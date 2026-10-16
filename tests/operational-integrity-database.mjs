// Disposable PostgreSQL fixture only; all mutations are local, never live.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const mig=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const OWNER=id(1),STORES=id(2),PACKER=id(3),PACKER2=id(4),OUTSIDER=id(5),ORG=id(10),CONTACT=id(11),PRODUCT=id(12),SCARCE=id(13),PACK=id(14),SCARCE_PACK=id(15),HUB=id(16),LOT=id(17);
let next=100,checks=0;const check=async f=>{await f();checks++;};
const as=actor=>db.query("select set_config('test.actor',$1,false)",[actor??'']);
const admin=async(sql,params=[])=>{await db.exec('reset role');try{return await db.query(sql,params);}finally{await db.exec('set role authenticated');}};
const loadFunction=async(file,name)=>{
 const match=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));
 assert.ok(match,`${name} exists`);await db.exec(match[0]);
};
const delivery=async(product=PRODUCT,status='sent_to_sales',lot=null,qty=1)=>{
 const pf=id(next++),pl=id(next++),note=id(next++),line=id(next++);
 await admin(`insert into sales_proformas(id,document_number,organization_id,contact_id,valid_until,delivery_period,payment_terms,prepared_by)
  values($1,$2,$3,$4,current_date+30,'7 days','Cash',$5)`,[pf,'PF-'+next,ORG,CONTACT,OWNER]);
 await admin('insert into sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor) values($1,$2,$3,1,$4,$5,$6,100)',[pl,pf,product,'Fixture item',qty,'unit']);
 const delivered=status==='delivered';
 await admin(`insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,status,accounts_reference,expected_delivery_date,created_by,
  dispatched_by,dispatched_at,delivered_by,delivered_at,recipient_name,proof_reference,updated_at)
  values($1,$2,$3,$4,$5,$6,'ACC-1',current_date,$7,case when $8 then $7::uuid end,case when $8 then now() end,
  case when $8 then $7::uuid end,case when $8 then now() end,case when $8 then 'Fixture customer' end,case when $8 then 'Signed proof' end,now()-interval '1 day')`,
 [note,'DN-'+next,pf,ORG,CONTACT,status,OWNER,delivered]);
 if(lot)await admin('insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values($1,$2,$3,$4,$5,$6)',[line,note,pl,product,lot,qty]);
 return {pf,pl,note,line};
};
const returned=async(expiry,category='unopened')=>{
 const source=id(next++),returnId=id(next++);
 await admin('insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,loose_units) values($1,$2,$3,$4,$5,$6,0)',[source,PRODUCT,HUB,PACK,'RETURN-'+next,expiry]);
 const d=await delivery(PRODUCT,'delivered',source);
 await as(STORES);await db.query('select * from record_sales_return($1,$2,$3,$4,null,$5::jsonb)',[returnId,d.note,category,'Fixture return',JSON.stringify([{deliveryLineId:d.line,quantity:1}])]);
 return (await db.query('select * from sales_return_lines where return_id=$1',[returnId])).rows[0];
};
const resolve=(line,action,confirm=false)=>db.query('select * from resolve_sales_return_line($1,1,$2,$3,$4)',[line.id,action,'Inspected fixture item',confirm]);
const note=noteId=>db.query('select * from sales_delivery_notes where id=$1',[noteId]).then(r=>r.rows[0]);
const record=(d,version,serials)=>db.query('select * from record_delivery_serials($1,$2,$3::jsonb)',[d.note,version,JSON.stringify([{deliveryLineId:d.line,serials}])]);
const travel=async()=>{
 const request=id(next++);await as(OWNER);
 return (await db.query('select * from save_travel_request($1,0,$2,$3,$4,$5,$6,now()+interval \'1 day\',now()+interval \'2 days\',$7,$8)',
 [request,[OWNER],ORG,'','meeting','Fixture customer','Company car',''])).rows[0];
};
const advance=(request,version,action,note)=>db.query('select * from advance_travel_request($1,$2,$3,$4)',[request,version,action,note]).then(r=>r.rows[0]);
const take=()=>db.query('select (packing_take_next()).id id').then(r=>r.rows[0].id);
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[],display_name text);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,location text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 create table document_attachments(id uuid primary key,record_type text,record_id uuid,uploaded_at timestamptz);
 grant usage on schema auth to authenticated;
 insert into auth.users(id) values('${OWNER}'),('${STORES}'),('${PACKER}'),('${PACKER2}'),('${OUTSIDER}');
 insert into staff values('${OWNER}',true,'owner','management','{}','Fixture owner'),('${STORES}',true,'head','stores','{stock,deliveries}','Fixture head'),
 ('${PACKER}',true,'staff','stores','{deliveries}','Fixture packer'),('${PACKER2}',true,'staff','stores','{deliveries}','Fixture second packer'),('${OUTSIDER}',true,'staff','sales','{leads}','Fixture outsider');
 insert into products values('${PRODUCT}','Fixture machine',null),('${SCARCE}','Fixture unavailable item',null);
 insert into organizations values('${ORG}','Fixture clinic','Dar',null);insert into contacts values('${CONTACT}','${ORG}',null,'valid');`);
 await db.exec('create function public.mfa_satisfied() returns boolean language sql stable as $$select true$$');
 for(const name of ['has_access','require_access','is_department_head'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql',
  '202609210005_sales_office_workflow.sql','202609230015_accounting_membership.sql','202609230019_accounting_drafts.sql','202609300045_work_assignments.sql',
  '202610010056_team_tasks.sql','202610010057_travel_requests.sql','202610090078_packing_queue.sql','202610150081_delivery_proof_required.sql',
  '202610150082_customer_returns.sql','202610150084_serial_numbers.sql'])await db.exec(mig(file));
 for(const name of ['advance_travel_request','start_sales_delivery_packing'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 await loadFunction('202610010051_automatic_handoffs.sql','auto_assign_work');
 await db.exec(`insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${HUB}','Fixture Haadi','FH','dispatch_hub',true,'${OWNER}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values
 ('${PACK}','${PRODUCT}',1,'unit',1,'Fixture pack','${OWNER}'),('${SCARCE_PACK}','${SCARCE}',1,'unit',1,'Fixture pack','${OWNER}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units,reserved_units) values('${LOT}','${PRODUCT}','${HUB}','${PACK}','AVAILABLE',10,1);`);
 const functions=['resolve_sales_return_line(uuid,integer,text,text,boolean)','record_delivery_serials(uuid,integer,jsonb)','advance_travel_request(uuid,integer,text,text)','packing_take_next()'];
 const metadata=()=>db.query('select oid,proacl,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[functions]).then(r=>r.rows);
 const before=await metadata();await db.exec(mig('202610160095_operational_integrity.sql'));await db.exec(mig('202610160095_operational_integrity.sql'));
 await check(async()=>assert.deepEqual(await metadata(),before,'Rerun preserves RPC identity, privileges, security and search paths'));
 await db.exec('set role authenticated');

 // Actual lot expiry controls restocking even when the return was labelled unopened.
 const dates=(await db.query("select ((now() at time zone 'Africa/Dar_es_Salaam')::date)::text today,((now() at time zone 'Africa/Dar_es_Salaam')::date-1)::text yesterday")).rows[0];
 await db.exec("set timezone='Etc/GMT+12'");
 const expired=await returned(dates.yesterday);
 await check(()=>assert.rejects(resolve(expired,'restock'),/Expired goods cannot go back/));
 await check(async()=>{
  assert.equal((await db.query('select resolution from sales_return_lines where id=$1',[expired.id])).rows[0].resolution,null);
  assert.equal((await db.query('select loose_units from inventory_lots where id=$1',[expired.quarantine_lot_id])).rows[0].loose_units,1);
  assert.equal((await db.query("select count(*)::int n from inventory_movements where lot_id=$1 and movement_type='return_release'",[expired.quarantine_lot_id])).rows[0].n,0);
 });
 await check(async()=>assert.equal((await resolve(expired,'write_off')).rows[0].status,'resolved'));
 await db.exec("set timezone='Pacific/Kiritimati'");
 const validToday=await returned(dates.today);await check(async()=>assert.equal((await resolve(validToday,'restock')).rows[0].status,'resolved','Today is valid until the Tanzania day ends'));
 const undated=await returned(null);await check(async()=>assert.equal((await resolve(undated,'restock')).rows[0].status,'resolved'));
 const sterile=await returned(null,'sterile');await check(()=>assert.rejects(resolve(sterile,'restock'),/confirm the seal and temperature/));
 await check(async()=>assert.equal((await resolve(sterile,'restock',true)).rows[0].status,'resolved'));
 await db.exec("set timezone='UTC'");

 // Serial replacements consume the same locked delivery version used by other delivery edits.
 await as(STORES);await db.query('select set_product_serial_required($1,true)',[PRODUCT]);
 const d=await delivery(PRODUCT,'ready',LOT);await as(PACKER);const old=await note(d.note);
 await check(async()=>{await record(d,1,['SN-ONE']);const current=await note(d.note);assert.equal(current.version,2);assert.ok(current.updated_at>old.updated_at);});
 await check(()=>assert.rejects(record(d,1,['SN-STALE']),/Delivery changed; refresh/));
 await check(async()=>assert.deepEqual((await db.query('select serial_number from delivery_line_serials where delivery_note_id=$1',[d.note])).rows,[{serial_number:'SN-ONE'}]));
 await check(async()=>{await record(d,2,['SN-CORRECTED']);assert.equal((await note(d.note)).version,3);});
 await check(()=>assert.rejects(record(d,3,[]),/exactly 1 serial/));
 await check(async()=>assert.equal((await note(d.note)).version,3,'Failed replacements do not consume a version'));
 await db.query("select advance_sales_delivery($1,3,'dispatch','Fixture truck','Fixture route','','')",[d.note]);
 await check(()=>assert.rejects(record(d,4,['SN-LATE']),/before the delivery goes out/));

 // Validation matches storage: decision notes 1000, trip outcomes 2000.
 for(const action of ['approve','decline']){
  const t=await travel();
  await check(()=>assert.rejects(advance(t.id,1,action,'a'.repeat(1001)),error=>error.code==='P0001'&&/Note is too long/.test(error.message)));
  await check(async()=>assert.equal((await advance(t.id,1,action,'a'.repeat(1000))).decision_note.length,1000));
 }
 for(const action of ['done','cancel']){
  let t=await travel();if(action==='done')t=await advance(t.id,1,'approve','Approved');
  await check(()=>assert.rejects(advance(t.id,t.version,action,'a'.repeat(2001)),/Note is too long/));
  await check(async()=>assert.equal((await advance(t.id,t.version,action,'a'.repeat(2000))).outcome_note.length,2000));
 }

 // Fifty blocked orders cannot starve the next packable order across bounded calls.
 const blocked=[];for(let i=0;i<50;i++)blocked.push(await delivery(SCARCE));
 const packable=await delivery();await as(PACKER);
 await check(async()=>assert.equal(await take(),null));
 await check(async()=>assert.equal((await db.query("select count(*)::int n from sales_delivery_notes where packing_blocked_at is not null")).rows[0].n,50,'One call attempts at most fifty orders'));
 await check(async()=>assert.equal(await take(),packable.note,'The next call continues past the blocked first fifty'));
 await check(()=>assert.rejects(take(),/Press Packed/));
 await as(PACKER2);await check(async()=>assert.equal(await take(),null,'Another packer cannot claim the same order'));
 await admin('insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units) values($1,$2,$3,$4,$5,1)',[id(next++),SCARCE,HUB,SCARCE_PACK,'REPLENISHED']);
 await check(async()=>assert.equal(await take(),blocked[0].note,'Previously blocked orders are reconsidered after replenishment'));
 await check(async()=>{
  const claimed=(await db.query('select * from work_assignments where record_id in ($1,$2) order by assignee_user_id',[packable.note,blocked[0].note])).rows;
  assert.deepEqual(claimed.map(r=>r.assignee_user_id),[PACKER,PACKER2]);
  assert.equal((await db.query('select sum(reserved_units)::int n from inventory_lots where product_id=$1',[SCARCE])).rows[0].n,1);
 });
 await as(OUTSIDER);await check(()=>assert.rejects(take(),/do not have access/));
 await check(()=>assert.rejects(record(d,4,['UNAUTHORIZED']),/delivery or stock access/));
 await check(()=>assert.rejects(resolve(validToday,'restock'),/stores head or the owner/));
 await check(()=>assert.rejects(advance(id(999),1,'approve','Test'),/do not have access/));
 await check(async()=>{for(const fn of functions)assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[fn])).rows[0].allowed,false);});
 console.log(`PASS: ${checks} operational integrity checks; Tanzania expiry, atomic serial versioning, bounded packing continuation/replenishment and travel note boundaries. PGlite is single-session; overlapping PostgreSQL locks are not simulated.`);
}finally{await db.close();}
