import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Opt-in browser tests use only local scripts, synthetic data and an isolated browser.
const enabled=process.env.ACCOUNTING_BROWSER_QA==='1';
const sources=['sales-domain.js','accounting-ledger.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
let browser;
test.before(async()=>{
 if(!enabled)return;
 const module=process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs');
 const {chromium}=await import(pathToFileURL(module).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close();});
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set ACCOUNTING_BROWSER_QA=1 with a local Playwright/browser runtime'},fn);
async function fixture(t,{chosen='quote-a',lines}={}){
 const page=await browser.newPage();t.after(()=>page.close());
 await page.route('**/*',route=>route.abort());
 await page.setContent('<section id="content"><div id="booksBody"></div></section>');
 await page.evaluate(()=>{
  window.me={user_id:'actor'};window.view='books';window.$=s=>document.querySelector(s);
  window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.organizations=[{id:'customer',name:'Test customer'}];
  window.run=fn=>fn();window.calls=[];window.messages=[];window.message=s=>messages.push(s);window.refreshes=0;
  window.pendingLoaded=true;window.salesLoaded=true;window.inventoryLoaded=true;
  let nextId=0;Object.defineProperty(window,'crypto',{value:{randomUUID:()=>`request-${++nextId}`}});
  window.snapshots={};window.waiters={};window.delayQuantities=false;
  window.client={rpc:async(name,args)=>{
   calls.push({name,args:structuredClone(args)});
   if(name==='order_invoice_quantities'){
    if(delayQuantities)await new Promise(resolve=>waiters[args.p_proforma_id]=resolve);
    return {data:structuredClone(snapshots[args.p_proforma_id])};
   }
   if(window.delayPost)await new Promise(resolve=>window.releasePost=resolve);
   if(window.postError){const error=postError;window.postError=null;if(error.transport)throw Error(error.message);return {error};}
   return {data:{id:args.p_id,invoice_number:'INV-TEST',proforma_id:args.p_proforma_id}};
  }};
 });
 for(const source of sources)await page.addScriptTag({content:source});
 await page.evaluate(({chosen,lines})=>{
  booksData={today:booksToday(),invoices:[],toInvoice:[{id:'quote-a',organization_id:'customer',document_number:'PF-A',currency:'TZS',total_minor:40000},{id:'quote-b',organization_id:'customer',document_number:'PF-B',currency:'TZS',total_minor:10000}]};
  booksDraft={proformaId:chosen};
  snapshots['quote-a']={proforma_id:'quote-a',version:7,lines:lines||[{proforma_line_id:'machine',product_id:'p',description:'Machine',uom:'unit',ordered_quantity:4,invoiced_quantity:0,remaining_quantity:4,available_quantity:2,unit_price_minor:10000,discount_basis_points:0,tax_basis_points:0},{proforma_line_id:'unavailable',product_id:'q',description:'Unavailable spare',uom:'unit',ordered_quantity:1,invoiced_quantity:1,remaining_quantity:0,available_quantity:0,unit_price_minor:10000,discount_basis_points:0,tax_basis_points:0}]};
  snapshots['quote-b']={proforma_id:'quote-b',version:2,lines:[{proforma_line_id:'other',product_id:'other',description:'Other item',uom:'unit',ordered_quantity:1,invoiced_quantity:0,remaining_quantity:1,available_quantity:1}]};
  booksWorkspace=async()=>{refreshes++;};
  return booksInvoices();
 },{chosen,lines});
 return page;
}
const quantities=p=>p.locator('[data-books-invoice-quantity]');
const post=p=>p.locator('#booksInvoicePost');
const writes=p=>p.evaluate(()=>calls.filter(call=>call.name==='invoice_order_quantities'));

acceptance('Accounts reviews four ordered, invoices two available and omits unavailable zeroes',async t=>{
 const p=await fixture(t);
 assert.deepEqual(await quantities(p).evaluateAll(inputs=>inputs.map(input=>input.value)),['2','0']);
 assert.match(await p.locator('#booksInvoiceQuantities').innerText(),/Already invoiced/);
 assert.match(await p.locator('#booksInvoiceReview').innerText(),/2 units selected.*2 units remain pending/);
 assert.match(await p.locator('[name="proforma"] option:checked').innerText(),/Quote total/);
 await p.locator('[name="accountsref"]').fill('APPROVAL-1');
 await post(p).click();
 await p.waitForFunction(()=>refreshes===1);
 const calls=await writes(p);assert.equal(calls.length,1);
 assert.deepEqual(calls[0].args.p_lines,[{proforma_line_id:'machine',quantity:2}]);
 assert.equal(calls[0].args.p_expected_version,7);assert.equal(calls[0].args.p_accounts_reference,'APPROVAL-1');
 assert.equal(await p.evaluate(()=>calls.some(call=>call.name==='create_invoice_from_proforma')),false);
 assert.deepEqual(await p.evaluate(()=>[pendingLoaded,salesLoaded,inventoryLoaded]),[false,false,false]);
 await p.evaluate(()=>{const line=snapshots['quote-a'].lines[0];line.invoiced_quantity=2;line.remaining_quantity=2;line.available_quantity=0;booksDraft={proformaId:'quote-a'};return booksInvoices();});
 assert.equal(await quantities(p).first().inputValue(),'0');assert.equal(await post(p).isDisabled(),true);
 await p.evaluate(()=>snapshots['quote-a'].lines[0].available_quantity=2);
 await p.locator('#booksInvoiceReload').click();await p.waitForFunction(()=>document.querySelector('[data-books-invoice-quantity]').value==='2');
 assert.match(await p.locator('#booksInvoiceReview').innerText(),/2 units selected.*0 units remain pending/);
 await p.locator('[name="accountsref"]').fill('APPROVAL-2');await post(p).click();await p.waitForFunction(()=>refreshes===2);
 const later=await writes(p);assert.equal(later.length,2);assert.deepEqual(later[1].args.p_lines,[{proforma_line_id:'machine',quantity:2}]);assert.notEqual(later[0].args.p_id,later[1].args.p_id);
});

acceptance('No selected quantity may exceed the balance, available stock or whole-unit bounds',async t=>{
 const p=await fixture(t);await p.locator('[name="accountsref"]').fill('APPROVAL-1');
 for(const value of ['3','5','1.5','-1','1000001','0']){
  await quantities(p).first().fill(value);
  assert.equal(await post(p).isDisabled(),true,`quantity ${value} must not be posted`);
 }
 assert.equal((await writes(p)).length,0);
 await quantities(p).first().fill('1');assert.equal(await post(p).isDisabled(),false);
 await p.locator('[name="deliverydate"]').fill('2020-01-01');
 await p.locator('#booksInvoiceForm').evaluate(form=>form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
 assert.match(await p.locator('#booksInvoiceStatus').innerText(),/today or later/);
 assert.equal((await writes(p)).length,0);
});

acceptance('Repeated product lines share stock when defaults and edited quantities are reviewed',async t=>{
 const p=await fixture(t,{lines:[{proforma_line_id:'a',product_id:'same',description:'First machine',uom:'unit',ordered_quantity:4,invoiced_quantity:0,remaining_quantity:4,available_quantity:2},{proforma_line_id:'b',product_id:'same',description:'Second machine',uom:'unit',ordered_quantity:3,invoiced_quantity:1,remaining_quantity:2,available_quantity:2}]});
 assert.deepEqual(await quantities(p).evaluateAll(inputs=>inputs.map(input=>input.value)),['2','0']);
 await quantities(p).nth(1).fill('1');
 assert.equal(await post(p).isDisabled(),true);assert.match(await p.locator('#booksInvoiceReview').innerText(),/available Haadi stock/);
});

acceptance('An older quantity response cannot replace a different selected order',async t=>{
 const p=await fixture(t,{chosen:''});await p.evaluate(()=>window.delayQuantities=true);
 await p.locator('[name="proforma"]').selectOption('quote-a');await p.waitForFunction(()=>waiters['quote-a']);
 await p.locator('[name="proforma"]').selectOption('quote-b');await p.waitForFunction(()=>waiters['quote-b']);
 await p.evaluate(()=>waiters['quote-b']());await p.waitForSelector('[data-books-invoice-quantity="other"]');
 await p.evaluate(()=>waiters['quote-a']());
 assert.equal(await quantities(p).count(),1);assert.equal(await quantities(p).first().getAttribute('data-books-invoice-quantity'),'other');
 await p.locator('[name="accountsref"]').fill('B-APPROVAL');await post(p).click();await p.waitForFunction(()=>refreshes===1);
 assert.equal((await writes(p))[0].args.p_proforma_id,'quote-b');
});

acceptance('A late initial quantity response cannot touch the replacement page',async t=>{
 const p=await fixture(t,{chosen:''});
 await p.evaluate(()=>{window.delayQuantities=true;booksDraft={proformaId:'quote-a'};window.loading=booksInvoices();});
 await p.waitForFunction(()=>waiters['quote-a']);
 await p.evaluate(()=>{view='sales';$('#content').innerHTML='<h1>Replacement page</h1>';waiters['quote-a']();});
 await p.evaluate(()=>loading);
 assert.equal(await p.locator('#content').innerText(),'Replacement page');
});

acceptance('Actor, session or page changes prevent invoice writes',async t=>{
 for(const change of ['actor','session','page']){
  const p=await fixture(t);await p.locator('[name="accountsref"]').fill('APPROVAL-1');
  await p.evaluate(change=>{if(change==='actor')me={user_id:'other'};else if(change==='session')me={user_id:'actor'};else view='sales';},change);
  await post(p).click();assert.equal((await writes(p)).length,0);
 }
});

acceptance('Uncertain posting locks details and retries exactly the same request without double submission',async t=>{
 const p=await fixture(t);await p.locator('[name="accountsref"]').fill('APPROVAL-1');
 await p.evaluate(()=>{window.delayPost=true;window.postError={transport:true,message:'Connection lost'};});
 await post(p).click();await p.waitForFunction(()=>typeof releasePost==='function');
 await p.locator('#booksInvoiceForm').evaluate(form=>form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
 assert.equal((await writes(p)).length,1);
 await p.evaluate(()=>{window.delayPost=false;releasePost();});
 await p.waitForFunction(()=>document.querySelector('#booksInvoicePost').textContent==='Retry same invoice');
 assert.equal(await p.locator('[name="proforma"]').isDisabled(),true);
 assert.equal(await p.locator('[name="accountsref"]').isDisabled(),true);
 await post(p).click();await p.waitForFunction(()=>refreshes===1);
 const calls=await writes(p);assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);
});

acceptance('Confirmed SQL rejection permits correction; unchanged retry keeps its ID and edited retry gets a new ID',async t=>{
 const p=await fixture(t);await p.locator('[name="accountsref"]').fill('APPROVAL-1');
 await p.evaluate(()=>window.postError={code:'P0001',message:'Stock changed. Refresh quantities.'});
 await post(p).click();await p.waitForFunction(()=>document.querySelector('#booksInvoiceStatus').textContent.includes('Stock changed'));
 assert.equal(await p.locator('[name="accountsref"]').isDisabled(),false);
 await p.evaluate(()=>window.postError={code:'P0001',message:'Stock changed again.'});
 await post(p).click();await p.waitForFunction(()=>document.querySelector('#booksInvoiceStatus').textContent.includes('again'));
 let calls=await writes(p);assert.equal(calls[0].args.p_id,calls[1].args.p_id);
 await quantities(p).first().fill('1');await post(p).click();await p.waitForFunction(()=>refreshes===1);
 calls=await writes(p);assert.notEqual(calls[2].args.p_id,calls[1].args.p_id);assert.equal(calls[2].args.p_lines[0].quantity,1);
});

acceptance('A late posting result cannot refresh or announce success in another session',async t=>{
 const p=await fixture(t);await p.locator('[name="accountsref"]').fill('APPROVAL-1');
 await p.evaluate(()=>window.delayPost=true);await post(p).click();await p.waitForFunction(()=>typeof releasePost==='function');
 await p.evaluate(()=>{me={user_id:'other'};view='sales';$('#content').innerHTML='<h1>Replacement page</h1>';releasePost();});
 assert.equal(await p.locator('#content').innerText(),'Replacement page');
 assert.equal(await p.evaluate(()=>refreshes),0);assert.equal(await p.evaluate(()=>messages.length),0);
});


acceptance('Unknown transaction completion keeps details locked even when the server supplies an SQL code',async t=>{
 const p=await fixture(t);await p.locator('[name="accountsref"]').fill('APPROVAL-1');
 await p.evaluate(()=>window.postError={code:'08007',message:'Transaction resolution unknown'});
 await post(p).click();await p.waitForFunction(()=>document.querySelector('#booksInvoicePost').textContent==='Retry same invoice');
 assert.equal(await p.locator('[name="accountsref"]').isDisabled(),true);
 await post(p).click();await p.waitForFunction(()=>refreshes===1);
 const calls=await writes(p);assert.deepEqual(calls[1],calls[0]);
});


acceptance('Voiding an invoice invalidates its pending balance so reopening Pending reloads it the same day',async t=>{
 const p=await fixture(t);
 await p.addScriptTag({content:readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8')});
 await p.evaluate(()=>{
  pendingLoaded=true;pendingAvailabilityDay=pendingToday();window.pendingReads=0;window.syncWorkspaceNavigation=()=>{};
  loadPendingStock=async()=>{pendingReads++;pendingLoaded=true;return true;};renderPendingStock=()=>{};
  booksVoidPrompt('invoice',{id:'invoice',invoice_number:'INV-TEST'});
 });
 await p.locator('#booksVoidForm [name="reason"]').fill('Cancelled delivery');
 await p.locator('#booksVoidForm [type="submit"]').click();await p.waitForFunction(()=>refreshes===1);
 assert.equal(await p.evaluate(()=>pendingLoaded),false);
 await p.evaluate(()=>{view='pending';return pendingStockWorkspace();});
 assert.equal(await p.evaluate(()=>pendingReads),1);
});

acceptance('A void result from a previous session cannot clear the new session cache or announce success',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{window.delayPost=true;booksVoidPrompt('invoice',{id:'invoice',invoice_number:'INV-TEST'});});
 await p.locator('#booksVoidForm [name="reason"]').fill('Cancelled delivery');
 await p.locator('#booksVoidForm [type="submit"]').click();await p.waitForFunction(()=>typeof releasePost==='function');
 await p.evaluate(()=>{me={user_id:'actor'};pendingLoaded=true;releasePost();});
 assert.equal(await p.evaluate(()=>pendingLoaded),true);assert.equal(await p.evaluate(()=>refreshes),0);assert.equal(await p.evaluate(()=>messages.length),0);
});
