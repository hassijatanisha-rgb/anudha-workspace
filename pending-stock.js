'use strict';
// Pending stock orders: quantities a customer still needs once stock arrives. Advisory availability only;
// reservations and deductions stay in the invoice workflow.
let pendingFilter='waiting',pendingSearch='',pendingPage=0,pendingRows=[],pendingAvailability=new Map(),pendingLoaded=false,pendingLoadError='',pendingAvailabilityError='',pendingEpoch=0,pendingCreating=false,pendingRequestId=null;
let pendingAvailabilityDay='',pendingRenderEpoch=0;
let pendingActor=null,pendingPageData=null,pendingSelectedId='';
let pendingRegisterError='',pendingUnverifiedId='',pendingRegisterRequest=0;
const pendingHandoffRefresh=new Set();
function clearPendingStock(){pendingActor=null;pendingPageData=null;pendingSelectedId='';pendingRegisterError='';pendingUnverifiedId='';pendingHandoffRefresh.clear();pendingEpoch++;pendingRenderEpoch++;pendingRows=[];pendingAvailability=new Map();pendingAvailabilityDay='';pendingLoaded=false;pendingCreating=false;pendingRequestId=null;pendingFilter='waiting';pendingSearch='';pendingPage=0;pendingLoadError='';pendingAvailabilityError='';}
function syncPendingActor(){if(pendingActor&&pendingActor!==me)clearPendingStock();pendingActor=me;}
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
 if(row.proforma_line_id&&row.status==='fulfilled')return {key:'closed',label:'Allocated to invoice'};
 if(row.status!=='waiting')return {key:'closed',label:{fulfilled:'Fulfilled',cancelled:'Cancelled',expired:'Closed after six months'}[row.status]||row.status};
 if(pendingDaysLeft(row,today)<0)return {key:'due',label:row.proforma_line_id?'Follow-up overdue · order remains pending':'Pending period ended — close or extend'};
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
function pendingStatusTone(row,state){return statusTone(state.key==='closed'?{fulfilled:'completed',cancelled:'cancelled',expired:'archived'}[row.status]:{due:'overdue',arrived:'in_stock',partial:'warning',waiting:'waiting',unknown:'warning'}[state.key]);}
function pendingClientLabel(row){if(row.page_summary)return row.client_label;const org=orgIndex.get(row.organization_id);return org?`${org.name}${org.location?' · '+org.location:''}`:'Client unavailable';}
function pendingProductLabel(row){if(row.page_summary)return row.product_name;const product=typeof inventoryProduct==='function'?inventoryProduct(row.product_id):products.find(p=>p.id===row.product_id);return product?.name||'Unknown product';}
function pendingActions(row){
 if(row.id===pendingUnverifiedId)return `<button type="button" data-pending-open="${esc(row.id)}">Reload saved request</button>`;
 if(row.status!=='waiting')return `<button type="button" data-pending-history="${esc(row.id)}">History</button>`;
 const mine=row.salesperson_user_id===me?.user_id||me?.role==='owner',buttons=[];
 // Buying needs Purchasing access; without it the button only led to a "no access" page.
 if(typeof hasArea!=='function'||hasArea('purchasing'))buttons.push(`<button type="button" data-pending-purchase="${esc(row.id)}">Order from supplier</button>`);
 if(row.proforma_line_id)buttons.push(`<button type="button" data-pending-order="${esc(row.proforma_id)}">Open order / invoice balance</button>`);
 if(mine&&!row.proforma_line_id)buttons.push(`<button type="button" data-pending-action="fulfil" data-id="${esc(row.id)}">Mark fulfilled</button>`,`<button type="button" data-pending-action="cancel" data-id="${esc(row.id)}">Cancel</button>`);
 if(me?.role==='owner'&&row.extension_count<4)buttons.push(`<button type="button" data-pending-action="extend" data-id="${esc(row.id)}">Extend</button>`);
 if(!row.proforma_line_id&&pendingDaysLeft(row)<0)buttons.push(`<button type="button" data-pending-action="expire" data-id="${esc(row.id)}">Close as expired</button>`);
 buttons.push(`<button type="button" data-pending-history="${esc(row.id)}">History</button>`);
 return buttons.join('');
}
function pendingCard({row,state}){
 const days=pendingDaysLeft(row),proforma=salesProformas.find(p=>p.id===row.proforma_id);
 return `<article class="card pending-card pending-${state.key}" data-pending-card="${esc(row.id)}"><div class="heading"><div><small>${esc(row.request_number)}</small><h2>${esc(pendingProductLabel(row))} · ${esc(row.quantity)} pcs</h2><p>${esc(pendingClientLabel(row))}</p></div><span class="tag chip chip--${pendingStatusTone(row,state)}">${esc(state.label)}</span></div>${row.proforma_line_id?'<p class="muted">Linked order balance: invoice available units from the original Pro forma. This quantity updates automatically when an invoice is posted or voided. The follow-up date is a staff reminder, not a promised customer delivery date; the delivery promise remains on the order.</p>':''}${row.notes?`<p>${esc(row.notes)}</p>`:''}<div class="details"><div><small>Salesperson</small>${esc(employeeName(row.salesperson_user_id))}</div><div><small>${row.status==='waiting'?(row.proforma_line_id?'Next stock follow-up':'Administrative close date'):'Closed'}</small>${row.status==='waiting'?`${esc(row.expires_on)} · ${days<0?'overdue':days+' days left'}${row.extension_count?` · extended ${row.extension_count}×`:''}`:esc(row.close_note)}</div>${proforma?`<div><small>Pro forma</small>${esc(proforma.document_number)}</div>`:''}</div><div class="actions">${pendingActions(row)}</div><div data-pending-history-output="${esc(row.id)}"></div></article>`;
}
function pendingForm(){
 return `<section class="card document-editor"><div class="heading"><div><small>NEW</small><h2>Pending stock order</h2></div><button type="button" id="closePendingForm">Close</button></div><form id="pendingForm"><p role="alert" id="pendingFormError"></p><p class="muted">Use this when a customer wants more than is in stock. It does not reserve stock. You will see here when stock arrives.</p><div class="grid"><label><span>Client</span><select name="organizationId" required data-lookup-rows="organizations"><option value="">Choose client / branch</option>${salesOrganizationOptions()}</select></label><label><span>Contact · optional</span><select name="contactId"><option value="">No named contact</option></select></label><label class="wide"><span>Product</span><input name="productChoice" list="pendingProductChoices" required autocomplete="off" placeholder="Type to search products"><datalist id="pendingProductChoices" data-lookup-values="products">${salesProductChoices()}</datalist></label><label><span>Quantity still needed (pieces)</span><input name="quantity" type="number" min="1" max="1000000" step="1" required></label><label><span>Pro forma · optional</span><select name="proformaId"><option value="">Not linked</option></select></label><label><span>Salesperson</span><select name="salesperson" required>${leadEmployeeOptions(me?.user_id||'')}</select></label><label class="wide"><span>Notes</span><textarea name="notes" maxlength="4000"></textarea></label></div><div class="actions"><button type="submit">Save pending order</button></div></form></section>`;
}
function pendingFormFieldError(control){
 control=fieldValidationSource(control);if(!control.willValidate)return '';
 const native=nativeFieldError(control);if(native)return native;
 if(control.name==='organizationId'&&!control.value)return 'Choose the client.';
 if(control.name==='productChoice'&&!inventoryProductFromChoice(control.value))return 'Choose a product from the list.';
 if(control.name==='quantity'){const quantity=Number(control.value);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return 'Enter a whole quantity of at least 1.';}
 return '';
}
function pendingFormErrors(form){
 const errors=nativeFormErrors(form);
 for(const control of form.querySelectorAll('input,select,textarea')){if(fieldValidationSource(control)!==control)continue;const problem=pendingFormFieldError(control);if(problem)errors.set(control,problem);}
 return errors;
}
async function loadPendingStock(force=true){
 syncPendingActor();
 const epoch=++pendingEpoch,actor=me,actorId=me?.user_id;
 const current=()=>epoch===pendingEpoch&&me===actor&&me?.user_id===actorId;
 const stock=Promise.all([all('inventory_lots','id,product_id,location_id,pack_definition_id,sealed_cartons,loose_units,reserved_units,stock_status,expiry_date'),all('product_pack_definitions','id,units_per_carton'),all('inventory_locations','id,active')]);
 // The request read may fail or become stale before this advisory read finishes.
 stock.catch(()=>{});
 if(force||!pendingLoaded){
  const [rows,proformas]=await Promise.all([all('pending_stock_requests','*'),salesLoaded?Promise.resolve(null):all('sales_proformas','id,document_number,organization_id,status,deleted_at')]);
  if(!current())return false;
  pendingRows=rows;pendingUnverifiedId='';pendingHandoffRefresh.clear();if(proformas&&!salesLoaded)salesProformas=proformas;
 }
 // Availability is advisory: a failure shows "Stock check unavailable" instead of hiding requests.
 try{
  const [lots,packs,locations]=await stock;
  if(!current())return false;
  pendingAvailabilityDay=pendingToday();pendingAvailability=pendingAvailableByProduct(lots,packs,locations,pendingAvailabilityDay);pendingAvailabilityError='';
 }catch(error){if(!current())return false;pendingAvailability=new Map();pendingAvailabilityError=error.message;}
 pendingLoaded=true;pendingLoadError='';return true;
}
function pendingSearchPeople(){
 const query=pendingSearch.trim().toLowerCase();if(!query)return [];
 return [...employeeDirectory.keys()].filter(id=>employeeName(id).toLowerCase().includes(query));
}
async function loadPendingPage(current){
 const result=await client.rpc('pending_stock_page',{p_query:pendingSearch,p_filter:pendingFilter,p_page:pendingPage,p_salesperson_ids:pendingSearchPeople()});
 if(!current())return false;if(result.error)throw result.error;const data=result.data;
 if(!data||!Array.isArray(data.rows)||!data.counts||!['all','waiting','arrived','mine','due','closed'].every(key=>Number.isSafeInteger(data.counts[key])&&data.counts[key]>=0&&data.counts[key]<=data.counts.all)||data.counts.waiting+data.counts.closed!==data.counts.all||![data.total,data.page,data.pages,data.mine_arrived].every(Number.isSafeInteger)||data.total<0||data.total>data.counts.all||data.page<0||data.pages!==Math.max(1,Math.ceil(data.total/50))||data.page>=data.pages||data.mine_arrived<0||data.mine_arrived>data.counts.arrived||data.rows.length!==Math.min(50,data.total-data.page*50)||new Set(data.rows.map(row=>row.id)).size!==data.rows.length||typeof data.availability_error!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(data.as_of)||data.rows.some(row=>typeof row.id!=='string'||typeof row.request_number!=='string'||row.page_summary!==true||typeof row.product_name!=='string'||typeof row.client_label!=='string'||!['waiting','fulfilled','cancelled','expired'].includes(row.status)||!Number.isSafeInteger(row.quantity)||row.quantity<1||!/^\d{4}-\d{2}-\d{2}$/.test(row.expires_on)||(data.availability_error?row.available_units!==null:!Number.isSafeInteger(row.available_units)||row.available_units<0)))throw Error('The pending order page could not be confirmed. Refresh to retry.');
 pendingPageData=data;pendingPage=data.page;pendingLoadError='';return true;
}
async function pendingStockWorkspace(force=false){
 syncPendingActor();const actor=me,epoch=++pendingRenderEpoch;
 const current=()=>!!actor&&me===actor&&view==='pending'&&epoch===pendingRenderEpoch;
 if(!current())return;syncWorkspaceNavigation();const input=$('#pendingSearch');
 // Recheck stock on every entry, including a same-day return from another workspace.
 if(!input)workspaceLoading('Loading pending stock orders…');
 try{if(!await loadPendingPage(current))return;pendingRegisterError='';}catch(error){if(!current())return;pendingPageData=null;pendingLoadError=error.message||'Pending orders could not load.';}
 if(!current())return;
 if(input&&document.activeElement===input)renderSearchPreservingPosition(input,renderPendingStock);else renderPendingStock();
}
function pendingSummaryCard(row,availabilityUnknown=false){
 const state=pendingStockState(row,availabilityUnknown?null:row.available_units),status={arrived:'Stock arrived',partial:'Partly available',due:row.proforma_line_id?'Follow-up overdue':'Close or extend'}[state.key]||state.label;
 // Keep handoff history lazy until the request is opened.
 return `<article class="card pending-card pending-${state.key}" data-pending-card="${esc(row.id)}"><div class="heading" data-work-handoff><div><small>${esc(row.request_number)}</small><h2>${esc(pendingProductLabel(row))}</h2><p>${esc(pendingClientLabel(row))}</p></div><span class="tag chip chip--${pendingStatusTone(row,state)}">${esc(status)}</span></div><p class="muted">${row.status==='waiting'?`${row.proforma_line_id?'Stock follow-up':'Administrative close date'}: ${esc(row.expires_on)}`:`Closed: ${esc(row.closed_at?pendingToday(new Date(row.closed_at)):'Not recorded')}`}</p><div class="actions"><button type="button" data-pending-open="${esc(row.id)}">Open request</button></div></article>`;
}
function pendingAvailabilityNotice(){
 const data=pendingPageData;return data?.availability_error?'Stock check unavailable':data&&data.as_of!==pendingToday()?'Stock check is from a previous day. Press Refresh to check current availability':'';
}
function pendingStockNotices(){
 const availabilityError=pendingAvailabilityNotice(),mineArrived=availabilityError?0:pendingPageData?.mine_arrived||0;
 return `${availabilityError?`<p class="notice error" role="alert">Stock levels could not be checked: ${esc(availabilityError)}. Requests are still listed.</p>`:''}${mineArrived?`<p class="notice" role="status"><strong>Stock has arrived for ${mineArrived} of your pending order${mineArrived===1?'':'s'}.</strong> Call the customer to reconfirm, then open the linked order to invoice its balance. For a manual request, create or open its Pro forma.</p>`:''}`;
}
function pendingDetailHtml(row){
 return pendingCard({row,state:pendingStockState(row,pendingAvailabilityError||pendingAvailabilityDay!==pendingToday()?null:pendingAvailability.get(row.product_id)||0)});
}
function pendingRegisterNotice(){
 return `${pendingUnverifiedId?`<p class="notice error" role="alert">The save completed, but the returned request details could not be verified. Reload the saved request before continuing. <button type="button" data-pending-open="${esc(pendingUnverifiedId)}">Reload saved request</button></p>`:''}${pendingRegisterError?`<p class="notice error" role="alert">Saved, but the register could not refresh: ${esc(pendingRegisterError)}. Counts and membership may be out of date. <button type="button" id="pendingRetryRegister">Retry register refresh</button></p>`:''}`;
}
function renderPendingStock(){
 const data=pendingPageData,stale=data&&data.as_of!==pendingToday(),selected=pendingSelectedId&&pendingRows.find(row=>row.id===pendingSelectedId),detail=selected?pendingDetailHtml(selected):'';
 $('#content').innerHTML=`<section class="pending-workspace">${workspacePageHeader({title:'Pending stock orders',subtitle:'Customer quantities waiting for stock.',actions:'<button type="button" id="pendingRefresh">Refresh</button><button type="button" class="primary-action" id="newPending">New pending order</button>'})}<p class="muted">Manual requests close after six months unless extended. Accepted order balances remain pending until invoiced.</p><div id="pendingLoadNotice">${pendingLoadError?`<p class="notice error" role="alert">Pending orders could not load: ${esc(pendingLoadError)}.</p>`:''}</div><div id="pendingRegisterNotice">${pendingRegisterNotice()}</div><div id="pendingStockNotices">${pendingStockNotices()}</div><div id="pendingEditor">${pendingCreating?pendingForm():''}</div><div class="tabs" role="group" aria-label="Filter pending orders">${[['waiting','Waiting'],['arrived','Stock arrived'],['mine','Mine'],['due','Closing soon'],['closed','Closed'],['all','All']].map(([key,label])=>`<button type="button" data-pending-filter="${key}" class="${pendingFilter===key?'active':''}" aria-pressed="${pendingFilter===key}">${label}${data&&!stale?' ('+data.counts[key]+')':''}</button>`).join('')}</div><label class="search"><span>Search</span><input id="pendingSearch" type="search" maxlength="2000" placeholder="Client, product, salesperson or PS number" value="${esc(pendingSearch)}"></label><p id="pendingCount">${data?data.total+' matching pending orders':''}</p><div id="pendingCards">${(data?.rows||[]).map(row=>row.id===selected?.id?detail:pendingSummaryCard(row,!!pendingAvailabilityNotice())).join('')}${selected&&!(data?.rows||[]).some(row=>row.id===selected.id)?detail:''}</div><p id="pendingEmpty" class="muted" ${!data||data.rows.length||selected?'hidden':''}>No pending orders match this filter.</p><div class="actions" id="pendingPaging" ${data?'':'hidden'}><button type="button" id="pendingPrev" ${!data||data.page===0?'disabled':''}>Previous</button><span id="pendingPageStatus" tabindex="-1">${data?`Page ${data.page+1} of ${data.pages}`:''}</span><button type="button" id="pendingNext" ${!data||data.page>=data.pages-1?'disabled':''}>Next</button></div></section>`;
 bindPendingStock();
}
async function openPendingDetail(id=''){
 if(!me||view!=='pending')return;syncPendingActor();const actor=me,epoch=++pendingRenderEpoch,current=()=>me===actor&&view==='pending'&&epoch===pendingRenderEpoch;
 workspaceLoading(id?'Loading the complete pending request…':'Loading the pending order form…');
 try{
  if(!listsLoaded){await (listsLoading||loadLists());if(!current())return;if(!listsLoaded)throw Error('Pending order editing data could not load. Refresh and reopen the request.');}
  if(!await loadPendingStock(true)||!current())return;
  if(id&&!pendingRows.some(row=>row.id===id))throw Error('This pending request is unavailable.');
  pendingSelectedId=id;pendingCreating=!id;pendingRequestId=null;renderPendingStock();if(!id)$('#pendingForm [name="organizationId"]')?.focus();
 }catch(error){if(!current())return;pendingSelectedId='';pendingCreating=false;pendingLoadError=error.message||'Pending order details could not load.';renderPendingStock();}
}
function bindPendingStock(){
 const actor=me,epoch=pendingRenderEpoch,current=()=>me===actor&&view==='pending'&&pendingRenderEpoch===epoch;
 $('#pendingRefresh').onclick=()=>run(()=>pendingStockWorkspace(true));
 $('#newPending').onclick=()=>run(()=>openPendingDetail());
 $('#closePendingForm')?.addEventListener('click',()=>{pendingCreating=false;pendingRequestId=null;pendingRenderEpoch++;renderPendingStock();});
 const form=$('#pendingForm');
 if(form){
  const button=form.querySelector('[type="submit"]'),notice=form.querySelector('#pendingFormError'),active=()=>current()&&form.isConnected&&$('#pendingForm')===form,summary=(count=form.querySelectorAll('.field-error').length)=>{notice.textContent=fieldErrorSummary(count);};
  if(pendingUnverifiedId&&pendingUnverifiedId===pendingRequestId)button.disabled=true;
  form.noValidate=true;form.addEventListener('focusout',event=>{const control=fieldValidationSource(event.target);if(!active()||button.disabled||!form.contains(control)||!control.matches('input,select,textarea'))return;showFieldError(control,pendingFormFieldError(control));if(form.dataset.validationSubmitted==='true')summary();});
  form.elements.organizationId.onchange=event=>{if(!active())return;const org=event.target.value;form.elements.contactId.innerHTML='<option value="">No named contact</option>'+salesContactOptions(org);form.elements.proformaId.innerHTML='<option value="">Not linked</option>'+salesProformas.filter(p=>p.organization_id===org&&!p.deleted_at).map(p=>inventoryOption(p.id,p.document_number)).join('');};
  form.onsubmit=event=>{event.preventDefault();if(!active()||button.disabled)return;if(busy){actionFeedbackRefuse(button,notice);return;}
   const errors=pendingFormErrors(form);form.dataset.validationSubmitted='true';summary(errors.size);showFieldErrors(form,errors);if(errors.size)return;button.disabled=true;
   return run(async()=>{try{await savePendingForm(form)}catch(error){if(active())throw error;}finally{if(active())button.disabled=!!pendingUnverifiedId&&pendingUnverifiedId===pendingRequestId;}},{origin:button,errorTarget:notice});};
 }
 $('#pendingSearch').oninput=event=>{pendingSearch=event.target.value;pendingPage=0;pendingSelectedId='';pendingCreating=false;pendingRenderEpoch++;renderSearchPreservingPosition(event.target,()=>run(()=>pendingStockWorkspace()),150);};
 if($('#pendingPrev'))$('#pendingPrev').onclick=()=>{pendingPage--;pendingSelectedId='';run(()=>pendingStockWorkspace());};if($('#pendingNext'))$('#pendingNext').onclick=()=>{pendingPage++;pendingSelectedId='';run(()=>pendingStockWorkspace());};
 document.querySelectorAll('[data-pending-filter]').forEach(button=>button.onclick=()=>{pendingFilter=button.dataset.pendingFilter;pendingPage=0;pendingSelectedId='';run(()=>pendingStockWorkspace());});
 document.querySelectorAll('[data-pending-card]').forEach(card=>{
  const row=pendingPageData?.rows.find(row=>row.id===card.dataset.pendingCard);
  if(row&&row.id!==pendingSelectedId)card.pendingSummaryHtml=pendingSummaryCard(row,!!pendingAvailabilityNotice());
 });
 bindPendingCards(document);bindPendingRegisterRetry(current);
 if(typeof decorateWorkHandoffs==='function')decorateWorkHandoffs().catch(()=>{});
}
function bindPendingCards(root){
 const actor=me,epoch=pendingRenderEpoch,current=()=>me===actor&&view==='pending'&&pendingRenderEpoch===epoch;
 root.querySelectorAll('[data-pending-open]').forEach(button=>button.onclick=()=>{if(current())return run(()=>openPendingDetail(button.dataset.pendingOpen));});
 root.querySelectorAll('[data-pending-action]').forEach(button=>button.onclick=()=>{if(current())openPendingAction(pendingRows.find(row=>row.id===button.dataset.id),button.dataset.pendingAction,button);});
 root.querySelectorAll('[data-pending-order]').forEach(button=>button.onclick=()=>{if(current())return run(()=>{salesFocusedProforma=button.dataset.pendingOrder;salesFocusedDelivery='';salesSection='proformas';salesEditing='';view='sales';return salesDeliveryWorkspace(true);});});
 root.querySelectorAll('[data-pending-purchase]').forEach(button=>button.onclick=()=>{if(current()&&typeof startPurchaseFromPending==='function')startPurchaseFromPending(pendingRows.find(row=>row.id===button.dataset.pendingPurchase));});
 root.querySelectorAll('[data-pending-history]').forEach(button=>button.onclick=()=>{if(current())return run(()=>showPendingHistory(button.dataset.pendingHistory));});
 root.querySelectorAll('[data-pending-card]').forEach(card=>{if(pendingHandoffRefresh.has(card.dataset.pendingCard))pendingMarkHandoffStale(card);});
}
function pendingMarkHandoffStale(card){
 const id=card.dataset.pendingCard,actor=me,epoch=pendingRenderEpoch;
 let box=card.querySelector('[data-work-handoff]');
 if(!box){box=document.createElement('div');box.setAttribute('class','work-handoff');box.setAttribute('data-work-handoff','');card.insertBefore(box,card.querySelector('.actions'));}
 // The request RPC can succeed even if its handoff trigger could not update the assignment.
 box.querySelectorAll('button:not([data-pending-handoff-refresh])').forEach(button=>button.remove());
 if(id===pendingUnverifiedId){box.querySelector('[data-pending-handoff-refresh]')?.remove();if(!box.querySelector('[data-pending-handoff-unverified]'))box.insertAdjacentHTML('beforeend','<p role="status" data-pending-handoff-unverified>Reload the saved request before refreshing handoff information.</p>');return;}
 if(!box.querySelector('[data-pending-handoff-refresh]'))box.insertAdjacentHTML('beforeend','<p role="status">Handoff information needs refresh.</p><button type="button" data-pending-handoff-refresh>Refresh handoff</button>');
 const button=box.querySelector('[data-pending-handoff-refresh]');button.onclick=()=>run(async()=>{
  if(me!==actor||view!=='pending'||pendingRenderEpoch!==epoch||!card.isConnected)return;
  const focused=document.activeElement===button;box.remove();pendingHandoffRefresh.delete(id);
  if(typeof decorateWorkHandoffs==='function')await decorateWorkHandoffs(card);
  if(me!==actor||view!=='pending'||pendingRenderEpoch!==epoch||!card.isConnected)return;
  if(card.querySelector('[data-work-handoff] [role="alert"]')){pendingHandoffRefresh.add(id);pendingMarkHandoffStale(card);}
  if(focused&&document.activeElement===document.body)(card.querySelector('[data-work-handoff] button')||card.querySelector('.actions button'))?.focus({preventScroll:true});
 });
}
function pendingFocusAfterPatch(card,previous,trigger,current){
 const active=document.activeElement,shouldFocus=previous?.contains(active)||previous?.contains(trigger)||trigger?.closest('#pendingForm'),data=Object.entries(trigger?.dataset||{});
 if(!shouldFocus)return;
 const focus=()=>{
  if(!current()||!card.isConnected)return;
  if(document.activeElement!==document.body&&document.activeElement?.isConnected&&!document.activeElement.closest('dialog:not([open])'))return;
  const matching=data.length&&[...card.querySelectorAll('button')].find(button=>data.every(([key,value])=>button.dataset[key]===value));
  (matching||card.querySelector('.actions button:not(:disabled)'))?.focus({preventScroll:true});
 };
 const dialog=document.querySelector('dialog[open]');if(dialog)dialog.addEventListener('close',focus,{once:true});else focus();
}
function pendingPatchDetail(row,trigger,current){
 const previous=document.querySelector(`[data-pending-card="${CSS.escape(row.id)}"]`),template=document.createElement('template'),x=window.scrollX,y=window.scrollY;
 template.innerHTML=pendingDetailHtml(row);const card=template.content.firstElementChild,oldHandoff=previous?.querySelector('[data-work-handoff]:not(.heading)');
 if(oldHandoff)card.insertBefore(oldHandoff,card.querySelector('.actions'));
 if(previous)previous.replaceWith(card);else $('#pendingCards')?.append(card);
 if(!pendingCreating)$('#pendingEditor')?.replaceChildren();
 bindPendingCards(card);pendingMarkHandoffStale(card);pendingFocusAfterPatch(card,previous,trigger,current);
 window.scrollTo({left:x,top:y,behavior:'instant'});return card;
}
function reconcilePendingRegister(){
 const data=pendingPageData,container=$('#pendingCards');if(!container)return;
 const x=window.scrollX,y=window.scrollY,selected=pendingSelectedId&&pendingRows.find(row=>row.id===pendingSelectedId),existing=new Map([...container.querySelectorAll('[data-pending-card]')].map(card=>[card.dataset.pendingCard,card])),wanted=[];
 for(const row of data.rows){
  let card=existing.get(row.id);const html=row.id===selected?.id?null:pendingSummaryCard(row,!!pendingAvailabilityNotice());
  if(!card||html!==null&&card.pendingSummaryHtml!==html){const template=document.createElement('template');template.innerHTML=html??pendingDetailHtml(selected);const next=template.content.firstElementChild;if(card)card.replaceWith(next);card=next;card.pendingSummaryHtml=html;bindPendingCards(card);}
  wanted.push(card);
 }
 if(selected&&!data.rows.some(row=>row.id===selected.id)){const card=existing.get(selected.id);if(card)wanted.push(card);}
 for(const card of existing.values())if(!wanted.includes(card))card.remove();
 // Only move nodes whose position changed; retained cards keep focus and expanded content.
 wanted.forEach((card,index)=>{if(container.children[index]!==card)container.insertBefore(card,container.children[index]||null);});
 $('#pendingPaging').hidden=false;$('#pendingCount').textContent=`${data.total} matching pending orders`;$('#pendingPageStatus').textContent=`Page ${data.page+1} of ${data.pages}`;$('#pendingPrev').disabled=data.page===0;$('#pendingNext').disabled=data.page>=data.pages-1;$('#pendingEmpty').hidden=!!wanted.length;
 const labels={waiting:'Waiting',arrived:'Stock arrived',mine:'Mine',due:'Closing soon',closed:'Closed',all:'All'};
 document.querySelectorAll('[data-pending-filter]').forEach(button=>{button.textContent=labels[button.dataset.pendingFilter]+(data.as_of===pendingToday()?` (${data.counts[button.dataset.pendingFilter]})`:'');});
 $('#pendingLoadNotice').replaceChildren();$('#pendingStockNotices').innerHTML=pendingStockNotices();window.scrollTo({left:x,top:y,behavior:'instant'});
}
function bindPendingRegisterRetry(current){
 const button=$('#pendingRetryRegister');if(button)button.onclick=()=>{
  if(!current()||button.disabled)return;
  return run(async()=>{if(!current())return;const focused=document.activeElement===button;button.disabled=true;try{await refreshPendingRegister(current);if(current()&&focused&&document.activeElement===document.body)($('#pendingRetryRegister')||$('#pendingPageStatus'))?.focus({preventScroll:true});}finally{if(button.isConnected)button.disabled=false;}},{origin:button});
 };
}
function showPendingRegisterNotice(current){
 const notice=$('#pendingRegisterNotice');if(notice){notice.innerHTML=pendingRegisterNotice();bindPendingCards(notice);bindPendingRegisterRetry(current);}
}
async function refreshPendingRegister(current){
 const request=++pendingRegisterRequest,latest=()=>current()&&pendingRegisterRequest===request;
 try{if(!await loadPendingPage(latest))return;pendingRegisterError='';reconcilePendingRegister();}
 catch(error){if(!latest())return;pendingRegisterError=error.message||'Register unavailable.';}
 if(latest())showPendingRegisterNotice(current);
}
function pendingConfirmedRecord(data,id,previous=null,action=''){
 const row=Array.isArray(data)&&data.length===1?data[0]:data,date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(!row||row.id!==id||row.page_summary===true||!['request_number','organization_id','product_id','salesperson_user_id'].every(key=>typeof row[key]==='string'&&row[key])||!['notes','close_note'].every(key=>typeof row[key]==='string')||!['proforma_id','proforma_line_id'].every(key=>row[key]===null||typeof row[key]==='string')||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>1000000||!Number.isSafeInteger(row.version)||row.version<1||!Number.isSafeInteger(row.extension_count)||row.extension_count<0||row.extension_count>4||!date(row.expires_on)||!['waiting','fulfilled','cancelled','expired'].includes(row.status)||!(row.closed_at===null||typeof row.closed_at==='string'&&Number.isFinite(Date.parse(row.closed_at)))||(row.status==='waiting')!==(row.closed_at===null))return null;
 if(previous&&(['organization_id','product_id','quantity','salesperson_user_id','proforma_id','proforma_line_id'].some(key=>row[key]!==previous[key])||row.version!==previous.version+1||row.status!=={fulfil:'fulfilled',cancel:'cancelled',expire:'expired',extend:'waiting'}[action]||row.extension_count!==previous.extension_count+(action==='extend'?1:0)))return null;
 return row;
}
async function pendingApplySave(data,id,previous,action,trigger,current){
 const saved=pendingConfirmedRecord(data,id,previous,action);pendingLoaded=false;
 if(!saved){pendingUnverifiedId=id;pendingHandoffRefresh.add(id);if(previous)pendingPatchDetail(previous,trigger,current);showPendingRegisterNotice(current);message('The save completed, but the returned request details could not be verified. Reload the saved request before continuing.',true);return false;}
 pendingUnverifiedId='';pendingRows=pendingRows.some(row=>row.id===id)?pendingRows.map(row=>row.id===id?saved:row):[...pendingRows,saved];pendingSelectedId=id;pendingCreating=false;pendingRequestId=null;pendingHandoffRefresh.add(id);
 pendingPatchDetail(saved,trigger,current);message(`${saved.request_number}: ${action?'change':'request'} saved.`);
 await refreshPendingRegister(current);return true;
}
async function savePendingForm(form){
 if(pendingUnverifiedId&&pendingUnverifiedId===pendingRequestId)throw Error('Reload the saved request before continuing.');
 const f=new FormData(form),product=inventoryProductFromChoice(String(f.get('productChoice')||'')),quantity=Number(f.get('quantity'));
 if(!f.get('organizationId'))throw Error('Choose the client.');
 if(!product)throw Error('Choose a product from the list.');
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)throw Error('Enter a whole quantity of at least 1.');
 // One request ID per form until the server confirms it, so a retry after a lost response cannot duplicate the order.
 pendingRequestId??=crypto.randomUUID();
 const actor=me,epoch=pendingRenderEpoch,id=pendingRequestId,current=()=>me===actor&&view==='pending'&&pendingRenderEpoch===epoch&&form.isConnected;
 let result;
 try{result=await client.rpc('create_pending_stock_request',{p_id:id,p_organization_id:f.get('organizationId'),p_contact_id:f.get('contactId')||null,p_product_id:product.id,p_quantity:quantity,p_proforma_id:f.get('proformaId')||null,p_lead_id:null,p_salesperson_user_id:f.get('salesperson')||null,p_notes:String(f.get('notes')||'')});}
 catch(error){if(!current())return;throw error;}
 if(!current())return;
 if(result.error)throw Error(result.error.message);
 // Removing the confirmed form is intentional; subsequent register work uses the workspace guard.
 await pendingApplySave(result.data,id,null,'',form.querySelector('[type="submit"]'),()=>me===actor&&view==='pending'&&pendingRenderEpoch===epoch);
}
function openPendingAction(row,action,trigger=null){
 if(!row)return;
 if(row.id===pendingUnverifiedId)throw Error('Reload the saved request before continuing.');
 if(row.proforma_line_id&&action!=='extend')throw Error('Open the original order to invoice its balance. Linked pending quantities update automatically.');
 trigger??=document.activeElement;
 const actor=me,epoch=pendingRenderEpoch,current=()=>me===actor&&view==='pending'&&pendingRenderEpoch===epoch;
 const titles={fulfil:'Mark pending order fulfilled',cancel:'Cancel pending order',extend:'Extend pending order',expire:'Close pending order as expired'};
 const fields=`<p><strong>${esc(row.request_number)}</strong> · ${esc(pendingProductLabel(row))} · ${esc(row.quantity)} pcs · ${esc(pendingClientLabel(row))}</p>${action==='extend'?`<label><span>Extend by</span><select name="months" required>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${n===3?'selected':''}>${n} month${n===1?'':'s'}</option>`).join('')}</select></label><p class="muted">Extensions used: ${row.extension_count} of 4.</p>`:''}<label><span>${action==='fulfil'?'Invoice, Pro forma or delivery reference':action==='cancel'?'Why is it cancelled?':action==='extend'?'Why is it being extended?':'Note · optional'}</span><textarea name="note" maxlength="1000" ${action==='expire'?'':'required minlength="3"'}></textarea></label>`;
 actionForm(titles[action],fields,async values=>{
  if(!current())throw Error('The workspace changed. Reopen the pending request.');
  let result;try{result=await client.rpc('advance_pending_stock_request',{p_id:row.id,p_expected_version:row.version,p_action:action,p_note:values.note||'',p_extend_months:action==='extend'?Number(values.months):null});}catch(error){if(!current())return;throw error;}
  if(!current())return;
  if(result.error)throw Error(result.error.message);
  await pendingApplySave(result.data,row.id,row,action,trigger,current);
 });
}
async function showPendingHistory(id){
 const output=document.querySelector(`[data-pending-history-output="${CSS.escape(id)}"]`),actor=me,epoch=pendingRenderEpoch;if(!output)return;
 output.textContent='Loading history…';
 const result=await client.from('pending_stock_events').select('action,from_status,to_status,note,expires_on,actor_user_id,created_at').eq('request_id',id).order('created_at').limit(200);
 if(me!==actor||pendingRenderEpoch!==epoch||!output.isConnected)return;
 if(result.error){output.textContent=`History could not load: ${result.error.message}`;return;}
 output.innerHTML=`<ol class="lead-history">${(result.data||[]).map(event=>`<li>${esc(new Date(event.created_at).toLocaleString())} · <strong>${esc(employeeName(event.actor_user_id))}</strong> · ${esc(event.action)} · closes ${esc(event.expires_on)}${event.note?` · ${esc(event.note)}`:''}</li>`).join('')}</ol>`;
}
