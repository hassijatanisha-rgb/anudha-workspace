// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 087: double-entry books, invoices from accepted Pro formas, receipts, lock date and reports.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const ACCT=id(1),OWNER=id(2),SALES=id(3),ORG=id(10),ORG2=id(11),PF=id(20),PF_DRAFT=id(21),PF2=id(22);
const BANK='a0000000-0000-4000-8000-000000001200',AR='a0000000-0000-4000-8000-000000001300',SALES_ACC='a0000000-0000-4000-8000-000000004000',
 VAT='a0000000-0000-4000-8000-000000002200',RENT='a0000000-0000-4000-8000-000000006100',CAPITAL='a0000000-0000-4000-8000-000000003000';
const migration=readFileSync(new URL('../supabase/migrations/202610160087_accounting_ledger.sql',import.meta.url),'utf8');
let checks=0;const ok=async f=>{await f();checks++;};
const rejects=async(p,re)=>{await assert.rejects(p,re);};
let n=1000;const nid=()=>id(n++);
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text);
 create table organizations(id uuid primary key,name text);
 create table sales_proformas(id uuid primary key,document_number text,organization_id uuid,status text,currency text,subtotal_minor bigint,discount_minor bigint,tax_minor bigint,total_minor bigint,revision integer,deleted_at timestamptz,payment_terms text default '30 days',accepted_at timestamptz);
 create table sales_proforma_lines(id uuid primary key default gen_random_uuid(),proforma_id uuid,product_id uuid,sort_order integer,description text,quantity integer,uom text,unit_price_minor bigint,discount_basis_points integer,tax_basis_points integer);
 create table accounting_memberships(user_id uuid primary key,active boolean);
 create function mfa_satisfied() returns boolean language sql stable as $$select true$$;
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active) and mfa_satisfied()$$;
 create function inventory_owner() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active and role='owner') and mfa_satisfied()$$;
 create function accounting_access() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select auth.uid() is not null and inventory_active_staff() and exists(select 1 from accounting_memberships m where m.user_id=auth.uid() and m.active)$$;
 insert into auth.users values('${ACCT}'),('${OWNER}'),('${SALES}');
 insert into staff values('${ACCT}',true,'staff','accounts'),('${OWNER}',true,'owner','management'),('${SALES}',true,'staff','sales');
 insert into accounting_memberships values('${ACCT}',true),('${OWNER}',true);
 insert into organizations values('${ORG}','Fixture Hospital'),('${ORG2}','Other Clinic');
 insert into sales_proformas values
  ('${PF}','PF-2026-000001','${ORG}','accepted','TZS',100000000,5000000,17100000,112100000,2,null),
  ('${PF_DRAFT}','PF-2026-000002','${ORG}','draft','TZS',1000,0,0,1000,1,null),
  ('${PF2}','PF-2026-000003','${ORG2}','accepted','TZS',50000000,0,0,50000000,1,null);
 insert into sales_proforma_lines(proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points)
  values('${PF}','${id(30)}',1,'Fixture analyser',1,'unit',100000000,500,1800);
 grant select on all tables in schema public to authenticated;`);
 await db.exec(migration);
 await db.exec(migration); // re-runnable
 // Later accounting migrations must keep every rule below.
 for(const later of ['202610160090_invoice_on_submit.sql','202610160091_erp_tax_invoice.sql','202610160093_accounting_integrity.sql','202610160093_accounting_integrity.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+later,import.meta.url),'utf8'));
 const as=async actor=>db.exec(`reset role;set test.actor='${actor}';set role authenticated`);
 const q=(sql,params)=>db.query(sql,params);
 const one=async(sql,params)=>(await q(sql,params)).rows[0];
 const lines=(...l)=>JSON.stringify(l.map(([account_id,d,c,org])=>({account_id,debit_minor:d,credit_minor:c,organization_id:org||null})));
 const D='2026-10-10';

 await ok(async()=>{assert.equal((await one('select count(*)::int n from acc_accounts')).n,43,'seeded chart of accounts');});

 // Access: sales staff see nothing and cannot post or read reports; anonymous cannot call anything.
 await as(SALES);
 await ok(async()=>{assert.equal((await one('select count(*)::int n from acc_accounts')).n,0);});
 await ok(()=>rejects(q('select post_manual_journal($1,$2,$3,$4)',[nid(),D,'Not allowed',lines([RENT,100,0],[BANK,0,100])]),/Accounting access is required/));
 await ok(()=>rejects(q('select * from acc_trial_balance($1)',[D]),/Accounting access is required/));
 await ok(async()=>{assert.equal((await one('select count(*)::int n from acc_invoice_balances')).n,0);assert.equal((await one('select count(*)::int n from acc_waiting_proformas')).n,0);});
 await db.exec('reset role;set role anon');
 await ok(()=>rejects(q('select * from acc_trial_balance($1)',[D]),/permission denied/));
 await ok(()=>rejects(q('select * from acc_invoice_balances'),/permission denied/));
 await ok(()=>rejects(q('select * from acc_waiting_proformas'),/permission denied/));

 // Manual journals.
 await as(ACCT);
 const capital=nid();
 await ok(async()=>{const r=await one('select (post_manual_journal($1,$2,$3,$4)).*',[capital,'2026-10-01','Owner capital paid in',lines([BANK,500000000,0],[CAPITAL,0,500000000])]);assert.match(r.entry_number,/^JE-2026-\d{6}$/);});
 await ok(async()=>{const a=await one('select (post_manual_journal($1,$2,$3,$4)).entry_number',[capital,'2026-10-01','Owner capital paid in',lines([BANK,500000000,0],[CAPITAL,0,500000000])]);
  assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,1,'retry did not post twice');assert.ok(a.entry_number);});
 await ok(()=>rejects(q('select post_manual_journal($1,$2,$3,$4)',[capital,'2026-10-01','Different memo',lines([BANK,1,0],[CAPITAL,0,1])]),/already used/));
 await ok(()=>rejects(q('select post_manual_journal($1,$2,$3,$4)',[nid(),D,'Unbalanced rent',lines([RENT,1000,0],[BANK,0,900])]),/must be equal/));
 await ok(()=>rejects(q('select post_manual_journal($1,$2,$3,$4)',[nid(),D,'One line only',lines([RENT,1000,0])]),/between 2 and 200 lines/));
 await ok(()=>rejects(q('select post_manual_journal($1,$2,$3,$4)',[nid(),D,'Both sides',lines([RENT,10,10],[BANK,0,20])]),/either a debit or a credit/));
 await ok(()=>rejects(q('select post_manual_journal($1,$2,$3,$4)',[nid(),D,'Unknown account',lines([id(999),10,0],[BANK,0,10])]),/unknown or inactive account/));
 await ok(async()=>{assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,1,'rejected entries left nothing behind');});
 const rent=nid();
 await q('select post_manual_journal($1,$2,$3,$4)',[rent,'2026-10-05','October rent',lines([RENT,20000000,0],[BANK,0,20000000])]);

 // Posted history is permanent, even for the database owner.
 await db.exec('reset role');
 await ok(()=>rejects(q('update acc_journal_entries set memo=$1 where id=$2',['Changed',rent]),/cannot be changed/));
 await ok(()=>rejects(q('delete from acc_journal_lines where entry_id=$1',[rent]),/cannot be changed/));
 await ok(()=>rejects(db.exec(`begin;insert into acc_journal_entries(id,entry_number,entry_date,memo,source_type,created_by) values('${id(990)}','JE-X','2026-10-01','Sneaky','manual','${ACCT}');
  insert into acc_journal_lines(entry_id,line_no,account_id,debit_minor) values('${id(990)}',1,'${RENT}',5),('${id(990)}',2,'${BANK}',0);commit;`),/./));
 await db.exec('rollback').catch(()=>{});
 await ok(()=>rejects(db.exec(`begin;insert into acc_journal_entries(id,entry_number,entry_date,memo,source_type,created_by) values('${id(991)}','JE-Y','2026-10-01','Sneaky','manual','${ACCT}');
  insert into acc_journal_lines(entry_id,line_no,account_id,debit_minor) values('${id(991)}',1,'${RENT}',5);
  insert into acc_journal_lines(entry_id,line_no,account_id,credit_minor) values('${id(991)}',2,'${BANK}',4);commit;`),/does not balance/));
 await db.exec('rollback').catch(()=>{});

 // Reversal of a manual entry.
 await as(ACCT);
 const rev=nid();
 await ok(()=>rejects(q('select reverse_journal_entry($1,$2,$3,$4)',[nid(),rent,'2026-10-06','no']),/at least 5/));
 await ok(async()=>{await q('select reverse_journal_entry($1,$2,$3,$4)',[rev,rent,'2026-10-06','Wrong month booked']);
  const r=await one('select sum(debit_minor-credit_minor)::bigint b from acc_journal_lines where account_id=$1',[RENT]);assert.equal(Number(r.b),0);});
 await ok(()=>rejects(q('select reverse_journal_entry($1,$2,$3,$4)',[nid(),rent,'2026-10-06','Second reversal']),/already been reversed/));
 await ok(()=>rejects(q('select reverse_journal_entry($1,$2,$3,$4)',[nid(),rev,'2026-10-06','Reverse the reversal']),/cannot itself be reversed/));

 // Invoices from Pro formas.
 const inv=nid();
 await ok(()=>rejects(q('select create_invoice_from_proforma($1,$2,$3,$4,$5)',[nid(),PF_DRAFT,D,'2026-11-09','']),/Only an accepted/));
 await ok(()=>rejects(q('select create_invoice_from_proforma($1,$2,$3,$4,$5)',[nid(),PF,D,'2026-10-01','']),/due date on or after/));
 await ok(async()=>{const r=await one('select (create_invoice_from_proforma($1,$2,$3,$4,$5)).*',[inv,PF,D,'2026-10-20','EFD-123']);
  assert.match(r.invoice_number,/^INV-2026-\d{6}$/);assert.equal(Number(r.total_minor),112100000);assert.equal(r.lines.length,1);
  const ls=(await q('select account_id,debit_minor,credit_minor,organization_id from acc_journal_lines where entry_id=$1 order by line_no',[r.journal_entry_id])).rows;
  assert.deepEqual(ls.map(l=>[l.account_id,Number(l.debit_minor),Number(l.credit_minor)]),[[AR,112100000,0],[SALES_ACC,0,95000000],[VAT,0,17100000]]);
  assert.equal(ls[0].organization_id,ORG);});
 await ok(async()=>{const r=await one('select (create_invoice_from_proforma($1,$2,$3,$4,$5)).invoice_number',[inv,PF,D,'2026-10-20','EFD-123']);assert.ok(r.invoice_number);
  assert.equal((await one('select count(*)::int n from acc_invoices')).n,1,'retry did not invoice twice');});
 await ok(()=>rejects(q('select create_invoice_from_proforma($1,$2,$3,$4,$5)',[nid(),PF,D,'2026-10-20','']),/already has an invoice/));
 const inv2=nid();
 await q('select create_invoice_from_proforma($1,$2,$3,$4,$5)',[inv2,PF2,'2026-07-01','2026-07-10','']);

 // Receipts and allocation.
 await ok(()=>rejects(q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[nid(),ORG,'2026-10-12',1000,'bank','',AR,'[]']),/bank, cash or mobile money/));
 await ok(()=>rejects(q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[nid(),ORG,'2026-10-12',1000,'bank','',BANK,JSON.stringify([{invoice_id:inv2,amount_minor:1000}])]),/another customer/));
 await ok(()=>rejects(q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[nid(),ORG,'2026-10-12',1000,'bank','',BANK,JSON.stringify([{invoice_id:inv,amount_minor:2000}])]),/more than the amount received/));
 await ok(()=>rejects(q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[nid(),ORG,'2026-10-12',999999999,'bank','',BANK,JSON.stringify([{invoice_id:inv,amount_minor:999999999}])]),/less than that left/));
 const rct=nid();
 await ok(async()=>{const r=await one('select (record_receipt($1,$2,$3,$4,$5,$6,$7,$8)).*',[rct,ORG,'2026-10-12',60000000,'bank','TT 4411',BANK,JSON.stringify([{invoice_id:inv,amount_minor:60000000}])]);
  assert.match(r.receipt_number,/^RCT-2026-\d{6}$/);
  const paid=await one('select coalesce(sum(amount_minor),0)::bigint p from acc_receipt_allocations where invoice_id=$1',[inv]);assert.equal(Number(paid.p),60000000);});
 await ok(async()=>{await q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[rct,ORG,'2026-10-12',60000000,'bank','TT 4411',BANK,JSON.stringify([{invoice_id:inv,amount_minor:60000000}])]);
  assert.equal((await one('select count(*)::int n from acc_receipts')).n,1,'retry did not record twice');});
 await ok(()=>rejects(q('select void_invoice($1,$2,$3)',[inv,'2026-10-13','Customer cancelled order']),/Void the receipts/));

 await ok(async()=>{const r=await one('select * from acc_invoice_balances where id=$1',[inv]);assert.equal(Number(r.paid_minor),60000000);assert.equal(Number(r.outstanding_minor),52100000);assert.ok(['part','overdue'].includes(r.status_key));assert.equal(r.proforma_number,'PF-2026-000001');
  assert.equal((await one('select count(*)::int n from acc_waiting_proformas where id=$1',[PF])).n,0,'live invoice excluded by server anti-join');});
 await ok(()=>rejects(q('update acc_invoice_balances set buyer_tin=$1 where id=$2',['123456789',inv]),/permission denied|cannot update view/));

 // Reports.
 await ok(async()=>{const tb=(await q('select * from acc_trial_balance($1)',['2026-10-31'])).rows;
  const d=tb.reduce((s,r)=>s+Number(r.debit_minor),0),c=tb.reduce((s,r)=>s+Number(r.credit_minor),0);assert.equal(d,c,'trial balance balances');
  const bank=tb.find(r=>r.code==='1200');assert.equal(Number(bank.debit_minor),500000000+60000000);});
 await ok(async()=>{const pl=(await q('select * from acc_profit_and_loss($1,$2)',['2026-10-01','2026-10-31'])).rows;
  assert.deepEqual(pl.map(r=>[r.code,Number(r.amount_minor)]),[['4000',95000000]],'October sales; rent reversed out');
  const pl2=(await q('select * from acc_profit_and_loss($1,$2)',['2026-07-01','2026-07-31'])).rows;assert.equal(Number(pl2[0].amount_minor),50000000);});
 await ok(async()=>{const bs=(await q('select * from acc_balance_sheet($1)',['2026-10-31'])).rows;
  const sum=t=>bs.filter(r=>r.account_type===t).reduce((s,r)=>s+Number(r.amount_minor),0);
  assert.equal(sum('asset'),sum('liability')+sum('equity'),'assets = liabilities + equity');});
 await ok(async()=>{const ag=(await q('select * from acc_receivables_ageing($1)',['2026-10-31'])).rows;
  const a=ag.find(r=>r.organization_id===ORG),b=ag.find(r=>r.organization_id===ORG2);
  assert.equal(Number(a.days_1_30_minor),112100000-60000000,'Fixture Hospital 11 days overdue');assert.equal(Number(a.balance_minor),52100000);
  assert.equal(Number(b.days_over_90_minor),50000000,'Other Clinic over 90 days');});
 await ok(async()=>{const gl=(await q('select * from acc_account_ledger($1,$2,$3)',[BANK,'2026-10-02','2026-10-31'])).rows;
  assert.equal(Number(gl[0].balance_minor),500000000,'opening balance');assert.equal(Number(gl.at(-1).balance_minor),500000000-20000000+20000000+60000000,'running balance');});

 const arAt=async(org,date)=>Number((await one('select coalesce(sum(l.debit_minor-l.credit_minor),0)::bigint b from acc_journal_lines l join acc_journal_entries e on e.id=l.entry_id where l.account_id=$1 and l.organization_id=$2 and e.entry_date<=$3',[AR,org,date])).b);
 const ageingAt=async(org,date)=>(await q('select * from acc_receivables_ageing($1)',[date])).rows.find(r=>r.organization_id===org);

 // Unallocated money is a customer credit; voiding a receipt then the invoice reverses both.
 await ok(async()=>{await q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[nid(),ORG2,'2026-10-14',1000000,'cash','Advance','a0000000-0000-4000-8000-000000001100','[]']);
  const ag=(await q('select * from acc_receivables_ageing($1)',['2026-10-31'])).rows.find(r=>r.organization_id===ORG2);assert.equal(Number(ag.unapplied_credit_minor),1000000);assert.equal(Number(ag.balance_minor),49000000);});
 await ok(async()=>{await q('select void_receipt($1,$2,$3)',[rct,'2026-10-15','Cheque bounced at bank']);
  await q('select void_invoice($1,$2,$3)',[inv,'2026-10-15','Customer cancelled order']);
  const r=await one('select sum(debit_minor-credit_minor)::bigint b from acc_journal_lines l join acc_journal_entries e on e.id=l.entry_id where l.account_id=$1 and l.organization_id=$2',[AR,ORG]);assert.equal(Number(r.b),0,'customer owes nothing after both voids');
  const voided=await one('select paid_minor,outstanding_minor,status_key from acc_invoice_balances where id=$1',[inv]);assert.equal(Number(voided.paid_minor),0);assert.equal(Number(voided.outstanding_minor),0);assert.equal(voided.status_key,'void');
  assert.equal((await one('select count(*)::int n from acc_waiting_proformas where id=$1',[PF])).n,1,'void invoice returns Pro forma to waiting');
  const again=await one('select (create_invoice_from_proforma($1,$2,$3,$4,$5)).invoice_number',[nid(),PF,'2026-10-16','2026-10-30','']);assert.ok(again.invoice_number,'re-invoice after void');});

 // Void clicks happen now, but history follows the reversal's accounting date.
 await ok(async()=>{for(const [date,expected] of [['2026-10-11',112100000],['2026-10-14',52100000],['2026-10-15',0]]){
  assert.equal(Number((await ageingAt(ORG,date))?.balance_minor||0),expected,`ageing at ${date} after backdated void`);assert.equal(await arAt(ORG,date),expected);
 }});
 const futureVoidReceipt=nid();
 await q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[futureVoidReceipt,ORG2,'2026-10-16',2000000,'bank','Future reversal',BANK,JSON.stringify([{invoice_id:inv2,amount_minor:2000000}])]);
 await q('select void_receipt($1,$2,$3)',[futureVoidReceipt,'2026-11-10','Future bank correction']);
 await q('select void_invoice($1,$2,$3)',[inv2,'2026-11-01','Future order cancellation']);
 await ok(async()=>{for(const [date,expected] of [['2026-10-20',47000000],['2026-11-05',-3000000],['2026-11-10',-1000000]]){
  assert.equal(Number((await ageingAt(ORG2,date))?.balance_minor||0),expected,`ageing at ${date} before/after future reversals`);assert.equal(await arAt(ORG2,date),expected);
 }});
 await ok(async()=>{const futureInvoice=nid(),earlyReceipt=nid();await q('select create_invoice_from_proforma($1,$2,$3,$4,$5)',[futureInvoice,PF2,'2026-11-15','2027-01-15','']);
  await q('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[earlyReceipt,ORG2,'2026-10-20',5000000,'bank','Advance before invoice date',BANK,JSON.stringify([{invoice_id:futureInvoice,amount_minor:5000000}])]);
  for(const date of ['2026-11-05','2026-11-15'])assert.equal(Number((await ageingAt(ORG2,date)).balance_minor),await arAt(ORG2,date),'allocations before invoice date remain historical customer credit');
 });

 // Lock date: owner only; nothing on or before it.
 await ok(()=>rejects(q('select set_books_lock($1,$2)',[1,'2026-09-30']),/Only the owner/));
 await as(OWNER);
 await ok(async()=>{await q('select set_books_lock($1,$2)',[1,'2026-10-12']);});
 await as(ACCT);
 await ok(()=>rejects(q('select post_manual_journal($1,$2,$3,$4)',[nid(),'2026-10-12','Late entry',lines([RENT,1,0],[BANK,0,1])]),/locked through/));
 await ok(async()=>{await q('select post_manual_journal($1,$2,$3,$4)',[nid(),'2026-10-13','After lock',lines([RENT,1,0],[BANK,0,1])]);});

 // Accounts: add, rename, protect system accounts, optimistic version.
 const acc=nid();
 await ok(async()=>{await q('select save_ledger_account($1,$2,$3,$4,$5,$6)',[acc,null,'6150','Generator fuel','expense',true]);
  await q('select save_ledger_account($1,$2,$3,$4,$5,$6)',[acc,1,'6150','Generator diesel','expense',true]);
  await rejects(q('select save_ledger_account($1,$2,$3,$4,$5,$6)',[acc,1,'6150','Stale edit','expense',true]),/changed this account/);});
 await ok(()=>rejects(q('select save_ledger_account($1,$2,$3,$4,$5,$6)',[AR,1,'1300','Receivables','asset',false]),/automatic postings/));
 await ok(()=>rejects(q('select save_ledger_account($1,$2,$3,$4,$5,$6)',[nid(),null,'61','Bad code','expense',true]),/4 to 6 digits/));

 // A payment cannot disappear when the UI's historical 1,000-row receipt limit is exceeded.
 await ok(async()=>{const live=(await one('select id from acc_invoices where proforma_id=$1 and voided_at is null',[PF])).id;
  await q(`select record_receipt(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,$1,'2026-10-20',1,'bank','Volume receipt',$2,jsonb_build_array(jsonb_build_object('invoice_id',$3::text,'amount_minor',1))) from generate_series(100000,101004) n`,[ORG,BANK,live]);
  const r=await one('select paid_minor,outstanding_minor from acc_invoice_balances where id=$1',[live]);assert.equal(Number(r.paid_minor),1005);assert.equal(Number(r.outstanding_minor),112100000-1005);
 });
 await ok(async()=>{await db.exec('reset role');
  await db.exec(`insert into sales_proformas(id,document_number,organization_id,status,currency,subtotal_minor,discount_minor,tax_minor,total_minor,revision)
   select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'PF-USD-'||n,'${ORG}','accepted','USD',100,0,0,100,1 from generate_series(200000,200500) n`);
  await as(ACCT);assert.equal((await one("select count(*)::int n from acc_waiting_proformas where currency='USD'")).n,501,'waiting candidates have no 500-row SQL cap');
  assert.equal((await one("select total_minor from acc_waiting_proformas where document_number='PF-USD-200500'")).total_minor,100);
 });

 await ok(async()=>{await as(SALES);assert.equal((await one('select count(*)::int n from acc_invoice_balances')).n,0,'populated invoice view keeps accounting RLS');assert.equal((await one('select count(*)::int n from acc_waiting_proformas')).n,0);await as(ACCT);});

 // Whole-book check: every entry balances.
 await ok(async()=>{const r=await one(`select count(*)::int n from (select entry_id from acc_journal_lines group by entry_id having sum(debit_minor)<>sum(credit_minor)) x`);assert.equal(r.n,0);});
 console.log(`PASS: ${checks} accounting ledger checks; access limited to accounting users, balanced and permanent entries, retry-safe posting, reversals, invoices only from accepted Pro formas with VAT split, receipts with allocation and customer credit, voids, lock date, trial balance, profit and loss, balance sheet, ageing, account ledger.`);
}finally{await db.close();}
