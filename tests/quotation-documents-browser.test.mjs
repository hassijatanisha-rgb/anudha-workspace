import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const enabled=process.env.QUOTATION_DOCUMENTS_BROWSER_QA==='1';
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set QUOTATION_DOCUMENTS_BROWSER_QA=1 with local Playwright and Chrome'},fn);
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const app=read('app.js'),feedback=read('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
let browser;
test.before(async()=>{if(enabled){const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});}});
test.after(async()=>{await browser?.close();});
async function fixture(t){
 const page=await browser.newPage({acceptDownloads:true});t.after(()=>page.close());page.setDefaultTimeout(3000);await page.route('**/*',route=>route.abort());
 await page.setContent('<p id="notice"></p><main id="content">Fictional quotation</main>');
 await page.evaluate(()=>{
  window.me={user_id:'fixture-sales'};window.view='sales';window.salesEpoch=0;window.calls=[];window.allowed=true;
  window.quote={id:'00000000-0000-4000-8000-000000000001',version:1,revision:2,document_number:'PF-FIXTURE',internal_notes:'INTERNAL REMARK NOT FOR CUSTOMER'};
  window.product='00000000-0000-4000-8000-000000000002';
  window.rows=[{id:'00000000-0000-4000-8000-000000000003',record_type:'product',record_id:product,object_path:'product/private-brochure',original_filename:'Fictional-brochure.pdf',mime_type:'application/pdf',byte_size:8,uploaded_at:'2026-10-20'}];
  window.esc=value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';');window.busy=false;window.$=selector=>document.querySelector(selector);
  window.salesProforma=()=>quote;window.salesProduct=()=>({name:'Fictional product'});window.salesDocumentLines=()=>[{product_id:product,product_name:'Fictional quoted analyzer'}];window.loadSalesRevision=async()=>{};window.printSalesDocument=()=>{};
  window.client={rpc:async(name,args)=>{calls.push({type:'rpc',name,args});return {data:allowed};},from:()=>{
   const filters={};return {select(){return this;},eq(key,value){filters[key]=value;return this;},order(){return this;},range(start,end){return Promise.resolve({data:rows.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)).slice(start,end+1)});}};
  },storage:{from:()=>({download:async path=>{calls.push({type:'download',path});if(window.delayDownload)await new Promise(resolve=>window.releaseDownload=resolve);return {data:new Blob(['%PDF-1.7'],{type:'application/pdf'})};}})}};
 });
 await page.addStyleTag({content:read('tokens.css')+read('ui-polish.css')});
 await page.addScriptTag({content:feedback});await page.addScriptTag({content:read('ui-dialogs.js')});
 for(const file of ['document-attachments.js','quotation-documents.js'])await page.addScriptTag({content:read(file)});
 await page.evaluate(()=>openQuotationDocuments(quote));return page;
}
acceptance('product library is empty until uploaded and explicitly selected files download once as a ZIP',async t=>{
 const page=await fixture(t);assert.match(await page.locator('[data-quote-files]').innerText(),/No quotation supporting files/);
 await page.locator('[data-quote-source]').selectOption('1');await page.getByLabel(/Fictional-brochure.pdf/).waitFor();
 assert.equal(await page.locator('[data-quote-file]').isChecked(),false);assert.equal(await page.locator('[data-quote-download]').isDisabled(),true);
 await page.locator('[data-quote-file]').check();const downloaded=page.waitForEvent('download');await page.locator('[data-quote-download]').click();const file=await downloaded;
 assert.equal(file.suggestedFilename(),'PF-FIXTURE-supporting-files.zip');assert.equal(await file.failure(),null);
 const bytes=readFileSync(await file.path());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.includes(Buffer.from('01-Fictional-brochure.pdf')));assert.ok(bytes.includes(Buffer.from('%PDF-1.7')));assert.ok(!bytes.includes(Buffer.from('INTERNAL REMARK')));
 assert.match(await page.locator('[data-quote-status]').innerText(),/Nothing has been emailed or marked sent/);assert.equal(await page.evaluate(()=>calls.filter(call=>call.type==='download').length),1);
 await page.locator('[data-quote-close]').click();await page.waitForFunction(()=>!document.querySelector('.document-attachments'));await page.evaluate(()=>{rows=[];return openQuotationDocuments(quote);});await page.locator('[data-quote-source]').selectOption('1');assert.match(await page.locator('[data-quote-files]').innerText(),/No product brochures/);
});
acceptance('a session replacement during a download closes the dialog and never triggers a browser download',async t=>{
 const page=await fixture(t);let downloads=0;page.on('download',()=>downloads++);await page.locator('[data-quote-source]').selectOption('1');await page.locator('[data-quote-file]').check();
 await page.evaluate(()=>window.delayDownload=true);await page.locator('[data-quote-download]').click();await page.waitForFunction(()=>typeof releaseDownload==='function');
 await page.evaluate(()=>{me={user_id:'replacement'};releaseDownload();});await page.waitForFunction(()=>!document.querySelector('[data-quote-status]'));assert.equal(downloads,0);
});
acceptance('revoked access produces a visible failure with no storage download',async t=>{
 const page=await fixture(t);await page.locator('[data-quote-source]').selectOption('1');await page.locator('[data-quote-file]').check();await page.evaluate(()=>allowed=false);await page.locator('[data-quote-download]').click();
 await page.waitForFunction(()=>document.querySelector('[data-quote-status]').textContent.includes('do not have access'));assert.equal(await page.evaluate(()=>calls.filter(call=>call.type==='download').length),0);
});
