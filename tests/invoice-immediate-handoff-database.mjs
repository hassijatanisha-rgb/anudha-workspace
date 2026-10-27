// Actual migrations/RPCs in disposable PGlite; no production connection or records.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const migrations=['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180109_order_task_readiness.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202610200113_task_progress_history.sql','202610200114_travel_visit_planning.sql','202610200115_independent_service_intake.sql','202610200116_customer_contracts.sql','202610200117_proforma_commercial_terms.sql','202610200118_delivery_installation_choice.sql','202610200119_product_pricing_control.sql','202610200120_machine_serial_requirement.sql','202610200121_receiving_machine_serials.sql','202610200122_product_brochure_attachments.sql'];
const f=await createOrderFixture({extraMigrations:migrations});
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,ENGINEER,OUTSIDER,ORG,CONTACT,MACHINE,REAGENT,HUB,MACHINE_PACK,MACHINE_LOT,REAGENT_LOT,as,admin,one,dates}=f;
let sequence=9000,checks=0;const fresh=()=>id(sequence++);
const machine=quantity=>({productId:MACHINE,description:'Fictional planning analyzer',quantity,uom:'unit',unitPriceMinor:100000,discountBasisPoints:0,taxBasisPoints:1800});
const reagent=quantity=>({...machine(quantity),productId:REAGENT,description:'Fictional reagent',unitPriceMinor:2000});
const reject=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const scenario=async(label,fn)=>{await db.exec('begin');try{await fn();await db.exec('set constraints all immediate');checks++;console.log('PASS: '+label);}finally{await db.exec('rollback');}};
const note=id=>one('select * from sales_delivery_notes where id=$1',[id]);
const cases=async n=>(await admin('select * from service_cases where source_delivery_note_id=$1 order by planned_delivery_line_id,planned_unit_number,id',[n.id])).rows;
const stock=async()=> (await admin('select id,loose_units,reserved_units,version from inventory_lots order by id')).rows;
const snapshot=async()=>{const result={};for(const table of ['acc_invoices','acc_journal_entries','sales_delivery_notes','sales_delivery_lines','service_cases','equipment_assets','service_case_events','work_assignments','inventory_lots','pending_stock_requests','pending_stock_events','inventory_issues','inventory_movements'])result[table]=(await admin(`select * from ${table} order by id`)).rows;return result;};
async function order(lines=[machine(4)],required=true){
 await as(SALES);let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)',[fresh(),ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Synthetic order',JSON.stringify(lines),'sale',null,required,'Installation labour separately quoted','PRIVATE NEGOTIATION']);
 for(const action of ['send','accept'])pf=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[pf.id,pf.version,action,'Synthetic customer '+action]);
 const items=(await db.query('select * from sales_proforma_lines where proforma_id=$1 order by sort_order',[pf.id])).rows;return {...pf,items};
}
const invoiceArgs=(pf,quantities,request=fresh())=>[request,pf.id,pf.version,dates.today,dates.valid,JSON.stringify(quantities.map((q,i)=>({proforma_line_id:pf.items[i].id,quantity:q})).filter(l=>l.quantity)),'Synthetic approval',dates.delivery,''];
const post=args=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',args);
async function invoice(pf,q){await as(ACCOUNTS);const result=await post(invoiceArgs(pf,q));return {invoice:result,note:await one("select * from sales_delivery_notes where invoice_id=$1 and status<>'cancelled'",[result.id])};}
async function advance(n,action){return one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[n.id,(await note(n.id)).version,action,'Synthetic truck','SYNTHETIC-ROUTE','Synthetic recipient','Synthetic signed proof / cancellation']);}
async function progress(c,action){await as(ENGINEER);const current=await one('select * from service_cases where id=$1',[c.id]);return one('select * from advance_service_case($1,$2,$3,$4,$5,$6)',[c.id,current.version,action,action==='assign'?ENGINEER:null,action==='schedule'?dates.today:null,'Synthetic planning '+action]);}
async function deliver(n,serials,{manualSend=false,guardChecks=false,packingStarted=false}={}){
 await as(ACCOUNTS);if(manualSend)n=await advance(n,'send_to_sales');
 await as(PACKER);if(!packingStarted)n=await one('select * from start_reserved_sales_delivery_packing($1,$2)',[n.id,(await note(n.id)).version]);
 if(guardChecks){await reject(()=>db.query('select packing_mark_packed($1,$2)',[n.id,n.version]),/real serial number/);await db.exec('reset role');await reject(()=>db.query("update sales_delivery_notes set status='out_for_delivery' where id=$1",[n.id]),/real serial number|dispatch|ready|invoice/i);await db.exec('set role authenticated');}
 const lines=(await admin('select * from sales_delivery_lines where delivery_note_id=$1 and product_id=$2 order by id',[n.id,MACHINE])).rows;let offset=0;
 if(lines.length){const entries=lines.map(l=>({deliveryLineId:l.id,serials:serials.slice(offset,(offset+=l.quantity)),legacyConfirmed:false}));
  await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[n.id,(await note(n.id)).version,JSON.stringify(entries)]);}
 n=await one('select * from packing_mark_packed($1,$2)',[n.id,(await note(n.id)).version]);
 await as(ACCOUNTS);const inv=await one('select * from acc_invoices where id=$1',[n.invoice_id]);await db.query('select record_invoice_fiscal($1,$2,$3,$4,$5)',[inv.id,'FIX-TRA-'+sequence++,'FIX-VERIFY','100-200-300','10-123456-X']);
 await as(DRIVER);n=await advance(n,'dispatch');
 if(guardChecks)await reject(()=>advance(n,'deliver'),/upload.*signed|signed.*delivery/i);
 const proof=fresh(),path=`delivery/${n.id}/${proof}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[path,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',n.id,path,'Synthetic signed delivery.pdf','application/pdf',321]);
 return advance(n,'deliver');
}
const reportArgs=(c,serial)=>[c.id,c.version,dates.today,'Fictional Analyzer Model',serial,'Fixture Dar laboratory','','Installation and training','Installed, tested and trained the fictional clinic','',ENGINEER,'Fixture Engineer',dates.today,'Fixture Customer',dates.today,'FIX-CUSTOMER','Fixture Engineer',dates.today,'FIX-ANUDHA',true,'completed',false,null,null,null,'TZS',0,'',6,JSON.stringify([]),JSON.stringify([{full_name:'Fixture Trainee',telephone:'000000000',designation:'Lab technician'}])];
const complete=args=>one(`select * from complete_service_report(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
const summary=async pf=>(await one('select order_live_status($1::uuid[]) rows',[[pf.id]])).rows[0].quantity_summary;
try{
 await as(OWNER);for(const [product,price] of [[MACHINE,100000],[REAGENT,2000]])await db.query('select set_product_sale_price($1,$2,$3,$4,$5,$6)',[fresh(),product,'TZS',0,price,'Explicit fictional test price']);
 const receiptSerials=['HISTORICAL-UNIT','PLAN-A','PLAN-B','EXTERNAL-REUSE'];
 const receiptLot=(await admin('select * from inventory_lots where id=$1',[MACHINE_LOT])).rows[0];
 await db.query('select receive_serialized_inventory($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10::text[])',[MACHINE_LOT,receiptLot.version,MACHINE,HUB,MACHINE_PACK,receiptLot.batch_number,receiptLot.sealed_cartons,receiptLot.loose_units+receiptSerials.length,'Explicit fictional received machine serials',receiptSerials]);
 const historical=await invoice(await order([machine(1)]),[1]);historical.note=await deliver(historical.note,['HISTORICAL-UNIT'],{manualSend:true});
 const legacyWaiting=await invoice(await order([reagent(1)]),[1]);
 const beforeMigration=await snapshot();await db.exec('reset role');await f.load('202610270123_invoice_immediate_handoffs.sql');await f.load('202610270124_workflow_status_clarity.sql');await db.exec('set role authenticated');
 const afterMigration=await snapshot();
 for(const table of Object.keys(beforeMigration)){const rows=afterMigration[table].map(row=>{if(table!=='service_cases')return row;const {planned_delivery_line_id,planned_unit_number,delivery_ready,reused_case_id,...prior}=row;assert.equal(delivery_ready,true);assert.equal(planned_delivery_line_id,null);assert.equal(planned_unit_number,null);assert.equal(reused_case_id,null);return prior;});assert.deepEqual(rows,beforeMigration[table],`Migration preserves existing ${table}`);}
 console.log('PASS: migration preserves all existing workflow rows and history');checks++;
 await scenario('Combined status migration exposes waiting identities and void-aware order quantities to permitted roles',async()=>{
  await as(PACKER);const board=(await one('select packing_queue_board() board')).board;assert.ok(Array.isArray(board.coming.items));
  const waiting=board.coming.items.find(item=>item.id===legacyWaiting.note.id);assert.equal(waiting.delivery_number,legacyWaiting.note.delivery_number);assert.equal(waiting.status,'tax_invoice_created');assert.equal(waiting.organization,'Fictional Clinic');assert.ok(waiting.owner_name);
  const pf=await order(),args=invoiceArgs(pf,[2]);await as(ACCOUNTS);const inv=await post(args);assert.deepEqual(await summary(pf),{ordered:4,invoiced:2,pending:2});
  await post(args);assert.deepEqual(await summary(pf),{ordered:4,invoiced:2,pending:2});
  const n=await one('select * from sales_delivery_notes where invoice_id=$1',[inv.id]);await advance(n,'cancel');await db.query('select void_invoice($1,$2,$3)',[inv.id,dates.today,'Synthetic status-summary reversal']);
  assert.deepEqual(await summary(pf),{ordered:4,invoiced:0,pending:4});await as(OUTSIDER);await reject(()=>db.query('select order_live_status($1::uuid[])',[[pf.id]]),/access/);await reject(()=>db.query('select packing_queue_board()'),/access/);
 });
 await scenario('Partial invoice atomically queues reserved stock and creates only invoiced machine plans',async()=>{
  const pf=await order([machine(4),reagent(3)]),before=await stock(),p=await invoice(pf,[2,1]);
  assert.equal(p.note.status,'sent_to_sales');assert.ok(p.note.packing_queued_at);assert.equal(p.note.packer_user_id,null);
  const plans=await cases(p.note);assert.equal(plans.length,2);assert.ok(plans.every(c=>c.asset_id===null&&!c.delivery_ready&&c.status==='new'&&c.product_id===MACHINE&&c.created_by===ACCOUNTS));
  assert.deepEqual(plans.map(c=>c.planned_unit_number),[1,2]);assert.ok(plans.every(c=>/separately quoted/.test(c.problem_summary)&&!JSON.stringify(c).includes('PRIVATE NEGOTIATION')));
  assert.equal((await admin('select count(*)::int n from equipment_assets')).rows[0].n,beforeMigration.equipment_assets.length);
  const after=await stock();for(const [lot,q] of [[MACHINE_LOT,2],[REAGENT_LOT,1]]){assert.equal(after.find(l=>l.id===lot).loose_units,before.find(l=>l.id===lot).loose_units);assert.equal(after.find(l=>l.id===lot).reserved_units,before.find(l=>l.id===lot).reserved_units+q);}
  const pending=(await admin("select product_id,quantity from pending_stock_requests where proforma_id=$1 and status='waiting' order by product_id",[pf.id])).rows;assert.ok(pending.some(x=>x.product_id===MACHINE&&x.quantity===2));assert.ok(pending.some(x=>x.product_id===REAGENT&&x.quantity===2));
  const events=(await admin('select from_status,to_status from sales_delivery_events where delivery_note_id=$1',[p.note.id])).rows;assert.ok(events.some(e=>e.from_status==='accounts_approved'&&e.to_status==='tax_invoice_created'));assert.ok(events.some(e=>e.from_status==='tax_invoice_created'&&e.to_status==='sent_to_sales'));
  await as(ENGINEER);assert.equal((await one('select count(*)::int n from service_cases where source_delivery_note_id=$1',[p.note.id])).n,2);
  for(const c of plans)assert.equal((await one("select assignee_user_id from work_assignments where record_id=$1 and status='open'",[c.id])).assignee_user_id,ENGINEER);
  await as(PACKER);const claim=await one('select * from packing_take_next()');assert.equal(claim.id,p.note.id);assert.equal(claim.packer_user_id,PACKER);assert.equal(claim.packing_auto_reserved,false);
  await reject(()=>db.query('select packing_take_next()'),/packing.*now|already.*packing/i);
 });
 await scenario('Consumable-only and installation-deferred invoices also queue, without machine plans',async()=>{
  for(const [lines,required] of [[[reagent(1)],true],[[machine(1)],false]]){const p=await invoice(await order(lines,required),[1]);assert.equal(p.note.status,'sent_to_sales');assert.equal((await cases(p.note)).length,0);}
 });
 await scenario('Same-content retry is inert and invalid/stale/unauthorized invoices leave no effects',async()=>{
  const pf=await order(),args=invoiceArgs(pf,[2]);await as(ACCOUNTS);const inv=await post(args),saved=await snapshot();assert.equal((await post(args)).id,inv.id);assert.deepEqual(await snapshot(),saved);
  const changed=[...args];changed[5]=JSON.stringify([{proforma_line_id:pf.items[0].id,quantity:1}]);await reject(()=>post(changed),/different details|already used/);
  const stale=invoiceArgs(pf,[1]);stale[2]--;await reject(()=>post(stale),/changed|refresh/);
  for(const actor of [SALES,PACKER,ENGINEER,OUTSIDER]){await as(actor);await reject(()=>post(invoiceArgs(pf,[1])),/access|account/i);}
  assert.deepEqual(await snapshot(),saved);
 });
 await scenario('Later-line shortages and expired stock roll back invoice, queue, planning, journal and reservations',async()=>{
  const pf=await order([machine(1),reagent(30)]);await as(ACCOUNTS);let saved=await snapshot();await reject(()=>post(invoiceArgs(pf,[1,30])),/not enough available stock/i);assert.deepEqual(await snapshot(),saved);
  await admin('update inventory_lots set expiry_date=current_date-1 where id=$1',[MACHINE_LOT]);saved=await snapshot();await reject(()=>post(invoiceArgs(pf,[1,1])),/not enough available stock/i);assert.deepEqual(await snapshot(),saved);
 });
 await scenario('Installation planning fan-out is bounded atomically; exact limit and non-planning invoices remain supported',async()=>{
  await admin('update inventory_lots set loose_units=5000 where id=any($1::uuid[])',[[MACHINE_LOT,REAGENT_LOT]]);
  const tooMany=await order([machine(1001)]);await as(ACCOUNTS);const saved=await snapshot();await reject(()=>post(invoiceArgs(tooMany,[1001])),/batches of at most 1,000/);assert.deepEqual(await snapshot(),saved);
  const maximum=await invoice(await order([machine(1000)]),[1000]);assert.equal((await cases(maximum.note)).length,1000);assert.equal(maximum.note.status,'sent_to_sales');
  const deferred=await invoice(await order([machine(1001)],false),[1001]);assert.equal((await cases(deferred.note)).length,0);assert.equal(deferred.note.status,'sent_to_sales');
  const consumables=await invoice(await order([reagent(1001)]),[1001]);assert.equal((await cases(consumables.note)).length,0);assert.equal(consumables.note.status,'sent_to_sales');
 });
 await scenario('Planning assignment/date survive signed delivery; pre-delivery work and reports are blocked',async()=>{
  const p=await invoice(await order([machine(2)]),[2]),initial=await cases(p.note);let c=await progress(initial[0],'assign');c=await progress(c,'schedule');
  await reject(()=>progress(c,'start'),/awaiting signed delivery/);await as(ENGINEER);await reject(()=>complete(reportArgs(c,'PLAN-A')),/awaiting signed delivery/);
  const scheduled=(await admin('select * from service_cases where id=$1',[c.id])).rows[0];const before=await stock();p.note=await deliver(p.note,['PLAN-A','PLAN-B'],{guardChecks:true});
  const plans=await cases(p.note);assert.deepEqual(plans.map(x=>x.id),initial.map(x=>x.id));assert.ok(plans.every(x=>x.delivery_ready&&x.asset_id));
  c=plans.find(x=>x.id===c.id);assert.equal(c.status,'scheduled');assert.equal(c.assigned_user_id,ENGINEER);assert.deepEqual(c.scheduled_for,scheduled.scheduled_for);
  assert.equal((await stock()).find(x=>x.id===MACHINE_LOT).loose_units,before.find(x=>x.id===MACHINE_LOT).loose_units-2);
  const delivered=await snapshot();await admin('update sales_delivery_notes set status=status where id=$1',[p.note.id]);assert.deepEqual(await snapshot(),delivered);
  c=await progress(c,'start');c=await progress(c,'submit_report');const asset=(await admin('select * from equipment_assets where id=$1',[c.asset_id])).rows[0];
  await as(ENGINEER);await reject(()=>complete(reportArgs(c,'WRONG-SERIAL')),/serial must match/);c=await complete(reportArgs(c,asset.serial_number));assert.equal(c.status,'completed');
  assert.equal((await one('select count(*)::int n from service_reports where case_id=$1',[c.id])).n,1);assert.equal((await one('select count(*)::int n from service_cases where source_case_id=$1',[c.id])).n,1);
  const finished=await snapshot();await reject(()=>complete(reportArgs(c,asset.serial_number)),/not ready|changed/);assert.deepEqual(await snapshot(),finished);
 });
 for(const setting of ['absent','false'])await scenario(`An invoiced installation retains serial identity after category correction with serial setting ${setting}`,async()=>{
  const p=await invoice(await order([machine(1)]),[1]),plan=(await cases(p.note))[0];await as(OWNER);
  await db.query('select save_product_inventory_classification($1,$2,1,$3,$4)',[fresh(),MACHINE,'consumables','Synthetic corrected product category after invoice']);
  if(setting==='absent')await admin('delete from product_serial_settings where product_id=$1',[MACHINE]);else await db.query('select set_product_serial_required($1,false)',[MACHINE]);
  await as(PACKER);let n=await one('select * from start_reserved_sales_delivery_packing($1,$2)',[p.note.id,(await note(p.note.id)).version]);
  assert.deepEqual((await one('select planned_delivery_serial_lines($1::uuid[]) lines',[[n.id]])).lines,[{delivery_line_id:plan.planned_delivery_line_id}]);
  assert.deepEqual((await one('select planned_delivery_serial_lines($1::uuid[]) lines',[[fresh()]])).lines,[]);
  await reject(()=>db.query('select * from planned_delivery_serial_lines($1::uuid[])',[Array(101).fill(n.id)]),/1 and 100/);
  const before=await snapshot();await reject(()=>db.query('select packing_mark_packed($1,$2)',[n.id,n.version]),/real serial number/);assert.deepEqual(await snapshot(),before);
  await db.exec('reset role');for(const status of ['out_for_delivery','delivered'])await reject(()=>db.query('update sales_delivery_notes set status=$1 where id=$2',[status,n.id]),/real serial number/);await db.exec('set role authenticated');assert.deepEqual(await snapshot(),before);
  const line=await one('select * from sales_delivery_lines where delivery_note_id=$1',[n.id]);
  await reject(()=>db.query('select record_delivery_serials($1,$2,$3::jsonb)',[n.id,n.version,JSON.stringify([{deliveryLineId:line.id,serials:['UNRECEIVED-DRIFT-UNIT'],legacyConfirmed:false}])]),/no receiving record/);assert.deepEqual(await snapshot(),before);
  await as(OUTSIDER);await reject(()=>db.query('select record_delivery_serials($1,$2,$3::jsonb)',[n.id,n.version,JSON.stringify([{deliveryLineId:line.id,serials:['PLAN-A'],legacyConfirmed:false}])]),/access/);await reject(()=>db.query('select * from planned_delivery_serial_lines($1::uuid[])',[[n.id]]),/access/);
  n=await deliver(n,['PLAN-A'],{packingStarted:true});assert.equal(n.status,'delivered');
  const bound=(await cases(n))[0];assert.equal(bound.id,plan.id);assert.equal(bound.delivery_ready,true);
  const asset=(await admin('select * from equipment_assets where id=$1',[bound.asset_id])).rows[0];assert.equal(asset.serial_number,'PLAN-A');assert.equal(asset.serial_unknown,false);
  const unrelated=await invoice(await order([machine(1)]),[1]);assert.equal((await cases(unrelated.note)).length,0);await as(PACKER);
  const next=await one('select * from start_reserved_sales_delivery_packing($1,$2)',[unrelated.note.id,unrelated.note.version]);assert.equal((await one('select * from packing_mark_packed($1,$2)',[next.id,next.version])).status,'ready');
 });
 await scenario('Packing and dispatch revalidate recorded receipt identity and its currently allocated lot',async()=>{
  const p=await invoice(await order([machine(1)]),[1]);await as(PACKER);let n=await one('select * from start_reserved_sales_delivery_packing($1,$2)',[p.note.id,p.note.version]);
  const line=await one('select * from sales_delivery_lines where delivery_note_id=$1',[n.id]);
  await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[n.id,n.version,JSON.stringify([{deliveryLineId:line.id,serials:['PLAN-A'],legacyConfirmed:false}])]);n=await note(n.id);
  const serial=await one('select * from delivery_line_serials where delivery_line_id=$1',[line.id]);
  const wrongLot=fresh();await admin('insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units,reserved_units) values($1,$2,$3,$4,$5,1,1)',[wrongLot,MACHINE,HUB,MACHINE_PACK,'WRONG-ALLOCATED-LOT']);
  for(const damage of ['receipt','quarantine','wrong-lot']){
   await db.exec('savepoint altered_serial_boundary');
   if(damage==='receipt')await admin('update delivery_line_serials set inventory_serial_id=null where id=$1',[serial.id]);
   else if(damage==='quarantine')await admin("update inventory_lots set stock_status='quarantine' where id=$1",[MACHINE_LOT]);
   else await admin('update sales_delivery_lines set lot_id=$1 where id=$2',[wrongLot,line.id]);
   const before=await snapshot();await reject(()=>db.query('select packing_mark_packed($1,$2)',[n.id,n.version]),/real serial number|Reserved Haadi stock/);
   await db.exec('reset role');await reject(()=>db.query("update sales_delivery_notes set status='out_for_delivery' where id=$1",[n.id]),/real serial number/);await db.exec('set role authenticated');assert.deepEqual(await snapshot(),before);
   await db.exec('rollback to savepoint altered_serial_boundary;release savepoint altered_serial_boundary');
  }
  assert.equal((await one('select * from packing_mark_packed($1,$2)',[n.id,n.version])).status,'ready');
 });
 await scenario('A known independent asset/open installation is reused without phantom equipment or history loss',async()=>{
  await as(ENGINEER);const existing=await one("select * from create_service_intake($1,'installation',null,null,$2,null,$3,$4,'External model','EXTERNAL-REUSE',false,'Existing site','','Install existing machine','legacy')",[fresh(),ORG,CONTACT,MACHINE]);
  const saved=(await admin('select * from service_cases where id=$1',[existing.id])).rows[0],assetCount=(await admin('select count(*)::int n from equipment_assets')).rows[0].n;
  const p=await invoice(await order([machine(1)]),[1]),plan=(await cases(p.note))[0];await deliver(p.note,['EXTERNAL-REUSE']);
  const reconciled=(await cases(p.note))[0];assert.equal(reconciled.id,plan.id);assert.equal(reconciled.status,'cancelled');assert.equal(reconciled.reused_case_id,existing.id);assert.equal(reconciled.asset_id,existing.asset_id);assert.equal(reconciled.delivery_ready,true);
  assert.equal((await admin('select count(*)::int n from equipment_assets')).rows[0].n,assetCount);assert.deepEqual((await admin('select * from service_cases where id=$1',[existing.id])).rows[0],saved);
  assert.equal((await admin("select count(*)::int n from service_cases where asset_id=$1 and case_type='installation' and status not in ('completed','cancelled')",[existing.asset_id])).rows[0].n,1);
  assert.equal((await admin("select count(*)::int n from work_assignments where record_id=$1 and status='open'",[plan.id])).rows[0].n,0);
 });
 await scenario('Returned machine redelivery reuses the canonical asset and open job while preserving source history',async()=>{
  const first=await invoice(await order([machine(1)]),[1]);await deliver(first.note,['PLAN-A']);const original=(await cases(first.note))[0];
  const asset=(await admin('select * from equipment_assets where id=$1',[original.asset_id])).rows[0];await as(OWNER);
  const line=await one('select * from sales_delivery_lines where delivery_note_id=$1',[first.note.id]);
  let returned=await one('select * from record_sales_return($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),first.note.id,'unopened','Synthetic returned unused machine','',JSON.stringify([{deliveryLineId:line.id,quantity:1}])]);
  const returnLine=await one('select * from sales_return_lines where return_id=$1',[returned.id]);
  await db.query('select resolve_sales_return_line($1,$2,$3,$4,$5)',[returnLine.id,returned.version,'restock','Synthetic count and seal verified',true]);
  await db.query('select mark_serials_returned($1,$2::text[])',[returnLine.id,['PLAN-A']]);
  const count=(await admin('select count(*)::int n from equipment_assets')).rows[0].n;
  const second=await invoice(await order([machine(1)]),[1]);await deliver(second.note,['PLAN-A']);const reused=(await cases(second.note))[0];
  assert.equal(reused.reused_case_id,original.id);assert.equal(reused.asset_id,asset.id);assert.equal(reused.status,'cancelled');
  assert.equal((await admin('select count(*)::int n from equipment_assets')).rows[0].n,count);assert.deepEqual((await admin('select * from equipment_assets where id=$1',[asset.id])).rows[0],asset);
  assert.deepEqual((await admin('select * from service_cases where id=$1',[original.id])).rows[0],original);
 });
 await scenario('Installation-deferred delivery records the actual asset without creating a planning job',async()=>{
  const p=await invoice(await order([machine(1)],false),[1]);assert.equal((await cases(p.note)).length,0);await deliver(p.note,['PLAN-B']);
  assert.equal((await cases(p.note)).length,0);const asset=(await admin('select a.* from equipment_assets a join sales_delivery_lines l on l.id=a.source_delivery_line_id where l.delivery_note_id=$1',[p.note.id])).rows[0];assert.equal(asset.serial_number,'PLAN-B');assert.equal(asset.serial_unknown,false);
 });
 await scenario('Packing release retains reservations and planning; cancelling a claimed order closes plans',async()=>{
  const p=await invoice(await order([machine(1)]),[1]);await as(PACKER);let claimed=await one('select * from packing_take_next()');assert.equal(claimed.id,p.note.id);
  const beforeStock=await stock(),beforePlans=await cases(p.note);await as(OWNER);let released=await one('select * from packing_release($1,$2,$3)',[claimed.id,claimed.version,'Synthetic packer shift ended']);
  assert.equal(released.status,'sent_to_sales');assert.deepEqual(await stock(),beforeStock);assert.deepEqual(await cases(p.note),beforePlans);
  await as(PACKER);claimed=await one('select * from packing_take_next()');await as(OWNER);await advance(claimed,'cancel');
  assert.equal((await cases(p.note))[0].status,'cancelled');assert.equal((await stock()).find(l=>l.id===MACHINE_LOT).reserved_units,beforeStock.find(l=>l.id===MACHINE_LOT).reserved_units-1);
 });
 await scenario('Cancellation closes early plans, releases reservation once, and void reopens the exact balance',async()=>{
  const pf=await order(),p=await invoice(pf,[2]);let c=(await cases(p.note))[0];c=await progress(c,'assign');await progress(c,'schedule');
  await as(ACCOUNTS);await reject(()=>db.query('select void_invoice($1,$2,$3)',[p.invoice.id,dates.today,'Synthetic reversal']),/active or completed delivery/);
  const before=await stock();await advance(p.note,'cancel');const plans=await cases(p.note);assert.ok(plans.every(x=>x.status==='cancelled'&&!x.delivery_ready&&x.asset_id===null));
  assert.equal((await stock()).find(x=>x.id===MACHINE_LOT).reserved_units,before.find(x=>x.id===MACHINE_LOT).reserved_units-2);
  const cancelled=await snapshot();await reject(()=>advance(p.note,'cancel'),/next allowed/);assert.deepEqual(await snapshot(),cancelled);await reject(()=>progress(c,'start'),/awaiting signed delivery/);
  await as(ACCOUNTS);await db.query('select void_invoice($1,$2,$3)',[p.invoice.id,dates.today,'Synthetic cancellation reversal']);assert.equal((await one("select quantity from pending_stock_requests where proforma_id=$1 and status='waiting'",[pf.id])).quantity,4);
  const replacement=await invoice(pf,[2]);assert.equal((await cases(replacement.note)).length,2);assert.notEqual(replacement.note.id,p.note.id);
 });
 await scenario('Multiple partial invoices and split lots keep per-unit plans distinct and balances exact',async()=>{
  await admin('update inventory_lots set loose_units=1 where id=$1',[MACHINE_LOT]);
  await admin('insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units) values($1,$2,$3,$4,$5,3)',[fresh(),MACHINE,HUB,MACHINE_PACK,'SPLIT-LOT']);
  const pf=await order(),first=await invoice(pf,[2]),second=await invoice(pf,[2]);const a=await cases(first.note),b=await cases(second.note);
  assert.equal(a.length,2);assert.equal(b.length,2);assert.equal(new Set([...a,...b].map(c=>c.id)).size,4);assert.equal(new Set(a.map(c=>c.planned_delivery_line_id)).size,2);
  await as(ACCOUNTS);assert.equal((await one('select order_invoice_quantities($1) review',[pf.id])).review.lines[0].remaining_quantity,0);assert.equal((await one("select count(*)::int n from pending_stock_requests where proforma_id=$1 and status='waiting'",[pf.id])).n,0);
 });
 await scenario('No eligible engineering default remains visible as unowned; helper and direct writes are closed',async()=>{
  await admin("update staff set access='{}' where user_id=$1",[ENGINEER]);const p=await invoice(await order([machine(1)]),[1]),c=(await cases(p.note))[0];await as(OWNER);
  assert.equal((await one("select count(*)::int n from unowned_work() where record_type='service' and record_id=$1",[c.id])).n,1);assert.equal((await one("select count(*)::int n from work_assignments where record_id=$1 and status='open'",[c.id])).n,0);
  await as(OUTSIDER);await reject(()=>db.query('select lock_service_delivery($1,false)',[c.id]),/permission denied/);await reject(()=>db.query('select create_installation_cases_for_delivery()'),/permission denied/);await reject(()=>db.query("update service_cases set delivery_ready=true where id=$1",[c.id]),/permission denied|row-level security/);
  await as(ENGINEER);assert.equal((await one('select count(*)::int n from acc_invoices')).n,0);
 });
 console.log(`PASS: ${checks} invoice immediate-handoff/status scenarios; real migrations through 124, fictional fixtures, single-session disposable PGlite. Cross-session concurrency and live transport are not exercised.`);
}catch(error){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;}finally{await db.close();}
