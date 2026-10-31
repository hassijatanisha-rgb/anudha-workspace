'use strict';
let productMachineLinks=new Map(),productMachineLinksError='',machineLinksEpoch=0;
function clearProductMachineLinks(){machineLinksEpoch++;productMachineLinks.clear();productMachineLinksError='';}
function machineLinkImportedIds(product){
 const ids=product.source?.machine_ids;
 return Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.trim()&&id===id.trim())?[...ids]:[];
}
function machineLinkReviewedProduct(product){
 const review=productMachineLinks.get(product.id);
 return review?{...product,source:{...product.source,machine_ids:[...review.machine_ids]}}:product;
}
async function loadProductMachineLinks(){
 const epoch=++machineLinksEpoch,actor=me;
 try{
  const rows=await all('product_machine_link_reviews','*'),latest=new Map();
  for(const row of rows)if((latest.get(row.product_id)?.version||0)<row.version)latest.set(row.product_id,row);
  if(epoch!==machineLinksEpoch||me!==actor)return;productMachineLinks=latest;productMachineLinksError='';
 }catch(error){if(epoch!==machineLinksEpoch||me!==actor)return;productMachineLinksError=error.message||'Connection unavailable';}
}
async function openProductMachineLinks(id){
 if(!canEditRecords())throw Error(recordsLockedText);
 const actor=me,paged=typeof catalogIsActive==='function'&&catalogIsActive(),context=paged?catalogSaveContext():null,current=()=>me===actor&&(!paged||context.current());
 let product,response,machines;
 try{
  if(paged)await loadCatalogProduct(id);if(!current())return;
  product=catalogRows().find(p=>p.id===id);
  if(!product||!['reagents','consumables','spares'].includes(catalogCategoryOf(product)))throw Error('Choose a reagent, consumable or spare.');
  response=paged?{data:[catalogDetailRows.get(id)?.links].filter(Boolean)}:await client.from('product_machine_link_reviews').select('*').eq('product_id',id).order('version',{ascending:false}).limit(1);
  if(!current())return;if(response.error)throw Error(`Machine links could not be loaded: ${response.error.message}`);
  machines=(paged?await loadCatalogMachines():catalogRows()).filter(p=>p.id!==id&&catalogCategoryOf(p)==='machines');
  if(!current())return;
 }catch(error){if(current())throw error;return;}
 if(!canEditRecords())throw Error(recordsLockedText);
 const review=response.data?.[0],selected=new Set(review?.machine_ids||machineLinkImportedIds(product));
 const choices=[...machines];
 for(const missing of selected)if(!choices.some(p=>p.id===missing))choices.push({id:missing,name:'Unavailable machine — remove or review',source:{}});
 const dialog=document.createElement('dialog');dialog.className='product-review-editor';
 dialog.innerHTML=`<form><h2>Compatible machines</h2><p>${esc(product.name)} · ${esc(product.source?.company||'Manufacturer needs review')}</p><p>Link this same product to every compatible machine. This does not copy or move stock.</p><p role="alert"></p><label>Search machines<input type="search" autocomplete="off" placeholder="Name, manufacturer or model"></label><div class="machine-link-options" data-machine-choices>${choices.map(p=>`<label data-machine-search="${esc([p.name,p.source?.company,p.source?.specification,p.source?.model,p.sku].join(' ').toLowerCase())}"><input type="checkbox" name="machineId" value="${esc(p.id)}" ${selected.has(p.id)?'checked':''}>${esc(p.name)} · ${esc(p.source?.company||'Manufacturer needs review')} · ${esc(p.source?.specification||p.source?.model||'Specification needs review')} · ${esc(p.sku||'Stock code missing')} · ID: ${esc(p.id)}</label>`).join('')||'<p>No machines are classified yet. Confirm their product categories first.</p>'}</div><label>Reason / source checked<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Save machine links</button></div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 dialog.querySelector('input[type="search"]').oninput=event=>{
  const query=event.target.value.trim().toLowerCase();
  dialog.querySelectorAll('[data-machine-search]').forEach(row=>{row.hidden=!row.dataset.machineSearch.includes(query)});
 };
 const form=dialog.querySelector('form'),requestId=crypto.randomUUID(),initial=workspaceFormSnapshot(form);let saving=false,committed=false;form.noValidate=true;
 form.addEventListener('focusout',event=>{const control=event.target;if(!current()||!canEditRecords()||saving||committed||!dialog.open||!dialog.isConnected||!form.contains(control)||!control.matches('input,select,textarea')||fieldBlurToAction(event))return;showFieldError(control,nativeFieldError(control));form.querySelector('[role="alert"]').textContent=fieldErrorSummary(form.querySelectorAll('.field-error').length);});
 dialog.querySelector('[data-close]').onclick=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>saving,isDirty:()=>!committed&&workspaceFormSnapshot(form)!==initial});
 form.onsubmit=async event=>{
  event.preventDefault();const alert=form.querySelector('[role="alert"]'),button=form.querySelector('[type="submit"]');
  if(!current()||!canEditRecords()){alert.textContent='Login changed. Close and reopen this form.';return;}
  if(saving||committed||button.disabled)return;if(busy){actionFeedbackRefuse(button,alert);return;}
  const errors=nativeFormErrors(form);alert.textContent=fieldErrorSummary(errors.size);showFieldErrors(form,errors);if(errors.size)return;
  saving=true;button.disabled=true;alert.textContent='';
  const data=new FormData(form),ids=data.getAll('machineId');
  await run(async()=>{
  try{
   const result=await client.rpc('save_product_machine_link_review',{p_id:requestId,p_product_id:id,p_expected_version:review?.version||0,p_machine_ids:ids,p_reason:data.get('reason').trim()});
   if(!current()||!canEditRecords()||!dialog.isConnected){dialog.close();return;}
   if(result.error)throw result.error;
   committed=true;if(!await closeWorkspaceDialog(dialog)||!current()||!canEditRecords())return;
   if(paged)await refreshCatalogSavedProduct(id,'Machine links saved. Stock remains on the same product.',context,{links:(review?.version||0)+1});
   else{const saved=Array.isArray(result.data)?result.data[0]:result.data;if(saved?.product_id===id&&saved.version&&Array.isArray(saved.machine_ids))productMachineLinks.set(id,saved);catalogInvalidateProductCaches();render();message('Machine links saved. Stock remains on the same product.');}
  }catch(error){if(current()&&dialog.isConnected)throw Error(`Not confirmed saved: ${error.message}. Close and reopen to check the latest version before retrying.`);}
  finally{saving=false;button.disabled=committed;}
  },{origin:button,errorTarget:alert,busyLabel:'Saving…'});
 };
 actionFeedbackRememberDialog(dialog);
 showWorkspaceDialog(dialog,{size:'large'});
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-machine-link-edit]');if(button)run(()=>openProductMachineLinks(button.dataset.machineLinkEdit))});
