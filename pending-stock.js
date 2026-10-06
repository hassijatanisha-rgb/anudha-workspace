'use strict';
// Pending stock orders: quantities a customer still needs once stock arrives. Advisory availability only;
// reservations and deductions stay in the invoice workflow.
let pendingFilter='waiting',pendingSearch='',pendingPage=0,pendingRows=[],pendingAvailability=new Map(),pendingLoaded=false,pendingLoadError='',pendingAvailabilityError='',pendingEpoch=0,pendingCreating=false,pendingRequestId=null;
let pendingRenderEpoch=0,pendingSessionEpoch=0,pendingAvailabilityDay='';
const pendingHistoryReads=new WeakMap();
function clearPendingStock(){pendingEpoch++;pendingRenderEpoch++;pendingSessionEpoch++;pendingRows=[];pendingAvailability=new Map();pendingAvailabilityDay='';pendingLoaded=false;pendingCreating=false;pendingRequestId=null;pendingFilter='waiting';pendingSearch='';pendingPage=0;pendingLoadError='';pendingAvailabilityError='';}
function pendingToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function pendingDaysLeft(row,today=pendingToday()){return Math.round((Date.parse(row.expires_on)-Date.parse(today))/86400000);}
// Saleable pieces per product: sealed cartons × units per carton + loose − reserved, available lots at active locations only.
function pendingAvailableByProduct(lots,packs,locations,today=pendingToday()){
 const perCarton=new Map(packs.map(pack=>[pack.id,pack.units_per_carton])),active=new Set(locations.filter(location=>location.active).map(location=>location.id)),out=new Map();
 for(const lot of lots){
  if(lot.stock_status!=='available'||!active.has(lot.location_id))continue;
  // Match stock-review policy: lots expiring today are not available for sale.
  if(lot.expiry_date!=null){
   const expiry=String(lot.expiry_date),date=new Date(`${expiry}T00:00:00Z`);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==expiry||expiry<=today)continue;
  }
  const units=perCarton.get(lot.pack_definition_id),cartons=lot.sealed_cartons,loose=lot.loose_units,reserved=lot.reserved_units;
  if(![units,cartons,loose,reserved].every(value=>Number.isSafeInteger(value)&&value>=0)||reserved>loose)continue;
  out.set(lot.product_id,(out.get(lot.product_id)||0)+cartons*units+loose-reserved);
 }
 return out;
}
function pendingStockState(row,available,today=pendingToday()){
 if(row.status!=='waiting')return {key:'closed',label:{fulfilled:'Fulfilled',cancelled:'Cancelled',expired:'Closed after six months'}[row.status]||row.status};
 if(pendingDaysLeft(row,today)<0)return {key:'due',label:'Pending period ended — close or extend'};
 if(available==null)return {key:'unknown',label:'Stock check unavailable'};
 if(available>=row.quantity)return {key:'arrived',label:`Stock arrived: ${available} available — reconfirm with the customer`};
 if(available>0)return {key:'partial',label:`Partly available: ${available} of ${row.quantity} — reconfirm with the customer`};
 return {key:'waiting',label:'Waiting for stock'};
}
function pendingVisibleRows(rows,{filter,search,actor,availability,today=pendingToday()}){
 const q=String(search||'').trim().toLowerCase(),rank={due:0,arrived:1,partial:2,waiting:3,unknown:4,closed:5};
 return rows.map(row=>({row,state:pendingStockState(row,availability?availability.get(row.product_id)||0:null,today)}))
  .filter(({row,state})=>filter==='all'||(filter==='closed'?row.status!=='waiting':row.status==='waiting'&&(filter==='waiting'||(filter==='arrived'?['arrived','partial'].includes(state.key):filter==='mine'?row.salesperson_user_id===actor:filter==='due'?pendingDaysLeft(row,today)<=14:true))))
  .filter(({row})=>!q||[row.request_number,row.notes,row.close_note,pendingClientLabel(row),pendingProductLabel(row),employeeName(row.salesperson_user_id)].join(' ').toLowerCase().includes(q))
  .sort((a,b)=>rank[a.state.key]-rank[b.state.key]||String(a.row.expires_on).localeCompare(String(b.row.expires_on))||a.row.id.localeCompare(b.row.id));
}
function pendingClientLabel(row){const org=orgIndex.get(row.organization_id);return org?`${org.name}${org.location?' · '+org.location:''}`:'Client unavailable';}
function pendingProductLabel(row){const product=typeof inventoryProduct==='function'?inventoryProduct(row.product_id):products.find(p=>p.id===row.product_id);return product?.name||'Unknown product';}
function pendingActions(row){
 if(row.status!=='waiting')return `<button type="button" data-pending-history="${esc(row.id)}">History</button>`;
 const mine=row.salesperson_user_id===me?.user_id||me?.role==='owner',buttons=[];
 buttons.push(`<button type="button" data-pending-purchase="${esc(row.id)}">Order from supplier</button>`);
 if(mine)buttons.push(`<button type="button" data-pending-action="fulfil" data-id="${esc(row.id)}">Mark fulfilled</button>`);
 if(me?.role==='owner')buttons.push(`<button type="button" data-pending-action="cancel" data-id="${esc(row.id)}">Cancel</button>`);
 if(me?.role==='owner'&&row.extension_count<4)buttons.push(`<button type="button" data-pending-action="extend" data-id="${esc(row.id)}">Extend</button>`);
 if(pendingDaysLeft(row)<0)buttons.push(`<button type="button" data-pending-action="expire" data-id="${esc(row.id)}">Close as expired</button>`);
 buttons.push(`<button type="button" data-pending-history="${esc(row.id)}">History</button>`);
 return buttons.join('');
}
function pendingCard({row,state}){
 const days=pendingDaysLeft(row),proforma=salesProformas.find(p=>p.id===row.proforma_id);
 return `<article class="card pending-card pending-${state.key}" data-pending-card="${esc(row.id)}"><div class="heading"><div><small>${esc(row.request_number)}</small><h2>${esc(pendingProductLabel(row))} · ${esc(row.quantity)} pcs</h2><p>${esc(pendingClientLabel(row))}</p></div><span class="tag">${esc(state.label)}</span></div>${row.notes?`<p>${esc(row.notes)}</p>`:''}<div class="details"><div><small>Salesperson</small>${esc(employeeName(row.salesperson_user_id))}</div><div><small>${row.status==='waiting'?'Closes on':'Closed'}</small>${row.status==='waiting'?`${esc(row.expires_on)} · ${days<0?'overdue':days+' days left'}${row.extension_count?` · extended ${row.extension_count}×`:''}`:esc(row.close_note)}</div>${proforma?`<div><small>Pro forma</small>${esc(proforma.document_number)}</div>`:''}</div><div class="actions">${pendingActions(row)}</div><div data-pending-history-output="${esc(row.id)}"></div></article>`;
}
function pendingForm(){
 return `<section class="card document-editor"><div class="heading"><div><small>NEW</small><h2>Pending stock order</h2></div><button type="button" id="closePendingForm">Close</button></div><form id="pendingForm"><p class="muted">Use this when a customer wants more than is in stock. It does not reserve stock. You will see here when stock arrives.</p><div class="grid"><label><span>Client</span><select name="organizationId" required><option value="">Choose client / branch</option>${salesOrganizationOptions()}</select></label><label><span>Contact · optional</span><select name="contactId"><option value="">No named contact</option></select></label><label class="wide"><span>Product</span><input name="productChoice" list="pendingProductChoices" required autocomplete="off" placeholder="Type to search products"><datalist id="pendingProductChoices">${salesProductChoices()}</datalist></label><label><span>Quantity still needed (pieces)</span><input name="quantity" type="number" min="1" max="1000000" step="1" required></label><label><span>Pro forma · optional</span><select name="proformaId"><option value="">Not linked</option></select></label><label><span>Salesperson</span><select name="salesperson" required>${leadEmployeeOptions(me?.user_id||'')}</select></label><label class="wide"><span>Notes</span><textarea name="notes" maxlength="4000"></textarea></label></div><p role="alert" id="pendingFormError"></p><div class="actions"><button type="submit">Save pending order</button></div></form></section>`;
}
async function loadPendingStock(){
 const epoch=++pendingEpoch,actor=me,actorId=me?.user_id;
 const current=()=>epoch===pendingEpoch&&me===actor&&me?.user_id===actorId;
 const [rows,proformas]=await Promise.all([all('pending_stock_requests','*'),salesLoaded?Promise.resolve(null):all('sales_proformas','id,document_number,organization_id,status,deleted_at')]);
 if(!current())return false;
 pendingRows=rows;if(proformas&&!salesLoaded)salesProformas=proformas;
 // Availability is advisory: a failure shows "Stock check unavailable" instead of hiding requests.
 try{
  const [lots,packs,locations]=await Promise.all([all('inventory_lots','id,product_id,location_id,pack_definition_id,sealed_cartons,loose_units,reserved_units,stock_status,expiry_date'),all('product_pack_definitions','id,units_per_carton'),all('inventory_locations','id,active')]);
  if(!current())return false;
  pendingAvailabilityDay=pendingToday();pendingAvailability=pendingAvailableByProduct(lots,packs,locations,pendingAvailabilityDay);pendingAvailabilityError='';
 }catch(error){if(!current())return false;pendingAvailability=new Map();pendingAvailabilityError=error.message;}
 pendingLoaded=true;pendingLoadError='';return true;
}
async function pendingStockWorkspace(force=false){
 const actor=me,actorId=me?.user_id,epoch=++pendingRenderEpoch;
 const current=()=>!!actor&&me===actor&&me?.user_id===actorId&&view==='pending'&&epoch===pendingRenderEpoch;
 if(!current())return;
 syncWorkspaceNavigation();
 if(force||!pendingLoaded||pendingAvailabilityDay!==pendingToday()){
  $('#content').innerHTML='<p role="status">Loading pending stock orders…</p>';
  try{if(!(await loadPendingStock()))return;}catch(error){if(!current())return;pendingLoadError=error.message;pendingLoaded=false;}
 }
 if(!current())return;
 renderPendingStock();
}
function renderPendingStock(){
 if(pendingAvailabilityDay&&pendingAvailabilityDay!==pendingToday()){
  pendingAvailability=new Map();pendingAvailabilityError='Stock check is from a previous day. Press Refresh to check current availability';
 }
 const availability=pendingAvailabilityError?null:pendingAvailability;
 const rows=pendingVisibleRows(pendingRows,{filter:pendingFilter,search:pendingSearch,actor:me?.user_id,availability});
 const pages=Math.max(1,Math.ceil(rows.length/20));pendingPage=Math.min(Math.max(pendingPage,0),pages-1);
 const mineArrived=pendingVisibleRows(pendingRows,{filter:'arrived',search:'',actor:me?.user_id,availability}).filter(({row})=>row.salesperson_user_id===me?.user_id).length;
 $('#content').innerHTML=`<section class="pending-workspace"><div class="heading"><div><small>ORDERS</small><h1>Pending stock orders</h1><p class="muted">Customer quantities waiting for stock. Requests close after six months unless the owner extends them.</p></div><div class="actions"><button type="button" id="pendingRefresh">Refresh</button><button type="button" id="newPending">New pending order</button></div></div>${pendingLoadError?`<p class="notice error" role="alert">Pending orders could not load: ${esc(pendingLoadError)}. Nothing was changed.</p>`:''}${pendingAvailabilityError?`<p class="notice error" role="alert">Stock levels could not be checked: ${esc(pendingAvailabilityError)}. Requests are still listed.</p>`:''}${mineArrived?`<p class="notice" role="status"><strong>Stock has arrived for ${mineArrived} of your pending order${mineArrived===1?'':'s'}.</strong> Call the customer to reconfirm, then create the Pro forma or invoice.</p>`:''}${pendingCreating?pendingForm():''}<div class="tabs" role="group" aria-label="Filter pending orders">${[['waiting','Waiting'],['arrived','Stock arrived'],['mine','Mine'],['due','Closing soon'],['closed','Closed'],['all','All']].map(([key,label])=>`<button type="button" data-pending-filter="${key}" class="${pendingFilter===key?'active':''}" aria-pressed="${pendingFilter===key}">${label}</button>`).join('')}</div><label class="search"><span>Search</span><input id="pendingSearch" type="search" placeholder="Client, product, salesperson or PS number" value="${esc(pendingSearch)}"></label>${rows.slice(pendingPage*20,pendingPage*20+20).map(pendingCard).join('')||'<p class="muted">No pending orders match this filter.</p>'}${pages>1?`<div class="actions"><button type="button" id="pendingPrev" ${pendingPage===0?'disabled':''}>Previous</button><span>Page ${pendingPage+1} of ${pages}</span><button type="button" id="pendingNext" ${pendingPage>=pages-1?'disabled':''}>Next</button></div>`:''}</section>`;
 bindPendingStock();
}
function bindPendingStock(){
 $('#pendingRefresh').onclick=()=>run(()=>pendingStockWorkspace(true));
 $('#newPending').onclick=()=>{pendingCreating=true;pendingRequestId=null;renderPendingStock();$('#pendingForm [name="organizationId"]')?.focus();};
 $('#closePendingForm')?.addEventListener('click',()=>{pendingCreating=false;pendingRequestId=null;renderPendingStock();});
 const form=$('#pendingForm');
 if(form){
  form.elements.organizationId.onchange=event=>{const org=event.target.value;form.elements.contactId.innerHTML='<option value="">No named contact</option>'+salesContactOptions(org);form.elements.proformaId.innerHTML='<option value="">Not linked</option>'+salesProformas.filter(p=>p.organization_id===org&&!p.deleted_at).map(p=>inventoryOption(p.id,p.document_number)).join('');};
  form.onsubmit=event=>{event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;$('#pendingFormError').textContent='';
   run(async()=>{try{await savePendingForm(form)}catch(error){if($('#pendingFormError'))$('#pendingFormError').textContent=error.message;throw error;}finally{if(button.isConnected)button.disabled=false;}});};
 }
 $('#pendingSearch').oninput=event=>{pendingSearch=event.target.value;pendingPage=0;renderSearchPreservingPosition(event.target,renderPendingStock);};
 if($('#pendingPrev'))$('#pendingPrev').onclick=()=>{pendingPage--;renderPendingStock();};if($('#pendingNext'))$('#pendingNext').onclick=()=>{pendingPage++;renderPendingStock();};
 document.querySelectorAll('[data-pending-filter]').forEach(button=>button.onclick=()=>{pendingFilter=button.dataset.pendingFilter;pendingPage=0;renderPendingStock();});
 document.querySelectorAll('[data-pending-action]').forEach(button=>button.onclick=()=>openPendingAction(pendingRows.find(row=>row.id===button.dataset.id),button.dataset.pendingAction));
 document.querySelectorAll('[data-pending-purchase]').forEach(button=>button.onclick=()=>{if(typeof startPurchaseFromPending==='function')startPurchaseFromPending(pendingRows.find(row=>row.id===button.dataset.pendingPurchase));});
 document.querySelectorAll('[data-pending-history]').forEach(button=>button.onclick=()=>run(()=>showPendingHistory(button.dataset.pendingHistory)));
 if(typeof decorateWorkHandoffs==='function')decorateWorkHandoffs().catch(()=>{});
}
async function savePendingForm(form){
 const actor=me,actorId=me?.user_id,session=pendingSessionEpoch;
 const sessionCurrent=()=>!!actor&&me===actor&&me?.user_id===actorId&&session===pendingSessionEpoch&&view==='pending';
 const formCurrent=()=>sessionCurrent()&&form.isConnected&&$('#pendingForm')===form;
 if(!formCurrent())return;
 const f=new FormData(form),product=inventoryProductFromChoice(String(f.get('productChoice')||'')),quantity=Number(f.get('quantity'));
 if(!f.get('organizationId'))throw Error('Choose the client.');
 if(!product)throw Error('Choose a product from the list.');
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)throw Error('Enter a whole quantity of at least 1.');
 // One request ID per form until the server confirms it, so a retry after a lost response cannot duplicate the order.
 pendingRequestId??=crypto.randomUUID();
 const requestId=pendingRequestId,current=()=>formCurrent()&&pendingRequestId===requestId;
 let result;
 try{result=await client.rpc('create_pending_stock_request',{p_id:requestId,p_organization_id:f.get('organizationId'),p_contact_id:f.get('contactId')||null,p_product_id:product.id,p_quantity:quantity,p_proforma_id:f.get('proformaId')||null,p_lead_id:null,p_salesperson_user_id:f.get('salesperson')||null,p_notes:String(f.get('notes')||'')});}
 catch(error){if(!current())return;throw error;}
 if(!current())return;
 if(result.error)throw Error(result.error.message);
 const saved=Array.isArray(result.data)?result.data[0]:result.data;
 if(saved?.id!==requestId)throw Error('The server did not confirm the save. Press Save again to retry safely.');
 pendingRequestId=null;pendingCreating=false;await pendingStockWorkspace(true);if(sessionCurrent())message(`${saved.request_number} saved. It closes on ${saved.expires_on} unless extended.`);
}
function openPendingAction(row,action){
 if(!row)return;
 const actor=me,actorId=me?.user_id,session=pendingSessionEpoch;
 const current=()=>!!actor&&me===actor&&me?.user_id===actorId&&session===pendingSessionEpoch&&view==='pending';
 const titles={fulfil:'Mark pending order fulfilled',cancel:'Cancel pending order',extend:'Extend pending order',expire:'Close pending order as expired'};
 const fields=`<p><strong>${esc(row.request_number)}</strong> · ${esc(pendingProductLabel(row))} · ${esc(row.quantity)} pcs · ${esc(pendingClientLabel(row))}</p>${action==='extend'?`<label><span>Extend by</span><select name="months" required>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${n===3?'selected':''}>${n} month${n===1?'':'s'}</option>`).join('')}</select></label><p class="muted">Extensions used: ${row.extension_count} of 4.</p>`:''}<label><span>${action==='fulfil'?'Invoice, Pro forma or delivery reference':action==='cancel'?'Why is it cancelled?':action==='extend'?'Why is it being extended?':'Note · optional'}</span><textarea name="note" maxlength="1000" ${action==='expire'?'':'required minlength="3"'}></textarea></label>`;
 actionForm(titles[action],fields,async values=>{
  if(!current())return;
  let result;
  try{result=await client.rpc('advance_pending_stock_request',{p_id:row.id,p_expected_version:row.version,p_action:action,p_note:values.note||'',p_extend_months:action==='extend'?Number(values.months):null});}
  catch(error){if(!current())return;throw error;}
  if(!current())return;
  if(result.error)throw Error(result.error.message);
  await pendingStockWorkspace(true);if(current())message(`${row.request_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
async function showPendingHistory(id){
 const output=document.querySelector(`[data-pending-history-output="${CSS.escape(id)}"]`),actor=me,actorId=me?.user_id,session=pendingSessionEpoch;
 const token={};
 const current=()=>!!actor&&me===actor&&me?.user_id===actorId&&session===pendingSessionEpoch&&view==='pending'&&output?.isConnected&&pendingHistoryReads.get(output)===token;
 if(output)pendingHistoryReads.set(output,token);
 if(!output||!current())return;
 output.textContent='Loading history…';
 let result;
 try{result=await client.from('pending_stock_events').select('action,from_status,to_status,note,expires_on,actor_user_id,created_at').eq('request_id',id).order('created_at').limit(200);}
 catch(error){if(current())output.textContent=`History could not load: ${error.message}`;return;}
 if(!current())return;
 if(result.error){output.textContent=`History could not load: ${result.error.message}`;return;}
 output.innerHTML=`<ol class="lead-history">${(result.data||[]).map(event=>`<li>${esc(new Date(event.created_at).toLocaleString())} · <strong>${esc(employeeName(event.actor_user_id))}</strong> · ${esc(event.action)} · closes ${esc(event.expires_on)}${event.note?` · ${esc(event.note)}`:''}</li>`).join('')}</ol>`;
}
