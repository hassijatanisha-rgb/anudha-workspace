// Disposable browser-to-PGlite integration. No live Supabase, login, or network.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE||'/private/tmp/anudha-db-tests.aRoaJU/package/dist/index.js');
const {chromium}=await import(pathToFileURL(resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const main=new URL('../',import.meta.url);
const employeeCount=process.env.TWENTY_EMPLOYEES==='1'?20:2;
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const db=new PGlite();let browser;const evidence=[];let tail=Promise.resolve();
// Each bridge captures its actor outside browser control. All transactions are
// serialized: PGlite is one connection, not parallel PostgreSQL or real auth.
function asActor(actor,work){
 const result=tail.then(()=>db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE authenticated');
  await tx.query("select set_config('test.actor',$1,true)",[actor]);
  assert.equal((await tx.query('select auth.uid() actor')).rows[0].actor,actor);
  return work(tx);
 }));tail=result.catch(()=>{});return result;
}
const rpcSpec={
 save_product_machine_link_review:['p_id','p_product_id','p_expected_version','p_machine_ids','p_reason'],
 save_product_source_mapping_review:['p_id','p_source_key','p_expected_version','p_product_id','p_decision','p_snapshot','p_reason']
};
function bridge(actor){return async request=>{
 try{return await asActor(actor,async tx=>{
  if(request.kind==='rpc'){
   const keys=rpcSpec[request.name];assert.ok(keys,'Allowed RPC');
   const values=keys.map(k=>k==='p_snapshot'?JSON.stringify(request.args[k]):request.args[k]);
   return {data:(await tx.query(`select * from ${request.name}(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values)).rows};
  }
  assert.ok(['product_machine_link_reviews','product_source_mapping_reviews'].includes(request.table));
  const field=request.table==='product_machine_link_reviews'?'product_id':'source_key';
  assert.ok(!request.field||request.field===field);
  return {data:(await tx.query(`select * from ${request.table}${request.field?` where ${field}=$1`:''} order by version desc${request.limit?' limit 1':''}`,request.field?[request.value]:[])).rows};
 });}catch(error){return {error:{message:error.message}};}
};}
async function snapshot(){const out={};for(const table of ['products','inventory_locations','product_pack_definitions','inventory_lots','inventory_movements','inventory_transfers','inventory_issues'])out[table]=(await db.query(`select * from ${table} order by id`)).rows;return out;}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text);
 create table organizations(id uuid primary key);
 create table products(id uuid primary key,name text,source jsonb,deleted_at timestamptz);
 grant usage on schema auth to authenticated,anon;
 insert into auth.users values('${id(1)}'),('${id(2)}');
 insert into staff values('${id(1)}',true,'owner'),('${id(2)}',true,'staff');
 insert into products values
 ('${id(10)}','Fictional Albumin Reagent','{"category":"reagents","company":"Fictional Labs","specification":"ALB-100","pack_unit":"KIT","stock":-2,"machine_ids":[]}',null),
 ('${id(11)}','Fictional Analyzer A','{"category":"machines","company":"Fictional Labs","specification":"A-100","pack_unit":"PCS"}',null),
 ('${id(12)}','Fictional Analyzer B','{"category":"machines","company":"Fictional Labs","specification":"B-200","pack_unit":"PCS"}',null);`);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609230017_product_detail_review.sql','202609280032_product_machine_links.sql','202609290033_product_source_mapping_reviews.sql'])await db.exec(readFileSync(new URL('supabase/migrations/'+file,main),'utf8'));
 await db.exec(`insert into inventory_locations(id,name,code,created_by) values('${id(20)}','Fictional Store','FIX','${id(1)}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('${id(21)}','${id(10)}',1,'KIT',10,'Fictional seed','${id(1)}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,sealed_cartons,loose_units) values('${id(22)}','${id(10)}','${id(20)}','${id(21)}',3,4);
 insert into inventory_movements(id,lot_id,movement_type,sealed_carton_change,loose_unit_change,base_unit_change,reason,actor_user_id) values('${id(23)}','${id(22)}','opening_balance',3,4,34,'Fictional seed','${id(1)}');`);
 for(let n=2;n<employeeCount;n++){
  await db.query('insert into auth.users values($1)',[id(1000+n)]);
  await db.query("insert into staff values($1,true,'staff')",[id(1000+n)]);
 }
 const before=await snapshot(),products=before.products;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const ownerContext=await browser.newContext(),staffContext=await browser.newContext();
 async function setup(context,actor,role){
  await context.route('**/*',route=>route.abort());const page=await context.newPage();
  await page.exposeFunction('databaseBridge',bridge(actor));await page.setContent('<main></main>');
  await page.evaluate(({actor,role,products})=>{
   let sequence=100;crypto.randomUUID=()=>`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`;
   window.me={user_id:actor,role};window.products=products;
   window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
   window.run=fn=>fn();window.message=()=>{};window.catalogInventory=()=>{};
   window.catalogRows=()=>products;window.catalogCategoryOf=p=>p.source.category;
   window.client={rpc:(name,args)=>databaseBridge({kind:'rpc',name,args}),from:table=>({
    select(){return this},eq(field,value){this.field=field;this.value=value;return this},order(){return this},
    limit(){return databaseBridge({kind:'read',table,field:this.field,value:this.value,limit:true})}
   })};
   window.all=async table=>{const result=await databaseBridge({kind:'read',table});if(result.error)throw Error(result.error.message);return result.data};
   const original={name:'Fictional Albumin Reagent',originalName:'Fictional Albumin Reagent',manufacturer:'Fictional Labs',model:'ALB-100',units:'KIT',totalStock:-2,locations:'Fictional Store',source:'fictional fixture',notes:null,matchConfidence:1};
   window.row={sourceKey:'fictional:albumin:1',original,corrected:{...original},editedLocally:false,editedAt:null,match:{status:'exact',productIds:[products[0].id]},issues:['negative_stock']};
  },{actor,role,products});
  for(const file of ['product-machine-links.js','product-mapping-decision.js'])await page.addScriptTag({content:readFileSync(new URL(file,main),'utf8')});
  return page;
 }
 const owner=await setup(ownerContext,id(1),'owner'),staff=await setup(staffContext,id(2),'staff');
 await owner.evaluate(id=>openProductMachineLinks(id),id(10));
 for(const machine of [id(11),id(12)])await owner.locator(`input[value="${machine}"]`).check();
 await owner.locator('textarea').fill('Fictional compatibility verified');await owner.locator('button[type="submit"]').click();await owner.locator('dialog').waitFor({state:'detached'});
 const savedLinks=(await db.query('select * from product_machine_link_reviews')).rows;
 assert.equal(savedLinks.length,1);assert.equal(savedLinks[0].product_id,id(10));assert.deepEqual(savedLinks[0].machine_ids,[id(11),id(12)]);assert.equal(savedLinks[0].created_by,id(1));
 // Clear client overlay before reopen, forcing form selection from actual rows.
 await owner.evaluate(id=>{productMachineLinks.clear();return openProductMachineLinks(id)},id(10));
 for(const machine of [id(11),id(12)])assert.equal(await owner.locator(`input[value="${machine}"]`).isChecked(),true);
 await owner.locator('[data-close]').click();await owner.locator('dialog').waitFor({state:'detached'});
 evidence.push('Owner UI saved one product linked to two machines; reopen after clearing client cache loaded both persisted selections.');
 await owner.evaluate(()=>openProductMappingDecision(row,saved=>{window.savedMapping=saved}));
 await owner.locator('textarea').fill('Fictional source identity checked');await owner.locator('button[type="submit"]').click();await owner.locator('dialog').waitFor({state:'detached'});
 const mapping=(await db.query('select * from product_source_mapping_reviews')).rows[0];
 assert.equal(mapping.product_id,id(10));assert.equal(mapping.created_by,id(1));assert.equal(mapping.version,1);assert.equal(mapping.snapshot.original.totalStock,-2);assert.equal(await owner.evaluate(()=>savedMapping.id),mapping.id);
 await owner.evaluate(()=>openProductMappingDecision(row,()=>{}));assert.match(await owner.locator('dialog').innerText(),/Previous decision: linked.*version 1/);await owner.locator('[data-cancel]').click();await owner.locator('dialog').waitFor({state:'detached'});
 evidence.push('Owner mapping form persisted linked decision, original negative stock snapshot, actor, and version; reopen read version 1.');
 const readStaff=await staff.evaluate(async()=>({links:await all('product_machine_link_reviews'),mappings:await all('product_source_mapping_reviews')}));
 assert.deepEqual(readStaff.links[0].machine_ids,[id(11),id(12)]);assert.equal(readStaff.mappings[0].id,mapping.id);
 const linksArgs={p_id:id(201),p_product_id:id(10),p_expected_version:1,p_machine_ids:[id(11)],p_reason:'Direct RPC attempt'};
 const mappingArgs={p_id:id(202),p_source_key:mapping.source_key,p_expected_version:1,p_product_id:id(10),p_decision:'linked',p_snapshot:mapping.snapshot,p_reason:'Direct RPC attempt'};
 // Browser role spoof cannot alter fixed bridge actor. These calls bypass UI.
 await staff.evaluate(()=>{me={role:'owner',user_id:products[0].id}});
 for(const [name,args] of [['save_product_machine_link_review',linksArgs],['save_product_source_mapping_review',mappingArgs]]){
  const result=await staff.evaluate(({name,args})=>client.rpc(name,args),{name,args});assert.match(result.error.message,/Owner/i);
 }
 evidence.push('Independent staff context read actual audit rows through authenticated RLS; both direct RPC writes were denied even after browser role spoof.');
 // Interleaved requests exercise serialization and transaction-local identity.
 for(let n=0;n<4;n++)await Promise.all([
  owner.evaluate(()=>all('product_machine_link_reviews')),
  staff.evaluate(args=>client.rpc('save_product_machine_link_review',args),linksArgs).then(result=>assert.match(result.error.message,/Owner/i))
 ]);
 for(const [name,args] of [['save_product_machine_link_review',linksArgs],['save_product_source_mapping_review',mappingArgs]]){
  const result=await owner.evaluate(({name,args})=>client.rpc(name,{...args,p_expected_version:0}),{name,args});assert.match(result.error.message,/changed|stale/i);
 }
 assert.equal((await db.query('select count(*)::int n from product_machine_link_reviews')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from product_source_mapping_reviews')).rows[0].n,1);
 assert.deepEqual(await snapshot(),before);
 assert.equal((await db.query('select auth.uid() actor')).rows[0].actor,null);
 evidence.push('Both stale-version RPCs rejected; interleaved owner/staff requests retained fixed actors and reset transaction-local auth.');
 if(employeeCount===20){
  const extra=[];
  for(let n=2;n<20;n++)extra.push(await setup(await browser.newContext(),id(1000+n),'staff'));
  // All20 browser contexts remain alive; the shared database still serializes transactions.
  await Promise.all([owner,staff,...extra].map(async(page,index)=>{
   const rows=await page.evaluate(()=>all('product_source_mapping_reviews'));
   assert.equal(rows.length,1);assert.equal(rows[0].id,mapping.id);
   if(index===0)return;
   await page.evaluate(()=>{me.role='owner'});
   const denied=await page.evaluate(args=>client.rpc('save_product_source_mapping_review',args),mappingArgs);
   assert.match(denied.error.message,/Owner/i);
  }));
  assert.equal((await db.query('select count(*)::int n from product_source_mapping_reviews')).rows[0].n,1);
  assert.deepEqual(await snapshot(),before);
  evidence.push('20 simultaneously open isolated browser contexts read the persisted mapping; all19 staff contexts rejected spoofed-owner writes. Database transactions serialized; identities supplied by fixed test bridges, not real sign-in.');
 }
 evidence.push('Complete snapshots unchanged: 3 products, seeded lot (3 cartons + 4 loose units), opening movement, locations, packs, transfers and issues.');
 console.log(JSON.stringify({status:'PASS',checks:evidence,scope:`Actual local browser forms + SQL 001/002/017/032/033; disposable PGlite; ${employeeCount} isolated contexts; all browser network aborted. Serialized one-connection test, not live Supabase auth or parallel PostgreSQL.`},null,2));
}finally{if(browser)await browser.close();await db.close()}
