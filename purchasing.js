'use strict';
// Suppliers and purchase orders: request → owner approval → ordered (LPO) → closed, or cancelled.
// Writes go through save_supplier / save_purchase_request / advance_purchase_order only. No stock changes here.
let purchaseSection='orders',purchaseFilter='requested',purchaseSearch='',purchasePage=0,purchaseLoaded=false,purchaseLoadError='',purchaseEpoch=0;
let purchaseOrders=[],purchaseLines=[],suppliers=[],purchaseEditing='',supplierEditing='',purchasePrefill=null,purchasePendingSave=null,supplierPendingSave=null;
const purchaseStatuses={requested:'Needs owner approval',approved:'Approved · order now',ordered:'Ordered · waiting for goods',closed:'Goods arrived',cancelled:'Cancelled'};
// Filter tabs use the same words as the status tags, so a request reads the same everywhere.
const purchaseFilters=[['requested','Needs owner approval'],['approved','Approved · order now'],['ordered','Ordered · waiting for goods'],['finished','Arrived or cancelled'],['all','All']];
const purchaseRecentDays=183;
// The order and item fields this page reads (approval, ordering and closing times are not shown).
const purchaseColumns='id,po_number,status,supplier_id,currency,expected_on,lpo_reference,notes,requested_by,approved_by,close_note,version,created_at,updated_at,purchase_order_lines(id,purchase_order_id,line_number,product_id,quantity,unit_price_minor,pending_request_id,note)';
let purchaseSearchTimer=0;
// Older orders are looked up on the server by PO or LPO number while typing in Search.
async function purchaseSearchOlder(text){
 const term=String(text||'').replace(/[^\p{L}\p{N}.\-\/ ]/gu,' ').trim();if(term.length<3)return;
 const epoch=purchaseEpoch,actor=me?.user_id,like=`*${term}*`;
 const result=await client.from('purchase_orders').select(purchaseColumns).or(`po_number.ilike.${like},lpo_reference.ilike.${like}`).order('created_at',{ascending:false}).limit(50);
 if(result.error||epoch!==purchaseEpoch||me?.user_id!==actor||view!=='purchasing'||purchaseSearch!==text)return;
 const known=new Set(purchaseOrders.map(o=>o.id)),extra=(result.data||[]).filter(r=>!known.has(r.id));
 if(!extra.length)return;
 purchaseOrders=purchaseOrders.concat(extra.map(({purchase_order_lines:items,...order})=>order));purchaseLines=purchaseLines.concat(extra.flatMap(r=>r.purchase_order_lines||[]));
 const box=$('#purchaseSearch');if(box)renderSearchPreservingPosition(box,renderPurchasing);else renderPurchasing();
}
function clearPurchasing(){purchaseEpoch++;purchaseLoaded=false;purchaseOrders=[];purchaseLines=[];suppliers=[];purchaseEditing='';supplierEditing='';purchasePrefill=null;purchasePendingSave=null;supplierPendingSave=null;}
function openPurchaseSection(section){purchaseSection=section||'orders';purchasePage=0;purchaseEditing='';supplierEditing='';}
function purchaseToday(){return new Date().toISOString().slice(0,10);}
function purchaseOverdue(order,today=purchaseToday()){return order.status==='ordered'&&!!order.expected_on&&order.expected_on<today;}
function purchaseSupplier(id){return suppliers.find(s=>s.id===id);}
function purchaseProductName(id){const product=typeof inventoryProduct==='function'?inventoryProduct(id):products.find(p=>p.id===id);return product?.name||'Unknown product';}
function purchaseMoney(minor,currency){return minor==null?'':new Intl.NumberFormat('en-TZ',{style:'currency',currency:currency||'TZS'}).format(Number(minor)/100);}
function purchaseOrderLines(orderId){return [...rowsWhere(purchaseLines,'purchase_order_id',orderId)].sort((a,b)=>a.line_number-b.line_number);}
function purchaseVisibleOrders(orders,{filter,search,today=purchaseToday()}){
 const q=String(search||'').trim().toLowerCase();
 return orders.filter(order=>filter==='all'||(filter==='finished'?['closed','cancelled'].includes(order.status):order.status===filter))
  .filter(order=>!q||[order.po_number,order.lpo_reference,order.notes,purchaseSupplier(order.supplier_id)?.name,...purchaseOrderLines(order.id).map(line=>purchaseProductName(line.product_id))].join(' ').toLowerCase().includes(q))
  .sort((a,b)=>Number(purchaseOverdue(b,today))-Number(purchaseOverdue(a,today))||String(a.expected_on||'9999').localeCompare(String(b.expected_on||'9999'))||String(b.created_at).localeCompare(String(a.created_at))||a.id.localeCompare(b.id));
}
function purchaseOrderTotal(order){const lines=purchaseOrderLines(order.id);return lines.length&&lines.every(line=>line.unit_price_minor!=null)?lines.reduce((sum,line)=>sum+Number(line.unit_price_minor)*line.quantity,0):null;}
function purchaseActions(order){
 const owner=me?.role==='owner',mine=order.requested_by===me?.user_id,buttons=[];
 if(order.status==='requested'&&(owner||mine))buttons.push(`<button type="button" data-purchase-edit="${esc(order.id)}">Edit</button>`);
 if(order.status==='requested'&&owner)buttons.push(`<button type="button" data-purchase-action="approve" data-id="${esc(order.id)}">Approve purchase</button>`);
 if(order.status==='approved')buttons.push(`<button type="button" data-purchase-action="order" data-id="${esc(order.id)}">Place order with supplier</button>`);
 if(order.status==='ordered')buttons.push(`<button type="button" data-purchase-action="close" data-id="${esc(order.id)}">Goods arrived — close</button>`);
 if(!['closed','cancelled'].includes(order.status)&&(owner||(order.status==='requested'&&mine)))buttons.push(`<button type="button" data-purchase-action="cancel" data-id="${esc(order.id)}">Cancel</button>`);
 buttons.push(`<button type="button" data-purchase-history="${esc(order.id)}">History</button>`);
 return buttons.join('');
}
function purchaseCard(order){
 const supplier=purchaseSupplier(order.supplier_id),lines=purchaseOrderLines(order.id),overdue=purchaseOverdue(order);
 return `<article class="card purchase-card${overdue?' attention':''}" data-purchase-card="${esc(order.id)}"><div class="heading"><div><small>${esc(order.po_number)}${order.lpo_reference?` · LPO ${esc(order.lpo_reference)}`:''}</small><h2>${esc(supplier?.name||'Supplier not chosen yet')}</h2></div><span class="tag purchase-tag-${esc(order.status)}">${esc(purchaseStatuses[order.status]||order.status)}</span></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th>For</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${esc(purchaseProductName(line.product_id))}${line.note?`<small>${esc(line.note)}</small>`:''}</td><td>${esc(line.quantity)}</td><td>${line.pending_request_id?esc((typeof pendingRows!=='undefined'?pendingRows:[]).find(p=>p.id===line.pending_request_id)?.request_number||'Pending order'):'Stock'}</td></tr>`).join('')}</tbody></table></div><div class="details"><div><small>Requested by</small>${esc(employeeName(order.requested_by))}</div><div><small>Approved by</small>${esc(order.approved_by?employeeName(order.approved_by):'Not yet')}</div><div><small>Expected arrival</small>${order.expected_on?`<strong${overdue?' class="overdue"':''}>${overdue?'Overdue ':''}${esc(order.expected_on)}</strong>`:'Not set'}</div>${order.close_note?`<div><small>${order.status==='cancelled'?'Cancelled because':'Receipt reference'}</small>${esc(order.close_note)}</div>`:''}</div>${order.notes?`<p class="muted">${esc(order.notes)}</p>`:''}<div class="actions">${purchaseActions(order)}</div><div data-purchase-history-output="${esc(order.id)}"></div></article>`;
}
function purchaseSupplierOptions(selected=''){return suppliers.filter(s=>s.active||s.id===selected).sort((a,b)=>a.name.localeCompare(b.name)).map(s=>inventoryOption(s.id,`${s.name}${s.active?'':' (inactive)'}`,s.id===selected)).join('');}
function purchaseLineRow(line={}){
 const product=line.product_id?products.find(p=>p.id===line.product_id):null,choice=product&&typeof inventoryProductChoice==='function'?inventoryProductChoice(typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(product):product):'';
 // Prices are no longer asked for; a price saved before is carried through unchanged.
 return `<tr data-purchase-line data-pending="${esc(line.pending_request_id||'')}" data-price="${line.unit_price_minor==null?'':esc(line.unit_price_minor)}"><td><input name="productChoice" list="purchaseProductChoices" required autocomplete="off" value="${esc(choice)}" placeholder="Start typing the product" aria-label="Item"></td><td><input name="quantity" type="number" min="1" max="1000000" step="1" required value="${esc(line.quantity||'')}" aria-label="Quantity"></td><td><input name="note" maxlength="500" value="${esc(line.note||'')}" placeholder="Optional" aria-label="Note"></td><td><button type="button" data-remove-purchase-line aria-label="Remove item">Remove</button></td></tr>`;
}
function purchaseEditor(order){
 const lines=order?purchaseOrderLines(order.id):(purchasePrefill?.lines||[{}]);
 return `<section class="card document-editor"><div class="heading"><div><small>${order?esc(order.po_number):'NEW'}</small><h2>${order?'Edit purchase request':'New purchase request'}</h2></div><button type="button" id="closePurchaseEditor">Close</button></div><form id="purchaseForm" data-id="${esc(order?.id||'')}" data-version="${order?.version||0}"><input type="hidden" name="currency" value="${esc(order?.currency||'TZS')}"><label class="purchase-supplier"><span>1. Supplier</span><select name="supplierId" required><option value="">Choose the supplier, for example Polymed</option>${purchaseSupplierOptions(order?.supplier_id||'')}</select></label><h3>2. Items we need from them</h3><datalist id="purchaseProductChoices" data-lookup-values="products">${salesProductChoices()}</datalist><div class="table-wrap"><table class="purchase-lines"><thead><tr><th>Item</th><th>Quantity</th><th>Note</th><th></th></tr></thead><tbody id="purchaseLines">${lines.map(purchaseLineRow).join('')}</tbody></table></div><div class="actions"><button type="button" id="addPurchaseLine">Add item</button></div><details class="purchase-more"${order?.expected_on||order?.notes||purchasePrefill?.notes?' open':''}><summary>Needed by date or a note (optional)</summary><div class="grid"><label><span>Needed by</span><input name="expectedOn" type="date" value="${esc(order?.expected_on||'')}"></label><label class="wide"><span>Note for the owner</span><textarea name="notes" maxlength="4000">${esc(order?.notes||purchasePrefill?.notes||'')}</textarea></label></div></details><p role="alert" id="purchaseFormError"></p><div class="actions"><button type="submit">${order?'Save changes':'Send for approval'}</button></div></form></section>`;
}
function purchaseFormValues(form){
 const f=new FormData(form),lines=[...form.querySelectorAll('[data-purchase-line]')].map((row,index)=>{
  const choice=row.querySelector('[name="productChoice"]').value,product=inventoryProductFromChoice(choice),quantity=Number(row.querySelector('[name="quantity"]').value);
  if(!product)throw Error(`Item ${index+1}: choose a product from the list.`);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)throw Error(`Item ${index+1}: enter a whole quantity of at least 1.`);
  const unit_price_minor=row.dataset.price===''||row.dataset.price===undefined?null:Number(row.dataset.price);
  return {product_id:product.id,quantity,unit_price_minor,pending_request_id:row.dataset.pending||null,note:row.querySelector('[name="note"]').value.trim()};
 });
 if(!lines.length)throw Error('Add at least one item.');
 if(!f.get('supplierId'))throw Error('Choose the supplier.');
 return {supplierId:f.get('supplierId')||null,currency:f.get('currency')||'TZS',expectedOn:f.get('expectedOn')||null,notes:String(f.get('notes')||''),lines};
}
async function savePurchaseForm(form){
 const values=purchaseFormValues(form),id=form.dataset.id||'',version=Number(form.dataset.version||0),key=JSON.stringify(values);
 // One request ID per unchanged form until the server confirms it, so a retry cannot create a duplicate order.
 if(!id&&purchasePendingSave?.key!==key)purchasePendingSave={key,id:crypto.randomUUID()};
 const requestId=id||purchasePendingSave.id,actor=me?.user_id;
 const result=await client.rpc('save_purchase_request',{p_id:requestId,p_expected_version:version,p_supplier_id:values.supplierId,p_currency:values.currency,p_expected_on:values.expectedOn,p_notes:values.notes,p_lines:values.lines});
 if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
 if(result.error)throw Error(result.error.message);
 const saved=Array.isArray(result.data)?result.data[0]:result.data;
 if(saved?.id!==requestId)throw Error('The server did not confirm the save. Press save again to retry safely.');
 purchasePendingSave=null;purchasePrefill=null;purchaseEditing='';await purchaseRefreshOne(saved.id);message(`${saved.po_number} ${id?'updated':'sent for approval'}.`);
}
function supplierEditor(row){
 return `<section class="card document-editor"><div class="heading"><div><small>${row?esc(row.supplier_number):'NEW'}</small><h2>${row?'Edit supplier':'New supplier'}</h2></div><button type="button" id="closeSupplierEditor">Close</button></div><form id="supplierForm" data-id="${esc(row?.id||'')}" data-version="${row?.version||0}"><div class="grid"><label class="wide"><span>Supplier name</span><input name="name" required minlength="2" maxlength="200" value="${esc(row?.name||'')}"></label><label><span>Country</span><input name="country" maxlength="100" value="${esc(row?.country||'')}"></label><label><span>Contact person</span><input name="contact_name" maxlength="200" value="${esc(row?.contact_name||'')}"></label><label><span>Phone</span><input name="phone" maxlength="60" inputmode="tel" value="${esc(row?.phone||'')}"></label><label><span>Email</span><input name="email" type="email" maxlength="320" value="${esc(row?.email||'')}"></label><label><span>TIN</span><input name="tin" maxlength="60" value="${esc(row?.tin||'')}"></label><label><span>Payment terms</span><input name="payment_terms" maxlength="300" value="${esc(row?.payment_terms||'')}"></label><label class="wide"><span>Notes</span><textarea name="notes" maxlength="4000">${esc(row?.notes||'')}</textarea></label>${row&&me?.role==='owner'?`<label><span>Status</span><select name="active"><option value="true" ${row.active?'selected':''}>Active</option><option value="false" ${row.active?'':'selected'}>Inactive — hide from new orders</option></select></label>`:''}</div><p role="alert" id="supplierFormError"></p><div class="actions"><button type="submit">${row?'Save changes':'Save supplier'}</button></div></form></section>`;
}
async function saveSupplierForm(form){
 const f=new FormData(form),id=form.dataset.id||'',version=Number(form.dataset.version||0),existing=suppliers.find(s=>s.id===id);
 const fields={name:String(f.get('name')||'').trim(),country:f.get('country')||'',contact_name:f.get('contact_name')||'',phone:f.get('phone')||'',email:String(f.get('email')||'').trim(),tin:f.get('tin')||'',payment_terms:f.get('payment_terms')||'',notes:f.get('notes')||'',active:f.has('active')?f.get('active')==='true':(existing?.active??true)};
 if(fields.name.length<2)throw Error('Enter the supplier name.');
 if(!id&&supplierPendingSave?.name!==fields.name)supplierPendingSave={name:fields.name,id:crypto.randomUUID()};
 const requestId=id||supplierPendingSave.id,actor=me?.user_id,result=await client.rpc('save_supplier',{p_id:requestId,p_expected_version:version,p_fields:fields});
 if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
 if(result.error)throw Error(result.error.message);
 const saved=Array.isArray(result.data)?result.data[0]:result.data;
 if(saved?.id!==requestId)throw Error('The server did not confirm the save. Press save again to retry safely.');
 supplierPendingSave=null;supplierEditing='';await purchasingWorkspace(true);message(`${saved.name} saved.`);
}
// After a save or a step, only that order is read again, so the page stays quick however many orders are listed.
async function purchaseRefreshOne(id){
 if(!purchaseLoaded||!id)return purchasingWorkspace(true);
 const epoch=purchaseEpoch,actor=me?.user_id;
 const result=await client.from('purchase_orders').select(purchaseColumns).eq('id',id).maybeSingle();
 if(result.error)throw Error(result.error.message);
 if(epoch!==purchaseEpoch||me?.user_id!==actor)return;
 purchaseOrders=purchaseOrders.filter(o=>o.id!==id);purchaseLines=purchaseLines.filter(l=>l.purchase_order_id!==id);
 if(result.data){const {purchase_order_lines:items,...order}=result.data;purchaseOrders.push(order);purchaseLines.push(...(items||[]));}
 if(view==='purchasing')renderPurchasing();
}
async function loadPurchasing(){
 const epoch=++purchaseEpoch,actor=me?.user_id;
 // Every open order is loaded; arrived and cancelled ones only from the last six months, with their items in the
 // same request (items are nested per order, so the 1,000-row page limit applies to orders only).
 const since=new Date(Date.now()-purchaseRecentDays*864e5).toISOString();
 const [rows,supplierRows]=await Promise.all([all('purchase_orders',purchaseColumns,q=>q.or(`status.in.(requested,approved,ordered),updated_at.gte.${since}`)),all('suppliers','*')]);
 const orders=rows.map(({purchase_order_lines:items,...order})=>order),lines=rows.flatMap(row=>row.purchase_order_lines||[]);
 if(epoch!==purchaseEpoch||me?.user_id!==actor)return false;
 purchaseOrders=orders;purchaseLines=lines;suppliers=supplierRows;purchaseLoaded=true;purchaseLoadError='';return true;
}
async function purchasingWorkspace(force=false){
 const actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!purchaseLoaded){
  $('#content').innerHTML='<p role="status">Loading purchasing…</p>';
  try{if(!(await loadPurchasing()))return;}catch(error){if(me?.user_id!==actor)return;purchaseLoadError=error.message;purchaseLoaded=false;}
 }
 if(view!=='purchasing'||me?.user_id!==actor)return;
 renderPurchasing();
}
function renderPurchasing(){
 const ordersSection=purchaseSection==='orders';
 const rows=ordersSection?purchaseVisibleOrders(purchaseOrders,{filter:purchaseFilter,search:purchaseSearch}):suppliers.filter(s=>{const q=purchaseSearch.trim().toLowerCase();return !q||[s.supplier_number,s.name,s.country,s.contact_name,s.phone,s.email,s.tin].join(' ').toLowerCase().includes(q);}).sort((a,b)=>Number(b.active)-Number(a.active)||a.name.localeCompare(b.name));
 const pages=Math.max(1,Math.ceil(rows.length/20));purchasePage=Math.min(Math.max(purchasePage,0),pages-1);
 const counts={requested:purchaseOrders.filter(o=>o.status==='requested').length,approved:purchaseOrders.filter(o=>o.status==='approved').length,ordered:purchaseOrders.filter(o=>o.status==='ordered').length,overdue:purchaseOrders.filter(o=>purchaseOverdue(o)).length};
 const editingOrder=purchaseEditing&&purchaseEditing!=='new'?purchaseOrders.find(o=>o.id===purchaseEditing):null,editingSupplier=supplierEditing&&supplierEditing!=='new'?suppliers.find(s=>s.id===supplierEditing):null;
 $('#content').innerHTML=`<section class="purchasing-workspace"><div class="heading"><div><small>ORDERS</small><h1>${ordersSection?'Purchasing':'Suppliers'}</h1><p class="muted">${ordersSection?'Choose the supplier and list the items. The owner approves, then the order is placed.':'Everyone we buy from. The same supplier cannot be entered twice.'}</p></div><div class="actions"><button type="button" id="purchaseRefresh">Refresh</button><button type="button" id="${ordersSection?'newPurchase':'newSupplier'}">${ordersSection?'New purchase request':'New supplier'}</button></div></div>${purchaseLoadError?`<p class="notice error" role="alert">Purchasing could not load: ${esc(purchaseLoadError)}. Nothing was changed.</p>`:''}${ordersSection&&purchaseEditing?purchaseEditor(editingOrder):''}${!ordersSection&&supplierEditing?supplierEditor(editingSupplier):''}${ordersSection?`<div class="tabs" role="group" aria-label="Filter purchase orders">${purchaseFilters.map(([key,label])=>`<button type="button" data-purchase-filter="${key}" class="${purchaseFilter===key?'active':''}" aria-pressed="${purchaseFilter===key}">${label}${counts[key]?` · ${counts[key]}`:''}</button>`).join('')}</div>${['finished','all'].includes(purchaseFilter)?'<p class="muted">Showing arrived and cancelled orders from the last 6 months. Search by PO or LPO number finds older ones.</p>':''}`:''}<label class="search"><span>Search</span><input id="purchaseSearch" type="search" placeholder="${ordersSection?'Supplier, product, PO or LPO number':'Name, contact, phone, email or TIN'}" value="${esc(purchaseSearch)}"></label>${rows.slice(purchasePage*20,purchasePage*20+20).map(row=>ordersSection?purchaseCard(row):supplierCard(row)).join('')||`<p class="muted">${ordersSection?'No purchase orders here.':'No suppliers yet. Press New supplier to add one.'}</p>`}${pages>1?`<div class="actions"><button type="button" id="purchasePrev" ${purchasePage===0?'disabled':''}>Previous</button><span>Page ${purchasePage+1} of ${pages}</span><button type="button" id="purchaseNext" ${purchasePage>=pages-1?'disabled':''}>Next</button></div>`:''}</section>`;
 bindPurchasing();
 if(typeof decorateWorkHandoffs==='function')decorateWorkHandoffs().catch(()=>{});
}
function supplierCard(row){return `<article class="card supplier-card" data-supplier-card="${esc(row.id)}"><div class="heading"><div><small>${esc(row.supplier_number)}${row.country?' · '+esc(row.country):''}</small><h2>${esc(row.name)}</h2></div><span class="tag">${row.active?'Active':'Inactive'}</span></div><div class="details"><div><small>Contact</small>${esc(row.contact_name||'—')}</div><div><small>Phone</small>${esc(row.phone||'—')}</div><div><small>Email</small>${esc(row.email||'—')}</div><div><small>TIN</small>${esc(row.tin||'—')}</div><div><small>Payment terms</small>${esc(row.payment_terms||'—')}</div><div><small>Purchase orders</small>${purchaseOrders.filter(o=>o.supplier_id===row.id).length}</div></div><div class="actions"><button type="button" data-supplier-edit="${esc(row.id)}">Edit</button></div></article>`;}
function bindPurchasing(){
 $('#purchaseRefresh').onclick=()=>run(()=>purchasingWorkspace(true));
 $('#newPurchase')?.addEventListener('click',()=>{purchaseEditing='new';purchasePendingSave=null;renderPurchasing();$('#purchaseForm')?.scrollIntoView({block:'start'});});
 $('#newSupplier')?.addEventListener('click',()=>{supplierEditing='new';supplierPendingSave=null;renderPurchasing();$('#supplierForm [name="name"]')?.focus();});
 $('#closePurchaseEditor')?.addEventListener('click',()=>{purchaseEditing='';purchasePrefill=null;purchasePendingSave=null;renderPurchasing();});
 $('#closeSupplierEditor')?.addEventListener('click',()=>{supplierEditing='';supplierPendingSave=null;renderPurchasing();});
 const form=$('#purchaseForm');
 if(form){
  $('#addPurchaseLine').onclick=()=>$('#purchaseLines').insertAdjacentHTML('beforeend',purchaseLineRow());
  $('#purchaseLines').addEventListener('click',event=>{const remove=event.target.closest('[data-remove-purchase-line]');if(!remove)return;if(form.querySelectorAll('[data-purchase-line]').length>1)remove.closest('tr').remove();else $('#purchaseFormError').textContent='A purchase request needs at least one item.';});
  form.onsubmit=event=>{event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;$('#purchaseFormError').textContent='';
   run(async()=>{try{await savePurchaseForm(form)}catch(error){if($('#purchaseFormError'))$('#purchaseFormError').textContent=error.message;throw error;}finally{if(button.isConnected)button.disabled=false;}});};
 }
 const supplierForm=$('#supplierForm');
 if(supplierForm)supplierForm.onsubmit=event=>{event.preventDefault();const button=supplierForm.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;$('#supplierFormError').textContent='';
  run(async()=>{try{await saveSupplierForm(supplierForm)}catch(error){if($('#supplierFormError'))$('#supplierFormError').textContent=error.message;throw error;}finally{if(button.isConnected)button.disabled=false;}});};
 $('#purchaseSearch').oninput=event=>{purchaseSearch=event.target.value;purchasePage=0;renderSearchPreservingPosition(event.target,renderPurchasing,150);clearTimeout(purchaseSearchTimer);const text=purchaseSearch;if(purchaseSection==='orders')purchaseSearchTimer=setTimeout(()=>purchaseSearchOlder(text).catch(()=>{}),400);};
 if($('#purchasePrev'))$('#purchasePrev').onclick=()=>{purchasePage--;renderPurchasing();};if($('#purchaseNext'))$('#purchaseNext').onclick=()=>{purchasePage++;renderPurchasing();};
 document.querySelectorAll('[data-purchase-filter]').forEach(button=>button.onclick=()=>{purchaseFilter=button.dataset.purchaseFilter;purchasePage=0;renderPurchasing();});
 document.querySelectorAll('[data-purchase-edit]').forEach(button=>button.onclick=()=>{purchaseEditing=button.dataset.purchaseEdit;renderPurchasing();$('#purchaseForm')?.scrollIntoView({block:'start'});});
 document.querySelectorAll('[data-supplier-edit]').forEach(button=>button.onclick=()=>{supplierEditing=button.dataset.supplierEdit;renderPurchasing();$('#supplierForm')?.scrollIntoView({block:'start'});});
 document.querySelectorAll('[data-purchase-action]').forEach(button=>button.onclick=()=>openPurchaseAction(purchaseOrders.find(o=>o.id===button.dataset.id),button.dataset.purchaseAction));
 document.querySelectorAll('[data-purchase-history]').forEach(button=>button.onclick=()=>run(()=>showPurchaseHistory(button.dataset.purchaseHistory)));
}
function openPurchaseAction(order,action){
 if(!order)return;
 const titles={approve:'Approve purchase',order:'Place order with supplier',close:'Goods arrived — close purchase order',cancel:'Cancel purchase order'};
 const supplier=purchaseSupplier(order.supplier_id);
 const fields=`<p><strong>${esc(order.po_number)}</strong> · ${esc(supplier?.name||'Supplier not chosen')}</p>${action==='order'?(supplier?`<label><span>LPO number sent to the supplier</span><input name="lpo" required minlength="2" maxlength="120"></label><label><span>Expected arrival · optional</span><input name="expected" type="date" min="${purchaseToday()}" value="${esc(order.expected_on&&order.expected_on>=purchaseToday()?order.expected_on:'')}"></label>`:'<p class="notice">Choose the supplier first: ask the requester or owner to cancel and re-request, or edit before approval.</p>'):''}${action==='approve'?'<p>Approving lets staff place this order with the supplier.</p>':''}<label><span>${action==='close'?'Supplier delivery note or receipt reference':action==='cancel'?'Why is it cancelled?':'Note · optional'}</span><textarea name="note" maxlength="1000" ${['close','cancel'].includes(action)?'required minlength="3"':''}></textarea></label>${action==='close'?'<p class="muted">Closing records that the goods arrived. Enter the received quantities into stock in Inventory.</p>':''}`;
 actionForm(titles[action],fields,async values=>{
  const actor=me?.user_id,result=await client.rpc('advance_purchase_order',{p_id:order.id,p_expected_version:order.version,p_action:action,p_note:values.note||'',p_lpo_reference:values.lpo||'',p_expected_on:values.expected||null});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the purchase order.');
  if(result.error)throw Error(result.error.message);
  await purchaseRefreshOne(order.id);message(`${order.po_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
async function showPurchaseHistory(id){
 const output=document.querySelector(`[data-purchase-history-output="${CSS.escape(id)}"]`),actor=me?.user_id;if(!output)return;
 output.textContent='Loading history…';
 const result=await client.from('purchase_order_events').select('action,from_status,to_status,note,actor_user_id,created_at').eq('purchase_order_id',id).order('created_at').limit(200);
 if(me?.user_id!==actor||!output.isConnected)return;
 if(result.error){output.textContent=`History could not load: ${result.error.message}`;return;}
 output.innerHTML=`<ol class="lead-history">${(result.data||[]).map(event=>`<li>${esc(new Date(event.created_at).toLocaleString())} · <strong>${esc(employeeName(event.actor_user_id))}</strong> · ${esc(event.action)}${event.from_status&&event.from_status!==event.to_status?` · ${esc(purchaseStatuses[event.from_status]||event.from_status)} → ${esc(purchaseStatuses[event.to_status]||event.to_status)}`:''}${event.note?` · ${esc(event.note)}`:''}</li>`).join('')}</ol>`;
}
// Called from a pending stock order: opens a new purchase request with that product and quantity.
function startPurchaseFromPending(row){
 if(!row)return;
 purchasePrefill={lines:[{product_id:row.product_id,quantity:row.quantity,pending_request_id:row.id,note:`For ${row.request_number}`}],notes:`Customer pending order ${row.request_number}`};
 view='purchasing';openPurchaseSection('orders');purchaseEditing='new';purchasePendingSave=null;render();
}
