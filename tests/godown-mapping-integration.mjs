import {chromium} from '/Users/tanisha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE||'../../../test-runtime/pglite-0.3.14/package/dist/index.js');
const db=new PGlite(),id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
let browser;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;create table staff(user_id uuid,active boolean,role text);create table products(id uuid primary key);create table organizations(id uuid primary key);insert into auth.users values('${id(1)}'),('${id(2)}');insert into staff values('${id(1)}',true,'owner'),('${id(2)}',true,'staff');grant usage on schema auth to authenticated,anon;`);
 const root=new URL('../supabase/migrations/',import.meta.url);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609230018_tally_stock_review.sql'])await db.exec(readFileSync(new URL(file,root),'utf8'));
 await db.exec(`insert into inventory_locations(id,name,code,created_by) values('${id(10)}','City Printer','CP','${id(1)}');insert into tally_stock_sources(id,source_file,source_row,godown,product_name,quantity,balance_date,raw,imported_by) values('source','fixture',1,'CITY PRINTER','Blood bags',-4,'2026-09-22','{}','${id(1)}');`);
 const migration=new URL('202609290041_godown_mapping_reviews.sql',root);if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'));

 await db.exec(`set test.actor='${id(1)}';set role authenticated`);
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage();
 await page.exposeFunction('readFixture',async name=>{
  const queries={inventory_locations:'select id,name,active from inventory_locations',godown_mapping_reviews:'select id,source_godown,version,location_id,reason from godown_mapping_reviews'};
  if(!queries[name])throw Error('Unexpected table');return (await db.query(queries[name])).rows;
 });
 let loseFirstResponse=true;
 await page.exposeFunction('saveFixture',async(name,p)=>{
  assert.equal(name,'save_godown_mapping_review');
  try{
   const result=await db.query('select * from save_godown_mapping_review($1,$2,$3,$4,$5)',[p.p_id,p.p_godown,p.p_expected_version,p.p_location_id,p.p_reason]);
   if(loseFirstResponse){loseFirstResponse=false;return {error:{message:'Simulated lost response after commit'}};}
   return {data:result.rows[0]};
  }catch(error){return {error:{message:error.message}};}
 });
 await page.route('https://inventory-fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<main id="content"></main>'}));await page.goto('https://inventory-fixture.test/');
 await page.addScriptTag({content:`let me={user_id:'owner',role:'owner'},inventorySection='review';const client={rpc:(n,p)=>window.saveFixture(n,p)};const all=n=>window.readFixture(n);function esc(v){const e=document.createElement('span');e.textContent=String(v);return e.innerHTML.replace(/"/g,'&quot;');}`});
 await page.addScriptTag({content:readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8')});
 await page.evaluate(()=>{document.querySelector('#content').innerHTML='<section id="godownReadiness"><table><tbody><tr data-source-godown="CITY PRINTER"><td data-location-ready="true">Previously checked location</td></tr></tbody></table></section>';});
 await page.evaluate(()=>openGodownMapping('CITY PRINTER'));
 await page.locator('select[name="location"]').selectOption(id(10));await page.locator('textarea').fill('Warehouse checked in fixture');
 await page.getByRole('button',{name:'Save mapping only'}).click();await page.getByText('Not confirmed saved: Simulated lost response after commit').waitFor();
 assert.equal(await page.locator('[data-location-ready]').getAttribute('data-location-ready'),'false');
 assert.equal(await page.locator('[data-location-ready]').textContent(),'Mapping save unconfirmed — do not import');
 assert.equal((await db.query('select count(*)::int n from godown_mapping_reviews')).rows[0].n,1);
 await page.getByRole('button',{name:'Save mapping only'}).click();await page.getByText('Mapping saved. Stock quantities unchanged.').waitFor();
 assert.equal(await page.locator('[data-location-ready]').getAttribute('data-location-ready'),'true');
 assert.equal((await db.query('select count(*)::int n from godown_mapping_reviews')).rows[0].n,1);
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});
 await page.evaluate(()=>openGodownMapping('CITY PRINTER'));
 assert.equal(await page.locator('select').inputValue(),id(10));await page.getByText('CITY PRINTER · version 1').waitFor();
 await page.locator('[data-mapping-history]').getByText('Warehouse checked in fixture',{exact:false}).waitFor({timeout:3000});
 assert.ok((await page.locator('[data-mapping-history]').textContent()).includes('City Printer'));
 await page.locator('select').selectOption('');await page.locator('textarea').fill('Mapping needs physical confirmation');await page.getByRole('button',{name:'Save mapping only'}).click();await page.getByText('Mapping saved. Stock quantities unchanged.').waitFor();
 const history=(await db.query('select version,location_id from godown_mapping_reviews order by version')).rows;
 assert.equal(history.length,2);assert.equal(history[1].version,2);assert.equal(history[1].location_id,null);
 assert.equal(await page.locator('[data-location-ready]').getAttribute('data-location-ready'),'false');
 assert.equal(await page.locator('[data-location-ready]').textContent(),'Unresolved — do not import');
 assert.equal((await db.query('select quantity from tally_stock_sources')).rows[0].quantity,'-4');
 assert.equal((await db.query('select count(*)::int n from inventory_lots')).rows[0].n,0);
 console.log('PASS: actual browser → actual isolated SQL mapping, lost-response retry does not duplicate, reopen persists selection/version, unresolved revision persists, original negative/operational lots unchanged.');
}finally{if(browser)await browser.close();await db.close();}
