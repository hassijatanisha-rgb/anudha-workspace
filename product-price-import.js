'use strict';

const productPriceImportHeaders=['Product ID','Product Name','Currency','Current Price','New Price','Reason'];
const productPriceImportLimit=200;
function productPriceImportMinor(value){
 const text=String(value??'').trim();
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw Error('New Price must be a nonnegative decimal amount with at most two decimal places.');
 if(text.length>32)throw Error('New Price is above the supported amount.');
 if(typeof value==='number'&&text.replace('.','').replace(/^0+/,'').length>15)throw Error('Store large prices as text in Excel to preserve every digit.');
 const [whole,fraction='']=text.split('.'),minor=BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));
 if(minor>9000000000000000n)throw Error('New Price is above the supported amount.');
 return Number(minor);
}
function productPriceImportCatalog(catalog){return catalog.filter(product=>!product.deleted_at).map(product=>typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(product):product).sort((a,b)=>String(a.name).localeCompare(String(b.name))||a.id.localeCompare(b.id));}
function productPriceImportTemplateRows(catalog,prices,currency,page=0){
 if(!['TZS','USD','EUR'].includes(currency)||!Number.isInteger(page)||page<0)throw Error('Choose a template currency and product page.');
 return productPriceImportCatalog(catalog).slice(page*productPriceImportLimit,(page+1)*productPriceImportLimit).map(product=>{
  const price=prices.get(pricingKey(product.id,currency));
  return [product.id,product.name,currency,price?pricingMinorText(price.unit_price_minor):'','',''];
 });
}
function productPriceImportPreview(sheet,catalog,prices){
 const rows=[],errors=[],byId=new Map(productPriceImportCatalog(catalog).map(product=>[product.id.toLowerCase(),product])),seen=new Map();
 const fail=message=>({rows,errors:[message],reviewed:false});
 if(!sheet?.['!ref'])return fail('The selected sheet is empty.');
 const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
 if(range.e.r>productPriceImportLimit)return fail(`Use at most ${productPriceImportLimit} product rows plus the header. Download another template page for the remaining products.`);
 if(range.e.c>31)return fail('Use the downloaded template; the sheet has too many columns.');
 const formula=cell=>cell?.f||cell?.F||cell?.t==='e';
 const cellsAt=r=>Array.from({length:Math.max(range.e.c+1,productPriceImportHeaders.length)},(_,c)=>sheet[XLSX.utils.encode_cell({r,c})]);
 const headers=cellsAt(0);
 if(headers.some(formula)||productPriceImportHeaders.some((header,index)=>String(headers[index]?.v??'').trim()!==header)||headers.slice(productPriceImportHeaders.length).some(cell=>String(cell?.v??'').trim()))return fail(`Row 1 must contain these columns in order: ${productPriceImportHeaders.join(', ')}. Formulas are not supported.`);
 for(let r=1;r<=range.e.r;r++){
  const cells=cellsAt(r);if(cells.every(cell=>!formula(cell)&&String(cell?.v??'').trim()===''))continue;
  const values=productPriceImportHeaders.map((_,c)=>cells[c]?.v??''),[rawId,,rawCurrency,,rawPrice,rawReason]=values;
  const productId=String(rawId).trim().toLowerCase(),currency=String(rawCurrency).trim(),reason=String(rawReason).trim(),product=byId.get(productId),key=pricingKey(productId,currency),prior=prices.get(key);
  const row={number:r+1,productId,productName:product?.name||String(values[1]),currency,beforeMinor:prior?Number(prior.unit_price_minor):null,expectedVersion:prior?.version||0,unitPriceMinor:null,reason,errors:[],status:'not entered',requestId:null};rows.push(row);
  const bad=message=>row.errors.push(message);
  if(cells.some(formula)||cells.some((cell,index)=>index!==1&&typeof cell?.v==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(cell.v)))bad('Formulas and spreadsheet errors are not supported. Paste reviewed values only.');
  if(cells.slice(productPriceImportHeaders.length).some(cell=>String(cell?.v??'').trim()!==''))bad('Unexpected data after the Reason column.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(productId)||!product)bad('Product ID must exactly match an active product UUID from the template. Names are not matched.');
  if(!['TZS','USD','EUR'].includes(currency))bad('Currency must be TZS, USD or EUR.');
  if(seen.has(key)){bad('Duplicate product and currency in this file.');seen.get(key).errors.push('Duplicate product and currency in this file.');}else seen.set(key,row);
  if(prior&&(!Number.isSafeInteger(row.expectedVersion)||row.expectedVersion<1||!Number.isSafeInteger(row.beforeMinor)||row.beforeMinor<0))bad('Current database price/version is invalid; refresh product prices.');
  if(String(rawPrice).trim()===''){if(reason)bad('Enter New Price or clear Reason to leave this price unchanged.');}
  else{
   try{row.unitPriceMinor=productPriceImportMinor(rawPrice);}catch(error){bad(error.message);}
   if(reason.length<2||reason.length>1000)bad('Reason must contain 2–1000 characters for every entered New Price.');
   row.status=row.unitPriceMinor===row.beforeMinor?'unchanged':'ready';
  }
 }
 for(const row of rows)for(const error of row.errors)errors.push(`Row ${row.number}: ${error}`);
 if(!rows.length)errors.push('Add product rows from the downloaded template.');
 if(!rows.some(row=>row.status==='ready')&&!errors.length)errors.push('No price changes to apply. Enter New Price and Reason for the products you want to change.');
 return {rows,errors,reviewed:false,busy:false};
}
async function productPriceImportApply(backend,preview,current,onProgress=()=>{}){
 if(!current())return null;
 if(!preview||preview.errors.length||!preview.reviewed||preview.rows.length>productPriceImportLimit)throw Error('Review a valid import preview before applying prices.');
 if(preview.rows.some(row=>row.status==='rejected'))throw Error('Start another import and review fresh prices after the rejected row.');
 if(preview.busy)return null;preview.busy=true;
 try{
  for(const row of preview.rows){
   if(!current())return null;
   if(!['ready','unconfirmed'].includes(row.status))continue;
   const uncertain=row.status==='unconfirmed';row.requestId ||= crypto.randomUUID();row.status='saving';row.error='';onProgress();
   try{
    const result=await backend.rpc('set_product_sale_price',{p_request_id:row.requestId,p_product_id:row.productId,p_currency:row.currency,p_expected_version:row.expectedVersion,p_unit_price_minor:row.unitPriceMinor,p_reason:row.reason});
    if(!current())return null;if(result.error){const error=Error(result.error.message);error.rejected=/^(?:P0001|42501|22[A-Z0-9]{3}|23[A-Z0-9]{3})$/.test(result.error.code||'');throw error;}
    const saved=Array.isArray(result.data)?result.data[0]:result.data;
    if(!saved||saved.product_id!==row.productId||saved.currency!==row.currency||Number(saved.unit_price_minor)!==row.unitPriceMinor||saved.version!==row.expectedVersion+1)throw Error('The server did not confirm this exact price revision.');
    row.status='saved';onProgress();
   }catch(error){
    if(!current())return null;row.status=error.rejected&&!uncertain?'rejected':'unconfirmed';row.error=error.message||'Please retry.';onProgress();break;
   }
  }
  return {saved:preview.rows.filter(row=>row.status==='saved').length,rejected:preview.rows.filter(row=>row.status==='rejected').length,unconfirmed:preview.rows.filter(row=>row.status==='unconfirmed').length,pending:preview.rows.filter(row=>row.status==='ready').length};
 }finally{preview.busy=false;}
}
function bindProductPriceImport(target,workspaceCurrent){
 const actor=me,productCount=productPriceImportCatalog(products).length;let workbook=null,preview=null,working=false;
 const current=()=>me===actor&&workspaceCurrent()&&panel.isConnected;
 target.insertAdjacentHTML('beforeend',`<details class="card"><summary>Import product prices from Excel / CSV</summary><section data-price-import><p>Download a template for the currency and product page you need. Fill New Price and Reason only for approved changes. Blank New Price leaves a product unchanged. Up to ${productPriceImportLimit} rows and 5 MB per import.</p><div class="grid"><label>Template currency<select data-price-import-currency><option>TZS</option><option>USD</option><option>EUR</option></select></label><label>Template product page<select data-price-import-page>${Array.from({length:Math.max(1,Math.ceil(productCount/productPriceImportLimit))},(_,index)=>`<option value="${index}">${productCount?`${index*productPriceImportLimit+1}–${Math.min((index+1)*productPriceImportLimit,productCount)}`:'No active products'}</option>`).join('')}</select></label></div><div class="actions"><button type="button" data-price-import-excel>Download Excel template</button><button type="button" data-price-import-csv>Download CSV template</button></div><label>Completed Excel workbook or CSV<input type="file" data-price-import-file accept=".xlsx,.csv"></label><label>Sheet to review<select data-price-import-sheet disabled></select></label><button type="button" data-price-import-preview disabled>Preview current price changes</button><p>Product ID is the only match key. Product Name and Current Price in the file are references; the preview reloads current database prices and versions. No price changes are saved until you review and apply them. Prices save one at a time; if one fails, earlier confirmed changes remain and later rows stop.</p><div data-price-import-results></div><label><input type="checkbox" data-price-import-reviewed disabled>I have reviewed every listed price change and reason.</label><button type="button" data-price-import-apply disabled>Apply reviewed price changes</button><p data-price-import-status role="status" aria-live="polite"></p><button type="button" data-price-import-reset>Start another import</button></section></details>`);
 const panel=target.querySelector('[data-price-import]'),get=selector=>panel.querySelector(selector),file=get('[data-price-import-file]'),sheet=get('[data-price-import-sheet]'),review=get('[data-price-import-reviewed]'),apply=get('[data-price-import-apply]'),status=get('[data-price-import-status]'),previewButton=get('[data-price-import-preview]');
 const mutable=()=>!!preview?.rows.some(row=>['saving','saved','unconfirmed','rejected'].includes(row.status));
 function lock(){
  file.disabled=working||mutable();sheet.disabled=working||!workbook||mutable();previewButton.disabled=working||!workbook||mutable();review.disabled=working||!preview||!!preview.errors.length||mutable();
  apply.disabled=working||!preview||!!preview.errors.length||!review.checked||preview.rows.some(row=>row.status==='rejected')||!preview.rows.some(row=>['ready','unconfirmed'].includes(row.status));
  get('[data-price-import-reset]').disabled=working||!!preview?.rows.some(row=>row.status==='unconfirmed');
  for(const selector of ['[data-price-import-excel]','[data-price-import-csv]','[data-price-import-currency]','[data-price-import-page]'])get(selector).disabled=working;
 }
 function render(){
  const rows=preview?.rows||[],errors=preview?.errors||[];
  get('[data-price-import-results]').innerHTML=`${errors.length?`<div role="alert"><p>Correct these errors before applying:</p><ul>${errors.map(error=>`<li>${esc(error)}</li>`).join('')}</ul></div>`:''}${rows.length?`<div class="table-wrap"><table><thead><tr><th>Row / product UUID</th><th>Product</th><th>Currency</th><th class="numeric-cell">Current database price</th><th class="numeric-cell">New price</th><th>Reason</th><th>Result</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.number}<small>${esc(row.productId)}</small></td><td>${esc(row.productName)}</td><td>${esc(row.currency)}</td><td>${row.beforeMinor===null?'Not configured':esc(pricingMinorText(row.beforeMinor))}<small>Version ${row.expectedVersion}</small></td><td>${row.unitPriceMinor===null?'Leave unchanged':esc(pricingMinorText(row.unitPriceMinor))}</td><td>${esc(row.reason)}</td><td>${esc(row.errors.length?'Invalid':row.status)}${row.error?`<small>${esc(row.error)}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:''}`;lock();
 }
 async function requireEditor(){
  if(!current())throw Error('Reopen product prices before importing.');const result=await client.rpc('accounting_access');
  if(!current())throw Error('Login or price view changed.');if(actor.role!=='owner'&&(result.error||result.data!==true))throw Error('Only the owner or approved accounting users can import prices.');
 }
 async function template(format,origin){
  if(working||!current())return;if(busy){actionFeedbackRefuse(origin,status);return;}working=true;lock();
  return run(async()=>{try{
   await requireEditor();const rows=await pricingLoad();if(!current()||rows===null)return;
   const currency=get('[data-price-import-currency]').value,page=Number(get('[data-price-import-page]').value),values=productPriceImportTemplateRows(products,productSalePrices,currency,page);
   if(!values.length)throw Error('No active products on this template page. Refresh product prices.');
   if(format==='xlsx'){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([productPriceImportHeaders,...values]),'Product Prices');XLSX.writeFile(book,`product-prices-${currency}-${page+1}.xlsx`);}
   else booksDownload(`product-prices-${currency}-${page+1}.csv`,'\uFEFF'+booksCsv(productPriceImportHeaders.map((header,index)=>[index,header]),values));
   status.textContent='Template download requested. Fill only approved New Price and Reason values, then upload it to preview.';
  }catch(error){if(current())status.textContent=error.message;}finally{working=false;if(current())lock();}
  },{origin,errorTarget:status,busyLabel:'Preparing template…'});
 }
 get('[data-price-import-excel]').onclick=()=>template('xlsx',get('[data-price-import-excel]'));get('[data-price-import-csv]').onclick=()=>template('csv',get('[data-price-import-csv]'));
 file.onchange=async()=>{
  if(working||mutable()||!current())return;working=true;workbook=null;preview=null;review.checked=false;render();
  try{
   await requireEditor();const loaded=await financialImportRead(file.files?.[0]);if(!current())return;workbook=loaded;
   sheet.innerHTML=loaded.SheetNames.map(name=>`<option>${esc(name)}</option>`).join('');status.textContent='Choose the sheet and preview its current price changes.';
  }catch(error){if(current())status.textContent=error.message;}finally{working=false;if(current())lock();}
 };
 sheet.onchange=()=>{if(!working&&!mutable()&&current()){preview=null;review.checked=false;render();}};
 previewButton.onclick=async()=>{
  if(working||mutable()||!workbook||!current())return;if(busy){actionFeedbackRefuse(previewButton,status);return;}working=true;preview=null;review.checked=false;render();
  return run(async()=>{try{
   await requireEditor();const rows=await pricingLoad();if(!current()||rows===null)return;
   preview=productPriceImportPreview(workbook.Sheets[sheet.value],products,productSalePrices);render();status.textContent=preview.errors.length?'No prices have been saved. Correct the file and upload it again.':`${preview.rows.filter(row=>row.status==='ready').length} price changes ready for review. No prices have been saved.`;
  }catch(error){if(current())status.textContent=error.message;}finally{working=false;if(current())lock();}
  },{origin:previewButton,errorTarget:status,busyLabel:'Preparing preview…'});
 };
 review.onchange=()=>{if(preview&&current()&&!working){preview.reviewed=review.checked;lock();}};
 apply.onclick=async()=>{
  if(working||!preview||!review.checked||!current())return;if(busy){actionFeedbackRefuse(apply,status);return;}working=true;lock();
  return run(async()=>{try{
   await requireEditor();preview.reviewed=true;status.textContent='Applying reviewed prices one at a time…';
   const result=await productPriceImportApply(client,preview,current,render);if(!current()||!result)return;
   status.textContent=result.unconfirmed?`${result.saved} confirmed saved; 1 result not confirmed; ${result.pending} not attempted. Retry the same reviewed import to check the same request. Earlier confirmed saves remain saved.`:result.rejected?`${result.saved} confirmed saved; 1 rejected without saving; ${result.pending} not attempted. Start another import to correct the file and review fresh prices. Earlier confirmed saves remain saved.`:`${result.saved} confirmed saved. Blank and unchanged prices were skipped. Refresh product prices to see the updated register.`;
   apply.textContent=result.unconfirmed?'Retry unconfirmed and remaining prices':'Apply reviewed price changes';
  }catch(error){if(current())status.textContent=error.message;}finally{working=false;if(current())render();}
  },{origin:apply,errorTarget:status,busyLabel:'Applying prices…'});
 };
 get('[data-price-import-reset]').onclick=()=>{if(working||preview?.rows.some(row=>row.status==='unconfirmed')||!current())return;workbook=null;preview=null;file.value='';sheet.innerHTML='';review.checked=false;status.textContent='';apply.textContent='Apply reviewed price changes';render();};
}
