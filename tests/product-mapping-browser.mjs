import {readFileSync,existsSync} from 'node:fs';import assert from 'node:assert/strict';import {dirname,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent('<main></main>');
 await page.evaluate(()=>{window.me={role:'owner',user_id:'owner'};window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.run=fn=>fn();window.catalogRows=()=>[{id:'uuid-a',name:'Albumin',source:{company:'Maker A',specification:'200 ml',units:'bottle'}}];window.client={rpc(){throw Error('No writes allowed')}};});
 for(const file of ['product-identity.js','product-mapping-preview.js','product-mapping-ui.js']){const path=new URL('../'+file,import.meta.url);if(existsSync(path))await page.addScriptTag({content:readFileSync(path,'utf8')});}
 assert.equal(await page.evaluate(()=>typeof openProductMappingPreview),'function');await page.evaluate(()=>openProductMappingPreview());
 const original={name:'Old',manufacturer:'Maker A',model:'200 ml',units:'bottle',totalStock:-3,locations:'Godown A'},payload={schema:'anudha-product-mapping-v1',rows:[{sourceKey:'stable-key',original,corrected:{...original,name:'Albumin',price:900},editedLocally:true}]};
 await page.locator('input[type="file"]').setInputFiles({name:'mapping.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
 await page.locator('[data-mapping-results] table').waitFor();const result=await page.locator('[data-mapping-results]').innerText();
 assert.match(result,/stable-key/);assert.match(result,/uuid-a/);assert.match(result,/negative_stock/);assert.doesNotMatch(result,/900/);
 assert.match(await page.locator('dialog').innerText(),/not saved|not imported/i);
 await page.locator('input[type="file"]').setInputFiles({name:'wrong.json',mimeType:'application/json',buffer:Buffer.from('{}')});
 await page.waitForFunction(()=>document.querySelector('[data-mapping-status]').textContent.includes('format'));
 assert.equal(await page.locator('[data-mapping-results] table').count(),0);
 await page.evaluate(()=>{me={role:'staff',user_id:'staff'}});
 await page.locator('input[type="file"]').setInputFiles({name:'mapping.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
 await page.waitForFunction(()=>document.querySelector('[data-mapping-status]').textContent.includes('Login changed'));
 await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<nav id="nav"></nav><div id="identity"></div><dialog id="editor"></dialog><div id="fields"></div>');window.$=s=>document.querySelector(s);window.organizations=[];window.contacts=[];window.products=[];window.duplicates=new Map();});
 await page.addScriptTag({content:readFileSync(new URL('../app.js',import.meta.url),'utf8').split('\n').find(line=>line.startsWith('function clear()'))});
 await page.evaluate(()=>clear());assert.equal(await page.locator('dialog.product-review-editor').count(),0);
 console.log('PASS: mapping upload displays exact IDs and negatives without prices or writes, rejects wrong format/changed login and removes private dialogs on sign-out.');
}finally{await browser.close()}
