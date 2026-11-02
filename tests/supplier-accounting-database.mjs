// Actual supplier migration in disposable PostgreSQL. No live database connection or writes.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:[...(process.env.SUPPLIER_INTEGRATION==='1'?['202610070073_receive_transfer_available_lot.sql','202610200120_machine_serial_requirement.sql','202610200121_receiving_machine_serials.sql']:[]),'202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202611020156_accounting_posting_integrity.sql','202611020157_accounting_report_snapshot.sql','202611020158_supplier_accounting.sql',...(process.env.SUPPLIER_INTEGRATION==='1'?['202611020159_inventory_cost_accounting.sql','202611020160_customer_credit_settlement.sql']:[])]});
const {db,id,as,admin,one,ACCOUNTS,SALES,OWNER,dates,MACHINE}=f;
const BANK='a0000000-0000-4000-8000-000000001200',CASH='a0000000-0000-4000-8000-000000001100',RENT='a0000000-0000-4000-8000-000000006100',AP='a0000000-0000-4000-8000-000000002100',VAT='a0000000-0000-4000-8000-000000001500',STOCK='a0000000-0000-4000-8000-000000001400',EQUITY='a0000000-0000-4000-8000-000000003000';
const supplier=id(9400),other=id(9401),day=dates.today,cutover='2026-10-01';
const {later,last}=await one('select (current_date+1)::text later,(current_date+2)::text last');
let sequence=9500,checks=0;const fresh=()=>id(sequence++);
const rpc=async(name,args)=>(await one(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).result;
const line=(net='10000',tax='1800')=>({account_id:RENT,net_minor:net,tax_minor:tax,description:'Reviewed expense'});
const bill=(request=fresh(),lines=[line()],extra={})=>rpc('post_supplier_bill',[request,extra.supplier??supplier,extra.date??day,extra.due??later,extra.reference??('INV-'+request),JSON.stringify(lines),extra.po??null]);
const payment=(request,amount,allocations=[],extra={})=>rpc('post_supplier_payment',[request,extra.supplier??supplier,extra.date??day,amount,extra.method??'bank',extra.reference??'Reviewed payment',extra.account??BANK,JSON.stringify(allocations)]);
const alloc=(bill_id,amount_minor)=>({bill_id,amount_minor});
const page=(date=day,sid=null,bid=null)=>rpc('get_supplier_books_page',[date,sid,bid]);
const reject=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const count=()=>one('select (select count(*)::int from acc_journal_entries) entries,(select count(*)::int from acc_supplier_bills) bills,(select count(*)::int from acc_supplier_payments) payments');
const check=async(name,fn)=>{await db.exec('begin');await as(ACCOUNTS);try{await fn();await db.exec('set constraints all immediate');checks++;console.log('PASS: '+name);}finally{await db.exec('rollback');}};
const openRows=()=>[{reference:'OPEN-BILL',supplier_id:supplier,bill_date:'2026-09-01',due_date:'2026-09-30',amount_minor:'10000',currency:'TZS'},{reference:'OPEN-ADVANCE',supplier_id:supplier,bill_date:'2026-09-10',due_date:'2026-09-10',amount_minor:'-2000',currency:'TZS'}];
const opening=async()=>{
 const batch=fresh();await rpc('import_financial_journals',[batch,'Reviewed supplier opening','opening',JSON.stringify([{reference:batch,date:cutover,memo:'Reviewed supplier opening GL',lines:[{account_id:EQUITY,debit_minor:8000,credit_minor:0,description:'Opening equity'},{account_id:AP,debit_minor:0,credit_minor:8000,description:'Opening payables'}]}])]);
 return batch;
};
try{
 await admin("insert into suppliers(id,supplier_number,name,created_by) values($1,'SUP-TEST-1','Reviewed supplier',$3),($2,'SUP-TEST-2','Other supplier',$3)",[supplier,other,OWNER]);
 await check('expense bill posts entered net/tax and payable once; exact retry survives lock and rejects every changed field',async()=>{
 const request=fresh(),first=await bill(request);
 assert.equal(first.net_minor,'10000');assert.equal(first.tax_minor,'1800');assert.equal(first.total_minor,'11800');
 const entries=await one('select sum(debit_minor)::text debit,sum(credit_minor)::text credit from acc_journal_lines where entry_id=$1',[first.journal_entry_id]);assert.deepEqual(entries,{debit:'11800',credit:'11800'});
 assert.equal((await one('select debit_minor::text amount from acc_journal_lines where entry_id=$1 and account_id=$2',[first.journal_entry_id,VAT])).amount,'1800');
 await admin('update acc_settings set locked_through=$1 where id',[day]);
 assert.deepEqual(await bill(request,[line()],{reference:'  INV-'+request+'  '}),first);
 for(const change of [{date:later,due:later},{due:last},{reference:'Changed'},{supplier:other},{po:fresh()}])await reject(()=>bill(request,[line()],change),/different details/);
 await reject(()=>bill(request,[line('9999')]),/different details/);await reject(()=>bill(request,[{...line(),description:'Different'}]),/different details/);
 await reject(()=>bill(),/locked/);assert.deepEqual(await count(),{entries:1,bills:1,payments:0});
 assert.equal((await page()).summary.reconciled,true);
 });
 await check('bill validation rejects guessed tax, invalid dates/accounts, duplicate references and unverified stock atomically',async()=>{
 const before=await count();
 for(const lines of [[{account_id:RENT,net_minor:'1'}],[line('1.2','0')],[line('1','1.0')],[line('0','0')],[{...line(),account_id:AP}],[{...line(),account_id:STOCK,product_id:MACHINE,stock_receipt_id:fresh(),stock_quantity:'1'}],[{...line(),product_id:MACHINE}]])await reject(()=>bill(fresh(),lines),/explicit integer|positive|expense account|verified receipt|inventory account|receipt|Receipt|Activate verified opening inventory/);
 await reject(()=>bill(fresh(),[line()],{date:'infinity',due:'infinity'}),/valid bill/);
 await reject(()=>bill(fresh(),[line()],{due:'2026-01-01'}),/valid bill/);
 assert.deepEqual(await count(),before);
 await bill(fresh(),[line()],{reference:'Same reference'});await reject(()=>bill(fresh(),[line()],{reference:' same REFERENCE '}),/unique constraint/);
 });
 await check('payments allocate exactly, retain advances, prohibit overallocations and reject changed retries',async()=>{
 const b=await bill(),request=fresh(),payload=[alloc(b.id,'4000')];
 const p=await payment(request,'6000',payload);assert.equal(p.amount_minor,'6000');
 assert.deepEqual(await payment(request,'6000',payload),p);
 for(const changed of [[],[alloc(b.id,'3999')],[...payload,...payload]])await reject(()=>payment(request,'6000',changed),/different details|only once/);
 for(const change of [{date:later},{reference:'Changed'},{supplier:other},{method:'cash',account:CASH}])await reject(()=>payment(request,'6000',payload,change),/different details/);
 await reject(()=>payment(fresh(),'8000',[alloc(b.id,'8000')]),/outstanding/);
 await reject(()=>payment(fresh(),'1000',[alloc(b.id,'2000')]),/unapplied/);
 await reject(()=>payment(fresh(),'1000',[],{account:RENT}),/asset account/);

 const a=fresh();await rpc('allocate_supplier_payment',[a,p.id,later,JSON.stringify([alloc(b.id,'1000')])]);
 await rpc('allocate_supplier_payment',[a,p.id,later,JSON.stringify([alloc(b.id,'1000')])]);
 await reject(()=>rpc('allocate_supplier_payment',[a,p.id,later,JSON.stringify([alloc(b.id,'999')])]),/different details/);
 const before=await page(day),after=await page(later);assert.equal(before.bills[0].paid_minor,'4000');assert.equal(after.bills[0].paid_minor,'5000');assert.equal(after.payments[0].unapplied_minor,'1000');assert.equal(after.summary.reconciled,true);
 });
 await check('supplier refunds cap to advances, preserve historical dates, enforce chronological reuse and reverse exactly',async()=>{
 const p=await payment(fresh(),'3000'),r=fresh();
 const refund=()=>rpc('post_supplier_refund',[r,p.id,later,'2000','bank','Supplier returned excess',BANK]);await refund();await refund();
 await reject(()=>rpc('post_supplier_refund',[r,p.id,later,'1999','bank','Supplier returned excess',BANK]),/different details/);
 await reject(()=>rpc('post_supplier_refund',[fresh(),p.id,later,'1001','bank','Excess',BANK]),/unapplied/);

 assert.equal((await page(day)).summary.balance_minor,'-3000');assert.equal((await page(later)).summary.balance_minor,'-1000');
 await rpc('void_supplier_refund',[r,last,'Bank refund reversed']);await rpc('void_supplier_refund',[r,last,'Bank refund reversed']);
 await reject(()=>rpc('void_supplier_refund',[r,last,'Changed refund reason']),/different details/);
 assert.equal((await page(last)).summary.balance_minor,'-3000');assert.equal((await page(last)).summary.reconciled,true);
 await rpc('void_supplier_payment',[p.id,last,'Payment was duplicated']);assert.equal((await page(last)).summary.balance_minor,'0');
 });
 await check('supplier expense credits reverse explicit original net/tax within remaining limits with exact corrections',async()=>{
 const b=await bill(),request=fresh(),lines=JSON.stringify([{line_no:1,net_minor:'1000',tax_minor:'180'}]);
 const credit=()=>rpc('post_supplier_credit',[request,b.id,later,'SC-001','Supplier price correction',lines]);const c=await credit();assert.equal(c.total_minor,'1180');await credit();
 await reject(()=>rpc('post_supplier_credit',[request,b.id,later,'SC-002','Supplier price correction',lines]),/different details/);
 await reject(()=>rpc('post_supplier_credit',[fresh(),b.id,later,'SC-003','Supplier price correction',JSON.stringify([{line_no:1,net_minor:'9001',tax_minor:'0'}])]),/original net/);
 assert.equal((await page(day)).bills[0].outstanding_minor,'11800');assert.equal((await page(later)).bills[0].outstanding_minor,'10620');assert.equal((await page(later)).summary.reconciled,true);
 await reject(()=>rpc('void_supplier_bill',[b.id,later,'Incorrect supplier bill']),/credits first/);
 await rpc('void_supplier_credit',[c.id,last,'Supplier corrected credit']);await rpc('void_supplier_credit',[c.id,last,'Supplier corrected credit']);
 assert.equal((await page(last)).bills[0].outstanding_minor,'11800');assert.equal((await page(last)).summary.reconciled,true);
 });
 await check('credits on paid bills free original payments for supplier refunds and cannot reverse consumed credit',async()=>{
 const b=await bill(),p=await payment(fresh(),'11800',[alloc(b.id,'11800')]),creditId=fresh(),payload=JSON.stringify([{line_no:1,net_minor:'1000',tax_minor:'180'}]);
 const credit=()=>rpc('post_supplier_credit',[creditId,b.id,later,'PAID-CREDIT','Returned paid expense',payload]);await credit();await credit();
 assert.equal((await one('select count(*)::int n from acc_supplier_credit_releases')).n,1);
 const before=await page(day),after=await page(later);assert.equal(before.bills[0].paid_minor,'11800');assert.equal(after.bills[0].paid_minor,'10620');assert.equal(after.bills[0].credited_minor,'1180');assert.equal(after.bills[0].outstanding_minor,'0');assert.equal(after.payments[0].unapplied_minor,'1180');assert.equal(after.summary.balance_minor,'-1180');assert.equal(after.summary.reconciled,true);
 const refund=fresh();await rpc('post_supplier_refund',[refund,p.id,later,'1180','bank','Refund paid supplier credit',BANK]);assert.equal((await page(later)).summary.balance_minor,'0');
 await reject(()=>rpc('void_supplier_credit',[creditId,last,'Supplier cancelled credit']),/overallocated|used while void/);
 await rpc('void_supplier_refund',[refund,last,'Refund was cancelled']);await rpc('void_supplier_credit',[creditId,last,'Supplier cancelled credit']);
 assert.equal((await page(last)).payments[0].unapplied_minor,'0');assert.equal((await page(last)).summary.reconciled,true);
 });
 await check('backdated credit releases later applications on their effective dates without reusing earlier funds',async()=>{
 const b=await bill(),p=await payment(fresh(),'11800'),allocation=fresh();await rpc('allocate_supplier_payment',[allocation,p.id,later,JSON.stringify([alloc(b.id,'11800')])]);
 const creditId=fresh();await rpc('post_supplier_credit',[creditId,b.id,day,'BACK-CREDIT','Backdated supplier credit',JSON.stringify([{line_no:1,net_minor:'1000',tax_minor:'180'}])]);
 const before=await page(day),after=await page(later);assert.equal(before.payments[0].unapplied_minor,'11800');assert.equal(after.payments[0].unapplied_minor,'1180');assert.equal(before.credit_releases.length,0);assert.equal(after.credit_releases[0].release_date,later);
 await rpc('post_supplier_refund',[fresh(),p.id,day,'1180','bank','Refund against supplier credit',BANK]);
 assert.equal((await page(day)).summary.reconciled,true);assert.equal((await page(later)).summary.reconciled,true);
 await reject(()=>rpc('void_supplier_credit',[creditId,day,'Credit correction before refund']),/overallocated/);
 });
 await check('payment void reverses GL and applications together; bill void follows history and retries match reason/date',async()=>{
 const b=await bill(),p=await payment(fresh(),'11800',[alloc(b.id,'11800')]);
 await reject(()=>rpc('void_supplier_bill',[b.id,later,'Incorrect supplier bill']),/allocations/);
 const v=await rpc('void_supplier_payment',[p.id,later,'Payment was duplicated']);assert.ok(v.void_entry_id);
 assert.deepEqual(await rpc('void_supplier_payment',[p.id,later,'Payment was duplicated']),v);
 await reject(()=>rpc('void_supplier_payment',[p.id,last,'Payment was duplicated']),/different details/);
 assert.equal((await page(day)).bills[0].outstanding_minor,'0');assert.equal((await page(later)).bills[0].outstanding_minor,'11800');
 await reject(()=>rpc('void_supplier_bill',[b.id,day,'Incorrect supplier bill']),/overallocated|while void/);
 const voided=await rpc('void_supplier_bill',[b.id,last,'Incorrect supplier bill']);assert.ok(voided.void_entry_id);assert.equal((await page(last)).bills[0].status_key,'void');assert.equal((await page(last)).summary.reconciled,true);
 await admin('update acc_settings set locked_through=$1 where id',[last]);assert.deepEqual(await rpc('void_supplier_bill',[b.id,last,'Incorrect supplier bill']),voided);
 });
 await check('backdated settlements are allowed when valid and checked against later use/reversal boundaries',async()=>{
 const b=await bill(),p=await payment(fresh(),'11800');
 const a=fresh();await rpc('allocate_supplier_payment',[a,p.id,later,JSON.stringify([alloc(b.id,'6000')])]);
 const back=fresh();await rpc('allocate_supplier_payment',[back,p.id,day,JSON.stringify([alloc(b.id,'5800')])]);
 assert.equal((await page(day)).bills[0].paid_minor,'5800');assert.equal((await page(later)).bills[0].paid_minor,'11800');
 await rpc('void_supplier_allocation',[a,last,'Correct future allocation']);
 await reject(()=>rpc('allocate_supplier_payment',[fresh(),p.id,day,JSON.stringify([alloc(b.id,'6000')])]),/overallocated/);
 const advance=await payment(fresh(),'2000',[],{date:day}),r=fresh();
 await rpc('post_supplier_refund',[r,advance.id,later,'2000','bank','Later refund',BANK]);
 await rpc('void_supplier_refund',[r,last,'Later refund correction']);
 await reject(()=>rpc('post_supplier_refund',[fresh(),advance.id,day,'2000','bank','Backdated reuse',BANK]),/overallocated/);
 await rpc('post_supplier_refund',[fresh(),advance.id,last,'2000','bank','Valid reuse',BANK]);
 for(const date of [day,later,last])assert.equal((await page(date)).summary.reconciled,true);
 });
 await check('opening signed supplier schedule matches imported GL without duplicate entries and pays from opening advances',async()=>{
 const batch=await opening(),request=fresh(),before=await count(),rows=openRows();
 const preview=await rpc('opening_payables_check',['Reviewed supplier schedule',cutover,batch,JSON.stringify(rows)]);assert.equal(preview.difference_minor,'0');
 const result=await rpc('import_opening_payables',[request,'Reviewed supplier schedule',cutover,batch,JSON.stringify(rows)]);
 assert.deepEqual(await rpc('import_opening_payables',[request,'Reviewed supplier schedule',cutover,batch,JSON.stringify(rows)]),result);assert.equal((await count()).entries,before.entries);
 assert.equal((await page('2026-09-30')).summary.balance_minor,'0');assert.equal((await page(cutover)).summary.balance_minor,'8000');assert.equal((await page(cutover)).summary.reconciled,true);
 await reject(()=>rpc('allocate_supplier_payment',[fresh(),result.payments[0].payment_id,cutover,JSON.stringify([alloc(result.bills[0].bill_id,'2000')])]),/after opening cutover/);
 await rpc('allocate_supplier_payment',[fresh(),result.payments[0].payment_id,day,JSON.stringify([alloc(result.bills[0].bill_id,'2000')])]);
 await payment(fresh(),'8000',[alloc(result.bills[0].bill_id,'8000')]);assert.equal((await page()).summary.balance_minor,'0');assert.equal((await page()).summary.reconciled,true);
 await reject(()=>rpc('correct_opening_payables',[fresh(),request,JSON.stringify(rows),'Fix supplier references']),/settlement history/);
 const entry=await one('select entry_id from acc_imported_journals where import_id=$1',[batch]);await reject(()=>rpc('reverse_journal_entry',[fresh(),entry.entry_id,day,'Wrong opening GL']),/attached supplier schedules/);
 });
 await check('opening schedule corrections preserve old rows, replace atomically and reject imbalance or changed retries',async()=>{
 const batch=await opening(),request=fresh(),rows=openRows();await rpc('import_opening_payables',[request,'Schedule',cutover,batch,JSON.stringify(rows)]);
 const revised=rows.map((r,i)=>({...r,reference:r.reference+'-FIX',supplier_id:i?other:supplier})),correction=fresh();
 const result=await rpc('correct_opening_payables',[correction,request,JSON.stringify(revised),'Correct supplier assignment']);assert.equal(result.difference_minor,'0');
 assert.deepEqual(await rpc('correct_opening_payables',[correction,request,JSON.stringify(revised),'Correct supplier assignment']),result);
 await reject(()=>rpc('correct_opening_payables',[correction,request,JSON.stringify(rows),'Correct supplier assignment']),/different details/);
 const before=await count();await reject(()=>rpc('correct_opening_payables',[fresh(),correction,JSON.stringify(revised.map((r,i)=>i?r:{...r,amount_minor:'9999'})),'Correct amount']),/differs from imported/);assert.deepEqual(await count(),before);
 assert.equal((await page(cutover)).summary.reconciled,true);assert.equal((await one('select count(*)::int n from acc_supplier_bills where voided_on is not null')).n,1);
 });
 await check('AP manual bypass is denied; currency/date/ownership failures do not post',async()=>{
 await reject(()=>rpc('post_manual_journal',[fresh(),day,'AP bypass attempt',JSON.stringify([{account_id:AP,credit_minor:'1000'},{account_id:RENT,debit_minor:'1000'}])]),/payables control account/);
 const b=await bill();await reject(()=>payment(fresh(),'100',[alloc(b.id,'100')],{supplier:other}),/another supplier/);
 await reject(()=>payment(fresh(),'100',[],{date:'infinity'}),/valid date/);
 await reject(()=>rpc('get_supplier_books_page',['infinity',null,null]),/valid report date/);
 await as(SALES);await reject(()=>bill(),/Accounting access/);await reject(()=>page(),/Accounting access/);await as('');await reject(()=>page(),/Accounting access/);await as(ACCOUNTS);
 await reject(()=>db.query('update acc_supplier_bills set reference=$1 where id=$2',['Tamper',b.id]),/permission denied/);
 for(const name of ['acc_supplier_lock()','acc_supplier_date(date)','acc_supplier_bill_paid(uuid,date)','acc_void_supplier_record(text,uuid,date,text)'])assert.equal((await one('select has_function_privilege($1,$2,$3) allowed',['authenticated','public.'+name,'execute'])).allowed,false);
 assert.equal((await one("select has_function_privilege('anon','public.post_supplier_bill(uuid,uuid,date,date,text,jsonb,uuid)','execute') allowed")).allowed,false);
 });
 await check('added cash/bank accounts are accepted; archived membership and direct history mutation are denied',async()=>{
 const account=fresh();await admin("insert into acc_accounts(id,code,name,account_type) values($1,'1201','Second TZS bank','asset')",[account]);
 const p=await payment(fresh(),'100',[],{account,method:'cheque'});assert.equal(p.payment_account_id,account);assert.ok((await page()).accounts.some(a=>a.id===account));
 await db.exec('reset role');await reject(()=>db.query("update acc_supplier_payments set reference='tamper' where id=$1",[p.id]),/immutable/);await db.exec('set role authenticated');
 await admin('update accounting_memberships set active=false where user_id=$1',[ACCOUNTS]);await reject(()=>page(),/Accounting access/);await admin('update accounting_memberships set active=true where user_id=$1',[ACCOUNTS]);
 await admin('update staff set active=false where user_id=$1',[ACCOUNTS]);await reject(()=>payment(fresh(),'100'),/Accounting access/);await admin('update staff set active=true where user_id=$1',[ACCOUNTS]);
 });
 await check('money stays exact beyond 2^53 and registers return complete JSON above API row limits',async()=>{
 const huge='9007199254740993',b=await bill(fresh(),[line(huge,'0')]);assert.equal(b.total_minor,huge);assert.equal((await page()).bills[0].total_minor,huge);
 // Generate legitimate balanced bills through the real RPC, one SQL response still returns every row.
 await db.query("select post_supplier_bill(('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,$2,'BULK-'||n,jsonb_build_array(jsonb_build_object('account_id',$3::text,'net_minor','1','tax_minor','0'))) from generate_series(1,1001)n",[supplier,day,RENT]);
 const result=await page();assert.equal(result.bills.length,1002);assert.equal(result.summary.balance_minor,(BigInt(huge)+1001n).toString());assert.equal(result.summary.reconciled,true);
 const validate=v=>{if(Array.isArray(v))v.forEach(validate);else if(v&&typeof v==='object')for(const [k,value]of Object.entries(v)){if(k.endsWith('_minor')&&value!==null)assert.equal(typeof value,'string',k);else validate(value);}};validate(result);
 });
 console.log(`PASS: ${checks} supplier accounting database scenarios.`);
}finally{await db.close();}
