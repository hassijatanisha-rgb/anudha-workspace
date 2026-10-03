// Actual shared dialog + service action callback, fictional RPC only.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,timeout:45000});
try{
 for(const workflow of ['action','report'])for(const mode of ['success','account-change','navigation','error']){
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());
  await page.setContent('<main id="content">Service fixture</main><p id="notice"></p>');
  await page.addScriptTag({content:`
   let me={user_id:'first'},view='service',resolveRpc,rpcCount=0,lastPayload;
   const esc=String,inventoryProduct=()=>({name:'Fictional machine'}),serviceStatusLabel=String;
   const orgIndex=new Map(),contacts=[],employeeName=()=> 'Fixture Engineer';
   const inventoryOption=(id,label,selected)=> '<option value="'+id+'" '+(selected?'selected':'')+'>'+label+'</option>';
   const client={rpc(name,payload){rpcCount++;lastPayload={name,payload};return new Promise(resolve=>resolveRpc=resolve);}};
   function message(text){document.querySelector('#notice').textContent=text;}
  `});
  const forms=readFileSync(new URL('../action-forms.js',import.meta.url),'utf8');
  await page.addScriptTag({content:forms.slice(0,forms.indexOf('function openOrganizationForm('))});
  await page.addScriptTag({content:readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8')});
  await page.evaluate(workflow=>{
   serviceWorkspace=async()=>{};
   if(workflow==='report'){
    serviceTeam=[{user_id:'engineer',active:true}];
    openServiceReport({id:'fixture',version:1,case_number:'Fixture',case_type:'service',assigned_user_id:'engineer'});
   }else openServiceAction({id:'fixture',version:1,case_number:'Fixture'},'start');
  },workflow);
  if(workflow==='report'){
   await page.getByRole('button',{name:'Save',exact:true}).click();
   assert.equal(await page.evaluate(()=>rpcCount),0,'required fields block empty submission');
   for(const name of ['engineerName','model','serial','location','workCompleted','customerRepresentative','customerReference','anudhaRepresentative','anudhaReference']){
    await page.locator('[name="'+name+'"]').fill('Fixture '+name);
   }
  }else await page.getByLabel('Progress note').fill('Fictional service update');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>rpcCount===1);
  if(workflow==='report'){
   const sent=await page.evaluate(()=>lastPayload);
   assert.equal(sent.name,'complete_service_report');
   assert.equal(sent.payload.p_actual_engineer_id,'engineer');
   assert.equal(sent.payload.p_customer_signoff_reference,'Fixture customerReference');
   assert.equal(sent.payload.p_training_completed,false);
   assert.equal(sent.payload.p_service_charge_minor,0);
  }
  await page.evaluate(mode=>{
   if(mode==='account-change'){clearServiceWorkflow();me={user_id:'second'};view='clients';document.querySelector('#content').textContent='Second account';}
   if(mode==='navigation'){view='clients';document.querySelector('#content').textContent='Clients';}
   resolveRpc({data:{status:'on_site'},error:mode==='error'?{message:'Fixture denied'}:null});
  },mode);
  await page.waitForFunction(()=>actionSaving===false);
  if(mode==='error'){
   assert.equal(await page.locator('#actionError').innerText(),'Fixture denied');
   assert.equal(await page.locator('#actionEditor').evaluate(el=>el.open),true);
  }else{
   assert.equal(await page.locator('#actionEditor').evaluate(el=>el.open),false);
   const success=workflow==='report'?'Signed report saved. The next maintenance job is now on the service schedule.':'Service job updated: on_site.';
   assert.equal(await page.locator('#notice').innerText(),mode==='success'?success:'');
   if(mode==='account-change')assert.equal(await page.locator('#content').innerText(),'Second account');
   if(mode==='navigation')assert.equal(await page.locator('#content').innerText(),'Clients');
  }
  await page.close();
 }
 console.log('PASS: eight isolated Chrome action/report dialog cases; required report fields, selected payload fields, current errors and stale account/navigation outcomes verified. No live auth/database.');
}finally{await browser.close();}
