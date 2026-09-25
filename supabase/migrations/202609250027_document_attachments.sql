-- Private record-linked supporting files. No fiscal issuance or document replacement.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('erp-documents','erp-documents',false,10485760,array['application/pdf','image/jpeg','image/png']);

create function public.document_attachment_parent_access(p_record_type text,p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then return false; end if;
 case p_record_type
 when 'proforma' then return exists(select 1 from public.sales_proformas where id=p_record_id);
 when 'delivery' then return exists(select 1 from public.sales_delivery_notes where id=p_record_id);
 when 'service' then return exists(select 1 from public.service_cases where id=p_record_id);
 when 'accounting' then return public.accounting_access() and exists(select 1 from public.accounting_drafts where id=p_record_id);
 else return false;
 end case;
end $$;
create function public.document_attachment_path_access(p_path text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_path is null or p_path !~ '^(proforma|delivery|service|accounting)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$' then return false; end if;
 return public.document_attachment_parent_access(split_part(p_path,'/',1),split_part(p_path,'/',2)::uuid);
end $$;
revoke all on function public.document_attachment_parent_access(text,uuid),public.document_attachment_path_access(text) from public,anon;
grant execute on function public.document_attachment_parent_access(text,uuid),public.document_attachment_path_access(text) to authenticated;

create table public.document_attachments (
 id uuid primary key,
 record_type text not null check(record_type in ('proforma','delivery','service','accounting')),
 record_id uuid not null,
 object_path text not null unique,
 original_filename text not null check(length(trim(original_filename)) between 1 and 255 and original_filename !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 byte_size bigint not null check(byte_size between 1 and 10485760),
 uploaded_by uuid not null references auth.users(id),
 uploaded_at timestamptz not null default now()
);
create index document_attachments_parent_page on public.document_attachments(record_type,record_id,uploaded_at desc,id desc);
create trigger document_attachments_immutable before update or delete on public.document_attachments
for each row execute function public.deny_sales_history_mutation();
alter table public.document_attachments enable row level security;
revoke all on public.document_attachments from public,anon,authenticated;
grant select on public.document_attachments to authenticated;
create policy document_attachments_read on public.document_attachments for select to authenticated
using(public.document_attachment_parent_access(record_type,record_id));

create policy erp_documents_upload on storage.objects for insert to authenticated
with check(bucket_id='erp-documents' and owner_id=auth.uid()::text and public.document_attachment_path_access(name));
create policy erp_documents_read on storage.objects for select to authenticated
using(bucket_id='erp-documents' and public.document_attachment_path_access(name));
-- Restrictive guards prevent an unrelated permissive storage policy broadening this bucket.
create policy erp_documents_upload_guard on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'erp-documents' or (owner_id=auth.uid()::text and public.document_attachment_path_access(name)));
create policy erp_documents_read_guard on storage.objects as restrictive for select to authenticated
using(bucket_id<>'erp-documents' or public.document_attachment_path_access(name));
create policy erp_documents_no_replace on storage.objects as restrictive for update to public
using(bucket_id<>'erp-documents') with check(bucket_id<>'erp-documents');
create policy erp_documents_no_delete on storage.objects as restrictive for delete to public
using(bucket_id<>'erp-documents');
create policy erp_documents_no_anon_read on storage.objects as restrictive for select to anon
using(bucket_id<>'erp-documents');
create policy erp_documents_no_anon_upload on storage.objects as restrictive for insert to anon
with check(bucket_id<>'erp-documents');

create function public.finalize_document_attachment(p_id uuid,p_record_type text,p_record_id uuid,p_object_path text,
 p_original_filename text,p_mime_type text,p_byte_size bigint)
returns public.document_attachments language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.document_attachments; v_object storage.objects; v_extension text;
begin
 if public.document_attachment_parent_access(p_record_type,p_record_id) is not true then raise exception 'Document parent access required'; end if;
 if p_id is null or p_object_path is null or p_original_filename is null or length(trim(p_original_filename)) not between 1 and 255
  or p_original_filename ~ '[[:cntrl:]/\\]' or p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png')
  or p_byte_size is null or p_byte_size not between 1 and 10485760 then raise exception 'Invalid attachment metadata'; end if;
 v_extension:=split_part(p_object_path,'.',2);
 if p_object_path<>p_record_type||'/'||p_record_id::text||'/'||p_id::text||'.'||v_extension
  or public.document_attachment_path_access(p_object_path) is not true
  or not ((p_mime_type='application/pdf' and v_extension='pdf') or (p_mime_type='image/jpeg' and v_extension in ('jpg','jpeg')) or (p_mime_type='image/png' and v_extension='png')) then
  raise exception 'Attachment path and MIME type do not match';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,270925));
 select * into v_row from public.document_attachments where id=p_id;
 if found then
  if v_row.record_type is distinct from p_record_type or v_row.record_id is distinct from p_record_id
   or v_row.object_path is distinct from p_object_path or v_row.original_filename is distinct from p_original_filename
   or v_row.mime_type is distinct from p_mime_type or v_row.byte_size is distinct from p_byte_size or v_row.uploaded_by is distinct from auth.uid() then
   raise exception 'Attachment request already used with different metadata';
  end if;
  return v_row;
 end if;
 select * into v_object from storage.objects where bucket_id='erp-documents' and name=p_object_path for share;
 if not found or v_object.owner_id is distinct from auth.uid()::text then raise exception 'Uploaded object is missing or belongs to another uploader'; end if;
 if v_object.metadata->>'size' is null or (v_object.metadata->>'size') !~ '^[0-9]{1,8}$' then raise exception 'Uploaded object size is missing or invalid'; end if;
 if (v_object.metadata->>'size')::bigint<>p_byte_size or v_object.metadata->>'mimetype' is distinct from p_mime_type then
  raise exception 'Uploaded object metadata does not match';
 end if;
 insert into public.document_attachments(id,record_type,record_id,object_path,original_filename,mime_type,byte_size,uploaded_by)
 values(p_id,p_record_type,p_record_id,p_object_path,p_original_filename,p_mime_type,p_byte_size,auth.uid()) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.finalize_document_attachment(uuid,text,uuid,text,text,text,bigint) from public,anon;
grant execute on function public.finalize_document_attachment(uuid,text,uuid,text,text,text,bigint) to authenticated;
commit;
