import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Opt in to local-browser acceptance tests; default Node runs report explicit skips.
// No server, production credentials, network requests or persistent browser profile.
const enabled=process.env.ACCOUNTING_BROWSER_QA==='1';
const sources=['company-forms.js','accounting-workspace.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
let browser;
test.before(async()=>{
 if(!enabled)return;
 const module=process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs');
 const {chromium}=await import(pathToFileURL(module).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close()});
async function fixture(t,overrides={}){
 const page=await browser.newPage();t.after(()=>page.close());
 await page.route('**/*',route=>route.abort());
 await page.setContent('<section id="content"></section>');
 await page.evaluate(overrides=>{
  window.me={user_id:'actor'};window.view='accounting';window.$=s=>document.querySelector(s);
  window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.run=fn=>fn();window.calls=[];window.saved=null;
  window.organizations=[{id:'a',name:'Alpha',location:'Branch A'},{id:'b',name:'Beta',location:'Branch B'}];
  window.contacts=[{id:'ca',organization_id:'a',first_name:'Alice',last_name:'A'},{id:'cb',organization_id:'b',first_name:'Bob',last_name:'B'},{id:'gone',organization_id:'a',first_name:'Deleted',deleted_at:'2026-01-01'}];
  window.requireAccountingAccess=async()=>me.user_id;
  window.client={rpc:async(name,args)=>{
   calls.push({name,args});
   if(window.delaySave)await new Promise(resolve=>window.releaseSave=resolve);
   window.saved={id:args.p_id,kind:args.p_kind,version:args.p_expected_version+1,organization_id:args.p_organization_id,contact_id:args.p_contact_id,body:args.p_body};
   return {data:structuredClone(saved)};
  },from:()=>({select:()=>({order:()=>({range:async()=>({data:window.saved?[window.saved]:[]})})})})};
  window.row={id:'draft',kind:'tax_invoice',version:2,organization_id:'a',contact_id:'ca',body:{number:'DRAFT-1',contact:'Printed contact',buyer:'Printed buyer',lines:[{description:'Device',quantity:'2',rate:'100',per:'unit',amount:'200'}]},...overrides};
 },overrides);
 for(const source of sources)await page.addScriptTag({content:source});
 await page.evaluate(()=>accountingEditor(row,'actor'));
 return page;
}
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set ACCOUNTING_BROWSER_QA=1 with a local Playwright/browser runtime'},fn);

acceptance('Draft save and reopen preserve linked IDs, printable fields and successive versions',async t=>{
 const p=await fixture(t);
 await p.locator('[name="buyer"]').fill('Customer billing snapshot');
 await p.locator('#accountingSave').click();
 await p.waitForFunction(()=>saved?.version===3);
 assert.deepEqual(await p.evaluate(()=>[calls[0].name,calls[0].args.p_organization_id,calls[0].args.p_contact_id,calls[0].args.p_body.lines[0].amount]),['save_accounting_draft','a','ca','200']);
 await p.evaluate(()=>accountingEditor(saved,'actor'));
 assert.equal(await p.locator('#accountingCustomer').inputValue(),'a');
 assert.equal(await p.locator('#accountingContact').inputValue(),'ca');
 assert.equal(await p.locator('[name="buyer"]').inputValue(),'Customer billing snapshot');
 assert.equal(await p.locator('[name="contact"]').inputValue(),'Printed contact');
 await p.locator('#accountingSave').click();
 await p.waitForFunction(()=>saved?.version===4);
 assert.equal(await p.evaluate(()=>calls[1].args.p_expected_version),3);
});
acceptance('Changing customer clears linked contact and excludes other-branch/deleted contacts',async t=>{
 const p=await fixture(t);
 assert.deepEqual(await p.locator('#accountingContact option').evaluateAll(options=>options.map(o=>o.value)),['','ca']);
 await p.locator('#accountingCustomer').selectOption('b');
 assert.equal(await p.locator('#accountingContact').inputValue(),'');
 assert.deepEqual(await p.locator('#accountingContact option').evaluateAll(options=>options.map(o=>o.value)),['','cb']);
 await p.locator('#accountingContact').selectOption('cb');
 await p.locator('#accountingSave').click();
 await p.waitForFunction(()=>calls.length===1);
 assert.deepEqual(await p.evaluate(()=>[calls[0].args.p_organization_id,calls[0].args.p_contact_id,calls[0].args.p_body.contact]),['b','cb','Printed contact']);
});
acceptance('Unknown saved contact requires explicit correction before save',async t=>{
 const p=await fixture(t,{contact_id:'missing-contact'});
 await p.locator('#accountingSave').click();
 assert.equal(await p.evaluate(()=>calls.length),0);
 assert.match(await p.locator('#accountingSaveStatus').textContent(),/contact|unavailable|select/i);
});
acceptance('Search cannot silently change saved customer or contact selection',async t=>{
 const p=await fixture(t);
 await p.locator('#accountingCustomerSearch').fill('Beta');
 await p.locator('#accountingContactSearch').fill('No match');
 assert.equal(await p.locator('#accountingCustomer').inputValue(),'a');
 assert.equal(await p.locator('#accountingContact').inputValue(),'ca');
 await p.locator('#accountingSave').click();
 await p.waitForFunction(()=>calls.length===1);
 assert.deepEqual(await p.evaluate(()=>[saved.organization_id,saved.contact_id]),['a','ca']);
});
acceptance('A saved contact from another branch is blocked before RPC',async t=>{
 const p=await fixture(t,{contact_id:'cb'});
 await p.locator('#accountingSave').click();
 assert.equal(await p.evaluate(()=>calls.length),0);
 assert.match(await p.locator('#accountingSaveStatus').textContent(),/contact belonging/i);
});
acceptance('Server rejection preserves entered form and does not advance expected version',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{
  const original=client.rpc;
  client.rpc=async(name,args)=>{window.rejectedArgs=args;client.rpc=original;return {error:{message:'Draft changed. Reopen latest revision.'}}};
 });
 await p.locator('[name="buyer"]').fill('Unsaved edit');
 await p.locator('#accountingSave').click();
 assert.match(await p.locator('#accountingSaveStatus').textContent(),/Not confirmed saved: Draft changed/);
 assert.equal(await p.locator('[name="buyer"]').inputValue(),'Unsaved edit');
 assert.equal(await p.locator('#accountingSave').isDisabled(),false);
 await p.locator('#accountingSave').click();
 await p.waitForFunction(()=>calls.length===1);
 assert.equal(await p.evaluate(()=>calls[0].args.p_expected_version),2);
});
acceptance('Actor or page change before submit prevents any draft write',async t=>{
 for(const change of ['actor','page']){
  const p=await fixture(t);
  await p.evaluate(change=>{if(change==='actor')me={user_id:'other'};else view='sales'},change);
  await p.locator('#accountingSave').click();
  assert.equal(await p.evaluate(()=>calls.length),0);
 }
});
acceptance('Late save completion does not overwrite a replacement page',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>window.delaySave=true);
 await p.locator('#accountingSave').click();
 await p.waitForFunction(()=>typeof releaseSave==='function');
 await p.evaluate(()=>{view='sales';$('#content').innerHTML='<h1>New sales page</h1>';releaseSave()});
 assert.equal(await p.locator('#content').innerText(),'New sales page');
});
acceptance('Permission response arriving after navigation does not overwrite the new page',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{
  window.requireAccountingAccess=()=>new Promise(resolve=>window.releaseAccess=resolve);
  window.pendingWorkspace=accountingWorkspace();
  view='sales';$('#content').innerHTML='<h1>New sales page</h1>';releaseAccess('actor');
 });
 await p.evaluate(()=>pendingWorkspace);
 assert.equal(await p.locator('#content').innerText(),'New sales page');
});
