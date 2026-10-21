// Full fictional order paths exercise the actual delivery trigger and service identity rules.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180109_order_task_readiness.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202610200113_task_progress_history.sql','202610200114_travel_visit_planning.sql','202610200115_independent_service_intake.sql','202610200116_customer_contracts.sql','202610200117_proforma_commercial_terms.sql','202610200118_delivery_installation_choice.sql','202610200119_product_pricing_control.sql']});
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,ENGINEER,ORG,CONTACT,MACHINE,REAGENT,HUB,MACHINE_PACK,MACHINE_LOT,as,admin,one,dates}=f;
let checks=0;
const check=async(label,fn)=>{await fn();checks++;console.log('PASS: '+label);};
async function deliver(n,{required=true,serials=['DELIVERY-'+n],charges='',reagents=0,orderQuantity=null,proforma=null}={}){
 const pfId=proforma?.id||id(n),proofId=id(n+2),quantity=serials.length||1;let noteId;
 const lines=[{productId:MACHINE,description:'Fictional Analyzer',quantity:orderQuantity||quantity,uom:'unit',unitPriceMinor:100000,discountBasisPoints:0,taxBasisPoints:1800}];if(reagents)lines.push({productId:REAGENT,description:'Fictional Reagent',quantity:reagents,uom:'kit',unitPriceMinor:2000,discountBasisPoints:0,taxBasisPoints:1800});
 await as(SALES);
 let pf=proforma;
 if(!pf){pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)',[pfId,ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Fictional order',JSON.stringify(lines),'sale',null,required,charges,'PRIVATE COMMERCIAL NEGOTIATION']);
 pf=await one("select * from advance_sales_proforma($1,$2,'send','Sent fictional quote')",[pfId,pf.version]);
 pf=await one("select * from advance_sales_proforma($1,$2,'accept','Fictional customer accepted')",[pfId,pf.version]);}
 await as(ACCOUNTS);
 const pfLines=(await db.query('select * from sales_proforma_lines where proforma_id=$1 order by sort_order',[pfId])).rows;
 const invoice=await one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[id(n+1),pfId,pf.version,dates.today,dates.valid,JSON.stringify(pfLines.map(line=>({proforma_line_id:line.id,quantity:line.product_id===MACHINE?quantity:reagents})).filter(line=>line.quantity)),'Fixture approval',dates.delivery,'']);
 await db.query('select record_invoice_fiscal($1,$2,$3,$4,$5)',[invoice.id,'FIX-TRA-'+n,'FIX-VERIFY-'+n,'100-200-300','10-123456-X']);
 let note=await one("select * from sales_delivery_notes where invoice_id=$1 and status<>'cancelled'",[invoice.id]);noteId=note.id;
 const advance=async action=>{note=await one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[noteId,note.version,action,'Fixture truck','FIX-ROUTE','Fixture recipient','FIX-SIGNED-PROOF']);};
 await advance('send_to_sales');await as(PACKER);note=await one('select * from packing_take_next()');assert.equal(note.id,noteId);
 if(n===300){
  await assert.rejects(db.query('select packing_mark_packed($1,$2)',[noteId,note.version]),/real serial number/);
  await assert.rejects(advance('ready'),/real serial number/);
  await assert.rejects(admin("update sales_delivery_notes set status='ready' where id=$1",[noteId]),/real serial number/);
  await assert.rejects(admin("update sales_delivery_notes set status='out_for_delivery',dispatched_at=now(),dispatched_by=$2 where id=$1",[noteId,DRIVER]),/real serial number/);
  assert.equal((await one('select status from sales_delivery_notes where id=$1',[noteId])).status,'packing');
 }
 if(serials.length){
  const line=await one('select id from sales_delivery_lines where delivery_note_id=$1 and product_id=$2',[noteId,MACHINE]),beforeVersion=note.version;
  const serialArgs=[noteId,beforeVersion,JSON.stringify([{deliveryLineId:line.id,serials,legacyConfirmed:true}])];
  await db.query('select record_delivery_serials($1,$2,$3::jsonb)',serialArgs);note=await one('select * from sales_delivery_notes where id=$1',[noteId]);
  if(n===410){
   assert.equal(note.version,beforeVersion+1,'Recording serials advances the delivery version');
   const saved=(await db.query('select id,serial_number,inventory_serial_id from delivery_line_serials where delivery_note_id=$1 order by id',[noteId])).rows;
   await assert.rejects(db.query('select record_delivery_serials($1,$2,$3::jsonb)',serialArgs),/Delivery changed/i);
   assert.deepEqual((await db.query('select id,serial_number,inventory_serial_id from delivery_line_serials where delivery_note_id=$1 order by id',[noteId])).rows,saved);
   assert.equal((await one('select version from sales_delivery_notes where id=$1',[noteId])).version,note.version);
  }
 }
 note=await one('select * from packing_mark_packed($1,$2)',[noteId,note.version]);
 if(n===300){
  const before=(await admin('select sum(loose_units)::int n from inventory_lots')).rows[0].n;await admin('delete from delivery_line_serials where delivery_note_id=$1',[noteId]);await as(DRIVER);
  await assert.rejects(advance('dispatch'),/real serial number/);assert.equal((await admin('select sum(loose_units)::int n from inventory_lots')).rows[0].n,before);
  await as(PACKER);const line=await one('select id from sales_delivery_lines where delivery_note_id=$1 and product_id=$2',[noteId,MACHINE]);
  await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[noteId,note.version,JSON.stringify([{deliveryLineId:line.id,serials,legacyConfirmed:true}])]);note=await one('select * from sales_delivery_notes where id=$1',[noteId]);
 }
 await as(DRIVER);await advance('dispatch');
 const path=`delivery/${noteId}/${proofId}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[path,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select * from finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proofId,'delivery',noteId,path,'Fictional delivery.pdf','application/pdf',321]);await advance('deliver');
 return {pf,note,invoice,assets:(await admin('select a.* from equipment_assets a join sales_delivery_lines l on l.id=a.source_delivery_line_id where l.delivery_note_id=$1',[noteId])).rows,cases:(await admin('select * from service_cases where source_delivery_note_id=$1',[noteId])).rows};
}
try{
 await check('All release migrations retain configured pricing; owner seeds explicit fixture prices and sales cannot substitute a price',async()=>{
  await as(OWNER);
  for(const [request,product,price] of [[id(280),MACHINE,100000],[id(281),REAGENT,2000]]){
   const configured=await one('select * from set_product_sale_price($1,$2,$3,$4,$5,$6)',[request,product,'TZS',0,price,'Explicit fictional integration-test price']);assert.equal(Number(configured.unit_price_minor),price);
  }
  await as(SALES);await assert.rejects(db.query('select save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[id(299),ORG,CONTACT,'TZS',dates.valid,'Seven days','On delivery','Rejected fixture quote',JSON.stringify([{productId:MACHINE,description:'Fictional Analyzer',quantity:1,uom:'unit',unitPriceMinor:99999,discountBasisPoints:0,taxBasisPoints:1800}])]),/configured.*product price/);
 });
 await as(OWNER);await db.query('select set_product_serial_required($1,false)',[MACHINE]);
 const historical=await deliver(340,{serials:[]});
 await db.exec('reset role');await f.load('202610200120_machine_serial_requirement.sql');await f.load('202610200121_receiving_machine_serials.sql');await db.exec('set role authenticated');
 await check('Historical delivered units remain unknown while new machine serial requirements cannot be switched off',async()=>{
  await as(OWNER);await assert.rejects(db.query('select set_product_serial_required($1,false)',[MACHINE]),/mandatory/);
  const a=await one('select * from equipment_assets where id=$1',[historical.assets[0].id]);assert.equal(a.serial_number,null);assert.equal(a.serial_unknown,true);assert.equal(historical.note.status,'delivered');
  assert.equal((await one('select serial_required from product_serial_settings where product_id=$1',[MACHINE])).serial_required,false);
 });
 let deferred,mixed;
 await check('No-installation order delivers stock and retains each known machine asset without installation jobs',async()=>{
  deferred=await deliver(300,{required:false,serials:['DEFER-002','DEFER-001']});assert.equal(deferred.note.status,'delivered');assert.equal(deferred.assets.length,2);assert.equal(deferred.cases.length,0);
  assert.deepEqual(deferred.assets.map(a=>a.serial_number).sort(),['DEFER-001','DEFER-002']);assert.ok(deferred.assets.every(a=>!a.serial_unknown&&a.installed_on===null));
 });
 await check('Default installation creates a job with real serial, site and charge information; private notes stay private',async()=>{
  const result=mixed=await deliver(310,{charges:'Installation labour is separately quoted',reagents:2});assert.equal(result.cases.length,1);assert.equal(result.assets.length,1);
  const c=result.cases[0];assert.equal(result.assets[0].serial_number,'DELIVERY-310');assert.equal(result.assets[0].serial_unknown,false);assert.equal(c.site_organization_id,ORG);assert.equal(c.site_location,'Fixture Dar laboratory');assert.equal(c.intake_source,'erp_delivery');assert.match(c.problem_summary,/separately quoted/);assert.doesNotMatch(JSON.stringify(c),/PRIVATE COMMERCIAL/);
  await admin('update sales_delivery_notes set status=status where id=$1',[result.note.id]);assert.equal((await admin('select count(*)::int n from service_cases where source_delivery_note_id=$1',[result.note.id])).rows[0].n,1);
  await as(ENGINEER);assert.equal((await one("select assignee_user_id from work_assignments where record_id=$1 and status='open'",[c.id])).assignee_user_id,ENGINEER);
 });
 await check('An independent installation reuses its real machine identity when a later ERP delivery arrives',async()=>{
  await as(ENGINEER);const existing=await one("select * from create_service_intake($1,'installation',null,null,$2,null,$3,$4,'External model','REUSED-320',false,'Existing site','','Install existing machine','legacy')",[id(329),ORG,CONTACT,MACHINE]);
  const before=(await admin('select count(*)::int n from equipment_assets')).rows[0].n;const result=await deliver(320,{serials:['REUSED-320']});
  assert.equal((await admin('select count(*)::int n from equipment_assets')).rows[0].n,before);assert.equal(result.cases.length,0);
  const same=(await admin("select id from equipment_assets where product_id=$1 and serial_number='REUSED-320'",[MACHINE])).rows[0];assert.equal(same.id,existing.asset_id);
  assert.equal((await admin("select count(*)::int n from service_cases where asset_id=$1 and case_type='installation' and status not in ('completed','cancelled')",[same.id])).rows[0].n,1);
 });
 await check('A deferred installation is opened later against the original asset without a new sale',async()=>{
  await as(ENGINEER);const a=deferred.assets[0];const c=await one("select * from create_service_intake($1,'installation',$2,$3,$4,null,$5,$6,'',$7,false,'Destination hospital','','Install distributor equipment later','distributor')",[id(330),a.id,a.updated_at,ORG,CONTACT,MACHINE,a.serial_number]);assert.equal(c.asset_id,a.id);assert.equal(c.source_delivery_note_id,null);assert.equal(c.organization_id,ORG);
 });
 await check('Mixed machine and reagent return/restock permits redelivery of the real serial without a duplicate asset or open job',async()=>{
  await as(OWNER);await db.query('select set_product_serial_required($1,true)',[MACHINE]);
  const lines=(await db.query('select * from sales_delivery_lines where delivery_note_id=$1 order by product_id',[mixed.note.id])).rows;assert.equal(lines.length,2);
  let returned=await one('select * from record_sales_return($1,$2,$3,$4,$5,$6::jsonb)',[id(350),mixed.note.id,'unopened','Fixture unused equipment and reagent','',JSON.stringify(lines.map(line=>({deliveryLineId:line.id,quantity:1})))]);
  const returnedLines=(await db.query('select * from sales_return_lines where return_id=$1',[returned.id])).rows;
  for(const line of returnedLines){await db.query('select * from resolve_sales_return_line($1,$2,$3,$4,$5)',[line.id,returned.version,'restock','Count and seal verified',true]);returned=await one('select * from sales_returns where id=$1',[returned.id]);}
  const machineReturn=returnedLines.find(line=>line.product_id===MACHINE);await db.query('select mark_serials_returned($1,$2::text[])',[machineReturn.id,['DELIVERY-310']]);
  const before=(await admin('select count(*)::int n from equipment_assets')).rows[0].n;const again=await deliver(360,{serials:['DELIVERY-310']});
  assert.equal(again.note.status,'delivered');assert.equal((await admin('select count(*)::int n from equipment_assets')).rows[0].n,before);assert.equal(again.cases.length,0);
  const a=(await admin("select * from equipment_assets where product_id=$1 and serial_number='DELIVERY-310'",[MACHINE])).rows[0];assert.equal(a.id,mixed.assets[0].id);assert.equal(a.source_delivery_line_id,mixed.assets[0].source_delivery_line_id);assert.equal(a.organization_id,ORG);
  assert.equal((await admin("select count(*)::int n from service_cases where asset_id=$1 and case_type='installation' and status not in ('completed','cancelled')",[a.id])).rows[0].n,1);
 });
 await check('Ordinary priced sale can be invoiced and delivered in two parts with distinct serials and exact total quantities',async()=>{
  const first=await deliver(380,{orderQuantity:2,serials:['PARTIAL-380-A'],required:false});
  await as(ACCOUNTS);let balance=await one('select order_invoice_quantities($1) as balance',[first.pf.id]);assert.equal(Number(balance.balance.lines[0].remaining_quantity),1);
  const second=await deliver(390,{proforma:first.pf,serials:['PARTIAL-380-B'],required:false});assert.equal(second.pf.id,first.pf.id);assert.notEqual(second.invoice.id,first.invoice.id);
  await as(ACCOUNTS);balance=await one('select order_invoice_quantities($1) as balance',[first.pf.id]);assert.equal(Number(balance.balance.lines[0].remaining_quantity),0);
  assert.equal(Number(first.invoice.total_minor)+Number(second.invoice.total_minor),Number(first.pf.total_minor));
  const delivered=await one("select sum(l.quantity)::int n from sales_delivery_lines l join sales_delivery_notes n on n.id=l.delivery_note_id where n.proforma_id=$1 and n.status='delivered'",[first.pf.id]);assert.equal(delivered.n,2);
  assert.deepEqual([...first.assets,...second.assets].map(a=>a.serial_number).sort(),['PARTIAL-380-A','PARTIAL-380-B']);assert.equal(first.cases.length+second.cases.length,0);
 });
 await check('Centrally priced partial sale completes both signed installations and schedules maintenance without duplicate effects',async()=>{
  const serials=['PARTIAL-INSTALL-410-A','PARTIAL-INSTALL-410-B'];
  await as(OWNER);
  const before=(await admin('select * from inventory_lots where id=$1',[MACHINE_LOT])).rows[0];
  const allowance=(await admin('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).rows[0].captured_units;
  const received=await one('select * from receive_serialized_inventory($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10::text[])',[MACHINE_LOT,before.version,MACHINE,HUB,MACHINE_PACK,before.batch_number,before.sealed_cartons,before.loose_units+2,'Fictional receipt for complete partial-order installation',serials]);
  assert.equal(received.loose_units,before.loose_units+2);
  const first=await deliver(410,{orderQuantity:2,serials:[serials[0]],required:true});
  await as(ACCOUNTS);
  assert.equal((await one('select order_invoice_quantities($1) balance',[first.pf.id])).balance.lines[0].remaining_quantity,1);
  const review=await one("select * from work_assignments where record_type='proforma' and record_id=$1 and status='open'",[first.pf.id]);
  assert.equal(review.assignee_user_id,ACCOUNTS);
  const second=await deliver(420,{proforma:first.pf,serials:[serials[1]],required:true}),parts=[first,second];
  assert.equal(first.pf.installation_required,true);assert.equal(first.pf.commercial_kind,'sale');
  assert.equal(Number(first.invoice.lines[0].unit_price_minor),100000);assert.equal(Number(second.invoice.lines[0].unit_price_minor),100000);
  assert.equal(Number(first.invoice.total_minor)+Number(second.invoice.total_minor),Number(first.pf.total_minor));
  await as(ACCOUNTS);
  assert.equal((await one('select order_invoice_quantities($1) balance',[first.pf.id])).balance.lines[0].remaining_quantity,0);
  assert.equal((await one('select status from work_assignments where id=$1',[review.id])).status,'done');
  const caseIds=[],assetIds=[],maintenanceIds=[],reportAttempts=[];
  for(const [index,part] of parts.entries()){
   assert.equal(part.note.status,'delivered');assert.equal(part.note.recipient_name,'Fixture recipient');assert.equal(part.note.proof_reference,'FIX-SIGNED-PROOF');
   assert.equal(part.assets.length,1);assert.equal(part.cases.length,1);
   const asset=part.assets[0];let record=part.cases[0];caseIds.push(record.id);assetIds.push(asset.id);
   assert.equal(asset.serial_number,serials[index]);assert.equal(record.asset_id,asset.id);assert.equal(record.source_delivery_note_id,part.note.id);
   await as(ENGINEER);
   assert.equal((await one("select assignee_user_id from work_assignments where record_type='service' and record_id=$1 and status='open'",[record.id])).assignee_user_id,ENGINEER);
   for(const action of ['assign','schedule','start','submit_report'])record=await one('select * from advance_service_case($1,$2,$3,$4,$5,$6)',[record.id,record.version,action,action==='assign'?ENGINEER:null,action==='schedule'?dates.today:null,'Fictional partial-order '+action]);
   const reportArgs=[record.id,record.version,dates.today,'Fictional Analyzer Model',asset.serial_number,'Fixture Dar laboratory','','Installation and training','Installed, tested and trained the fictional clinic','',ENGINEER,'Fixture Engineer',
    dates.today,'Fixture Customer',dates.today,'FIX-PARTIAL-CUSTOMER-'+index,'Fixture Engineer',dates.today,'FIX-PARTIAL-ANUDHA-'+index,true,'completed',false,null,null,null,'TZS',0,'',6,
    JSON.stringify([{description:'Fixture power cable',serial_number:'FIX-PARTIAL-ACCESSORY-'+index}]),JSON.stringify([{full_name:'Fixture Trainee',telephone:'000000000',designation:'Lab technician'}])];
   const reportSql=`select * from complete_service_report(${reportArgs.map((_,i)=>'$'+(i+1)).join(',')})`;
   record=await one(reportSql,reportArgs);reportAttempts.push({sql:reportSql,args:reportArgs});assert.equal(record.status,'completed');
   const report=await one('select * from service_reports where case_id=$1',[record.id]);
   assert.equal(report.serial_number,asset.serial_number);assert.equal(report.customer_signoff_reference,'FIX-PARTIAL-CUSTOMER-'+index);assert.equal(report.anudha_signoff_reference,'FIX-PARTIAL-ANUDHA-'+index);assert.equal(report.training_completed,true);
   const maintenance=(await db.query('select * from service_cases where source_case_id=$1',[record.id])).rows;assert.equal(maintenance.length,1);
   const next=maintenance[0];maintenanceIds.push(next.id);assert.equal(next.asset_id,asset.id);assert.equal(next.case_type,'service');assert.equal(next.status,'scheduled');assert.equal(next.assigned_user_id,ENGINEER);
   assert.equal((await one('select scheduled_for=service_add_months($2::date,6) correct from service_cases where id=$1',[next.id,dates.today])).correct,true);
   assert.equal((await one('select status from equipment_assets where id=$1',[asset.id])).status,'active');
   assert.equal((await one('select installed_on=$2::date and next_maintenance_date=service_add_months($2::date,6) correct from equipment_assets where id=$1',[asset.id,dates.today])).correct,true);
  }
  assert.equal(new Set(assetIds).size,2);assert.equal(new Set(maintenanceIds).size,2);
  const recordIds=[first.pf.id,...parts.map(part=>part.note.id),...caseIds,...maintenanceIds];
  const snapshot=async()=>({
   counts:(await admin('select (select count(*)::int from acc_invoices where proforma_id=$1) invoices,(select count(*)::int from acc_journal_entries where source_id=any($2::uuid[])) journals,(select count(*)::int from sales_delivery_notes where proforma_id=$1) deliveries,(select count(*)::int from equipment_assets where product_id=$3 and serial_number=any($4::text[])) assets,(select count(*)::int from service_cases where asset_id=any($5::uuid[])) cases,(select count(*)::int from service_reports where case_id=any($6::uuid[])) reports',[first.pf.id,parts.map(part=>part.invoice.id),MACHINE,serials,assetIds,caseIds])).rows[0],
   stock:(await admin('select id,loose_units,sealed_cartons,reserved_units,version from inventory_lots order by id')).rows,
   work:(await admin('select id,record_id,status,version,assignee_user_id from work_assignments where record_id=any($1::uuid[]) order by id',[recordIds])).rows
  });
  const completed=await snapshot();assert.deepEqual(completed.counts,{invoices:2,journals:2,deliveries:2,assets:2,cases:4,reports:2});
  const finalLot=completed.stock.find(lot=>lot.id===MACHINE_LOT);assert.equal(finalLot.loose_units,received.loose_units-2);assert.equal(finalLot.reserved_units,0);
  const open=completed.work.filter(work=>work.status==='open');assert.equal(open.length,2);assert.deepEqual(open.map(work=>work.record_id).sort(),[...maintenanceIds].sort());assert.ok(open.every(work=>work.assignee_user_id===ENGINEER));
  assert.equal((await admin('select count(*)::int n from inventory_serial_receipts where product_id=$1 and serial_number=any($2::text[]) and source=$3',[MACHINE,serials,'receiving'])).rows[0].n,2);
  assert.equal((await admin('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).rows[0].captured_units,allowance);
  assert.equal((await admin('select count(*)::int n from (select entry_id from acc_journal_lines where entry_id=any($1::uuid[]) group by entry_id having sum(debit_minor)<>sum(credit_minor)) unbalanced',[parts.map(part=>part.invoice.journal_entry_id)])).rows[0].n,0);
  for(const part of parts){
   await as(ACCOUNTS);
   const retry=await one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[part.invoice.id,first.pf.id,first.pf.version,dates.today,dates.valid,JSON.stringify([{proforma_line_id:part.invoice.lines[0].proforma_line_id,quantity:1}]),'Fixture approval',dates.delivery,'']);assert.equal(retry.id,part.invoice.id);
   await as(DRIVER);await assert.rejects(db.query("select advance_sales_delivery($1,$2,'deliver','Fixture truck','FIX-ROUTE','Fixture recipient','FIX-SIGNED-PROOF')",[part.note.id,part.note.version-1]),/changed/i);
   await admin('update sales_delivery_notes set status=status where id=$1',[part.note.id]);
  }
  await as(ENGINEER);for(const attempt of reportAttempts)await assert.rejects(db.query(attempt.sql,attempt.args),/changed|not ready/i);
  assert.deepEqual(await snapshot(),completed,'Invoice retries, repeated delivery status and stale signed reports cannot duplicate any chain effects');
 });
 await check('Authenticated callers cannot invoke the delivery trigger function directly',async()=>{await assert.rejects(db.query('select create_installation_cases_for_delivery()'),/permission denied/);});
 console.log(`PASS: ${checks} all-release delivery installation choice checks (107–121 together); explicit owner-configured prices, received serials, partial invoices, actual acceptance, invoice, reservation, packing, dispatch, proof, delivery, completed signed installations and scheduled maintenance, with exact stock, asset, journal and handoff totals and retry checks. Single-session disposable PGlite only.`);
}finally{await db.close();}
