// Isolated fictional reads; no live credentials, records or external network.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const scenario of ['current','navigation','session','refresh-error','owner-error','owner-stale-success','owner-stale-error']){
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
  await page.setContent('<button id="leave">Clients</button><button id="logout">Change account</button><main id="content"></main>');
  await page.addScriptTag({content:`
   let me={user_id:'first',role:'staff'},view='pending',salesLoaded=true,salesProformas=[],queries=[],rpcCalls=[];
   const client={rpc:async(name,payload)=>{rpcCalls.push({name,payload});return {error:{message:'Fixture permission denied'}}}};
   const $=s=>document.querySelector(s),orgIndex=new Map([['org',{name:'Fictional Hospital'}]]),products=[{id:'product',name:'Fictional Blood Bag'}];
   const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
   function employeeName(){return 'Fixture Employee'}function syncWorkspaceNavigation(){}function run(fn){return fn()}
   function all(table){return table==='pending_stock_requests'?new Promise((resolve,reject)=>queries.push({resolve,reject})):Promise.resolve([])}
   $('#leave').onclick=()=>{view='clients';$('#content').textContent='Clients fixture'};
   $('#logout').onclick=()=>{clearPendingStock();me={user_id:'second',role:'staff'};view='clients';$('#content').textContent='Second account fixture'};
   const fixture=[{id:'request',version:1,request_number:'PS-fixture',product_id:'product',organization_id:'org',salesperson_user_id:'first',quantity:2,status:'waiting',expires_on:'2099-01-01',extension_count:0}];
  `});
  await page.addScriptTag({content:readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8')});
  if(scenario.startsWith('owner-')){
   await page.addScriptTag({content:readFileSync(new URL('../action-forms.js',import.meta.url),'utf8')});
   await page.evaluate(()=>{me.role='owner'});
  }
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
   if(scenario.startsWith('owner-')){
    if(scenario.startsWith('owner-stale'))await page.evaluate(()=>{client.rpc=(name,payload)=>{rpcCalls.push({name,payload});return new Promise(resolve=>{window.finishAction=resolve})}});
    await page.locator('[data-pending-action="cancel"]').click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Save',exact:true}).click();
    assert.equal(await page.evaluate(()=>rpcCalls.length),0,'required reason prevents submit');
    await dialog.getByRole('textbox',{name:'Why is it cancelled?'}).fill('Client declined');
    await dialog.getByRole('button',{name:'Save',exact:true}).click();
    if(scenario.startsWith('owner-stale')){
     await page.waitForFunction(()=>!!window.finishAction);
     await page.evaluate(()=>{clearPendingStock();me={user_id:'second',role:'owner'};view='clients';$('#content').textContent='Second account fixture';document.querySelector('#actionEditor').close();document.querySelector('#actionEditor').remove();actionForm('New account form','<input aria-label="New note">',async()=>{});});
     await page.evaluate(error=>window.finishAction(error?{error:{message:'Old action error'}}:{data:{}}),scenario==='owner-stale-error');
     await page.waitForFunction(()=>!actionSaving);
     assert.equal(await page.locator('#content').innerText(),'Second account fixture');
     assert.equal(await page.getByRole('dialog').isVisible(),true);
     assert.equal(await page.locator('#actionError').innerText(),'');
     assert.equal(await page.locator('#actionTitle').innerText(),'New account form');
     assert.deepEqual(errors,[]);console.log('PASS pending browser: '+scenario);await page.close();continue;
    }
    await page.waitForFunction(()=>document.querySelector('#actionError').textContent==='Fixture permission denied');
    assert.equal(await dialog.isVisible(),true);
    assert.equal(await dialog.getByRole('button',{name:'Save',exact:true}).isEnabled(),true);
    assert.deepEqual(await page.evaluate(()=>rpcCalls),[{name:'advance_pending_stock_request',payload:{p_id:'request',p_expected_version:1,p_action:'cancel',p_note:'Client declined',p_extend_months:null}}]);
   }else{
    assert.equal(await page.getByRole('alert').count(),0);
    assert.equal(await page.locator('[data-pending-action="cancel"]').count(),0,'staff cannot see cancellation control');
   }
  }
  assert.deepEqual(errors,[]);console.log('PASS pending browser: '+scenario);await page.close();
 }
}finally{await browser.close()}
