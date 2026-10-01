// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,mig=f=>readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8');
const owner=id(1),sales=id(2),mujtaba=id(3),jagroop=id(4),nisa=id(5),qusai=id(6),ayaz=id(7),left_=id(8);
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean,display_name text);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create function public.accounting_access() returns boolean language sql stable as $$select false$$;
create table public.sales_proformas(id uuid primary key,document_number text,status text,prepared_by uuid,acceptance_reference text,deleted_at timestamptz,updated_at timestamptz default now());
create table public.sales_delivery_notes(id uuid primary key,delivery_number text,proforma_id uuid,status text,updated_at timestamptz default now());
create table public.service_cases(id uuid primary key,case_number text,case_type text,status text,assigned_user_id uuid,hod_user_id uuid,updated_at timestamptz default now());
create table public.sales_leads(id uuid primary key,lead_number text,stage text,owner_user_id uuid,created_by uuid,next_action text,updated_at timestamptz default now());
create table public.pending_stock_requests(id uuid primary key,request_number text,status text,salesperson_user_id uuid,created_by uuid,updated_at timestamptz default now());
create table public.purchase_orders(id uuid primary key,po_number text,status text,requested_by uuid,updated_at timestamptz default now());
insert into auth.users select unnest(array['${owner}','${sales}','${mujtaba}','${jagroop}','${nisa}','${qusai}','${ayaz}','${left_}'])::uuid;
insert into public.staff values('${owner}','owner',true,'Owner'),('${sales}','staff',true,'Sales'),('${mujtaba}','staff',true,'Mujtaba'),('${jagroop}','staff',true,'Jagroop'),('${nisa}','staff',true,'Nisa'),('${qusai}','staff',true,'Qusai'),('${ayaz}','staff',true,'Ayaz'),('${left_}','staff',false,'Former');`);
for(const f of ['202609300045_work_assignments.sql','202610010050_tally_sales_invoices.sql','202610010051_automatic_handoffs.sql'])await db.exec(mig(f));
const as=a=>db.exec(`select set_config('test.actor','${a||''}',false)`);
const open=async(type,rid)=>(await db.query(`select assignee_user_id a,task,note from work_assignments where record_type=$1 and record_id=$2 and status='open'`,[type,rid])).rows[0];
const history=async(type,rid)=>(await db.query(`select status from work_assignments where record_type=$1 and record_id=$2 order by created_at,id`,[type,rid])).rows.map(r=>r.status);
const unowned=async()=>(await db.query('select record_type,record_label from public.unowned_work()')).rows.map(r=>r.record_type+':'+r.record_label);
const setStep=(step,v,user,team=[])=>db.query('select * from public.set_workflow_step_owner($1,$2,$3,$4::uuid[])',[step,v,user,team]).then(r=>r.rows[0]);
let checks=0;const ok=()=>checks++;
const pf=id(100),inv=id(110),dn=id(120),svc=id(130),lead=id(140),pend=id(150),po=id(160);

// Step owners: owner only, active staff, versioned; the default joins the team.
await as(sales);await assert.rejects(setStep('packing',0,jagroop),/Only the owner/);ok();
await as(owner);
await assert.rejects(setStep('packing',0,left_),/active employee/);ok();
await assert.rejects(setStep('packing',0,jagroop,[left_]),/Team members/);ok();
await assert.rejects(setStep('toilets',0,jagroop),/check constraint|violates/);ok();
const packing=await setStep('packing',0,jagroop);assert.deepEqual(packing.team,[jagroop]);ok();
await assert.rejects(setStep('packing',0,jagroop),/changed/);ok();
await setStep('delivery',0,jagroop,[nisa]);await setStep('installation',0,qusai,[ayaz]);await setStep('service',0,ayaz,[qusai]);
// invoice step deliberately not set yet

// Pro forma: creator owns it while drafting and following up.
await as(sales);
await db.exec(`insert into sales_proformas(id,document_number,status,prepared_by) values('${pf}','PF-2026-000012','draft','${sales}')`);
assert.equal((await open('proforma',pf)).a,sales);ok();
await db.exec(`update sales_proformas set status='sent' where id='${pf}'`);
assert.match((await open('proforma',pf)).task,/Follow up/);ok();
// Accepted but nobody set for the invoice step: the salesperson keeps it rather than nobody.
await db.exec(`update sales_proformas set status='accepted',acceptance_reference='LPO 7' where id='${pf}'`);
assert.equal((await open('proforma',pf)).a,sales,'no invoice default: stays with the salesperson');ok();
await as(owner);await setStep('invoice',0,mujtaba);await as(sales);
await db.exec(`update sales_proformas set status='sent' where id='${pf}'`);await db.exec(`update sales_proformas set status='accepted' where id='${pf}'`);
const acc=await open('proforma',pf);assert.equal(acc.a,mujtaba);assert.match(acc.task,/TallyPrime — type PF-2026-000012 in Order No/);ok();

// Tally invoice linked → invoicing done, packing job for Jagroop, creator told.
await as(mujtaba);
await db.exec(`insert into public.staff values('${id(99)}','staff',true,'x') on conflict do nothing`);
await as(owner);
await db.query(`select public.import_tally_invoices($1::jsonb,'upload')`,[JSON.stringify([{tally_guid:'g1',voucher_number:'INV/101',voucher_date:'2026-10-01',party_name:'Fixture Hospital',order_reference:'pf 2026 12',lines:[]}])]);
const invId=(await db.query(`select id from tally_sales_invoices where voucher_number='INV/101'`)).rows[0].id;
const pfHistory=await history('proforma',pf);assert.equal(pfHistory.at(-1),'done','invoicing task closed as done');assert.ok(pfHistory.slice(0,-1).every(x=>x==='handed_on'));
assert.equal(await open('proforma',pf),undefined,'invoicing task closed');ok();
const packJob=await open('tally_invoice',invId);assert.equal(packJob.a,jagroop);assert.match(packJob.task,/Pack order PF-2026-000012 \(Tally invoice INV\/101\)/);ok();
const notice=(await db.query(`select user_id,message from work_notices`)).rows;assert.equal(notice.length,1);assert.equal(notice[0].user_id,sales);assert.match(notice[0].message,/Invoiced in Tally \(INV\/101\) and sent to packing — Jagroop/);ok();
// Re-import changes nothing; a cancelled invoice closes the packing job.
await db.query(`select public.import_tally_invoices($1::jsonb,'upload')`,[JSON.stringify([{tally_guid:'g1',voucher_number:'INV/101',voucher_date:'2026-10-01',party_name:'Fixture Hospital',order_reference:'pf 2026 12',lines:[]}])]);
assert.equal((await db.query(`select count(*)::int n from work_assignments where record_type='tally_invoice'`)).rows[0].n,1);ok();

// Delivery note takes over packing, then delivery, then done.
await db.exec(`insert into sales_delivery_notes values('${dn}','DN-1','${pf}','packing',now())`);
assert.deepEqual(await history('tally_invoice',invId),['handed_on'],'Tally packing job handed to the delivery note');ok();
assert.equal((await open('delivery',dn)).a,jagroop);ok();
await db.exec(`update sales_delivery_notes set status='out_for_delivery' where id='${dn}'`);
assert.equal((await open('delivery',dn)).a,jagroop,'delivery default is Jagroop');assert.match((await open('delivery',dn)).task,/signed delivery note/);ok();
await db.exec(`update sales_delivery_notes set status='delivered' where id='${dn}'`);
assert.equal(await open('delivery',dn),undefined);assert.equal((await history('delivery',dn)).at(-1),'done');ok();

// Service: new installation → Qusai to schedule; engineer assigned → engineer; completed → done.
await db.exec(`insert into service_cases values('${svc}','SC-1','installation','new',null,null,now())`);
assert.equal((await open('service',svc)).a,qusai);ok();
await db.exec(`update service_cases set status='assigned',assigned_user_id='${ayaz}' where id='${svc}'`);
assert.equal((await open('service',svc)).a,ayaz);assert.match((await open('service',svc)).task,/Carry out installation SC-1/);ok();
await db.exec(`update service_cases set status='report_required' where id='${svc}'`);assert.match((await open('service',svc)).task,/report/);ok();
await db.exec(`update service_cases set status='completed' where id='${svc}'`);assert.equal(await open('service',svc),undefined);ok();

// Lead, pending and purchase.
await db.exec(`insert into sales_leads values('${lead}','LD-1','inquiry',null,'${sales}','Call back Monday',now())`);
assert.equal((await open('lead',lead)).a,sales);assert.equal((await open('lead',lead)).task,'Call back Monday');ok();
await db.exec(`update sales_leads set owner_user_id='${nisa}' where id='${lead}'`);assert.equal((await open('lead',lead)).a,nisa);ok();
await db.exec(`update sales_leads set stage='lost' where id='${lead}'`);assert.equal(await open('lead',lead),undefined);ok();
await db.exec(`insert into pending_stock_requests values('${pend}','PS-1','waiting','${nisa}','${sales}',now())`);assert.equal((await open('pending',pend)).a,nisa);ok();
await db.exec(`update pending_stock_requests set status='fulfilled' where id='${pend}'`);assert.equal((await history('pending',pend)).at(-1),'done');ok();
await db.exec(`insert into purchase_orders values('${po}','PO-1','requested','${sales}',now())`);
assert.equal(await open('purchase',po),undefined,'no approver set yet');
assert.ok((await unowned()).includes('purchase:PO-1'),'listed as nobody responsible');ok();
await as(owner);await setStep('purchase_approval',0,owner);await as(sales);
await db.exec(`update purchase_orders set status='approved' where id='${po}'`);assert.equal((await open('purchase',po)).a,sales);ok();
assert.ok(!(await unowned()).includes('purchase:PO-1'));ok();

// A failing rule never blocks the business action.
await db.exec(`update staff set active=false where user_id='${nisa}'`);
await db.exec(`insert into pending_stock_requests values('${id(151)}','PS-2','waiting','${nisa}','${sales}',now())`);
assert.equal((await db.query(`select count(*)::int n from pending_stock_requests`)).rows[0].n,2,'insert still succeeded');
assert.ok((await unowned()).includes('pending:PS-2'),'inactive salesperson: shows as nobody responsible');ok();
await db.exec(`alter table work_assignments add constraint test_block check (task <> 'Tell the customer when the stock arrives') not valid`);
await db.exec(`update staff set active=true where user_id='${nisa}'`);
await db.exec(`insert into pending_stock_requests values('${id(152)}','PS-3','waiting','${nisa}','${sales}',now())`);
assert.equal((await db.query(`select count(*)::int n from pending_stock_requests`)).rows[0].n,3,'handoff failure did not block the insert');ok();
await db.exec(`alter table work_assignments drop constraint test_block`);

// Notices: only the recipient marks read; API roles cannot write directly.
const nid=(await db.query(`select id from work_notices limit 1`)).rows[0].id;
await as(jagroop);await assert.rejects(db.query('select public.dismiss_work_notice($1)',[nid]),/not found/);ok();
await as(sales);assert.ok((await db.query('select public.dismiss_work_notice($1) r',[nid])).rows[0].r);ok();
await assert.rejects(db.query('select public.dismiss_work_notice($1)',[nid]),/already read/);ok();
await assert.rejects(db.exec(`delete from work_notices`),/never deleted/);ok();
await as('');assert.equal((await db.query('select count(*)::int n from public.unowned_work()')).rows[0].n,0,'signed-out callers see nothing');ok();
const priv=(await db.query(`select has_table_privilege('authenticated','public.work_notices','INSERT') i,has_function_privilege('authenticated','public.auto_assign_work(text,uuid,text,text,uuid,text)','EXECUTE') a,has_function_privilege('anon','public.unowned_work()','EXECUTE') u`)).rows[0];
assert.deepEqual(priv,{i:false,a:false,u:false});ok();
console.log(`automatic handoffs database: ${checks} checks passed`);
