import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const enabled=process.env.PROFORMA_BROWSER_QA==='1';
const sources=['company-forms.js','sales-domain.js','sales-delivery.js','action-forms.js','accounting-access.js','proforma-accounting-queue.js','accounting-workspace.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
let browser;
test.before(async()=>{
 if(!enabled)return;
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close()});
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set PROFORMA_BROWSER_QA=1 with local Playwright and Chrome'},fn);
async function fixture(t){
 const page=await browser.newPage();t.after(()=>page.close());page.setDefaultTimeout(2500);
 await page.route('**/*',route=>route.abort());
 await page.setContent('<section id="content"></section><div id="notice"></div>');
 await page.evaluate(()=>{
  window.$=s=>document.querySelector(s);window.me={user_id:'actor',role:'staff'};window.view='sales';
  window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let sequence=0;crypto.randomUUID=()=>`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`;
  window.message=s=>$('#notice').textContent=s;
  window.pending=0;window.run=async fn=>{pending++;try{await fn()}catch(error){message(error.message)}finally{pending--}};
  window.syncWorkspaceNavigation=()=>{};window.inventoryLoaded=true;window.loadInventoryOperations=async()=>{};
  window.organizations=[{id:'branch',name:'Fixture Hospital',location:'Dar'}];window.orgIndex=new Map(organizations.map(row=>[row.id,row]));
  window.contacts=[{id:'contact',organization_id:'branch',first_name:'Named',last_name:'Contact',status:'valid'}];
  window.products=[{id:'product',name:'Fixture Product',sku:'SKU'}];window.inventoryLocations=[];window.inventoryLots=[];
  window.inventoryOption=(id,label,selected=false)=>`<option value="${esc(id)}" ${selected?'selected':''}>${esc(label)}</option>`;
  window.inventoryProductChoice=p=>p.name;window.inventoryProductFromChoice=value=>products.find(p=>p.name===value);
  window.rows=[];window.lines=[];window.calls=[];window.loads=0;window.accountingAllowed=true;window.accessChecks=0;window.reads=[];
  window.client={from:table=>{
   const query={},filters=[];let bounds=null,limit=null,single=false;
   for(const method of ['select','order'])query[method]=()=>query;
   query.eq=(key,value)=>{filters.push([key,value]);return query};query.range=(start,end)=>{bounds=[start,end];return query};query.limit=value=>{limit=value;return query};query.single=()=>{single=true;return query};
   query.then=(ok,bad)=>{loads++;reads.push({table,filters,bounds,limit,single});let data=table==='sales_proformas'?rows:table==='sales_proforma_lines'?lines:[];data=data.filter(row=>filters.every(([key,value])=>row[key]===value));if(limit!==null)data=data.slice(0,limit);if(bounds)data=data.slice(bounds[0],bounds[1]+1);return Promise.resolve({data:structuredClone(single?data[0]:data)}).then(ok,bad)};return query;
  },rpc:async(name,args)=>{
   if(name==='accounting_access'){accessChecks++;return {data:accountingAllowed}}
   calls.push({name,args});if(window.delaySave)await new Promise(resolve=>window.releaseSave=resolve);
   if(window.saveError)return {error:{message:saveError}};
   if(window.invalidResponse)return {data:window.invalidResponse==='empty'?null:window.invalidResponse==='wrong-id'?{id:'different',version:1}:{id:args.p_id}};
   if(name==='advance_sales_proforma'){
    const row=rows.find(row=>row.id===args.p_id);row.status=args.p_action==='accept'?'accepted':args.p_action==='send'?'sent':'draft';row.version++;return {data:structuredClone(row)};
   }
   const row={id:args.p_id,version:args.p_expected_version+1,revision:args.p_expected_version+1,document_number:'PF-FIXTURE',status:'draft',organization_id:args.p_organization_id,contact_id:args.p_contact_id,currency:args.p_currency,valid_until:args.p_valid_until,delivery_period:args.p_delivery_period,payment_terms:args.p_payment_terms,notes:args.p_notes,subtotal_minor:10000,discount_minor:0,tax_minor:0,total_minor:10000};
   row.revision=(rows.find(r=>r.id===row.id)?.revision||0)+1;
   rows=rows.filter(r=>r.id!==row.id).concat(row);
   lines=args.p_lines.map((l,i)=>({id:'line-'+i,proforma_id:row.id,product_id:l.productId,sort_order:i,description:l.description,quantity:l.quantity,uom:l.uom,unit_price_minor:l.unitPriceMinor,discount_basis_points:l.discountBasisPoints,tax_basis_points:l.taxBasisPoints}));
   return {data:row};
  }};
 });
 for(const source of sources)await page.addScriptTag({content:source});
 await page.evaluate(()=>salesDeliveryWorkspace());return page;
}
async function fillEntry(p){
 await p.locator('#newProforma').click();
 await p.locator('[name="organizationId"]').selectOption('branch');await p.locator('[name="contactId"]').selectOption('contact');
 await p.locator('[name="productChoice"]').fill('Fixture Product');await p.locator('[name="description"]').fill('Fixture description');await p.locator('[name="unitPrice"]').fill('100.00');
}
async function save(p,count=1){await p.locator('#proformaForm [type="submit"]').click();await p.waitForFunction(count=>calls.length>=count&&pending===0,count)}
acceptance('Added proforma items can be removed immediately',async t=>{
 const p=await fixture(t);await fillEntry(p);await p.locator('#addSalesLine').click();
 assert.equal(await p.locator('[data-proforma-line]').count(),2);
 await p.locator('[data-remove-sales-line]').last().click();assert.equal(await p.locator('[data-proforma-line]').count(),1);
});
acceptance('Create retry retains its document ID and entered values after failed RPC',async t=>{
 const p=await fixture(t);await fillEntry(p);await p.evaluate(()=>window.saveError='Connection lost');await save(p);
 assert.equal(await p.locator('[name="description"]').inputValue(),'Fixture description');await save(p,2);
 const calls=await p.evaluate(()=>window.calls);assert.equal(calls[0].args.p_id,calls[1].args.p_id);
 assert.equal(calls[1].args.p_expected_version,0);
});
for(const invalid of ['empty','wrong-id','missing-version'])acceptance(`Unconfirmed save (${invalid}) preserves the editor`,async t=>{
 const p=await fixture(t);await fillEntry(p);await p.evaluate(value=>window.invalidResponse=value,invalid);await save(p);
 assert.equal(await p.locator('#proformaForm').count(),1);
 assert.equal(await p.locator('[name="description"]').inputValue(),'Fixture description');
 assert.doesNotMatch(await p.locator('#notice').innerText(),/saved with an immutable revision/i);
});
acceptance('Save disables submission while pending and restores it after failure',async t=>{
 const p=await fixture(t);await fillEntry(p);await p.evaluate(()=>{window.delaySave=true;window.saveError='Retry later'});
 await p.locator('#proformaForm [type="submit"]').click();await p.waitForFunction(()=>typeof releaseSave==='function');
 assert.equal(await p.locator('#proformaForm [type="submit"]').isDisabled(),true);
 await p.evaluate(()=>releaseSave());await p.waitForFunction(()=>pending===0);
 assert.equal(await p.locator('#proformaForm [type="submit"]').isDisabled(),false);
});
acceptance('Confirmed create closes editor and prints the saved document',async t=>{
 const p=await fixture(t);await fillEntry(p);await save(p);
 assert.equal(await p.locator('#proformaForm').count(),0);assert.equal(await p.locator('[data-document-card]').count(),1,await p.locator('#notice').innerText());assert.equal(await p.locator('[data-document-card] .heading h2').textContent(),'PF-FIXTURE');
 await p.evaluate(()=>window.print=()=>{window.printed=document.querySelector('.print-document')?.dataset.documentCard});
 await p.locator('[data-print-document]').click();assert.equal(await p.evaluate(()=>window.printed),await p.evaluate(()=>calls[0].args.p_id));
});
acceptance('Record-sent action acknowledges manual sending; accepted submission targets accounting',async t=>{
 const p=await fixture(t);await fillEntry(p);await save(p);
 assert.match(await p.locator('[data-proforma-action="send"]').textContent(),/record.*sent|mark.*sent/i);
 await p.locator('[data-proforma-action="send"]').click();assert.match(await p.locator('#actionFields').innerText(),/has been sent|already sent|sent.*yourself/i);
 await p.locator('#actionEditor [type="submit"]').click();await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 assert.equal((await p.locator('[data-proforma-action="accept"]').textContent()).trim(),'Submit to accounting');
 await p.locator('[data-proforma-action="accept"]').click();await p.locator('#actionFields [name="reference"]').fill('Customer LPO 42');
 await p.locator('#actionEditor [type="submit"]').click();await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 const call=await p.evaluate(()=>calls.at(-1));assert.equal(call.name,'advance_sales_proforma');assert.equal(call.args.p_action,'accept');assert.equal(call.args.p_reference,'Customer LPO 42');
});
acceptance('Sent proforma returns for revision and saves changes under its original document ID',async t=>{
 const p=await fixture(t);await fillEntry(p);await save(p);
 const original=await p.evaluate(()=>structuredClone(rows[0]));
 await p.locator('[data-proforma-action="send"]').click();await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 assert.equal(await p.locator('[data-edit-proforma]').count(),0);
 await p.locator('[data-proforma-action="revise"]').click();await p.locator('#actionFields [name="reference"]').fill('Customer requested revised quantity');
 await p.locator('#actionEditor [type="submit"]').click();await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 await p.locator('[data-edit-proforma]').click();assert.equal(await p.locator('[name="description"]').inputValue(),'Fixture description');
 await p.locator('[name="quantity"]').fill('3');await save(p,4);
 const result=await p.evaluate(()=>({rows,calls,lines}));assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].id,original.id);assert.equal(result.rows[0].revision,2);assert.equal(result.rows[0].version,4);
 assert.equal(result.calls[2].args.p_action,'revise');assert.equal(result.calls[2].args.p_reference,'Customer requested revised quantity');
 assert.equal(result.calls[3].args.p_id,original.id);assert.equal(result.calls[3].args.p_expected_version,3);assert.equal(result.calls[3].args.p_lines[0].quantity,3);
 assert.equal(await p.locator('[data-document-card]').count(),1);assert.match(await p.locator('[data-document-card]').innerText(),/Revision 2/);
});
acceptance('Stale save rejection preserves edited values and original expected version',async t=>{
 const p=await fixture(t);await fillEntry(p);await save(p);await p.locator('[data-edit-proforma]').click();
 await p.locator('[name="description"]').fill('Unconfirmed change');await p.evaluate(()=>window.saveError='Pro forma changed; refresh before saving');await save(p,2);
 assert.equal(await p.locator('[name="description"]').inputValue(),'Unconfirmed change');
 assert.match(await p.locator('#notice').innerText(),/Pro forma changed/);
 assert.equal(await p.locator('#proformaForm').getAttribute('data-version'),'1');
 assert.equal(await p.evaluate(()=>rows[0].revision),1);assert.equal(await p.locator('#proformaForm [type="submit"]').isEnabled(),true);
});
for(const changed of ['actor','view'])acceptance(`Pending save cannot overwrite replacement page after ${changed} changes`,async t=>{
 const p=await fixture(t);await fillEntry(p);await p.evaluate(()=>window.delaySave=true);
 await p.locator('#proformaForm [type="submit"]').click();await p.waitForFunction(()=>typeof releaseSave==='function');
 const loads=await p.evaluate(()=>window.loads);
 await p.evaluate(changed=>{if(changed==='actor')me={user_id:'other',role:'staff'};else view='personal';$('#content').textContent='Replacement page';$('#notice').textContent='Replacement notice';releaseSave()},changed);
 await p.waitForFunction(()=>pending===0);
 assert.equal(await p.locator('#content').innerText(),'Replacement page');assert.equal(await p.locator('#notice').innerText(),'Replacement notice');assert.equal(await p.evaluate(()=>window.loads),loads);
});
acceptance('Print failure clears the temporary print selection',async t=>{
 const p=await fixture(t);await fillEntry(p);await save(p);
 const error=await p.evaluate(()=>{window.print=()=>{throw Error('Fixture print failure')};try{printSalesDocument(rows[0].id)}catch(error){return error.message}});
 assert.equal(error,'Fixture print failure');assert.equal(await p.locator('.print-document').count(),0);
});
acceptance('Accounting opens accepted persisted proforma from the queue with its print action',async t=>{
 const p=await fixture(t);await fillEntry(p);await save(p);
 const id=await p.evaluate(async()=>{rows[0].status='accepted';rows[0].acceptance_reference='LPO 42';rows[0].accepted_at='2026-09-25T10:00:00Z';rows.push({...rows[0],id:'draft-other',status:'draft',document_number:'PF-DRAFT'});view='accounting';await accountingWorkspace();return rows[0].id});
 assert.equal(await p.locator('#proformaAccountingQueue [data-proforma-accounting-open]').count(),1);
 assert.match(await p.locator('#proformaAccountingQueue').innerText(),/PF-FIXTURE/);assert.doesNotMatch(await p.locator('#proformaAccountingQueue').innerText(),/PF-DRAFT/);
 assert.match(await p.locator('#proformaAccountingQueue').innerText(),/LPO 42/);
 await p.locator('[data-proforma-accounting-open]').click();await p.waitForFunction(()=>pending===0&&view==='sales');
 const card=p.locator(`[data-document-card="${id}"]`);assert.equal(await card.count(),1);assert.equal(await card.locator('[data-print-document]').getAttribute('data-print-document'),id);
 assert.match(await card.innerText(),/PF-FIXTURE/);assert.match(await card.innerText(),/LPO 42/);assert.match(await card.locator('.company-form-brand').innerText(),/ANUDHA LIMITED/);
 assert.equal(await p.evaluate(()=>calls.length),1);assert.ok(await p.evaluate(()=>accessChecks>=3));
 assert.ok(await p.evaluate(()=>reads.some(read=>read.table==='sales_proformas'&&read.filters.some(([key,value])=>key==='status'&&value==='accepted'))));
});
acceptance('Denied accounting membership stops all accounting and queue data reads',async t=>{
 const p=await fixture(t);const result=await p.evaluate(async()=>{view='accounting';accountingAllowed=false;const before=loads;let error;try{await accountingWorkspace()}catch(e){error=e.message}return {before,after:loads,error}});
 assert.equal(result.after,result.before);assert.match(result.error,/restricted to approved financial users/);
 assert.equal(await p.locator('#proformaAccountingQueue').count(),0);
});
acceptance('Queue and opened record escape malicious customer names and acceptance references',async t=>{
 const p=await fixture(t);await fillEntry(p);await save(p);
 const malicious='<img id="injected" src=x onerror="window.injected=true"><script>window.injected=true</script>';
 await p.evaluate(async malicious=>{organizations[0].name=malicious;rows[0].status='accepted';rows[0].acceptance_reference=malicious;view='accounting';await accountingWorkspace()},malicious);
 assert.ok((await p.locator('#proformaAccountingQueue').innerText()).includes(malicious));
 assert.equal(await p.locator('#content script, #injected').count(),0);assert.equal(await p.evaluate(()=>window.injected),undefined);
 await p.locator('[data-proforma-accounting-open]').click();await p.waitForFunction(()=>pending===0&&view==='sales');
 assert.ok((await p.locator('[data-document-card]').innerText()).includes(malicious));assert.equal(await p.locator('#content script, #injected').count(),0);assert.equal(await p.evaluate(()=>window.injected),undefined);
});
