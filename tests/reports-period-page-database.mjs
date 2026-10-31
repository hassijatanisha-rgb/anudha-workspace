import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,owner=id(1),staff=id(2),inactive=id(3),since='2026-09-30T21:00:00.000Z',until='2026-10-31T21:00:00.000Z',now='2026-10-29T21:30:00.123Z',today='2026-10-30';
const kinds=['tasks','proformas','leads','purchasing','service','travel','movements','deliveries'];
const ctx=vm.createContext({Date,products:[],employeeName:actor=>actor});vm.runInContext(read('business-date.js'),ctx);vm.runInContext(read('reports.js'),ctx);
const prodFunction=(file,name)=>{const text=read(file),start=text.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`)),end=text.indexOf('$$;',text.indexOf('as $$',start));assert.ok(start>=0&&end>start);return text.slice(start,end+3)};
const list=async(sql,args=[])=>(await db.query(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') data from (${sql})r`,args)).rows[0].data;
const page=async(kind,p=0,args=[since,until,now,today])=>(await db.query('select report_period_page($1,$2,$3,$4,$5,$6) data',[kind,...args,p])).rows[0].data;
const range=async(table,column='created_at')=>list(`select * from ${table} where ${column}>=$1 and ${column}<$2 order by ${column},id`,[since,until]);
async function expected(kind){
 if(kind==='tasks')return plain(ctx.reportTasks(await range('team_tasks','due_at'),Date.parse(now)));
 if(kind==='proformas')return plain(ctx.reportProformas(await range('sales_proformas')));
 if(kind==='leads')return plain(ctx.reportLeads(await range('sales_leads')));
 if(kind==='purchasing'){const names=new Map((await list('select * from suppliers')).map(row=>[row.id,row.name]));return plain(ctx.reportPurchasing(await range('purchase_orders'))).map(row=>({...row,supplier:names.get(row.supplier_id)||'Supplier not chosen'}));}
 if(kind==='service')return plain(ctx.reportService(await range('service_cases'),Date.parse(now)));
 if(kind==='travel')return plain(ctx.reportTravel(await range('travel_requests','depart_at')));
 if(kind==='movements'){
  const lots=await list('select * from inventory_lots'),locations=new Map((await list('select * from inventory_locations')).map(row=>[row.id,row.name]));ctx.products=await list("select p.id,coalesce(r.name,p.name) name from products p left join lateral(select name from product_detail_reviews where product_id=p.id order by version desc limit 1) r on true");
  return plain(ctx.reportMovements(await range('inventory_movements'),lots)).map(row=>({...row,product:ctx.reportProductName(row.product_id),location:locations.get(row.location_id)||'Unknown location',net:row.pieces_in-row.pieces_out}));
 }
 const notes=await range('sales_delivery_notes','delivered_at'),pfs=await list('select * from sales_proformas'),numbers=new Map(pfs.map(row=>[row.id,row.document_number])),customers=new Map((await list('select * from organizations where deleted_at is null')).map(row=>[row.id,row.name]));
 return plain(ctx.reportDeliveries(notes,pfs)).map(row=>({id:row.id,delivery:row.delivery_number,proforma:numbers.get(row.proforma_id)||'',client:customers.get(row.organization_id)||'',delivered_at:row.delivered_at,ms:row.ms,days:Number((row.ms/86400000).toFixed(1))}));
}
async function parity(){
 for(const kind of kinds){
  const first=await page(kind),oracle=await expected(kind),rows=[];assert.equal(first.total,oracle.length,kind+' total');
  for(let n=0;n<first.pages;n++){const data=await page(kind,n);assert.equal(data.page,n);assert.ok(data.rows.length<=50);assert.deepEqual(data.totals,first.totals);rows.push(...data.rows);}
  // Movement ordering intentionally uses database collation; all grouped values remain identical.
  const identity=row=>`${row.product_id}|${row.location_id}|${row.movement_type}`;
  if(kind==='movements'){rows.sort((a,b)=>identity(a).localeCompare(identity(b)));oracle.sort((a,b)=>identity(a).localeCompare(identity(b)));}
  assert.deepEqual(rows.map((row,i)=>Object.fromEntries(Object.keys(oracle[i]).map(key=>[key,row[key]]))),oracle,kind+' oracle');
  for(const [key,total] of Object.entries(first.totals)){const wanted=oracle.reduce((sum,row)=>sum+(row[key]||0),0);assert.ok(Math.abs(total-wanted)<1e-7,kind+' footer '+key);}
  assert.ok(rows.every(row=>!Object.hasOwn(row,'_order')&&!Object.hasOwn(row,'itinerary')&&!Object.hasOwn(row,'travellers')));
  const last=await page(kind,1000000);assert.equal(last.page,first.pages-1);assert.equal(last.rows.length,Math.max(0,first.total-last.page*50));
 }
}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function mfa_satisfied() returns boolean language sql stable as $$select current_setting('test.mfa',true)='yes'$$;
 create table staff(user_id uuid primary key,department text,active boolean,role text,access text[]);
 insert into staff values('${owner}','management',true,'owner','{}'),('${staff}','sales',true,'staff','{reports,proformas,leads,purchasing,service,travel,stock,deliveries}'),('${inactive}','sales',false,'staff','{}');
 set test.actor='${owner}';set test.mfa='yes';
 create table team_tasks(id uuid primary key,assignee_user_id uuid,status text,due_at timestamptz,closed_at timestamptz);
 create table sales_proformas(id uuid primary key,prepared_by uuid,status text,total_minor bigint,currency text,deleted_at timestamptz,created_at timestamptz,accepted_at timestamptz,document_number text);
 create table sales_leads(id uuid primary key,source text,stage text,created_at timestamptz);
 create table suppliers(id uuid primary key,name text);
 create table purchase_orders(id uuid primary key,supplier_id uuid,status text,created_at timestamptz,closed_at timestamptz);
 create table service_cases(id uuid primary key,case_type text,status text,assigned_user_id uuid,scheduled_for date,created_at timestamptz,completed_at timestamptz);
 create table travel_requests(id uuid primary key,travellers uuid[],status text,organization_id uuid,destination text,depart_at timestamptz,return_at timestamptz,itinerary jsonb);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table product_detail_reviews(product_id uuid,name text,version integer);
 create table inventory_locations(id uuid primary key,name text);
 create table inventory_lots(id uuid primary key,product_id uuid,location_id uuid);
 create table inventory_movements(id uuid primary key,lot_id uuid,movement_type text,base_unit_change integer,created_at timestamptz);
 create table organizations(id uuid primary key,name text,deleted_at timestamptz);
 create table sales_delivery_notes(id uuid primary key,delivery_number text,proforma_id uuid,organization_id uuid,status text,created_at timestamptz,delivered_at timestamptz);`);
 await db.exec(prodFunction('supabase/migrations/202610010058_two_step_sign_in.sql','inventory_active_staff'));await db.exec(prodFunction('supabase/migrations/202610010058_two_step_sign_in.sql','inventory_owner'));await db.exec(prodFunction('supabase/migrations/202610050060_department_heads_and_access.sql','has_access'));
 for(const [table,area] of [['team_tasks',''],['sales_proformas','proformas'],['sales_leads','leads'],['suppliers','purchasing'],['purchase_orders','purchasing'],['service_cases','service'],['travel_requests','travel'],['products',''],['product_detail_reviews',''],['inventory_locations','stock'],['inventory_lots','stock'],['inventory_movements','stock'],['organizations',''],['sales_delivery_notes','deliveries']])await db.exec(`alter table ${table} enable row level security;create policy visible on ${table} for select to authenticated using((select ${area?`has_access('${area}')`:'inventory_active_staff()'}));grant select on ${table} to authenticated`);
 await db.exec(`
 insert into organizations values('${id(8000)}','Fictional <customer>',null),('${id(8001)}','Archived customer',now());
 insert into suppliers select ('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Supplier '||n from generate_series(1,67)n;
 insert into products select ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Raw product '||n,null from generate_series(1,59)n;
 update products set deleted_at=now() where right(id::text,12)::int=1;insert into product_detail_reviews select id,'Reviewed '||name,2 from products;insert into product_detail_reviews select id,'Older correction',1 from products;
 insert into inventory_locations values('${id(7001)}','Godown one'),('${id(7002)}','Godown two');
 insert into inventory_lots select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('40000000-0000-0000-0000-'||lpad((n%59+1)::text,12,'0'))::uuid,case when n%2=0 then '${id(7001)}'::uuid else '${id(7002)}'::uuid end from generate_series(1,119)n;
 insert into team_tasks select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('90000000-0000-0000-0000-'||lpad((n%61)::text,12,'0'))::uuid,case when n%4<2 then 'done' when n%4=2 then 'open' else 'cancelled' end,'2026-10-15'::timestamptz+n*interval '1 millisecond',case when n%4=0 then '2026-10-14'::timestamptz when n%4=1 then '2026-10-16'::timestamptz end from generate_series(1,1107)n;
 insert into sales_proformas select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,case when n%13=0 then null else ('90000000-0000-0000-0000-'||lpad((n%61)::text,12,'0'))::uuid end,case when n%2=0 then 'accepted' else 'sent' end,1000+n,case when n%3=0 then 'USD' when n%3=1 then 'TZS' else 'EUR' end,case when n%11=0 then now() end,'2026-10-01'::timestamptz+n*interval '1 millisecond','2026-10-02','PF-'||n from generate_series(1,1107)n;
 insert into sales_leads select id,case when right(id::text,12)::int%3=0 then 'phone' when right(id::text,12)::int%3=1 then 'whatsapp' else '' end,case when right(id::text,12)::int%5=0 then 'won' when right(id::text,12)::int%5=1 then 'lost' else 'inquiry' end,created_at from sales_proformas;
 insert into purchase_orders select id,case when right(id::text,12)::int%10=0 then null else ('30000000-0000-0000-0000-'||lpad((right(id::text,12)::int%67+1)::text,12,'0'))::uuid end,case when right(id::text,12)::int%5=0 then 'closed' when right(id::text,12)::int%5=1 then 'ordered' when right(id::text,12)::int%5=2 then 'requested' when right(id::text,12)::int%5=3 then 'approved' else 'cancelled' end,created_at,'2026-10-20 00:00:00.123999+00' from sales_proformas;
 insert into service_cases select id,case when right(id::text,12)::int%2=0 then 'installation' else 'service' end,case when right(id::text,12)::int%4=0 then 'completed' when right(id::text,12)::int%4=1 then 'cancelled' else 'scheduled' end,prepared_by,case when right(id::text,12)::int%2=0 then '2026-10-29'::date else '2026-10-30'::date end,created_at,'2026-10-20 00:00:00.111999+00' from sales_proformas;
 insert into travel_requests select id,array[('90000000-0000-0000-0000-'||lpad((right(id::text,12)::int%61)::text,12,'0'))::uuid],case when right(id::text,12)::int%4=0 then 'requested' when right(id::text,12)::int%4=1 then 'done' else 'approved' end,'${id(8000)}','Town',created_at,created_at+interval '1.15 days',case when right(id::text,12)::int%2=0 then '[{"destination":"Town"},{"destination":"Town"},{"destination":"Next town"}]'::jsonb else '[]'::jsonb end from sales_proformas;
 insert into inventory_movements select id,('50000000-0000-0000-0000-'||lpad((right(id::text,12)::int%119+1)::text,12,'0'))::uuid,case when right(id::text,12)::int%2=0 then 'consumer_issue' else 'consumer_return' end,case when right(id::text,12)::int%2=0 then -5 else 7 end,created_at from sales_proformas;
 insert into sales_delivery_notes select id,'DN-'||right(id::text,12),id,'${id(8000)}',case when right(id::text,12)::int%9=0 then 'cancelled' else 'delivered' end,created_at,'2026-10-20 00:00:00.444999+00'::timestamptz+right(id::text,12)::int*interval '1 millisecond' from sales_proformas;
 insert into travel_requests values('${id(9990)}',array['${id(9991)}'::uuid],'done',null,'Rounding','2026-10-01','2026-10-02 03:36:00+00','[]');
 insert into sales_delivery_notes values('${id(9992)}','DN-ROUND',null,'${id(8000)}','delivered','2026-10-01','2026-10-02 03:36:00+00');
 -- Exact local-period edges are compared by every original reducer below.
 update team_tasks set due_at='${until}' where right(id::text,12)::int=1;
 update sales_proformas set created_at='${since}',accepted_at=null where right(id::text,12)::int=1;
 update sales_leads set created_at='${until}' where right(id::text,12)::int=2;
 update service_cases set completed_at=created_at-interval '1 hour' where right(id::text,12)::int=4;
 update sales_delivery_notes set organization_id='${id(8001)}' where right(id::text,12)::int=2;
 update inventory_movements set lot_id=null where right(id::text,12)::int=1;`);
 await db.exec(read('supabase/migrations/202610290148_report_period_page.sql'));await db.exec('set role authenticated');await parity();
 const travel=[];for(let n=0;n<(await page('travel')).pages;n++)travel.push(...(await page('travel',n)).rows);assert.equal(travel.find(row=>row.actor===id(9991)).days,1.1);
 const delivery=[];for(let n=0;n<(await page('deliveries')).pages;n++)delivery.push(...(await page('deliveries',n)).rows);assert.equal(delivery.find(row=>row.id===id(9992)).days,1.1);
 assert.ok((await page('movements')).rows.some(row=>row.product.startsWith('Reviewed ')));assert.equal(delivery.find(row=>row.id==='10000000-0000-0000-0000-000000000002').client,'');assert.ok(!Object.hasOwn((await page('proformas')).totals,'quoted'),'different currencies must not be summed');
 await db.exec(`reset role;create policy hide_customer on organizations as restrictive for select to authenticated using(false);create policy hide_supplier on suppliers as restrictive for select to authenticated using(false);create policy hide_lot on inventory_lots as restrictive for select to authenticated using(right(id::text,12)::integer>10);create policy hide_review on product_detail_reviews as restrictive for select to authenticated using(version=1);create policy selected_orders on sales_proformas as restrictive for select to authenticated using(right(id::text,12)::integer<500);set role authenticated`);await parity();
 for(const actor of [inactive,id(99999)]){await db.exec(`set test.actor='${actor}'`);await assert.rejects(page('tasks'),/Active staff access/);}
 await db.exec(`set test.actor='${owner}';set test.mfa='no'`);await assert.rejects(page('travel'),/Active staff access/);await db.exec("set test.mfa='yes'");
 for(const args of [[null,until,now,today],[since,null,now,today],[until,since,now,today],[since,until,null,today],[since,until,now,null],['-infinity',until,now,today],[since,'infinity',now,today]])await assert.rejects(page('tasks',0,args),/valid report page/);
 for(const p of [-1,null,1000001])await assert.rejects(page('tasks',p),/valid report page/);await assert.rejects(page('invented'),/valid report page/);
 await db.exec(`reset role;update staff set access='{reports}' where user_id='${staff}';set test.actor='${staff}';set role authenticated`);for(const kind of ['proformas','leads','purchasing','service','travel','deliveries'])assert.equal((await page(kind)).total,0);await assert.rejects(page('movements'),/owner only/);assert.ok((await page('tasks')).total>0);
 await db.exec('reset role;set role anon');await assert.rejects(page('tasks'),/permission denied/);
 await db.exec(`reset role;set test.actor='${owner}'`);for(const table of ['team_tasks','sales_proformas','sales_leads','purchase_orders','service_cases','travel_requests','inventory_movements','sales_delivery_notes'])await db.exec(`create policy hide_all on ${table} as restrictive for select to authenticated using(false)`);await db.exec('set role authenticated');for(const kind of kinds){const empty=await page(kind,10);assert.equal(empty.total,0);assert.equal(empty.page,0);assert.equal(empty.pages,1);assert.deepEqual(empty.rows,[]);assert.ok(Object.values(empty.totals).every(n=>n===0));}
 await db.exec('reset role');const fn=(await db.query("select prosecdef,provolatile from pg_proc where proname='report_period_page'")).rows[0];assert.equal(fn.prosecdef,false);assert.equal(fn.provolatile,'s');
 console.log('PASS: all 8 JS oracle formulas and paged full totals across >1100 records per stream, exact dates/milliseconds/company day, binary day-rounding boundaries, currencies, all-page history, corrected names, caller/linked-row/area RLS, owner gate, active/MFA, empty/bounds and anonymous denial. Movement order deliberately uses DB collation.');
}finally{await db.close();}
