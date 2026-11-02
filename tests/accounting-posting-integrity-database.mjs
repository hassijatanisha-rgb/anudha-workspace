// Actual migrations in disposable PostgreSQL; no production connection or writes.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202611020156_accounting_posting_integrity.sql','202611020156_accounting_posting_integrity.sql']});
const {db,id,as,one,ORG,ACCOUNTS,SALES,dates}=f;
const AR='a0000000-0000-4000-8000-000000001300',BANK='a0000000-0000-4000-8000-000000001200',CASH='a0000000-0000-4000-8000-000000001100',EQUITY='a0000000-0000-4000-8000-000000003000',RENT='a0000000-0000-4000-8000-000000006100';
let sequence=9100,checks=0;const fresh=()=>id(sequence++),cutover='2026-10-01';
const lines=(amount=10000,account=RENT)=>[{account_id:account,debit_minor:amount,credit_minor:0,description:'First line'},{account_id:BANK,debit_minor:0,credit_minor:amount,description:'Second line'}];
const manual=(request,payload=lines(),memo='Reviewed journal',date=dates.today)=>one('select * from post_manual_journal($1,$2,$3,$4::jsonb)',[request,date,memo,JSON.stringify(payload)]);
const imported=async(kind='opening',payload=lines(20000,AR))=>{const batch=fresh();await db.query('select import_financial_journals($1,$2,$3,$4::jsonb)',[batch,'Reviewed legacy',kind,JSON.stringify([{reference:'ENTRY-'+batch,date:cutover,memo:'Reviewed opening journal',lines:payload}])]);return batch;};
const attach=async batch=>{
 const rows=['A','B'].map(reference=>({reference,organization_id:ORG,invoice_date:'2026-09-01',due_date:'2026-09-30',amount_minor:10000,currency:'TZS'}));
 return (await one('select import_opening_receivables($1,$2,$3,$4,$5::jsonb) result',[fresh(),'Reviewed residuals',cutover,batch,JSON.stringify(rows)])).result;
};
const receipt=(request,allocations,extra={})=>one('select * from record_receipt($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[request,ORG,dates.today,10000,extra.method??'bank',extra.reference??'Reviewed receipt',extra.deposit??BANK,allocations===null?null:JSON.stringify(allocations)]);
const reject=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const check=async(name,fn)=>{await db.exec('begin');await as(ACCOUNTS);try{await fn();await db.exec('set constraints all immediate');checks++;console.log('PASS: '+name);}finally{await db.exec('rollback');}};
try{
 await check('manual and transaction-import AR postings fail atomically; opening GL and residuals reconcile',async()=>{
  await reject(()=>manual(fresh(),lines(10000,AR)),/receivables control account/);
  await reject(()=>imported('journal'),/receivables control account/);
  assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,0);
  const batch=await imported(),entry=await one('select entry_id from acc_imported_journals where import_id=$1',[batch]);
  assert.equal((await manual(entry.entry_id,lines(20000,AR),'Reviewed opening journal',cutover)).id,entry.entry_id,'an existing AR posting stays recoverable by its exact request');
  const result=await attach(batch);assert.equal(result.difference_minor,0);assert.equal(result.reconciled,true);
  const gl=await one('select sum(debit_minor-credit_minor)::bigint n from acc_journal_lines where account_id=$1',[AR]);
  assert.equal(Number(gl.n),Number((await one('select sum(balance_minor)::bigint n from acc_receivables_ageing($1)',[dates.today])).n));
 });
 await check('manual exact retries match normalized optional fields and do not duplicate',async()=>{
  const request=fresh(),payload=lines(),first=await manual(request,payload);
  assert.equal((await manual(request,payload,'  Reviewed journal  ')).id,first.id);
  const normalized=payload.map(l=>({...l,organization_id:null}));delete normalized[0].credit_minor;delete normalized[1].debit_minor;
  assert.equal((await manual(request,normalized)).id,first.id);
  assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,1);
 });
 await check('manual retries reject changed amounts, accounts, line count/order, customer, descriptions and header',async()=>{
  const request=fresh();await manual(request);
  const changed=[lines(20000),lines(10000,CASH),lines().reverse(),[...lines(),...lines()],lines().map((l,i)=>i?l:{...l,organization_id:ORG}),lines().map((l,i)=>i?l:{...l,description:'Changed'})];
  for(const payload of changed)await reject(()=>manual(request,payload),/different details/);
  await reject(()=>manual(request,lines(),'Different memo'),/different details/);
  await reject(()=>manual(request,lines(),'Reviewed journal',dates.delivery),/different details/);
  await reject(()=>manual(request,lines(),null),/required/);
  assert.equal(Number((await one('select sum(debit_minor)::bigint n from acc_journal_lines where entry_id=$1',[request])).n),10000);
 });
 await check('receipt exact retries normalize allocation order and leave one receipt',async()=>{
  const result=await attach(await imported()),[a,b]=result.invoices.map(i=>i.invoice_id),request=fresh();
  const payload=[{invoice_id:a,amount_minor:4000},{invoice_id:b,amount_minor:6000}],first=await receipt(request,payload);
  assert.equal((await receipt(request,[...payload].reverse(),{reference:'  Reviewed receipt  '})).id,first.id);
  assert.equal((await one('select count(*)::int n from acc_receipts')).n,1);
  assert.equal(Number((await one('select sum(amount_minor)::bigint n from acc_receipt_allocations')).n),10000);
 });
 await check('receipt retries reject changed allocation amount/target, method, reference and deposit',async()=>{
  const result=await attach(await imported()),[a,b]=result.invoices.map(i=>i.invoice_id),request=fresh(),payload=[{invoice_id:a,amount_minor:10000}];await receipt(request,payload);
  for(const allocation of [[],[{invoice_id:b,amount_minor:10000}],[{invoice_id:a,amount_minor:9000}],[...payload,...payload]])await reject(()=>receipt(request,allocation),/different details/);
  for(const extra of [{method:'cash'},{reference:'Changed reference'},{deposit:CASH}])await reject(()=>receipt(request,payload,extra),/different details/);
  assert.equal(Number((await one('select paid_minor from acc_invoice_balances where id=$1',[a])).paid_minor),10000);
  assert.equal(Number((await one('select paid_minor from acc_invoice_balances where id=$1',[b])).paid_minor),0);
 });
 await check('unallocated receipt exact retries remain valid and allocated retries cannot claim it',async()=>{
  const result=await attach(await imported()),request=fresh(),first=await receipt(request,[]);
  assert.equal((await receipt(request,null)).id,first.id);
  await reject(()=>receipt(request,[{invoice_id:result.invoices[0].invoice_id,amount_minor:10000}]),/different details/);
 });
 await check('attached opening journals cannot reverse and keep AR reconciled',async()=>{
  const batch=await imported(),result=await attach(batch),entry=await one('select entry_id from acc_imported_journals where import_id=$1',[batch]);
  await reject(()=>db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),entry.entry_id,dates.today,'Incorrect opening journal']),/attached customer residuals cannot be reversed/);
  assert.equal((await one("select count(*)::int n from acc_journal_entries where source_type='reversal'")).n,0);
  assert.equal(Number((await one('select sum(balance_minor)::bigint n from acc_receivables_ageing($1)',[dates.today])).n),20000);
  assert.equal(result.control_ar_minor,20000);
 });
 await check('unattached opening journals and ordinary journals still reverse; reversed GL cannot attach',async()=>{
  const batch=await imported(),entry=await one('select entry_id from acc_imported_journals where import_id=$1',[batch]);
  const request=fresh();await db.query('select reverse_journal_entry($1,$2,$3,$4)',[request,entry.entry_id,dates.today,'Incorrect opening journal']);
  await db.query('select reverse_journal_entry($1,$2,$3,$4)',[request,entry.entry_id,dates.today,'Incorrect opening journal']);
  await reject(()=>attach(batch),/unreversed/);
  const journal=await manual(fresh());await db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),journal.id,dates.today,'Incorrect ordinary journal']);
  assert.equal((await one("select count(*)::int n from acc_journal_entries where source_type='reversal'")).n,2);
 });
 await check('reversal retries verify date, reason and original entry, and require an identity',async()=>{
  const journal=await manual(fresh()),request=fresh();
  const reverse=(requestId=request,entry=journal.id,date=dates.today,reason='Incorrect ordinary journal')=>one('select * from reverse_journal_entry($1,$2,$3,$4)',[requestId,entry,date,reason]);
  const first=await reverse();assert.equal((await reverse(request,journal.id,dates.today,'  Incorrect ordinary journal  ')).id,first.id);
  await reject(()=>reverse(request,journal.id,dates.delivery),/different details/);
  await reject(()=>reverse(request,journal.id,dates.today,'Changed reversal reason'),/different details/);
  await reject(()=>reverse(request,fresh()),/different details/);
  await reject(()=>reverse(null),/required/);await reject(()=>reverse(fresh(),journal.id,null),/required/);
  assert.equal((await one("select count(*)::int n from acc_journal_entries where source_type='reversal'")).n,1);
 });
 await check('posting access stays accounting-only and internal opening poster remains inaccessible',async()=>{
  await as(SALES);await reject(()=>manual(fresh()),/Accounting access/);await reject(()=>imported(),/Accounting access/);
  await as(ACCOUNTS);
  for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.acc_post(uuid,date,text,text,uuid,uuid,jsonb)','execute') allowed",[role])).allowed,false);
 });
 console.log(`PASS: ${checks} accounting posting integrity database scenarios.`);
}finally{await db.close();}
