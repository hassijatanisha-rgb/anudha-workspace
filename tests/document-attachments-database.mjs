// Disposable database with platform auth/storage scaffolding; no live uploads.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text);
 create table products(id uuid primary key,name text);
 create table organizations(id uuid primary key,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage,auth to authenticated,anon;
 grant select,insert,update,delete on storage.objects to authenticated,anon;
 -- Simulate an unrelated permissive policy to verify the restrictive bucket guards.
 create policy unrelated_permissive_policy on storage.objects for all to authenticated,anon using(true) with check(true);
 insert into auth.users values('${id(1)}','accountant@example.invalid'),('${id(2)}','staff@example.invalid'),('${id(30)}','inactive@example.invalid');
 insert into staff values('${id(1)}',true,'staff'),('${id(2)}',true,'staff'),('${id(30)}',false,'staff');
 insert into products values('${id(3)}','Fictional widget');insert into organizations values('${id(4)}',null);
 insert into contacts values('${id(5)}','${id(4)}',null,'valid');set test.actor='${id(1)}';`);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql','202609210005_sales_office_workflow.sql','202609210007_sales_office_contract.sql','202609210008_service_workflow.sql','202609230015_accounting_membership.sql','202609230019_accounting_drafts.sql','202609250024_proforma_save_validation.sql','202609250027_document_attachments.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into accounting_memberships values('${id(1)}',true,'${id(1)}','Fictional test only',now());
 insert into sales_proformas(id,document_number,organization_id,contact_id,valid_until,delivery_period,payment_terms,prepared_by)
 values('${id(6)}','PF-FIXTURE','${id(4)}','${id(5)}',current_date+30,'7 days','On delivery','${id(1)}');
 insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,accounts_reference,expected_delivery_date,created_by)
 values('${id(7)}','DN-FIXTURE','${id(6)}','${id(4)}','${id(5)}','Fixture approval',current_date+7,'${id(1)}');
 insert into equipment_assets(id,organization_id,product_id) values('${id(8)}','${id(4)}','${id(3)}');
 insert into service_cases(id,case_number,case_type,asset_id,organization_id,product_id,created_by)
 values('${id(9)}','SC-FIXTURE','service','${id(8)}','${id(4)}','${id(3)}','${id(1)}');
 select save_accounting_draft('${id(10)}','payment',0,null,null,'{"lines":[]}');`);
 const bucket=(await db.query("select * from storage.buckets where id='erp-documents'")).rows[0];
 assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),10485760);assert.deepEqual(bucket.allowed_mime_types,['application/pdf','image/jpeg','image/png']);
 const path=(type,parent,request,ext='pdf')=>`${type}/${id(parent)}/${id(request)}.${ext}`;
 const upload=(type,parent,request,owner=1,meta={size:321,mimetype:'application/pdf'},ext='pdf')=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3)",[path(type,parent,request,ext),id(owner),JSON.stringify(meta)]);
 const finalize=(type,parent,request,filename='Fictional example.pdf',mime='application/pdf',size=321,ext='pdf')=>db.query('select * from finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[id(request),type,id(parent),path(type,parent,request,ext),filename,mime,size]);
 await db.exec('set role authenticated');
 for(const [type,parent,request] of [['proforma',6,11],['delivery',7,12],['service',9,13],['accounting',10,14]]) {
  await upload(type,parent,request);const result=(await finalize(type,parent,request)).rows[0];
  assert.equal(result.uploaded_by,id(1));assert.equal(result.record_type,type);
  assert.deepEqual((await finalize(type,parent,request)).rows[0],result);
  await assert.rejects(finalize(type,parent,request,'Changed.pdf'),/different metadata/i);
 }
 await upload('proforma',6,31,1,{size:20,mimetype:'image/jpeg'},'jpg');await finalize('proforma',6,31,'Photo.jpg','image/jpeg',20,'jpg');
 await upload('proforma',6,32,1,{size:20,mimetype:'image/png'},'png');await finalize('proforma',6,32,'Photo.png','image/png',20,'png');
 await assert.rejects(finalize('proforma',6,15),/missing/i);
 await assert.rejects(upload('proforma',99,15),/row-level security/i);
 await assert.rejects(finalize('proforma',99,15),/parent access/i);
 await assert.rejects(upload('invalid',6,15),/row-level security/i);
 await assert.rejects(upload('proforma',6,15,2),/row-level security/i);
 await upload('proforma',6,16,1,{size:20,mimetype:'application/pdf'});
 await assert.rejects(finalize('proforma',6,16),/metadata does not match/i);
 await assert.rejects(finalize('proforma',6,16,'oversized.pdf','application/pdf',10485761),/Invalid attachment metadata/i);
 await assert.rejects(finalize('proforma',6,16,'../escape.pdf'),/Invalid attachment metadata/i);
 await assert.rejects(finalize('proforma',6,16,'file.html','text/html'),/Invalid attachment metadata/i);
 await assert.rejects(finalize('proforma',6,16,'file.png','image/png',20),/path and MIME/i);
 await upload('proforma',6,17,1,{mimetype:'application/pdf'});await assert.rejects(finalize('proforma',6,17),/size is missing/i);
 await upload('proforma',6,18,1,{size:321,mimetype:'image/png'});await assert.rejects(finalize('proforma',6,18),/metadata does not match/i);
 assert.equal((await db.query("update storage.objects set metadata='{}' where bucket_id='erp-documents' returning id")).rows.length,0);
 assert.equal((await db.query("delete from storage.objects where bucket_id='erp-documents' returning id")).rows.length,0);
 await assert.rejects(db.exec('delete from document_attachments'),/permission denied/i);
 await assert.rejects(db.exec('insert into document_attachments select * from document_attachments'),/permission denied/i);
 await db.exec(`set test.actor='${id(2)}'`);
 assert.equal((await db.query("select * from document_attachments where record_type='accounting'")).rows.length,0);
 assert.equal((await db.query("select * from storage.objects where name like 'accounting/%'")).rows.length,0);
 await assert.rejects(upload('accounting',10,19,2),/row-level security/i);
 await assert.rejects(finalize('accounting',10,14),/parent access/i);
 await assert.rejects(finalize('proforma',6,11),/different metadata/i);
 await assert.rejects(finalize('proforma',6,16,'Fictional example.pdf','application/pdf',20),/another uploader/i);
 await upload('service',9,20,2);await finalize('service',9,20);
 await db.exec(`set test.actor='${id(30)}'`);
 assert.equal((await db.query('select * from document_attachments')).rows.length,0);
 assert.equal((await db.query("select * from storage.objects where bucket_id='erp-documents'")).rows.length,0);
 await assert.rejects(upload('service',9,21,30),/row-level security/i);
 await db.exec("reset role;set role anon;set test.actor=''");
 assert.equal((await db.query("select * from storage.objects where bucket_id='erp-documents'")).rows.length,0);
 await assert.rejects(upload('service',9,22),/row-level security/i);
 await assert.rejects(finalize('service',9,20),/permission denied/i);
 await db.exec('reset role');
 await assert.rejects(db.exec("update document_attachments set original_filename='Replaced.pdf'"),/immutable/i);
 await assert.rejects(db.exec('delete from document_attachments'),/immutable/i);
 console.log('PASS: private bucket constraints, four real parent schemas, immutable metadata, exact retry, object-owner/MIME/size validation, denied missing parents/accounting cross-access/inactive/anonymous access, restrictive storage replacement/deletion guards.');
} finally {await db.close();}
