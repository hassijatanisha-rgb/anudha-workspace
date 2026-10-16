'use strict';
// Books (migration 087): chart of accounts, journal entries, customer invoices from accepted Pro formas, customer
// receipts, lock date and reports. The database checks access, balance and permanence; this page only shows and asks.
let booksSection='overview',booksData=null,booksReport={kind:'trial',from:'',to:'',asOf:'',accountId:''},booksDraft=null,booksEpoch=0;
const booksSections=[['overview','Overview'],['invoices','Customer invoices'],['receipts','Customer receipts'],['journal','Journal entries'],['accounts','Chart of accounts'],['reports','Financial reports'],['import','Import Excel']];
const booksTypes=[['asset','Assets'],['liability','Liabilities'],['equity','Equity'],['income','Income'],['expense','Expenses']];
const booksMethods=[['bank','Bank transfer'],['cash','Cash'],['mobile_money','Mobile money'],['cheque','Cheque']];

function openBooksSection(section){booksSection=booksSections.some(([key])=>key===section)?section:'overview';booksDraft=null;}
function clearBooks(){booksEpoch++;booksData=null;booksDraft=null;booksSection='overview';booksReport={kind:'trial',from:'',to:'',asOf:'',accountId:''};booksClearPrint();}
function booksToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function booksAddDays(date,days){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function booksMonthStart(date){return `${date.slice(0,7)}-01`;}
function booksMoney(minor,currency='TZS'){return minor==null?'—':moneyDisplay(Number(minor),currency);}
function booksCustomer(id){return (typeof orgIndex!=='undefined'&&orgIndex.get(id)?.name)||(organizations||[]).find(o=>o.id===id)?.name||'Customer not loaded';}
function booksAccountLabel(account){return account?`${account.code} · ${account.name}`:'Unknown account';}

// A journal draft: lines [{accountId, debit, credit, description}] with amounts as typed. Returns totals and the first problem.
function booksJournalCheck(lines){
 let debit=0,credit=0,used=0,problem='';
 lines.forEach((line,index)=>{
  const hasDebit=String(line.debit||'').trim()!=='',hasCredit=String(line.credit||'').trim()!=='';
  if(!line.accountId&&!hasDebit&&!hasCredit)return;
  used++;
  try{
   const d=hasDebit?moneyMinor(line.debit):0,c=hasCredit?moneyMinor(line.credit):0;
   if(!line.accountId&&!problem)problem=`Line ${index+1}: choose an account.`;
   if((d>0)===(c>0)&&!problem)problem=`Line ${index+1}: enter either a debit or a credit.`;
   debit+=d;credit+=c;
  }catch(error){if(!problem)problem=`Line ${index+1}: ${error.message}`;}
 });
 if(!problem&&used<2)problem='An entry needs at least two lines.';
 if(!problem&&debit!==credit)problem=`Debits and credits differ by ${moneyDisplay(Math.abs(debit-credit))}.`;
 return {debit,credit,difference:debit-credit,problem};
}
// Spread a receipt over a customer's invoices, oldest due first.
function booksAllocateOldest(amountMinor,openInvoices){
 let left=amountMinor;const out=new Map();
 for(const invoice of [...openInvoices].sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.invoice_number.localeCompare(b.invoice_number))){
  if(left<=0)break;const take=Math.min(left,invoice.outstanding);if(take>0){out.set(invoice.id,take);left-=take;}
 }
 return out;
}
function booksCsv(columns,rows){
 const cell=v=>{let s=String(v??'');if(typeof v==='string'&&(/^[\s\u0000-\u001f]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s)))s="'"+s;return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
 return [columns.map(([,label])=>cell(label)).join(','),...rows.map(row=>columns.map(([key])=>cell(row[key])).join(','))].join('\n');
}
function booksDownload(name,text){
 const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));link.download=name;document.body.append(link);link.click();
 setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove();},1000);
}
async function booksRpc(name,args){
 const r=await client.rpc(name,args);
 if(r.error)throw Error(r.error.message);
 return r.data;
}
async function booksSelect(table,columns,build){
 let query=client.from(table).select(columns);if(build)query=build(query);
 const r=await query;if(r.error)throw Error(`${table.replace('acc_','').replace(/_/g,' ')} could not load: ${r.error.message}`);
 return r.data||[];
}
// Keep requesting pages until empty, including when the server caps a page below our requested size.
async function booksSelectAll(table,columns,build){
 const rows=[];
 for(;;){const page=await booksSelect(table,columns,q=>(build?build(q):q).range(rows.length,rows.length+499));if(!page.length)return rows;rows.push(...page);}
}
async function loadBooksData(){
 const [accounts,settings,invoices,receipts,allocations,toInvoice,taxIds]=await Promise.all([
  booksSelectAll('acc_accounts','*',q=>q.order('code')),
  booksSelect('acc_settings','*'),
  booksSelectAll('acc_invoice_balances','*',q=>q.order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false})),
  booksSelectAll('acc_receipts','*',q=>q.order('receipt_date',{ascending:false}).order('receipt_number',{ascending:false})),
  booksSelectAll('acc_receipt_allocations','*',q=>q.order('receipt_id').order('invoice_id')),
  booksSelectAll('acc_waiting_proformas','*',q=>q.order('accepted_at',{ascending:false}).order('id')),
  booksSelectAll('acc_customer_tax_ids','*',q=>q.order('organization_id'))
 ]);
 const today=booksToday();
 for(const invoice of invoices){invoice.paid=Number(invoice.paid_minor);invoice.outstanding=Number(invoice.outstanding_minor);invoice.state={key:invoice.status_key,label:invoice.status_label};}
 return {accounts,settings:settings[0]||{version:1,locked_through:null},invoices,receipts,allocations,proformaNumbers:new Map(invoices.map(i=>[i.proforma_id,i.proforma_number])),taxIds:new Map(taxIds.map(t=>[t.organization_id,t])),toInvoice,today};
}
async function booksWorkspace(){
 const actor=await requireAccountingAccess(client,()=>me),epoch=++booksEpoch;
 const current=()=>me?.user_id===actor&&view==='books'&&epoch===booksEpoch;
 if(!current())return;
 $('#content').innerHTML='<p role="status">Loading the books…</p>';
 const data=await loadBooksData();
 if(!current())return;
 booksData=data;
 const body={overview:booksOverview,invoices:booksInvoices,receipts:booksReceipts,journal:booksJournal,accounts:booksAccounts,reports:booksReports,import:financialImportWorkspace}[booksSection]||booksOverview;
 $('#content').innerHTML=`<section class="books"><div class="heading"><div><small>ACCOUNTS</small><h1>Books</h1><p class="muted">Double-entry books in TZS. Posted entries are never edited; mistakes are reversed or voided. ${data.settings.locked_through?`Books locked through ${esc(data.settings.locked_through)}.`:'No lock date set.'}</p></div></div>
 <div class="tabs" role="group" aria-label="Books sections">${booksSections.map(([key,label])=>`<button type="button" data-books-section="${key}"${key===booksSection?' class="active" aria-pressed="true"':' aria-pressed="false"'}>${esc(label)}</button>`).join('')}</div>
 <div id="booksBody"></div></section>`;
 document.querySelectorAll('[data-books-section]').forEach(button=>button.onclick=()=>run(()=>{if(button.dataset.booksSection!==booksSection&&typeof financialImportConfirmLeave==='function'&&!financialImportConfirmLeave())return;openBooksSection(button.dataset.booksSection);syncWorkspaceNavigation();return booksWorkspace();}));
 await body(actor,current);
}
async function booksOverview(actor,current){
 const d=booksData,today=d.today;
 const [tb,pl]=await Promise.all([booksRpc('acc_trial_balance',{p_as_of:today}),booksRpc('acc_profit_and_loss',{p_from:booksMonthStart(today),p_to:today})]);
 if(!current())return;
 const balance=key=>{const account=d.accounts.find(a=>a.system_key===key);const row=account&&tb.find(r=>r.account_id===account.id);return row?Number(row.debit_minor)-Number(row.credit_minor):0;};
 const money=['cash','bank','mobile_money'].reduce((s,k)=>s+balance(k),0);
 const income=pl.filter(r=>r.account_type==='income').reduce((s,r)=>s+Number(r.amount_minor),0),expense=pl.filter(r=>r.account_type==='expense').reduce((s,r)=>s+Number(r.amount_minor),0);
 const overdue=d.invoices.filter(i=>i.state.key==='overdue');
 $('#booksBody').innerHTML=`<div class="books-metrics">
  <div><small>Cash, bank and mobile money</small><strong>${booksMoney(money)}</strong></div>
  <div><small>Customers owe</small><strong>${booksMoney(balance('receivables'))}</strong></div>
  <div><small>VAT output payable</small><strong>${booksMoney(-balance('vat_output'))}</strong></div>
  <div><small>Profit this month</small><strong>${booksMoney(income-expense)}</strong></div></div>
 <section class="card"><h2>Accepted Pro formas waiting for an invoice (${d.toInvoice.length})</h2><p class="muted">A Pro forma becomes an invoice by itself when Sales presses Submit to accounting. Any listed here could not be invoiced then (for example the books were locked for that date, or it is not in TZS).</p>${d.toInvoice.length?`<div class="table-wrap"><table><thead><tr><th>Pro forma</th><th>Customer</th><th>Accepted</th><th>Total</th><th></th></tr></thead><tbody>${d.toInvoice.slice(0,20).map(p=>`<tr><td>${esc(p.document_number)}</td><td>${esc(booksCustomer(p.organization_id))}</td><td>${esc(String(p.accepted_at||'').slice(0,10))}</td><td>${booksMoney(p.total_minor,p.currency)}</td><td><button type="button" data-books-invoice-pf="${esc(p.id)}">Create invoice</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Every accepted Pro forma has an invoice.</p>'}</section>
 <section class="card"><h2>Overdue invoices (${overdue.length})</h2>${overdue.length?booksInvoiceTable(overdue.slice(0,20)):'<p class="empty">No overdue invoices.</p>'}</section>`;
 document.querySelectorAll('[data-books-invoice-pf]').forEach(b=>b.onclick=()=>run(()=>{booksSection='invoices';booksDraft={proformaId:b.dataset.booksInvoicePf};return booksWorkspace();}));
 wireBooksInvoiceActions();
}
function booksInvoiceTable(rows){
 return `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date · due</th><th>Customer</th><th>Total</th><th>Paid</th><th>Owed</th><th>Status</th><th>TRA receipt</th><th></th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.invoice_number)}<small>${esc(booksData.proformaNumbers?.get(i.proforma_id)||'')}</small></td><td>${esc(i.invoice_date)}<small>due ${esc(i.due_date)}</small></td><td>${esc(booksCustomer(i.organization_id))}</td><td>${booksMoney(i.total_minor)}</td><td>${booksMoney(i.paid)}</td><td>${booksMoney(i.outstanding)}</td><td><span class="tag books-${i.state.key}">${esc(i.state.label)}</span></td><td>${i.tra_receipt_number?esc(i.tra_receipt_number):i.voided_at?'':'<span class="tag books-overdue">Not recorded</span>'}</td><td class="actions"><button type="button" data-books-print-invoice="${esc(i.id)}">Print</button>${i.voided_at?'':`<button type="button" data-books-fiscal="${esc(i.id)}">${i.tra_receipt_number?'Edit TRA receipt':'Record TRA receipt'}</button><button type="button" class="danger" data-books-void-invoice="${esc(i.id)}">Void</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}
function wireBooksInvoiceActions(){
 document.querySelectorAll('[data-books-print-invoice]').forEach(b=>b.onclick=()=>booksPrintInvoice(booksData.invoices.find(i=>i.id===b.dataset.booksPrintInvoice)));
 document.querySelectorAll('[data-books-fiscal]').forEach(b=>b.onclick=()=>booksFiscalPrompt(booksData.invoices.find(i=>i.id===b.dataset.booksFiscal)));
 document.querySelectorAll('[data-books-void-invoice]').forEach(b=>b.onclick=()=>booksVoidPrompt('invoice',booksData.invoices.find(i=>i.id===b.dataset.booksVoidInvoice)));
}
// The TRA receipt for an invoice and the customer's TIN and VRN, as printed on the tax invoice.
function booksFiscalPrompt(invoice){
 if(!invoice)return;
 const saved=booksData.taxIds?.get(invoice.organization_id)||{};
 const box=document.createElement('section');box.className='card books-void';
 box.innerHTML=`<h2>TRA receipt for ${esc(invoice.invoice_number)}</h2><p class="muted">${esc(booksCustomer(invoice.organization_id))} · ${booksMoney(invoice.total_minor)}. Type the receipt as issued by the TRA system. The customer's TIN and VRN are saved for their next invoice too.</p><form id="booksFiscalForm"><div class="grid">
  <label><span>TRA receipt number</span><input name="receipt" required maxlength="60" value="${esc(invoice.tra_receipt_number||'')}"></label>
  <label><span>Verification code · optional</span><input name="code" maxlength="60" value="${esc(invoice.tra_verification_code||'')}"></label>
  <label><span>Customer TIN</span><input name="tin" maxlength="16" placeholder="100-113-473" value="${esc(invoice.buyer_tin||saved.tin||'')}"></label>
  <label><span>Customer VRN · if VAT registered</span><input name="vrn" maxlength="20" placeholder="10-001061-P" value="${esc(invoice.buyer_vrn||saved.vrn||'')}"></label></div>
  <div class="actions"><button type="submit">Save TRA receipt</button><button type="button" id="booksFiscalCancel">Cancel</button></div></form>`;
 $('#booksBody').prepend(box);box.scrollIntoView({block:'start'});
 $('#booksFiscalCancel').onclick=()=>box.remove();
 $('#booksFiscalForm').onsubmit=event=>{event.preventDefault();const f=new FormData(event.target);run(async()=>{
  await booksRpc('record_invoice_fiscal',{p_invoice_id:invoice.id,p_receipt_number:f.get('receipt'),p_verification_code:f.get('code'),p_buyer_tin:f.get('tin'),p_buyer_vrn:f.get('vrn')});
  message(`TRA receipt saved on ${invoice.invoice_number}.`);await booksWorkspace();
 });};
}
function booksVoidPrompt(kind,record){
 if(!record)return;
 const number=kind==='invoice'?record.invoice_number:record.receipt_number;
 const box=document.createElement('section');box.className='card books-void';
 box.innerHTML=`<h2>Void ${esc(number)}</h2><p>Voiding posts a reversing entry dated below. The original stays in the books.${kind==='invoice'?' Void its receipts first if any were paid against it.':''}</p><form id="booksVoidForm"><div class="grid"><label><span>Date of the reversal</span><input name="date" type="date" required value="${esc(booksData.today)}"></label><label><span>Reason (at least 5 characters)</span><input name="reason" required minlength="5" maxlength="300"></label></div><div class="actions"><button type="submit">Void ${esc(number)}</button><button type="button" id="booksVoidCancel">Cancel</button></div></form>`;
 $('#booksBody').prepend(box);box.scrollIntoView({block:'start'});
 $('#booksVoidCancel').onclick=()=>box.remove();
 $('#booksVoidForm').onsubmit=event=>{event.preventDefault();const f=new FormData(event.target);run(async()=>{
  await booksRpc(kind==='invoice'?'void_invoice':'void_receipt',kind==='invoice'?{p_invoice_id:record.id,p_date:f.get('date'),p_reason:f.get('reason')}:{p_receipt_id:record.id,p_date:f.get('date'),p_reason:f.get('reason')});
  message(`${number} voided.`);await booksWorkspace();
 });};
}
async function booksInvoices(){
 const d=booksData,chosen=booksDraft?.proformaId||'';
 $('#booksBody').innerHTML=`<section class="card"><h2>Invoice a waiting Pro forma</h2><p class="muted">Normally not needed: Submit to accounting makes the invoice. Use this only for an accepted Pro forma still waiting.</p>${d.toInvoice.length?`<form id="booksInvoiceForm"><div class="grid">
  <label class="wide"><span>Accepted Pro forma</span><select name="proforma" required><option value="">Choose</option>${d.toInvoice.map(p=>`<option value="${esc(p.id)}"${p.id===chosen?' selected':''}>${esc(p.document_number)} · ${esc(booksCustomer(p.organization_id))} · ${esc(booksMoney(p.total_minor,p.currency))}</option>`).join('')}</select></label>
  <label><span>Invoice date</span><input name="date" type="date" required value="${esc(d.today)}"></label>
  <label><span>Due date</span><input name="due" type="date" required value="${esc(booksAddDays(d.today,30))}"></label>
  <label class="wide"><span>Reference · optional</span><input name="taxref" maxlength="80"></label></div>
  <p class="muted">Posts: customer owes the total; sales gets the amount after discount; VAT goes to VAT output payable.</p>
  <div class="actions"><button type="submit">Post invoice</button></div></form>`:'<p class="empty">No accepted Pro formas are waiting for an invoice.</p>'}</section>
 <section class="card"><div class="heading"><h2>Invoices (${d.invoices.length})</h2><button type="button" id="booksInvoicesCsv">Download CSV</button></div>${d.invoices.length?booksInvoiceTable(d.invoices):'<p class="empty">No invoices yet.</p>'}</section>`;
 const form=$('#booksInvoiceForm');
 if(form){const id=crypto.randomUUID();form.onsubmit=event=>{event.preventDefault();const f=new FormData(form);run(async()=>{
  const r=await booksRpc('create_invoice_from_proforma',{p_id:id,p_proforma_id:f.get('proforma'),p_invoice_date:f.get('date'),p_due_date:f.get('due'),p_tax_reference:f.get('taxref')||''});
  booksDraft=null;message(`${r.invoice_number} posted.`);await booksWorkspace();
 });};}
 $('#booksInvoicesCsv').onclick=()=>booksDownload(`invoices-${d.today}.csv`,booksCsv([['invoice_number','Invoice'],['invoice_date','Date'],['due_date','Due'],['customer','Customer'],['tra_receipt_number','TRA receipt'],['buyer_tin','Customer TIN'],['total','Total'],['paid','Paid'],['owed','Owed'],['status','Status']],
  d.invoices.map(i=>({...i,customer:booksCustomer(i.organization_id),total:(Number(i.total_minor)/100).toFixed(2),paid:(i.paid/100).toFixed(2),owed:(i.outstanding/100).toFixed(2),status:i.state.label}))));
 wireBooksInvoiceActions();
}
function booksClearPrint(){
 document.body.classList.remove('books-printing');
 document.querySelectorAll('.books-print-active').forEach(area=>area.classList.remove('books-print-active'));
}
function booksPrint(area){
 booksClearPrint();area.classList.add('books-print-active');document.body.classList.add('books-printing');
 try{window.print();}finally{booksClearPrint();}
}
// One invoice line: amount after discount and its VAT, from the snapshot taken when the invoice was made.
function booksInvoiceLineAmounts(line){
 const gross=Number(line.quantity||0)*Number(line.unit_price_minor||0),discount=Math.round(gross*Number(line.discount_basis_points||0)/10000),net=gross-discount;
 return {net,vat:Math.round(net*Number(line.tax_basis_points||0)/10000)};
}
function booksPrintInvoice(invoice){
 if(!invoice)return;
 const lines=Array.isArray(invoice.lines)?invoice.lines:[];
 const brand=typeof companyFormBrand==='function'?companyFormBrand('sales'):'<header><strong>ANUDHA LIMITED</strong><br>TIN: 100-113-473 · VRN: 10-001061-P</header>';
 document.querySelectorAll('.books-print').forEach(area=>area.remove());
 const area=document.createElement('section');area.className='books-print';
 area.innerHTML=`${brand}<div class="books-print-title"><h2>TAX INVOICE ${esc(invoice.invoice_number)}</h2>${invoice.voided_at?'<b>VOID</b>':''}</div>
 <div class="books-print-parties"><div><small>Bill to</small><strong>${esc(booksCustomer(invoice.organization_id))}</strong><span>TIN: ${esc(invoice.buyer_tin||booksData.taxIds?.get(invoice.organization_id)?.tin||'—')}</span><span>VRN: ${esc(invoice.buyer_vrn||booksData.taxIds?.get(invoice.organization_id)?.vrn||'—')}</span></div>
 <div><small>Invoice</small><span>Date: ${esc(invoice.invoice_date)}</span><span>Due: ${esc(invoice.due_date)}</span><span>Pro forma: ${esc(booksData.proformaNumbers?.get(invoice.proforma_id)||'')}</span></div></div>
 <table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Amount</th><th>VAT</th><th>VAT amount</th></tr></thead><tbody>${lines.map(l=>{const a=booksInvoiceLineAmounts(l);return `<tr><td>${esc(l.description)}</td><td>${esc(l.quantity)} ${esc(l.uom||'')}</td><td>${booksMoney(l.unit_price_minor)}</td><td>${Number(l.discount_basis_points||0)/100}%</td><td>${booksMoney(a.net)}</td><td>${Number(l.tax_basis_points||0)/100}%</td><td>${booksMoney(a.vat)}</td></tr>`;}).join('')}</tbody></table>
 <dl><dt>Subtotal</dt><dd>${booksMoney(invoice.subtotal_minor)}</dd><dt>Discount</dt><dd>${booksMoney(invoice.discount_minor)}</dd><dt>Amount before VAT</dt><dd>${booksMoney(Number(invoice.subtotal_minor)-Number(invoice.discount_minor))}</dd><dt>VAT</dt><dd>${booksMoney(invoice.tax_minor)}</dd><dt>Total</dt><dd><strong>${booksMoney(invoice.total_minor)}</strong></dd><dt>Paid</dt><dd>${booksMoney(invoice.paid)}</dd><dt>Balance due</dt><dd><strong>${booksMoney(invoice.outstanding)}</strong></dd></dl>
 <p class="books-print-fiscal">${invoice.tra_receipt_number?`TRA receipt: <strong>${esc(invoice.tra_receipt_number)}</strong>${invoice.tra_verification_code?` · Verification code: ${esc(invoice.tra_verification_code)}`:''}`:'<span class="error">TRA receipt not yet recorded</span>'}</p>
 <div class="actions no-print"><button type="button" id="booksPrintNow">Print / PDF</button><button type="button" id="booksPrintClose">Close</button></div>`;
 $('#booksBody').prepend(area);area.scrollIntoView({block:'start'});
 $('#booksPrintClose').onclick=()=>{booksClearPrint();area.remove();};
 $('#booksPrintNow').onclick=()=>booksPrint(area);
}
// Money accounts: cash, bank and mobile money (codes 1100–1299), never receivables.
function booksDepositAccounts(){return booksData.accounts.filter(a=>a.active&&a.account_type==='asset'&&a.system_key!=='receivables'&&/^1[12]\d\d$/.test(a.code));}
async function booksReceipts(){
 const d=booksData,draft=booksDraft?.receipt||{organizationId:'',amount:'',method:'bank'};
 const openFor=org=>d.invoices.filter(i=>i.organization_id===org&&!i.voided_at&&i.outstanding>0);
 const deposits=booksDepositAccounts();
 $('#booksBody').innerHTML=`<section class="card"><h2>Record money received from a customer</h2><form id="booksReceiptForm"><div class="grid">
  <label class="wide"><span>Customer</span><select name="organization" required data-lookup-rows="organizations"><option value="">Choose client / branch</option>${typeof salesOrganizationOptions==='function'?salesOrganizationOptions():''}</select></label>
  <label><span>Date received</span><input name="date" type="date" required value="${esc(d.today)}"></label>
  <label><span>Amount (TZS)</span><input name="amount" inputmode="decimal" required placeholder="e.g. 1500000"></label>
  <label><span>How it was paid</span><select name="method">${booksMethods.map(([k,l])=>`<option value="${k}"${k===draft.method?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
  <label><span>Paid into</span><select name="deposit" required>${deposits.map(a=>`<option value="${esc(a.id)}"${a.system_key==='bank'?' selected':''}>${esc(booksAccountLabel(a))}</option>`).join('')}</select></label>
  <label class="wide"><span>Reference (bank slip, M-Pesa code, cheque number) · optional</span><input name="reference" maxlength="120"></label></div>
  <div id="booksAllocation"><p class="muted">Choose a customer to see what they owe.</p></div>
  <p id="booksReceiptCheck" class="muted"></p>
  <div class="actions"><button type="submit">Record receipt</button></div></form></section>
 <section class="card"><div class="heading"><h2>Receipts (${d.receipts.length})</h2><button type="button" id="booksReceiptsCsv">Download CSV</button></div>${d.receipts.length?`<div class="table-wrap"><table><thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Method · reference</th><th>Amount</th><th>Applied to</th><th></th></tr></thead><tbody>${d.receipts.map(r=>`<tr><td>${esc(r.receipt_number)}${r.voided_at?'<small>Void</small>':''}</td><td>${esc(r.receipt_date)}</td><td>${esc(booksCustomer(r.organization_id))}</td><td>${esc(booksMethods.find(([k])=>k===r.method)?.[1]||r.method)}<small>${esc(r.reference)}</small></td><td>${booksMoney(r.amount_minor)}</td><td>${d.allocations.filter(a=>a.receipt_id===r.id).map(a=>`${esc(d.invoices.find(i=>i.id===a.invoice_id)?.invoice_number||'Invoice')} ${booksMoney(a.amount_minor)}`).join('<br>')||'<small>Customer credit</small>'}</td><td>${r.voided_at?'':`<button type="button" class="danger" data-books-void-receipt="${esc(r.id)}">Void</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No receipts yet.</p>'}</section>`;
 const form=$('#booksReceiptForm'),id=crypto.randomUUID();
 const allocationInputs=()=>[...document.querySelectorAll('[data-books-allocate]')];
 const check=()=>{
  let amount=0,applied=0,problem='';
  try{amount=form.amount.value.trim()?moneyMinor(form.amount.value):0;}catch(error){problem=`Amount: ${error.message}`;}
  for(const input of allocationInputs()){if(!input.value.trim())continue;try{applied+=moneyMinor(input.value);}catch(error){problem=problem||`Allocation: ${error.message}`;}}
  if(!problem&&applied>amount)problem='The amounts applied add up to more than the amount received.';
  $('#booksReceiptCheck').textContent=problem||(amount?`Applied ${moneyDisplay(applied)} · left as customer credit ${moneyDisplay(amount-applied)}`:'');
  $('#booksReceiptCheck').className=problem?'error':'muted';
  return {amount,problem};
 };
 const showOpen=()=>{
  const open=openFor(form.organization.value);
  $('#booksAllocation').innerHTML=!form.organization.value?'<p class="muted">Choose a customer to see what they owe.</p>':open.length?`<h3>Apply to invoices</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Due</th><th>Owed</th><th>Apply (TZS)</th></tr></thead><tbody>${open.map(i=>`<tr><td>${esc(i.invoice_number)}</td><td>${esc(i.due_date)}</td><td>${booksMoney(i.outstanding)}</td><td><input data-books-allocate="${esc(i.id)}" inputmode="decimal" aria-label="Amount applied to ${esc(i.invoice_number)}"></td></tr>`).join('')}</tbody></table></div><button type="button" id="booksOldestFirst">Apply to oldest invoices first</button>`:'<p class="muted">This customer has no unpaid invoices. The receipt will be kept as a customer credit.</p>';
  const oldest=$('#booksOldestFirst');
  if(oldest)oldest.onclick=()=>{const {amount,problem}=check();if(problem&&!amount)return;const plan=booksAllocateOldest(amount,open);allocationInputs().forEach(input=>{const v=plan.get(input.dataset.booksAllocate);input.value=v?(v/100).toFixed(2):'';});check();};
  allocationInputs().forEach(input=>input.oninput=check);check();
 };
 form.organization.onchange=showOpen;form.amount.oninput=check;showOpen();
 form.onsubmit=event=>{event.preventDefault();const {amount,problem}=check();if(problem){message(problem,true);return;}if(!amount){message('Enter the amount received.',true);return;}
  const allocations=allocationInputs().filter(i=>i.value.trim()).map(i=>({invoice_id:i.dataset.booksAllocate,amount_minor:moneyMinor(i.value)}));
  run(async()=>{const r=await booksRpc('record_receipt',{p_id:id,p_organization_id:form.organization.value,p_date:form.date.value,p_amount_minor:amount,p_method:form.method.value,p_reference:form.reference.value,p_deposit_account_id:form.deposit.value,p_allocations:allocations});
   message(`${r.receipt_number} recorded.`);await booksWorkspace();});};
 document.querySelectorAll('[data-books-void-receipt]').forEach(b=>b.onclick=()=>booksVoidPrompt('receipt',d.receipts.find(r=>r.id===b.dataset.booksVoidReceipt)));
 $('#booksReceiptsCsv').onclick=()=>booksDownload(`receipts-${d.today}.csv`,booksCsv([['receipt_number','Receipt'],['receipt_date','Date'],['customer','Customer'],['method','Method'],['reference','Reference'],['amount','Amount'],['status','Status']],
  d.receipts.map(r=>({...r,customer:booksCustomer(r.organization_id),amount:(Number(r.amount_minor)/100).toFixed(2),status:r.voided_at?'Void':'Recorded'}))));
}
async function booksJournal(actor,current){
 const d=booksData;
 const entries=await booksSelect('acc_journal_entries','*',q=>q.order('entry_date',{ascending:false}).order('entry_number',{ascending:false}).limit(100));
 const lines=entries.length?await booksSelectAll('acc_journal_lines','*',q=>q.in('entry_id',entries.map(e=>e.id)).order('entry_id').order('line_no')):[];
 if(!current())return;
 const reversed=new Set(entries.filter(e=>e.reverses_entry_id).map(e=>e.reverses_entry_id));
 const draft=booksDraft?.journal||{date:d.today,memo:'',lines:[{},{}]};
 const active=d.accounts.filter(a=>a.active);
 const lineRow=(line,i)=>`<tr><td><select data-jl="accountId" data-i="${i}" aria-label="Account, line ${i+1}"><option value="">Choose account</option>${booksTypes.map(([type,label])=>`<optgroup label="${label}">${active.filter(a=>a.account_type===type).map(a=>`<option value="${esc(a.id)}"${a.id===line.accountId?' selected':''}>${esc(booksAccountLabel(a))}</option>`).join('')}</optgroup>`).join('')}</select></td><td><input data-jl="debit" data-i="${i}" inputmode="decimal" value="${esc(line.debit||'')}" aria-label="Debit, line ${i+1}"></td><td><input data-jl="credit" data-i="${i}" inputmode="decimal" value="${esc(line.credit||'')}" aria-label="Credit, line ${i+1}"></td><td><input data-jl="description" data-i="${i}" maxlength="300" value="${esc(line.description||'')}" aria-label="Note, line ${i+1}"></td></tr>`;
 $('#booksBody').innerHTML=`<section class="card"><h2>New journal entry</h2><p class="muted">For anything that is not a customer invoice or receipt: expenses, supplier bills, salaries, opening balances, depreciation. Debits must equal credits.</p><form id="booksJournalForm"><div class="grid"><label><span>Date</span><input name="date" type="date" required value="${esc(draft.date)}"></label><label><span>Description</span><input name="memo" required minlength="3" maxlength="500" value="${esc(draft.memo)}" placeholder="e.g. October office rent"></label></div>
 <div class="table-wrap"><table><thead><tr><th>Account</th><th>Debit (TZS)</th><th>Credit (TZS)</th><th>Note</th></tr></thead><tbody id="booksJournalLines">${draft.lines.map(lineRow).join('')}</tbody></table></div>
 <p id="booksJournalCheck" class="muted"></p><div class="actions"><button type="button" id="booksAddLine">Add line</button><button type="submit">Post entry</button></div></form></section>
 <section class="card"><h2>Recent entries</h2>${entries.length?entries.map(e=>`<article class="contact"><div class="heading"><div><strong>${esc(e.entry_number)} · ${esc(e.entry_date)}</strong><p>${esc(e.memo)}</p><small>${esc({manual:'Journal entry',invoice:'Customer invoice',receipt:'Customer receipt',reversal:'Reversal'}[e.source_type])} · by ${esc(typeof employeeName==='function'?employeeName(e.created_by):'')}</small></div>${e.source_type==='manual'&&!reversed.has(e.id)?`<button type="button" data-books-reverse="${esc(e.id)}">Reverse</button>`:reversed.has(e.id)?'<span class="tag">Reversed</span>':''}</div><div class="table-wrap"><table><tbody>${lines.filter(l=>l.entry_id===e.id).map(l=>`<tr><td>${esc(booksAccountLabel(d.accounts.find(a=>a.id===l.account_id)))}${l.organization_id?`<small>${esc(booksCustomer(l.organization_id))}</small>`:''}</td><td>${Number(l.debit_minor)?booksMoney(l.debit_minor):''}</td><td>${Number(l.credit_minor)?booksMoney(l.credit_minor):''}</td><td><small>${esc(l.description)}</small></td></tr>`).join('')}</tbody></table></div></article>`).join(''):'<p class="empty">No entries yet.</p>'}</section>`;
 const form=$('#booksJournalForm'),id=crypto.randomUUID();
 const read=()=>{const out=[];document.querySelectorAll('[data-jl]').forEach(input=>{const i=Number(input.dataset.i);out[i]=out[i]||{};out[i][input.dataset.jl]=input.value;});return out;};
 const check=()=>{const result=booksJournalCheck(read());$('#booksJournalCheck').textContent=result.problem||`Balanced: ${moneyDisplay(result.debit)} debit and credit.`;$('#booksJournalCheck').className=result.problem?'error':'muted';return result;};
 const save=()=>{booksDraft={journal:{date:form.date.value,memo:form.memo.value,lines:read()}};};
 form.oninput=check;check();
 $('#booksAddLine').onclick=()=>{save();booksDraft.journal.lines.push({});booksJournal(actor,current);};
 form.onsubmit=event=>{event.preventDefault();const result=check();if(result.problem){message(result.problem,true);return;}
  const posted=read().filter(l=>l.accountId||String(l.debit||'').trim()||String(l.credit||'').trim()).map(l=>({account_id:l.accountId,debit_minor:String(l.debit||'').trim()?moneyMinor(l.debit):0,credit_minor:String(l.credit||'').trim()?moneyMinor(l.credit):0,description:l.description||''}));
  run(async()=>{const r=await booksRpc('post_manual_journal',{p_id:id,p_date:form.date.value,p_memo:form.memo.value,p_lines:posted});booksDraft=null;message(`${r.entry_number} posted.`);await booksWorkspace();});};
 document.querySelectorAll('[data-books-reverse]').forEach(b=>b.onclick=()=>{
  const entry=entries.find(e=>e.id===b.dataset.booksReverse);const box=document.createElement('form');box.className='card';
  box.innerHTML=`<h3>Reverse ${esc(entry.entry_number)}</h3><div class="grid"><label><span>Date of the reversal</span><input name="date" type="date" required value="${esc(d.today)}"></label><label><span>Reason (at least 5 characters)</span><input name="reason" required minlength="5" maxlength="300"></label></div><div class="actions"><button type="submit">Post reversal</button></div>`;
  b.closest('article').append(box);b.disabled=true;const reversalId=crypto.randomUUID();
  box.onsubmit=event=>{event.preventDefault();run(async()=>{const r=await booksRpc('reverse_journal_entry',{p_id:reversalId,p_entry_id:entry.id,p_date:box.date.value,p_reason:box.reason.value});message(`${r.entry_number} posted.`);await booksWorkspace();});};
 });
}
async function booksAccounts(actor,current){
 const d=booksData,tb=await booksRpc('acc_trial_balance',{p_as_of:d.today});
 if(!current())return;
 const bal=id=>{const r=tb.find(x=>x.account_id===id);return r?Number(r.debit_minor)-Number(r.credit_minor):0;};
 const editing=booksDraft?.account||null;
 $('#booksBody').innerHTML=`<section class="card"><h2>${editing?.version?`Edit ${esc(editing.code)}`:'Add an account'}</h2><p class="muted">Standard starting list; ask the accountant to match it to the TallyPrime ledgers. Accounts used by automatic postings cannot be switched off.</p><form id="booksAccountForm"><div class="grid">
  <label><span>Code (4 to 6 digits)</span><input name="code" required pattern="[0-9]{4,6}" value="${esc(editing?.code||'')}"></label>
  <label><span>Name</span><input name="name" required minlength="2" maxlength="120" value="${esc(editing?.name||'')}"></label>
  <label><span>Type</span><select name="type">${booksTypes.map(([k,l])=>`<option value="${k}"${k===(editing?.account_type||'expense')?' selected':''}>${esc(l.replace(/s$/,''))}</option>`).join('')}</select></label>
  <label><span>In use</span><select name="active"><option value="true"${editing?.active===false?'':' selected'}>Yes</option><option value="false"${editing?.active===false?' selected':''}>No (hidden from new entries)</option></select></label></div>
  <div class="actions"><button type="submit">${editing?.version?'Save changes':'Add account'}</button>${editing?'<button type="button" id="booksAccountCancel">Cancel</button>':''}</div></form></section>
 ${d.settings&&typeof me!=='undefined'&&me?.role==='owner'?`<section class="card"><h2>Lock the books</h2><p class="muted">Nothing can be posted on or before the lock date. Owner only.</p><form id="booksLockForm" class="actions"><input name="date" type="date" value="${esc(d.settings.locked_through||'')}" aria-label="Locked through"><button type="submit">Save lock date</button></form></section>`:''}
 ${booksTypes.map(([type,label])=>`<section class="card"><h2>${esc(label)}</h2><div class="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Balance today</th><th></th></tr></thead><tbody>${d.accounts.filter(a=>a.account_type===type).map(a=>`<tr${a.active?'':' class="muted"'}><td>${esc(a.code)}</td><td>${esc(a.name)}${a.system_key?'<small>Used by automatic postings</small>':''}${a.active?'':'<small>Not in use</small>'}</td><td>${booksMoney(['asset','expense'].includes(type)?bal(a.id):-bal(a.id))}</td><td><button type="button" data-books-edit-account="${esc(a.id)}">Edit</button> <button type="button" data-books-account-ledger="${esc(a.id)}">Ledger</button></td></tr>`).join('')}</tbody></table></div></section>`).join('')}`;
 const form=$('#booksAccountForm'),id=editing?.id||crypto.randomUUID();
 form.onsubmit=event=>{event.preventDefault();run(async()=>{await booksRpc('save_ledger_account',{p_id:id,p_expected_version:editing?.version??null,p_code:form.code.value,p_name:form.name.value,p_type:form.type.value,p_active:form.active.value==='true'});booksDraft=null;message('Account saved.');await booksWorkspace();});};
 if($('#booksAccountCancel'))$('#booksAccountCancel').onclick=()=>run(()=>{booksDraft=null;return booksWorkspace();});
 const lock=$('#booksLockForm');if(lock)lock.onsubmit=event=>{event.preventDefault();run(async()=>{await booksRpc('set_books_lock',{p_expected_version:d.settings.version,p_locked_through:lock.date.value||null});message(lock.date.value?`Books locked through ${lock.date.value}.`:'Lock date removed.');await booksWorkspace();});};
 document.querySelectorAll('[data-books-edit-account]').forEach(b=>b.onclick=()=>run(()=>{booksDraft={account:d.accounts.find(a=>a.id===b.dataset.booksEditAccount)};return booksWorkspace();}));
 document.querySelectorAll('[data-books-account-ledger]').forEach(b=>b.onclick=()=>run(()=>{booksSection='reports';booksReport={...booksReport,kind:'ledger',accountId:b.dataset.booksAccountLedger};booksDraft=null;syncWorkspaceNavigation();return booksWorkspace();}));
}
const booksReportKinds=[['trial','Trial balance'],['pl','Profit and loss'],['bs','Balance sheet'],['ageing','Customer ageing'],['ledger','Account ledger']];
async function booksReports(actor,current){
 const d=booksData,today=d.today,r=booksReport;
 r.asOf=r.asOf||today;r.from=r.from||booksMonthStart(today);r.to=r.to||today;
 const ranged=r.kind==='pl'||r.kind==='ledger';
 let columns=[],rows=[],totals='';
 if(r.kind==='trial'){rows=await booksRpc('acc_trial_balance',{p_as_of:r.asOf});columns=[['code','Code'],['name','Account'],['debit','Debit'],['credit','Credit']];
  const dr=rows.reduce((s,x)=>s+Number(x.debit_minor),0),cr=rows.reduce((s,x)=>s+Number(x.credit_minor),0);rows=rows.map(x=>({...x,debit:Number(x.debit_minor)?booksMoney(x.debit_minor):'',credit:Number(x.credit_minor)?booksMoney(x.credit_minor):''}));
  totals=`Total debits ${booksMoney(dr)} · total credits ${booksMoney(cr)}${dr===cr?' · balanced':' · NOT BALANCED'}`;}
 if(r.kind==='pl'){const raw=await booksRpc('acc_profit_and_loss',{p_from:r.from,p_to:r.to});const inc=raw.filter(x=>x.account_type==='income'),exp=raw.filter(x=>x.account_type==='expense');
  const ti=inc.reduce((s,x)=>s+Number(x.amount_minor),0),te=exp.reduce((s,x)=>s+Number(x.amount_minor),0);columns=[['section','Section'],['code','Code'],['name','Account'],['amount','Amount']];
  rows=[...inc.map(x=>({...x,section:'Income',amount:booksMoney(x.amount_minor)})),{section:'Income',name:'Total income',amount:booksMoney(ti)},...exp.map(x=>({...x,section:'Expenses',amount:booksMoney(x.amount_minor)})),{section:'Expenses',name:'Total expenses',amount:booksMoney(te)},{section:'Result',name:ti-te>=0?'Net profit':'Net loss',amount:booksMoney(ti-te)}];}
 if(r.kind==='bs'){const raw=await booksRpc('acc_balance_sheet',{p_as_of:r.asOf});const sum=t=>raw.filter(x=>x.account_type===t).reduce((s,x)=>s+Number(x.amount_minor),0);columns=[['section','Section'],['code','Code'],['name','Account'],['amount','Amount']];
  rows=booksTypes.slice(0,3).flatMap(([t,label])=>[...raw.filter(x=>x.account_type===t).map(x=>({...x,section:label,amount:booksMoney(x.amount_minor)})),{section:label,name:`Total ${label.toLowerCase()}`,amount:booksMoney(sum(t))}]);
  totals=`Assets ${booksMoney(sum('asset'))} · liabilities and equity ${booksMoney(sum('liability')+sum('equity'))}${sum('asset')===sum('liability')+sum('equity')?' · balanced':' · NOT BALANCED'}`;}
 if(r.kind==='ageing'){const raw=await booksRpc('acc_receivables_ageing',{p_as_of:r.asOf});columns=[['customer','Customer'],['cur','Not yet due'],['d30','1–30 days'],['d60','31–60'],['d90','61–90'],['d91','Over 90'],['credit','Unapplied credit'],['bal','Balance']];
  rows=raw.map(x=>({customer:x.customer,cur:booksMoney(x.current_minor),d30:booksMoney(x.days_1_30_minor),d60:booksMoney(x.days_31_60_minor),d90:booksMoney(x.days_61_90_minor),d91:booksMoney(x.days_over_90_minor),credit:booksMoney(x.unapplied_credit_minor),bal:booksMoney(x.balance_minor)}));
  totals=`Total owed ${booksMoney(raw.reduce((s,x)=>s+Number(x.balance_minor),0))}`;}
 if(r.kind==='ledger'){r.accountId=r.accountId||d.accounts.find(a=>a.system_key==='bank')?.id||'';const raw=r.accountId?await booksRpc('acc_account_ledger',{p_account_id:r.accountId,p_from:r.from,p_to:r.to}):[];
  columns=[['entry_date','Date'],['entry_number','Entry'],['memo','Description'],['debit','Debit'],['credit','Credit'],['balance','Balance']];
  rows=raw.map(x=>({...x,debit:Number(x.debit_minor)?booksMoney(x.debit_minor):'',credit:Number(x.credit_minor)?booksMoney(x.credit_minor):'',balance:booksMoney(x.balance_minor)}));}
 if(!current())return;
 const title=booksReportKinds.find(([k])=>k===r.kind)[1];
 $('#booksBody').innerHTML=`<section class="card"><form id="booksReportForm" class="grid"><label><span>Report</span><select name="kind">${booksReportKinds.map(([k,l])=>`<option value="${k}"${k===r.kind?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
 ${r.kind==='ledger'?`<label><span>Account</span><select name="account">${d.accounts.map(a=>`<option value="${esc(a.id)}"${a.id===r.accountId?' selected':''}>${esc(booksAccountLabel(a))}</option>`).join('')}</select></label>`:''}
 ${ranged?`<label><span>From</span><input name="from" type="date" value="${esc(r.from)}"></label><label><span>To</span><input name="to" type="date" value="${esc(r.to)}"></label>`:`<label><span>As at</span><input name="asOf" type="date" value="${esc(r.asOf)}"></label>`}
 <div class="actions wide"><button type="submit">Show report</button><button type="button" id="booksReportCsv">Download CSV</button><button type="button" id="booksReportPrint">Print / PDF</button></div></form></section>
 <section class="card books-report"><h2>${esc(title)}</h2><p class="muted">${ranged?`${esc(r.from)} to ${esc(r.to)}`:`As at ${esc(r.asOf)}`} · TZS</p>${rows.length?`<div class="table-wrap"><table><thead><tr>${columns.map(([,l])=>`<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr${x.code||x.entry_number||x.customer?'':' class="books-total"'}>${columns.map(([k])=>`<td>${esc(x[k]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="empty">Nothing posted for this report yet.</p>'}${totals?`<p><strong>${esc(totals)}</strong></p>`:''}</section>`;
 const form=$('#booksReportForm');
 form.onsubmit=event=>{event.preventDefault();run(()=>{booksReport={kind:form.kind.value,asOf:form.asOf?.value||r.asOf,from:form.from?.value||r.from,to:form.to?.value||r.to,accountId:form.account?.value||r.accountId};return booksWorkspace();});};
 form.kind.onchange=()=>form.requestSubmit();
 $('#booksReportCsv').onclick=()=>booksDownload(`${title.toLowerCase().replace(/\s+/g,'-')}-${ranged?r.to:r.asOf}.csv`,booksCsv(columns,rows));
 $('#booksReportPrint').onclick=()=>booksPrint(document.querySelector('.books-report'));
}
