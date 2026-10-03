// Isolated actual clear/actionForm lifecycle; no network, credentials or database.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,timeout:45000});
try{
 for(const outcome of ['resolve','reject']){
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());
 await page.setContent('<nav id="nav"></nav><span id="identity"></span><div id="fields"></div>');
 await page.addScriptTag({content:`let me={user_id:'first'},organizations=[],contacts=[],products=[],duplicates=new Map();const $=s=>document.querySelector(s);function clearEmployeeNames(){}`});
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const clear=app.split('\n').find(line=>line.startsWith('function clear(){'));assert.ok(clear);
 await page.addScriptTag({content:clear});
 const forms=readFileSync(new URL('../action-forms.js',import.meta.url),'utf8');
 await page.addScriptTag({content:forms.slice(0,forms.indexOf('function openOrganizationForm('))});
 await page.evaluate(()=>{
  window.pendingSave=new Promise((resolve,reject)=>{window.finishOldSave=resolve;window.failOldSave=reject});
  actionForm('First fixture','<input name="example" value="Fictional draft">',()=>window.pendingSave);
 });
 await page.locator('#actionEditor button[type="submit"]').click();
 assert.equal(await page.evaluate(()=>actionSaving),true);
 await page.evaluate(()=>clear());
 assert.equal(await page.locator('#actionEditor').count(),0,'old dialog removed');
 const state=await page.evaluate(()=>{
  me={user_id:'second'};
  window.newSaves=0;
  window.newPending=new Promise(resolve=>{window.finishNewSave=resolve});
  actionForm('Second fixture','<input name="example">',async()=>{window.newSaves++;await window.newPending});
  return {connected:actionDialog.isConnected,open:actionDialog.open,saving:actionSaving};
 });
 assert.deepEqual(state,{connected:true,open:true,saving:false},'old pending save must not block new-account forms');
 assert.equal(await page.locator('[name="example"]').inputValue(),'','old fields cleared');
 await page.locator('#actionEditor button[type="submit"]').click();
 await page.waitForFunction(()=>window.newSaves===1);
 await page.evaluate(async outcome=>{
  if(outcome==='resolve')window.finishOldSave();else window.failOldSave(new Error('Old private error'));
  await window.pendingSave.catch(()=>{});
 },outcome);
 assert.equal(await page.locator('#actionEditor').evaluate(el=>el.open),true,'old completion must not close new form');
 assert.equal(await page.locator('#actionError').textContent(),'','old errors must not appear');
 assert.equal(await page.locator('#actionEditor button[type="submit"]').isDisabled(),true,'old finally must not reenable pending new save');
 assert.equal(await page.evaluate(()=>actionSaving),true,'new save remains pending');
 await page.evaluate(async()=>{window.finishNewSave();await window.newPending});
 await page.waitForFunction(()=>!actionDialog.open);
 assert.equal(await page.locator('#actionEditor').evaluate(el=>el.open),false,'new save closes its own form');
 await page.close();
 }
 console.log('PASS: pending old save does not block new account form.');
}finally{await browser.close();}
