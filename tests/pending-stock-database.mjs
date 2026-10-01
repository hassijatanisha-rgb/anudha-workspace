// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),sales=id(2),other=id(3),inactive=id(4),org=id(10),otherOrg=id(11),contact=id(20),product=id(30),archived=id(31),pf=id(40),otherPf=id(41);
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create table public.organizations(id uuid primary key,deleted_at timestamptz);
create table public.contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz);
create table public.products(id uuid primary key,deleted_at timestamptz);
create table public.sales_proformas(id uuid primary key,organization_id uuid,deleted_at timestamptz);
create table public.sales_leads(id uuid primary key);
create table public.inventory_lots(id uuid primary key,product_id uuid,loose_units integer,reserved_units integer);
insert into auth.users values('${owner}'),('${sales}'),('${other}'),('${inactive}');
insert into public.staff values('${owner}','owner',true),('${sales}','staff',true),('${other}','staff',true),('${inactive}','staff',false);
insert into public.organizations values('${org}',null),('${otherOrg}',null);insert into public.contacts values('${contact}','${org}',null);
insert into public.products values('${product}',null),('${archived}',now());insert into public.sales_proformas values('${pf}','${org}',null),('${otherPf}','${otherOrg}',null);
insert into public.inventory_lots values(gen_random_uuid(),'${product}',10,2);`);
await db.exec(readFileSync(new URL('../supabase/migrations/202609300043_pending_stock_requests.sql',import.meta.url),'utf8'));
const as=actor=>db.exec(`select set_config('test.actor','${actor||''}',false)`);
const create=(requestId,fields={})=>{const f={org,contact:null,product,quantity:5,proforma:null,lead:null,salesperson:null,notes:'Customer needs 5 more',...fields};
 return db.query('select * from public.create_pending_stock_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',[requestId,f.org,f.contact,f.product,f.quantity,f.proforma,f.lead,f.salesperson,f.notes]).then(r=>r.rows[0]);};
const advance=(requestId,version,action,note='',months=null)=>db.query('select * from public.advance_pending_stock_request($1,$2,$3,$4,$5)',[requestId,version,action,note,months]).then(r=>r.rows[0]);
let checks=0;const ok=()=>checks++;
const lots=async()=>(await db.query('select loose_units,reserved_units from public.inventory_lots')).rows[0];
const before=await lots();

await as('');await assert.rejects(create(id(100)),/Active staff/);ok();
await as(inactive);await assert.rejects(create(id(100)),/Active staff/);ok();
await as(sales);
for(const [fields,pattern] of [[{quantity:0},/Quantity/],[{quantity:1000001},/Quantity/],[{product:archived},/active product/],[{contact:id(99)},/contact from the selected client/],[{proforma:otherPf},/same client/],[{salesperson:inactive},/active salesperson/],[{lead:id(98)},/Lead not found/]]){
 await assert.rejects(create(id(100),fields),pattern);ok();
}
const first=await create(id(100),{contact,proforma:pf});
// Apply the forward fix over an existing request, then prove row/event preservation.
const snapshot=async()=>(await db.query('select row_to_json(r) data from public.pending_stock_requests r order by id')).rows;
const existing=await snapshot();
const fix=readFileSync(new URL('../supabase/migrations/20261001095315_pending_retry_content.sql',import.meta.url),'utf8');
await db.exec(fix);await db.exec(fix);
assert.deepEqual(await snapshot(),existing,'forward fix preserves existing records and is safe to rerun');ok();
assert.equal(first.status,'waiting');assert.match(first.request_number,/^PS-\d{6}$/);assert.equal(first.salesperson_user_id,sales);ok();
const due=(await db.query(`select (current_date + interval '6 months')::date as d`)).rows[0].d;
assert.equal(new Date(first.expires_on).getTime(),new Date(due).getTime(),'closes six months after creation');ok();

// Identical retry returns the same row; different content with the same ID is refused.
assert.equal((await create(id(100),{contact,proforma:pf})).request_number,first.request_number);ok();
await assert.rejects(create(id(100),{contact,proforma:pf,quantity:6}),/already exists/);ok();
const retryConflicts=[];
for(const fields of [{notes:'Changed customer instructions'},{salesperson:other}]){
 try { await create(id(100),{contact,proforma:pf,...fields});retryConflicts.push(Object.keys(fields)[0]); }
 catch(error){assert.match(error.message,/already exists/);}
}
assert.deepEqual(retryConflicts,[],'same retry ID must reject changed notes and salesperson');ok();
assert.equal((await create(id(100),{contact,proforma:pf,salesperson:sales,notes:'  Customer needs 5 more  '})).id,first.id);ok();
await as(other);await assert.rejects(create(id(100),{contact,proforma:pf,salesperson:sales}),/already exists/);ok();
await as(sales);
const blankNotes=await create(id(102),{notes:null});
assert.equal((await create(id(102),{notes:'   ',salesperson:sales})).id,blankNotes.id);ok();
assert.equal((await db.query('select count(*)::integer n from public.pending_stock_events where request_id=$1',[first.id])).rows[0].n,1,'retries do not duplicate history');ok();
assert.deepEqual((await db.query('select salesperson_user_id,notes from public.pending_stock_requests where id=$1',[first.id])).rows[0],{salesperson_user_id:sales,notes:first.notes});ok();

// Only the salesperson or owner may close it, with a reference; stale versions are refused.
await as(other);await assert.rejects(advance(id(100),1,'fulfil','INV-1'),/salesperson or the owner/);ok();
await as(sales);await assert.rejects(advance(id(100),1,'fulfil',''),/reference/);ok();
await assert.rejects(advance(id(100),9,'cancel','Customer cancelled'),/changed/);ok();

// Extensions are owner-only, need a reason, are capped at four, and push the closure date.
await assert.rejects(advance(id(100),1,'extend','Waiting on supplier',3),/Only the owner/);ok();
await as(owner);await assert.rejects(advance(id(100),1,'extend','',3),/why/);ok();
await assert.rejects(advance(id(100),1,'extend','Waiting on supplier',7),/1 to 6 months/);ok();
let row=await advance(id(100),1,'extend','Waiting on supplier',3);assert.equal(row.extension_count,1);assert.ok(new Date(row.expires_on)>new Date(first.expires_on));ok();
for(let n=2;n<=4;n++)row=await advance(id(100),row.version,'extend','Still waiting',1);
await assert.rejects(advance(id(100),row.version,'extend','Again',1),/four times/);ok();

// Expiry is only allowed after the closure date.
await as(sales);await assert.rejects(advance(id(100),row.version,'expire'),/not due to close/);ok();
await db.exec(`update public.pending_stock_requests set expires_on=current_date - 1 where id='${id(100)}'`);
const expired=await advance(id(100),row.version,'expire');assert.equal(expired.status,'expired');assert.ok(expired.closed_at);ok();
await assert.rejects(advance(id(100),expired.version,'fulfil','INV-2'),/already closed/);ok();

// Fulfilment by the salesperson records the reference.
const second=await create(id(101),{quantity:3});
const fulfilled=await advance(id(101),second.version,'fulfil','INV-2026-0042');assert.equal(fulfilled.status,'fulfilled');assert.equal(fulfilled.close_note,'INV-2026-0042');ok();

// History is complete and immutable; requests cannot be deleted; stock was never touched.
const actions=(await db.query(`select action from public.pending_stock_events where request_id=$1 order by created_at`,[id(100)])).rows.map(r=>r.action);
assert.deepEqual(actions,['create','extend','extend','extend','extend','expire']);ok();
await assert.rejects(db.query('update public.pending_stock_events set note=$1',['x']),/immutable/);ok();
await assert.rejects(db.query('delete from public.pending_stock_requests'),/never hard-deleted/);ok();
assert.deepEqual(await lots(),before);ok();
const grants=(await db.query(`select has_table_privilege('authenticated','public.pending_stock_requests','insert') ins,has_function_privilege('anon','public.create_pending_stock_request(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text)','execute') anon_create,has_function_privilege('authenticated','public.create_pending_stock_request(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text)','execute') staff_create`)).rows[0];
assert.deepEqual(grants,{ins:false,anon_create:false,staff_create:true});ok();
await as(inactive);await assert.rejects(create(id(100),{contact,proforma:pf}),/Active staff/);ok();
await as('');await db.exec('set role anon');
await assert.rejects(create(id(103)),/permission denied/);ok();
await db.exec('reset role');await as(sales);await db.exec('set role authenticated');
assert.equal((await create(id(100),{contact,proforma:pf})).id,first.id);ok();
await assert.rejects(create(id(100),{contact,proforma:pf,notes:'Different'}),/already exists/);ok();
await db.exec('reset role');
console.log(`PASS: ${checks} pending stock checks — access, validation, six-month closure, identical-retry replay, salesperson/owner closing, owner-only capped extensions, expiry gate, immutable history, no deletes, stock untouched.`);
