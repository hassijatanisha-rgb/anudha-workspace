import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function load(){const ctx=vm.createContext({Intl,Number,String,Math,Map,Set,Date});vm.runInContext(read('ledger-domain.js'),ctx);return ctx;}
const plain=value=>JSON.parse(JSON.stringify(value));

test('money is typed and shown in shillings and cents, never floating point',()=>{
 const c=load();
 assert.equal(c.ledgerParseMinor('1,180.50'),118050);assert.equal(c.ledgerParseMinor('1180'),118000);assert.equal(c.ledgerParseMinor('0.1'),10);
 for(const bad of ['','-5','1.234','abc','1e3',null])assert.equal(c.ledgerParseMinor(bad),null,String(bad));
 assert.equal(c.ledgerParseMinor('0.29'),29,'no 0.29*100 rounding error');
 assert.equal(c.ledgerMoney(118050),'1,180.50');assert.equal(c.ledgerMoney(-5),'-0.05');
 assert.equal(c.ledgerBalanceText(118000),'1,180.00 Dr');assert.equal(c.ledgerBalanceText(-500),'5.00 Cr');assert.equal(c.ledgerBalanceText(0),'0.00');
});
test('the default date is today in Tanzania, not in UTC',()=>{
 const c=load();
 assert.equal(c.ledgerToday(new Date('2026-07-31T22:30:00Z')),'2026-08-01');assert.equal(c.ledgerToday(new Date('2026-07-31T20:00:00Z')),'2026-07-31');
 assert.equal(c.ledgerMonthStart('2026-08-17'),'2026-08-01');
 const years=[{id:'a',starts_on:'2026-07-01',ends_on:'2027-06-30'}];
 assert.equal(c.ledgerYearFor('2026-07-01',years).id,'a');assert.equal(c.ledgerYearFor('2026-06-30',years),null);
});
test('totals, VAT per line and the problems shown before Save',()=>{
 const c=load(),ledgers=new Map([['cust',{id:'cust',name:'Test Hospital',bill_wise:true}],['sales',{id:'sales',name:'Sales'}],['vat',{id:'vat',name:'Output VAT'}]]);
 const type={base_type:'sales',numbering:'auto'};
 const form={date:'2026-07-10',lines:[
  {ledger_id:'cust',side:'dr',amount:'1,180.00',bills:[{kind:'new',name:'INV-1',amount:'1,180.00'}]},
  {ledger_id:'sales',side:'cr',amount:'1,000.00',vat_class:'standard'},
  {ledger_id:'vat',side:'cr',amount:'180.00'}]};
 assert.deepEqual(plain(c.ledgerTotals(form.lines)),{debit:118000,credit:118000,difference:0});
 assert.equal(c.ledgerVatFor(form.lines,{standard:1800}),-18000,'credit side, negative');
 assert.equal(c.ledgerVatFor([{side:'dr',amount:'0.03',vat_class:'standard'},{side:'dr',amount:'0.03',vat_class:'standard'}],{standard:1800}),2,'rounded per line: 0.54 → 1 cent each');
 assert.equal(c.ledgerVatFor([{side:'cr',amount:'10.00',vat_class:'exempt'}],{standard:1800,exempt:0}),0);
 assert.deepEqual(plain(c.ledgerVoucherProblems(form,ledgers,type)),[]);
 const wrong=structuredClone(form);wrong.lines[2].amount='170.00';wrong.lines[0].bills[0].amount='1,000.00';
 const problems=plain(c.ledgerVoucherProblems(wrong,ledgers,type));
 assert.ok(problems.some(p=>/bills add up to 1,000.00 but the line is 1,180.00/.test(p)));assert.ok(problems.some(p=>/differ by 10.00/.test(p)));
 assert.ok(plain(c.ledgerVoucherProblems({date:'',lines:[{ledger_id:'x',side:'dr',amount:'5'}]},ledgers,{numbering:'manual'})).join(' ').match(/date.*number.*two lines.*choose a ledger/i));
 const noBill=structuredClone(form);noBill.lines[0].bills=[];assert.ok(c.ledgerVoucherProblems(noBill,ledgers,type).some(p=>/keeps bills/.test(p)));
});
test('entries sent to the books carry signs on lines and bills',()=>{
 const c=load(),ledgers=new Map([['cust',{bill_wise:true}],['bank',{}]]);
 const entries=plain(c.ledgerVoucherEntries({lines:[{ledger_id:'bank',side:'dr',amount:'500.00'},{ledger_id:'cust',side:'cr',amount:'500.00',bills:[{kind:'against',name:' INV-1 ',amount:'400.00',due_date:'2026-09-01'},{kind:'on_account',name:'ignored',amount:'100.00'}]},{ledger_id:'',side:'dr',amount:''}]},ledgers));
 assert.deepEqual(entries,[{ledger_id:'bank',amount_minor:50000},{ledger_id:'cust',amount_minor:-50000,bills:[{kind:'against',amount_minor:-40000,name:'INV-1'},{kind:'on_account',amount_minor:-10000}]}]);
});
test('chart and Trial Balance roll ledgers up through their groups',()=>{
 const c=load();
 const groups=[{id:'ca',name:'Current Assets',parent_id:null,sort:80},{id:'sd',name:'Sundry Debtors',parent_id:'ca',sort:86},{id:'bk',name:'Bank Accounts',parent_id:'ca',sort:81},{id:'cap',name:'Capital Account',parent_id:null,sort:10},{id:'empty',name:'Investments',parent_id:null,sort:70}];
 const ledgers=[{id:'c1',name:'Zeta Clinic',group_id:'sd'},{id:'c2',name:'Alpha Hospital',group_id:'sd'},{id:'b1',name:'CRDB',group_id:'bk'},{id:'k1',name:'Owner',group_id:'cap'}];
 const bal=new Map([['c1',{opening:0,debit:100,credit:0,closing:100}],['b1',{opening:500,debit:0,credit:0,closing:500}],['k1',{opening:-500,debit:0,credit:100,closing:-600}]]);
 const rows=plain(c.ledgerTreeRows(c.ledgerTree(groups,ledgers,bal,false)));
 assert.deepEqual(rows.map(r=>r.kind==='group'?r.group.name:r.ledger.name),['Capital Account','Owner','Current Assets','Bank Accounts','CRDB','Sundry Debtors','Zeta Clinic'],'sorted, empty groups and ledgers dropped');
 assert.equal(rows.find(r=>r.group?.name==='Current Assets').closing,600);
 assert.deepEqual(plain(c.ledgerTrialTotals([...bal.values()])),{debit:600,credit:600,balanced:true});
 assert.equal(c.ledgerTreeRows(c.ledgerTree(groups,ledgers,bal,true)).length,9,'the chart keeps everything');
 const cyclic=[{id:'a',name:'A',parent_id:null},{id:'b',name:'B',parent_id:'c'},{id:'c',name:'C',parent_id:'b'}];
 assert.equal(c.ledgerTreeRows(c.ledgerTree(cyclic,[])).length,1,'a broken tree cannot loop');
});
test('statement running balance and open bills',()=>{
 const c=load();
 const s=plain(c.ledgerStatement(1000,[{voucher_date:'2026-07-12',amount_minor:-300,created_at:'b'},{voucher_date:'2026-07-10',amount_minor:500,created_at:'a'}]));
 assert.deepEqual(s.map(r=>r.balance),[1500,1200]);
 const bills=[{ledger_id:'x',name:'B2',due_date:'2026-09-01',balance_minor:5},{ledger_id:'x',name:'B1',due_date:'2026-08-01',balance_minor:5},{ledger_id:'x',name:'Paid',due_date:'2026-07-01',balance_minor:0},{ledger_id:'y',name:'Other',balance_minor:5}];
 assert.deepEqual(plain(c.ledgerOpenBills(bills,'x')).map(b=>b.name),['B1','B2']);
 assert.equal(c.ledgerNotInstalled({code:'42P01',message:'relation "public.vouchers" does not exist'}),true);
 assert.equal(c.ledgerNotInstalled({code:'PGRST202',message:'Could not find the function public.ledger_staff'}),true);
 assert.equal(c.ledgerNotInstalled({message:'Debits and credits differ by 1'}),false);
});
test('ageing buckets, receivables per party and credit limits',()=>{
 const c=load();
 assert.equal(c.ledgerAgeBucket('2026-10-06','2026-10-06'),'current');assert.equal(c.ledgerAgeBucket('2026-10-05','2026-10-06'),'d30');
 assert.equal(c.ledgerAgeBucket('2026-09-06','2026-10-06'),'d30');assert.equal(c.ledgerAgeBucket('2026-09-05','2026-10-06'),'d60');
 assert.equal(c.ledgerAgeBucket('2026-06-01','2026-10-06'),'older');assert.equal(c.ledgerAgeBucket(null,'2026-10-06'),'current');
 const ledgers=new Map([['a',{id:'a',name:'Alpha'}],['b',{id:'b',name:'Beta'}]]);
 const rows=plain(c.ledgerAgeing([{ledger_id:'a',name:'PF-1',due_date:'2026-06-01',balance_minor:500},{ledger_id:'a',name:'ADV',due_date:'2026-10-20',balance_minor:-100},{ledger_id:'b',name:'PF-2',due_date:'2026-10-01',balance_minor:900},{ledger_id:'b',name:'Paid',balance_minor:0},{ledger_id:'x',name:'Other',balance_minor:5}],ledgers,'2026-10-06',1));
 assert.deepEqual(rows.map(r=>[r.ledger.name,r.total,r.older,r.current,r.d30]),[['Alpha',400,500,-100,0],['Beta',900,0,0,900]],'most overdue first; an advance reduces the total');
 assert.equal(plain(c.ledgerAgeing([{ledger_id:'a',name:'S',due_date:'2026-10-01',balance_minor:-700}],ledgers,'2026-10-06',-1))[0].total,700,'payables shown positive');
 assert.equal(c.ledgerCreditWarning({name:'Alpha',credit_limit_minor:100000},90000,20000),'Alpha would owe 1,100.00, over the credit limit of 1,000.00.');
 assert.equal(c.ledgerCreditWarning({name:'Alpha',credit_limit_minor:100000},90000,10000),'');assert.equal(c.ledgerCreditWarning({name:'Alpha',credit_limit_minor:null},9e9,1),'');
 const groups=[{id:'ca',code:'current_assets',parent_id:null},{id:'sd',code:'sundry_debtors',parent_id:'ca'},{id:'h',code:null,parent_id:'sd'}];
 assert.equal(c.ledgerGroupUnder('h','sundry_debtors',groups),true);assert.equal(c.ledgerGroupUnder('ca','sundry_debtors',groups),false);
});
test('a purchase order pre-fills a balanced purchase bill with 18% input VAT',()=>{
 const c=load();
 const d=plain(c.ledgerPurchaseDraft({po_number:'PO-1',lpo_reference:'LPO-9'},[{quantity:2,unit_price_minor:50000},{quantity:1,unit_price_minor:25000}],{purchase_ledger_id:'p',input_vat_ledger_id:'v'},{id:'s',bill_wise:true},1800));
 assert.deepEqual(d.lines.map(l=>[l.ledger_id,l.side,l.amount]),[['p','dr','1,250.00'],['v','dr','225.00'],['s','cr','1,475.00']]);
 assert.equal(d.lines[2].bills[0].kind,'new');assert.equal(d.reference,'LPO-9');assert.equal(d.missingPrices,false);
 assert.deepEqual(plain(c.ledgerTotals(d.lines)),{debit:147500,credit:147500,difference:0});
 assert.equal(c.ledgerPurchaseDraft({po_number:'PO-2',lpo_reference:''},[{quantity:1,unit_price_minor:null}],{},null,1800).missingPrices,true);
});
test('bank statements are read from common CSV layouts',()=>{
 const c=load();
 assert.equal(c.ledgerParseDate('21/07/2026'),'2026-07-21');assert.equal(c.ledgerParseDate('2026-07-21'),'2026-07-21');assert.equal(c.ledgerParseDate('21-Jul-2026'),'2026-07-21');
 assert.equal(c.ledgerParseDate('21.07.26'),'2026-07-21');assert.equal(c.ledgerParseDate('07/21/2026','mdy'),'2026-07-21');assert.equal(c.ledgerParseDate('31/02/2026'),null);
 assert.equal(c.ledgerParseSignedMinor('1,234.50'),123450);assert.equal(c.ledgerParseSignedMinor('(1,234.50)'),-123450);assert.equal(c.ledgerParseSignedMinor('1,234.50 DR'),-123450);
 assert.equal(c.ledgerParseSignedMinor(''),0);assert.equal(c.ledgerParseSignedMinor('abc'),null);
 const split=plain(c.ledgerStatementFromCsv('CRDB Bank statement\nAccount,0150\nTransaction Date,Value Date,Details,Reference,Debit,Credit,Balance\n21/07/2026,21/07/2026,"Cheque deposit, Test Hospital",CHQ 0001,,"500,000.00","1,000,000.00"\n31/07/2026,31/07/2026,Bank charges,,"1,500.00",,"998,500.00"\nOpening balance,,,,,,\n'));
 assert.deepEqual(split.lines,[{line_date:'2026-07-21',amount_minor:50000000,description:'Cheque deposit, Test Hospital',bank_ref:'CHQ 0001'},{line_date:'2026-07-31',amount_minor:-150000,description:'Bank charges',bank_ref:''}]);
 assert.deepEqual(split.skipped,[6]);
 const signed=plain(c.ledgerStatementFromCsv('Date;Narration;Amount;Dr/Cr\n2026-07-21;Deposit;500.00;CR\n2026-07-22;Charges;15.00;DR\n'));
 assert.deepEqual(signed.lines.map(l=>l.amount_minor),[50000,-1500]);
 assert.throws(()=>c.ledgerStatementFromCsv('hello\nworld'),/No header row/);
});
test('auto-match pairs each statement line with one book entry by amount, reference and date',()=>{
 const c=load();
 const entries=[{entry_id:'e1',amount_minor:50000,voucher_date:'2026-07-20',reference:'CHQ 0001',number:'5'},{entry_id:'e2',amount_minor:50000,voucher_date:'2026-07-21',reference:'',number:'6'},
  {entry_id:'e3',amount_minor:-1500,voucher_date:'2026-07-01',reference:'',number:'7'},{entry_id:'e4',amount_minor:900,voucher_date:'2026-07-21',bank_date:'2026-07-21'}];
 const lines=[{id:'l1',line_date:'2026-07-21',amount_minor:50000,description:'Cheque deposit',bank_ref:'CHQ 0001'},{id:'l2',line_date:'2026-07-22',amount_minor:50000,description:'Cash',bank_ref:''},
  {id:'l3',line_date:'2026-07-31',amount_minor:-1500,description:'Charges',bank_ref:''},{id:'l4',line_date:'2026-07-21',amount_minor:900,description:'x',bank_ref:''}];
 assert.deepEqual(plain(c.ledgerAutoMatch(entries,lines)),[{entry_id:'e1',statement_line_id:'l1',bank_date:'2026-07-21'},{entry_id:'e2',statement_line_id:'l2',bank_date:'2026-07-22'}],'the reference wins over the nearer date; 30 days apart is too far; cleared entries are left alone');
 const brs=plain(c.ledgerBrs([{voucher_date:'2026-07-01',amount_minor:1000,bank_date:'2026-07-01'},{voucher_date:'2026-07-30',amount_minor:500},{voucher_date:'2026-07-30',amount_minor:-200,bank_date:'2026-08-02'},{voucher_date:'2026-08-05',amount_minor:7}],'2026-07-31'));
 assert.deepEqual(brs,{book:1300,deposits:500,payments:-200,bank:1000});
});
test('Profit & Loss and Balance Sheet follow the group natures',()=>{
 const c=load();
 const groups=[{id:'sales',name:'Sales Accounts',nature:'income',affects_gross_profit:true,parent_id:null,sort:100},{id:'purch',name:'Purchase Accounts',nature:'expense',affects_gross_profit:true,parent_id:null,sort:130},
  {id:'ind',name:'Indirect Expenses',nature:'expense',affects_gross_profit:false,parent_id:null,sort:150},{id:'oi',name:'Indirect Incomes',nature:'income',affects_gross_profit:false,parent_id:null,sort:120},
  {id:'cap',name:'Capital Account',nature:'liability',parent_id:null,sort:10},{id:'ca',name:'Current Assets',nature:'asset',parent_id:null,sort:80}];
 const ledgers=[{id:'s',name:'Sales',group_id:'sales'},{id:'p',name:'Purchases',group_id:'purch'},{id:'r',name:'Rent',group_id:'ind'},{id:'i',name:'Interest',group_id:'oi'},{id:'k',name:'Capital',group_id:'cap'},{id:'b',name:'Bank',group_id:'ca'}];
 const bal=new Map([['s',{opening:-100,debit:0,credit:1000,closing:-1100}],['p',{opening:0,debit:600,credit:0,closing:600}],['r',{opening:0,debit:150,credit:0,closing:150}],['i',{opening:0,debit:0,credit:50,closing:-50}],
  ['k',{opening:-500,debit:0,credit:0,closing:-500}],['b',{opening:600,debit:1050,credit:750,closing:900}]]);
 const pl=plain(c.ledgerProfitAndLoss(groups,ledgers,bal));
 assert.equal(pl.gross,400,'sales 1,000 in the period less purchases 600');assert.equal(pl.net,300,'less rent 150 plus interest 50');
 const bs=plain(c.ledgerBalanceSheet(groups,ledgers,bal));
 assert.equal(bs.profit,400,'all unclosed profit to date, including the 100 before the period');assert.equal(bs.totalAssets,900);assert.equal(bs.totalLiabilities,900);assert.equal(bs.balanced,true);
});
test('menu, router, sign-out, help and script order are wired; writes go only through the books functions',()=>{
 const app=read('app.js'),html=read('index.html'),src=read('ledger-workspace.js'),nav=read('workspace-navigation.js');
 assert.match(nav,/\['Books of account','ledger'\]/);assert.match(nav,/data-ledger-only hidden/);assert.match(nav,/rpc\('ledger_staff'\)/);
 assert.match(app,/view==='ledger'\)return ledgerWorkspace\(\)/);assert.match(app,/typeof clearLedger==='function'\)clearLedger\(\)/);
 assert.match(read('how-to-use.js'),/Correct a voucher that was posted wrongly/);
 const at=name=>html.indexOf(name);assert.ok(at('ledger-domain.js')>0&&at('ledger-domain.js')<at('ledger-workspace.js')&&at('ledger-workspace.js')<at('app.js'));
 assert.doesNotMatch(src,/\)\.(insert|update|upsert|delete)\(/);
 for(const fn of ['post_voucher','reverse_voucher','save_ledger','save_account_group','save_fiscal_year','lock_ledger_period','post_sales_invoice','save_ledger_settings','import_bank_statement','record_bank_dates','close_fiscal_year'])assert.match(src,new RegExp(`rpc\\('${fn}'`));
 const schema=read('replica/schema.sql');
 for(const fn of ['import_bank_statement','record_bank_dates','bank_book','close_fiscal_year','post_sales_invoice','save_ledger_settings','ledger_staff','ledger_locked_through','post_voucher','reverse_voucher','save_ledger','save_account_group','save_fiscal_year','lock_ledger_period','trial_balance'])assert.match(schema,new RegExp(`create function public\\.${fn}\\(`),fn);
 assert.doesNotMatch(src.replace(/\$\{[^}]*\}/g,''),/<[^>]*\son\w+=/i,'no inline handlers (CSP)');
});
