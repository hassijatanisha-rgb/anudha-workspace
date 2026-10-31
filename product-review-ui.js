'use strict';
let productDetailReviews=new Map();
let productReviewLoadError='';
function reviewedCatalogProduct(product){if(product.catalog_current)return product;const r=productDetailReviews.get(product.id),reviewed=r?{...product,name:r.name,source:{...product.source,company:r.company,specification:r.specification,model:r.specification,sale_status:r.sale_status,batch_required:r.batch_required,expiry_required:r.expiry_required}}:product;return typeof machineLinkReviewedProduct==='function'?machineLinkReviewedProduct(reviewed):reviewed;}

function productReviewDefaults(product){
 const s=product.source||{};
 return {name:product.name||'',company:s.company||'',specification:s.specification||s.model||'',sale_status:s.sale_status||'unknown',batch_required:s.batch_required,expiry_required:s.expiry_required};
}
async function openProductReview(id){
 const actor=me;
 const paged=typeof catalogIsActive==='function'&&catalogIsActive(),context=paged?catalogSaveContext():null,current=()=>me===actor&&(!paged||context.current());
 let product,response;
 try{
  product=paged?await loadCatalogProduct(id):products.find(p=>p.id===id);if(!current()||!product)return;
  response=paged?{data:[catalogDetailRows.get(id)?.review].filter(Boolean)}:await client.from('product_detail_reviews').select('*').eq('product_id',id).order('version',{ascending:false}).limit(1);
  if(!current())return;if(response.error)throw Error(`Product correction database is not ready: ${response.error.message}`);
 }catch(error){if(current())throw error;return;}
 if(!actor)return;
 const row=response.data?.[0],details=row||productReviewDefaults(product);
 const dialog=document.createElement('dialog');dialog.className='product-review-editor';
 const choice=(value,label,selected)=>`<option value="${value}" ${selected?'selected':''}>${label}</option>`;
 const applicability=key=>choice('unknown','Needs review',typeof details[key]!=='boolean')+choice('yes','Yes',details[key]===true)+choice('no','Not applicable',details[key]===false);
 dialog.innerHTML=`<form><div class="product-review-fields"><h2 tabindex="-1" autofocus>Correct product details</h2><p>Original spreadsheet values stay unchanged. Stock counts are verified separately by godown. Product name and correction reason are required.</p><p role="alert"></p><section><h3>Identity</h3><label>Product name<input name="name" maxlength="500" required value="${esc(details.name)}"></label><label>Company / manufacturer (optional)<input name="company" maxlength="500" value="${esc(details.company)}"></label><label>Version / specification (optional)<textarea name="specification" maxlength="2000">${esc(details.specification)}</textarea></label></section><section><h3>Applicability</h3><label>Sale status (optional)<select name="sale_status">${choice('unknown','Needs review',details.sale_status==='unknown')}${choice('active','Active — for sale',details.sale_status==='active')}${choice('inactive_serviced','Inactive — not sold, still serviced',details.sale_status==='inactive_serviced')}</select></label><label>Batch number applicable? (optional)<select name="batch_required">${applicability('batch_required')}</select></label><label>Expiry date applicable? (optional)<select name="expiry_required">${applicability('expiry_required')}</select></label></section><section><h3>Correction reason</h3><label>Reason / source checked<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label></section></div><div class="actions product-review-footer"><p class="muted" data-product-review-dirty>No changes</p><button type="button" data-close>Cancel</button>${canEditRecords()?'<button class="button-primary" type="submit">Save correction</button>':`<span>${esc(recordsLockedText)}</span>`}</div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form'),requestId=crypto.randomUUID(),initial=workspaceFormSnapshot(form);let saving=false,committed=false,validationSubmitted=false;form.noValidate=true;
 const isDirty=()=>!committed&&workspaceFormSnapshot(form)!==initial,dirtyStatus=form.querySelector('[data-product-review-dirty]');
 const updateDirtyStatus=()=>{if(!current()||!dialog.open||!dialog.isConnected)return;const text=committed?'Correction saved':isDirty()?'Unsaved changes':'No changes';if(dirtyStatus.textContent!==text)dirtyStatus.textContent=text;};
 form.oninput=updateDirtyStatus;form.onchange=updateDirtyStatus;
 form.addEventListener('focusout',event=>{const control=event.target;if(!current()||!canEditRecords()||saving||committed||!dialog.open||!form.contains(control)||!control.matches('input,select,textarea')||fieldBlurToAction(event))return;showFieldError(control,nativeFieldError(control));if(validationSubmitted)actionFeedbackShow(actionFeedbackReference(form.querySelector('[type="submit"]')),fieldErrorSummary(form.querySelectorAll('.field-error').length),'error',form.querySelector('[role="alert"]'));});
 dialog.querySelector('[data-close]').onclick=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>saving,isDirty});
 actionFeedbackRememberDialog(dialog);showWorkspaceDialog(dialog,{size:'medium'});
 form.onsubmit=async event=>{
  event.preventDefault();if(!current()){form.querySelector('[role="alert"]').textContent='Login changed. Close and reopen this form.';return;}if(!canEditRecords())return;
  const button=form.querySelector('[type="submit"]'),errorTarget=form.querySelector('[role="alert"]');if(saving||committed||button.disabled)return;if(busy){actionFeedbackRefuse(button,errorTarget);return;}
  const errors=nativeFormErrors(form);validationSubmitted=errors.size>0;if(errors.size){actionFeedbackShow(actionFeedbackReference(button),fieldErrorSummary(errors.size),'error',errorTarget);showFieldErrors(form,errors);return;}showFieldErrors(form,errors);saving=true;button.disabled=true;
  const f=new FormData(form),boolean=key=>f.get(key)==='unknown'?null:f.get(key)==='yes';
  await run(async()=>{
  try{
   const result=await client.rpc('save_product_detail_review',{p_id:requestId,p_product_id:id,p_expected_version:row?.version||0,p_name:f.get('name').trim(),p_company:f.get('company').trim(),p_specification:f.get('specification').trim(),p_sale_status:f.get('sale_status'),p_batch_required:boolean('batch_required'),p_expiry_required:boolean('expiry_required'),p_reason:f.get('reason').trim()});
   if(!current()||!canEditRecords()||!dialog.isConnected){dialog.close();return;}
   if(result.error)throw result.error;
   committed=true;updateDirtyStatus();if(!await closeWorkspaceDialog(dialog)||!current()||!canEditRecords())return;
   if(paged)await refreshCatalogSavedProduct(id,'Correction saved with history. Unresolved details and stock still need review.',context,{review:(row?.version||0)+1});
   else{const saved=Array.isArray(result.data)?result.data[0]:result.data;if(saved?.product_id===id&&saved.version)productDetailReviews.set(id,saved);catalogInvalidateProductCaches();render();message('Correction saved with history.');}
  }catch(error){if(current()&&dialog.isConnected)throw Error(`Not confirmed saved: ${error.message}. Close and reopen to check the latest version before retrying.`);}
  finally{saving=false;button.disabled=committed;}
  },{origin:button,errorTarget,busyLabel:'Saving…'});
 };
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-product-review]');if(button)run(()=>openProductReview(button.dataset.productReview))});
