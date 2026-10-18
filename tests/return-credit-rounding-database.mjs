// Actual workflow/credit RPCs in disposable PostgreSQL; no production data or storage bytes.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture();
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
try{
 // Exercise real historical invoice snapshots generated before migrations 107/108.
 const legacy=await quote([line(1),line(1,20003)]),legacyInvoice=await one('select * from acc_invoices where proforma_id=$1',[legacy.id]);
 await db.exec('reset role');for(const name of ['202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610180110_return_credit_rounding.sql'])await load(name);await db.exec('set role authenticated');
 await check('Full return of second split invoice preserves 11803 and VAT 1800',async()=>{
  const pf=await quote([line(2)]),first=await invoice(pf,[1]),second=await invoice(pf,[1]);
  assert.equal(Number(first.total_minor),11804);assert.equal(Number(second.total_minor),11803);
  const n=await deliver(second),r=await returned(n,[1]),d=await credit(r);reconciles(second,[d]);
  assert.equal(d.body.totalMinor,11803);assert.equal(d.body.lines[0].taxMinor,1800);assert.deepEqual(d.body.lines[0].allocationRanges,[[1,2]]);
  assert.equal(d.body.source.invoiceId,second.id);
  assert.equal(Number((await one('select outstanding_minor from acc_invoice_balances where id=$1',[second.id])).outstanding_minor),11803,'Credit remains a draft, not a ledger posting');
 });
 await check('Partial return drafts created out of return order allocate each invoice unit once and reconcile exactly',async()=>{
  const pf=await quote([line(5)]);await invoice(pf,[2]);const inv=await invoice(pf,[3]),n=await deliver(inv);
  const a=await returned(n,[1]),b=await returned(n,[1]),c=await returned(n,[1]);
  const drafts=[];for(const r of [c,a,b]){drafts.push(await credit(r));assert.ok(totals(drafts).total<=Number(inv.total_minor));}
  reconciles(inv,drafts);assert.deepEqual(drafts.flatMap(d=>d.body.lines[0].allocationRanges),[[2,3],[3,4],[4,5]]);
  await rejected(()=>returned(n,[1]),/more than was delivered/);
 });
 await check('Returned quantities spanning multiple lots price once per invoice line',async()=>{
  await admin('update inventory_lots set loose_units=1 where id=$1',[REAGENT_LOT]);
  await admin('insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units) values($1,$2,$3,$4,$5,1)',[fresh(),REAGENT,HUB,REAGENT_PACK,'CREDIT-SECOND-LOT']);
  const pf=await quote([line(2)]),inv=await invoice(pf,[2]),n=await deliver(inv);assert.equal(n.lines.length,2);
  const d=await credit(await returned(n,[1,1]));assert.equal(d.body.lines.length,1);assert.equal(d.body.totalMinor,23607);reconciles(inv,[d]);
 });
 await check('Distinct order lines for the same product retain their own invoice prices',async()=>{
  const pf=await quote([line(1),line(1,20003)]),inv=await invoice(pf,[1,1]),n=await deliver(inv);
  const d=await credit(await returned(n,n.lines.map(l=>l.quantity)));assert.equal(d.body.lines.length,2);reconciles(inv,[d]);
  assert.deepEqual(d.body.lines.map(l=>l.netMinor),[10003,20003]);
 });
 await check('Voided invoice holes retain exact discount and VAT ranges across later partial returns',async()=>{
  const pf=await quote([line(4,101,5000)]),parts=[];for(let i=0;i<4;i++)parts.push(await invoice(pf,[1]));
  for(const i of [0,2]){await as(OWNER);await advance(await note(parts[i].id),'cancel');await db.query('select void_invoice($1,$2,$3)',[parts[i].id,dates.today,'Fixture replacement']);await as(ACCOUNTS);}
  const inv=await invoice(pf,[2]);assert.deepEqual(inv.lines[0].allocation_ranges,[[0,1],[2,3]]);
  const n=await deliver(inv),drafts=[];for(let i=0;i<2;i++)drafts.push(await credit(await returned(n,[1])));
  assert.deepEqual(drafts.flatMap(d=>d.body.lines[0].allocationRanges),[[0,1],[2,3]]);reconciles(inv,drafts);
 });
 await check('Historical whole-invoice snapshots map repeated products by original line order',async()=>{
  let n=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),legacy.id,legacy.version,'Fixture legacy approval',dates.delivery,'[]']);
  await db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[n.id,n.version,legacyInvoice.invoice_number]);n=await deliver(legacyInvoice);
  const d=await credit(await returned(n,n.lines.map(l=>l.quantity)));reconciles(legacyInvoice,[d]);assert.deepEqual(d.body.lines.map(l=>l.netMinor),[10003,20003]);
 });
 await check('Editing the first draft cannot release or change its allocation for subsequent drafts',async()=>{
  const pf=await quote([line(2)]),inv=await invoice(pf,[2]),n=await deliver(inv),first=await credit(await returned(n,[1]));
  await db.query('select save_accounting_draft($1,$2,$3,$4,null,$5::jsonb)',[first.id,'credit_note',first.version,ORG,JSON.stringify({lines:[],totalMinor:0})]);
  const second=await credit(await returned(n,[1]));assert.equal(second.body.totalMinor,11803);reconciles(inv,[first,second]);
  assert.deepEqual(second.body.lines[0].allocationRanges,[[1,2]]);
 });
 await check('Retries preserve one draft/history record; stale, different draft IDs and unauthorized actors fail',async()=>{
  const pf=await quote([line(1)]),inv=await invoice(pf,[1]),n=await deliver(inv),r=await returned(n,[1]),d=await credit(r);
  const saved=await one('select * from sales_returns where id=$1',[r.id]);assert.equal((await credit(saved,d.id)).id,d.id);
  await rejected(()=>credit(r,d.id),/Return changed/);await rejected(()=>credit(saved),/already exists/);
  for(const actor of [SALES,OUTSIDER]){await as(actor);await rejected(()=>credit(saved,d.id),/Only accounts/);}
  await as(ACCOUNTS);assert.equal((await one('select count(*)::int n from accounting_draft_history where draft_id=$1',[d.id])).n,1);
  assert.equal((await one("select has_function_privilege('anon','public.create_return_credit_note(uuid,integer,uuid)','execute') allowed")).allowed,false);
 });
 await check('Pre-fix ERP drafts with unidentifiable allocations fail closed without creating another draft',async()=>{
  const pf=await quote([line(2)]),inv=await invoice(pf,[2]),n=await deliver(inv),a=await returned(n,[1]);
  // Install the original credit function to reproduce an actual pre-fix draft, then restore migration 110.
  const {readFileSync}=await import('node:fs');const sql=readFileSync(new URL('../supabase/migrations/202610150082_customer_returns.sql',import.meta.url),'utf8');
  const old=sql.slice(sql.indexOf('create or replace function public.create_return_credit_note'),sql.indexOf('\nrevoke all on function public.record_sales_return'));
  await db.exec('reset role');await db.exec(old);await db.exec('set role authenticated');await credit(a);
  await db.exec('reset role');await db.exec(readFileSync(new URL('../supabase/migrations/202610180110_return_credit_rounding.sql',import.meta.url),'utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,''));await db.exec('set role authenticated');
  const b=await returned(n,[1]),before=await one('select count(*)::int n from accounting_drafts');await rejected(()=>credit(b),/Earlier credit drafts.*Accounts review/);
  assert.deepEqual(await one('select count(*)::int n from accounting_drafts'),before);assert.equal((await one('select credit_note_draft_id from sales_returns where id=$1',[b.id])).credit_note_draft_id,null);
 });
 await check('Pre-ERP external-invoice deliveries retain existing draft pricing',async()=>{
  const n={id:fresh()},deliveryLine=fresh();
  await admin(`insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,status,accounts_reference,expected_delivery_date,created_by,dispatched_by,dispatched_at,delivered_by,delivered_at,recipient_name,proof_reference,tax_invoice_reference)
   values($1,$2,$3,$4,$5,'delivered','Legacy external invoice',current_date,$6,$6,now(),$6,now(),'Fixture customer','Historical signed proof','EXTERNAL-TAX-INVOICE')`,[n.id,'LEGACY-'+counter,legacy.id,ORG,CONTACT,OWNER]);
  await admin('insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values($1,$2,$3,$4,$5,1)',[deliveryLine,n.id,legacy.lines[0].id,REAGENT,REAGENT_LOT]);
  n.lines=[{id:deliveryLine}];const d=await credit(await returned(n,[1]));assert.equal(d.body.totalMinor,11804);assert.equal(d.body.source.invoiceId,null);
 });
 console.log(`PASS: ${checks} return-credit rounding scenarios; draft only, no accounting postings.`);
}finally{await db.close();}
