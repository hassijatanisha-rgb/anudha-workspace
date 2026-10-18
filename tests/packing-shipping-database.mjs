// Disposable PostgreSQL fixture. PGLITE_MODULE points to @electric-sql/pglite/dist/index.js.
// Uses real stock/sales/packing/serial migrations and current RPC bodies; no live connections.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const mig=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const OWNER=id(1),HEAD=id(2),PACKER=id(3),OTHER=id(4),OUTSIDER=id(5),ORG=id(10),CONTACT=id(11),PRODUCT=id(12),PACK=id(13),HUB=id(14),EARLY=id(15),LATE=id(16);
let next=100,checks=0;const check=async f=>{await f();checks++;};
const as=actor=>db.query("select set_config('test.actor',$1,false)",[actor??'']);
const admin=async(sql,params=[])=>{await db.exec('reset role');try{return await db.query(sql,params);}finally{await db.exec('set role authenticated');}};
const adminExec=async sql=>{await db.exec('reset role');try{return await db.exec(sql);}finally{await db.exec('set role authenticated');}};
const loadFunction=async(file,name)=>{
 const match=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));
 assert.ok(match,`${name} exists`);await db.exec(match[0]);
};
const note=noteId=>db.query('select * from sales_delivery_notes where id=$1',[noteId]).then(r=>r.rows[0]);
const stock=()=>db.query('select id,loose_units,reserved_units,version from inventory_lots order by id').then(r=>r.rows);
const state=async d=>({note:await note(d.note),stock:await stock(),events:(await db.query('select * from sales_delivery_events where delivery_note_id=$1 order by id',[d.note])).rows});
const advance=async(d,action,reference='Fixture reference')=>db.query("select * from advance_sales_delivery($1,$2,$3,'Fixture truck','Fixture route','Fixture recipient',$4)",[d.note,(await note(d.note)).version,action,reference]).then(r=>r.rows[0]);
const reserve=async d=>db.query('select * from create_tax_invoice_and_reserve_stock($1,$2,$3)',[d.note,(await note(d.note)).version,'TI-'+d.note]).then(r=>r.rows[0]);
const start=async d=>db.query('select * from start_reserved_sales_delivery_packing($1,$2)',[d.note,(await note(d.note)).version]).then(r=>r.rows[0]);
const packed=async d=>db.query('select * from packing_mark_packed($1,$2)',[d.note,(await note(d.note)).version]).then(r=>r.rows[0]);
const release=async d=>db.query('select * from packing_release($1,$2,$3)',[d.note,(await note(d.note)).version,'Fixture reassignment']).then(r=>r.rows[0]);
const take=()=>db.query('select (packing_take_next()).id id').then(r=>r.rows[0].id);
const pick=async(d,quantity)=>db.query('select * from start_sales_delivery_packing($1,$2,$3::jsonb)',[d.note,(await note(d.note)).version,JSON.stringify([{proformaLineId:d.pl,lotId:LATE,quantity}])]).then(r=>r.rows[0]);
const order=async(quantity=2,legacy=false)=>{
 await as(OWNER);const pf=id(next++),pl=id(next++),delivery=id(next++);
 await admin(`insert into sales_proformas(id,document_number,organization_id,contact_id,status,valid_until,delivery_period,payment_terms,prepared_by,accepted_by,accepted_at,acceptance_reference)
  values($1,$2,$3,$4,'accepted',current_date+30,'7 days','Cash',$5,$5,now(),'Fixture customer approval')`,[pf,'PF-'+next,ORG,CONTACT,OWNER]);
 await admin('insert into sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor) values($1,$2,$3,1,$4,$5,$6,100)',[pl,pf,PRODUCT,'Fixture item',quantity,'unit']);
 await db.query("select * from create_sales_delivery_note($1,$2,1,'ACC fixture',current_date,'[]')",[delivery,pf]);
 if(legacy)await admin("update sales_delivery_notes set status='sent_to_sales',tax_invoice_reference='Legacy invoice' where id=$1",[delivery]);
 return {pf,pl,note:delivery};
};
const queue=async d=>{await as(OWNER);await reserve(d);await advance(d,'send_to_sales');};
const serials=async(d,values)=>{
 const lines=(await db.query('select id,quantity from sales_delivery_lines where delivery_note_id=$1 order by lot_id',[d.note])).rows;let offset=0;
 await db.query('select * from record_delivery_serials($1,$2,$3::jsonb)',[d.note,(await note(d.note)).version,JSON.stringify(lines.map(l=>({deliveryLineId:l.id,serials:values.slice(offset,offset+=l.quantity)})))]);
};
const proof=async(d,when='now()')=>admin(`insert into document_attachments(record_type,record_id,uploaded_at) values('delivery',$1,${when})`,[d.note]);
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[],display_name text);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,location text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 create table document_attachments(id uuid primary key default gen_random_uuid(),record_type text,record_id uuid,uploaded_at timestamptz);
 grant usage on schema auth to authenticated;
 insert into auth.users(id) values('${OWNER}'),('${HEAD}'),('${PACKER}'),('${OTHER}'),('${OUTSIDER}');
 insert into staff values('${OWNER}',true,'owner','management','{}','Fixture owner'),('${HEAD}',true,'head','stores','{stock,deliveries}','Fixture stores head'),
 ('${PACKER}',true,'staff','stores','{deliveries}','Fixture packer'),('${OTHER}',true,'staff','stores','{deliveries}','Fixture second packer'),('${OUTSIDER}',true,'staff','sales','{leads}','Fixture outsider');
 insert into products values('${PRODUCT}','Fixture machine',null);
 insert into organizations values('${ORG}','Fixture clinic','Dar',null);insert into contacts values('${CONTACT}','${ORG}',null,'valid');
 create function public.mfa_satisfied() returns boolean language sql stable as $$select true$$;`);
 for(const name of ['has_access','require_access','is_department_head'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql',
  '202609210005_sales_office_workflow.sql','202609210010_accounting_tax_invoice_reservation.sql','202609230015_accounting_membership.sql',
  '202609230019_accounting_drafts.sql','202609300045_work_assignments.sql','202610010056_team_tasks.sql','202610010057_travel_requests.sql',
  '202610090078_packing_queue.sql','202610150081_delivery_proof_required.sql','202610150082_customer_returns.sql','202610150084_serial_numbers.sql'])await db.exec(mig(file));
 for(const name of ['create_sales_delivery_note','start_sales_delivery_packing','advance_travel_request'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 await loadFunction('202610010051_automatic_handoffs.sql','auto_assign_work');
 await db.exec(mig('202610160095_operational_integrity.sql'));
 await db.exec(`insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${HUB}','Fixture Haadi','FH','dispatch_hub',true,'${OWNER}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('${PACK}','${PRODUCT}',1,'unit',1,'Fixture pack','${OWNER}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,loose_units) values
 ('${EARLY}','${PRODUCT}','${HUB}','${PACK}','EARLY','2030-01-01',1),('${LATE}','${PRODUCT}','${HUB}','${PACK}','LATE','2031-01-01',30);`);
 const functions=['create_tax_invoice_and_reserve_stock(uuid,integer,text)','start_reserved_sales_delivery_packing(uuid,integer)',
  'start_sales_delivery_packing(uuid,integer,jsonb)','advance_sales_delivery(uuid,integer,text,text,text,text,text)',
  'packing_take_next()','packing_release(uuid,integer,text)','packing_items(public.sales_delivery_notes)','order_live_status(uuid[])'];
 const metadata=()=>db.query('select oid,proacl,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[functions]).then(r=>r.rows);
 const before=await metadata();await db.exec(mig('202610180102_packing_shipping_handoffs.sql'));await db.exec(mig('202610180102_packing_shipping_handoffs.sql'));
 await check(async()=>assert.deepEqual(await metadata(),before,'Rerun preserves identities, grants and security paths'));
 await db.exec('set role authenticated');

 const a=await order();await as(OUTSIDER);const unreserved=await state(a);
 await check(()=>assert.rejects(reserve(a),/do not have access/));
 await check(async()=>assert.deepEqual(await state(a),unreserved,'Unauthorized reservation changes nothing'));
 await queue(a);
 await check(async()=>assert.deepEqual((await db.query('select l.batch_number,d.quantity from sales_delivery_lines d join inventory_lots l on l.id=d.lot_id where delivery_note_id=$1 order by batch_number',[a.note])).rows,[{batch_number:'EARLY',quantity:1},{batch_number:'LATE',quantity:1}],'Tax invoice reserves FIFO by expiry'));
 await as(OUTSIDER);const waiting=await state(a);await check(()=>assert.rejects(start(a),/do not have access/));
 await check(async()=>assert.deepEqual(await state(a),waiting));
 await as(PACKER);const claimed=await start(a);
 await check(async()=>{assert.equal(claimed.packer_user_id,PACKER);assert.ok(claimed.packing_taken_at);assert.equal(claimed.packing_auto_reserved,false);
  assert.equal((await db.query("select assignee_user_id from work_assignments where record_id=$1 and status='open'",[a.note])).rows[0].assignee_user_id,PACKER);});
 const b=await order(1);await queue(b);await as(PACKER);
 await check(()=>assert.rejects(start(b),/Press Packed/));await check(()=>assert.rejects(take(),/Press Packed/));
 const legacy=await order(2,true);await as(PACKER);await check(()=>assert.rejects(pick(legacy,1),/Press Packed/));
 await as(OTHER);const beforeEmpty=await state(legacy);
 await check(()=>assert.rejects(db.query('select start_sales_delivery_packing($1,$2,null)',[legacy.note,beforeEmpty.note.version]),/Choose at least one item/));
 await check(async()=>assert.deepEqual(await state(legacy),beforeEmpty,'NULL packing list never creates an empty shipment'));
 await as(OTHER);const unchanged=await state(a);
 await check(()=>assert.rejects(advance(a,'ready'),/who took this order/));await check(()=>assert.rejects(packed(a),/who took this order/));
 await check(async()=>assert.deepEqual(await state(a),unchanged,'Both completion paths reject a different packer without touching stock or history'));
 await as(HEAD);const reservedStock=await stock();await release(a);
 await check(async()=>{assert.deepEqual(await stock(),reservedStock,'Tax invoice reservations survive release');assert.equal((await note(a.note)).packer_user_id,null);});
 await as(PACKER);await check(async()=>assert.equal(await take(),a.note,'Queue claims the released oldest order'));
 await check(async()=>assert.equal((await db.query('select count(*)::int n from work_assignments where record_id=$1',[a.note])).rows[0].n,1,'Retaking an existing reservation does not duplicate the same packing assignment'));
 await as(HEAD);await packed(a);await check(async()=>assert.equal((await note(a.note)).status,'ready'));

 await db.query('select set_product_serial_required($1,true)',[PRODUCT]);await as(PACKER);
 await check(()=>assert.rejects(advance(a,'dispatch'),/serial number of every unit/));
 await serials(a,['SERIAL-1','SERIAL-2']);await proof(a,"now()-interval '1 day'");const reservedBeforeDispatch=await stock();await advance(a,'dispatch');
 await check(async()=>{const after=await stock();for(let i=0;i<2;i++){assert.equal(after[i].loose_units,reservedBeforeDispatch[i].loose_units-1);assert.equal(after[i].reserved_units,reservedBeforeDispatch[i].reserved_units-1);}
  assert.equal((await db.query('select count(*)::int n from inventory_issues where delivery_note_id=$1',[a.note])).rows[0].n,2);});
 await check(()=>assert.rejects(advance(a,'dispatch'),/next allowed delivery step/));
 await check(()=>assert.rejects(advance(a,'deliver'),/Upload a photo or scan/));await proof(a);await advance(a,'deliver');
 await check(async()=>assert.equal((await note(a.note)).status,'delivered'));

 // Legacy partial picking retains its exact quantities and safely releases entered serials.
 await as(OTHER);const picked=await pick(legacy,1);await check(async()=>{assert.equal(picked.packer_user_id,OTHER);assert.equal(picked.packing_auto_reserved,true);});
 await serials(legacy,['SERIAL-RELEASE']);const stockBeforeRelease=await stock();await as(HEAD);await release(legacy);
 await check(async()=>{assert.equal((await stock())[1].reserved_units,stockBeforeRelease[1].reserved_units-1);
  assert.equal((await db.query('select count(*)::int n from delivery_line_serials where delivery_note_id=$1',[legacy.note])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from sales_delivery_lines where delivery_note_id=$1',[legacy.note])).rows[0].n,0);});
 await as(OTHER);await pick(legacy,1);await serials(legacy,['SERIAL-PART']);await packed(legacy);await advance(legacy,'dispatch');await proof(legacy);await advance(legacy,'deliver');
 await check(async()=>{const live=(await db.query('select order_live_status($1) data',[[legacy.pf]])).rows[0].data[0];assert.equal(live.status,'delivered');assert.equal(live.remaining_quantity,1);});
 await as(OWNER);const rest={...legacy,note:id(next++)};await db.query("select create_sales_delivery_note($1,$2,1,'ACC remainder',current_date,'[]')",[rest.note,rest.pf]);
 await check(async()=>{const items=(await admin('select packing_items(n) items from sales_delivery_notes n where id=$1',[rest.note])).rows[0].items;assert.equal(items[0].quantity,1);});
 await reserve(rest);await advance(rest,'send_to_sales');await as(OTHER);await start(rest);await packed(rest);await serials(rest,['SERIAL-REST']);await advance(rest,'dispatch');await proof(rest);await advance(rest,'deliver');
 await check(async()=>assert.equal((await db.query('select order_live_status($1) data',[[rest.pf]])).rows[0].data[0].remaining_quantity,0));

 const shortage=await order(1000);const beforeShortage=await state(shortage);await check(()=>assert.rejects(reserve(shortage),/Not enough available stock/));
 await check(async()=>{assert.deepEqual(await state(shortage),beforeShortage);assert.equal((await db.query('select count(*)::int n from sales_delivery_lines where delivery_note_id=$1',[shortage.note])).rows[0].n,0);});
 await as(OWNER);const beforeCancel=await stock();await advance(b,'cancel','Fixture cancelled');
 await check(async()=>assert.equal((await stock())[1].reserved_units,beforeCancel[1].reserved_units-1));
 await check(()=>assert.rejects(advance(b,'cancel','Duplicate cancellation'),/next allowed delivery step/));
 const auto=await order(1,true);await as(PACKER);await check(async()=>assert.equal(await take(),auto.note));
 await check(async()=>{assert.equal((await note(auto.note)).packing_auto_reserved,true);
  assert.equal((await db.query('select count(*)::int n from work_assignments where record_id=$1',[auto.note])).rows[0].n,1,'Automatic picking creates just one assignment');});
 await check(async()=>{for(const fn of functions)assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[fn])).rows[0].allowed,false);});
 await check(async()=>{for(const fn of ['start_reserved_sales_delivery_packing(uuid,integer)','start_sales_delivery_packing(uuid,integer,jsonb)','packing_take_next()']){
  const definition=(await admin('select pg_get_functiondef($1::regprocedure) body',[fn])).rows[0].body;
  assert.ok(definition.indexOf('pg_advisory_xact_lock')<definition.indexOf('for update'),'Packer lock always precedes note locks');
 }});
 const malformed=await order(1,true);await admin("update sales_delivery_notes set status='packing',packer_user_id=$2 where id=$1",[malformed.note,OTHER]);await as(OTHER);
 await check(()=>assert.rejects(packed(malformed),/Select stock/));
 await admin("update sales_delivery_notes set status='ready' where id=$1",[malformed.note]);
 await check(()=>assert.rejects(advance(malformed,'dispatch'),/Select stock/));

 // 103/104 use the real invoice creation, reversal, journal and accounting access rules.
 await adminExec(`alter table sales_proformas add column deleted_at timestamptz;
  insert into accounting_memberships(user_id,active,approved_by,approval_reference) values('${OWNER}',true,'${OWNER}','Fixture accounting access');`);
 await adminExec(mig('202610160087_accounting_ledger.sql'));
 await adminExec(mig('202610160093_accounting_integrity.sql'));
 await adminExec(mig('202610180103_erp_invoice_delivery_link.sql'));await adminExec(mig('202610180103_erp_invoice_delivery_link.sql'));
 await check(async()=>assert.deepEqual(await metadata(),before,'ERP linkage preserves existing RPC identity and grants'));
 const invoice=async d=>{
  await admin('update sales_proformas set subtotal_minor=t.amount,total_minor=t.amount from (select sum(quantity*unit_price_minor) amount from sales_proforma_lines where proforma_id=$1) t where id=$1',[d.pf]);
  return (await db.query("select * from create_invoice_from_proforma($1,$2,current_date,current_date,'')",[id(next++),d.pf])).rows[0];
 };
 const voidInvoice=i=>db.query("select * from void_invoice($1,current_date,'Fixture invoice correction')",[i.id]);
 const linked=await order(1),beforeLink=await state(linked);
 const reserveLinked=reference=>db.query('select * from create_tax_invoice_and_reserve_stock($1,$2,$3)',[linked.note,beforeLink.note.version,reference]);
 await check(()=>assert.rejects(reserveLinked(''),/active ERP invoice/));
 await admin('update sales_proformas set revision=2 where id=$1',[linked.pf]);const wrongRevision=await invoice(linked);
 await admin('update sales_proformas set revision=1 where id=$1',[linked.pf]);
 await check(()=>assert.rejects(reserveLinked(null),/active ERP invoice/));
 await voidInvoice(wrongRevision);
 await check(()=>assert.rejects(reserveLinked(wrongRevision.invoice_number),/active ERP invoice/));
 const linkedInvoice=await invoice(linked);
 await check(()=>assert.rejects(reserveLinked('INV-OTHER-ORDER'),/does not match/));
 await check(async()=>assert.deepEqual(await state(linked),beforeLink,'Missing, void, wrong revision and wrong reference never reserve stock'));
 await as(OUTSIDER);await check(async()=>assert.equal((await db.query('select invoice_number from acc_invoices')).rows.length,0));await as(OWNER);
 await check(async()=>assert.equal((await reserveLinked(' ')).rows[0].tax_invoice_reference,linkedInvoice.invoice_number,'Blank reference derives the ERP invoice inside the authorized RPC'));
 await check(()=>assert.rejects(advance(shortage,'tax_invoice','Fabricated invoice'),/Link the active ERP invoice/));

 // Reproduce an already-voided reservation using the old public RPC before installing the guard.
 const historical=await order(1),historicalInvoice=await invoice(historical);
 await db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[historical.note,(await note(historical.note)).version,'']);
 await voidInvoice(historicalInvoice);await advance(historical,'send_to_sales');await start(historical);
 await serials(historical,['SERIAL-HISTORICAL']);await packed(historical);
 const protectedFunctions=[...functions,'void_invoice(uuid,date,text)'];
 const protectedMetadata=()=>admin('select oid,proacl,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[protectedFunctions]).then(r=>r.rows);
 const before104=await protectedMetadata();await adminExec(mig('202610180104_active_invoice_dispatch.sql'));await adminExec(mig('202610180104_active_invoice_dispatch.sql'));
 await check(async()=>assert.deepEqual(await protectedMetadata(),before104,'Dispatch and void patches preserve existing function metadata on rerun'));
 const historicalState=await state(historical);
 await check(()=>assert.rejects(advance(historical,'dispatch'),/active linked ERP invoice/));
 await check(async()=>assert.deepEqual(await state(historical),historicalState,'An already-voided invoice cannot dispatch or mutate stock'));
 await advance(historical,'cancel');
 const blockedVoid=async()=>{
  const beforeState=await state(linked),beforeInvoice=(await db.query('select * from acc_invoices where id=$1',[linkedInvoice.id])).rows;
  const journals=(await db.query('select count(*)::int n from acc_journal_entries')).rows;
  await assert.rejects(voidInvoice(linkedInvoice),/active or completed delivery/);
  assert.deepEqual(await state(linked),beforeState);
  assert.deepEqual((await db.query('select * from acc_invoices where id=$1',[linkedInvoice.id])).rows,beforeInvoice);
  assert.deepEqual((await db.query('select count(*)::int n from acc_journal_entries')).rows,journals);
 };
 await check(blockedVoid);await advance(linked,'send_to_sales');await check(blockedVoid);
 await start(linked);await check(blockedVoid);await serials(linked,['SERIAL-LINKED']);await packed(linked);await check(blockedVoid);
 const readyState=await state(linked);
 await admin("update sales_delivery_notes set tax_invoice_reference='UNKNOWN-INVOICE' where id=$1",[linked.note]);
 const missingLink=await state(linked);await check(()=>assert.rejects(advance(linked,'dispatch'),/active linked ERP invoice/));
 await check(async()=>assert.deepEqual(await state(linked),missingLink,'An absent invoice link cannot mutate stock or history'));
 await admin('update sales_delivery_notes set tax_invoice_reference=$2 where id=$1',[linked.note,linkedInvoice.invoice_number]);
 await admin('update sales_proformas set revision=2 where id=$1',[linked.pf]);
 await check(()=>assert.rejects(advance(linked,'dispatch'),/active linked ERP invoice/));
 await check(async()=>assert.deepEqual(await state(linked),readyState,'A stale invoice revision cannot dispatch'));
 await admin('update sales_proformas set revision=1 where id=$1',[linked.pf]);
 await as(OUTSIDER);await check(()=>assert.rejects(voidInvoice(linkedInvoice),/Accounting access/));await as(OWNER);
 await db.exec('begin');
 try{
  await advance(linked,'cancel');await check(async()=>assert.ok((await voidInvoice(linkedInvoice)).rows[0].voided_at,'Pre-dispatch cancellation permits a real invoice reversal'));
 }finally{await db.exec('rollback');}
 await advance(linked,'dispatch');await check(blockedVoid);await proof(linked);await advance(linked,'deliver');await check(blockedVoid);

 // 106: receipt inspection already treats dates before current_date as expired.
 const expiryMetadata=()=>admin('select oid,proacl,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[[...protectedFunctions,'packing_pick_lots(public.sales_delivery_notes)']]).then(r=>r.rows);
 const before106=await expiryMetadata();await adminExec(mig('202610180106_order_stock_expiry.sql'));await adminExec(mig('202610180106_order_stock_expiry.sql'));
 await check(async()=>assert.deepEqual(await expiryMetadata(),before106,'Expiry patches preserve function metadata on rerun'));
 const EXPIRED=id(next++),TODAY=id(next++),UNDATED=id(next++);
 await admin('update inventory_lots set expiry_date=current_date-1 where id=any($1::uuid[])',[[EARLY,LATE]]);
 await admin(`insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,loose_units) values
  ($1,$4,$5,$6,'EXPIRED',current_date-1,10),($2,$4,$5,$6,'TODAY',current_date,2),($3,$4,$5,$6,'UNDATED',null,2)`,[EXPIRED,TODAY,UNDATED,PRODUCT,HUB,PACK]);
 const boundary=await order(3);await invoice(boundary);
 await db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[boundary.note,(await note(boundary.note)).version,'']);
 await check(async()=>assert.deepEqual((await db.query('select lot_id,quantity from sales_delivery_lines where delivery_note_id=$1 order by lot_id',[boundary.note])).rows,
  [{lot_id:TODAY,quantity:2},{lot_id:UNDATED,quantity:1}],'Reservation skips yesterday, accepts today and NULL, and keeps FEFO'));
 const queueBoundary=await order(1,true),beforeQueueStock=await stock();
 await check(async()=>assert.equal(await take(),queueBoundary.note));
 await check(async()=>{assert.equal((await db.query('select lot_id from sales_delivery_lines where delivery_note_id=$1',[queueBoundary.note])).rows[0].lot_id,UNDATED);
  assert.deepEqual((await stock()).filter(l=>[EARLY,LATE,EXPIRED].includes(l.id)),beforeQueueStock.filter(l=>[EARLY,LATE,EXPIRED].includes(l.id)),'Queue automatic picking never reserves expired lots');});
 await release(queueBoundary);await advance(queueBoundary,'cancel');
 const expiredShortage=await order(10);await invoice(expiredShortage);const beforeExpiredShortage=await state(expiredShortage);
 await check(()=>assert.rejects(db.query('select create_tax_invoice_and_reserve_stock($1,$2,$3)',[expiredShortage.note,(beforeExpiredShortage.note).version,'']),/Not enough available stock/));
 await check(async()=>assert.deepEqual(await state(expiredShortage),beforeExpiredShortage,'Expired stock cannot satisfy a shortage and partial reservations roll back'));
 const manualExpired=await order(1,true),beforeManualExpired=await state(manualExpired);
 await check(()=>assert.rejects(pick(manualExpired,1),/lot has expired/));
 await check(async()=>assert.deepEqual(await state(manualExpired),beforeManualExpired,'Explicit legacy lot selection rejects expiry under its stock lock'));
 await advance(manualExpired,'cancel');
 await advance(boundary,'send_to_sales');
 await admin('update inventory_lots set expiry_date=current_date-1 where id=$1',[TODAY]);
 const expiredReserved=await state(boundary);
 await check(()=>assert.rejects(start(boundary),/Reserved Haadi stock/));
 await check(async()=>assert.deepEqual(await state(boundary),expiredReserved,'Expiry between reservation and packing leaves manual claim and stock unchanged'));
 await check(async()=>{assert.equal(await take(),null);const n=await note(boundary.note);assert.equal(n.status,'sent_to_sales');assert.equal(n.version,expiredReserved.note.version);
  assert.equal(n.packer_user_id,null);assert.match(n.packing_blocked_reason,/Reserved Haadi stock/);assert.deepEqual(await stock(),expiredReserved.stock);});
 await admin('update inventory_lots set expiry_date=current_date where id=$1',[TODAY]);await start(boundary);
 await admin('update inventory_lots set expiry_date=current_date-1 where id=$1',[TODAY]);const expiredPacking=await state(boundary);
 await check(()=>assert.rejects(packed(boundary),/Reserved Haadi stock/));await check(async()=>assert.deepEqual(await state(boundary),expiredPacking));
 await admin('update inventory_lots set expiry_date=current_date where id=$1',[TODAY]);
 await serials(boundary,['SERIAL-TODAY-1','SERIAL-TODAY-2','SERIAL-UNDATED']);await packed(boundary);
 await admin('update inventory_lots set expiry_date=current_date-1 where id=$1',[TODAY]);const expiredReady=await state(boundary);
 const issuesBeforeExpiry=(await db.query('select count(*)::int n from inventory_issues')).rows[0].n;
 await check(()=>assert.rejects(advance(boundary,'dispatch'),/Reserved Haadi stock/));
 await check(async()=>{assert.deepEqual(await state(boundary),expiredReady);assert.equal((await db.query('select count(*)::int n from inventory_issues')).rows[0].n,issuesBeforeExpiry,'Expiry after ready never issues stock');});
 await admin('update inventory_lots set expiry_date=current_date where id=$1',[TODAY]);
 await advance(boundary,'dispatch');await check(async()=>assert.equal((await note(boundary.note)).status,'out_for_delivery','Today and undated stock still dispatch normally'));
 console.log(`PASS: ${checks} packing/shipping database checks. Reservation/claim permissions, packing ownership, serials, partial balance, ERP invoice/void guards, expiry, dispatch and proof. PGlite is single-session; overlapping PostgreSQL locks are not simulated.`);
}finally{await db.close();}
