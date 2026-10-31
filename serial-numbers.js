'use strict';
// Serial numbers (migration 084). The database decides which products need serials, blocks dispatch until each such
// unit has one, keeps them permanent after dispatch and frees them on return; this file shows and records them.
let serialSettings=new Map(),serialSettingsRequest=0,deliverySerials=[],plannedSerialLines=new Set(),serialToolsSearch='',serialToolsPage=0;
const serialEditableStatuses=['sent_to_sales','packing','ready'];

// Parses what stores typed or scanned: one serial per line or comma, trimmed, blanks dropped.
function parseSerialList(text){return String(text||'').split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean)}
// Problems to fix before saving; the database checks the same and more.
function serialListProblem(serials,quantity){
 if(serials.length!==quantity)return `Enter exactly ${quantity} serial number${quantity===1?'':'s'}; ${serials.length} entered.`;
 const seen=new Set();for(const s of serials){const key=s.toUpperCase();if(seen.has(key))return `${s} is entered twice.`;seen.add(key);}
 if(serials.some(s=>s.length>120))return 'A serial number is too long.';
 return '';
}
function machineSerialRequired(productId){return typeof inventoryClassification==='function'&&inventoryClassification(productId)?.category==='machines'}
function serialRequired(productId){return machineSerialRequired(productId)||serialSettings.get(productId)===true}
function deliveryLineSerialRequired(line,serials=deliverySerials){return serialRequired(line.product_id)||plannedSerialLines.has(line.id)||serials.some(serial=>serial.delivery_line_id===line.id)}
function canFlagSerials(user){return !!user&&(user.role==='owner'||(user.role==='head'&&user.department==='stores'))}

function deliverySerialPanelHtml(note,lines,serials){
 const tracked=lines.filter(line=>deliveryLineSerialRequired(line,serials));if(!tracked.length)return '';
 const editable=serialEditableStatuses.includes(note.status);
 const rows=tracked.map(line=>{const own=serials.filter(s=>s.delivery_line_id===line.id);
  const list=own.length?own.map(s=>`<code>${esc(s.serial_number)}</code>${s.returned_at?' <small>(returned)</small>':''}`).join(', '):'<strong>Not entered yet</strong>';
  return `<li>${esc(salesProduct(line.product_id).name)} × ${esc(line.quantity)} · ${list}</li>`;}).join('');
 const missing=tracked.some(line=>serials.filter(s=>s.delivery_line_id===line.id&&!s.returned_at).length!==line.quantity||serials.some(s=>s.delivery_line_id===line.id&&s.inventory_serial_id===null));
 return `<div class="notice serial-numbers no-print" data-serial-panel="${esc(note.id)}"><h3>Serial numbers</h3><ul>${rows}</ul>${editable&&missing?'<p>This delivery cannot go out until every unit above has its serial number. Enter these before marking Packed.</p>':''}${editable?`<button type="button" data-serial-record="${esc(note.id)}">${missing?'Enter serial numbers':'Correct serial numbers'}</button>`:''}</div>`;
}

async function loadSerialSettings(){
 const actor=me,request=++serialSettingsRequest,epoch=typeof sessionLoadEpoch==='number'?sessionLoadEpoch:0;
 const result=await client.from('product_serial_settings').select('product_id,serial_required');
 if(me!==actor||request!==serialSettingsRequest||epoch!==(typeof sessionLoadEpoch==='number'?sessionLoadEpoch:0))return false;
 if(result.error)return false; // before migration 084: nothing to show
 serialSettings=new Map((result.data||[]).map(row=>[row.product_id,row.serial_required]));return true;
}
let serialDecorationRequest=0;
async function decorateDeliverySerials(){
 plannedSerialLines=new Set();deliverySerials=[];
 const notes=[...document.querySelectorAll('[data-document-card]')].map(card=>salesDeliveryNotes.find(row=>row.id===card.dataset.documentCard)).filter(Boolean);
 if(!notes.length)return;
 const actor=me,request=++serialDecorationRequest,current=()=>me===actor&&request===serialDecorationRequest;
 const settings=loadSerialSettings(),chunks=[];for(let start=0;start<notes.length;start+=100)chunks.push(notes.slice(start,start+100).map(note=>note.id));
 const plans=chunks.map(ids=>Promise.resolve(client.rpc('planned_delivery_serial_lines',{p_delivery_note_ids:ids})));
 const serials=salesRowsFor('delivery_line_serials','delivery_note_id',notes.map(note=>note.id),'serial_number');
 // Observe pending failures even if settings or a stale request cause an early return.
 for(const pending of plans)pending.catch(()=>{});serials.catch(()=>{});
 if(!(await settings)||!current())return;
 const planned=[];
 for(const pending of plans){
  const result=await pending;
  if(!current())return;
  if(result.error){message('Serial requirements could not load. Refresh the delivery list before packing. '+result.error.message,true);return;}
  planned.push(...(result.data||[]));
 }
 const result=await serials;
 if(!current())return;
 if(result.error){message('Serial numbers could not load. Refresh the delivery list before packing. '+result.error.message,true);return;}
 plannedSerialLines=new Set(planned.map(line=>line.delivery_line_id));deliverySerials=result.data||[];
 const relevant=notes.filter(note=>deliveryLines(note.id).some(line=>deliveryLineSerialRequired(line)));
 for(const note of relevant){
  const card=document.querySelector(`[data-document-card="${CSS.escape(note.id)}"]`),actions=card?.querySelector('.actions');
  if(!actions||card.querySelector('[data-serial-panel]'))continue;
  actions.insertAdjacentHTML('beforebegin',deliverySerialPanelHtml(note,deliveryLines(note.id),deliverySerials.filter(s=>s.delivery_note_id===note.id)));
 }
 document.querySelectorAll('[data-serial-record]').forEach(button=>button.onclick=()=>openRecordSerials(salesDeliveryNotes.find(row=>row.id===button.dataset.serialRecord)));
 if(typeof decorateReturnedSerials==='function')decorateReturnedSerials();
}
async function refreshSavedDeliverySerials(note,trigger){
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest;
 let card=document.querySelector(`[data-document-card="${CSS.escape(note.id)}"]`);
 const current=()=>me===actor&&epoch===salesEpoch&&request===salesWorkspaceRequest&&view==='sales'&&!salesEditing&&card?.isConnected;
 async function reload(){
  if(!current())return;
  card.inert=true;card.setAttribute('aria-busy','true');
  let row=note,warning='';
  try{
   await salesSerialsLoading;if(!current())return;
   const result=await salesRowsFor('sales_delivery_notes','id',[note.id]);if(!current())return;if(result.error)throw result.error;
   row=Array.isArray(result.data)&&result.data.length===1?result.data[0]:null;
   if(!row||row.id!==note.id||row.proforma_id!==note.proforma_id||row.organization_id!==note.organization_id||!Number.isSafeInteger(row.version)||row.version<note.version+1||Object.keys(note).some(key=>!Object.hasOwn(row,key)))throw Error('The saved delivery version could not be verified.');
   const problem=await refreshDeliveryAfterStockChange(row,current,trigger);if(problem===null)return;
   card=document.querySelector(`[data-document-card="${CSS.escape(note.id)}"]`);if(!current())return;
   warning=problem;
  }catch(error){
   if(!current())return;
   warning='Serial numbers saved. Current delivery details could not refresh: '+(error.message||'Connection unavailable')+'.';
   salesDeliveryRefreshErrors.set(note.id,warning);salesDeliveryHistoryLoaded.delete(note.id);
   salesPatchStatusCard('delivery',note,trigger);card=document.querySelector(`[data-document-card="${CSS.escape(note.id)}"]`);
  }
  if(!current())return;
  const retry=card.querySelector('[data-delivery-retry]');
  if(retry)retry.onclick=()=>run(reload);
  const focus=retry||card.querySelector('[data-serial-record]')||card.querySelector('.actions button:not(:disabled)');
  if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
  message(warning?'Serial numbers saved. Use Refresh delivery details before continuing.':'Serial numbers saved.');
 }
 await reload();
}
function openRecordSerials(note){
 if(!note)return;
 const context=customerReturnContext(note.id),trigger=document.activeElement;
 const lines=deliveryLines(note.id).filter(line=>deliveryLineSerialRequired(line));
 actionForm('Serial numbers',`<p>${esc(note.delivery_number)}: type or scan the serial number of each unit going out, one per line. Every unit must be available in the allocated stock lot. Transferred units must have a confirmed arrival; quarantined units cannot be selected.</p>`+lines.map(line=>{
   const current=deliverySerials.filter(s=>s.delivery_line_id===line.id).map(s=>s.serial_number).join('\n');
   return `<label><span>${esc(salesProduct(line.product_id).name)} — ${esc(line.quantity)} unit${line.quantity===1?'':'s'}</span><textarea name="serials_${esc(line.id)}" rows="${Math.min(8,Math.max(2,line.quantity))}" required>${esc(current)}</textarea></label><label><input type="checkbox" name="legacy_${esc(line.id)}"> These are verified units already in stock before serial receiving began. I checked their real serials. This confirmation is audited and limited to remaining legacy stock.</label>`;}).join(''),
  async values=>{
   if(!context.current()||salesEditing)throw Error('Reopen this delivery before recording serial numbers.');
   const payload=lines.map(line=>({deliveryLineId:line.id,serials:parseSerialList(values['serials_'+line.id]),legacyConfirmed:values['legacy_'+line.id]==='on'}));
   for(const [i,item] of payload.entries()){const problem=serialListProblem(item.serials,lines[i].quantity);if(problem)throw Error(`${salesProduct(lines[i].product_id).name}: ${problem}`);}
   let result;try{result=await client.rpc('record_delivery_serials',{p_delivery_note_id:note.id,p_expected_version:note.version,p_lines:payload});}catch(error){if(!context.current())return;throw error;}
   if(me!==context.actor)return;if(result.error){if(context.current())throw result.error;return;}
   invalidateReturnStockCaches();salesLoadRequest++;salesProformaPageKey='';salesDeliveryPageKey='';
   if(context.current())await refreshSavedDeliverySerials(note,trigger);
  });
}
// Returns panel (customer-returns.js): mark which serials came back on a return line.
function decorateReturnedSerials(){
 document.querySelectorAll('[data-returns-panel]').forEach(panel=>{
  const noteId=panel.dataset.returnsPanel,out=deliverySerials.filter(s=>s.delivery_note_id===noteId&&!s.returned_at);if(!out.length)return;
  const lines=(typeof customerReturnLines!=='undefined'?customerReturnLines:[]).filter(line=>deliverySerials.some(s=>s.delivery_line_id===line.delivery_line_id&&s.delivery_note_id===noteId));
  for(const line of lines){
   const marked=deliverySerials.filter(s=>s.return_line_id===line.id).length;if(marked>=line.quantity||panel.querySelector(`[data-serial-return="${CSS.escape(line.id)}"]`))continue;
   panel.insertAdjacentHTML('beforeend',`<button type="button" data-serial-return="${esc(line.id)}">Mark returned serials · ${esc(salesProduct(line.product_id).name)} (${esc(line.quantity-marked)} to mark)</button>`);
  }
  panel.querySelectorAll('[data-serial-return]').forEach(button=>button.onclick=()=>openMarkReturnedSerials(customerReturnLines.find(row=>row.id===button.dataset.serialReturn)));
 });
}
function openMarkReturnedSerials(line){
 const ret=line&&customerReturns.find(row=>row.id===line.return_id);if(!ret)return;
 const context=customerReturnContext(ret.delivery_note_id);
 const out=deliverySerials.filter(s=>s.delivery_line_id===line.delivery_line_id&&!s.returned_at);
 actionForm('Serials that came back',`<p>${esc(salesProduct(line.product_id).name)}: tick the units that came back on this return.</p>`+out.map(s=>`<label><input type="checkbox" name="sn_${esc(s.id)}"> ${esc(s.serial_number)}</label>`).join(''),
  async values=>{
   if(!context.current())throw Error('Reopen this return before marking serial numbers.');
   const serials=out.filter(s=>values['sn_'+s.id]==='on').map(s=>s.serial_number);
   if(!serials.length)throw Error('Tick at least one serial number.');
   let result;try{result=await client.rpc('mark_serials_returned',{p_return_line_id:line.id,p_serials:serials});}catch(error){if(!context.current())return;throw error;}
   if(me!==context.actor)return;if(result.error){if(context.current())throw result.error;return;}
   invalidateReturnStockCaches();
   await refreshCustomerReturnPanel(ret.delivery_note_id,'Returned serial numbers recorded.',context,{id:line.return_id});
  });
}

function serialFlaggedPage(){
 const query=serialToolsSearch.trim().toLowerCase(),rows=[...new Set([...serialSettings.keys(),...(typeof products!=='undefined'?products:[]).map(product=>product.id)])].filter(serialRequired).filter(id=>{const product=inventoryProduct(id);return `${product.name} ${product.sku||''} ${id}`.toLowerCase().includes(query)});
 const pages=Math.max(1,Math.ceil(rows.length/50));serialToolsPage=Math.max(0,Math.min(serialToolsPage,pages-1));return {rows:rows.slice(serialToolsPage*50,serialToolsPage*50+50),total:rows.length,pages};
}
function serialFlaggedHtml(){
 const page=serialFlaggedPage();
 return `<p role="status">${page.total} matching products · Page ${serialToolsPage+1} of ${page.pages}</p><ul>${page.rows.map(productId=>`<li>${esc(inventoryProduct(productId).name)} ${machineSerialRequired(productId)?'<small>Required for machines</small>':`<button type="button" data-serial-unflag="${esc(productId)}">Remove</button>`}</li>`).join('')||'<li>No matching products.</li>'}</ul><button type="button" id="serialToolsPrevious" ${serialToolsPage===0?'disabled':''}>Previous</button><button type="button" id="serialToolsNext" ${serialToolsPage+1>=page.pages?'disabled':''}>Next</button>`;
}
function bindSerialFlaggedList(){
 for(const [id,step] of [['serialToolsPrevious',-1],['serialToolsNext',1]]){const button=$('#'+id);if(button)button.onclick=()=>{serialToolsPage+=step;$('#serialFlaggedList').innerHTML=serialFlaggedHtml();bindSerialFlaggedList();const next=$('#'+id);(next.disabled?$('#serialFlaggedSearch'):next)?.focus()};}
 $('#content').querySelectorAll('[data-serial-unflag]').forEach(button=>button.onclick=()=>run(async()=>{
  const result=await client.rpc('set_product_serial_required',{p_product_id:button.dataset.serialUnflag,p_required:false});if(result.error)throw result.error;
  $('#content').querySelector('[data-serial-tools]')?.remove();await decorateSerialTools();message('That product no longer needs serial numbers.');
 }));
}
// Inventory: find who has a serial, and (stores head or owner) choose which products need serials.
async function decorateSerialTools(){
 const content=$('#content');if(!content||content.querySelector('[data-serial-tools]')||!$('#inventoryRefresh'))return;
 const actor=me?.user_id;if(!(await loadSerialSettings())||me?.user_id!==actor)return;
 content.insertAdjacentHTML('beforeend',`<section class="card serial-tools" data-serial-tools><h2>Serial numbers</h2>
  <form id="serialSearch" class="actions"><input name="serial" placeholder="Serial number" minlength="2" maxlength="120" required><button type="submit">Find</button></form><div id="serialResults"></div>
  ${canFlagSerials(me)?`<p>Every machine needs its real serial number before it can be marked Packed or sent out.</p><h3>Products that need serial numbers</h3><label><span>Search serial-tracked products</span><input id="serialFlaggedSearch" type="search" value="${esc(serialToolsSearch)}" placeholder="Product name or stock code"></label><div id="serialFlaggedList">${serialFlaggedHtml()}</div>
  <form id="serialFlag" class="actions"><input name="product" list="serialProductChoices" placeholder="Product name or code" required><datalist id="serialProductChoices" data-lookup-values="products">${inventoryProductChoices()}</datalist><button type="submit">Needs serial numbers</button></form>`:''}</section>`);
 $('#serialSearch').onsubmit=event=>{event.preventDefault();run(async()=>{
  const actor=me?.user_id,value=new FormData(event.target).get('serial'),result=await client.rpc('find_serial',{p_serial:value});
  if(result.error)throw result.error;
  const receiptHtml=typeof receivingSerialSearchHtml==='function'?await receivingSerialSearchHtml(value):'';if(me?.user_id!==actor)return;
  $('#serialResults').innerHTML=receiptHtml+((result.data||[]).length?`<ul>${result.data.map(r=>`<li><code>${esc(r.serial_number)}</code> · ${esc(inventoryProduct(r.product_id).name)} · ${esc(r.organization_name||'Customer unavailable')} · ${esc(r.delivery_number)} (${esc(typeof salesStatus==='function'?salesStatus(r.delivery_status):r.delivery_status)})${r.returned_at?' · came back '+esc(String(r.returned_at).slice(0,10)):''}</li>`).join('')}</ul>`:'<p>No delivery has this serial number.</p>');
 });};
 $('#serialFlag')?.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const text=String(new FormData(event.target).get('product')||'').trim(),product=inventoryProductFromChoice(text);
  if(!product)throw Error('Choose a product from the list.');
  const result=await client.rpc('set_product_serial_required',{p_product_id:product.id,p_required:true});if(result.error)throw result.error;
  content.querySelector('[data-serial-tools]')?.remove();await decorateSerialTools();message(`${product.name} now needs serial numbers when received and packed.`);
 });});
 const filter=$('#serialFlaggedSearch');if(filter)filter.oninput=()=>{serialToolsSearch=filter.value;serialToolsPage=0;$('#serialFlaggedList').innerHTML=serialFlaggedHtml();bindSerialFlaggedList();};
 bindSerialFlaggedList();
 if(typeof bindReceivingSerialForms==='function')bindReceivingSerialForms();
}
