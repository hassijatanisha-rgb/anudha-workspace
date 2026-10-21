-- Reuse private, immutable record attachments for customer-facing product brochures.
begin;
alter table public.document_attachments drop constraint document_attachments_record_type_check;
alter table public.document_attachments add constraint document_attachments_record_type_check
 check(record_type in ('proforma','delivery','service','accounting','contract','product'));

create or replace function public.document_attachment_parent_access(p_record_type text,p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then return false; end if;
 case p_record_type
 when 'proforma' then return (public.has_access('proformas') or public.has_access('deliveries')) and exists(select 1 from public.sales_proformas where id=p_record_id);
 when 'delivery' then return public.has_access('deliveries') and exists(select 1 from public.sales_delivery_notes where id=p_record_id);
 when 'service' then return public.has_access('service') and exists(select 1 from public.service_cases where id=p_record_id);
 when 'accounting' then return public.accounting_access() and exists(select 1 from public.accounting_drafts where id=p_record_id);
 when 'contract' then return exists(select 1 from public.customer_contracts where id=p_record_id and public.customer_contract_access(kind));
 when 'product' then return (public.has_access('records') or public.has_access('stock') or public.has_access('proformas') or public.has_access('deliveries') or public.has_access('service'))
  and exists(select 1 from public.products where id=p_record_id and deleted_at is null);
 else return false;
 end case;
end $$;
create or replace function public.document_attachment_path_access(p_path text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_path is null or p_path !~ '^(proforma|delivery|service|accounting|contract|product)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$' then return false; end if;
 return public.document_attachment_parent_access(split_part(p_path,'/',1),split_part(p_path,'/',2)::uuid);
end $$;
revoke all on function public.document_attachment_parent_access(text,uuid),public.document_attachment_path_access(text) from public,anon;
grant execute on function public.document_attachment_parent_access(text,uuid),public.document_attachment_path_access(text) to authenticated;
commit;
