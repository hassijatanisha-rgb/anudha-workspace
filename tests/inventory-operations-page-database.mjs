import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let checks=0;const pass=label=>{checks++;console.log('PASS '+label)};
try{
 await db.exec(`create role anon;create role authenticated;
 create function inventory_active_staff() returns boolean language sql stable as $$select current_setting('test.active',true)='yes' and current_setting('test.mfa',true)='yes'$$;
 create function has_access(text) returns boolean language sql stable as $$select inventory_active_staff() and $1='stock' and current_setting('test.stock',true)='yes'$$;
 create table products(id uuid primary key,name text,sku text,source jsonb,deleted_at timestamptz);
 create table product_detail_reviews(id uuid primary key,product_id uuid,version integer,name text,company text,specification text,unique(product_id,version));
 create table inventory_locations(id uuid primary key,name text,code text,active boolean,is_dispatch_hub boolean);
 create table product_pack_definitions(id uuid primary key,product_id uuid,version integer,base_unit text,units_per_carton integer,reason text);
 create table inventory_transfers(id uuid primary key,product_id uuid,source_lot_id uuid,from_location_id uuid,to_location_id uuid,pack_definition_id uuid,cartons integer,expected_units integer,actual_units integer,expected_at date,status text,created_at timestamptz,reason text,inspection_note text,version integer);
 create table inventory_lots(id uuid primary key,sealed_cartons integer,loose_units integer,reserved_units integer);
 do $$declare t text;begin foreach t in array array['products','product_detail_reviews','inventory_locations','product_pack_definitions','inventory_transfers'] loop
 execute format('alter table %I enable row level security',t);execute format('create policy read_rows on %I for select to authenticated using (inventory_active_staff())',t);execute format('grant select on %I to authenticated',t);end loop;end $$;
 alter policy read_rows on inventory_locations using(has_access('stock'));alter policy read_rows on inventory_transfers using(has_access('stock'));
 set test.active='yes';set test.mfa='yes';set test.stock='yes';`);
 await db.exec(readFileSync(new URL('../supabase/migrations/202610290144_inventory_operations_page.sql',import.meta.url),'utf8'));
 await db.exec(`insert into products select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Raw product '||n,'SKU-'||n,'{"company":"Raw maker","model":"Raw model","private":"Source details"}'::jsonb,null from generate_series(1,77) n;
 insert into product_pack_definitions select id,id,1,'bottle',10,'Private carton reason' from products;
 insert into inventory_locations select ('00000000-0000-4000-8000-'||lpad((90000+n)::text,12,'0'))::uuid,'Godown '||lpad(n::text,3,'0'),'G'||n,n%9<>0,n=1 from generate_series(1,117) n;
 insert into inventory_transfers select ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,
 ('00000000-0000-4000-8000-'||lpad((1+n%77)::text,12,'0'))::uuid,'${id(99999)}','${id(90001)}',
 ('00000000-0000-4000-8000-'||lpad((90002+n%116)::text,12,'0'))::uuid,
 ('00000000-0000-4000-8000-'||lpad((1+n%77)::text,12,'0'))::uuid,1+n%50,(1+n%50)*10,null,'2026-11-01'::date+n%15,
 (array['requested','in_transit','received','quarantine','cancelled'])[1+n%5],
 '2026-10-29 08:00Z'::timestamptz-(n%11)*interval '1 second','Private transfer reason','Private inspection note',7 from generate_series(1,1067) n;
 insert into inventory_lots values('${id(99999)}',982,599,5);`);
 await db.query('insert into product_detail_reviews values($1,$2,1,$3,$4,$5),($6,$2,2,$7,$8,$9)',[id(95001),id(77),'Old review','Old company','Old spec',id(95002),'Reviewed product % _','Reviewed company','Updated 200ml']);
 await db.query('update products set deleted_at=now() where id=$1',[id(76)]);
 const legacyRows=(await db.query('select *,expected_at::text as expected_at from inventory_transfers')).rows;
 const expectedOrder=[...legacyRows].sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).map(r=>r.id);
 const expectedTotals={all:1067};for(const status of ['requested','in_transit','received','quarantine','cancelled'])expectedTotals[status]=legacyRows.filter(r=>r.status===status).length;
 const quantitiesBefore=JSON.stringify((await db.query('select * from inventory_lots')).rows),transfersBefore=JSON.stringify(legacyRows);
 await db.exec('set role authenticated');
 const page=async({section='transfers',query='',status='',page=0}={})=>(await db.query('select inventory_operations_page($1,$2,$3,$4) as result',[section,query,status,page])).rows[0].result;
 const first=await page();assert.equal(first.rows.length,25);assert.equal(first.total,1067);assert.equal(first.pages,43);assert.deepEqual(first.totals,expectedTotals);assert.ok(first.rows.every(r=>!Object.hasOwn(r,'reason')&&!Object.hasOwn(r,'inspection_note')&&!Object.hasOwn(r,'version')&&!Object.hasOwn(r,'source_lot_id')));pass('bounded 25-row payload and exact whole-scope status totals');
 const seen=[];for(let p=0;p<first.pages;p++)seen.push(...(await page({page:p})).rows.map(r=>r.id));assert.deepEqual(seen,expectedOrder);assert.equal(new Set(seen).size,1067);const last=await page({page:999999});assert.equal(last.page,42);assert.equal(last.rows.length,17);pass('complete 1,067-transfer traversal exactly matches prior descending timestamp / ID order');
 for(const query of ['Reviewed product % _','Reviewed company','Updated 200ml','SKU-77','% _']){
  const result=await page({query});assert.equal(result.total,legacyRows.filter(r=>r.product_id===id(77)).length);assert.ok(result.rows.every(r=>r.product_name==='Reviewed product % _'&&r.company==='Reviewed company'&&r.specification==='Updated 200ml'));assert.deepEqual(result.totals,expectedTotals);
 }
 assert.equal((await page({query:'Old review'})).total,0);assert.equal((await page({query:"' OR true --"})).total,0);assert.equal((await page({query:'Private transfer reason'})).total,0);assert.equal((await page({query:'Source details'})).total,0);assert.ok((await page({query:'SKU-76'})).total>0);pass('latest reviewed identity, deleted product history, literal search and minimal payload');
 for(const status of Object.keys(expectedTotals).filter(k=>k!=='all')){const result=await page({status});assert.equal(result.total,expectedTotals[status]);assert.ok(result.rows.every(r=>r.status===status));assert.deepEqual(result.totals,expectedTotals);}
 const route=await page({query:'G117'});assert.equal(route.total,legacyRows.filter(r=>r.to_location_id===id(90117)).length);const day=await page({query:'2026-11-14'});assert.equal(day.total,legacyRows.filter(r=>r.expected_at==='2026-11-14').length);const empty=await page({query:'missing',page:777});assert.deepEqual([empty.total,empty.page,empty.pages,empty.rows.length],[0,0,1,0]);assert.deepEqual(empty.totals,expectedTotals);pass('exact filters, route/date search and empty/high-page clamping');
 const locations=await page({section:'locations'});assert.equal(locations.rows.length,50);assert.equal(locations.total,117);assert.deepEqual(locations.totals,{all:117,active:104,dispatch_hub:1});const locationIds=[];for(let p=0;p<locations.pages;p++)locationIds.push(...(await page({section:'locations',page:p})).rows.map(r=>r.id));assert.equal(new Set(locationIds).size,117);assert.deepEqual(locationIds,Array.from({length:117},(_,i)=>id(90001+i)));assert.equal((await page({section:'locations',status:'inactive'})).total,13);assert.equal((await page({section:'locations',status:'dispatch_hub'})).total,1);assert.equal((await page({section:'locations',status:'godown'})).total,116);assert.equal((await page({section:'locations',query:'G117'})).total,1);pass('50-location pages, traversal and exact unfiltered active/hub aggregates');
 for(const args of [{section:'stock'},{section:null},{page:-1},{page:null},{page:1000001},{query:null},{query:'x'.repeat(2001)},{status:'bad'},{status:null},{section:'locations',status:'requested'}])await assert.rejects(page(args));pass('typed validated section, filter and bounded page inputs');
 await db.exec("set test.mfa='no'");await assert.rejects(page(),/Stock access/);await db.exec("set test.mfa='yes';set test.active='no'");await assert.rejects(page(),/Stock access/);await db.exec("set test.active='yes';set test.stock='no'");await assert.rejects(page(),/Stock access/);await assert.rejects(page({section:'locations'}),/Stock access/);await db.exec("set test.stock='yes';reset role;set role anon");await assert.rejects(page(),/permission denied/);await db.exec('reset role');const proc=(await db.query("select prosecdef,proconfig from pg_proc where proname='inventory_operations_page'")).rows[0];assert.equal(proc.prosecdef,false);assert.ok(proc.proconfig.includes('search_path=public, pg_temp'));pass('invoker, fixed search path, anonymous denial and active/MFA/stock module checks');
 await db.exec(`create policy hidden_transfer on inventory_transfers as restrictive for select to authenticated using(id<>'${id(10001)}');
 create policy hidden_product on products as restrictive for select to authenticated using(id<>'${id(77)}');
 create policy hidden_location on inventory_locations as restrictive for select to authenticated using(id<>'${id(90117)}');
 create policy hidden_pack on product_pack_definitions as restrictive for select to authenticated using(id<>'${id(77)}');set role authenticated`);
 const restricted=await page();assert.equal(restricted.totals.all,1066);assert.equal(restricted.totals.in_transit,expectedTotals.in_transit-1);assert.equal((await page({query:'Reviewed product % _'})).total,0);assert.equal((await page({query:'G117'})).total,0);assert.equal((await page({section:'locations'})).total,116);
 const hiddenRows=[];for(let p=0;p<restricted.pages;p++)hiddenRows.push(...(await page({page:p})).rows);assert.ok(hiddenRows.filter(r=>r.product_id===id(77)).every(r=>r.product_name===null&&r.company===null&&r.base_unit===null));assert.ok(hiddenRows.filter(r=>r.to_location_id===id(90117)).every(r=>r.to_name===null));assert.ok(hiddenRows.some(r=>r.product_id===id(77)));pass('restrictive row and join RLS hides metadata without hiding authorized transfers or leaking search matches');
 await db.exec('reset role');assert.equal(JSON.stringify((await db.query('select * from inventory_lots')).rows),quantitiesBefore);assert.equal(JSON.stringify((await db.query('select *,expected_at::text as expected_at from inventory_transfers')).rows),transfersBefore);pass('read-only RPC leaves all stock quantities and transfer records unchanged');
 console.log(`${checks} database checks passed`);
}finally{await db.close();}
