'use strict';

let salesSection='proformas',salesLoaded=false,salesLoadError='',salesProformas=[],salesProformaLines=[],salesProformaEvents=[],salesDeliveryNotes=[],salesDeliveryLines=[],salesDeliveryEvents=[],salesEditing='',salesFocusedProforma='',salesPrefill=null;
function clearSalesPrefill(){salesPrefill=null;}
let salesProformaFilter='all',salesProformaSearch='';
const salesTabs=[['proformas','Pro forma invoices'],['delivery','Delivery notes'],['documents','Official forms & PDFs']];
const salesWorkflowSteps=[
 ['submitted','Pro forma submitted'],['accounts_approved','Accounts approved'],['tax_invoice_created','Tax invoice created'],['sent_to_sales','Sent to downstairs sales'],['packing','Packing in progress'],['ready','Ready for delivery'],['out_for_delivery','Out for delivery'],['delivered','Delivery note signed']
];
function salesOrganization(id){return orgIndex.get(id)||{name:'Client unavailable',location:''}}
function salesContact(id){return rowById(contacts,id)||{first_name:'Contact',last_name:'unavailable'} }
function salesContactName(id){const c=salesContact(id);return [c.title==='N/A'?'':c.title,c.first_name,c.last_name].filter(Boolean).join(' ')}
function salesProduct(id){return rowById(products,id)||{name:'Product unavailable',sku:''}}
function salesProforma(id){return rowById(salesProformas,id)}
function salesLines(id){return [...rowsWhere(salesProformaLines,'proforma_id',id)].sort((a,b)=>a.sort_order-b.sort_order)}
function deliveryLines(id){return [...rowsWhere(salesDeliveryLines,'delivery_note_id',id)]}
function salesDate(offset=0){const date=new Date();date.setDate(date.getDate()+offset);return date.toISOString().slice(0,10)}
function salesStatus(value){return ({draft:'Draft',sent:'Sent to client',accepted:'Pro forma submitted',accounts_approved:'Accounts approved',tax_invoice_created:'Tax invoice created',sent_to_sales:'Sent to downstairs sales',packing:'Packing in progress',ready:'Ready for delivery',out_for_delivery:'Out for delivery',delivered:'Delivery note signed',rejected:'Rejected',cancelled:'Cancelled'})[value]||String(value||'').replaceAll('_',' ')}
function latestDelivery(proformaId){return rowsWhere(salesDeliveryNotes,'proforma_id',proformaId).find(note=>note.status!=='cancelled')}
function openDelivery(proformaId){return rowsWhere(salesDeliveryNotes,'proforma_id',proformaId).find(note=>!['cancelled','delivered'].includes(note.status))}
function hasRemainingDelivery(record){return salesLines(record.id).some(line=>remainingDeliveryQuantity(line,salesDeliveryLines,salesDeliveryNotes)>0)}
function canCreateDelivery(record){return record.status==='accepted'&&!openDelivery(record.id)&&hasRemainingDelivery(record)}
function workflowIndex(record,note){if(record.status!=='accepted')return -1;if(!note)return 0;return salesWorkflowSteps.findIndex(([status])=>status===note.status)}
function workflowProgress(record,note){const current=workflowIndex(record,note);return `<ol class="workflow-progress" aria-label="Order progress">${salesWorkflowSteps.map(([status,label],index)=>`<li class="${index<current?'complete':index===current?'current':''}" ${index===current?'aria-current="step"':''}><span>${index<current?'✓':index+1}</span><small>${esc(label)}</small></li>`).join('')}</ol><details class="workflow-history" data-order-timing data-proforma="${esc(record?.id||'')}" data-delivery="${esc(note?.id||'')}"><summary>Step durations, waiting time and staff</summary><button type="button" data-load-order-timing>Load / refresh timing</button><div data-order-timing-output role="status">Load complete history to calculate durations.</div></details>`}
async function loadOrderTiming(panel){
 const actor=me?.user_id,target=panel.querySelector('[data-order-timing-output]'),button=panel.querySelector('button');
 const current=()=>me?.user_id===actor&&view==='sales'&&panel.isConnected;
 button.disabled=true;target.textContent='Loading complete event history…';
 try{
  const id=panel.dataset.proforma,noteId=panel.dataset.delivery;
  const [events,delivery,recordResult]=await Promise.all([
   fetchOrderEvents(client,'sales_proforma_events','proforma_id',id),
   noteId?fetchOrderEvents(client,'sales_delivery_events','delivery_note_id',noteId):Promise.resolve([]),
   client.from(noteId?'sales_delivery_notes':'sales_proformas').select('status,version').eq('id',noteId||id).single()
  ]);
  if(!current())return;
  if(recordResult.error||!recordResult.data)throw Error('Current order status could not be verified.');
  // Accounts approval starts a separate delivery stream from an accepted proforma.
  const combined=events.map(event=>({...event,id:'proforma:'+event.id}));
  delivery.forEach((event,index)=>combined.push({...event,id:'delivery:'+event.id,from_status:index===0&&event.from_status==null?'accepted':event.from_status}));
  const now=Date.now(),timing=orderTiming(combined,recordResult.data.status,now);
  const date=value=>value?new Date(value).toLocaleString('en-TZ'):'—',who=value=>value===actor?'You':value||'Unknown';
  target.innerHTML=`<p>Total elapsed: <strong>${esc(orderDuration(timing.totalMs))}</strong> · Current waiting: <strong>${esc(orderDuration(timing.waitingMs))}</strong></p><p>As of ${esc(date(now))}. Refresh for current waiting time. ${noteId?'This delivery path only. ':''}${timing.reliable?'':'History has missing or inconsistent transitions; unknown durations are not estimated.'}</p><div class="table-wrap"><table><thead><tr><th>Step / visit</th><th>Started</th><th>Started by</th><th>Ended</th><th>Ended by</th><th>Duration</th></tr></thead><tbody>${timing.visits.map(visit=>`<tr><td>${esc(salesStatus(visit.status))}</td><td>${esc(date(visit.startedAt))}</td><td>${esc(who(visit.startedBy))}</td><td>${esc(date(visit.endedAt))}</td><td>${esc(who(visit.endedBy))}</td><td>${esc(orderDuration(visit.durationMs))}</td></tr>`).join('')}</tbody></table></div>`;
 }catch(error){if(current())target.textContent='Timing unavailable: '+error.message;}
 finally{if(current())button.disabled=false;}
}
function deliveryHistory(note){const events=salesDeliveryEvents.filter(event=>event.delivery_note_id===note.id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));if(!events.length)return '';return `<details class="workflow-history"><summary>Who changed this order and when</summary>${events.map(event=>`<div><strong>${esc(salesStatus(event.to_status))}</strong><small>${esc(employeeName(event.actor_user_id))} · ${esc(new Date(event.created_at).toLocaleString('en-TZ'))}${event.reference?' · '+esc(event.reference):''}</small></div>`).join('')}</details>`}
// Lines are loaded only for the Pro formas and delivery notes on screen, 100 parents and 1,000 rows at a time, so
// the server's per-request row limit can never silently drop items.
async function salesRowsFor(table,column,ids,order){
 const out=[];
 for(let i=0;i<ids.length;i+=100){
  const chunk=ids.slice(i,i+100);
  for(let offset=0;;offset+=1000){
   let query=client.from(table).select('*').in(column,chunk);
   if(order)query=query.order(order);
   const result=await query.order('id').range(offset,offset+999);
   if(result.error)return {error:result.error};
   out.push(...(result.data||[]));
   if((result.data||[]).length<1000)break;
  }
 }
 return {data:out};
}
async function loadSalesDelivery(){
 const actor=me?.user_id;
 salesLoadError='';
 if(!inventoryLoaded)await loadInventoryOperations();
 const requests=await Promise.all([
  client.from('sales_proformas').select('*').order('created_at',{ascending:false}).limit(200),
  Promise.resolve({data:[]}),
  client.from('sales_proforma_events').select('*').order('created_at',{ascending:false}).limit(500),
  client.from('sales_delivery_notes').select('*,tax_invoice_reference').order('created_at',{ascending:false}).limit(200),
  Promise.resolve({data:[]}),
  client.from('sales_delivery_events').select('*').order('created_at',{ascending:false}).limit(1000)
 ]);
 if(me?.user_id!==actor)return;
 const failed=requests.find(result=>result.error);
 if(failed){salesLoaded=false;salesLoadError=failed.error.message||'Sales workflow schema has not been installed.';return;}
 if(salesFocusedProforma&&!requests[0].data?.some(row=>row.id===salesFocusedProforma)){
  const record=await client.from('sales_proformas').select('*').eq('id',salesFocusedProforma).single();
  if(me?.user_id!==actor)return;
  if(record.error||!record.data){salesLoaded=false;salesLoadError=record.error?.message||'Saved Pro forma unavailable.';return;}
  requests[0].data=[record.data,...(requests[0].data||[])];
 }
 const [proformaLines,deliveryLines]=await Promise.all([
  salesRowsFor('sales_proforma_lines','proforma_id',(requests[0].data||[]).map(row=>row.id),'sort_order'),
  salesRowsFor('sales_delivery_lines','delivery_note_id',(requests[3].data||[]).map(row=>row.id))
 ]);
 if(me?.user_id!==actor)return;
 const linesFailed=[proformaLines,deliveryLines].find(result=>result.error);
 if(linesFailed){salesLoaded=false;salesLoadError=linesFailed.error.message||'Items could not load.';return;}
 requests[1]=proformaLines;requests[4]=deliveryLines;
 [salesProformas,salesProformaLines,salesProformaEvents,salesDeliveryNotes,salesDeliveryLines,salesDeliveryEvents]=requests.map(result=>result.data||[]);salesLoaded=true;
}
function salesHeader(){return `<div class="heading"><div><small>ORDERS</small><h1>${salesSection==='delivery'?'Delivery progress':salesEditing==='new'?'Create Pro forma':'Pro formas'}</h1></div><button id="salesRefresh" type="button">Refresh list</button></div>`}
function salesUnavailable(){return `${salesHeader()}<section class="card"><h2>Pro formas could not be loaded</h2><p class="warning">Press Refresh list. If it keeps happening, tell the owner. Nothing was changed.</p><p class="muted">${esc(salesLoadError)}</p></section>`}
// With the search box loaded (smart-lookup.js) a client <select> marked data-lookup-rows="organizations" holds only the
// chosen branch; the box offers all of them. Without it, every branch is listed as before.
function salesOrganizationOptions(selected=''){return (typeof lookupRowSources==='undefined'?organizations.slice().sort((a,b)=>a.name.localeCompare(b.name)):organizations.filter(row=>row.id===selected).slice(0,1)).map(row=>inventoryOption(row.id,`${row.name}${row.location?' · '+row.location:''}`,row.id===selected)).join('')}
function salesContactOptions(organizationId,selected=''){return contacts.filter(row=>row.organization_id===organizationId&&row.status!=='incorrect').sort((a,b)=>(a.first_name+' '+a.last_name).localeCompare(b.first_name+' '+b.last_name)).map(row=>inventoryOption(row.id,salesContactName(row.id),row.id===selected)).join('')}
// Labels must come from the reviewed product, the same one inventoryProductFromChoice matches against.
function salesProductChoices(){return (typeof inventorySelectableProducts==='function'?inventorySelectableProducts():products.filter(p=>!p.deleted_at).map(p=>typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(p):p).sort((a,b)=>a.name.localeCompare(b.name))).map(product=>`<option value="${esc(inventoryProductChoice(product))}"></option>`).join('')}
function salesLineRow(line={}){const product=salesProduct(line.product_id),choice=line.product_id?inventoryProductChoice(product.id&&typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(product):product):'';return `<div class="document-line" data-proforma-line><label><span>Product</span><input name="productChoice" list="salesProductChoices" value="${esc(choice)}" placeholder="Start typing a product" required autocomplete="off"></label><label><span>Description</span><input name="description" value="${esc(line.description||'')}" required maxlength="4000"></label><label><span>Quantity</span><input name="quantity" type="number" min="1" step="1" value="${line.quantity||1}" required></label><label><span>Unit</span><input name="uom" value="${esc(line.uom||'unit')}" required maxlength="40"></label><label><span>Unit price</span><input name="unitPrice" inputmode="decimal" value="${line.unit_price_minor===undefined?'':(line.unit_price_minor/100).toFixed(2)}" required></label><label><span>Discount %</span><input name="discount" type="number" min="0" max="100" step="0.01" value="${line.discount_basis_points===undefined?0:line.discount_basis_points/100}" required></label><label><span>Tax %</span><input name="tax" type="number" min="0" max="100" step="0.01" value="${line.tax_basis_points===undefined?0:line.tax_basis_points/100}" required></label><button type="button" class="danger" data-remove-sales-line>Remove item</button></div>`}
// Before a second quote is made for the same client, show the open ones and who made them, so the team can
// check with that person instead of sending the client two different Pro formas.
let proformaExistingAsk=0;
async function proformaShowExisting(){
 const form=$('#proformaForm');if(!form)return;
 const org=form.querySelector('[name="organizationId"]')?.value,editing=form.dataset.id,ask=++proformaExistingAsk;
 let box=form.querySelector('#proformaExisting');
 if(!box){box=document.createElement('div');box.id='proformaExisting';form.querySelector('.grid')?.after(box);}
 box.className='';box.innerHTML='';if(!org)return;
 // Asked for this client only: the list on screen holds just the newest Pro formas of the whole company.
 const r=await client.from('sales_proformas').select('id,document_number,status,total_minor,currency,prepared_by,created_at').eq('organization_id',org).is('deleted_at',null).in('status',['draft','sent']).order('created_at',{ascending:false}).limit(20);
 if(ask!==proformaExistingAsk||!box.isConnected||r.error)return;
 const open=(r.data||[]).filter(row=>row.id!==editing);
 const label={draft:'Draft',sent:'Sent to customer'};
 box.className=open.length?'notice attention':'';
 box.innerHTML=open.length?`<strong>This client already has ${open.length===20?'20 or more':open.length} Pro forma${open.length>1?'s':''} not yet accepted.</strong> Check with the person who made it before sending another:<ul>${open.slice(0,5).map(row=>`<li>${esc(row.document_number)} · ${esc(label[row.status]||row.status)} · ${esc(moneyDisplay(Number(row.total_minor),row.currency))} · made by ${esc(typeof employeeName==='function'?employeeName(row.prepared_by):'')} · ${esc(new Date(row.created_at).toLocaleDateString())}</li>`).join('')}</ul>${open.length>5?`<p class="muted">and ${open.length-5} more under Pro formas · all.</p>`:''}`:'';
}
function proformaEditor(){
 const record=salesEditing==='new'?null:salesProforma(salesEditing),lines=record?salesLines(record.id):[{}],prefill=record?null:salesPrefill,organizationId=record?.organization_id||prefill?.organizationId||'',contactId=record?.contact_id||prefill?.contactId||'';
 return `<section class="card document-editor"><div class="heading"><div><small>${record?'REVISION '+record.revision:'NEW DOCUMENT'}</small><h2>${record?'Edit '+esc(record.document_number):'New Pro forma invoice'}</h2></div><button type="button" id="closeSalesEditor">Close</button></div><form id="proformaForm" data-id="${record?.id||''}" data-version="${record?.version||0}"><div class="grid"><label><span>Client branch</span><select name="organizationId" required data-lookup-rows="organizations"><option value="">Choose client / branch</option>${salesOrganizationOptions(organizationId)}</select></label><label><span>Named contact</span><select name="contactId" required><option value="">Choose the branch first</option>${salesContactOptions(organizationId,contactId)}</select></label><label><span>Currency</span><select name="currency"><option ${record?.currency==='TZS'?'selected':''}>TZS</option><option ${record?.currency==='USD'?'selected':''}>USD</option><option ${record?.currency==='EUR'?'selected':''}>EUR</option></select></label><label><span>Valid until</span><input name="validUntil" type="date" min="${salesDate()}" value="${record?.valid_until||salesDate(15)}" required></label><label><span>Delivery period</span><input name="deliveryPeriod" value="${esc(record?.delivery_period||'As agreed after acceptance')}" required maxlength="300"></label><label><span>Payment terms</span><input name="paymentTerms" value="${esc(record?.payment_terms||'Payment before delivery')}" required maxlength="1000"></label><label class="wide"><span>Notes</span><textarea name="notes" maxlength="4000">${esc(record?.notes||'')}</textarea></label></div><h3>Items</h3><datalist id="salesProductChoices">${salesProductChoices()}</datalist><div id="proformaLines">${lines.map(salesLineRow).join('')}</div><div class="actions"><button type="button" id="addSalesLine">+ Add item</button><button type="submit">${record?'Save new revision':'Save Pro forma invoice'}</button></div></form></section>`;
}
function proformaTable(record){const lines=salesLines(record.id);return `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Disc.</th><th>Tax</th><th>Total</th></tr></thead><tbody>${lines.map(line=>{const totals=proformaLineTotal({quantity:line.quantity,unitPriceMinor:Number(line.unit_price_minor),discountBasisPoints:line.discount_basis_points,taxBasisPoints:line.tax_basis_points});return `<tr><td><strong>${esc(salesProduct(line.product_id).name)}</strong><small>${esc(line.description)} · ${esc(line.uom)}</small></td><td>${line.quantity}</td><td>${esc(moneyDisplay(Number(line.unit_price_minor),record.currency))}</td><td>${line.discount_basis_points/100}%</td><td>${line.tax_basis_points/100}%</td><td>${esc(moneyDisplay(totals.total,record.currency))}</td></tr>`}).join('')}</tbody></table></div>`}
function proformaActions(record){const actions=proformaNextActions(record.status),buttons=[];if(record.status==='draft')buttons.push(`<button data-edit-proforma="${record.id}">Edit draft</button>`);if(record.status==='draft'&&!record.deleted_at&&me?.role==='owner')buttons.push(`<button type="button" class="danger" data-archive-business="proforma" data-id="${record.id}">Delete draft</button>`);for(const action of actions){const labels={send:'Record sent to client',accept:'Submit to accounting',revise:'Return for revision',reject:'Record rejected',cancel:'Cancel'};buttons.push(`<button data-proforma-action="${action}" data-id="${record.id}" class="${['reject','cancel'].includes(action)?'danger':''}">${labels[action]}</button>`)}if(record.status==='accepted'&&typeof openSendToTally==='function')buttons.push(`<button type="button" data-send-tally="${record.id}">Send to Tally</button>`);buttons.push(`<button data-print-document="${record.id}">Print / PDF</button>`);return buttons.join('')}
function proformaCard(record){const organization=salesOrganization(record.organization_id),note=latestDelivery(record.id);return `<article class="card document-card" data-document-card="${record.id}">${companyFormBrand()}<h2>PRO FORMA INVOICE</h2><div class="heading"><div><h2>${esc(record.document_number)}</h2><p>${esc(organization.name)} · ${esc(organization.location||'Location not supplied')}<br>Contact: ${esc(salesContactName(record.contact_id))}</p></div><div>${proformaTagHtml(record)}<small>Revision ${record.revision}</small></div></div><div class="no-print">${workflowProgress(record,note)}</div>${proformaTable(record)}<div class="document-totals"><span>Subtotal <strong>${esc(moneyDisplay(Number(record.subtotal_minor),record.currency))}</strong></span><span>Discount <strong>${esc(moneyDisplay(Number(record.discount_minor),record.currency))}</strong></span><span>Tax <strong>${esc(moneyDisplay(Number(record.tax_minor),record.currency))}</strong></span><span>Total <strong>${esc(moneyDisplay(Number(record.total_minor),record.currency))}</strong></span></div><div class="details"><div><small>Valid until</small>${esc(record.valid_until)}</div><div><small>Delivery period</small>${esc(record.delivery_period)}</div><div><small>Payment terms</small>${esc(record.payment_terms)}</div><div><small>Customer acceptance / LPO</small>${esc(record.acceptance_reference||'Not accepted yet')}</div><div><small>Prepared by</small>${esc(record.prepared_by?(typeof employeeName==='function'?employeeName(record.prepared_by):record.prepared_by):'Not recorded')}</div></div>${record.notes?`<p>${esc(record.notes)}</p>`:''}${companyProformaReferenceTerms()}<p>E. &amp; O.E. · Pro forma only — not a tax invoice or proof of payment.</p><div class="no-print">${note?deliveryHistory(note):''}</div><div class="actions no-print">${proformaActions(record)}</div></article>`}
// One tag per Pro forma, from where it is now: its own status, then the delivery started from it.
const proformaTagKinds=[['draft','Draft'],['revised','Revised'],['sent','Sent to customer'],['waiting','Waiting approval'],['delivery','Approved · in delivery'],['done','Delivered'],['closed','Cancelled / rejected']];
function proformaTag(record){
 if(record.status==='cancelled'||record.status==='rejected')return 'closed';
 if(record.status==='draft')return record.revision>1?'revised':'draft';
 if(record.status==='sent')return 'sent';
 const note=latestDelivery(record.id);
 if(!note||note.status==='draft')return 'waiting';
 return note.status==='delivered'?'done':'delivery';
}
function proformaTagHtml(record){const kind=proformaTag(record),label=proformaTagKinds.find(([key])=>key===kind)[1];return `<span class="proforma-tag proforma-tag-${kind}">${esc(label)}</span>`}
function proformaTile(record){
 const organization=salesOrganization(record.organization_id),when=record.updated_at||record.created_at;
 return `<li><button type="button" class="proforma-tile" data-open-proforma="${record.id}">${proformaTagHtml(record)}<strong>${esc(record.document_number)}</strong><span>${esc(organization.name)}${organization.location?' · '+esc(organization.location):''}</span><small>${esc(salesContactName(record.contact_id))}</small><span class="proforma-tile-foot"><b>${esc(moneyDisplay(Number(record.total_minor),record.currency))}</b><small>${when?esc(new Date(when).toLocaleDateString()):''}${record.prepared_by&&typeof employeeName==='function'?' · '+esc(employeeName(record.prepared_by)):''}</small></span></button></li>`;
}
function proformaListScreen(){
 const live=salesProformas.filter(record=>!record.deleted_at),q=salesProformaSearch.trim().toLowerCase();
 const counts=Object.fromEntries(proformaTagKinds.map(([key])=>[key,0]));for(const record of live)counts[proformaTag(record)]++;
 const matches=live.filter(record=>(salesProformaFilter==='all'||proformaTag(record)===salesProformaFilter)&&(!q||`${record.document_number} ${salesOrganization(record.organization_id).name} ${salesOrganization(record.organization_id).location||''} ${salesContactName(record.contact_id)} ${record.acceptance_reference||''}`.toLowerCase().includes(q)));
 const shown=matches.slice(0,120);
 return `${salesHeader()}<div class="heading"><p class="muted">Newest first. Press one to open it.</p><button class="primary-action" id="newProforma">+ New Pro forma</button></div>
 <label class="proforma-search"><span>Search</span><input id="proformaSearch" type="search" value="${esc(salesProformaSearch)}" placeholder="PF number, client, contact or LPO" autocomplete="off"></label>
 <div class="tabs proforma-filters" role="group" aria-label="Show Pro formas"><button type="button" data-proforma-filter="all" class="${salesProformaFilter==='all'?'active':''}" aria-pressed="${salesProformaFilter==='all'}">All · ${live.length}</button>${proformaTagKinds.map(([key,label])=>`<button type="button" data-proforma-filter="${key}" class="proforma-filter-${key}${salesProformaFilter===key?' active':''}" aria-pressed="${salesProformaFilter===key}">${esc(label)} · ${counts[key]}</button>`).join('')}</div>
 ${shown.length?`<ul class="proforma-tiles">${shown.map(proformaTile).join('')}</ul>${matches.length>shown.length?`<p class="muted">Showing ${shown.length} of ${matches.length}. Search to find older ones.</p>`:''}`:live.length?'<p class="empty">No Pro forma matches. Clear the search or choose All.</p>':'<div class="empty"><strong>No Pro formas yet.</strong><br>Press + New Pro forma to make the first one.</div>'}`;
}
function proformaScreen(){
 if(salesEditing)return `${salesHeader()}${proformaEditor()}`;
 const open=salesFocusedProforma&&salesProformas.find(record=>record.id===salesFocusedProforma&&!record.deleted_at);
 if(open)return `${salesHeader()}<div class="actions"><button type="button" data-proforma-back>← All Pro formas</button></div>${proformaCard(open)}`;
 return proformaListScreen();
}
function haadiLots(productId){const hubIds=new Set(inventoryLocations.filter(row=>row.active&&row.is_dispatch_hub).map(row=>row.id));return inventoryLots.filter(row=>row.product_id===productId&&row.stock_status==='available'&&hubIds.has(row.location_id)&&row.loose_units-row.reserved_units>0)}
function deliveryEditor(record){
 return `<section class="card document-editor"><div class="heading"><div><small>FROM ${esc(record.document_number)}</small><h2>Record Accounts approval</h2></div><button type="button" id="closeDeliveryEditor">Close</button></div><form id="deliveryForm" data-id="${record.id}" data-version="${record.version}"><div class="grid"><label><span>Accounts approval reference</span><input name="accountsReference" required maxlength="120" placeholder="Approval email, voucher or reference"></label><label><span>Expected delivery date</span><input name="expectedDeliveryDate" type="date" min="${salesDate()}" value="${salesDate()}" required></label></div><p class="muted">Accounts approval does not depend on stock availability. Haadi lots are selected and reserved only when downstairs sales starts packing.</p><p class="muted">Accounts-only permissions will be added later. Until then, the signed-in employee who records this approval is saved in the permanent history.</p><button type="submit">Record Accounts approval</button></form></section>`;
}
function packingFields(note){const reserved=deliveryLines(note.id);if(reserved.length)return `<p class="notice">Stock was reserved when the Tax Invoice was created. Confirm the team has started packing these reserved items.</p><ul>${reserved.map(line=>`<li>${esc(salesProduct(line.product_id).name)} · ${line.quantity} reserved</li>`).join('')}</ul>`;const record=salesProforma(note.proforma_id),rows=salesLines(record.id).map(line=>({line,remaining:remainingDeliveryQuantity(line,salesDeliveryLines,salesDeliveryNotes)})).filter(row=>row.remaining>0);return `<p>Select only the quantities being packed in this legacy delivery. Saving reserves those exact Haadi units so another order cannot use them.</p>${rows.map(({line,remaining})=>{const lots=haadiLots(line.product_id),key=line.id;return `<div class="delivery-pick"><label class="delivery-check"><input type="checkbox" name="include_${key}" ${lots.length?'':'disabled'}><span>${esc(salesProduct(line.product_id).name)} · ${remaining} ${esc(line.uom)} remaining</span></label><label><span>Haadi lot</span><select name="lot_${key}" ${lots.length?'':'disabled'}><option value="">Choose lot</option>${lots.map(lot=>inventoryOption(lot.id,`${lot.batch_number||'No batch'} · ${lot.loose_units-lot.reserved_units} available`)).join('')}</select></label><label><span>Quantity</span><input name="qty_${key}" type="number" min="1" max="${remaining}" value="${remaining}" ${lots.length?'':'disabled'}></label>${lots.length?'':'<p class="warning">No loose Haadi stock is available for this item.</p>'}</div>`}).join('')}`}
function deliveryActions(note){const labels={tax_invoice:'Record tax invoice',send_to_sales:'Send to downstairs sales',start_packing:'Start packing',ready:'Packing complete · ready for delivery',dispatch:'Mark out for delivery',deliver:'Record signed delivery note',cancel:'Cancel'};return `${deliveryNextActions(note.status).map(action=>`<button data-delivery-action="${action}" data-id="${note.id}" class="${action==='cancel'?'danger':''}">${labels[action]}</button>`).join('')}<button data-print-document="${note.id}">Print / PDF</button>`}
function deliveryCard(note){const proforma=salesProforma(note.proforma_id),organization=salesOrganization(note.organization_id),lines=deliveryLines(note.id);return `<article class="card document-card" data-document-card="${note.id}"><div class="document-brand"><img src="assets/anudha-logo.svg" alt="Anudha Limited"><span>DELIVERY NOTE</span></div><div class="heading"><div><h2>${esc(note.delivery_number)}</h2><p>${esc(organization.name)} · ${esc(organization.location||'Location not supplied')}<br>Contact: ${esc(salesContactName(note.contact_id))}</p></div><span class="tag">${esc(salesStatus(note.status))}</span></div>${workflowProgress(proforma,note)}${!note.tax_invoice_reference&&['ready','out_for_delivery','delivered'].includes(note.status)?'<p class="warning">Legacy order: the tax invoice reference was not verified during migration.</p>':''}<div class="details"><div><small>Accepted Pro forma</small>${esc(proforma?.document_number||'Unavailable')}</div><div><small>Accounts approval</small>${esc(note.accounts_reference)}</div><div><small>Tax invoice</small>${esc(note.tax_invoice_reference||'Not created yet')}</div><div><small>Expected delivery</small>${esc(note.expected_delivery_date)}</div><div><small>Driver / out-for-delivery reference</small>${esc([note.carrier,note.tracking_reference].filter(Boolean).join(' · ')||'Not out for delivery')}</div></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th>Haadi lot</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${esc(salesProduct(line.product_id).name)}</td><td>${line.quantity}</td><td>${esc(inventoryLots.find(lot=>lot.id===line.lot_id)?.batch_number||'No batch')}</td></tr>`).join('')}</tbody></table></div>${note.status==='delivered'?`<p><strong>Received by:</strong> ${esc(note.recipient_name)} · <strong>Signed delivery note:</strong> ${esc(note.proof_reference)}</p><p class="notice">Order closed. Every delivered item classified as a Machine has been added automatically to the Installation queue.</p>`:''}${deliveryHistory(note)}<div class="actions no-print">${deliveryActions(note)}</div></article>`}
function deliveryScreen(){const accepted=salesProformas.filter(canCreateDelivery);return `${salesHeader()}<div class="heading"><div><h2>Delivery register</h2><p class="muted">Press the button for the step you have just finished. Stock is reserved when the tax invoice is made and leaves the godown when you mark Out for delivery.</p></div></div>${salesEditing&&salesEditing!=='new'?deliveryEditor(salesProforma(salesEditing)):''}${salesDeliveryNotes.map(deliveryCard).join('')||'<div class="empty"><strong>No delivery notes yet.</strong><br>Submit an accepted Pro forma, then record the Accounts approval.</div>'}${accepted.length&&!salesEditing?`<section class="card"><h2>Submitted Pro formas waiting for Accounts</h2>${accepted.map(record=>`<div class="recycle-record"><span><strong>${esc(record.document_number)}</strong><small>${esc(salesOrganization(record.organization_id).name)}</small></span><button data-create-delivery="${record.id}">Record Accounts approval</button></div>`).join('')}</section>`:''}`}
function officialDocumentsScreen(){return `${salesHeader()}<div class="heading"><div><h2>Official forms and printable records</h2><p class="muted">Use the approved Anudha forms. Completed Pro formas and delivery notes are printed from their own record cards.</p></div></div><div class="official-document-grid"><article class="card"><small>WORKFLOW 1 · SALES</small><h3>Pro forma invoice</h3><p>Open a Pro forma record and choose <strong>Print / PDF</strong>. Its current revision, client, items, prices, tax and terms are printed together.</p><button type="button" data-sales-section="proformas">Open Pro formas</button></article><article class="card"><small>WORKFLOW 1 · DELIVERY</small><h3>Delivery note</h3><p>Open a delivery record and choose <strong>Print / PDF</strong>. The signed reference and recipient remain attached to the closed order.</p><button type="button" data-sales-section="delivery">Open delivery notes</button></article><article class="card"><small>WORKFLOW 2 · INSTALLATION</small><h3>Equipment handover and installation report</h3><p>The official Anudha equipment handover and installation form.</p><a class="button" href="official-documents/equipment-handover-installation-report.pdf" target="_blank" rel="noopener">Open / print PDF</a></article><article class="card"><small>WORKFLOW 2 · SERVICE</small><h3>Service work report</h3><p>The official Anudha service report for field work, parts, customer sign-off and completion.</p><a class="button" href="official-documents/service-work-report.pdf" target="_blank" rel="noopener">Open / print PDF</a></article></div><p class="warning">These blank official forms contain no client data and are included as approved print references. The next service build will turn their fields into connected records and generate completed PDFs from the website.</p>`}
async function salesDeliveryWorkspace(force=false){
 const actor=me?.user_id;
 syncWorkspaceNavigation();
 $('#content').innerHTML='<p role="status">Loading Pro forma invoices and deliveries…</p>';
 if(salesSection==='documents'){$('#content').innerHTML=officialDocumentsScreen();bindSalesDelivery();return;}
 if(force||!salesLoaded)await loadSalesDelivery();
 if(me?.user_id!==actor||view!=='sales')return;
 if(!salesLoaded){$('#content').innerHTML=salesUnavailable();bindSalesDelivery();return;}
 $('#content').innerHTML=salesSection==='delivery'?deliveryScreen():salesSection==='documents'?officialDocumentsScreen():proformaScreen();bindSalesDelivery();
}
function readProformaLines(form){return [...form.querySelectorAll('[data-proforma-line]')].map(row=>{const product=inventoryProductFromChoice(row.querySelector('[name="productChoice"]').value);if(!product)throw Error('Choose every product from the search suggestions.');const quantity=Number(row.querySelector('[name="quantity"]').value),discount=Number(row.querySelector('[name="discount"]').value),tax=Number(row.querySelector('[name="tax"]').value);if(!Number.isSafeInteger(quantity)||quantity<1)throw Error('Every quantity must be a positive whole number.');if(!Number.isFinite(discount)||discount<0||discount>100||!Number.isFinite(tax)||tax<0||tax>100)throw Error('Discount and tax must be between 0% and 100%.');return {productId:product.id,description:row.querySelector('[name="description"]').value.trim(),quantity,uom:row.querySelector('[name="uom"]').value.trim(),unitPriceMinor:moneyMinor(row.querySelector('[name="unitPrice"]').value),discountBasisPoints:Math.round(discount*100),taxBasisPoints:Math.round(tax*100)}})}
async function saveProformaForm(form){
 if(form.dataset.saving==='true')return;
 const actor=me?.user_id;if(!actor||view!=='sales'||!form.isConnected)throw Error('Reopen the Pro forma form before saving.');
 const button=form.querySelector('[type="submit"]'),label=button.textContent;
 form.dataset.saving='true';button.disabled=true;button.textContent='Saving…';
 try{
  const f=new FormData(form),id=form.dataset.id||(form.dataset.requestId ||= crypto.randomUUID()),version=Number(form.dataset.version);
  const result=await client.rpc('save_sales_proforma',{p_id:id,p_expected_version:version,p_organization_id:f.get('organizationId'),p_contact_id:f.get('contactId'),p_currency:f.get('currency'),p_valid_until:f.get('validUntil'),p_delivery_period:f.get('deliveryPeriod'),p_payment_terms:f.get('paymentTerms'),p_notes:f.get('notes'),p_lines:readProformaLines(form)});
  if(me?.user_id!==actor||view!=='sales'||!form.isConnected)return;
  if(result.error)throw result.error;
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved?.id!==id||!Number.isInteger(saved.version)||saved.version!==version+1)throw Error('The server did not confirm this saved revision. Refresh the register before retrying.');
  form.dataset.id=id;form.dataset.version=String(saved.version);salesFocusedProforma=id;salesEditing='';
  await salesDeliveryWorkspace(true);
  if(me?.user_id===actor&&view==='sales')message(salesLoaded?'Pro forma invoice saved with an immutable revision.':'Pro forma was saved, but the register could not reload. Refresh to reopen it.',!salesLoaded);
 }finally{form.dataset.saving='false';button.disabled=false;button.textContent=label;}
}
async function createDeliveryForm(form){const f=new FormData(form),result=await client.rpc('create_sales_delivery_note',{p_id:crypto.randomUUID(),p_proforma_id:form.dataset.id,p_expected_proforma_version:Number(form.dataset.version),p_accounts_reference:f.get('accountsReference'),p_expected_delivery_date:f.get('expectedDeliveryDate'),p_lines:[]});if(result.error)throw result.error;salesEditing='';await salesDeliveryWorkspace(true);message('Accounts approval recorded. Next step: create the tax invoice.')}
function openProformaAction(record,action){const asksReference=action!=='send',label={send:'Send Pro forma to client',accept:'Record customer acceptance',revise:'Return Pro forma for revision',reject:'Record customer rejection',cancel:'Cancel Pro forma'}[action];actionForm(label,asksReference?`<p>${esc(record.document_number)} · ${esc(salesOrganization(record.organization_id).name)}</p><label><span>${action==='accept'?'Customer LPO, payment proof, email or acceptance reference':'Reason / reference'}</span><textarea name="reference" required maxlength="1000"></textarea></label>`:`<p>Confirm that ${esc(record.document_number)} has been sent to the named customer contact. The sent revision is locked until it is returned to Draft.</p>`,async values=>{const result=await client.rpc('advance_sales_proforma',{p_id:record.id,p_expected_version:record.version,p_action:action,p_reference:values.reference||''});if(result.error)throw result.error;await salesDeliveryWorkspace(true);message(label+' saved.')})}
function openDeliveryAction(note,action){const content=action==='tax_invoice'?'<p class="notice">Creating the Tax Invoice reserves all accepted quantities from available Haadi stock immediately. If any item is short, nothing is saved.</p><label><span>Tax invoice number or reference</span><input name="proof" required maxlength="120"></label>':action==='dispatch'?'<label><span>Driver / vehicle</span><input name="carrier" required maxlength="200"></label><label><span>Out-for-delivery / tracking reference</span><input name="tracking" required maxlength="200"></label>':action==='deliver'?'<label><span>Customer recipient name</span><input name="recipient" required maxlength="200"></label><label><span>Signed delivery note / proof reference</span><input name="proof" required maxlength="500"></label>':action==='cancel'?'<label><span>Cancellation reason</span><textarea name="proof" required maxlength="500"></textarea></label>':action==='send_to_sales'?'<p>Confirm the tax-invoiced order has been handed to the downstairs sales team for packing.</p>':action==='start_packing'?packingFields(note):'<p>Confirm every listed item and quantity is packed and the selected Haadi stock is still available.</p>';actionForm({tax_invoice:'Record tax invoice',send_to_sales:'Send to downstairs sales',start_packing:'Start packing',ready:'Mark ready for delivery',dispatch:'Mark out for delivery',deliver:'Record signed delivery note',cancel:'Cancel delivery'}[action],content,async values=>{let result;if(action==='tax_invoice')result=await client.rpc('create_tax_invoice_and_reserve_stock',{p_id:note.id,p_expected_version:note.version,p_tax_invoice_reference:values.proof});else if(action==='start_packing'&&deliveryLines(note.id).length)result=await client.rpc('start_reserved_sales_delivery_packing',{p_id:note.id,p_expected_version:note.version});else if(action==='start_packing'){const record=salesProforma(note.proforma_id),lines=salesLines(record.id).filter(line=>values[`include_${line.id}`]==='on').map(line=>({proformaLineId:line.id,lotId:values[`lot_${line.id}`]||'',quantity:Number(values[`qty_${line.id}`])}));if(!lines.length)throw Error('Choose at least one item to pack.');if(lines.some(line=>!line.lotId||!Number.isSafeInteger(line.quantity)||line.quantity<1))throw Error('Choose a Haadi lot and whole quantity for every selected item.');result=await client.rpc('start_sales_delivery_packing',{p_id:note.id,p_expected_version:note.version,p_lines:lines})}else result=await client.rpc('advance_sales_delivery',{p_id:note.id,p_expected_version:note.version,p_action:action,p_carrier:values.carrier||'',p_tracking_reference:values.tracking||'',p_recipient_name:values.recipient||'',p_proof_reference:values.proof||''});if(result.error)throw result.error;if(['tax_invoice','start_packing','cancel','dispatch'].includes(action))await loadInventoryOperations();await salesDeliveryWorkspace(true);message('Order status saved: '+salesStatus(Array.isArray(result.data)?result.data[0]?.status:result.data?.status)+'.')})}
function printSalesDocument(id){const card=document.querySelector(`[data-document-card="${CSS.escape(id)}"]`);if(!card)return;card.classList.add('print-document');try{window.print()}finally{card.classList.remove('print-document')}}
function bindSalesDelivery(){
 document.querySelectorAll('[data-load-order-timing]').forEach(button=>button.onclick=()=>loadOrderTiming(button.closest('[data-order-timing]')));
 if(typeof openDocumentAttachments==='function')document.querySelectorAll('[data-document-card]').forEach(card=>{
  const id=card.dataset.documentCard,proforma=salesProforma(id),note=salesDeliveryNotes.find(row=>row.id===id),actions=card.querySelector('.actions');
  if(!actions||(!proforma&&!note)||actions.querySelector('[data-document-files]'))return;
  const button=document.createElement('button');button.type='button';button.dataset.documentFiles=id;button.textContent='Upload / view documents';
  button.onclick=()=>run(()=>openDocumentAttachments(proforma?'proforma':'delivery',id,proforma?.document_number||note.delivery_number));actions.append(button);
 });
 document.querySelectorAll('[data-sales-section]').forEach(button=>button.onclick=()=>{salesSection=button.dataset.salesSection;salesEditing='';salesFocusedProforma='';salesDeliveryWorkspace()});
 document.querySelectorAll('[data-open-proforma]').forEach(button=>button.onclick=()=>{salesFocusedProforma=button.dataset.openProforma;salesDeliveryWorkspace();window.scrollTo?.(0,0)});
 document.querySelectorAll('[data-proforma-back]').forEach(button=>button.onclick=()=>{salesFocusedProforma='';salesDeliveryWorkspace()});
 document.querySelectorAll('[data-proforma-filter]').forEach(button=>button.onclick=()=>{salesProformaFilter=button.dataset.proformaFilter;salesDeliveryWorkspace()});
 const proformaSearch=$('#proformaSearch');if(proformaSearch)proformaSearch.oninput=event=>{salesProformaSearch=event.target.value;renderSearchPreservingPosition(event.target,()=>{$('#content').innerHTML=proformaScreen();bindSalesDelivery()},150)};
 $('#salesRefresh')?.addEventListener('click',()=>run(()=>salesDeliveryWorkspace(true)));
 $('#newProforma')?.addEventListener('click',()=>{salesPrefill=null;salesEditing='new';salesDeliveryWorkspace()});
 $('#closeSalesEditor')?.addEventListener('click',()=>{salesPrefill=null;salesEditing='';salesDeliveryWorkspace()});
 $('#closeDeliveryEditor')?.addEventListener('click',()=>{salesEditing='';salesDeliveryWorkspace()});
 $('#addSalesLine')?.addEventListener('click',()=>$('#proformaLines').insertAdjacentHTML('beforeend',salesLineRow()));
 $('#proformaForm')?.addEventListener('change',event=>{if(event.target.name==='organizationId'){const select=$('#proformaForm [name="contactId"]');select.innerHTML='<option value="">Choose named contact</option>'+salesContactOptions(event.target.value);proformaShowExisting()}});proformaShowExisting();
 $('#proformaForm')?.addEventListener('submit',event=>{event.preventDefault();run(()=>saveProformaForm(event.currentTarget))});
 $('#deliveryForm')?.addEventListener('submit',event=>{event.preventDefault();run(()=>createDeliveryForm(event.currentTarget))});
 $('#proformaLines')?.addEventListener('click',event=>{const button=event.target.closest('[data-remove-sales-line]');if(!button)return;if(document.querySelectorAll('[data-proforma-line]').length>1)button.closest('[data-proforma-line]').remove();else message('A Pro forma needs at least one item.',true)});
 document.querySelectorAll('[data-edit-proforma]').forEach(button=>button.onclick=()=>{salesEditing=button.dataset.editProforma;salesDeliveryWorkspace()});
 document.querySelectorAll('[data-create-delivery]').forEach(button=>button.onclick=()=>{salesSection='delivery';salesEditing=button.dataset.createDelivery;salesDeliveryWorkspace()});
 document.querySelectorAll('[data-proforma-action]').forEach(button=>button.onclick=()=>openProformaAction(salesProforma(button.dataset.id),button.dataset.proformaAction));
 document.querySelectorAll('[data-delivery-action]').forEach(button=>button.onclick=()=>openDeliveryAction(salesDeliveryNotes.find(row=>row.id===button.dataset.id),button.dataset.deliveryAction));
 document.querySelectorAll('[data-print-document]').forEach(button=>button.onclick=()=>printSalesDocument(button.dataset.printDocument));
 document.querySelectorAll('[data-send-tally]').forEach(button=>button.onclick=()=>run(()=>openSendToTally(button.dataset.sendTally)));
 if(typeof decorateWorkHandoffs==='function')decorateWorkHandoffs().catch(()=>{});
}
