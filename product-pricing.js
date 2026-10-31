'use strict';
// Prices are configured separately from quotes; the database also enforces the configured base price.
let productSalePrices=new Map(),productPricingActor=null,productPricingEpoch=0,productPriceViewEpoch=0;
let productPricePageActor=null,productPricePageData=null,productPricePage=0,productPriceSearch='',productPriceCurrency='',productPriceStatus='configured',productPriceDetail=null,productPriceDetailEpoch=0;
function clearProductPricing(){productPricingEpoch++;productPriceViewEpoch++;productPriceDetailEpoch++;productSalePrices.clear();productPricingActor=null;productPricePageActor=null;productPricePageData=null;productPricePage=0;productPriceSearch='';productPriceCurrency='';productPriceStatus='configured';productPriceDetail=null;}
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
 const product=row.querySelector('[name="productChoice"]'),unit=row.querySelector('[name="unitPrice"]'),quantity=row.querySelector('[name="quantity"]'),percent=row.querySelector('[name="discount"]'),amount=row.querySelector('[name="discountAmount"]'),mode=row.querySelector('[name="discountMode"]').value,feedback=row.querySelector('[data-pricing-feedback]');
 row.querySelector('[data-discount-percent]').hidden=mode==='amount';row.querySelector('[data-discount-amount]').hidden=mode!=='amount';amount.disabled=mode!=='amount';percent.readOnly=mode==='amount';
 unit.readOnly=true;product.setCustomValidity('');unit.setCustomValidity('');quantity.setCustomValidity('');percent.setCustomValidity('');amount.setCustomValidity('');
 if(!Number.isSafeInteger(Number(quantity.value))||Number(quantity.value)<1)quantity.setCustomValidity('Every quantity must be a positive whole number.');
 let expected;
 try{
  expected=pricingExpectedPrice(row,form);
  if(replacePrice)unit.value=pricingMinorText(expected);
  else if(moneyMinor(unit.value)!==expected)throw Error('Saved unit price differs from the configured price. Re-select the product to use its current price.');
 }catch(error){
  if(replacePrice)unit.value='';
  // A readonly price cannot receive native validation focus; its selected product can.
  product.setCustomValidity(error.message);feedback.textContent=error.message;return;
 }
 if(quantity.validationMessage){feedback.textContent=quantity.validationMessage;return;}
 try{
  const discount=pricingDiscount(Number(quantity.value),expected,mode,mode==='amount'?amount.value:percent.value);
  if(mode==='amount')percent.value=String(discount.discountBasisPoints/100);
  const currency=form.querySelector('[name="currency"]').value;
  feedback.textContent=`Actual discount: ${moneyDisplay(discount.discountMinor,currency)} (${discount.discountBasisPoints/100}%). ${discount.discountBasisPoints>1000?'Owner approval required.':discount.discountBasisPoints>0?'Department head or owner approval required.':'No discount.'}`;
 }catch(error){
  const invalid=mode==='amount'?amount:percent;invalid.setCustomValidity(error.message);feedback.textContent=error.message;
 }
}
function pricingRefreshForm(form){for(const row of form.querySelectorAll('[data-proforma-line]'))pricingRefreshRow(row,form);}
function pricingBindForm(form){
 if(!form||form.dataset.pricingBound)return;form.dataset.pricingBound='true';
 if(!form.querySelector('#pricingHelp')){
  const help=document.createElement('div');help.id='pricingHelp';help.className='notice';
  help.innerHTML='<p>Unit prices come from Product prices. If a price is missing, ask Accounts to configure it, then refresh prices here. Your draft stays open. Discounts apply to the whole line; the actual rounded amount is shown.</p><div class="actions"><a class="button" href="#/go/prices" target="_blank" rel="noopener">Open product prices in a new tab</a><button type="button" data-refresh-quote-prices>Refresh prices in this draft</button></div><p data-quote-price-status role="status"></p>';
  form.querySelector('#proformaLines').before(help);
  const button=help.querySelector('[data-refresh-quote-prices]'),status=help.querySelector('[data-quote-price-status]');
  button.onclick=()=>run(async()=>{
   const actor=me;button.disabled=true;status.textContent='Loading current prices…';
   try{const rows=await pricingLoad();if(me!==actor||!form.isConnected||rows===null)return;
    // Fill missing prices only. A saved price changes only after explicit product selection.
    for(const row of form.querySelectorAll('[data-proforma-line]'))pricingRefreshRow(row,form,{replacePrice:!row.querySelector('[name="unitPrice"]').value});
    status.textContent='Prices refreshed. Existing prices and entered quantities were preserved; review any price-change messages.';
   }catch(error){if(me===actor&&form.isConnected)status.textContent=error.message;}finally{button.disabled=false;}
  });
 }
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
function pricingInputMinor(value){
 const text=String(value??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text)||text.length>32)throw Error('Enter a valid amount with no more than two decimal places.');
 const [whole,fraction='']=text.split('.'),minor=BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));if(minor>9000000000000000n)throw Error('Amount is too large.');return Number(minor);
}
function pricingEditorAmount(value){
 const text=String(value??'').trim();return text.length<=48&&/^(?:\d*|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?$/.test(text)?text.replaceAll(',',''):null;
}
function pricingEditorAmountText(value){const [whole,fraction]=value.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);}
function pricingEditorFieldError(control,selectedCurrency){
 control=fieldValidationSource(control);if(!control.willValidate)return '';
 const native=nativeFieldError(control);if(native)return native;
 if(control.name==='price'){try{pricingInputMinor(pricingEditorAmount(control.value)??control.value);}catch(error){return error.message;}}
 if(control.name==='currency'&&(!['TZS','USD','EUR'].includes(control.value)||control.value!==selectedCurrency))return 'Choose the currency before saving.';
 if(control.name==='reason'){const reason=control.value.trim();if(reason.length<2||reason.length>1000)return 'Write the reason for this price (2 to 1000 characters).';}
 return '';
}
function pricingEditorFormErrors(form,selectedCurrency){
 const errors=nativeFormErrors(form);
 for(const control of form.querySelectorAll('input,select,textarea')){if(fieldValidationSource(control)!==control)continue;const problem=pricingEditorFieldError(control,selectedCurrency);if(problem)errors.set(control,problem);}
 return errors;
}
function pricingBindEditorAmount(input,current){
 let edit=null,composing=false;
 const capture=type=>({value:input.value,start:input.selectionStart,end:input.selectionEnd,type});
 const format=()=>{
  if(!current())return;
  const value=input.value;let amount=pricingEditorAmount(value);
  // Regroup only a known edit of a valid display; malformed pasted separators stay visible.
  if(amount===null&&edit&&pricingEditorAmount(edit.value)!==null){
   let validEdit=false;
   if(/^delete/.test(edit.type||'')){let first=0;while(first<value.length&&value[first]===edit.value[first])first++;const removed=edit.value.length-value.length;validEdit=removed>0&&value===edit.value.slice(0,first)+edit.value.slice(first+removed);}
   else if(/^(?:insertText|insertFromPaste|insertFromDrop|insertReplacementText|insertCompositionText)$/.test(edit.type||'')){
    const prefix=edit.value.slice(0,edit.start),suffix=edit.value.slice(edit.end),end=value.length-suffix.length;
    validEdit=end>=prefix.length&&value.startsWith(prefix)&&value.endsWith(suffix)&&pricingEditorAmount(value.slice(prefix.length,end))!==null;
   }
   if(validEdit)amount=pricingEditorAmount(value.replaceAll(',',''));
  }
  const deletedComma=edit?.type==='deleteContentForward'&&edit.start===edit.end&&edit.value[edit.start]===',';edit=null;if(amount===null||value!==value.trim())return;
  const next=pricingEditorAmountText(amount);if(next===value)return;
  const offset=position=>value.slice(0,position).replaceAll(',','').length,position=offset=>{let index=0,count=0;while(index<next.length&&count<offset){if(next[index]!==',')count++;index++;}return index;};
  let start=position(offset(input.selectionStart)),end=position(offset(input.selectionEnd));const direction=input.selectionDirection;if(deletedComma&&start===end&&next[start]===',')start=end=start+1;
  input.value=next;input.setSelectionRange(start,end,direction);
 };
 input.addEventListener('beforeinput',event=>{if(current()&&!composing)edit=capture(event.inputType);});
 input.addEventListener('input',event=>{if(!composing&&!event.isComposing)format();});
 input.addEventListener('compositionstart',()=>{if(current()){composing=true;edit=capture('insertCompositionText');}});
 input.addEventListener('compositionend',()=>{composing=false;format();});
}
function pricingValidCurrent(row,productId){return row&&row.product_id===productId&&['TZS','USD','EUR'].includes(row.currency)&&(typeof row.unit_price_minor==='number'||(typeof row.unit_price_minor==='string'&&/^\d+$/.test(row.unit_price_minor)))&&Number.isSafeInteger(Number(row.unit_price_minor))&&Number(row.unit_price_minor)>=0&&Number(row.unit_price_minor)<=9000000000000000&&Number.isSafeInteger(row.version)&&row.version>0&&typeof row.updated_by==='string'&&Number.isFinite(Date.parse(row.updated_at));}
function pricingValidatePage(data){
 if(!data||!Array.isArray(data.rows)||typeof data.can_edit!=='boolean'||!data.totals||!['products','configured','missing'].every(key=>Number.isSafeInteger(data.totals[key])&&data.totals[key]>=0)||data.totals.configured+data.totals.missing!==data.totals.products||![data.total,data.page,data.pages].every(Number.isSafeInteger)||data.total<0||data.total>data.totals.products||data.page<0||data.pages!==Math.max(1,Math.ceil(data.total/25))||data.page>=data.pages||data.rows.length!==Math.min(25,data.total-data.page*25)||!data.rows.every(row=>typeof row.id==='string'&&typeof row.name==='string'&&Array.isArray(row.prices)&&row.prices.length<=3&&new Set(row.prices.map(price=>price.currency)).size===row.prices.length&&row.prices.every(price=>pricingValidCurrent(price,row.id))))throw Error('The product price page was incomplete. Refresh before continuing.');
 return data;
}
function pricingProductIdentity(row){return `${row.name} · ${row.company||'Manufacturer needs review'} · ${row.specification||'Specification needs review'}${row.sku?' · '+row.sku:''}`;}
function pricingSummaryRow(row){return `<tr data-price-product="${esc(row.id)}" role="row"><td role="cell" data-label="Product"><span class="phone-cell-label" aria-hidden="true">Product</span>${esc(pricingProductIdentity(row))}</td><td role="cell" data-label="Configured price"><span class="phone-cell-label" aria-hidden="true">Configured price</span>${row.prices.length?row.prices.map(price=>esc(`${price.currency} ${pricingMinorText(price.unit_price_minor)}`)).join('<br>'):`<span class="tag chip chip--${statusTone('warning')}">Not configured</span>`}</td><td role="cell" data-label="Details" class="phone-card-actions"><span class="phone-cell-label" aria-hidden="true">Details</span><button type="button" data-price-open="${esc(row.id)}">Open price</button></td></tr>`;}
function pricingPageHtml(){
 const data=productPricePageData;
 return `<section class="prices-workspace">${workspacePageHeader({title:'Product prices',subtitle:'Configured selling prices. Missing prices are never treated as zero.',actions:'<button type="button" data-pricing-reload>Refresh prices</button>'})}
 <div class="inventory-metrics">${[['products','Products'],['configured','Configured'],['missing','Missing price']].map(([key,label])=>`<div><small>${label}${productPriceCurrency&&key!=='products'?' · '+esc(productPriceCurrency):''}</small><strong>${data.totals[key].toLocaleString('en-GB')}</strong></div>`).join('')}</div><p class="muted">Counts cover all current products for the selected currency, before search and status filters.</p>
 <section class="card price-register-panel"><h2>Selling price register</h2><div class="grid"><label><span>Find a price</span><input data-price-search type="search" maxlength="2000" value="${esc(productPriceSearch)}" placeholder="Product, manufacturer, stock code or currency"></label><label><span>Currency</span><select data-price-currency>${[['','All currencies'],['TZS','TZS'],['USD','USD'],['EUR','EUR']].map(([value,label])=>`<option value="${value}" ${productPriceCurrency===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Price status</span><select data-price-status>${[['configured','Configured'],['missing','Missing price'],['all','All products']].map(([value,label])=>`<option value="${value}" ${productPriceStatus===value?'selected':''}>${label}</option>`).join('')}</select></label></div>
 <div class="heading inventory-pagination"><p data-price-page-status role="status" tabindex="-1">${data.total?`${(data.page*25+1).toLocaleString('en-GB')}–${(data.page*25+data.rows.length).toLocaleString('en-GB')} of ${data.total.toLocaleString('en-GB')} products`:'No products match these filters'} · Page ${data.page+1} of ${data.pages}</p><div><button type="button" data-price-previous ${data.page===0?'disabled':''}>Previous</button><button type="button" data-price-next ${data.page+1>=data.pages?'disabled':''}>Next</button></div></div>
 <div data-price-register>${data.rows.length?`<div class="table-wrap"><table class="product-price-table" role="table" aria-label="Product prices"><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Product</th><th scope="col" role="columnheader">Configured price</th><th scope="col" role="columnheader">Details</th></tr></thead><tbody role="rowgroup">${data.rows.map(pricingSummaryRow).join('')}</tbody></table></div>`:'<p class="empty">Choose All products to find a product whose price needs configuring.</p>'}</div></section><div data-price-detail></div>
 ${data.can_edit?'<p><button type="button" data-price-import-open>Import approved prices</button></p><div data-price-import-host></div>':'<p class="muted">Only the owner or approved accounting users can change prices.</p>'}</section>`;
}
function bindProductPricePage(target){
 const search=target.querySelector('[data-price-search]');search.oninput=()=>{productPriceSearch=search.value;productPricePage=0;productPriceViewEpoch++;productPriceDetailEpoch++;renderSearchPreservingPosition(search,()=>pricesWorkspace(target),150);};
 for(const [selector,set] of [['[data-price-currency]',value=>productPriceCurrency=value],['[data-price-status]',value=>productPriceStatus=value]]){const input=target.querySelector(selector);input.onchange=()=>run(async()=>{set(input.value);productPricePage=0;await pricesWorkspace(target);target.querySelector(selector)?.focus()});}
 for(const [selector,step] of [['[data-price-previous]',-1],['[data-price-next]',1]]){const button=target.querySelector(selector);button.onclick=()=>run(async()=>{productPricePage+=step;await pricesWorkspace(target);const next=target.querySelector(selector);(next?.disabled?target.querySelector('[data-price-page-status]'):next)?.focus()});}
 target.querySelector('[data-pricing-reload]').onclick=()=>run(()=>pricesWorkspace(target));
 bindProductPriceOpenButtons(target);
 const importer=target.querySelector('[data-price-import-open]');if(importer)importer.onclick=()=>run(()=>openProductPriceImport(target));
}
function bindProductPriceOpenButtons(target){target.querySelectorAll('[data-price-open]').forEach(button=>button.onclick=()=>run(()=>openProductPrice(button.dataset.priceOpen,target)));}
function reconcileProductPricePage(target,previous){
 const active=document.activeElement,focusedId=active?.closest('[data-price-product]')?.dataset.priceProduct,left=window.scrollX,top=window.scrollY;
 const template=document.createElement('template');template.innerHTML=pricingPageHtml();
 const metrics=target.querySelector('.inventory-metrics');metrics.innerHTML=template.content.querySelector('.inventory-metrics').innerHTML;metrics.removeAttribute('aria-busy');
 target.querySelector('[data-price-page-status]').textContent=template.content.querySelector('[data-price-page-status]').textContent;
 for(const selector of ['[data-price-previous]','[data-price-next]'])target.querySelector(selector).disabled=template.content.querySelector(selector).disabled;
 const register=target.querySelector('[data-price-register]'),body=register.querySelector('tbody'),data=productPricePageData;
 if(!body||!data.rows.length)register.innerHTML=template.content.querySelector('[data-price-register]').innerHTML;
 else{
  const oldRows=[...body.querySelectorAll('[data-price-product]')],keep=[];
  for(const row of data.rows){
   const old=oldRows.find(node=>node.dataset.priceProduct===row.id),before=previous.rows.find(item=>item.id===row.id);let next=old;
   if(!old||!before||pricingSummaryRow(before)!==pricingSummaryRow(row)){const html=document.createElement('template');html.innerHTML=pricingSummaryRow(row);next=html.content.firstElementChild;if(old)old.replaceWith(next);}
   keep.push(next);
  }
  for(const old of oldRows)if(!keep.includes(old))old.remove();
  keep.forEach((node,index)=>{if(body.children[index]!==node)body.insertBefore(node,body.children[index]||null);});
 }
 bindProductPriceOpenButtons(target);target.querySelectorAll('[data-price-open]').forEach(button=>button.disabled=false);
 const importer=target.querySelector('[data-price-import-open]');if(importer&&!data.can_edit){importer.hidden=true;target.querySelector('[data-price-import-host]').innerHTML='';}
 if(focusedId&&(!active.isConnected||document.activeElement!==active))([...target.querySelectorAll('[data-price-open]')].find(button=>button.dataset.priceOpen===focusedId)||target.querySelector('[data-price-page-status]')).focus({preventScroll:true});
 window.scrollTo({left,top,behavior:'instant'});
}
async function refreshSavedProductPrice(target,current,row,saved,priceEpoch,added){
 const actor=me,panel=target.querySelector('[data-price-detail]'),active=()=>current()&&panel.isConnected&&target.querySelector('[data-price-detail]')===panel;
 const confirmed=`${saved.currency} ${pricingMinorText(saved.unit_price_minor)} · Version ${saved.version}`;
 async function reload(){
  if(!active())return;
  const focused=panel.contains(document.activeElement)||(document.activeElement===document.body&&typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive?.wasFocused&&actionFeedbackCurrent(actionFeedbackActive)&&panel.contains(actionFeedbackActive.origin?.node)),left=window.scrollX,top=window.scrollY;
  productPriceDetail=null;panel.innerHTML=`<section class="card"><p role="status">Price saved with history. ${esc(confirmed)}. Loading current prices…</p></section>`;
  const metrics=target.querySelector('.inventory-metrics');metrics.setAttribute('aria-busy','true');metrics.querySelectorAll('strong').forEach(value=>value.textContent='…');target.querySelector('[data-price-page-status]').textContent='Price saved. Loading current results…';
  for(const selector of ['[data-price-previous]','[data-price-next]'])target.querySelector(selector).disabled=true;
  target.querySelectorAll('[data-price-open]').forEach(button=>button.disabled=true);window.scrollTo({left,top,behavior:'instant'});
  try{
   const refreshed=await client.rpc('product_price_page',{p_query:'',p_currency:'',p_status:'all',p_page:0,p_product_id:row.id});if(!active())return;if(refreshed.error)throw refreshed.error;
   const data=pricingValidatePage(refreshed.data),fresh=data.rows[0];if(data.rows.length!==1||fresh.id!==row.id)throw Error('Current product unavailable.');
   const price=fresh.prices.find(price=>price.currency===saved.currency);if(!price||price.version<saved.version||(price.version===saved.version&&Number(price.unit_price_minor)!==Number(saved.unit_price_minor)))throw Error('Current price version could not be verified.');
   const previous=productPricePageData;let page;
   if(added||row.prices.map(price=>price.currency).sort().join(',')!==fresh.prices.map(price=>price.currency).sort().join(',')||['name','sku','company','specification'].some(key=>fresh[key]!==row[key])||!fresh.prices.some(price=>!productPriceCurrency||price.currency===productPriceCurrency)){
    const result=await client.rpc('product_price_page',{p_query:productPriceSearch,p_currency:productPriceCurrency,p_status:productPriceStatus,p_page:productPricePage,p_product_id:null});if(!active())return;if(result.error)throw result.error;
    page=pricingValidatePage(result.data);
    const listed=page.rows.find(item=>item.id===row.id);
    if(listed&&(['name','sku','company','specification'].some(key=>listed[key]!==fresh[key])||listed.prices.some(price=>{const detail=fresh.prices.find(item=>item.currency===price.currency);return !detail||detail.version!==price.version||Number(detail.unit_price_minor)!==Number(price.unit_price_minor)})))throw Error('Product prices changed again. Retry to load the current version.');
   }else{
    const summary={...fresh,prices:productPriceCurrency?fresh.prices.filter(price=>price.currency===productPriceCurrency):fresh.prices};
    page={...previous,can_edit:data.can_edit,rows:previous.rows.map(item=>item.id===row.id?summary:item)};
   }
   if(productPricingActor===actor&&productPricingEpoch===priceEpoch){for(const currency of ['TZS','USD','EUR'])productSalePrices.delete(pricingKey(row.id,currency));for(const price of fresh.prices)productSalePrices.set(pricingKey(row.id,price.currency),price);}
   productPricePageData=page;productPricePage=page.page;reconcileProductPricePage(target,previous);
   const left=window.scrollX,top=window.scrollY;
   productPriceDetail={row:fresh,canEdit:data.can_edit&&page.can_edit};renderProductPriceDetail(target,current,saved.currency);
   const focus=panel.querySelector('[name="price"]')||panel.querySelector('[data-price-detail-card]');
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
   if(focused&&(document.activeElement===document.body||panel.contains(document.activeElement)))focus.focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message('Configured product price saved with history.');
  }catch(error){
   if(!active())return;const left=window.scrollX,top=window.scrollY;
   productPriceDetail=null;panel.innerHTML=`<section class="card"><p role="alert">Price saved with history. ${esc(confirmed)}. Current prices could not reload: ${esc(error.message)} Use Retry saved price before another change.</p><button type="button" data-price-retry-saved>Retry saved price</button></section>`;
   target.querySelector('[data-price-page-status]').textContent='Price saved. Current results unavailable until retry.';
   const retry=panel.querySelector('[data-price-retry-saved]');retry.onclick=()=>run(reload);
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);
   if(focused&&document.activeElement===document.body)retry.focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message('Price saved with history. Use Retry saved price to load current details and results.');
  }
 }
 await reload();
}
async function pricesWorkspace(target=$('#content')){
 if(!me||view!=='prices'||!target?.isConnected)return;
 if((productPricePageActor&&productPricePageActor!==me)||(productPricingActor&&productPricingActor!==me))clearProductPricing();productPricePageActor=me;
 const actor=me,epoch=++productPriceViewEpoch,current=()=>me===actor&&view==='prices'&&epoch===productPriceViewEpoch&&target.isConnected;
 productPriceDetailEpoch++;productPriceDetail=null;workspaceLoading('Loading product prices…');
 try{
  const result=await client.rpc('product_price_page',{p_query:productPriceSearch,p_currency:productPriceCurrency,p_status:productPriceStatus,p_page:productPricePage,p_product_id:null});
  if(!current())return;if(result.error)throw result.error;
  const data=pricingValidatePage(result.data);productPricePageData=data;productPricePage=data.page;
  const paint=()=>{target.innerHTML=pricingPageHtml();bindProductPricePage(target)},input=target.querySelector('[data-price-search]');
  if(input&&document.activeElement===input)renderSearchPreservingPosition(input,paint);else paint();
 }catch(error){if(!current())return;productPricePageData=null;target.innerHTML=`${workspacePageHeader({title:'Product prices',actions:'<button type="button" data-pricing-reload>Retry loading prices</button>'})}<section class="card"><p role="alert">${esc(error.message||'Prices could not load.')}</p></section>`;target.querySelector('[data-pricing-reload]').onclick=()=>run(()=>pricesWorkspace(target));}
}
async function openProductPrice(id,target=$('#content')){
 if(productPricePageActor!==me||view!=='prices'||!target.isConnected||!productPricePageData?.rows.some(row=>row.id===id))return;
 const actor=me,epoch=productPriceViewEpoch,request=++productPriceDetailEpoch,current=()=>me===actor&&view==='prices'&&epoch===productPriceViewEpoch&&request===productPriceDetailEpoch&&target.isConnected;
 const panel=target.querySelector('[data-price-detail]');productPriceDetail=null;panel.innerHTML='<section class="card"><p role="status">Loading current product prices…</p></section>';
 try{
  const result=await client.rpc('product_price_page',{p_query:'',p_currency:'',p_status:'all',p_page:0,p_product_id:id});if(!current())return;if(result.error)throw result.error;
  const data=pricingValidatePage(result.data);if(data.rows.length!==1||data.rows[0].id!==id)throw Error('This product is no longer available. Refresh product prices.');
  productPriceDetail={row:data.rows[0],canEdit:data.can_edit};renderProductPriceDetail(target,current);panel.querySelector('[data-price-detail-card]')?.focus();
 }catch(error){if(!current())return;panel.innerHTML=`<section class="card"><p role="alert">${esc(error.message||'Current prices could not load.')}</p></section>`;}
}
function renderProductPriceDetail(target,current,currency=productPriceCurrency||'TZS'){
 const detail=productPriceDetail,row=detail.row,panel=target.querySelector('[data-price-detail]');
 panel.innerHTML=`<section class="card price-edit-panel" data-price-detail-card tabindex="-1"><div class="heading"><h2>${esc(pricingProductIdentity(row))}</h2><button type="button" data-price-close>Close details</button></div><p>Product ID: ${esc(row.id)}</p>${row.prices.map(price=>`<p>${esc(`${price.currency} ${pricingMinorText(price.unit_price_minor)}`)} · Version ${price.version}<br><small>${esc(employeeName(price.updated_by))} · ${esc(new Date(price.updated_at).toLocaleString())}</small></p>`).join('')||'<p>No selling prices configured. Missing prices are never treated as zero.</p>'}
 ${detail.canEdit?`<form data-price-editor><p data-price-error role="alert"></p><div class="grid price-fields"><label><span>Currency</span><select name="currency">${['TZS','USD','EUR'].map(value=>`<option ${value===currency?'selected':''}>${value}</option>`).join('')}</select></label><label><span>Unit price</span><input name="price" inputmode="decimal" required></label><label class="price-reason"><span>Reason for this price</span><textarea name="reason" minlength="2" maxlength="1000" rows="2" required></textarea></label></div><p data-price-current class="muted" role="status"></p><button type="submit">Save configured price</button></form>`:'<p>Only the owner or approved accounting users can change prices.</p>'}</section>`;
 const actor=me,form=panel.querySelector('[data-price-editor]'),active=()=>current()&&me===actor&&productPriceDetail===detail&&panel.isConnected&&target.querySelector('[data-price-detail]')===panel&&(!form||form.isConnected&&panel.querySelector('[data-price-editor]')===form);
 let selected=null,request=null,closing=false,initial='';const values=()=>form?JSON.stringify(['currency','price','reason'].map(name=>form.elements[name].value)):'';
 panel.querySelector('[data-price-close]').onclick=async()=>{
  if(!active()||closing)return false;
  if(form?.dataset.saving==='true'){message('Wait for this price save to finish before closing details.',true);return false;}
  if(request){message('The price save is still unconfirmed. Retry its original values or refresh to check the saved price before closing.',true);return false;}
  const snapshot=values();closing=true;
  try{
   if(snapshot!==initial&&!await askConfirm({title:'Discard price changes?',body:'Your unsaved price and reason will be lost.',confirmLabel:'Discard changes',tone:'danger'}))return false;
   if(!active()||form?.dataset.saving==='true'||request||values()!==snapshot)return false;
   productPriceDetailEpoch++;productPriceDetail=null;panel.innerHTML='';[...target.querySelectorAll('[data-price-open]')].find(button=>button.dataset.priceOpen===row.id)?.focus();return true;
  }finally{closing=false;}
 };
 if(!form)return;
 const choose=()=>{const currency=form.elements.currency.value;selected={currency,current:row.prices.find(price=>price.currency===currency)};form.elements.price.value=selected.current?pricingEditorAmountText(pricingMinorText(selected.current.unit_price_minor)):'';form.querySelector('[data-price-current]').textContent=selected.current?`Current version ${selected.current.version}. Saving retains the previous price in history.`:'No price configured for this currency. Enter zero explicitly only when it is the approved price.';};choose();initial=values();
 pricingBindEditorAmount(form.elements.price,()=>active()&&form.dataset.saving!=='true');
 const notice=form.querySelector('[data-price-error]'),touched=new Set(),summary=(count=form.querySelectorAll('.field-error').length)=>{notice.textContent=fieldErrorSummary(count);};
 const check=control=>{touched.add(control);showFieldError(control,pricingEditorFieldError(control,selected.currency));if(form.dataset.validationSubmitted==='true')summary();};form.noValidate=true;
 form.addEventListener('focusout',event=>{const control=fieldValidationSource(event.target);if(!active()||form.dataset.saving==='true'||!form.contains(control)||!control.matches('input,select,textarea')||fieldBlurToAction(event))return;check(control);});
 form.addEventListener('change',event=>{if(!active())return;if(event.target.name==='currency'){if(request){form.elements.currency.value=selected.currency;message('A previous save was not confirmed. Retry its original values or refresh before changing currency.',true);}else choose();if(form.dataset.saving!=='true')for(const control of [form.elements.currency,form.elements.price])if(touched.has(control)||form.dataset.validationSubmitted==='true')check(control);}});
 form.onsubmit=event=>{event.preventDefault();if(!active()||form.dataset.saving==='true')return;const button=form.querySelector('[type="submit"]');if(button.disabled)return;
  if(busy){actionFeedbackRefuse(button,notice);return;}
  const errors=pricingEditorFormErrors(form,selected.currency);form.dataset.validationSubmitted='true';summary(errors.size);showFieldErrors(form,errors);if(errors.size)return;const wasFocused=document.activeElement===button;button.disabled=true;
  return run(async()=>{
  // Native disabling can move focus to body before run captures the originating button.
  if(wasFocused&&typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive?.origin?.node===button)actionFeedbackActive.wasFocused=true;
  try{
  if(!current()||!form.isConnected||productPriceDetail!==detail)throw Error('Login or price view changed. Reopen product prices.');if(form.dataset.saving==='true')return;
  const currency=form.elements.currency.value;if(currency!==selected.currency)throw Error('Choose the currency before saving.');
  const price=pricingInputMinor(pricingEditorAmount(form.elements.price.value)??form.elements.price.value),reason=form.elements.reason.value.trim();if(reason.length<2||reason.length>1000)throw Error('Write the reason for this price (2 to 1000 characters).');
  const key=JSON.stringify([row.id,currency,selected.current?.version||0,price,reason]);if(request&&request.key!==key)throw Error('A previous save was not confirmed. Retry its original values or refresh before changing the price.');
  request ||= {key,id:crypto.randomUUID()};form.dataset.saving='true';
   const result=await client.rpc('set_product_sale_price',{p_request_id:request.id,p_product_id:row.id,p_currency:currency,p_expected_version:selected.current?.version||0,p_unit_price_minor:price,p_reason:reason});
   if(!active())return;if(result.error)throw Error(result.error.message);
   const saved=result.data;if(!pricingValidCurrent(saved,row.id)||saved.currency!==currency||saved.version!==(selected.current?.version||0)+1||Number(saved.unit_price_minor)!==price||saved.updated_by!==actor.user_id)throw Error('The price save was not confirmed. Retry the same values or refresh before changing the price.');
   const priceEpoch=++productPricingEpoch;if(productPricingActor===actor&&(productSalePrices.get(pricingKey(row.id,currency))?.version||0)<=saved.version)productSalePrices.set(pricingKey(row.id,currency),saved);
   await refreshSavedProductPrice(target,current,row,saved,priceEpoch,!selected.current);
  }catch(error){if(active())throw error;}finally{if(active()){form.dataset.saving='false';button.disabled=false;}}
 },{origin:button,errorTarget:notice});};
}
async function openProductPriceImport(target=$('#content')){
 if(productPricePageActor!==me||view!=='prices'||!target.isConnected||!productPricePageData?.can_edit)return;
 const actor=me,epoch=productPriceViewEpoch,host=target.querySelector('[data-price-import-host]'),button=target.querySelector('[data-price-import-open]'),current=()=>me===actor&&view==='prices'&&epoch===productPriceViewEpoch&&target.isConnected&&host.isConnected;
 button.disabled=true;host.innerHTML='<p role="status">Loading the complete product and price lists for import…</p>';
 try{
  await loadLists();if(!current())return;await loadInventoryOperations();if(!current())return;
  if(!inventoryLoaded||productReviewLoadError)throw Error(productReviewLoadError||inventoryLoadError||'Product corrections could not load.');
  const prices=await pricingLoad();if(!current()||prices===null)return;host.innerHTML='';bindProductPriceImport(host,current);const disclosure=host.querySelector('details');if(disclosure)disclosure.open=true;button.hidden=true;
 }catch(error){if(current()){host.innerHTML=`<p role="alert">${esc(error.message||'Price import could not load.')}</p>`;button.disabled=false;}}
}
