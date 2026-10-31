// Disposable PostgreSQL only. Auth request claims are fictional; access functions are loaded from current migrations.
// Original CRM policy creation is absent from the baseline, so its current checked-in predicates are used here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actors={owner:id(1),staff:id(2),head:id(3),delivery:id(4),blocked:id(5),inactive:id(6),accounts:id(7)};
let checks=0,firstSearchMs=0;const check=async(label,fn)=>{await fn();checks++;console.log('PASS '+label);};
const loadFunction=async(file,name)=>{
 const sql=read(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'))?.[0];
 assert.ok(sql,name);await db.exec(sql);
};
const as=async(actor,{aal='aal2',age=0}={})=>{
 await db.exec('reset role');
 await db.query("select set_config('test.actor',$1,false),set_config('test.aal',$2,false),set_config('test.age',$3,false)",[actor,aal,String(age)]);
 await db.exec('set role authenticated');
};
const search=async query=>(await db.query('select workspace_search($1) result',[query])).rows[0].result;
const rows=(result,group)=>result.groups[group].rows;
const allRows=result=>Object.values(result.groups).flatMap(group=>group.rows);
const seed=async(table,records)=>db.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table},$1)`,[JSON.stringify(records)]);
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true),'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint-coalesce(nullif(current_setting('test.age',true),''),'0')::bigint)))$$;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
 create table auth.mfa_factors(user_id uuid,status text);
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table accounting_memberships(user_id uuid primary key,active boolean);
 create table organizations(id uuid primary key,name text,location text,parent_id uuid,deleted_at timestamptz,source jsonb);
 create table contacts(id uuid primary key,title text,first_name text,last_name text,phone text,email text,deleted_at timestamptz);
 create table products(id uuid primary key,name text,sku text,source jsonb,deleted_at timestamptz);
 create table product_detail_reviews(id uuid primary key,product_id uuid,version integer,name text,company text,specification text,unique(product_id,version));
 create table sales_proformas(id uuid primary key,document_number text,organization_id uuid,contact_id uuid,status text,acceptance_reference text,deleted_at timestamptz,notes text);
 create table acc_invoices(id uuid primary key,invoice_number text,organization_id uuid,voided_at timestamptz,opening_import_id uuid,opening_reference text,lines jsonb,buyer_tin text);
 grant usage on schema auth to authenticated;
 insert into staff values('${actors.owner}',true,'owner','management','{}'),('${actors.staff}',true,'staff','sales','{proformas}'),('${actors.head}',true,'head','sales','{proformas}'),('${actors.delivery}',true,'staff','stores','{deliveries}'),('${actors.blocked}',true,'staff','service','{}'),('${actors.inactive}',false,'staff','sales','{proformas}'),('${actors.accounts}',true,'staff','accounts','{}');
 insert into auth.users select user_id,'{}'::jsonb from staff;
 insert into accounting_memberships values('${actors.owner}',true),('${actors.accounts}',true);`);
 await loadFunction('202610140080_require_two_step.sql','two_step_required');
 await loadFunction('202610160099_password_replacement.sql','password_change_satisfied');
 await loadFunction('202610160099_password_replacement.sql','mfa_satisfied');
 await loadFunction('202610010058_two_step_sign_in.sql','inventory_active_staff');
 await loadFunction('202610010058_two_step_sign_in.sql','is_active_staff');
 await loadFunction('202610050060_department_heads_and_access.sql','has_access');
 await loadFunction('202609230015_accounting_membership.sql','accounting_access');
 await db.exec(`do $$declare t text;begin
 foreach t in array array['organizations','contacts','products','product_detail_reviews','sales_proformas','acc_invoices'] loop
 execute format('alter table %I enable row level security',t);execute format('grant select on %I to authenticated',t);
 end loop;end$$;
 create policy organizations_read on organizations for select to authenticated using ((select is_active_staff()));
 create policy contacts_read on contacts for select to authenticated using ((select is_active_staff()));
 create policy products_read on products for select to authenticated using ((select is_active_staff()));
 create policy product_detail_reviews_read on product_detail_reviews for select to authenticated using ((select inventory_active_staff()));
 create policy sales_proformas_read on sales_proformas for select to authenticated using ((select has_access('proformas')) or (select has_access('deliveries')));
 create policy acc_invoices_read on acc_invoices for select to authenticated using ((select accounting_access()));`);
 const orgs=Array.from({length:1205},(_,n)=>({id:id(10000+n),name:`Fixture client ${String(n).padStart(4,'0')}`,location:'Fixture town',parent_id:null,deleted_at:null,source:{private:'PRIVATE_ORG_SOURCE'}}));
 const products=Array.from({length:1205},(_,n)=>({id:id(20000+n),name:`Fixture product ${String(n).padStart(4,'0')}`,sku:`SKU-${n}`,source:{company:'Fixture maker',model:'M100',specification:'Fixture spec',raw:{secret:'PRIVATE_PRODUCT_SOURCE'}},deleted_at:null}));
 const proformas=Array.from({length:1205},(_,n)=>({id:id(30000+n),document_number:`PF-${String(n).padStart(5,'0')}`,organization_id:orgs[n].id,contact_id:id(9000),status:'draft',acceptance_reference:'',deleted_at:null,notes:'PRIVATE_ORDER_NOTE'}));
 const invoices=Array.from({length:1205},(_,n)=>({id:id(40000+n),invoice_number:`INV-${String(n).padStart(5,'0')}`,organization_id:orgs[n].id,voided_at:null,opening_import_id:null,opening_reference:null,lines:[{secret:'PRIVATE_INVOICE_LINES'}],buyer_tin:'PRIVATE_BUYER_TIN'}));
 await seed('organizations',orgs);await seed('products',products);await seed('sales_proformas',proformas);await seed('acc_invoices',invoices);
 await seed('contacts',[{id:id(9000),title:'Dr',first_name:'ContactOnly',last_name:'Buyer',phone:'PRIVATE_PHONE',email:'PRIVATE_EMAIL',deleted_at:null}]);
 await seed('product_detail_reviews',[
  {id:id(50000),product_id:id(21204),version:1,name:'Old reviewed identity',company:'Old reviewed maker',specification:'Old reviewed spec'},
  {id:id(50001),product_id:id(21204),version:2,name:'Corrected analyzer',company:'Current manufacturer',specification:'Z-900'}
 ]);
 await db.exec(read('202610290155_workspace_search.sql'));await as(actors.owner);
 await check('contract: 1205 records per domain, five suggestions plus sixth sentinel, 20 total, deterministic order',async()=>{
  const start=performance.now(),first=await search('Fixture');firstSearchMs=performance.now()-start;assert.deepEqual(Object.keys(first).sort(),['groups','query']);assert.equal(first.query,'Fixture');assert.equal(allRows(first).length,20);
  for(const [kind,group] of Object.entries(first.groups)){assert.deepEqual(Object.keys(group).sort(),['available','has_more','rows']);assert.equal(group.available,true);assert.equal(group.rows.length,5,kind);assert.equal(group.has_more,true);for(const row of group.rows){assert.deepEqual(Object.keys(row).sort(),['id','kind','subtitle','title']);assert.ok(row.title.length<=180&&row.subtitle.length<=180);}}
  assert.deepEqual(await search('Fixture'),first);assert.deepEqual(rows(first,'clients').map(r=>r.id),orgs.slice(0,5).map(r=>r.id));
  assert.ok(Buffer.byteLength(JSON.stringify(first))<10000);
 });
 await check('blank/one-character/Unicode whitespace returns no company rows; null and oversized reject',async()=>{
  for(const query of ['', ' ', '\t\n\u00a0\u3000\ufeff', 'F','  F  ']){const result=await search(query);assert.equal(allRows(result).length,0);assert.ok(Object.values(result.groups).every(g=>!g.has_more));}
  assert.equal((await search(' \tFixture\u00a0')).query,'Fixture');await assert.rejects(search(null),/120 characters/);await assert.rejects(search('a'.repeat(121)),/120 characters/);assert.equal(allRows(await search('a'.repeat(120))).length,0);
  // Prove the short-query branch does not read domain tables, even with their SELECT privilege absent.
  await db.exec('reset role;revoke select on organizations,contacts,products,product_detail_reviews,sales_proformas,acc_invoices from authenticated;set role authenticated');
  assert.equal(allRows(await search('')).length,0);await assert.rejects(search('Fixture'),/permission denied/);
  await db.exec('reset role;grant select on organizations,contacts,products,product_detail_reviews,sales_proformas,acc_invoices to authenticated;set role authenticated');
 });
 await check('exact identifier wins over prefix; equal names ordered by UUID',async()=>{
  assert.equal(rows(await search('SKU-12'),'products')[0].id,id(20012));assert.equal(rows(await search('PF-00012'),'proformas')[0].id,id(30012));assert.equal(rows(await search('INV-00012'),'invoices')[0].id,id(40012));
  await db.exec('reset role');await db.query('update organizations set name=$1 where id in($2,$3)',['Fixture identical',id(10005),id(10004)]);await db.exec('set role authenticated');
  assert.deepEqual(rows(await search('Fixture identical'),'clients').map(r=>r.id),[id(10004),id(10005)]);
 });
 await check('latest reviewed product identity replaces old search fields and base SKU remains searchable',async()=>{
  for(const query of ['Corrected analyzer','Current manufacturer','Z-900','SKU-1204'])assert.equal(rows(await search(query),'products')[0].id,id(21204));
  for(const query of ['Old reviewed identity','Old reviewed maker','Old reviewed spec','Fixture product 1204'])assert.equal(rows(await search(query),'products').length,0);
 });
 await check('literal wildcards, quotes, SQL-shaped text and Unicode cannot broaden results',async()=>{
  await db.exec('reset role');await db.query('update organizations set name=$1,location=$2 where id=$3',["École 100%_ ' OR 1=1 --",'München',id(11203)]);await db.exec('set role authenticated');
  for(const query of ['%_','100%_',"' OR 1=1 --",'éCOLE','MÜNCHEN']){const result=await search(query);assert.deepEqual(rows(result,'clients').map(r=>r.id),[id(11203)]);assert.equal(rows(result,'products').length,0);}
  assert.equal(allRows(await search("'; drop table products; --")).length,0);
 });
 await check('no private provenance, phone, email, note, line JSON, balances or tax fields projected/searched',async()=>{
  const result=await search('ContactOnly');assert.equal(rows(result,'proformas').length,5);assert.ok(rows(result,'proformas').every(r=>!r.subtitle.includes('ContactOnly')));
  for(const query of ['PRIVATE_ORG_SOURCE','PRIVATE_PRODUCT_SOURCE','PRIVATE_PHONE','PRIVATE_EMAIL','PRIVATE_ORDER_NOTE','PRIVATE_INVOICE_LINES','PRIVATE_BUYER_TIN'])assert.equal(allRows(await search(query)).length,0,query);
  assert.doesNotMatch(JSON.stringify(await search('Fixture')),/PRIVATE_|"lines"|"source"|"total_minor"|"phone"|"email"|"buyer_tin"/);
 });
 await check('180-character labels, exactly five has_more false, six has_more true, unknown query empty',async()=>{
  await db.exec('reset role');await db.query('update organizations set name=$1,location=$2 where id=$3',['Long '+ '名'.repeat(300),'所'.repeat(400),id(11202)]);
  await db.exec("update organizations set name='FiveOnly' where id::text between '00000000-0000-4000-8000-000000010010' and '00000000-0000-4000-8000-000000010014';set role authenticated");
  const long=rows(await search('Long'),'clients')[0];assert.equal([...long.title].length,180);assert.equal([...long.subtitle].length,180);
  assert.equal((await search('FiveOnly')).groups.clients.has_more,false);assert.equal(rows(await search('FiveOnly'),'clients').length,5);
  await db.exec("reset role;update organizations set name='FiveOnly' where id='00000000-0000-4000-8000-000000010015';set role authenticated");assert.equal((await search('FiveOnly')).groups.clients.has_more,true);
  assert.equal(allRows(await search('No matches exist')).length,0);
 });
 await check('deleted rows excluded; visible branch of hidden parent stays independent; void/opening invoice semantics retained',async()=>{
  await db.exec('reset role');await db.query('update organizations set parent_id=$1 where id=$2',[id(10000),id(11201)]);
  for(const [table,key] of [['organizations',id(11200)],['products',id(21200)],['sales_proformas',id(31200)]])await db.query(`update ${table} set deleted_at=now() where id=$1`,[key]);
  await db.query("update acc_invoices set opening_import_id=$1,opening_reference='OpeningMarker' where id=$2",[id(80000),id(41204)]);await db.query('update acc_invoices set voided_at=now() where id=$1',[id(41203)]);await db.exec('set role authenticated');
  assert.equal(rows(await search('Fixture client 1200'),'clients').length,0);assert.equal(rows(await search('SKU-1200'),'products').length,0);assert.equal(rows(await search('PF-01200'),'proformas').length,0);
  assert.equal(rows(await search('Fixture client 1201'),'clients')[0].kind,'branch');assert.equal(rows(await search('OpeningMarker'),'invoices')[0].kind,'opening_balance');assert.match(rows(await search('INV-01203'),'invoices')[0].subtitle,/Void/);
 });
 await check('ordinary staff/head area access; delivery-only read policy does not expose an unusable Pro forma route',async()=>{
  for(const actor of [actors.staff,actors.head]){await as(actor);const result=await search('Fixture');assert.equal(result.groups.proformas.available,true);assert.equal(result.groups.invoices.available,false);assert.equal(rows(result,'invoices').length,0);}
  for(const actor of [actors.delivery,actors.blocked]){await as(actor);const result=await search('Fixture');assert.equal(result.groups.proformas.available,false);assert.equal(rows(result,'proformas').length,0);assert.equal(rows(result,'clients').length,5);assert.equal(rows(result,'products').length,5);}
  await as(actors.delivery);assert.ok((await db.query('select count(*)::integer n from sales_proformas')).rows[0].n>1000,'underlying delivery read remains allowed');
 });
 await check('accounting membership required even for owner; revocation immediate; denied groups do not read protected tables',async()=>{
  await as(actors.accounts);assert.equal((await search('INV-')).groups.invoices.available,true);assert.equal((await search('PF-')).groups.proformas.available,false);
  await db.exec(`reset role;update accounting_memberships set active=false where user_id='${actors.owner}';`);await as(actors.owner);assert.equal((await search('INV-')).groups.invoices.available,false);
  await db.exec(`reset role;update accounting_memberships set active=false where user_id='${actors.accounts}';`);await as(actors.accounts);assert.equal(rows(await search('INV-'),'invoices').length,0);
  await as(actors.blocked);await db.exec('reset role;revoke select on sales_proformas,acc_invoices from authenticated;set role authenticated');assert.equal(rows(await search('Fixture'),'clients').length,5);
  await db.exec(`reset role;grant select on sales_proformas,acc_invoices to authenticated;update accounting_memberships set active=true;`);await as(actors.owner);
 });
 await check('current password/MFA age/required enrollment gates, inactive and missing actor fail closed',async()=>{
  await as(actors.owner,{aal:'aal1'});await assert.rejects(search('Fixture'),/Active staff/);
  await as(actors.owner,{age:31*86400});await assert.rejects(search('Fixture'),/Active staff/);
  await as(actors.accounts,{aal:'aal1'});await assert.rejects(search('Fixture'),/Active staff/);
  await as(actors.staff,{aal:'aal1'});assert.equal(rows(await search('Fixture'),'clients').length,5,'unenrolled ordinary staff retain optional MFA');
  await db.exec(`reset role;insert into auth.mfa_factors values('${actors.staff}','verified');set role authenticated`);await assert.rejects(search('Fixture'),/Active staff/);
  await as(actors.staff);assert.equal(rows(await search('Fixture'),'clients').length,5);
  await db.exec(`reset role;update auth.users set raw_app_meta_data='{"must_change_password":true}' where id='${actors.staff}';set role authenticated`);await assert.rejects(search('Fixture'),/Active staff/);
  await as(actors.inactive);await assert.rejects(search('Fixture'),/Active staff/);await as('');await assert.rejects(search(''),/Active staff/);
  await db.exec(`reset role;update auth.users set raw_app_meta_data='{}' where id='${actors.staff}';`);await as(actors.owner);
 });
 await check('caller RLS hides matching customer/contact labels; invoice/PF identifier remains accessible without leaking the hidden name',async()=>{
  await db.exec(`reset role;create policy hidden_customer on organizations as restrictive for select to authenticated using(id<>'${id(11203)}' and id<>'${id(10000)}');create policy hidden_contact on contacts as restrictive for select to authenticated using(false);set role authenticated`);
  assert.equal(allRows(await search('École')).length,0);assert.equal(rows(await search('ContactOnly'),'proformas').length,0);
  const pf=rows(await search('PF-01203'),'proformas')[0],invoice=rows(await search('INV-01203'),'invoices')[0];assert.match(pf.subtitle,/Client unavailable/);assert.match(invoice.subtitle,/Client unavailable/);assert.doesNotMatch(JSON.stringify([pf,invoice]),/École/);
  assert.equal(rows(await search('Fixture client 1201'),'clients')[0].kind,'branch');
 });
 await check('caller RLS applies to product reviews, products, Pro formas and invoices independently',async()=>{
  await db.exec(`reset role;create policy hidden_review on product_detail_reviews as restrictive for select to authenticated using(version<>2);set role authenticated`);
  assert.equal(rows(await search('Corrected analyzer'),'products').length,0);assert.equal(rows(await search('Old reviewed identity'),'products')[0].id,id(21204));
  await db.exec(`reset role;create policy hidden_product on products as restrictive for select to authenticated using(id<>'${id(21204)}');create policy hidden_pf on sales_proformas as restrictive for select to authenticated using(id<>'${id(31203)}');create policy hidden_invoice on acc_invoices as restrictive for select to authenticated using(id<>'${id(41203)}');set role authenticated`);
  assert.equal(rows(await search('SKU-1204'),'products').length,0);assert.equal(rows(await search('PF-01203'),'proformas').length,0);assert.equal(rows(await search('INV-01203'),'invoices').length,0);
 });
 await check('invoker/stable/fixed path, authenticated-only execution, no new write privileges or source row mutations',async()=>{
  await db.exec('reset role;set role anon');await assert.rejects(search('Fixture'),/permission denied/);await db.exec('reset role');
  const proc=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid='workspace_search(text)'::regprocedure")).rows[0];assert.deepEqual(proc,{prosecdef:false,provolatile:'s',proconfig:['search_path=public, pg_temp']});
  assert.equal((await db.query("select has_function_privilege('authenticated','workspace_search(text)','execute') allowed")).rows[0].allowed,true);
  assert.equal((await db.query("select has_function_privilege('anon','workspace_search(text)','execute') allowed")).rows[0].allowed,false);
  for(const table of ['organizations','contacts','products','product_detail_reviews','sales_proformas','acc_invoices'])assert.equal((await db.query('select has_table_privilege(\'authenticated\',$1,\'INSERT,UPDATE,DELETE\') allowed',[table])).rows[0].allowed,false);
  for(const table of ['organizations','products','sales_proformas','acc_invoices'])assert.equal((await db.query(`select count(*)::integer n from ${table}`)).rows[0].n,1205);
 });
 await as(actors.owner);const timings=[];
 for(let n=0;n<12;n++){const start=performance.now();await search(n%2?'Fixture':'PF-01203');timings.push(performance.now()-start);}
 console.log(`LOCAL PGlite search timings (1205 rows/domain, JS transport included): first invocation=${firstSearchMs.toFixed(3)}ms; 12 warm calls after restrictive-policy tests: mean=${(timings.reduce((a,b)=>a+b,0)/timings.length).toFixed(3)}ms max=${Math.max(...timings).toFixed(3)}ms. Not live HTTP/database latency; no index added.`);
 console.log(`${checks} workspace-search database checks passed`);
}finally{await db.close();}
