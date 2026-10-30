'use strict';

function booksInvoiceRecordResult(rows,id){
 const row=Array.isArray(rows)&&rows.length===1?rows[0]:null,uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),money=value=>Number.isSafeInteger(value)&&value>=0;
 const invalid=()=>{throw Error('The complete invoice details could not be verified. Retry loading this record.');};
 if(row?.id!==id||!uuid(row.organization_id)||typeof row.invoice_number!=='string'||!row.invoice_number.trim()||row.currency!=='TZS'||!date(row.invoice_date)||!date(row.due_date)||!['subtotal_minor','discount_minor','tax_minor','total_minor','paid_minor','credited_minor','customer_credit_minor','outstanding_minor'].every(key=>money(row[key]))||!['open','part','overdue','paid','void'].includes(row.status_key)||typeof row.status_label!=='string'||!row.status_label.trim()||!Array.isArray(row.lines))invalid();
 if(row.opening_import_id!=null){
  if(!uuid(row.opening_import_id)||typeof row.opening_reference!=='string'||!row.opening_reference.trim()||!date(row.opening_cutover_date)||row.lines.length)invalid();
 }else{
  if(!row.lines.length)invalid();
  for(const line of row.lines){
   if(!line||typeof line.description!=='string'||typeof line.uom!=='string'||!Number.isSafeInteger(line.quantity)||line.quantity<=0||!money(line.unit_price_minor)||!['discount_basis_points','tax_basis_points'].every(key=>Number.isSafeInteger(line[key])&&line[key]>=0&&line[key]<=10000))invalid();
   const amounts=['subtotal_minor','discount_minor','tax_minor','total_minor'];
   if(amounts.some(key=>line[key]!=null)&&!amounts.every(key=>money(line[key])))invalid();
   const {net,vat}=booksInvoiceLineAmounts(line);if(!money(net)||!money(vat)||!money(net+vat))invalid();
  }
 }
 return booksInvoiceAmounts(row);
}

async function booksInvoiceRecordWorkspace(id){
 const actor=me,session=sessionLoadEpoch,hash=location.hash,route=workspaceRecordRoute(hash),root=$('#content');
 if(!actor?.user_id||view!=='books'||booksSection!=='invoices'||route?.kind!=='invoice'||route.id!==id||!root?.isConnected)return false;
 const epoch=++booksEpoch;booksClearInvoicePreview();booksInvoiceRecordData=null;
 const current=()=>me===actor&&sessionLoadEpoch===session&&booksEpoch===epoch&&view==='books'&&booksSection==='invoices'&&location.hash===hash&&root.isConnected&&$('#content')===root;
 const header=title=>workspacePageHeader({title,titleAttrs:'id="booksInvoiceRecordTitle" tabindex="-1"',back:'<a href="#/go/books/invoices" data-books-invoice-back>← Back to invoices</a>',breadcrumbs:`<a href="#/go/books/invoices" data-books-invoice-back>Customer invoices</a><a href="${esc(hash)}" aria-current="page">${esc(title)}</a>`,actions:'<span id="booksInvoiceRecordActions"></span>'});
 root.innerHTML=header('Invoice')+'<div class="books"><div id="booksBody">'+workspaceSkeleton('table','Loading invoice…')+'</div></div>';
 const body=$('#booksBody'),active=()=>current()&&body.isConnected&&$('#booksBody')===body;
 const bindBack=()=>root.querySelectorAll('[data-books-invoice-back]').forEach(link=>link.onclick=event=>{event.preventDefault();if(active())return navigateWorkspace(workspaceRecordButton('invoice'));});
 bindBack();
 try{
  const allowed=await requireAccountingAccess(client,()=>me);if(!active()||allowed!==actor.user_id)return false;
  const rows=await booksSelect('acc_invoice_balances','*',query=>query.eq('id',id).limit(2));if(!active())return false;
  if(!rows.length)throw Error('This invoice is no longer available to your account.');
  const invoice=booksInvoiceRecordResult(rows,id);
  const [customers,taxIds]=await Promise.all([
   booksSelect('organizations','id,name',query=>query.eq('id',invoice.organization_id).limit(2)),
   booksSelect('acc_customer_tax_ids','organization_id,tin,vrn',query=>query.eq('organization_id',invoice.organization_id).limit(2))
  ]);
  if(!active())return false;
  if(customers.length>1||customers.some(row=>row.id!==invoice.organization_id||typeof row.name!=='string')||taxIds.length>1||taxIds.some(row=>row.organization_id!==invoice.organization_id||typeof row.tin!=='string'||typeof row.vrn!=='string'))throw Error('The current customer details could not be verified. Retry loading this record.');
  const data={invoices:[invoice],customerNames:new Map([[invoice.organization_id,customers[0]?.name||'Customer not available']]),taxIds:new Map(taxIds.map(row=>[row.organization_id,row])),proformaNumbers:new Map([[invoice.proforma_id,invoice.proforma_number||'']]),current:active};
  booksInvoiceRecordData=data;
  const opening=!!invoice.opening_import_id,title=(opening?'Opening balance ':'Invoice ')+invoice.invoice_number;
  root.querySelector('#booksInvoiceRecordTitle').textContent=title;root.querySelector('[aria-current="page"]').textContent=title;
  body.innerHTML=`<section class="card"><div class="heading"><h2>${esc(booksCustomer(invoice.organization_id,data))}</h2><span class="tag books-${esc(invoice.state.key)} chip chip--${booksInvoiceTone(invoice.state.key)}">${esc(invoice.state.label)}</span></div>${opening?`<p class="notice">Opening balance · reference only. This is not a new tax invoice.</p><p>Reference: ${esc(invoice.opening_reference)} · Cutover: ${esc(invoice.opening_cutover_date)}</p>`:''}<dl><dt>Invoice date</dt><dd>${esc(invoice.invoice_date)}</dd><dt>Due date</dt><dd>${esc(invoice.due_date)}</dd><dt>Total</dt><dd>${booksMoney(invoice.total_minor)}</dd><dt>Balance due</dt><dd>${booksMoney(invoice.outstanding)}</dd><dt>Paid</dt><dd>${booksMoney(invoice.paid)}</dd><dt>Posted credits</dt><dd>${booksMoney(invoice.credited_minor)}</dd><dt>Customer credit</dt><dd>${booksMoney(invoice.customer_credit_minor)}</dd></dl>${opening?'':`<p>TRA receipt: ${esc(invoice.tra_receipt_number||'Not recorded')}</p>`}</section>${opening?'':`<section class="card"><h2>Invoice lines</h2><div class="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th class="numeric-cell">Unit price</th><th class="numeric-cell">Amount before VAT</th><th class="numeric-cell">VAT</th></tr></thead><tbody>${invoice.lines.map(line=>{const amounts=booksInvoiceLineAmounts(line);return `<tr><td>${esc(line.description)}</td><td>${esc(line.quantity)} ${esc(line.uom)}</td><td class="numeric-cell">${booksMoney(line.unit_price_minor)}</td><td class="numeric-cell">${booksMoney(amounts.net)}</td><td class="numeric-cell">${booksMoney(amounts.vat)}</td></tr>`;}).join('')}</tbody></table></div></section>`}`;
  root.querySelector('#booksInvoiceRecordActions').innerHTML=opening?'':'<button type="button" id="booksInvoiceRecordPreview" class="button-primary">Preview invoice</button>';
  const preview=root.querySelector('#booksInvoiceRecordPreview');if(preview)preview.onclick=()=>{if(active()&&booksInvoiceRecordData===data)booksPrintInvoice(invoice,data,{trigger:preview});};
  return true;
 }catch(error){
  if(!active())return false;booksInvoiceRecordData=null;
  body.innerHTML=`<section class="card"><p role="alert">${esc(error.message||'This invoice could not be loaded.')}</p></section>`;
  root.querySelector('#booksInvoiceRecordActions').innerHTML='<button type="button" id="booksInvoiceRecordRetry" class="button-primary">Retry loading invoice</button>';
  const retry=root.querySelector('#booksInvoiceRecordRetry');retry.onclick=()=>{if(active()&&retry.isConnected)return run(()=>booksInvoiceRecordWorkspace(id),{origin:retry,errorTarget:retry.parentElement});};
  return false;
 }
}
