// Local Chromium UI checks; RPC transport is stubbed and cannot reach Supabase.
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent('<main id="content"></main>');
 await page.evaluate(()=>{
  window.me={user_id:'OWNER',role:'owner'};window.products=[{id:'M',name:'Fictional machine'},{id:'R',name:'Fictional reagent'}];window.organizations=[];window.orgIndex=new Map();
  window.productReviewLoadError='';window.rowById=(rows,id)=>rows.find(r=>r.id===id);window.reviewedCatalogProduct=p=>p;window.companyDate=()=> '2026-10-20';window.canEditRecords=()=>true;
  window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.$=s=>document.querySelector(s);window.message=()=>{};window.run=async fn=>{try{await fn()}catch(e){window.lastError=e.message}};
  window.lastError='';crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000001';window.calls=[];window.client={from:()=>({select:async()=>({data:[]})}),rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'SAVED'}}}};
 });
 for(const file of ['inventory-domain.js','inventory-operations.js','serial-numbers.js','receiving-serials.js'])await page.addScriptTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  inventoryPacks=[{id:'PM',product_id:'M',version:1,units_per_carton:2,base_unit:'unit'},{id:'PR',product_id:'R',version:1,units_per_carton:10,base_unit:'bottle'}];
  inventoryLocations=[{id:'H',name:'Fixture Haadi',code:'FH',active:true,is_dispatch_hub:true}];inventoryLots=[{id:'LM',product_id:'M',location_id:'H',pack_definition_id:'PM',stock_status:'available',sealed_cartons:0,loose_units:1,reserved_units:0,version:1}];
  inventoryClassifications=[{product_id:'M',version:1,category:'machines'}];inventoryLatestClassifications=inventoryLatestBy(inventoryClassifications);inventoryLatestPacks=inventoryLatestBy(inventoryPacks);
  inventoryWorkspace=async()=>{};document.querySelector('#content').innerHTML=inventoryStock();bindInventoryWorkspace();
 });
 await page.waitForSelector('[data-receiving-serials]',{state:'attached'});
 const form=page.locator('form[data-inventory-action="opening"]');await form.locator('..').evaluate(el=>el.open=true);
 await form.locator('[name="packId"]').selectOption('PM');await form.locator('[name="locationId"]').selectOption('H');await form.locator('[name="sealedCartons"]').fill('1');
 assert.equal(await form.locator('[data-receiving-serials]').isVisible(),true);assert.equal(await form.locator('[name="receivingSerials"]').getAttribute('required'),'');
 assert.match(await form.locator('[data-receiving-serial-count]').innerText(),/2 additional units/);
 await form.locator('[name="reason"]').fill('Fictional verified machine receipt');await form.locator('[name="receivingSerials"]').fill('FIX-1\nFIX-2');
 await form.locator('button[type="submit"]').click();await page.waitForFunction(()=>calls.length===1||lastError);
 assert.equal(await page.evaluate(()=>window.lastError||''),'');const saved=await page.evaluate(()=>calls[0]);assert.equal(saved.name,'receive_serialized_inventory');assert.deepEqual(saved.args.p_serials,['FIX-1','FIX-2']);
 assert.equal(await page.locator('form[data-inventory-action="issue"]').count(),0);assert.match(await page.locator('#content').innerText(),/Issue serial-tracked units through Deliveries/);
 await form.locator('[name="packId"]').selectOption('PR');assert.equal(await form.locator('[data-receiving-serials]').isVisible(),false);assert.equal(await form.locator('[name="receivingSerials"]').isDisabled(),true);
 console.log('PASS: Chromium inventory form reveals mandatory machine receiving serials, counts carton contents, submits the real serial payload, disables hidden fields for untracked stock, and directs serialized issues through Deliveries. All RPCs stubbed; no live database or network.');
}finally{await browser.close();}
