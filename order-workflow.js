'use strict';

function orderWorkflowHtml(record){
 const notes=rowsWhere(salesDeliveryNotes,'proforma_id',record.id),active=notes.filter(note=>note.status!=='cancelled');
 const fulfillment=salesFulfillment(record),summary=record.status!=='accepted'?salesStatus(record.status):fulfillment==='complete'?'All quantities delivered':fulfillment==='partial'?'Part delivered · balance outstanding':'Delivery outstanding';
 return `<section class="card no-print" data-order-workflow="${esc(record.id)}" aria-label="Whole order workflow"><div class="heading"><div><h2>Whole order · ${esc(record.document_number)}</h2><p>${esc(summary)}</p></div><button type="button" data-order-refresh>Refresh order</button></div><p>Create and send the Pro forma → record customer acceptance → Accounts chooses invoice quantities → reserve those units → pack → dispatch → signed delivery → machine installation.</p><p>Use <strong>Assign to me</strong> on the record below to take responsibility for the current step. Packing and engineering assignment are recorded in their own steps.</p><div class="details"><div><small>Pro forma</small>${esc(salesStatus(record.status))} · revision ${esc(record.revision)}</div><div><small>Prepared by</small>${esc(employeeName(record.prepared_by))}</div><div><small>Deliveries</small>${active.length} active / completed · ${notes.length-active.length} cancelled</div></div><h3>ERP invoice</h3><div data-order-invoices role="status">Checking accounting access…</div><h3>Packing and shipping</h3>${notes.length?notes.map(note=>`<div class="recycle-record"><span><strong>${esc(note.delivery_number)}</strong><small>${esc(salesStatus(note.status))}${note.packer_user_id?' · Packer: '+esc(employeeName(note.packer_user_id)):''}${note.tracking_reference?' · Tracking: '+esc(note.tracking_reference):''}</small></span>${typeof hasArea==='function'&&hasArea('deliveries')?`<button type="button" data-order-delivery="${esc(note.id)}">Open delivery</button>`:'<span>Delivery access required</span>'}</div>`).join(''):'<p>No delivery note yet. After customer acceptance, review invoice quantities in Books. Posting creates the delivery and reserves the selected units.</p>'}<h3>Service engineering</h3><p>Signing a machine delivery creates one installation case for each machine unit. The engineer can then be assigned and the installation tracked here.</p><div data-order-service role="status">Loading linked engineering cases…</div></section>`;
}

function orderQuantityHtml(order){
 const deliveredNotes=new Set(rowsWhere(salesDeliveryNotes,'proforma_id',order.proforma_id).filter(note=>note.status==='delivered').map(note=>note.id));
 return `<h3>Order quantities</h3><div class="table-wrap"><table><thead><tr><th>Item</th><th>Ordered</th><th>Invoiced</th><th>Delivered</th><th>Pending invoice</th></tr></thead><tbody>${(order.lines||[]).map(line=>{
  const delivered=salesDeliveryLines.filter(row=>row.proforma_line_id===line.proforma_line_id&&deliveredNotes.has(row.delivery_note_id)).reduce((sum,row)=>sum+Number(row.quantity),0);
  return `<tr><td>${esc(line.description)}${line.uom?' · '+esc(line.uom):''}</td><td>${esc(line.ordered_quantity)}</td><td>${esc(line.invoiced_quantity)}</td><td>${delivered}</td><td>${esc(line.remaining_quantity)}</td></tr>`;
 }).join('')}</tbody></table></div><p class="muted">Pending quantities stay on this accepted order. Each invoice reserves only its selected units. An order is complete only after all quantities have signed delivery proof.</p>`;
}

async function orderWorkflowRows(table,columns,column,ids,current){
 const rows=[];
 for(let i=0;i<ids.length;i+=100){
  for(let offset=0;;offset+=500){
   const result=await client.from(table).select(columns).in(column,ids.slice(i,i+100)).order('id').range(offset,offset+499);
   if(!current())return [];
   if(result.error)throw Error(result.error.message||'Linked records could not load.');
   rows.push(...(result.data||[]));
   if((result.data||[]).length<500)break;
  }
 }
 return rows;
}

async function loadOrderWorkflow(panel){
 const actor=me,epoch=salesEpoch,id=panel.dataset.orderWorkflow,current=()=>me===actor&&salesEpoch===epoch&&view==='sales'&&panel.isConnected&&salesFocusedProforma===id;
 if(!current())return;
 const invoices=panel.querySelector('[data-order-invoices]'),service=panel.querySelector('[data-order-service]');
 const loadInvoices=async()=>{
  try{
   const permission=await client.rpc('accounting_access');
   if(!current())return;
   if(permission.error)throw Error('Accounting access could not be checked. Refresh to retry.');
   if(permission.data!==true){invoices.textContent='Invoice details are available to approved accounting users in Books. The delivery shows its tax invoice reference.';return;}
   const rows=await orderWorkflowRows('acc_invoices','id,invoice_number,total_minor,currency,voided_at','proforma_id',[id],current);
   if(!current())return;
   const accepted=salesProformas.find(record=>record.id===id)?.status==='accepted';
   let quantities=null;
   if(accepted){
    const result=await client.rpc('order_invoice_quantities',{p_proforma_id:id});
    if(!current())return;
    if(result.error)throw Error(result.error.message||'Order quantities could not load.');
    quantities=result.data;
   }
   invoices.innerHTML=(rows.length?rows.map(row=>`<p><strong>${esc(row.invoice_number)}</strong> · ${esc(moneyDisplay(Number(row.total_minor),row.currency))}${row.voided_at?' · Voided':''}</p>`).join(''):'<p>No ERP invoice is linked yet. Accounts chooses the quantities to invoice after customer acceptance.</p>')+(quantities?orderQuantityHtml(quantities):'')+`<button type="button" data-order-books>${accepted?'Review quantities / open invoices':'Open customer invoices in Books'}</button>`;
   invoices.querySelector('[data-order-books]')?.addEventListener('click',()=>run(async()=>{await requireAccountingAccess(client,()=>me);if(!current())return;openBooksSection('invoices');booksDraft={proformaId:id};view='books';await render();}));
  }catch(error){if(current())invoices.textContent='Invoice lookup unavailable: '+error.message;}
 };
 const loadService=async()=>{
  try{
   if(typeof hasArea!=='function'||!hasArea('service')){service.textContent='Engineering case details require Service jobs access. Ask the assigned engineer to review the Installation queue.';return;}
   const noteIds=rowsWhere(salesDeliveryNotes,'proforma_id',id).filter(note=>note.status==='delivered').map(note=>note.id);
   if(!noteIds.length){service.textContent='Waiting for signed machine delivery.';return;}
   const rows=await orderWorkflowRows('service_cases','id,case_number,status,assigned_user_id,scheduled_for,source_delivery_note_id','source_delivery_note_id',noteIds,current);
   if(!current())return;
   service.innerHTML=rows.length?rows.map(row=>`<div class="recycle-record"><span><strong>${esc(row.case_number)}</strong><small>${esc(String(row.status||'').replaceAll('_',' '))} · ${row.assigned_user_id?esc(employeeName(row.assigned_user_id)):'Engineer not assigned'}${row.scheduled_for?' · '+esc(row.scheduled_for):''}</small></span><button type="button" data-order-service-case="${esc(row.id)}">Open engineering case</button></div>`).join(''):'<p>No engineering cases are linked to these deliveries. Automatic cases apply to products classified as Machine at delivery.</p>';
   service.querySelectorAll('[data-order-service-case]').forEach(button=>button.onclick=()=>run(()=>{if(current())return focusServiceCase(button.dataset.orderServiceCase);}));
  }catch(error){if(current())service.textContent='Engineering lookup unavailable: '+error.message;}
 };
 await Promise.all([loadInvoices(),loadService()]);
}

function bindOrderWorkflow(){
 document.querySelectorAll('[data-order-workflow]').forEach(panel=>{
  panel.querySelector('[data-order-refresh]').onclick=()=>run(()=>salesDeliveryWorkspace(true));
  panel.querySelectorAll('[data-order-delivery]').forEach(button=>button.onclick=()=>{salesFocusedDelivery=button.dataset.orderDelivery;salesSection='delivery';salesEditing='';salesDeliveryWorkspace();});
  loadOrderWorkflow(panel);
 });
 document.querySelectorAll('[data-order-proforma]').forEach(button=>button.onclick=()=>{salesFocusedProforma=button.dataset.orderProforma;salesFocusedDelivery='';salesSection='proformas';salesEditing='';salesDeliveryWorkspace();});
}
