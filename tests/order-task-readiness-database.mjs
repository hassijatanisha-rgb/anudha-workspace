// Real RPCs and RLS in disposable PostgreSQL; no live customer or stock changes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture();
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,ENGINEER,OUTSIDER,ORG,CONTACT,MACHINE,REAGENT,dates,as,admin,one,load}=f;
let next=4000,passed=0;
const fresh=()=>id(next++);
const check=async(name,fn)=>{await fn();passed++;console.log('PASS:',name);};
const order=async(quantity=4,product=REAGENT)=>{
 await as(SALES);
 let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[fresh(),ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Synthetic task readiness',JSON.stringify([{productId:product,description:'Fictional task readiness product',quantity,uom:'unit',unitPriceMinor:100000,discountBasisPoints:0,taxBasisPoints:1800}])]);
 for(const action of ['send','accept'])pf=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[pf.id,pf.version,action,'Synthetic '+action]);
 await as(ACCOUNTS);
 return {...pf,line:await one('select * from sales_proforma_lines where proforma_id=$1',[pf.id])};
};
const invoice=(pf,quantity)=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[fresh(),pf.id,pf.version,dates.today,dates.delivery,JSON.stringify([{proforma_line_id:pf.line.id,quantity}]),'Synthetic approval',dates.delivery,'']);
const openTask=pf=>one("select * from work_assignments where record_type='proforma' and record_id=$1 and status='open'",[pf.id]);
const unowned=async pf=>(await one('select exists(select 1 from unowned_work() where record_type=$1 and record_id=$2) present',['proforma',pf.id])).present;
const cancel=async inv=>{
 const note=await one('select * from sales_delivery_notes where invoice_id=$1',[inv.id]);
 await db.query("select advance_sales_delivery($1,$2,'cancel','','','','Synthetic cancellation')",[note.id,note.version]);
};
const voidInvoice=inv=>one('select * from void_invoice($1,$2,$3)',[inv.id,dates.today,'Synthetic invoice reversal']);
const selectDefault=step=>admin('select workflow_step_default($1) selected',[step]).then(r=>r.rows[0].selected);
try{
 // Retain a genuine whole-order invoice made by the older acceptance trigger.
 const legacy=await order(2),legacyInvoice=await one('select * from acc_invoices where proforma_id=$1',[legacy.id]);
 await db.exec('reset role');await load('202610180107_partial_order_invoices.sql');await load('202610180108_invoice_quantity_delivery.sql');await db.exec('set role authenticated');
 const partial=await order(),first=await invoice(partial,2),originalTask=await openTask(partial);
 const full=await order(2),fullInvoice=await invoice(full,2);
 const firstNote=await one('select * from sales_delivery_notes where invoice_id=$1',[first.id]);
 const oldDeliveryTask=await one("select * from work_assignments where record_type='delivery' and record_id=$1 and status='open'",[firstNote.id]);
 const fullNote=await one('select * from sales_delivery_notes where invoice_id=$1',[fullInvoice.id]);
 const fullDeliveryTask=await one("select * from work_assignments where record_type='delivery' and record_id=$1 and status='open'",[fullNote.id]);
 const customTask=await one('select * from hand_off_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fresh(),'delivery',fullNote.id,fullNote.delivery_number,'Call the customer before sending this delivery',ACCOUNTS,dates.delivery,'Synthetic customer instruction',fullDeliveryTask.id]);
 const staleReviewer=await order(1),staleTask=await openTask(staleReviewer);
 const inaccessibleReview=await one('select * from hand_off_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fresh(),'proforma',staleReviewer.id,staleReviewer.document_number,'Review the accepted order',SALES,null,'Synthetic old inaccessible reviewer',staleTask.id]);
 await as(OWNER);
 await db.query('select set_workflow_step_owner($1,1,$2,$3::uuid[])',['installation',OUTSIDER,[OUTSIDER]]);
 // The shared fixture intentionally omits this unrelated dashboard RPC; install its actual current definition.
 const automatic=readFileSync(new URL('../supabase/migrations/202610010051_automatic_handoffs.sql',import.meta.url),'utf8');
 const unownedDefinition=automatic.match(/create function public\.unowned_work\(\)[\s\S]*?\$\$;/)[0];
 await as('');await db.exec('reset role');await db.exec(unownedDefinition);await load('202610180109_order_task_readiness.sql');await db.exec('set role authenticated');await as(OWNER);
 await check('Migration closes existing full-order tasks and preserves partial owner/history',async()=>{
  assert.equal(await openTask(full),undefined);assert.equal(await openTask(legacy),undefined);
  assert.equal((await openTask(partial)).id,originalTask.id);assert.equal(await unowned(full),false);assert.equal(await unowned(legacy),false);
  assert.equal((await openTask(staleReviewer)).assignee_user_id,ACCOUNTS);
  assert.equal((await one('select status from work_assignments where id=$1',[inaccessibleReview.id])).status,'handed_on');
 });
 await check('Legacy automatic Tally wording becomes the correct ERP step without changing custom instructions',async()=>{
  const changed=await one("select * from work_assignments where record_type='delivery' and record_id=$1 and status='open'",[firstNote.id]);
  assert.equal(changed.task,`Send ${firstNote.delivery_number} to downstairs sales`);assert.equal(changed.previous_assignment_id,oldDeliveryTask.id);
  assert.equal((await one('select status from work_assignments where id=$1',[oldDeliveryTask.id])).status,'handed_on');
  const preserved=await one('select * from work_assignments where id=$1',[customTask.id]);
  assert.equal(preserved.status,'open');assert.equal(preserved.task,customTask.task);assert.equal(preserved.note,customTask.note);assert.deepEqual(preserved.due_on,customTask.due_on);
  const replacement=await one('select * from create_sales_delivery_note($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),legacy.id,legacy.version,'Synthetic existing invoice delivery',dates.delivery,'[]']);
  assert.equal((await one("select task from work_assignments where record_type='delivery' and record_id=$1 and status='open'",[replacement.id])).task,`Link the ERP invoice and reserve stock for ${replacement.delivery_number}`);
  await db.query("select advance_sales_delivery($1,$2,'cancel','','','','Synthetic unused replacement')",[replacement.id,replacement.version]);
 });
 await check('Final partial invoice closes the task and does not create phantom unowned work',async()=>{
  await as(ACCOUNTS);const inv=await invoice(partial,2);assert.equal(await openTask(partial),undefined);assert.equal(await unowned(partial),false);
  const note=await one('select * from sales_delivery_notes where invoice_id=$1',[inv.id]);
  assert.equal((await one("select task from work_assignments where record_type='delivery' and record_id=$1 and status='open'",[note.id])).task,`Send ${note.delivery_number} to downstairs sales`);
  const old=await one('select status,close_note from work_assignments where id=$1',[originalTask.id]);
  assert.deepEqual(old,{status:'done',close_note:'All order quantities invoiced'});
 });
 await check('Voiding a cancelled invoice reopens the correct remaining invoice task once',async()=>{
  await cancel(first);await voidInvoice(first);
  const task=await openTask(partial);assert.equal(task.assignee_user_id,ACCOUNTS);assert.match(task.task,/Review quantities/);
  assert.equal((await one('select order_invoice_quantities($1) q',[partial.id])).q.lines[0].remaining_quantity,2);
  await voidInvoice(first);assert.equal((await openTask(partial)).id,task.id);
  await invoice(partial,1);assert.equal((await openTask(partial)).id,task.id);
 });
 await check('Legacy whole-order invoices hide invoice work until voided',async()=>{
  await voidInvoice(legacyInvoice);assert.equal((await openTask(legacy)).assignee_user_id,ACCOUNTS);
  assert.equal((await one('select order_invoice_quantities($1) q',[legacy.id])).q.lines[0].remaining_quantity,2);
  await invoice(legacy,2);assert.equal(await openTask(legacy),undefined);assert.equal(await unowned(legacy),false);
 });
 await check('A manually completed partial review still appears as unowned work',async()=>{
  const task=await openTask(partial);
  await db.query("select close_work_assignment($1,$2,'done','Synthetic manual completion')",[task.id,task.version]);
  assert.equal(await unowned(partial),true);await invoice(partial,1);assert.equal(await unowned(partial),false);
 });
 await check('Invalid defaults and team members are rejected without storing a new version',async()=>{
  await as(OWNER);
  await assert.rejects(()=>db.query('select set_workflow_step_owner($1,2,$2,$3::uuid[])',['installation',OUTSIDER,[OUTSIDER]]),/access to this workflow step/i);
  await assert.rejects(()=>db.query('select set_workflow_step_owner($1,2,$2,$3::uuid[])',['installation',ENGINEER,[ENGINEER,OUTSIDER]]),/team members.*access/i);
  await assert.rejects(()=>db.query('select set_workflow_step_owner($1,1,$2,$3::uuid[])',['invoice',SALES,[SALES]]),/access to this workflow step/i);
  await assert.rejects(()=>db.query('select set_workflow_step_owner($1,1,$2,$3::uuid[])',['packing',ENGINEER,[ENGINEER]]),/access to this workflow step/i);
  assert.equal((await one("select max(version)::int version from workflow_step_owners where step='installation'")).version,2);
 });
 await check('Existing invalid defaults cannot fall back to an inaccessible actor',async()=>{
  await as(DRIVER);assert.equal(await selectDefault('installation'),null);
  await as(ENGINEER);assert.equal(await selectDefault('installation'),ENGINEER);
  await as(OWNER);await db.query('select set_workflow_step_owner($1,2,$2,$3::uuid[])',['installation',ENGINEER,[ENGINEER]]);
  await as(DRIVER);assert.equal(await selectDefault('installation'),ENGINEER);
  await admin("update staff set access='{}' where user_id=$1",[ENGINEER]);assert.equal(await selectDefault('installation'),null);
  await admin("update staff set access='{service}' where user_id=$1",[ENGINEER]);
 });
 await check('Invoice defaults are ignored after accounting membership is revoked',async()=>{
  await as(SALES);assert.equal(await selectDefault('invoice'),ACCOUNTS);
  await admin('update accounting_memberships set active=false where user_id=$1',[ACCOUNTS]);assert.equal(await selectDefault('invoice'),null);
  await admin('update accounting_memberships set active=true where user_id=$1',[ACCOUNTS]);
 });
 await check('Acceptance closes the completed Sales follow-up when no eligible invoice owner exists',async()=>{
  await admin('update accounting_memberships set active=false where user_id=$1',[ACCOUNTS]);
  const waiting=await order(1);assert.equal(await openTask(waiting),undefined);assert.equal(await unowned(waiting),true);
  assert.equal((await one("select status from work_assignments where record_type='proforma' and record_id=$1 and task='Follow up until the customer accepts'",[waiting.id])).status,'handed_on');
  await admin('update accounting_memberships set active=true where user_id=$1',[ACCOUNTS]);
  await invoice(waiting,1);assert.equal(await unowned(waiting),false);
 });
 await check('Partial invoicing preserves a manually selected eligible owner',async()=>{
  const pf=await order(2),task=await openTask(pf);
  const manual=await one('select * from hand_off_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fresh(),'proforma',pf.id,pf.document_number,'Owner reviews available quantities',OWNER,null,'Synthetic owner override',task.id]);
  await invoice(pf,1);assert.equal((await openTask(pf)).id,manual.id);
  await invoice(pf,1);assert.equal(await openTask(pf),undefined);
 });
 await check('Every workflow step accepts its existing eligible role and rejects unrelated access',async()=>{
  for(const [step,actor] of [['invoice',ACCOUNTS],['packing',PACKER],['delivery',DRIVER],['installation',ENGINEER],['service',ENGINEER],['purchase_approval',OWNER]]){
   assert.equal((await admin('select workflow_step_access($1,$2) allowed',[step,actor])).rows[0].allowed,true);
   assert.equal((await admin('select workflow_step_access($1,$2) allowed',[step,OUTSIDER])).rows[0].allowed,false);
  }
  await admin('update staff set active=false where user_id=$1',[ENGINEER]);
  assert.equal((await admin("select workflow_step_access('service',$1) allowed",[ENGINEER])).rows[0].allowed,false);
  await admin('update staff set active=true where user_id=$1',[ENGINEER]);
 });
 await check('Signed delivery with no eligible default leaves engineering work visible as unowned',async()=>{
  await admin("update staff set access='{}' where user_id=$1",[ENGINEER]);
  const pf=await order(2,MACHINE),inv=await invoice(pf,2);
  let note=await one('select * from sales_delivery_notes where invoice_id=$1',[inv.id]);
  const advance=action=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[note.id,note.version,action,'Synthetic truck','SYNTHETIC-ROUTE','Synthetic recipient','Synthetic signed proof']);
  note=await advance('send_to_sales');await as(PACKER);note=await one('select * from start_reserved_sales_delivery_packing($1,$2)',[note.id,note.version]);
  const line=await one('select * from sales_delivery_lines where delivery_note_id=$1',[note.id]);
  await db.query('select record_delivery_serials($1,$2,$3::jsonb)',[note.id,note.version,JSON.stringify([{deliveryLineId:line.id,serials:['SYNTHETIC-READINESS-A','SYNTHETIC-READINESS-B']}])]);
  note=await one('select * from sales_delivery_notes where id=$1',[note.id]);note=await one('select * from packing_mark_packed($1,$2)',[note.id,note.version]);
  await as(DRIVER);note=await advance('dispatch');
  const proof=fresh(),proofPath=`delivery/${note.id}/${proof}.pdf`;
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[proofPath,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
  await db.query('select finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',note.id,proofPath,'Synthetic signed delivery.pdf','application/pdf',321]);
  note=await advance('deliver');await as(OWNER);
  const cases=(await db.query('select id from service_cases where source_delivery_note_id=$1',[note.id])).rows;
  assert.equal(cases.length,2);
  for(const item of cases){
   assert.equal((await one("select count(*)::int n from work_assignments where record_type='service' and record_id=$1 and status='open'",[item.id])).n,0);
   assert.equal((await one("select count(*)::int n from unowned_work() where record_type='service' and record_id=$1",[item.id])).n,1);
   await admin("select auto_assign_work('service',$1,'Synthetic case','Synthetic inaccessible fallback',$2)",[item.id,OUTSIDER]);
   assert.equal((await one("select count(*)::int n from work_assignments where record_type='service' and record_id=$1 and status='open'",[item.id])).n,0);
  }
 });
 await check('Internal eligibility and reconciliation helpers remain unavailable to clients',async()=>{
  await as(OUTSIDER);
  for(const [sql,args] of [['select workflow_step_access($1,$2)',['service',OUTSIDER]],['select order_needs_invoice($1)',[full.id]],['select sync_order_invoice_work($1)',[full.id]]])await assert.rejects(()=>db.query(sql,args),/permission denied/i);
  await assert.rejects(()=>db.query('select set_workflow_step_owner($1,3,$2,$3::uuid[])',['installation',OUTSIDER,[OUTSIDER]]),/only the owner/i);
 });
 await check('Reapplying migration preserves public RPC identity and assignment history',async()=>{
  const before=(await admin("select oid,proacl,prosecdef,proconfig from pg_proc where oid in ('public.set_workflow_step_owner(text,integer,uuid,uuid[])'::regprocedure,'public.unowned_work()'::regprocedure) order by oid")).rows;
  const count=(await admin('select count(*)::int n from work_assignments')).rows[0].n;
  await db.exec('reset role');await load('202610180109_order_task_readiness.sql');await db.exec('set role authenticated');
  assert.deepEqual((await admin("select oid,proacl,prosecdef,proconfig from pg_proc where oid in ('public.set_workflow_step_owner(text,integer,uuid,uuid[])'::regprocedure,'public.unowned_work()'::regprocedure) order by oid")).rows,before);
  assert.equal((await admin('select count(*)::int n from work_assignments')).rows[0].n,count);
 });
 console.log(`PASS: ${passed} order task readiness scenarios.`);
}catch(error){console.error('ORDER TASK READINESS FAILED:',error.message,'\nContext:',error.where||'');process.exitCode=1;}
finally{await db.close();}
