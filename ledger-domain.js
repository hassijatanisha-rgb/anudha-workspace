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
