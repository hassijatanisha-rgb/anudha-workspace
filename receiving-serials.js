'use strict';
// Stock quantities still use the established count transaction; receipt identities are saved atomically with it.
function receivingSerialCount(pack,lot,sealed,loose){return Number(sealed)*Number(pack.units_per_carton)+Number(loose)-(lot?Number(lot.sealed_cartons)*Number(pack.units_per_carton)+Number(lot.loose_units):0)}
function receivingSerialFieldsHtml(){return '<div class="wide" data-receiving-serials hidden><p>For machines and other serial-tracked products, enter the real serial of every additional unit received. Include units inside sealed cartons. Existing stock is identified separately while packing.</p><label><span data-receiving-serial-count>Serial numbers of added units</span><textarea name="receivingSerials" rows="4" placeholder="One real serial number per line"></textarea></label><p class="muted">To receive more into this lot, enter the new total physical counts above. Reducing serial-tracked stock needs a reviewed serial adjustment.</p></div>'}
const receivingSerialRefreshers=new WeakMap();
function bindReceivingSerialForms(){
 document.querySelectorAll('form[data-inventory-action="opening"],form[data-inventory-action="correct"]').forEach(form=>{
  if(!form.querySelector('[data-receiving-serials]'))form.querySelector('.grid')?.insertAdjacentHTML('beforeend',receivingSerialFieldsHtml());
  let refresh=receivingSerialRefreshers.get(form);
  if(!refresh){refresh=()=>{
   const lot=inventoryLots.find(row=>row.id===form.dataset.lot),pack=inventoryPacks.find(row=>row.id===(lot?.pack_definition_id||form.elements.packId?.value));
   const tracked=!!pack&&serialRequired(pack.product_id),panel=form.querySelector('[data-receiving-serials]');if(!panel)return;
   panel.hidden=!tracked;const field=panel.querySelector('textarea');field.disabled=!tracked;
   if(form.dataset.inventoryAction==='correct'){const summary=form.closest('details')?.querySelector('summary');if(summary)summary.textContent=tracked?'Receive additional units with serials':'Correct this physical count';}
   const added=pack?receivingSerialCount(pack,lot,form.elements.sealedCartons.value,form.elements.looseUnits.value):0;
   field.required=tracked&&added>0;panel.querySelector('[data-receiving-serial-count]').textContent=`Real serial numbers · ${Math.max(0,added)} additional units`;
  };
  receivingSerialRefreshers.set(form,refresh);form.addEventListener('input',refresh);form.addEventListener('change',refresh);}
  refresh();
 });
 bindTransferSerialForms();
 document.querySelectorAll('form[data-inventory-action="issue"]').forEach(form=>{
  const lot=inventoryLots.find(row=>row.id===form.dataset.lot);if(!lot||!serialRequired(lot.product_id))return;
  const details=form.closest('details');if(details)details.innerHTML='<summary>Issue serial-tracked units through Deliveries</summary><p>Create the delivery and record each unit’s real serial number while packing. This preserves ownership and return history.</p>';
 });
}
async function saveInventoryCountWithSerials(args,serialText){
 if(!serialRequired(args.p_product_id))return client.rpc('set_inventory_opening_balance',args);
 const lot=args.p_expected_version?inventoryLots.find(row=>row.id===args.p_lot_id):null,pack=inventoryPacks.find(row=>row.id===args.p_pack_definition_id);
 if(!pack)throw Error('Refresh the saved carton sizes before receiving stock.');
 const added=receivingSerialCount(pack,lot,args.p_sealed_cartons,args.p_loose_units);
 if(added<0)throw Error('Reducing serial-tracked stock needs a reviewed serial adjustment. Do not change a physical count to bypass unit identities.');
 if(added===0)return client.rpc('set_inventory_opening_balance',args);
 const serials=parseSerialList(serialText),problem=serialListProblem(serials,added);if(problem)throw Error(problem);
 return client.rpc('receive_serialized_inventory',{...args,p_serials:serials});
}
async function receivingSerialSearchHtml(serial){
 const result=await client.from('inventory_serial_receipts').select('product_id,serial_number,lot_id,source,recorded_at').ilike('serial_number',`%${String(serial).trim()}%`).order('recorded_at',{ascending:false}).limit(50);
 if(result.error)throw result.error;
 const sources={receiving:'Received into stock',legacy_stock:'Verified legacy stock',legacy_return:'Verified legacy return'};
 return (result.data||[]).length?`<h3>Recorded stock identities</h3><ul>${result.data.map(row=>`<li><code>${esc(row.serial_number)}</code> · ${esc(inventoryProduct(row.product_id).name)} · ${esc(sources[row.source]||row.source)} · ${esc(String(row.recorded_at).slice(0,10))}</li>`).join('')}</ul>`:'';
}

function transferSerialFieldsHtml(transfer,action){
 const receiving=action==='receive';
 return `<div class="wide" data-transfer-serials><p>${receiving?'Scan only the units that actually arrived. The list must match the counted quantity; missing or quarantined units cannot be sold.':`Scan every unit inside the ${esc(transfer.cartons)} cartons being moved (${esc(transfer.expected_units)} units). Only serials available in the source lot can move.`}</p><label><span>${receiving?'Real serial numbers that arrived':'Real serial numbers being dispatched'}</span><textarea name="transferSerials" rows="4" ${receiving?'':'required'} placeholder="One serial per line"></textarea></label><label><input type="checkbox" name="legacyTransfer"> ${receiving?'This transfer left before serial receiving began. I physically checked these legacy units and their real serials.':'These are verified units already in stock before serial receiving began. I physically checked their real serials.'} This confirmation is audited and limited to eligible legacy stock.</label></div>`;
}
function bindTransferSerialForms(){
 document.querySelectorAll('form[data-inventory-action="dispatch"],form[data-inventory-action="receive"]').forEach(form=>{
  const transfer=inventoryTransfers.find(row=>row.id===form.dataset.transfer);if(!transfer||!serialRequired(transfer.product_id)||form.querySelector('[data-transfer-serials]'))return;
  form.querySelector('button[type="submit"]')?.insertAdjacentHTML('beforebegin',transferSerialFieldsHtml(transfer,form.dataset.inventoryAction));
 });
}
async function saveInventoryTransferWithSerials(action,args,serialText,legacyConfirmed){
 const transfer=inventoryTransfers.find(row=>row.id===args.p_id);if(!transfer)throw Error('Refresh this transfer before continuing.');
 const receiving=action==='receive';
 if(!serialRequired(transfer.product_id))return client.rpc(receiving?'receive_inventory_transfer':'dispatch_inventory_transfer',args);
 const serials=parseSerialList(serialText),problem=serialListProblem(serials,receiving?args.p_actual_units:transfer.expected_units);if(problem)throw Error(problem);
 return client.rpc(receiving?'receive_serialized_inventory_transfer':'dispatch_serialized_inventory_transfer',{...args,p_serials:serials,p_legacy_confirmed:legacyConfirmed===true});
}
