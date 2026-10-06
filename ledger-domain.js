'use strict';
// Books of account: pure rules shared by the ledger screens and their tests. Amounts are signed integer TZS cents,
// debit positive and credit negative, exactly as the database stores them. The database repeats every check here;
// these only let the screen explain a problem before Save.

// "1,180.50" → 118050. Blank, negative, more than two decimals or anything else → null.
function ledgerParseMinor(text){
 const value=String(text??'').trim().replace(/,/g,'');
 if(!/^\d+(\.\d{1,2})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(minor)?minor:null;
}
function ledgerMoney(minor){
 const value=Number(minor||0),sign=value<0?'-':'',abs=Math.abs(value);
 return `${sign}${Math.floor(abs/100).toLocaleString('en-US')}.${String(abs%100).padStart(2,'0')}`;
}
// Dr / Cr display of a signed balance: 118000 → "1,180.00 Dr", -500 → "5.00 Cr", 0 → "0.00".
function ledgerBalanceText(minor){const value=Number(minor||0);return value===0?'0.00':`${ledgerMoney(Math.abs(value))} ${value>0?'Dr':'Cr'}`;}
// Today's date in Tanzania (UTC+3), as the default voucher date. Never the UTC date.
function ledgerToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function ledgerMonthStart(date){return `${String(date).slice(0,7)}-01`;}
function ledgerYearFor(date,years){return years.find(y=>date>=y.starts_on&&date<=y.ends_on)||null;}

// Voucher form lines: {ledger_id, side:'dr'|'cr', amount:'1,000.00', vat_class?, bills?:[{kind,name,due_date?,amount}]}.
function ledgerLineMinor(line){const minor=ledgerParseMinor(line.amount);return minor==null?null:(line.side==='cr'?-minor:minor);}
function ledgerTotals(lines){
 let debit=0,credit=0;
 for(const line of lines){const signed=ledgerLineMinor(line);if(signed==null)continue;if(signed>0)debit+=signed;else credit-=signed;}
 return {debit,credit,difference:debit-credit};
}
// Same rounding as the database and the Pro forma: per taxable line, half away from zero.
function ledgerVatFor(lines,rates){
 let vat=0;
 for(const line of lines){
  if(!line.vat_class)continue;
  const signed=ledgerLineMinor(line),rate=rates[line.vat_class];
  if(signed==null||rate==null)continue;
  vat+=Math.sign(signed)*Math.round(Math.abs(signed)*rate/10000);
 }
 return vat;
}
// Problems in plain words, in the order a person would fix them. An empty list means the voucher can be saved.
function ledgerVoucherProblems(form,ledgersById,type){
 const problems=[],lines=form.lines.filter(l=>l.ledger_id||String(l.amount||'').trim());
 if(!type)problems.push('Choose the voucher type.');
 if(!form.date)problems.push('Enter the voucher date.');
 if(type?.numbering==='manual'&&!String(form.number||'').trim())problems.push('Enter the voucher number.');
 if(lines.length<2)problems.push('A voucher needs at least two lines.');
 lines.forEach((line,i)=>{
  const ledger=ledgersById.get(line.ledger_id),n=i+1;
  if(!ledger)problems.push(`Line ${n}: choose a ledger from the list.`);
  if(ledgerParseMinor(line.amount)==null||ledgerParseMinor(line.amount)===0)problems.push(`Line ${n}: enter an amount above zero, for example 1,180.00.`);
  if(ledger?.bill_wise){
   const bills=line.bills||[],total=bills.reduce((s,b)=>s+(ledgerParseMinor(b.amount)||0),0);
   if(!bills.length)problems.push(`Line ${n}: ${ledger.name} keeps bills; add the bill this amount belongs to.`);
   bills.forEach((b,j)=>{if(b.kind!=='on_account'&&!String(b.name||'').trim())problems.push(`Line ${n}, bill ${j+1}: enter the bill number.`);});
   if(bills.length&&total!==ledgerParseMinor(line.amount))problems.push(`Line ${n}: the bills add up to ${ledgerMoney(total)} but the line is ${ledgerMoney(ledgerParseMinor(line.amount)||0)}.`);
  }
 });
 const totals=ledgerTotals(lines);
 if(totals.difference!==0)problems.push(`Debit ${ledgerMoney(totals.debit)} and credit ${ledgerMoney(totals.credit)} differ by ${ledgerMoney(Math.abs(totals.difference))}.`);
 return problems;
}
// What post_voucher receives. Bills carry the line's sign.
function ledgerVoucherEntries(form,ledgersById){
 return form.lines.filter(l=>l.ledger_id&&ledgerParseMinor(l.amount)).map(line=>{
  const signed=ledgerLineMinor(line),sign=Math.sign(signed),ledger=ledgersById.get(line.ledger_id),entry={ledger_id:line.ledger_id,amount_minor:signed};
  if(line.vat_class)entry.vat_class=line.vat_class;
  if(ledger?.bill_wise)entry.bills=(line.bills||[]).map(b=>{
   const bill={kind:b.kind,amount_minor:sign*ledgerParseMinor(b.amount)};
   if(b.kind!=='on_account')bill.name=String(b.name||'').trim();
   if(b.due_date&&(b.kind==='new'||b.kind==='advance'))bill.due_date=b.due_date;
   return bill;
  });
  return entry;
 });
}

// Chart of accounts and Trial Balance: groups in their tree, each with its ledgers, and totals rolled up.
// balances: Map ledger_id → {opening, debit, credit, closing}. Groups and ledgers with nothing to show are kept only
// when keepEmpty is true (the chart), so the Trial Balance stays short.
function ledgerTree(groups,ledgers,balances=new Map(),keepEmpty=true){
 const byParent=new Map(),ledgersByGroup=new Map(),zero={opening:0,debit:0,credit:0,closing:0};
 for(const g of groups){const k=g.parent_id||'';if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(g);}
 for(const l of ledgers){if(!ledgersByGroup.has(l.group_id))ledgersByGroup.set(l.group_id,[]);ledgersByGroup.get(l.group_id).push(l);}
 const sortGroups=list=>[...list].sort((a,b)=>(a.sort??1000)-(b.sort??1000)||a.name.localeCompare(b.name));
 const visit=(group,depth,seen)=>{
  if(seen.has(group.id))return null;seen=new Set(seen).add(group.id);
  const children=sortGroups(byParent.get(group.id)||[]).map(g=>visit(g,depth+1,seen)).filter(Boolean);
  const own=[...(ledgersByGroup.get(group.id)||[])].sort((a,b)=>a.name.localeCompare(b.name))
   .map(l=>({ledger:l,depth:depth+1,...(balances.get(l.id)||zero)}))
   .filter(r=>keepEmpty||r.opening||r.debit||r.credit||r.closing);
  const total={...zero};
  for(const part of [...children,...own])for(const k of Object.keys(zero))total[k]+=part[k];
  if(!keepEmpty&&!children.length&&!own.length)return null;
  return {group,depth,children,ledgers:own,...total};
 };
 return sortGroups(byParent.get('')||[]).map(g=>visit(g,0,new Set())).filter(Boolean);
}
// Flattens the tree for display: a group row, then its sub-groups, then its ledgers.
function ledgerTreeRows(tree){
 const rows=[];
 const walk=node=>{rows.push({kind:'group',...node});node.children.forEach(walk);node.ledgers.forEach(l=>rows.push({kind:'ledger',...l}));};
 tree.forEach(walk);return rows;
}
function ledgerTrialTotals(rows){
 let debit=0,credit=0;
 for(const r of rows){if(r.closing>0)debit+=r.closing;else credit-=r.closing;}
 return {debit,credit,balanced:debit===credit};
}
// A ledger statement: rows in date order with the running balance after each.
function ledgerStatement(opening,rows){
 let balance=Number(opening||0);
 return [...rows].sort((a,b)=>String(a.voucher_date).localeCompare(String(b.voucher_date))||String(a.created_at||'').localeCompare(String(b.created_at||'')))
  .map(r=>{balance+=Number(r.amount_minor);return {...r,balance};});
}
// Open bills of one ledger for the "against" picker: name, due date and amount still open, oldest due first.
function ledgerOpenBills(bills,ledgerId){
 return bills.filter(b=>b.ledger_id===ledgerId&&Number(b.balance_minor)!==0)
  .sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||''))||a.name.localeCompare(b.name));
}
// The database explains every refusal in words; this only recognises "the books are not installed yet".
function ledgerNotInstalled(error){return /does not exist|Could not find the (table|function)|schema cache|42P01|PGRST20[2-5]/i.test(`${error?.code||''} ${error?.message||''}`);}

// True when the group, or any group above it, has this standard code (for example 'sundry_debtors').
function ledgerGroupUnder(groupId,code,groups){
 const byId=new Map(groups.map(g=>[g.id,g])),seen=new Set();
 for(let g=byId.get(groupId);g&&!seen.has(g.id);g=byId.get(g.parent_id)){if(g.code===code)return true;seen.add(g.id);}
 return false;
}
const ledgerAgeBuckets=[['current','Not yet due'],['d30','1-30 days'],['d60','31-60 days'],['d90','61-90 days'],['older','Over 90 days']];
function ledgerAgeBucket(dueDate,asOf){
 if(!dueDate)return 'current';
 const days=Math.floor((Date.parse(asOf+'T00:00:00Z')-Date.parse(dueDate+'T00:00:00Z'))/86400000);
 return days<=0?'current':days<=30?'d30':days<=60?'d60':days<=90?'d90':'older';
}
// Open bills grouped per party with overdue buckets. sign 1 = receivables (debit balances), -1 = payables (credit).
// A bill on the other side (an advance) reduces the party's total in its own bucket.
function ledgerAgeing(bills,ledgers,asOf,sign){
 const parties=new Map();
 for(const b of bills){
  const ledger=ledgers.get(b.ledger_id);if(!ledger||Number(b.balance_minor)===0)continue;
  if(!parties.has(ledger.id))parties.set(ledger.id,{ledger,bills:[],total:0,current:0,d30:0,d60:0,d90:0,older:0});
  const p=parties.get(ledger.id),amount=sign*Number(b.balance_minor),bucket=ledgerAgeBucket(b.due_date,asOf);
  p.bills.push({...b,amount,bucket});p[bucket]+=amount;p.total+=amount;
 }
 for(const p of parties.values())p.bills.sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||''))||a.name.localeCompare(b.name));
 return [...parties.values()].sort((a,b)=>b.older-a.older||b.total-a.total||a.ledger.name.localeCompare(b.ledger.name));
}
// Over the limit after this amount? Returns the words to show, or ''.
function ledgerCreditWarning(ledger,balanceMinor,addMinor){
 if(ledger?.credit_limit_minor==null)return '';
 const after=Number(balanceMinor||0)+Number(addMinor||0);
 return after>Number(ledger.credit_limit_minor)?`${ledger.name} would owe ${ledgerMoney(after)}, over the credit limit of ${ledgerMoney(ledger.credit_limit_minor)}.`:'';
}
// Pre-fills a purchase bill from a purchase order: purchases Dr at the order prices with standard VAT, input VAT Dr,
// the supplier Cr against a new bill. The accountant checks every amount against the supplier's own bill.
function ledgerPurchaseDraft(order,lines,settings,supplierLedger,rateBp){
 const net=lines.reduce((s,l)=>s+Number(l.quantity)*Number(l.unit_price_minor||0),0),vat=Math.round(net*rateBp/10000),total=net+vat;
 const out=[{ledger_id:settings.purchase_ledger_id||'',side:'dr',amount:net?ledgerMoney(net):'',vat_class:'standard',bills:[]}];
 if(settings.input_vat_ledger_id)out.push({ledger_id:settings.input_vat_ledger_id,side:'dr',amount:vat?ledgerMoney(vat):'',vat_class:'',bills:[]});
 out.push({ledger_id:supplierLedger?.id||'',side:'cr',amount:total?ledgerMoney(total):'',vat_class:'',bills:supplierLedger?.bill_wise?[{kind:'new',name:'',due_date:'',amount:total?ledgerMoney(total):''}]:[]});
 return {lines:out,reference:order.lpo_reference||order.po_number,narration:`Purchase order ${order.po_number}`,missingPrices:lines.some(l=>l.unit_price_minor==null)};
}

// Bank statements -------------------------------------------------------------------------------------------------------
// CSV rows, with quoted fields, CRLF and either comma or semicolon separators.
function ledgerCsvRows(text){
 const src=String(text||'').replace(/^﻿/,''),first=src.split(/\r?\n/).find(l=>l.trim())||'';
 const sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',',rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<src.length;i++){
  const ch=src[i];
  if(quoted){if(ch==='"'&&src[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
  else if(ch==='"')quoted=true;else if(ch===sep){row.push(cell);cell='';}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&src[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row.map(c=>c.trim()));row=[];cell='';}
  else cell+=ch;
 }
 row.push(cell);if(row.some(c=>c.trim()))rows.push(row.map(c=>c.trim()));
 return rows;
}
const ledgerMonths={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
// "21/07/2026", "2026-07-21", "21-Jul-2026", "21.07.26" → "2026-07-21". order 'dmy' (Tanzanian banks) or 'mdy'.
function ledgerParseDate(text,order='dmy'){
 const t=String(text||'').trim().split(/[ T]/)[0];let m;
 if((m=t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)))return ledgerIsoDate(+m[1],+m[2],+m[3]);
 if((m=t.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{2,4})$/)))return ledgerIsoDate(ledgerYear(m[3]),ledgerMonths[m[2].toLowerCase()],+m[1]);
 if((m=t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)))return order==='mdy'?ledgerIsoDate(ledgerYear(m[3]),+m[1],+m[2]):ledgerIsoDate(ledgerYear(m[3]),+m[2],+m[1]);
 return null;
}
function ledgerYear(y){return y.length===2?2000+Number(y):Number(y);}
function ledgerIsoDate(y,m,d){
 if(!y||!m||!d)return null;const date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
// "1,234.50", "(1,234.50)", "-1234.5", "1,234.50 DR", "TZS 1,234.50" → signed cents. Blank → 0.
function ledgerParseSignedMinor(text){
 let t=String(text||'').trim();if(!t)return 0;
 let sign=1;if(/^\(.*\)$/.test(t)){sign=-1;t=t.slice(1,-1);}if(/\bDR\b|-$/i.test(t))sign=-1;
 t=t.replace(/\b(CR|DR|TZS|TSH|USD)\b/gi,'').replace(/[\s,]/g,'');if(t.startsWith('-')){sign=-sign;t=t.slice(1);}t=t.replace(/-$/,'');
 if(!/^\d+(\.\d{1,2})?$/.test(t))return null;
 return sign*ledgerParseMinor(t);
}
// Reads a bank's CSV export. Finds the header row and the date, description, reference and amount columns by name.
// Withdrawals become negative and deposits positive, like the bank ledger (money in the bank is a debit).
function ledgerStatementFromCsv(text){
 const rows=ledgerCsvRows(text);
 const at=rows.findIndex(r=>r.some(c=>/date/i.test(c))&&r.some(c=>/amount|debit|credit|withdraw|deposit|paid/i.test(c)));
 if(at<0)throw Error('No header row with a date and an amount column was found. Export the statement as CSV from the bank.');
 const header=rows[at].map(h=>h.toLowerCase());
 const kind=header.findIndex(h=>/^(dr\/cr|cr\/dr|d\/c|c\/d|debit\/credit|credit\/debit|type|dr ?cr)$/.test(h));
 const pick=(...lists)=>{for(const words of lists){const i=header.findIndex((h,j)=>j!==kind&&words.some(w=>h===w||h.includes(w)));if(i>=0)return i;}return -1;};
 const col={kind,date:pick(['transaction date','posting date','trans date','txn date'],['date']),text:pick(['description','narration','details','particulars','remarks','memo']),
  ref:pick(['reference','ref','cheque','chq','document']),debit:pick(['debit','withdrawal','paid out','money out']),credit:pick(['credit','deposit','paid in','money in']),amount:pick(['amount'])};
 if(col.date<0||(col.amount<0&&(col.debit<0||col.credit<0)))throw Error('The date or amount columns could not be found in the statement.');
 const body=rows.slice(at+1),raw=body.map(r=>r[col.date]||'');
 const order=raw.some(d=>{const m=d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);return m&&+m[2]>12;})?'mdy':'dmy';
 const lines=[],skipped=[];
 body.forEach((r,i)=>{
  const date=ledgerParseDate(r[col.date],order);
  let amount;
  if(col.debit>=0&&col.credit>=0){const c=ledgerParseSignedMinor(r[col.credit]),d=ledgerParseSignedMinor(r[col.debit]);amount=c==null||d==null?null:Math.abs(c)-Math.abs(d);}
  else{amount=ledgerParseSignedMinor(r[col.amount]);if(amount!=null&&col.kind>=0&&/^\s*d/i.test(r[col.kind]||''))amount=-Math.abs(amount);else if(amount!=null&&col.kind>=0&&/^\s*c/i.test(r[col.kind]||''))amount=Math.abs(amount);}
  if(!date||amount==null||amount===0){skipped.push(at+i+2);return;}
  lines.push({line_date:date,amount_minor:amount,description:(col.text>=0?r[col.text]:'').slice(0,500),bank_ref:(col.ref>=0&&col.ref!==col.text?r[col.ref]:'').slice(0,120)});
 });
 return {lines,skipped,order};
}
// Proposes one statement line per book entry: same amount, within `days` of the voucher date, a matching cheque or
// reference number first, then the nearest date. Nothing is saved until the accountant confirms.
function ledgerAutoMatch(entries,lines,days=7){
 const open=entries.filter(e=>!e.bank_date),used=new Set(),matches=[],dayOf=d=>Date.parse(d+'T00:00:00Z')/86400000;
 const refHit=(e,l)=>{const words=[e.reference,e.number].filter(x=>String(x||'').trim().length>=3).map(x=>String(x).toLowerCase());const text=`${l.description} ${l.bank_ref}`.toLowerCase();return words.some(w=>text.includes(w));};
 for(const line of [...lines].sort((a,b)=>a.line_date.localeCompare(b.line_date))){
  const candidates=open.filter(e=>!used.has(e.entry_id)&&Number(e.amount_minor)===Number(line.amount_minor)&&Math.abs(dayOf(line.line_date)-dayOf(e.voucher_date))<=days)
   .sort((a,b)=>Number(refHit(b,line))-Number(refHit(a,line))||Math.abs(dayOf(line.line_date)-dayOf(a.voucher_date))-Math.abs(dayOf(line.line_date)-dayOf(b.voucher_date)));
  if(candidates[0]){used.add(candidates[0].entry_id);matches.push({entry_id:candidates[0].entry_id,statement_line_id:line.id,bank_date:line.line_date});}
 }
 return matches;
}
// Bank reconciliation statement on a date: balance in the books, entries the bank has not yet cleared, and the
// balance the bank should show.
function ledgerBrs(entries,asOf){
 let book=0,deposits=0,payments=0;
 for(const e of entries){if(e.voucher_date>asOf)continue;const a=Number(e.amount_minor);book+=a;if(!e.bank_date||e.bank_date>asOf){if(a>0)deposits+=a;else payments+=a;}}
 return {book,deposits,payments,bank:book-deposits-payments};
}

// Financial statements ---------------------------------------------------------------------------------------------------
// Profit & Loss for a period from Trial Balance rows: movement = closing - opening. Income is shown positive.
function ledgerProfitAndLoss(groups,ledgers,balances){
 const tree=ledgerTree(groups,ledgers,balances,false),part=(nature,direct)=>tree.filter(n=>n.group.nature===nature&&!!n.group.affects_gross_profit===direct)
  .map(n=>({node:n,amount:(nature==='income'?-1:1)*(n.closing-n.opening)})).filter(p=>p.amount!==0);
 const sum=list=>list.reduce((s,p)=>s+p.amount,0);
 const s={directIncome:part('income',true),directExpense:part('expense',true),indirectIncome:part('income',false),indirectExpense:part('expense',false)};
 const gross=sum(s.directIncome)-sum(s.directExpense);
 return {...s,gross,net:gross+sum(s.indirectIncome)-sum(s.indirectExpense)};
}
// Balance Sheet on a date. The profit not yet closed to reserves is shown on the liabilities side.
function ledgerBalanceSheet(groups,ledgers,balances){
 const tree=ledgerTree(groups,ledgers,balances,false);
 const liabilities=tree.filter(n=>n.group.nature==='liability').map(n=>({node:n,amount:-n.closing})).filter(p=>p.amount!==0);
 const assets=tree.filter(n=>n.group.nature==='asset').map(n=>({node:n,amount:n.closing})).filter(p=>p.amount!==0);
 const profit=-tree.filter(n=>n.group.nature==='income'||n.group.nature==='expense').reduce((s,n)=>s+n.closing,0);
 const totalLiabilities=liabilities.reduce((s,p)=>s+p.amount,0)+profit,totalAssets=assets.reduce((s,p)=>s+p.amount,0);
 return {liabilities,assets,profit,totalLiabilities,totalAssets,balanced:totalLiabilities===totalAssets};
}
