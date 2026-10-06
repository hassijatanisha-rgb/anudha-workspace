'use strict';
// Books of account (stage 1 of replica/architecture.md): enter vouchers, Day Book, ledgers, ledger statement,
// Trial Balance, financial years and month locks. Every write goes through a database function that checks the
// voucher balances, the bills, the VAT and the lock again; nothing here writes a table directly. A posted voucher is
// never edited: it is reversed and posted again. Open to the owner and approved accounts staff (ledger_staff).
let ledgerTab='voucher',ledgerLoaded=false,ledgerEpoch=0,ledgerLoadError='',ledgerNotReady=false;
let ledgerGroups=[],ledgerLedgers=[],ledgerTypes=[],ledgerYears=[],ledgerRates={},ledgerLockedThrough=null,ledgerIsOwner=false;
let ledgerForm=null,ledgerBillsCache=new Map(),ledgerReversalIds=new Map(),ledgerReversing='';
let ledgerDayFrom='',ledgerDayTo='',ledgerDayPage=0,ledgerStatementId='',ledgerStatementFrom='',ledgerStatementTo='',ledgerTbFrom='',ledgerTbTo='';
let ledgerEditing=null,ledgerSuppliers=null,ledgerYearId='',ledgerSettings=null,ledgerBalanceCache=new Map(),ledgerInvoiceIds=new Map(),ledgerOrderSearch='';
const ledgerTabs=[['voucher','Enter voucher'],['orders','From orders'],['outstanding','Receivables & payables'],['daybook','Day Book'],['accounts','Ledgers'],['statement','Ledger statement'],['tb','Trial Balance'],['statements','P&L and Balance Sheet'],['bank','Bank reconciliation'],['setup','Years & locks']];
const ledgerVatClasses=[['','No VAT'],['standard','Standard rate'],['zero','Zero-rated'],['exempt','Exempt'],['out_of_scope','Outside VAT']];
const ledgerBillKinds=[['new','New bill'],['against','Against bill'],['advance','Advance'],['on_account','On account']];
function clearLedger(){ledgerEpoch++;ledgerLoaded=false;ledgerLoadError='';ledgerNotReady=false;ledgerGroups=[];ledgerLedgers=[];ledgerTypes=[];ledgerYears=[];ledgerRates={};ledgerForm=null;ledgerBillsCache=new Map();ledgerReversalIds=new Map();ledgerEditing=null;ledgerSuppliers=null;ledgerSettings=null;ledgerBalanceCache=new Map();ledgerInvoiceIds=new Map();}
function openLedgerTab(tab){ledgerTab=ledgerTabs.some(([key])=>key===tab)?tab:'voucher';ledgerEditing=null;ledgerReversing='';}
const ledgerById=id=>ledgerLedgers.find(l=>l.id===id);
const ledgerGroupById=id=>ledgerGroups.find(g=>g.id===id);
const ledgerTypeById=id=>ledgerTypes.find(t=>t.id===id);
const ledgerMap=()=>new Map(ledgerLedgers.map(l=>[l.id,l]));
function ledgerFail(result,what){if(result?.error){if(ledgerNotInstalled(result.error))ledgerNotReady=true;throw Error(`${what}: ${result.error.message}`);}return result.data;}

async function loadLedger(){
 const epoch=++ledgerEpoch,actor=me?.user_id;
 const access=await client.rpc('ledger_staff');
 if(access.error){if(ledgerNotInstalled(access.error)){ledgerNotReady=true;return true;}throw Error(access.error.message);}
 if(access.data!==true)throw Error('Books of account are open to the owner and approved accounts staff only.');
 const [groups,ledgers,types,years,rates,lock,settings]=await Promise.all([all('account_groups','*'),all('ledgers','*'),all('voucher_types','*'),all('fiscal_years','*'),all('vat_rates','*'),client.rpc('ledger_locked_through'),client.from('ledger_settings').select('*').maybeSingle()]);
 if(epoch!==ledgerEpoch||me?.user_id!==actor)return false;
 ledgerGroups=groups;ledgerLedgers=ledgers;ledgerTypes=types.filter(t=>t.active);ledgerYears=[...years].sort((a,b)=>b.starts_on.localeCompare(a.starts_on));
 const today=ledgerToday();ledgerRates={};
 for(const r of [...rates].sort((a,b)=>a.effective_from.localeCompare(b.effective_from)))if(r.effective_from<=today)ledgerRates[r.vat_class]=r.rate_bp;
 ledgerLockedThrough=ledgerFail(lock,'Month lock could not load');ledgerSettings=ledgerFail(settings,'Default ledgers could not load')||{version:1};ledgerIsOwner=me?.role==='owner';
 ledgerLoaded=true;ledgerLoadError='';ledgerNotReady=false;return true;
}
async function ledgerWorkspace(force=false){
 const actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!ledgerLoaded){
  $('#content').innerHTML='<p role="status">Loading books of account…</p>';
  try{if(!(await loadLedger()))return;}
  catch(error){if(me?.user_id!==actor)return;if(ledgerNotInstalled(error))ledgerNotReady=true;else ledgerLoadError=error.message;ledgerLoaded=false;}
 }
 if(view!=='ledger'||me?.user_id!==actor)return;
 const year=ledgerYearFor(ledgerToday(),ledgerYears),today=ledgerToday();
 if(!ledgerDayFrom){ledgerDayFrom=ledgerMonthStart(today);ledgerDayTo=today;}
 if(!ledgerTbFrom){ledgerTbFrom=year?.starts_on||ledgerMonthStart(today);ledgerTbTo=today;}
 if(!ledgerStatementFrom){ledgerStatementFrom=year?.starts_on||ledgerMonthStart(today);ledgerStatementTo=today;}
 $('#content').innerHTML=`<section class="ledger-workspace"><div class="heading"><div><small>ACCOUNTS</small><h1>Books of account</h1><p class="muted">Every voucher must balance. A posted voucher is never changed; reverse it and post it again.${ledgerLockedThrough?` Books are locked through ${esc(ledgerLockedThrough)}.`:''}</p></div><div class="actions"><button type="button" id="ledgerRefresh">Refresh</button></div></div>
  ${ledgerNotReady?'<p class="notice" role="status">Books of account are not switched on yet. They are switched on after the accountant has checked the setup.</p>':''}
  ${ledgerLoadError?`<p class="notice error" role="alert">Books of account could not load: ${esc(ledgerLoadError)}. Nothing was changed.</p>`:''}
  ${ledgerLoaded?`<div class="tabs" role="group" aria-label="Books of account pages">${ledgerTabs.map(([key,label])=>`<button type="button" data-ledger-tab="${key}" class="${ledgerTab===key?'active':''}" aria-pressed="${ledgerTab===key}">${label}</button>`).join('')}</div><div id="ledgerPage"><p role="status">Loading…</p></div>`:''}</section>`;
 $('#ledgerRefresh').onclick=()=>run(()=>ledgerWorkspace(true));
 document.querySelectorAll('[data-ledger-tab]').forEach(b=>b.onclick=()=>run(async()=>{openLedgerTab(b.dataset.ledgerTab);await ledgerWorkspace();}));
 if(!ledgerLoaded)return;
 const page=ledgerTab==='bank'?ledgerBankPage:ledgerTab==='statements'?ledgerStatementsPage:ledgerTab==='orders'?ledgerOrdersPage:ledgerTab==='outstanding'?ledgerOutstandingPage:ledgerTab==='daybook'?ledgerDayBook:ledgerTab==='accounts'?ledgerAccounts:ledgerTab==='statement'?ledgerStatementPage:ledgerTab==='tb'?ledgerTrialBalance:ledgerTab==='setup'?ledgerSetup:ledgerVoucherPage;
 try{await page();}catch(error){if(ledgerNotReady)return ledgerWorkspace();if($('#ledgerPage'))$('#ledgerPage').innerHTML=`<p class="notice error" role="alert">${esc(error.message)}</p>`;}
}
const ledgerStillHere=(actor,tab)=>view==='ledger'&&me?.user_id===actor&&ledgerTab===tab&&$('#ledgerPage');

// Enter voucher ----------------------------------------------------------------------------------------------------
const ledgerBlankLine=side=>({ledger_id:'',side,amount:'',vat_class:'',bills:[]});
function ledgerNewForm(keep){
 const type=keep?.type_id||ledgerTypes.find(t=>t.base_type==='payment')?.id||ledgerTypes.find(t=>t.base_type!=='opening')?.id||'';
 return {id:crypto.randomUUID(),type_id:type,date:keep?.date||ledgerToday(),number:'',reference:'',narration:'',supplier_tin:'',supplier_code:'',source:{},source_label:'',lines:[ledgerBlankLine('dr'),ledgerBlankLine('cr')]};
}
const ledgerTaxBase=type=>['sales','purchase','credit_note','debit_note'].includes(type?.base_type);
const ledgerVatRole=type=>['sales','credit_note'].includes(type?.base_type)?'output':['purchase','debit_note'].includes(type?.base_type)?'input':'';
function ledgerDefaultBillKind(type){return ['sales','purchase','opening'].includes(type?.base_type)?'new':'against';}
function ledgerLedgerLabel(l){return `${l.name} (${ledgerGroupById(l.group_id)?.name||'No group'})`;}
function ledgerFindByLabel(text){const t=String(text||'').trim().toLowerCase();return ledgerLedgers.find(l=>l.active&&(ledgerLedgerLabel(l).toLowerCase()===t||l.name.toLowerCase()===t));}
async function ledgerBillsFor(ledgerId){
 if(!ledgerBillsCache.has(ledgerId)){
  const r=await client.from('ledger_bill_balances').select('*').eq('ledger_id',ledgerId).neq('balance_minor',0).order('due_date').limit(500);
  ledgerBillsCache.set(ledgerId,ledgerOpenBills(ledgerFail(r,'Open bills could not load')||[],ledgerId));
 }
 return ledgerBillsCache.get(ledgerId);
}
async function ledgerVoucherPage(){
 ledgerForm=ledgerForm||ledgerNewForm();
 const f=ledgerForm,type=ledgerTypeById(f.type_id),ledgers=ledgerMap();
 const billLedgers=[...new Set(f.lines.map(l=>l.ledger_id).filter(id=>ledgers.get(id)?.bill_wise))];
 await Promise.all(billLedgers.filter(id=>ledgers.get(id).credit_limit_minor!=null).map(id=>ledgerBalanceOf(id)));
 const openBills=new Map(await Promise.all(billLedgers.map(async id=>[id,await ledgerBillsFor(id)])));
 if(view!=='ledger'||ledgerTab!=='voucher'||!$('#ledgerPage'))return;
 const types=ledgerTypes.filter(t=>t.base_type!=='opening'||ledgerYears.some(y=>y.starts_on===f.date));
 const vat=ledgerVatFor(f.lines,ledgerRates),role=ledgerVatRole(type);
 $('#ledgerPage').innerHTML=`<form id="ledgerVoucherForm" class="card ledger-voucher" novalidate>
  ${f.source_label?`<p class="notice">${esc(f.source_label)} Check every amount against the supplier's bill before posting.</p>`:''}<datalist id="ledgerNames">${ledgerLedgers.filter(l=>l.active).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value="${esc(ledgerLedgerLabel(l))}"></option>`).join('')}</datalist>
  <div class="ledger-voucher-head"><label><span>Voucher type</span><select name="type_id">${types.map(t=>`<option value="${esc(t.id)}" ${t.id===f.type_id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
  <label><span>Date</span><input name="date" type="date" value="${esc(f.date)}" required></label>
  ${type?.numbering==='manual'?`<label><span>Voucher number</span><input name="number" value="${esc(f.number)}" maxlength="60" required></label>`:'<p class="muted">The number is given when you post.</p>'}
  <label><span>Reference</span><input name="reference" value="${esc(f.reference)}" maxlength="200" placeholder="Cheque, transfer or bill number"></label></div>
  ${type?.base_type==='purchase'?`<div class="ledger-voucher-head"><label><span>Supplier TIN</span><input name="supplier_tin" value="${esc(f.supplier_tin)}" maxlength="30"></label><label><span>Fiscal receipt verification code</span><input name="supplier_code" value="${esc(f.supplier_code)}" maxlength="100"></label><p class="muted">Needed to claim input VAT. Without them, post the VAT to the cost instead.</p></div>`:''}
  <table class="ledger-lines"><thead><tr><th>Ledger</th><th>Dr / Cr</th><th>Amount (TZS)</th>${ledgerTaxBase(type)?'<th>VAT</th>':''}<th></th></tr></thead><tbody>
  ${f.lines.map((line,i)=>ledgerLineRow(line,i,type,ledgers,openBills)).join('')}</tbody></table>
  <div class="actions"><button type="button" id="ledgerAddLine">Add line</button>${ledgerTaxBase(type)&&vat?`<span>VAT on taxable lines: <strong>${ledgerMoney(Math.abs(vat))}</strong></span><button type="button" id="ledgerFillVat">Fill VAT line</button>`:''}</div>
  <label><span>Narration</span><textarea name="narration" maxlength="2000" rows="2">${esc(f.narration)}</textarea></label>
  <div id="ledgerVoucherStatus" role="status" aria-live="polite"></div>
  <div class="actions"><button type="submit" id="ledgerPost">Post voucher</button><button type="button" id="ledgerClear">Clear form</button></div></form>`;
 bindLedgerVoucher(role);ledgerVoucherStatus();
}
function ledgerLineRow(line,i,type,ledgers,openBills){
 const ledger=ledgers.get(line.ledger_id),bills=ledger?.bill_wise?line.bills:[],open=openBills.get(line.ledger_id)||[];
 return `<tr data-line="${i}"><td><input list="ledgerNames" data-field="ledger" value="${esc(ledger?ledgerLedgerLabel(ledger):'')}" aria-label="Ledger, line ${i+1}" placeholder="Type to search"></td>
  <td><select data-field="side" aria-label="Debit or credit, line ${i+1}"><option value="dr" ${line.side==='dr'?'selected':''}>Dr</option><option value="cr" ${line.side==='cr'?'selected':''}>Cr</option></select></td>
  <td><input data-field="amount" inputmode="decimal" value="${esc(line.amount)}" aria-label="Amount, line ${i+1}" placeholder="0.00"></td>
  ${ledgerTaxBase(type)?`<td><select data-field="vat_class" aria-label="VAT, line ${i+1}">${ledgerVatClasses.map(([k,label])=>`<option value="${k}" ${line.vat_class===k?'selected':''}>${label}${k&&ledgerRates[k]!=null?` ${ledgerRates[k]/100}%`:''}</option>`).join('')}</select></td>`:''}
  <td><button type="button" data-remove-line="${i}" aria-label="Remove line ${i+1}">×</button></td></tr>
  ${ledger?.bill_wise?`<tr class="ledger-bills" data-bills-for="${i}"><td colspan="${ledgerTaxBase(type)?5:4}"><small>Bills for ${esc(ledger.name)}</small>
   <datalist id="ledgerBills${i}">${open.map(b=>`<option value="${esc(b.name)}">${esc(ledgerBalanceText(b.balance_minor))} open${b.due_date?` · due ${esc(b.due_date)}`:''}</option>`).join('')}</datalist>
   ${bills.map((b,j)=>`<div class="ledger-bill" data-bill="${j}"><select data-bill-field="kind" aria-label="Bill type">${ledgerBillKinds.map(([k,label])=>`<option value="${k}" ${b.kind===k?'selected':''}>${label}</option>`).join('')}</select>
    ${b.kind==='on_account'?'':`<input data-bill-field="name" value="${esc(b.name)}" ${b.kind==='against'?`list="ledgerBills${i}"`:''} maxlength="100" placeholder="Bill number" aria-label="Bill number">`}
    ${b.kind==='new'||b.kind==='advance'?`<input type="date" data-bill-field="due_date" value="${esc(b.due_date||'')}" aria-label="Due date" title="Leave empty to use the ledger's credit days">`:''}
    <input data-bill-field="amount" inputmode="decimal" value="${esc(b.amount)}" aria-label="Bill amount" placeholder="0.00"><button type="button" data-remove-bill="${j}" aria-label="Remove bill">×</button></div>`).join('')}
   <button type="button" data-add-bill="${i}">Add bill</button>${line.side&&ledgerDefaultBillKind(type)==='against'&&!open.length?' <small>No open bills on this ledger.</small>':''}</td></tr>`:''}`;
}
function ledgerVoucherStatus(){
 const status=$('#ledgerVoucherStatus');if(!status)return;
 const totals=ledgerTotals(ledgerForm.lines),problems=ledgerVoucherProblems(ledgerForm,ledgerMap(),ledgerTypeById(ledgerForm.type_id));
 const warnings=ledgerForm.lines.filter(l=>l.side==='dr'&&ledgerBalanceCache.has(l.ledger_id)).map(l=>ledgerCreditWarning(ledgerById(l.ledger_id),ledgerBalanceCache.get(l.ledger_id),ledgerParseMinor(l.amount)||0)).filter(Boolean);
 status.innerHTML=`${warnings.map(w=>`<p class="notice">${esc(w)}</p>`).join('')}<p>Debit <strong>${ledgerMoney(totals.debit)}</strong> · Credit <strong>${ledgerMoney(totals.credit)}</strong>${totals.difference?` · <strong class="overdue">Difference ${ledgerMoney(Math.abs(totals.difference))}</strong>`:' · Balanced'}</p>${problems.length?`<ul class="ledger-problems">${problems.slice(0,6).map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}`;
 $('#ledgerPost').disabled=problems.length>0;
}
function bindLedgerVoucher(vatRole){
 const form=$('#ledgerVoucherForm'),f=ledgerForm,rerender=()=>run(()=>ledgerVoucherPage());
 for(const name of ['date','number','reference','narration','supplier_tin','supplier_code'])form.elements[name]?.addEventListener('input',e=>{f[name]=e.target.value;ledgerVoucherStatus();});
 form.elements.date.addEventListener('change',rerender);
 form.elements.type_id.onchange=e=>{f.type_id=e.target.value;const type=ledgerTypeById(f.type_id);for(const line of f.lines){const l=ledgerById(line.ledger_id);line.vat_class=ledgerTaxBase(type)?(l?.vat_class||''):'';}rerender();};
 form.querySelectorAll('tr[data-line]').forEach(row=>{
  const line=f.lines[Number(row.dataset.line)];
  row.querySelector('[data-field="ledger"]').onchange=e=>{
   const l=ledgerFindByLabel(e.target.value),type=ledgerTypeById(f.type_id);
   line.ledger_id=l?.id||'';line.vat_class=ledgerTaxBase(type)?(l?.vat_class||''):'';
   line.bills=l?.bill_wise?[{kind:ledgerDefaultBillKind(type),name:'',due_date:'',amount:line.amount}]:[];
   if(!l&&e.target.value.trim())message('Choose a ledger from the list, or create it under Ledgers first.',true);
   rerender();
  };
  row.querySelector('[data-field="side"]').onchange=e=>{line.side=e.target.value;ledgerVoucherStatus();};
  row.querySelector('[data-field="amount"]').oninput=e=>{const before=line.amount;line.amount=e.target.value;if(line.bills.length===1&&line.bills[0].amount===before){line.bills[0].amount=line.amount;const input=form.querySelector(`[data-bills-for="${row.dataset.line}"] [data-bill-field="amount"]`);if(input)input.value=line.amount;}ledgerVoucherStatus();};
  row.querySelector('[data-field="amount"]').onchange=()=>{if(ledgerTaxBase(ledgerTypeById(f.type_id)))rerender();};
  row.querySelector('[data-field="vat_class"]')?.addEventListener('change',e=>{line.vat_class=e.target.value;rerender();});
 });
 form.querySelectorAll('tr[data-bills-for]').forEach(row=>{
  const line=f.lines[Number(row.dataset.billsFor)];
  row.querySelectorAll('[data-bill]').forEach(div=>{
   const bill=line.bills[Number(div.dataset.bill)];
   div.querySelectorAll('[data-bill-field]').forEach(input=>input.addEventListener(input.tagName==='SELECT'?'change':'input',e=>{bill[input.dataset.billField]=e.target.value;if(input.tagName==='SELECT')rerender();else ledgerVoucherStatus();}));
   div.querySelector('[data-remove-bill]').onclick=()=>{line.bills.splice(Number(div.dataset.bill),1);rerender();};
  });
  row.querySelector('[data-add-bill]').onclick=()=>{const used=line.bills.reduce((s,b)=>s+(ledgerParseMinor(b.amount)||0),0),rest=(ledgerParseMinor(line.amount)||0)-used;line.bills.push({kind:ledgerDefaultBillKind(ledgerTypeById(f.type_id)),name:'',due_date:'',amount:rest>0?ledgerMoney(rest):''});rerender();};
 });
 form.querySelectorAll('[data-remove-line]').forEach(b=>b.onclick=()=>{if(f.lines.length>2){f.lines.splice(Number(b.dataset.removeLine),1);rerender();}else message('A voucher needs at least two lines.',true);});
 $('#ledgerAddLine').onclick=()=>{const t=ledgerTotals(f.lines),line=ledgerBlankLine(t.difference>0?'cr':'dr');if(t.difference)line.amount=ledgerMoney(Math.abs(t.difference));f.lines.push(line);rerender();};
 $('#ledgerFillVat')?.addEventListener('click',()=>{
  const vatLedger=ledgerLedgers.find(l=>l.active&&l.vat_role===vatRole);
  if(!vatLedger)return message(`Create a Duties & Taxes ledger for ${vatRole} VAT under Ledgers first.`,true);
  const vat=ledgerVatFor(f.lines,ledgerRates);let line=f.lines.find(l=>l.ledger_id===vatLedger.id);
  if(!line){line=f.lines.find(l=>!l.ledger_id&&!String(l.amount).trim());if(!line){line=ledgerBlankLine('dr');f.lines.push(line);}line.ledger_id=vatLedger.id;}
  line.side=vat>0?'dr':'cr';line.amount=ledgerMoney(Math.abs(vat));line.vat_class='';rerender();
 });
 $('#ledgerClear').onclick=()=>{ledgerForm=ledgerNewForm(f);rerender();};
 form.onsubmit=event=>{event.preventDefault();const button=$('#ledgerPost');if(button.disabled)return;button.disabled=true;run(()=>ledgerPostVoucher()).finally(()=>{if(button.isConnected)ledgerVoucherStatus();});};
}
async function ledgerPostVoucher(){
 const f=ledgerForm,type=ledgerTypeById(f.type_id),ledgers=ledgerMap(),actor=me?.user_id;
 const problems=ledgerVoucherProblems(f,ledgers,type);if(problems.length)throw Error(problems[0]);
 // The form's id is the idempotency key: a retry after a lost connection returns the voucher already posted.
 const r=await client.rpc('post_voucher',{p_id:f.id,p_voucher_type_id:f.type_id,p_date:f.date,p_entries:ledgerVoucherEntries(f,ledgers),p_narration:f.narration,p_reference:f.reference,
  p_number:type.numbering==='manual'?f.number.trim():null,p_source:f.source||{},p_supplier:type.base_type==='purchase'?{tin:f.supplier_tin.trim(),fiscal_code:f.supplier_code.trim()}:{}});
 if(me?.user_id!==actor)return;
 const saved=ledgerFail(r,'Not posted');
 for(const line of f.lines){ledgerBillsCache.delete(line.ledger_id);ledgerBalanceCache.delete(line.ledger_id);}
 ledgerForm=ledgerNewForm(f);message(`${type.name} ${saved.number} posted.`);
 if(view==='ledger'&&ledgerTab==='voucher')await ledgerVoucherPage();
}

// Day Book -------------------------------------------------------------------------------------------------------------
async function ledgerDayBook(){
 const actor=me?.user_id,from=ledgerDayFrom,to=ledgerDayTo;
 const r=await client.from('vouchers').select('*').gte('voucher_date',from).lte('voucher_date',to).order('voucher_date').order('created_at').range(ledgerDayPage*50,ledgerDayPage*50+50);
 const rows=ledgerFail(r,'Day Book could not load')||[],page=rows.slice(0,50),ids=page.map(v=>v.id);
 const [entries,reversals]=ids.length?await Promise.all([client.from('voucher_entries').select('*').in('voucher_id',ids).order('line_no'),client.from('vouchers').select('id,number,voucher_type_id,reverses_voucher_id').in('reverses_voucher_id',ids)]):[{data:[]},{data:[]}];
 if(!ledgerStillHere(actor,'daybook'))return;
 const lines=ledgerFail(entries,'Voucher lines could not load')||[],reversedBy=new Map((ledgerFail(reversals,'Reversals could not load')||[]).map(v=>[v.reverses_voucher_id,v]));
 const originals=new Map(page.filter(v=>v.reverses_voucher_id).map(v=>[v.id,page.find(o=>o.id===v.reverses_voucher_id)]));
 $('#ledgerPage').innerHTML=`<form id="ledgerDayFilter" class="actions ledger-filter"><label><span>From</span><input type="date" name="from" value="${esc(from)}"></label><label><span>To</span><input type="date" name="to" value="${esc(to)}"></label><button type="submit">Show</button></form>
  ${page.map(v=>{const type=ledgerTypeById(v.voucher_type_id)||{name:'Voucher'},rev=reversedBy.get(v.id),orig=originals.get(v.id),own=lines.filter(l=>l.voucher_id===v.id);
   return `<article class="card ledger-voucher-card"><div class="heading"><div><small>${esc(v.voucher_date)}${v.reference?` · ${esc(v.reference)}`:''}</small><h2>${esc(type.name)} ${esc(v.number)}</h2></div>
    <div>${rev?`<span class="tag">Reversed by ${esc(ledgerTypeById(rev.voucher_type_id)?.name||'')} ${esc(rev.number)}</span>`:''}${v.reverses_voucher_id?`<span class="tag">Reversal${orig?` of ${esc(orig.number)}`:''}</span>`:''}</div></div>
    <table><thead><tr><th>Ledger</th><th class="number">Debit</th><th class="number">Credit</th></tr></thead><tbody>${own.map(l=>`<tr><td>${esc(ledgerById(l.ledger_id)?.name||'Unknown ledger')}${l.vat_class?` <small>VAT ${esc(l.vat_class.replace('_',' '))}${l.vat_rate_bp?` ${l.vat_rate_bp/100}%`:''}</small>`:''}</td><td class="number">${l.amount_minor>0?ledgerMoney(l.amount_minor):''}</td><td class="number">${l.amount_minor<0?ledgerMoney(-l.amount_minor):''}</td></tr>`).join('')}</tbody></table>
    ${v.narration?`<p>${esc(v.narration)}</p>`:''}<p class="muted">Posted by ${esc(typeof employeeName==='function'?employeeName(v.created_by):'')} · ${esc(new Date(v.created_at).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam'}))}</p>
    ${!rev&&!v.reverses_voucher_id?(ledgerReversing===v.id?`<form class="ledger-reverse" data-reverse-form="${esc(v.id)}"><label><span>Reversal date</span><input type="date" name="date" value="${esc(ledgerToday()>v.voucher_date?ledgerToday():v.voucher_date)}" required></label><label><span>Reason</span><input name="reason" maxlength="300" required minlength="5" placeholder="Why this voucher is wrong"></label><button type="submit">Post reversal</button><button type="button" data-cancel-reverse>Cancel</button></form>`:`<div class="actions"><button type="button" data-reverse="${esc(v.id)}">Reverse</button></div>`):''}</article>`;}).join('')||'<p>No vouchers in these dates.</p>'}
  <div class="actions"><button type="button" id="ledgerDayPrev" ${ledgerDayPage?'':'disabled'}>Previous</button><span>Page ${ledgerDayPage+1}</span><button type="button" id="ledgerDayNext" ${rows.length>50?'':'disabled'}>Next</button></div>`;
 $('#ledgerDayFilter').onsubmit=e=>{e.preventDefault();ledgerDayFrom=e.target.from.value;ledgerDayTo=e.target.to.value;ledgerDayPage=0;run(()=>ledgerDayBook());};
 $('#ledgerDayPrev').onclick=()=>run(()=>{ledgerDayPage--;return ledgerDayBook();});$('#ledgerDayNext').onclick=()=>run(()=>{ledgerDayPage++;return ledgerDayBook();});
 document.querySelectorAll('[data-reverse]').forEach(b=>b.onclick=()=>run(()=>{ledgerReversing=b.dataset.reverse;return ledgerDayBook();}));
 document.querySelectorAll('[data-cancel-reverse]').forEach(b=>b.onclick=()=>run(()=>{ledgerReversing='';return ledgerDayBook();}));
 document.querySelectorAll('[data-reverse-form]').forEach(form=>form.onsubmit=e=>{e.preventDefault();run(async()=>{
  const original=form.dataset.reverseForm,reason=form.reason.value.trim();
  if(reason.length<5)throw Error('Give the reason for the reversal.');
  if(!ledgerReversalIds.has(original))ledgerReversalIds.set(original,crypto.randomUUID());
  const saved=ledgerFail(await client.rpc('reverse_voucher',{p_id:ledgerReversalIds.get(original),p_original_id:original,p_date:form.date.value,p_reason:reason}),'Not reversed');
  ledgerReversalIds.delete(original);ledgerReversing='';ledgerBillsCache.clear();message(`Reversal ${saved.number} posted.`);await ledgerDayBook();
 });});
}

// Ledgers (chart of accounts) ------------------------------------------------------------------------------------------
async function ledgerBalances(from,to){
 const rows=[];
 for(let i=0;;i+=1000){const r=await client.rpc('trial_balance',{p_from:from,p_to:to}).range(i,i+999);const data=ledgerFail(r,'Balances could not load')||[];rows.push(...data);if(data.length<1000)break;}
 return new Map(rows.map(r=>[r.ledger_id,{opening:Number(r.opening_minor),debit:Number(r.debit_minor),credit:Number(r.credit_minor),closing:Number(r.closing_minor)}]));
}
function ledgerGroupOptions(selected,exclude){
 return ledgerTreeRows(ledgerTree(ledgerGroups,[])).filter(r=>r.group.id!==exclude).map(r=>`<option value="${esc(r.group.id)}" ${r.group.id===selected?'selected':''}>${'— '.repeat(r.depth)}${esc(r.group.name)}</option>`).join('');
}
async function ledgerAccounts(){
 const actor=me?.user_id,year=ledgerYearFor(ledgerToday(),ledgerYears);
 const balances=year?await ledgerBalances(year.starts_on,ledgerToday()):new Map();
 if(ledgerEditing?.kind==='ledger'&&ledgerSuppliers===null){const r=await client.from('suppliers').select('id,name').order('name').limit(2000);ledgerSuppliers=r.error?[]:r.data;}
 if(!ledgerStillHere(actor,'accounts'))return;
 const rows=ledgerTreeRows(ledgerTree(ledgerGroups,ledgerLedgers,balances,true));
 $('#ledgerPage').innerHTML=`<div class="actions"><button type="button" id="ledgerNewLedger">New ledger</button><button type="button" id="ledgerNewGroup">New group</button></div>
  ${ledgerEditing?.kind==='ledger'?ledgerLedgerEditor(ledgerById(ledgerEditing.id)):''}${ledgerEditing?.kind==='group'?ledgerGroupEditor(ledgerGroupById(ledgerEditing.id)):''}
  <p class="muted">${year?`Balances for ${esc(year.name)} to today.`:'No financial year covers today; balances are not shown.'}</p>
  <table class="ledger-tree"><thead><tr><th>Group / ledger</th><th class="number">Balance</th><th></th></tr></thead><tbody>${rows.map(r=>r.kind==='group'
   ?`<tr class="ledger-group-row"><td style="padding-left:${r.depth*18+8}px"><strong>${esc(r.group.name)}</strong></td><td class="number">${r.closing?ledgerBalanceText(r.closing):''}</td><td><button type="button" data-edit-group="${esc(r.group.id)}">${r.group.is_predefined?'Rename':'Edit'}</button></td></tr>`
   :`<tr><td style="padding-left:${r.depth*18+8}px">${esc(r.ledger.name)}${r.ledger.active?'':' <small>(inactive)</small>'}${r.ledger.bill_wise?' <small>bills</small>':''}</td><td class="number">${ledgerBalanceText(r.closing)}</td><td><button type="button" data-statement="${esc(r.ledger.id)}">Statement</button> <button type="button" data-edit-ledger="${esc(r.ledger.id)}">Edit</button></td></tr>`).join('')}</tbody></table>`;
 $('#ledgerNewLedger').onclick=()=>run(()=>{ledgerEditing={kind:'ledger',id:''};return ledgerAccounts();});
 $('#ledgerNewGroup').onclick=()=>run(()=>{ledgerEditing={kind:'group',id:''};return ledgerAccounts();});
 document.querySelectorAll('[data-edit-ledger]').forEach(b=>b.onclick=()=>run(()=>{ledgerEditing={kind:'ledger',id:b.dataset.editLedger};return ledgerAccounts();}));
 document.querySelectorAll('[data-edit-group]').forEach(b=>b.onclick=()=>run(()=>{ledgerEditing={kind:'group',id:b.dataset.editGroup};return ledgerAccounts();}));
 document.querySelectorAll('[data-statement]').forEach(b=>b.onclick=()=>run(async()=>{ledgerStatementId=b.dataset.statement;openLedgerTab('statement');await ledgerWorkspace();}));
 $('#ledgerCancelEdit')?.addEventListener('click',()=>run(()=>{ledgerEditing=null;return ledgerAccounts();}));
 const lf=$('#ledgerLedgerForm');if(lf)lf.onsubmit=e=>{e.preventDefault();run(()=>ledgerSaveLedger(lf));};
 const gf=$('#ledgerGroupForm');if(gf){gf.onsubmit=e=>{e.preventDefault();run(()=>ledgerSaveGroup(gf));};gf.parent_id.onchange=()=>{gf.querySelector('[data-nature]').hidden=!!gf.parent_id.value;};}
 const search=$('#ledgerCustomerSearch');if(search)search.oninput=()=>{const q=search.value.trim().toLowerCase(),select=lf.organization_id,keep=select.value;const matches=organizations.filter(o=>!o.deleted_at&&(o.id===keep||!q||`${o.name} ${o.location||''}`.toLowerCase().includes(q))).slice(0,50);select.innerHTML='<option value="">Not a customer</option>'+matches.map(o=>`<option value="${esc(o.id)}" ${o.id===keep?'selected':''}>${esc([o.name,o.location].filter(Boolean).join(' · '))}</option>`).join('');};
}
function ledgerLedgerEditor(l){
 const org=l?.organization_id?organizations.find(o=>o.id===l.organization_id):null;
 return `<form id="ledgerLedgerForm" class="card"><div class="heading"><h2>${l?`Edit ${esc(l.name)}`:'New ledger'}</h2><button type="button" id="ledgerCancelEdit" aria-label="Close">×</button></div>
  <label><span>Name</span><input name="name" value="${esc(l?.name||'')}" maxlength="200" required></label>
  <label><span>Group</span><select name="group_id" required ${l?.is_predefined?'disabled':''}>${ledgerGroupOptions(l?.group_id||'')}</select></label>
  <label class="check"><input type="checkbox" name="bill_wise" ${l?.bill_wise?'checked':''}> Keep bills for this ledger (customers and suppliers)</label>
  <label><span>Credit days</span><input name="credit_days" type="number" min="0" max="3650" value="${esc(l?.credit_days??0)}"></label>
  <label><span>Credit limit (TZS, empty for none)</span><input name="credit_limit" inputmode="decimal" value="${l?.credit_limit_minor!=null?esc(ledgerMoney(l.credit_limit_minor)):''}"></label>
  <label><span>Search customer</span><input id="ledgerCustomerSearch" type="search" placeholder="Name or location"></label>
  <label><span>Customer</span><select name="organization_id"><option value="">Not a customer</option>${org?`<option value="${esc(org.id)}" selected>${esc([org.name,org.location].filter(Boolean).join(' · '))}</option>`:''}</select></label>
  <label><span>Supplier</span><select name="supplier_id"><option value="">Not a supplier</option>${(ledgerSuppliers||[]).map(s=>`<option value="${esc(s.id)}" ${s.id===l?.supplier_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>
  <label><span>VAT on what this ledger sells or buys</span><select name="vat_class">${ledgerVatClasses.map(([k,label])=>`<option value="${k}" ${(l?.vat_class||'')===k?'selected':''}>${label}</option>`).join('')}</select></label>
  <label><span>VAT ledger (Duties &amp; Taxes only)</span><select name="vat_role"><option value="">Not a VAT ledger</option><option value="output" ${l?.vat_role==='output'?'selected':''}>Output VAT (on sales)</option><option value="input" ${l?.vat_role==='input'?'selected':''}>Input VAT (on purchases)</option></select></label>
  <label><span>TIN</span><input name="tin" value="${esc(l?.tin||'')}" maxlength="30"></label><label><span>VRN</span><input name="vrn" value="${esc(l?.vrn||'')}" maxlength="30"></label>
  <label class="check"><input type="checkbox" name="active" ${l?.active===false?'':'checked'}> Active</label>
  <div class="actions"><button type="submit">Save ledger</button></div></form>`;
}
async function ledgerSaveLedger(form){
 const existing=ledgerById(ledgerEditing.id),limit=form.credit_limit.value.trim();
 if(limit&&ledgerParseMinor(limit)==null)throw Error('Write the credit limit as a number, for example 5,000,000.00.');
 const body={name:form.name.value.trim(),group_id:existing?.is_predefined?existing.group_id:form.group_id.value,bill_wise:form.bill_wise.checked,credit_days:Number(form.credit_days.value||0),
  credit_limit_minor:limit?ledgerParseMinor(limit):null,organization_id:form.organization_id.value||null,supplier_id:form.supplier_id.value||null,
  vat_class:form.vat_role.value?null:(form.vat_class.value||null),vat_role:form.vat_role.value,tin:form.tin.value.trim(),vrn:form.vrn.value.trim(),active:form.active.checked};
 if(body.organization_id&&body.supplier_id)throw Error('A ledger is either a customer or a supplier, not both.');
 const saved=ledgerFail(await client.rpc('save_ledger',{p_id:existing?.id||ledgerEditing.newId||(ledgerEditing.newId=crypto.randomUUID()),p_expected_version:existing?.version||0,p_ledger:body}),'Ledger not saved');
 ledgerLedgers=[...ledgerLedgers.filter(l=>l.id!==saved.id),saved];ledgerEditing=null;message(`Ledger ${saved.name} saved.`);await ledgerAccounts();
}
function ledgerGroupEditor(g){
 return `<form id="ledgerGroupForm" class="card"><div class="heading"><h2>${g?`${g.is_predefined?'Rename':'Edit'} ${esc(g.name)}`:'New group'}</h2><button type="button" id="ledgerCancelEdit" aria-label="Close">×</button></div>
  <label><span>Name</span><input name="name" value="${esc(g?.name||'')}" maxlength="120" required></label>
  <label><span>Under</span><select name="parent_id" ${g?.is_predefined?'disabled':''}><option value="">Top level</option>${ledgerGroupOptions(g?.parent_id||'',g?.id)}</select></label>
  <label data-nature ${g?.parent_id||g?.is_predefined?'hidden':''}><span>Kind (top-level groups only)</span><select name="nature" ${g?'disabled':''}>${[['asset','Asset'],['liability','Liability'],['income','Income'],['expense','Expense']].map(([k,label])=>`<option value="${k}" ${g?.nature===k?'selected':''}>${label}</option>`).join('')}</select></label>
  <div class="actions"><button type="submit">Save group</button></div></form>`;
}
async function ledgerSaveGroup(form){
 const existing=ledgerGroupById(ledgerEditing.id),parent=existing?.is_predefined?existing.parent_id:(form.parent_id.value||null);
 const saved=ledgerFail(await client.rpc('save_account_group',{p_id:existing?.id||ledgerEditing.newId||(ledgerEditing.newId=crypto.randomUUID()),p_expected_version:existing?.version||0,p_name:form.name.value.trim(),p_parent_id:parent,p_nature:parent?null:(existing?.nature||form.nature.value)}),'Group not saved');
 ledgerGroups=[...ledgerGroups.filter(g=>g.id!==saved.id),saved];ledgerEditing=null;message(`Group ${saved.name} saved.`);await ledgerAccounts();
}

// Ledger statement -----------------------------------------------------------------------------------------------------
async function ledgerStatementPage(){
 const actor=me?.user_id,ledger=ledgerById(ledgerStatementId),from=ledgerStatementFrom,to=ledgerStatementTo;
 let opening=0,rows=[],more=false;
 if(ledger){
  const [tb,entries]=await Promise.all([client.rpc('trial_balance',{p_from:from,p_to:to}).eq('ledger_id',ledger.id),
   client.from('voucher_entries').select('amount_minor,voucher_id,vouchers!inner(number,voucher_date,narration,created_at,voucher_type_id)').eq('ledger_id',ledger.id).gte('vouchers.voucher_date',from).lte('vouchers.voucher_date',to).limit(2001)]);
  opening=Number((ledgerFail(tb,'Opening balance could not load')||[])[0]?.opening_minor||0);
  const data=ledgerFail(entries,'Statement could not load')||[];more=data.length>2000;
  rows=ledgerStatement(opening,data.slice(0,2000).map(e=>({amount_minor:Number(e.amount_minor),voucher_id:e.voucher_id,...e.vouchers})));
 }
 if(!ledgerStillHere(actor,'statement'))return;
 const closing=rows.length?rows[rows.length-1].balance:opening;
 $('#ledgerPage').innerHTML=`<form id="ledgerStatementFilter" class="actions ledger-filter"><datalist id="ledgerNamesAll">${ledgerLedgers.map(l=>`<option value="${esc(ledgerLedgerLabel(l))}"></option>`).join('')}</datalist>
  <label><span>Ledger</span><input name="ledger" list="ledgerNamesAll" value="${esc(ledger?ledgerLedgerLabel(ledger):'')}" placeholder="Type to search" required></label><label><span>From</span><input type="date" name="from" value="${esc(from)}"></label><label><span>To</span><input type="date" name="to" value="${esc(to)}"></label><button type="submit">Show</button></form>
  ${ledger?`<div class="heading"><h2>${esc(ledger.name)}</h2><button type="button" id="ledgerPrint">Print statement</button></div>${more?'<p class="notice">Only the first 2,000 lines are shown. Choose shorter dates.</p>':''}<table class="ledger-statement"><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th class="number">Debit</th><th class="number">Credit</th><th class="number">Balance</th></tr></thead>
  <tbody><tr><td>${esc(from)}</td><td colspan="4"><strong>Opening balance</strong></td><td class="number">${ledgerBalanceText(opening)}</td></tr>${rows.map(r=>`<tr><td>${esc(r.voucher_date)}</td><td>${esc(ledgerTypeById(r.voucher_type_id)?.name||'')} ${esc(r.number)}</td><td>${esc(r.narration)}</td><td class="number">${r.amount_minor>0?ledgerMoney(r.amount_minor):''}</td><td class="number">${r.amount_minor<0?ledgerMoney(-r.amount_minor):''}</td><td class="number">${ledgerBalanceText(r.balance)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><th colspan="5">Closing balance</th><th class="number">${ledgerBalanceText(closing)}</th></tr></tfoot></table>`:'<p>Choose a ledger to see its statement.</p>'}`;
 $('#ledgerPrint')?.addEventListener('click',()=>window.print());
 $('#ledgerStatementFilter').onsubmit=e=>{e.preventDefault();const l=ledgerLedgers.find(x=>ledgerLedgerLabel(x).toLowerCase()===e.target.ledger.value.trim().toLowerCase()||x.name.toLowerCase()===e.target.ledger.value.trim().toLowerCase());if(!l)return message('Choose a ledger from the list.',true);ledgerStatementId=l.id;ledgerStatementFrom=e.target.from.value;ledgerStatementTo=e.target.to.value;run(()=>ledgerStatementPage());};
}

// Trial Balance --------------------------------------------------------------------------------------------------------
async function ledgerTrialBalance(){
 const actor=me?.user_id,balances=await ledgerBalances(ledgerTbFrom,ledgerTbTo);
 if(!ledgerStillHere(actor,'tb'))return;
 const tree=ledgerTree(ledgerGroups,ledgerLedgers,balances,false),rows=ledgerTreeRows(tree),totals=ledgerTrialTotals([...balances.values()]);
 const cell=v=>v?ledgerMoney(v):'';
 $('#ledgerPage').innerHTML=`<form id="ledgerTbFilter" class="actions ledger-filter"><label><span>From</span><input type="date" name="from" value="${esc(ledgerTbFrom)}"></label><label><span>To</span><input type="date" name="to" value="${esc(ledgerTbTo)}"></label><button type="submit">Show</button></form>
  <p class="${totals.balanced?'':'notice error'}">${totals.balanced?'Debits equal credits.':`Debits and credits differ by ${ledgerMoney(Math.abs(totals.debit-totals.credit))}. Tell the system administrator.`}</p>
  <table class="ledger-tree"><thead><tr><th>Particulars</th><th class="number">Opening</th><th class="number">Debit</th><th class="number">Credit</th><th class="number">Closing Dr</th><th class="number">Closing Cr</th></tr></thead>
  <tbody>${rows.map(r=>{const name=r.kind==='group'?`<strong>${esc(r.group.name)}</strong>`:esc(r.ledger.name);return `<tr class="${r.kind==='group'?'ledger-group-row':''}"><td style="padding-left:${r.depth*18+8}px">${name}</td><td class="number">${r.opening?ledgerBalanceText(r.opening):''}</td><td class="number">${cell(r.debit)}</td><td class="number">${cell(r.credit)}</td><td class="number">${r.closing>0?ledgerMoney(r.closing):''}</td><td class="number">${r.closing<0?ledgerMoney(-r.closing):''}</td></tr>`;}).join('')||'<tr><td colspan="6">Nothing posted in these dates.</td></tr>'}</tbody>
  <tfoot><tr><th colspan="4">Total</th><th class="number">${ledgerMoney(totals.debit)}</th><th class="number">${ledgerMoney(totals.credit)}</th></tr></tfoot></table>`;
 $('#ledgerTbFilter').onsubmit=e=>{e.preventDefault();ledgerTbFrom=e.target.from.value;ledgerTbTo=e.target.to.value;run(()=>ledgerTrialBalance());};
}

// Years & locks --------------------------------------------------------------------------------------------------------
async function ledgerSetup(){
 const actor=me?.user_id,events=await client.from('accounting_events').select('*').order('recorded_at',{ascending:false}).limit(50);
 const log=ledgerFail(events,'Change log could not load')||[];
 if(!ledgerStillHere(actor,'setup'))return;
 const what=e=>{const d=e.after_data||{};return e.entity==='voucher'?`${e.action==='reversed'?'Reversed':'Posted'} ${esc(ledgerTypeById(d.voucher_type_id)?.name||'voucher')} ${esc(d.number||'')}`:e.entity==='period_lock'?`Books locked through ${esc(d.through_date||'')}: ${esc(d.reason||'')}`:`${e.action==='created'?'Created':'Changed'} ${esc(e.entity.replace('_',' '))} ${esc(d.name||'')}`;};
 $('#ledgerPage').innerHTML=`<section class="card"><h2>Financial years</h2><table><thead><tr><th>Year</th><th>From</th><th>To</th></tr></thead><tbody>${ledgerYears.map(y=>`<tr><td>${esc(y.name)}</td><td>${esc(y.starts_on)}</td><td>${esc(y.ends_on)}</td></tr>`).join('')||'<tr><td colspan="3">No financial year yet. The owner opens the first one.</td></tr>'}</tbody></table>
  ${ledgerIsOwner?`<form id="ledgerYearForm" class="actions ledger-filter"><label><span>Name</span><input name="name" placeholder="FY 2026-27" maxlength="40" required></label><label><span>First day</span><input type="date" name="starts_on" required></label><label><span>Last day</span><input type="date" name="ends_on" required></label><button type="submit">Open financial year</button></form>`:''}</section>
  ${ledgerSettingsCard()}${ledgerCloseCard()}
  <section class="card"><h2>Lock the books</h2><p>${ledgerLockedThrough?`Books are locked through <strong>${esc(ledgerLockedThrough)}</strong>. Nothing can be posted on or before that date.`:'No month is locked yet.'} Lock a month after its VAT return is filed.${ledgerIsOwner?'':' Only the owner can reopen a locked month.'}</p>
  <form id="ledgerLockForm" class="actions ledger-filter"><label><span>Lock through</span><input type="date" name="through" required></label><label><span>Reason</span><input name="reason" maxlength="500" minlength="5" placeholder="September VAT return filed" required></label><button type="submit">Lock books</button></form></section>
  <section class="card"><h2>Change log</h2><p class="muted">The latest 50 changes. Nothing here can be edited or deleted.</p><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${log.map(e=>`<tr><td>${esc(new Date(e.recorded_at).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam'}))}</td><td>${esc(typeof employeeName==='function'?employeeName(e.actor_user_id):'')}</td><td>${what(e)}</td></tr>`).join('')||'<tr><td colspan="3">No changes yet.</td></tr>'}</tbody></table></section>`;
 const yf=$('#ledgerYearForm');if(yf)yf.onsubmit=e=>{e.preventDefault();run(async()=>{ledgerYearId=ledgerYearId||crypto.randomUUID();const saved=ledgerFail(await client.rpc('save_fiscal_year',{p_id:ledgerYearId,p_name:yf.name.value.trim(),p_starts_on:yf.starts_on.value,p_ends_on:yf.ends_on.value}),'Year not opened');ledgerYearId='';ledgerYears=[saved,...ledgerYears.filter(y=>y.id!==saved.id)].sort((a,b)=>b.starts_on.localeCompare(a.starts_on));message(`${saved.name} opened.`);await ledgerSetup();});};
 bindLedgerSettings();bindLedgerClose();
 const lf=$('#ledgerLockForm');lf.onsubmit=e=>{e.preventDefault();run(async()=>{const through=lf.through.value;if(ledgerLockedThrough&&through<ledgerLockedThrough&&!ledgerIsOwner)throw Error('Only the owner can reopen a locked month.');if(!confirm(`Lock the books through ${through}? Nothing can then be posted on or before that date.`))return;const saved=ledgerFail(await client.rpc('lock_ledger_period',{p_through_date:through,p_reason:lf.reason.value.trim()}),'Books not locked');ledgerLockedThrough=saved.through_date;message(`Books locked through ${saved.through_date}.`);await ledgerWorkspace();});};
}

// Balance today, for credit-limit warnings. Cached until a voucher on that ledger posts.
async function ledgerBalanceOf(ledgerId){
 if(!ledgerBalanceCache.has(ledgerId)){
  const r=await client.rpc('trial_balance',{p_from:'1900-01-01',p_to:ledgerToday()}).eq('ledger_id',ledgerId);
  ledgerBalanceCache.set(ledgerId,Number((ledgerFail(r,'Balance could not load')||[])[0]?.closing_minor||0));
 }
 return ledgerBalanceCache.get(ledgerId);
}

// From orders: accepted Pro formas waiting for their tax invoice, and purchase orders waiting for the supplier's bill.
async function ledgerOrdersPage(){
 const actor=me?.user_id;
 const [pfs,pos,posted]=await Promise.all([
  client.from('sales_proformas').select('id,document_number,organization_id,total_minor,currency,accepted_at,acceptance_reference,deleted_at').eq('status','accepted').order('accepted_at',{ascending:false}).limit(300),
  client.from('purchase_orders').select('id,po_number,supplier_id,status,currency,lpo_reference,ordered_at').in('status',['ordered','closed']).order('ordered_at',{ascending:false}).limit(300),
  client.from('vouchers').select('id,number,source_kind,source_id,reverses_voucher_id').in('source_kind',['proforma','purchase_order']).limit(5000)]);
 if(ledgerSuppliers===null){const r=await client.from('suppliers').select('id,name').order('name').limit(2000);ledgerSuppliers=r.error?[]:r.data;}
 if(!ledgerStillHere(actor,'orders'))return;
 const done=ledgerFail(posted,'Posted vouchers could not load')||[],reversed=new Set(done.filter(v=>v.reverses_voucher_id).map(v=>v.reverses_voucher_id));
 const live=new Map(done.filter(v=>!v.reverses_voucher_id&&!reversed.has(v.id)).map(v=>[`${v.source_kind}:${v.source_id}`,v]));
 const q=ledgerOrderSearch.trim().toLowerCase(),orgName=id=>organizations.find(o=>o.id===id)?.name||'Customer not loaded',supName=id=>ledgerSuppliers.find(s=>s.id===id)?.name||'No supplier';
 const proformas=(ledgerFail(pfs,'Pro formas could not load')||[]).filter(p=>!p.deleted_at&&!live.has(`proforma:${p.id}`)&&(!q||`${p.document_number} ${orgName(p.organization_id)} ${p.acceptance_reference||''}`.toLowerCase().includes(q)));
 const orders=(ledgerFail(pos,'Purchase orders could not load')||[]).filter(o=>!live.has(`purchase_order:${o.id}`)&&(!q||`${o.po_number} ${supName(o.supplier_id)} ${o.lpo_reference}`.toLowerCase().includes(q)));
 const customerLedger=id=>ledgerLedgers.find(l=>l.organization_id===id&&l.active);
 $('#ledgerPage').innerHTML=`<label class="search"><span>Search</span><input id="ledgerOrderSearch" type="search" value="${esc(ledgerOrderSearch)}" placeholder="PF or PO number, customer, supplier or LPO"></label>
  <section class="card"><h2>Pro formas to invoice</h2><p class="muted">Accepted Pro formas without a tax invoice in the books. The invoice is made from the Pro forma's own lines and VAT; nothing is typed again.</p>
  <table><thead><tr><th>Pro forma</th><th>Customer</th><th>Accepted</th><th class="number">Total (TZS)</th><th></th></tr></thead><tbody>${proformas.map(p=>{const l=customerLedger(p.organization_id);return `<tr><td>${esc(p.document_number)}${p.acceptance_reference?`<br><small>${esc(p.acceptance_reference)}</small>`:''}</td><td>${esc(orgName(p.organization_id))}${l?'':'<br><small class="overdue">No customer ledger yet</small>'}</td><td>${esc(String(p.accepted_at||'').slice(0,10))}</td><td class="number">${p.currency==='TZS'?ledgerMoney(p.total_minor):`${esc(p.currency)} ${ledgerMoney(p.total_minor)}`}</td>
   <td>${p.currency!=='TZS'?'<small>Not TZS: enter by hand</small>':`<form class="ledger-invoice" data-invoice="${esc(p.id)}"><input type="date" name="date" value="${esc(ledgerToday())}" aria-label="Invoice date for ${esc(p.document_number)}"><button type="submit">Post tax invoice</button></form>`}</td></tr>`;}).join('')||'<tr><td colspan="5">Every accepted Pro forma is invoiced.</td></tr>'}</tbody></table></section>
  <section class="card"><h2>Purchase orders to bill</h2><p class="muted">Ordered purchase orders without a supplier bill in the books. The voucher form opens filled from the order; change it to match the supplier's bill.</p>
  <table><thead><tr><th>Purchase order</th><th>Supplier</th><th>Ordered</th><th></th></tr></thead><tbody>${orders.map(o=>`<tr><td>${esc(o.po_number)}${o.lpo_reference?`<br><small>${esc(o.lpo_reference)}</small>`:''}</td><td>${esc(supName(o.supplier_id))}</td><td>${esc(String(o.ordered_at||'').slice(0,10))}</td><td>${o.currency!=='TZS'?'<small>Not TZS: enter by hand</small>':`<button type="button" data-bill-po="${esc(o.id)}">Enter supplier bill</button>`}</td></tr>`).join('')||'<tr><td colspan="4">No purchase orders waiting for a bill.</td></tr>'}</tbody></table></section>`;
 $('#ledgerOrderSearch').oninput=e=>{ledgerOrderSearch=e.target.value;clearTimeout(ledgerOrdersPage.timer);ledgerOrdersPage.timer=setTimeout(()=>run(async()=>{await ledgerOrdersPage();const box=$('#ledgerOrderSearch');if(box){box.focus();box.setSelectionRange(box.value.length,box.value.length);}}),300);};
 document.querySelectorAll('[data-invoice]').forEach(form=>form.onsubmit=e=>{e.preventDefault();run(async()=>{
  const pf=form.dataset.invoice;if(!ledgerInvoiceIds.has(pf))ledgerInvoiceIds.set(pf,crypto.randomUUID());
  const saved=ledgerFail(await client.rpc('post_sales_invoice',{p_id:ledgerInvoiceIds.get(pf),p_proforma_id:pf,p_date:form.date.value}),'Invoice not posted');
  ledgerInvoiceIds.delete(pf);ledgerBillsCache.clear();ledgerBalanceCache.clear();message(`Sales ${saved.number} posted for ${proformas.find(p=>p.id===pf)?.document_number||'the Pro forma'}.`);await ledgerOrdersPage();
 });});
 document.querySelectorAll('[data-bill-po]').forEach(b=>b.onclick=()=>run(()=>ledgerBillPurchaseOrder(orders.find(o=>o.id===b.dataset.billPo))));
}
async function ledgerBillPurchaseOrder(order){
 const lines=ledgerFail(await client.from('purchase_order_lines').select('quantity,unit_price_minor').eq('purchase_order_id',order.id),'Order lines could not load')||[];
 const supplier=ledgerLedgers.find(l=>l.supplier_id===order.supplier_id&&l.active),type=ledgerTypes.find(t=>t.base_type==='purchase');
 if(!type)throw Error('There is no active Purchase voucher type.');
 const draft=ledgerPurchaseDraft(order,lines,ledgerSettings||{},supplier,ledgerRates.standard??0);
 ledgerForm={...ledgerNewForm(),type_id:type.id,reference:draft.reference,narration:draft.narration,lines:draft.lines,source:{kind:'purchase_order',id:order.id},
  source_label:`Filled from purchase order ${order.po_number}.${supplier?'':' This supplier has no ledger yet; create it under Ledgers.'}${draft.missingPrices?' Some order lines have no price.':''}`};
 openLedgerTab('voucher');await ledgerWorkspace();
}

// Receivables & payables: open bills per customer and supplier, with how long they are overdue.
let ledgerOutstandingSide='receivable';
async function ledgerOutstandingPage(){
 const actor=me?.user_id,today=ledgerToday(),code=ledgerOutstandingSide==='receivable'?'sundry_debtors':'sundry_creditors';
 const parties=new Map(ledgerLedgers.filter(l=>l.bill_wise&&ledgerGroupUnder(l.group_id,code,ledgerGroups)).map(l=>[l.id,l]));
 const rows=[];
 // All open bills, paged; filtered here so the request does not carry hundreds of ledger ids.
 for(let i=0;parties.size;i+=1000){const r=await client.from('ledger_bill_balances').select('*').neq('balance_minor',0).order('bill_id').range(i,i+999);const data=ledgerFail(r,'Open bills could not load')||[];rows.push(...data.filter(b=>parties.has(b.ledger_id)));if(data.length<1000)break;}
 if(!ledgerStillHere(actor,'outstanding'))return;
 const ageing=ledgerAgeing(rows,parties,today,ledgerOutstandingSide==='receivable'?1:-1),sum=k=>ageing.reduce((s,p)=>s+p[k],0);
 $('#ledgerPage').innerHTML=`<div class="tabs" role="group" aria-label="Receivables or payables"><button type="button" data-outstanding="receivable" class="${ledgerOutstandingSide==='receivable'?'active':''}" aria-pressed="${ledgerOutstandingSide==='receivable'}">Customers owe us</button><button type="button" data-outstanding="payable" class="${ledgerOutstandingSide==='payable'?'active':''}" aria-pressed="${ledgerOutstandingSide==='payable'}">We owe suppliers</button></div>
  <p class="muted">Open bills on ${esc(today)}, by days past the due date. Payments not yet matched to a bill (on account) are not in this list; see the ledger statement.</p>
  <table class="ledger-ageing"><thead><tr><th>${ledgerOutstandingSide==='receivable'?'Customer':'Supplier'}</th>${ledgerAgeBuckets.map(([,label])=>`<th class="number">${label}</th>`).join('')}<th class="number">Total</th><th></th></tr></thead>
  <tbody>${ageing.map(p=>`<tr><td><details><summary>${esc(p.ledger.name)} <small>${p.bills.length} bill${p.bills.length===1?'':'s'}</small></summary><ul>${p.bills.map(b=>`<li>${esc(b.name)} · ${ledgerMoney(b.amount)}${b.due_date?` · due ${esc(b.due_date)}`:''}</li>`).join('')}</ul></details></td>${ledgerAgeBuckets.map(([k])=>`<td class="number ${k==='older'&&p[k]?'overdue':''}">${p[k]?ledgerMoney(p[k]):''}</td>`).join('')}<td class="number"><strong>${ledgerMoney(p.total)}</strong></td><td><button type="button" data-statement="${esc(p.ledger.id)}">Statement</button></td></tr>`).join('')||'<tr><td colspan="8">Nothing outstanding.</td></tr>'}</tbody>
  <tfoot><tr><th>Total</th>${ledgerAgeBuckets.map(([k])=>`<th class="number">${ledgerMoney(sum(k))}</th>`).join('')}<th class="number">${ledgerMoney(sum('total'))}</th><th></th></tr></tfoot></table>`;
 document.querySelectorAll('[data-outstanding]').forEach(b=>b.onclick=()=>run(()=>{ledgerOutstandingSide=b.dataset.outstanding;return ledgerOutstandingPage();}));
 document.querySelectorAll('[data-statement]').forEach(b=>b.onclick=()=>run(async()=>{ledgerStatementId=b.dataset.statement;openLedgerTab('statement');await ledgerWorkspace();}));
}

// Default ledgers (on Years & locks): where a Pro forma invoice posts and how a purchase bill is pre-filled.
function ledgerSettingsCard(){
 const s=ledgerSettings||{},pick=(name,label,filter)=>`<label><span>${label}</span><select name="${name}"><option value="">Not chosen</option>${ledgerLedgers.filter(l=>l.active&&filter(l)).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value="${esc(l.id)}" ${s[name]===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>`;
 return `<section class="card"><h2>Default ledgers</h2><p class="muted">Used when a Pro forma is invoiced and when a supplier bill is filled from a purchase order.</p>
  <form id="ledgerSettingsForm" class="ledger-voucher-head">${pick('sales_ledger_id','Sales ledger',l=>ledgerGroupUnder(l.group_id,'sales_accounts',ledgerGroups))}${pick('output_vat_ledger_id','Output VAT ledger',l=>l.vat_role==='output')}
  ${pick('purchase_ledger_id','Purchase ledger',l=>ledgerGroupUnder(l.group_id,'purchase_accounts',ledgerGroups))}${pick('input_vat_ledger_id','Input VAT ledger',l=>l.vat_role==='input')}
  <label><span>Pro forma lines without VAT are</span><select name="untaxed_vat_class">${[['exempt','Exempt'],['zero','Zero-rated'],['out_of_scope','Outside VAT']].map(([k,label])=>`<option value="${k}" ${(s.untaxed_vat_class||'exempt')===k?'selected':''}>${label}</option>`).join('')}</select></label>
  <div class="actions"><button type="submit">Save default ledgers</button></div></form></section>`;
}
function bindLedgerSettings(){
 const form=$('#ledgerSettingsForm');if(!form)return;
 form.onsubmit=e=>{e.preventDefault();run(async()=>{
  const body=Object.fromEntries(['sales_ledger_id','output_vat_ledger_id','purchase_ledger_id','input_vat_ledger_id','untaxed_vat_class'].map(k=>[k,form[k].value]));
  ledgerSettings=ledgerFail(await client.rpc('save_ledger_settings',{p_expected_version:ledgerSettings?.version||1,p_settings:body}),'Default ledgers not saved');
  message('Default ledgers saved.');await ledgerSetup();
 });};
}

// Bank reconciliation ---------------------------------------------------------------------------------------------------
let ledgerBankId='',ledgerBankTo='',ledgerBankProposed=new Map(),ledgerBankImportId='';
const ledgerBankLedgers=()=>ledgerLedgers.filter(l=>l.active&&(ledgerGroupUnder(l.group_id,'bank_accounts',ledgerGroups)||ledgerGroupUnder(l.group_id,'bank_od',ledgerGroups))).sort((a,b)=>a.name.localeCompare(b.name));
async function ledgerBankPage(){
 const actor=me?.user_id,banks=ledgerBankLedgers();
 if(!ledgerBankTo)ledgerBankTo=ledgerToday();
 if(!banks.some(b=>b.id===ledgerBankId))ledgerBankId=banks[0]?.id||'';
 if(!ledgerBankId){$('#ledgerPage').innerHTML='<p>Create a ledger under Bank Accounts first.</p>';return;}
 const book=[];
 for(let i=0;;i+=1000){const r=await client.rpc('bank_book',{p_ledger_id:ledgerBankId,p_to:ledgerBankTo}).range(i,i+999);const data=ledgerFail(r,'Bank book could not load')||[];book.push(...data.map(e=>({...e,amount_minor:Number(e.amount_minor)})));if(data.length<1000)break;}
 const lr=await client.from('bank_statement_lines').select('*').eq('ledger_id',ledgerBankId).lte('line_date',ledgerBankTo).order('line_date').limit(5000);
 if(!ledgerStillHere(actor,'bank'))return;
 const lines=(ledgerFail(lr,'Statement lines could not load')||[]).map(l=>({...l,amount_minor:Number(l.amount_minor)}));
 const used=new Set(book.map(e=>e.bank_date&&e.statement_line_id).filter(Boolean)),freeLines=lines.filter(l=>!used.has(l.id));
 const proposedLines=new Set([...ledgerBankProposed.values()].map(p=>p.statement_line_id)),missing=freeLines.filter(l=>!proposedLines.has(l.id));
 const brs=ledgerBrs(book,ledgerBankTo),open=book.filter(e=>!e.bank_date),cleared=book.filter(e=>e.bank_date).slice(-30).reverse();
 const typeName=id=>ledgerTypeById(id)?.name||'';
 $('#ledgerPage').innerHTML=`<form id="ledgerBankFilter" class="actions ledger-filter"><label><span>Bank</span><select name="bank">${banks.map(b=>`<option value="${esc(b.id)}" ${b.id===ledgerBankId?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label><label><span>On</span><input type="date" name="to" value="${esc(ledgerBankTo)}"></label><button type="submit">Show</button></form>
  <section class="card"><h2>Reconciliation on ${esc(ledgerBankTo)}</h2><table class="ledger-brs"><tbody>
   <tr><td>Balance in our books</td><td class="number">${ledgerBalanceText(brs.book)}</td></tr>
   <tr><td>Less: deposits the bank has not yet credited</td><td class="number">${ledgerMoney(brs.deposits)}</td></tr>
   <tr><td>Add: payments the bank has not yet paid out</td><td class="number">${ledgerMoney(-brs.payments)}</td></tr></tbody>
   <tfoot><tr><th>The bank statement should show</th><th class="number">${ledgerBalanceText(brs.bank)}</th></tr></tfoot></table>
   <p class="muted">Compare this with the closing balance on the bank statement for ${esc(ledgerBankTo)}. If they differ, an entry is missing or has the wrong bank date.</p></section>
  <section class="card"><h2>Import a bank statement</h2><p class="muted">Download the statement from the bank as CSV. Lines already imported are skipped, so the same file can be imported again.</p>
   <div class="actions"><input type="file" id="ledgerBankFile" accept=".csv,text/csv" aria-label="Bank statement CSV file"><button type="button" id="ledgerBankImport">Import statement</button></div></section>
  <section class="card"><div class="heading"><h2>Not yet cleared by the bank · ${open.length}</h2><div class="actions"><button type="button" id="ledgerBankMatch" ${freeLines.length&&open.length?'':'disabled'}>Match with statement</button><button type="button" id="ledgerBankSave">Save bank dates</button></div></div>
   <p class="muted">Type the date each entry appears on the bank statement, or press Match with statement. Nothing is saved until you press Save bank dates.</p>
   <table><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th class="number">Deposit</th><th class="number">Payment</th><th>Bank date</th></tr></thead><tbody>${open.map(e=>{const p=ledgerBankProposed.get(e.entry_id);return `<tr data-bank-entry="${esc(e.entry_id)}" data-line="${esc(p?.statement_line_id||'')}"><td>${esc(e.voucher_date)}</td><td>${esc(typeName(e.voucher_type_id))} ${esc(e.number)}</td><td>${esc(e.narration||e.reference||'')}</td><td class="number">${e.amount_minor>0?ledgerMoney(e.amount_minor):''}</td><td class="number">${e.amount_minor<0?ledgerMoney(-e.amount_minor):''}</td><td><input type="date" value="${esc(p?.bank_date||'')}" aria-label="Bank date for ${esc(typeName(e.voucher_type_id))} ${esc(e.number)}">${p?' <small>from statement</small>':''}</td></tr>`;}).join('')||'<tr><td colspan="6">Every entry is cleared.</td></tr>'}</tbody></table></section>
  <section class="card"><h2>On the statement but not in our books · ${missing.length}</h2><p class="muted">Bank charges, interest or transfers nobody has entered yet. Enter a voucher for each, then match again.</p>
   <table><thead><tr><th>Date</th><th>Description</th><th class="number">In</th><th class="number">Out</th><th></th></tr></thead><tbody>${missing.slice(0,200).map(l=>`<tr><td>${esc(l.line_date)}</td><td>${esc(l.description)}${l.bank_ref?` <small>${esc(l.bank_ref)}</small>`:''}</td><td class="number">${l.amount_minor>0?ledgerMoney(l.amount_minor):''}</td><td class="number">${l.amount_minor<0?ledgerMoney(-l.amount_minor):''}</td><td><button type="button" data-bank-voucher="${esc(l.id)}">Enter voucher</button></td></tr>`).join('')||'<tr><td colspan="5">Nothing outstanding.</td></tr>'}</tbody></table></section>
  <section class="card"><h2>Recently cleared</h2><table><thead><tr><th>Date</th><th>Voucher</th><th class="number">Amount</th><th>Bank date</th><th></th></tr></thead><tbody>${cleared.map(e=>`<tr><td>${esc(e.voucher_date)}</td><td>${esc(typeName(e.voucher_type_id))} ${esc(e.number)}</td><td class="number">${ledgerBalanceText(e.amount_minor)}</td><td>${esc(e.bank_date)}</td><td><button type="button" data-bank-undo="${esc(e.entry_id)}">Undo</button></td></tr>`).join('')||'<tr><td colspan="5">Nothing cleared yet.</td></tr>'}</tbody></table></section>`;
 $('#ledgerBankFilter').onsubmit=e=>{e.preventDefault();ledgerBankId=e.target.bank.value;ledgerBankTo=e.target.to.value;ledgerBankProposed=new Map();run(()=>ledgerBankPage());};
 $('#ledgerBankMatch').onclick=()=>run(async()=>{const found=ledgerAutoMatch(open,freeLines);ledgerBankProposed=new Map(found.map(m=>[m.entry_id,m]));message(found.length?`${found.length} entr${found.length===1?'y':'ies'} matched with the statement. Check them, then press Save bank dates.`:'No entries match the statement by amount within 7 days.');await ledgerBankPage();});
 $('#ledgerBankSave').onclick=()=>run(async()=>{
  const rows=[...document.querySelectorAll('[data-bank-entry]')].map(r=>({entry_id:r.dataset.bankEntry,bank_date:r.querySelector('input').value,statement_line_id:r.dataset.line||null})).filter(r=>r.bank_date)
   .map(r=>{const p=ledgerBankProposed.get(r.entry_id);return p&&p.bank_date===r.bank_date?r:{...r,statement_line_id:null};});
  if(!rows.length)throw Error('Type a bank date for at least one entry, or press Match with statement.');
  const n=ledgerFail(await client.rpc('record_bank_dates',{p_rows:rows}),'Bank dates not saved');ledgerBankProposed=new Map();message(`${n} bank date${n===1?'':'s'} saved.`);await ledgerBankPage();
 });
 $('#ledgerBankImport').onclick=()=>run(async()=>{
  const file=$('#ledgerBankFile').files[0];if(!file)throw Error('Choose the statement file first.');
  const parsed=ledgerStatementFromCsv(await file.text());if(!parsed.lines.length)throw Error('No statement lines with a date and an amount were found in this file.');
  ledgerBankImportId=ledgerBankImportId||crypto.randomUUID();let added=0,already=0;
  for(let i=0;i<parsed.lines.length;i+=2000){const r=ledgerFail(await client.rpc('import_bank_statement',{p_import_id:i?crypto.randomUUID():ledgerBankImportId,p_ledger_id:ledgerBankId,p_file_name:file.name,p_lines:parsed.lines.slice(i,i+2000)}),'Statement not imported');added+=r.new;already+=r.already;}
  ledgerBankImportId='';message(`Statement imported: ${added} new line${added===1?'':'s'}${already?`, ${already} already here`:''}${parsed.skipped.length?`; rows skipped (no date or amount): ${parsed.skipped.slice(0,10).join(', ')}`:''}.`);await ledgerBankPage();
 });
 document.querySelectorAll('[data-bank-undo]').forEach(b=>b.onclick=()=>run(async()=>{ledgerFail(await client.rpc('record_bank_dates',{p_rows:[{entry_id:b.dataset.bankUndo,bank_date:null}]}),'Not undone');message('Bank date removed.');await ledgerBankPage();}));
 document.querySelectorAll('[data-bank-voucher]').forEach(b=>b.onclick=()=>run(async()=>{
  const l=missing.find(x=>x.id===b.dataset.bankVoucher),type=ledgerTypes.find(t=>t.base_type===(l.amount_minor>0?'receipt':'payment'));
  ledgerForm={...ledgerNewForm(),type_id:type?.id||'',date:l.line_date,reference:l.bank_ref,narration:l.description,source_label:`From the bank statement of ${l.line_date}.`,
   lines:[{ledger_id:ledgerBankId,side:l.amount_minor>0?'dr':'cr',amount:ledgerMoney(Math.abs(l.amount_minor)),vat_class:'',bills:[]},{ledger_id:'',side:l.amount_minor>0?'cr':'dr',amount:ledgerMoney(Math.abs(l.amount_minor)),vat_class:'',bills:[]}]};
  openLedgerTab('voucher');await ledgerWorkspace();
 }));
}

// Profit & Loss and Balance Sheet ---------------------------------------------------------------------------------------
let ledgerStatementKind='pl';
function ledgerStatementRows(parts,sign){
 return parts.map(p=>`<tr class="ledger-group-row"><td><details><summary><strong>${esc(p.node.group.name)}</strong></summary><table>${ledgerTreeRows([p.node]).filter(r=>r.kind==='ledger').map(r=>`<tr><td>${esc(r.ledger.name)}</td><td class="number">${ledgerMoney(sign(r))}</td></tr>`).join('')}</table></details></td><td class="number">${ledgerMoney(p.amount)}</td></tr>`).join('');
}
async function ledgerStatementsPage(){
 const actor=me?.user_id,pl=ledgerStatementKind==='pl',balances=await ledgerBalances(pl?ledgerTbFrom:'1900-01-01',ledgerTbTo);
 if(!ledgerStillHere(actor,'statements'))return;
 const head=`<div class="tabs" role="group" aria-label="Statement"><button type="button" data-statement-kind="pl" class="${pl?'active':''}" aria-pressed="${pl}">Profit &amp; Loss</button><button type="button" data-statement-kind="bs" class="${pl?'':'active'}" aria-pressed="${!pl}">Balance Sheet</button></div>
  <form id="ledgerStatementsFilter" class="actions ledger-filter">${pl?`<label><span>From</span><input type="date" name="from" value="${esc(ledgerTbFrom)}"></label>`:''}<label><span>${pl?'To':'As at'}</span><input type="date" name="to" value="${esc(ledgerTbTo)}"></label><button type="submit">Show</button><button type="button" id="ledgerStatementsPrint">Print</button></form>`;
 let body;
 if(pl){
  const r=ledgerProfitAndLoss(ledgerGroups,ledgerLedgers,balances),inc=x=>-(x.closing-x.opening),exp=x=>x.closing-x.opening;
  body=`<h2>Profit &amp; Loss · ${esc(ledgerTbFrom)} to ${esc(ledgerTbTo)}</h2><table class="ledger-statement-table"><tbody>
   ${ledgerStatementRows(r.directIncome,inc)}<tr><td colspan="2"><small>Less</small></td></tr>${ledgerStatementRows(r.directExpense,exp)}
   <tr class="ledger-total"><th>Gross ${r.gross<0?'loss':'profit'}</th><th class="number">${ledgerMoney(Math.abs(r.gross))}</th></tr>
   ${ledgerStatementRows(r.indirectIncome,inc)}${r.indirectExpense.length?'<tr><td colspan="2"><small>Less</small></td></tr>':''}${ledgerStatementRows(r.indirectExpense,exp)}
   </tbody><tfoot><tr class="ledger-total"><th>Net ${r.net<0?'loss':'profit'}</th><th class="number">${ledgerMoney(Math.abs(r.net))}</th></tr></tfoot></table>
   <p class="muted">Closing stock is not added here. Post the stock value at the end of the period to Stock-in-Hand by journal.</p>`;
 }else{
  const r=ledgerBalanceSheet(ledgerGroups,ledgerLedgers,balances);
  body=`<h2>Balance Sheet as at ${esc(ledgerTbTo)}</h2>${r.balanced?'':`<p class="notice error">Assets and liabilities differ by ${ledgerMoney(Math.abs(r.totalAssets-r.totalLiabilities))}. Tell the system administrator.</p>`}
   <div class="ledger-bs"><table class="ledger-statement-table"><thead><tr><th>Liabilities</th><th class="number">TZS</th></tr></thead><tbody>${ledgerStatementRows(r.liabilities,x=>-x.closing)}
    <tr class="ledger-group-row"><td><strong>Profit &amp; Loss A/c</strong><br><small>Profit not yet closed to reserves</small></td><td class="number">${ledgerMoney(r.profit)}</td></tr></tbody><tfoot><tr class="ledger-total"><th>Total</th><th class="number">${ledgerMoney(r.totalLiabilities)}</th></tr></tfoot></table>
   <table class="ledger-statement-table"><thead><tr><th>Assets</th><th class="number">TZS</th></tr></thead><tbody>${ledgerStatementRows(r.assets,x=>x.closing)}</tbody><tfoot><tr class="ledger-total"><th>Total</th><th class="number">${ledgerMoney(r.totalAssets)}</th></tr></tfoot></table></div>`;
 }
 $('#ledgerPage').innerHTML=head+body;
 document.querySelectorAll('[data-statement-kind]').forEach(b=>b.onclick=()=>run(()=>{ledgerStatementKind=b.dataset.statementKind;return ledgerStatementsPage();}));
 $('#ledgerStatementsFilter').onsubmit=e=>{e.preventDefault();if(e.target.from)ledgerTbFrom=e.target.from.value;ledgerTbTo=e.target.to.value;run(()=>ledgerStatementsPage());};
 $('#ledgerStatementsPrint').onclick=()=>{document.querySelectorAll('.ledger-statement-table details').forEach(d=>d.open=true);window.print();};
}

// Year-end close (owner) ------------------------------------------------------------------------------------------------
let ledgerCloseIds=new Map();
function ledgerCloseCard(){
 if(!ledgerYears.length)return '';
 const capital=ledgerLedgers.filter(l=>l.active&&ledgerGroupUnder(l.group_id,'capital_account',ledgerGroups)).sort((a,b)=>a.name.localeCompare(b.name));
 return `<section class="card"><h2>Close a financial year</h2><p class="muted">Moves the year's profit or loss to the ledger you choose and locks the year. It cannot be undone; close each year once its accounts are final.</p>
  <table><thead><tr><th>Year</th><th>State</th><th></th></tr></thead><tbody>${[...ledgerYears].reverse().map(y=>`<tr><td>${esc(y.name)}</td><td>${y.closed_at?`Closed ${esc(String(y.closed_at).slice(0,10))}`:'Open'}</td><td>${y.closed_at||!ledgerIsOwner?'':`<form class="ledger-invoice" data-close-year="${esc(y.id)}"><select name="retained" aria-label="Ledger for the profit of ${esc(y.name)}"><option value="">Profit goes to…</option>${capital.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select><button type="submit">Close ${esc(y.name)}</button></form>`}</td></tr>`).join('')}</tbody></table>${ledgerIsOwner?'':'<p class="muted">Only the owner can close a year.</p>'}</section>`;
}
function bindLedgerClose(){
 document.querySelectorAll('[data-close-year]').forEach(form=>form.onsubmit=e=>{e.preventDefault();run(async()=>{
  const year=ledgerYears.find(y=>y.id===form.dataset.closeYear);
  if(!form.retained.value)throw Error('Choose the ledger the profit goes to, for example Retained earnings under Reserves & Surplus.');
  if(!confirm(`Close ${year.name}? Its profit or loss moves to ${ledgerById(form.retained.value)?.name}, and nothing more can be posted up to ${year.ends_on}.`))return;
  if(!ledgerCloseIds.has(year.id))ledgerCloseIds.set(year.id,crypto.randomUUID());
  const saved=ledgerFail(await client.rpc('close_fiscal_year',{p_voucher_id:ledgerCloseIds.get(year.id),p_year_id:year.id,p_retained_ledger_id:form.retained.value}),'Year not closed');
  ledgerCloseIds.delete(year.id);ledgerYears=ledgerYears.map(y=>y.id===saved.id?saved:y);message(`${saved.name} closed.`);await ledgerWorkspace(true);
 });});
}
