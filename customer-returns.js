'use strict';
// Customer returns on delivered orders (migration 082). The database enforces the 7-day window, quantities, who may
// inspect and who may create credit notes; this file shows the state and offers the actions it will accept.
let customerReturns=[],customerReturnLines=[],returnsAccountingActor=null,returnsAccountingAllowed=false;
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
 const actor=me?.user_id;
 const result=await client.from('sales_returns').select('*').in('delivery_note_id',notes.map(note=>note.id)).order('received_at');
 if(result.error||me?.user_id!==actor)return; // before migration 082 the table does not exist: show nothing
 const lineResult=result.data.length?await client.from('sales_return_lines').select('*').in('return_id',result.data.map(row=>row.id)):{data:[]};
 if(lineResult.error||me?.user_id!==actor)return;
 if(returnsAccountingActor!==actor){const access=await client.rpc('accounting_access');returnsAccountingActor=actor;returnsAccountingAllowed=!access.error&&access.data===true;}
 if(me?.user_id!==actor)return;
 customerReturns=result.data;customerReturnLines=lineResult.data||[];
 for(const note of notes){
  const card=document.querySelector(`[data-document-card="${CSS.escape(note.id)}"]`),actions=card?.querySelector('.actions');
  if(!actions||card.querySelector('[data-returns-panel]'))continue;
  const returns=customerReturns.filter(row=>row.delivery_note_id===note.id),ids=new Set(returns.map(row=>row.id));
  actions.insertAdjacentHTML('beforebegin',returnsPanelHtml(note,returns,customerReturnLines.filter(line=>ids.has(line.return_id)),me,returnsAccountingAllowed));
 }
 document.querySelectorAll('[data-return-record]').forEach(button=>button.onclick=()=>openRecordReturn(salesDeliveryNotes.find(row=>row.id===button.dataset.returnRecord)));
 document.querySelectorAll('[data-return-inspect]').forEach(button=>button.onclick=()=>openInspectReturnLine(customerReturnLines.find(row=>row.id===button.dataset.returnInspect)));
 document.querySelectorAll('[data-return-credit]').forEach(button=>button.onclick=()=>run(()=>createReturnCreditNote(customerReturns.find(row=>row.id===button.dataset.returnCredit))));
}

function openRecordReturn(note){
 if(!note)return;
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
   const items=lines.map(line=>({deliveryLineId:line.id,quantity:Number(values['qty_'+line.id]||0)})).filter(item=>item.quantity>0);
   if(!items.length)throw Error('Enter the quantity returned for at least one item.');
   if(items.some(item=>!Number.isSafeInteger(item.quantity)||item.quantity>(remaining.get(item.deliveryLineId)||0)))throw Error('Each quantity must be a whole number no larger than what is left to return.');
   const result=await client.rpc('record_sales_return',{p_id:returnId,p_delivery_note_id:note.id,p_category:values.category,p_notes:values.notes||'',p_late_override_reason:late?values.override||'':'',p_lines:items});
   if(result.error)throw result.error;
   if(typeof loadInventoryOperations==='function')await loadInventoryOperations();
   await salesDeliveryWorkspace(true);message(`Return ${result.data?.return_number||''} recorded. The goods are in quarantine until inspected.`);
  });
}
function openInspectReturnLine(line){
 const ret=line&&customerReturns.find(row=>row.id===line.return_id);if(!ret)return;
 const needsConfirm=['sterile','cold_chain'].includes(ret.category);
 actionForm('Inspect returned goods',
  `<p>${esc(ret.return_number)} · ${esc(salesProduct(line.product_id).name)} × ${esc(line.quantity)} · ${esc(returnCategoryLabels[ret.category])}</p>
  <label><span>Decision</span><select name="resolution" required><option value="">Choose</option>${ret.category==='expired'?'':'<option value="restock">Back into stock</option>'}<option value="write_off">Write off</option><option value="return_to_supplier">Return to supplier</option></select></label>
  <label><span>What did the inspection find?</span><textarea name="note" required minlength="3" maxlength="1000"></textarea></label>
  ${needsConfirm?'<label><input type="checkbox" name="confirmed"> I checked the seal and the cold-chain temperature record before putting this back into stock</label>':''}`,
  async values=>{
   const result=await client.rpc('resolve_sales_return_line',{p_line_id:line.id,p_expected_version:ret.version,p_resolution:values.resolution,p_note:values.note||'',p_condition_confirmed:values.confirmed==='on'});
   if(result.error)throw result.error;
   if(typeof loadInventoryOperations==='function')await loadInventoryOperations();
   await salesDeliveryWorkspace(true);message('Inspection saved: '+(returnResolutionLabels[values.resolution]||'decided')+'.');
  });
}
async function createReturnCreditNote(ret){
 if(!ret||!confirm(`Create a Credit Note draft for ${ret.return_number}? It is priced from the original Pro forma and goes to Accounting drafts.`))return;
 const result=await client.rpc('create_return_credit_note',{p_return_id:ret.id,p_expected_version:ret.version,p_draft_id:crypto.randomUUID()});
 if(result.error)throw result.error;
 await salesDeliveryWorkspace(true);message('Credit Note draft created. Open Accounting to review, number and issue it.');
}
