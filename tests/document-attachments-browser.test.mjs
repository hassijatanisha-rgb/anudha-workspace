import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const enabled=process.env.ATTACHMENTS_BROWSER_QA==='1';
const source=readFileSync(new URL('../document-attachments.js',import.meta.url),'utf8');
const recordId='00000000-0000-0000-0000-000000000006';
const pdf={name:'Fictional-example.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n% Fictional attachment browser fixture\n%%EOF')};
let browser;
test.before(async()=>{
 if(!enabled)return;
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close()});
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set ATTACHMENTS_BROWSER_QA=1 with local Playwright and Chrome'},fn);
async function fixture(t){
 const page=await browser.newPage({acceptDownloads:true});t.after(()=>page.close());page.setDefaultTimeout(3000);
 await page.route('**/*',route=>route.abort());
 await page.setContent('<main id="content">Original page</main><p id="notice">Original notice</p>');
 await page.evaluate(()=>{
  window.me={user_id:'fixture-actor'};window.view='sales';window.allowed=true;
  window.esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let sequence=40;crypto.randomUUID=()=>`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`;
  window.calls=[];window.rows=[];window.objects=new Map();window.uploadReturned=false;
  window.client={rpc:async(name,args)=>{
   calls.push({kind:'rpc',name,args});
   if(name==='document_attachment_parent_access')return {data:allowed};
   if(window.finalizeFailures>0){window.finalizeFailures--;return {error:{message:'Fixture lost finalize response'}};}
   const row={id:args.p_id,record_type:args.p_record_type,record_id:args.p_record_id,object_path:args.p_object_path,original_filename:args.p_original_filename,mime_type:args.p_mime_type,byte_size:args.p_byte_size,uploaded_by:me.user_id,uploaded_at:'2026-09-25T12:00:00Z'};
   if(!rows.some(item=>item.id===row.id))rows.push(row);return {data:row};
  },from:table=>{
   const filters=[];const query={select(){return query},eq(key,value){filters.push([key,value]);return query},order(){return query},range(start,end){calls.push({kind:'list',table,start,end,filters});return Promise.resolve({data:rows.filter(row=>filters.every(([key,value])=>row[key]===value)).slice(start,end+1)})}};return query;
  },storage:{from:bucket=>({upload:async(path,file,options)=>{
   calls.push({kind:'upload',bucket,path,options});
   if(window.delayUpload)await new Promise(resolve=>window.releaseUpload=resolve);
   objects.set(path,file);window.uploadReturned=true;return {data:{path}};
  },download:async path=>{calls.push({kind:'download',bucket,path});return objects.has(path)?{data:objects.get(path)}:{error:{statusCode:'404',message:'Missing fixture object'}};}})}};
 });
 await page.addScriptTag({content:source});return page;
}
const open=(page,type='proforma')=>page.evaluate(({type,id})=>openDocumentAttachments(type,id,'Fictional record'),{type,id:recordId});
async function submit(page,file=pdf){await page.locator('[data-attachment-file]').setInputFiles(file);await page.locator('.document-attachments [type="submit"]').click();}
acceptance('PDF upload finalizes, persists on reopen, and downloads through a browser download event',async t=>{
 const page=await fixture(t);await open(page);await submit(page);
 await page.waitForFunction(()=>document.querySelector('[data-attachment-status]')?.textContent==='Attachment saved to this record.');
 assert.equal(await page.locator('[data-attachment-open]').count(),1);
 await page.locator('[data-attachment-close]').click();await page.waitForFunction(()=>!document.querySelector('.document-attachments'));await open(page);
 assert.equal(await page.locator('[data-attachment-open]').count(),1);
 const downloadEvent=page.waitForEvent('download');await page.locator('[data-attachment-open]').click();
 const download=await downloadEvent;assert.equal(download.suggestedFilename(),pdf.name);
 assert.equal(await download.failure(),null);
 const calls=await page.evaluate(()=>window.calls);
 assert.equal(calls.filter(call=>call.kind==='upload').length,1);
 assert.equal(calls.filter(call=>call.name==='finalize_document_attachment').length,1);
 assert.ok(calls.filter(call=>call.kind==='list').every(call=>call.start===0&&call.end===24));
});
acceptance('Mismatched PDF contents fail before any storage request',async t=>{
 const page=await fixture(t);await open(page);
 await submit(page,{name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('<html>Not a PDF</html>')});
 await page.waitForFunction(()=>document.querySelector('[data-attachment-status]')?.textContent.includes('file contents do not match'));
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.kind==='upload'||call.kind==='download'||call.name==='finalize_document_attachment').length),0);
});
acceptance('Denied accounting parent access performs no attachment list or storage queries',async t=>{
 const page=await fixture(t);await page.evaluate(()=>window.allowed=false);
 await assert.rejects(open(page,'accounting'),/do not have access/);
 assert.equal(await page.locator('.document-attachments').count(),0);
 assert.deepEqual(await page.evaluate(()=>calls.map(call=>call.kind)),['rpc']);
});
acceptance('Finalize retry retains the same request and path and uploads exactly once',async t=>{
 const page=await fixture(t);await open(page);await page.evaluate(()=>window.finalizeFailures=1);await submit(page);
 await page.waitForFunction(()=>document.querySelector('[type="submit"]')?.textContent==='Retry attachment');
 assert.equal(await page.locator('[data-attachment-file]').isDisabled(),true);
 await page.locator('.document-attachments [type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-attachment-status]')?.textContent==='Attachment saved to this record.');
 const calls=await page.evaluate(()=>window.calls);const finalizes=calls.filter(call=>call.name==='finalize_document_attachment');
 assert.equal(calls.filter(call=>call.kind==='upload').length,1);assert.equal(finalizes.length,2);assert.deepEqual(finalizes[0].args,finalizes[1].args);
});
for(const change of ['view','actor'])acceptance(`In-flight upload cannot finalize or leave its dialog visible after ${change} changes`,async t=>{
 const page=await fixture(t);await open(page);await page.evaluate(()=>window.delayUpload=true);await submit(page);
 await page.waitForFunction(()=>typeof releaseUpload==='function');
 await page.evaluate(change=>{if(change==='view')view='personal';else me={user_id:'replacement-actor'};document.querySelector('#content').textContent='Replacement page';document.querySelector('#notice').textContent='Replacement notice';releaseUpload()},change);
 await page.waitForFunction(()=>uploadReturned);
 await page.waitForFunction(()=>!document.querySelector('.document-attachments'));
 assert.equal(await page.locator('#content').innerText(),'Replacement page');assert.equal(await page.locator('#notice').innerText(),'Replacement notice');
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.name==='finalize_document_attachment').length),0);
});
acceptance('Sales and service attachment buttons route each saved record to its matching parent type',async t=>{
 const page=await fixture(t);
 for(const name of ['sales-delivery.js','service-workflow.js'])await page.addScriptTag({content:readFileSync(new URL('../'+name,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  window.$=selector=>document.querySelector(selector);window.run=fn=>fn();window.opened=[];
  openDocumentAttachments=async(...args)=>opened.push(args);
  salesProformas=[{id:'proforma-fixture',document_number:'PF-FIXTURE'}];salesDeliveryNotes=[{id:'delivery-fixture',delivery_number:'DN-FIXTURE'}];serviceCases=[{id:'service-fixture',case_number:'SC-FIXTURE'}];
  document.querySelector('#content').innerHTML='<article data-document-card="proforma-fixture"><div class="actions"></div></article><article data-document-card="delivery-fixture"><div class="actions"></div></article><article data-service-card="service-fixture"><div class="actions"></div></article>';
  bindSalesDelivery();bindServiceWorkflow();bindSalesDelivery();bindServiceWorkflow();
 });
 assert.equal(await page.locator('[data-document-files]').count(),3);
 for(const type of ['proforma','delivery','service'])await page.locator(`[data-document-files="${type}-fixture"]`).click();
 assert.deepEqual(await page.evaluate(()=>opened),[['proforma','proforma-fixture','PF-FIXTURE'],['delivery','delivery-fixture','DN-FIXTURE'],['service','service-fixture','SC-FIXTURE']]);
});
acceptance('Accounting attachment button stays disabled until draft save and then routes the saved ID',async t=>{
 const page=await fixture(t);
 for(const name of ['company-forms.js','accounting-access.js','accounting-workspace.js'])await page.addScriptTag({content:readFileSync(new URL('../'+name,import.meta.url),'utf8')});
 await page.evaluate(async()=>{
  window.$=selector=>document.querySelector(selector);window.run=fn=>fn();window.organizations=[];window.contacts=[];window.opened=[];view='accounting';
  openDocumentAttachments=async(...args)=>opened.push(args);
  client.rpc=async(name,args)=>name==='accounting_access'?{data:true}:{data:{id:args.p_id,kind:args.p_kind,version:1,body:args.p_body}};
  await accountingEditor({id:'accounting-fixture',kind:'payment',version:0,body:{number:'PV-FIXTURE'}},me.user_id);
 });
 const button=page.getByRole('button',{name:'Upload / view documents'});
 assert.equal(await button.isDisabled(),true);
 await page.locator('#accountingSave').click();await page.waitForFunction(()=>document.querySelector('#accountingSaveStatus')?.textContent.startsWith('Saved revision 1'));
 assert.equal(await button.isEnabled(),true);await button.click();
 assert.deepEqual(await page.evaluate(()=>opened),[['accounting','accounting-fixture','PV-FIXTURE']]);
});
