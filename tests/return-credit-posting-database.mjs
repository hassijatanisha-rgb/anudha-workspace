// Actual workflow/credit RPCs in disposable PostgreSQL; no production data or storage bytes.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190111_post_return_credits.sql',...(process.env.RETURN_CREDIT_WITH_OPENING==='1'?['202610190112_opening_receivables.sql']:[])]});
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,OUTSIDER,ORG,CONTACT,REAGENT,HUB,REAGENT_PACK,REAGENT_LOT,as,admin,one,dates,load}=f;
let counter=7000,checks=0;
const fresh=()=>id(counter++);
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
const rejected=async(fn,pattern)=>{
 await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}
};
const check=async(name,fn)=>{
 await db.exec('begin');await as(ACCOUNTS);
 try{await fn();await db.exec('set constraints all immediate');checks++;console.log(`PASS: ${name}`);}finally{await db.exec('rollback');}
};
const post=(draft,date=dates.today,request=fresh())=>one('select * from post_return_credit_note($1,$2,$3,$4)',[request,draft.id,draft.version,date]);
const balance=inv=>one('select * from acc_invoice_balances where id=$1',[inv.id]);
const ageing=date=>one('select * from acc_receivables_ageing($1) where organization_id=$2',[date,ORG]);
const received=(inv,amount,date=dates.today)=>one("select * from record_receipt($1,$2,$3,$4,'bank','Fixture payment',$5,$6::jsonb)",[fresh(),ORG,date,amount,'a0000000-0000-4000-8000-000000001200',JSON.stringify([{invoice_id:inv.id,amount_minor:amount}])]);
const setup=async(quantity=2)=>{const pf=await quote([line(quantity)]),inv=await invoice(pf,[quantity]),n=await deliver(inv),d=await credit(await returned(n,[1]));return {pf,inv,n,d};};
try{
 await check('A partial returned-goods credit posts exact net/VAT/AR and lowers authoritative outstanding',async()=>{
  const {inv,d}=await setup(),c=await post(d),b=await balance(inv);
  assert.equal(Number(c.net_minor),10003);assert.equal(Number(c.tax_minor),1801);assert.equal(Number(c.total_minor),11804);
  assert.equal(c.invoice_id,inv.id);assert.equal(Number(b.credited_minor),11804);assert.equal(Number(b.outstanding_minor),11803);assert.equal(Number(b.paid_minor),0);
  const rows=(await db.query('select a.system_key,l.debit_minor,l.credit_minor from acc_journal_lines l join acc_accounts a on a.id=l.account_id where l.entry_id=$1',[c.journal_entry_id])).rows;
  assert.deepEqual(rows.map(r=>[r.system_key,Number(r.debit_minor),Number(r.credit_minor)]).sort(),[['receivables',0,11804],['sales',10003,0],['vat_output',1801,0]].sort());
  assert.equal(Number((await ageing(dates.today)).balance_minor),11803);
 });
 await check('Retry and another request for the same saved return never duplicate credits',async()=>{
  const {d}=await setup(),request=fresh(),c=await post(d,dates.today,request);
  assert.equal((await post(d,dates.today,request)).id,c.id);assert.equal((await post(d)).id,c.id);
  await rejected(()=>post({...d,version:d.version+1},dates.today,request),/different details/);
  assert.equal((await one('select count(*)::int n from acc_credit_notes where draft_id=$1',[d.id])).n,1);
  await rejected(()=>post({...d,id:fresh()},dates.today,request),/different details/);
 });
 await check('Successive partial credits retain rounding and cannot exceed the invoice',async()=>{
  const {inv,n,d}=await setup();await post(d);const second=await credit(await returned(n,[1]));await post(second);
  const b=await balance(inv);assert.equal(Number(b.outstanding_minor),0);assert.equal(Number(b.credited_minor),Number(inv.total_minor));assert.equal(b.status_label,'Credited');
  assert.equal(await ageing(dates.today),undefined);
  await rejected(()=>returned(n,[1]),/more than was delivered/);
  const counts=await one('select count(*)::int n from acc_credit_notes');
  await rejected(async()=>db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),(await post(second)).journal_entry_id,dates.today,'Fixture attempt']),/corrected by voiding/);
  assert.deepEqual(await one('select count(*)::int n from acc_credit_notes'),counts);
 });
 await check('Paid invoice return becomes explicit customer credit without negative outstanding',async()=>{
  const {inv,d}=await setup();await received(inv,Number(inv.total_minor));await post(d);
  const b=await balance(inv);assert.equal(Number(b.outstanding_minor),0);assert.equal(Number(b.paid_minor),Number(inv.total_minor));assert.equal(Number(b.customer_credit_minor),Number(d.body.totalMinor));
  const a=await ageing(dates.today);assert.equal(Number(a.current_minor),0);assert.equal(Number(a.unapplied_credit_minor),11804);assert.equal(Number(a.balance_minor),-11804);
 });
 await check('New receipt allocation is bounded by credited outstanding and rolls back on excess',async()=>{
  const {inv,d}=await setup();await post(d);await rejected(()=>received(inv,Number(inv.total_minor)),/less left to pay after posted credits/);
  assert.equal(Number((await balance(inv)).paid_minor),0);await received(inv,11803);assert.equal(Number((await balance(inv)).outstanding_minor),0);
 });
 await check('Historical ageing uses credit date and receipt reversal date and reconciles to AR',async()=>{
  const {inv,d}=await setup();const r=await received(inv,Number(inv.total_minor));await post(d,dates.delivery);
  assert.equal(await ageing(dates.today),undefined);assert.equal(Number((await ageing(dates.delivery)).unapplied_credit_minor),11804);
  await db.query('select void_receipt($1,$2,$3)',[r.id,dates.valid,'Fixture reversed payment']);
  assert.equal(Number((await ageing(dates.delivery)).balance_minor),-11804);assert.equal(Number((await ageing(dates.valid)).balance_minor),11803);
  const ar=await one("select coalesce(sum(l.debit_minor-l.credit_minor),0)::bigint n from acc_journal_lines l join acc_journal_entries e on e.id=l.entry_id join acc_accounts a on a.id=l.account_id where a.system_key='receivables' and e.entry_date<=$1",[dates.valid]);
  assert.equal(Number(ar.n),Number((await ageing(dates.valid)).balance_minor));
 });
 await check('Edited form amounts cannot change authoritative return allocations',async()=>{
  const {inv,d}=await setup();const saved=await one('select * from save_accounting_draft($1,$2,$3,$4,null,$5::jsonb)',[d.id,'credit_note',d.version,ORG,JSON.stringify({lines:[{amount:'999999'}],totalMinor:999999})]);
  await rejected(()=>post(d),/Draft changed/);const c=await post(saved);assert.equal(Number(c.total_minor),11804);assert.equal(Number((await balance(inv)).outstanding_minor),11803);
 });
 await check('Permissions, immutable history and anonymous execution stay closed',async()=>{
  const {d}=await setup();for(const actor of [SALES,OUTSIDER]){await as(actor);await rejected(()=>post(d),/Accounting access/);assert.equal((await one('select count(*)::int n from acc_credit_notes')).n,0);}
  await as(ACCOUNTS);const c=await post(d);
  await rejected(()=>db.query('delete from acc_credit_notes where id=$1',[c.id]),/permission denied/);
  assert.equal((await one("select has_function_privilege('anon','public.post_return_credit_note(uuid,uuid,integer,date)','execute') allowed")).allowed,false);
  await db.exec('reset role');await rejected(()=>db.query('update acc_credit_notes set total_minor=1 where id=$1',[c.id]),/cannot be changed/);await db.exec('set role authenticated');
 });
 await check('Locked dates and dates before returned goods are rejected without partial postings',async()=>{
  const {d}=await setup();await rejected(()=>post(d,'2000-01-01'),/cannot precede/);
  await as(OWNER);await db.query('select set_books_lock(1,$1)',[dates.today]);await as(ACCOUNTS);
  await rejected(()=>post(d),/books are locked/);assert.equal((await one('select count(*)::int n from acc_credit_notes')).n,0);
 });
 await check('Manual or unlinked external drafts cannot post invented credits',async()=>{
  const d=await one('select * from save_accounting_draft($1,$2,0,$3,null,$4::jsonb)',[fresh(),'credit_note',ORG,JSON.stringify({lines:[{amount:'10'}]})]);
  await rejected(()=>post(d),/Only a credit draft created from returned goods/);
 });
 console.log(`PASS: ${checks} return-credit posting database scenarios.`);
}finally{await db.close();}
