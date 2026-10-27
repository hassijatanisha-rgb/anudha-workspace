import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage({viewport:{width:390,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
 await page.setContent('<main><h1>Delivery serials</h1><article data-document-card="N1"><h2>Planned installation</h2><div class="actions"></div><div data-returns-panel="N1"></div></article><article data-document-card="N2"><h2>Later consumable order</h2><div class="actions"></div></article></main><dialog id="editor"></dialog>');
 for(const file of ['style.css','ui-polish.css'])await page.addStyleTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  window.me={user_id:'packer'};window.salesEpoch=0;window.esc=value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');window.message=()=>{};
  window.salesDeliveryNotes=[{id:'N1',status:'packing',delivery_number:'DN-1',version:3},{id:'N2',status:'packing',delivery_number:'DN-2',version:1}];
  window.deliveryLines=id=>[{id:id==='N1'?'L1':'L2',product_id:'P',quantity:1}];window.inventoryClassification=()=>({category:'consumables'});window.salesProduct=()=>({name:'Analyzer <reviewed>'});
  window.recorded=[];window.calls=[];window.customerReturnLines=[];
  window.client={from:table=>({select:()=>{if(table==='product_serial_settings')return Promise.resolve({data:[{product_id:'P',serial_required:false}]});const query={in:()=>query,order:()=>query,range:async(start,end)=>({data:recorded.slice(start,end+1)})};return query;}}),rpc:async(name,args)=>{
   calls.push({name,args});if(name==='planned_delivery_serial_lines')return {data:[{delivery_line_id:'L1'}]};
   if(name==='record_delivery_serials'){recorded=[{id:'SERIAL',delivery_line_id:'L1',delivery_note_id:'N1',serial_number:args.p_lines[0].serials[0],inventory_serial_id:'RECEIPT'}];return {data:recorded};}
   if(name==='mark_serials_returned'){recorded[0].returned_at='2026-10-27';recorded[0].return_line_id='RETURN';return {data:recorded};}throw Error(name);
  }};
  window.actionForm=(_title,html,submit)=>{const dialog=document.querySelector('#editor');dialog.innerHTML='<form>'+html+'<button>Save</button></form>';dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();await submit(Object.fromEntries(new FormData(event.target)));};dialog.showModal();};
  window.salesDeliveryWorkspace=async()=>{document.querySelector('#editor').close();document.querySelectorAll('[data-serial-panel],[data-serial-return]').forEach(node=>node.remove());await decorateDeliverySerials();};
 });
 await page.addScriptTag({content:readFileSync(new URL('../sales-delivery.js',import.meta.url),'utf8').match(/async function salesRowsFor\([\s\S]*?\n}\n/)[0]});
 await page.addScriptTag({content:readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8')});await page.evaluate(()=>decorateDeliverySerials());
 assert.equal(await page.locator('[data-serial-record=N1]').count(),1);assert.equal(await page.locator('[data-serial-panel=N2]').count(),0);
 await page.locator('[data-serial-record=N1]').click();assert.equal(await page.locator('[name=serials_L1]').count(),1);assert.equal(await page.locator('[name=serials_L2]').count(),0);
 await page.locator('[name=serials_L1]').fill('ACTUAL-UNIT-1');await page.locator('#editor button').click();await page.waitForFunction(()=>document.querySelector('[data-serial-panel=N1]')?.textContent.includes('ACTUAL-UNIT-1'));
 const capture=await page.evaluate(()=>calls.find(call=>call.name==='record_delivery_serials'));assert.equal(capture.args.p_expected_version,3);assert.deepEqual(capture.args.p_lines,[{deliveryLineId:'L1',serials:['ACTUAL-UNIT-1'],legacyConfirmed:false}]);
 assert.match(await page.locator('[data-serial-panel=N1]').innerText(),/Analyzer <reviewed>/);assert.equal(await page.locator('[data-serial-panel=N1] reviewed').count(),0);
 if(process.env.SERIAL_SCREENSHOT)await page.screenshot({path:process.env.SERIAL_SCREENSHOT});
 console.log('PASS: corrected-category planned line remains visible/editable, captures exact serial payload, and leaves the unrelated line alone');
 await page.evaluate(async()=>{salesDeliveryNotes[0].status='delivered';customerReturnLines=[{id:'RETURN',product_id:'P',delivery_line_id:'L1',quantity:1}];await salesDeliveryWorkspace();});
 assert.equal(await page.locator('[data-serial-record=N1]').count(),0);await page.locator('[data-serial-return=RETURN]').click();await page.locator('[name=sn_SERIAL]').check();await page.locator('#editor button').click();
 await page.waitForFunction(()=>window.calls.some(call=>call.name==='mark_serials_returned'));const returned=await page.evaluate(()=>calls.find(call=>call.name==='mark_serials_returned'));assert.deepEqual(returned.args,{p_return_line_id:'RETURN',p_serials:['ACTUAL-UNIT-1']});
 assert.deepEqual(errors,[]);console.log('PASS: delivered serials remain read-only and their return action survives corrected category/setting');
}finally{await browser.close();}
