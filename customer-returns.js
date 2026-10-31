'use strict';
// Customer returns on delivered orders (migration 082). The database enforces the 7-day window, quantities, who may
// inspect and who may create credit notes; this file shows the state and offers the actions it will accept.
let customerReturns=[],customerReturnLines=[],returnsAccountingActor=null,returnsAccountingAllowed=false,returnsReadRequest=0;
const returnCategoryLabels={wrong_item:'Wrong item',wrong_size:'Wrong size',unopened:'Unopened, not needed',damaged:'Damaged',expired:'Expired',sterile:'Sterile goods',cold_chain:'Cold-chain reagent',other:'Other'};
const returnResolutionLabels={restock:'Back into stock',write_off:'Written off',return_to_supplier:'Returned to supplier'};

// How many of each delivered line can still come back.
function returnableQuantities(deliveryRows,returnRows){
 const returned=new Map();for(const row of returnRows||[])returned.set(row.delivery_line_id,(returned.get(row.delivery_line_id)||0)+Number(row.quantity));
 return new Map((deliveryRows||[]).map(line=>[line.id,Math.max(0,Number(line.quantity)-(returned.get(line.id)||0))]));
}
// Days since delivery in Dar es Salaam (UTC+3 all year); the database applies the same rule.
function returnDaysSinceDelivery(deliveredAt,now=Date.now()){
 const day=value=>Math.floor((Date.parse(value)+3*3600e3)/864e5);
 return day(new Date(now).toISOString())-day(deliveredAt);
}
function canInspectReturns(user){return !!user&&(user.role==='owner'||(user.role==='head'&&user.department==='stores'))}

function returnsPanelHtml(note,returns,lines,user,accounting){
 const remaining=returnableQuantities(deliveryLines(note.id),lines),canReturn=[...remaining.values()].some(q=>q>0);
 const rows=returns.map(ret=>{
  const own=lines.filter(line=>line.return_id===ret.id);
  const items=own.map(line=>`<li>${esc(salesProduct(line.product_id).name)} × ${esc(line.quantity)} · ${line.resolution?esc(returnResolutionLabels[line.resolution])+' — '+esc(line.resolution_note):'<strong>In quarantine, waiting for inspection</strong>'}${!line.resolution&&canInspectReturns(user)?` <button type="button" data-return-inspect="${esc(line.id)}">Inspect</button>`:''}</li>`).join('');
  const credit=ret.credit_note_draft_id?'<small>Credit Note draft created for accounts.</small>':accounting?`<button type="button" data-return-credit="${esc(ret.id)}">Create Credit Note draft</button>`:'';
  return `<div class="return-record"><strong>${esc(ret.return_number)}</strong> · ${esc(returnCategoryLabels[ret.category]||ret.category)}${ret.late_override_reason?` · late, accepted: ${esc(ret.late_override_reason)}`:''}<ul>${items}</ul>${credit}</div>`;
 }).join('');
 return `<div class="notice customer-returns no-print" data-returns-panel="${esc(note.id)}"><h3>Returns</h3>${rows||'<p>No goods returned.</p>'}${canReturn?`<button type="button" data-return-record="${esc(note.id)}">Record returned goods</button>`:''}</div>`;
}

async function decorateCustomerReturns(){
 const notes=[...document.querySelectorAll('[data-document-card]')].map(card=>salesDeliveryNotes.find(row=>row.id===card.dataset.documentCard)).filter(note=>note&&note.status==='delivered');
 if(!notes.length)return;
 const actor=me,request=++returnsReadRequest,epoch=salesEpoch,workspace=salesWorkspaceRequest;
 const current=()=>me===actor&&request===returnsReadRequest&&epoch===salesEpoch&&workspace===salesWorkspaceRequest&&view==='sales';
 const result=await client.from('sales_returns').select('*').in('delivery_note_id',notes.map(note=>note.id)).order('received_at');
 if(result.error||!current())return; // before migration 082 the table does not exist: show nothing
 const lineResult=result.data.length?await client.from('sales_return_lines').select('*').in('return_id',result.data.map(row=>row.id)):{data:[]};
 if(lineResult.error||!current())return;
 if(returnsAccountingActor!==actor){const access=await client.rpc('accounting_access');if(!current())return;returnsAccountingActor=actor;returnsAccountingAllowed=!access.error&&access.data===true;}
 if(!current())return;
 customerReturns=result.data;customerReturnLines=lineResult.data||[];
 for(const note of notes){
  const card=document.querySelector(`[data-document-card="${CSS.escape(note.id)}"]`),actions=card?.querySelector('.actions');
  if(!actions||card.querySelector('[data-returns-panel]'))continue;
  const returns=customerReturns.filter(row=>row.delivery_note_id===note.id),ids=new Set(returns.map(row=>row.id));
  actions.insertAdjacentHTML('beforebegin',returnsPanelHtml(note,returns,customerReturnLines.filter(line=>ids.has(line.return_id)),me,returnsAccountingAllowed));
 }
 bindCustomerReturnActions(document);
 if(typeof decorateReturnedSerials==='function')decorateReturnedSerials(); // serial-numbers.js; whichever panel loads last adds the button
}
function bindCustomerReturnActions(root){
 root.querySelectorAll('[data-return-record]').forEach(button=>button.onclick=()=>openRecordReturn(salesDeliveryNotes.find(row=>row.id===button.dataset.returnRecord)));
 root.querySelectorAll('[data-return-inspect]').forEach(button=>button.onclick=()=>openInspectReturnLine(customerReturnLines.find(row=>row.id===button.dataset.returnInspect)));
 root.querySelectorAll('[data-return-credit]').forEach(button=>button.onclick=()=>run(()=>createReturnCreditNote(customerReturns.find(row=>row.id===button.dataset.returnCredit))));
}
function customerReturnContext(noteId){
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,card=document.querySelector(`[data-document-card="${CSS.escape(noteId)}"]`);
 return {actor,card,current:()=>me===actor&&epoch===salesEpoch&&request===salesWorkspaceRequest&&view==='sales'&&card?.isConnected};
}
function invalidateReturnStockCaches(){
 inventoryLoaded=false;inventoryEpoch++;inventoryStockPageKey='';inventoryOperationsKey='';inventoryStockActionsReady=false;salesLoaded=false;
}
async function refreshCustomerReturnPanel(noteId,text,context,expected={}){
 if(!context.current())return;
 const request=++returnsReadRequest,current=()=>context.current()&&request===returnsReadRequest;
 let panel=context.card.querySelector('[data-returns-panel]');if(!panel){message(text);return;}
 const left=window.scrollX,top=window.scrollY;
 async function reload(){
  if(!current()||!panel.isConnected)return;
  panel.innerHTML=`<h3>Returns</h3><p role="status">${esc(text)} Updating return details…</p>`;
  try{
   await salesSerialsLoading;if(!current())return;
   const [returns,serials,access]=await Promise.all([salesRowsFor('sales_returns','delivery_note_id',[noteId],'received_at'),salesRowsFor('delivery_line_serials','delivery_note_id',[noteId],'serial_number'),client.rpc('accounting_access')]);
   if(!current())return;
   const failure=[returns,serials,access].find(result=>result.error);if(failure)throw failure.error;
   if(!Array.isArray(returns.data)||!Array.isArray(serials.data)||returns.data.some(row=>row.delivery_note_id!==noteId)||serials.data.some(row=>row.delivery_note_id!==noteId))throw Error('Current return records could not be verified.');
   const saved=returns.data.find(row=>row.id===expected.id);
   if(expected.id&&(!saved||!Number.isSafeInteger(saved.version)||saved.version<(expected.version||1)||expected.creditId&&saved.credit_note_draft_id!==expected.creditId))throw Error('The saved return version could not be verified.');
   const ids=returns.data.map(row=>row.id),lines=ids.length?await salesRowsFor('sales_return_lines','return_id',ids):{data:[]};
   if(!current())return;if(lines.error)throw lines.error;
   if(!Array.isArray(lines.data)||lines.data.some(line=>!ids.includes(line.return_id)||!Number.isSafeInteger(line.quantity)||line.quantity<1))throw Error('Returned quantities could not be verified.');
   const previousIds=new Set(customerReturns.filter(row=>row.delivery_note_id===noteId).map(row=>row.id));
   customerReturns=[...customerReturns.filter(row=>row.delivery_note_id!==noteId),...returns.data];
   customerReturnLines=[...customerReturnLines.filter(line=>!previousIds.has(line.return_id)),...lines.data];
   deliverySerials=[...deliverySerials.filter(serial=>serial.delivery_note_id!==noteId),...serials.data];
   returnsAccountingActor=context.actor;returnsAccountingAllowed=access.data===true;
   const note=salesDeliveryNotes.find(row=>row.id===noteId);if(!note)throw Error('The delivery is no longer open.');
   const template=document.createElement('template');template.innerHTML=returnsPanelHtml(note,returns.data,lines.data,me,returnsAccountingAllowed);
   const next=template.content.firstElementChild;panel.replaceWith(next);panel=next;bindCustomerReturnActions(panel);
   const serialPanel=context.card.querySelector('[data-serial-panel]');if(serialPanel){template.innerHTML=deliverySerialPanelHtml(note,deliveryLines(noteId),serials.data);if(template.content.firstElementChild)serialPanel.replaceWith(template.content.firstElementChild);else serialPanel.remove();}
   if(typeof decorateReturnedSerials==='function')decorateReturnedSerials();
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(panel.querySelector('button')||panel);
   message(text);
  }catch(error){
   if(!current()||!panel.isConnected)return;
   const serialPanel=context.card.querySelector('[data-serial-panel]');if(serialPanel)serialPanel.innerHTML='<h3>Serial numbers</h3><p>Refresh return details to see current serials.</p>';
   panel.innerHTML=`<h3>Returns</h3><p role="alert">${esc(text)} Current details could not refresh: ${esc(error.message||'Connection unavailable')}.</p><button type="button" data-return-retry>Retry return details</button>`;
   panel.querySelector('[data-return-retry]').onclick=()=>run(reload);
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(panel.querySelector('button'));
   message(text+' Use Retry return details before another return action.');
  }
  window.scrollTo({left,top,behavior:'instant'});
 }
 await reload();
}

function openRecordReturn(note){
 if(!note)return;
 const context=customerReturnContext(note.id);
 const returnId=crypto.randomUUID(),lines=deliveryLines(note.id);
 const remaining=returnableQuantities(lines,customerReturnLines.filter(line=>customerReturns.some(ret=>ret.id===line.return_id&&ret.delivery_note_id===note.id)));
 const days=note.delivered_at?returnDaysSinceDelivery(note.delivered_at):0,late=days>7;
 actionForm('Record returned goods',
  `<p>${esc(note.delivery_number)} · delivered ${esc(String(note.delivered_at||'').slice(0,10))} (${esc(days)} day${days===1?'':'s'} ago). Returned goods go into quarantine until the stores head inspects them.</p>
  <label><span>Why did the goods come back?</span><select name="category" required><option value="">Choose</option>${Object.entries(returnCategoryLabels).map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}</select></label>
  ${lines.map(line=>`<label><span>${esc(salesProduct(line.product_id).name)} — returned quantity (up to ${esc(remaining.get(line.id)??0)})</span><input name="qty_${esc(line.id)}" type="number" min="0" max="${esc(remaining.get(line.id)??0)}" step="1" value="0"></label>`).join('')}
  <label><span>Notes</span><textarea name="notes" maxlength="2000"></textarea></label>
  ${late?'<p class="notice">This delivery is more than 7 days old. Only a department head or the owner can accept it, with a reason.</p><label><span>Reason for accepting a late return</span><textarea name="override" required minlength="5" maxlength="1000"></textarea></label>':''}`,
  async values=>{
   if(!context.current())throw Error('Reopen the delivery before recording its return.');
   const items=lines.map(line=>({deliveryLineId:line.id,quantity:Number(values['qty_'+line.id]||0)})).filter(item=>item.quantity>0);
   if(!items.length)throw Error('Enter the quantity returned for at least one item.');
   if(items.some(item=>!Number.isSafeInteger(item.quantity)||item.quantity>(remaining.get(item.deliveryLineId)||0)))throw Error('Each quantity must be a whole number no larger than what is left to return.');
   let result;try{result=await client.rpc('record_sales_return',{p_id:returnId,p_delivery_note_id:note.id,p_category:values.category,p_notes:values.notes||'',p_late_override_reason:late?values.override||'':'',p_lines:items});}catch(error){if(!context.current())return;throw error;}
   if(me!==context.actor)return;
   if(result.error){if(context.current())throw result.error;return;}
   invalidateReturnStockCaches();
   await refreshCustomerReturnPanel(note.id,'Return recorded. The goods are in quarantine until inspected.',context,{id:returnId,version:1});
  });
}
function openInspectReturnLine(line){
 const ret=line&&customerReturns.find(row=>row.id===line.return_id);if(!ret)return;
 const context=customerReturnContext(ret.delivery_note_id);
 const needsConfirm=['sterile','cold_chain'].includes(ret.category);
 actionForm('Inspect returned goods',
  `<p>${esc(ret.return_number)} · ${esc(salesProduct(line.product_id).name)} × ${esc(line.quantity)} · ${esc(returnCategoryLabels[ret.category])}</p>
  <label><span>Decision</span><select name="resolution" required><option value="">Choose</option>${ret.category==='expired'?'':'<option value="restock">Back into stock</option>'}<option value="write_off">Write off</option><option value="return_to_supplier">Return to supplier</option></select></label>
  <label><span>What did the inspection find?</span><textarea name="note" required minlength="3" maxlength="1000"></textarea></label>
  ${needsConfirm?'<label><input type="checkbox" name="confirmed"> I checked the seal and the cold-chain temperature record before putting this back into stock</label>':''}`,
  async values=>{
   if(!context.current())throw Error('Reopen the return before inspecting it.');
   let result;try{result=await client.rpc('resolve_sales_return_line',{p_line_id:line.id,p_expected_version:ret.version,p_resolution:values.resolution,p_note:values.note||'',p_condition_confirmed:values.confirmed==='on'});}catch(error){if(!context.current())return;throw error;}
   if(me!==context.actor)return;
   if(result.error){if(context.current())throw result.error;return;}
   invalidateReturnStockCaches();
   await refreshCustomerReturnPanel(ret.delivery_note_id,'Inspection saved: '+(returnResolutionLabels[values.resolution]||'decided')+'.',context,{id:ret.id,version:ret.version+1});
  });
}
async function createReturnCreditNote(ret){
 if(!ret||ret.credit_note_draft_id)return;
 const context=customerReturnContext(ret.delivery_note_id),id=ret.id,version=ret.version,panel=context.card?.querySelector('[data-returns-panel]'),trigger=panel?.querySelector(`[data-return-credit="${CSS.escape(id)}"]`);
 const current=()=>context.current()&&panel?.isConnected&&trigger?.isConnected&&context.card.querySelector('[data-returns-panel]')===panel&&ret.id===id&&customerReturns.find(row=>row.id===id)===ret&&ret.version===version&&!ret.credit_note_draft_id;
 if(!current())return;
 if(!await askConfirm({title:`Create a Credit Note draft for ${ret.return_number}?`,body:'The draft is priced from the original Pro forma and added to Accounting drafts for review.',confirmLabel:'Create Credit Note draft',tone:'normal'})||!current())return;
 const draftId=crypto.randomUUID();
 let result;try{result=await client.rpc('create_return_credit_note',{p_return_id:ret.id,p_expected_version:ret.version,p_draft_id:draftId});}catch(error){if(!context.current())return;throw error;}
 if(me!==context.actor)return;
 if(result.error){if(context.current())throw result.error;return;}
 await refreshCustomerReturnPanel(ret.delivery_note_id,'Credit Note draft created. Open Accounting to review it.',context,{id:ret.id,version:ret.version+1,creditId:draftId});
}
