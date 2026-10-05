// Actual clear() and shared action form; all identities/fields fictional.
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
 await page.evaluate(()=>actionForm('First fixture','<input name="example" value="Fictional private draft">',async()=>{}));
 assert.equal(await page.locator('#actionEditor').evaluate(el=>el.open),true);
 await page.evaluate(()=>clear());
 assert.equal(await page.locator('#actionEditor').count(),0,'old dialog removed from visible DOM');
 const result=await page.evaluate(()=>{
  me={user_id:'second'};
  try{actionForm('Second fixture','<input name="example">',async()=>{});return {opened:actionDialog.open,connected:actionDialog.isConnected};}
  catch(error){return {error:error.name,message:error.message};}
 });
 assert.deepEqual(result,{opened:true,connected:true},'new account must be able to open the shared form after clear');
 console.log('PASS: shared action form reopens after actual clear.');
}finally{await browser.close();}
