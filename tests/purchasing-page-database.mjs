// Disposable PostgreSQL fixture only; executes migration 138 with invoker roles and RLS.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const OWNER=id(9001),BUYER=id(9002),OTHER=id(9003),INACTIVE=id(9004);let checks=0;
const check=async fn=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,role text,active boolean,access text[]);
 insert into staff values('${OWNER}','owner',true,'{}'),('${BUYER}','staff',true,'{purchasing}'),('${OTHER}','staff',true,'{stock}'),('${INACTIVE}','staff',false,'{purchasing}');
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active) and current_setting('test.mfa',true)='yes'$$;
 create function has_access(area text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select inventory_active_staff() and exists(select 1 from staff where user_id=auth.uid() and (role='owner' or area=any(access)))$$;
 create table suppliers(id uuid primary key,supplier_number text,name text,country text,contact_name text,phone text,email text,tin text,active boolean,notes text);
 create table purchase_orders(id uuid primary key,po_number text,status text,supplier_id uuid,expected_on date,lpo_reference text,notes text,created_at timestamptz,updated_at timestamptz);
 create table purchase_order_lines(id uuid primary key,purchase_order_id uuid,line_number integer,product_id uuid,quantity integer,note text);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table product_detail_reviews(id uuid primary key,product_id uuid,version integer,name text);
 create unique index purchase_order_lines_order_number on purchase_order_lines(purchase_order_id,line_number);
 create index product_detail_reviews_product on product_detail_reviews(product_id,version desc);
 grant usage on schema auth to authenticated;
 do $$declare t text;begin foreach t in array array['suppliers','purchase_orders','purchase_order_lines','products','product_detail_reviews'] loop
 execute format('alter table %I enable row level security',t);execute format('grant select on %I to authenticated',t);
 execute format('create policy read_rows on %I for select to authenticated using ((select inventory_active_staff()))',t);
 end loop;end $$;
 alter policy read_rows on suppliers using ((select has_access('purchasing')));
 alter policy read_rows on purchase_orders using ((select has_access('purchasing')));
 alter policy read_rows on purchase_order_lines using ((select has_access('purchasing')));
 set test.mfa='yes';`);
 await db.exec(read('supabase/migrations/202610290138_purchasing_page.sql'));
 const now=(await db.query('select now() as value')).rows[0].value,stamp=days=>new Date(new Date(now).getTime()-days*864e5).toISOString(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const suppliers=Array.from({length:1131},(_,n)=>({id:id(10000+n),supplier_number:'SUP-'+String(n).padStart(6,'0'),name:'Supplier '+String(n).padStart(4,'0'),country:n%2?'Tanzania':'India',contact_name:n%7?'Named contact':'Special contact',phone:'+255-000-'+n,email:'supplier'+n+'@example.test',tin:'TIN-'+n,active:n%4!==0,notes:'DETAIL ONLY '.repeat(300)}));
 const statuses=['requested','approved','ordered','closed','cancelled'];
 const orders=Array.from({length:1120},(_,n)=>({id:id(20000+n),po_number:'PO-'+String(n).padStart(6,'0'),status:n<100?'closed':statuses[n%5],supplier_id:suppliers[n%suppliers.length].id,expected_on:n%4===0?null:n%4===1?'2000-01-01':n%4===2?today:'2099-01-01',lpo_reference:n<100?'LPO-OLD-GROUP-'+n:'LPO-'+n,notes:n%3?'Standard order':'Need urgent delivery',created_at:stamp(250+n%10),updated_at:stamp(n<100||n%7===0?220:7)}));
 orders[1100].notes='Literal %_ search';orders[1101].notes='Quote \' ; DROP TABLE suppliers; --';
 const products=[{id:id(30001),name:'Original syringe',deleted_at:null},{id:id(30002),name:'Cannula',deleted_at:null},{id:id(30003),name:'Archived bag',deleted_at:stamp(1)}];
 const reviews=[{id:id(31001),product_id:products[0].id,version:1,name:'Old reviewed syringe'},{id:id(31002),product_id:products[0].id,version:2,name:'Corrected syringe'}];
 const lines=orders.flatMap((order,n)=>[0,1].map((m)=>({id:id(40000+n*2+m),purchase_order_id:order.id,line_number:m+1,product_id:products[(n+m)%3].id,quantity:4,note:'LINE DETAIL '.repeat(100)})));
 await db.query('insert into suppliers select * from jsonb_to_recordset($1::jsonb) as x(id uuid,supplier_number text,name text,country text,contact_name text,phone text,email text,tin text,active boolean,notes text)',[JSON.stringify(suppliers)]);
 await db.query('insert into purchase_orders select * from jsonb_to_recordset($1::jsonb) as x(id uuid,po_number text,status text,supplier_id uuid,expected_on date,lpo_reference text,notes text,created_at timestamptz,updated_at timestamptz)',[JSON.stringify(orders)]);
 await db.query('insert into products select * from jsonb_to_recordset($1::jsonb) as x(id uuid,name text,deleted_at timestamptz)',[JSON.stringify(products)]);
 await db.query('insert into product_detail_reviews select * from jsonb_to_recordset($1::jsonb) as x(id uuid,product_id uuid,version integer,name text)',[JSON.stringify(reviews)]);
 await db.query('insert into purchase_order_lines select * from jsonb_to_recordset($1::jsonb) as x(id uuid,purchase_order_id uuid,line_number integer,product_id uuid,quantity integer,note text)',[JSON.stringify(lines)]);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');};
 const page=async(section='orders',filter='all',query='',number=0)=>(await db.query('select purchasing_page($1,$2,$3,$4) result',[section,filter,query,number])).rows[0].result;
 const legacy=vm.createContext({document:{addEventListener(){}},clearTimeout});
 for(const file of ['business-date.js','row-index.js','product-review-ui.js','purchasing.js'])vm.runInContext(read(file),legacy);
 async function visible(){for(const [key,table] of [['orders','purchase_orders'],['suppliers','suppliers'],['lines','purchase_order_lines'],['products','products'],['reviews','product_detail_reviews']])legacy[key+'Fixture']=(await db.query('select to_jsonb(t) as value from '+table+' t')).rows.map(row=>row.value);
  vm.runInContext("purchaseOrders=ordersFixture;suppliers=suppliersFixture;purchaseLines=linesFixture;products=productsFixture;productDetailReviews=new Map();for(const row of reviewsFixture)if((productDetailReviews.get(row.product_id)?.version||0)<row.version)productDetailReviews.set(row.product_id,row);inventoryProduct=id=>{const row=products.find(p=>p.id===id);return row?reviewedCatalogProduct(row):{name:'Unknown product'};};",legacy);
 }
 const scoped=query=>{const term=query.replace(/[^\p{L}\p{N}.\-\/ ]/gu,' ').trim().toLowerCase();return legacy.ordersFixture.filter(row=>['requested','approved','ordered'].includes(row.status)||new Date(row.updated_at)>=new Date(new Date(now).getTime()-183*864e5)||(term.length>=3&&[row.po_number,row.lpo_reference].some(value=>value.toLowerCase().includes(term))));};
 const expectedOrders=(filter,query)=>legacy.purchaseVisibleOrders(scoped(query),{filter,search:query,today}).map(row=>row.id);
 const expectedSuppliers=query=>legacy.suppliersFixture.filter(s=>[s.supplier_number,s.name,s.country,s.contact_name,s.phone,s.email,s.tin].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>Number(b.active)-Number(a.active)||a.name.localeCompare(b.name)).map(row=>row.id);
 async function collect(section,filter,query){const first=await page(section,filter,query),rows=[...first.rows];for(let n=1;n<first.pages;n++)rows.push(...(await page(section,filter,query,n)).rows);assert.equal(rows.length,first.total);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);return {first,rows};}
 await as(OWNER);await visible();
 await check(async()=>{for(const filter of ['requested','approved','ordered','finished','all']){const {first,rows}=await collect('orders',filter,'');assert.deepEqual(rows.map(row=>row.id),expectedOrders(filter,''));assert.ok(first.rows.length<=20);for(const status of ['requested','approved','ordered'])assert.equal(first.counts[status],scoped('').filter(row=>row.status===status).length);assert.equal(first.counts.all,scoped('').length);assert.equal(first.counts.overdue,scoped('').filter(row=>legacy.purchaseOverdue(row,today)).length);}});
 await check(async()=>{for(const query of ['Corrected syringe','Original syringe','Old reviewed syringe','Archived bag','Cannula','Supplier 010','Need urgent','PO-000110','LPO-108','%_','Quote \' ; DROP TABLE suppliers; --','  cannula  ','PO','LPO-OLD-GROUP']){const {rows}=await collect('orders','all',query);assert.deepEqual(rows.map(row=>row.id),expectedOrders('all',query),query);}assert.equal((await page('orders','all','Original syringe')).total,0);});
 await check(async()=>{const {first,rows}=await collect('orders','finished','LPO-OLD-GROUP');assert.equal(first.total,100);assert.equal(first.pages,5);assert.equal(rows.length,100,'older PO/LPO searches are not truncated at 50');assert.equal((await page('orders','finished','LPO-OLD-GROUP',1000000)).page,4);assert.ok(!scoped('').some(row=>row.id===orders[0].id));});
 await check(async()=>{const {first,rows}=await collect('suppliers','all','');assert.equal(first.total,1131);assert.equal(first.pages,57);assert.deepEqual(rows.map(row=>row.id),expectedSuppliers(''));for(const query of ['Special contact','TIN-10','supplier9@','+255-000-7','India','SUP-0000','%'])assert.deepEqual((await collect('suppliers','all',query)).rows.map(row=>row.id),expectedSuppliers(query));});
 await check(async()=>{for(const section of ['orders','suppliers']){const result=await page(section);assert.ok(JSON.stringify(result).length<20000);assert.ok(result.rows.every(row=>row.register_summary===true&&row.kind===section&&!('purchase_order_lines' in row)&&!('notes' in row)));assert.ok(!JSON.stringify(result).includes('DETAIL'));}const empty=await page('orders','all','no matching order');assert.equal(empty.total,0);assert.equal(empty.pages,1);assert.equal(empty.page,0);});
 await check(async()=>{await as(BUYER);assert.equal((await page()).total,expectedOrders('all','').length);await as(OTHER);await assert.rejects(page(),/Purchasing access/);await as(INACTIVE);await assert.rejects(page('suppliers'),/Purchasing access/);await as(OWNER);await db.exec("set test.mfa='no'");await assert.rejects(page(),/Purchasing access/);await db.exec("set test.mfa='yes'");});
 await check(async()=>{await assert.rejects(page('invalid'),/valid purchasing section/);await assert.rejects(page('orders','invalid'),/valid purchase filter/);await assert.rejects(page('orders','all',null),/Search must/);await assert.rejects(page('orders','all','x'.repeat(2001)),/Search must/);for(const n of [null,-1,1000001])await assert.rejects(page('orders','all','',n),/valid purchasing page/);});
 await check(async()=>{await db.exec(`reset role;create policy hide_order on purchase_orders as restrictive for select to authenticated using(id<>'${orders[1100].id}');create policy hide_supplier on suppliers as restrictive for select to authenticated using(id<>'${suppliers[1100].id}');create policy hide_lines on purchase_order_lines as restrictive for select to authenticated using(purchase_order_id<>'${orders[1101].id}');set role authenticated`);await visible();for(const query of ['','Literal %_','Supplier 1100','Corrected syringe'])assert.deepEqual((await collect('orders','all',query)).rows.map(row=>row.id),expectedOrders('all',query));assert.equal((await page('suppliers')).total,1130);});
 await check(async()=>{await db.exec("reset role;create policy hide_product on products as restrictive for select to authenticated using(false);set role authenticated");await visible();assert.equal((await page('orders','all','Corrected syringe')).total,0);assert.deepEqual((await collect('orders','all','Unknown product')).rows.map(row=>row.id),expectedOrders('all','Unknown product'));});
 await check(async()=>{await db.exec('reset role;set role anon');await assert.rejects(page(),/permission denied/);await db.exec('reset role');assert.deepEqual((await db.query("select prosecdef,provolatile from pg_proc where proname='purchasing_page'")).rows[0],{prosecdef:false,provolatile:'s'});assert.equal((await db.query('select count(*)::int n from suppliers')).rows[0].n,1131);});
 console.log(`PASS: ${checks} purchasing-page database checks; 1120 orders and 1131 suppliers, complete 20-row pages, actual filter/search/overdue parity, older PO/LPO access, corrected identities, bounded payload, roles/MFA/RLS and anonymous denial.`);
}finally{await db.close();}
