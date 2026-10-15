// Isolated fictional reads; no live credentials, records or external network.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const scenario of ['current','navigation','session','refresh-error']){
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
  await page.setContent('<button id="leave">Clients</button><button id="logout">Change account</button><main id="content"></main>');
  await page.addScriptTag({content:`
   let me={user_id:'first',role:'staff'},view='pending',salesLoaded=true,salesProformas=[],queries=[];
   const $=s=>document.querySelector(s),orgIndex=new Map([['org',{name:'Fictional Hospital'}]]),products=[{id:'product',name:'Fictional Blood Bag'}];
   const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
   function employeeName(){return 'Fixture Employee'}function syncWorkspaceNavigation(){}function run(fn){return fn()}
   function all(table){return table==='pending_stock_requests'?new Promise((resolve,reject)=>queries.push({resolve,reject})):Promise.resolve([])}
   $('#leave').onclick=()=>{view='clients';$('#content').textContent='Clients fixture'};
   $('#logout').onclick=()=>{clearPendingStock();me={user_id:'second',role:'staff'};view='clients';$('#content').textContent='Second account fixture'};
   const fixture=[{id:'request',request_number:'PS-fixture',product_id:'product',organization_id:'org',salesperson_user_id:'first',quantity:2,status:'waiting',expires_on:'2099-01-01',extension_count:0}];
  `});
  await page.addScriptTag({content:readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{window.oldLoad=pendingStockWorkspace(true)});
  await page.waitForFunction(()=>queries.length===1);
  if(scenario==='navigation')await page.getByRole('button',{name:'Clients',exact:true}).click();
  if(scenario==='session')await page.getByRole('button',{name:'Change account',exact:true}).click();
  if(scenario==='refresh-error'){
   await page.evaluate(()=>{window.newLoad=pendingStockWorkspace(true)});
   await page.waitForFunction(()=>queries.length===2);
   await page.evaluate(async()=>{queries[1].resolve(fixture);await window.newLoad;queries[0].reject(Error('Old failure'));await window.oldLoad});
  }else await page.evaluate(async()=>{queries[0].resolve(fixture);await window.oldLoad});
  if(scenario==='navigation')assert.equal(await page.locator('#content').innerText(),'Clients fixture');
  else if(scenario==='session'){
   assert.equal(await page.locator('#content').innerText(),'Second account fixture');
   assert.equal(await page.evaluate(()=>pendingRows.length),0);
  }else{
   await page.getByRole('heading',{name:'Pending stock orders',exact:true}).waitFor();
   await page.getByRole('heading',{name:'Fictional Blood Bag · 2 pcs',exact:true}).waitFor();
   assert.equal(await page.getByRole('alert').count(),0);
  }
  assert.deepEqual(errors,[]);console.log('PASS pending browser: '+scenario);await page.close();
 }
}finally{await browser.close()}
