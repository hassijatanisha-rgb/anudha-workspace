// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
// Checks replica/schema.sql (general ledger, milestone M1 of replica/architecture.md).
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),accounts=id(2),sales=id(3),org=id(10),sup=id(11);
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean);
create table public.accounting_members(user_id uuid primary key);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create function public.accounting_access() returns boolean language sql stable security definer set search_path=public as $$select public.inventory_active_staff() and exists(select 1 from public.accounting_members where user_id=auth.uid())$$;
create table public.organizations(id uuid primary key);create table public.suppliers(id uuid primary key);
create table public.sales_proformas(id uuid primary key,document_number text,organization_id uuid,status text,currency text,total_minor bigint,acceptance_reference text,deleted_at timestamptz);
create table public.sales_proforma_lines(id uuid primary key default gen_random_uuid(),proforma_id uuid,sort_order int,quantity int,unit_price_minor bigint,discount_basis_points int,tax_basis_points int);
insert into auth.users values('${owner}'),('${accounts}'),('${sales}');
insert into public.staff values('${owner}','owner',true),('${accounts}','staff',true),('${sales}','staff',true);insert into public.accounting_members values('${accounts}');
insert into public.organizations values('${org}');insert into public.suppliers values('${sup}');
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
await db.exec(readFileSync(new URL('../replica/schema.sql',import.meta.url),'utf8'));
let checks=0;const ok=async(p,re)=>{if(re)await assert.rejects(p,re);else await p;checks++;};
const as=a=>db.exec(`select set_config('test.actor','${a||''}',false)`);
const one=(sql,args=[])=>db.query(sql,args).then(r=>r.rows[0]);
const T={opening:'c0000000-0000-4000-8000-000000000001',sales:'c0000000-0000-4000-8000-000000000002',purchase:'c0000000-0000-4000-8000-000000000003',receipt:'c0000000-0000-4000-8000-000000000005'};
const G={capital:'a0000000-0000-4000-8000-000000000001',bank:'a0000000-0000-4000-8000-000000000023',debtors:'a0000000-0000-4000-8000-000000000028',creditors:'a0000000-0000-4000-8000-000000000022',sales:'a0000000-0000-4000-8000-000000000010',purchase:'a0000000-0000-4000-8000-000000000013',duties:'a0000000-0000-4000-8000-000000000020',currentAssets:'a0000000-0000-4000-8000-000000000008',indirectExp:'a0000000-0000-4000-8000-000000000015'};
const L={capital:id(100),bank:id(101),cust:id(102),sales:id(103),outVat:id(104),inVat:id(105),supplier:id(106),purchase:id(107)};
const post=(vid,type,date,entries,extra={})=>one('select * from public.post_voucher($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb)',
 [vid,type,date,JSON.stringify(entries),extra.narration||'',extra.reference||'',extra.number||null,JSON.stringify(extra.source||{}),JSON.stringify(extra.supplier||{})]);
const reverse=(vid,orig,date,reason='Customer cancelled')=>one('select * from public.reverse_voucher($1,$2,$3,$4)',[vid,orig,date,reason]);
const ledger=(lid,body,v=0)=>one('select * from public.save_ledger($1,$2,$3::jsonb)',[lid,v,JSON.stringify(body)]);
const bill=name=>one('select balance_minor::int b, due_date::text d from public.ledger_bill_balances where name=$1',[name]);

// Seeds: 28 groups (15 primary, 13 sub), children inherit nature, VAT 18%.
const g=await one(`select count(*)::int n, count(*) filter (where parent_id is null)::int p from account_groups`);
await ok(Promise.resolve(assert.deepEqual(g,{n:28,p:15})));
await ok(one(`select nature from account_groups where code='sundry_debtors'`).then(r=>assert.equal(r.nature,'asset')));
await ok(one(`select public.vat_rate_on('standard','2026-10-06') r`).then(r=>assert.equal(r.r,1800)));

// Access: sales staff cannot post or create ledgers.
await as(sales);
await ok(ledger(L.bank,{name:'CRDB Main',group_id:G.bank}),/Accounting access/);
// Only the owner opens a year; years cannot overlap.
await as(accounts);
await ok(one(`select * from save_fiscal_year($1,'FY 2026-27','2026-07-01','2027-06-30')`,[id(50)]),/Only the owner/);
await as(owner);
await ok(one(`select * from save_fiscal_year($1,'FY 2026-27','2026-07-01','2027-06-30')`,[id(50)]));
await ok(one(`select * from save_fiscal_year($1,'FY overlap','2027-01-01','2027-12-31')`,[id(51)]),/overlaps/);

// Masters.
await as(accounts);
await ok(ledger(L.capital,{name:'Owner capital',group_id:G.capital}));
await ok(ledger(L.bank,{name:'CRDB Main',group_id:G.bank}));
await ok(ledger(L.cust,{name:'Test Hospital',group_id:G.debtors,bill_wise:true,credit_days:30,organization_id:org}));
await ok(ledger(L.sales,{name:'Sales - goods',group_id:G.sales,vat_class:'standard'}));
await ok(ledger(L.outVat,{name:'Output VAT',group_id:G.duties,vat_role:'output'}));
await ok(ledger(L.inVat,{name:'Input VAT',group_id:G.duties,vat_role:'input'}));
await ok(ledger(L.supplier,{name:'Test Supplier',group_id:G.creditors,bill_wise:true,supplier_id:sup}));
await ok(ledger(L.purchase,{name:'Purchases - goods',group_id:G.purchase,vat_class:'standard'}));
await ok(ledger(id(108),{name:'Misplaced VAT',group_id:G.indirectExp,vat_role:'output'}),/Duties & Taxes/);
await ok(ledger(id(109),{name:'Second ledger for org',group_id:G.debtors,organization_id:org}),/already has this name, customer or supplier/);
await ok(ledger(L.bank,{name:'CRDB Main renamed',group_id:G.bank},2),/changed; refresh/);
await ok(ledger(L.bank,{name:'CRDB Main',group_id:G.bank},1));
// Groups: child inherits nature; no cycles; standard groups do not move.
await ok(one(`select * from save_account_group($1,0,'Hospitals',$2)`,[id(60),G.debtors]).then(r=>assert.equal(r.nature,'asset')));
await ok(one(`select * from save_account_group($1,1,'Hospitals',$1)`,[id(60)]),/under itself|cannot sit/);
await ok(one(`select * from save_account_group($1,1,'Debtors',$2)`,[G.debtors,G.capital]),/renamed but not moved/);

// Opening balances only on the first day of the year.
await ok(post(id(200),T.opening,'2026-07-02',[{ledger_id:L.bank,amount_minor:500000},{ledger_id:L.capital,amount_minor:-500000}]),/first day/);
await ok(post(id(200),T.opening,'2026-07-01',[{ledger_id:L.bank,amount_minor:500000},{ledger_id:L.capital,amount_minor:-500000}]));

// Sales invoice with 18% VAT and a bill due after the customer's 30 credit days.
const sale=[{ledger_id:L.cust,amount_minor:118000,bills:[{kind:'new',name:'INV-1',amount_minor:118000}]},{ledger_id:L.sales,amount_minor:-100000,vat_class:'standard'},{ledger_id:L.outVat,amount_minor:-18000}];
await ok(post(id(201),T.sales,'2026-07-10',[{ledger_id:L.cust,amount_minor:117000,bills:[{kind:'new',name:'INV-X',amount_minor:117000}]},{ledger_id:L.sales,amount_minor:-100000,vat_class:'standard'},{ledger_id:L.outVat,amount_minor:-17000}]),/VAT should be -18000/);
await ok(post(id(201),T.sales,'2026-07-10',[{ledger_id:L.cust,amount_minor:118000,bills:[{kind:'new',name:'INV-X',amount_minor:118000}]},{ledger_id:L.sales,amount_minor:-100000,vat_class:'standard'},{ledger_id:L.outVat,amount_minor:-17000}]),/VAT should be|Debits and credits/);
await ok(post(id(201),T.sales,'2026-07-10',[{ledger_id:L.cust,amount_minor:118000},{ledger_id:L.sales,amount_minor:-100000,vat_class:'standard'},{ledger_id:L.outVat,amount_minor:-18000}]),/allocate the amount to bills/);
const s1=await post(id(201),T.sales,'2026-07-10',sale,{source:{kind:'proforma',id:id(300)}});checks++;
assert.equal(s1.number,'1','failed posts never burn a voucher number');
await ok(bill('INV-1').then(r=>assert.deepEqual(r,{b:118000,d:'2026-08-09'})));
// Idempotent resend; same id with other details refused; same Pro forma cannot be invoiced twice.
await ok(post(id(201),T.sales,'2026-07-10',sale,{source:{kind:'proforma',id:id(300)}}).then(r=>assert.equal(r.number,'1')));
await ok(post(id(201),T.sales,'2026-07-11',sale),/already saved with different details/);
await ok(post(id(202),T.sales,'2026-07-10',sale.map(e=>e.bills?{...e,bills:[{kind:'new',name:'INV-2',amount_minor:118000}]}:e),{source:{kind:'proforma',id:id(300)}}),/already has a posted voucher/);
// Unbalanced is rejected at commit.
await ok(post(id(203),T.receipt,'2026-07-12',[{ledger_id:L.bank,amount_minor:100},{ledger_id:L.capital,amount_minor:-99}]),/Debits and credits differ/);

// Part payment, then an over-payment against the same bill is refused.
await ok(post(id(204),T.receipt,'2026-07-20',[{ledger_id:L.bank,amount_minor:50000},{ledger_id:L.cust,amount_minor:-50000,bills:[{kind:'against',name:'INV-1',amount_minor:-50000}]}]));
await ok(bill('INV-1').then(r=>assert.equal(r.b,68000)));
await ok(post(id(205),T.receipt,'2026-07-21',[{ledger_id:L.bank,amount_minor:80000},{ledger_id:L.cust,amount_minor:-80000,bills:[{kind:'against',name:'INV-1',amount_minor:-80000}]}]),/over-settled/);
// Overpayment goes on account instead.
await ok(post(id(205),T.receipt,'2026-07-21',[{ledger_id:L.bank,amount_minor:80000},{ledger_id:L.cust,amount_minor:-80000,bills:[{kind:'against',name:'INV-1',amount_minor:-68000},{kind:'on_account',amount_minor:-12000}]}]));
await ok(bill('INV-1').then(r=>assert.equal(r.b,0)));

// Reversal: a paid invoice cannot be reversed until its receipts are; reversals cannot be reversed.
await ok(reverse(id(206),id(201),'2026-07-25'),/over-settled/);
await ok(reverse(id(206),id(205),'2026-07-25','Cheque bounced'));
await ok(reverse(id(207),id(204),'2026-07-25','Wrong customer'));
await ok(reverse(id(208),id(206),'2026-07-26','Undo the reversal'),/cannot itself be reversed/);
await ok(reverse(id(209),id(201),'2026-07-26'));
await ok(reverse(id(210),id(201),'2026-07-27'),/already reversed/);
await ok(bill('INV-1').then(r=>assert.equal(r.b,0)));
// Once reversed, the Pro forma can be invoiced again.
await ok(post(id(211),T.sales,'2026-07-27',sale.map(e=>e.bills?{...e,bills:[{kind:'new',name:'INV-1B',amount_minor:118000}]}:e),{source:{kind:'proforma',id:id(300)}}));

// Input VAT needs the supplier's fiscal receipt code and TIN.
const purchase=[{ledger_id:L.purchase,amount_minor:50000,vat_class:'standard'},{ledger_id:L.inVat,amount_minor:9000},{ledger_id:L.supplier,amount_minor:-59000,bills:[{kind:'new',name:'SUP-77',amount_minor:-59000}]}];
await ok(post(id(212),T.purchase,'2026-07-28',purchase),/fiscal receipt verification code/);
await ok(post(id(212),T.purchase,'2026-07-28',purchase,{supplier:{tin:'123-456-789'}}),/both the supplier TIN/);
await ok(post(id(212),T.purchase,'2026-07-28',purchase,{supplier:{tin:'123-456-789',fiscal_code:'ABC123XYZ'}}));

// Period lock: accounts lock forward; only the owner reopens.
await ok(one(`select * from lock_ledger_period('2026-07-31','July VAT return filed')`));
await ok(post(id(213),T.receipt,'2026-07-30',[{ledger_id:L.bank,amount_minor:100},{ledger_id:L.capital,amount_minor:-100}]),/locked through 2026-07-31/);
await ok(one(`select * from lock_ledger_period('2026-06-30','Reopen July')`),/Only the owner/);
await as(owner);await ok(one(`select * from lock_ledger_period('2026-06-30','Reopen July for correction')`));
await as(accounts);await ok(post(id(213),T.receipt,'2026-07-30',[{ledger_id:L.bank,amount_minor:100},{ledger_id:L.capital,amount_minor:-100}]));

// Books are immutable even to the table owner.
await ok(db.exec(`delete from vouchers where id='${id(201)}'`),/never changed or deleted/);
await ok(db.exec(`update voucher_entries set amount_minor=1 where voucher_id='${id(201)}'`),/never changed or deleted/);
await ok(db.exec(`delete from accounting_events`),/never changed or deleted/);

// Trial balance balances and matches the postings.
const tb=await db.query(`select ledger_id, closing_minor::int c from trial_balance('2026-07-01','2027-06-30')`).then(r=>r.rows);
await ok(Promise.resolve(assert.equal(tb.reduce((s,r)=>s+r.c,0),0)));
await ok(Promise.resolve(assert.equal(tb.find(r=>r.ledger_id===L.outVat).c,-18000)));
await ok(Promise.resolve(assert.equal(tb.find(r=>r.ledger_id===L.cust).c,118000)));

// M2: invoice an accepted Pro forma without retyping.
const pf=id(400),pfDraft=id(401),pfOdd=id(402),pfZero=id(403),org2=id(12);
await db.exec(`insert into organizations values('${org2}');
insert into sales_proformas values('${pf}','PF-2026-000012','${org2}','accepted','TZS',1062000,'LPO 77',null),('${pfDraft}','PF-2026-000013','${org2}','draft','TZS',118000,null,null),
 ('${pfOdd}','PF-2026-000014','${org2}','accepted','TZS',116000,'x',null),('${pfZero}','PF-2026-000015','${org2}','accepted','TZS',50000,'y',null);
insert into sales_proforma_lines(proforma_id,sort_order,quantity,unit_price_minor,discount_basis_points,tax_basis_points) values
 ('${pf}',1,2,250000,1000,1800),('${pf}',2,1,450000,0,1800),('${pf}',3,1,0,0,1800),
 ('${pfDraft}',1,1,100000,0,1800),('${pfOdd}',1,1,100000,0,1600),('${pfZero}',1,1,50000,0,0);`);
const invoice=(vid,p,date='2026-08-05')=>one('select * from public.post_sales_invoice($1,$2,$3)',[vid,p,date]);
const settings=(v,body)=>one('select * from public.save_ledger_settings($1,$2::jsonb)',[v,JSON.stringify(body)]);
await ok(invoice(id(410),pf),/default sales ledger/);
await ok(settings(1,{sales_ledger_id:L.capital}),/under Sales Accounts/);
await ok(settings(1,{sales_ledger_id:L.sales,output_vat_ledger_id:L.inVat}),/output VAT ledger/);
await ok(settings(1,{sales_ledger_id:L.sales,output_vat_ledger_id:L.outVat,purchase_ledger_id:L.purchase,input_vat_ledger_id:L.inVat}));
await ok(settings(1,{sales_ledger_id:L.sales}),/changed; refresh/);
await ok(invoice(id(410),pf),/customer ledger linked/);
await ok(ledger(id(110),{name:'Second Hospital',group_id:G.debtors,organization_id:org2}));
await ok(invoice(id(410),pf),/Turn on bills/);
await ok(ledger(id(110),{name:'Second Hospital',group_id:G.debtors,organization_id:org2,bill_wise:true,credit_days:14},1));
await ok(invoice(id(410),pfDraft),/Only an accepted/);
await ok(invoice(id(410),pfOdd),/VAT at 16%, but the rate on 2026-08-05 is 18%/);
const inv=await invoice(id(410),pf);checks++;
const lines=await db.query(`select amount_minor::int a,vat_class c from voucher_entries where voucher_id=$1 order by line_no`,[inv.id]).then(r=>r.rows);
// 2 × 2,500.00 less 10% = 4,500.00; 4,500.00; VAT 18% of each; free line skipped.
await ok(Promise.resolve(assert.deepEqual(lines,[{a:1062000,c:null},{a:-450000,c:'standard'},{a:-450000,c:'standard'},{a:-162000,c:null}])));
await ok(bill('PF-2026-000012').then(r=>assert.deepEqual(r,{b:1062000,d:'2026-08-19'})));
await ok(invoice(id(410),pf).then(r=>assert.equal(r.number,inv.number)),undefined);
await ok(invoice(id(411),pf),/already has a posted voucher/);
await ok(invoice(id(412),pfZero).then(async r=>assert.equal((await one(`select vat_class from voucher_entries where voucher_id=$1 and line_no=2`,[r.id])).vat_class,'exempt')));

// M5: bank statement import and reconciliation.
const importStmt=(iid,ledgerId,lines)=>one('select public.import_bank_statement($1,$2,$3,$4::jsonb) r',[iid,ledgerId,'july.csv',JSON.stringify(lines)]).then(r=>r.r);
const stmt=[{line_date:'2026-07-21',amount_minor:80000,description:'Deposit',bank_ref:'CHQ1'},{line_date:'2026-07-21',amount_minor:80000,description:'Deposit',bank_ref:'CHQ1'},{line_date:'2026-07-31',amount_minor:-1500,description:'Charges'}];
await ok(importStmt(id(500),L.cust,stmt),/Bank Accounts or Bank OD/);
await ok(importStmt(id(500),L.bank,stmt).then(r=>assert.deepEqual({...r},{new:3,already:0,repeated:false})));
await ok(importStmt(id(501),L.bank,stmt).then(r=>assert.deepEqual({...r},{new:0,already:3,repeated:false})),undefined);
await ok(importStmt(id(500),L.bank,stmt).then(r=>assert.equal(r.repeated,true)));
const book=await db.query(`select * from public.bank_book($1,'2026-07-31')`,[L.bank]).then(r=>r.rows);
const lines80=await db.query(`select id from bank_statement_lines where amount_minor=80000 order by line_key`).then(r=>r.rows.map(x=>x.id));
const chargeLine=(await one(`select id from bank_statement_lines where amount_minor=-1500`)).id;
const e80=book.filter(b=>Number(b.amount_minor)===80000).map(b=>b.entry_id);
await ok(Promise.resolve(assert.ok(e80.length===1&&lines80.length===2)));
const rec=rows=>one('select public.record_bank_dates($1::jsonb) n',[JSON.stringify(rows)]).then(r=>r.n);
await ok(rec([{entry_id:e80[0],bank_date:'2026-07-21',statement_line_id:chargeLine}]),/different bank or amount/);
await ok(rec([{entry_id:e80[0],bank_date:'2026-07-21',statement_line_id:lines80[0]}]).then(n=>assert.equal(n,1)));
const opening=book.find(b=>Number(b.amount_minor)===500000).entry_id;
await ok(rec([{entry_id:opening,bank_date:'2026-07-01',statement_line_id:lines80[0]}]),/different bank or amount/);
await ok(post(id(505),T.receipt,'2026-07-21',[{ledger_id:L.bank,amount_minor:80000},{ledger_id:L.capital,amount_minor:-80000}]));
const second=(await one(`select e.id from voucher_entries e where e.voucher_id=$1 and e.ledger_id=$2`,[id(505),L.bank])).id;
await ok(rec([{entry_id:second,bank_date:'2026-07-21',statement_line_id:lines80[0]}]),/already clears another entry/);
await ok(rec([{entry_id:second,bank_date:'2026-07-21',statement_line_id:lines80[1]}]),undefined);
await ok(rec([{entry_id:book.find(b=>Number(b.amount_minor)===-50000)?.entry_id||opening,bank_date:null}]));
await ok(one(`select bank_date::text d from public.bank_book($1,'2026-07-31') where entry_id=$2`,[L.bank,e80[0]]).then(r=>assert.equal(r.d,'2026-07-21')));
await ok(rec([{entry_id:e80[0],bank_date:null}]).then(()=>one(`select bank_date from public.bank_book($1,'2026-07-31') where entry_id=$2`,[L.bank,e80[0]])).then(r=>assert.equal(r.bank_date,null)),undefined);
await ok(rec([{entry_id:id(999),bank_date:'2026-07-01'}]),/bank ledger entries/);
await ok(db.exec(`delete from bank_reconciliations`),/never changed or deleted/);

// M6: year-end close moves every income and expense balance to reserves and locks the year.
await ok(ledger(id(120),{name:'Retained earnings',group_id:'a0000000-0000-4000-8000-000000000016'}));
const close=(vid,ledgerId)=>one('select * from public.close_fiscal_year($1,$2,$3)',[vid,id(50),ledgerId]);
await ok(close(id(510),id(120)),/Only the owner/);
await as(owner);
await ok(close(id(510),L.sales),/Capital Account/);
const before=await db.query(`select sum(e.amount_minor)::bigint p from voucher_entries e join ledgers l on l.id=e.ledger_id join account_groups g on g.id=l.group_id where g.nature in ('income','expense')`).then(r=>Number(r.rows[0].p));
const closed=await close(id(510),id(120));checks++;
await ok(Promise.resolve(assert.ok(closed.closed_at&&closed.closing_voucher_id)));
const after=await db.query(`select ledger_id, closing_minor::bigint c from trial_balance('2026-07-01','2027-06-30')`).then(r=>new Map(r.rows.map(x=>[x.ledger_id,Number(x.c)])));
await ok(Promise.resolve(assert.equal(after.get(L.sales)||0,0)));
await ok(Promise.resolve(assert.equal(after.get(id(120)),before,'profit (credit) lands in retained earnings')));
await ok(one('select public.ledger_locked_through()::text d').then(r=>assert.equal(r.d,'2027-06-30')));
await ok(close(id(511),id(120)),/already closed/);
await as(accounts);
await ok(post(id(512),T.receipt,'2027-06-30',[{ledger_id:L.bank,amount_minor:100},{ledger_id:L.capital,amount_minor:-100}]),/locked through 2027-06-30/);

// RLS: accounts read, other staff see nothing, nobody writes directly.
await db.exec('set role authenticated');
await ok(one('select count(*)::int n from vouchers').then(r=>assert.ok(r.n>5)));
await ok(db.exec(`insert into ledger_period_locks(through_date,reason,locked_by) values('2027-01-01','direct write','${accounts}')`),/permission denied/);
await as(sales);
await ok(one('select count(*)::int n from vouchers').then(r=>assert.equal(r.n,0)));
await ok(one('select count(*)::int n from ledger_bill_balances').then(r=>assert.equal(r.n,0)));
await db.exec('reset role');
console.log(`general ledger database: ${checks} checks passed`);await db.close();
