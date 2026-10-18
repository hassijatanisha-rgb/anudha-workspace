// Real migration/RPC rehearsal in disposable PostgreSQL; all stock, customers and proof are fictional.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture();
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,OUTSIDER,ORG,CONTACT,MACHINE,REAGENT,HUB,MACHINE_PACK,MACHINE_LOT,REAGENT_LOT,as,admin,one,dates,load}=f;
let next=2000;const fresh=()=>id(next++),passed=[];
const machine=quantity=>({productId:MACHINE,description:'Fictional partial-order analyzer',quantity,uom:'unit',unitPriceMinor:100000,discountBasisPoints:0,taxBasisPoints:1800});
const rejected=async(fn,pattern)=>{
 await db.exec('savepoint expected_failure');
 try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}
};
const scenario=async(name,fn)=>{
 await db.exec('begin');await as(OWNER);
 try{await fn();await db.exec('set constraints all immediate');passed.push(name);console.log('PASS:',name);}
 finally{await db.exec('rollback');}
};
const createOrder=async(lines=[machine(4)])=>{
 await as(SALES);
 let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[fresh(),ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Synthetic partial-order test',JSON.stringify(lines)]);
 if(lines.some(l=>l.discountBasisPoints>0)){await as(OWNER);await db.query('select decide_proforma_discount($1,$2,$3,$4,$5)',[fresh(),pf.id,pf.version,'approved','Synthetic reviewed discount']);await as(SALES);}
 for(const action of ['send','accept'])pf=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[pf.id,pf.version,action,'Synthetic customer '+action]);
 const stored=(await db.query('select * from sales_proforma_lines where proforma_id=$1 order by sort_order',[pf.id])).rows;
 await as(OWNER);return {...pf,orderLines:stored};
};
const invoiceArgs=(pf,quantities,invoiceId=fresh())=>[invoiceId,pf.id,pf.version,dates.today,dates.delivery,JSON.stringify(quantities.map((quantity,index)=>({proforma_line_id:pf.orderLines[index].id,quantity})).filter(x=>x.quantity>0)),'Synthetic Accounts approval',dates.delivery,''];
const invoice=async(pf,quantities,invoiceId)=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',invoiceArgs(pf,quantities,invoiceId));
const callInvoice=args=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',args);
const note=noteId=>one('select * from sales_delivery_notes where id=$1',[noteId]);
const invoiceNote=invoiceId=>one("select * from sales_delivery_notes where invoice_id=$1 and status<>'cancelled'",[invoiceId]);
const review=async pf=>(await one('select order_invoice_quantities($1) as review',[pf.id])).review;
const pending=pf=>one("select coalesce(sum(quantity),0)::int quantity from pending_stock_requests where proforma_id=$1 and status='waiting'",[pf.id]);
const stock=lot=>one('select loose_units,reserved_units,version from inventory_lots where id=$1',[lot]);
const setStock=async(lot,quantity)=>{
 const current=(await admin('select * from inventory_lots where id=$1',[lot])).rows[0];await as(OWNER);
 return one('select * from set_inventory_opening_balance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[lot,current.version,current.product_id,current.location_id,current.pack_definition_id,current.batch_number,current.expiry_date,0,quantity,'Synthetic controlled stock fixture']);
};
const advance=async(noteId,action)=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[noteId,(await note(noteId)).version,action,'Synthetic truck','SYNTHETIC-ROUTE','Synthetic recipient','Synthetic signed proof or cancellation']);
const pack=async invoiceId=>{
 let n=await invoiceNote(invoiceId);await as(ACCOUNTS);n=await advance(n.id,'send_to_sales');await as(PACKER);
 n=await one('select * from packing_take_next()');assert.equal(n.invoice_id,invoiceId);
 const lines=(await db.query('select * from sales_delivery_lines where delivery_note_id=$1 and product_id=$2',[n.id,MACHINE])).rows;
 if(lines.length)await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[n.id,n.version,JSON.stringify(lines.map(l=>({deliveryLineId:l.id,serials:Array.from({length:l.quantity},()=>`SYNTHETIC-${next++}`)})))]);
 n=await one('select * from packing_mark_packed($1,$2)',[n.id,(await note(n.id)).version]);return n;
};
const deliver=async(invoiceId,{checkProof=false}={})=>{
 let n=await pack(invoiceId);await as(DRIVER);n=await advance(n.id,'dispatch');
 if(checkProof)await rejected(()=>advance(n.id,'deliver'),/upload|signed.*delivery/i);
 const proof=fresh(),path=`delivery/${n.id}/${proof}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[path,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',n.id,path,'Synthetic signed delivery.pdf','application/pdf',321]);
 n=await advance(n.id,'deliver');await as(OWNER);return n;
};
const cancel=async inv=>{await as(OWNER);return advance((await invoiceNote(inv.id)).id,'cancel');};
const voidInvoice=inv=>one('select * from void_invoice($1,$2,$3)',[inv.id,dates.today,'Synthetic cancelled order allocation']);
const counts=async pf=>(await admin(`select (select count(*)::int from acc_invoices where proforma_id=$1) invoices,
 (select count(*)::int from acc_journal_entries) journals,(select count(*)::int from sales_delivery_notes where proforma_id=$1) deliveries,
 (select count(*)::int from pending_stock_events) pending_events,(select coalesce(sum(quantity),0)::int from pending_stock_requests where proforma_id=$1 and status='waiting') pending`,[pf.id])).rows[0];
try{
 // Upgrade a real legacy full-quote invoice, so compatibility is checked against historical data rather than a fabricated JSON shape.
 const legacy=await createOrder([machine(2)]),legacyInvoice=await one('select * from acc_invoices where proforma_id=$1',[legacy.id]);
 await db.exec('reset role');await load('202610180107_partial_order_invoices.sql');await load('202610180108_invoice_quantity_delivery.sql');await db.exec('set role authenticated');
 await scenario('4 ordered / 2 available: accept without invoicing, invoice and deliver 2, add 2, invoice and deliver remainder',async()=>{
  await setStock(MACHINE_LOT,2);const pf=await createOrder();
  assert.equal((await counts(pf)).invoices,0);assert.equal((await review(pf)).lines[0].remaining_quantity,4);
  await as(ACCOUNTS);const first=await invoice(pf,[2]);assert.equal(Number(first.total_minor),236000);
  const firstNote=await invoiceNote(first.id);assert.equal(firstNote.status,'tax_invoice_created');assert.equal(firstNote.tax_invoice_reference,first.invoice_number);
  assert.deepEqual(await stock(MACHINE_LOT),{loose_units:2,reserved_units:2,version:3});assert.equal((await pending(pf)).quantity,2);
  const d1=await deliver(first.id,{checkProof:true});
  assert.equal((await admin('select count(*)::int n from service_cases where source_delivery_note_id=$1',[d1.id])).rows[0].n,2);
  assert.equal((await pending(pf)).quantity,2);assert.equal((await stock(MACHINE_LOT)).loose_units,0);
  await setStock(MACHINE_LOT,2);await as(ACCOUNTS);const second=await invoice(pf,[2]);assert.equal((await pending(pf)).quantity,0);
  assert.equal((await one('select status,close_note from pending_stock_requests where proforma_id=$1',[pf.id])).close_note,'Allocated to invoice');
  const d2=await deliver(second.id);const totals=(await admin('select sum(total_minor)::bigint total,count(*)::int invoices from acc_invoices where proforma_id=$1 and voided_at is null',[pf.id])).rows[0];
  assert.equal(Number(totals.total),Number(pf.total_minor));assert.equal(totals.invoices,2);
  assert.equal((await admin('select count(*)::int n from service_cases where source_delivery_note_id=any($1::uuid[])',[[d1.id,d2.id]])).rows[0].n,4);
  assert.deepEqual((await stock(MACHINE_LOT)),{loose_units:0,reserved_units:0,version:7});
  await rejected(()=>invoice(pf,[1]),/remaining|balance/i);await rejected(()=>advance(d2.id,'dispatch'),/next allowed/i);
  await rejected(()=>voidInvoice(second),/active or completed delivery/i);
 });
 await scenario('2 + 1 + 1 invoices reserve distinct quantities while prior deliveries remain open',async()=>{
  await setStock(MACHINE_LOT,4);const pf=await createOrder();const invoices=[];
  for(const quantity of [2,1,1])invoices.push(await invoice(pf,[quantity]));
  assert.equal((await pending(pf)).quantity,0);assert.equal((await stock(MACHINE_LOT)).reserved_units,4);
  assert.equal((await counts(pf)).deliveries,3);
  for(const inv of invoices){const n=await invoiceNote(inv.id);assert.equal((await one('select sum(quantity)::int quantity from sales_delivery_lines where delivery_note_id=$1',[n.id])).quantity,inv.lines[0].quantity);await deliver(inv.id);}
  assert.equal((await stock(MACHINE_LOT)).loose_units,0);
  assert.equal((await admin('select sum(total_minor)::bigint total from acc_invoices where proforma_id=$1',[pf.id])).rows[0].total,pf.total_minor);
 });
 await scenario('Identical retry is idempotent; mismatched content, stale version and unauthorized access fail without effects',async()=>{
  const pf=await createOrder(),request=invoiceArgs(pf,[2]);const first=await callInvoice(request),before=await counts(pf);
  assert.equal((await callInvoice(request)).id,first.id);assert.deepEqual(await counts(pf),before);
  const changed=[...request];changed[5]=JSON.stringify([{proforma_line_id:pf.orderLines[0].id,quantity:1}]);
  await rejected(()=>callInvoice(changed),/already used|different details/i);
  const stale=invoiceArgs(pf,[1]);stale[2]--;await rejected(()=>callInvoice(stale),/changed|refresh|version/i);
  for(const actor of [SALES,PACKER,OUTSIDER]){await as(actor);await rejected(()=>callInvoice(invoiceArgs(pf,[1])),/access|account/i);}
  await as(OWNER);assert.deepEqual(await counts(pf),before);
  await rejected(()=>db.query('select acc_create_invoice($1,$2,$3,$4,$5)',[fresh(),pf.id,dates.today,dates.delivery,'']),/permission denied|review/i);
 });
 await scenario('Duplicate, foreign, negative, decimal and oversized line quantities are rejected atomically',async()=>{
  const pf=await createOrder(),other=await createOrder(),line=pf.orderLines[0].id,before=await counts(pf);
  for(const lines of [[{proforma_line_id:line,quantity:1},{proforma_line_id:line,quantity:1}],
   [{proforma_line_id:other.orderLines[0].id,quantity:1}],[{proforma_line_id:line,quantity:-1}],
   [{proforma_line_id:line,quantity:1.5}],[{proforma_line_id:line,quantity:5}],[{proforma_line_id:line,quantity:1000001}]]){
   const args=invoiceArgs(pf,[1]);args[5]=JSON.stringify(lines);await rejected(()=>callInvoice(args),/line|quantity|quantities|balance/i);
  }
  assert.deepEqual(await counts(pf),before);assert.equal((await stock(MACHINE_LOT)).reserved_units,0);
 });
 await scenario('Short stock, expired stock and later-line shortages roll back invoice, journal, delivery and pending changes',async()=>{
  await setStock(MACHINE_LOT,2);const pf=await createOrder();const first=await invoice(pf,[1]);const before=await counts(pf),priorStock=await stock(MACHINE_LOT);
  await rejected(()=>invoice(pf,[2]),/not enough.*stock/i);assert.deepEqual(await counts(pf),before);assert.deepEqual(await stock(MACHINE_LOT),priorStock);
  await admin('update inventory_lots set expiry_date=current_date-1 where id=$1',[MACHINE_LOT]);
  await rejected(()=>invoice(pf,[1]),/not enough.*stock/i);assert.deepEqual(await counts(pf),before);
  await admin('update inventory_lots set expiry_date=null where id=$1',[MACHINE_LOT]);await cancel(first);
  const multi=await createOrder([machine(1),{...machine(1),productId:REAGENT,description:'Fictional reagent',uom:'kit'}]);
  await setStock(REAGENT_LOT,0);const multiBefore=await counts(multi);await rejected(()=>invoice(multi,[1,1]),/not enough.*stock/i);
  assert.deepEqual(await counts(multi),multiBefore);assert.equal((await stock(MACHINE_LOT)).reserved_units,0);
 });
 await scenario('Cancellation permits re-delivery on the same invoice; cancel then void restores uninvoiced balance',async()=>{
  const pf=await createOrder(),first=await invoice(pf,[2]);
  await rejected(()=>voidInvoice(first),/active or completed delivery/i);await cancel(first);
  assert.equal((await stock(MACHINE_LOT)).reserved_units,0);assert.equal((await pending(pf)).quantity,2);
  const replacement=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),pf.id,pf.version,'Synthetic replacement delivery',dates.delivery,'[]']);
  const reserved=await one('select * from create_tax_invoice_and_reserve_stock($1,$2,$3)',[replacement.id,replacement.version,first.invoice_number]);
  assert.equal(reserved.invoice_id,first.id);assert.equal((await stock(MACHINE_LOT)).reserved_units,2);
  await advance(reserved.id,'cancel');await voidInvoice(first);
  assert.equal((await pending(pf)).quantity,4);assert.equal((await review(pf)).lines[0].remaining_quantity,4);
  const second=await invoice(pf,[4]);assert.equal(Number(second.total_minor),Number(pf.total_minor));assert.equal((await pending(pf)).quantity,0);
 });
 await scenario('Legacy reservation requires an unambiguous invoice and never exceeds its selected quantities',async()=>{
  const pf=await createOrder(),first=await invoice(pf,[1]),second=await invoice(pf,[1]);await cancel(first);await cancel(second);
  const n=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),pf.id,pf.version,'Synthetic old-client delivery',dates.delivery,'[]']);
  await rejected(()=>db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[n.id,n.version,'']),/more than one|exact.*invoice/i);
  await rejected(()=>db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[n.id,n.version,'FOREIGN-INVOICE']),/matching active/i);
  const chosen=await one('select * from create_tax_invoice_and_reserve_stock($1,$2,$3)',[n.id,n.version,second.invoice_number]);
  assert.equal(chosen.invoice_id,second.id);assert.equal((await one('select sum(quantity)::int quantity from sales_delivery_lines where delivery_note_id=$1',[n.id])).quantity,1);
  const duplicate=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),pf.id,pf.version,'Synthetic duplicate attempt',dates.delivery,'[]']);
  await rejected(()=>db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[duplicate.id,duplicate.version,second.invoice_number]),/already assigned/i);
  assert.equal((await stock(MACHINE_LOT)).reserved_units,1);
 });
 await scenario('Dispatch validates exact invoice identity, active state, line quantities and preserved serial ownership rules',async()=>{
  const pf=await createOrder(),first=await invoice(pf,[2]),second=await invoice(pf,[1]);
  const n=await invoiceNote(first.id);await db.exec('reset role');await rejected(()=>db.query('update sales_delivery_notes set invoice_id=$1 where id=$2',[second.id,n.id]),/cannot change/i);await db.exec('set role authenticated');
  await as(ACCOUNTS);await advance(n.id,'send_to_sales');await as(PACKER);let packing=await one('select * from packing_take_next()');
  await as(DRIVER);await rejected(()=>advance(n.id,'ready'),/who took|mark it packed/i);
  await as(PACKER);await db.query('select packing_mark_packed($1,$2)',[packing.id,packing.version]);
  await as(DRIVER);await rejected(()=>advance(n.id,'dispatch'),/serial/i);
  await as(OWNER);await advance(n.id,'cancel');
  const packed=await pack(second.id);await as(OWNER);
  await admin('alter table sales_delivery_notes disable trigger sales_delivery_invoice_identity');
  await admin('update sales_delivery_notes set invoice_id=$1 where id=$2',[first.id,packed.id]);
  await rejected(()=>advance(packed.id,'dispatch'),/active linked.*invoice/i);
  await admin('update sales_delivery_notes set invoice_id=$1 where id=$2',[second.id,packed.id]);
  await admin('alter table sales_delivery_notes enable trigger sales_delivery_invoice_identity');
  const line=(await one('select * from sales_delivery_lines where delivery_note_id=$1',[packed.id]));
  await admin('update product_serial_settings set serial_required=false where product_id=$1',[MACHINE]);
  await admin('update sales_delivery_lines set quantity=2 where id=$1',[line.id]);
  await rejected(()=>advance(packed.id,'dispatch'),/exactly match|quantities/i);
  assert.equal((await note(packed.id)).status,'ready');
 });
 await scenario('Legacy delivery creation cannot turn uninvoiced balances into empty delivery notes',async()=>{
  const pf=await createOrder();const create=()=>db.query('select create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),pf.id,pf.version,'Synthetic legacy approval',dates.delivery,'[]']);
  await rejected(create,/invoice the ready quantities.*Accounts/i);assert.equal((await counts(pf)).deliveries,0);
  await invoice(pf,[2]);await rejected(create,/every existing invoice quantity is already assigned/i);
  assert.equal((await counts(pf)).deliveries,1);assert.equal((await pending(pf)).quantity,2);
 });
 await scenario('Old delivery create retries cannot duplicate a note, and direct manual packing cannot over-allocate its invoice',async()=>{
  const pf=await createOrder(),inv=await invoice(pf,[1]);await cancel(inv);
  const args=[fresh(),pf.id,pf.version,'Synthetic manual delivery',dates.delivery,'[]'];
  const n=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',args);
  const before=await counts(pf);
  await rejected(()=>db.query('select create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',args),/duplicate|unique/i);
  const changed=[...args];changed[3]='Changed approval';
  await rejected(()=>db.query('select create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',changed),/duplicate|unique/i);
  assert.deepEqual(await counts(pf),before);
  // Reproduce an old unallocated packing-queue record to exercise the still-exposed manual packing RPC.
  await admin('alter table sales_delivery_notes disable trigger sales_tax_invoice_requires_stock');
  await admin("update sales_delivery_notes set invoice_id=$1,tax_invoice_reference=$2,status='sent_to_sales' where id=$3",[inv.id,inv.invoice_number,n.id]);
  await admin('alter table sales_delivery_notes enable trigger sales_tax_invoice_requires_stock');
  await as(PACKER);
  const selected=quantity=>JSON.stringify([{proformaLineId:pf.orderLines[0].id,lotId:MACHINE_LOT,quantity}]);
  await rejected(()=>db.query('select start_sales_delivery_packing($1,$2,$3::jsonb)',[n.id,n.version,selected(2)]),/exactly match|quantities/i);
  assert.equal((await stock(MACHINE_LOT)).reserved_units,0);
  assert.equal((await one('select count(*)::int n from sales_delivery_lines where delivery_note_id=$1',[n.id])).n,0);
  const packed=await one('select * from start_sales_delivery_packing($1,$2,$3::jsonb)',[n.id,n.version,selected(1)]);
  assert.equal(packed.status,'packing');assert.equal((await stock(MACHINE_LOT)).reserved_units,1);
 });
 await scenario('Receipts remain attached to each partial invoice and block voiding until the receipt is voided',async()=>{
  const pf=await createOrder(),first=await invoice(pf,[2]),second=await invoice(pf,[1]);
  const bank=await one("select id from acc_accounts where system_key='bank'");
  const receipt=await one('select * from record_receipt($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[fresh(),ORG,dates.today,1000,'bank','Synthetic partial payment',bank.id,JSON.stringify([{invoice_id:first.id,amount_minor:1000}])]);
  await cancel(first);const before=await counts(pf);
  await rejected(()=>voidInvoice(first),/receipts paid|receipts/i);assert.deepEqual(await counts(pf),before);
  assert.equal((await one('select amount_minor from acc_receipt_allocations where invoice_id=$1',[first.id])).amount_minor,1000);
  assert.equal((await one('select count(*)::int n from acc_receipt_allocations where invoice_id=$1',[second.id])).n,0);
  await db.query('select void_receipt($1,$2,$3)',[receipt.id,dates.today,'Synthetic payment reversed']);await voidInvoice(first);
  assert.equal((await pending(pf)).quantity,3);assert.equal((await stock(MACHINE_LOT)).reserved_units,1);
  assert.equal((await invoiceNote(second.id)).status,'tax_invoice_created');
 });
 await scenario('Dispatch fails closed for a stale revision, wrong organization or voided linked invoice',async()=>{
  const pf=await createOrder(),inv=await invoice(pf,[1]),packed=await pack(inv.id);await as(OWNER);
  const otherOrg=fresh();await admin('insert into organizations(id,name,location) values($1,$2,$3)',[otherOrg,'Synthetic other customer','Synthetic location']);
  for(const [sql,params] of [
   ['update acc_invoices set proforma_revision=proforma_revision+1 where id=$1',[inv.id]],
   ['update acc_invoices set organization_id=$2 where id=$1',[inv.id,otherOrg]],
   ["update acc_invoices set voided_at=now(),voided_by=$2,void_reason='Synthetic stale record',void_entry_id=journal_entry_id where id=$1",[inv.id,OWNER]]]){
   await db.exec('savepoint stale_invoice_fixture');
   // Corrupt only the disposable fixture to model stale historical data that ordinary RPCs cannot create.
   await admin('alter table acc_invoices disable trigger acc_invoices_void_only');await admin(sql,params);await admin('alter table acc_invoices enable trigger acc_invoices_void_only');
   await rejected(()=>advance(packed.id,'dispatch'),/active linked.*invoice/i);
   assert.equal((await note(packed.id)).status,'ready');assert.equal((await stock(MACHINE_LOT)).reserved_units,1);
   await db.exec('rollback to savepoint stale_invoice_fixture;release savepoint stale_invoice_fixture');
  }
 });
 await scenario('Historical full-quote invoice with no line IDs reserves and delivers the complete accepted quantity',async()=>{
  const n=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),legacy.id,legacy.version,'Synthetic legacy approval',dates.delivery,'[]']);
  const reserved=await one('select * from create_tax_invoice_and_reserve_stock($1,$2,$3)',[n.id,n.version,'']);
  assert.equal(reserved.invoice_id,legacyInvoice.id);assert.equal((await stock(MACHINE_LOT)).reserved_units,2);
  assert.equal((await review(legacy)).legacy_invoice,true);await rejected(()=>invoice(legacy,[1]),/legacy|already|remaining|balance|existing/i);
  await deliver(legacyInvoice.id);assert.equal((await stock(MACHINE_LOT)).loose_units,8);
 });
 await scenario('Multiple product lines and cent rounding reconcile after split invoices, a void and replacement',async()=>{
  const pf=await createOrder([{...machine(4),unitPriceMinor:7,discountBasisPoints:1100,taxBasisPoints:1800},
   {...machine(3),productId:REAGENT,description:'Fictional rounded reagent',unitPriceMinor:3,discountBasisPoints:1300,taxBasisPoints:1800}]);
  const first=await invoice(pf,[2,1]),second=await invoice(pf,[1,1]);await cancel(first);await voidInvoice(first);
  const third=await invoice(pf,[3,2]);assert.equal((await pending(pf)).quantity,0);
  const totals=(await one('select sum(subtotal_minor)::bigint subtotal,sum(discount_minor)::bigint discount,sum(tax_minor)::bigint tax,sum(total_minor)::bigint total from acc_invoices where proforma_id=$1 and voided_at is null',[pf.id]));
  assert.deepEqual(totals,{subtotal:pf.subtotal_minor,discount:pf.discount_minor,tax:pf.tax_minor,total:pf.total_minor});
  for(const inv of [second,third]){const sums=inv.lines.reduce((a,l)=>a+Number(l.total_minor),0);assert.equal(sums,Number(inv.total_minor));await deliver(inv.id);}
  assert.equal((await review(pf)).lines.every(l=>l.remaining_quantity===0),true);
 });
 await scenario('Non-stock selected quantities fail clearly and leave no invoice or reservation',async()=>{
  await admin('insert into product_inventory_classifications(id,product_id,version,category,reason,created_by) values($1,$2,2,$3,$4,$5)',[fresh(),MACHINE,'non_stock','Synthetic unsupported stock type',OWNER]);
  const pf=await createOrder(),before=await counts(pf);await rejected(()=>invoice(pf,[2]),/non-stock|stock delivery|supported/i);
  assert.deepEqual(await counts(pf),before);assert.equal((await stock(MACHINE_LOT)).reserved_units,0);
 });
 console.log(`PASS: ${passed.length} partial-order database scenarios using actual migrations and workflow RPCs.`);
}catch(error){console.error('PARTIAL ORDER FAILED:',error.message,'\nContext:',error.where||'');process.exitCode=1;}
finally{await db.close();}
