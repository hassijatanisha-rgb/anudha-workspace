import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
 await page.setContent('<main><h1>Product lookup check</h1><form id="productForm"><label><span>Product</span><input name="productChoice" list="products" placeholder="Start typing a product" required></label><datalist id="products" data-lookup-values="products"></datalist><button>Save</button><button type="reset">Reset</button></form><form id="ordinary"><label><span>Client</span><select name="client" data-lookup required><option value="">Choose client</option><option value="hospital">Hospital</option><option value="clinic">Clinic</option></select></label><label><span>Reference</span><input name="reference" list="references"></label><datalist id="references"><option value="REF-001">Order one</option></datalist></form></main>');
 for(const file of ['style.css','ui-polish.css'])await page.addStyleTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  window.fixtureProducts=[
   {id:'00000000-0000-4000-8000-000000000001',name:'CRP reagent',sku:'R-XL200',source:{company:'Acme',specification:'For XL-200 chemistry analyzer',category:'reagents'}},
   {id:'00000000-0000-4000-8000-000000000002',name:'Chemistry analyzer',sku:'M-002',source:{company:'Acme',model:'XL-200',category:'machines'}},
   {id:'00000000-0000-4000-8000-000000000003',name:'<img src=x onerror="window.injected=true"> pump',sku:'M-003',source:{company:'Acme',model:'DP10',category:'machines'}},
   {id:'00000000-0000-4000-8000-000000000004',name:'Pump',sku:'M-004',source:{company:'Acme',model:'DP100',category:'machines'}}
  ];
  window.inventorySelectableProducts=()=>fixtureProducts;
  window.inventoryClassification=()=>undefined;
  window.catalogCategoryOf=product=>product.source.category;
  window.catalogLabel=category=>({machines:'Machines',reagents:'Reagents'}[category]);
  window.inventoryProductIdentity=product=>`${product.name} · ${product.source.company} · ${product.source.specification||product.source.model} · ${product.sku}`;
  window.inventoryProductChoice=product=>`${inventoryProductIdentity(product)} · ${product.id}`;
  window.inventoryProductFromChoice=value=>fixtureProducts.find(product=>inventoryProductChoice(product)===value);
  window.productEvents=[];window.submitted=0;
  const form=document.querySelector('#productForm');for(const type of ['input','change'])form.addEventListener(type,event=>{if(event.target.name==='productChoice')productEvents.push([type,event.target.value]);});
  form.addEventListener('submit',event=>{event.preventDefault();submitted++;});
 });
 await page.addScriptTag({content:readFileSync(new URL('../smart-lookup.js',import.meta.url),'utf8')});await page.evaluate(()=>lookupScan());
 const source=page.locator('#productForm [name=productChoice]'),input=page.locator('#productForm .lookup-input'),options=page.locator('#productForm .lookup-list li[data-i]');
 const machine=await page.evaluate(()=>inventoryProductChoice(fixtureProducts[1]));
 assert.equal(await source.isVisible(),false);assert.equal(await input.getAttribute('aria-label'),'Product');assert.equal(await input.getAttribute('name'),null);
 await input.fill('XL200');await page.waitForFunction(()=>document.querySelectorAll('#productForm .lookup-list li[data-i]').length===2);
 assert.equal(await options.count(),2);assert.match(await options.first().innerText(),/^Chemistry analyzer.*Machines$/);await input.press('Enter');
 assert.equal(await source.inputValue(),machine);assert.equal(await input.inputValue(),'Chemistry analyzer · Acme · XL-200 · M-002 · Machines');
 assert.deepEqual(await page.evaluate(()=>productEvents),[['input',machine],['change',machine]]);
 assert.deepEqual(await page.evaluate(()=>new FormData(document.querySelector('#productForm')).getAll('productChoice')),[machine]);
 await page.locator('#productForm button').first().click();assert.equal(await page.evaluate(()=>submitted),1);
 console.log('PASS: keyboard selection shows a human label and serializes the unchanged canonical product once');

 await input.fill('DP10');assert.equal(await source.inputValue(),'');await page.waitForFunction(()=>document.querySelectorAll('#productForm .lookup-list li[data-i]').length===1);
 assert.equal(await options.count(),1);assert.equal(await page.locator('#productForm .lookup-list img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
 await options.first().click();assert.match(await input.inputValue(),/DP10.*Machines$/);assert.ok(!(await input.inputValue()).includes('00000000'));
 await input.fill('unknown product');await input.press('Tab');await page.waitForTimeout(175);assert.equal(await input.inputValue(),'unknown product');
 assert.equal(await page.evaluate(()=>document.querySelector('#productForm').reportValidity()),false);assert.equal(await input.evaluate(el=>document.activeElement===el),true);
 assert.equal(await source.inputValue(),'');assert.equal(await input.evaluate(el=>el.validationMessage),'Choose one from the list');assert.equal(await page.evaluate(()=>submitted),1);
 console.log('PASS: typing clears selection; unmatched text remains editable and native required validation focuses the visible control');

 await source.evaluate((el,value)=>{el.setCustomValidity('No configured TZS price for this product. Ask accounting to set its price.');el.value=value;},machine);
 assert.equal(await input.inputValue(),'Chemistry analyzer · Acme · XL-200 · M-002 · Machines');
 assert.equal(await input.evaluate(el=>el.validationMessage),await source.evaluate(el=>el.validationMessage));
 await page.evaluate(()=>document.querySelector('#productForm').reportValidity());assert.equal(await input.evaluate(el=>document.activeElement===el),true);
 await source.evaluate(el=>el.setCustomValidity(''));assert.equal(await input.evaluate(el=>el.validationMessage),'');
 await source.evaluate(el=>el.disabled=true);await page.waitForFunction(()=>document.querySelector('#productForm .lookup-input').disabled);await source.evaluate(el=>el.disabled=false);await page.waitForFunction(()=>!document.querySelector('#productForm .lookup-input').disabled);
 await source.evaluate((el,value)=>el.defaultValue=value,machine);await input.fill('changed query');await input.press('Escape');await page.locator('#productForm [type=reset]').click();await page.waitForFunction(()=>document.querySelector('#productForm .lookup-input').value.startsWith('Chemistry analyzer'));
 assert.equal(await source.inputValue(),machine);assert.equal(await input.evaluate(el=>el.validationMessage),'');
 console.log('PASS: exact custom error forwarding, programmatic draft updates, disabled state and native form reset');
 await input.fill('DP100');await input.press('Enter');assert.match(await source.inputValue(),/DP100/);await page.waitForTimeout(80);assert.equal(await page.locator('#productForm .lookup-list').isVisible(),false);
 console.log('PASS: immediate Enter uses the current query and pending searches cannot reopen a completed selection');

 const clientInput=page.locator('#ordinary select').locator('..').locator('.lookup-input');await clientInput.fill('Clinic');await page.waitForTimeout(80);await clientInput.press('Enter');assert.equal(await page.locator('#ordinary select').inputValue(),'clinic');assert.equal(await clientInput.inputValue(),'Clinic');
 const reference=page.locator('[name=reference]');await reference.fill('REF');await page.waitForTimeout(80);await reference.press('Enter');assert.equal(await reference.inputValue(),'REF-001');
 console.log('PASS: ordinary select and free-text datalist retain their existing value behavior');

 await page.evaluate(()=>{window.me={user_id:'sales',role:'staff'};window.esc=value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');});
 for(const file of ['ui-page-header.js','sales-domain.js','product-pricing.js'])await page.addScriptTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  productPricingActor=me;productSalePrices=new Map([[pricingKey(fixtureProducts[1].id,'TZS'),{unit_price_minor:10000}]]);
  const form=document.createElement('form');form.id='pricingForm';form.innerHTML='<div id="pricingHelp"></div><select name="currency"><option>TZS</option></select><div data-proforma-line><label><span>Quoted product</span><input name="productChoice" list="pricingProducts" required></label><input name="quantity" type="number" value="1" required>'+pricingLineFields()+'</div><datalist id="pricingProducts" data-lookup-values="products"></datalist><button>Save quote</button>';
  document.querySelector('main').append(form);pricingBindForm(form);lookupScan();
 });
 const quoteInput=page.locator('#pricingForm .lookup-input');await quoteInput.fill('CRP');await page.waitForTimeout(80);await quoteInput.press('Enter');
 const pricingError='No configured TZS price for this product. Ask the owner or accounting to set its price.';
 assert.equal(await quoteInput.evaluate(el=>el.validationMessage),pricingError);assert.equal(await page.evaluate(()=>document.querySelector('#pricingForm').reportValidity()),false);assert.equal(await quoteInput.evaluate(el=>document.activeElement===el),true);
 await quoteInput.press('Tab');await page.waitForTimeout(175);assert.equal(await quoteInput.evaluate(el=>el.validationMessage),pricingError);
 await quoteInput.fill('XL200');await page.waitForTimeout(80);await quoteInput.press('Enter');assert.equal(await quoteInput.evaluate(el=>el.validationMessage),'');assert.equal(await page.locator('#pricingForm [name=unitPrice]').inputValue(),'100.00');
 assert.equal(await page.evaluate(()=>document.querySelector('#pricingForm').checkValidity()),true);
 console.log('PASS: real pricingBindForm error reaches the visible product field; choosing a priced product clears it and sets the configured price');

 await page.setViewportSize({width:390,height:900});await quoteInput.fill('XL200');await page.waitForTimeout(80);await quoteInput.scrollIntoViewIfNeeded();
 assert.ok(await quoteInput.evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;}));
 assert.ok(await quoteInput.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'||getComputedStyle(el).boxShadow!=='none'));
 if(process.env.LOOKUP_SCREENSHOT)await page.screenshot({path:process.env.LOOKUP_SCREENSHOT});
 assert.deepEqual(errors,[]);console.log('PASS: narrow screen control fits, keyboard focus remains visible, and no browser errors');
}finally{await browser.close();}
