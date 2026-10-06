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
test('menu, router, sign-out, help and script order are wired; writes go only through the books functions',()=>{
 const app=read('app.js'),html=read('index.html'),src=read('ledger-workspace.js'),nav=read('workspace-navigation.js');
 assert.match(nav,/\['Books of account','ledger'\]/);assert.match(nav,/data-ledger-only hidden/);assert.match(nav,/rpc\('ledger_staff'\)/);
 assert.match(app,/view==='ledger'\)return ledgerWorkspace\(\)/);assert.match(app,/typeof clearLedger==='function'\)clearLedger\(\)/);
 assert.match(read('how-to-use.js'),/Correct a voucher that was posted wrongly/);
 const at=name=>html.indexOf(name);assert.ok(at('ledger-domain.js')>0&&at('ledger-domain.js')<at('ledger-workspace.js')&&at('ledger-workspace.js')<at('app.js'));
 assert.doesNotMatch(src,/\)\.(insert|update|upsert|delete)\(/);
 for(const fn of ['post_voucher','reverse_voucher','save_ledger','save_account_group','save_fiscal_year','lock_ledger_period'])assert.match(src,new RegExp(`rpc\\('${fn}'`));
 const schema=read('replica/schema.sql');
 for(const fn of ['ledger_staff','ledger_locked_through','post_voucher','reverse_voucher','save_ledger','save_account_group','save_fiscal_year','lock_ledger_period','trial_balance'])assert.match(schema,new RegExp(`create function public\\.${fn}\\(`),fn);
 assert.doesNotMatch(src.replace(/\$\{[^}]*\}/g,''),/<[^>]*\son\w+=/i,'no inline handlers (CSP)');
});
