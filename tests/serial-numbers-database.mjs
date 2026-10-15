// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 084: per-product serial numbers entered while packing, required for dispatch, one customer at a time,
// freed by cancellation or a recorded return. Real stock, sales, accounting and returns migrations (001-019, 081, 082).
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const DESK=id(1),STORES=id(2),ENGINEER=id(3),OUTSIDER=id(4),OWNER=id(5);
const ORG=id(10),CONTACT=id(11),MACHINE=id(12),REAGENT=id(13),PACK_M=id(14),PACK_R=id(15),HUB=id(16),LOT_M=id(17),LOT_R=id(18),PF=id(19),PFL_M=id(20),PFL_R=id(21);
const mig=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 create table document_attachments(id uuid primary key default gen_random_uuid(),record_type text,record_id uuid,uploaded_at timestamptz);
 insert into auth.users(id) values('${DESK}'),('${STORES}'),('${ENGINEER}'),('${OUTSIDER}'),('${OWNER}');
 insert into staff values('${DESK}',true,'staff','sales','{deliveries}'),('${STORES}',true,'head','stores','{stock}'),('${ENGINEER}',true,'staff','service','{service}'),
  ('${OUTSIDER}',true,'staff','marketing','{leads}'),('${OWNER}',true,'owner','management','{}');
 insert into products values('${MACHINE}','Fixture analyzer',null),('${REAGENT}','Fixture reagent',null);
 insert into organizations values('${ORG}','Fixture Hospital',null);insert into contacts values('${CONTACT}','${ORG}',null,'valid');`);
 for(const n of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql','202609210005_sales_office_workflow.sql','202609230015_accounting_membership.sql','202609230019_accounting_drafts.sql'])await db.exec(mig(n));
 await db.exec(`create or replace function public.mfa_satisfied() returns boolean language sql stable as $$select true$$;
 create or replace function public.inventory_active_staff() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true)$$;
 create or replace function public.inventory_owner() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true and role='owner')$$;
 create or replace function public.is_department_head() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=(select auth.uid()) and active and role='head')$$;
 create or replace function public.has_access(p_area text) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff s where s.user_id=(select auth.uid()) and s.active and (s.role='owner' or p_area=any(s.access)))$$;
 create or replace function public.require_access(p_area text) returns void language plpgsql stable security definer set search_path to 'public','pg_temp' as $$begin if not public.has_access(p_area) then raise exception 'You do not have access to %.',p_area; end if; end $$;
 create or replace function public.packing_supervisor() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select public.inventory_active_staff() and exists(select 1 from public.staff where user_id=auth.uid() and active and (role='owner' or (role='head' and department='stores')))$$;
 create or replace function public.accounting_access() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select false$$;
 insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${HUB}','Fixture Haadi','FH','dispatch_hub',true,'${OWNER}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('${PACK_M}','${MACHINE}',1,'unit',1,'Fixture pack','${OWNER}'),('${PACK_R}','${REAGENT}',1,'kit',10,'Fixture pack','${OWNER}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units,reserved_units) values('${LOT_M}','${MACHINE}','${HUB}','${PACK_M}','M-1',10,10),('${LOT_R}','${REAGENT}','${HUB}','${PACK_R}','R-1',50,50);
 insert into sales_proformas(id,document_number,organization_id,contact_id,currency,valid_until,delivery_period,payment_terms,prepared_by) values('${PF}','PF-S-1','${ORG}','${CONTACT}','TZS',current_date+30,'7 days','On delivery','${DESK}');
 insert into sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor) values('${PFL_M}','${PF}','${MACHINE}',1,'Analyzer',10,'unit',100),('${PFL_R}','${PF}','${REAGENT}',2,'Reagent',50,'kit',10);`);
 await db.exec(mig('202610150081_delivery_proof_required.sql'));await db.exec(mig('202610150082_customer_returns.sql'));
 await db.exec(mig('202610150084_serial_numbers.sql'));await db.exec(mig('202610150084_serial_numbers.sql')); // re-runnable
 let n=100;
 const delivery=async(status,machines,reagents=0)=>{const note=id(n++),lm=id(n++),lr=id(n++);
  const delivered=status==='delivered',out=['out_for_delivery','delivered'].includes(status);
  await db.query(`insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,status,accounts_reference,expected_delivery_date,created_by,dispatched_by,dispatched_at,delivered_by,delivered_at,recipient_name,proof_reference)
   values($1,$2,'${PF}','${ORG}','${CONTACT}',$3,'ACC-1',current_date,'${DESK}',${out?`'${DESK}'`:'null'},${out?'now()':'null'},${delivered?`'${DESK}'`:'null'},${delivered?'now()':'null'},${delivered?"'Mr R'":'null'},${delivered?"'Signed'":'null'})`,[note,'DN-'+n,status]);
  if(machines)await db.query('insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values($1,$2,$3,$4,$5,$6)',[lm,note,PFL_M,MACHINE,LOT_M,machines]);
  if(reagents)await db.query('insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values($1,$2,$3,$4,$5,$6)',[lr,note,PFL_R,REAGENT,LOT_R,reagents]);
  return {note,lm,lr};};
 const as=actor=>db.exec(`set test.actor='${actor}'`);
 const ver=async note=>(await db.query('select version from sales_delivery_notes where id=$1',[note])).rows[0].version;
 const record=async(note,lines)=>db.query('select * from record_delivery_serials($1,$2,$3)',[note,await ver(note),JSON.stringify(lines)]);
 const dispatch=async note=>db.query("select advance_sales_delivery($1,$2,'dispatch','Truck T 1','Route A','','')",[note,await ver(note)]);
 const status=async note=>(await db.query('select status from sales_delivery_notes where id=$1',[note])).rows[0].status;

 // Only the stores head or owner chooses which products need serials; unflagged products are unaffected.
 await as(DESK);await ok(()=>assert.rejects(db.query('select * from set_product_serial_required($1,true)',[MACHINE]),/stores head or the owner/));
 const R0=await delivery('ready',0,3);await ok(async()=>{await dispatch(R0.note);assert.equal(await status(R0.note),'out_for_delivery');});
 await as(STORES);await db.query('select * from set_product_serial_required($1,true)',[MACHINE]);
 await ok(async()=>assert.equal((await db.query('select serial_required from product_serial_settings where product_id=$1',[MACHINE])).rows[0].serial_required,true));

 // Dispatch waits for one serial per flagged unit.
 const D1=await delivery('ready',2,3);await as(DESK);
 await ok(()=>assert.rejects(dispatch(D1.note),/serial number of every unit/));
 await ok(()=>assert.rejects(record(D1.note,[{deliveryLineId:D1.lm,serials:['SN-1']}]),/exactly 2 serial number\(s\) for this item; 1 entered/));
 await ok(()=>assert.rejects(record(D1.note,[{deliveryLineId:D1.lm,serials:['SN-1','sn-1']}]),/entered twice/));
 await ok(()=>assert.rejects(record(D1.note,[{deliveryLineId:D1.lr,serials:['X','Y','Z']}]),/does not need serial numbers/));
 await as(OUTSIDER);await ok(()=>assert.rejects(record(D1.note,[{deliveryLineId:D1.lm,serials:['SN-1','SN-2']}]),/delivery or stock access/));
 await as(DESK);await record(D1.note,[{deliveryLineId:D1.lm,serials:['SN-1','SN-9']}]);
 await record(D1.note,[{deliveryLineId:D1.lm,serials:[' SN-1 ','SN-2']}]); // corrected before dispatch, trimmed
 await ok(async()=>assert.deepEqual((await db.query('select serial_number from delivery_line_serials where delivery_line_id=$1 order by 1',[D1.lm])).rows.map(r=>r.serial_number),['SN-1','SN-2']));
 await dispatch(D1.note);await ok(async()=>assert.equal(await status(D1.note),'out_for_delivery'));
 // After dispatch the serials are permanent.
 await ok(()=>assert.rejects(record(D1.note,[{deliveryLineId:D1.lm,serials:['SN-3','SN-4']}]),/while packing, before the delivery goes out/));
 await ok(()=>assert.rejects(db.query('delete from delivery_line_serials where delivery_note_id=$1',[D1.note]),/permanent/));
 await ok(()=>assert.rejects(db.query("update delivery_line_serials set serial_number='SN-X' where delivery_note_id=$1",[D1.note]),/permanent/));

 // One customer at a time: a serial already out cannot go on another delivery.
 const D2=await delivery('ready',1);
 await ok(()=>assert.rejects(record(D2.note,[{deliveryLineId:D2.lm,serials:['sn-2']}]),/Serial SN-2 is already on another delivery/));
 // A cancelled delivery frees its serials.
 const D3=await delivery('ready',1);await record(D3.note,[{deliveryLineId:D3.lm,serials:['SN-7']}]);
 await ok(()=>assert.rejects(record(D2.note,[{deliveryLineId:D2.lm,serials:['SN-7']}]),/already on another delivery/));
 await db.query("select advance_sales_delivery($1,$2,'cancel','','','','Customer cancelled')",[D3.note,await ver(D3.note)]);
 await ok(async()=>{await record(D2.note,[{deliveryLineId:D2.lm,serials:['SN-7']}]);assert.equal((await db.query("select count(*)::int n from delivery_line_serials where serial_number='SN-7'")).rows[0].n,1);});

 // A recorded return frees the unit to go out again.
 await db.query("update sales_delivery_notes set status='delivered',delivered_by=$2,delivered_at=now(),recipient_name='Mr R',proof_reference='Signed' where id=$1",[D1.note,DESK]);
 const RET=id(900);await db.query('select * from record_sales_return($1,$2,$3,$4,$5,$6)',[RET,D1.note,'wrong_item','',null,JSON.stringify([{deliveryLineId:D1.lm,quantity:1}])]);
 const retLine=(await db.query('select id from sales_return_lines where return_id=$1',[RET])).rows[0].id;
 await ok(()=>assert.rejects(db.query('select * from mark_serials_returned($1,$2)',[retLine,['SN-1','SN-2']]),/has 1 unit\(s\); 0 already marked/));
 await ok(()=>assert.rejects(db.query('select * from mark_serials_returned($1,$2)',[retLine,['SN-99']]),/not one that went out/));
 await db.query('select * from mark_serials_returned($1,$2)',[retLine,['sn-1']]);
 await ok(async()=>assert.ok((await db.query("select returned_at from delivery_line_serials where serial_number='SN-1' and delivery_note_id=$1",[D1.note])).rows[0].returned_at));
 await ok(()=>assert.rejects(db.query("update delivery_line_serials set returned_at=null,returned_by=null,return_line_id=null where serial_number='SN-1'"),/permanent/));
 const D4=await delivery('ready',1);await ok(async()=>{await record(D4.note,[{deliveryLineId:D4.lm,serials:['SN-1']}]);});

 // Lookup: stock, delivery and service staff see who has a serial; others see nothing.
 await as(ENGINEER);await ok(async()=>{const rows=(await db.query("select * from find_serial('sn-2')")).rows;assert.equal(rows.length,1);assert.equal(rows[0].organization_name,'Fixture Hospital');assert.equal(rows[0].delivery_status,'delivered');assert.equal(rows[0].returned_at,null);});
 await ok(async()=>assert.equal((await db.query("select * from find_serial('SN-1')")).rows.length,2,'history: returned unit and its new delivery'));
 await as(OUTSIDER);await ok(async()=>assert.equal((await db.query("select * from find_serial('SN-2')")).rows.length,0));
 await ok(async()=>{const r=(await db.query("select has_table_privilege('anon','public.delivery_line_serials','select') a, has_function_privilege('anon','public.find_serial(text)','execute') b, (select bool_and(relrowsecurity) from pg_class where relname in ('delivery_line_serials','product_serial_settings')) c")).rows[0];assert.deepEqual([r.a,r.b,r.c],[false,false,true]);});
 console.log(`PASS: ${checks} serial checks; stores-head/owner product flag, unflagged products unaffected, dispatch needs one serial per flagged unit, count/duplicate/access checks, corrections only before dispatch then permanent, one customer at a time, cancellation and recorded returns free units, lookup limited to stock/delivery/service, no anonymous access.`);
}finally{await db.close();}
