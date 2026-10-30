// Disposable PostgreSQL fixture. Actual board/items/access functions; overdue alert delivery is stubbed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const loadFunction=async(file,name)=>{const definition=migration(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));assert.ok(definition,name);await db.exec(definition[0]);};
const OWNER=id(1),PACKER=id(2),OTHER=id(3),INACTIVE=id(4),ORG=id(10),PF=id(11),PRODUCT=id(12),LINE=id(13),LOT=id(14);
let checks=0;const check=async fn=>{await fn();checks++;};
const as=async actor=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor||'']);await db.exec('set role authenticated');};
const admin=async(sql,args=[])=>{await db.exec('reset role');try{return await db.query(sql,args);}finally{await db.exec('set role authenticated');}};
const board=async()=>(await db.query('select packing_queue_board() result')).rows[0].result;
const records=async(ids=[],waiting=[],packing=[])=>(await db.query('select packing_queue_records($1,$2,$3) result',[ids,waiting,packing])).rows[0].result;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,role text,active boolean,department text,display_name text,access text[]);
 create function mfa_satisfied() returns boolean language sql stable as $$select current_setting('test.mfa',true)='yes'$$;
 insert into staff values('${OWNER}','owner',true,'management','Owner','{}'),('${PACKER}','staff',true,'stores','Packer','{deliveries}'),('${OTHER}','staff',true,'sales','Other','{leads}'),('${INACTIVE}','staff',false,'stores','Inactive','{deliveries}');
 create table organizations(id uuid primary key,name text,location text);
 insert into organizations values('${ORG}','Fictional Clinic','Dar');
 create table sales_delivery_notes(id uuid primary key,organization_id uuid,proforma_id uuid,delivery_number text,status text,version integer default 1,
 customer_waiting boolean default false,packing_queued_at timestamptz,created_at timestamptz,packing_taken_at timestamptz,packer_user_id uuid,packing_alerted_at timestamptz,packing_blocked_reason text,promise_kind text default 'consumables',promised_by timestamptz,tax_invoice_reference text default 'PRIVATE');
 create table products(id uuid primary key,name text);insert into products values('${PRODUCT}','Fictional reagent');
 create table sales_proforma_lines(id uuid primary key,proforma_id uuid,product_id uuid,sort_order integer,quantity integer,uom text);
 insert into sales_proforma_lines values('${LINE}','${PF}','${PRODUCT}',1,10,'kit');
 create table sales_delivery_lines(id uuid primary key,delivery_note_id uuid,proforma_line_id uuid,product_id uuid,lot_id uuid,quantity integer);
 create table inventory_lots(id uuid primary key,batch_number text);insert into inventory_lots values('${LOT}','BATCH-F');
 create table product_inventory_classifications(product_id uuid,version integer,category text);
 create function packing_raise_overdue_alerts() returns integer language sql as $$select 0$$;
 grant usage on schema public,auth to authenticated;
 set test.mfa='yes';`);
 for(const name of ['inventory_active_staff','inventory_owner'])await loadFunction('202610010058_two_step_sign_in.sql',name);
 for(const name of ['has_access','require_access'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 for(const name of ['packing_supervisor','packing_staff_name','packing_overdue_minutes','packing_amber_minutes','packing_queue_board'])await loadFunction('202610090078_packing_queue.sql',name);
 await loadFunction('202610180102_packing_shipping_handoffs.sql','packing_items');
 await db.exec(`revoke all on function packing_queue_board() from public,anon;grant execute on function packing_queue_board() to authenticated;
 revoke all on function packing_items(sales_delivery_notes),packing_staff_name(uuid) from public,anon,authenticated;
 alter table sales_delivery_notes enable row level security;alter table staff enable row level security;
 grant select on sales_delivery_notes,staff to authenticated;
 create policy denied on sales_delivery_notes for select to authenticated using(false);
 create policy own_staff on staff for select to authenticated using(user_id=auth.uid());`);
 await db.exec(migration('202610290130_packing_queue_records.sql'));
 for(let i=0;i<105;i++)await db.query(`insert into sales_delivery_notes(id,organization_id,proforma_id,delivery_number,status,customer_waiting,packing_queued_at,created_at,promised_by)
 values($1,$2,$3,$4,'sent_to_sales',$5,now()+$6*interval '1 minute',now()+$6*interval '1 minute',now()-interval '3 days')`,[id(1000+i),ORG,PF,'DN-'+i,i===104,i]);
 await db.query(`insert into sales_delivery_notes(id,organization_id,proforma_id,delivery_number,status,packer_user_id,packing_taken_at,created_at)
 values($1,$2,$3,'DN-PACK','packing',$4,now(),now())`,[id(2000),ORG,PF,PACKER]);
 await db.query('insert into sales_delivery_lines values($1,$2,$3,$4,$5,2)',[id(3000),id(2000),LINE,PRODUCT,LOT]);
 await as(PACKER);
 let initial=await board(),knownWaiting=initial.waiting.map(row=>row.id),knownPacking=initial.packing.map(row=>row.id);
 await check(async()=>{
  assert.equal(initial.waiting.length,100);assert.equal(initial.waiting[0].id,id(1104));
  const result=await records([],knownWaiting,knownPacking);assert.deepEqual(result.waiting_ids,knownWaiting);assert.deepEqual(result.packing_ids,knownPacking);assert.deepEqual(result.rows,[]);assert.equal(result.mine,id(2000));assert.equal(result.can_release,false);
  assert.equal((await db.query('select count(*)::int n from sales_delivery_notes')).rows[0].n,0,'direct RLS remains denied; RPC has the same explicitly authorized board view');
 });
 await check(async()=>{
  const result=await records([knownWaiting[0],knownPacking[0]],knownWaiting,knownPacking);
  for(const row of result.rows){const original=[...initial.waiting,...initial.packing].find(item=>item.id===row.id);const {status,...fields}=row;assert.deepEqual(fields,original);assert.equal(status,row.id===id(2000)?'packing':'sent_to_sales');assert.equal('tax_invoice_reference' in row,false);}
  assert.equal(result.rows.find(row=>row.id===id(2000)).items[0].batch,'BATCH-F');assert.equal(result.rows.find(row=>row.id===knownWaiting[0]).items[0].quantity,8,'actual partial-order balance is preserved');
 });
 const claimed=knownWaiting[0];
 await admin("update sales_delivery_notes set status='packing',packer_user_id=$2,packing_taken_at=now()+interval '1 second',version=2 where id=$1",[claimed,OWNER]);
 await check(async()=>{
  const current=await board(),result=await records([claimed],knownWaiting,knownPacking);
  assert.deepEqual(result.waiting_ids,current.waiting.map(row=>row.id));assert.deepEqual(result.packing_ids,current.packing.map(row=>row.id));
  const newcomer=current.waiting.find(row=>!knownWaiting.includes(row.id));assert.ok(newcomer);assert.deepEqual(new Set(result.rows.map(row=>row.id)),new Set([claimed,newcomer.id]));
  assert.equal(result.rows.find(row=>row.id===claimed).packer_name,'Owner');
 });
 await check(async()=>{
  const result=await records([],knownWaiting,knownPacking);assert.ok(result.rows.some(row=>row.id===claimed&&row.status==='packing'),'concurrent known-ID group changes get fresh card data');
 });
 initial=await board();knownWaiting=initial.waiting.map(row=>row.id);knownPacking=initial.packing.map(row=>row.id);
 await admin("update sales_delivery_notes set status='sent_to_sales',packer_user_id=null,packing_taken_at=null,version=3 where id=$1",[claimed]);
 await check(async()=>{
  const current=await board(),result=await records([claimed],knownWaiting,knownPacking);
  assert.deepEqual(result.waiting_ids,current.waiting.map(row=>row.id));assert.deepEqual(result.packing_ids,current.packing.map(row=>row.id));assert.equal(result.waiting_ids[0],claimed);assert.equal(result.rows.length,1);assert.equal(result.rows[0].status,'sent_to_sales');assert.equal(result.waiting_ids.length,100,'release evicts the old boundary row without adding a duplicate');
 });
 await check(async()=>{const current=await board(),result=await records([id(9999)],current.waiting.map(row=>row.id),current.packing.map(row=>row.id));assert.deepEqual(result.rows,[],'unknown IDs reveal no non-board records');});
 await check(async()=>{
  await admin(`insert into sales_delivery_notes(id,organization_id,proforma_id,delivery_number,status,packing_taken_at,created_at)
   select ('00000000-0000-4000-8000-'||lpad((5000+n)::text,12,'0'))::uuid,$1,$2,'DN-LIMIT-'||n,'packing',now()+n*interval '1 minute',now() from generate_series(1,100) n`,[ORG,PF]);
  const before=await board(),waiting=before.waiting.map(row=>row.id),packing=before.packing.map(row=>row.id);assert.equal(packing.length,100);
  await admin("update sales_delivery_notes set status='ready',version=version+1 where id=$1",[packing[0]]);
  const after=await board(),result=await records([packing[0]],waiting,packing),newcomer=after.packing.find(row=>!packing.includes(row.id));
  assert.ok(newcomer);assert.deepEqual(result.packing_ids,after.packing.map(row=>row.id));assert.equal(result.rows.length,1);assert.equal(result.rows[0].id,newcomer.id);assert.equal(result.packing_ids.length,100);
 });
 await check(async()=>{await assert.rejects(records(Array(101).fill(claimed)),/at most 100/);await assert.rejects(records([],Array(101).fill(claimed)),/at most 100/);await assert.rejects(records([],[],Array(101).fill(claimed)),/at most 100/);await assert.rejects(records([null]),/must not be null/);});
 await check(async()=>{
  await as(OWNER);assert.equal((await records()).can_release,true);
  await db.exec("set test.mfa='no'");await assert.rejects(records(),/do not have access/);await db.exec("set test.mfa='yes'");
  for(const actor of [OTHER,INACTIVE,null]){await as(actor);await assert.rejects(records(),/do not have access/);}
  await db.exec('reset role;set role anon');await assert.rejects(records(),/permission denied/);
 });
 await db.exec('reset role');
 await check(async()=>{const meta=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where proname='packing_queue_records'")).rows[0];assert.equal(meta.prosecdef,true);assert.deepEqual(meta.proconfig,['search_path=public, pg_temp']);assert.equal(meta.anon,false);assert.equal(meta.authenticated,true);});
 console.log(`PASS: ${checks} packing record database checks; actual board/items/access parity, partial quantities/batches, queue boundary fills, concurrent moves, bounds, anonymous/inactive/MFA denial. Alerts stubbed; no real writes or network.`);
}finally{await db.close();}
