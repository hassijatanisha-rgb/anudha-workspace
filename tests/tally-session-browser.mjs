// Isolated fictional source reads; no live data, credentials or network.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const mode of ['current','navigation','auth'])for(const outcome of ['success','error']){
  const page=await browser.newPage();await page.route('**/*',r=>r.abort());
  await page.setContent('<nav id="nav"></nav><div id="identity"></div><div id="fields"></div><main id="content"></main>');
  await page.addScriptTag({content:`let me={user_id:'fixture',role:'staff'},view='inventory',products=[],organizations=[],contacts=[],duplicates=new Map(),productDetailReviews=new Map(),productReviewLoadError='';const $=s=>document.querySelector(s);const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');function clearEmployeeNames(){};function productStockReview(){return {issues:['Needs verification']}};let finish;const delayed=new Promise((resolve,reject)=>{finish=ok=>ok?resolve([{id:'fixture-source',product_name:'Fictional reagent',godown:'Fixture godown',quantity:-1,unit:'PCS'}]):reject(Error('Fixture read failure'))});async function all(table){return table==='tally_stock_sources'?delayed:[]}`});
  for(const file of ['inventory-operations.js','tally-stock-review.js','search-state.js'])await page.addScriptTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
  await page.addScriptTag({content:readFileSync(new URL('../app.js',import.meta.url),'utf8').split('\n').find(l=>l.startsWith('function clear(){'))});
  await page.evaluate(()=>{inventorySection='review';bindInventoryWorkspace=()=>{};window.loading=tallyStockScreen()});
  await page.evaluate(({mode,outcome})=>{
   if(mode==='navigation'){view='clients';$('#content').textContent='Clients';}
   if(mode==='auth'){const actor=me;clear();me=actor;inventorySection='review';$('#content').textContent='New session';}
   finish(outcome==='success');
  },{mode,outcome});
  await page.evaluate(()=>window.loading);
  const text=await page.locator('#content').innerText();
  if(mode==='current'&&outcome==='success'){
   assert.match(text,/Fictional reagent/);assert.match(text,/Negative/);
   await page.locator('#tallySearch').pressSequentially('absent');
   assert.match(await page.locator('#tallyScope').innerText(),/0 matching rows/);
  }else if(mode==='current')assert.match(text,/Fixture read failure/);
  else assert.equal(text,mode==='auth'?'New session':'Clients');
  if(mode==='auth')assert.equal(await page.evaluate(()=>tallyRows.length+tallyCorrections.size),0);
  await page.close();console.log('PASS: source review '+mode+' '+outcome);
 }
}finally{await browser.close()}
