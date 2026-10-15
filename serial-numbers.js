'use strict';
// Serial numbers (migration 084). The database decides which products need serials, blocks dispatch until each such
// unit has one, keeps them permanent after dispatch and frees them on return; this file shows and records them.
let serialSettings=new Map(),deliverySerials=[];
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
function serialRequired(productId){return serialSettings.get(productId)===true}
function canFlagSerials(user){return !!user&&(user.role==='owner'||(user.role==='head'&&user.department==='stores'))}

function deliverySerialPanelHtml(note,lines,serials){
 const tracked=lines.filter(line=>serialRequired(line.product_id));if(!tracked.length)return '';
 const editable=serialEditableStatuses.includes(note.status);
 const rows=tracked.map(line=>{const own=serials.filter(s=>s.delivery_line_id===line.id);
  const list=own.length?own.map(s=>`<code>${esc(s.serial_number)}</code>${s.returned_at?' <small>(returned)</small>':''}`).join(', '):'<strong>Not entered yet</strong>';
  return `<li>${esc(salesProduct(line.product_id).name)} × ${esc(line.quantity)} · ${list}</li>`;}).join('');
 const missing=tracked.some(line=>serials.filter(s=>s.delivery_line_id===line.id&&!s.returned_at).length!==line.quantity);
 return `<div class="notice serial-numbers no-print" data-serial-panel="${esc(note.id)}"><h3>Serial numbers</h3><ul>${rows}</ul>${editable&&missing?'<p>This delivery cannot go out until every unit above has its serial number.</p>':''}${editable?`<button type="button" data-serial-record="${esc(note.id)}">${missing?'Enter serial numbers':'Correct serial numbers'}</button>`:''}</div>`;
}

async function loadSerialSettings(){
 const result=await client.from('product_serial_settings').select('product_id,serial_required');
 if(result.error)return false; // before migration 084: nothing to show
 serialSettings=new Map((result.data||[]).map(row=>[row.product_id,row.serial_required]));return true;
}
async function decorateDeliverySerials(){
 const notes=[...document.querySelectorAll('[data-document-card]')].map(card=>salesDeliveryNotes.find(row=>row.id===card.dataset.documentCard)).filter(Boolean);
 if(!notes.length)return;
 const actor=me?.user_id;
 if(!(await loadSerialSettings())||me?.user_id!==actor)return;
 const relevant=notes.filter(note=>deliveryLines(note.id).some(line=>serialRequired(line.product_id)));if(!relevant.length)return;
 const result=await client.from('delivery_line_serials').select('*').in('delivery_note_id',relevant.map(note=>note.id)).order('serial_number');
 if(result.error||me?.user_id!==actor)return;
 deliverySerials=result.data||[];
 for(const note of relevant){
  const card=document.querySelector(`[data-document-card="${CSS.escape(note.id)}"]`),actions=card?.querySelector('.actions');
  if(!actions||card.querySelector('[data-serial-panel]'))continue;
  actions.insertAdjacentHTML('beforebegin',deliverySerialPanelHtml(note,deliveryLines(note.id),deliverySerials.filter(s=>s.delivery_note_id===note.id)));
 }
 document.querySelectorAll('[data-serial-record]').forEach(button=>button.onclick=()=>openRecordSerials(salesDeliveryNotes.find(row=>row.id===button.dataset.serialRecord)));
 if(typeof decorateReturnedSerials==='function')decorateReturnedSerials();
}
function openRecordSerials(note){
 if(!note)return;
 const lines=deliveryLines(note.id).filter(line=>serialRequired(line.product_id));
 actionForm('Serial numbers',`<p>${esc(note.delivery_number)}: type or scan the serial number of each unit going out, one per line.</p>`+lines.map(line=>{
   const current=deliverySerials.filter(s=>s.delivery_line_id===line.id).map(s=>s.serial_number).join('\n');
   return `<label><span>${esc(salesProduct(line.product_id).name)} — ${esc(line.quantity)} unit${line.quantity===1?'':'s'}</span><textarea name="serials_${esc(line.id)}" rows="${Math.min(8,Math.max(2,line.quantity))}" required>${esc(current)}</textarea></label>`;}).join(''),
  async values=>{
   const payload=lines.map(line=>({deliveryLineId:line.id,serials:parseSerialList(values['serials_'+line.id])}));
   for(const [i,item] of payload.entries()){const problem=serialListProblem(item.serials,lines[i].quantity);if(problem)throw Error(`${salesProduct(lines[i].product_id).name}: ${problem}`);}
   const result=await client.rpc('record_delivery_serials',{p_delivery_note_id:note.id,p_expected_version:note.version,p_lines:payload});
   if(result.error)throw result.error;
   await salesDeliveryWorkspace(true);message('Serial numbers saved.');
  });
}
// Returns panel (customer-returns.js): mark which serials came back on a return line.
function decorateReturnedSerials(){
 document.querySelectorAll('[data-returns-panel]').forEach(panel=>{
  const noteId=panel.dataset.returnsPanel,out=deliverySerials.filter(s=>s.delivery_note_id===noteId&&!s.returned_at);if(!out.length)return;
  const lines=(typeof customerReturnLines!=='undefined'?customerReturnLines:[]).filter(line=>serialRequired(line.product_id)&&deliverySerials.some(s=>s.delivery_line_id===line.delivery_line_id&&s.delivery_note_id===noteId));
  for(const line of lines){
   const marked=deliverySerials.filter(s=>s.return_line_id===line.id).length;if(marked>=line.quantity||panel.querySelector(`[data-serial-return="${CSS.escape(line.id)}"]`))continue;
   panel.insertAdjacentHTML('beforeend',`<button type="button" data-serial-return="${esc(line.id)}">Mark returned serials · ${esc(salesProduct(line.product_id).name)} (${esc(line.quantity-marked)} to mark)</button>`);
  }
  panel.querySelectorAll('[data-serial-return]').forEach(button=>button.onclick=()=>openMarkReturnedSerials(customerReturnLines.find(row=>row.id===button.dataset.serialReturn)));
 });
}
function openMarkReturnedSerials(line){
 if(!line)return;
 const out=deliverySerials.filter(s=>s.delivery_line_id===line.delivery_line_id&&!s.returned_at);
 actionForm('Serials that came back',`<p>${esc(salesProduct(line.product_id).name)}: tick the units that came back on this return.</p>`+out.map(s=>`<label><input type="checkbox" name="sn_${esc(s.id)}"> ${esc(s.serial_number)}</label>`).join(''),
  async values=>{
   const serials=out.filter(s=>values['sn_'+s.id]==='on').map(s=>s.serial_number);
   if(!serials.length)throw Error('Tick at least one serial number.');
   const result=await client.rpc('mark_serials_returned',{p_return_line_id:line.id,p_serials:serials});
   if(result.error)throw result.error;
   await salesDeliveryWorkspace(true);message('Returned serial numbers recorded; those units can go out again.');
  });
}

// Inventory: find who has a serial, and (stores head or owner) choose which products need serials.
async function decorateSerialTools(){
 const content=$('#content');if(!content||content.querySelector('[data-serial-tools]')||!$('#inventoryRefresh'))return;
 const actor=me?.user_id;if(!(await loadSerialSettings())||me?.user_id!==actor)return;
 const flagged=[...serialSettings].filter(([,on])=>on).map(([productId])=>productId);
 content.insertAdjacentHTML('beforeend',`<section class="card serial-tools" data-serial-tools><h2>Serial numbers</h2>
  <form id="serialSearch" class="actions"><input name="serial" placeholder="Serial number" minlength="2" maxlength="120" required><button type="submit">Find</button></form><div id="serialResults"></div>
  ${canFlagSerials(me)?`<h3>Products that need serial numbers · ${flagged.length}</h3><ul>${flagged.map(productId=>`<li>${esc(inventoryProduct(productId).name)} <button type="button" data-serial-unflag="${esc(productId)}">Remove</button></li>`).join('')||'<li>None yet.</li>'}</ul>
  <form id="serialFlag" class="actions"><input name="product" list="serialProductChoices" placeholder="Product name or code" required><datalist id="serialProductChoices">${(typeof products!=='undefined'?products:[]).filter(p=>!p.deleted_at&&!serialRequired(p.id)).slice(0,2000).map(p=>`<option value="${esc(p.name)}${p.sku?' · '+esc(p.sku):''}"></option>`).join('')}</datalist><button type="submit">Needs serial numbers</button></form>`:''}</section>`);
 $('#serialSearch').onsubmit=event=>{event.preventDefault();run(async()=>{
  const value=new FormData(event.target).get('serial'),result=await client.rpc('find_serial',{p_serial:value});
  if(result.error)throw result.error;
  $('#serialResults').innerHTML=(result.data||[]).length?`<ul>${result.data.map(r=>`<li><code>${esc(r.serial_number)}</code> · ${esc(inventoryProduct(r.product_id).name)} · ${esc(r.organization_name||'Customer unavailable')} · ${esc(r.delivery_number)} (${esc(typeof salesStatus==='function'?salesStatus(r.delivery_status):r.delivery_status)})${r.returned_at?' · came back '+esc(String(r.returned_at).slice(0,10)):''}</li>`).join('')}</ul>`:'<p>No delivery has this serial number.</p>';
 });};
 $('#serialFlag')?.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const text=String(new FormData(event.target).get('product')||'').trim(),product=(typeof products!=='undefined'?products:[]).find(p=>`${p.name}${p.sku?' · '+p.sku:''}`===text||p.name===text);
  if(!product)throw Error('Choose a product from the list.');
  const result=await client.rpc('set_product_serial_required',{p_product_id:product.id,p_required:true});if(result.error)throw result.error;
  content.querySelector('[data-serial-tools]')?.remove();await decorateSerialTools();message(`${product.name} now needs serial numbers when it is packed.`);
 });});
 content.querySelectorAll('[data-serial-unflag]').forEach(button=>button.onclick=()=>run(async()=>{
  const result=await client.rpc('set_product_serial_required',{p_product_id:button.dataset.serialUnflag,p_required:false});if(result.error)throw result.error;
  content.querySelector('[data-serial-tools]')?.remove();await decorateSerialTools();message('That product no longer needs serial numbers.');
 }));
}
