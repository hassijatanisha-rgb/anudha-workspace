// Actual workflow migrations/RPCs in disposable PostgreSQL; no live business records are used.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180109_order_task_readiness.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202611020156_accounting_posting_integrity.sql',...(process.env.CUSTOMER_CREDIT_INTEGRATION==='1'?['202610070073_receive_transfer_available_lot.sql','202610200120_machine_serial_requirement.sql','202610200121_receiving_machine_serials.sql','202611020158_supplier_accounting.sql','202611020159_inventory_cost_accounting.sql']:[]),'202611020160_customer_credit_settlement.sql','202611100166_cancel_accepted_sales_order.sql']});
const {db,id,as,admin,one,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,OUTSIDER,ORG,CONTACT,REAGENT,MACHINE,dates}=f;
let next=40000,checks=0;const fresh=()=>id(next++),reason='Customer cancelled the training order';
const reject=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
const check=async(name,fn)=>{await db.exec('begin');await as(ACCOUNTS);try{await fn();await db.exec('set constraints all immediate');checks++;console.log('PASS:',name);}finally{await db.exec('rollback');}};
const order=async(quantities=[2],product=REAGENT)=>{
 await as(SALES);let p=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[fresh(),ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Fictional cancellation fixture',JSON.stringify(quantities.map(quantity=>({productId:product,description:'Fictional ordered item',quantity,uom:'unit',unitPriceMinor:10000,discountBasisPoints:0,taxBasisPoints:1800})))]);
 for(const action of ['send','accept'])p=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[p.id,p.version,action,'Fictional customer '+action]);
 await as(ACCOUNTS);return {...p,lines:(await db.query('select * from sales_proforma_lines where proforma_id=$1 order by sort_order',[p.id])).rows};
};
const invoice=(p,quantities=p.lines.map(l=>l.quantity),date=dates.today)=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[fresh(),p.id,p.version,date,dates.valid,JSON.stringify(quantities.map((quantity,i)=>({proforma_line_id:p.lines[i].id,quantity})).filter(l=>l.quantity)),'Fictional invoice approval',dates.delivery,'']);
const cancel=(p,version=p.version,note=reason)=>one('select * from cancel_accepted_sales_order($1,$2,$3)',[p.id,version,note]);
const note=inv=>one('select * from sales_delivery_notes where invoice_id=$1',[inv.id]);
const advance=(n,action)=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[n.id,n.version,action,'Fixture truck','FIXTURE-ROUTE','Fixture recipient','Fixture signed proof or cancellation']);
const voided=async(p,date=dates.today)=>{const i=await invoice(p,p.lines.map(()=>1));await advance(await note(i),'cancel');await one('select * from void_invoice($1,$2,$3)',[i.id,date,'Fictional invoice reversal']);return i;};
const deliver=async i=>{
 let n=await advance(await note(i),'send_to_sales');await as(PACKER);n=await one('select * from packing_take_next()');assert.equal(n.invoice_id,i.id);
 n=await one('select * from packing_mark_packed($1,$2)',[n.id,n.version]);await as(DRIVER);n=await advance(n,'dispatch');
 const proof=fresh(),path=`delivery/${n.id}/${proof}.pdf`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[path,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',n.id,path,'Fixture signed delivery.pdf','application/pdf',321]);
 n=await advance(n,'deliver');await as(ACCOUNTS);return {...n,lines:(await db.query('select * from sales_delivery_lines where delivery_note_id=$1 order by id',[n.id])).rows};
};
const credit=async(n,quantity,{resolve=true,date=dates.today}={})=>{
 let r=await one('select * from record_sales_return($1,$2,$3,$4,$5,$6::jsonb)',[fresh(),n.id,'unopened','Fictional return','',JSON.stringify([{deliveryLineId:n.lines[0].id,quantity}])]);
 const draft=await one('select * from create_return_credit_note($1,$2,$3)',[r.id,r.version,fresh()]);
 const c=await one('select * from post_return_credit_note($1,$2,$3,$4)',[fresh(),draft.id,draft.version,date]);
 if(resolve){await as(OWNER);r=await one('select * from sales_returns where id=$1',[r.id]);const l=await one('select * from sales_return_lines where return_id=$1',[r.id]);await one('select * from resolve_sales_return_line($1,$2,$3,$4,$5)',[l.id,r.version,'restock','Fictional return inspected',true]);await as(ACCOUNTS);}
 return c;
};
const snapshot=p=>admin(`select (select status from sales_proformas where id=$1) status,(select version from sales_proformas where id=$1) version,
 (select count(*)::int from sales_proforma_events where proforma_id=$1) events,(select count(*)::int from acc_journal_entries) journals,
 (select count(*)::int from pending_stock_requests where proforma_id=$1 and status='waiting') pending,
 (select coalesce(sum(quantity),0)::int from pending_stock_requests where proforma_id=$1 and status='waiting') quantity,
 (select count(*)::int from work_assignments where status='open' and (record_type='proforma' and record_id=$1 or record_type='pending' and record_id in(select id from pending_stock_requests where proforma_id=$1))) work`,[p.id]).then(r=>r.rows[0]);
try{
 await check('authorization, required version/reason, stale version and original transition remain enforced',async()=>{
  const p=await order();for(const actor of [SALES,OUTSIDER,'']){await as(actor);await reject(()=>cancel(p),/Owner or accounting/);}
  await as(ACCOUNTS);await reject(()=>cancel(p,null),/expected version/);await reject(()=>cancel(p,p.version,''),/reason/);await reject(()=>cancel(p,p.version,'x'.repeat(301)),/reason/);await reject(()=>cancel(p,p.version-1),/changed/);
  await reject(()=>one("select * from advance_sales_proforma($1,$2,'cancel',$3)",[p.id,p.version,reason]),/next allowed/);
  await db.exec('set role anon');await reject(()=>cancel(p),/permission denied/);await db.exec('set role authenticated');
 });
 await check('owner without accounting membership can cancel an uninvoiced accepted order',async()=>{
  const p=await order();await admin('delete from accounting_memberships where user_id=$1',[OWNER]);await as(OWNER);assert.equal((await cancel(p)).status,'cancelled');
 });
 await check('active delivery and live invoice reject without partial changes',async()=>{
  const p=await order(),i=await invoice(p),before=await snapshot(p);await reject(()=>cancel(p),/active deliveries/);assert.deepEqual(await snapshot(p),before);
  await advance(await note(i),'cancel');const after=await snapshot(p);await reject(()=>cancel(p),/Void or fully credit/);assert.deepEqual(await snapshot(p),after);
 });
 await check('future-dated invoice void is not yet sufficient',async()=>{const p=await order();await voided(p,dates.delivery);await reject(()=>cancel(p),/effective today/);});
 await check('two voided orders close exactly four pending requests, 312 quantities and six tasks; audits and originals remain',async()=>{
  const a=await order([150,150]),b=await order([6,6]);await voided(a);await voided(b);const beforeA=await snapshot(a),beforeB=await snapshot(b);
  assert.equal(beforeA.pending+beforeB.pending,4);assert.equal(beforeA.quantity+beforeB.quantity,312);assert.equal(beforeA.work+beforeB.work,6);
  const unrelated=await order([3]);const untouched=await snapshot(unrelated);const cancelledA=await cancel(a);await cancel(b);
  for(const p of [a,b]){const s=await snapshot(p);assert.equal(s.status,'cancelled');assert.equal(s.version,p.version+1);assert.equal(s.pending,0);assert.equal(s.work,0);
   const audit=await one("select * from sales_proforma_events where proforma_id=$1 and from_status='accepted' and to_status='cancelled'",[p.id]);assert.equal(audit.reference,reason);assert.equal(audit.actor_user_id,ACCOUNTS);
   assert.equal((await one("select count(*)::int n from pending_stock_events where request_id in(select id from pending_stock_requests where proforma_id=$1) and action='order_cancel'",[p.id])).n,2);
   const history=(await admin('select accepted_at,accepted_by,acceptance_reference from sales_proformas where id=$1',[p.id])).rows[0];assert.equal(history.accepted_by,p.accepted_by);assert.equal(history.acceptance_reference,p.acceptance_reference);assert.deepEqual(history.accepted_at,p.accepted_at);
  }
  assert.equal((await snapshot(a)).journals,beforeB.journals);assert.deepEqual(await snapshot(unrelated),untouched);
  await reject(()=>cancel(a),/changed/);await reject(()=>cancel(cancelledA),/Only an active accepted/);
  const s=await snapshot(a);await admin('select sync_order_pending($1)',[a.id]);await admin('select sync_order_invoice_work($1)',[a.id]);assert.deepEqual(await snapshot(a),s);
  await reject(()=>invoice({...cancelledA,lines:a.lines},[1,1]),/Only an accepted/);
  const pend=await one('select * from pending_stock_requests where proforma_id=$1 limit 1',[a.id]);
  await reject(()=>one('select * from hand_off_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fresh(),'pending',pend.id,pend.request_number,'Reopen this pending order',SALES,null,'Fixture',null]),/no longer open/);
  await reject(()=>one('select * from hand_off_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fresh(),'proforma',a.id,a.document_number,'Reopen this order',ACCOUNTS,null,'Fixture',null]),/no longer open/);
  await reject(()=>one('select * from create_pending_stock_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fresh(),ORG,CONTACT,REAGENT,1,a.id,null,SALES,'Fixture']),/open Pro forma/);
 });
 await check('linked standalone pending requests also close, independent pending stays open',async()=>{
  const p=await order();const make=pf=>one('select * from create_pending_stock_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fresh(),ORG,CONTACT,REAGENT,1,pf,null,SALES,'Fixture pending']);
  const linked=await make(p.id),independent=await make(null);await cancel(p);assert.equal((await one('select status from pending_stock_requests where id=$1',[linked.id])).status,'cancelled');assert.equal((await one('select status from pending_stock_requests where id=$1',[independent.id])).status,'waiting');
 });
 await check('a handoff failure rolls back pending quantities, order, journal and event changes',async()=>{
  const p=await order([4,4]);await voided(p);const before=await snapshot(p);
  await admin(`create function pg_temp.reject_order_close() returns trigger language plpgsql as $$begin if new.status='cancelled' then raise exception 'Injected close failure';end if;return new;end$$;`);
  await admin('create trigger cancellation_rollback_test before update on work_assignments for each row execute function pg_temp.reject_order_close()');
  await reject(()=>cancel(p),/Injected close failure/);assert.deepEqual(await snapshot(p),before);
 });
 await check('partial return credit cannot cancel a partly reversed invoice',async()=>{const p=await order(),i=await invoice(p),n=await deliver(i);await credit(n,1);await reject(()=>cancel(p),/Void or fully credit/);});
 await check('full credit with unresolved returned goods cannot cancel',async()=>{const p=await order(),i=await invoice(p),n=await deliver(i);await credit(n,2,{resolve:false});await reject(()=>cancel(p),/resolved return/);});
 await check('full credit scheduled in the future cannot cancel today',async()=>{const p=await order(),i=await invoice(p),n=await deliver(i);await credit(n,2,{date:dates.delivery});await reject(()=>cancel(p),/Void or fully credit/);});
 await check('future credit void followed by a later repost cannot hide an intermediate receivable',async()=>{
  const p=await order(),i=await invoice(p),n=await deliver(i),c=await credit(n,2);
  const future=await one('select (current_date+2)::text void_date,(current_date+3)::text repost_date');
  await one('select void_return_credit_note($1,$2,$3)',[c.id,future.void_date,'Fixture future reversal']);
  await one('select repost_return_credit_note($1,$2,$3)',[fresh(),c.id,future.repost_date]);
  await reject(()=>cancel(p),/Void or fully credit/);
 });
 await check('customer payment/excess credit prevents cancellation even after a full resolved return',async()=>{
  const p=await order(),i=await invoice(p);await one("select * from record_receipt($1,$2,$3,$4,'bank','Fixture payment',$5,$6::jsonb)",[fresh(),ORG,dates.today,100,'a0000000-0000-4000-8000-000000001200',JSON.stringify([{invoice_id:i.id,amount_minor:100}])]);
  const n=await deliver(i);await credit(n,2);await reject(()=>cancel(p),/payments and customer credit/);
 });
 await check('open service linked through either delivery or asset blocks cancellation',async()=>{
  const p=await order(),i=await invoice(p),n=await deliver(i);await credit(n,2);const asset=fresh(),job=fresh();
  await admin("insert into equipment_assets(id,organization_id,product_id,source_delivery_line_id) values($1,$2,$3,$4)",[asset,ORG,MACHINE,n.lines[0].id]);
  await admin("insert into service_cases(id,case_number,case_type,asset_id,organization_id,product_id,created_by) values($1,$2,'installation',$3,$4,$5,$6)",[job,'Fixture-service-'+job,asset,ORG,MACHINE,OWNER]);
  await reject(()=>cancel(p),/open installation and service/);
 });
 await check('fully returned resolved credited order cancels; credit void and backdated receipt/application cannot reopen finance',async()=>{
  const p=await order(),earlier=(await one("select (current_date-1)::text date")).date,i=await invoice(p,undefined,earlier),n=await deliver(i),c=await credit(n,2);
  assert.equal((await cancel(p)).status,'cancelled');const s=await snapshot(p);
  await reject(()=>one('select void_return_credit_note($1,$2,$3)',[c.id,dates.today,'Fixture correction']),/must retain/);
  await reject(()=>one("select * from record_receipt($1,$2,$3,$4,'bank','Fixture late receipt',$5,$6::jsonb)",[fresh(),ORG,earlier,100,'a0000000-0000-4000-8000-000000001200',JSON.stringify([{invoice_id:i.id,amount_minor:100}])]),/cannot receive new invoice settlements/);
  const r=await one("select * from record_receipt($1,$2,$3,$4,'bank','Fixture advance',$5,'[]'::jsonb)",[fresh(),ORG,earlier,100,'a0000000-0000-4000-8000-000000001200']);
  await reject(()=>one('select apply_customer_credit($1,$2,null,null,$3,$4,$5)',[fresh(),r.id,i.id,earlier,100]),/cannot receive new invoice settlements/);
  assert.equal((await snapshot(p)).events,s.events);assert.equal((await one('select voided_at from acc_credit_notes where id=$1',[c.id])).voided_at,null);
 });
 console.log(`PASS: ${checks} accepted-order cancellation scenarios using actual migrations and RPCs. Parallel-session lock contention is not simulated by PGlite.`);
}finally{await db.close();}
