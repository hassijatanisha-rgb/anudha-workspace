// Offline browser regression. Every network request is blocked; no live records.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();
 await page.route('**/*',route=>route.abort());
 await page.setContent('<main id="content"></main>');
 await page.evaluate(()=>{
  window.$=s=>document.querySelector(s);window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  window.me={role:'staff'};window.products=[{id:'maker-a',name:'Albumin',sku:'A',source:{company:'Maker A'}},{id:'maker-b',name:'Albumin',sku:'B',source:{company:'Maker B'}}];
  window.catalogProductIssues=()=>[];window.catalogLabel=()=> 'Reagents';window.catalogCategoryOf=()=> 'reagents';
  window.run=fn=>fn();window.inventoryAvailableTotals=lots=>({cartons:0,loose:lots.reduce((sum,x)=>sum+x.loose_units,0)});
 });
 for(const file of ['search-state.js','product-review-ui.js','inventory-operations.js','product-workbench.js'])await page.addScriptTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  productDetailReviews.set('maker-a',{name:'Reviewed Albumin',company:'Corrected Maker A',specification:'200 ml'});
  inventoryLocation=()=>({name:'Godown A',code:'G-A'});
  inventoryHeader=()=>'';inventorySetupProgress=()=>'';
  inventoryLotCard=lot=>`<article data-lot="${lot.id}">${esc(inventoryProduct(lot.product_id).source.company)} ${lot.loose_units}</article>`;
  inventoryMovementCard=row=>`<p>${row.id}</p>`;inventoryIssueCard=row=>`<p>${row.id}</p>`;
  inventoryLots=[{id:'lot-a',product_id:'maker-a',stock_status:'available',loose_units:10},{id:'lot-b',product_id:'maker-b',stock_status:'available',loose_units:25}];
  inventoryWorkspace=()=>{$('#content').innerHTML=inventoryStock();bindInventoryWorkspace()};
  $('#content').innerHTML=productWorkbenchTable(products);bindProductWorkbench();
 });
 await page.locator('[data-workbench-stock="maker-a"]').click();
 assert.equal(await page.locator('[data-lot="lot-a"]').count(),1);
 assert.equal(await page.locator('[data-lot="lot-b"]').count(),0);
 assert.match(await page.locator('.inventory-metrics').innerText(),/10/);
 assert.match(await page.locator('#content').innerText(),/Selected product: Reviewed Albumin/);
 await page.locator('#inventorySearch').pressSequentially('Albumin');
 assert.equal(await page.locator('#inventorySearch').inputValue(),'Albumin');
 assert.equal(await page.locator('[data-lot="lot-b"]').count(),0);
 await page.locator('#inventorySearch').fill('corrected maker a');
 assert.equal(await page.locator('[data-lot="lot-a"]').count(),1);
 await page.locator('#inventorySearch').fill('200 ml');
 assert.equal(await page.locator('[data-lot="lot-a"]').count(),1);
 await page.locator('#clearStockProduct').click();
 assert.equal(await page.locator('[data-lot="lot-b"]').count(),1);
 assert.equal(await page.locator('#inventorySearch').inputValue(),'');
 assert.equal(await page.locator('#clearStockProduct').count(),0);
 console.log('PASS: actual stock button, UUID isolation, typing and show-all reset in offline Chrome.');
}finally{await browser.close()}
