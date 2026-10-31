'use strict';
// Products: Clients & items data access (migration 071). Draft Pro formas: owner only.
function canArchiveBusiness(kind){return kind==='product'?canEditRecords():me?.role==='owner'}
async function openArchiveBusinessRecord(kind,id){
 if(!['product','proforma'].includes(kind))throw Error('Unsupported record type.');
 if(!canArchiveBusiness(kind))throw Error(kind==='product'?recordsLockedText:'Owner access is required.');
 const actor=me,scope=kind==='product'&&typeof catalogIsActive==='function'&&catalogIsActive()?catalogSaveContext():null;
 const record=kind==='product'?(typeof catalogIsActive==='function'&&catalogIsActive()?await loadCatalogProduct(id):products.find(p=>p.id===id)):salesProforma(id);
 if(me!==actor||scope&&!scope.current())return;
 if(!record||record.deleted_at)throw Error('Record changed. Refresh before deleting.');
 if(kind==='proforma'&&record.status!=='draft')throw Error('Only draft pro formas can be deleted.');
 if(kind==='proforma')return archiveDraftProforma(record);
 const current=()=>me===actor&&(!scope||scope.current());
 const form=actionForm('Move to Deleted Items',`<p>Delete <strong>${esc(record.name)}</strong> from the active list?</p><p>You can restore it from Deleted Items. Linked history remains intact. No reason is required.</p>`,async()=>{
  if(!current())throw Error('The record view changed. Reopen it before deleting.');
  if(!canArchiveBusiness(kind))throw Error('Access changed. Nothing was deleted.');
  let result;try{result=await client.rpc('set_product_archived',{p_id:id,p_archived:true});}catch(error){if(!current())return;throw error;}
  if(me!==actor)return;if(result.error){if(current())throw result.error;return;}
  if(scope)catalogInvalidateProductCaches();if(!current())return;
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved?.id!==id||!saved.deleted_at)throw Error('The deletion response could not be verified. Refresh this record before trying again.');
  if(scope)await refreshArchivedCatalogProduct(id,scope);else await load();
  if(current())message('Moved to Deleted Items.');
 });
 const button=form?.querySelector('[type="submit"]');if(button)button.textContent='Delete';
}
function draftArchiveRejected(error){return /^(?:P0001|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3}|40001|40P01|57014)$/.test(error?.code||'');}
function draftArchiveReceipt(previous,data,actor,archived){
 const row=salesConfirmedRow('proforma',previous,data,'draft');
 if(archived?row.deleted_by!==actor.user_id||typeof row.deleted_at!=='string'||!Number.isFinite(Date.parse(row.deleted_at))||row.updated_at!==row.deleted_at:row.deleted_at!==null||row.deleted_by!==null)throw Error('The draft response could not be verified.');
 return row;
}
async function archiveDraftProforma(record){
 const target=$('#content'),card=document.querySelector(`[data-document-card="${CSS.escape(record.id)}"]`);
 if(!card||!target||salesEditing||view!=='sales')throw Error('Reopen the draft before deleting it.');
 if(card.draftArchiveState){if(card.draftArchiveState.check)return card.draftArchiveState.check();return;}
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,session=sessionLoadEpoch;
 const state={card,posting:true,reading:false,sequence:0,check:null,completed:false};card.draftArchiveState=state;
 const contextCurrent=()=>me===actor&&sessionLoadEpoch===session&&salesEpoch===epoch&&salesWorkspaceRequest===request&&view==='sales'&&!salesEditing&&target.isConnected&&$('#content')===target;
 const current=()=>contextCurrent()&&state.card?.isConnected&&state.card.draftArchiveState===state;
 const controls=[...card.querySelectorAll('button,input,select,textarea')].map(node=>[node,node.disabled]);
 const workflow=document.querySelector(`[data-order-workflow="${CSS.escape(record.id)}"]`),workflowInert=workflow?.inert;
 const expanded=new Set([...card.querySelectorAll('details[open]')].map(detail=>detail.querySelector('summary')?.textContent));
 let archived=null;
 const notice=(text,retry,label='Check saved status')=>{
  if(!current())return;
  state.card.querySelectorAll('button,input,select,textarea').forEach(node=>node.disabled=true);
  let box=state.card.querySelector('[data-draft-archive-notice]');if(!box){box=document.createElement('div');box.dataset.draftArchiveNotice='';state.card.append(box);}
  box.replaceChildren();const status=document.createElement('p');status.setAttribute('role',retry?'alert':'status');status.textContent=text;box.append(status);
  if(retry){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>run(retry);box.append(button);}
  const back=state.card.querySelector('[data-proforma-back]');if(back)back.disabled=false;
 };
 const invalidate=()=>{salesLoaded=false;salesProformaPageKey='';};
 const deletedCard=()=>{
  const active=document.activeElement,left=window.scrollX,top=window.scrollY;
  const focused=state.card.contains(active);
  state.card.innerHTML=`<p role="status">${esc(record.document_number)} moved to Deleted Items. It can be restored there.</p><button type="button" data-proforma-back>All Pro formas</button>`;
  state.card.removeAttribute('aria-busy');
  if(workflow?.isConnected){const placeholder=document.createElement('div');placeholder.dataset.orderWorkflow=record.id;placeholder.hidden=true;workflow.replaceWith(placeholder);}
  bindSalesDelivery();const back=state.card.querySelector('button');
  if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(back);
  if(focused&&document.activeElement===document.body)back.focus({preventScroll:true});
  window.scrollTo({left,top,behavior:'instant'});return back;
 };
 const refreshRestored=async restored=>{
  if(!current()||state.reading)return;
  state.reading=true;const sequence=++state.sequence,still=()=>current()&&sequence===state.sequence;
  notice('Draft restored. Updating its history…');
  try{
   const events=await salesRowsFor('sales_proforma_events','proforma_id',[record.id],'created_at');
   if(!still())return;if(events.error)throw Error(events.error.message);
   if(!Array.isArray(events.data)||events.data.some(event=>event.proforma_id!==record.id))throw Error('The current draft history could not be verified.');
   salesProformaEvents=[...salesProformaEvents.filter(event=>event.proforma_id!==record.id),...events.data];
   await salesUpdateConfirmedCard('proforma',archived,restored,'draft',still,state.card.querySelector('[data-proforma-back]'));
   if(!contextCurrent()||sequence!==state.sequence)return;
   state.card=document.querySelector(`[data-document-card="${CSS.escape(record.id)}"]`);if(!state.card)return;state.card.draftArchiveState=state;
   state.card.querySelectorAll('details').forEach(detail=>{if(expanded.has(detail.querySelector('summary')?.textContent))detail.open=true;});
   if(!current())return;
   const focus=state.card.querySelector('[data-edit-proforma]')||state.card.querySelector('button');
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
   if(document.activeElement===document.body||!document.activeElement?.isConnected)focus?.focus({preventScroll:true});
   state.card.draftArchiveState=null;message('Draft restored.');
  }catch(error){if(still())notice(`Draft restored. Its history could not refresh: ${error.message}.`,()=>refreshRestored(restored),'Retry draft history');}
  finally{if(sequence===state.sequence)state.reading=false;}
 };
 const restoredFollowup=restored=>{
  state.completed=true;state.check=null;invalidate();salesProformas=salesProformas.map(row=>row.id===record.id?restored:row);
  // Confirmed restore is complete; its read-only history refresh need not hold run's global lock.
  refreshRestored(restored).catch(error=>{if(current())notice(`Draft restored. Details could not refresh: ${error.message}.`,()=>refreshRestored(restored),'Retry draft history');});
 };
 const verifyUndo=async()=>{
  if(!current()||state.reading)return;state.reading=true;const sequence=++state.sequence;
  try{
   const result=await client.from('sales_proformas').select('*').eq('id',record.id).maybeSingle();if(!current()||sequence!==state.sequence)return;if(result.error)throw Error(result.error.message);
   const value=Array.isArray(result.data)?result.data[0]:result.data;
   if(value?.version===archived.version&&value.deleted_at===archived.deleted_at&&value.deleted_by===actor.user_id){deletedCard();notice('The draft remains in Deleted Items. Restore it there when needed.');state.check=null;return;}
   const restored=draftArchiveReceipt(archived,value,actor,false);state.reading=false;restoredFollowup(restored);
  }catch(error){if(current()&&sequence===state.sequence)notice(`The current draft could not be confirmed: ${error.message}.`,verifyUndo);}
  finally{if(sequence===state.sequence)state.reading=false;}
 };
 const undo=async()=>{
  if(!current()||salesProforma(record.id)?.version!==archived?.version)throw Error('The draft or login changed. Reopen the record.');
  if(state.posting||state.completed)return;state.posting=true;const sequence=++state.sequence,still=()=>current()&&sequence===state.sequence;
  try{
   let result;try{result=await client.rpc('undo_draft_proforma_archive',{p_id:record.id,p_expected_version:archived.version});}catch(error){if(me===actor&&sessionLoadEpoch===session)invalidate();if(!still())return;state.check=undo;notice('Undo could not be confirmed. Retry the same Undo safely before making another change.',undo,'Check Undo');throw error;}
   if(me===actor&&sessionLoadEpoch===session)invalidate();if(!still())return;
   if(result?.error){state.check=draftArchiveRejected(result.error)?verifyUndo:undo;notice(`Undo could not be confirmed: ${result.error.message}`,state.check,draftArchiveRejected(result.error)?'Check saved status':'Check Undo');throw Error(result.error.message);}
   let restored;try{restored=draftArchiveReceipt(archived,result?.data,actor,false);}catch(error){state.check=undo;notice('Undo returned without complete details. Retry the same Undo safely.',undo,'Check Undo');throw error;}
   restoredFollowup(restored);
  }finally{state.posting=false;}
 };
 const publish=saved=>{
  archived=saved;state.check=null;invalidate();salesProformas=salesProformas.map(row=>row.id===record.id?saved:row);
  const back=deletedCard(),remaining=Date.parse(saved.deleted_at)+8000-Date.now();
  if(remaining>0)actionFeedbackUndo(actionFeedbackReference(back),'Draft moved to Deleted Items.',Math.min(8000,remaining),undo);
  else message('Moved to Deleted Items.');
 };
 const verifyDelete=async()=>{
  if(!current()||state.posting||state.reading)return;state.reading=true;const sequence=++state.sequence;
  try{
   const result=await client.from('sales_proformas').select('*').eq('id',record.id).maybeSingle();if(!current()||sequence!==state.sequence)return;if(result.error)throw Error(result.error.message);
   publish(draftArchiveReceipt(record,result?.data,actor,true));
  }catch(error){if(current()&&sequence===state.sequence)notice(`Deletion is not confirmed: ${error.message}. Check saved status before making another change.`,verifyDelete);}
  finally{if(sequence===state.sequence)state.reading=false;}
 };
 controls.forEach(([node])=>node.disabled=true);if(workflow)workflow.inert=true;card.setAttribute('aria-busy','true');notice('Deleting draft…');
 try{
  let result;try{result=await client.rpc('set_draft_proforma_archived',{p_id:record.id,p_archived:true,p_expected_version:record.version});}catch(error){if(me===actor&&sessionLoadEpoch===session)invalidate();if(!current())return;state.check=verifyDelete;notice('Deletion could not be confirmed. Check saved status before making another change.',verifyDelete);throw error;}
  if(me===actor&&sessionLoadEpoch===session)invalidate();if(!current())return;
  if(result?.error){
   if(draftArchiveRejected(result.error)){controls.forEach(([node,disabled])=>node.disabled=disabled);if(workflow?.isConnected)workflow.inert=workflowInert;card.querySelector('[data-draft-archive-notice]')?.remove();card.removeAttribute('aria-busy');card.draftArchiveState=null;}
   else{state.check=verifyDelete;notice('Deletion could not be confirmed. Check saved status before making another change.',verifyDelete);}
   throw Error(result.error.message);
  }
  let saved;try{saved=draftArchiveReceipt(record,result?.data,actor,true);}catch(error){state.check=verifyDelete;notice('The delete request returned without a complete receipt. Check saved status before making another change.',verifyDelete);throw error;}
  publish(saved);
 }finally{state.posting=false;if(current())state.card.removeAttribute('aria-busy');}
}

async function refreshArchivedCatalogProduct(id,scope){
 if(!scope.current())return;
 catalogDetailRows.delete(id);catalogMachineChoices=catalogMachineChoices.filter(row=>row.id!==id);
 const notice=$('#catalogSaveNotice'),detail=$('#catalogDetail'),left=window.scrollX,top=window.scrollY;
 catalogProductRefreshPending(id,true);
 if(catalogSelectedProduct===id){detail.replaceChildren();catalogSelectedProduct='';}
 const refresh=async()=>{
  if(!scope.current())return;
  notice.textContent='Moved to Deleted Items. Updating product results…';
  try{
   const data=await requestCatalogPage({p_query:catalogSearch,p_category:catalogCategory,p_colour:catalogColour,p_sort:catalogSort,p_page:catalogPage,p_machine_id:catalogMachineId||null});
   if(!scope.current())return;
   if(data.rows.some(row=>row.id===id))throw Error('The deleted product is still in the returned results.');
   catalogReconcilePage(data);notice.textContent='Moved to Deleted Items.';
  }catch(error){
   if(!scope.current())return;
   $('#catalogStatus').textContent='Product counts need refresh.';
   notice.innerHTML=`<p role="alert">Moved to Deleted Items. Product results could not refresh: ${esc(error.message)}.</p><button type="button" data-archive-retry>Retry product results</button>`;
   notice.querySelector('button').onclick=()=>run(refresh);
  }
  if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(notice.querySelector('button')||$('#catalogSearch'));
  window.scrollTo({left,top,behavior:'instant'});
 };
 await refresh();
}
async function appendDeletedBusinessRecords(request){
 const actor=me,owner=me?.role==='owner';
 const [product,proforma]=await Promise.all([canArchiveBusiness('product')?deletedRecyclePage('product',recyclePages.product?.page||0):null,owner?deletedRecyclePage('proforma',recyclePages.proforma?.page||0):null]);
 if(!recycleCurrent(request,actor))return {};
 return {...(product?{product}:{}),...(proforma?{proforma}:{})};
}
function deletedBusinessRecordsHtml(pages){
 return [['product','Products'],['proforma','Draft pro formas']].filter(([kind])=>pages[kind]).map(([kind,title])=>recycleSection(kind,title,pages[kind],pages[kind].rows.map(row=>`<article class="recycle-record" data-recycle-record="${esc(row.id)}"><div><strong>${esc(row.name||row.document_number)}</strong><p>Deleted ${esc(recycleDate(row.deleted_at))}</p></div><button data-restore-business="${kind}" data-id="${esc(row.id)}" data-version="${esc(row.version||0)}">Restore</button></article>`).join(''))).join('');
}
async function restoreDeletedBusinessRecord(kind,id,version){
 if(!['product','proforma'].includes(kind))throw Error('Unsupported record type.');
 if(!canArchiveBusiness(kind))throw Error(kind==='product'?recordsLockedText:'Owner access is required.');
 const context=recycleRestoreContext(kind,id),args={p_id:id,p_archived:false};
 if(kind==='proforma'){
  if(!Number.isSafeInteger(context.record.version)||context.record.version<1||context.record.version!==version)throw Error('Refresh the recycle bin before restoring this draft.');
  args.p_expected_version=context.record.version;
 }
 const result=await client.rpc(kind==='product'?'set_product_archived':'set_draft_proforma_archived',args);if(context.actor!==me)return;if(result.error)throw result.error;
 await recycleRestored(context,kind);
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||busy)return;
 if(button.dataset.archiveBusiness)return run(()=>openArchiveBusinessRecord(button.dataset.archiveBusiness,button.dataset.id));
 if(button.dataset.restoreBusiness)return run(()=>restoreDeletedBusinessRecord(button.dataset.restoreBusiness,button.dataset.id,Number(button.dataset.version)));
});
