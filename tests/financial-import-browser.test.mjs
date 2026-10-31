import {leaveScopeSource} from './helpers/leave-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Synthetic local browser only: every network request is blocked and RPCs use an in-memory fixture.
const enabled=process.env.FINANCIAL_IMPORT_BROWSER_QA==='1';
const sources=['ui-motion.js','ui-page-header.js','vendor/xlsx.full.min.js','sales-domain.js','accounting-access.js','accounting-ledger.js','financial-import.js','ui-dialogs.js','client-profile-pages.js','workspace-navigation.js','record-navigation.js','nav-history.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
let browser;
test.before(async()=>{
 if(!enabled)return;
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close();});
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set FINANCIAL_IMPORT_BROWSER_QA=1 with local Playwright and Chrome'},fn);
async function fixture(t){
 const page=await browser.newPage({acceptDownloads:true});t.after(()=>page.close());page.setDefaultTimeout(4000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.route('**/*',route=>route.abort());
 await page.setContent('<header>Fixture ERP</header><nav id="nav"></nav><main><p id="notice"></p><section id="content"><div id="booksBody"></div></section></main>');
 await page.addStyleTag({content:readFileSync(new URL('../tokens.css',import.meta.url),'utf8')});
 await page.evaluate(()=>{
  window.sessionLoadEpoch=0;window.returnCreditPostingConfirmLeave=()=>true;window.salesConfirmLeave=async()=>true;window.openingReceivablesConfirmLeave=async()=>true;
  window.render=async()=>{$('#content').innerHTML='<h1>Replacement '+view+' page</h1>';};
  window.$=selector=>document.querySelector(selector);window.me={user_id:'fixture-accountant',role:'owner'};window.view='books';window.busy=false;
  window.salesSection='proformas';window.serviceSection='installations';window.inventorySection='stock';window.personalSection='task';
  window.esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.message=text=>$('#notice').textContent=text;window.run=fn=>Promise.resolve().then(fn).catch(error=>message(error.message));window.calls=[];window.receipts=new Map();window.entries=new Map();window.posted=0;
  const accounts=[{id:'bank',code:'1200',name:'Bank',active:true,account_type:'asset'},{id:'capital',code:'3000',name:'Capital',active:true,account_type:'equity'}];
  let sequence=100;crypto.randomUUID=()=>`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`;
  window.client={from(table){let start=0,end=499;return {select(){return this;},order(){return this;},range(a,b){start=a;end=b;return this;},then(done){calls.push({kind:'read',table});done({data:(table==='acc_accounts'?accounts:table==='acc_settings'?[{locked_through:null}]:[]).slice(start,end+1)});}};},async rpc(name,args){
   calls.push({kind:'rpc',name,args:args?structuredClone(args):null});
   if(name==='accounting_access')return {data:true};
   if(name==='financial_import_status'){if(window.unresolved)throw Error('Fixture status connection lost');return {data:receipts.get(args.p_id)||null};}
   if(name==='import_financial_journals'){
    if(window.delayPost)await new Promise(resolve=>window.releasePost=resolve);
    let result=receipts.get(args.p_id);
    if(!result){let imported=0,skipped=0;const listed=[];for(const entry of args.p_entries){const key=args.p_source.toLowerCase()+'|'+entry.reference;let saved=entries.get(key);if(saved)skipped++;else{saved={reference:entry.reference,entry_id:'entry-'+(++posted),entry_number:'JE-FIXTURE-'+posted};entries.set(key,saved);imported++;}listed.push(saved);}result={batch_id:args.p_id,imported_count:imported,skipped_count:skipped,entries:listed};receipts.set(args.p_id,result);}
    if(window.loseReply){window.loseReply=false;throw Error('Fixture commit response lost');}return {data:result};
   }
   throw Error('Unexpected RPC '+name);
  }};
 });
 await page.addScriptTag({content:leaveScopeSource});
 for(const source of sources)await page.addScriptTag({content:source});
 await page.evaluate(async()=>{
  booksSection='import';await booksWorkspace();
 });
 return page;
}
async function workbookFile(page,{formula=false,multiple=false,hostile=false}={}){
 const bytes=await page.evaluate(({formula,multiple,hostile})=>{
  const workbook=XLSX.utils.book_new();if(multiple)XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Instructions only']]),'Read first');
  const rows=[financialImportHeaders,['OPEN-1','2026-10-10','Reviewed opening balances','1200',125.5,'',hostile?'<img src=x onerror="window.injected=true">':'Bank statement','TZS'],['OPEN-1','2026-10-10','Reviewed opening balances','3000','',125.5,'Opening capital','TZS']];
  const sheet=XLSX.utils.aoa_to_sheet(rows);if(formula)sheet.E2={t:'n',v:125.5,f:'SUM(100,25.5)'};
  XLSX.utils.book_append_sheet(workbook,sheet,multiple?'Reviewed amounts':'Journal');return Array.from(new Uint8Array(XLSX.write(workbook,{type:'array',bookType:'xlsx'})));
 },{formula,multiple,hostile});
 return {name:'fixture-journals.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)};
}
async function upload(page,options){const file=await workbookFile(page,options);await page.locator('[name="source"]').fill('Fixture source ledger');await page.locator('[name="file"]').setInputFiles(file);await page.waitForFunction(()=>document.querySelector('#financialImportPreview').textContent.length>0);return file;}

acceptance('XLSX upload stays local, selects a sheet and previews exact balanced totals',async t=>{
 const page=await fixture(t);await upload(page,{multiple:true});
 assert.match(await page.locator('#financialImportPreview').innerText(),/Row 1 must contain/);
 await page.locator('[name="sheet"]').selectOption('Reviewed amounts');
 assert.match(await page.locator('#financialImportPreview').innerText(),/1 entries · 2 rows/);
 const totals=await page.locator('#financialImportPreview table').first().locator('tbody tr').innerText();assert.match(totals,/OPEN-1/);assert.equal((totals.match(/125\.50/g)||[]).length,2);
 assert.equal(await page.locator('#financialImportCommit').isDisabled(),false);
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.name&&call.name!=='accounting_access').length),0);
});

acceptance('explicit post confirms once and reimport skips the same source/reference',async t=>{
 const page=await fixture(t),file=await upload(page);
 await page.locator('#financialImportCommit').click();await page.waitForFunction(()=>document.querySelector('#financialImportStatus').textContent.includes('Import confirmed: 1 posted'));
 assert.equal(await page.evaluate(()=>posted),1);assert.equal(await page.locator('#financialImportCommit').isDisabled(),true);
 assert.equal(await page.evaluate(()=>calls.find(call=>call.name==='import_financial_journals').args.p_entries[0].lines[0].debit_minor),12550);
 await page.locator('#financialImportNew').click();await page.locator('[name="source"]').fill('Fixture source ledger');await page.locator('[name="file"]').setInputFiles(file);
 await page.locator('#financialImportCommit').click();await page.waitForFunction(()=>document.querySelector('#financialImportStatus').textContent.includes('0 posted, 1 already imported'));
 assert.equal(await page.evaluate(()=>posted),1);
});

acceptance('lost response preserves identity, blocks navigation and retries without duplicate posting',async t=>{
 const page=await fixture(t);await upload(page);await page.evaluate(()=>{window.loseReply=true;window.unresolved=true;});
 await page.locator('#financialImportCommit').click();await page.waitForFunction(()=>document.querySelector('#financialImportCommit').textContent==='Retry and reconcile this import');
 assert.equal(await page.locator('[name="source"]').isDisabled(),true);assert.equal(await page.evaluate(()=>posted),1);
 await page.locator('#nav [data-view="contacts"]').click();assert.equal(await page.evaluate(()=>view),'books');assert.match(await page.locator('#notice').innerText(),/Confirm this import/);
 await page.evaluate(()=>window.unresolved=false);await page.locator('#financialImportCommit').click();await page.waitForFunction(()=>document.querySelector('#financialImportStatus').textContent.includes('Import confirmed'));
 const ids=await page.evaluate(()=>calls.filter(call=>call.name==='import_financial_journals').map(call=>call.args.p_id));assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(await page.evaluate(()=>posted),1);
});

acceptance('sidebar navigation preserves a cancelled preview and clears an explicitly discarded preview',async t=>{
 const page=await fixture(t);await upload(page);
 await page.locator('#nav [data-view="contacts"]').click();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(await page.evaluate(()=>view),'books');assert.equal(await page.locator('#financialImportCommit').isDisabled(),false);
 await page.locator('#nav [data-view="contacts"]').click();await page.getByRole('dialog').getByRole('button',{name:'Discard preview',exact:true}).click();await page.waitForFunction(()=>view==='contacts');assert.equal(await page.evaluate(()=>view),'contacts');assert.equal(await page.evaluate(()=>financialImportState),null);assert.equal(await page.evaluate(()=>posted),0);
});

acceptance('Books section tabs retain a cancelled preview and block an unresolved import',async t=>{
 const page=await fixture(t);await upload(page);
 await page.locator('[data-books-section="overview"]').click();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 assert.equal(await page.evaluate(()=>booksSection),'import');assert.equal(await page.locator('#financialImportCommit').isDisabled(),false);
 await page.evaluate(()=>{window.loseReply=true;window.unresolved=true;});await page.locator('#financialImportCommit').click();
 await page.waitForFunction(()=>document.querySelector('#financialImportCommit').textContent==='Retry and reconcile this import');
 await page.locator('[data-books-section="accounts"]').click();assert.equal(await page.evaluate(()=>booksSection),'import');assert.match(await page.locator('#notice').innerText(),/Confirm this import/);
});

acceptance('formula cells cannot post and imported display text cannot create markup',async t=>{
 const page=await fixture(t);await upload(page,{formula:true,hostile:true});
 assert.match(await page.locator('#financialImportPreview').innerText(),/Formulas and spreadsheet error cells/);assert.equal(await page.locator('#financialImportCommit').isDisabled(),true);
 assert.equal(await page.locator('#financialImportPreview img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.evaluate(()=>posted),0);
});

acceptance('late commit response cannot repaint or notify a replacement actor page',async t=>{
 const page=await fixture(t);await upload(page);await page.evaluate(()=>window.delayPost=true);
 await page.locator('#financialImportCommit').click();await page.waitForFunction(()=>typeof releasePost==='function');
 await page.evaluate(()=>{me={user_id:'other'};view='sales';clearFinancialImport();$('#content').innerHTML='<h1>Replacement actor page</h1>';$('#notice').textContent='Replacement notice';releasePost();});
 await page.waitForFunction(()=>posted===1);assert.equal(await page.locator('#content').innerText(),'Replacement actor page');assert.equal(await page.locator('#notice').innerText(),'Replacement notice');assert.equal(await page.evaluate(()=>financialImportState),null);
});

acceptance('the blank financial workbook template downloads through the browser',async t=>{
 const page=await fixture(t),event=page.waitForEvent('download');await page.locator('#financialTemplate').click();const download=await event;
 assert.equal(download.suggestedFilename(),'financial-journals-template.xlsx');assert.equal(await download.failure(),null);assert.equal(await page.evaluate(()=>posted),0);
});
