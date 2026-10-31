import {leaveScopeSource,leaveContextSource} from './helpers/leave-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const enabled=process.env.OPENING_BROWSER_QA==='1';let browser;
test.before(async()=>{if(enabled){const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});}});
test.after(async()=>browser?.close());
const acceptance=(name,fn)=>test(name,{skip:!enabled},fn);
async function fixture(t){
 const p=await browser.newPage();t.after(()=>p.close());p.setDefaultTimeout(5000);await p.route('**/*',r=>r.abort());await p.setContent('<main id="booksBody"></main>');
 await p.evaluate(()=>{window.me={user_id:'actor'};window.view='books';window.$=s=>document.querySelector(s);window.esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');window.message=()=>{};window.requireAccountingAccess=async()=>me.user_id;window.calls=[];
  crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000003';window.fixtureBooksSelectAll=async table=>table==='organizations'?[{id:'00000000-0000-4000-8000-000000000001',name:'Fixture Clinic',location:'Dar'}]:[{id:'00000000-0000-4000-8000-000000000002',source:'Legacy GL',created_at:'2026-10-01'}];
  window.client={rpc:async(name,args)=>{calls.push({name,args});if(name==='opening_receivables_check')return window.checkError?{error:{message:checkError}}:{data:{gl_import_id:args.p_gl_import_id,cutover_date:args.p_cutover,reconciled:true,difference_minor:0,imported_gl_ar_minor:12345,opening_residual_minor:12345,control_ar_minor:12345,customer_subledger_minor:12345}};
   if(name==='opening_receivables_status')return {data:null};if(window.delayPost)await new Promise(resolve=>window.releasePost=resolve);if(window.offline)throw Error('Connection lost');return {data:{gl_import_id:args.p_gl_import_id,cutover_date:args.p_cutover,reconciled:true,difference_minor:0,invoices:[{invoice_id:'invoice'}],imported_count:1}};}};});
 for(const name of ['ui-motion.js','ui-page-header.js','vendor/xlsx.full.min.js','business-date.js','sales-domain.js','accounting-ledger.js','financial-import.js','opening-receivables.js'])await p.addScriptTag({content:readFileSync(new URL('../'+name,import.meta.url),'utf8')});
 await p.evaluate(()=>{window.sessionLoadEpoch=0;});
 await p.addScriptTag({content:leaveScopeSource+'\n'+leaveContextSource});
 await p.evaluate(async()=>{booksSelectAll=fixtureBooksSelectAll;booksSection='opening';await openingReceivablesWorkspace('actor',()=>true)});
 await p.locator('[name="source"]').fill('Legacy AR');await p.locator('[name="cutover"]').fill('2026-10-01');await p.locator('[name="gl"]').selectOption('00000000-0000-4000-8000-000000000002');
 const text='Invoice Reference,Customer UUID,Invoice Date,Due Date,Residual Amount,Currency\r\nHIST-001,00000000-0000-4000-8000-000000000001,2026-08-01,2026-09-01,123.45,TZS';
 await p.locator('[name="file"]').setInputFiles({name:'receivables.csv',mimeType:'text/csv',buffer:Buffer.from(text)});await p.waitForFunction(()=>document.querySelector('#openingPreview').textContent.includes('File validation passed'));return p;
}
acceptance('opening UI validates the real CSV, requires reconciliation and posts one reviewed payload',async t=>{
 const p=await fixture(t);assert.equal(await p.locator('#openingPost').isDisabled(),true);assert.match(await p.locator('#openingPreview').innerText(),/Fixture Clinic/);
 await p.locator('#openingCheck').click();await p.waitForFunction(()=>!document.querySelector('#openingPost').disabled);assert.match(await p.locator('#openingStatus').innerText(),/Overall AR control/);
 await p.locator('#openingPost').click();await p.waitForFunction(()=>document.querySelector('#openingStatus').textContent.includes('Opening import confirmed'));
 const calls=await p.evaluate(()=>window.calls);assert.deepEqual(calls.map(c=>c.name),['opening_receivables_check','import_opening_receivables']);assert.equal(calls[1].args.p_rows[0].amount_minor,12345);assert.equal(await p.locator('[name="file"]').isDisabled(),true);
});
acceptance('AR mismatch blocks posting and preserves the locally reviewed residuals',async t=>{
 const p=await fixture(t);await p.evaluate(()=>window.checkError='AR reconciliation failed: 100 versus 12345');await p.locator('#openingCheck').click();await p.waitForFunction(()=>document.querySelector('#openingStatus').textContent.includes('reconciliation failed'));
 assert.equal(await p.locator('#openingPost').isDisabled(),true);assert.match(await p.locator('#openingPreview').innerText(),/HIST-001/);assert.equal(await p.locator('[name="source"]').isEnabled(),true);
});
acceptance('pending and uncertain imports lock input and retry the same identity',async t=>{
 const p=await fixture(t);await p.locator('#openingCheck').click();await p.waitForFunction(()=>!document.querySelector('#openingPost').disabled);await p.evaluate(()=>{window.delayPost=true;window.offline=true});
 await p.locator('#openingPost').click();await p.waitForFunction(()=>typeof releasePost==='function');assert.equal(await p.locator('[name="source"]').isDisabled(),true);await p.evaluate(()=>releasePost());await p.waitForFunction(()=>document.querySelector('#openingPost').textContent.includes('Retry'));
 assert.equal(await p.locator('[name="file"]').isDisabled(),true);assert.equal(await p.evaluate(()=>openingReceivablesConfirmLeave()),false);await p.evaluate(()=>{window.delayPost=false;window.offline=false});await p.locator('#openingPost').click();await p.waitForFunction(()=>document.querySelector('#openingStatus').textContent.includes('Opening import confirmed'));
 const calls=await p.evaluate(()=>window.calls.filter(c=>c.name==='import_opening_receivables'));assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);
});
