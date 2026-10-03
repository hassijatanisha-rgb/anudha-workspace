// Isolated actual clear/actionForm lifecycle; no network, credentials or database.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,timeout:45000});
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());
 await page.setContent('<nav id="nav"></nav><span id="identity"></span><div id="fields"></div>');
 await page.addScriptTag({content:`let me={user_id:'first'},organizations=[],contacts=[],products=[],duplicates=new Map();const $=s=>document.querySelector(s);function clearEmployeeNames(){}`});
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const clear=app.split('\n').find(line=>line.startsWith('function clear(){'));assert.ok(clear);
 await page.addScriptTag({content:clear});
 const forms=readFileSync(new URL('../action-forms.js',import.meta.url),'utf8');
 await page.addScriptTag({content:forms.slice(0,forms.indexOf('function openOrganizationForm('))});
 await page.evaluate(()=>{
  window.pendingSave=new Promise(resolve=>{window.finishOldSave=resolve});
  actionForm('First fixture','<input name="example" value="Fictional draft">',()=>window.pendingSave);
 });
 await page.locator('#actionEditor button[type="submit"]').click();
 assert.equal(await page.evaluate(()=>actionSaving),true);
 await page.evaluate(()=>clear());
 assert.equal(await page.locator('#actionEditor').count(),0,'old dialog removed');
 const state=await page.evaluate(()=>{
  me={user_id:'second'};
  actionForm('Second fixture','<input name="example">',async()=>{});
  return {connected:actionDialog.isConnected,open:actionDialog.open,saving:actionSaving};
 });
 assert.deepEqual(state,{connected:true,open:true,saving:false},'old pending save must not block new-account forms');
 console.log('PASS: pending old save does not block new account form.');
}finally{await browser.close();}
