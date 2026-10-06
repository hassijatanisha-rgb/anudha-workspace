// Fictional deferred reads only; no live session, RPC writes or external traffic.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const kind of ['refresh','search'])for(const scenario of ['current','replacement','clear-error','navigation',...(kind==='refresh'?['overlap-result','overlap-error']:[])]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());await page.setContent('<main id="content">Original</main>');
  await page.addScriptTag({content:`
   let me={user_id:'first',role:'staff'},view='purchasing',reads=[],products=[];
   const $=s=>document.querySelector(s),esc=s=>String(s??'');
   function syncWorkspaceNavigation(){} function run(fn){return fn()}
   function renderSearchPreservingPosition(box,render){render()}
   const query={select(){return this},eq(){return this},or(){return this},order(){return this},limit(){return this.maybeSingle()},maybeSingle(){return new Promise((resolve,reject)=>reads.push({resolve,reject}))}};
   const client={from:()=>query};
  `});
  await page.addScriptTag({content:readFileSync(new URL('../purchasing.js',import.meta.url),'utf8')});
  await page.evaluate(kind=>{purchaseLoaded=true;purchaseSearch='PO123';window.pending=kind==='refresh'?purchaseRefreshOne('po'):purchaseSearchOlder('PO123')},kind);
  assert.equal(await page.evaluate(()=>reads.length),1);
  await page.evaluate(scenario=>{
   if(scenario==='replacement')me={user_id:'first',role:'staff'};
   if(scenario==='clear-error')clearPurchasing();
   if(scenario==='navigation')view='clients';
   if(scenario!=='current'&&!scenario.startsWith('overlap'))$('#content').textContent='New screen';
  },scenario);
  await page.evaluate(async({kind,scenario})=>{
   const order={id:'po',status:'cancelled',po_number:'PO123',purchase_order_lines:[{id:'line',purchase_order_id:'po'}]};
   if(scenario.startsWith('overlap')){
    const newer=purchaseRefreshOne('po');
    reads[1].resolve({data:{...order,version:2,purchase_order_lines:[{id:'new-line',purchase_order_id:'po'}]}});
    await newer;
    if(scenario==='overlap-error')reads[0].reject(Error('Superseded failure'));
    else reads[0].resolve({data:{...order,version:1}});
    await window.pending;return;
   }
   if(scenario==='clear-error')reads[0].reject(Error('Obsolete transport failure'));
   else reads[0].resolve({data:kind==='refresh'?order:[order]});
   await window.pending;
  },{kind,scenario});
  if(scenario==='current'||scenario.startsWith('overlap')){
   await page.getByRole('heading',{name:'Purchasing',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>purchaseLines.length),1);
   if(scenario.startsWith('overlap')){
    assert.equal(await page.evaluate(()=>purchaseOrders[0].version),2);
    assert.equal(await page.evaluate(()=>purchaseLines[0].id),'new-line');
    assert.equal(await page.evaluate(()=>purchaseRefreshRequests.size),0);
   }
  }else{
   assert.equal(await page.locator('#content').innerText(),'New screen');
   if(scenario!=='navigation')assert.equal(await page.evaluate(()=>purchaseOrders.length),0);
  }
  assert.deepEqual(errors,[]);console.log(`PASS purchasing ${kind}: ${scenario}`);await page.close();
 }
}finally{await browser.close()}
