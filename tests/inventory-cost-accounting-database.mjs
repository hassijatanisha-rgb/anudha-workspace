// Real migrations and RPCs in disposable PostgreSQL. No production data or connections.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610070073_receive_transfer_available_lot.sql','202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202610200120_machine_serial_requirement.sql','202610200121_receiving_machine_serials.sql','202611020156_accounting_posting_integrity.sql','202611020158_supplier_accounting.sql','202611020159_inventory_cost_accounting.sql','202611020160_customer_credit_settlement.sql']});
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,ORG,CONTACT,REAGENT,MACHINE,HUB,REAGENT_PACK,MACHINE_PACK,REAGENT_LOT,MACHINE_LOT,as,admin,one,dates}=f;
const INV='a0000000-0000-4000-8000-000000001400',EQ='a0000000-0000-4000-8000-000000003000';
let n=15000,checks=0;const fresh=()=>id(n++),json=JSON.stringify;
const reject=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const check=async(name,fn)=>{await db.exec('begin');await as(OWNER);try{await fn();await db.exec('set constraints all immediate');checks++;console.log('PASS: '+name);}finally{await db.exec('rollback');}};
const status=async()=>(await one('select inventory_cost_status() result')).result;
const activate=async(policy='weighted_average')=>{
 const cutover=(await one('select (current_date-1)::text d')).d,batch=fresh(),request=fresh();
 const rows=[{lot_id:MACHINE_LOT,expected_version:1,quantity:10,total_cost_minor:'100000',evidence_reference:'Verified machine cost register',acquired_on:cutover},{lot_id:REAGENT_LOT,expected_version:1,quantity:20,total_cost_minor:'20000',evidence_reference:'Verified reagent cost register',acquired_on:cutover}];
 await db.query('select import_financial_journals($1,$2,$3,$4::jsonb)',[batch,'Verified inventory GL','opening',json([{reference:'OPEN-'+batch,date:cutover,memo:'Verified opening inventory',lines:[{account_id:INV,debit_minor:120000,credit_minor:0,description:'Verified stock'},{account_id:EQ,credit_minor:120000,debit_minor:0,description:'Opening equity'}]}])]);
 const call=async(r=rows,p=policy)=>(await one('select activate_inventory_costing($1,$2,$3,$4,$5::jsonb,$6) result',[request,p,cutover,batch,json(r),'Accounts verified counts and acquisition costs'])).result;
 const result=await call();return {result,rows,call,batch};
};
const purchase=async(quantity=10,product=REAGENT)=>{
 const supplier=fresh();await db.query('select save_supplier($1,0,$2::jsonb)',[supplier,json({name:'Fictional supplier '+supplier})]);
 let po=await one('select * from save_purchase_request($1,0,$2,$3,$4,$5,$6::jsonb)',[fresh(),supplier,'TZS',dates.delivery,'Fixture purchase',json([{product_id:product,quantity}])]);
 po=await one("select * from advance_purchase_order($1,$2,'approve','Approved fixture')",[po.id,po.version]);
 po=await one("select * from advance_purchase_order($1,$2,'order','Ordered fixture','FIX-LPO',$3)",[po.id,po.version,dates.delivery]);
 const line=await one('select * from purchase_order_lines where purchase_order_id=$1',[po.id]);return {supplier,po,line};
};
const receive=async(p,quantity=10,overrides={})=>{
 const l=await one('select * from inventory_lots where id=$1',[REAGENT_LOT]);
 const args=[overrides.request??fresh(),p.line.id,overrides.lot??REAGENT_LOT,overrides.version??l.version,quantity,dates.today,'Supplier delivery reference',overrides.inspection??'pass','Reviewed received goods',json(overrides.details??{}),overrides.serials??[]];
 const call=(a=args)=>one('select * from receive_supplier_stock($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::text[])',a);
 return {row:await call(),args,call};
};
const bill=(p,r,value=30000,request=fresh())=>one('select post_supplier_bill($1,$2,$3,$4,$5,$6::jsonb,$7) result',[request,p.supplier,dates.today,dates.delivery,'Supplier invoice '+request,json([{account_id:INV,net_minor:String(value),tax_minor:'0',description:'Actual acquisition including allocated landed cost',product_id:p.line.product_id,stock_receipt_id:r.row.id,stock_quantity:String(r.row.quantity)}]),p.po.id]);
const quote=async(quantity=3)=>{
 await as(SALES);let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[fresh(),ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Stock cost fixture',json([{productId:REAGENT,description:'Reagent',quantity,uom:'kit',unitPriceMinor:10003,discountBasisPoints:0,taxBasisPoints:1800}])]);
 for(const action of ['send','accept'])pf=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[pf.id,pf.version,action,'Fixture customer '+action]);
 await as(ACCOUNTS);pf.line=await one('select * from sales_proforma_lines where proforma_id=$1',[pf.id]);return pf;
};
const invoice=(pf,quantity=3,request=fresh())=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[request,pf.id,pf.version,dates.today,dates.valid,json([{proforma_line_id:pf.line.id,quantity}]),'Fixture approval',dates.delivery,'']);
const note=invoiceId=>one("select * from sales_delivery_notes where invoice_id=$1 and status<>'cancelled'",[invoiceId]);
const advance=(r,action)=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[r.id,r.version,action,'Fixture truck','FIX-ROUTE','Fixture recipient','Fixture signed proof or cancellation']);
const dispatch=async inv=>{await as(ACCOUNTS);let r=await advance(await note(inv.id),'send_to_sales');await as(PACKER);r=await one('select * from packing_take_next()');r=await one('select * from packing_mark_packed($1,$2)',[r.id,r.version]);await as(DRIVER);return advance(r,'dispatch');};
const deliver=async inv=>{let d=await dispatch(inv);const proof=fresh(),path=`delivery/${d.id}/${proof}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[path,DRIVER,json({size:321,mimetype:'application/pdf'})]);
 await db.query('select finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',d.id,path,'Signed fixture.pdf','application/pdf',321]);
 d=await advance(d,'deliver');await as(ACCOUNTS);d.line=await one('select * from sales_delivery_lines where delivery_note_id=$1',[d.id]);return d;};
try{
 await check('activation is exact, evidenced, reconciled and does not repost opening GL',async()=>{
  const a=await activate(),s=await status();assert.equal(s.enabled,true);assert.equal(s.inventory_value_minor,'120000');assert.equal(s.difference_minor,'0');
  assert.equal((await a.call()).id,a.result.id);await reject(()=>a.call(a.rows,'fifo'),/different details/);
  assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,1);
  await reject(async()=>db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),(await one('select entry_id from acc_imported_journals where import_id=$1',[a.batch])).entry_id,dates.today,'Wrong imported value']),/active inventory/);
 });
 await check('existing operational issues remain available before activation',async()=>{
  const l=await one('select * from inventory_lots where id=$1',[REAGENT_LOT]);
  await db.query('select issue_consumer_units($1,$2,$3,$4,1,$5,$6,$7)',[fresh(),l.id,l.version,ORG,dates.today,'Direct issue','Fixture issued unit']);
  assert.equal((await one('select count(*)::int n from acc_stock_cost_events')).n,0);
 });
 await check('uncosted receipts block invoice atomically; bill cost unblocks and weighted average matches GL',async()=>{
  await activate();const p=await purchase(),r=await receive(p),pf=await quote();
  await reject(()=>invoice(pf),/uncosted receipts/);await as(OWNER);
  assert.equal((await r.call()).id,r.row.id);const changed=[...r.args];changed[4]=9;await reject(()=>r.call(changed),/different details/);
  const b=await bill(p,r),inv=await invoice(pf);assert.ok(b.result.id);
  assert.equal(Number((await one('select value_minor from acc_stock_invoice_costs where invoice_id=$1',[inv.id])).value_minor),5000);
  assert.equal((await status()).difference_minor,'0');
  await dispatch(inv);await as(OWNER);assert.equal((await one("select count(*)::int n from acc_stock_cost_events where source_type='invoice'")).n,1);
  assert.equal((await status()).products.find(p=>p.product_id===REAGENT).invoiced_undispatched_quantity,0);
 });
 await check('FIFO consumes oldest acquisition and invoice void restores original layer priority',async()=>{
  await activate('fifo');const p=await purchase(),r=await receive(p);await bill(p,r);const pf=await quote(),inv=await invoice(pf);
  assert.equal(Number((await one('select value_minor from acc_stock_invoice_costs where invoice_id=$1',[inv.id])).value_minor),3000);
  await advance(await note(inv.id),'cancel');await db.query('select void_invoice($1,$2,$3)',[inv.id,dates.today,'Incorrect fixture invoice']);
  const second=await invoice(pf);assert.equal(Number((await one('select value_minor from acc_stock_invoice_costs where invoice_id=$1',[second.id])).value_minor),3000);
  assert.equal((await status()).difference_minor,'0');
 });
 await check('unused stock bill void leaves physical quantity awaiting an exact replacement cost',async()=>{
  await activate();const p=await purchase(),r=await receive(p),b=(await bill(p,r)).result;
  await db.query('select void_supplier_bill($1,$2,$3)',[b.id,dates.today,'Incorrect supplier cost']);const pf=await quote();await reject(()=>invoice(pf),/uncosted receipts/);
  await bill(p,r,60000);await invoice(pf);await as(OWNER);assert.equal((await status()).difference_minor,'0');
 });
 await check('count gains and dated value corrections preserve ledger reconciliation and retry identity',async()=>{
  await activate();const request=fresh(),l=await one('select * from inventory_lots where id=$1',[REAGENT_LOT]);
  const gain=async(value=2500)=>(await one('select post_inventory_count_gain($1,$2,$3,2,$4,$5,$6) result',[request,l.id,l.version,value,dates.today,'Verified previously omitted purchase'])).result;
  const event=await gain();assert.equal((await gain()).id,event.id);await reject(()=>gain(5000),/different details/);
  const correction=fresh();await db.query('select correct_inventory_value($1,$2,-500,$3,$4)',[correction,event.id,dates.today,'Verified acquisition cost correction']);
  await reject(()=>db.query('select correct_inventory_value($1,$2,-999999,$3,$4)',[fresh(),event.id,dates.today,'Invalid negative valuation']),/negative/);
  const result=await status();assert.equal(result.difference_minor,'0');
  assert.deepEqual(result.value_corrections.map(row=>({id:row.id,amount_minor:row.amount_minor,product_id:row.product_id})),[{id:correction,amount_minor:'-500',product_id:REAGENT}]);
 });
 await check('supplier return and credit remove cost once and undo restores physical stock and ledger',async()=>{
  await activate();const p=await purchase(),r=await receive(p),b=(await bill(p,r)).result,l=await one('select * from inventory_lots where id=$1',[REAGENT_LOT]);
  const payment=fresh();await db.query('select post_supplier_payment($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[payment,p.supplier,dates.today,'30000','bank','Original paid stock bill','a0000000-0000-4000-8000-000000001200',json([{bill_id:b.id,amount_minor:'30000'}])]);
  const request=fresh(),args=[request,b.id,1,l.id,l.version,2,dates.today,'SUP-RET-1','Damaged supplier goods',0];
  const returned=()=>one('select return_supplier_stock($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',args);
  const first=(await returned()).result;assert.equal((await returned()).result.return.id,request);assert.equal(first.return.net_minor,'6000');
  assert.equal((await one('select get_supplier_books_page($1,$2) result',[dates.today,p.supplier])).result.payments.find(row=>row.id===payment).unapplied_minor,'6000');
  assert.equal((await status()).difference_minor,'0');assert.equal((await one('select loose_units from inventory_lots where id=$1',[l.id])).loose_units,28);
  await db.query('select void_supplier_credit($1,$2,$3)',[request,dates.today,'Return record was erroneous']);
  assert.equal((await one('select get_supplier_books_page($1,$2) result',[dates.today,p.supplier])).result.payments.find(row=>row.id===payment).unapplied_minor,'0');
  assert.equal((await one('select loose_units from inventory_lots where id=$1',[l.id])).loose_units,30);assert.equal((await status()).difference_minor,'0');
 });
 await check('customer return stays quarantined; credit restores original invoice cost after purchase prices change',async()=>{
  await activate();const pf=await quote(),inv=await invoice(pf),d=await deliver(inv);await as(OWNER);
  const p=await purchase(),r=await receive(p);await bill(p,r,90000);
  const ret=await one('select * from record_sales_return($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),d.id,'unopened','Actual returned fixture','',json([{deliveryLineId:d.line.id,quantity:1}])]);
  const rl=await one('select * from sales_return_lines where return_id=$1',[ret.id]);
  assert.equal((await one('select stock_status from inventory_lots where id=$1',[rl.quarantine_lot_id])).stock_status,'quarantine');
  assert.equal(Number((await one('select value_minor from acc_stock_return_costs where return_line_id=$1',[rl.id])).value_minor),1000);
  await reject(()=>db.query('select resolve_sales_return_line($1,$2,$3,$4,true)',[rl.id,ret.version,'restock','Inspected and safe']),/post the return credit/);
  const draft=await one('select * from create_return_credit_note($1,$2,$3)',[ret.id,ret.version,fresh()]);
  const credit=await one('select * from post_return_credit_note($1,$2,$3,$4)',[fresh(),draft.id,draft.version,dates.today]);
  assert.equal(Number((await one("select value_minor from acc_stock_cost_events where source_type='return_credit' and source_id=$1",[credit.id])).value_minor),1000);
  const latest=await one('select version from sales_returns where id=$1',[ret.id]);
  await db.query('select resolve_sales_return_line($1,$2,$3,$4,true)',[rl.id,latest.version,'restock','Inspected and safe']);
  assert.equal((await status()).difference_minor,'0');
 });
 await check('transfers preserve valuation and shortages post the exact missing quantity as a stock loss',async()=>{
  await activate();const location=fresh();await db.query("select save_inventory_location($1,0,'Fixture godown','FIX-G','godown',true)",[location]);
  // Repack fixture stock without changing base units, using the privileged fixture boundary.
  await admin('update inventory_lots set sealed_cartons=5,loose_units=15 where id=$1',[REAGENT_LOT]);
  let t=await one('select * from request_inventory_transfer($1,$2,$3,5,$4,$5)',[fresh(),REAGENT_LOT,location,dates.delivery,'Verified transfer']);
  t=await one('select * from dispatch_inventory_transfer($1,$2,1,$3)',[t.id,t.version,'Verified dispatch']);
  assert.equal((await status()).inventory_value_minor,'120000');
  t=await one('select * from receive_inventory_transfer($1,$2,4,$3,$4)',[t.id,t.version,'pass','Counted shortage on receipt']);
  assert.equal(t.status,'quarantine');assert.equal((await status()).inventory_value_minor,'119000');assert.equal((await status()).difference_minor,'0');
  const lot=await one('select l.* from inventory_lots l join inventory_movements m on m.lot_id=l.id where m.transfer_id=$1 and m.base_unit_change>0',[t.id]);assert.equal(lot.stock_status,'quarantine');
 });
 await check('new receipt lots preserve inspection status and verified quantity; foreign product cost is rejected',async()=>{
  await activate();const p=await purchase(),r=await receive(p,10,{lot:fresh(),version:0,inspection:'quarantine',details:{location_id:HUB,pack_definition_id:REAGENT_PACK,batch_number:'NEW-Q',expiry_date:null}});
  assert.equal((await one('select stock_status from inventory_lots where id=$1',[r.row.lot_id])).stock_status,'quarantine');
  await reject(()=>one('select post_supplier_bill($1,$2,$3,$4,$5,$6::jsonb,$7)',[fresh(),p.supplier,dates.today,dates.delivery,'Wrong product',json([{account_id:INV,net_minor:'30000',tax_minor:'0',product_id:MACHINE,stock_receipt_id:r.row.id,stock_quantity:'10'}]),p.po.id]),/match the receipt/);
  await bill(p,r);assert.equal((await status()).products.find(p=>p.product_id===REAGENT).quarantine_quantity,10);
 });
 await check('books locks stop both quantity and cost writes atomically',async()=>{
  await activate();await admin('update acc_settings set locked_through=current_date where id');
  const lot=await one('select * from inventory_lots where id=$1',[REAGENT_LOT]);
  await reject(()=>db.query('select issue_consumer_units($1,$2,$3,$4,1,$5,$6,$7)',[fresh(),lot.id,lot.version,ORG,dates.today,'Direct issue','Fixture issued unit']),/books lock/);
  assert.equal((await one('select loose_units from inventory_lots where id=$1',[lot.id])).loose_units,lot.loose_units);
 });
 await check('customer credit void and explicit replacement reverse and restore exact original cost once',async()=>{
  await activate('fifo');const pf=await quote(),inv=await invoice(pf),d=await deliver(inv);await as(OWNER);
  const ret=await one('select * from record_sales_return($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),d.id,'unopened','Actual returned fixture','',json([{deliveryLineId:d.line.id,quantity:1}])]);
  const rl=await one('select * from sales_return_lines where return_id=$1',[ret.id]),draft=await one('select * from create_return_credit_note($1,$2,$3)',[ret.id,ret.version,fresh()]);
  const credit=await one('select * from post_return_credit_note($1,$2,$3,$4)',[fresh(),draft.id,draft.version,dates.today]);
  await db.query('select void_return_credit_note($1,$2,$3)',[credit.id,dates.today,'Wrong credit posting date']);
  assert.equal((await status()).difference_minor,'0');
  const latest=await one('select version from sales_returns where id=$1',[ret.id]);
  await reject(()=>db.query('select resolve_sales_return_line($1,$2,$3,$4,true)',[rl.id,latest.version,'restock','Inspected and safe']),/post the return credit/);
  const replacement=fresh();await db.query('select repost_return_credit_note($1,$2,$3)',[replacement,credit.id,dates.today]);
  assert.equal(Number((await one("select sum(value_minor) value from acc_stock_cost_events where source_line_id=$1 and source_type in ('return_credit','return_credit_void')",[rl.id])).value),1000);
  await db.query('select resolve_sales_return_line($1,$2,$3,$4,true)',[rl.id,latest.version,'restock','Inspected and safe']);
  await reject(()=>db.query('select void_return_credit_note($1,$2,$3)',[replacement,dates.today,'Cannot undo restocked goods']),/stock resolution/);
  assert.equal((await status()).difference_minor,'0');
 });
 await check('machine receiving preserves actual serial identity through supplier return and undo',async()=>{
  await activate();const p=await purchase(2,MACHINE),lot=fresh(),details={location_id:HUB,pack_definition_id:MACHINE_PACK,batch_number:'NEW-MACHINES',expiry_date:null};
  await reject(()=>receive(p,2,{lot,version:0,details,serials:['REAL-M-ONE']}),/one unique real serial/);
  assert.equal(await one('select id from inventory_lots where id=$1',[lot]),undefined);
  const r=await receive(p,2,{lot,version:0,details,serials:['REAL-M-ONE','REAL-M-TWO']}),b=(await bill(p,r)).result;
  const serial=await one('select id from inventory_serial_receipts where lot_id=$1 and serial_number=$2',[lot,'REAL-M-ONE']),request=fresh();
  await db.query('select return_supplier_stock($1,$2,1,$3,1,1,$4,$5,$6,0,$7::text[])',[request,b.id,lot,dates.today,'MACHINE-RETURN','Erroneous unit supplied',['REAL-M-ONE']]);
  assert.equal((await admin('select inventory_serial_available_lot($1) lot',[serial.id])).rows[0].lot,null);
  await db.query('select void_supplier_credit($1,$2,$3)',[request,dates.today,'Supplier return recorded in error']);
  assert.equal((await admin('select inventory_serial_available_lot($1) lot',[serial.id])).rows[0].lot,lot);
  assert.equal((await status()).difference_minor,'0');
 });
 await check('accounting permissions and internal cost hooks cannot be bypassed',async()=>{
  for(const signature of ['acc_inventory_lock()','acc_inventory_consume(uuid,bigint,date,text,uuid,uuid,text)','acc_validate_supplier_stock_credit(uuid,uuid,integer,uuid,bigint,bigint,date)','acc_void_supplier_stock_credit(uuid,date,text)','acc_void_return_credit_cost(uuid,date)'])
   for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,$3) allowed',[role,'public.'+signature,'execute'])).allowed,false,signature);
  await as(SALES);await reject(()=>status(),/Accounting access/);
 });
 console.log(`PASS: ${checks} inventory cost accounting scenarios.`);
}catch(error){console.error('FAIL:',error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
