// Disposable PostgreSQL using actual accounting, opening import, receipt and ageing migrations.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql']});
const {db,id,as,admin,one,ORG,ACCOUNTS,SALES,OWNER,dates}=f;
const AR='a0000000-0000-4000-8000-000000001300',EQUITY='a0000000-0000-4000-8000-000000003000',BANK='a0000000-0000-4000-8000-000000001200';
let sequence=8200,checks=0;const fresh=()=>id(sequence++),cutover='2026-10-01';
const row=(extra={})=>({reference:'HIST-001',organization_id:ORG,invoice_date:'2026-08-01',due_date:'2026-09-01',amount_minor:12345,currency:'TZS',...extra});
const gl=async(amount=12345,reference='OPEN-AR')=>{const batch=fresh();await db.query('select import_financial_journals($1,$2,$3,$4::jsonb)',[batch,'Legacy GL','opening',JSON.stringify([{reference,date:cutover,memo:'Reviewed opening balance',lines:[{account_id:AR,debit_minor:amount,credit_minor:0,description:'Opening AR'},{account_id:EQUITY,debit_minor:0,credit_minor:amount,description:'Opening equity'}]}])]);return batch;};
const post=(batch,rows=[row()],request=fresh(),source='Legacy AR')=>one('select import_opening_receivables($1,$2,$3,$4,$5::jsonb) result',[request,source,cutover,batch,JSON.stringify(rows)]).then(r=>r.result);
const preview=(batch,rows=[row()])=>one('select opening_receivables_check($1,$2,$3,$4::jsonb) result',['Legacy AR',cutover,batch,JSON.stringify(rows)]).then(r=>r.result);
const count=table=>one(`select count(*)::int n from ${table}`).then(r=>r.n);
const reject=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const check=async(name,fn)=>{await db.exec('begin');await as(ACCOUNTS);try{await fn();await db.exec('set constraints all immediate');checks++;console.log('PASS: '+name);}finally{await db.exec('rollback');}};
try{
 await check('opening residuals reconcile to GL without creating sales, journals or stock',async()=>{
  const batch=await gl(),before={journals:await count('acc_journal_entries'),sales:await count('sales_proformas'),stock:await count('inventory_movements')};
  assert.equal((await preview(batch)).difference_minor,0);const result=await post(batch),invoice=await one('select * from acc_invoice_balances where id=$1',[result.invoices[0].invoice_id]);
  assert.equal(invoice.opening_reference,'HIST-001');assert.equal(new Date(invoice.opening_cutover_date).toISOString().slice(0,10),cutover);assert.equal(invoice.proforma_id,null);assert.equal(invoice.journal_entry_id,null);assert.equal(Number(invoice.outstanding_minor),12345);assert.equal(Number(invoice.credited_minor),0);
  assert.deepEqual({journals:await count('acc_journal_entries'),sales:await count('sales_proformas'),stock:await count('inventory_movements')},before);
  assert.equal(Number((await one('select sum(balance_minor)::bigint n from acc_receivables_ageing($1)',[cutover])).n),12345);
  assert.equal(Number((await one("select coalesce(sum(balance_minor),0)::bigint n from acc_receivables_ageing('2026-09-30')")).n),0);
 });
 await check('same request and identical re-upload never duplicate residuals',async()=>{
  const batch=await gl(),request=fresh(),first=await post(batch,[row()],request);assert.equal((await post(batch,[row()],request)).batch_id,first.batch_id);assert.equal((await post(batch)).batch_id,first.batch_id);assert.equal(await count('acc_invoices'),1);
  assert.equal((await one('select opening_receivables_status($1) r',[request])).r.batch_id,request);
  await reject(()=>post(batch,[row({amount_minor:999})],request),/different details/);
  await reject(()=>post(batch,[row()],fresh(),'Different source'),/different details/);
 });
 await check('GL mismatch and broader AR mismatch both fail without partial rows',async()=>{
  const batch=await gl();await reject(()=>post(batch,[row({amount_minor:1})]),/does not equal/);assert.equal(await count('acc_invoices'),0);
  await db.query('select post_manual_journal($1,$2,$3,$4::jsonb)',[fresh(),cutover,'Unexplained AR difference',JSON.stringify([{account_id:AR,debit_minor:100,credit_minor:0},{account_id:EQUITY,debit_minor:0,credit_minor:100}])]);
  await reject(()=>post(batch),/AR reconciliation failed/);assert.equal(await count('acc_invoices'),0);
 });
 await check('inactive or named customers, currencies, precision, dates and duplicates fail',async()=>{
  const batch=await gl();for(const bad of [row({organization_id:'Fictional Clinic'}),row({organization_id:fresh()}),row({currency:'USD'}),row({currency:null}),row({amount_minor:1.1}),row({amount_minor:-1}),row({invoice_date:'2026-10-02'}),row({due_date:'2026-07-01'})])await reject(()=>post(batch,[bad]),/./);
  await reject(()=>post(batch,[row(),row()]),/unique/);await reject(()=>post(batch,[row({extra:'ignored'})]),/only/);
  await admin('update organizations set deleted_at=now() where id=$1',[ORG]);await reject(()=>post(batch),/archived/);assert.equal(await count('acc_invoices'),0);
 });
 await check('ordinary receipts settle the residual; historic allocations and ordinary void fail',async()=>{
  const result=await post(await gl()),invoice=result.invoices[0].invoice_id;
  const receipt=date=>one("select * from record_receipt($1,$2,$3,2345,'bank','Settlement',$4,$5::jsonb)",[fresh(),ORG,date,BANK,JSON.stringify([{invoice_id:invoice,amount_minor:2345}])]);
  await reject(()=>receipt(cutover),/after its cutover/);await receipt('2026-10-02');
  assert.equal(Number((await one('select outstanding_minor from acc_invoice_balances where id=$1',[invoice])).outstanding_minor),10000);
  assert.equal(Number((await one("select sum(balance_minor)::bigint n from acc_receivables_ageing('2026-10-02')")).n),10000);
  await reject(()=>db.query('select void_invoice($1,$2,$3)',[invoice,dates.today,'Wrong opening residual']),/Opening receivables cannot/);
 });
 await check('SQL access, RLS and immutable history remain accounting-only',async()=>{
  const batch=await gl(),result=await post(batch);await as(SALES);await reject(()=>preview(batch),/Accounting access/);await reject(()=>post(batch),/Accounting access/);await reject(()=>one('select opening_receivables_status($1)',[result.batch_id]),/Accounting access/);
  assert.equal(await count('acc_opening_receivable_imports'),0);assert.equal(await count('acc_opening_receivable_refs'),0);
  await as(ACCOUNTS);assert.equal((await one("select has_function_privilege('anon','public.import_opening_receivables(uuid,text,date,uuid,jsonb)','execute') allowed")).allowed,false);
  await reject(()=>db.query('delete from acc_opening_receivable_imports where id=$1',[result.batch_id]),/permission denied/);
  await db.exec('reset role');await reject(()=>db.query('update acc_opening_receivable_imports set source=$1 where id=$2',['changed',result.batch_id]),/cannot be changed/);await db.exec('set role authenticated');
 });
 await check('source/reference and linked-GL identities prevent duplicate balances across batches',async()=>{
  const first=await gl();await post(first);const second=await gl(12345,'OPEN-SECOND');await reject(()=>post(second),/already imported/);assert.equal(await count('acc_invoices'),1);
 });
 await check('reversed GL imports and locked cutovers cannot be attached',async()=>{
  const batch=await gl(),entry=await one('select entry_id from acc_imported_journals where import_id=$1',[batch]);
  await db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),entry.entry_id,dates.today,'Incorrect opening journal']);await reject(()=>post(batch),/unreversed/);
 });
 await check('locked cutovers reject new residuals but confirmed imports remain recoverable',async()=>{
  const batch=await gl();await as(OWNER);await db.query('select set_books_lock(1,$1)',[cutover]);await as(ACCOUNTS);await reject(()=>post(batch),/locked through/);
 });
 console.log(`PASS: ${checks} opening receivables database scenarios.`);
}finally{await db.close();}
