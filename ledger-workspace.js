'use strict';
// Books of account (stage 1 of replica/architecture.md): enter vouchers, Day Book, ledgers, ledger statement,
// Trial Balance, financial years and month locks. Every write goes through a database function that checks the
// voucher balances, the bills, the VAT and the lock again; nothing here writes a table directly. A posted voucher is
// never edited: it is reversed and posted again. Open to the owner and approved accounts staff (ledger_staff).
let ledgerTab='voucher',ledgerLoaded=false,ledgerEpoch=0,ledgerLoadError='',ledgerNotReady=false;
let ledgerGroups=[],ledgerLedgers=[],ledgerTypes=[],ledgerYears=[],ledgerRates={},ledgerLockedThrough=null,ledgerIsOwner=false;
let ledgerForm=null,ledgerBillsCache=new Map(),ledgerReversalIds=new Map(),ledgerReversing='';
let ledgerDayFrom='',ledgerDayTo='',ledgerDayPage=0,ledgerStatementId='',ledgerStatementFrom='',ledgerStatementTo='',ledgerTbFrom='',ledgerTbTo='';
let ledgerEditing=null,ledgerSuppliers=null,ledgerYearId='';
const ledgerTabs=[['voucher','Enter voucher'],['daybook','Day Book'],['accounts','Ledgers'],['statement','Ledger statement'],['tb','Trial Balance'],['setup','Years & locks']];
const ledgerVatClasses=[['','No VAT'],['standard','Standard rate'],['zero','Zero-rated'],['exempt','Exempt'],['out_of_scope','Outside VAT']];
const ledgerBillKinds=[['new','New bill'],['against','Against bill'],['advance','Advance'],['on_account','On account']];
function clearLedger(){ledgerEpoch++;ledgerLoaded=false;ledgerLoadError='';ledgerNotReady=false;ledgerGroups=[];ledgerLedgers=[];ledgerTypes=[];ledgerYears=[];ledgerRates={};ledgerForm=null;ledgerBillsCache=new Map();ledgerReversalIds=new Map();ledgerEditing=null;ledgerSuppliers=null;}
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
 const [groups,ledgers,types,years,rates,lock]=await Promise.all([all('account_groups','*'),all('ledgers','*'),all('voucher_types','*'),all('fiscal_years','*'),all('vat_rates','*'),client.rpc('ledger_locked_through')]);
 if(epoch!==ledgerEpoch||me?.user_id!==actor)return false;
 ledgerGroups=groups;ledgerLedgers=ledgers;ledgerTypes=types.filter(t=>t.active);ledgerYears=[...years].sort((a,b)=>b.starts_on.localeCompare(a.starts_on));
 const today=ledgerToday();ledgerRates={};
 for(const r of [...rates].sort((a,b)=>a.effective_from.localeCompare(b.effective_from)))if(r.effective_from<=today)ledgerRates[r.vat_class]=r.rate_bp;
 ledgerLockedThrough=ledgerFail(lock,'Month lock could not load');ledgerIsOwner=me?.role==='owner';
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
 const page=ledgerTab==='daybook'?ledgerDayBook:ledgerTab==='accounts'?ledgerAccounts:ledgerTab==='statement'?ledgerStatementPage:ledgerTab==='tb'?ledgerTrialBalance:ledgerTab==='setup'?ledgerSetup:ledgerVoucherPage;
 try{await page();}catch(error){if(ledgerNotReady)return ledgerWorkspace();if($('#ledgerPage'))$('#ledgerPage').innerHTML=`<p class="notice error" role="alert">${esc(error.message)}</p>`;}
}
const ledgerStillHere=(actor,tab)=>view==='ledger'&&me?.user_id===actor&&ledgerTab===tab&&$('#ledgerPage');

// Enter voucher ----------------------------------------------------------------------------------------------------
const ledgerBlankLine=side=>({ledger_id:'',side,amount:'',vat_class:'',bills:[]});
function ledgerNewForm(keep){
 const type=keep?.type_id||ledgerTypes.find(t=>t.base_type==='payment')?.id||ledgerTypes.find(t=>t.base_type!=='opening')?.id||'';
 return {id:crypto.randomUUID(),type_id:type,date:keep?.date||ledgerToday(),number:'',reference:'',narration:'',supplier_tin:'',supplier_code:'',lines:[ledgerBlankLine('dr'),ledgerBlankLine('cr')]};
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
 const openBills=new Map(await Promise.all(billLedgers.map(async id=>[id,await ledgerBillsFor(id)])));
 if(view!=='ledger'||ledgerTab!=='voucher'||!$('#ledgerPage'))return;
 const types=ledgerTypes.filter(t=>t.base_type!=='opening'||ledgerYears.some(y=>y.starts_on===f.date));
 const vat=ledgerVatFor(f.lines,ledgerRates),role=ledgerVatRole(type);
 $('#ledgerPage').innerHTML=`<form id="ledgerVoucherForm" class="card ledger-voucher" novalidate>
  <datalist id="ledgerNames">${ledgerLedgers.filter(l=>l.active).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value="${esc(ledgerLedgerLabel(l))}"></option>`).join('')}</datalist>
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
 status.innerHTML=`<p>Debit <strong>${ledgerMoney(totals.debit)}</strong> · Credit <strong>${ledgerMoney(totals.credit)}</strong>${totals.difference?` · <strong class="overdue">Difference ${ledgerMoney(Math.abs(totals.difference))}</strong>`:' · Balanced'}</p>${problems.length?`<ul class="ledger-problems">${problems.slice(0,6).map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}`;
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
  p_number:type.numbering==='manual'?f.number.trim():null,p_source:{},p_supplier:type.base_type==='purchase'?{tin:f.supplier_tin.trim(),fiscal_code:f.supplier_code.trim()}:{}});
 if(me?.user_id!==actor)return;
 const saved=ledgerFail(r,'Not posted');
 for(const line of f.lines)ledgerBillsCache.delete(line.ledger_id);
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
  ${ledger?`<h2>${esc(ledger.name)}</h2>${more?'<p class="notice">Only the first 2,000 lines are shown. Choose shorter dates.</p>':''}<table class="ledger-statement"><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th class="number">Debit</th><th class="number">Credit</th><th class="number">Balance</th></tr></thead>
  <tbody><tr><td>${esc(from)}</td><td colspan="4"><strong>Opening balance</strong></td><td class="number">${ledgerBalanceText(opening)}</td></tr>${rows.map(r=>`<tr><td>${esc(r.voucher_date)}</td><td>${esc(ledgerTypeById(r.voucher_type_id)?.name||'')} ${esc(r.number)}</td><td>${esc(r.narration)}</td><td class="number">${r.amount_minor>0?ledgerMoney(r.amount_minor):''}</td><td class="number">${r.amount_minor<0?ledgerMoney(-r.amount_minor):''}</td><td class="number">${ledgerBalanceText(r.balance)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><th colspan="5">Closing balance</th><th class="number">${ledgerBalanceText(closing)}</th></tr></tfoot></table>`:'<p>Choose a ledger to see its statement.</p>'}`;
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
  <section class="card"><h2>Lock the books</h2><p>${ledgerLockedThrough?`Books are locked through <strong>${esc(ledgerLockedThrough)}</strong>. Nothing can be posted on or before that date.`:'No month is locked yet.'} Lock a month after its VAT return is filed.${ledgerIsOwner?'':' Only the owner can reopen a locked month.'}</p>
  <form id="ledgerLockForm" class="actions ledger-filter"><label><span>Lock through</span><input type="date" name="through" required></label><label><span>Reason</span><input name="reason" maxlength="500" minlength="5" placeholder="September VAT return filed" required></label><button type="submit">Lock books</button></form></section>
  <section class="card"><h2>Change log</h2><p class="muted">The latest 50 changes. Nothing here can be edited or deleted.</p><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${log.map(e=>`<tr><td>${esc(new Date(e.recorded_at).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam'}))}</td><td>${esc(typeof employeeName==='function'?employeeName(e.actor_user_id):'')}</td><td>${what(e)}</td></tr>`).join('')||'<tr><td colspan="3">No changes yet.</td></tr>'}</tbody></table></section>`;
 const yf=$('#ledgerYearForm');if(yf)yf.onsubmit=e=>{e.preventDefault();run(async()=>{ledgerYearId=ledgerYearId||crypto.randomUUID();const saved=ledgerFail(await client.rpc('save_fiscal_year',{p_id:ledgerYearId,p_name:yf.name.value.trim(),p_starts_on:yf.starts_on.value,p_ends_on:yf.ends_on.value}),'Year not opened');ledgerYearId='';ledgerYears=[saved,...ledgerYears.filter(y=>y.id!==saved.id)].sort((a,b)=>b.starts_on.localeCompare(a.starts_on));message(`${saved.name} opened.`);await ledgerSetup();});};
 const lf=$('#ledgerLockForm');lf.onsubmit=e=>{e.preventDefault();run(async()=>{const through=lf.through.value;if(ledgerLockedThrough&&through<ledgerLockedThrough&&!ledgerIsOwner)throw Error('Only the owner can reopen a locked month.');if(!confirm(`Lock the books through ${through}? Nothing can then be posted on or before that date.`))return;const saved=ledgerFail(await client.rpc('lock_ledger_period',{p_through_date:through,p_reason:lf.reason.value.trim()}),'Books not locked');ledgerLockedThrough=saved.through_date;message(`Books locked through ${saved.through_date}.`);await ledgerWorkspace();});};
}
