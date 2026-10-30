// Run only against the existing disposable PGlite runtime, never a live database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;
 create function accounting_access() returns boolean language sql stable as $$select current_setting('test.accounting',true)='yes' and current_setting('test.active',true)='yes' and current_setting('test.mfa',true)='yes'$$;
 create function acc_require_access() returns void language plpgsql as $$begin if not coalesce(accounting_access(),false) then raise exception 'Accounting access required';end if;end$$;
 create table acc_accounts(id uuid primary key,code text,name text,account_type text,system_key text);
 create table acc_journal_entries(id uuid primary key,entry_date date);
 create table acc_journal_lines(id uuid primary key,entry_id uuid,account_id uuid,debit_minor bigint,credit_minor bigint);
 create table acc_settings(id boolean primary key,version integer,locked_through date);
 create table organizations(id uuid primary key,name text);
 create table acc_invoices(id uuid primary key,organization_id uuid,invoice_number text,invoice_date date,due_date date,paid_minor bigint,outstanding_minor bigint,status_key text,status_label text,lines jsonb,total_minor bigint not null default 610,tra_receipt_number text not null default '',tra_verification_code text not null default '',buyer_tin text not null default '',buyer_vrn text not null default '',voided_at timestamptz,opening_import_id uuid);
 create table sales_proformas(id uuid primary key,organization_id uuid,document_number text,accepted_at timestamptz,currency text,total_minor bigint);
 create table acc_customer_tax_ids(organization_id uuid primary key,tin text,vrn text);
 create view acc_invoice_balances with(security_invoker=true) as select * from acc_invoices;
 create view acc_waiting_proformas with(security_invoker=true) as select * from sales_proformas;
 grant select on acc_invoice_balances,acc_waiting_proformas to authenticated;
 do $$declare t text;begin foreach t in array array['acc_accounts','acc_journal_entries','acc_journal_lines','acc_settings','organizations','acc_invoices','sales_proformas','acc_customer_tax_ids'] loop
 execute format('alter table %I enable row level security',t);execute format('create policy read_rows on %I for select to authenticated using ((select accounting_access()))',t);execute format('grant select on %I to authenticated',t);end loop;end$$;
 set test.accounting='yes';set test.active='yes';set test.mfa='yes';
 insert into acc_settings values(true,3,'2026-09-30');
 insert into organizations values('00000000-0000-0000-0000-000000000001','Current customer');
 insert into acc_customer_tax_ids values('00000000-0000-0000-0000-000000000001','TIN-1','VRN-1');
 insert into acc_accounts select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'100'||n,'Account '||n,case when n=6 then 'income' when n=7 then 'expense' else 'asset' end,(array['cash','bank','mobile_money','receivables','vat_output',null,null])[n] from generate_series(1,7) n;
 insert into acc_journal_entries values('10000000-0000-0000-0000-000000000001','2026-10-20');
 insert into acc_journal_lines select id,'10000000-0000-0000-0000-000000000001',id,case when system_key in ('cash','bank','mobile_money') then 100 when system_key='receivables' then 600 when account_type='expense' then 200 else 0 end,case when system_key='vat_output' then 50 when account_type='income' then 900 else 0 end from acc_accounts;
 insert into acc_invoices(id,organization_id,invoice_number,invoice_date,due_date,paid_minor,outstanding_minor,status_key,status_label,lines) select ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','INV-'||lpad(n::text,5,'0'),'2026-10-01','2026-10-02',10,600,case when n<=1005 then 'overdue' else 'paid' end,'Overdue','[]'::jsonb from generate_series(1,1006) n;
 insert into organizations values('00000000-0000-0000-0000-000000000002','TRA-only customer');
 insert into acc_customer_tax_ids values('00000000-0000-0000-0000-000000000002','TIN-2','VRN-2');
 update acc_invoices set tra_receipt_number='TRA-RECORDED' where invoice_number in ('INV-01001','INV-01005');
 update acc_invoices set voided_at=now(),status_key='void' where invoice_number='INV-01002';
 update acc_invoices set opening_import_id='90000000-0000-0000-0000-000000000001' where invoice_number='INV-01003';
 update acc_invoices set tra_receipt_number='   ' where invoice_number='INV-01004';
 update acc_invoices set organization_id='00000000-0000-0000-0000-000000000002' where invoice_number='INV-01006';
 insert into sales_proformas select ('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','PF-'||n,'2026-10-20','USD',12345 from generate_series(1,2050) n;`);
 // Exercise the unchanged production arithmetic behind both existing summary RPCs.
 const ledger=read('supabase/migrations/202610160087_accounting_ledger.sql');
 for(const name of ['acc_trial_balance','acc_profit_and_loss']){
  const start=ledger.indexOf('create or replace function public.'+name+'('),end=ledger.indexOf('end $$;',start)+'end $$;'.length;
  assert.ok(start>=0&&end>start);await db.exec(ledger.slice(start,end));
 }
 await db.exec(read('supabase/migrations/202610290131_accounts_overview.sql'));
 await db.exec('set role authenticated');
 const overview=async()=>(await db.query("select acc_overview('2026-10-29') as data")).rows[0].data;
 let data=await overview();assert.deepEqual(data.summary,{money_minor:300,receivables_minor:600,vat_minor:50,profit_minor:700});
 assert.equal(data.overdue_count,1004);assert.equal(data.waiting_count,2050);assert.equal(data.invoices.length,20);assert.equal(data.to_invoice.length,20);assert.equal(data.invoices[0].invoice_number,'INV-01005');
 assert.equal(data.settings.locked_through,'2026-09-30');assert.equal(data.invoices[0].customer_name,'Current customer');assert.deepEqual(data.tax_ids.map(row=>row.tin).sort(),['TIN-1','TIN-2']);assert.ok(data.to_invoice.every(row=>row.currency==='USD'&&row.total_minor===12345));
 assert.equal(data.unrecorded_tra_count,1002);assert.equal(data.unrecorded_tra.length,20);assert.equal(data.unrecorded_tra[0].invoice_number,'INV-01006');assert.equal(data.unrecorded_tra[0].customer_name,'TRA-only customer');
 const eligible=(await db.query("select id::text from acc_invoices where voided_at is null and opening_import_id is null and btrim(tra_receipt_number)='' order by invoice_date desc,invoice_number desc,id")).rows.map(row=>row.id);
 assert.equal(data.unrecorded_tra_count,eligible.length);assert.deepEqual(data.unrecorded_tra.map(row=>row.id),eligible.slice(0,20));assert.ok(data.unrecorded_tra.some(row=>row.invoice_number==='INV-01004'));assert.ok(data.unrecorded_tra.every(row=>!Object.hasOwn(row,'lines')&&!row.voided_at&&!row.opening_import_id&&!row.tra_receipt_number.trim()));
 for(const gate of ['accounting','active','mfa']){await db.exec(`set test.${gate}='no'`);await assert.rejects(overview(),/Accounting access/);await db.exec(`set test.${gate}='yes'`);}
 await db.exec('reset role;set role anon');await assert.rejects(overview(),/permission denied/);
 await db.exec(`reset role;create policy invoice_scope on acc_invoices as restrictive for select to authenticated using(invoice_number<'INV-00011');create policy hide_customer on organizations as restrictive for select to authenticated using(false);create policy hide_tax on acc_customer_tax_ids as restrictive for select to authenticated using(false);set role authenticated`);
 data=await overview();assert.equal(data.overdue_count,10);assert.equal(data.invoices.length,10);assert.ok(data.invoices.every(row=>row.customer_name===null));assert.equal(data.tax_ids.length,0);assert.equal(data.unrecorded_tra_count,10);assert.equal(data.unrecorded_tra.length,10);assert.ok(data.unrecorded_tra.every(row=>row.customer_name===null));
 await db.exec('reset role;create policy hide_all_invoices on acc_invoices as restrictive for select to authenticated using(false);set role authenticated');data=await overview();assert.equal(data.unrecorded_tra_count,0);assert.deepEqual(data.unrecorded_tra,[]);
 await db.exec('reset role');assert.equal((await db.query("select prosecdef from pg_proc where proname='acc_overview'")).rows[0].prosecdef,false);
 assert.equal((await db.query('select count(*)::integer n from acc_invoices')).rows[0].n,1006);
 console.log('PASS: bounded Accounts overview with 20 TRA rows, exact eligible count/ordering, void/opening exclusions and TRA-only tax identities; existing trial/P&L arithmetic, exact counts, source currencies, financial/active/MFA gates, anonymous rejection and caller invoice/customer/tax RLS.');
}finally{await db.close();}
