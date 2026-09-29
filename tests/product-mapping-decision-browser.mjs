import {readFileSync,existsSync} from 'node:fs';import assert from 'node:assert/strict';import {dirname,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent('<main></main>');
 await page.evaluate(()=>{
  crypto.randomUUID=()=> '00000000-0000-0000-0000-000000000099';
  window.me={role:'owner',user_id:'owner'};window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  window.calls=[];window.saved=null;window.fail=false;window.notified=null;
  window.client={from:()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:window.saved?[window.saved]:[]})}),rpc:async(name,args)=>{calls.push({name,args});if(fail)return {error:{message:'Version changed'}};saved={source_key:args.p_source_key,version:args.p_expected_version+1,decision:args.p_decision,product_id:args.p_product_id};return {data:saved};}};
  window.row={sourceKey:'source-key',original:{name:'Original',totalStock:-2},corrected:{name:'Albumin',manufacturer:'Maker A',totalStock:-2},editedLocally:true,editedAt:123,match:{status:'exact',productIds:['product-1']},issues:['negative_stock']};
 });
 const file=new URL('../product-mapping-decision.js',import.meta.url);if(existsSync(file))await page.addScriptTag({content:readFileSync(file,'utf8')});
 assert.equal(await page.evaluate(()=>typeof openProductMappingDecision),'function');
 await page.evaluate(()=>openProductMappingDecision(row,r=>{notified=r}));
 assert.equal((await page.evaluate(()=>calls)).length,0);
 await page.locator('textarea').fill('Manufacturer label checked');await page.locator('button[type="submit"]').click();await page.locator('dialog').waitFor({state:'detached'});
 const call=(await page.evaluate(()=>calls))[0];assert.equal(call.name,'save_product_source_mapping_review');assert.equal(call.args.p_product_id,'product-1');assert.equal(call.args.p_expected_version,0);assert.equal(call.args.p_snapshot.corrected.totalStock,-2);assert.equal(await page.evaluate(()=>notified.version),1);
 await page.evaluate(()=>{fail=true;return openProductMappingDecision(row,()=>{})});await page.locator('textarea').fill('Second check');await page.locator('button[type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('[role="alert"]').textContent.includes('Version changed'));
 assert.equal(await page.locator('textarea').inputValue(),'Second check');
 const before=await page.evaluate(()=>calls.length);await page.evaluate(()=>{me={role:'staff',user_id:'staff'}});await page.locator('button[type="submit"]').click();assert.equal(await page.evaluate(()=>calls.length),before);
 assert.match(await page.locator('[role="alert"]').innerText(),/Login changed/);
 await page.locator('[data-cancel]').click();await page.locator('dialog').waitFor({state:'detached'});
 await page.evaluate(()=>{me={role:'owner',user_id:'owner'};window.previewCurrent=true;client.from=()=>({select(){return this},eq(){return this},order(){return this},limit:()=>new Promise(resolve=>{window.finishRead=resolve})});window.pendingOpen=openProductMappingDecision(row,()=>{},()=>previewCurrent);});
 await page.evaluate(async()=>{previewCurrent=false;finishRead({data:[]});await pendingOpen;});
 assert.equal(await page.locator('dialog').count(),0,'A closed or replaced preview must not reopen a stale save dialog');
 console.log('PASS: explicit mapping save sends snapshot/version, preserves rejected form and blocks changed account.');
}finally{await browser.close()}
