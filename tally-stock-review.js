'use strict';
let tallyRows=[],tallyCorrections=new Map(),tallySearch='',tallyPage=0,tallyGodown='';
let tallyReadiness=null;
let tallyActor=null,tallyRequest=0,tallyActionRequest=0,tallyPageData=null,tallyReadinessPage=0,tallyLoading=false;
function clearTallyStockReview(){tallyActor=null;tallyRequest++;tallyActionRequest++;tallyPageData=null;tallyReadinessPage=0;tallyLoading=false;tallyRows=[];tallyCorrections.clear();tallyReadiness=null;tallySearch='';tallyPage=0;tallyGodown='';}
function tallyGodownReview(source,corrections,godown,search){
 const godowns=[...new Set(source.map(r=>r.godown||''))].sort((a,b)=>a.localeCompare(b));
 const scoped=godown?source.filter(r=>r.godown===godown):source;
 const needle=String(search||'').trim().toLowerCase();
 return {godowns,total:scoped.length,reviewed:scoped.filter(r=>corrections.has(r.id)).length,
  negative:scoped.filter(r=>r.quantity<0).length,
  missingQuantity:scoped.filter(r=>r.quantity===null||r.quantity===undefined||r.quantity==='').length,
  rows:scoped.filter(r=>[r.product_name,r.godown,r.unit].join(' ').toLowerCase().includes(needle))};
}
async function tallyStockScreen(trigger=null,retaining=false){
 if(!me||view!=='inventory'||inventorySection!=='review')return false;
 if(tallyActor!==me){clearTallyStockReview();tallyActor=me;}
 const actor=me,target=$('#content'),request=++tallyRequest,page=tallyPage,readinessPage=tallyReadinessPage,current=()=>me===actor&&tallyActor===actor&&request===tallyRequest&&view==='inventory'&&inventorySection==='review'&&target?.isConnected&&$('#content')===target;
 tallyActionRequest++;tallyLoading=true;
 if(!tallyPageData)workspaceLoading('Loading Tally stock review…');
 const old=$('#tallyRegister');old?.setAttribute('aria-busy','true');old?.querySelectorAll('button').forEach(button=>button.disabled=true);
 try{
  const response=await client.rpc('tally_stock_review_page',{p_godown:tallyGodown,p_query:tallySearch,p_page:page,p_readiness_page:readinessPage,p_today:companyDate()});
  if(!current())return false;if(response.error)throw response.error;
  const data=response.data,validCount=value=>Number.isSafeInteger(value)&&value>=0,validPage=(value,size,requested)=>value&&Array.isArray(value.rows)&&validCount(value.total)&&validCount(value.page)&&value.pages===Math.max(1,Math.ceil(value.total/size))&&value.page===Math.min(requested,value.pages-1)&&value.rows.length===Math.min(size,Math.max(0,value.total-value.page*size));
  if(!validPage(data,50,page)||!validPage(data.readiness,20,readinessPage)||!data.scope||!['total','reviewed','negative','missingQuantity'].every(key=>validCount(data.scope[key])&&data.scope[key]<=data.scope.total)||data.total>data.scope.total||new Set(data.rows.map(row=>row.id)).size!==data.rows.length||data.rows.some(row=>typeof row.id!=='string'||typeof row.product_name!=='string'||typeof row.godown!=='string'||typeof row.reviewed!=='boolean'||typeof row.checks_passed!=='boolean'||!Object.hasOwn(row,'quantity')||!(row.pieces===null||validCount(row.pieces)))||new Set(data.readiness.rows.map(row=>row.name)).size!==data.readiness.rows.length||data.readiness.rows.some(row=>typeof row.name!=='string'||!['total','checked','blocked','unmapped','negative'].every(key=>validCount(row[key])&&row[key]<=row.total)||row.checked+row.blocked!==row.total))throw Error('The server did not return a complete stock review page.');
  tallyPageData=data;tallyPage=data.page;tallyReadinessPage=data.readiness.page;tallyLoading=false;
  const input=document.activeElement;
  if(retaining)renderTallyStock(true);else if(input&&['tallySearch','tallyGodown'].includes(input.id))renderSearchPreservingPosition(input,renderTallyStock);else renderTallyStock();
  if(trigger&&(document.activeElement===trigger||document.activeElement===document.body||!document.activeElement?.isConnected)){const next=trigger.id?$('#'+trigger.id):trigger.dataset.tallyReview?[...document.querySelectorAll('[data-tally-review]')].find(button=>button.dataset.tallyReview===trigger.dataset.tallyReview):$('#tallyGodown');(next&&!next.disabled?next:$('#tallyScope'))?.focus({preventScroll:true});}
  return true;
 }catch(error){
  if(!current())return false;
  if(retaining&&tallyPageData){
   tallyLoading=true;
   const notice=$('#tallyStatus');notice.innerHTML=`<span role="alert">Stock review saved. The updated list could not load: ${esc(error.message)}. Refresh before reviewing another row.</span> <button type="button" id="tallySavedRetry">Retry refresh</button>`;
   $('#tallySavedRetry').onclick=()=>run(async()=>{if(!current())return;const loaded=await tallyStockScreen(trigger,true);if(loaded&&me===actor)message('Stock review saved. No operational stock was changed.');});
   if(trigger&&!document.activeElement?.closest?.('dialog[open]'))$('#tallySavedRetry').focus({preventScroll:true});return false;
  }
  tallyPageData=null;tallyLoading=false;
  $('#content').innerHTML=inventoryHeader()+`<section class="card"><h2>Stock review could not load</h2><p role="alert">${esc(error.message)}</p><button type="button" id="tallyRetry">Retry</button></section>`;bindInventoryWorkspace();$('#tallyRetry').onclick=()=>{if(current())run(()=>tallyStockScreen());};if(trigger&&(document.activeElement===document.body||!document.activeElement?.isConnected))$('#tallyRetry').focus({preventScroll:true});return false;
 }
}
function tallyRowReview(row){
 const correction=tallyCorrections.get(row.id),product=products.find(p=>p.id===correction?.product_id&&!p.deleted_at);
 const details=product?productReviewDefaults(reviewedCatalogProduct(product)):{name:row.product_name};
 const result=productStockReview(details,{quantity:correction?.pieces??row.quantity,unit:correction?.pieces!=null?'PCS':row.unit,verified:correction?.pieces!=null,batch:correction?.batch,expiry:correction?.expiry});
 if(!product)result.issues.unshift('Choose the matching catalog product');
 return {correction,product,result};
}
function tallyGodownReadiness(rows,review){
 const groups=new Map();
 for(const row of rows){
  const name=row.godown||'';
  if(!groups.has(name))groups.set(name,{name,total:0,checked:0,blocked:0,unmapped:0,negative:0});
  const group=groups.get(name),check=review(row);group.total++;
  if(!check.product)group.unmapped++;
  if(row.quantity<0)group.negative++;
  if(!name.trim()||!check.product||check.result.issues.length)group.blocked++;else group.checked++;
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function renderTallyStock(retaining=false){
 if(tallyActor!==me||!tallyPageData||view!=='inventory'||inventorySection!=='review')return;
 const data=tallyPageData,scope=data.scope,readiness=data.readiness,actor=me,request=tallyRequest,current=()=>me===actor&&tallyActor===actor&&request===tallyRequest&&view==='inventory'&&inventorySection==='review';
 const markup=inventoryHeader()+`<p class="muted">Corrections preserve original balances and do not post operational stock.</p><div class="cleanup-metrics" id="tallyMetrics"><div><small>Source rows</small><strong>${scope.total}</strong></div><div><small>Saved reviews</small><strong>${scope.reviewed}</strong></div><div><small>Negative balances</small><strong>${scope.negative}</strong></div><div><small>Source godown labels</small><strong>${readiness.total}</strong></div></div>
 <section class="card cleanup-table" id="tallyRegister"><div class="cleanup-search"><label><span>Exact godown name · blank for all</span><input id="tallyGodown" list="tallyGodowns" maxlength="2000" value="${esc(tallyGodown)}"><datalist id="tallyGodowns">${readiness.rows.filter(row=>row.name).map(row=>`<option value="${esc(row.name)}"></option>`).join('')}</datalist></label>${me.role==='owner'?'<label><span>Load prepared private stock file</span><input id="tallyFile" type="file" accept=".json,application/json"></label>':''}<label><span>Search product or godown</span><input type="search" id="tallySearch" maxlength="2000" value="${esc(tallySearch)}" placeholder="Search Tally rows"></label></div><p id="tallyScope" role="status" tabindex="-1">${data.total} matching rows · ${esc(tallyGodown||'All source godowns')} · ${scope.missingQuantity} missing quantities. Saved reviews can still need correction.</p><div class="table-wrap"><table><thead><tr><th>Product / godown</th><th>Original balance</th><th>Review</th><th>Verified pieces</th><th>Action</th></tr></thead><tbody id="tallyRows">${data.rows.map(row=>`<tr data-tally-row="${esc(row.id)}"><td><strong>${esc(row.product_name)}</strong><small>${esc(row.godown)} · ${esc(row.balance_date)}</small></td><td>${esc(row.quantity??'Unknown')} ${esc(row.unit||'Unit missing')}${row.quantity<0?'<span class="cleanup-pill danger">Negative</span>':''}</td><td><span class="cleanup-pill ${row.checks_passed?'success':'warning'}">${row.checks_passed?'Checks passed':row.reviewed?'Needs correction':'Not reviewed'}</span></td><td>${esc(row.pieces??'Not verified')}</td><td><button type="button" data-tally-review="${esc(row.id)}">Review / correct</button></td></tr>`).join('')}</tbody></table></div><div class="actions cleanup-pagination"><button type="button" id="tallyPrev" ${data.page===0?'disabled':''}>Previous</button><span id="tallyPageStatus">Page ${data.page+1} of ${data.pages}</span><button type="button" id="tallyNext" ${data.page+1>=data.pages?'disabled':''}>Next</button></div><p id="tallyStatus" role="status"></p></section>
 <section class="card" id="godownReadiness"><h2>All godowns · reconciliation checklist</h2><p>Checks passed means product details and physical-count review are complete, not that stock has been imported. Original negative balances remain visible. Quantities in different products or units are never added together.</p><div class="table-wrap"><table><thead><tr><th>Godown</th><th>Source rows</th><th>Checks passed</th><th>Needs correction</th><th>Product not linked</th><th>Original negatives</th><th>Action</th></tr></thead><tbody id="tallyReadinessRows">${readiness.rows.map(row=>`<tr data-tally-readiness="${esc(row.name)}"><td>${esc(row.name||'Missing godown — needs correction')}</td><td>${row.total}</td><td>${row.checked}</td><td>${row.blocked}</td><td>${row.unmapped}</td><td>${row.negative}</td><td>${row.name?`<button type="button" data-tally-godown="${esc(row.name)}">Show rows</button>`:''}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button type="button" id="tallyGodownPrev" ${readiness.page===0?'disabled':''}>Previous godowns</button><span id="tallyReadinessPageStatus">Page ${readiness.page+1} of ${readiness.pages}</span><button type="button" id="tallyGodownNext" ${readiness.page+1>=readiness.pages?'disabled':''}>Next godowns</button></div></section>`;
 if(retaining){
  const template=document.createElement('template');template.innerHTML=markup;
  for(const [id,key] of [['tallyRows','tallyRow'],['tallyReadinessRows','tallyReadiness']]){
   const body=$('#'+id),fresh=template.content.querySelector('#'+id),existing=new Map([...body.children].map(row=>[row.dataset[key],row]));let cursor=body.firstElementChild;
   for(const row of [...fresh.children]){
    const old=existing.get(row.dataset[key]),next=old||row;
    if(old&&old.tallyMarkup!==row.outerHTML){const html=row.outerHTML;old.replaceChildren(...row.children);old.tallyMarkup=html;}
    if(next===cursor)cursor=cursor.nextElementSibling;else body.insertBefore(next,cursor);existing.delete(row.dataset[key]);
   }
   for(const row of existing.values())row.remove();
  }
  for(const id of ['tallyMetrics','tallyScope','tallyPageStatus','tallyReadinessPageStatus','tallyGodowns']){const old=$('#'+id),fresh=template.content.querySelector('#'+id);if(old.innerHTML!==fresh.innerHTML)old.innerHTML=fresh.innerHTML;}
  for(const id of ['tallyPrev','tallyNext','tallyGodownPrev','tallyGodownNext'])$('#'+id).disabled=template.content.querySelector('#'+id).disabled;
  document.querySelectorAll('[data-tally-review],[data-tally-godown]').forEach(button=>button.disabled=false);
  $('#tallyRegister').setAttribute('aria-busy','false');$('#tallyStatus').textContent='Stock review saved. No operational stock was changed.';
 }else $('#content').innerHTML=markup;
 document.querySelectorAll('[data-tally-row],[data-tally-readiness]').forEach(row=>row.tallyMarkup=row.outerHTML);
 bindInventoryWorkspace();
 for(const [id,set] of [['tallyGodown',value=>tallyGodown=value],['tallySearch',value=>tallySearch=value]]){
  const input=$('#'+id);input.oninput=()=>{if(me!==actor||view!=='inventory'||inventorySection!=='review')return;set(input.value);tallyPage=0;tallyRequest++;tallyActionRequest++;tallyLoading=true;renderSearchPreservingPosition(input,tallyStockScreen,150);};
 }
 for(const [id,step,godowns] of [['tallyPrev',-1,false],['tallyNext',1,false],['tallyGodownPrev',-1,true],['tallyGodownNext',1,true]]){
  const button=$('#'+id);button.onclick=()=>{if(!current()||tallyLoading)return;run(()=>{if(godowns)tallyReadinessPage+=step;else tallyPage+=step;return tallyStockScreen(button)});};
 }
 document.querySelectorAll('[data-tally-godown]').forEach(button=>button.onclick=()=>{if(!current()||tallyLoading)return;run(()=>{tallyGodown=button.dataset.tallyGodown;tallyPage=0;return tallyStockScreen(button)});});
 document.querySelectorAll('[data-tally-review]').forEach(button=>button.onclick=()=>{if(current()&&!tallyLoading)run(()=>openTallyCorrection(button.dataset.tallyReview));});
 const file=$('#tallyFile');if(file)file.onchange=()=>run(async()=>{
  if(!current()||tallyLoading||!file.files[0])return;
  const selected=file.files[0],active=()=>current()&&!tallyLoading&&tallyPageData===data&&file.isConnected&&$('#tallyFile')===file&&file.files[0]===selected;
  const text=await selected.text();if(!active())return;const payload=JSON.parse(text);
  if(!Array.isArray(payload.records))throw Error('Choose the prepared stock review JSON.');
  const rows=payload.records.filter(row=>row.record_kind==='item_balance');
  if(!await askConfirm({title:`Stage ${rows.length} Tally source rows?`,body:'These source rows are added for review. This does not create saleable stock.',confirmLabel:'Stage source rows',tone:'normal'})||!active())return;
  file.disabled=true;
  try{for(let i=0;i<rows.length;i+=100){if(!active())throw Error('Login, page or file changed; import stopped.');const response=await client.rpc('import_tally_stock_review',{p_rows:rows.slice(i,i+100)});if(response.error)throw Error(`Import stopped at batch ${i+1}: ${response.error.message}. The same file can be retried without duplicating rows.`);if(!active())return;const status=$('#tallyStatus');if(status)status.textContent=`Staged ${Math.min(i+100,rows.length)} of ${rows.length}`;}
   const loaded=await tallyStockScreen();if(me===actor&&view==='inventory'&&inventorySection==='review')message(loaded?'Source rows staged for review. No stock was changed.':'Source rows staged, but the review list could not reload. Use Retry.',!loaded);
  }finally{if(file.isConnected)file.disabled=false;}
 });
}
async function openTallyCorrection(id){
 if(tallyActor!==me||tallyLoading||view!=='inventory'||inventorySection!=='review'||!tallyPageData?.rows.some(row=>row.id===id))return;
 const actor=me,target=$('#content'),opener=[...document.querySelectorAll('[data-tally-review]')].find(button=>button.dataset.tallyReview===id),request=tallyRequest,action=++tallyActionRequest,current=()=>me===actor&&tallyActor===actor&&request===tallyRequest&&action===tallyActionRequest&&view==='inventory'&&inventorySection==='review'&&target?.isConnected&&$('#content')===target;
 let row,c;
 try{
  const [loaded,source,corrections,reviews]=await Promise.all([loadLists(),client.from('tally_stock_sources').select('id,source_file,source_row,godown,product_name,quantity,unit,balance_date,imported_at').eq('id',id).maybeSingle(),client.from('tally_stock_corrections').select('*').eq('source_id',id).order('version',{ascending:false}).limit(1),all('product_detail_reviews','*')]);
  if(!current())return;if(loaded===false)throw Error('Product choices could not load. Reopen this review.');if(source.error)throw source.error;if(corrections.error)throw corrections.error;
  row=source.data;c=corrections.data?.[0];if(row?.id!==id||c&&(c.source_id!==id||!Number.isSafeInteger(c.version)||c.version<1))throw Error('This review changed or is no longer available. Refresh before continuing.');
  const latest=new Map();for(const review of reviews)if((latest.get(review.product_id)?.version||0)<review.version)latest.set(review.product_id,review);productDetailReviews=latest;productReviewLoadError='';
 }catch(error){if(!current())return;throw error;}
 const p=(x=>x?reviewedCatalogProduct(x):x)(products.find(product=>product.id===c?.product_id));
 const details=p&&!p.deleted_at?productReviewDefaults(p):{name:row.product_name},check=productStockReview(details,{quantity:c?.pieces??row.quantity,unit:c?.pieces!=null?'PCS':row.unit,verified:c?.pieces!=null,batch:c?.batch,expiry:c?.expiry},companyDate());
 if(!p||p.deleted_at)check.issues.unshift('Choose the matching catalog product');if(!row.godown.trim())check.issues.unshift('Godown name needs correction in the source');
 const dialog=document.createElement('dialog');
 dialog.innerHTML=`<form><h2>Review stock row</h2><p role="alert"></p><p>${esc(row.product_name)} · ${esc(row.godown)}</p><p>Original Tally balance: ${esc(row.quantity??'Unknown')} ${esc(row.unit||'Unknown unit')} · ${esc(row.source_file)}, row ${esc(row.source_row)}</p><p>${check.issues.map(esc).join('; ')||'Product and count checks passed.'}</p>${c?`<p><strong>Last saved review · version ${esc(c.version)}</strong><br>${esc(c.reason)}</p>`:''}<label>Match catalog product<input name="product" list="tallyProducts" value="${esc(p?inventoryProductChoice(p):'')}"></label><datalist id="tallyProducts" data-lookup-values="products">${inventoryProductChoices()}</datalist><label>Verified pieces (leave blank if unknown)<input name="pieces" type="number" min="0" max="9007199254740991" step="1" value="${esc(c?.pieces??'')}"></label><label>Batch, if applicable<input name="batch" value="${esc(c?.batch||'')}"></label><label>Expiry, if applicable<input name="expiry" type="date" value="${esc(c?.expiry||'')}"></label><label>Reason / evidence for correction<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><p>Verify pack-to-piece conversions before entering pieces. No saleable stock is posted by this form.</p><div class="actions"><button type="button" data-close>Close</button>${me.role==='owner'?'<button type="submit">Save review</button>':''}</div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form'),initial=workspaceFormSnapshot(form);let saving=false,committed=false;
 const errorTarget=dialog.querySelector('[role="alert"]'),fieldErrors=new Map();form.noValidate=true;
 function errors(){
  const result=nativeFormErrors(form),f=new FormData(form),product=form.elements.product,pieces=form.elements.pieces,quantity=f.get('pieces').trim();
  if(f.get('product')&&!inventoryProductFromChoice(f.get('product'))&&!result.has(product))result.set(product,'Select an exact catalog product from the search list.');
  if(quantity!==''&&(!Number.isSafeInteger(Number(quantity))||Number(quantity)<0)&&!result.has(pieces))result.set(pieces,'Enter whole nonnegative pieces or leave blank.');
  return result;
 }
 form.addEventListener('focusout',event=>{
  if(!current()||!dialog.isConnected||saving||committed||busy||me.role!=='owner'||fieldBlurToAction(event))return;
  const control=fieldValidationSource(event.target);if(!control.matches('input,select,textarea')||!form.contains(control))return;
  const problem=errors().get(control)||'';if(problem)fieldErrors.set(control,problem);else fieldErrors.delete(control);
  showFieldError(control,problem);errorTarget.textContent=fieldErrorSummary(fieldErrors.size);
 });
 dialog.querySelector('[data-close]').onclick=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>saving,isDirty:()=>!committed&&workspaceFormSnapshot(form)!==initial});
 actionFeedbackRememberDialog(dialog);showWorkspaceDialog(dialog,{size:'large'});
 form.onsubmit=async e=>{
  e.preventDefault();const button=dialog.querySelector('[type="submit"]');if(!button||saving||committed||button.disabled||!current()||me.role!=='owner'||!dialog.isConnected)return;if(busy){actionFeedbackRefuse(button,errorTarget);return;}
  fieldErrors.clear();for(const [control,problem]of errors())fieldErrors.set(control,problem);errorTarget.textContent=fieldErrorSummary(fieldErrors.size);showFieldErrors(form,fieldErrors);if(fieldErrors.size)return;
  saving=true;button.disabled=true;
  await run(async()=>{
  try{const f=new FormData(e.target),match=inventoryProductFromChoice(f.get('product')),quantity=f.get('pieces').trim();if(f.get('product')&&!match)throw Error('Select an exact catalog product from the search list.');if(quantity!==''&&(!Number.isSafeInteger(Number(quantity))||Number(quantity)<0))throw Error('Enter whole nonnegative pieces or leave blank.');
   const r=await client.rpc('save_tally_stock_correction',{p_id:crypto.randomUUID(),p_source_id:id,p_expected_version:c?.version||0,p_product_id:match?.id||null,p_pieces:quantity===''?null:Number(quantity),p_batch:f.get('batch'),p_expiry:f.get('expiry')||null,p_reason:f.get('reason').trim()});
   if(!current()||me.role!=='owner'||!dialog.isConnected){dialog.close();return;}if(r.error)throw r.error;
   committed=true;if(!await closeWorkspaceDialog(dialog)||!current()||me.role!=='owner')return;
   const refresh=tallyStockScreen(opener,true),refreshRequest=tallyRequest,loaded=await refresh;if(me===actor&&view==='inventory'&&inventorySection==='review'&&tallyRequest===refreshRequest&&target.isConnected&&$('#content')===target)message(loaded?'Stock review saved. No operational stock was changed.':'Stock review saved, but the list could not reload. Use Retry.',!loaded);
  }catch(error){if(current()&&dialog.isConnected)throw Error(`Not confirmed saved: ${error.message}. Reopen to check the latest version before retrying.`);}finally{saving=false;button.disabled=committed;}
  },{origin:button,errorTarget,busyLabel:'Saving…'});
 };
}
