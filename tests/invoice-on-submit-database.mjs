// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 090: Submit to accounting turns the accepted Pro forma into a posted invoice in the Books.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const ACCT=id(1),OWNER=id(2),SALES=id(3),ORG=id(10);
const mig=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text);
 create table organizations(id uuid primary key,name text);
 create table sales_proformas(id uuid primary key,document_number text,organization_id uuid,status text,currency text,payment_terms text,subtotal_minor bigint,discount_minor bigint,tax_minor bigint,total_minor bigint,revision integer,accepted_at timestamptz,deleted_at timestamptz);
 create table sales_proforma_lines(id uuid primary key default gen_random_uuid(),proforma_id uuid,product_id uuid,sort_order integer,description text,quantity integer,uom text,unit_price_minor bigint,discount_basis_points integer,tax_basis_points integer);
 create table accounting_memberships(user_id uuid primary key,active boolean);
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active)$$;
 create function inventory_owner() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active and role='owner')$$;
 create function accounting_access() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select auth.uid() is not null and inventory_active_staff() and exists(select 1 from accounting_memberships m where m.user_id=auth.uid() and m.active)$$;
 insert into auth.users values('${ACCT}'),('${OWNER}'),('${SALES}');
 insert into staff values('${ACCT}',true,'staff','accounts'),('${OWNER}',true,'owner','management'),('${SALES}',true,'staff','sales');
 insert into accounting_memberships values('${ACCT}',true),('${OWNER}',true);
 insert into organizations values('${ORG}','Fixture Hospital');
 grant select,update on sales_proformas to authenticated;grant select on all tables in schema public to authenticated;`);
 await db.exec(mig('202610160087_accounting_ledger.sql'));
 const m090=mig('202610160090_invoice_on_submit.sql');await db.exec(m090);await db.exec(m090); // re-runnable
 const pf=async(n,{terms='Payment before delivery',currency='TZS',sub=100000,disc=0,tax=18000}={})=>{const k=id(100+n);
  await db.query(`insert into sales_proformas values($1,$2,$3,'sent',$4,$5,$6,$7,$8,$9,1,null,null)`,[k,`PF-2026-00000${n}`,ORG,currency,terms,sub,disc,tax,sub-disc+tax]);
  await db.query(`insert into sales_proforma_lines(proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points) values($1,$2,1,'Analyser',1,'unit',$3,0,1800)`,[k,id(50),sub]);return k;};
 // Sales submits to accounting (the status change advance_sales_proforma makes), at 23:30 UTC = 02:30 next day in Dar es Salaam.
 const submit=async(k,at='2026-10-16T23:30:00Z')=>{await db.exec(`reset role;set test.actor='${SALES}';set role authenticated`);
  await db.query(`update sales_proformas set status='accepted',accepted_at=$2 where id=$1`,[k,at]);await db.exec('reset role');};
 const inv=async k=>(await db.query('select * from acc_invoices where proforma_id=$1',[k])).rows;

 const a=await pf(1);
 await ok(async()=>{await submit(a);const r=await inv(a);assert.equal(r.length,1,'invoice made on submit');
  assert.equal(r[0].created_by,SALES,'records who submitted');assert.equal(Number(r[0].total_minor),118000);
  assert.equal(r[0].invoice_date.toISOString().slice(0,10),'2026-10-17','invoice dated in Dar es Salaam time');
  assert.equal(r[0].due_date.toISOString().slice(0,10),'2026-10-17','payment before delivery is due at once');
  const lines=(await db.query('select account_id,debit_minor,credit_minor from acc_journal_lines where entry_id=$1 order by line_no',[r[0].journal_entry_id])).rows.map(l=>[l.account_id.slice(-4),Number(l.debit_minor),Number(l.credit_minor)]);
  assert.deepEqual(lines,[['1300',118000,0],['4000',0,100000],['2200',0,18000]]);});
 await ok(async()=>{await db.exec(`set test.actor='${SALES}'`);await db.query(`update sales_proformas set revision=revision where id=$1`,[a]);await db.exec('reset role');
  assert.equal((await inv(a)).length,1,'later updates do not invoice twice');});
 const b=await pf(2,{terms:'Net 14 days'});
 await ok(async()=>{await submit(b,'2026-10-16T08:00:00Z');const r=(await inv(b))[0];assert.equal(r.due_date.toISOString().slice(0,10),'2026-10-30','14 days from the terms');});
 const c=await pf(3,{terms:'As agreed'});
 await ok(async()=>{await submit(c,'2026-10-16T08:00:00Z');assert.equal((await inv(c))[0].due_date.toISOString().slice(0,10),'2026-11-15','30 days when terms give no number');});
 // Cannot invoice: submission still succeeds, Pro forma waits for Accounts.
 const usd=await pf(4,{currency:'USD'});
 await ok(async()=>{await submit(usd,'2026-10-16T08:00:00Z');assert.equal((await db.query('select status from sales_proformas where id=$1',[usd])).rows[0].status,'accepted');assert.equal((await inv(usd)).length,0);});
 await db.exec(`set test.actor='${OWNER}'`);await db.query('select set_books_lock(1,$1)',['2026-10-20']);await db.exec('reset role');
 const locked=await pf(5);
 await ok(async()=>{await submit(locked,'2026-10-18T08:00:00Z');assert.equal((await db.query('select status from sales_proformas where id=$1',[locked])).rows[0].status,'accepted','submission not blocked by the lock');assert.equal((await inv(locked)).length,0,'no invoice inside the locked period');});
 // Accounts can still invoice the waiting one by hand, after the lock date.
 await ok(async()=>{await db.exec(`set test.actor='${ACCT}';set role authenticated`);const r=(await db.query('select (create_invoice_from_proforma($1,$2,$3,$4,$5)).invoice_number n',[id(900),locked,'2026-10-21','2026-10-21','EFD-1'])).rows[0];assert.match(r.n,/^INV-2026-/);await db.exec('reset role');});
 await ok(async()=>{await db.exec(`set test.actor='${SALES}';set role authenticated`);await assert.rejects(db.query('select create_invoice_from_proforma($1,$2,$3,$4,$5)',[id(901),usd,'2026-10-21','2026-10-21','']),/Accounting access is required/);await assert.rejects(db.query('select acc_create_invoice($1,$2,$3,$4,$5)',[id(902),usd,'2026-10-21','2026-10-21','']),/permission denied/);await db.exec('reset role');});
 await ok(async()=>{const r=(await db.query(`select count(*)::int n from (select entry_id from acc_journal_lines group by entry_id having sum(debit_minor)<>sum(credit_minor)) x`)).rows[0];assert.equal(r.n,0,'every entry balances');});
 console.log(`PASS: ${checks} invoice-on-submit checks; Sales submit posts one invoice with VAT split, Dar es Salaam date, due date from terms; non-TZS and locked dates leave the Pro forma waiting without blocking Sales; Accounts can still invoice by hand; Sales cannot call the invoice functions directly.`);
}finally{await db.close();}
