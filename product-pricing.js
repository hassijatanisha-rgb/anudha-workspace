'use strict';
// Prices are configured separately from quotes; the database also enforces the configured base price.
let productSalePrices=new Map(),productPricingActor=null,productPricingEpoch=0,productPriceViewEpoch=0;
function clearProductPricing(){productPricingEpoch++;productPriceViewEpoch++;productSalePrices.clear();productPricingActor=null;}
function pricingKey(productId,currency){return `${productId}:${currency}`;}
function pricingMinorText(minor){const amount=BigInt(minor);return `${amount/100n}.${String(amount%100n).padStart(2,'0')}`;}
async function pricingLoad(){
 const actor=me,epoch=++productPricingEpoch,rows=[];
 if(!actor?.user_id)throw Error('Sign in before loading product prices.');
 for(let offset=0;;offset+=1000){
  const result=await client.from('product_sale_prices').select('product_id,currency,unit_price_minor,version,updated_by,updated_at').order('product_id').order('currency').range(offset,offset+999);
  if(me!==actor||epoch!==productPricingEpoch)return null;
  if(result.error)throw Error(`Product prices could not load: ${result.error.message}`);
  rows.push(...(result.data||[]));if((result.data||[]).length<1000)break;
 }
 productSalePrices=new Map(rows.map(row=>[pricingKey(row.product_id,row.currency),row]));productPricingActor=actor;return rows;
}
function pricingDiscount(quantity,unitPriceMinor,mode,value){
 if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(unitPriceMinor)||unitPriceMinor<0)throw Error('Enter a valid quantity and configured unit price.');
 const gross=BigInt(quantity)*BigInt(unitPriceMinor);
 if(gross>9000000000000000n)throw Error('Line total is too large.');
 let basisPoints,requested;
 if(mode==='amount'){
  requested=BigInt(moneyMinor(value));if(requested>gross)throw Error('Discount amount cannot exceed the line subtotal.');
  basisPoints=gross===0n?0n:(requested*10000n+gross/2n)/gross;
 }else{
  basisPoints=BigInt(moneyMinor(value));if(basisPoints>10000n)throw Error('Discount must be between 0% and 100%.');
 }
 const actual=(gross*basisPoints+5000n)/10000n;
 if(mode==='amount'&&actual!==requested)throw Error(`This exact discount cannot be represented in 0.01% steps. The nearest percentage (${Number(basisPoints)/100}%) gives ${pricingMinorText(actual)}. Enter a percentage or a representable amount.`);
 return {discountBasisPoints:Number(basisPoints),discountMinor:Number(actual),grossMinor:Number(gross)};
}
function pricingLineFields(line={}){
 const price=line.unit_price_minor===undefined?'':pricingMinorText(line.unit_price_minor),discount=(line.discount_basis_points||0)/100;
 return `<label><span>Configured unit price</span><input name="unitPrice" inputmode="decimal" value="${esc(price)}" readonly required aria-describedby="pricingHelp"></label><label><span>Discount entry</span><select name="discountMode"><option value="percent">Percentage</option><option value="amount">Amount for this line</option></select></label><label data-discount-percent><span>Discount %</span><input name="discount" type="number" min="0" max="100" step="0.01" value="${esc(discount)}" required></label><label data-discount-amount hidden><span>Discount amount for this line</span><input name="discountAmount" inputmode="decimal" value="" disabled></label><small data-pricing-feedback role="status"></small>`;
}
function pricingExpectedPrice(row,form){
 if(productPricingActor!==me)throw Error('Product prices are not loaded for this login. Refresh before quoting.');
 const product=inventoryProductFromChoice(row.querySelector('[name="productChoice"]').value);
 if(!product)throw Error('Choose the product from the search suggestions.');
 if(form.querySelector('[name="commercialKind"]')?.value==='placement')return 0;
 const currency=form.querySelector('[name="currency"]').value,price=productSalePrices.get(pricingKey(product.id,currency));
 if(!price)throw Error(`No configured ${currency} price for this product. Ask the owner or accounting to set its price.`);
 const value=Number(price.unit_price_minor);if(!Number.isSafeInteger(value)||value<0)throw Error('Configured price is invalid. Ask accounting to review it.');
 return value;
}
function pricingReadLine(row,{quantity,unitPriceMinor}){
 const expected=pricingExpectedPrice(row,row.closest('form'));
 if(unitPriceMinor!==expected)throw Error('The configured price changed. Refresh before saving the quote.');
 const mode=row.querySelector('[name="discountMode"]').value,input=row.querySelector(mode==='amount'?'[name="discountAmount"]':'[name="discount"]');
 const discount=pricingDiscount(quantity,unitPriceMinor,mode,input.value);
 row.querySelector('[name="discount"]').value=String(discount.discountBasisPoints/100);
 return {unitPriceMinor,discountBasisPoints:discount.discountBasisPoints};
}
function pricingRefreshRow(row,form,{replacePrice=true}={}){
 const unit=row.querySelector('[name="unitPrice"]'),percent=row.querySelector('[name="discount"]'),amount=row.querySelector('[name="discountAmount"]'),mode=row.querySelector('[name="discountMode"]').value,feedback=row.querySelector('[data-pricing-feedback]');
 row.querySelector('[data-discount-percent]').hidden=mode==='amount';row.querySelector('[data-discount-amount]').hidden=mode!=='amount';amount.disabled=mode!=='amount';percent.readOnly=mode==='amount';
 unit.readOnly=true;unit.setCustomValidity('');percent.setCustomValidity('');amount.setCustomValidity('');
 try{
  const expected=pricingExpectedPrice(row,form);
  if(replacePrice)unit.value=pricingMinorText(expected);
  else if(moneyMinor(unit.value)!==expected)throw Error('Saved unit price differs from the configured price. Re-select the product to use its current price.');
  const discount=pricingDiscount(Number(row.querySelector('[name="quantity"]').value),expected,mode,mode==='amount'?amount.value:percent.value);
  if(mode==='amount')percent.value=String(discount.discountBasisPoints/100);
  const currency=form.querySelector('[name="currency"]').value;
  feedback.textContent=`Actual discount: ${moneyDisplay(discount.discountMinor,currency)} (${discount.discountBasisPoints/100}%). ${discount.discountBasisPoints>1000?'Owner approval required.':discount.discountBasisPoints>0?'Department head or owner approval required.':'No discount.'}`;
 }catch(error){
  if(replacePrice){try{pricingExpectedPrice(row,form);}catch{unit.value='';}}
  const invalid=mode==='amount'?amount:percent;invalid.setCustomValidity(error.message);feedback.textContent=error.message;
 }
}
function pricingRefreshForm(form){for(const row of form.querySelectorAll('[data-proforma-line]'))pricingRefreshRow(row,form);}
function pricingBindForm(form){
 if(!form||form.dataset.pricingBound)return;form.dataset.pricingBound='true';
 if(!form.querySelector('#pricingHelp')){const help=document.createElement('p');help.id='pricingHelp';help.className='muted';help.textContent='Unit prices come from the central price list. Discounts may be entered as a percentage or an amount for the whole line. Exact amounts must fit a 0.01% step; the actual rounded discount is shown.';form.querySelector('#proformaLines').before(help);}
 // Preserve a saved historical base price until the seller explicitly selects the product again.
 for(const row of form.querySelectorAll('[data-proforma-line]'))pricingRefreshRow(row,form,{replacePrice:!row.querySelector('[name="unitPrice"]').value});
 form.addEventListener('change',event=>{
  if(['currency','commercialKind'].includes(event.target.name)){pricingRefreshForm(form);return;}
  const row=event.target.closest('[data-proforma-line]');if(!row)return;
  if(event.target.name==='discountMode'&&event.target.value==='amount'){
   try{const value=pricingDiscount(Number(row.querySelector('[name="quantity"]').value),moneyMinor(row.querySelector('[name="unitPrice"]').value),'percent',row.querySelector('[name="discount"]').value);row.querySelector('[name="discountAmount"]').value=pricingMinorText(value.discountMinor);}catch{}
  }
  if(['productChoice','discountMode'].includes(event.target.name))pricingRefreshRow(row,form,{replacePrice:event.target.name==='productChoice'});
 });
 form.addEventListener('input',event=>{const row=event.target.closest('[data-proforma-line]');if(row&&['quantity','discount','discountAmount'].includes(event.target.name))pricingRefreshRow(row,form,{replacePrice:false});});
}
async function pricesWorkspace(target=$('#content')){
 const actor=me,epoch=++productPriceViewEpoch,current=()=>me===actor&&view==='prices'&&epoch===productPriceViewEpoch&&target.isConnected;
 if(!current())return;target.innerHTML='<p role="status">Loading product prices…</p>';
 const [rows,access]=await Promise.all([pricingLoad(),client.rpc('accounting_access')]);
 if(!current()||rows===null)return;
 const canEdit=actor.role==='owner'||(!access.error&&access.data===true);
 target.innerHTML=`<section class="card"><div class="heading"><div><h1>Product prices</h1><p>Prices are configured per product and currency. Sales staff use these base prices and request approval for discounts.</p></div><button type="button" data-pricing-reload>Refresh</button></div>${canEdit?`<form data-price-editor><div class="grid"><label><span>Product</span><input name="productChoice" list="pricingProductChoices" required autocomplete="off" placeholder="Choose a product"></label><datalist id="pricingProductChoices" data-lookup-values="products">${salesProductChoices()}</datalist><label><span>Currency</span><select name="currency"><option>TZS</option><option>USD</option><option>EUR</option></select></label><label><span>Configured unit price</span><input name="price" inputmode="decimal" required></label><label><span>Reason</span><textarea name="reason" minlength="2" maxlength="1000" required></textarea></label></div><p data-price-current class="muted">Choose a product. Enter zero explicitly only when it is the approved price.</p><button type="submit">Save configured price</button></form>`:'<p class="muted">Only the owner or approved accounting users can change prices.</p>'}<label><span>Find configured price</span><input data-price-search type="search" placeholder="Product or currency"></label><div data-price-register></div></section>`;
 const register=target.querySelector('[data-price-register]'),search=target.querySelector('[data-price-search]');
 const draw=()=>{const query=search.value.trim().toLowerCase(),shown=rows.filter(row=>`${salesProduct(row.product_id).name} ${row.currency}`.toLowerCase().includes(query));register.innerHTML=`<p>${shown.length} configured prices${shown.length>100?' · showing the first 100; narrow your search':''}</p><div class="table-wrap"><table><thead><tr><th>Product</th><th>Currency</th><th>Price</th><th>Updated</th></tr></thead><tbody>${shown.slice(0,100).map(row=>`<tr><td>${esc(salesProduct(row.product_id).name)}</td><td>${esc(row.currency)}</td><td>${esc(moneyDisplay(Number(row.unit_price_minor),row.currency))}</td><td>${esc(employeeName(row.updated_by))} · ${esc(new Date(row.updated_at).toLocaleString())}</td></tr>`).join('')}</tbody></table></div>`;};
 search.oninput=draw;draw();target.querySelector('[data-pricing-reload]').onclick=()=>run(()=>pricesWorkspace(target));
 const form=target.querySelector('[data-price-editor]');if(!form)return;
 if(typeof bindProductPriceImport==='function')bindProductPriceImport(target,current);
 let selected=null,request=null;
 const choose=()=>{const product=inventoryProductFromChoice(form.elements.productChoice.value),currency=form.elements.currency.value;selected=product?{product,currency,current:productSalePrices.get(pricingKey(product.id,currency))}:null;request=null;form.elements.price.value=selected?.current?pricingMinorText(selected.current.unit_price_minor):'';form.querySelector('[data-price-current]').textContent=selected?(selected.current?`Current version ${selected.current.version}. Saving retains the previous price in history.`:'No price configured for this product and currency.'): 'Choose a product from the suggestions.';};
 form.addEventListener('change',event=>{if(['productChoice','currency'].includes(event.target.name))choose();});
 form.onsubmit=event=>{event.preventDefault();run(async()=>{
  if(!current()||!form.isConnected)throw Error('Login or price view changed. Reopen product prices.');
  if(form.dataset.saving==='true')return;
  const product=inventoryProductFromChoice(form.elements.productChoice.value),currency=form.elements.currency.value;
  if(!selected||selected.product.id!==product?.id||selected.currency!==currency)throw Error('Choose the product and currency before saving.');
  const price=moneyMinor(form.elements.price.value),reason=form.elements.reason.value.trim();
  const key=JSON.stringify([product.id,currency,selected.current?.version||0,price,reason]);if(request&&request.key!==key)throw Error('A previous save was not confirmed. Retry its original values or refresh before changing the price.');
  request ||= {key,id:crypto.randomUUID()};form.dataset.saving='true';const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
   const result=await client.rpc('set_product_sale_price',{p_request_id:request.id,p_product_id:product.id,p_currency:currency,p_expected_version:selected.current?.version||0,p_unit_price_minor:price,p_reason:reason});
   if(!current()||!form.isConnected)return;if(result.error)throw Error(result.error.message);
   await pricesWorkspace(target);if(me===actor&&view==='prices'&&target.isConnected)message('Configured product price saved with history.');
  }finally{form.dataset.saving='false';button.disabled=false;}
 });};
}
