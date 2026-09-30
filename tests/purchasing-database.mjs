// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),buyer=id(2),other=id(3),inactive=id(4),p1=id(30),p2=id(31),archived=id(32),pend=id(40);
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create table public.products(id uuid primary key,deleted_at timestamptz);
create table public.pending_stock_requests(id uuid primary key,product_id uuid);
create table public.inventory_lots(id uuid primary key,loose_units integer);
insert into auth.users values('${owner}'),('${buyer}'),('${other}'),('${inactive}');
insert into public.staff values('${owner}','owner',true),('${buyer}','staff',true),('${other}','staff',true),('${inactive}','staff',false);
insert into public.products values('${p1}',null),('${p2}',null),('${archived}',now());
insert into public.pending_stock_requests values('${pend}','${p1}');insert into public.inventory_lots values(gen_random_uuid(),10);`);
await db.exec(readFileSync(new URL('../supabase/migrations/202609300046_suppliers_purchasing.sql',import.meta.url),'utf8'));
const as=actor=>db.exec(`select set_config('test.actor','${actor||''}',false)`);
const supplier=(sid,version,fields)=>db.query('select * from public.save_supplier($1,$2,$3::jsonb)',[sid,version,JSON.stringify(fields)]).then(r=>r.rows[0]);
const request=(pid,version,supplierId,lines,extra={})=>db.query('select * from public.save_purchase_request($1,$2,$3,$4,$5,$6,$7::jsonb)',[pid,version,supplierId,extra.currency??'TZS',extra.expected??null,extra.notes??'',JSON.stringify(lines)]).then(r=>r.rows[0]);
const advance=(pid,version,action,note='',lpo='',expected=null)=>db.query('select * from public.advance_purchase_order($1,$2,$3,$4,$5,$6)',[pid,version,action,note,lpo,expected]).then(r=>r.rows[0]);
const lineCount=async pid=>(await db.query('select count(*)::int n from public.purchase_order_lines where purchase_order_id=$1',[pid])).rows[0].n;
let checks=0;const ok=()=>checks++;

// Suppliers
await as('');await assert.rejects(supplier(id(100),0,{name:'Anon Supplies'}),/Active staff/);ok();
await as(inactive);await assert.rejects(supplier(id(100),0,{name:'Inactive Supplies'}),/Active staff/);ok();
await as(buyer);
await assert.rejects(supplier(id(100),0,{name:'X'}),/check constraint|violates/);ok();
await assert.rejects(supplier(id(100),0,{name:'Bad Email Ltd',email:'not-an-email'}),/check constraint|violates/);ok();
const s1=await supplier(id(100),0,{name:'Fixture Medical Supplies',email:'Sales@Fixture.example',phone:'+255 22 000 0000',tin:'100-000-001'});
assert.match(s1.supplier_number,/^SUP-\d{6}$/);assert.equal(s1.email,'sales@fixture.example');ok();
assert.equal((await supplier(id(100),0,{name:'Fixture Medical Supplies'})).id,id(100),'identical retry returns the supplier');ok();
await assert.rejects(supplier(id(101),0,{name:'  fixture   MEDICAL supplies '}),/already exists/);ok();
await assert.rejects(supplier(id(100),1,{name:'Fixture Medical Supplies',active:false}),/Only the owner/);ok();
await assert.rejects(supplier(id(100),5,{name:'Stale'}),/changed/);ok();
const s2=await supplier(id(102),0,{name:'Second Supplier'});

// Purchase requests
await assert.rejects(request(id(200),0,null,[]),/between 1 and 200/);ok();
await assert.rejects(request(id(200),0,null,[{product_id:archived,quantity:1}]),/active product/);ok();
await assert.rejects(request(id(200),0,null,[{product_id:p1,quantity:0}]),/whole quantity/);ok();
await assert.rejects(request(id(200),0,null,[{product_id:p2,quantity:1,pending_request_id:pend}]),/different product/);ok();
await assert.rejects(request(id(200),0,null,[{product_id:p1,quantity:'lots'}]),/invalid product, quantity/);ok();
await assert.rejects(request(id(200),0,null,[{product_id:p1,quantity:1}],{currency:'GBP'}),/TZS, USD or EUR/);ok();
const po=await request(id(200),0,null,[{product_id:p1,quantity:50,pending_request_id:pend,note:'For PS-000001'},{product_id:p2,quantity:5,unit_price_minor:120000}]);
assert.equal(po.status,'requested');assert.match(po.po_number,/^PO-\d{6}$/);assert.equal(await lineCount(id(200)),2);ok();
assert.equal((await request(id(200),0,null,[{product_id:p1,quantity:50},{product_id:p2,quantity:5}])).po_number,po.po_number,'identical retry returns the request');ok();
// Editing replaces items atomically; a failing edit leaves the previous items intact.
await assert.rejects(request(id(200),1,s1.id,[{product_id:p1,quantity:60},{product_id:archived,quantity:1}]),/active product/);ok();
assert.equal(await lineCount(id(200)),2,'failed edit kept the original items');ok();
const edited=await request(id(200),1,s1.id,[{product_id:p1,quantity:60}],{expected:'2099-01-01'});assert.equal(edited.version,2);assert.equal(await lineCount(id(200)),1);ok();

// Approval, ordering and closing
await assert.rejects(advance(id(200),2,'approve'),/Only the owner can approve/);ok();
await assert.rejects(advance(id(200),2,'order','','LPO-1'),/Approve the purchase/);ok();
await as(owner);const approved=await advance(id(200),2,'approve');assert.equal(approved.status,'approved');assert.equal(approved.approved_by,owner);ok();
await as(buyer);
await assert.rejects(request(id(200),3,s1.id,[{product_id:p1,quantity:70}]),/not yet approved/);ok();
await assert.rejects(db.query(`delete from public.purchase_order_lines where purchase_order_id=$1`,[id(200)]),/only change while/);ok();
await assert.rejects(advance(id(200),3,'order','',''),/LPO number/);ok();
await assert.rejects(advance(id(200),3,'order','','LPO-1','2000-01-01'),/past/);ok();
await assert.rejects(advance(id(200),3,'cancel','Changed mind'),/Only the owner can cancel an approved/);ok();
const ordered=await advance(id(200),3,'order','','LPO-2026-017');assert.equal(ordered.status,'ordered');assert.equal(ordered.lpo_reference,'LPO-2026-017');assert.equal(ordered.ordered_by,buyer);ok();
await assert.rejects(advance(id(200),4,'close',''),/delivery note/);ok();
const closed=await advance(id(200),4,'close','Supplier DN 8812');assert.equal(closed.status,'closed');ok();
await assert.rejects(advance(id(200),5,'cancel','Too late'),/already finished/);ok();

// A request with no supplier cannot be ordered even after approval; requester or owner may cancel a request.
const po2=await request(id(201),0,null,[{product_id:p2,quantity:1}]);
await as(owner);const po2a=await advance(id(201),1,'approve');
await assert.rejects(advance(id(201),po2a.version,'order','','LPO-9'),/Choose the supplier/);ok();
const po3=await request(id(202),0,s2.id,[{product_id:p2,quantity:3}]);
await as(other);await assert.rejects(advance(id(202),1,'cancel','Not needed'),/requester or the owner/);ok();
await as(owner);await assert.rejects(advance(id(202),1,'cancel',''),/why/);ok();
const cancelled=await advance(id(202),1,'cancel','Duplicate request');assert.equal(cancelled.status,'cancelled');ok();

// History, immutability, deletion and privileges; stock untouched.
const actions=(await db.query(`select action from public.purchase_order_events where purchase_order_id=$1 order by created_at`,[id(200)])).rows.map(r=>r.action);
assert.deepEqual(actions,['request','edit','approve','order','close']);ok();
await assert.rejects(db.query(`update public.purchase_order_events set note='x'`),/immutable/);ok();
await assert.rejects(db.query(`delete from public.purchase_orders`),/never hard-deleted/);ok();
await assert.rejects(db.query(`delete from public.suppliers`),/never hard-deleted/);ok();
assert.equal((await db.query('select sum(loose_units)::int n from public.inventory_lots')).rows[0].n,10,'no stock change');ok();
const grants=(await db.query(`select has_table_privilege('authenticated','public.purchase_orders','insert') po_ins,has_table_privilege('authenticated','public.suppliers','update') sup_upd,
 has_function_privilege('anon','public.save_supplier(uuid,integer,jsonb)','execute') anon_sup,has_function_privilege('authenticated','public.advance_purchase_order(uuid,integer,text,text,text,date)','execute') auth_adv`)).rows[0];
assert.deepEqual(grants,{po_ins:false,sup_upd:false,anon_sup:false,auth_adv:true});ok();
console.log(`PASS: ${checks} purchasing checks — access, supplier validation and duplicate names, owner-only deactivation, item validation, atomic item replacement, owner approval, LPO ordering, close/cancel rules, immutable history, no deletes, no stock change.`);
