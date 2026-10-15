// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 082: customer returns into quarantine, inspection, and Credit Note drafts. Real migrations 001/002/004/005/
// 015/019 build the stock, sales and accounting tables; access helpers are the live definitions (058/060/078).
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const DESK=id(1),STORES=id(2),SALES_HEAD=id(3),OWNER=id(4),ACCT=id(5),OUTSIDER=id(6);
const ORG=id(10),CONTACT=id(11),PRODUCT=id(12),PACK=id(13),HUB=id(14),LOT=id(15),PF=id(16),PFL=id(17);
const mig=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 insert into auth.users(id) values('${DESK}'),('${STORES}'),('${SALES_HEAD}'),('${OWNER}'),('${ACCT}'),('${OUTSIDER}');
 insert into staff values('${DESK}',true,'staff','sales','{deliveries}'),('${STORES}',true,'head','stores','{stock}'),('${SALES_HEAD}',true,'head','sales','{deliveries}'),
  ('${OWNER}',true,'owner','management','{}'),('${ACCT}',true,'staff','accounts','{}'),('${OUTSIDER}',true,'staff','marketing','{leads}');
 insert into products values('${PRODUCT}','Fixture reagent',null);insert into organizations values('${ORG}','Fixture Hospital',null);insert into contacts values('${CONTACT}','${ORG}',null,'valid');`);
 for(const n of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql','202609210005_sales_office_workflow.sql','202609230015_accounting_membership.sql','202609230019_accounting_drafts.sql'])await db.exec(mig(n));
 await db.exec(`create or replace function public.mfa_satisfied() returns boolean language sql stable as $$select true$$;
 create or replace function public.inventory_active_staff() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true) and public.mfa_satisfied()$$;
 create or replace function public.inventory_owner() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true and role='owner') and public.mfa_satisfied()$$;
 create or replace function public.is_department_head() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=(select auth.uid()) and active and role='head') and public.mfa_satisfied()$$;
 create or replace function public.has_access(p_area text) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff s where s.user_id=(select auth.uid()) and s.active and (s.role='owner' or p_area=any(s.access))) and public.mfa_satisfied()$$;
 create or replace function public.packing_supervisor() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select public.inventory_active_staff() and exists(select 1 from public.staff where user_id=auth.uid() and active and (role='owner' or (role='head' and department='stores')))$$;
 create or replace function public.accounting_access() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select auth.uid() is not null and public.inventory_active_staff() and exists(select 1 from public.accounting_memberships m where m.user_id=auth.uid() and m.active)$$;
 insert into accounting_memberships(user_id,active,approved_by,approval_reference) values('${ACCT}',true,'${OWNER}','Fixture approval');
 insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${HUB}','Fixture Haadi','FH','dispatch_hub',true,'${OWNER}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('${PACK}','${PRODUCT}',1,'piece',10,'Fixture pack','${OWNER}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,loose_units) values('${LOT}','${PRODUCT}','${HUB}','${PACK}','B-1','2030-01-31',20);
 insert into sales_proformas(id,document_number,organization_id,contact_id,currency,valid_until,delivery_period,payment_terms,prepared_by) values('${PF}','PF-T-1','${ORG}','${CONTACT}','TZS',current_date+30,'7 days','On delivery','${DESK}');
 insert into sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points) values('${PFL}','${PF}','${PRODUCT}',1,'Fixture reagent kit',30,'piece',10000,1000,1800);`);
 await db.exec(mig('202610150082_customer_returns.sql'));await db.exec(mig('202610150082_customer_returns.sql')); // re-runnable
 let n=100;
 const delivery=async(daysAgo,qty=5,status='delivered')=>{const note=id(n++),line=id(n++);
  await db.query(`insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,status,accounts_reference,expected_delivery_date,created_by,dispatched_by,dispatched_at,delivered_by,delivered_at,recipient_name,proof_reference,tax_invoice_reference)
   values($1,$2,$3,$4,$5,$6,'ACC-1',current_date,$7,$7,now()-make_interval(days=>$8+1),case when $6='delivered' then $7::uuid end,case when $6='delivered' then now()-make_interval(days=>$8) end,case when $6='delivered' then 'Mr Recipient' end,case when $6='delivered' then 'Signed DN' end,'TI-777')`,
   [note,'DN-'+n,PF,ORG,CONTACT,status,DESK,daysAgo]);
  await db.query('insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values($1,$2,$3,$4,$5,$6)',[line,note,PFL,PRODUCT,LOT,qty]);return {note,line};};
 const as=actor=>db.exec(`set test.actor='${actor}'`);
 const record=(returnId,note,lines,category='unopened',override=null)=>db.query('select * from record_sales_return($1,$2,$3,$4,$5,$6)',[returnId,note,category,'Fixture note',override,JSON.stringify(lines)]);
 const ret=async rid=>(await db.query('select * from sales_returns where id=$1',[rid])).rows[0];
 const lineOf=async rid=>(await db.query('select * from sales_return_lines where return_id=$1 order by id',[rid])).rows;
 const resolve=async(lineId,rid,res,note='Seal intact, counted',confirm=false)=>db.query('select * from resolve_sales_return_line($1,$2,$3,$4,$5)',[lineId,(await ret(rid)).version,res,note,confirm]);
 const lot=async(status)=>(await db.query("select * from inventory_lots where product_id=$1 and stock_status=$2",[PRODUCT,status])).rows[0];

 // Recording: access, delivered only, window, quantities, quarantine.
 const fresh=await delivery(2);const transit=await delivery(0,5,'out_for_delivery');
 await as(OUTSIDER);await ok(()=>assert.rejects(record(id(900),fresh.note,[{deliveryLineId:fresh.line,quantity:1}]),/delivery or stock access/));
 await as(DESK);await ok(()=>assert.rejects(record(id(901),transit.note,[{deliveryLineId:transit.line,quantity:1}]),/Only a delivered order/));
 await ok(()=>assert.rejects(record(id(902),fresh.note,[{deliveryLineId:fresh.line,quantity:1}],'unopened','Not needed but given'),/no override is needed/));
 const R1=id(910);await record(R1,fresh.note,[{deliveryLineId:fresh.line,quantity:2}]);
 await ok(async()=>assert.match((await ret(R1)).return_number,/^RT-\d{4}-\d{6}$/));
 await ok(async()=>{assert.equal((await lot('quarantine')).loose_units,2);assert.equal((await lot('available')).loose_units,20,'available stock untouched');});
 await ok(async()=>assert.equal((await record(R1,fresh.note,[{deliveryLineId:fresh.line,quantity:2}])).rows[0].id,R1,'replay returns the saved return'));
 await ok(async()=>assert.equal((await lot('quarantine')).loose_units,2,'replay adds nothing'));
 await ok(()=>assert.rejects(record(id(903),fresh.note,[{deliveryLineId:fresh.line,quantity:4}]),/more than was delivered \(5 delivered, 2 already returned\)/));
 await ok(()=>assert.rejects(record(id(904),fresh.note,[{deliveryLineId:transit.line,quantity:1}]),/not on this delivery/));
 // Late returns need a head or owner and a reason.
 const old=await delivery(10);
 await ok(()=>assert.rejects(record(id(905),old.note,[{deliveryLineId:old.line,quantity:1}]),/older than 7 days/));
 await ok(()=>assert.rejects(record(id(906),old.note,[{deliveryLineId:old.line,quantity:1}],'damaged','Customer called on day 6'),/need a department head or the owner/));
 await as(SALES_HEAD);const R2=id(911);await record(R2,old.note,[{deliveryLineId:old.line,quantity:3}],'cold_chain','Customer called on day 6, cooler box kept');
 await ok(async()=>assert.equal((await ret(R2)).late_override_reason,'Customer called on day 6, cooler box kept'));

 // Inspection: stores head or owner only; sterile/cold-chain restock needs confirmation; expired never restocks.
 const [l1]=await lineOf(R1),[l2]=await lineOf(R2);
 await as(DESK);await ok(()=>assert.rejects(resolve(l1.id,R1,'restock'),/stores head or the owner/));
 await as(SALES_HEAD);await ok(()=>assert.rejects(resolve(l1.id,R1,'restock'),/stores head or the owner/));
 await as(STORES);await ok(()=>assert.rejects(db.query('select * from resolve_sales_return_line($1,$2,$3,$4,$5)',[l1.id,99,'restock','Checked',false]),/changed; refresh/));
 await resolve(l1.id,R1,'restock');
 await ok(async()=>{assert.equal((await lot('available')).loose_units,22);assert.equal((await lot('quarantine')).loose_units,3,'only R2 stays in quarantine');assert.equal((await ret(R1)).status,'resolved');});
 await ok(()=>assert.rejects(resolve(l1.id,R1,'write_off'),/decided once|already decided/));
 await ok(()=>assert.rejects(resolve(l2.id,R2,'restock','Looks fine',false),/confirm the seal and temperature/));
 await resolve(l2.id,R2,'restock','Cooler log 4°C, seal intact',true);
 await ok(async()=>{assert.equal((await lot('available')).loose_units,25);assert.equal((await lot('quarantine')).loose_units,0);});
 const exp=await delivery(1);await as(DESK);const R3=id(912);await record(R3,exp.note,[{deliveryLineId:exp.line,quantity:2}],'expired');
 const [l3]=await lineOf(R3);await as(OWNER);await ok(()=>assert.rejects(resolve(l3.id,R3,'restock'),/Expired goods cannot go back/));
 await resolve(l3.id,R3,'write_off','Past expiry, destroyed');
 await ok(async()=>{assert.equal((await lot('available')).loose_units,25,'write-off does not restock');assert.equal((await lot('quarantine')).loose_units,0);});
 // Stock conservation: every lot equals the sum of its movements beyond its opening quantity.
 await ok(async()=>{const q=await lot('quarantine'),m=(await db.query('select coalesce(sum(loose_unit_change),0)::int s from inventory_movements where lot_id=$1',[q.id])).rows[0].s;assert.equal(m,q.loose_units);});
 await ok(async()=>{const m=(await db.query("select movement_type,sum(loose_unit_change)::int s from inventory_movements group by 1 order by 1")).rows.map(r=>`${r.movement_type}:${r.s}`);assert.deepEqual(m,['consumer_return:7','return_release:0','return_write_off:-2']);});

 // Credit note: accounts only, priced from the original line, linked to the tax invoice, once per return.
 await as(DESK);await ok(async()=>assert.rejects(db.query('select * from create_return_credit_note($1,$2,$3)',[R1,(await ret(R1)).version,id(950)]),/Only accounts staff/));
 await as(ACCT);const draft=(await db.query('select * from create_return_credit_note($1,$2,$3)',[R1,(await ret(R1)).version,id(950)])).rows[0];
 await ok(()=>{assert.equal(draft.kind,'credit_note');assert.equal(draft.body.reference,'TI-777');assert.equal(draft.body.party,'Fixture Hospital');assert.equal(draft.body.source.returnId,R1);});
 // 2 × 100.00 = 200.00, less 10% = 180.00, plus 18% VAT = 212.40
 await ok(()=>{assert.equal(draft.body.totalMinor,21240);assert.equal(draft.body.lines[0].amount,'212.40');assert.equal(draft.body.lines[0].netMinor,18000);assert.equal(draft.body.lines[0].taxMinor,3240);});
 await ok(async()=>assert.equal((await db.query('select count(*)::int n from accounting_draft_history where draft_id=$1',[id(950)])).rows[0].n,1));
 await ok(async()=>assert.equal((await ret(R1)).credit_note_draft_id,id(950)));
 await ok(async()=>assert.equal((await db.query('select * from create_return_credit_note($1,$2,$3)',[R1,(await ret(R1)).version,id(950)])).rows[0].id,id(950),'replay returns the same draft'));
 await ok(async()=>assert.rejects(db.query('select * from create_return_credit_note($1,$2,$3)',[R1,(await ret(R1)).version,id(951)]),/already exists/));

 // History is permanent; no anonymous access.
 await ok(()=>assert.rejects(db.query("update sales_returns set category='other' where id=$1",[R1]),/permanent history/));
 await ok(()=>assert.rejects(db.query('delete from sales_return_lines'),/permanent history/));
 await ok(()=>assert.rejects(db.query("update sales_returns set credit_note_draft_id=$2 where id=$1",[R1,id(952)]),/permanent history/));
 await ok(async()=>{const r=(await db.query("select has_table_privilege('anon','public.sales_returns','select') a, has_function_privilege('anon','public.record_sales_return(uuid,uuid,text,text,text,jsonb)','execute') b, (select bool_and(relrowsecurity) from pg_class where relname in ('sales_returns','sales_return_lines','sales_return_policy')) c")).rows[0];assert.deepEqual([r.a,r.b,r.c],[false,false,true]);});
 console.log(`PASS: ${checks} return checks; delivered-only, 7-day window with head/owner override, no over-return, quarantine first, stores-head inspection, sterile/cold-chain confirmation, expired never restocked, stock conserved, priced Credit Note draft for accounts once per return, permanent history, no anonymous access.`);
}finally{await db.close();}
