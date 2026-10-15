'use strict';
async function openProductMappingDecision(row,onSaved,isCurrent=()=>true){
 if(!isCurrent())return;
 if(!canEditRecords())throw Error(recordsLockedText);
 const actor=me.user_id,response=await client.from('product_source_mapping_reviews').select('*').eq('source_key',row.sourceKey).order('version',{ascending:false}).limit(1);
 if(me?.user_id!==actor||!canEditRecords())throw Error('Login changed. Reopen the mapping review.');
 if(!isCurrent())return;
 if(response.error)throw Error(`Saved mappings unavailable: ${response.error.message}`);
 const previous=response.data?.[0],canLink=row.match.status==='exact'&&row.match.productIds.length===1;
 const dialog=document.createElement('dialog');dialog.className='product-review-editor';
 dialog.innerHTML=`<form><h2>Save mapping decision</h2><p>Source: ${esc(row.sourceKey)}</p><p>${esc(row.corrected.name)} · ${esc(row.corrected.manufacturer||'Manufacturer missing')}</p><p>This records the product identity only. Stock is not imported, and source stock warnings remain unresolved.</p><p>Previous decision: ${esc(previous?`${previous.decision} · ${previous.product_id||'No product'} · version ${previous.version}`:'None')}</p><label>Decision<select name="decision">${canLink?`<option value="linked">Confirm product ${esc(row.match.productIds[0])}</option>`:''}<option value="unresolved">Keep unresolved — needs further review</option></select></label><label>Reason / source checked<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><p role="alert"></p><div class="actions"><button type="button" data-cancel>Cancel</button><button type="submit">Save decision only</button></div></form>`;
 const requestId=crypto.randomUUID(),form=dialog.querySelector('form');
 form.onsubmit=async event=>{
  event.preventDefault();const alert=form.querySelector('[role="alert"]'),button=form.querySelector('[type="submit"]');
  if(me?.user_id!==actor||!canEditRecords()){alert.textContent='Login changed. Close and reopen this review.';return;}
  if(!isCurrent()){alert.textContent='Preview changed. Close and reopen this review.';return;}
  if(button.disabled)return;button.disabled=true;alert.textContent='';
  const data=new FormData(form),decision=data.get('decision');
  try{
   if(decision==='linked'&&!canLink)throw Error('Resolve product identity before confirming a link.');
   const result=await client.rpc('save_product_source_mapping_review',{p_id:requestId,p_source_key:row.sourceKey,p_expected_version:previous?.version||0,p_product_id:decision==='linked'?row.match.productIds[0]:null,p_decision:decision,p_snapshot:{original:row.original,corrected:row.corrected,editedLocally:row.editedLocally,editedAt:row.editedAt},p_reason:data.get('reason').trim()});
   if(me?.user_id!==actor||!canEditRecords()||!dialog.isConnected){dialog.close();return;}
   if(result.error)throw result.error;
   const saved=Array.isArray(result.data)?result.data[0]:result.data;
   if(saved?.source_key!==row.sourceKey||!saved.version||saved.decision!==decision)throw Error('Server did not confirm the saved decision');
   dialog.close();onSaved(saved);
  }catch(error){alert.textContent=`Not confirmed saved: ${error.message}. Close and reopen to check the latest decision before retrying.`;}
  finally{button.disabled=false;}
 };
 dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
