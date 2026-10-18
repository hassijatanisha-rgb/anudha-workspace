// Disposable PostgreSQL only. Exercises the real delivery/service migrations with fictional records.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),ENGINEER=id(2),SALES=id(3),INACTIVE=id(4),MISSING_ACCESS=id(5);
const ORG=id(10),CONTACT=id(11),MACHINE=id(12),REAGENT=id(13),UNCLASSIFIED=id(14),RECLASSIFIED=id(15),PF=id(20),NOTE=id(21),HUB=id(22);
const mig=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const as=actor=>db.query("select set_config('test.actor',$1,false)",[actor]);
let checks=0;const check=async fn=>{await fn();checks++;};
const loadFunction=async(file,name)=>{
 const definition=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));
 assert.ok(definition,`Expected ${name} in ${file}`);await db.exec(definition[0]);
};
const advance=(caseId,version,action,assignee=null,date=null)=>db.query('select * from advance_service_case($1,$2,$3,$4,$5,$6)',[caseId,version,action,assignee,date,'Fixture service progress']).then(r=>r.rows[0]);
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 grant usage on schema auth to authenticated;
 insert into auth.users(id) values('${OWNER}'),('${ENGINEER}'),('${SALES}'),('${INACTIVE}'),('${MISSING_ACCESS}');
 insert into staff values('${OWNER}',true,'owner','management','{}'),('${ENGINEER}',true,'staff','service','{service}'),
 ('${SALES}',true,'staff','sales','{deliveries,proformas}'),('${INACTIVE}',false,'staff','service','{service}'),('${MISSING_ACCESS}',true,'staff','service',null);
 insert into products values('${MACHINE}','Fixture analyzer',null),('${REAGENT}','Fixture reagent',null),('${UNCLASSIFIED}','Fixture unclassified',null),('${RECLASSIFIED}','Fixture reviewed item',null);
 insert into organizations values('${ORG}','Fixture clinic',null);
 insert into contacts values('${CONTACT}','${ORG}',null,'valid');`);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql',
  '202609210005_sales_office_workflow.sql','202609210008_service_workflow.sql'])await db.exec(mig(file));
 await db.exec('create function public.mfa_satisfied() returns boolean language sql stable as $$select true$$;');
 for(const name of ['has_access','require_access'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 for(const table of ['service_cases','service_case_events']){
  const policy=mig('202610050060_department_heads_and_access.sql').split('\n').find(line=>line.startsWith(`alter policy ${table}_read `));
  assert.ok(policy);await db.exec(policy);
 }
 await db.exec(mig('202610090077_service_change_work_date.sql'));
 const metadata=async()=>(await db.query("select oid,proacl,prosecdef,proconfig from pg_proc where oid='public.advance_service_case(uuid,integer,text,uuid,date,text)'::regprocedure")).rows[0];
 const before=await metadata();
 await db.exec(mig('202610180101_service_assignee_access.sql'));await db.exec(mig('202610180101_service_assignee_access.sql'));
 await check(async()=>assert.deepEqual(await metadata(),before,'Reapplying the patch preserves RPC identity, grants and definer settings'));
 await as(SALES);
 await db.exec(`insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${HUB}','Fixture dispatch','FIX','dispatch_hub',true,'${OWNER}');
 insert into product_inventory_classifications(id,product_id,version,category,reason,created_by) values
 ('${id(30)}','${MACHINE}',1,'unclassified','Fixture original','${OWNER}'),('${id(31)}','${MACHINE}',2,'machines','Fixture reviewed','${OWNER}'),
 ('${id(32)}','${REAGENT}',1,'reagents','Fixture reviewed','${OWNER}'),('${id(33)}','${RECLASSIFIED}',1,'machines','Fixture original','${OWNER}'),
 ('${id(34)}','${RECLASSIFIED}',2,'consumables','Fixture reviewed','${OWNER}');
 insert into sales_proformas(id,document_number,organization_id,contact_id,valid_until,delivery_period,payment_terms,prepared_by)
 values('${PF}','PF-FIXTURE','${ORG}','${CONTACT}',current_date+30,'Seven days','On delivery','${SALES}');
 insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,status,accounts_reference,expected_delivery_date,created_by)
 values('${NOTE}','DN-FIXTURE','${PF}','${ORG}','${CONTACT}','packing','Fixture approval',current_date+7,'${SALES}');`);
 for(const [index,product] of [MACHINE,REAGENT,UNCLASSIFIED,RECLASSIFIED].entries()){
  const pack=id(40+index),lot=id(50+index),line=id(60+index),deliveryLine=id(70+index),quantity=index===0?2:1;
  await db.query("insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values($1,$2,1,'unit',1,'Fixture pack',$3)",[pack,product,OWNER]);
  await db.query('insert into inventory_lots(id,product_id,location_id,pack_definition_id,loose_units) values($1,$2,$3,$4,10)',[lot,product,HUB,pack]);
  await db.query("insert into sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor) values($1,$2,$3,$4,'Fixture item',$5,'unit',100)",[line,PF,product,index+1,quantity]);
  await db.query('insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values($1,$2,$3,$4,$5,$6)',[deliveryLine,NOTE,line,product,lot,quantity]);
 }
 for(const status of ['packing','ready','out_for_delivery']){
  await db.query(`update sales_delivery_notes set status=$1,dispatched_at=case when $1='out_for_delivery' then now() end,dispatched_by=case when $1='out_for_delivery' then $2::uuid end where id=$3`,[status,SALES,NOTE]);
  await check(async()=>assert.equal((await db.query('select count(*)::int n from service_cases')).rows[0].n,0,`No installation before signed delivery (${status})`));
 }
 await db.query("update sales_delivery_notes set status='delivered',delivered_at=now(),delivered_by=$1,recipient_name='Fixture recipient',proof_reference='Fixture signed proof' where id=$2",[SALES,NOTE]);
 const cases=(await db.query('select * from service_cases order by case_number')).rows;
 await check(async()=>{assert.equal(cases.length,2);assert.ok(cases.every(row=>row.product_id===MACHINE&&row.source_delivery_note_id===NOTE&&row.organization_id===ORG&&row.contact_id===CONTACT&&row.created_by===SALES&&row.status==='new'&&row.case_type==='installation'));});
 await check(async()=>assert.deepEqual((await db.query('select source_delivery_line_id,unit_number,status from equipment_assets order by unit_number')).rows,[
  {source_delivery_line_id:id(70),unit_number:1,status:'pending_installation'},
  {source_delivery_line_id:id(70),unit_number:2,status:'pending_installation'}
 ]));
 await db.query("update sales_delivery_notes set status='delivered' where id=$1",[NOTE]);
 await db.exec(mig('202609210009_service_legacy_handoff.sql'));await db.exec(mig('202609210009_service_legacy_handoff.sql'));
 await check(async()=>{assert.equal((await db.query('select count(*)::int n from service_cases')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from equipment_assets')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from service_case_events')).rows[0].n,2);});

 await db.exec('set role authenticated');
 const first=cases[0].id,second=cases[1].id;
 await as(SALES);
 await check(async()=>{assert.equal((await db.query('select count(*)::int n from service_cases')).rows[0].n,0);await assert.rejects(advance(first,1,'assign',SALES),/do not have access to service/);});
 await as(ENGINEER);
 for(const assignee of [SALES,INACTIVE,MISSING_ACCESS,null])await check(()=>assert.rejects(advance(first,1,'assign',assignee),/active employee with Service access/));
 await check(async()=>{assert.deepEqual((await db.query('select status,version,assigned_user_id from service_cases where id=$1',[first])).rows[0],{status:'new',version:1,assigned_user_id:null});assert.equal((await db.query('select count(*)::int n from service_case_events where case_id=$1',[first])).rows[0].n,1);});
 await check(async()=>{const row=await advance(first,1,'assign',ENGINEER);assert.equal(row.status,'assigned');assert.equal(row.assigned_user_id,ENGINEER);assert.equal(row.hod_user_id,ENGINEER);});
 await check(()=>assert.rejects(advance(first,1,'assign',ENGINEER),/changed; refresh/));
 await check(()=>assert.rejects(advance(first,2,'reassign',SALES),/active employee with Service access/));
 const today=(await db.query('select current_date::text d')).rows[0].d;
 await check(async()=>assert.equal((await advance(first,2,'schedule',null,today)).status,'scheduled'));
 await check(async()=>assert.equal((await advance(first,3,'start')).status,'on_site'));
 await check(async()=>assert.equal((await advance(first,4,'submit_report')).status,'report_required'));
 await check(async()=>{const row=await advance(second,1,'assign',OWNER);assert.equal(row.assigned_user_id,OWNER);assert.equal(row.status,'assigned');});
 await db.exec('reset role');await db.query("update staff set access='{}' where user_id=$1",[ENGINEER]);await db.exec('set role authenticated');
 await check(()=>assert.rejects(advance(second,2,'reassign',ENGINEER),/do not have access to service/));
 await as(OWNER);
 await check(()=>assert.rejects(advance(second,2,'reassign',ENGINEER),/active employee with Service access/));
 await check(async()=>assert.equal((await advance(second,2,'cancel')).status,'cancelled'));
 await db.exec('set role anon');
 await check(()=>assert.rejects(advance(second,3,'assign',OWNER),/permission denied/));
 console.log(`PASS: ${checks} service handoff checks; machine units, classification, signed-delivery timing, source links, idempotency, access, self-assignment and workflow progression.`);
}finally{await db.close();}
