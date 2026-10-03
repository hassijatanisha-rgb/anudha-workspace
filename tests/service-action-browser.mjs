// Actual shared dialog + service action callback, fictional RPC only.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,timeout:45000});
try{
 for(const mode of ['success','account-change','navigation','error']){
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());
  await page.setContent('<main id="content">Service fixture</main><p id="notice"></p>');
  await page.addScriptTag({content:`
   let me={user_id:'first'},view='service',resolveRpc,rpcCount=0;
   const esc=String,inventoryProduct=()=>({name:'Fictional machine'}),serviceStatusLabel=String;
   const client={rpc(){rpcCount++;return new Promise(resolve=>resolveRpc=resolve);}};
   function message(text){document.querySelector('#notice').textContent=text;}
  `});
  const forms=readFileSync(new URL('../action-forms.js',import.meta.url),'utf8');
  await page.addScriptTag({content:forms.slice(0,forms.indexOf('function openOrganizationForm('))});
  await page.addScriptTag({content:readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{serviceWorkspace=async()=>{};openServiceAction({id:'fixture',version:1,case_number:'Fixture'},'start');});
  await page.getByLabel('Progress note').fill('Fictional service update');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>rpcCount===1);
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
   assert.equal(await page.locator('#notice').innerText(),mode==='success'?'Service job updated: on_site.':'');
   if(mode==='account-change')assert.equal(await page.locator('#content').innerText(),'Second account');
   if(mode==='navigation')assert.equal(await page.locator('#content').innerText(),'Clients');
  }
  await page.close();
 }
 console.log('PASS: isolated Chrome shared dialog retains current errors and suppresses stale action results across account/navigation changes. No live auth/database.');
}finally{await browser.close();}
