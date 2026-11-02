// Disposable PostgreSQL; installs production migrations and never connects to a live database.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202610290134_books_invoice_register.sql','202610290146_books_transaction_page.sql','202611020156_accounting_posting_integrity.sql',...(process.env.CUSTOMER_CREDIT_INTEGRATION==='1'?['202610070073_receive_transfer_available_lot.sql','202610200120_machine_serial_requirement.sql','202610200121_receiving_machine_serials.sql','202611020158_supplier_accounting.sql','202611020159_inventory_cost_accounting.sql']:[]),'202611020160_customer_credit_settlement.sql']});
const {db,id,as,admin,one,ORG,ACCOUNTS,SALES,OWNER,PACKER,DRIVER,CONTACT,REAGENT,dates}=f;
const AR='a0000000-0000-4000-8000-000000001300',BANK='a0000000-0000-4000-8000-000000001200',EQUITY='a0000000-0000-4000-8000-000000003000',INVENTORY='a0000000-0000-4000-8000-000000001400';
let n=20000,checks=0;const fresh=()=>id(n++),cutover='2026-10-01',d1='2026-10-02',d2='2026-10-03',d3='2026-10-04',d4='2026-10-05';
const reject=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const check=async(name,fn)=>{await db.exec('begin');await as(ACCOUNTS);try{await fn();await db.exec('set constraints all immediate');checks++;console.log('PASS: '+name);}finally{await db.exec('rollback');}};
const opening=async(amounts=[10000],credits=[],extra={})=>{
 const batch=fresh(),request=extra.request??fresh(),source='Credit test '+batch,total=amounts.reduce((a,b)=>a+b,0)-credits.reduce((a,b)=>a+b,0);
 await db.query('select import_financial_journals($1,$2,$3,$4::jsonb)',[batch,source,'opening',JSON.stringify([{reference:'GL-'+batch,date:cutover,memo:'Opening AR fixture',lines:[{account_id:AR,debit_minor:Math.max(total,0),credit_minor:Math.max(-total,0),description:'Opening AR'},{account_id:EQUITY,credit_minor:Math.max(total,0),debit_minor:Math.max(-total,0),description:'Opening equity'}]}])]);
 const rows=[...amounts.map((amount,i)=>({kind:'invoice',amount,reference:'INV-'+i})),...credits.map((amount,i)=>({kind:'credit',amount,reference:'CREDIT-'+i}))].map(({kind,amount,reference})=>({kind,reference,organization_id:reference==='INV-1'?(extra.otherCustomer??ORG):ORG,invoice_date:'2026-09-01',due_date:'2026-09-30',amount_minor:amount,currency:'TZS'}));
 const call=(req=request,payload=rows)=>one('select import_opening_receivables($1,$2,$3,$4,$5::jsonb) r',[req,source,cutover,batch,JSON.stringify(payload)]).then(r=>r.r);
 const result=await call();return {batch,request,source,rows,call,...result};
};
const receipt=(amount=10000,date=d1,allocations=[],request=fresh())=>one("select * from record_receipt($1,$2,$3,$4,'bank','Credit fixture',$5,$6::jsonb)",[request,ORG,date,amount,BANK,JSON.stringify(allocations)]);
const apply=(source,target,amount,date=d2,request=fresh())=>one('select apply_customer_credit($1,$2,$3,$4,$5,$6,$7) r',[request,source.receipt??null,source.invoice??null,source.opening??null,target,date,amount]).then(row=>row.r);
const refund=(source,amount,date=d3,request=fresh(),account=BANK,reference='Credit refund')=>one("select refund_customer_credit($1,$2,$3,$4,$5,$6,$7,'bank',$8) r",[request,source.receipt??null,source.invoice??null,source.opening??null,date,amount,account,reference]).then(row=>row.r);
const reverse=(application,date=d3,request=fresh(),reason='Correct application')=>one('select reverse_customer_credit_application($1,$2,$3,$4) r',[request,application,date,reason]).then(row=>row.r);
const sources=(date=d4,org=ORG)=>one('select acc_customer_credit_sources($1,$2) r',[org,date]).then(r=>r.r);
const reconcile=async dates=>{for(const date of dates){const r=await one('select (select coalesce(sum(balance_minor),0)::text from acc_receivables_ageing($1)) sub,(select coalesce(sum(l.debit_minor-l.credit_minor),0)::text from acc_journal_lines l join acc_journal_entries e on e.id=l.entry_id where l.account_id=$2 and e.entry_date<=$1) gl',[date,AR]);assert.equal(r.sub,r.gl,'ageing = GL at '+date);}};
const line=(quantity,price=10003,discount=0)=>({productId:REAGENT,description:'Fixture reagent',quantity,uom:'kit',unitPriceMinor:price,discountBasisPoints:discount,taxBasisPoints:1800});
const quote=async(lines)=>{
 await as(SALES);
 let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[fresh(),ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Credit rounding fixture',JSON.stringify(lines)]);
 if(lines.some(l=>l.discountBasisPoints)){await as(OWNER);await db.query('select decide_proforma_discount($1,$2,$3,$4,$5)',[fresh(),pf.id,pf.version,'approved','Fixture discount approved']);await as(SALES);}
 for(const action of ['send','accept'])pf=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[pf.id,pf.version,action,'Fixture customer '+action]);
 await as(ACCOUNTS);pf.lines=(await db.query('select * from sales_proforma_lines where proforma_id=$1 order by sort_order',[pf.id])).rows;return pf;
};
const invoice=(pf,quantities)=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[fresh(),pf.id,pf.version,dates.today,dates.valid,JSON.stringify(quantities.map((quantity,i)=>({proforma_line_id:pf.lines[i].id,quantity})).filter(l=>l.quantity)),'Fixture approval',dates.delivery,'']);
const note=invoiceId=>one("select * from sales_delivery_notes where invoice_id=$1 and status<>'cancelled'",[invoiceId]);
const advance=async(n,action)=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[n.id,n.version,action,'Fixture truck','FIXTURE-ROUTE','Fixture recipient','Fixture signed proof or cancellation']);
const deliver=async inv=>{
 await as(ACCOUNTS);let n=await advance(await note(inv.id),'send_to_sales');await as(PACKER);
 n=await one('select * from packing_take_next()');assert.equal(n.invoice_id,inv.id);
 n=await one('select * from packing_mark_packed($1,$2)',[n.id,n.version]);await as(DRIVER);n=await advance(n,'dispatch');
 const proof=fresh(),path=`delivery/${n.id}/${proof}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[path,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',n.id,path,'Fixture signed delivery.pdf','application/pdf',321]);
 n=await advance(n,'deliver');await as(ACCOUNTS);n.lines=(await db.query('select * from sales_delivery_lines where delivery_note_id=$1 order by id',[n.id])).rows;return n;
};
const returned=(n,quantities)=>one('select * from record_sales_return($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),n.id,'unopened','Fixture returned goods','',JSON.stringify(quantities.map((quantity,i)=>({deliveryLineId:n.lines[i].id,quantity})).filter(l=>l.quantity))]);
const credit=(ret,draft=fresh())=>one('select * from create_return_credit_note($1,$2,$3)',[ret.id,ret.version,draft]);
const totals=drafts=>drafts.reduce((sum,d)=>{sum.total+=d.body.totalMinor;for(const l of d.body.lines){sum.net+=l.netMinor;sum.tax+=l.taxMinor;sum.quantity+=l.quantityReturned;}return sum;},{total:0,net:0,tax:0,quantity:0});
const reconciles=(inv,drafts)=>{
 const t=totals(drafts);assert.equal(t.total,Number(inv.total_minor));assert.equal(t.net,Number(inv.subtotal_minor)-Number(inv.discount_minor));assert.equal(t.tax,Number(inv.tax_minor));
 assert.equal(t.quantity,inv.lines.reduce((sum,l)=>sum+l.quantity,0));
};
const post=(draft,date=dates.today,request=fresh())=>one('select * from post_return_credit_note($1,$2,$3,$4)',[request,draft.id,draft.version,date]);
const balance=inv=>one('select * from acc_invoice_balances where id=$1',[inv.id]);
const ageing=date=>one('select * from acc_receivables_ageing($1) where organization_id=$2',[date,ORG]);
const received=(inv,amount,date=dates.today)=>one("select * from record_receipt($1,$2,$3,$4,'bank','Fixture payment',$5,$6::jsonb)",[fresh(),ORG,date,amount,'a0000000-0000-4000-8000-000000001200',JSON.stringify([{invoice_id:inv.id,amount_minor:amount}])]);
const setup=async(quantity=2)=>{const pf=await quote([line(quantity)]),inv=await invoice(pf,[quantity]),n=await deliver(inv),d=await credit(await returned(n,[1]));return {pf,inv,n,d};};

await admin('grant select on organizations to authenticated');
try{
 await check('opening debit and credit residuals reconcile without duplicated journals; exact replay survives lock',async()=>{
  const o=await opening([10000],[15000]);assert.equal(o.opening_residual_minor,-5000);assert.equal(o.credits.length,1);assert.equal(o.invoices.length,1);
  assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,1);
  assert.equal((await o.call(fresh())).batch_id,o.batch_id);
  await reject(()=>o.call(o.request,o.rows.map(r=>({...r,amount_minor:r.amount_minor+1}))),/different details/);
  await as(OWNER);await db.query('select set_books_lock(1,$1)',[cutover]);await as(ACCOUNTS);assert.equal((await o.call()).batch_id,o.batch_id);
  const source=await sources(cutover);assert.equal(source.sources[0].available_minor,'15000');
  await reject(()=>apply({opening:o.credits[0].credit_id},o.invoices[0].invoice_id,100,cutover),/locked/);
  const entry=await one('select entry_id from acc_imported_journals where import_id=$1',[o.batch]);await reject(()=>db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),entry.entry_id,d2,'Correct opening']),/attached customer residuals/);
  await reconcile(['2026-09-30',cutover,d4]);
 });
 await check('receipt credit applies in parts; original receipt exact retry and changed retry checks remain intact',async()=>{
  const o=await opening([10000,6000]),r=await receipt(),target=o.invoices[0].invoice_id,req=fresh(),a=await apply({receipt:r.id},target,3000,d2,req);
  assert.equal((await apply({receipt:r.id},target,3000,d2,req)).id,a.id);
  for(const args of [[{receipt:r.id},target,3001,d2,req],[{receipt:r.id},o.invoices[1].invoice_id,3000,d2,req],[{receipt:r.id},target,3000,d3,req]])await reject(()=>apply(...args),/different details/);
  await apply({receipt:r.id},target,7000,d3);
  const b=await one('select * from acc_invoice_balances where id=$1',[target]);assert.equal(Number(b.paid_minor),0);assert.equal(Number(b.applied_credit_minor),10000);assert.equal(Number(b.outstanding_minor),0);
  assert.equal((await receipt(10000,d1,[],r.id)).id,r.id);await reject(()=>receipt(10000,d1,[{invoice_id:target,amount_minor:1}],r.id),/different details/);
  await reject(()=>apply({receipt:r.id},o.invoices[1].invoice_id,1,d4),/Insufficient/);
  await reject(()=>receipt(1,d4,[{invoice_id:target,amount_minor:1}]),/less left/);
  const page=(await one("select acc_transaction_page('receipts',0) r")).r;assert.equal(Number(page.summary.credit_minor),0);
  await reconcile([cutover,d1,d2,d3,d4]);
 });
 await check('refund posts only AR debit and bank credit; void is dated and compares exact retry content',async()=>{
  await opening();const custom=fresh();await admin("insert into acc_accounts(id,code,name,account_type,active) values($1,'1201','Additional bank','asset',true)",[custom]);const advance=await receipt(10);await refund({receipt:advance.id},10,d2,fresh(),custom);const r=await receipt(1000),req=fresh(),f=await refund({receipt:r.id},400,d2,req);
  assert.equal((await refund({receipt:r.id},400,d2,req,BANK,'  Credit refund  ')).id,f.id);
  await reject(()=>refund({receipt:r.id},401,d2,req),/different details/);await reject(()=>refund({receipt:r.id},400,d3,req),/different details/);
  const l=(await db.query('select account_id,debit_minor::text,credit_minor::text from acc_journal_lines where entry_id=$1 order by line_no',[f.journal_entry_id])).rows;
  assert.deepEqual(l,[{account_id:AR,debit_minor:'400',credit_minor:'0'},{account_id:BANK,debit_minor:'0',credit_minor:'400'}]);
  await reject(()=>db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),f.journal_entry_id,d3,'Wrong refund']),/corrected by voiding/);
  const voidIt=(date=d3,reason='Correct refund')=>one('select * from void_customer_refund($1,$2,$3)',[f.id,date,reason]);await voidIt();await voidIt();await reject(()=>voidIt(d4),/different details/);await reject(()=>voidIt(d3,'Different correction'),/different details/);
  assert.equal((await sources(d2)).sources.find(s=>s.source_id===r.id).available_minor,'600');assert.equal((await sources(d3)).sources.find(s=>s.source_id===r.id).available_minor,'1000');
  await reconcile([d1,d2,d3,d4]);
 });
 await check('backdated uses cannot consume future commitments; reversal restores credit only on its date',async()=>{
  const o=await opening([10000,10000]),r=await receipt(10000),a=await apply({receipt:r.id},o.invoices[0].invoice_id,8000,d4);
  await reject(()=>apply({receipt:r.id},o.invoices[1].invoice_id,3000,d2),/Insufficient/);await reject(()=>refund({receipt:r.id},3000,d2),/Insufficient/);
  const reversalId=fresh();await reverse(a.id,'2026-10-06',reversalId);assert.equal((await reverse(a.id,'2026-10-06',reversalId)).id,reversalId);
  await reject(()=>reverse(a.id,'2026-10-07',reversalId),/different details/);await reject(()=>reverse(reversalId,'2026-10-07'),/original credit/);await reject(()=>reverse(a.id,'2026-10-06'),/already been reversed/);
  assert.equal((await sources(d4)).sources.find(s=>s.source_id===r.id).available_minor,'2000');assert.equal((await sources('2026-10-06')).sources.find(s=>s.source_id===r.id).available_minor,'10000');
  await reconcile([d1,d2,d3,d4,'2026-10-06']);
 });
 await check('source receipt cannot disappear while applications or refunds consume it',async()=>{
  const o=await opening(),r=await receipt(),a=await apply({receipt:r.id},o.invoices[0].invoice_id,5000,d2),rf=await refund({receipt:r.id},5000,d2);
  const voidIt=()=>one('select * from void_receipt($1,$2,$3)',[r.id,d4,'Correct original receipt']);await reject(voidIt,/Insufficient/);await reverse(a.id,d3);await reject(voidIt,/Insufficient/);
  await db.query('select void_customer_refund($1,$2,$3)',[rf.id,d3,'Correct refund']);await voidIt();await voidIt();await reconcile([d1,d2,d3,d4]);
 });
 await check('future cash settlements bound a backdated credit application',async()=>{
  const o=await opening(),target=o.invoices[0].invoice_id,r=await receipt(10000);
  await receipt(8000,d4,[{invoice_id:target,amount_minor:8000}]);await reject(()=>apply({receipt:r.id},target,3000,d2),/less left/);
  await apply({receipt:r.id},target,2000,d2);await reconcile([d1,d2,d4]);
 });
 await check('opening credit refunds and applications consume exact residuals and reject invalid payouts',async()=>{
  const o=await opening([10000],[5000]),s={opening:o.credits[0].credit_id};await apply(s,o.invoices[0].invoice_id,2000,d2);await refund(s,3000,d3);
  await reject(()=>refund(s,1,d4),/Insufficient/);await reject(()=>refund(s,1,d4,fresh(),AR),/active bank/);await reject(()=>refund(s,1,d4,fresh(),INVENTORY),/active bank/);
  await reconcile([cutover,d1,d2,d3,d4]);
 });
 await check('accounting access, immutable writes, lock dates, source and target ownership are enforced',async()=>{
  const other=fresh();await admin('insert into organizations(id,name) values($1,$2)',[other,'Other fixture customer']);
  const o=await opening([10000,10000],[],{otherCustomer:other}),r=await receipt(),target=o.invoices[1].invoice_id;
  await reject(()=>apply({receipt:r.id},target,0,d2),/above zero/);await reject(()=>apply({receipt:r.id},target,1,'infinity'),/finite/);
  await reject(()=>apply({receipt:r.id},target,1,d2),/same customer/);
  await as(SALES);await reject(()=>sources(),/Accounting access/);await reject(()=>refund({receipt:r.id},1),/Accounting access/);await reject(()=>apply({receipt:r.id},target,1),/Accounting access/);await reject(()=>one('select acc_opening_receivable_schedules()'),/Accounting access/);await reject(()=>one('select correct_opening_receivables($1,$2,$3::jsonb,$4)',[fresh(),o.batch_id,JSON.stringify(o.rows),'Correct schedule']),/Accounting access/);await reject(()=>one('select void_return_credit_note($1,$2,$3)',[fresh(),d3,'Correct credit']),/Accounting access/);await as(ACCOUNTS);
  for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.acc_credit_available(uuid,uuid,uuid,date)','execute') p",[role])).p,false);
  await reject(()=>db.query('delete from acc_customer_credit_applications'),/permission denied/);
  await as(OWNER);await db.query('select set_books_lock(1,$1)',[d3]);await as(ACCOUNTS);await reject(()=>refund({receipt:r.id},1,d2),/locked/);
 });
 await check('paid-invoice return credit can fund another invoice and a refund without another sales or VAT credit',async()=>{
  const o=await opening([30000]),{inv,d}=await setup(),r=await received(inv,Number(inv.total_minor));await post(d);
  const amount=Number((await balance(inv)).customer_credit_minor);assert.equal(amount,11804);
  const tomorrow=(await one("select (current_date+1)::text d")).d,after=(await one("select (current_date+2)::text d")).d;
  await apply({invoice:inv.id},o.invoices[0].invoice_id,10000,tomorrow);await refund({invoice:inv.id},1804,after);
  const b=await balance(inv);assert.equal(Number(b.customer_credit_minor),0);assert.equal(Number(b.credit_used_minor),10000);assert.equal(Number(b.refunded_minor),1804);assert.equal(Number(b.paid_minor),23607);
  assert.equal((await one('select count(*)::int n from acc_credit_notes')).n,1);
  await reject(()=>db.query('select void_receipt($1,$2,$3)',[r.id,after,'Correct paid invoice receipt']),/Insufficient invoice/);
  await reconcile([cutover,dates.today,tomorrow,after]);
 });
 await check('credit-funded return becomes reusable; reversing an upstream application requires downstream corrections first',async()=>{
  const o=await opening([30000]),{inv,d}=await setup(),advance=await receipt(30000,dates.today),first=await apply({receipt:advance.id},inv.id,Number(inv.total_minor),dates.today);
  await post(d);assert.equal(Number((await balance(inv)).customer_credit_minor),11804);
  const tomorrow=(await one("select (current_date+1)::text d")).d,after=(await one("select (current_date+2)::text d")).d;
  const next=await apply({invoice:inv.id},o.invoices[0].invoice_id,8000,tomorrow),rf=await refund({invoice:inv.id},3804,tomorrow);
  await reject(()=>reverse(first.id,after),/Insufficient invoice/);await reverse(next.id,after);await reject(()=>reverse(first.id,after),/Insufficient invoice/);
  await db.query('select void_customer_refund($1,$2,$3)',[rf.id,after,'Correct chained refund']);await reverse(first.id,after);
  assert.equal(Number((await balance(inv)).outstanding_minor),11803);assert.equal(Number((await balance(inv)).customer_credit_minor),0);
  await reconcile([dates.today,tomorrow,after]);
 });
 await check('a receipt earmarked for a future invoice remains unspendable while historical ageing carries its credit',async()=>{
  const o=await opening(),pf=await quote([line(1)]),future=(await one("select (current_date+5)::text d")).d;
  const inv=await one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[fresh(),pf.id,pf.version,future,dates.valid,JSON.stringify([{proforma_line_id:pf.lines[0].id,quantity:1}]),'Future invoice fixture',dates.delivery,'']);
  const r=await receipt(Number(inv.total_minor),dates.today,[{invoice_id:inv.id,amount_minor:Number(inv.total_minor)}]);
  assert.equal((await sources(dates.today)).sources.some(x=>x.source_id===r.id),false);
  await reject(()=>apply({receipt:r.id},o.invoices[0].invoice_id,1,dates.today),/Insufficient/);await reject(()=>refund({receipt:r.id},1,dates.today),/Insufficient/);
  const ag=await ageing(dates.today);assert.equal(Number(ag.unapplied_credit_minor),Number(inv.total_minor));await reconcile([dates.today,future]);
 });
 await check('posted settlements remain recoverable after books locking; changed retries and new writes fail',async()=>{
  const o=await opening(),r=await receipt(),a=await apply({receipt:r.id},o.invoices[0].invoice_id,1000,d2),rf=await refund({receipt:r.id},1000,d2);
  await as(OWNER);await db.query('select set_books_lock(1,$1)',[d3]);await as(ACCOUNTS);
  assert.equal((await apply({receipt:r.id},o.invoices[0].invoice_id,1000,d2,a.id)).id,a.id);assert.equal((await refund({receipt:r.id},1000,d2,rf.id)).id,rf.id);
  await reject(()=>apply({receipt:r.id},o.invoices[0].invoice_id,1001,d2,a.id),/different details/);await reject(()=>refund({receipt:r.id},1001,d2,rf.id),/different details/);
  await reject(()=>reverse(a.id,d3),/locked/);await reject(()=>db.query('select void_customer_refund($1,$2,$3)',[rf.id,d3,'Correct refund']),/locked/);
 });
 await check('an invoice cannot be voided while credit is applied; dated reversal permits correction',async()=>{
  const pf=await quote([line(1)]),inv=await invoice(pf,[1]),r=await receipt(20000,dates.today),a=await apply({receipt:r.id},inv.id,Number(inv.total_minor),dates.today);
  await advance(await note(inv.id),'cancel');const tomorrow=(await one("select (current_date+1)::text d")).d;
  await reject(()=>db.query('select void_invoice($1,$2,$3)',[inv.id,tomorrow,'Correct invoice']),/Reverse credit applications/);
  await reverse(a.id,tomorrow);await db.query('select void_invoice($1,$2,$3)',[inv.id,tomorrow,'Correct invoice']);await reconcile([dates.today,tomorrow]);
 });
 await check('unused opening schedules replace atomically at the same GL net and retain all original identities',async()=>{
  const o=await opening([10000],[3000]),request=fresh(),rows=o.rows.map(r=>({...r,amount_minor:r.kind==='invoice'?12000:5000}));
  const correct=(req=request,payload=rows,reason='Correct customer residual schedule')=>one('select correct_opening_receivables($1,$2,$3::jsonb,$4) r',[req,o.batch_id,JSON.stringify(payload),reason]).then(r=>r.r);
  const preview=(await one('select opening_receivables_correction_check($1,$2::jsonb) r',[o.batch_id,JSON.stringify(rows)])).r;assert.equal(preview.reconciled,true);assert.equal(preview.replaces_import_id,o.batch_id);assert.equal(preview.opening_residual_minor,'7000');assert.equal((await one('select acc_opening_receivable_schedules() r')).r[0].can_correct,true);
  const result=await correct();assert.equal(result.opening_residual_minor,'7000');assert.equal(result.replaces_import_id,o.batch_id);assert.equal((await correct()).batch_id,request);
  assert.equal((await one('select count(*)::int n from acc_invoices')).n,2);assert.equal((await one('select count(*)::int n from acc_invoice_balances')).n,1);assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,1);
  assert.equal((await o.call()).superseded_by,request);assert.equal((await sources(cutover)).sources[0].available_minor,'5000');
  await reject(()=>correct(request,rows,'Changed correction'),/different details/);await reject(()=>correct(fresh()),/already been replaced/);
  await reject(()=>apply({opening:o.credits[0].credit_id},result.invoices[0].invoice_id,1,d2),/Insufficient/);
  await reject(()=>receipt(1,d2,[{invoice_id:o.invoices[0].invoice_id,amount_minor:1}]),/active TZS/);
  await reconcile(['2026-09-30',cutover,d2]);
 });
 await check('opening correction rejects changed GL net, lock dates and any settlement history without partial changes',async()=>{
  const o=await opening([10000],[3000]),correct=rows=>one('select correct_opening_receivables($1,$2,$3::jsonb,$4) r',[fresh(),o.batch_id,JSON.stringify(rows),'Correct opening schedule']);
  await reject(()=>correct(o.rows.map(r=>({...r,amount_minor:1}))),/does not equal/);assert.equal((await one('select superseded_by from acc_opening_receivable_imports where id=$1',[o.batch_id])).superseded_by,null);
  const a=await apply({opening:o.credits[0].credit_id},o.invoices[0].invoice_id,100,d2);await reverse(a.id,d3);await reject(()=>correct(o.rows),/settlement history/);
  assert.equal((await one('select count(*)::int n from acc_opening_receivable_corrections')).n,0);assert.equal((await one('select acc_opening_receivable_schedules() r')).r[0].can_correct,false);await reject(()=>one('select opening_receivables_correction_check($1,$2::jsonb)',[o.batch_id,JSON.stringify(o.rows)]),/settlement history/);await as(OWNER);await db.query('select set_books_lock(1,$1)',[cutover]);await as(ACCOUNTS);await reject(()=>correct(o.rows),/locked/);await reconcile([cutover,d2,d3]);
 });
 await check('return credit void and explicit repost preserve dated revenue, VAT, AR and exact retry identities',async()=>{
  const {inv,d}=await setup(),c=await post(d),tomorrow=(await one("select (current_date+1)::text d")).d,after=(await one("select (current_date+2)::text d")).d;
  const voidIt=(date=tomorrow,reason='Correct credit accounting date')=>one('select void_return_credit_note($1,$2,$3) r',[c.id,date,reason]).then(r=>r.r);
  assert.equal((await voidIt()).total_minor,'11804');await voidIt();await reject(()=>voidIt(after),/different details/);
  await reject(()=>post(d,after,fresh()),/explicit return credit repost/);
  const request=fresh(),repost=(date=after)=>one('select repost_return_credit_note($1,$2,$3) r',[request,c.id,date]).then(r=>r.r);
  const saved=await repost();assert.equal(saved.total_minor,'11804');assert.equal(saved.replaces_credit_id,c.id);assert.equal((await repost()).id,request);await reject(()=>repost(tomorrow),/different details/);
  assert.equal(Number((await balance(inv)).credited_minor),11804);assert.equal((await one('select count(*)::int n from acc_credit_notes')).n,2);await reconcile([dates.today,tomorrow,after]);
 });
 await check('a returned-goods credit cannot be voided while any later dependent use consumes its surplus',async()=>{
  const o=await opening([30000]),{inv,d}=await setup();await received(inv,Number(inv.total_minor));const c=await post(d),tomorrow=(await one("select (current_date+1)::text d")).d,after=(await one("select (current_date+2)::text d")).d;
  const a=await apply({invoice:inv.id},o.invoices[0].invoice_id,10000,after);
  await reject(()=>db.query('select void_return_credit_note($1,$2,$3)',[c.id,tomorrow,'Correct returned credit']),/Insufficient invoice/);
  await reverse(a.id,after);await db.query('select void_return_credit_note($1,$2,$3)',[c.id,after,'Correct returned credit']);await reconcile([dates.today,tomorrow,after]);
 });
 await check('new settlement reports return more than a page limit with exact minor strings',async()=>{
  // Fixture-only bulk seeding avoids conflating report transport with 1,100 independent posting workflows.
  await db.exec('reset role');await db.exec(`insert into acc_journal_entries(id,entry_number,entry_date,memo,source_type,source_id,created_by)
   select ('d0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'CREDIT-BULK-'||n,'${d1}','Credit source fixture','receipt',('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${ACCOUNTS}' from generate_series(1,1100)n;
   insert into acc_journal_lines(entry_id,line_no,account_id,debit_minor,credit_minor,organization_id)
   select ('d0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,line_no,case when line_no=1 then '${BANK}'::uuid else '${AR}'::uuid end,case when line_no=1 then 9007199254740993 else 0 end,case when line_no=2 then 9007199254740993 else 0 end,case when line_no=2 then '${ORG}'::uuid else null end from generate_series(1,1100)n cross join generate_series(1,2)line_no;
   insert into acc_receipts(id,receipt_number,organization_id,receipt_date,amount_minor,method,reference,deposit_account_id,journal_entry_id,created_by)
   select ('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'CREDIT-BULK-'||n,'${ORG}','${d1}',9007199254740993,'bank','Exact large amount','${BANK}',('d0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${ACCOUNTS}' from generate_series(1,1100)n;`);await db.exec('set role authenticated');
  const report=await sources();assert.equal(report.sources.length,1100);assert.equal(report.sources[0].available_minor,'9007199254740993');
 });
 console.log(`PASS: ${checks} customer credit settlement database scenarios.`);
}finally{await db.close();}
