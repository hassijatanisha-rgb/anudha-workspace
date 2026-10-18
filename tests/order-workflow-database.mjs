// End-to-end order rehearsal in disposable PGlite. All identities, money, stock and proof are fictional.
// Auth token claims and storage metadata are fixture boundaries; business functions come from real migrations.
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,ENGINEER,OUTSIDER,ORG,CONTACT,MACHINE,REAGENT,PF,NOTE,installed,as,admin,one,dates}=await createOrderFixture();
const evidence=[];
const resultPath=new URL('../../order-workflow-result.json',import.meta.url);
const snapshots=[],snapshotPath=new URL('../../order-demo-snapshots.json',import.meta.url);
const snapshotTables=['staff','organizations','contacts','products','product_inventory_classifications','inventory_lots',
 'sales_proformas','sales_proforma_lines','sales_proforma_events','sales_proforma_revisions','sales_delivery_notes','sales_delivery_lines','sales_delivery_events',
 'acc_invoices','service_cases','equipment_assets','service_reports','work_assignments'];
const capture=async(key,title)=>{
 const actor=(await one('select auth.uid() as user_id')).user_id,tables={};
 await db.exec('reset role');
 try{for(const table of snapshotTables)tables[table]=(await db.query(`select * from public.${table}`)).rows;}
 finally{await db.exec('set role authenticated');}
 snapshots.push({key,title,actorUserId:actor,capturedAt:new Date().toISOString(),tables});
};
const check=async(name,fn)=>{await fn();evidence.push(name);};
const note=()=>one('select * from sales_delivery_notes where id=$1',[NOTE]);
const advanceDelivery=async action=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[NOTE,(await note()).version,action,'Fixture truck','FIXTURE-ROUTE','Fixture recipient','FIXTURE-SIGNED-PROOF']);
const lots=async()=>(await admin('select product_id,loose_units,reserved_units from inventory_lots order by product_id')).rows;
const openWork=async(type,recordId)=>one("select * from work_assignments where record_type=$1 and record_id=$2 and status='open'",[type,recordId]);
let report;
try{
 const lineData=[{productId:MACHINE,description:'Fictional Analyzer',quantity:2,uom:'unit',unitPriceMinor:100000,discountBasisPoints:0,taxBasisPoints:1800},
  {productId:REAGENT,description:'Fictional Reagent',quantity:3,uom:'kit',unitPriceMinor:2000,discountBasisPoints:0,taxBasisPoints:1800}];
 await as(SALES);
 let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[PF,ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Fictional rehearsal only',JSON.stringify(lineData)]);
 await check('Sales creates the real Pro forma with two machine units and three reagent kits',async()=>{assert.equal(pf.status,'draft');assert.equal(Number(pf.subtotal_minor),206000);assert.equal(Number(pf.tax_minor),37080);assert.equal(Number(pf.total_minor),243080);});
 let work=await openWork('proforma',PF);
 await check('Automatic task ownership and explicit self-assignment retain the versioned handoff chain',async()=>{
  assert.equal(work.assignee_user_id,SALES);
  const assigned=await one('select * from hand_off_work($1,$2,$3,$4,$5,$6,null,$7,$8)',[id(40),'proforma',PF,pf.document_number,'Prepare this order',SALES,'I will handle this customer',work.id]);
  assert.equal(assigned.assignee_user_id,SALES);assert.equal(assigned.previous_assignment_id,work.id);
 });
 await capture('draft','Prepare the Pro forma and assign its task to yourself');
 pf=await one("select * from advance_sales_proforma($1,$2,'send','Sent fictional quote')",[PF,pf.version]);
 pf=await one("select * from advance_sales_proforma($1,$2,'accept','Fictional customer accepted')",[PF,pf.version]);
 let invoice;
 await check('Acceptance automatically posts one ERP invoice and balanced receivables/sales/VAT journal',async()=>{
  const invoices=(await admin('select * from acc_invoices where proforma_id=$1',[PF])).rows;assert.equal(invoices.length,1);invoice=invoices[0];
  assert.equal(Number(invoice.total_minor),243080);assert.equal(invoice.created_by,SALES);assert.equal(invoice.proforma_revision,pf.revision);
  const journal=(await admin('select sum(debit_minor)::bigint debit,sum(credit_minor)::bigint credit,count(*)::int lines from acc_journal_lines where entry_id=$1',[invoice.journal_entry_id])).rows[0];
  assert.equal(Number(journal.debit),243080);assert.equal(Number(journal.credit),243080);assert.equal(journal.lines,3);
  const split=(await admin('select account_id,debit_minor,credit_minor from acc_journal_lines where entry_id=$1 order by line_no',[invoice.journal_entry_id])).rows;
  assert.deepEqual(split.map(line=>[line.account_id.slice(-4),Number(line.debit_minor),Number(line.credit_minor)]),[['1300',243080,0],['4000',0,206000],['2200',0,37080]]);
  assert.equal((await openWork('proforma',PF)).assignee_user_id,ACCOUNTS);
 });
 await capture('accepted_invoice','Customer accepted: the ERP invoice and accounting entry exist');
 await check('Sales cannot directly post or read the invoice ledger',async()=>{assert.equal((await db.query('select * from acc_invoices')).rows.length,0);await assert.rejects(db.query('select acc_create_invoice($1,$2,$3,$3,$4)',[id(41),PF,dates.today,'']),/permission denied/);});
 await as(ACCOUNTS);
 await db.query('select record_invoice_fiscal($1,$2,$3,$4,$5)',[invoice.id,'FIXTURE-TRA-RECEIPT','FIXTURE-VERIFY','100-200-300','10-123456-X']);
 let delivery=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[NOTE,PF,pf.version,'Fixture accounts approved',dates.delivery,'[]']);
 await check('Accounts creates a linked delivery and no machine service case is created early',async()=>{assert.equal(delivery.status,'accounts_approved');assert.equal(delivery.proforma_id,PF);assert.equal((await admin('select count(*)::int n from service_cases')).rows[0].n,0);});
 await capture('accounts_approved','Accounts approval creates the linked delivery');
 await check('An unrelated invoice number is rejected before stock is reserved',async()=>{
  await assert.rejects(db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[NOTE,delivery.version,'UNRELATED-999']),/invoice/i);
  assert.deepEqual((await lots()).map(r=>r.reserved_units),[0,0]);assert.equal((await note()).version,delivery.version);
 });
 delivery=await one('select * from create_tax_invoice_and_reserve_stock($1,$2,$3)',[NOTE,delivery.version,'']);
 await check('The server selects the active ERP invoice and reserves exactly the accepted quantities once',async()=>{
  assert.equal(delivery.tax_invoice_reference,invoice.invoice_number);assert.equal(delivery.status,'tax_invoice_created');
  assert.deepEqual((await lots()).map(r=>[r.loose_units,r.reserved_units]),[[10,2],[20,3]]);
  await assert.rejects(db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[NOTE,delivery.version-1,'']),/changed|refresh/i);
  assert.equal((await db.query('select count(*)::int n from sales_delivery_lines where delivery_note_id=$1',[NOTE])).rows[0].n,2);
 });
 await capture('reserved','The ERP invoice reserves the accepted quantities at Haadi');
 delivery=await advanceDelivery('send_to_sales');await as(PACKER);
 delivery=await one('select * from packing_take_next()');
 await check('Packing queue claims the reserved order for its packer without reserving twice',async()=>{
  assert.equal(delivery.id,NOTE);assert.equal(delivery.status,'packing');assert.equal(delivery.packer_user_id,PACKER);
  assert.equal((await openWork('delivery',NOTE)).assignee_user_id,PACKER);assert.deepEqual((await lots()).map(r=>r.reserved_units),[2,3]);
 });
 await capture('packing','The packer takes the next order and owns its packing task');
 const machineLine=(await one('select id from sales_delivery_lines where delivery_note_id=$1 and product_id=$2',[NOTE,MACHINE])).id;
 await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[NOTE,(await note()).version,JSON.stringify([{deliveryLineId:machineLine,serials:['FIX-MACHINE-001','FIX-MACHINE-002']}])]);
 await as(DRIVER);await check('Another delivery employee cannot mark someone else’s packing complete',()=>assert.rejects(advanceDelivery('ready'),/who took|mark it packed/i));
 await as(PACKER);delivery=await one('select * from packing_mark_packed($1,$2)',[NOTE,(await note()).version]);
 await check('Packed order retains its packer for the explicit handoff to delivery',async()=>{assert.equal(delivery.status,'ready');const handoff=await openWork('delivery',NOTE);assert.equal(handoff.assignee_user_id,PACKER);assert.match(handoff.task,/Hand .* to delivery/);});
 await capture('ready','Packed and ready to hand to delivery');
 await as(DRIVER);delivery=await advanceDelivery('dispatch');
 await check('Dispatch consumes physical stock and clears reservations exactly once',async()=>{
  assert.equal(delivery.status,'out_for_delivery');assert.equal((await openWork('delivery',NOTE)).assignee_user_id,DRIVER);assert.deepEqual((await lots()).map(r=>[r.loose_units,r.reserved_units]),[[8,0],[17,0]]);
  const issues=(await admin('select count(*)::int n,sum(quantity)::int quantity from inventory_issues where delivery_note_id=$1',[NOTE])).rows[0];assert.deepEqual(issues,{n:2,quantity:5});
  await assert.rejects(advanceDelivery('dispatch'),/next allowed/);assert.deepEqual((await lots()).map(r=>r.loose_units),[8,17]);
 });
 await capture('dispatched','Out for delivery: stock is issued and the driver owns the task');
 await check('Delivery requires uploaded signed-proof metadata before completing',()=>assert.rejects(advanceDelivery('deliver'),/upload|signed.*delivery/i));
 const proof=id(50),proofPath=`delivery/${NOTE}/${proof}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[proofPath,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select * from finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',NOTE,proofPath,'Fictional signed delivery.pdf','application/pdf',321]);
 delivery=await advanceDelivery('deliver');
 await check('Signed delivery closes delivery work and creates one linked engineering case per machine unit',async()=>{
  assert.equal(delivery.status,'delivered');assert.equal(await openWork('delivery',NOTE),undefined);
  const cases=(await admin('select * from service_cases')).rows;assert.equal(cases.length,2);assert.ok(cases.every(c=>c.product_id===MACHINE&&c.source_delivery_note_id===NOTE&&c.organization_id===ORG&&c.contact_id===CONTACT&&c.status==='new'));
  assert.equal((await admin('select count(*)::int n from equipment_assets')).rows[0].n,2);
 });
 await capture('delivered','Signed delivery automatically creates two machine installation jobs');
 await as(ENGINEER);
 const cases=(await db.query("select * from service_cases where case_type='installation' order by case_number")).rows;
 for(const [index,initial] of cases.entries()){
  let record=initial;
  assert.equal((await openWork('service',record.id)).assignee_user_id,ENGINEER);
  for(const action of ['assign','schedule','start','submit_report']){
   record=await one('select * from advance_service_case($1,$2,$3,$4,$5,$6)',[record.id,record.version,action,action==='assign'?ENGINEER:null,action==='schedule'?dates.today:null,'Fixture '+action]);
   if(index===0&&action==='assign')await capture('assigned_engineering','The engineer assigns the installation to themself');
  }
  record=await one(`select * from complete_service_report(${Array.from({length:31},(_,i)=>'$'+(i+1)).join(',')})`,[
   record.id,record.version,dates.today,'Fictional Analyzer Model',`FIX-MACHINE-00${index+1}`,'Fixture Dar laboratory','','Installation and training','Installed and tested fixture machine','',ENGINEER,'Fixture Engineer',
   dates.today,'Fixture Customer',dates.today,'FIXTURE-CUSTOMER-SIGNATURE','Fixture Engineer',dates.today,'FIXTURE-ENGINEER-SIGNATURE',true,'completed',false,null,null,null,'TZS',0,'',6,
   JSON.stringify([{description:'Fixture power cable',serial_number:'FIX-ACCESSORY-'+index}]),JSON.stringify([{full_name:'Fixture Trainee',telephone:'000000000',designation:'Lab technician'}])
  ]);
  await check(`Machine unit ${index+1}: engineer self-assignment, scheduling, on-site work, signed report and automatic maintenance`,async()=>{
   assert.equal(record.status,'completed');assert.equal(await openWork('service',record.id),undefined);
   const maintenance=await one('select * from service_cases where source_case_id=$1',[record.id]);assert.equal(maintenance.case_type,'service');assert.equal(maintenance.status,'scheduled');assert.equal(maintenance.assigned_user_id,ENGINEER);
   assert.equal((await one('select scheduled_for=service_add_months($2::date,6) as correct_date from service_cases where id=$1',[maintenance.id,dates.today])).correct_date,true);
   assert.equal((await openWork('service',maintenance.id)).assignee_user_id,ENGINEER);
  });
 }
 await capture('completed_installation','Signed installation reports activate the machines and schedule maintenance');
 await check('Final counts remain consistent across invoices, stock, proofs, installations, reports and maintenance',async()=>{
  assert.equal((await admin('select count(*)::int n from acc_invoices')).rows[0].n,1);assert.equal((await one('select count(*)::int n from service_reports')).n,2);
  assert.equal((await one("select count(*)::int n from service_cases where case_type='service' and status='scheduled'")).n,2);
  assert.equal((await one("select count(*)::int n from equipment_assets where status='active' and serial_number like 'FIX-MACHINE-%'")).n,2);
  assert.deepEqual((await lots()).map(r=>[r.loose_units,r.reserved_units]),[[8,0],[17,0]]);
 });
 await as(OUTSIDER);
 await check('Unrelated staff cannot view service cases or take packing work',async()=>{assert.equal((await db.query('select * from service_cases')).rows.length,0);await assert.rejects(db.query('select packing_take_next()'),/access/);});

 // The same authorized person can do each operational step and explicitly take each default handoff.
 // Existing department defaults stay in place; this exercises the real self-assignment RPC at every stage.
 const SELF_PF=id(1000),SELF_NOTE=id(1001),SELF_PROOF=id(1002),selfSteps=[];
 let selfRequest=1100;
 await as(OWNER);
 const selfTake=async(type,recordId,label,step)=>{
  const current=await openWork(type,recordId);
  const taken=await one('select * from hand_off_work($1,$2,$3,$4,$5,$6,null,$7,$8)',[id(selfRequest++),type,recordId,label,current?.task||'Handle the next order step',OWNER,'I am handling this step',current?.id||null]);
  assert.equal(taken.assignee_user_id,OWNER);assert.equal(taken.assigned_by,OWNER);selfSteps.push(step);
 };
 const selfNote=()=>one('select * from sales_delivery_notes where id=$1',[SELF_NOTE]);
 const selfAdvance=async action=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[SELF_NOTE,(await selfNote()).version,action,'Fixture owner vehicle','FIXTURE-SELF-ROUTE','Fixture self-order recipient','FIXTURE-SELF-SIGNED']);
 let selfPf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[SELF_PF,ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Fictional same-person rehearsal',JSON.stringify([{...lineData[0],quantity:1}])]);
 await selfTake('proforma',SELF_PF,selfPf.document_number,'Create Pro forma and assign to myself');
 selfPf=await one("select * from advance_sales_proforma($1,$2,'send','Sent fictional self-operated quote')",[SELF_PF,selfPf.version]);
 selfPf=await one("select * from advance_sales_proforma($1,$2,'accept','Fictional self-operated quote accepted')",[SELF_PF,selfPf.version]);
 await selfTake('proforma',SELF_PF,selfPf.document_number,'Take the Accounts task myself');
 const selfInvoice=await one('select * from acc_invoices where proforma_id=$1',[SELF_PF]);
 await db.query('select record_invoice_fiscal($1,$2,$3,$4,$5)',[selfInvoice.id,'FIXTURE-SELF-TRA','FIXTURE-SELF-VERIFY','100-200-300','10-123456-X']);
 let selfDelivery=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[SELF_NOTE,SELF_PF,selfPf.version,'Fixture owner accounts approval',dates.delivery,'[]']);
 await selfTake('delivery',SELF_NOTE,selfDelivery.delivery_number,'Approve Accounts and take delivery myself');
 selfDelivery=await one('select * from create_tax_invoice_and_reserve_stock($1,$2,$3)',[SELF_NOTE,selfDelivery.version,'']);
 await check('One authorized operator creates, self-assigns, accepts, invoices and reserves their own machine order',async()=>{
  assert.equal(selfPf.prepared_by,OWNER);assert.equal(selfInvoice.created_by,OWNER);assert.equal(Number(selfInvoice.total_minor),118000);
  assert.equal(selfDelivery.created_by,OWNER);assert.equal(selfDelivery.tax_invoice_reference,selfInvoice.invoice_number);
  assert.deepEqual((await lots()).map(r=>[r.loose_units,r.reserved_units]),[[8,1],[17,0]]);
 });
 selfDelivery=await selfAdvance('send_to_sales');
 selfDelivery=await one('select * from packing_take_next()');
 assert.equal(selfDelivery.id,SELF_NOTE);assert.equal(selfDelivery.packer_user_id,OWNER);assert.equal((await openWork('delivery',SELF_NOTE)).assignee_user_id,OWNER);
 selfSteps.push('Take packing myself');
 const selfLine=(await one('select id from sales_delivery_lines where delivery_note_id=$1',[SELF_NOTE])).id;
 await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[SELF_NOTE,(await selfNote()).version,JSON.stringify([{deliveryLineId:selfLine,serials:['FIX-MACHINE-SELF']}])]);
 selfDelivery=await one('select * from packing_mark_packed($1,$2)',[SELF_NOTE,(await selfNote()).version]);
 await selfTake('delivery',SELF_NOTE,selfDelivery.delivery_number,'Take shipping myself after packing');
 await check('The same operator personally claims packing, records the serial and marks the order ready',async()=>{
  assert.equal(selfDelivery.status,'ready');assert.equal(selfDelivery.packer_user_id,OWNER);assert.equal((await openWork('delivery',SELF_NOTE)).assignee_user_id,OWNER);
 });

 // The reserved order must keep its invoice active; a cancelled pre-dispatch order can be voided.
 const invoiceVoidProbe={invoiceCanBeVoidedAfterReservation:false,cancelThenVoidAllowed:false};
 await check('A reserved ready order blocks invoice voiding without changing its journal, stock or version',async()=>{
  const before=await selfNote(),journalCount=(await one('select count(*)::int n from acc_journal_entries')).n;
  await assert.rejects(db.query('select * from void_invoice($1,$2,$3)',[selfInvoice.id,dates.today,'Fixture audit: invoice voided after reservation']),error=>{
   invoiceVoidProbe.rejection=error.message;return /cancel|delivery/i.test(error.message);
  });
  assert.equal((await one('select voided_at from acc_invoices where id=$1',[selfInvoice.id])).voided_at,null);
  assert.equal((await one('select count(*)::int n from acc_journal_entries')).n,journalCount);
  assert.equal((await selfNote()).version,before.version);assert.equal((await selfNote()).status,'ready');
  assert.deepEqual((await lots()).map(r=>[r.loose_units,r.reserved_units]),[[8,1],[17,0]]);
 });
 await db.exec('begin');
 try{
  await check('Cancelling the pre-dispatch order releases its reservation and permits the invoice reversal',async()=>{
   const cancelled=await selfAdvance('cancel');assert.equal(cancelled.status,'cancelled');
   assert.deepEqual((await db.query('select loose_units,reserved_units from inventory_lots order by product_id')).rows.map(r=>[r.loose_units,r.reserved_units]),[[8,0],[17,0]]);
   const voided=await one('select * from void_invoice($1,$2,$3)',[selfInvoice.id,dates.today,'Fixture audit: order cancelled before dispatch']);
   assert.ok(voided.voided_at);assert.ok(voided.void_entry_id);invoiceVoidProbe.cancelThenVoidAllowed=true;
  });
 }finally{await db.exec('rollback');}
 assert.equal((await selfNote()).status,'ready');assert.equal((await one('select voided_at from acc_invoices where id=$1',[selfInvoice.id])).voided_at,null);
 selfDelivery=await selfAdvance('dispatch');
 await selfTake('delivery',SELF_NOTE,selfDelivery.delivery_number,'Take dispatched delivery myself');
 const selfProofPath=`delivery/${SELF_NOTE}/${SELF_PROOF}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[selfProofPath,OWNER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select * from finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[SELF_PROOF,'delivery',SELF_NOTE,selfProofPath,'Fictional self-operated proof.pdf','application/pdf',321]);
 selfDelivery=await selfAdvance('deliver');
 await check('The same operator dispatches, uploads proof and records signed delivery',async()=>{
  assert.equal(selfDelivery.dispatched_by,OWNER);assert.equal(selfDelivery.delivered_by,OWNER);assert.equal(selfDelivery.status,'delivered');
  assert.equal((await one('select uploaded_by from document_attachments where id=$1',[SELF_PROOF])).uploaded_by,OWNER);
  assert.deepEqual((await lots()).map(r=>[r.loose_units,r.reserved_units]),[[7,0],[17,0]]);
 });
 let selfCase=await one("select * from service_cases where source_delivery_note_id=$1 and case_type='installation'",[SELF_NOTE]);
 assert.ok(selfCase);selfCase=await one("select * from advance_service_case($1,$2,'assign',$3,null,'I will install this machine myself')",[selfCase.id,selfCase.version,OWNER]);
 selfSteps.push('Assign the resulting installation to myself');
 await check('The same operator explicitly assigns the single generated installation to themself',async()=>{
  assert.equal(selfCase.status,'assigned');assert.equal(selfCase.assigned_user_id,OWNER);assert.equal(selfCase.hod_user_id,OWNER);
  assert.equal((await openWork('service',selfCase.id)).assignee_user_id,OWNER);
  assert.equal((await one('select count(*)::int n from service_cases where source_delivery_note_id=$1',[SELF_NOTE])).n,1);
  assert.equal((await one('select count(*)::int n from service_reports')).n,2,'The first full report scenario is retained');
 });
 const samePerson={actorUserId:OWNER,proformaNumber:selfPf.document_number,invoiceNumber:selfInvoice.invoice_number,deliveryNumber:selfDelivery.delivery_number,
  totalMinor:Number(selfInvoice.total_minor),status:selfDelivery.status,installationCaseNumber:selfCase.case_number,installationStatus:selfCase.status,
  installationAssignee:selfCase.assigned_user_id,steps:selfSteps,proofId:SELF_PROOF};
 const finalCases=(await admin('select case_number,case_type,status,source_delivery_note_id,source_case_id,assigned_user_id from service_cases order by case_number')).rows;
 report={status:'passed',checks:evidence.length,executedAt:new Date().toISOString(),fixture:'Fictional order; disposable in-memory PGlite only',
  proforma:{id:PF,number:pf.document_number,status:pf.status,currency:'TZS',subtotalMinor:206000,taxMinor:37080,totalMinor:243080},
  invoice:{id:invoice.id,number:invoice.invoice_number,journalEntryId:invoice.journal_entry_id,totalMinor:Number(invoice.total_minor)},
  delivery:{id:NOTE,number:delivery.delivery_number,status:delivery.status,proofId:proof},samePerson,invoiceVoidProbe,stock:await lots(),serviceCases:finalCases,evidence,installed,
  omitted:['Real network authentication and MFA enrollment (fixture JWT claims used with actual server MFA/access functions).','Actual file bytes, object storage transport and physical signatures (synthetic metadata passed through actual storage RLS and attachment finalization).','TRA external issuance/verification (fictional receipt recorded through ERP RPC).','Parallel PostgreSQL sessions and lock contention (single-session PGlite).','Opening-balance migration, real inventory import, payment collection and accounting settlement.','Unrelated modules and their automatic handoff triggers; only order/delivery/service trigger definitions loaded.']};
 writeFileSync(resultPath,JSON.stringify(report,null,2)+'\n');
 writeFileSync(snapshotPath,JSON.stringify({status:'passed',synthetic:true,fixture:'Fictional records from the executable PGlite rehearsal; no live business data',generatedAt:new Date().toISOString(),tableWhitelist:snapshotTables,stages:snapshots},null,2)+'\n');
 console.log(`PASS: ${evidence.length} integrated order checks; first order ${pf.document_number} -> ${invoice.invoice_number} -> ${delivery.delivery_number}, 2 installations completed and 2 maintenance jobs scheduled; same-person order ${selfPf.document_number} -> ${selfDelivery.delivery_number}, installation self-assigned. Final machine/reagent stock 7/17; zero reservations. Invoice void blocked while delivery is active; cancel-then-void allowed.`);
}catch(error){
 writeFileSync(resultPath,JSON.stringify({status:'failed',executedAt:new Date().toISOString(),error:error.message,context:error.where||'',evidence,installed},null,2)+'\n');
 writeFileSync(snapshotPath,JSON.stringify({status:'failed',synthetic:true,error:error.message,stages:snapshots},null,2)+'\n');
 console.error('REHEARSAL FAILED:',error.message,'\nContext:',error.where||'', '\nLast installed:',installed.at(-1));process.exitCode=1;
}finally{await db.close();}
