// Disposable PostgreSQL fixture shared by complete and split-order rehearsals.
// Auth claims and uploaded-file metadata are boundaries; workflow code is installed from actual migrations.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export async function createOrderFixture({extraMigrations=[],missingOrderPrerequisites=false}={}){
 const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),SALES=id(2),ACCOUNTS=id(3),PACKER=id(4),DRIVER=id(5),ENGINEER=id(6),OUTSIDER=id(7);
const ORG=id(10),CONTACT=id(11),MACHINE=id(12),REAGENT=id(13),HUB=id(14),MACHINE_PACK=id(15),REAGENT_PACK=id(16),MACHINE_LOT=id(17),REAGENT_LOT=id(18),PF=id(20),NOTE=id(21);
const mig=file=>readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8');
const installed=[];
const load=async file=>{await db.exec(mig(file));installed.push(file);};
const loadFunction=async(file,name)=>{
 const definition=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));
 assert.ok(definition,`Expected ${name} in ${file}`);await db.exec(definition[0]);installed.push(`${file}:${name}`);
};
const as=actor=>db.query("select set_config('test.actor',$1,false)",[actor]);
const admin=async(sql,params=[])=>{await db.exec('reset role');try{return await db.query(sql,params);}finally{await db.exec('set role authenticated');}};
const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))$$;
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[],display_name text);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,location text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text,title text,first_name text,last_name text,country_code text,phone text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema auth,storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;
 insert into auth.users(id) values('${OWNER}'),('${SALES}'),('${ACCOUNTS}'),('${PACKER}'),('${DRIVER}'),('${ENGINEER}'),('${OUTSIDER}');
 insert into staff values('${OWNER}',true,'owner','management','{}','Fixture owner'),('${SALES}',true,'staff','sales','{proformas}','Fixture sales'),
 ('${ACCOUNTS}',true,'head','accounts','{proformas,deliveries}','Fixture accounts'),('${PACKER}',true,'staff','stores','{deliveries}','Fixture packer'),
 ('${DRIVER}',true,'staff','stores','{deliveries}','Fixture driver'),('${ENGINEER}',true,'staff','service','{service}','Fixture engineer'),
 ('${OUTSIDER}',true,'staff','marketing','{leads}','Fixture outsider');
 insert into products values('${MACHINE}','Fictional Analyzer',null),('${REAGENT}','Fictional Reagent',null);
 insert into organizations values('${ORG}','Fictional Clinic','Fixture Dar laboratory',null);
 insert into contacts values('${CONTACT}','${ORG}',null,'valid','Dr','Fixture','Customer','+255','000000000');`);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql',
  '202609210005_sales_office_workflow.sql','202609210007_sales_office_contract.sql','202609210008_service_workflow.sql','202609210010_accounting_tax_invoice_reservation.sql',
  '202609230015_accounting_membership.sql','202609230019_accounting_drafts.sql','202609250024_proforma_save_validation.sql','202609250027_document_attachments.sql',
  '202609250028_service_report_recordset.sql','202609300042_sales_leads.sql','202609300043_pending_stock_requests.sql','202609300045_work_assignments.sql','202609300046_suppliers_purchasing.sql','202610010050_tally_sales_invoices.sql',
  '202610010056_team_tasks.sql','202610010057_travel_requests.sql','202610070068_task_reschedule.sql','202610150083_deadline_approval.sql'])await load(file);
 // The unrelated client/product archive triggers are outside this fixture; retain the actual Pro forma columns.
 for(const line of mig('202609260029_admin_soft_delete.sql').split('\n').filter(line=>line.startsWith('alter table public.sales_proformas ')))await db.exec(line);
 await load('202610140080_require_two_step.sql');await load('202610160088_two_step_monthly.sql');
 for(const name of ['inventory_active_staff','inventory_owner'])await loadFunction('202610010058_two_step_sign_in.sql',name);
 for(const name of ['has_access','require_access','is_department_head','save_sales_proforma','create_sales_delivery_note','start_sales_delivery_packing','advance_sales_delivery','advance_service_case','save_purchase_request','advance_travel_request'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 // Actual access policies for the order/service tables; auth transport is represented by fixture token claims.
 for(const line of mig('202610050060_department_heads_and_access.sql').split('\n').filter(line=>/^alter policy (sales_proforma|sales_delivery|service_)/.test(line)))await db.exec(line);
 await load('202610070072_delivery_staff_read_order_items.sql');
 const automatic=mig('202610010051_automatic_handoffs.sql');
 const prefix=automatic.slice(0,automatic.indexOf('create function public.handoff_proforma'));
 assert.ok(prefix.includes('create function public.auto_close_work'));await db.exec(prefix+'\ncommit;');installed.push('202610010051_automatic_handoffs.sql:tables and automatic assignment helpers');
 for(const name of ['handoff_proforma','handoff_delivery','handoff_service','handoff_pending'])await loadFunction('202610010051_automatic_handoffs.sql',name);
 for(const table of ['sales_proformas','sales_delivery_notes','service_cases','pending_stock_requests']){
  const trigger=automatic.match(new RegExp(`create trigger ${table}_handoff[^;]+;`));assert.ok(trigger);await db.exec(trigger[0]);
 }
 await db.exec(`revoke all on function public.auto_assign_work(text,uuid,text,text,uuid,text),public.auto_close_work(text,uuid,text,text),public.auto_notice(uuid,text,uuid,text,text),public.handoff_proforma(),public.handoff_delivery(),public.handoff_service(),public.handoff_pending() from public,anon,authenticated;`);
 for(const file of ['202610050061_step_stays_with_whoever_acts.sql','202610090077_service_change_work_date.sql','202610090078_packing_queue.sql',
  '202610130079_discount_approval.sql','202610150081_delivery_proof_required.sql','202610150082_customer_returns.sql','202610150084_serial_numbers.sql','202610150085_pending_retry_content.sql',
  '202610160087_accounting_ledger.sql','202610160090_invoice_on_submit.sql','202610160091_erp_tax_invoice.sql','202610160092_workflow_authorization.sql',
  '202610160093_accounting_integrity.sql','202610160094_proforma_integrity.sql','202610160095_operational_integrity.sql'])await load(file);
 if(missingOrderPrerequisites)await db.exec(`drop trigger sales_tax_invoice_requires_stock on sales_delivery_notes;
 drop trigger release_cancelled_tax_invoice_stock on sales_delivery_notes;
 drop function guard_tax_invoice_stock_reservation();drop function release_cancelled_tax_invoice_stock();
 drop function create_tax_invoice_and_reserve_stock(uuid,integer,text);drop function start_reserved_sales_delivery_packing(uuid,integer);
 drop function packing_release(uuid,integer,text);`);
 await load('202610170001_restore_order_reservation_prerequisites.sql');
 for(const file of ['202610180100_work_assignment_access.sql','202610180101_service_assignee_access.sql','202610180102_packing_shipping_handoffs.sql'])await load(file);
 // The ERP invoice/stock linkage migration is part of this rehearsal's release contract.
 await load('202610180103_erp_invoice_delivery_link.sql');
 await load('202610180104_active_invoice_dispatch.sql');
 await load('202610180105_work_handoff_parent_state.sql');
 await load('202610180106_order_stock_expiry.sql');
 for(const file of extraMigrations)await load(file);
 await db.exec(`insert into accounting_memberships(user_id,active,approved_by,approval_reference) values('${ACCOUNTS}',true,'${OWNER}','Fictional rehearsal only'),('${OWNER}',true,'${OWNER}','Fictional authorized operator');
 insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${HUB}','Fixture Haadi','FIX-H','dispatch_hub',true,'${OWNER}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values
 ('${MACHINE_PACK}','${MACHINE}',1,'unit',1,'Fixture pack','${OWNER}'),('${REAGENT_PACK}','${REAGENT}',1,'kit',1,'Fixture pack','${OWNER}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units) values
 ('${MACHINE_LOT}','${MACHINE}','${HUB}','${MACHINE_PACK}','FIX-M',10),('${REAGENT_LOT}','${REAGENT}','${HUB}','${REAGENT_PACK}','FIX-R',20);
 insert into product_inventory_classifications(id,product_id,version,category,reason,created_by) values
 ('${id(30)}','${MACHINE}',1,'machines','Fixture reviewed machine','${OWNER}'),('${id(31)}','${REAGENT}',1,'reagents','Fixture reviewed reagent','${OWNER}');`);
 await db.exec('set role authenticated');await as(OWNER);
 for(const [step,actor] of [['invoice',ACCOUNTS],['packing',PACKER],['delivery',DRIVER],['installation',ENGINEER],['service',ENGINEER]])await db.query('select set_workflow_step_owner($1,0,$2,$3::uuid[])',[step,actor,[actor]]);
 await db.query('select set_product_serial_required($1,true)',[MACHINE]);
 const dates=await one("select current_date::text today,(current_date+30)::text valid,(current_date+7)::text delivery");
 return {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,ENGINEER,OUTSIDER,ORG,CONTACT,MACHINE,REAGENT,HUB,MACHINE_PACK,REAGENT_PACK,MACHINE_LOT,REAGENT_LOT,PF,NOTE,installed,as,admin,one,dates,load};
}catch(error){await db.close();throw error;}
}
