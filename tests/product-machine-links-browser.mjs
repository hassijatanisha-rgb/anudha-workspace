// Isolated fictional records; no live Supabase or external network calls.
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent('<main id="content"></main>');
 await page.evaluate(()=>{
  let sequence=0;crypto.randomUUID=()=>`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`;
  window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  window.me={role:'owner',user_id:'owner'};window.run=fn=>fn();window.message=()=>{};
  window.products=[{id:'r',name:'Reagent',source:{category:'reagents',machine_ids:['a']}},{id:'a',name:'Analyzer A',source:{category:'machines',company:'Maker A'}},{id:'b',name:'Analyzer B',source:{category:'machines',company:'Maker B'}}];
  window.catalogCategoryOf=p=>p.source.category;window.catalogRows=()=>products;window.catalogInventory=()=>{};
  window.review=null;window.calls=[];window.failSave=false;
  window.client={from:()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:window.review?[window.review]:[]})}),rpc:async(name,args)=>{
   window.calls.push({name,args});if(window.failSave)return {error:{message:'Stale version'}};
   window.review={product_id:args.p_product_id,machine_ids:args.p_machine_ids,version:args.p_expected_version+1};return {data:window.review};
  }};
 });
 const file=new URL('../product-machine-links.js',import.meta.url);
 if(existsSync(file))await page.addScriptTag({content:readFileSync(file,'utf8')});
 assert.equal(await page.evaluate(()=>typeof openProductMachineLinks),'function','Relationship editor must exist');
 await page.evaluate(()=>openProductMachineLinks('r'));
 assert.match(await page.locator('dialog [data-machine-search]').first().innerText(),/Stock code missing.*ID: a/);
 await page.locator('dialog input[type="search"]').fill('Analyzer B');
 await page.locator('dialog input[value="b"]').check();
 await page.locator('dialog textarea[name="reason"]').fill('Verified supplier compatibility');
 await page.locator('dialog button[type="submit"]').click();
 await page.locator('dialog').waitFor({state:'detached'});
 assert.equal(await page.locator('dialog').count(),0);
 let calls=await page.evaluate(()=>calls);assert.deepEqual(calls[0].args.p_machine_ids,['a','b']);assert.equal(calls[0].args.p_expected_version,0);
 assert.equal(await page.evaluate(()=>machineLinkReviewedProduct(products[0]).id),'r');
 await page.evaluate(()=>openProductMachineLinks('r'));
 await page.locator('dialog input[value="a"]').uncheck();await page.locator('dialog input[value="b"]').uncheck();
 await page.locator('dialog textarea[name="reason"]').fill('No compatible machines verified');
 await page.evaluate(()=>{failSave=true});await page.locator('dialog button[type="submit"]').click();
 assert.match(await page.locator('dialog [role="alert"]').innerText(),/Stale version/);
 assert.deepEqual(await page.evaluate(()=>machineLinkReviewedProduct(products[0]).source.machine_ids),['a','b']);
 await page.evaluate(()=>{failSave=false});await page.locator('dialog button[type="submit"]').click();
 await page.locator('dialog').waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>machineLinkReviewedProduct(products[0]).source.machine_ids),[]);
 await page.evaluate(()=>openProductMachineLinks('r'));await page.locator('dialog textarea[name="reason"]').fill('Account switched during editing');
 const before=await page.evaluate(()=>calls.length);await page.evaluate(()=>{me={role:'staff',user_id:'staff'}});
 await page.locator('dialog button[type="submit"]').click();assert.equal(await page.evaluate(()=>calls.length),before);
 assert.match(await page.locator('dialog [role="alert"]').innerText(),/Login changed/);
 console.log('PASS: machine editor search preserves selections, saves/clears same product links, retains state on error and blocks changed login.');
}finally{await browser.close()}
