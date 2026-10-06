// Actual form and callbacks, fictional RPCs only; external traffic blocked.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const scenario of ['retry','replace-success','replace-error']){
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url()==='https://erp-fixture.test/'?route.fulfill({contentType:'text/html',body:'<main id="content"></main>'}):route.abort());
  await page.goto('https://erp-fixture.test/');
  await page.addScriptTag({content:`
   let me={user_id:'first',role:'staff'},view='pending',salesLoaded=true,salesProformas=[],calls=[],messages=[],caught=[];
   const $=s=>document.querySelector(s),orgIndex=new Map(),products=[];
   const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
   function syncWorkspaceNavigation(){} function all(){return Promise.resolve([])}
   function salesOrganizationOptions(){return '<option value="org">Fixture Hospital</option>'}
   function salesProductChoices(){return '<option value="Fixture Product">'}
   function leadEmployeeOptions(){return '<option value="first">Fixture Employee</option>'}
   function salesContactOptions(){return ''} function employeeName(){return 'Fixture Employee'}
   function inventoryProductFromChoice(value){return value==='Fixture Product'?{id:'product'}:null}
   function message(value){messages.push(value)}
   function run(fn){window.action=fn().catch(error=>caught.push(error.message));return window.action}
   const client={rpc:(name,payload)=>{calls.push({name,payload});return new Promise((resolve,reject)=>{window.reply=resolve;window.fail=reject})}};
  `});
  await page.addScriptTag({content:readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8')});
  await page.evaluate(()=>pendingStockWorkspace());
  await page.locator('#newPending').click();
  await page.getByRole('button',{name:'Save pending order',exact:true}).click();
  assert.equal(await page.evaluate(()=>calls.length),0,'required fields prevent RPC');
  await page.locator('[name="organizationId"]').selectOption('org');
  await page.locator('[name="productChoice"]').fill('Fixture Product');
  await page.locator('[name="quantity"]').fill('2');
  await page.getByRole('button',{name:'Save pending order',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Save pending order',exact:true}).isDisabled(),true);
  await page.evaluate(()=>document.querySelector('#pendingForm').dispatchEvent(new Event('submit',{cancelable:true})));
  assert.equal(await page.evaluate(()=>calls.length),1,'double submit blocked');
  if(scenario==='retry'){
   await page.evaluate(async()=>{fail(Error('Fixture connection lost'));await window.action});
   assert.equal(await page.locator('#pendingFormError').innerText(),'Fixture connection lost');
   assert.equal(await page.getByRole('button',{name:'Save pending order',exact:true}).isEnabled(),true);
   await page.getByRole('button',{name:'Save pending order',exact:true}).click();
   const recorded=await page.evaluate(()=>calls);
   assert.deepEqual(recorded[1],recorded[0],'same form retains exact retry payload');
   await page.evaluate(async()=>{reply({data:{id:calls[1].payload.p_id,request_number:'PS-fixture',expires_on:'2027-04-06'}});await window.action});
   assert.equal(await page.locator('#pendingForm').count(),0);
   assert.equal(await page.evaluate(()=>messages.length),1);
  }else{
   await page.locator('#closePendingForm').click();await page.locator('#newPending').click();
   await page.locator('[name="notes"]').fill('Replacement draft');
   await page.evaluate(async scenario=>{if(scenario==='replace-error')fail(Error('Old error'));else reply({data:{id:calls[0].payload.p_id,request_number:'PS-old'}});await window.action},scenario);
   assert.equal(await page.locator('[name="notes"]').inputValue(),'Replacement draft');
   assert.equal(await page.locator('#pendingFormError').innerText(),'');
   assert.equal(await page.evaluate(()=>messages.length),0);
   assert.equal(await page.evaluate(()=>caught.length),0);
  }
  assert.deepEqual(errors,[]);console.log('PASS pending create browser: '+scenario);await page.close();
 }
}finally{await browser.close()}
