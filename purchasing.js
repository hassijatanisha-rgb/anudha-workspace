'use strict';
// Suppliers and purchase orders: request → owner approval → ordered (LPO) → closed, or cancelled.
// Writes go through save_supplier / save_purchase_request / advance_purchase_order only. No stock changes here.
let purchaseSection='orders',purchaseFilter='requested',purchaseSearch='',purchasePage=0,purchaseLoaded=false,purchaseLoadError='',purchaseEpoch=0;
let purchaseOrders=[],purchaseLines=[],suppliers=[],purchaseEditing='',supplierEditing='',purchasePrefill=null,purchasePendingSave=null,supplierPendingSave=null;
let purchaseFocusedOrder='',purchaseFocusedSupplier='',purchasePageData=null,purchasePageKey='',purchasePageActor=null,purchaseLoadedActor=null,purchaseWorkspaceRequest=0,purchaseLoadRequest=0;
function purchasingLanding(){return !purchaseFocusedOrder&&!purchaseFocusedSupplier&&!purchaseEditing&&!supplierEditing;}
const purchaseStatuses={requested:'Needs owner approval',approved:'Approved · order now',ordered:'Ordered · waiting for goods',closed:'Goods arrived',cancelled:'Cancelled'};
// Filter tabs use the same words as the status tags, so a request reads the same everywhere.
const purchaseFilters=[['requested','Needs owner approval'],['approved','Approved · order now'],['ordered','Ordered · waiting for goods'],['finished','Arrived or cancelled'],['all','All']];
const purchaseRecentDays=183;
// The order and item fields this page reads (approval, ordering and closing times are not shown).
const purchaseColumns='id,po_number,status,supplier_id,currency,expected_on,lpo_reference,notes,requested_by,approved_by,close_note,version,created_at,updated_at,purchase_order_lines(id,purchase_order_id,line_number,product_id,quantity,unit_price_minor,pending_request_id,note)';
let purchaseSearchTimer=0;
function clearPurchasing(){purchaseEpoch++;purchaseWorkspaceRequest++;purchaseLoadRequest++;clearTimeout(purchaseSearchTimer);purchaseLoaded=false;purchaseLoadedActor=null;purchaseOrders=[];purchaseLines=[];suppliers=[];purchaseEditing='';supplierEditing='';purchaseFocusedOrder='';purchaseFocusedSupplier='';purchasePageData=null;purchasePageKey='';purchasePageActor=null;purchaseSearch='';purchasePage=0;purchasePrefill=null;purchasePendingSave=null;supplierPendingSave=null;}
function openPurchaseSection(section){purchaseWorkspaceRequest++;clearTimeout(purchaseSearchTimer);purchaseSection=section||'orders';purchasePage=0;purchaseEditing='';supplierEditing='';purchaseFocusedOrder='';purchaseFocusedSupplier='';purchasePrefill=null;purchasePendingSave=null;}
function purchaseToday(){return companyDate();}
function purchaseOverdue(order,today=purchaseToday()){return order.status==='ordered'&&!!order.expected_on&&order.expected_on<today;}
function purchaseStatusTone(order){return statusTone(purchaseOverdue(order)?'overdue':{requested:'awaiting_approval',approved:'in_progress',ordered:'waiting',closed:'completed',cancelled:'cancelled'}[order.status]);}
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
 return `<article class="card purchase-card${overdue?' attention':''}" data-purchase-card="${esc(order.id)}"><div class="heading"><div><small>${esc(order.po_number)}${order.lpo_reference?` · LPO ${esc(order.lpo_reference)}`:''}</small><h2>${esc(supplier?.name||'Supplier not chosen yet')}</h2></div><span class="tag purchase-tag-${esc(order.status)} chip chip--${purchaseStatusTone(order)}">${esc(purchaseStatuses[order.status]||order.status)}</span></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th>For</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${esc(purchaseProductName(line.product_id))}${line.note?`<small>${esc(line.note)}</small>`:''}</td><td>${esc(line.quantity)}</td><td>${line.pending_request_id?esc((typeof pendingRows!=='undefined'?pendingRows:[]).find(p=>p.id===line.pending_request_id)?.request_number||'Pending order'):'Stock'}</td></tr>`).join('')}</tbody></table></div><div class="details"><div><small>Requested by</small>${esc(employeeName(order.requested_by))}</div><div><small>Approved by</small>${esc(order.approved_by?employeeName(order.approved_by):'Not yet')}</div><div><small>Expected arrival</small>${order.expected_on?`<strong${overdue?' class="overdue"':''}>${overdue?'Overdue ':''}${esc(order.expected_on)}</strong>`:'Not set'}</div>${order.close_note?`<div><small>${order.status==='cancelled'?'Cancelled because':'Receipt reference'}</small>${esc(order.close_note)}</div>`:''}</div>${order.notes?`<p class="muted">${esc(order.notes)}</p>`:''}<div class="actions">${purchaseActions(order)}</div><div data-purchase-history-output="${esc(order.id)}"></div></article>`;
}
function purchaseSupplierOptions(selected=''){return suppliers.filter(s=>s.active||s.id===selected).sort((a,b)=>a.name.localeCompare(b.name)).map(s=>inventoryOption(s.id,`${s.name}${s.active?'':' (inactive)'}`,s.id===selected)).join('');}
function purchaseLineRow(line={}){
 const product=line.product_id?products.find(p=>p.id===line.product_id):null,choice=product&&typeof inventoryProductChoice==='function'?inventoryProductChoice(typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(product):product):'';
 // Prices are no longer asked for; a price saved before is carried through unchanged.
 return `<tr data-purchase-line data-pending="${esc(line.pending_request_id||'')}" data-product="${esc(line.product_id||'')}" data-price="${line.unit_price_minor==null?'':esc(line.unit_price_minor)}"><td><label><span>Item</span><input name="productChoice" list="purchaseProductChoices" required autocomplete="off" value="${esc(choice)}" placeholder="Start typing the product"></label>${line.pending_request_id?`<small data-purchase-pending>For pending order ${esc(line.pending_request_label||(typeof pendingRows!=='undefined'?pendingRows:[]).find(row=>row.id===line.pending_request_id)?.request_number||line.pending_request_id)}</small>`:''}</td><td><label><span>Quantity</span><input name="quantity" type="number" min="1" max="1000000" step="1" required value="${esc(line.quantity||'')}"></label></td><td><label><span>Note (optional)</span><input name="note" maxlength="500" value="${esc(line.note||'')}"></label></td><td><button type="button" data-remove-purchase-line aria-label="Remove item">Remove</button></td></tr>`;
}
function purchaseEditor(order){
 const lines=order?purchaseOrderLines(order.id):(purchasePrefill?.lines||[{}]);
 return `<section class="card document-editor"><div class="heading"><div><small>${order?esc(order.po_number):'NEW'}</small><h2>${order?'Edit purchase request':'New purchase request'}</h2></div><button type="button" id="closePurchaseEditor">Close</button></div><form id="purchaseForm" data-id="${esc(order?.id||'')}" data-version="${order?.version||0}"><p class="muted">Supplier, item and quantity are required. Other fields are optional.</p><p role="alert" id="purchaseFormError"></p><input type="hidden" name="currency" value="${esc(order?.currency||'TZS')}"><label class="purchase-supplier"><span>1. Supplier</span><select name="supplierId" required><option value="">Choose the supplier, for example Polymed</option>${purchaseSupplierOptions(order?.supplier_id||'')}</select></label><h3>2. Items we need from them</h3><datalist id="purchaseProductChoices" data-lookup-values="products">${salesProductChoices()}</datalist><div class="table-wrap"><table class="purchase-lines"><thead><tr><th>Item</th><th>Quantity</th><th>Note</th><th></th></tr></thead><tbody id="purchaseLines">${lines.map(purchaseLineRow).join('')}</tbody></table></div><div class="actions"><button type="button" id="addPurchaseLine">Add item</button></div><details class="purchase-more"${order?.expected_on||order?.notes||purchasePrefill?.notes?' open':''}><summary>Needed by date or a note (optional)</summary><div class="grid"><label><span>Needed by (optional)</span><input name="expectedOn" type="date" value="${esc(order?.expected_on||'')}"></label><label class="wide"><span>Note for the owner (optional)</span><textarea name="notes" maxlength="4000">${esc(order?.notes||purchasePrefill?.notes||'')}</textarea></label></div></details><div class="actions"><button type="submit">${order?'Save changes':'Send for approval'}</button></div></form></section>`;
}
function purchaseFieldError(control){
 control=fieldValidationSource(control);const error=nativeFieldError(control);if(error||!control.willValidate)return error;
 if(control.closest('[data-purchase-line]')){
  if(control.name==='productChoice'&&!inventoryProductFromChoice(control.value))return 'Choose a product from the list.';
  if(control.name==='quantity'){const quantity=Number(control.value);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return 'Enter a whole quantity between 1 and 1,000,000.';}
 }
 return '';
}
function purchaseFormErrors(form){
 const errors=nativeFormErrors(form);
 for(const control of form.querySelectorAll('[data-purchase-line] input')){if(fieldValidationSource(control)!==control)continue;const error=purchaseFieldError(control);if(error)errors.set(control,error);}
 return errors;
}
function purchaseClearPendingLine(row){row.dataset.pending='';const label=row.querySelector('[data-purchase-pending]');if(label)label.textContent='For stock';}
function purchaseFormValues(form){
 const f=new FormData(form),lines=[...form.querySelectorAll('[data-purchase-line]')].map((row,index)=>{
  const choice=row.querySelector('[name="productChoice"]').value,product=inventoryProductFromChoice(choice),quantity=Number(row.querySelector('[name="quantity"]').value);
  if(!product)throw Error(`Item ${index+1}: choose a product from the list.`);
  if(row.dataset.pending&&product.id!==row.dataset.product)purchaseClearPendingLine(row);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)throw Error(`Item ${index+1}: enter a whole quantity of at least 1.`);
  const unit_price_minor=row.dataset.price===''||row.dataset.price===undefined?null:Number(row.dataset.price);
  return {product_id:product.id,quantity,unit_price_minor,pending_request_id:row.dataset.pending||null,note:row.querySelector('[name="note"]').value.trim()};
 });
 if(!lines.length)throw Error('Add at least one item.');
 if(!f.get('supplierId'))throw Error('Choose the supplier.');
 return {supplierId:f.get('supplierId')||null,currency:f.get('currency')||'TZS',expectedOn:f.get('expectedOn')||null,notes:String(f.get('notes')||''),lines};
}
async function savePurchaseForm(form){
 if(form.dataset.saved==='true')throw Error('Saved. Use Retry saved purchase before continuing.');if(form.dataset.saving==='true')return;
 const values=purchaseFormValues(form),id=form.dataset.id||'',version=Number(form.dataset.version||0),key=JSON.stringify(values),context=purchaseSaveContext(form.closest('.document-editor'));
 if(!context.current())throw Error('Purchase view changed. Reopen the request.');
 // One request ID per unchanged form until the server confirms it, so a retry cannot create a duplicate order.
 if(!id&&purchasePendingSave?.key!==key)purchasePendingSave={key,id:crypto.randomUUID()};
 const requestId=id||purchasePendingSave.id,inert=form.inert,editorInert=context.target.inert;form.dataset.saving='true';form.inert=true;context.target.inert=true;
 try{
  let result;try{result=await client.rpc('save_purchase_request',{p_id:requestId,p_expected_version:version,p_supplier_id:values.supplierId,p_currency:values.currency,p_expected_on:values.expectedOn,p_notes:values.notes,p_lines:values.lines});}catch(error){if(context.current())throw error;return;}
  if(!context.sessionCurrent())return;if(result.error){if(context.current())throw Error(result.error.message);return;}
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved?.id!==requestId){if(context.current())throw Error('The server did not confirm the save. Press save again to retry safely.');return;}
  purchasePageKey='';purchaseLoadRequest++;if(!context.current()){purchaseLoaded=false;return;}
  form.dataset.saved='true';if(purchasePendingSave?.id===requestId)purchasePendingSave=null;
  await finishPurchaseSave(context,'orders',requestId,{version:version+1,status:'requested'},`Purchase request ${id?'updated':'sent for approval'}.`);
 }finally{if(form.dataset.saved!=='true'){form.dataset.saving='false';form.inert=inert;context.target.inert=editorInert;}}
}

function supplierEditor(row){
 return `<section class="card document-editor"><div class="heading"><div><small>${row?esc(row.supplier_number):'NEW'}</small><h2>${row?'Edit supplier':'New supplier'}</h2></div><button type="button" id="closeSupplierEditor">Close</button></div><form id="supplierForm" data-id="${esc(row?.id||'')}" data-version="${row?.version||0}"><p class="muted">Supplier name is required. Other contact details are optional.</p><p role="alert" id="supplierFormError"></p><div class="grid"><label class="wide"><span>Supplier name</span><input name="name" required minlength="2" maxlength="200" value="${esc(row?.name||'')}"></label><label><span>Country (optional)</span><input name="country" maxlength="100" value="${esc(row?.country||'')}"></label><label><span>Contact person (optional)</span><input name="contact_name" maxlength="200" value="${esc(row?.contact_name||'')}"></label><label><span>Phone (optional)</span><input name="phone" type="tel" maxlength="60" inputmode="tel" aria-describedby="supplierPhoneHint" value="${esc(row?.phone||'')}"><small id="supplierPhoneHint">Include the country code, for example +255 712 345 678.</small></label><label><span>Email (optional)</span><input name="email" type="email" maxlength="320" aria-describedby="supplierEmailHint" value="${esc(row?.email||'')}"><small id="supplierEmailHint">Use an address such as orders@example.com, or leave blank.</small></label><label><span>TIN (optional)</span><input name="tin" maxlength="60" value="${esc(row?.tin||'')}"></label><label><span>Payment terms (optional)</span><input name="payment_terms" maxlength="300" value="${esc(row?.payment_terms||'')}"></label><label class="wide"><span>Notes (optional)</span><textarea name="notes" maxlength="4000">${esc(row?.notes||'')}</textarea></label>${row&&me?.role==='owner'?`<label><span>Status</span><select name="active"><option value="true" ${row.active?'selected':''}>Active</option><option value="false" ${row.active?'':'selected'}>Inactive — hide from new orders</option></select></label>`:''}</div><div class="actions"><button type="submit">${row?'Save changes':'Save supplier'}</button></div></form></section>`;
}
async function saveSupplierForm(form){
 if(form.dataset.saved==='true')throw Error('Saved. Use Retry saved purchase before continuing.');if(form.dataset.saving==='true')return;
 const f=new FormData(form),id=form.dataset.id||'',version=Number(form.dataset.version||0),existing=suppliers.find(s=>s.id===id),context=purchaseSaveContext(form.closest('.document-editor'));
 const fields={name:String(f.get('name')||'').trim(),country:f.get('country')||'',contact_name:f.get('contact_name')||'',phone:f.get('phone')||'',email:String(f.get('email')||'').trim(),tin:f.get('tin')||'',payment_terms:f.get('payment_terms')||'',notes:f.get('notes')||'',active:f.has('active')?f.get('active')==='true':(existing?.active??true)};
 if(!context.current())throw Error('Purchase view changed. Reopen the supplier.');
 if(fields.name.length<2)throw Error('Enter the supplier name.');
 if(!id&&supplierPendingSave?.name!==fields.name)supplierPendingSave={name:fields.name,id:crypto.randomUUID()};
 const requestId=id||supplierPendingSave.id,inert=form.inert,editorInert=context.target.inert;form.dataset.saving='true';form.inert=true;context.target.inert=true;
 try{
  let result;try{result=await client.rpc('save_supplier',{p_id:requestId,p_expected_version:version,p_fields:fields});}catch(error){if(context.current())throw error;return;}
  if(!context.sessionCurrent())return;if(result.error){if(context.current())throw Error(result.error.message);return;}
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved?.id!==requestId){if(context.current())throw Error('The server did not confirm the save. Press save again to retry safely.');return;}
  purchasePageKey='';purchaseLoadRequest++;if(!context.current()){purchaseLoaded=false;return;}
  form.dataset.saved='true';if(supplierPendingSave?.id===requestId)supplierPendingSave=null;
  await finishPurchaseSave(context,'suppliers',requestId,{version:version+1},'Supplier saved.',saved);
 }finally{if(form.dataset.saved!=='true'){form.dataset.saving='false';form.inert=inert;context.target.inert=editorInert;}}
}
function purchaseSaveContext(target){
 const actor=me,epoch=purchaseEpoch,request=purchaseWorkspaceRequest,section=purchaseSection,region=$('#purchaseRecord'),notice=$('#purchaseSaved');
 const context={actor,target,region,notice,origin:document.activeElement,sessionCurrent:()=>me===actor&&purchaseEpoch===epoch};
 context.current=()=>context.sessionCurrent()&&purchaseLoadedActor===actor&&purchaseWorkspaceRequest===request&&view==='purchasing'&&purchaseSection===section&&region?.isConnected&&$('#purchaseRecord')===region&&context.target?.isConnected&&notice?.isConnected;
 return context;
}
function purchaseSavedRowValid(row,kind,id,expected){
 if(!row||row.id!==id||!Number.isSafeInteger(row.version)||row.version<expected.version)return false;
 if(kind==='suppliers')return typeof row.active==='boolean'&&['supplier_number','name','country','contact_name','phone','email','tin','payment_terms','notes'].every(key=>typeof row[key]==='string')&&row.name.trim().length>=2;
 return Object.hasOwn(purchaseStatuses,row.status)&&(row.version>expected.version||row.status===expected.status)&&['po_number','currency','lpo_reference','notes','requested_by','close_note','created_at','updated_at'].every(key=>typeof row[key]==='string')&&Object.hasOwn(row,'supplier_id')&&Object.hasOwn(row,'expected_on')&&Object.hasOwn(row,'approved_by')&&Array.isArray(row.purchase_order_lines)&&row.purchase_order_lines.length>0&&row.purchase_order_lines.length<=200&&new Set(row.purchase_order_lines.map(line=>line.id)).size===row.purchase_order_lines.length&&row.purchase_order_lines.every(line=>line.id&&line.purchase_order_id===id&&typeof line.product_id==='string'&&Number.isSafeInteger(line.line_number)&&line.line_number>0&&Number.isSafeInteger(line.quantity)&&line.quantity>0&&typeof line.note==='string');
}
// Headers returned by order writes do not include the saved lines. Read only this order before enabling it again.
async function purchaseRefreshOne(id){
 const result=await client.from('purchase_orders').select(purchaseColumns).eq('id',id).maybeSingle();
 if(result.error)throw Error(result.error.message);return result.data;
}
async function finishPurchaseSave(context,kind,id,expected,text,receipt=null){
 if(!context.current())return;
 const {notice}=context,wasTimelineOpen=context.target.querySelector('.work-timeline')?.open===true;
 async function reload(saved=null){
  if(!context.current())return;
  const x=window.scrollX,y=window.scrollY;context.target.inert=true;notice.textContent='Saved. '+text+' Loading current details…';$('#purchaseRefresh').onclick=()=>run(()=>reload());window.scrollTo(x,y);
  try{
   let row=saved;
   if(kind==='orders')row=await purchaseRefreshOne(id);
   else if(!purchaseSavedRowValid(row,kind,id,expected)){const result=await client.from('suppliers').select('*').eq('id',id).maybeSingle();if(result.error)throw Error(result.error.message);row=result.data;}
   if(!context.current())return;
   const current=(kind==='orders'?purchaseOrders:suppliers).find(value=>value.id===id);
   if(!purchaseSavedRowValid(row,kind,id,expected)||current&&current.version>row.version)throw Error('The saved record details could not be verified.');
   if(kind==='orders'){const {purchase_order_lines:items,...order}=row;purchaseOrders=[order,...purchaseOrders.filter(value=>value.id!==id)];purchaseLines=[...purchaseLines.filter(line=>line.purchase_order_id!==id),...items];purchaseEditing='';purchaseFocusedOrder=id;purchasePrefill=null;}
   else{suppliers=[row,...suppliers.filter(value=>value.id!==id)];supplierEditing='';purchaseFocusedSupplier=id;}
   const x=window.scrollX,y=window.scrollY,old=context.target,focused=document.activeElement,template=document.createElement('template');template.innerHTML=kind==='orders'?purchaseCard(purchaseOrders.find(value=>value.id===id)):supplierCard(row);
   const card=template.content.firstElementChild;old.replaceWith(card);context.target=card;bindPurchasing();$('#purchaseTitle').textContent=kind==='orders'?row.po_number:row.name;notice.textContent='Saved. '+text;
   const focus=card.querySelector('button')||notice;if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
   if(document.activeElement===document.body&&(old.contains(focused)||!context.origin?.isConnected))focus.focus({preventScroll:true});window.scrollTo(x,y);message('Saved. '+text);
   if(kind==='orders'&&typeof decorateWorkHandoffs==='function'){await decorateWorkHandoffs(card,text);if(context.current()){const timeline=card.querySelector('.work-timeline');if(timeline)timeline.open=wasTimelineOpen;}}
  }catch(error){
   if(!context.current())return;purchaseLoaded=false;purchasePageKey='';context.target.inert=true;
   const x=window.scrollX,y=window.scrollY;notice.innerHTML=`<p role="alert">Saved. ${esc(text)} Current details could not reload: ${esc(error.message||'Connection unavailable')}. Retry reads the saved record without saving again.</p><button type="button" data-purchase-save-retry>Retry saved purchase</button>`;
   const retry=notice.querySelector('[data-purchase-save-retry]');retry.onclick=()=>run(()=>reload());if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);if(document.activeElement===document.body)retry.focus({preventScroll:true});window.scrollTo(x,y);message('Saved. '+text+' Use Retry saved purchase before continuing.');
  }
 }
 await reload(receipt);
}

async function loadPurchasing(){
 const epoch=purchaseEpoch,request=++purchaseLoadRequest,workspace=purchaseWorkspaceRequest,actor=me;
 // Every open order is loaded; arrived and cancelled ones only from the last six months, with their items in the
 // same request (items are nested per order, so the 1,000-row page limit applies to orders only).
 const since=new Date(Date.now()-purchaseRecentDays*864e5).toISOString();
 const [rows,supplierRows]=await Promise.all([all('purchase_orders',purchaseColumns,q=>q.or(`status.in.(requested,approved,ordered),updated_at.gte.${since}`)),all('suppliers','*')]);
 const orders=rows.map(({purchase_order_lines:items,...order})=>order),lines=rows.flatMap(row=>row.purchase_order_lines||[]);
 if(epoch!==purchaseEpoch||request!==purchaseLoadRequest||workspace!==purchaseWorkspaceRequest||me!==actor)return false;
 purchaseOrders=orders;purchaseLines=lines;suppliers=supplierRows;purchaseLoaded=true;purchaseLoadedActor=actor;purchaseLoadError='';return true;
}
async function purchasingWorkspace(force=false){
 const actor=me,epoch=purchaseEpoch,request=++purchaseWorkspaceRequest,section=purchaseSection,current=()=>me===actor&&purchaseEpoch===epoch&&purchaseWorkspaceRequest===request&&view==='purchasing'&&purchaseSection===section;
 syncWorkspaceNavigation();
 if(purchasingLanding()){
  const key=JSON.stringify([purchaseSection,purchaseFilter,purchaseSearch,purchasePage,purchaseToday()]);
  if(!$('#purchaseSearch'))workspaceLoading('Loading purchasing…');
  try{
   const fresh=force||!purchasePageData||purchasePageActor!==actor||key!==purchasePageKey,data=fresh?await requestPurchasingPage():purchasePageData;
   if(!current()||!purchasingLanding()||key!==JSON.stringify([purchaseSection,purchaseFilter,purchaseSearch,purchasePage,purchaseToday()]))return;
   if(fresh)purchaseLoaded=false;
   purchasePageData=data;purchasePageActor=actor;purchasePage=data.page;purchasePageKey=JSON.stringify([purchaseSection,purchaseFilter,purchaseSearch,purchasePage,purchaseToday()]);purchaseLoadError='';
   const input=$('#purchaseSearch');if(input&&document.activeElement===input)renderSearchPreservingPosition(input,renderPurchasing);else renderPurchasing();
  }catch(error){if(current()&&purchasingLanding()&&key===JSON.stringify([purchaseSection,purchaseFilter,purchaseSearch,purchasePage,purchaseToday()])){purchasePageData=null;purchasePageKey='';purchaseLoadError=error.message;renderPurchasing();}}
  return;
 }
 workspaceLoading('Loading purchasing…');
 try{
  if(!listsLoaded){await loadLists();if(!current())return;if(!listsLoaded)throw Error('Product records could not load. Refresh before opening this record.');}
  if(force||!purchaseLoaded||purchaseLoadedActor!==actor){if(!(await loadPurchasing())||!current())return;}
  const id=purchaseFocusedOrder||(purchaseEditing!=='new'?purchaseEditing:'');
  if(id&&!purchaseOrders.some(row=>row.id===id)){
   const result=await client.from('purchase_orders').select(purchaseColumns).eq('id',id).maybeSingle();
   if(!current())return;if(result.error)throw Error(result.error.message);if(!result.data)throw Error('This purchase order is unavailable.');
   const {purchase_order_lines:items,...order}=result.data;purchaseOrders=[...purchaseOrders,order];purchaseLines=[...purchaseLines,...(items||[])];
  }
  if(purchaseFocusedSupplier&&!suppliers.some(row=>row.id===purchaseFocusedSupplier))throw Error('This supplier is unavailable.');
  purchaseLoadError='';
 }catch(error){if(!current())return;purchaseLoadError=error.message;purchaseLoaded=false;}
 if(current())renderPurchasing();
}
async function requestPurchasingPage(){
 const section=purchaseSection,filter=purchaseFilter,query=purchaseSearch,page=purchasePage,result=await client.rpc('purchasing_page',{p_section:section,p_filter:filter,p_query:query,p_page:page});
 if(result.error)throw Error(result.error.message||'Purchasing could not load.');
 const data=result.data;
 if(!data||data.section!==section||data.filter!==filter||data.query!==query||!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages!==Math.max(1,Math.ceil(data.total/20))||data.page!==Math.min(page,data.pages-1)||data.rows.length!==Math.min(20,Math.max(0,data.total-data.page*20))||!data.counts||['all',...(section==='orders'?['requested','approved','ordered','overdue']:[])].some(key=>!Number.isSafeInteger(data.counts[key])||data.counts[key]<0)||data.total>data.counts.all||new Set(data.rows.map(row=>row.id)).size!==data.rows.length||data.rows.some(row=>!row.id||row.register_summary!==true||row.kind!==section||(section==='orders'?typeof row.po_number!=='string'||!Object.hasOwn(purchaseStatuses,row.status)||typeof row.supplier_name!=='string'||!Object.hasOwn(row,'expected_on')||typeof row.lpo_reference!=='string':typeof row.name!=='string'||typeof row.supplier_number!=='string'||typeof row.active!=='boolean'||typeof row.country!=='string'||typeof row.contact_name!=='string')))throw Error('The server did not return a complete purchasing page.');
 return data;
}
function purchaseSummaryCard(row){
 const order=row.kind==='orders';
 return `<article class="card"><h2>${esc(order?row.po_number:row.name)}</h2><div class="details">${order?`<div><small>Supplier</small>${esc(row.supplier_name||'Supplier not chosen yet')}</div><div><small>Status</small><span class="tag purchase-tag-${esc(row.status)} chip chip--${purchaseStatusTone(row)}">${esc(purchaseStatuses[row.status])}</span></div><div><small>Expected arrival</small>${purchaseOverdue(row)?'Overdue · ':''}${esc(row.expected_on||'Not set')}</div><div><small>LPO</small>${esc(row.lpo_reference||'Not issued')}</div>`:`<div><small>Supplier number</small>${esc(row.supplier_number)}</div><div><small>Status</small><span class="tag chip chip--${statusTone(row.active?'success':'inactive')}">${row.active?'Active':'Inactive'}</span></div><div><small>Country</small>${esc(row.country||'Not supplied')}</div><div><small>Contact</small>${esc(row.contact_name||'Not supplied')}</div>`}</div><div class="actions"><button type="button" data-purchase-open="${esc(row.id)}" aria-label="Open ${esc(order?row.po_number:row.name)}">Open</button></div></article>`;
}
function renderPurchasing(){
 const ordersSection=purchaseSection==='orders',landing=purchasingLanding(),data=purchasePageData,counts=data?.counts||{};
 const editingOrder=purchaseEditing&&purchaseEditing!=='new'?purchaseOrders.find(o=>o.id===purchaseEditing):null,editingSupplier=supplierEditing&&supplierEditing!=='new'?suppliers.find(s=>s.id===supplierEditing):null;
 const focused=ordersSection?purchaseOrders.find(o=>o.id===purchaseFocusedOrder):suppliers.find(s=>s.id===purchaseFocusedSupplier);
 const record=purchaseLoadError?'':ordersSection&&purchaseEditing?purchaseEditor(editingOrder):!ordersSection&&supplierEditing?supplierEditor(editingSupplier):focused?(ordersSection?purchaseCard(focused):supplierCard(focused)):'<p role="alert">This record is unavailable. Return to the list and open it again.</p>';
 $('#content').innerHTML=`<section class="purchasing-workspace">${workspacePageHeader({titleAttrs:'id="purchaseTitle"',title:ordersSection?((focused||editingOrder)?.po_number||'Purchasing'):((focused||editingSupplier)?.name||'Suppliers'),back:landing?'':`<button type="button" id="purchaseBack">Back to ${ordersSection?'purchases':'suppliers'}</button>`,actions:`<button type="button" id="purchaseRefresh">Refresh</button>${landing?`<button type="button" class="primary-action" id="${ordersSection?'newPurchase':'newSupplier'}">${ordersSection?'New purchase request':'New supplier'}</button>`:''}`})}${purchaseLoadError?`<p class="notice error" role="alert">Purchasing could not load: ${esc(purchaseLoadError)}. Nothing was changed.</p>`:''}<div id="purchaseSaved" role="status" tabindex="-1"></div>${landing?`${ordersSection?`<div class="tabs" role="group" aria-label="Filter purchase orders">${purchaseFilters.map(([key,label])=>`<button type="button" data-purchase-filter="${key}" class="${purchaseFilter===key?'active':''}" aria-pressed="${purchaseFilter===key}">${label}${counts[key]?` · ${counts[key]}`:''}</button>`).join('')}</div>${['finished','all'].includes(purchaseFilter)?'<p class="muted">Arrived and cancelled: last 6 months. Search PO or LPO numbers for older orders.</p>':''}`:''}<label class="search"><span>Search</span><input id="purchaseSearch" type="search" maxlength="2000" placeholder="${ordersSection?'Supplier, product, PO or LPO number':'Name, contact, phone, email or TIN'}" value="${esc(purchaseSearch)}"></label>${data?`<p role="status">${data.total} ${ordersSection?'purchase orders':'suppliers'} · Page ${data.page+1} of ${data.pages}</p><div class="proforma-tiles">${data.rows.map(purchaseSummaryCard).join('')||'<p class="muted">No matching records.</p>'}</div><div class="actions" role="group" aria-label="Purchasing pages"><button type="button" id="purchasePrev" ${data.page===0?'disabled':''}>Previous</button><span>Page ${data.page+1} of ${data.pages}</span><button type="button" id="purchaseNext" ${data.page>=data.pages-1?'disabled':''}>Next</button></div>`:''}`:`<div id="purchaseRecord">${record}</div>`}</section>`;
 bindPurchasing();
 if(!landing&&!purchaseLoadError&&typeof decorateWorkHandoffs==='function')decorateWorkHandoffs().catch(()=>{});
}
function supplierCard(row){return `<article class="card supplier-card" data-supplier-card="${esc(row.id)}"><div class="heading"><div><small>${esc(row.supplier_number)}${row.country?' · '+esc(row.country):''}</small><h2>${esc(row.name)}</h2></div><span class="tag chip chip--${statusTone(row.active?'success':'inactive')}">${row.active?'Active':'Inactive'}</span></div><div class="details"><div><small>Contact</small>${esc(row.contact_name||'—')}</div><div><small>Phone</small>${esc(row.phone||'—')}</div><div><small>Email</small>${esc(row.email||'—')}</div><div><small>TIN</small>${esc(row.tin||'—')}</div><div><small>Payment terms</small>${esc(row.payment_terms||'—')}</div><div><small>Purchase orders</small>${purchaseOrders.filter(o=>o.supplier_id===row.id).length}</div></div><div class="actions"><button type="button" data-supplier-edit="${esc(row.id)}">Edit</button></div></article>`;}
const purchaseEditorSnapshots=new WeakMap();
async function confirmPurchasingLeave(current=()=>true){
 if(!current())return false;
 if(view!=='purchasing')return true;
 const form=$('#purchaseForm')||$('#supplierForm'),state=form&&purchaseEditorSnapshots.get(form);
 if(!form)return true;
 if(!state||!state.current())return false;
 if(form.dataset.saving==='true'&&form.dataset.saved!=='true'){actionFeedbackRefuse();return false;}
 if(form.dataset.saved==='true')return true;
 if(state.pending)return false;
 const snapshot=workspaceFormSnapshot(form);if(snapshot===state.snapshot)return true;
 if(busy){actionFeedbackRefuse();return false;}
 state.pending=true;
 try{
  const discard=await askConfirm({title:'Discard unsaved changes?',body:'Your changes to this '+(form.id==='purchaseForm'?'purchase request':'supplier')+' have not been saved.',confirmLabel:'Discard changes',tone:'danger'});
  return discard&&current()&&state.current()&&!busy&&form.dataset.saving!=='true'&&form.dataset.saved!=='true'&&workspaceFormSnapshot(form)===snapshot;
 }finally{state.pending=false;}
}
function bindPurchasing(){
 const actor=me,epoch=purchaseEpoch,request=purchaseWorkspaceRequest,section=purchaseSection,target=$('#content'),refresh=$('#purchaseRefresh'),current=()=>me===actor&&view==='purchasing'&&purchaseEpoch===epoch&&purchaseWorkspaceRequest===request&&purchaseSection===section&&target.isConnected&&$('#content')===target&&refresh.isConnected&&$('#purchaseRefresh')===refresh;
 for(const form of [$('#purchaseForm'),$('#supplierForm')])if(form&&!purchaseEditorSnapshots.has(form))purchaseEditorSnapshots.set(form,{snapshot:workspaceFormSnapshot(form),current:()=>current()&&form.isConnected&&$('#'+form.id)===form,pending:false});
 const leave=async (origin,action)=>{if(!current()||!await confirmPurchasingLeave()||!current())return;return run(action,{origin});};
 $('#purchaseRefresh').onclick=()=>leave(refresh,()=>purchasingWorkspace(true));
 const newPurchase=$('#newPurchase');if(newPurchase)newPurchase.onclick=()=>{purchasePrefill=null;purchaseFocusedOrder='';purchaseEditing='new';purchasePendingSave=null;run(async()=>{await purchasingWorkspace();$('#purchaseForm')?.scrollIntoView({block:'start'});});};
 const newSupplier=$('#newSupplier');if(newSupplier)newSupplier.onclick=()=>{purchaseFocusedSupplier='';supplierEditing='new';supplierPendingSave=null;run(async()=>{await purchasingWorkspace();$('#supplierForm [name="name"]')?.focus();});};
 const purchaseBack=$('#purchaseBack');if(purchaseBack)purchaseBack.onclick=()=>leave(purchaseBack,()=>{purchaseWorkspaceRequest++;purchaseFocusedOrder='';purchaseFocusedSupplier='';purchaseEditing='';supplierEditing='';purchasePrefill=null;purchasePendingSave=null;supplierPendingSave=null;return purchasingWorkspace();});
 const closePurchaseEditor=$('#closePurchaseEditor');if(closePurchaseEditor)closePurchaseEditor.onclick=()=>leave(closePurchaseEditor,()=>{purchaseEditing='';purchasePrefill=null;purchasePendingSave=null;return purchasingWorkspace();});
 const closeSupplierEditor=$('#closeSupplierEditor');if(closeSupplierEditor)closeSupplierEditor.onclick=()=>leave(closeSupplierEditor,()=>{supplierEditing='';supplierPendingSave=null;return purchasingWorkspace();});
 const form=$('#purchaseForm');
 if(form){
  const actor=me,epoch=purchaseEpoch,request=purchaseWorkspaceRequest,section=purchaseSection,current=()=>me===actor&&purchaseEpoch===epoch&&purchaseWorkspaceRequest===request&&purchaseSection===section&&view==='purchasing'&&form.isConnected&&$('#purchaseForm')===form;
  const summary=(count=form.querySelectorAll('.field-error').length)=>{form.querySelector('#purchaseFormError').textContent=fieldErrorSummary(count);};form.noValidate=true;
  form.addEventListener('focusout',event=>{const control=fieldValidationSource(event.target);if(!current()||form.dataset.saving==='true'||form.dataset.saved==='true'||!form.contains(control)||!control.matches('input,select,textarea')||fieldBlurToAction(event))return;showFieldError(control,purchaseFieldError(control));if(form.dataset.validationSubmitted==='true')summary();});
  form.oninput=event=>{if(!current()||form.dataset.saving==='true'||form.dataset.saved==='true')return;const control=fieldValidationSource(event.target);if(control.name!=='productChoice')return;const row=control.closest('[data-purchase-line]');if(row?.dataset.pending&&inventoryProductFromChoice(control.value)?.id!==row.dataset.product)purchaseClearPendingLine(row);};
  $('#addPurchaseLine').onclick=()=>{if(current()&&form.dataset.saving!=='true'&&form.dataset.saved!=='true')$('#purchaseLines').insertAdjacentHTML('beforeend',purchaseLineRow());};
  $('#purchaseLines').onclick=event=>{if(!current()||form.dataset.saving==='true'||form.dataset.saved==='true')return;const remove=event.target.closest('[data-remove-purchase-line]');if(!remove)return;if(form.querySelectorAll('[data-purchase-line]').length>1){remove.closest('tr').remove();if(form.dataset.validationSubmitted==='true')summary();}else form.querySelector('#purchaseFormError').textContent='A purchase request needs at least one item.';};
  form.onsubmit=event=>{event.preventDefault();if(!current())return;const button=form.querySelector('[type="submit"]'),notice=form.querySelector('#purchaseFormError');if(button.disabled)return;
   if(busy){actionFeedbackRefuse(button,notice);return;}
   const errors=purchaseFormErrors(form);form.dataset.validationSubmitted='true';summary(errors.size);for(const control of errors.keys()){const details=control.closest('details');if(details)details.open=true;}showFieldErrors(form,errors);if(errors.size)return;button.disabled=true;
   return run(async()=>{try{await savePurchaseForm(form)}catch(error){if(current())throw error;}finally{if(current())button.disabled=form.dataset.saved==='true';}},{origin:button,errorTarget:notice});};
 }
 const supplierForm=$('#supplierForm');
 if(supplierForm){
  const actor=me,epoch=purchaseEpoch,request=purchaseWorkspaceRequest,section=purchaseSection,current=()=>me===actor&&purchaseEpoch===epoch&&purchaseWorkspaceRequest===request&&purchaseSection===section&&view==='purchasing'&&supplierForm.isConnected&&$('#supplierForm')===supplierForm;
  const notice=supplierForm.querySelector('#supplierFormError'),summary=(count=supplierForm.querySelectorAll('.field-error').length)=>{notice.textContent=fieldErrorSummary(count);};supplierForm.noValidate=true;
  supplierForm.addEventListener('focusout',event=>{const control=fieldValidationSource(event.target);if(!current()||supplierForm.dataset.saving==='true'||supplierForm.dataset.saved==='true'||!supplierForm.contains(control)||!control.matches('input,select,textarea')||fieldBlurToAction(event))return;showFieldError(control,nativeFieldError(control));if(supplierForm.dataset.validationSubmitted==='true')summary();});
  supplierForm.onsubmit=event=>{event.preventDefault();if(!current())return;const button=supplierForm.querySelector('[type="submit"]');if(button.disabled)return;
   if(busy){actionFeedbackRefuse(button,notice);return;}
   const errors=nativeFormErrors(supplierForm);supplierForm.dataset.validationSubmitted='true';summary(errors.size);showFieldErrors(supplierForm,errors);if(errors.size)return;button.disabled=true;
   return run(async()=>{try{await saveSupplierForm(supplierForm)}catch(error){if(current())throw error;}finally{if(current())button.disabled=supplierForm.dataset.saved==='true';}},{origin:button,errorTarget:notice});};
 }
 const search=$('#purchaseSearch');if(search)search.oninput=event=>{purchaseSearch=event.target.value;purchasePage=0;clearTimeout(purchaseSearchTimer);const actor=me,epoch=purchaseEpoch,section=purchaseSection;purchaseSearchTimer=setTimeout(()=>{if(me===actor&&purchaseEpoch===epoch&&view==='purchasing'&&purchaseSection===section&&purchasingLanding())run(()=>purchasingWorkspace());},200);};
 if($('#purchasePrev'))$('#purchasePrev').onclick=()=>{purchasePage--;run(()=>purchasingWorkspace());};if($('#purchaseNext'))$('#purchaseNext').onclick=()=>{purchasePage++;run(()=>purchasingWorkspace());};
 document.querySelectorAll('[data-purchase-filter]').forEach(button=>button.onclick=()=>{purchaseFilter=button.dataset.purchaseFilter;purchasePage=0;run(()=>purchasingWorkspace());});
 document.querySelectorAll('[data-purchase-open]').forEach(button=>button.onclick=()=>{if(purchaseSection==='orders')purchaseFocusedOrder=button.dataset.purchaseOpen;else purchaseFocusedSupplier=button.dataset.purchaseOpen;run(()=>purchasingWorkspace());});
 document.querySelectorAll('[data-purchase-edit]').forEach(button=>button.onclick=()=>{purchasePrefill=null;purchaseEditing=button.dataset.purchaseEdit;renderPurchasing();$('#purchaseForm')?.scrollIntoView({block:'start'});});
 document.querySelectorAll('[data-supplier-edit]').forEach(button=>button.onclick=()=>{supplierEditing=button.dataset.supplierEdit;renderPurchasing();$('#supplierForm')?.scrollIntoView({block:'start'});});
 document.querySelectorAll('[data-purchase-action]').forEach(button=>button.onclick=()=>openPurchaseAction(purchaseOrders.find(o=>o.id===button.dataset.id),button.dataset.purchaseAction));
 document.querySelectorAll('[data-purchase-history]').forEach(button=>button.onclick=()=>run(()=>showPurchaseHistory(button.dataset.purchaseHistory)));
}
function openPurchaseAction(order,action){
 if(!order)return;const context=purchaseSaveContext([...document.querySelectorAll('[data-purchase-card]')].find(card=>card.dataset.purchaseCard===order.id));
 const titles={approve:'Approve purchase',order:'Place order with supplier',close:'Goods arrived — close purchase order',cancel:'Cancel purchase order'};
 const supplier=purchaseSupplier(order.supplier_id);
 const fields=`<p><strong>${esc(order.po_number)}</strong> · ${esc(supplier?.name||'Supplier not chosen')}</p>${action==='order'?(supplier?`<label><span>LPO number sent to the supplier</span><input name="lpo" required minlength="2" maxlength="120"></label><label><span>Expected arrival · optional</span><input name="expected" type="date" min="${purchaseToday()}" value="${esc(order.expected_on&&order.expected_on>=purchaseToday()?order.expected_on:'')}"></label>`:'<p class="notice">Choose the supplier first: ask the requester or owner to cancel and re-request, or edit before approval.</p>'):''}${action==='approve'?'<p>Approving lets staff place this order with the supplier.</p>':''}<label><span>${action==='close'?'Supplier delivery note or receipt reference':action==='cancel'?'Why is it cancelled?':'Note · optional'}</span><textarea name="note" maxlength="1000" ${['close','cancel'].includes(action)?'required minlength="3"':''}></textarea></label>${action==='close'?'<p class="muted">Closing records that the goods arrived. Enter the received quantities into stock in Inventory.</p>':''}`;
 actionForm(titles[action],fields,async values=>{
  if(!context.current())throw Error('Purchase view changed. Reopen the order.');
  let result;try{result=await client.rpc('advance_purchase_order',{p_id:order.id,p_expected_version:order.version,p_action:action,p_note:values.note||'',p_lpo_reference:values.lpo||'',p_expected_on:values.expected||null});}catch(error){if(context.current())throw error;return;}
  if(!context.sessionCurrent())return;if(result.error){if(context.current())throw Error(result.error.message);return;}
  purchasePageKey='';purchaseLoadRequest++;if(!context.current()){purchaseLoaded=false;return;}
  await finishPurchaseSave(context,'orders',order.id,{version:order.version+1,status:{approve:'approved',order:'ordered',close:'closed',cancel:'cancelled'}[action]},`${order.po_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
async function showPurchaseHistory(id){
 const output=document.querySelector(`[data-purchase-history-output="${CSS.escape(id)}"]`),actor=me,epoch=purchaseEpoch;if(!output)return;
 const current=()=>me===actor&&purchaseEpoch===epoch&&output.isConnected;
 output.textContent='Loading history…';
 const events=[];
 for(let offset=0;;offset+=1000){
  const result=await client.from('purchase_order_events').select('id,action,from_status,to_status,note,actor_user_id,created_at').eq('purchase_order_id',id).order('created_at').order('id').range(offset,offset+999);
  if(!current())return;
  if(result.error){output.textContent=`History could not load: ${result.error.message}`;return;}
  events.push(...(result.data||[]));if((result.data||[]).length<1000)break;
 }
 output.innerHTML=`<ol class="lead-history">${events.map(event=>`<li>${esc(new Date(event.created_at).toLocaleString())} · <strong>${esc(employeeName(event.actor_user_id))}</strong> · ${esc(event.action)}${event.from_status&&event.from_status!==event.to_status?` · ${esc(purchaseStatuses[event.from_status]||event.from_status)} → ${esc(purchaseStatuses[event.to_status]||event.to_status)}`:''}${event.note?` · ${esc(event.note)}`:''}</li>`).join('')}</ol>`;
}
// Called from a pending stock order: opens a new purchase request with that product and quantity.
function startPurchaseFromPending(row){
 if(!row)return;
 view='purchasing';openPurchaseSection('orders');
 purchasePrefill={lines:[{product_id:row.product_id,quantity:row.quantity,pending_request_id:row.id,pending_request_label:row.request_number,note:`For ${row.request_number}`}],notes:`Customer pending order ${row.request_number}`};
 purchaseEditing='new';purchasePendingSave=null;render();
}
