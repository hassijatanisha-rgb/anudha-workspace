// Disposable PostgreSQL fixture: real inventory, delivery, return and receiving-serial functions. No live database.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const DESK=id(1),STORES=id(2),ENGINEER=id(3),OUTSIDER=id(4),OWNER=id(5);
const ORG=id(10),CONTACT=id(11),MACHINE=id(12),REAGENT=id(13),PACK_M=id(14),PACK_R=id(15),HUB=id(16),LOT_M=id(17),LOT_R=id(18),PF=id(19),PFL_M=id(20),PFL_R=id(21);
const mig=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table products(id uuid primary key,name text,deleted_at timestamptz);
 create table organizations(id uuid primary key,name text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 create table document_attachments(id uuid primary key default gen_random_uuid(),record_type text,record_id uuid,uploaded_at timestamptz);
 insert into auth.users(id) values('${DESK}'),('${STORES}'),('${ENGINEER}'),('${OUTSIDER}'),('${OWNER}');
 insert into staff values('${DESK}',true,'staff','sales','{deliveries}'),('${STORES}',true,'head','stores','{stock}'),('${ENGINEER}',true,'staff','service','{service}'),
  ('${OUTSIDER}',true,'staff','marketing','{leads}'),('${OWNER}',true,'owner','management','{}');
 insert into products values('${MACHINE}','Fixture analyzer',null),('${REAGENT}','Fixture reagent',null);
 insert into organizations values('${ORG}','Fixture Hospital',null);insert into contacts values('${CONTACT}','${ORG}',null,'valid');`);
 for(const n of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609210004_proforma_delivery_workflow.sql','202609210005_sales_office_workflow.sql','202609230015_accounting_membership.sql','202609230019_accounting_drafts.sql'])await db.exec(mig(n));
 await db.exec(`create or replace function public.mfa_satisfied() returns boolean language sql stable as $$select true$$;
 create or replace function public.inventory_active_staff() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true)$$;
 create or replace function public.inventory_owner() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true and role='owner')$$;
 create or replace function public.is_department_head() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=(select auth.uid()) and active and role='head')$$;
 create or replace function public.has_access(p_area text) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff s where s.user_id=(select auth.uid()) and s.active and (s.role='owner' or p_area=any(s.access)))$$;
 create or replace function public.require_access(p_area text) returns void language plpgsql stable security definer set search_path to 'public','pg_temp' as $$begin if not public.has_access(p_area) then raise exception 'You do not have access to %.',p_area; end if; end $$;
 create or replace function public.packing_supervisor() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select public.inventory_active_staff() and exists(select 1 from public.staff where user_id=auth.uid() and active and (role='owner' or (role='head' and department='stores')))$$;
 create or replace function public.accounting_access() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select false$$;
 insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${HUB}','Fixture Haadi','FH','dispatch_hub',true,'${OWNER}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('${PACK_M}','${MACHINE}',1,'unit',1,'Fixture pack','${OWNER}'),('${PACK_R}','${REAGENT}',1,'kit',10,'Fixture pack','${OWNER}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units,reserved_units) values('${LOT_M}','${MACHINE}','${HUB}','${PACK_M}','M-1',10,10),('${LOT_R}','${REAGENT}','${HUB}','${PACK_R}','R-1',50,50);
 insert into sales_proformas(id,document_number,organization_id,contact_id,currency,valid_until,delivery_period,payment_terms,prepared_by) values('${PF}','PF-S-1','${ORG}','${CONTACT}','TZS',current_date+30,'7 days','On delivery','${DESK}');
 insert into sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor) values('${PFL_M}','${PF}','${MACHINE}',1,'Analyzer',10,'unit',100),('${PFL_R}','${PF}','${REAGENT}',2,'Reagent',50,'kit',10);`);
 await db.exec(mig('202610150081_delivery_proof_required.sql'));await db.exec(mig('202610150082_customer_returns.sql'));
 await db.exec(mig('202610150084_serial_numbers.sql'));await db.exec(mig('202610200120_machine_serial_requirement.sql'));
 const as=actor=>db.exec(`set test.actor='${actor}'`);
 const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const stock=()=>row('select * from inventory_lots where id=$1',[LOT_M]);
 await as(OWNER);
 await db.query('select set_product_serial_required($1,true)',[MACHINE]);
 const WAREHOUSE=id(60),TRANSFER=id(61);
 await db.exec(`insert into inventory_locations(id,name,code,created_by) values('${WAREHOUSE}','Fixture warehouse','FW','${OWNER}');
 update inventory_lots set sealed_cartons=2,loose_units=8,reserved_units=0 where id='${LOT_M}';`);
 await db.query('select request_inventory_transfer($1,$2,$3,1,current_date,$4)',[TRANSFER,LOT_M,WAREHOUSE,'Fixture legacy move']);
 await db.query('select dispatch_inventory_transfer($1,1,1,$2)',[TRANSFER,'Fixture transfer dispatch']);
 await db.exec(mig('202610070073_receive_transfer_available_lot.sql'));
 const HIST_NOTE=id(90),HIST_LINE=id(91);
 await db.exec(`insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,status,accounts_reference,expected_delivery_date,created_by,dispatched_by,dispatched_at,delivered_by,delivered_at,recipient_name,proof_reference)
 values('${HIST_NOTE}','DN-HIST','${PF}','${ORG}','${CONTACT}','delivered','ACC-HIST',current_date,'${OWNER}','${OWNER}',now(),'${OWNER}',now(),'Fixture old recipient','Fixture proof');
 insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values('${HIST_LINE}','${HIST_NOTE}','${PFL_M}','${MACHINE}','${LOT_M}',1);
 insert into delivery_line_serials(delivery_line_id,delivery_note_id,product_id,serial_number,recorded_by) values('${HIST_LINE}','${HIST_NOTE}','${MACHINE}','HISTORY-1','${OWNER}');`);
 await db.exec(mig('202610200121_receiving_machine_serials.sql'));
 await ok(async()=>{assert.equal(Number((await row('select initial_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).initial_units),10);assert.equal((await stock()).loose_units,8);assert.equal((await stock()).sealed_cartons,1);});
 let n=100;
 const delivery=async(quantity=1,lot=LOT_M)=>{
  const note=id(n++),line=id(n++);
  await db.query(`insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,status,accounts_reference,expected_delivery_date,created_by)
   values($1,$2,'${PF}','${ORG}','${CONTACT}','packing','ACC-FIXTURE',current_date,'${DESK}')`,[note,'DN-'+n]);
  await db.query('insert into sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity) values($1,$2,$3,$4,$5,$6)',[line,note,PFL_M,MACHINE,lot,quantity]);
  return {note,line,lot,quantity};
 };
 const record=async(d,serials,legacyConfirmed=false)=>db.query('select * from record_delivery_serials($1,$2,$3)',[d.note,(await row('select version from sales_delivery_notes where id=$1',[d.note])).version,JSON.stringify([{deliveryLineId:d.line,serials,legacyConfirmed}])]);
 const receive=async(serials,{lot=LOT_M,newLot=false,batch='M-1'}={})=>{
  const old=newLot?{version:0,sealed_cartons:0,loose_units:0}:await row('select * from inventory_lots where id=$1',[lot]);
  return db.query('select * from receive_serialized_inventory($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10)',[lot,old.version,MACHINE,HUB,PACK_M,batch,old.sealed_cartons,old.loose_units+serials.length,'Verified fixture receipt',serials]);
 };
 await ok(()=>assert.rejects(receive(['NEW-1','new-1']),/unique/));
 await ok(async()=>{const before=(await stock()).loose_units;await as(DESK);await assert.rejects(receive(['NEW-1']),/Owner access/);assert.equal((await stock()).loose_units,before);await as(OWNER);});
 await ok(async()=>{await receive(['NEW-1','NEW-2']);assert.equal((await stock()).loose_units,10);assert.equal(Number((await row('select initial_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).initial_units),10);});
 await ok(async()=>{const before=(await stock()).loose_units;await assert.rejects(receive(['new-1']),/already identifies/);assert.equal((await stock()).loose_units,before);});
 await ok(async()=>{const old=await stock();await assert.rejects(db.query('select set_inventory_opening_balance($1,$2,$3,$4,$5,$6,null,$7,$8,$9)',[LOT_M,old.version,REAGENT,HUB,PACK_M,'M-1',old.sealed_cartons,old.loose_units+1,'Attempt count bypass']),/Receive serial-tracked stock/);await assert.rejects(db.query('select set_inventory_opening_balance($1,$2,$3,$4,$5,$6,null,$7,$8,$9)',[LOT_M,old.version,MACHINE,HUB,PACK_M,'M-1',old.sealed_cartons,old.loose_units-1,'Attempt count decrease']),/reviewed serial adjustment/);});
 await ok(async()=>{await as(OWNER);const old=await stock();await assert.rejects(db.query('select issue_consumer_units($1,$2,$3,$4,1,current_date,$5,$6)',[id(n++),LOT_M,old.version,ORG,'Fixture direct','Fixture direct issue']),/through a delivery/);assert.equal((await stock()).loose_units,old.loose_units);});
 const NEWLOT=id(70);await receive(['NEW-3'],{lot:NEWLOT,newLot:true,batch:'New receipt only'});
 const newDelivery=await delivery(1,NEWLOT);
 await ok(()=>assert.rejects(record(newDelivery,['NO-RECEIPT'],true),/Only verified pre-rollout stock/));
 await ok(async()=>{await record(newDelivery,['new-3']);const linked=await row('select inventory_serial_id from delivery_line_serials where delivery_line_id=$1',[newDelivery.line]);assert.ok(linked.inventory_serial_id);});
 const first=await delivery(2);
 await ok(()=>assert.rejects(record(first,['OLD-1','OLD-2']),/explicit legacy-stock confirmation/));
 await ok(async()=>{await record(first,['OLD-1','OLD-2'],true);assert.equal(Number((await row('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).captured_units),2);await record(first,['OLD-1','OLD-2'],true);assert.equal(Number((await row('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).captured_units),2);});
 const duplicate=await delivery();
 await ok(()=>assert.rejects(record(duplicate,['old-1'],true),/already on another delivery/));
 await ok(async()=>{await db.query('select receive_serialized_inventory_transfer($1,2,1,$2,$3,$4,true)',[TRANSFER,'pass','Fixture arrival',['OLD-TRANSFER']]);const moved=await row('select id from inventory_lots where location_id=$1',[WAREHOUSE]);const d=await delivery(1,moved.id);await record(d,['OLD-TRANSFER'],true);assert.equal(Number((await row('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).captured_units),3);});
 // Use actual dispatch and recorded return/resolution functions for a received serial.
 const outgoing=await delivery();await record(outgoing,['NEW-1']);
 await db.query('update inventory_lots set reserved_units=1 where id=$1',[LOT_M]);
 await db.query("update sales_delivery_notes set status='ready' where id=$1",[outgoing.note]);
 await db.query("select advance_sales_delivery($1,$2,'dispatch','Fixture truck','Fixture route','','')",[outgoing.note,(await row('select version from sales_delivery_notes where id=$1',[outgoing.note])).version]);
 await db.query("update sales_delivery_notes set status='delivered',delivered_by=$2,delivered_at=now(),recipient_name='Fixture customer',proof_reference='Fixture signed proof' where id=$1",[outgoing.note,OWNER]);
 const returning=await delivery();await ok(()=>assert.rejects(record(returning,['new-1'],true),/already on another delivery/));
 const RET=id(800);
 await db.query('select record_sales_return($1,$2,$3,$4,null,$5)',[RET,outgoing.note,'unopened','Fixture returned unit',JSON.stringify([{deliveryLineId:outgoing.line,quantity:1}])]);
 const returnLine=await row('select * from sales_return_lines where return_id=$1',[RET]);
 await db.query('select mark_serials_returned($1,$2)',[returnLine.id,['NEW-1']]);
 await ok(()=>assert.rejects(record(returning,['NEW-1']),/not been inspected and released/));
 await db.query("select resolve_sales_return_line($1,1,'restock','Fixture seals and condition checked',true)",[returnLine.id]);
 await ok(async()=>{const allowance=await row('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE]);await record(returning,['NEW-1']);assert.equal((await row("select count(*)::int n from inventory_serial_receipts where product_id=$1 and upper(serial_number)='NEW-1'",[MACHINE])).n,1);assert.equal(Number((await row('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).captured_units),Number(allowance.captured_units));});
 await ok(()=>assert.rejects(receive(['NEW-1']),/recorded return workflow/));
 // Exact unit location: receiving at a different lot never authorizes delivery from this one.
 const SERIAL_SOURCE=id(1000),SERIAL_MOVE=id(1001),PARTIAL_MOVE=id(1002),DAMAGED_SOURCE=id(1003),DAMAGED_MOVE=id(1004);
 const receiveAt=async(lot,where,serials,cartons,batch)=>db.query('select receive_serialized_inventory($1,0,$2,$3,$4,$5,null,$6,0,$7,$8)',[lot,MACHINE,where,PACK_M,batch,cartons,'Fixture real serial receiving',serials]);
 const requestMove=(move,source,to,cartons)=>db.query('select request_inventory_transfer($1,$2,$3,$4,current_date,$5)',[move,source,to,cartons,'Fixture exact unit transfer']);
 const dispatchMove=async(move,serials,legacy=false)=>{const t=await row('select * from inventory_transfers where id=$1',[move]),lot=await row('select version from inventory_lots where id=$1',[t.source_lot_id]);return db.query('select dispatch_serialized_inventory_transfer($1,$2,$3,$4,$5,$6)',[move,t.version,lot.version,'Fixture exact serial dispatch',serials,legacy]);};
 const receiveMove=async(move,actual,serials,inspection='pass')=>{const t=await row('select version from inventory_transfers where id=$1',[move]);return db.query('select receive_serialized_inventory_transfer($1,$2,$3,$4,$5,$6,false)',[move,t.version,actual,inspection,'Fixture exact arrived serials',serials]);};
 const availableSerialLot=async serial=>(await row('select inventory_serial_available_lot(id) as lot from inventory_serial_receipts where product_id=$1 and serial_number=$2',[MACHINE,serial])).lot;
 await receiveAt(SERIAL_SOURCE,WAREHOUSE,['MOVE-A','MOVE-B'],2,'Exact moving identities');
 const wrongLot=await delivery();
 await ok(()=>assert.rejects(record(wrongLot,['MOVE-A']),/not available in the selected stock lot/));
 await requestMove(SERIAL_MOVE,SERIAL_SOURCE,HUB,1);
 await ok(()=>assert.rejects(db.query('select dispatch_inventory_transfer($1,1,1,$2)',[SERIAL_MOVE,'Attempt unidentified dispatch']),/exact serials/));
 await dispatchMove(SERIAL_MOVE,['MOVE-A']);
 await ok(async()=>{assert.equal(await availableSerialLot('MOVE-A'),null);await assert.rejects(record(wrongLot,['MOVE-A']),/not available in the selected stock lot/);await assert.rejects(receiveMove(SERIAL_MOVE,1,['MOVE-B']),/not selected/);await assert.rejects(receiveMove(SERIAL_MOVE,1,['MOVE-A'],null),/passed inspection/);});
 await receiveMove(SERIAL_MOVE,1,['MOVE-A']);
 const arrived=await row("select lot_id from inventory_movements where transfer_id=$1 and movement_type='transfer_receipt'",[SERIAL_MOVE]);
 await ok(async()=>{assert.equal(await availableSerialLot('MOVE-A'),arrived.lot_id);assert.equal(await availableSerialLot('MOVE-B'),SERIAL_SOURCE);await assert.rejects(record(wrongLot,['MOVE-A']),/not available in the selected stock lot/);});
 await db.query('select open_inventory_cartons($1,1,1,$2)',[arrived.lot_id,'Fixture open arrived machine']);
 const movedDelivery=await delivery(1,arrived.lot_id);await record(movedDelivery,['MOVE-A']);
 await ok(async()=>{assert.equal((await row('select version from sales_delivery_notes where id=$1',[movedDelivery.note])).version,2);await assert.rejects(db.query('select record_delivery_serials($1,1,$2)',[movedDelivery.note,JSON.stringify([{deliveryLineId:movedDelivery.line,serials:['MOVE-A']}])]),/Delivery changed/);});
 // A reservation blocks transfer selection; cancellation releases it without losing the unit's actual lot.
 await receive(['MOVE-SPARE'],{lot:arrived.lot_id,batch:'Exact moving identities'});
 const currentArrived=await row('select * from inventory_lots where id=$1',[arrived.lot_id]);
 await db.query('select set_inventory_opening_balance($1,$2,$3,$4,$5,$6,null,1,1,$7)',[arrived.lot_id,currentArrived.version,MACHINE,HUB,PACK_M,'Exact moving identities','Fixture one sealed and one loose']);
 const BLOCKED_MOVE=id(1005);await requestMove(BLOCKED_MOVE,arrived.lot_id,WAREHOUSE,1);
 await ok(()=>assert.rejects(dispatchMove(BLOCKED_MOVE,['MOVE-A']),/assigned to a delivery/));
 await db.query('update inventory_lots set reserved_units=1 where id=$1',[arrived.lot_id]);
 await db.query("select advance_sales_delivery($1,$2,'cancel','','','','Fixture customer cancelled')",[movedDelivery.note,(await row('select version from sales_delivery_notes where id=$1',[movedDelivery.note])).version]);
 await ok(async()=>{await dispatchMove(BLOCKED_MOVE,['MOVE-A']);assert.equal(await availableSerialLot('MOVE-A'),null);});
 await receiveMove(BLOCKED_MOVE,1,['MOVE-A']);
 assert.equal(await availableSerialLot('MOVE-A'),SERIAL_SOURCE);
 // Two chosen units, only one physically arrives: neither may be sold from the quarantined receipt.
 await requestMove(PARTIAL_MOVE,SERIAL_SOURCE,HUB,2);await dispatchMove(PARTIAL_MOVE,['MOVE-A','MOVE-B']);
 await ok(()=>assert.rejects(receiveMove(PARTIAL_MOVE,1,['MOVE-A','MOVE-B']),/exactly 1 arrived/));
 await receiveMove(PARTIAL_MOVE,1,['MOVE-A']);
 await ok(async()=>{assert.equal((await row('select status from inventory_transfers where id=$1',[PARTIAL_MOVE])).status,'quarantine');assert.equal(await availableSerialLot('MOVE-A'),null);assert.equal(await availableSerialLot('MOVE-B'),null);const counts=await row('select count(*) filter(where arrived_at is not null)::int arrived,count(*) filter(where arrived_at is null)::int missing from inventory_transfer_serials where transfer_id=$1',[PARTIAL_MOVE]);assert.deepEqual(counts,{arrived:1,missing:1});await assert.rejects(record(wrongLot,['MOVE-A']),/not available in the selected stock lot/);await assert.rejects(record(wrongLot,['MOVE-B']),/not available in the selected stock lot/);});
 await receiveAt(DAMAGED_SOURCE,HUB,['QUARANTINED-ONLY'],1,'Quarantine-only serial source');await requestMove(DAMAGED_MOVE,DAMAGED_SOURCE,WAREHOUSE,1);await dispatchMove(DAMAGED_MOVE,['QUARANTINED-ONLY']);await receiveMove(DAMAGED_MOVE,1,['QUARANTINED-ONLY'],'damaged');
 await ok(async()=>{await assert.rejects(record(wrongLot,['QUARANTINED-ONLY']),/not available in the selected stock lot/);assert.equal(await availableSerialLot('QUARANTINED-ONLY'),null);
  const receipt=await row("select id from inventory_serial_receipts where serial_number='QUARANTINED-ONLY'");
  await db.query('insert into delivery_line_serials(delivery_line_id,delivery_note_id,product_id,serial_number,recorded_by,inventory_serial_id) values($1,$2,$3,$4,$5,$6)',[wrongLot.line,wrongLot.note,MACHINE,'QUARANTINED-ONLY',OWNER,receipt.id]);
  await assert.rejects(db.query("update sales_delivery_notes set status='ready' where id=$1",[wrongLot.note]),/real serial number/);
  await db.query('delete from delivery_line_serials where delivery_note_id=$1',[wrongLot.note]);
 });

 // A transferred machine comes back to the actual delivery location, not its original receiving warehouse.
 const RETURN_SOURCE=id(1010),RETURN_MOVE=id(1011),MOVED_RETURN=id(1012);
 await receiveAt(RETURN_SOURCE,WAREHOUSE,['RETURN-MOVED'],1,'Return after serial transfer');await requestMove(RETURN_MOVE,RETURN_SOURCE,HUB,1);await dispatchMove(RETURN_MOVE,['RETURN-MOVED']);await receiveMove(RETURN_MOVE,1,['RETURN-MOVED']);
 const returnDestination=await row("select lot_id from inventory_movements where transfer_id=$1 and movement_type='transfer_receipt'",[RETURN_MOVE]);
 await db.query('select open_inventory_cartons($1,1,1,$2)',[returnDestination.lot_id,'Fixture unpack moved return unit']);
 const shippedMoved=await delivery(1,returnDestination.lot_id);await record(shippedMoved,['RETURN-MOVED']);await db.query('update inventory_lots set reserved_units=1 where id=$1',[returnDestination.lot_id]);
 await db.query("update sales_delivery_notes set status='ready' where id=$1",[shippedMoved.note]);await db.query("select advance_sales_delivery($1,$2,'dispatch','Fixture truck','Fixture moved delivery','','')",[shippedMoved.note,(await row('select version from sales_delivery_notes where id=$1',[shippedMoved.note])).version]);
 await db.query("update sales_delivery_notes set status='delivered',delivered_by=$2,delivered_at=now(),recipient_name='Fixture customer',proof_reference='Fixture proof' where id=$1",[shippedMoved.note,OWNER]);
 await db.query('select record_sales_return($1,$2,$3,$4,null,$5)',[MOVED_RETURN,shippedMoved.note,'unopened','Fixture moved machine return',JSON.stringify([{deliveryLineId:shippedMoved.line,quantity:1}])]);
 const movedReturnLine=await row('select id from sales_return_lines where return_id=$1',[MOVED_RETURN]);await db.query('select mark_serials_returned($1,$2)',[movedReturnLine.id,['RETURN-MOVED']]);await db.query("select resolve_sales_return_line($1,1,'restock','Fixture moved machine inspected',true)",[movedReturnLine.id]);
 await ok(async()=>{assert.equal(await availableSerialLot('RETURN-MOVED'),returnDestination.lot_id);const wrongWarehouse=await delivery(1,RETURN_SOURCE);await assert.rejects(record(wrongWarehouse,['RETURN-MOVED']),/not available in the selected stock lot/);const rightReturn=await delivery(1,returnDestination.lot_id);await record(rightReturn,['RETURN-MOVED']);});

 await ok(async()=>{
  const missingSource=id(1020),missingMove=id(1021);await receiveAt(missingSource,HUB,['MISSING-ALL'],1,'No transferred units arrived');await requestMove(missingMove,missingSource,WAREHOUSE,1);await dispatchMove(missingMove,['MISSING-ALL']);
  const before=Number((await row('select sum(loose_units+sealed_cartons)::bigint n from inventory_lots')).n);await receiveMove(missingMove,0,[]);
  assert.equal((await row('select actual_units from inventory_transfers where id=$1',[missingMove])).actual_units,0);assert.equal(await availableSerialLot('MISSING-ALL'),null);assert.equal(Number((await row('select sum(loose_units+sealed_cartons)::bigint n from inventory_lots')).n),before);
 });
 const remaining=await delivery(7);await record(remaining,Array.from({length:7},(_,i)=>'LEGACY-LAST-'+i),true);
 await ok(()=>assert.rejects(record(duplicate,['EXTRA-LEGACY'],true),/No unidentified pre-rollout units remain/));
 await ok(async()=>{
  await db.query('select record_sales_return($1,$2,$3,$4,null,$5)',[id(801),HIST_NOTE,'unopened','Fixture pre-rollout delivery returned',JSON.stringify([{deliveryLineId:HIST_LINE,quantity:1}])]);
  const historicalReturn=await row('select * from sales_return_lines where return_id=$1',[id(801)]);
  await db.query('select mark_serials_returned($1,$2)',[historicalReturn.id,['HISTORY-1']]);
  await db.query("select resolve_sales_return_line($1,1,'restock','Fixture historical unit inspected',true)",[historicalReturn.id]);
  const historicalAgain=await delivery();await record(historicalAgain,['HISTORY-1']);
  assert.equal((await row("select source from inventory_serial_receipts where serial_number='HISTORY-1'")).source,'legacy_return');
  assert.equal(Number((await row('select captured_units from inventory_legacy_serial_allowances where product_id=$1',[MACHINE])).captured_units),10);
 });
 await ok(async()=>{const receipt=await row('select * from inventory_serial_receipts limit 1');await assert.rejects(db.query("update inventory_serial_receipts set serial_number='changed' where id=$1",[receipt.id]),/immutable/);const acl=await row("select has_function_privilege('authenticated','set_inventory_opening_balance_internal(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text)','execute') internal,has_function_privilege('anon','receive_serialized_inventory(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text,text[])','execute') anon,has_table_privilege('authenticated','inventory_serial_receipts','insert') direct,has_function_privilege('authenticated','inventory_serial_available_lot(uuid)','execute') resolver,has_function_privilege('authenticated','dispatch_inventory_transfer_internal(uuid,integer,integer,text)','execute') dispatch_internal,has_function_privilege('authenticated','receive_inventory_transfer_internal(uuid,integer,integer,text,text)','execute') receive_internal,has_table_privilege('authenticated','inventory_transfer_serials','insert') transfer_write");assert.deepEqual(acl,{internal:false,anon:false,direct:false,resolver:false,dispatch_internal:false,receive_internal:false,transfer_write:false});});
 console.log(`PASS: ${checks} receiving serial checks; atomic receipt/count/access rules, bounded audited legacy identity, exact lot custody through explicitly selected dispatch and arrived subsets, quarantine/missing-unit rejection, cancellation/reservation/stale-version guards, and inspected return/redelivery at the actual lot. Single-session PGlite; no concurrency claim.`);
}finally{await db.close();}
