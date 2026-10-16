// Disposable PostgreSQL fixture only; no live database or storage access.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const mig=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const OWNER=id(1),REQUESTER=id(2),BUYER=id(3),OUTSIDER=id(4),ENGINEER=id(5),DELIVERY=id(6),ACCOUNTANT=id(7),INACTIVE=id(8);
const PRODUCT=id(20),ORG=id(21),CONTACT=id(22),PROFORMA=id(23),DELIVERY_NOTE=id(24),ASSET=id(25),SERVICE_CASE=id(26),DRAFT=id(27),PURCHASE=id(28),TASK=id(29);
const signature={
 attachment:'public.document_attachment_parent_access(text,uuid)',
 service:'public.complete_service_report(uuid,integer,date,text,text,text,text,text,text,text,uuid,text,date,text,date,text,text,date,text,boolean,text,boolean,text,date,text,text,bigint,text,integer,jsonb,jsonb)',
 purchase:'public.save_purchase_request(uuid,integer,uuid,text,date,text,jsonb)',
 task:'public.save_team_task(uuid,integer,text,text,text,timestamp with time zone,uuid)'
};
let checks=0;const check=async f=>{await f();checks++;};
const as=async(actor,aal='aal2')=>{await db.query("select set_config('test.actor',$1,false),set_config('test.aal',$2,false)",[actor??'',aal]);};
const admin=async(sql,params=[])=>{await db.exec('reset role');try{return await db.query(sql,params);}finally{await db.exec('set role authenticated');}};
const parent=(type,parentId)=>db.query('select document_attachment_parent_access($1,$2) allowed',[type,parentId]).then(r=>r.rows[0].allowed);
const path=(type,parentId,attachmentId)=>`${type}/${parentId}/${attachmentId}.pdf`;
const upload=(type,parentId,attachmentId,actor)=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,'{\"size\":321,\"mimetype\":\"application/pdf\"}')",[path(type,parentId,attachmentId),actor]);
const finalize=(type,parentId,attachmentId)=>db.query('select * from finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[attachmentId,type,parentId,path(type,parentId,attachmentId),'Fixture.pdf','application/pdf',321]);
const purchase=(version,quantity=1)=>db.query('select * from save_purchase_request($1,$2,null,$3,null,$4,$5::jsonb)',[PURCHASE,version,'TZS','Fixture purchase',JSON.stringify([{product_id:PRODUCT,quantity}])]).then(r=>r.rows[0]);
const days=n=>new Date(Date.now()+n*86400000).toISOString();
const task=(taskId,version,due,assignee=BUYER,title='Call fixture clinic')=>db.query('select * from save_team_task($1,$2,$3,$4,$5,$6,$7)',[taskId,version,title,'Fixture details','normal',due,assignee]).then(r=>r.rows[0]);
const today=new Date().toISOString().slice(0,10);
const complete=()=>db.query(`select * from complete_service_report(${Array.from({length:31},(_,i)=>'$'+(i+1)).join(',')})`,[
 SERVICE_CASE,1,today,'Fixture model','FIXTURE-SERIAL','Fixture laboratory','','Service complete','Inspected and repaired','',ENGINEER,'Fixture Engineer',
 today,'Fixture Customer',today,'Customer signed','Fixture Anudha',today,'Engineer signed',false,null,false,null,null,null,'TZS',0,'',6,
 JSON.stringify([{description:'Fixture accessory',serial_number:'ACC-1'}]),'[]'
]).then(r=>r.rows[0]);
// Load the current shared guards and purchasing RPC directly from their migrations.
const loadFunction=async(file,name)=>{
 const definition=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));
 assert.ok(definition,`Function ${name} exists in ${file}`);await db.exec(definition[0]);
};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text,title text,first_name text,last_name text,country_code text,phone text);
 create table pending_stock_requests(id uuid primary key,product_id uuid);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage,auth to authenticated,anon;
 grant select,insert,update,delete on storage.objects to authenticated,anon;
 create policy unrelated_permissive_policy on storage.objects for all to authenticated,anon using(true) with check(true);
 insert into auth.users(id) values('${OWNER}'),('${REQUESTER}'),('${BUYER}'),('${OUTSIDER}'),('${ENGINEER}'),('${DELIVERY}'),('${ACCOUNTANT}'),('${INACTIVE}');
 insert into staff values('${OWNER}',true,'owner','management','{}'),('${REQUESTER}',true,'head','sales','{purchasing,proformas}'),
 ('${BUYER}',true,'staff','sales','{purchasing}'),('${OUTSIDER}',true,'staff','sales','{reports}'),('${ENGINEER}',true,'staff','service','{service}'),
 ('${DELIVERY}',true,'staff','stores','{deliveries}'),('${ACCOUNTANT}',true,'staff','accounts','{}'),('${INACTIVE}',false,'staff','service','{service}');
 insert into products values('${PRODUCT}','Fixture machine',null);insert into organizations values('${ORG}','Fixture clinic',null);
 insert into contacts values('${CONTACT}','${ORG}',null,'valid','','Fixture','Customer','+255','000000000');`);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql',
  '202609210005_sales_office_workflow.sql','202609210007_sales_office_contract.sql','202609210008_service_workflow.sql','202609230015_accounting_membership.sql',
  '202609230019_accounting_drafts.sql','202609250027_document_attachments.sql','202609250028_service_report_recordset.sql','202609300046_suppliers_purchasing.sql',
  '202610010056_team_tasks.sql','202610070068_task_reschedule.sql','202610150083_deadline_approval.sql'])await db.exec(mig(file));
 await db.exec(mig('202610140080_require_two_step.sql'));
 for(const name of ['inventory_active_staff','inventory_owner'])await loadFunction('202610010058_two_step_sign_in.sql',name);
 for(const name of ['has_access','require_access','save_purchase_request'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 await as(ACCOUNTANT);
 await db.exec(`insert into accounting_memberships values('${ACCOUNTANT}',true,'${OWNER}','Fixture only',now());
 insert into sales_proformas(id,document_number,organization_id,contact_id,valid_until,delivery_period,payment_terms,prepared_by)
 values('${PROFORMA}','PF-FIXTURE','${ORG}','${CONTACT}',current_date+30,'7 days','On delivery','${REQUESTER}');
 insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,accounts_reference,expected_delivery_date,created_by)
 values('${DELIVERY_NOTE}','DN-FIXTURE','${PROFORMA}','${ORG}','${CONTACT}','Fixture approval',current_date+7,'${DELIVERY}');
 insert into equipment_assets(id,organization_id,product_id) values('${ASSET}','${ORG}','${PRODUCT}');
 insert into service_cases(id,case_number,case_type,asset_id,organization_id,contact_id,product_id,status,assigned_user_id,scheduled_for,created_by)
 values('${SERVICE_CASE}','SC-FIXTURE','service','${ASSET}','${ORG}','${CONTACT}','${PRODUCT}','report_required','${ENGINEER}',current_date,'${ENGINEER}');
 select save_accounting_draft('${DRAFT}','payment',0,null,null,'{"lines":[]}');`);
 const metadata=async()=>db.query('select oid,proacl,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[Object.values(signature)]).then(r=>r.rows);
 const before=await metadata();
 await db.exec(mig('202610160092_workflow_authorization.sql'));await db.exec(mig('202610160092_workflow_authorization.sql'));
 await check(async()=>assert.deepEqual(await metadata(),before,'Migration reruns preserve function identities, grants, definer and search paths'));
 await db.exec('set role authenticated');

 // The parent helper, metadata RLS, storage RLS and finalization agree on area access.
 for(const [type,parentId,actor,attachmentId] of [['proforma',PROFORMA,REQUESTER,id(100)],['delivery',DELIVERY_NOTE,DELIVERY,id(101)],['service',SERVICE_CASE,ENGINEER,id(102)],['accounting',DRAFT,ACCOUNTANT,id(103)]]){
  await as(actor);await check(async()=>{assert.equal(await parent(type,parentId),true);await upload(type,parentId,attachmentId,actor);await finalize(type,parentId,attachmentId);});
  await as(OUTSIDER);await check(async()=>{
   assert.equal(await parent(type,parentId),false);
   assert.equal((await db.query('select * from document_attachments where record_type=$1',[type])).rows.length,0);
   assert.equal((await db.query('select * from storage.objects where name=$1',[path(type,parentId,attachmentId)])).rows.length,0);
   await assert.rejects(upload(type,parentId,id(200+Number(attachmentId.slice(-3))),OUTSIDER),/row-level security/);
   await assert.rejects(finalize(type,parentId,attachmentId),/parent access/);
  });
 }
 await as(DELIVERY);await check(async()=>{assert.equal(await parent('proforma',PROFORMA),true);assert.equal(await parent('service',SERVICE_CASE),false);});
 await as(REQUESTER);await check(async()=>{assert.equal(await parent('delivery',DELIVERY_NOTE),false);assert.equal(await parent('proforma',id(999)),false);assert.equal(await parent('unknown',PROFORMA),false);});
 await as(OWNER);await check(async()=>{for(const [type,parentId] of [['proforma',PROFORMA],['delivery',DELIVERY_NOTE],['service',SERVICE_CASE]])assert.equal(await parent(type,parentId),true);assert.equal(await parent('accounting',DRAFT),false,'Owner still needs accounting membership');});

 // A caller with another area cannot complete or partially mutate a service case.
 await as(OUTSIDER);await check(()=>assert.rejects(complete(),/do not have access to service/));
 await check(async()=>{assert.deepEqual((await admin('select status,version from service_cases where id=$1',[SERVICE_CASE])).rows[0],{status:'report_required',version:1});assert.equal((await admin('select count(*)::int n from service_reports')).rows[0].n,0);});
 await as(ENGINEER);await check(async()=>{assert.equal((await complete()).status,'completed');assert.equal((await admin('select count(*)::int n from service_report_accessories')).rows[0].n,1);});
 await check(()=>assert.rejects(complete(),/changed or is not ready/));

 // Same-area staff cannot replace another person's request or its lines/history.
 await as(REQUESTER);await purchase(0);
 await as(BUYER);await check(()=>assert.rejects(purchase(1,99),/Only the requester or the owner/));
 await check(async()=>{const r=(await admin('select quantity from purchase_order_lines')).rows;assert.deepEqual(r,[{quantity:1}]);assert.equal((await admin('select count(*)::int n from purchase_order_events')).rows[0].n,1);});
 await as(REQUESTER);await check(async()=>assert.equal((await purchase(1,2)).version,2));
 await check(()=>assert.rejects(purchase(1,3),/changed; refresh/));
 await as(OWNER);await check(async()=>assert.equal((await purchase(2,3)).version,3));
 await as(OUTSIDER);await check(()=>assert.rejects(purchase(3,4),/do not have access to purchasing/));

 // Giving a task (including to oneself) does not authorize bypassing deadline approval.
 await as(REQUESTER);let saved=await task(TASK,0,days(1));
 await check(()=>assert.rejects(task(TASK,1,days(2)),/department head's approval/));
 await check(async()=>{const r=(await db.query('select due_at,version,reschedule_count from team_tasks where id=$1',[TASK])).rows[0];assert.deepEqual([r.due_at,r.version,r.reschedule_count],[saved.due_at,1,0]);});
 await check(async()=>{saved=await task(TASK,1,saved.due_at,BUYER,'Call fixture clinic today');assert.equal(saved.version,2);});
 await check(()=>assert.rejects(task(TASK,1,saved.due_at),/Task changed/));
 await as(BUYER);const self=await task(id(30),0,days(1),BUYER);
 await check(()=>assert.rejects(task(self.id,1,days(2),BUYER),/department head's approval/));
 const requested=(await db.query('select * from request_team_task_reschedule($1,$2,$3,$4,$5)',[id(31),TASK,saved.version,days(3),'Customer requested a later call'])).rows[0];
 await as(REQUESTER);await check(async()=>{
  await db.query('select * from decide_team_task_reschedule($1,$2,$3)',[requested.id,'approved','Confirmed with customer']);
  const r=(await db.query('select * from team_tasks where id=$1',[TASK])).rows[0];assert.equal(r.reschedule_count,1);assert.deepEqual(r.due_at,requested.requested_due_at);
 });
 await as(OWNER);await check(async()=>assert.equal((await task(TASK,3,days(4))).version,4,'Owner retains direct edit permission'));

 // Existing active-staff and two-step guards still apply to every modified entry point.
 for(const [actor,aal] of [[INACTIVE,'aal2'],[OWNER,'aal1'],[null,'aal2']]){
  await as(actor,aal);await check(async()=>{
   assert.equal(await parent('service',SERVICE_CASE),false);
   await assert.rejects(complete(),/do not have access to service/);
   await assert.rejects(purchase(3),/do not have access to purchasing/);
   await assert.rejects(task(id(40),0,days(1)),/Active staff/);
  });
 }
 await as(null);await db.exec('reset role;set role anon');
 await check(async()=>{for(const fn of Object.values(signature))assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[fn])).rows[0].allowed,false);});
 console.log(`PASS: ${checks} workflow authorization checks; parent-area storage/metadata/finalization, service completion, requester ownership, deadline approval, preserved MFA/version guards/grants and migration rerun.`);
}finally{await db.close();}
