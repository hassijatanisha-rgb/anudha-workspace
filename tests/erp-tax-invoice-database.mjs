// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 091: customer TIN/VRN, TRA receipt on the ERP tax invoice, posted amounts still locked.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const ACCT=id(1),SALES=id(3),ORG=id(10),PF=id(20),PF2=id(21);
const mig=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text);
 create table organizations(id uuid primary key,name text);
 create table sales_proformas(id uuid primary key,document_number text,organization_id uuid,status text,currency text,payment_terms text,subtotal_minor bigint,discount_minor bigint,tax_minor bigint,total_minor bigint,revision integer,accepted_at timestamptz,deleted_at timestamptz,prepared_by uuid,acceptance_reference text);
 create table sales_proforma_lines(id uuid primary key default gen_random_uuid(),proforma_id uuid,product_id uuid,sort_order integer,description text,quantity integer,uom text,unit_price_minor bigint,discount_basis_points integer,tax_basis_points integer);
 create table accounting_memberships(user_id uuid primary key,active boolean);
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active)$$;
 create function inventory_owner() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active and role='owner')$$;
 create function accounting_access() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select auth.uid() is not null and inventory_active_staff() and exists(select 1 from accounting_memberships m where m.user_id=auth.uid() and m.active)$$;
 insert into auth.users values('${ACCT}'),('${SALES}');
 insert into staff values('${ACCT}',true,'staff','accounts'),('${SALES}',true,'staff','sales');
 insert into accounting_memberships values('${ACCT}',true);
 insert into organizations values('${ORG}','Fixture Hospital');
 insert into sales_proformas values('${PF}','PF-2026-000001','${ORG}','sent','TZS','Payment before delivery',100000,0,18000,118000,1,null,null,null,null),('${PF2}','PF-2026-000002','${ORG}','sent','TZS','30 days',50000,0,9000,59000,1,null,null,null,null);
 grant select,update on sales_proformas to authenticated;grant select on all tables in schema public to authenticated;`);
 for(const m of ['202610160087_accounting_ledger.sql','202610160090_invoice_on_submit.sql'])await db.exec(mig(m));
 const m091=mig('202610160091_erp_tax_invoice.sql');await db.exec(m091);await db.exec(m091); // re-runnable
 const as=async a=>db.exec(`reset role;set test.actor='${a}';set role authenticated`);
 const submit=async k=>{await as(SALES);await db.query(`update sales_proformas set status='accepted',accepted_at=now() where id=$1`,[k]);await db.exec('reset role');};
 const invoice=async k=>(await db.query('select * from acc_invoices where proforma_id=$1',[k])).rows[0];

 await as(ACCT);
 await ok(()=>assert.rejects(db.query('select set_customer_tax_ids($1,$2,$3)',[ORG,'12AB','']),/TIN should be digits/));
 await ok(()=>assert.rejects(db.query('select set_customer_tax_ids($1,$2,$3)',[ORG,'100-113-473','bad vrn!']),/VRN should look like/));
 await ok(async()=>{const r=(await db.query('select (set_customer_tax_ids($1,$2,$3)).*',[ORG,'100-200-300','10-123456-x'])).rows[0];assert.equal(r.vrn,'10-123456-X','VRN kept in capitals');});
 await as(SALES);
 await ok(()=>assert.rejects(db.query('select set_customer_tax_ids($1,$2,$3)',[ORG,'100-200-300','']),/Accounting access is required/));
 await ok(async()=>{assert.equal((await db.query('select count(*)::int n from acc_customer_tax_ids')).rows[0].n,0,'sales cannot read tax numbers');});
 await db.exec('reset role');

 await submit(PF);
 const inv=await invoice(PF);
 await ok(async()=>{assert.equal(inv.buyer_tin,'100-200-300');assert.equal(inv.buyer_vrn,'10-123456-X');assert.equal(inv.tra_receipt_number,'');});
 await as(ACCT);
 await ok(()=>assert.rejects(db.query('select record_invoice_fiscal($1,$2,$3,$4,$5)',[inv.id,' ','', '100-200-300','10-123456-X']),/TRA receipt number/));
 await ok(async()=>{const r=(await db.query('select (record_invoice_fiscal($1,$2,$3,$4,$5)).*',[inv.id,'RCT 00412','ABC123XYZ','100-200-301','10-123456-X'])).rows[0];
  assert.equal(r.tra_receipt_number,'RCT 00412');assert.equal(r.tra_verification_code,'ABC123XYZ');assert.equal(r.buyer_tin,'100-200-301');assert.equal(r.fiscal_recorded_by,ACCT);assert.equal(Number(r.total_minor),118000,'amounts unchanged');
  assert.equal((await db.query('select tin from acc_customer_tax_ids where organization_id=$1',[ORG])).rows[0].tin,'100-200-301','customer numbers updated');});
 await as(SALES);
 await ok(()=>assert.rejects(db.query('select record_invoice_fiscal($1,$2,$3,$4,$5)',[inv.id,'X','', '','']),/Accounting access is required/));
 await db.exec('reset role');
 // Posted amounts and dates stay locked, even for the database owner.
 await ok(()=>assert.rejects(db.query('update acc_invoices set total_minor=1 where id=$1',[inv.id]),/nothing else may change/));
 await ok(()=>assert.rejects(db.query(`update acc_invoices set tra_receipt_number='Y', invoice_date=invoice_date+1 where id=$1`,[inv.id]),/nothing else may change/));
 await ok(()=>assert.rejects(db.query('delete from acc_invoices where id=$1',[inv.id]),/cannot be deleted/));
 // Voiding still works, and a void invoice takes no TRA receipt.
 await as(ACCT);
 await ok(async()=>{await db.query('select void_invoice($1,$2,$3)',[inv.id,new Date().toISOString().slice(0,10),'Customer cancelled order']);});
 await ok(()=>assert.rejects(db.query('select record_invoice_fiscal($1,$2,$3,$4,$5)',[inv.id,'RCT 2','', '','']),/void/));
 await db.exec('reset role');
 await ok(()=>assert.rejects(db.query(`update acc_invoices set tra_receipt_number='Z' where id=$1`,[inv.id]),/nothing else may change/));
 // An invoice made before tax numbers are known prints blank ones until recorded.
 await db.exec('delete from acc_customer_tax_ids');
 await submit(PF2);
 await ok(async()=>{const r=await invoice(PF2);assert.equal(r.buyer_tin,'');assert.ok(r.invoice_number);});
 console.log(`PASS: ${checks} ERP tax invoice checks; customer TIN/VRN validated and private to accounting, invoices take the saved numbers, TRA receipt recorded without touching amounts, posted fields locked even for the owner, void still works and void invoices take no receipt.`);
}finally{await db.close();}
