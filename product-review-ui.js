'use strict';
let productDetailReviews=new Map();
function reviewedCatalogProduct(product){const r=productDetailReviews.get(product.id);return r?{...product,name:r.name,source:{...product.source,company:r.company,specification:r.specification,model:r.specification,sale_status:r.sale_status,batch_required:r.batch_required,expiry_required:r.expiry_required}}:product;}

function productReviewDefaults(product){
 const s=product.source||{};
 return {name:product.name||'',company:s.company||'',specification:s.specification||s.model||'',sale_status:s.sale_status||'unknown',batch_required:s.batch_required,expiry_required:s.expiry_required};
}
async function openProductReview(id){
 const actor=me?.user_id;
 const product=products.find(p=>p.id===id);if(!product)return;
 const response=await client.from('product_detail_reviews').select('*').eq('product_id',id).order('version',{ascending:false}).limit(1);
 if(response.error)throw Error(`Product correction database is not ready: ${response.error.message}`);
 if(!actor||me?.user_id!==actor)throw Error('Login changed; reopen the product correction.');
 const row=response.data?.[0],details=row||productReviewDefaults(product);
 const dialog=document.createElement('dialog');dialog.className='product-review-editor';
 const choice=(value,label,selected)=>`<option value="${value}" ${selected?'selected':''}>${label}</option>`;
 const applicability=key=>choice('unknown','Needs review',typeof details[key]!=='boolean')+choice('yes','Yes',details[key]===true)+choice('no','Not applicable',details[key]===false);
 dialog.innerHTML=`<form><h2>Correct product details</h2><p>Original spreadsheet values stay unchanged. Stock counts are verified separately by godown.</p><label>Product name<input name="name" maxlength="500" required value="${esc(details.name)}"></label><label>Company / manufacturer<input name="company" maxlength="500" value="${esc(details.company)}"></label><label>Version / specification<textarea name="specification" maxlength="2000">${esc(details.specification)}</textarea></label><label>Sale status<select name="sale_status">${choice('unknown','Needs review',details.sale_status==='unknown')}${choice('active','Active — for sale',details.sale_status==='active')}${choice('inactive_serviced','Inactive — not sold, still serviced',details.sale_status==='inactive_serviced')}</select></label><label>Batch number applicable?<select name="batch_required">${applicability('batch_required')}</select></label><label>Expiry date applicable?<select name="expiry_required">${applicability('expiry_required')}</select></label><label>Reason / source checked<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button>${me.role==='owner'?'<button type="submit">Save correction</button>':'<span>Owner access is required to save corrections.</span>'}</div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.showModal();
 const form=dialog.querySelector('form');
 form.onsubmit=async event=>{
  event.preventDefault();if(me?.user_id!==actor){form.querySelector('[role="alert"]').textContent='Login changed. Close and reopen this form.';return;}if(me.role!=='owner')return;
  const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
  const f=new FormData(form),boolean=key=>f.get(key)==='unknown'?null:f.get(key)==='yes';
  try{
   const result=await client.rpc('save_product_detail_review',{p_id:crypto.randomUUID(),p_product_id:id,p_expected_version:row?.version||0,p_name:f.get('name').trim(),p_company:f.get('company').trim(),p_specification:f.get('specification').trim(),p_sale_status:f.get('sale_status'),p_batch_required:boolean('batch_required'),p_expiry_required:boolean('expiry_required'),p_reason:f.get('reason').trim()});
   if(me?.user_id!==actor){dialog.close();return;}
   if(result.error)throw result.error;
   const saved=Array.isArray(result.data)?result.data[0]:result.data;
   if(!saved?.version)throw Error('The server did not return the saved correction');
   productDetailReviews.set(id,saved);
   dialog.close();catalogInventory();message('Correction saved with history. Unresolved details and stock still need review.');
  }catch(error){form.querySelector('[role="alert"]').textContent=`Not confirmed saved: ${error.message}. Close and reopen to check the latest version before retrying.`;}
  finally{button.disabled=false;}
 };
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-product-review]');if(button)run(()=>openProductReview(button.dataset.productReview))});
