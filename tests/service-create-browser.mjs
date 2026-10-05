import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,timeout:45000});
try{
 for(const mode of ['success','account-change','navigation','error']){
  const page=await browser.newPage();await page.route('**/*',route=>route.request().url()==='https://erp-fixture.test/'?route.fulfill({contentType:'text/html',body:'<main id="content"></main><p id="notice"></p>'}):route.abort());
  // Locally fulfilled HTTPS document supplies the same secure context as production.
  await page.goto('https://erp-fixture.test/');
  await page.addScriptTag({content:`
   let me={user_id:'first'},view='service',resolveRpc,rpcCount=0,lastPayload,busy=false;
   const $=s=>document.querySelector(s),esc=String,orgIndex=new Map();
   const contacts=[{id:'same',organization_id:'client-a',status:'active'},{id:'other',organization_id:'client-b',status:'active'}];
   const inventoryProduct=()=>({name:'Fictional machine'}),salesContactName=id=>id;
   const inventoryOption=(id,label)=>'<option value="'+id+'">'+label+'</option>';
   const client={rpc(name,payload){rpcCount++;lastPayload={name,payload};return new Promise(resolve=>resolveRpc=resolve);}};
   function message(text){$('#notice').textContent=text;}
  `});
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  await page.addScriptTag({content:app.slice(app.indexOf('function friendlyError('),app.indexOf("$('#editForm').onsubmit"))});
  await page.addScriptTag({content:readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{
   serviceHeader=()=>'';serviceMetrics=()=>'';serviceWorkspace=async()=>{};
   serviceAssets=[{id:'asset',organization_id:'client-a',status:'active',serial_number:'Fixture'}];
   $('#content').innerHTML=serviceScheduleScreen();bindServiceWorkflow();
  });
  await page.getByText('Record an unscheduled repair or service request',{exact:true}).click();
  assert.equal(await page.locator('[name="contactId"]').isDisabled(),true);
  await page.locator('[name="assetId"]').selectOption('asset');
  assert.equal(await page.locator('[name="contactId"]').isDisabled(),false);
  assert.deepEqual(await page.locator('[name="contactId"] option').evaluateAll(nodes=>nodes.map(n=>n.value)),['','same']);
  await page.locator('[name="contactId"]').selectOption('same');
  await page.locator('[name="problem"]').fill('Fixture repair request');
  await page.getByRole('button',{name:'Create service job',exact:true}).click();
  try{await page.waitForFunction(()=>rpcCount===1,{},{timeout:5000});}
  catch(error){throw Error('Fixture submit failed: '+await page.locator('#notice').innerText(),{cause:error});}
  const sent=await page.evaluate(()=>lastPayload);
  assert.equal(sent.name,'create_service_case');assert.equal(sent.payload.p_contact_id,'same');assert.equal(sent.payload.p_asset_id,'asset');
  assert.match(sent.payload.p_id,/^[0-9a-f-]{36}$/);
  await page.evaluate(mode=>{
   if(mode==='account-change'){clearServiceWorkflow();me={user_id:'second'};view='clients';$('#content').textContent='Second account';}
   if(mode==='navigation'){view='clients';$('#content').textContent='Clients';}
   resolveRpc({data:{id:'fictional'},error:mode==='error'?{message:'Fixture denied'}:null});
  },mode);
  await page.waitForFunction(()=>!busy);
  assert.equal(await page.locator('#notice').innerText(),mode==='success'?'Service job created. Assign it to an engineer next.':mode==='error'?'Fixture denied':'');
  if(mode==='account-change')assert.equal(await page.locator('#content').innerText(),'Second account');
  if(mode==='navigation')assert.equal(await page.locator('#content').innerText(),'Clients');
  await page.close();
 }
 console.log('PASS: four isolated new-service form cases; client contact selection, payload and session/navigation outcomes verified. No live database.');
}finally{await browser.close();}
