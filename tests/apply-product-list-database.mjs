// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,mig=f=>readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8');
const owner=id(1),staff=id(2),p1=id(30),p2=id(31),archived=id(32),handFixed=id(33);
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create table public.products(id uuid primary key,name text not null,sku text not null default '',source jsonb not null default '{}',match_id uuid,match_status text not null default 'unreviewed',revision integer not null default 1,deleted_at timestamptz,deleted_by uuid);
create table public.inventory_lots(id uuid primary key,product_id uuid,loose_units integer);
insert into auth.users values('${owner}'),('${staff}');insert into public.staff values('${owner}','owner',true),('${staff}','staff',true);
insert into public.products(id,name,source) values('${p1}','BT - 770 12.1 Patient Monitor','{"category":"machines"}'),('${p2}','Blood bag 450','{}'),('${handFixed}','Glucose strips','{}');
insert into public.products(id,name,deleted_at) values('${archived}','Old item',now());insert into public.inventory_lots values(gen_random_uuid(),'${p1}',7);`);
for(const f of ['202609210002_product_inventory_classification.sql','202609230017_product_detail_review.sql','202609300047_stock_count.sql','202609300048_apply_product_list.sql'])await db.exec(mig(f));
const as=a=>db.exec(`select set_config('test.actor','${a||''}',false)`);
const apply=rows=>db.query('select public.apply_product_list($1::jsonb) r',[JSON.stringify(rows)]).then(r=>r.rows[0].r);
const one=async(sql,p=[])=>(await db.query(sql,p)).rows[0];
let checks=0;const ok=()=>checks++;
const rows=[
 {code:'AN-00001',product:'12.1 Patient Monitor with Printer',company:'Bistos (Korea)',specification:'BT-770',category:'Machine',erp_product_ids:[p1],company_note:'Found online: https://example.test'},
 {code:'AN-00002',product:'Blood Bag',company:'',specification:'450 ml',category:'Consumable',erp_product_ids:[p2],suggested_company:'Fixture Co'},
 {code:'AN-00003',product:'Hospital Bed',company:'',specification:'',category:'Furniture',erp_product_ids:[]},
 {code:'AN-00004',product:'Old item replacement',company:'X',specification:'Y',category:'Not sure',erp_product_ids:[archived]},
 {code:'AN-00005',product:'Glucose Test Strips',company:'List Co',specification:'50',category:'Consumable',erp_product_ids:[handFixed]}];
// A person corrected this product before the list arrived.
await as(owner);await db.query(`select public.save_product_detail_review($1,$2,0,'Glucose strips','Accu-Chek','50 strips','active',true,true,'Checked on the box')`,[id(90),handFixed]);
await db.query(`select public.save_product_inventory_classification($1,$2,0,'reagents','Checked on the box')`,[id(91),handFixed]);

await as(staff);await assert.rejects(apply(rows),/Only the owner/);ok();
await as(owner);
await assert.rejects(apply([]),/between 1 and 500/);ok();
await assert.rejects(apply([{code:'X',product:'a',category:'Machine'}]),/valid AN code/);ok();
await assert.rejects(apply([{code:'AN-00009',product:' ',category:'Machine'}]),/no product name/);ok();
await assert.rejects(apply([{code:'AN-00009',product:'a',category:'Toys'}]),/unknown category/);ok();
await assert.rejects(apply([{code:'AN-00009',product:'a',category:'Machine',erp_product_ids:['nope']}]),/invalid ERP id/);ok();
const first=await apply(rows);
assert.deepEqual(first,{rows:5,created:2,reviewed:4,classified:4,kept_manual:1});ok();
const r1=await one(`select name,company,specification,version from product_detail_reviews where product_id=$1 order by version desc limit 1`,[p1]);
assert.deepEqual(r1,{name:'12.1 Patient Monitor with Printer',company:'Bistos (Korea)',specification:'BT-770',version:1});ok();
const pr1=await one('select sku,source,revision from products where id=$1',[p1]);
assert.equal(pr1.sku,'AN-00001');assert.equal(pr1.source.an_code,'AN-00001');assert.equal(pr1.source.category,'machines','original source kept');assert.match(pr1.source.company_note,/Found online/);ok();
assert.equal((await one(`select source->>'suggested_company' s from products where id=$1`,[p2])).s,'Fixture Co');ok();
const bed=await one(`select p.id,p.sku,p.name,c.category from products p join product_inventory_classifications c on c.product_id=p.id where p.source->>'an_code'='AN-00003'`);
assert.equal(bed.sku,'AN-00003');assert.equal(bed.category,'furniture');ok();
assert.equal((await one(`select count(*)::int n from product_detail_reviews where product_id=$1`,[archived])).n,0,'archived product untouched');ok();
assert.equal((await one(`select count(*)::int n from products where source->>'an_code'='AN-00004' and deleted_at is null`)).n,1,'replacement created for archived product');ok();
const hand=await one(`select company,version from product_detail_reviews where product_id=$1 order by version desc limit 1`,[handFixed]);
assert.deepEqual(hand,{company:'Accu-Chek',version:1},'manual correction kept');ok();
assert.equal((await one(`select category from product_inventory_classifications where product_id=$1 order by version desc limit 1`,[handFixed])).category,'reagents');ok();
assert.equal((await one('select count(*)::int n from count_catalogue')).n,5,'count screen list filled too');ok();
// Running it again changes nothing and creates no duplicates.
const again=await apply(rows);assert.deepEqual(again,{rows:5,created:0,reviewed:0,classified:0,kept_manual:1});ok();
assert.equal((await one('select count(*)::int n from products')).n,6);ok();
// A newer list updates only what the list itself wrote.
const third=await apply([{...rows[1],company:'Fixture Co',suggested_company:''}]);assert.equal(third.reviewed,1);
assert.equal((await one(`select company from product_detail_reviews where product_id=$1 order by version desc limit 1`,[p2])).company,'Fixture Co');ok();
assert.equal((await one('select sum(loose_units)::int s from inventory_lots')).s,7,'stock untouched');ok();
await assert.rejects(db.query(`select public.save_product_inventory_classification($1,$2,0,'toys','x x x x x')`,[id(92),p2]),/supported inventory category/);ok();
assert.equal((await one(`select has_function_privilege('anon','public.apply_product_list(jsonb)','EXECUTE') a`)).a,false);ok();
console.log(`apply product list database: ${checks} checks passed`);
