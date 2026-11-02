// Actual accounting migrations in disposable PostgreSQL; no production connection or writes.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202611020156_accounting_posting_integrity.sql','202611020157_accounting_report_snapshot.sql','202611020157_accounting_report_snapshot.sql']});
const {db,id,as,admin,one,ACCOUNTS,SALES,ORG}=f;
const BANK='a0000000-0000-4000-8000-000000001200',AR='a0000000-0000-4000-8000-000000001300',SALES_ACCOUNT='a0000000-0000-4000-8000-000000004000';
const date='2026-10-01',maximum=9007199254740991,exact='9007199254740993',kinds=['trial','pl','bs','ageing'];
const report=async(kind,from=date,to=date,asOf=date)=>(await one('select acc_financial_report($1,$2,$3,$4) result limit 1',[kind,from,to,asOf])).result;
const direct={
 trial:'select account_id,code,name,account_type,debit_minor::text,credit_minor::text from acc_trial_balance($1)',
 pl:'select account_id,code,name,account_type,amount_minor::text from acc_profit_and_loss($1,$1)',
 bs:'select account_id,code,name,account_type,amount_minor::text from acc_balance_sheet($1)',
 ageing:'select organization_id,customer,current_minor::text,days_1_30_minor::text,days_31_60_minor::text,days_61_90_minor::text,days_over_90_minor::text,unapplied_credit_minor::text,balance_minor::text from acc_receivables_ageing($1)'
};
const counts=()=>one('select (select count(*)::int from acc_journal_entries) entries,(select count(*)::int from acc_journal_lines) lines,(select count(*)::int from acc_receipts) receipts');
try{
 await as(ACCOUNTS);
 for(const kind of kinds){const result=await report(kind);assert.equal(result.kind,kind);assert.equal(result.row_count,result.rows.length);assert.deepEqual(result.rows,(await db.query(direct[kind],[date])).rows);}
 for(const [offset,amount] of [[0,maximum],[1,2]]){
  await db.query('select post_manual_journal($1,$2,$3,$4::jsonb)',[id(9000+offset),date,'Exact large report fixture',JSON.stringify([{account_id:BANK,debit_minor:amount},{account_id:SALES_ACCOUNT,credit_minor:amount}])]);
  await db.query('select record_receipt($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id(9010+offset),ORG,date,String(amount),'bank','Exact large credit fixture',BANK,'[]']);
 }
 // Each report must exceed a typical API row limit using balanced, consistent persisted records.
 await db.exec(`reset role;begin;
 insert into organizations(id,name) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Report customer '||lpad(n::text,4,'0') from generate_series(1,1001)n;
 insert into acc_accounts(id,code,name,account_type) select ('20000000-0000-4000-8000-'||lpad((n*2+s)::text,12,'0'))::uuid,(800000+n*2+s)::text,'Report account '||n||' / '||s,case when s=0 then 'asset' else 'income' end from generate_series(1,1001)n cross join generate_series(0,1)s;
 insert into acc_journal_entries(id,entry_number,entry_date,memo,source_type,created_by) select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REPORT-SALE-'||n,'${date}','Report sale fixture','manual','${ACCOUNTS}' from generate_series(1,1001)n;
 insert into acc_journal_lines(entry_id,line_no,account_id,debit_minor,credit_minor) select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,s+1,('20000000-0000-4000-8000-'||lpad((n*2+s)::text,12,'0'))::uuid,case when s=0 then n else 0 end,case when s=1 then n else 0 end from generate_series(1,1001)n cross join generate_series(0,1)s;
 insert into acc_journal_entries(id,entry_number,entry_date,memo,source_type,source_id,created_by) select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REPORT-RECEIPT-'||n,'${date}','Report receipt fixture','receipt',('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${ACCOUNTS}' from generate_series(1,1001)n;
 insert into acc_journal_lines(entry_id,line_no,account_id,debit_minor,credit_minor,organization_id) select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,s+1,case when s=0 then '${BANK}'::uuid else '${AR}'::uuid end,case when s=0 then 1 else 0 end,case when s=1 then 1 else 0 end,case when s=1 then ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid end from generate_series(1,1001)n cross join generate_series(0,1)s;
 insert into acc_receipts(id,receipt_number,organization_id,receipt_date,amount_minor,method,deposit_account_id,journal_entry_id,created_by) select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REPORT-RCT-'||n,('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${date}',1,'bank','${BANK}',('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${ACCOUNTS}' from generate_series(1,1001)n;
 commit;set role authenticated;`);
 const before=await counts(),results={};
 for(const kind of kinds){
  const result=await report(kind);results[kind]=result;
  assert.equal(result.kind,kind);assert.equal(result.row_count,result.rows.length);assert.ok(result.row_count>1000,kind+' includes all rows within one SQL result row');
  assert.deepEqual(result.rows,(await db.query(direct[kind],[date])).rows,kind+' preserves legacy report values, keys and order');
  for(const row of result.rows)for(const [key,value] of Object.entries(row))if(key.endsWith('_minor')){assert.equal(typeof value,'string');assert.match(value,/^(?:0|-?[1-9]\d*)$/);}
 }
 assert.equal(results.trial.rows.find(row=>row.account_id===SALES_ACCOUNT).credit_minor,exact);
 assert.equal(results.pl.rows.find(row=>row.account_id===SALES_ACCOUNT).amount_minor,exact);
 assert.equal(results.bs.rows.find(row=>row.account_id===null).amount_minor,(BigInt(exact)+501501n).toString());
 assert.equal(results.ageing.rows.find(row=>row.organization_id===ORG).unapplied_credit_minor,exact);
 assert.equal(results.ageing.rows.find(row=>row.organization_id===ORG).balance_minor,'-'+exact);
 const sum=(rows,key)=>rows.reduce((total,row)=>total+BigInt(row[key]),0n);
 assert.equal(sum(results.trial.rows,'debit_minor'),sum(results.trial.rows,'credit_minor'));
 const assets=results.bs.rows.filter(row=>row.account_type==='asset'),other=results.bs.rows.filter(row=>row.account_type!=='asset');
 assert.equal(sum(assets,'amount_minor'),sum(other,'amount_minor'));
 const ar=results.trial.rows.find(row=>row.account_id===AR);assert.equal(BigInt(ar.debit_minor)-BigInt(ar.credit_minor),sum(results.ageing.rows,'balance_minor'));
 for(const kind of kinds){const result=await report(kind,'2026-09-30','2026-09-30','2026-09-30');assert.deepEqual(result.rows,(await db.query(direct[kind],['2026-09-30'])).rows);}
 for(const args of [[null,date,date,date],['ledger',date,date,date],['trial',null,null,null],['ageing',null,null,'infinity'],['bs',null,null,'-infinity'],['pl',null,date,null],['pl',date,null,null],['pl','2026-10-02',date,null],['pl','-infinity',date,null]])await assert.rejects(()=>report(...args),/Choose a (supported financial report|valid report)/);
 await as(SALES);for(const kind of kinds)await assert.rejects(()=>report(kind),/Accounting access/);
 await as('');await assert.rejects(()=>report('trial'),/Accounting access/);await as(ACCOUNTS);
 await admin('update accounting_memberships set active=false where user_id=$1',[ACCOUNTS]);await assert.rejects(()=>report('pl'),/Accounting access/);
 await admin('update accounting_memberships set active=true where user_id=$1',[ACCOUNTS]);
 await admin('update staff set active=false where user_id=$1',[ACCOUNTS]);await assert.rejects(()=>report('bs'),/Accounting access/);
 await admin('update staff set active=true where user_id=$1',[ACCOUNTS]);
 await db.exec('reset role;set role anon');await assert.rejects(()=>report('trial'),/permission denied/);await db.exec('reset role;set role authenticated');
 const definition=await one("select prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'execute') anon_allowed,has_function_privilege('authenticated',oid,'execute') member_allowed,exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) where grantee=0 and privilege_type='EXECUTE') public_allowed from pg_proc where oid='public.acc_financial_report(text,date,date,date)'::regprocedure");
 assert.equal(definition.prosecdef,true);assert.equal(definition.provolatile,'s');assert.ok(definition.proconfig.includes('search_path=public, pg_temp'));assert.equal(definition.anon_allowed,false);assert.equal(definition.public_allowed,false);assert.equal(definition.member_allowed,true);
 assert.deepEqual(await counts(),before,'reporting leaves posted history unchanged');
 console.log('PASS: four report snapshots >1000 rows, exact integer strings above 2^53, legacy values/order/date parity, balanced whole-report totals, AR/ageing parity, empty results, invalid dates/kinds, membership/active/anonymous denial, fixed-path stable ACL and unchanged history.');
}finally{await db.close();}
