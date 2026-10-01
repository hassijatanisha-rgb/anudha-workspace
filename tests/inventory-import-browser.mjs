// Isolated Chrome, fictional inputs, no live API requests or credentials.
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const runtime=process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(runtime).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();
 page.setDefaultTimeout(5000);
 await page.route('**/*',route=>route.abort());
 await page.setContent('<main id="content"></main>');
 await page.evaluate(()=>{
  window.$=s=>document.querySelector(s);
  window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  window.me={role:'owner'};window.products=[];window.errors=[];window.rpcCalls=[];
  window.run=fn=>Promise.resolve().then(fn).catch(e=>errors.push(e.message));
  window.client={rpc:async(name,args)=>{rpcCalls.push({name,args});return {error:null};}};
  window.load=async()=>{};window.message=text=>{window.lastMessage=text;};
 });
 for(const file of ['inventory-import.js','inventory-operations.js'])await page.addScriptTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  inventoryStock=()=>inventoryImportPanel();
  $('#content').innerHTML=inventoryStock();bindInventoryWorkspace();
 });
 const product=company=>({id:company,name:'Fixture Reagent',source:{company,specification:'500 ml'}});
 const file=(name,products)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify({metadata:{kind:'inventory-product-list',quantities_supplied:false},products}))});
 await page.locator('summary').click();
 await page.locator('#inventoryProductImport').setInputFiles(file('valid.json',[product('A')]));
 await page.waitForFunction(()=>document.querySelector('#inventoryImportCommit'));
 // Rendering reconstructs the details element; reopen it for the next selection.
 await page.locator('summary').click();
 await page.locator('#inventoryProductImport').setInputFiles(file('conflict.json',[product('A'),product('B')]));
 await page.waitForFunction(()=>document.querySelector('#inventoryImportStatus').textContent.includes('identity needs review'));
 assert.equal(await page.locator('#inventoryImportCommit').isDisabled(),true);
 assert.equal(await page.evaluate(()=>inventoryImportPreview),null);
 assert.equal(await page.evaluate(()=>rpcCalls.length),0);
 await page.locator('#inventoryProductImport').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')});
 await page.waitForFunction(()=>errors.length===2);
 assert.equal(await page.locator('#inventoryImportCommit').isDisabled(),true);
 await page.locator('#inventoryProductImport').setInputFiles(file('corrected.json',[product('C')]));
 await page.waitForFunction(()=>inventoryImportFileName==='corrected.json');
 await page.locator('summary').click();
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#inventoryImportCommit').click();
 await page.waitForFunction(()=>rpcCalls.length===1&&window.lastMessage);
 const calls=await page.evaluate(()=>rpcCalls);
 assert.equal(calls[0].name,'import_records');
 assert.equal(calls[0].args.p_products[0].source.company,'C');
 assert.equal(calls[0].args.p_products.length,1);
 console.log('PASS: real file selection rejects conflicts and malformed JSON, disables stale commit, and submits only corrected fixture. No live writes.');
}finally{await browser.close();}
