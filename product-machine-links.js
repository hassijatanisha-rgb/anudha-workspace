'use strict';
let productMachineLinks=new Map(),productMachineLinksError='';
function machineLinkImportedIds(product){
 const ids=product.source?.machine_ids;
 return Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.trim()&&id===id.trim())?[...ids]:[];
}
function machineLinkReviewedProduct(product){
 const review=productMachineLinks.get(product.id);
 return review?{...product,source:{...product.source,machine_ids:[...review.machine_ids]}}:product;
}
let machineLinkLoadGeneration=0;
async function loadProductMachineLinks(){
 const actor=me,actorId=me?.user_id,generation=++machineLinkLoadGeneration;
 const current=()=>me===actor&&me?.user_id===actorId&&generation===machineLinkLoadGeneration;
 try{
  const rows=await all('product_machine_link_reviews','*'),latest=new Map();
  if(!current())return;
  for(const row of rows)if((latest.get(row.product_id)?.version||0)<row.version)latest.set(row.product_id,row);
  productMachineLinks=latest;productMachineLinksError='';
 }catch(error){if(current())productMachineLinksError=error.message||'Connection unavailable';}
}
async function openProductMachineLinks(id){
 if(me?.role!=='owner')throw Error('Owner access is required to change machine links.');
 const actor=me.user_id,product=catalogRows().find(p=>p.id===id);
 if(!product||!['reagents','consumables','spares'].includes(catalogCategoryOf(product)))throw Error('Choose a reagent, consumable or spare.');
 const response=await client.from('product_machine_link_reviews').select('*').eq('product_id',id).order('version',{ascending:false}).limit(1);
 if(response.error)throw Error(`Machine links could not be loaded: ${response.error.message}`);
 if(me?.user_id!==actor||me?.role!=='owner')throw Error('Login changed; reopen machine links.');
 const review=response.data?.[0],selected=new Set(review?.machine_ids||machineLinkImportedIds(product));
 const machines=catalogRows().filter(p=>p.id!==id&&catalogCategoryOf(p)==='machines');
 const choices=[...machines];
 for(const missing of selected)if(!choices.some(p=>p.id===missing))choices.push({id:missing,name:'Unavailable machine — remove or review',source:{}});
 const dialog=document.createElement('dialog');dialog.className='product-review-editor';
 dialog.innerHTML=`<form><h2>Compatible machines</h2><p>${esc(product.name)} · ${esc(product.source?.company||'Manufacturer needs review')}</p><p>Link this same product to every compatible machine. This does not copy or move stock.</p><label>Search machines<input type="search" autocomplete="off" placeholder="Name, manufacturer or model"></label><div class="machine-link-options" data-machine-choices>${choices.map(p=>`<label data-machine-search="${esc([p.name,p.source?.company,p.source?.specification,p.source?.model,p.sku].join(' ').toLowerCase())}"><input type="checkbox" name="machineId" value="${esc(p.id)}" ${selected.has(p.id)?'checked':''}>${esc(p.name)} · ${esc(p.source?.company||'Manufacturer needs review')} · ${esc(p.source?.specification||p.source?.model||'Specification needs review')} · ${esc(p.sku||'Stock code missing')} · ID: ${esc(p.id)}</label>`).join('')||'<p>No machines are classified yet. Confirm their product categories first.</p>'}</div><label>Reason / source checked<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Save machine links</button></div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.querySelector('input[type="search"]').oninput=event=>{
  const query=event.target.value.trim().toLowerCase();
  dialog.querySelectorAll('[data-machine-search]').forEach(row=>{row.hidden=!row.dataset.machineSearch.includes(query)});
 };
 const form=dialog.querySelector('form'),requestId=crypto.randomUUID();
 form.onsubmit=async event=>{
  event.preventDefault();const alert=form.querySelector('[role="alert"]'),button=form.querySelector('[type="submit"]');
  if(me?.user_id!==actor||me?.role!=='owner'){alert.textContent='Login changed. Close and reopen this form.';return;}
  if(button.disabled)return;button.disabled=true;alert.textContent='';
  const data=new FormData(form),ids=data.getAll('machineId');
  try{
   const result=await client.rpc('save_product_machine_link_review',{p_id:requestId,p_product_id:id,p_expected_version:review?.version||0,p_machine_ids:ids,p_reason:data.get('reason').trim()});
   if(me?.user_id!==actor){dialog.close();return;}
   if(result.error)throw result.error;
   const saved=Array.isArray(result.data)?result.data[0]:result.data;
   if(saved?.product_id!==id||!saved.version||!Array.isArray(saved.machine_ids))throw Error('The server did not return the saved machine links');
   productMachineLinks.set(id,saved);dialog.close();catalogInventory();message('Machine links saved. Stock remains on the same product.');
  }catch(error){alert.textContent=`Not confirmed saved: ${error.message}. Close and reopen to check the latest version before retrying.`;}
  finally{button.disabled=false;}
 };
 dialog.showModal();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-machine-link-edit]');if(button)run(()=>openProductMachineLinks(button.dataset.machineLinkEdit))});
