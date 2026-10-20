// Full fictional order paths exercise the actual delivery trigger and service identity rules.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180109_order_task_readiness.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202610200113_task_progress_history.sql','202610200114_travel_visit_planning.sql','202610200115_independent_service_intake.sql','202610200116_customer_contracts.sql','202610200117_proforma_commercial_terms.sql','202610200118_delivery_installation_choice.sql','202610200119_product_pricing_control.sql']});
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,ENGINEER,ORG,CONTACT,MACHINE,REAGENT,as,admin,one,dates}=f;
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
 if(serials.length){const line=await one('select id from sales_delivery_lines where delivery_note_id=$1 and product_id=$2',[noteId,MACHINE]);await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[noteId,note.version,JSON.stringify([{deliveryLineId:line.id,serials}])]);note=await one('select * from sales_delivery_notes where id=$1',[noteId]);}
 note=await one('select * from packing_mark_packed($1,$2)',[noteId,note.version]);
 if(n===300){
  const before=(await admin('select sum(loose_units)::int n from inventory_lots')).rows[0].n;await admin('delete from delivery_line_serials where delivery_note_id=$1',[noteId]);await as(DRIVER);
  await assert.rejects(advance('dispatch'),/real serial number/);assert.equal((await admin('select sum(loose_units)::int n from inventory_lots')).rows[0].n,before);
  await as(PACKER);const line=await one('select id from sales_delivery_lines where delivery_note_id=$1 and product_id=$2',[noteId,MACHINE]);
  await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[noteId,note.version,JSON.stringify([{deliveryLineId:line.id,serials}])]);note=await one('select * from sales_delivery_notes where id=$1',[noteId]);
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
 await db.exec('reset role');await f.load('202610200120_machine_serial_requirement.sql');await db.exec('set role authenticated');
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
 await check('Authenticated callers cannot invoke the delivery trigger function directly',async()=>{await assert.rejects(db.query('select create_installation_cases_for_delivery()'),/permission denied/);});
 console.log(`PASS: ${checks} all-release delivery installation choice checks (107–120 together); explicit owner-configured prices, partial invoices, actual acceptance, invoice, reservation, packing, dispatch, proof, delivery, asset and work-assignment functions, with mandatory machine serial checks on both packing RPCs and direct status writes. Single-session disposable PGlite only.`);
}finally{await db.close();}
