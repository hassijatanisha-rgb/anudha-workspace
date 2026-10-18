// Disposable PostgreSQL rehearsal of the real accounting, pending and delivery migrations.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610180107_partial_order_invoices.sql']});
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,ORG,CONTACT,REAGENT,REAGENT_LOT,as,admin,one,dates}=f;
let checks=0,counter=2000;
const check=async(name,fn)=>{await fn();checks++;console.log(`ok ${checks} ${name}`);};
const createQuote=async({quantity=4,price=101,discount=0,tax=1800,lines=null}={})=>{
 await as(SALES);const pfId=id(counter++);
 let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[pfId,ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Accounting partial fixture',JSON.stringify(lines||[{productId:REAGENT,description:'Fictional reagent',quantity,uom:'kit',unitPriceMinor:price,discountBasisPoints:discount,taxBasisPoints:tax}])]);
 if(discount){await as(OWNER);await db.query('select decide_proforma_discount($1,$2,$3,$4,$5)',[id(counter++),pf.id,pf.version,'approved','Fixture discount approved']);await as(SALES);}
 pf=await one("select * from advance_sales_proforma($1,$2,'send','Fixture quote sent')",[pf.id,pf.version]);
 pf=await one("select * from advance_sales_proforma($1,$2,'accept','Fixture quote accepted')",[pf.id,pf.version]);
 await as(ACCOUNTS);const q=(await one('select order_invoice_quantities($1) q',[pf.id])).q;
 return {pf,lines:q.lines};
};
const invoice=async(q,quantity,{requestId=id(counter++),date=dates.today,due=dates.valid,reference='Fixture approval',delivery=dates.delivery,tax='',selected=null,version=q.pf.version}={})=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[requestId,q.pf.id,version,date,due,JSON.stringify(selected||[{proforma_line_id:q.lines[0].proforma_line_id,quantity}]),reference,delivery,tax]);
const quantities=async q=>(await one('select order_invoice_quantities($1) q',[q.pf.id])).q;
const pending=async q=>one('select * from pending_stock_requests where proforma_id=$1 and proforma_line_id=$2',[q.pf.id,q.lines[0].proforma_line_id]);
const cancel=async inv=>{const n=await one('select * from sales_delivery_notes where invoice_id=$1',[inv.id]);await db.query("select advance_sales_delivery($1,$2,'cancel','','','','Fixture cancellation')",[n.id,n.version]);};
try{
 const q=await createQuote();
 await check('Acceptance preserves quote and sends Accounts a review task without posting',async()=>{
  assert.equal((await one('select count(*)::int n from acc_invoices where proforma_id=$1',[q.pf.id])).n,0);
  assert.match((await one("select task from work_assignments where record_type='proforma' and record_id=$1 and status='open'",[q.pf.id])).task,/Review quantities/);
 });
 await check('Interrupted rollout before delivery migration cannot post or reserve a partial invoice',async()=>{
  await assert.rejects(invoice(q,2),/invoice_delivery_quantities.*does not exist/);
  assert.equal((await one('select count(*)::int n from acc_invoices where proforma_id=$1',[q.pf.id])).n,0);
  assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,0);
  assert.equal((await one('select count(*)::int n from sales_delivery_notes where proforma_id=$1',[q.pf.id])).n,0);
 });
 await db.exec('reset role');await f.load('202610180108_invoice_quantity_delivery.sql');await db.exec('set role authenticated');
 await admin('update inventory_lots set loose_units=2 where id=$1',[REAGENT_LOT]);
 let first;
 await check('Four ordered, two available: invoice and reserve two, create linked pending two',async()=>{
  first=await invoice(q,2);
  assert.equal(first.lines[0].quantity,2);assert.equal(first.lines[0].proforma_line_id,q.lines[0].proforma_line_id);
  const p=await pending(q);assert.equal(p.quantity,2);assert.equal(p.status,'waiting');assert.equal(p.salesperson_user_id,SALES);
  const lot=(await admin('select * from inventory_lots where id=$1',[REAGENT_LOT])).rows[0];assert.equal(lot.reserved_units,2);assert.equal(lot.loose_units,2);
  assert.equal((await quantities(q)).lines[0].remaining_quantity,2);
  assert.equal((await one('select count(*)::int n from acc_waiting_proformas where id=$1',[q.pf.id])).n,1);
 });
 await check('Exact retry returns same invoice without duplicate journal, delivery or pending',async()=>{
  const again=await invoice(q,2,{requestId:first.id});assert.equal(again.id,first.id);
  assert.equal((await one('select count(*)::int n from sales_delivery_notes where invoice_id=$1',[first.id])).n,1);
  assert.equal((await one('select count(*)::int n from acc_journal_entries where source_id=$1',[first.id])).n,1);
  assert.equal((await pending(q)).version,1);
 });
 await check('Every changed retry field is rejected and request snapshot is immutable',async()=>{
  for(const change of [{quantity:1},{date:dates.delivery},{due:dates.delivery},{reference:'Different approval'},{delivery:dates.valid},{tax:'changed'},{version:q.pf.version+1}]){
   const {quantity=2,...opts}=change;await assert.rejects(invoice(q,quantity,{requestId:first.id,...opts}),/different details/);
  }
  await assert.rejects(admin("update acc_invoices set request_content='{}' where id=$1",[first.id]),/nothing else may change/);
 });
 await check('Shortage rolls back invoice, journal, DN, pending and reservations',async()=>{
  const before=(await admin('select (select count(*) from acc_invoices) i,(select count(*) from acc_journal_entries) j,(select count(*) from sales_delivery_notes) d')).rows[0];
  await assert.rejects(invoice(q,2),/not enough available stock/i);
  assert.deepEqual((await admin('select (select count(*) from acc_invoices) i,(select count(*) from acc_journal_entries) j,(select count(*) from sales_delivery_notes) d')).rows[0],before);
  assert.equal((await pending(q)).quantity,2);
 });
 await check('Overbilling, duplicate lines, fractional quantities and foreign lines fail',async()=>{
  await assert.rejects(invoice(q,3),/exceeds the remaining/);
  await assert.rejects(invoice(q,1,{selected:[{proforma_line_id:q.lines[0].proforma_line_id,quantity:1},{proforma_line_id:q.lines[0].proforma_line_id,quantity:1}]}),/each order line once/);
  await assert.rejects(invoice(q,1.5),/positive whole/);
  await assert.rejects(invoice(q,1,{selected:[{proforma_line_id:id(9999),quantity:1}]}),/belong to this order/);
 });
 await check('Manual pending actions cannot falsify an order balance; ordinary requests still work',async()=>{
  const p=await pending(q);await as(OWNER);
  for(const action of ['fulfil','cancel','expire'])await assert.rejects(db.query('select advance_pending_stock_request($1,$2,$3,$4)',[p.id,p.version,action,'Fixture action']),/Order-linked pending/);
  await db.query('select advance_pending_stock_request($1,$2,$3,$4,$5)',[p.id,p.version,'extend','Fixture extension',1]);
  const manual=await one('select * from create_pending_stock_request($1,$2,$3,$4,1,null,null,$5,$6)',[id(counter++),ORG,CONTACT,REAGENT,SALES,'Separate manual request']);
  await db.query("select advance_pending_stock_request($1,$2,'fulfil','Manual invoice reference')",[manual.id,manual.version]);
  await as(ACCOUNTS);
 });
 await check('Accounting and delivery access required; old whole-order RPC cannot bypass review',async()=>{
  await assert.rejects(db.query('select create_invoice_from_proforma($1,$2,$3,$3,$4)',[id(counter++),q.pf.id,dates.today,'']),/Review the order quantities/);
  await as(SALES);await assert.rejects(quantities(q),/Accounting access/);await assert.rejects(invoice(q,1),/Accounting access/);
  await as(PACKER);await assert.rejects(invoice(q,1),/Accounting access/);
  await as(ACCOUNTS);await admin("update staff set access='{proformas}' where user_id=$1",[ACCOUNTS]);
  await assert.rejects(invoice(q,1),/access/i);await admin("update staff set access='{proformas,deliveries}' where user_id=$1",[ACCOUNTS]);
 });
 await admin('update inventory_lots set loose_units=4 where id=$1',[REAGENT_LOT]);
 let second;
 await check('Later stock invoices remaining two on the same quote with a distinct delivery',async()=>{
  second=await invoice(q,2);assert.notEqual(second.invoice_number,first.invoice_number);
  assert.equal((await one('select count(*)::int n from sales_delivery_notes where proforma_id=$1',[q.pf.id])).n,2);
  assert.equal((await pending(q)).status,'fulfilled');assert.equal((await pending(q)).close_note,'Allocated to invoice');assert.equal((await pending(q)).quantity,2);
  const closedWork=await one("select * from work_assignments where record_type='pending' and record_id=$1 order by created_at desc limit 1",[(await pending(q)).id]);assert.equal(closedWork.status,'done');
  assert.equal((await quantities(q)).lines[0].remaining_quantity,0);
  assert.equal((await one('select count(*)::int n from acc_waiting_proformas where id=$1',[q.pf.id])).n,0);
  const saved=await one('select * from sales_proformas where id=$1',[q.pf.id]);assert.equal(saved.revision,q.pf.revision);assert.equal(saved.version,q.pf.version);assert.equal(Number(saved.total_minor),Number(q.pf.total_minor));
 });
 await check('Voiding requires cancelling reserved delivery; void reopens linked pending quantity',async()=>{
  await assert.rejects(db.query('select void_invoice($1,$2,$3)',[first.id,dates.today,'Fixture order correction']),/active or completed delivery/);
  await cancel(first);await db.query('select void_invoice($1,$2,$3)',[first.id,dates.today,'Fixture order correction']);
  const p=await pending(q);assert.equal(p.quantity,2);assert.equal(p.status,'waiting');assert.equal(p.close_note,'');assert.equal((await quantities(q)).lines[0].remaining_quantity,2);
  const reopened=await one("select * from work_assignments where record_type='pending' and record_id=$1 and status='open'",[p.id]);assert.equal(reopened.assignee_user_id,SALES);
 });
 await check('Tax and discount rounding reconcile after nonsequential void and rebilling',async()=>{
  await admin('update inventory_lots set loose_units=100 where id=$1',[REAGENT_LOT]);
  const r=await createQuote({quantity:4,price:3,discount:5000,tax:1800});
  const slices=[];for(let i=0;i<4;i++)slices.push(await invoice(r,1));
  for(const i of [0,2]){await cancel(slices[i]);await db.query('select void_invoice($1,$2,$3)',[slices[i].id,dates.today,'Fixture rounded rebilling']);}
  const replacement=await invoice(r,2);assert.deepEqual(replacement.lines[0].allocation_ranges,[[0,1],[2,3]]);
  const totals=await one('select sum(subtotal_minor) sub,sum(discount_minor) disc,sum(tax_minor) tax,sum(total_minor) total from acc_invoices where proforma_id=$1 and voided_at is null',[r.pf.id]);
  assert.deepEqual(Object.values(totals).map(Number),[Number(r.pf.subtotal_minor),Number(r.pf.discount_minor),Number(r.pf.tax_minor),Number(r.pf.total_minor)]);
  assert.equal((await quantities(r)).lines[0].remaining_quantity,0);
 });
 await check('Expired lots excluded from availability, today and undated lots included',async()=>{
  await admin('update inventory_lots set expiry_date=current_date-1 where id=$1',[REAGENT_LOT]);assert.equal((await quantities(q)).lines[0].available_quantity,0);
  await admin('update inventory_lots set expiry_date=current_date where id=$1',[REAGENT_LOT]);assert.ok((await quantities(q)).lines[0].available_quantity>0);
 });
 await check('All posted journal entries balance and new invoice amounts equal stored lines',async()=>{
  assert.equal((await one('select count(*)::int n from (select entry_id from acc_journal_lines group by entry_id having sum(debit_minor)<>sum(credit_minor)) x')).n,0);
  assert.equal((await one(`select count(*)::int n from acc_invoices i where request_content is not null and i.total_minor<>(select sum((x->>'total_minor')::bigint) from jsonb_array_elements(i.lines) x)`)).n,0);
 });
 console.log(`PASS: ${checks} partial order accounting checks against actual migrations 107 and 108.`);
}finally{await db.close();}
