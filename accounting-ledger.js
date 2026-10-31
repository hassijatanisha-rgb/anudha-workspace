'use strict';
// Books (migration 087): chart of accounts, journal entries, customer invoices from accepted Pro formas, customer
// receipts, lock date and reports. The database checks access, balance and permanence; this page only shows and asks.
let booksSection='overview',booksData=null,booksReport={kind:'trial',from:'',to:'',asOf:'',accountId:''},booksDraft=null,booksEpoch=0,booksInvoicePageData=null,booksInvoicePage=0,booksWaitingPage=0;
let booksTransactionPageData=null,booksTransactionPages={receipts:0,journal:0},booksTransactionSelected='',booksTransactionActor=null;
let booksInvoicePreview=null,booksInvoiceRecordData=null;
let booksAccountPageData=null,booksAccountSearch='',booksAccountType='',booksAccountPage=0,booksLedgerPageData=null,booksLedgerPage=0;
const booksSections=[['overview','Overview'],['invoices','Customer invoices'],['receipts','Customer receipts'],['journal','Journal entries'],['accounts','Chart of accounts'],['reports','Financial reports'],['import','Import Excel'],['opening','Opening receivables']];
const booksTypes=[['asset','Assets'],['liability','Liabilities'],['equity','Equity'],['income','Income'],['expense','Expenses']];
const booksMethods=[['bank','Bank transfer'],['cash','Cash'],['mobile_money','Mobile money'],['cheque','Cheque']];

function openBooksSection(section){booksSection=booksSections.some(([key])=>key===section)?section:'overview';booksDraft=null;booksTransactionSelected='';}
function clearBooks(){booksClearInvoicePreview();booksEpoch++;booksInvoiceRecordData=null;booksData=null;booksInvoicePageData=null;booksInvoicePage=0;booksWaitingPage=0;booksTransactionPageData=null;booksTransactionPages={receipts:0,journal:0};booksTransactionSelected='';booksTransactionActor=null;booksAccountPageData=null;booksAccountSearch='';booksAccountType='';booksAccountPage=0;booksLedgerPageData=null;booksLedgerPage=0;booksDraft=null;booksSection='overview';booksReport={kind:'trial',from:'',to:'',asOf:'',accountId:''};booksClearPrint();}
function booksTransactionLanding(){return ['receipts','journal'].includes(booksSection)&&!booksTransactionSelected;}
function booksToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function booksAddDays(date,days){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function booksMonthStart(date){return `${date.slice(0,7)}-01`;}
function booksMoney(minor,currency='TZS'){return minor==null?'—':moneyDisplay(Number(minor),currency);}
function booksCustomer(id,data=booksData){if(data?.customerNames)return data.customerNames.get(id)||'Customer not loaded';return (typeof orgIndex!=='undefined'&&orgIndex.get(id)?.name)||(organizations||[]).find(o=>o.id===id)?.name||'Customer not loaded';}
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
async function loadBooksData(section=booksSection){
 if(section==='overview'){
  const data=await booksRpc('acc_overview',{p_as_of:booksToday()});
  if(!data?.summary||!['money_minor','receivables_minor','vat_minor','profit_minor'].every(key=>Number.isSafeInteger(data.summary[key]))||!Number.isSafeInteger(data.settings?.version)||!/^\d{4}-\d{2}-\d{2}$/.test(data.today)||!Array.isArray(data.invoices)||data.invoices.length>20||!Array.isArray(data.to_invoice)||data.to_invoice.length>20||!Array.isArray(data.tax_ids)||!Number.isSafeInteger(data.overdue_count)||data.overdue_count<data.invoices.length||!Number.isSafeInteger(data.waiting_count)||data.waiting_count<data.to_invoice.length)throw Error('The accounts overview was incomplete. Refresh before relying on these balances.');
  if(!Number.isSafeInteger(data.unrecorded_tra_count)||data.unrecorded_tra_count<0||!Array.isArray(data.unrecorded_tra)||data.unrecorded_tra.length!==Math.min(20,data.unrecorded_tra_count)||new Set(data.unrecorded_tra.map(row=>row?.id)).size!==data.unrecorded_tra.length||data.unrecorded_tra.some(row=>typeof row?.id!=='string'||!row.id||typeof row.organization_id!=='string'||!row.organization_id||typeof row.invoice_number!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.invoice_date)||!Number.isSafeInteger(row.total_minor)||row.total_minor<0||row.voided_at!==null||row.opening_import_id!==null||typeof row.tra_receipt_number!=='string'||row.tra_receipt_number.trim()||!['tra_verification_code','buyer_tin','buyer_vrn'].every(key=>typeof row[key]==='string')))throw Error('The accounts overview was incomplete. Refresh before relying on these balances.');
  const invoices=data.invoices.map(invoice=>({...invoice,paid:Number(invoice.paid_minor),outstanding:Number(invoice.outstanding_minor),state:{key:invoice.status_key,label:invoice.status_label}}));
  const unrecordedTra=data.unrecorded_tra.map(row=>invoices.find(invoice=>invoice.id===row.id)||row);
  return {accounts:[],settings:data.settings,invoices,receipts:[],allocations:[],proformaNumbers:new Map(invoices.map(i=>[i.proforma_id,i.proforma_number])),taxIds:new Map(data.tax_ids.map(t=>[t.organization_id,t])),toInvoice:data.to_invoice,today:data.today,summary:data.summary,overdueCount:data.overdue_count,waitingCount:data.waiting_count,unrecordedTra,unrecordedTraCount:data.unrecorded_tra_count,customerNames:new Map([...invoices,...unrecordedTra,...data.to_invoice].map(row=>[row.organization_id,row.customer_name]))};
 }
 const [accounts,settings,invoices,receipts,allocations,toInvoice,taxIds]=await Promise.all([
  ['receipts','journal'].includes(section)?booksSelectAll('acc_accounts','*',q=>q.order('code')):[],
  booksSelect('acc_settings','*'),
  ['invoices','receipts'].includes(section)?booksSelectAll('acc_invoice_balances','*',q=>q.order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false})):[],
  section==='receipts'?booksSelectAll('acc_receipts','*',q=>q.order('receipt_date',{ascending:false}).order('receipt_number',{ascending:false})):[],
  section==='receipts'?booksSelectAll('acc_receipt_allocations','*',q=>q.order('receipt_id').order('invoice_id')):[],
  section==='invoices'?booksSelectAll('acc_waiting_proformas','*',q=>q.order('accepted_at',{ascending:false}).order('id')):[],
  section==='invoices'?booksSelectAll('acc_customer_tax_ids','*',q=>q.order('organization_id')):[]
 ]);
 const today=booksToday();
 for(const invoice of invoices){invoice.paid=Number(invoice.paid_minor);invoice.outstanding=Number(invoice.outstanding_minor);invoice.state={key:invoice.status_key,label:invoice.status_label};}
 return {accounts,settings:settings[0]||{version:1,locked_through:null},invoices,receipts,allocations,proformaNumbers:new Map(invoices.map(i=>[i.proforma_id,i.proforma_number])),taxIds:new Map(taxIds.map(t=>[t.organization_id,t])),toInvoice,today};
}
function booksInvoiceAmounts(invoice){return {...invoice,paid:Number(invoice.paid_minor),outstanding:Number(invoice.outstanding_minor),state:{key:invoice.status_key,label:invoice.status_label}};}
function booksInvoicePageResult(data){
 if(!data?.summary||!['total_minor','paid_minor','credited_minor','outstanding_minor','customer_credit_minor'].every(key=>Number.isSafeInteger(data.summary[key]))||!Number.isSafeInteger(data.settings?.version)||!/^\d{4}-\d{2}-\d{2}$/.test(data.today)||!Array.isArray(data.invoices)||data.invoices.length>50||!Array.isArray(data.to_invoice)||data.to_invoice.length>20||!Array.isArray(data.tax_ids)||!['invoice_count','waiting_count','invoice_page','waiting_page'].every(key=>Number.isSafeInteger(data[key])&&data[key]>=0)||data.invoice_page>=Math.max(1,Math.ceil(data.invoice_count/50))||data.waiting_page>=Math.max(1,Math.ceil(data.waiting_count/20))||data.invoices.length!==Math.min(50,Math.max(0,data.invoice_count-data.invoice_page*50))||data.to_invoice.length!==Math.min(20,Math.max(0,data.waiting_count-data.waiting_page*20)))throw Error('The invoice register was incomplete. Refresh before relying on these balances.');
 const invoices=data.invoices.map(booksInvoiceAmounts);
 return {settings:data.settings,today:data.today,summary:data.summary,invoices,toInvoice:data.to_invoice,taxIds:new Map(data.tax_ids.map(t=>[t.organization_id,t])),proformaNumbers:new Map(invoices.map(i=>[i.proforma_id,i.proforma_number])),customerNames:new Map([...invoices,...data.to_invoice].map(row=>[row.organization_id,row.customer_name])),invoiceCount:data.invoice_count,waitingCount:data.waiting_count,invoicePage:data.invoice_page,waitingPage:data.waiting_page};
}
async function loadBooksInvoicePage(){return booksInvoicePageResult(await booksRpc('acc_invoice_register',{p_invoice_page:booksInvoicePage,p_waiting_page:booksWaitingPage}));}
async function booksInvoiceRegister(actor,current){
 const d=booksInvoicePageData,session=me;if(!current())return;
 const pager=(kind,page,count,size)=>`<div class="actions"><button type="button" id="books${kind}Previous" ${page===0?'disabled':''}>Previous</button><span id="books${kind}PageStatus" tabindex="-1">Page ${page+1} of ${Math.max(1,Math.ceil(count/size))} · ${count} total</span><button type="button" id="books${kind}Next" ${(page+1)*size>=count?'disabled':''}>Next</button></div>`;
 $('#booksBody').innerHTML=`<section class="card"><div class="heading"><h2>Accepted Pro formas waiting for invoice (${d.waitingCount})</h2><button type="button" id="booksRegisterRefresh">Refresh</button></div><p class="muted">Open an order to review its latest quantities, available stock and approval details before posting.</p>${d.toInvoice.length?`<div class="table-wrap"><table><thead><tr><th>Pro forma</th><th>Customer</th><th class="numeric-cell">Quote total</th><th>Actions</th></tr></thead><tbody>${d.toInvoice.map(order=>`<tr><td>${esc(order.document_number)}</td><td>${esc(booksCustomer(order.organization_id,d))}</td><td class="numeric-cell">${booksMoney(order.total_minor,order.currency)}</td><td><button type="button" data-books-open-order="${esc(order.id)}">Invoice order</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No accepted Pro formas have quantities waiting for invoice.</p>'}${pager('Waiting',d.waitingPage,d.waitingCount,20)}</section>
 <section class="card"><div class="heading"><h2>Customer invoices (${d.invoiceCount})</h2><button type="button" id="booksRegisterCsv">Download all invoices CSV</button></div><p class="muted">Current invoices, excluding voids: total ${booksMoney(d.summary.total_minor)} · paid ${booksMoney(d.summary.paid_minor)} · credits ${booksMoney(d.summary.credited_minor)} · owed ${booksMoney(d.summary.outstanding_minor)} · customer credit ${booksMoney(d.summary.customer_credit_minor)}.</p>${d.invoices.length?booksInvoiceTable(d.invoices,d):'<p class="empty">No customer invoices.</p>'}${pager('Invoice',d.invoicePage,d.invoiceCount,50)}</section>`;
 const active=()=>current()&&me===session&&me?.user_id===actor&&booksInvoicePageData===d;
 $('#booksRegisterRefresh').onclick=()=>run(()=>{if(active())return booksWorkspace();});
 for(const kind of ['Invoice','Waiting'])for(const [direction,step] of [['Previous',-1],['Next',1]]){
  const id='books'+kind+direction;$('#'+id).onclick=()=>run(async()=>{if(!active())return;if(kind==='Invoice')booksInvoicePage+=step;else booksWaitingPage+=step;await booksWorkspace();if(me===session&&view==='books'&&booksSection==='invoices'&&!booksDraft?.proformaId){const button=$('#'+id);(button?.disabled?$('#books'+kind+'PageStatus'):button)?.focus({preventScroll:true});}});
 }
 document.querySelectorAll('[data-books-open-order]').forEach(button=>button.onclick=()=>run(()=>{if(!active())return;booksDraft={proformaId:button.dataset.booksOpenOrder};return booksWorkspace();}));
 $('#booksRegisterCsv').onclick=()=>run(async()=>{
  if(!active())return;const rows=[],seen=new Set();let count=null;
  for(let page=0;;page++){const data=booksInvoicePageResult(await booksRpc('acc_invoice_register',{p_invoice_page:page,p_waiting_page:0}));if(!active())return;if(count!==null&&count!==data.invoiceCount||data.invoices.some(invoice=>seen.has(invoice.id)))throw Error('Invoices changed while the CSV was loading. Retry the export.');count=data.invoiceCount;for(const invoice of data.invoices){seen.add(invoice.id);rows.push(invoice);}if((page+1)*50>=count)break;}
  booksDownload(`invoices-${d.today}.csv`,booksCsv([['invoice_number','Invoice'],['invoice_date','Date'],['due_date','Due'],['customer_name','Customer'],['tra_receipt_number','TRA receipt'],['buyer_tin','Customer TIN'],['total','Total'],['paid','Paid'],['owed','Owed'],['status','Status']],rows.map(invoice=>({...invoice,total:(Number(invoice.total_minor)/100).toFixed(2),paid:(invoice.paid/100).toFixed(2),owed:(invoice.outstanding/100).toFixed(2),status:invoice.state.label}))));
 });
 wireBooksInvoiceActions(d);
}
async function booksWorkspace(){
 const record=workspaceRecordRoute(location.hash);if(record?.kind==='invoice')return booksInvoiceRecordWorkspace(record.id);
 booksInvoiceRecordData=null;
 const session=me;if(booksTransactionActor!==session){booksTransactionActor=session;booksTransactionPages={receipts:0,journal:0};booksTransactionSelected='';booksTransactionPageData=null;booksAccountPageData=null;booksAccountSearch='';booksAccountType='';booksAccountPage=0;booksLedgerPageData=null;booksLedgerPage=0;}
 const section=booksSection,register=section==='invoices'&&!booksDraft?.proformaId,transactionRegister=booksTransactionLanding(),accountRegister=section==='accounts',ledgerRegister=section==='reports'&&booksReport.kind==='ledger',epoch=++booksEpoch,actor=await requireAccountingAccess(client,()=>me);
 const current=()=>me===session&&me?.user_id===actor&&view==='books'&&booksSection===section&&epoch===booksEpoch;
 if(!current())return;
 workspaceLoading('Loading the books…');
 if(!register&&!transactionRegister&&['invoices','receipts','journal'].includes(section)&&!listsLoaded){await (listsLoading||loadLists());if(!current())return;if(!listsLoaded)throw Error('Customer records could not be loaded. Reopen the books.');}
 if(ledgerRegister){const today=booksToday();booksReport.from||=booksMonthStart(today);booksReport.to||=today;booksReport.asOf||=today;}
 const data=accountRegister?await loadBooksAccountPage(current):ledgerRegister?await loadBooksLedgerPage(current):register?await loadBooksInvoicePage():transactionRegister?booksTransactionPageResult(await booksRpc('acc_transaction_page',{p_section:section,p_page:booksTransactionPages[section]}),section):await loadBooksData(section);
 if(!current())return;
 if(accountRegister){booksAccountPageData=data;booksAccountPage=data.page;}else if(ledgerRegister){booksLedgerPageData=data;booksLedgerPage=data.page;booksReport.accountId=data.account?.id||'';}else if(register){booksInvoicePageData=data;booksInvoicePage=data.invoicePage;booksWaitingPage=data.waitingPage;}else if(transactionRegister){booksTransactionPageData=data;booksTransactionPages[section]=data.page;}else booksData=data;
 const body=ledgerRegister?booksLedgerRegister:transactionRegister?booksTransactionRegister:{overview:booksOverview,invoices:register?booksInvoiceRegister:booksInvoices,receipts:booksReceipts,journal:booksJournal,accounts:booksAccounts,reports:booksReports,import:financialImportWorkspace,opening:(actor,current)=>openingReceivablesWorkspace(actor,current)}[booksSection]||booksOverview;
 $('#content').innerHTML=`<section class="books">${workspacePageHeader({title:booksSection==='overview'?'Accounts overview':booksSections.find(([key])=>key===booksSection)?.[1]||'Accounts',subtitle:booksSection==='overview'?'Balances, overdue invoices and TRA receipts.':'Double-entry books in TZS. Posted entries are never edited; mistakes are reversed or voided.',back:!transactionRegister&&['receipts','journal'].includes(section)?'<button type="button" id="booksTransactionBack">Back to register</button>':''})}<p class="muted"><span id="booksLockStatus">${data.settings.locked_through?`Books locked through ${esc(data.settings.locked_through)}.`:'No lock date set.'}</span></p>
 <details class="no-print"><summary>Other accounting tasks</summary><div class="tabs" role="group" aria-label="Books sections">${booksSections.map(([key,label])=>`<button type="button" data-books-section="${key}"${key===booksSection?' class="active" aria-pressed="true"':' aria-pressed="false"'}>${esc(label)}</button>`).join('')}</div></details>
 <div id="booksBody"></div></section>`;
 document.querySelectorAll('[data-books-section]').forEach(button=>button.onclick=()=>run(async()=>{const context=workspaceNavigationContext(),active=()=>current()&&context.current()&&button.isConnected;if(!active()||!await confirmWorkspaceLeave(active)||!active())return;openBooksSection(button.dataset.booksSection);syncWorkspaceNavigation();return booksWorkspace();}));
 await body(actor,current);
}
function booksTransactionPageResult(data,section){
 const amounts=section==='receipts'?['amount_minor','applied_minor','credit_minor']:['debit_minor','credit_minor'];
 if(!data||data.section!==section||!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages!==Math.max(1,Math.ceil(data.total/25))||data.page>=data.pages||data.rows.length!==Math.min(25,data.total-data.page*25)||new Set(data.rows.map(row=>row.id)).size!==data.rows.length||!data.summary||!amounts.every(key=>Number.isSafeInteger(data.summary[key]))||!Number.isSafeInteger(data.settings?.version)||!/^\d{4}-\d{2}-\d{2}$/.test(data.today)||data.rows.some(row=>!row.id||(section==='receipts'?typeof row.receipt_number!=='string'||typeof row.receipt_date!=='string'||!row.organization_id||typeof row.method!=='string'||typeof row.reference!=='string'||!Object.hasOwn(row,'voided_at')||!Number.isSafeInteger(row.amount_minor)||!Number.isSafeInteger(row.applied_minor):typeof row.entry_number!=='string'||typeof row.entry_date!=='string'||typeof row.memo!=='string'||!['manual','invoice','receipt','reversal','credit_note'].includes(row.source_type)||!row.created_by||typeof row.reversed!=='boolean'||!Number.isSafeInteger(row.debit_minor)||!Number.isSafeInteger(row.credit_minor))))throw Error('The transaction register was incomplete. Refresh before relying on these totals.');
 return data;
}
function booksTransactionRegister(actor,current){
 const data=booksTransactionPageData,section=booksSection,session=me,receipts=section==='receipts',label=receipts?'receipt':'journal entry';
 if(!current())return;
 const active=()=>current()&&me===session&&booksTransactionPageData===data&&booksTransactionLanding();
 $('#booksBody').innerHTML=`<section class="card"><div class="heading"><h2>${receipts?'Receipts':'Journal entries'} · ${data.total}</h2><div class="actions"><button type="button" id="booksTransactionNew">New ${label}</button><button type="button" id="booksTransactionRefresh">Refresh</button>${receipts?'<button type="button" id="booksTransactionCsv">Download all receipts CSV</button>':''}</div></div><p>${receipts?`Recorded receipts, excluding voids: received ${booksMoney(data.summary.amount_minor)} · applied ${booksMoney(data.summary.applied_minor)} · customer credit ${booksMoney(data.summary.credit_minor)}.`:`All posted entries, including reversals: debits ${booksMoney(data.summary.debit_minor)} · credits ${booksMoney(data.summary.credit_minor)}.`}</p>${data.rows.map(row=>`<article class="contact" data-books-transaction="${esc(row.id)}"><strong>${esc(receipts?row.receipt_number:row.entry_number)}</strong><p>${esc(receipts?row.receipt_date:row.entry_date)} · ${receipts?esc(row.customer_name||'Customer not loaded'):esc(row.memo)}</p><p>${receipts?`${esc(row.voided_at?'Void':booksMethods.find(([key])=>key===row.method)?.[1]||row.method)} · ${booksMoney(row.amount_minor)}`:`${esc(row.reversed?'Reversed':{manual:'Journal entry',invoice:'Customer invoice',receipt:'Customer receipt',reversal:'Reversal',credit_note:'Return credit'}[row.source_type])} · debit ${booksMoney(row.debit_minor)} · credit ${booksMoney(row.credit_minor)}`}</p><button type="button" data-books-transaction-open="${esc(row.id)}">Open ${label}</button></article>`).join('')||`<p class="empty">No ${receipts?'receipts':'journal entries'} yet.</p>`}<div class="actions"><button type="button" id="booksTransactionPrevious" ${data.page===0?'disabled':''}>Previous</button><span id="booksTransactionPageStatus" tabindex="-1">Page ${data.page+1} of ${data.pages}</span><button type="button" id="booksTransactionNext" ${data.page+1>=data.pages?'disabled':''}>Next</button></div></section>`;
 const open=async id=>{if(!active())return;booksTransactionSelected=id;booksDraft=null;const epoch=booksEpoch+1;await booksWorkspace();if(me===session&&view==='books'&&booksSection===section&&booksTransactionSelected===id&&booksEpoch===epoch)$('#booksTransactionBack')?.focus({preventScroll:true});};
 $('#booksTransactionNew').onclick=()=>run(()=>open('new'));
 document.querySelectorAll('[data-books-transaction-open]').forEach(button=>button.onclick=()=>run(()=>open(button.dataset.booksTransactionOpen)));
 $('#booksTransactionRefresh').onclick=()=>run(()=>{if(active())return booksWorkspace();});
 for(const [direction,step] of [['Previous',-1],['Next',1]])$('#booksTransaction'+direction).onclick=()=>run(async()=>{if(!active())return;booksTransactionPages[section]+=step;const epoch=booksEpoch+1;await booksWorkspace();if(me===session&&view==='books'&&booksSection===section&&booksTransactionLanding()&&booksEpoch===epoch){const button=$('#booksTransaction'+direction);(button?.disabled?$('#booksTransactionPageStatus'):button)?.focus({preventScroll:true});}});
 if(receipts)$('#booksTransactionCsv').onclick=()=>run(async()=>{
  if(!active())return;const rows=[],seen=new Set();let total=null;
  for(let page=0;;page++){const result=booksTransactionPageResult(await booksRpc('acc_transaction_page',{p_section:section,p_page:page}),section);if(!active())return;if(total!==null&&total!==result.total||result.page!==page||result.rows.some(row=>seen.has(row.id)))throw Error('Receipts changed while the CSV was loading. Retry the export.');total=result.total;for(const row of result.rows){seen.add(row.id);rows.push(row);}if(page+1>=result.pages)break;}
  booksDownload(`receipts-${data.today}.csv`,booksCsv([['receipt_number','Receipt'],['receipt_date','Date'],['customer','Customer'],['method','Method'],['reference','Reference'],['amount','Amount'],['status','Status']],rows.map(row=>({...row,customer:row.customer_name||'Customer not loaded',amount:(Number(row.amount_minor)/100).toFixed(2),status:row.voided_at?'Void':'Recorded'}))));
 });
}
function booksTransactionBack(actor,current){
 const session=me,section=booksSection,selected=booksTransactionSelected;
 $('#booksTransactionBack').onclick=()=>run(async()=>{if(!current()||me!==session||me?.user_id!==actor)return;booksTransactionSelected='';booksDraft=null;const epoch=booksEpoch+1;await booksWorkspace();if(me===session&&view==='books'&&booksSection===section&&booksEpoch===epoch&&booksTransactionLanding()){const button=selected==='new'?$('#booksTransactionNew'):[...document.querySelectorAll('[data-books-transaction-open]')].find(item=>item.dataset.booksTransactionOpen===selected);(button||$('#booksTransactionPageStatus'))?.focus({preventScroll:true});}});
}
function booksCutoverChecklist(){
 return `<details class="card"><summary>Opening books and stock</summary><p>A successful Excel import does not complete the opening books. Accounts must reconcile and approve each stage before using the ERP balances for live reporting.</p><ol><li><strong>Cutover date and source:</strong> agree the final date, retain the source files and back up the current workspace.</li><li><strong>Test records:</strong> review test invoices, receipts and deliveries. Use the supported cancellation, void or reversal process; never delete posted history. Test entries remain in reports until correctly reversed.</li><li><strong>Account mapping and opening trial balance:</strong> map ledger codes, preview balanced journals, post once and compare every balance with the source.</li><li><strong>Customer receivables:</strong> import genuine outstanding invoice references and residual amounts using Opening receivables. Reconcile the customer total to the receivables control account without posting it twice.</li><li><strong>Supplier payables:</strong> reconcile supplier details and the payable control account separately. The journal importer does not create supplier bills or allocations.</li><li><strong>Physical stock:</strong> count and approve actual location, batch, expiry, carton conversion and machine serials in Stock count. Provisional quantities are not verified physical counts.</li><li><strong>Prices and tax details:</strong> review selling prices, currencies, tax rates and customer tax details. Missing prices must be configured before quoting.</li><li><strong>Final sign-off:</strong> reconcile banks, cash, receivables, payables and stock valuation; verify employee access and a controlled split-order workflow; set the approved lock date.</li></ol><p class="muted">This is a checklist, not a recorded approval. Keep the owner's reconciliation and sign-off with the cutover source documents.</p></details>`;
}
async function booksOverview(actor,current){
 const d=booksData;
 if(!current())return;
 const money=Number(d.summary.money_minor),receivables=Number(d.summary.receivables_minor),vat=Number(d.summary.vat_minor),profit=Number(d.summary.profit_minor);
 const overdue=d.invoices.filter(i=>i.state.key==='overdue');
 $('#booksBody').innerHTML=`<p class="muted">Balances include all posted entries.</p><div class="books-metrics">
  <div><small>Cash, bank and mobile money</small><strong>${booksMoney(money)}</strong></div>
  <div><small>Customers owe</small><strong>${booksMoney(receivables)}</strong></div>
  <div><small>VAT output payable</small><strong>${booksMoney(vat)}</strong></div>
  <div><small>Profit this month</small><strong>${booksMoney(profit)}</strong></div></div>
 <section class="card"><h2>Waiting for invoice (${d.waitingCount})</h2><p class="muted">Accepted Pro formas with quantities still to invoice.</p>${d.toInvoice.length?`<div class="table-wrap"><table><thead><tr><th>Pro forma</th><th>Customer</th><th>Accepted</th><th class="numeric-cell">Quote total</th><th>Actions</th></tr></thead><tbody>${d.toInvoice.map(p=>`<tr><td>${esc(p.document_number)}</td><td>${esc(booksCustomer(p.organization_id))}</td><td>${esc(String(p.accepted_at||'').slice(0,10))}</td><td class="numeric-cell">${booksMoney(p.total_minor,p.currency)}</td><td><button type="button" data-books-invoice-pf="${esc(p.id)}">Create invoice</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Every accepted Pro forma is fully invoiced.</p>'}${d.waitingCount>d.toInvoice.length?'<p class="muted">Showing the latest 20. Open Customer invoices for the full list.</p>':''}</section>
 <section class="card"><h2>Overdue invoices (${d.overdueCount})</h2>${overdue.length?booksInvoiceTable(overdue):'<p class="empty">No overdue invoices.</p>'}${d.overdueCount>overdue.length?'<p class="muted">Showing the latest 20. Open Customer invoices for the full list.</p>':''}</section>
 <section class="card"><h2>Unrecorded TRA receipts (<span id="booksTraCount" tabindex="-1">${d.unrecordedTraCount}</span>)</h2><div id="booksTraRows">${d.unrecordedTra.length?`<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="numeric-cell">Total</th><th>TRA receipt</th><th>Actions</th></tr></thead><tbody>${d.unrecordedTra.map(invoice=>`<tr data-books-tra-row="${esc(invoice.id)}"><td>${esc(invoice.invoice_number)}</td><td>${esc(invoice.invoice_date)}</td><td>${esc(booksCustomer(invoice.organization_id,d))}</td><td class="numeric-cell">${booksMoney(invoice.total_minor)}</td><td data-books-fiscal-cell="${esc(invoice.id)}"><span class="tag books-missing chip chip--${statusTone('waiting')}">Not recorded</span></td><td><button type="button" data-books-fiscal="${esc(invoice.id)}">Record TRA receipt</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No unrecorded TRA receipts.</p>'}</div><p id="booksTraCountStatus" class="muted">${d.unrecordedTraCount>d.unrecordedTra.length?`Showing ${d.unrecordedTra.length} of ${d.unrecordedTraCount}. Open Customer invoices for the full list.`:''}</p></section>`;
 document.querySelectorAll('[data-books-invoice-pf]').forEach(b=>b.onclick=()=>run(()=>{booksSection='invoices';booksDraft={proformaId:b.dataset.booksInvoicePf};return booksWorkspace();}));
 wireBooksInvoiceActions();
}
function booksInvoiceTone(key){return statusTone(({void:'inactive',paid:'paid',overdue:'overdue',part:'waiting',open:'waiting'})[key]);}
function booksInvoiceTable(rows,data=booksData){
 return `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date · due</th><th>Customer</th><th class="numeric-cell">Total</th><th class="numeric-cell">Paid</th><th class="numeric-cell">Credits</th><th class="numeric-cell">Owed</th><th>Status</th><th>TRA receipt</th><th>Actions</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.invoice_number)}<small>${esc(i.opening_import_id?`Opening balance · ${i.opening_reference} · cutover ${i.opening_cutover_date}`:data.proformaNumbers?.get(i.proforma_id)||'')}</small></td><td>${esc(i.invoice_date)}<small>due ${esc(i.due_date)}</small></td><td>${esc(booksCustomer(i.organization_id,data))}</td><td class="numeric-cell">${booksMoney(i.total_minor)}</td><td class="numeric-cell">${booksMoney(i.paid)}</td><td class="numeric-cell">${booksMoney(i.credited_minor||0)}${Number(i.customer_credit_minor)>0?`<small>Customer credit ${booksMoney(i.customer_credit_minor)}</small>`:''}</td><td class="numeric-cell">${booksMoney(i.outstanding)}</td><td><span class="tag books-${esc(i.state.key)} chip chip--${booksInvoiceTone(i.state.key)}">${esc(i.state.label)}</span></td><td data-books-fiscal-cell="${esc(i.id)}">${i.opening_import_id?'Opening balance':i.tra_receipt_number?esc(i.tra_receipt_number):i.voided_at?'':`<span class="tag books-missing chip chip--${statusTone('waiting')}">Not recorded</span>`}</td><td class="actions">${i.opening_import_id?'':`<button type="button" data-books-print-invoice="${esc(i.id)}">Print</button>`}${i.voided_at||i.opening_import_id?'':`<button type="button" data-books-fiscal="${esc(i.id)}">${i.tra_receipt_number?'Edit TRA receipt':'Record TRA receipt'}</button><button type="button" class="danger" data-books-void-invoice="${esc(i.id)}">Void</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}
function wireBooksInvoiceActions(data=booksData){
 const session=me,epoch=booksEpoch,current=()=>me===session&&view==='books'&&booksEpoch===epoch;
 document.querySelectorAll('[data-books-print-invoice]').forEach(b=>b.onclick=()=>run(async()=>{
  if(!current()||!b.isConnected)return;
  let invoice=data.invoices.find(i=>i.id===b.dataset.booksPrintInvoice);if(invoice?.booksVoidPending)return;
  if(data===booksInvoicePageData){const rows=await booksSelect('acc_invoice_balances','*',q=>q.eq('id',b.dataset.booksPrintInvoice).limit(1));if(!current()||!b.isConnected)return;if(rows[0]?.id!==b.dataset.booksPrintInvoice||!Array.isArray(rows[0].lines))throw Error('This invoice could not be loaded completely. Refresh the register.');invoice=booksInvoiceAmounts(rows[0]);}
  booksPrintInvoice(invoice,data,{trigger:b});
 }));
 document.querySelectorAll('[data-books-fiscal]').forEach(b=>b.onclick=()=>{if(current()&&b.isConnected)booksFiscalPrompt(data.invoices.find(i=>i.id===b.dataset.booksFiscal)||data.unrecordedTra?.find(i=>i.id===b.dataset.booksFiscal),data);});
 document.querySelectorAll('[data-books-void-invoice]').forEach(b=>b.onclick=()=>{if(current()&&b.isConnected)booksVoidPrompt('invoice',data.invoices.find(i=>i.id===b.dataset.booksVoidInvoice),data);});
}
function booksFormValidation(form,summary,current){
 const fieldErrors=new Map();form.noValidate=true;
 const updateSummary=()=>{summary.textContent=fieldErrorSummary(fieldErrors.size);};
 form.addEventListener('focusout',event=>{
  if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);if(!current()||!form.isConnected||!form.contains(control)||!control.matches('input,select,textarea')||control.disabled||control.readOnly)return;
  const problem=nativeFieldError(control);if(problem)fieldErrors.set(control,problem);else fieldErrors.delete(control);showFieldError(control,problem);updateSummary();
 });
 return ()=>{const errors=nativeFormErrors(form);fieldErrors.clear();for(const [control,problem]of errors)fieldErrors.set(control,problem);updateSummary();showFieldErrors(form,errors);return !errors.size;};
}
// The TRA receipt for an invoice and the customer's TIN and VRN, as printed on the tax invoice.
function booksFiscalPrompt(invoice,data=booksData){
 if(!invoice||invoice.booksVoidPending||document.querySelector('dialog[data-books-editor]'))return;
 if(invoice.opening_import_id){message('Opening balances are not new tax invoices.',true);return;}
 const saved=data.taxIds?.get(invoice.organization_id)||{},root=$('#booksBody'),opener=document.activeElement;
 const box=document.createElement('dialog');box.className='books-void';box.dataset.booksEditor='fiscal';
 box.innerHTML=`<h2>TRA receipt for ${esc(invoice.invoice_number)}</h2><p class="muted">${esc(booksCustomer(invoice.organization_id,data))} · ${booksMoney(invoice.total_minor)}. Type the receipt as issued by the TRA system. The customer's TIN and VRN are saved for their next invoice too.</p><form id="booksFiscalForm" data-books-fiscal-invoice="${esc(invoice.id)}"><p id="booksFiscalErrors" class="error" role="alert"></p><div class="grid">
  <label><span>TRA receipt number · required</span><input name="receipt" required maxlength="60" value="${esc(invoice.tra_receipt_number||'')}"></label>
  <label><span>Verification code · optional</span><input name="code" maxlength="60" value="${esc(invoice.tra_verification_code||'')}"></label>
  <label><span>Customer TIN · optional</span><input name="tin" maxlength="16" placeholder="100-113-473" value="${esc(invoice.buyer_tin||saved.tin||'')}"></label>
  <label><span>Customer VRN · if VAT registered</span><input name="vrn" maxlength="20" placeholder="10-001061-P" value="${esc(invoice.buyer_vrn||saved.vrn||'')}"></label></div>
  </form><div class="actions"><button type="button" class="button-quiet" id="booksFiscalCancel">Cancel</button><button type="submit" class="button-primary" form="booksFiscalForm">Save TRA receipt</button></div>`;
 document.body.append(box);
 const form=box.querySelector('form'),cancel=box.querySelector('#booksFiscalCancel'),submit=box.querySelector('[type="submit"]'),session=me,epoch=booksEpoch,context=()=>me===session&&view==='books'&&booksEpoch===epoch&&(booksData===data||booksInvoicePageData===data)&&root.isConnected&&$('#booksBody')===root,current=()=>context()&&!invoice.booksVoidPending&&box.open&&form.isConnected;
 let committed=false,posting=false;
 const summary=box.querySelector('#booksFiscalErrors'),validate=booksFormValidation(form,summary,()=>current()&&!committed&&!posting);
 const initial=workspaceFormSnapshot(form),requestClose=bindWorkspaceDialogDismiss(box,{isBusy:()=>posting||!context(),isDirty:()=>!committed&&workspaceFormSnapshot(form)!==initial});
 cancel.onclick=async()=>{if(!context()){box.close();return false;}return await requestClose();};
 box.addEventListener('close',()=>box.remove());
 showWorkspaceDialog(box,{size:'medium',trigger:opener});
 form.onsubmit=event=>{event.preventDefault();if(!current()||committed||posting)return;if(busy){actionFeedbackRefuse(submit,summary);return;}if(!validate())return;const f=new FormData(form);submit.disabled=true;run(async()=>{
  if(!current()||committed||posting)return;posting=true;form.inert=true;submit.disabled=true;
  try{
  const saved=await booksRpc('record_invoice_fiscal',{p_invoice_id:invoice.id,p_receipt_number:f.get('receipt'),p_verification_code:f.get('code'),p_buyer_tin:f.get('tin'),p_buyer_vrn:f.get('vrn')});
  committed=true;if(!current()){box.close();return;}cancel.textContent='Close';
  if(saved?.id!==invoice.id||saved.organization_id!==invoice.organization_id||typeof saved.tra_receipt_number!=='string'||!saved.tra_receipt_number){form.inert=true;message('TRA receipt saved, but the returned details were incomplete. Reopen Customer invoices before making another change.',true);return;}
  for(const key of ['tra_receipt_number','tra_verification_code','buyer_tin','buyer_vrn','fiscal_recorded_by','fiscal_recorded_at'])invoice[key]=saved[key];
  data.taxIds?.set(invoice.organization_id,{organization_id:invoice.organization_id,tin:saved.buyer_tin,vrn:saved.buyer_vrn});
  document.querySelectorAll('[data-books-fiscal-cell]').forEach(cell=>{if(cell.dataset.booksFiscalCell===invoice.id)cell.textContent=saved.tra_receipt_number;});
  if(data.unrecordedTra?.some(row=>row.id===invoice.id)){
   data.unrecordedTra=data.unrecordedTra.filter(row=>row.id!==invoice.id);data.unrecordedTraCount--;
   for(const row of document.querySelectorAll('[data-books-tra-row]'))if(row.dataset.booksTraRow===invoice.id)row.remove();
   $('#booksTraCount').textContent=data.unrecordedTraCount;
   if(!data.unrecordedTra.length)$('#booksTraRows').innerHTML=`<p class="empty">${data.unrecordedTraCount?'No more invoices in this preview.':'No unrecorded TRA receipts.'}</p>`;
   $('#booksTraCountStatus').textContent=data.unrecordedTraCount>data.unrecordedTra.length?`Showing ${data.unrecordedTra.length} of ${data.unrecordedTraCount}. Open Customer invoices for the full list.`:'';
  }
  const trigger=[...document.querySelectorAll('[data-books-fiscal]')].find(button=>button.dataset.booksFiscal===invoice.id);
  if(trigger)trigger.textContent='Edit TRA receipt';
  const focus=box.contains(document.activeElement)||document.activeElement===document.body;
  if(!await closeWorkspaceDialog(box)||!context())return;
  if(focus&&(!opener?.isConnected||opener===document.body))(trigger||$('#booksTraCount'))?.focus({preventScroll:true});
  message(`TRA receipt saved on ${invoice.invoice_number}.`);
  }catch(error){if(current())throw error;box.close();}
  finally{posting=false;if(!committed&&current()){form.inert=false;submit.disabled=false;}}
 },{origin:submit,errorTarget:summary});};
}
function booksVoidPrompt(kind,record,data=booksData){
 if(!record||record.booksVoidPending||document.querySelector('dialog[data-books-editor]'))return;
 if(kind==='invoice'&&record.opening_import_id){message('Opening balances require an Accounts correction review.',true);return;}
 const number=kind==='invoice'?record.invoice_number:record.receipt_number,root=$('#booksBody'),opener=document.activeElement;
 const box=document.createElement('dialog');box.className='books-void';box.dataset.booksEditor='void';
 box.innerHTML=`<h2>Void ${esc(number)}</h2><p>Voiding posts a reversing entry dated below. The original stays in the books.${kind==='invoice'?' Void its receipts first if any were paid against it.':''}</p><form id="booksVoidForm"><p id="booksVoidErrors" class="error" role="alert"></p><div class="grid"><label><span>Date of the reversal · required</span><input name="date" type="date" required value="${esc(data.today)}"></label><label><span>Reason (at least 5 characters) · required</span><input name="reason" required minlength="5" maxlength="300"></label></div></form><div class="actions"><button type="button" class="button-quiet" id="booksVoidCancel">Cancel</button><button type="submit" class="button-destructive" form="booksVoidForm">Void ${esc(number)}</button></div>`;
 document.body.append(box);
 const form=box.querySelector('form'),cancel=box.querySelector('#booksVoidCancel'),submit=box.querySelector('[type="submit"]'),session=me,epoch=booksEpoch,context=()=>me===session&&view==='books'&&booksEpoch===epoch&&(booksData===data||booksInvoicePageData===data)&&root.isConnected&&$('#booksBody')===root,current=()=>context()&&box.open&&form.isConnected;
 let committed=false,posting=false;
 const summary=box.querySelector('#booksVoidErrors'),validate=booksFormValidation(form,summary,()=>current()&&!committed&&!posting);
 const initial=workspaceFormSnapshot(form),requestClose=bindWorkspaceDialogDismiss(box,{isBusy:()=>posting||!context(),isDirty:()=>!committed&&workspaceFormSnapshot(form)!==initial});
 cancel.onclick=async()=>{if(!context()){box.close();return false;}return await requestClose();};
 box.addEventListener('close',()=>box.remove());
 showWorkspaceDialog(box,{size:'medium',trigger:opener});
 form.onsubmit=event=>{event.preventDefault();if(!current()||committed||posting)return;if(busy){actionFeedbackRefuse(submit,summary);return;}if(!validate())return;const f=new FormData(form);submit.disabled=true;run(async()=>{
  if(!current()||committed||posting)return;posting=true;form.inert=true;submit.disabled=true;
  try{
   const saved=await booksRpc(kind==='invoice'?'void_invoice':'void_receipt',kind==='invoice'?{p_invoice_id:record.id,p_date:f.get('date'),p_reason:f.get('reason')}:{p_receipt_id:record.id,p_date:f.get('date'),p_reason:f.get('reason')});
   committed=true;if(!current()){box.close();return;}cancel.textContent='Close';
   if(kind==='invoice'&&typeof pendingLoaded!=='undefined')pendingLoaded=false;
   record.booksVoidPending=true;
   const controls=kind==='invoice'?[...document.querySelectorAll('[data-books-print-invoice],[data-books-fiscal],[data-books-void-invoice]')].filter(button=>Object.values(button.dataset).includes(record.id)):[$('#booksReceiptVoid')].filter(Boolean);
   controls.forEach(button=>button.disabled=true);
   document.querySelectorAll('[data-books-fiscal-invoice]').forEach(prompt=>{if(prompt.dataset.booksFiscalInvoice===record.id)prompt.inert=true;});
   const csv=$('#booksInvoicesCsv');if(csv){csv.disabled=true;csv.title='Refresh the invoice list before exporting balances after this void.';}
   const tag=controls[0]?.closest('tr')?.querySelector('.tag');if(tag)tag.textContent='Void saved · details pending';
   const summary=controls[0]?.closest('section')?.querySelector('p.muted');if(summary&&summary.textContent.startsWith('Current invoices'))summary.textContent='Before this void: '+summary.textContent.replace(/^Current invoices/,'invoices');
   booksPostedConfirmation(form,'void_'+kind,saved,{id:record.id,organization_id:record.organization_id,[kind==='invoice'?'invoice_number':'receipt_number']:number},current,row=>{
    for(const key of ['voided_at','voided_by','void_reason','void_entry_id'])record[key]=row[key];
    if(tag)tag.textContent='Void';if(kind==='receipt'&&controls[0])controls[0].textContent='Void receipt recorded';
   },kind==='invoice'?async()=>{await booksOpenSavedInvoice(record.id,data,current);if(current())await closeWorkspaceDialog(box);}:async()=>{
    booksTransactionSelected=record.id;booksDraft=null;const opening=booksWorkspace(),navigationEpoch=booksEpoch;await opening;
    if(me===session&&view==='books'&&booksEpoch===navigationEpoch&&booksTransactionSelected===record.id&&box.open)await closeWorkspaceDialog(box);
   });
   if(document.activeElement===submit)box.querySelector('[data-books-posted] button')?.focus({preventScroll:true});
  }catch(error){if(current())throw error;box.close();}
  finally{posting=false;if(!committed&&current()){form.inert=false;submit.disabled=false;}}
 },{origin:submit,errorTarget:summary});};
}
// Select whole, available units; repeated product lines share the same Haadi stock.
function booksInvoiceQuantitySelection(lines,values){
 const selected=[],used=new Map();
 lines.forEach((line,index)=>{
  const raw=String(values[index]??'').trim(),quantity=Number(raw),label=`Line ${index+1}`;
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(quantity)||quantity>1000000)throw Error(`${label}: enter a whole quantity from 0 to 1,000,000.`);
  if(quantity>Number(line.remaining_quantity))throw Error(`${label}: quantity exceeds the uninvoiced balance.`);
  const total=(used.get(line.product_id)||0)+quantity;
  if(total>Number(line.available_quantity))throw Error(`${label}: selected quantities exceed available Haadi stock for this product.`);
  used.set(line.product_id,total);
  if(quantity>0)selected.push({proforma_line_id:line.proforma_line_id,quantity});
 });
 if(!selected.length)throw Error('Choose at least one available unit to invoice.');
 return selected;
}
async function booksInvoices(actor=me?.user_id,workspaceCurrent=()=>true){
 const d=booksData,chosen=booksDraft?.proformaId||'',session=me,epoch=booksEpoch;
 const invoices=chosen?d.invoices.filter(invoice=>invoice.proforma_id===chosen):d.invoices;
 const linked=invoices.find(invoice=>!invoice.voided_at)||invoices[0],waiting=d.toInvoice.find(order=>order.id===chosen);
 const orders=chosen?(waiting?[waiting]:linked?[{id:chosen,document_number:linked.proforma_number||d.proformaNumbers?.get(chosen)||'Selected order',organization_id:linked.organization_id,currency:linked.currency}]:[]):d.toInvoice;
 const orderNumber=waiting?.document_number||linked?.proforma_number||d.proformaNumbers?.get(chosen)||'Selected order';

 $('#booksBody').innerHTML=`${chosen?`<section class="card"><h2>${esc(orderNumber)}</h2><p>Showing only invoices and quantities for this order.</p><div class="actions"><button type="button" data-books-return-order>Return to whole order</button><button type="button" data-books-all-invoices>Show all customer invoices</button></div></section>`:''}<section class="card"><h2>Invoice available order quantities</h2><details class="invoice-help"><summary>How invoicing affects stock</summary><p>Posting creates one invoice and delivery note, reserves the selected Haadi units, and sends the delivery to packing. Machines with installation requested get planning cases immediately. Remaining quantities stay pending for a later invoice. Accounting and delivery access are required.</p></details>${orders.length?`<form id="booksInvoiceForm"><p id="booksInvoiceErrors" role="alert"></p><p class="muted">Complete the required fields before posting.</p><fieldset id="booksInvoiceFields"><legend>Invoice details and quantities</legend><div class="grid">
  <label class="wide"><span>Accepted Pro forma · quote total · required</span><select name="proforma" required><option value="">Choose</option>${orders.map(p=>`<option value="${esc(p.id)}"${p.id===chosen?' selected':''}>${esc(p.document_number)} · ${esc(booksCustomer(p.organization_id))}${p.total_minor!=null?' · Quote total '+esc(booksMoney(p.total_minor,p.currency)):''}</option>`).join('')}</select></label>
  <label><span>Invoice date · required</span><input name="date" type="date" required value="${esc(d.today)}"></label>
  <label><span>Due date · required</span><input name="due" type="date" required value="${esc(booksAddDays(d.today,30))}"></label>
  <label><span>Accounts approval reference · required</span><input name="accountsref" required minlength="2" maxlength="120"></label>
  <label><span>Expected delivery date · required</span><input name="deliverydate" type="date" required min="${esc(d.today)}" value="${esc(d.today)}"></label>
  <label class="wide"><span>Tax reference · optional</span><input name="taxref" maxlength="80"></label></div>
  <div id="booksInvoiceQuantities"><p class="muted">Choose an accepted Pro forma to review its quantities.</p></div>
  <button type="button" id="booksInvoiceReload" disabled>Refresh quantities</button></fieldset>
  <p class="muted">The quote total is for the whole order. This invoice charges only the selected quantities; any balance remains pending.</p>
  <p id="booksInvoiceReview" role="status"></p><p id="booksInvoiceStatus" role="status"></p>
  <div class="actions"><button type="submit" id="booksInvoicePost" disabled>Post invoice & reserve stock</button></div></form>`:'<p class="empty">No accepted Pro formas have quantities waiting for an invoice.</p>'}</section>
 <section class="card"><div class="heading"><h2>${chosen?'Invoices for this order':'Invoices'} (${invoices.length})</h2><button type="button" id="booksInvoicesCsv">Download CSV</button></div>${invoices.length?booksInvoiceTable(invoices):'<p class="empty">No invoices for this selection.</p>'}</section>`;
 $('#booksBody').querySelector('[data-books-all-invoices]')?.addEventListener('click',()=>run(()=>{booksDraft=null;return booksWorkspace();}));
 $('#booksBody').querySelector('[data-books-return-order]')?.addEventListener('click',()=>run(()=>{salesFocusedProforma=chosen;salesFocusedDelivery='';salesSection='proformas';salesEditing='';view='sales';return render();}));
 const form=$('#booksInvoiceForm');
 if(form){
  const current=()=>workspaceCurrent()&&me===session&&me?.user_id===actor&&view==='books'&&booksEpoch===epoch&&booksData===d&&form.isConnected&&$('#booksInvoiceForm')===form;
  const fields=$('#booksInvoiceFields'),button=$('#booksInvoicePost'),status=$('#booksInvoiceStatus'),review=$('#booksInvoiceReview'),reload=$('#booksInvoiceReload'),quantities=$('#booksInvoiceQuantities');
  let snapshot=null,request=0,posting=false,attempt=null,uncertain=false,committed=false,selectedProforma=form.elements.proforma.value;
  const inputs=()=>[...form.querySelectorAll('[data-books-invoice-quantity]')];
  const selection=()=>booksInvoiceQuantitySelection(snapshot.lines,inputs().map(input=>input.value));
  const summary=$('#booksInvoiceErrors'),fieldErrors=new Map();form.noValidate=true;
  const collectErrors=()=>{
   const errors=nativeFormErrors(form),proforma=form.elements.proforma,invoiceDate=form.elements.date,dueDate=form.elements.due,deliveryDate=form.elements.deliverydate;
   if(proforma.value&&(!snapshot||proforma.value!==snapshot.proforma_id))errors.set(proforma,'Refresh quantities for the selected Pro forma before posting.');
   if(invoiceDate.value&&dueDate.value&&dueDate.value<invoiceDate.value&&!errors.has(dueDate))errors.set(dueDate,'Choose a due date on or after the invoice date.');
   if(deliveryDate.value&&deliveryDate.value<booksToday()&&!deliveryDate.validity.customError)errors.set(deliveryDate,'Expected delivery must be today or later.');
   if(snapshot){
    const controls=inputs();
    controls.forEach((control,index)=>{
     if(errors.has(control))return;
     try{booksInvoiceQuantitySelection([snapshot.lines[index]],[control.value]);}
     catch(error){if(error.message.startsWith('Line 1:'))errors.set(control,error.message.replace('Line 1:',`Line ${index+1}:`));}
    });
    try{selection();}catch(error){
     const line=/^Line (\d+):/.exec(error.message),control=line?controls[Number(line[1])-1]:controls.find(input=>!input.readOnly)||proforma;
     if(control&&!errors.has(control))errors.set(control,error.message);
    }
   }
   return errors;
  };
  const updateSummary=()=>{for(const control of fieldErrors.keys())if(!form.contains(control))fieldErrors.delete(control);summary.textContent=fieldErrorSummary(fieldErrors.size);};
  const validateControl=control=>{
   const problem=collectErrors().get(control)||'';if(problem)fieldErrors.set(control,problem);else fieldErrors.delete(control);
   showFieldError(control,problem);updateSummary();
  };
  form.addEventListener('focusout',event=>{
   if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);
   if(!current()||posting||uncertain||committed||!form.contains(control)||!control.matches('input,select,textarea')||control.disabled||control.readOnly)return;
   validateControl(control);
  });
  const reviewSelection=()=>{
   if(!snapshot||posting||uncertain||committed)return;
   if(snapshot.lines.every(line=>Number(line.remaining_quantity)===0)){review.textContent='All order quantities are already invoiced.';button.disabled=true;return;}
   try{const lines=selection(),count=lines.reduce((sum,line)=>sum+line.quantity,0),remaining=snapshot.lines.reduce((sum,line)=>sum+Number(line.remaining_quantity),0)-count;
    review.textContent=`${count} units selected for this invoice; ${remaining} units remain pending on this order.`;button.disabled=false;
   }catch(error){review.textContent=error.message;button.disabled=true;}
  };
  const loadQuantities=async()=>{
   if(!current()||posting||uncertain||committed)return;
   const id=form.elements.proforma.value,sequence=++request;for(const control of inputs())fieldErrors.delete(control);updateSummary();selectedProforma=id;snapshot=null;button.disabled=true;review.textContent='';status.textContent='';reload.disabled=true;
   quantities.innerHTML=id?'<p role="status">Loading current order quantities and Haadi stock…</p>':'<p class="muted">Choose an accepted Pro forma to review its quantities.</p>';
   if(!id)return;
   form.elements.proforma.disabled=true;
   try{
    const result=await booksRpc('order_invoice_quantities',{p_proforma_id:id});
    if(!current()||sequence!==request||form.elements.proforma.value!==id)return;
    if(result?.proforma_id!==id||!Number.isSafeInteger(Number(result.version))||Number(result.version)<1||!Array.isArray(result.lines))throw Error('Order quantities could not be verified. Refresh quantities before posting.');
    snapshot=result;const available=new Map();
    quantities.innerHTML=`${result.lines.every(line=>Number(line.remaining_quantity)===0)?'<p class="notice"><strong>Fully invoiced.</strong> Zero units remain to invoice. Review the linked invoices below or return to the whole order.</p>':''}<div class="table-wrap"><table class="invoice-quantity-table"><thead><tr><th>Item</th><th>Ordered</th><th>Already invoiced</th><th>Remaining</th><th>Haadi free to invoice</th><th>Invoice now</th></tr></thead><tbody>${result.lines.map((line,index)=>{
     const stock=Number(line.available_quantity),left=available.has(line.product_id)?available.get(line.product_id):stock,max=Math.min(1000000,Number(line.remaining_quantity),stock),value=Math.min(max,left);available.set(line.product_id,left-value);
     const identity=typeof inventoryProduct==='function'?inventoryProduct(line.product_id):null;
     return `<tr><td>${identity?.name?`<strong>${esc(identity.name)}</strong>${identity.sku?`<small>${esc(identity.sku)}</small>`:''}`:''}<span>${esc(line.description)}</span><small>${esc(line.uom)}</small></td><td class="numeric-cell" data-label="Ordered">${esc(line.ordered_quantity)}</td><td class="numeric-cell" data-label="Already invoiced">${esc(line.invoiced_quantity)}</td><td class="numeric-cell" data-label="Remaining">${esc(line.remaining_quantity)}</td><td class="numeric-cell" data-label="Available at Haadi">${esc(line.available_quantity)}</td><td><label><span>Invoice now · required</span><input type="number" min="0" max="${esc(max)}" step="1" required value="${esc(value)}" data-books-invoice-quantity="${esc(line.proforma_line_id)}" aria-label="Invoice now · required: ${esc(line.description)} (line ${index+1})"${max===0?' readonly':''}></label></td></tr>`;
    }).join('')}</tbody></table></div><p class="muted">Haadi availability is shared by lines for the same product and is checked again when posting.</p>`;
    inputs().forEach(input=>input.oninput=reviewSelection);reviewSelection();if(fieldErrors.has(form.elements.proforma))validateControl(form.elements.proforma);
   }catch(error){if(current()&&sequence===request){snapshot=null;quantities.textContent='Quantities could not load.';status.textContent=error.message;}}
   finally{if(current()&&sequence===request){form.elements.proforma.disabled=false;reload.disabled=false;}}
  };
  const readQuantities=origin=>{
   if(!current()||posting||uncertain||committed||origin.disabled)return;
   if(busy){if(origin===form.elements.proforma)origin.value=selectedProforma;actionFeedbackRefuse(origin,status);return;}
   actionFeedbackShow(actionFeedbackReference(origin),'');origin.disabled=true;
   return run(async()=>{try{await loadQuantities();}finally{if(current()&&!posting&&!uncertain&&!committed){form.elements.proforma.disabled=false;reload.disabled=!form.elements.proforma.value;}}},{origin,errorTarget:status,busyLabel:'Loading order quantities…'});
  };
  form.elements.proforma.onchange=()=>readQuantities(form.elements.proforma);reload.onclick=()=>readQuantities(reload);
  form.onsubmit=event=>{event.preventDefault();if(!current()||posting||committed)return;
   if(busy){actionFeedbackRefuse(button,status);return;}
   if(!uncertain){const errors=collectErrors();fieldErrors.clear();for(const [control,problem]of errors)fieldErrors.set(control,problem);updateSummary();showFieldErrors(form,errors);if(errors.size)return;}
   button.disabled=true;run(async()=>{
    if(!current()||posting||committed)return;
    try{
     if(!uncertain){
      if(form.elements.proforma.value!==snapshot.proforma_id)throw Error('Refresh quantities for the selected Pro forma before posting.');
      const f=new FormData(form),reference=String(f.get('accountsref')||'').trim(),delivery=String(f.get('deliverydate')||''),today=booksToday();
      if(!reference)throw Error('Enter the Accounts approval reference.');
      if(!delivery||delivery<today)throw Error('Expected delivery must be today or later.');
      if(!form.reportValidity())return;
      const args={p_proforma_id:snapshot.proforma_id,p_expected_version:Number(snapshot.version),p_invoice_date:f.get('date'),p_due_date:f.get('due'),p_lines:selection(),p_accounts_reference:reference,p_expected_delivery_date:delivery,p_tax_reference:String(f.get('taxref')||'').trim()},key=JSON.stringify(args);
      if(!attempt||attempt.key!==key)attempt={id:crypto.randomUUID(),key,args};
     }
     posting=true;fields.disabled=true;button.disabled=true;status.textContent='Posting invoice and reserving selected stock…';
     let result;
     try{
      result=await client.rpc('invoice_order_quantities',{p_id:attempt.id,...attempt.args});
      // Connection and unknown-completion errors keep the original request locked for retry.
      if(result.error){uncertain=!(['P0001','42501','40001','40P01'].includes(result.error.code)||/^(22|23)[0-9A-Z]{3}$/.test(result.error.code||''));throw Error(result.error.message);}
      committed=true;uncertain=false;
     }catch(error){if(!result?.error)uncertain=true;throw error;}
     if(!current())return;
     if(typeof pendingLoaded!=='undefined')pendingLoaded=false;
     if(typeof salesLoaded!=='undefined')salesLoaded=false;
     if(typeof inventoryLoaded!=='undefined')inventoryLoaded=false;
     if(typeof serviceLoaded!=='undefined')serviceLoaded=false;
     if(!current())return;
     status.textContent='Invoice posted. Selected stock is reserved and queued for packing; requested machine installations are ready for planning. Remaining quantities stay in Pending stock.';
     booksPostedConfirmation(form,'invoice',result.data,{id:attempt.id,proforma_id:attempt.args.p_proforma_id,invoice_date:attempt.args.p_invoice_date,due_date:attempt.args.p_due_date,created_by:actor,currency:'TZS'},current,row=>booksInvoiceRequestConfirmed(row,attempt.args),()=>booksOpenSavedInvoice(attempt.id,d,current));
    }catch(error){if(current())status.textContent=uncertain?`Invoice result not confirmed: ${error.message} Retry this same invoice to check the result safely. Its submitted details stay locked until confirmed.`:error.message;
    }finally{posting=false;if(current()&&committed){fields.disabled=true;button.disabled=true;button.textContent='Invoice posted';}else if(current()){fields.disabled=uncertain;button.textContent=uncertain?'Retry same invoice':'Post invoice & reserve stock';if(uncertain)button.disabled=false;else reviewSelection();}}
   },{origin:button,errorTarget:status});
  };
  if(chosen)await loadQuantities();
 }
 if(!workspaceCurrent()||me!==session||view!=='books'||booksEpoch!==epoch)return;
 $('#booksInvoicesCsv').onclick=()=>{if(invoices.some(invoice=>invoice.booksVoidPending))return;booksDownload(`invoices-${d.today}.csv`,booksCsv([['invoice_number','Invoice'],['invoice_date','Date'],['due_date','Due'],['customer','Customer'],['tra_receipt_number','TRA receipt'],['buyer_tin','Customer TIN'],['total','Total'],['paid','Paid'],['owed','Owed'],['status','Status']],
  invoices.map(i=>({...i,customer:booksCustomer(i.organization_id),total:(Number(i.total_minor)/100).toFixed(2),paid:(i.paid/100).toFixed(2),owed:(i.outstanding/100).toFixed(2),status:i.state.label}))));};
 wireBooksInvoiceActions();
}
function booksClearPrint(){
 document.body.classList.remove('books-printing');document.body.classList.remove('books-printing-sheet');
 document.querySelectorAll('.books-print-active,.books-print-host').forEach(area=>{area.classList.remove('books-print-active');area.classList.remove('books-print-host');});
}
function booksClearInvoicePreview(){booksInvoicePreview?.dispose();}
function booksPrint(area){
 booksClearPrint();area.classList.add('books-print-active');const host=area.closest('dialog.books-invoice-preview');if(host){host.classList.add('books-print-host');document.body.classList.add('books-printing-sheet');}document.body.classList.add('books-printing');
 try{window.print();}finally{booksClearPrint();}
}
// One invoice line: amount after discount and its VAT, from the snapshot taken when the invoice was made.
function booksInvoiceLineAmounts(line){
 if(line.subtotal_minor!=null&&line.discount_minor!=null&&line.tax_minor!=null)return {net:Number(line.subtotal_minor)-Number(line.discount_minor),vat:Number(line.tax_minor)};
 const gross=Number(line.quantity||0)*Number(line.unit_price_minor||0),discount=Math.round(gross*Number(line.discount_basis_points||0)/10000),net=gross-discount;
 return {net,vat:Math.round(net*Number(line.tax_basis_points||0)/10000)};
}
function booksPrintInvoice(invoice,data=booksData,{trigger=document.activeElement}={}){
 if(!invoice)return;
 if(invoice.opening_import_id){message('Opening balances are not new tax invoices.',true);return;}
 const actor=me,epoch=booksEpoch,section=booksSection,hash=location.hash,root=$('#booksBody');
 const current=()=>me===actor&&view==='books'&&booksEpoch===epoch&&booksSection===section&&location.hash===hash&&(booksData===data||booksInvoicePageData===data||booksInvoiceRecordData===data&&data.current())&&root?.isConnected&&$('#booksBody')===root;
 if(!current())return;
 if(!Array.isArray(invoice.lines)||!invoice.lines.length)throw Error('The complete invoice lines are required before printing. Reopen this invoice.');
 const lines=invoice.lines;
 const brand=typeof companyFormBrand==='function'?companyFormBrand('sales'):'<header><strong>ANUDHA LIMITED</strong><br>TIN: 100-113-473 · VRN: 10-001061-P</header>';
 booksClearInvoicePreview();
 const dialog=document.createElement('dialog');dialog.className='books-invoice-preview';
 const area=document.createElement('section');area.className='books-print';
 area.innerHTML=`${brand}<div class="books-print-title"><h2>TAX INVOICE ${esc(invoice.invoice_number)}</h2>${invoice.voided_at?'<b>VOID</b>':''}</div>
 <div class="books-print-parties"><div><small>Bill to</small><strong>${esc(booksCustomer(invoice.organization_id,data))}</strong><span>TIN: ${esc(invoice.buyer_tin||data.taxIds?.get(invoice.organization_id)?.tin||'—')}</span><span>VRN: ${esc(invoice.buyer_vrn||data.taxIds?.get(invoice.organization_id)?.vrn||'—')}</span></div>
 <div><small>Invoice</small><span>Date: ${esc(invoice.invoice_date)}</span><span>Due: ${esc(invoice.due_date)}</span><span>Pro forma: ${esc(data.proformaNumbers?.get(invoice.proforma_id)||'')}</span></div></div>
 <table><thead><tr><th>Item</th><th>Qty</th><th class="numeric-cell">Unit price</th><th>Discount</th><th class="numeric-cell">Amount</th><th>VAT</th><th class="numeric-cell">VAT amount</th></tr></thead><tbody>${lines.map(l=>{const a=booksInvoiceLineAmounts(l);return `<tr><td>${esc(l.description)}</td><td>${esc(l.quantity)} ${esc(l.uom||'')}</td><td class="numeric-cell">${booksMoney(l.unit_price_minor)}</td><td>${Number(l.discount_basis_points||0)/100}%</td><td class="numeric-cell">${booksMoney(a.net)}</td><td>${Number(l.tax_basis_points||0)/100}%</td><td class="numeric-cell">${booksMoney(a.vat)}</td></tr>`;}).join('')}</tbody></table>
 <dl><dt>Subtotal</dt><dd>${booksMoney(invoice.subtotal_minor)}</dd><dt>Discount</dt><dd>${booksMoney(invoice.discount_minor)}</dd><dt>Amount before VAT</dt><dd>${booksMoney(Number(invoice.subtotal_minor)-Number(invoice.discount_minor))}</dd><dt>VAT</dt><dd>${booksMoney(invoice.tax_minor)}</dd><dt>Total</dt><dd><strong>${booksMoney(invoice.total_minor)}</strong></dd><dt>Paid</dt><dd>${booksMoney(invoice.paid)}</dd><dt>Posted credits</dt><dd>${booksMoney(invoice.credited_minor||0)}</dd><dt>Customer credit</dt><dd>${booksMoney(invoice.customer_credit_minor||0)}</dd><dt>Balance due</dt><dd><strong>${booksMoney(invoice.outstanding)}</strong></dd></dl>
 <p class="books-print-fiscal">${invoice.tra_receipt_number?`TRA receipt: <strong>${esc(invoice.tra_receipt_number)}</strong>${invoice.tra_verification_code?` · Verification code: ${esc(invoice.tra_verification_code)}`:''}`:'<span class="chip chip--warning">TRA receipt not yet recorded</span>'}</p>
 <div class="actions no-print"><button type="button" id="booksPrintClose" class="button-quiet">Close</button><button type="button" id="booksPrintNow" class="button-primary">Print / PDF</button></div>`;
 dialog.append(area);document.body.append(dialog);
 let disposed=false,immediate=false;
 const observer=new MutationObserver(()=>{if(!current())dispose();});
 const cleanup=()=>{if(disposed)return;disposed=true;observer.disconnect();window.removeEventListener('popstate',check);window.removeEventListener('hashchange',check);if(booksInvoicePreview?.dialog===dialog)booksInvoicePreview=null;booksClearPrint();dialog.remove();if(!immediate&&current()&&(!trigger?.isConnected||trigger.disabled))root.querySelector('button:not(:disabled)')?.focus({preventScroll:true});};
 const dispose=()=>{if(disposed)return;immediate=true;dialog.getAnimations().forEach(animation=>animation.cancel());if(dialog.open)dialog.close();cleanup();};
 const check=()=>{if(!current())dispose();};
 booksInvoicePreview={dialog,dispose};dialog.addEventListener('close',cleanup);
 const dismiss=bindWorkspaceDialogDismiss(dialog);
 area.querySelector('#booksPrintClose').onclick=()=>{if(!current()){dispose();return;}return dismiss();};
 area.querySelector('#booksPrintNow').onclick=()=>{if(!current()){dispose();return;}if(!dialog.inert)booksPrint(area);};
 actionFeedbackRememberDialog(dialog);
 showWorkspaceDialog(dialog,{placement:'side',size:'large',trigger});
 observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('popstate',check);window.addEventListener('hashchange',check);
 return dialog;
}
// Money accounts: cash, bank and mobile money (codes 1100–1299), never receivables.
function booksDepositAccounts(){return booksData.accounts.filter(a=>a.active&&a.account_type==='asset'&&a.system_key!=='receivables'&&/^1[12]\d\d$/.test(a.code));}
function booksInvoiceRequestConfirmed(row,args){
 const request=row.request_content,lines=request?.lines;
 if(!request||Object.entries(args).some(([key,value])=>key!=='p_lines'&&request[key.slice(2)]!==value)||!Array.isArray(lines)||lines.length!==args.p_lines.length||new Set(lines.map(line=>line.proforma_line_id)).size!==lines.length||lines.some(line=>!args.p_lines.some(sent=>sent.proforma_line_id===line.proforma_line_id&&sent.quantity===line.quantity)))throw Error('The saved invoice does not match the submitted request.');
}
async function booksOpenSavedInvoice(id,data,current){
 const trigger=document.activeElement;
 let rows;try{rows=await booksSelect('acc_invoice_balances','*',q=>q.eq('id',id).limit(2));}catch(error){if(current())throw error;return;}
 if(!current())return;
 const row=rows.length===1?rows[0]:null;
 if(row?.id!==id||!row.invoice_number||!Array.isArray(row.lines)||!row.lines.length||!['subtotal_minor','discount_minor','tax_minor','total_minor','paid_minor','credited_minor','customer_credit_minor','outstanding_minor'].every(key=>Number.isSafeInteger(row[key]))||typeof row.status_key!=='string'||typeof row.status_label!=='string')throw Error('The current invoice details were incomplete. Retry opening the saved invoice.');
 booksPrintInvoice(booksInvoiceAmounts(row),data,{trigger});
}
function booksPostedResult(data,kind,expected){
 const row=Array.isArray(data)?(data.length===1?data[0]:null):data,receipt=kind==='receipt'||kind==='void_receipt',invoice=kind==='invoice'||kind==='void_invoice',number=receipt?'receipt_number':invoice?'invoice_number':'entry_number';
 if(!row||typeof row[number]!=='string'||!row[number].trim()||Object.entries(expected).some(([key,value])=>row[key]!==value)||receipt&&(typeof row.journal_entry_id!=='string'||!row.journal_entry_id))throw Error('The returned details were incomplete.');
 if(kind.startsWith('void_')&&(!row.voided_at||!Number.isFinite(Date.parse(row.voided_at))||typeof row.voided_by!=='string'||!row.voided_by||typeof row.void_entry_id!=='string'||!row.void_entry_id||typeof row.void_reason!=='string'||!row.void_reason))throw Error('The saved void could not be verified.');
 return row;
}
function booksPostedConfirmation(form,kind,data,expected,current,onVerified=()=>{},openSaved=null){
 if(!current()||!form.isConnected)return;
 form.inert=true;form.setAttribute('aria-disabled','true');
 const notice=document.createElement('section');notice.className='notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.dataset.booksPosted=kind;form.after(notice);
 const receipt=kind==='receipt'||kind==='void_receipt',invoice=kind==='invoice'||kind==='void_invoice',voided=kind.startsWith('void_'),target=receipt?'receipt':invoice?'invoice':kind==='reversal'?'reversal':'journal entry',verb=voided?'voided':receipt?'recorded':'posted',label=target.charAt(0).toUpperCase()+target.slice(1)+' '+verb;
 const active=()=>current()&&form.isConnected&&notice.isConnected;
 const focus=()=>{const node=document.activeElement;if(node===document.body||form.contains(node)||notice.contains(node))notice.querySelector('button')?.focus({preventScroll:true});};
 const snapshot=voided?'Displayed balances are from before this void. Open the saved record to check its current details.':invoice?'Quantities, stock availability and invoice list below are from before this posting. Open the saved invoice to check current details.':receipt?'Invoice balances in the submitted form are from before this receipt. Open the saved receipt to check its current details.':'The submitted details are read-only. Open the saved entry to inspect its posted lines.';
 let reading=false;
 const show=row=>{
  if(!active())return;
  onVerified(row);
  notice.innerHTML=`<p>${esc(receipt?row.receipt_number:invoice?row.invoice_number:row.entry_number)} ${verb}. ${esc(snapshot)}</p><button type="button" data-books-posted-open>Open saved ${target}</button>`;
  const button=notice.querySelector('[data-books-posted-open]');button.onclick=()=>run(async()=>{if(!active())return;if(openSaved){try{await openSaved();if(active()){notice.querySelector('p').textContent=`${receipt?row.receipt_number:invoice?row.invoice_number:row.entry_number} ${verb}. ${snapshot}`;button.textContent=`Open saved ${target}`;}}catch(error){if(active()){notice.querySelector('p').textContent=`${label}, but current details could not load: ${error.message} ${snapshot}`;button.textContent=`Retry opening saved ${target}`;}}}else{booksTransactionSelected=row.id;booksDraft=null;await booksWorkspace();}});focus();
 };
 const failed=error=>{
  if(!active())return;
  notice.innerHTML=`<p>${label}, but its saved details could not be verified: ${esc(error.message)} The submitted form is locked to prevent another posting. ${esc(snapshot)}</p><button type="button" data-books-posted-retry>Retry saved details</button>`;
  const retry=notice.querySelector('[data-books-posted-retry]');retry.onclick=()=>run(async()=>{
   if(!active()||reading)return;reading=true;retry.disabled=true;
   try{const rows=await booksSelect(receipt?'acc_receipts':invoice?'acc_invoices':'acc_journal_entries','*',q=>q.eq('id',expected.id).limit(2));if(active())show(booksPostedResult(rows,kind,expected));}
   catch(error){if(active())failed(error);}
   finally{reading=false;if(active()&&retry.isConnected)retry.disabled=false;}
  });focus();
 };
 try{show(booksPostedResult(data,kind,expected));}catch(error){failed(error);}
}
async function booksReceipts(actor,current){
 const d=booksData,session=me,active=()=>current()&&me===session&&me?.user_id===actor&&booksData===d;
 if(!active())return;
 if(booksTransactionSelected!=='new'){
  const receipt=d.receipts.find(row=>row.id===booksTransactionSelected);
  if(!receipt)throw Error('This receipt is no longer available. Return to the register and refresh.');
  const allocations=d.allocations.filter(row=>row.receipt_id===receipt.id);
  $('#booksBody').innerHTML=`<section class="card"><h2>${esc(receipt.receipt_number)}</h2><p>${esc(booksCustomer(receipt.organization_id))} · ${esc(receipt.receipt_date)}</p><p>${booksMoney(receipt.amount_minor)} · ${esc(booksMethods.find(([key])=>key===receipt.method)?.[1]||receipt.method)} · ${esc(receipt.reference)}</p>${receipt.voided_at?`<p class="notice">Void · ${esc(receipt.void_reason||'')}</p>`:'<button type="button" class="danger" id="booksReceiptVoid">Void receipt</button>'}<h3>Applied to invoices</h3>${allocations.length?`<ul>${allocations.map(row=>`<li>${esc(d.invoices.find(invoice=>invoice.id===row.invoice_id)?.invoice_number||'Invoice')} · ${booksMoney(row.amount_minor)}</li>`).join('')}</ul>`:'<p>Customer credit</p>'}</section>`;
  booksTransactionBack(actor,current);
  const button=$('#booksReceiptVoid');if(button&&!receipt.voided_at)button.onclick=()=>{if(active()&&button.isConnected)booksVoidPrompt('receipt',receipt,d);};
  return;
 }
 const draft=booksDraft?.receipt||{organizationId:'',amount:'',method:'bank'};
 const openFor=org=>d.invoices.filter(i=>i.organization_id===org&&!i.voided_at&&i.outstanding>0);
 const deposits=booksDepositAccounts();
 $('#booksBody').innerHTML=`<section class="card"><h2>Record money received from a customer</h2><form id="booksReceiptForm"><p id="booksReceiptErrors" class="error" role="alert"></p><div class="grid">
  <label class="wide"><span>Customer · required</span><select name="organization" required data-lookup-rows="organizations"><option value="">Choose client / branch</option>${typeof salesOrganizationOptions==='function'?salesOrganizationOptions():''}</select></label>
  <label><span>Date received · required</span><input name="date" type="date" required value="${esc(d.today)}"></label>
  <label><span>Amount (TZS) · required</span><input name="amount" inputmode="decimal" required placeholder="e.g. 1500000"></label>
  <label><span>How it was paid</span><select name="method">${booksMethods.map(([k,l])=>`<option value="${k}"${k===draft.method?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
  <label><span>Paid into · required</span><select name="deposit" required>${deposits.map(a=>`<option value="${esc(a.id)}"${a.system_key==='bank'?' selected':''}>${esc(booksAccountLabel(a))}</option>`).join('')}</select></label>
  <label class="wide"><span>Reference (bank slip, M-Pesa code, cheque number) · optional</span><input name="reference" maxlength="120"></label></div>
  <div id="booksAllocation"><p class="muted">Choose a customer to see what they owe.</p></div>
  <p id="booksReceiptCheck" class="muted"></p>
  <div class="actions"><button type="submit">Record receipt</button></div></form></section>`;
 booksTransactionBack(actor,current);
 const form=$('#booksReceiptForm'),id=crypto.randomUUID();let committed=false,posting=false;
 const summary=$('#booksReceiptErrors'),fieldErrors=new Map();form.noValidate=true;
 const allocationInputs=()=>[...document.querySelectorAll('[data-books-allocate]')];
 const check=()=>{
  let amount=0,applied=0,problem='';const errors=new Map(),running=[];
  try{amount=form.amount.value.trim()?moneyMinor(form.amount.value):0;}catch(error){problem=`Amount: ${error.message}`;errors.set(form.amount,error.message);}
  for(const input of allocationInputs()){if(!input.value.trim())continue;try{applied+=moneyMinor(input.value);running.push([input,applied]);}catch(error){problem=problem||`Allocation: ${error.message}`;errors.set(input,error.message);}}
  if(!problem&&applied>amount){problem='The amounts applied add up to more than the amount received.';errors.set(running.find(([,total])=>total>amount)[0],problem);}
  $('#booksReceiptCheck').textContent=problem||(amount?`Applied ${moneyDisplay(applied)} · left as customer credit ${moneyDisplay(amount-applied)}`:'');
  $('#booksReceiptCheck').className=problem?'error':'muted';
  return {amount,problem,errors};
 };
 const collectErrors=()=>{
  const errors=nativeFormErrors(form),result=check();
  for(const [control,problem]of result.errors)if(!errors.has(control))errors.set(control,problem);
  if(!result.amount&&!errors.has(form.amount))errors.set(form.amount,'Enter the amount received.');
  return {amount:result.amount,errors};
 };
 const updateSummary=()=>{for(const control of fieldErrors.keys())if(!form.contains(control))fieldErrors.delete(control);summary.textContent=fieldErrorSummary(fieldErrors.size);};
 const validateControl=control=>{const problem=collectErrors().errors.get(control)||'';if(problem)fieldErrors.set(control,problem);else fieldErrors.delete(control);showFieldError(control,problem);updateSummary();};
 form.addEventListener('focusout',event=>{
  if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);
  if(!active()||!form.isConnected||posting||committed||!form.contains(control)||!control.matches('input,select,textarea')||control.disabled||control.readOnly)return;
  validateControl(control);
 });
 const showOpen=()=>{
  const open=openFor(form.organization.value);
  $('#booksAllocation').innerHTML=!form.organization.value?'<p class="muted">Choose a customer to see what they owe.</p>':open.length?`<h3>Apply to invoices</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Due</th><th class="numeric-cell">Owed</th><th>Apply (TZS)</th></tr></thead><tbody>${open.map(i=>`<tr><td>${esc(i.invoice_number)}</td><td>${esc(i.due_date)}</td><td class="numeric-cell">${booksMoney(i.outstanding)}</td><td><label><span>Apply (TZS) · optional</span><input data-books-allocate="${esc(i.id)}" inputmode="decimal" aria-label="Apply (TZS) · optional · ${esc(i.invoice_number)}"></label></td></tr>`).join('')}</tbody></table></div><button type="button" id="booksOldestFirst">Apply to oldest invoices first</button>`:'<p class="muted">This customer has no unpaid invoices. The receipt will be kept as a customer credit.</p>';
  const oldest=$('#booksOldestFirst');
  if(oldest)oldest.onclick=()=>{const {amount,problem}=check();if(problem&&!amount)return;const plan=booksAllocateOldest(amount,open);allocationInputs().forEach(input=>{const v=plan.get(input.dataset.booksAllocate);input.value=v?(v/100).toFixed(2):'';});check();for(const control of [...fieldErrors.keys()])validateControl(control);};
  allocationInputs().forEach(input=>input.oninput=check);check();updateSummary();
 };
 form.organization.onchange=showOpen;form.amount.oninput=check;showOpen();
 form.onsubmit=event=>{event.preventDefault();if(!active()||!form.isConnected||committed||posting)return;const {amount,errors}=collectErrors();fieldErrors.clear();for(const [control,problem]of errors)fieldErrors.set(control,problem);updateSummary();showFieldErrors(form,errors);if(errors.size)return;
  const allocations=allocationInputs().filter(i=>i.value.trim()).map(i=>({invoice_id:i.dataset.booksAllocate,amount_minor:moneyMinor(i.value)}));
  const args={p_id:id,p_organization_id:form.organization.value,p_date:form.date.value,p_amount_minor:amount,p_method:form.method.value,p_reference:form.reference.value,p_deposit_account_id:form.deposit.value,p_allocations:allocations};
  run(async()=>{if(!active()||!form.isConnected||committed||posting)return;posting=true;form.inert=true;
   try{
    const r=await booksRpc('record_receipt',args);committed=true;if(!active()||!form.isConnected)return;
    booksPostedConfirmation(form,'receipt',r,{id,organization_id:args.p_organization_id,receipt_date:args.p_date,amount_minor:args.p_amount_minor,method:args.p_method,reference:args.p_reference.replace(/^ +| +$/g,''),deposit_account_id:args.p_deposit_account_id,created_by:actor},active);
   }catch(error){if(active()&&form.isConnected)throw error;}
   finally{posting=false;if(!committed&&active()&&form.isConnected)form.inert=false;}
  });};
}
async function booksJournal(actor,current){
 const d=booksData,session=me,valid=()=>current()&&me===session&&me?.user_id===actor&&booksData===d;
 if(!valid())return;
 if(booksTransactionSelected!=='new')return booksJournalDetail(actor,current);
 const draft=booksDraft?.journal||{date:d.today,memo:'',lines:[{},{}]};
 const active=d.accounts.filter(a=>a.active);
 const lineRow=(line,i)=>`<tr><td><label><span>Account · required when used</span><select data-jl="accountId" data-i="${i}" aria-label="Account · required when used, line ${i+1}"><option value="">Choose account</option>${booksTypes.map(([type,label])=>`<optgroup label="${label}">${active.filter(a=>a.account_type===type).map(a=>`<option value="${esc(a.id)}"${a.id===line.accountId?' selected':''}>${esc(booksAccountLabel(a))}</option>`).join('')}</optgroup>`).join('')}</select></label></td><td><label><span>Debit (TZS)</span><input data-jl="debit" data-i="${i}" inputmode="decimal" value="${esc(line.debit||'')}" aria-label="Debit (TZS), line ${i+1}"></label></td><td><label><span>Credit (TZS)</span><input data-jl="credit" data-i="${i}" inputmode="decimal" value="${esc(line.credit||'')}" aria-label="Credit (TZS), line ${i+1}"></label></td><td><label><span>Note · optional</span><input data-jl="description" data-i="${i}" maxlength="300" value="${esc(line.description||'')}" aria-label="Note · optional, line ${i+1}"></label></td></tr>`;
 $('#booksBody').innerHTML=`<section class="card"><h2>New journal entry</h2><p class="muted">For anything that is not a customer invoice or receipt: expenses, supplier bills, salaries, opening balances, depreciation. Debits must equal credits.</p><form id="booksJournalForm"><p id="booksJournalErrors" class="error" role="alert"></p><p class="muted">Date and description are required. Use at least two lines, each with an account and either a debit or a credit. Leave unused lines blank.</p><div class="grid"><label><span>Date · required</span><input name="date" type="date" required value="${esc(draft.date)}"></label><label><span>Description · required</span><input name="memo" required minlength="3" maxlength="500" value="${esc(draft.memo)}" placeholder="e.g. October office rent"></label></div>
 <div class="table-wrap"><table><thead><tr><th>Account</th><th>Debit (TZS)</th><th>Credit (TZS)</th><th>Note</th></tr></thead><tbody id="booksJournalLines">${draft.lines.map(lineRow).join('')}</tbody></table></div>
 <p id="booksJournalCheck" class="muted"></p><div class="actions"><button type="button" id="booksAddLine">Add line</button><button type="submit">Post entry</button></div></form></section>`;
 booksTransactionBack(actor,current);
 const form=$('#booksJournalForm'),id=crypto.randomUUID();let committed=false,posting=false;
 const read=()=>{const out=[];document.querySelectorAll('[data-jl]').forEach(input=>{const i=Number(input.dataset.i);out[i]=out[i]||{};out[i][input.dataset.jl]=input.value;});return out;};
 const button=form.querySelector('[type="submit"]'),summary=$('#booksJournalErrors'),fieldErrors=new Map();form.noValidate=true;
 const collectErrors=()=>{
  const errors=nativeFormErrors(form),lines=read(),control=(index,key)=>form.querySelector(`[data-jl="${key}"][data-i="${index}"]`),add=(input,problem)=>{if(input&&!errors.has(input))errors.set(input,problem);};
  lines.forEach((line,index)=>{
   for(const key of ['debit','credit'])if(String(line[key]||'').trim())try{moneyMinor(line[key]);}catch(error){add(control(index,key),`Line ${index+1}: ${error.message}`);}
   const problem=booksJournalCheck([line]).problem.replace(/^Line 1:/,`Line ${index+1}:`);
   if(problem===`Line ${index+1}: choose an account.`)add(control(index,'accountId'),problem);
   if(problem===`Line ${index+1}: enter either a debit or a credit.`)for(const key of ['debit','credit'])add(control(index,key),problem);
  });
  const result=booksJournalCheck(lines);
  if(result.problem&&!/^Line \d+:/.test(result.problem)){
   const key=result.difference>0?'credit':'debit',index=result.problem==='An entry needs at least two lines.'?lines.findIndex(line=>!line.accountId&&!String(line.debit||'').trim()&&!String(line.credit||'').trim()):lines.findIndex(line=>String(line[key]||'').trim());
   add(control(Math.max(0,index),result.problem==='An entry needs at least two lines.'?'accountId':key),result.problem);
  }
  return errors;
 };
 const updateSummary=()=>{summary.textContent=fieldErrorSummary(fieldErrors.size);};
 const validateControl=(control,errors=collectErrors())=>{const problem=errors.get(control)||'';if(problem)fieldErrors.set(control,problem);else fieldErrors.delete(control);showFieldError(control,problem);updateSummary();};
 form.addEventListener('focusout',event=>{if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);if(!valid()||!form.isConnected||committed||posting||!form.contains(control)||!control.matches('input,select,textarea')||control.disabled||control.readOnly)return;validateControl(control);});
 form.addEventListener('change',event=>{if(!event.target.matches('select,input[type="checkbox"],input[type="radio"]')||!valid()||!form.isConnected||committed||posting)return;const errors=collectErrors();for(const control of fieldErrors.keys())validateControl(control,errors);});
 const check=()=>{const result=booksJournalCheck(read());$('#booksJournalCheck').textContent=result.problem||`Balanced: ${moneyDisplay(result.debit)} debit and credit.`;$('#booksJournalCheck').className=result.problem?'error':'muted';return result;};
 const save=()=>{booksDraft={journal:{date:form.date.value,memo:form.memo.value,lines:read()}};};
 form.oninput=check;check();
 $('#booksAddLine').onclick=()=>{if(!valid()||!form.isConnected||committed||posting)return;save();booksDraft.journal.lines.push({});booksJournal(actor,current);};
 form.onsubmit=event=>{event.preventDefault();if(!valid()||!form.isConnected||committed||posting)return;if(busy){actionFeedbackRefuse(button,summary);return;}const result=check();
  const errors=collectErrors();fieldErrors.clear();for(const [control,problem]of errors)fieldErrors.set(control,problem);updateSummary();showFieldErrors(form,errors);if(errors.size||result.problem)return;
  const posted=read().filter(l=>l.accountId||String(l.debit||'').trim()||String(l.credit||'').trim()).map(l=>({account_id:l.accountId,debit_minor:String(l.debit||'').trim()?moneyMinor(l.debit):0,credit_minor:String(l.credit||'').trim()?moneyMinor(l.credit):0,description:l.description||''}));
  const args={p_id:id,p_date:form.date.value,p_memo:form.memo.value,p_lines:posted};
  run(async()=>{if(!valid()||!form.isConnected||committed||posting)return;posting=true;form.inert=true;
   try{
    const r=await booksRpc('post_manual_journal',args);committed=true;if(!valid()||!form.isConnected)return;
    booksPostedConfirmation(form,'journal',r,{id,entry_date:args.p_date,memo:args.p_memo.replace(/^ +| +$/g,''),source_type:'manual',source_id:null,reverses_entry_id:null,currency:'TZS',created_by:actor},valid);
   }catch(error){if(valid()&&form.isConnected)throw error;}
   finally{posting=false;if(!committed&&valid()&&form.isConnected)form.inert=false;}
  },{origin:button,errorTarget:summary});};
}
async function booksJournalDetail(actor,current){
 const d=booksData,session=me,id=booksTransactionSelected,active=()=>current()&&me===session&&me?.user_id===actor&&booksData===d&&booksTransactionSelected===id;
 const [entries,lines,reversals]=await Promise.all([
  booksSelect('acc_journal_entries','*',q=>q.eq('id',id).limit(1)),
  booksSelectAll('acc_journal_lines','*',q=>q.eq('entry_id',id).order('line_no')),
  booksSelect('acc_journal_entries','id',q=>q.eq('reverses_entry_id',id).limit(1))
 ]);
 if(!active())return;
 const entry=entries[0];if(entry?.id!==id||!lines.length||lines.some(line=>line.entry_id!==id))throw Error('This journal entry could not be loaded completely. Return to the register and refresh.');
 const reversed=reversals.length>0;
 $('#booksBody').innerHTML=`<section class="card"><article class="contact" id="booksJournalDetail"><div class="heading"><div><h2>${esc(entry.entry_number)} · ${esc(entry.entry_date)}</h2><p>${esc(entry.memo)}</p><small>${esc({manual:'Journal entry',invoice:'Customer invoice',receipt:'Customer receipt',reversal:'Reversal',credit_note:'Return credit'}[entry.source_type])} · by ${esc(typeof employeeName==='function'?employeeName(entry.created_by):'')}</small></div>${entry.source_type==='manual'&&!reversed?'<button type="button" id="booksJournalReverse">Reverse</button>':reversed?'<span class="tag">Reversed</span>':''}</div><div class="table-wrap"><table><thead><tr><th>Account</th><th class="numeric-cell">Debit</th><th class="numeric-cell">Credit</th><th>Note</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${esc(booksAccountLabel(d.accounts.find(account=>account.id===line.account_id)))}${line.organization_id?`<small>${esc(booksCustomer(line.organization_id))}</small>`:''}</td><td>${Number(line.debit_minor)?booksMoney(line.debit_minor):''}</td><td>${Number(line.credit_minor)?booksMoney(line.credit_minor):''}</td><td><small>${esc(line.description)}</small></td></tr>`).join('')}</tbody></table></div></article></section>`;
 booksTransactionBack(actor,current);
 const button=$('#booksJournalReverse');if(!button||entry.source_type!=='manual'||reversed)return;
 button.onclick=()=>{
  if(!active()||!button.isConnected||button.disabled)return;
  const box=document.createElement('form');box.className='card';
  box.innerHTML=`<p id="booksReversalErrors" class="error" role="alert"></p><h3>Reverse ${esc(entry.entry_number)}</h3><div class="grid"><label><span>Date of the reversal · required</span><input name="date" type="date" required value="${esc(d.today)}"></label><label><span>Reason (at least 5 characters) · required</span><input name="reason" required minlength="5" maxlength="300"></label></div><div class="actions"><button type="submit">Post reversal</button></div>`;
  $('#booksJournalDetail').append(box);button.disabled=true;const reversalId=crypto.randomUUID();let committed=false,posting=false;
  const summary=box.querySelector('#booksReversalErrors'),submit=box.querySelector('[type="submit"]'),validate=booksFormValidation(box,summary,()=>active()&&!committed&&!posting);
  box.onsubmit=event=>{event.preventDefault();if(!active()||!box.isConnected||committed||posting)return;if(!validate())return;
   const args={p_id:reversalId,p_entry_id:entry.id,p_date:box.date.value,p_reason:box.reason.value};
   run(async()=>{if(!active()||!box.isConnected||committed||posting)return;posting=true;box.inert=true;
    try{
     const r=await booksRpc('reverse_journal_entry',args);committed=true;if(!active()||!box.isConnected)return;
     booksPostedConfirmation(box,'reversal',r,{id:reversalId,entry_date:args.p_date,memo:`Reversal of ${entry.entry_number}: ${args.p_reason.replace(/^ +| +$/g,'')}`,source_type:'reversal',source_id:entry.source_id,reverses_entry_id:entry.id,currency:'TZS',created_by:actor},active,()=>{button.textContent='Reversed';button.disabled=true;});
    }catch(error){if(active()&&box.isConnected)throw error;}
    finally{posting=false;if(!committed&&active()&&box.isConnected)box.inert=false;}
   },{origin:submit,errorTarget:summary});};
 };
}

function booksAccountFormHtml(editing){
 return `<h2>${editing?.version?`Edit ${esc(editing.code)}`:'Add an account'}</h2><p class="muted">Standard starting list; ask the accountant to match it to the TallyPrime ledgers. Accounts used by automatic postings cannot be switched off.</p><form id="booksAccountForm"><p id="booksAccountErrors" class="error" role="alert"></p><div class="grid">
  <label><span>Code (4 to 6 digits) · required</span><input name="code" required pattern="[0-9]{4,6}" value="${esc(editing?.code||'')}"></label>
  <label><span>Name · required</span><input name="name" required minlength="2" maxlength="120" value="${esc(editing?.name||'')}"></label>
  <label><span>Type</span><select name="type">${booksTypes.map(([k,l])=>`<option value="${k}"${k===(editing?.account_type||'expense')?' selected':''}>${esc(l.replace(/s$/,''))}</option>`).join('')}</select></label>
  <label><span>In use</span><select name="active"><option value="true"${editing?.active===false?'':' selected'}>Yes</option><option value="false"${editing?.active===false?' selected':''}>No (hidden from new entries)</option></select></label></div>
  <div class="actions"><button type="submit">${editing?.version?'Save changes':'Add account'}</button>${editing?'<button type="button" id="booksAccountCancel">Cancel</button>':''}</div></form>`;
}
function booksAccountRow(account,balance){const a=account;return `<tr data-books-account-row="${esc(a.id)}" role="row"${a.active?'':' class="muted"'}><td role="cell" data-label="Code"><span class="phone-cell-label" aria-hidden="true">Code</span>${esc(a.code)}</td><td role="cell" data-label="Name"><span class="phone-cell-label" aria-hidden="true">Name</span>${esc(a.name)}${a.system_key?'<small>Used by automatic postings</small>':''}${a.active?'':'<small>Not in use</small>'}</td><td class="numeric-cell" role="cell" data-label="Balance today"><span class="phone-cell-label" aria-hidden="true">Balance today</span>${booksMoney(['asset','expense'].includes(a.account_type)?balance:-balance)}</td><td role="cell" data-label="Actions" class="phone-card-actions"><span class="phone-cell-label" aria-hidden="true">Actions</span><button type="button" data-books-edit-account="${esc(a.id)}">Edit</button> <button type="button" data-books-account-ledger="${esc(a.id)}">Ledger</button></td></tr>`;}
function booksAccountPageResult(data){
 if(!data||!Array.isArray(data.accounts)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||data.pages!==Math.max(1,Math.ceil(data.total/50))||data.page>=data.pages||data.accounts.length!==Math.min(50,data.total-data.page*50)||new Set(data.accounts.map(row=>row.id)).size!==data.accounts.length||!Number.isSafeInteger(data.settings?.version)||!Object.hasOwn(data.settings,'locked_through')||!/^\d{4}-\d{2}-\d{2}$/.test(data.today)||!data.summary||!['account_count','debit_minor','credit_minor'].every(key=>Number.isSafeInteger(data.summary[key])&&data.summary[key]>=0)||data.total>data.summary.account_count||data.accounts.some(row=>!row.id||typeof row.code!=='string'||typeof row.name!=='string'||!booksTypes.some(([type])=>type===row.account_type)||typeof row.active!=='boolean'||!Number.isSafeInteger(row.version)||row.version<1||!Number.isSafeInteger(row.balance_minor)||!(row.system_key===null||typeof row.system_key==='string')))throw Error('The account page was incomplete. Refresh before relying on these balances.');
 return data;
}
async function loadBooksAccountPage(current){
 let data;try{data=await booksRpc('acc_account_page',{p_as_of:booksToday(),p_query:booksAccountSearch,p_type:booksAccountType,p_page:booksAccountPage});}catch(error){if(!current())return null;throw error;}
 return current()?booksAccountPageResult(data):null;
}
async function booksAccounts(actor,current){
 const d=booksAccountPageData,session=me,epoch=booksEpoch;
 if(!current())return;
 const bal=id=>d.accounts.find(row=>row.id===id)?.balance_minor||0;
 const active=()=>current()&&me===session&&me?.user_id===actor&&booksEpoch===epoch&&booksAccountPageData===d&&view==='books';
 const pageStatus=()=>`Page ${d.page+1} of ${d.pages} · ${d.total} matching accounts`,summary=()=>`Whole chart (${d.summary.account_count} accounts), as at ${d.today}: debits ${booksMoney(d.summary.debit_minor)} · credits ${booksMoney(d.summary.credit_minor)}.`;
 $('#booksBody').innerHTML=`<section class="card"><div class="heading"><h2>Chart of accounts</h2><button type="button" id="booksAccountNew">New account</button></div><form id="booksAccountFilters" class="grid"><label><span>Search code or account name</span><input name="query" type="search" maxlength="2000" value="${esc(booksAccountSearch)}"></label><label><span>Account type</span><select name="type"><option value="">All types</option>${booksTypes.map(([type,label])=>`<option value="${type}"${booksAccountType===type?' selected':''}>${label}</option>`).join('')}</select></label><div class="actions"><button type="submit">Apply filters</button><button type="button" id="booksAccountRefresh">Refresh</button></div></form><p id="booksAccountTotals">${esc(summary())}</p><p id="booksAccountPageError" role="alert"></p><div class="actions"><button type="button" id="booksAccountPrevious" ${d.page===0?'disabled':''}>Previous</button><span id="booksAccountPageStatus" tabindex="-1">${pageStatus()}</span><button type="button" id="booksAccountNext" ${d.page>=d.pages-1?'disabled':''}>Next</button></div></section><section class="card" id="booksAccountEditor" hidden></section>
 ${d.settings&&typeof me!=='undefined'&&me?.role==='owner'?`<details class="card"><summary>Lock the books</summary><p class="muted">Nothing can be posted on or before the lock date. Owner only.</p><form id="booksLockForm"><p id="booksLockErrors" class="error" role="alert"></p><div class="actions"><label><span>Locked through · optional (blank removes the lock)</span><input name="date" type="date" value="${esc(d.settings.locked_through||'')}" aria-label="Locked through"></label><button type="submit">Save lock date</button></div></form></details>`:''}
 ${booksTypes.map(([type,label])=>`<section class="card" data-books-account-group="${type}" ${d.accounts.some(account=>account.account_type===type)?'':'hidden'}><h2>${esc(label)}</h2><div class="table-wrap"><table class="books-account-table" role="table" aria-label="${esc(label)}"><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Code</th><th scope="col" role="columnheader">Name</th><th scope="col" role="columnheader" class="numeric-cell">Balance today</th><th scope="col" role="columnheader">Actions</th></tr></thead><tbody data-books-account-type="${type}" role="rowgroup">${d.accounts.filter(a=>a.account_type===type).map(a=>booksAccountRow(a,bal(a.id))).join('')}</tbody></table></div></section>`).join('')}<p id="booksAccountEmpty" ${d.accounts.length?'hidden':''}>No accounts match these filters.</p>`;
 const filters=$('#booksAccountFilters');filters.onsubmit=event=>{event.preventDefault();if(!active())return;booksAccountSearch=filters.query.value;booksAccountType=filters.type.value;booksAccountPage=0;booksDraft=null;run(async()=>{const request=booksEpoch+1;await booksWorkspace();if(me===session&&booksEpoch===request&&view==='books'&&booksSection==='accounts')$('#booksAccountFilters')?.query.focus({preventScroll:true});});};
 $('#booksAccountRefresh').onclick=()=>run(()=>{if(active())return booksWorkspace();});
 for(const [direction,step] of [['Previous',-1],['Next',1]])$('#booksAccount'+direction).onclick=()=>run(async()=>{if(!active())return;booksAccountPage+=step;booksDraft=null;const request=booksEpoch+1;await booksWorkspace();if(me===session&&booksEpoch===request&&view==='books'&&booksSection==='accounts'){const button=$('#booksAccount'+direction);(button?.disabled?$('#booksAccountPageStatus'):button)?.focus({preventScroll:true});}});
 const refresh=async()=>{
  try{
   const next=await loadBooksAccountPage(active);if(!active())return;
   const existing=new Map([...document.querySelectorAll('[data-books-account-row]')].map(row=>[row.dataset.booksAccountRow,row])),left=window.scrollX,top=window.scrollY,focused=document.activeElement,focusId=focused?.dataset?.booksEditAccount||focused?.dataset?.booksAccountLedger,focusKey=focused?.dataset?.booksEditAccount?'booksEditAccount':'booksAccountLedger';
   for(const [type] of booksTypes){const group=[...document.querySelectorAll('[data-books-account-type]')].find(body=>body.dataset.booksAccountType===type),rows=next.accounts.filter(account=>account.account_type===type);rows.forEach((account,index)=>{const html=booksAccountRow(account,account.balance_minor);let row=existing.get(account.id);if(!row||row.booksAccountHtml!==html){const template=document.createElement('template');template.innerHTML=html;const replacement=template.content.firstElementChild;replacement.booksAccountHtml=html;row?.remove();row=replacement;bindRows(row);}if(group.children[index]!==row)group.insertBefore(row,group.children[index]||null);});}
   for(const [id,row] of existing)if(!next.accounts.some(account=>account.id===id))row.remove();
   const settings=d.settings;Object.assign(d,next,{settings});booksAccountPage=d.page;document.querySelectorAll('[data-books-account-group]').forEach(group=>group.hidden=!d.accounts.some(account=>account.account_type===group.dataset.booksAccountGroup));$('#booksAccountTotals').textContent=summary();$('#booksAccountPageStatus').textContent=pageStatus();$('#booksAccountPrevious').disabled=d.page===0;$('#booksAccountNext').disabled=d.page>=d.pages-1;$('#booksAccountEmpty').hidden=!!d.accounts.length;$('#booksAccountPageError').textContent='';if(focusId&&document.activeElement===document.body){const target=[...document.querySelectorAll('[data-books-edit-account],[data-books-account-ledger]')].find(button=>button.dataset[focusKey]===focusId);(target||$('#booksAccountPageStatus'))?.focus({preventScroll:true});}window.scrollTo({left,top,behavior:'instant'});
  }catch(error){if(active())$('#booksAccountPageError').textContent=`Account saved, but the chart could not refresh: ${error.message}. Press Refresh to retry.`;}
 };
 const bindRows=target=>{
  target.querySelectorAll('[data-books-edit-account]').forEach(b=>b.onclick=()=>run(()=>{if(!active())return;booksDraft={account:d.accounts.find(a=>a.id===b.dataset.booksEditAccount)};renderForm(booksDraft.account,true);}));
  target.querySelectorAll('[data-books-account-ledger]').forEach(b=>b.onclick=()=>run(()=>{if(!active())return;booksSection='reports';booksReport={...booksReport,kind:'ledger',accountId:b.dataset.booksAccountLedger};booksLedgerPage=0;booksDraft=null;syncWorkspaceNavigation();return booksWorkspace();}));
 };
 const renderForm=(editing,focus=false)=>{
  const editor=$('#booksAccountEditor'),left=window.scrollX,top=window.scrollY;editor.hidden=false;editor.innerHTML=booksAccountFormHtml(editing);
  const form=$('#booksAccountForm'),id=editing?.id||crypto.randomUUID();let committed=false;
  const errors=$('#booksAccountErrors'),validate=booksFormValidation(form,errors,()=>active()&&!committed);
  if(focus){form.code.focus({preventScroll:true});window.scrollTo({left,top,behavior:'instant'});}
  form.onsubmit=event=>{event.preventDefault();if(!active()||!form.isConnected||committed)return;if(!validate())return;run(async()=>{
   if(!active()||!form.isConnected||committed)return;
   const saved=await booksRpc('save_ledger_account',{p_id:id,p_expected_version:editing?.version??null,p_code:form.code.value,p_name:form.name.value,p_type:form.type.value,p_active:form.active.value==='true'});
   committed=true;if(!active()||!form.isConnected)return;
   if(saved?.id!==id||!Number.isSafeInteger(saved.version)||saved.version!==(editing?.version?editing.version+1:1)||!booksTypes.some(([type])=>type===saved.account_type)||typeof saved.code!=='string'||!/^\d{4,6}$/.test(saved.code)||typeof saved.name!=='string'||saved.name.trim().length<2||typeof saved.active!=='boolean'||!(saved.system_key===null||typeof saved.system_key==='string')){form.inert=true;message('Account saved, but the returned details were incomplete. Reopen Chart of accounts before making another change.',true);return;}
   const balance=bal(id);saved.balance_minor=balance;const index=d.accounts.findIndex(account=>account.id===id);if(index<0){if(d.accounts.length<50)d.accounts.push(saved);}else d.accounts[index]=saved;d.accounts.sort((a,b)=>a.code.localeCompare(b.code));
   const left=window.scrollX,top=window.scrollY,focus=form.contains(document.activeElement)||document.activeElement===document.body;
   const focusedAction=document.activeElement?.dataset?.booksEditAccount===id?'[data-books-edit-account]':document.activeElement?.dataset?.booksAccountLedger===id?'[data-books-account-ledger]':null;
   const previous=[...document.querySelectorAll('[data-books-account-row]')].find(row=>row.dataset.booksAccountRow===id),template=document.createElement('template');
   template.innerHTML=booksAccountRow(saved,balance);const row=template.content.firstElementChild;row.booksAccountHtml=booksAccountRow(saved,balance);
   const group=[...document.querySelectorAll('[data-books-account-type]')].find(body=>body.dataset.booksAccountType===saved.account_type);
   previous?.remove();const after=d.accounts.slice(d.accounts.findIndex(account=>account.id===id)+1).find(account=>account.account_type===saved.account_type);
   if(d.accounts.some(account=>account.id===id))group.insertBefore(row,after?[...group.querySelectorAll('[data-books-account-row]')].find(item=>item.dataset.booksAccountRow===after.id)||null:null);bindRows(row);
   booksDraft=null;editor.innerHTML='';editor.hidden=true;if(focus)$('#booksAccountNew')?.focus({preventScroll:true});else if(focusedAction)row.querySelector(focusedAction)?.focus({preventScroll:true});window.scrollTo({left,top,behavior:'instant'});message('Account saved.');await refresh();
  },{origin:form.querySelector('[type="submit"]'),errorTarget:errors});};
  const cancel=$('#booksAccountCancel');if(cancel)cancel.onclick=()=>{if(!active())return;booksDraft=null;editor.innerHTML='';editor.hidden=true;$('#booksAccountNew')?.focus({preventScroll:true});};
 };
 $('#booksAccountNew').onclick=()=>{if(active()){booksDraft={account:{id:crypto.randomUUID()}};renderForm(booksDraft.account,true);}};
 if(booksDraft?.account)renderForm(booksDraft.account);bindRows(document);document.querySelectorAll('[data-books-account-row]').forEach(row=>{const account=d.accounts.find(account=>account.id===row.dataset.booksAccountRow);if(account)row.booksAccountHtml=booksAccountRow(account,bal(account.id));});
 const lock=$('#booksLockForm');let lockCommitted=false;
 const lockErrors=$('#booksLockErrors'),validateLock=lock&&booksFormValidation(lock,lockErrors,()=>active()&&!lockCommitted);
 if(lock)lock.onsubmit=event=>{event.preventDefault();if(!active()||!lock.isConnected||lockCommitted)return;if(!validateLock())return;run(async()=>{
  if(!active()||!lock.isConnected||lockCommitted)return;
  const submittedDate=lock.date.value,saved=await booksRpc('set_books_lock',{p_expected_version:d.settings.version,p_locked_through:submittedDate||null});
  lockCommitted=true;if(!active()||!lock.isConnected)return;
  if(!Number.isSafeInteger(saved?.version)||!Object.hasOwn(saved,'locked_through')){lock.inert=true;message('Lock date saved, but the returned settings were incomplete. Reopen Chart of accounts before changing the lock again.',true);return;}
  d.settings=saved;if(lock.date.value===submittedDate)lock.date.value=saved.locked_through||'';const status=$('#booksLockStatus');if(status)status.textContent=saved.locked_through?`Books locked through ${saved.locked_through}.`:'No lock date set.';
  lockCommitted=false;message(saved.locked_through?`Books locked through ${saved.locked_through}.`:'Lock date removed.');
 },{origin:lock.querySelector('[type="submit"]'),errorTarget:lockErrors});};
}
function booksLedgerPageResult(data,request=booksReport){
 const validAccount=data?.account===null||data?.account&&typeof data.account.id==='string'&&typeof data.account.code==='string'&&typeof data.account.name==='string'&&booksTypes.some(([type])=>type===data.account.account_type)&&typeof data.account.active==='boolean';
 if(!data||!validAccount||request.accountId&&data.account?.id!==request.accountId||data.from!==request.from||data.to!==request.to||!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||data.pages!==Math.max(1,Math.ceil(data.total/50))||data.page>=data.pages||data.rows.length!==Math.min(50,data.total-data.page*50)||new Set(data.rows.map(row=>row.line_id)).size!==data.rows.length||!Number.isSafeInteger(data.settings?.version)||!Object.hasOwn(data.settings,'locked_through')||data.account&&data.page===0&&data.rows[0]?.line_id!==null||!data.summary||!['opening_minor','debit_minor','credit_minor','closing_minor'].every(key=>Number.isSafeInteger(data.summary[key]))||data.summary.debit_minor<0||data.summary.credit_minor<0||(!data.account?data.total!==0||Object.values(data.summary).some(value=>value!==0):data.total<1)||data.rows.some((row,index)=>!['debit_minor','credit_minor','balance_minor'].every(key=>Number.isSafeInteger(row[key]))||row.debit_minor<0||row.credit_minor<0||!/^\d{4}-\d{2}-\d{2}$/.test(row.entry_date)||typeof row.entry_number!=='string'||typeof row.memo!=='string'||typeof row.description!=='string'||(row.line_id===null?data.page!==0||index!==0||row.entry_id!==null||row.entry_date!==data.from||row.entry_number!==''||row.memo!=='Opening balance'||row.debit_minor!==0||row.credit_minor!==0||row.balance_minor!==data.summary.opening_minor:typeof row.line_id!=='string'||typeof row.entry_id!=='string')))throw Error('The account ledger was incomplete. Refresh before relying on these balances.');
 return data;
}
async function loadBooksLedgerPage(current){
 const request={...booksReport};let data;
 try{data=await booksRpc('acc_ledger_page',{p_account_id:request.accountId||null,p_from:request.from,p_to:request.to,p_page:booksLedgerPage});}catch(error){if(!current())return null;throw error;}
 return current()?booksLedgerPageResult(data,request):null;
}
function booksLedgerRows(rows){return rows.map(row=>({...row,debit:row.debit_minor?booksMoney(row.debit_minor):'',credit:row.credit_minor?booksMoney(row.credit_minor):'',balance:booksMoney(row.balance_minor)}));}
const booksLedgerColumns=[['entry_date','Date'],['entry_number','Entry'],['memo','Description'],['debit','Debit'],['credit','Credit'],['balance','Balance']];
function booksLedgerReportHtml(data,rows=data.rows){
 return `<h2>Account ledger${data.account?' · '+esc(booksAccountLabel(data.account)):''}</h2><p class="muted">${esc(data.from)} to ${esc(data.to)} · TZS</p>${rows.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Account ledger"><table><thead><tr>${booksLedgerColumns.map(([key,label])=>`<th${['debit','credit','balance'].includes(key)?' class="numeric-cell"':''}>${label}</th>`).join('')}</tr></thead><tbody>${booksLedgerRows(rows).map(row=>`<tr>${booksLedgerColumns.map(([key])=>`<td${['debit','credit','balance'].includes(key)?' class="numeric-cell"':''}>${esc(row[key]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="empty">Choose an account to view its ledger.</p>'}<p><strong>Opening ${booksMoney(data.summary.opening_minor)} · total debits ${booksMoney(data.summary.debit_minor)} · total credits ${booksMoney(data.summary.credit_minor)} · closing ${booksMoney(data.summary.closing_minor)}</strong></p>`;
}
async function booksLedgerRegister(actor,current){
 const data=booksLedgerPageData,session=me,request={accountId:data.account?.id||'',from:data.from,to:data.to},active=()=>current()&&me===session&&me?.user_id===actor&&booksLedgerPageData===data;
 if(!active())return;
 $('#booksBody').innerHTML=`<section class="card"><form id="booksReportForm" class="grid"><label><span>Report</span><select name="kind">${booksReportKinds.map(([kind,label])=>`<option value="${kind}"${kind==='ledger'?' selected':''}>${esc(label)}</option>`).join('')}</select></label><div><span>Account</span><p>${esc(data.account?booksAccountLabel(data.account):'No bank account selected')}</p><button type="button" id="booksLedgerChoose">Choose account</button><div id="booksLedgerChooser"></div><p id="booksLedgerChooseStatus" role="status"></p></div><label><span>From</span><input name="from" type="date" required value="${esc(data.from)}"></label><label><span>To</span><input name="to" type="date" required value="${esc(data.to)}"></label><div class="actions wide"><button type="submit">Show report</button><button type="button" id="booksReportCsv" ${data.account?'':'disabled'}>Download complete CSV</button><button type="button" id="booksReportPrint" ${data.account?'':'disabled'}>Print complete report / PDF</button></div></form></section><section class="card books-report">${booksLedgerReportHtml(data)}<div class="actions no-print"><button type="button" id="booksLedgerPrevious" ${data.page===0?'disabled':''}>Previous</button><span id="booksLedgerPageStatus" tabindex="-1">Page ${data.page+1} of ${data.pages} · ${data.total} rows${data.account?', including opening balance':''}</span><button type="button" id="booksLedgerNext" ${data.page>=data.pages-1?'disabled':''}>Next</button></div></section>`;
 const form=$('#booksReportForm');form.onsubmit=event=>{event.preventDefault();if(!active()||!form.isConnected)return;booksReport={...booksReport,kind:form.kind.value,from:form.from.value,to:form.to.value,accountId:form.account?.value||request.accountId};booksLedgerPage=0;run(()=>booksWorkspace());};form.kind.onchange=()=>form.requestSubmit();
 const choose=$('#booksLedgerChoose'),chooseStatus=$('#booksLedgerChooseStatus');choose.onclick=()=>{
  if(!active()||!choose.isConnected||choose.disabled)return;if(busy){actionFeedbackRefuse(choose,chooseStatus);return;}actionFeedbackShow(actionFeedbackReference(choose),'');choose.disabled=true;
  return run(async()=>{
  try{const accounts=await booksSelectAll('acc_accounts','id,code,name,account_type,active',q=>q.order('code'));if(!active()||!choose.isConnected)return;
   $('#booksLedgerChooser').innerHTML=`<label><span>Select account</span><select name="account"><option value="">Choose account</option>${accounts.map(account=>`<option value="${esc(account.id)}"${account.id===request.accountId?' selected':''}>${esc(booksAccountLabel(account))}${account.active?'':' · not in use'}</option>`).join('')}</select></label>`;form.account.focus({preventScroll:true});
  }catch(error){if(active()&&choose.isConnected)throw error;}finally{if(active()&&choose.isConnected)choose.disabled=false;}
  },{origin:choose,errorTarget:chooseStatus,busyLabel:'Loading account choices…'});
 };
 for(const [direction,step] of [['Previous',-1],['Next',1]])$('#booksLedger'+direction).onclick=()=>run(async()=>{if(!active())return;booksLedgerPage+=step;const request=booksEpoch+1;await booksWorkspace();if(me===session&&booksEpoch===request&&view==='books'&&booksSection==='reports'&&booksReport.kind==='ledger'){const button=$('#booksLedger'+direction);(button?.disabled?$('#booksLedgerPageStatus'):button)?.focus({preventScroll:true});}});
 const complete=async()=>{
  const rows=[],seen=new Set();for(let page=0;page<data.pages;page++){
   let result;try{result=await booksRpc('acc_ledger_page',{p_account_id:request.accountId,p_from:request.from,p_to:request.to,p_page:page});}catch(error){if(!active())return null;throw error;}if(!active())return null;const next=booksLedgerPageResult(result,request);
   if(next.total!==data.total||next.page!==page||JSON.stringify(next.summary)!==JSON.stringify(data.summary)||next.rows.some(row=>seen.has(row.line_id)))throw Error('The ledger changed while the complete report was loading. Retry the export.');
   for(const row of next.rows){seen.add(row.line_id);rows.push(row);}
  }if(rows.length!==data.total)throw Error('The complete ledger could not be confirmed. Retry the export.');return rows;
 };
 $('#booksReportCsv').onclick=()=>run(async()=>{if(!active()||!data.account)return;const rows=await complete();if(rows&&active())booksDownload(`account-ledger-${data.to}.csv`,booksCsv(booksLedgerColumns,booksLedgerRows(rows)));});
 $('#booksReportPrint').onclick=()=>run(async()=>{if(!active()||!data.account)return;const rows=await complete();if(!rows||!active())return;const area=document.createElement('section');area.className='books-print';area.innerHTML=booksLedgerReportHtml(data,rows);document.body.append(area);try{booksPrint(area);}finally{area.remove();}});
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

 if(!current())return;
 const title=booksReportKinds.find(([k])=>k===r.kind)[1];
 $('#booksBody').innerHTML=`<section class="card"><form id="booksReportForm" class="grid"><label><span>Report</span><select name="kind">${booksReportKinds.map(([k,l])=>`<option value="${k}"${k===r.kind?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
 ${ranged?`<label><span>From</span><input name="from" type="date" value="${esc(r.from)}"></label><label><span>To</span><input name="to" type="date" value="${esc(r.to)}"></label>`:`<label><span>As at</span><input name="asOf" type="date" value="${esc(r.asOf)}"></label>`}
 <div class="actions wide"><button type="submit">Show report</button><button type="button" id="booksReportCsv">Download CSV</button><button type="button" id="booksReportPrint">Print / PDF</button></div></form></section>
 <section class="card books-report"><h2>${esc(title)}</h2><p class="muted">${ranged?`${esc(r.from)} to ${esc(r.to)}`:`As at ${esc(r.asOf)}`} · TZS</p>${rows.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(title)}"><table><thead><tr>${columns.map(([k,l])=>`<th${['debit','credit','amount','cur','d30','d60','d90','d91','bal'].includes(k)?' class="numeric-cell"':''}>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr${x.code||x.entry_number||x.customer?'':' class="books-total"'}>${columns.map(([k])=>`<td${['debit','credit','amount','cur','d30','d60','d90','d91','bal'].includes(k)?' class="numeric-cell"':''}>${esc(x[k]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="empty">Nothing posted for this report yet.</p>'}${totals?`<p><strong>${esc(totals)}</strong></p>`:''}</section>`;
 const form=$('#booksReportForm');
 form.onsubmit=event=>{event.preventDefault();run(()=>{booksReport={kind:form.kind.value,asOf:form.asOf?.value||r.asOf,from:form.from?.value||r.from,to:form.to?.value||r.to,accountId:form.account?.value||r.accountId};booksLedgerPage=0;return booksWorkspace();});};
 form.kind.onchange=()=>form.requestSubmit();
 $('#booksReportCsv').onclick=()=>booksDownload(`${title.toLowerCase().replace(/\s+/g,'-')}-${ranged?r.to:r.asOf}.csv`,booksCsv(columns,rows));
 $('#booksReportPrint').onclick=()=>booksPrint(document.querySelector('.books-report'));
}
