import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const enabled=process.env.PROFORMA_BROWSER_QA==='1';
const sources=['sales-domain.js','sales-delivery.js','action-forms.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
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
  window.companyFormBrand=()=>'<div>Fixture company brand</div>';
  window.organizations=[{id:'branch',name:'Fixture Hospital',location:'Dar'}];window.orgIndex=new Map(organizations.map(row=>[row.id,row]));
  window.contacts=[{id:'contact',organization_id:'branch',first_name:'Named',last_name:'Contact',status:'valid'}];
  window.products=[{id:'product',name:'Fixture Product',sku:'SKU'}];window.inventoryLocations=[];window.inventoryLots=[];
  window.inventoryOption=(id,label,selected=false)=>`<option value="${esc(id)}" ${selected?'selected':''}>${esc(label)}</option>`;
  window.inventoryProductChoice=p=>p.name;window.inventoryProductFromChoice=value=>products.find(p=>p.name===value);
  window.rows=[];window.lines=[];window.calls=[];
  window.client={from:table=>{
   const query={};for(const method of ['select','order','limit'])query[method]=()=>query;
   query.then=(ok,bad)=>Promise.resolve({data:structuredClone(table==='sales_proformas'?rows:table==='sales_proforma_lines'?lines:[])}).then(ok,bad);return query;
  },rpc:async(name,args)=>{
   calls.push({name,args});if(window.delaySave)await new Promise(resolve=>window.releaseSave=resolve);
   if(window.saveError)return {error:{message:saveError}};
   if(window.invalidResponse)return {data:window.invalidResponse==='empty'?null:window.invalidResponse==='wrong-id'?{id:'different',version:1}:{id:args.p_id}};
   if(name==='advance_sales_proforma'){
    const row=rows.find(row=>row.id===args.p_id);row.status=args.p_action==='accept'?'accepted':args.p_action==='send'?'sent':'draft';row.version++;return {data:structuredClone(row)};
   }
   const row={id:args.p_id,version:args.p_expected_version+1,revision:args.p_expected_version+1,document_number:'PF-FIXTURE',status:'draft',organization_id:args.p_organization_id,contact_id:args.p_contact_id,currency:args.p_currency,valid_until:args.p_valid_until,delivery_period:args.p_delivery_period,payment_terms:args.p_payment_terms,notes:args.p_notes,subtotal_minor:10000,discount_minor:0,tax_minor:0,total_minor:10000};
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
