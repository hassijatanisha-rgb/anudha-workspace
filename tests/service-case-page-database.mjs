// Isolated PostgreSQL fixture; no connection to an ERP database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const OWNER=id(9001),STAFF=id(9002),OTHER=id(9003),INACTIVE=id(9004);
let checks=0;const check=async fn=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,role text,active boolean,access text[]);
 insert into staff values('${OWNER}','owner',true,'{}'),('${STAFF}','staff',true,'{service}'),('${OTHER}','staff',true,'{travel}'),('${INACTIVE}','staff',false,'{service}');
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active) and current_setting('test.mfa',true)='yes'$$;
 create function has_access(area text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select inventory_active_staff() and exists(select 1 from staff where user_id=auth.uid() and (role='owner' or area=any(access)))$$;
 create table service_cases(id uuid primary key,case_number text,case_type text,status text,asset_id uuid,organization_id uuid,site_organization_id uuid,product_id uuid,assigned_user_id uuid,scheduled_for date,created_at timestamptz,updated_at timestamptz,version int default 1,reused_case_id uuid,delivery_ready boolean default true,problem_summary text default 'Fixture request');
 create table equipment_assets(id uuid primary key,serial_number text,installation_location text);
 create table organizations(id uuid primary key,name text,location text,deleted_at timestamptz);
 create table products(id uuid primary key,name text,source jsonb,deleted_at timestamptz);
 create table product_detail_reviews(id uuid primary key,product_id uuid,name text,version int);
 create table service_reports(id uuid primary key,case_id uuid,actual_work_date date,next_maintenance_date date,service_charge_minor bigint,currency text,work_completed text);
 create table service_case_events(id uuid primary key,case_id uuid,to_status text,actor_user_id uuid,created_at timestamptz,note text);
 create table work_assignments(id uuid primary key,record_type text,record_id uuid,status text,assignee_user_id uuid,assigned_by uuid,task text,created_at timestamptz,due_on date);
 create table work_delays(id uuid primary key,assignment_id uuid,reason text,expected_on date,recorded_at timestamptz);
 grant usage on schema auth to authenticated;
 do $$declare t text;begin foreach t in array array['service_cases','equipment_assets','organizations','products','product_detail_reviews','service_reports','service_case_events','work_assignments','work_delays'] loop
 execute format('alter table %I enable row level security',t);execute format('grant select on %I to authenticated',t);
 execute format('create policy read_rows on %I for select to authenticated using ((select inventory_active_staff()))',t);
 end loop;end $$;
 create policy own_handoff on work_assignments as restrictive for select to authenticated using(auth.uid()='${OWNER}' or assignee_user_id=auth.uid());
 set test.mfa='yes';`);
 await db.exec(read('supabase/migrations/202610290133_service_case_page.sql'));
 const context=vm.createContext({});for(const file of ['business-date.js','service-domain.js','service-workflow.js'])vm.runInContext(read(file),context);
 const today=context.serviceDate(),date=offset=>context.serviceDate(offset),created=offset=>date(offset)+'T22:00:00Z';
 await db.query("insert into organizations values($1,'Customer','Arusha',null),($2,'Destination <site>','Mwanza',null)",[id(8001),id(8002)]);
 await db.query("insert into equipment_assets values($1,'SERIAL-1','Ward')",[id(8101)]);
 await db.query("insert into products values($1,'Stale name',$2,null)",[id(8201),JSON.stringify({large:'source '.repeat(10000)})]);
 await db.query("insert into product_detail_reviews values($1,$2,'Older correction',1),($3,$2,'Reviewed <machine>',2)",[id(8301),id(8201),id(8302)]);
 const rows=Array.from({length:1068},(_,n)=>({id:id(n+1),case_number:'CASE-'+String(n+1).padStart(4,'0'),case_type:n<1063?'installation':'service',status:['new','assigned','scheduled','on_site','report_required','completed','cancelled'][n%7],asset_id:id(8101),organization_id:id(8001),site_organization_id:id(8002),product_id:id(8201),assigned_user_id:n%7===0?null:STAFF,scheduled_for:n%7<2?null:date(n%65-32),created_at:created(-120+n%111),updated_at:created(-1),version:1,reused_case_id:null,delivery_ready:n%5!==0}));
 rows[7].reused_case_id=id(1);rows[8].created_at=created(3); // duplicate planning jobs are excluded; future age clamps to zero.
 await db.query(`insert into service_cases(id,case_number,case_type,status,asset_id,organization_id,site_organization_id,product_id,assigned_user_id,scheduled_for,created_at,updated_at,version,reused_case_id,delivery_ready)
 select * from jsonb_to_recordset($1::jsonb) as x(id uuid,case_number text,case_type text,status text,asset_id uuid,organization_id uuid,site_organization_id uuid,product_id uuid,assigned_user_id uuid,scheduled_for date,created_at timestamptz,updated_at timestamptz,version int,reused_case_id uuid,delivery_ready boolean)`,[JSON.stringify(rows)]);
 const firstExpected=context.serviceSortCases(rows.filter(row=>row.case_type==='installation').sort((a,b)=>a.id.localeCompare(b.id)))[0];
 await db.query("insert into service_reports values($1,$2,$3,$4,500,'TZS',$5)",[id(8401),firstExpected.id,today,date(90),'Signed private narrative '.repeat(300)]);
 await db.query("insert into service_case_events values($1,$2,'new',$3,$4,'Old event'),($5,$2,'assigned',$3,$6,'Latest real event')",[id(8501),firstExpected.id,OWNER,created(-4),id(8502),created(-1)]);
 await db.query("insert into work_assignments values($1,'service',$2,'open',$3,$3,'Coordinate visit',$4,$5)",[id(8601),firstExpected.id,OWNER,created(-5),date(2)]);
 await db.query("insert into work_delays values($1,$2,'Older delay',$3,$4),($5,$2,'Latest delay',$6,$7)",[id(8701),id(8601),date(1),created(-2),id(8702),date(2),created(-1)]);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');};
 const page=async(type='installation',n=0,focus=null)=>(await db.query('select service_case_page($1,$2,$3) result',[type,n,focus])).rows[0].result;
 await as(OWNER);const first=await page();
 await check(async()=>{assert.equal(first.rows.length,50);assert.equal(first.total,1063);assert.equal(first.pages,22);assert.deepEqual(first.metrics,JSON.parse(JSON.stringify(context.serviceMetricValues(rows.filter(row=>row.case_type==='installation')))));assert.ok(JSON.stringify(first).length<100000);});
 await check(async()=>{const found=[];for(let n=0;n<first.pages;n++)found.push(...(await page('installation',n)).rows);assert.equal(new Set(found.map(row=>row.id)).size,1063);assert.deepEqual(found.map(row=>row.id),Array.from(context.serviceSortCases(rows.filter(row=>row.case_type==='installation').sort((a,b)=>a.id.localeCompare(b.id))),row=>row.id));assert.equal((await page('installation',1000000)).page,21);});
 await check(async()=>{const row=first.rows[0];assert.equal(row.display.product_name,'Reviewed <machine>');assert.equal(row.display.organization_name,'Destination <site>');assert.equal(row.display.customer_name,'Customer');assert.equal(row.display.serial_number,'SERIAL-1');assert.equal(row.latest_event.id,id(8502));assert.equal(row.coordinator.task,'Coordinate visit');assert.equal(row.coordinator_delay.reason,'Latest delay');assert.equal(row.report_summary.service_charge_minor,500);assert.ok(!JSON.stringify(first).includes('Signed private narrative'));assert.ok(!JSON.stringify(first).includes('source source'));});
 await check(async()=>{const focused=await page('installation',0,first.rows[0].id);assert.equal(focused.total,1);assert.equal(focused.rows.length,1);assert.deepEqual(focused.metrics,first.metrics);assert.equal((await page('installation',0,id(999999))).total,0);const service=await page('service');assert.equal(service.total,5);assert.deepEqual(service.metrics,JSON.parse(JSON.stringify(context.serviceMetricValues(rows.filter(row=>row.case_type==='service')))));});
 await check(async()=>{await as(STAFF);const result=await page();assert.equal(result.total,1063);assert.equal(result.rows[0].coordinator,null);assert.equal(result.rows[0].coordinator_delay,null);});
 await check(async()=>{await as(OTHER);await assert.rejects(page(),/Service access/);await as(INACTIVE);await assert.rejects(page(),/Service access/);await as(OWNER);await db.exec("set test.mfa='no'");await assert.rejects(page(),/Service access/);await db.exec("set test.mfa='yes'");});
 await check(async()=>{await assert.rejects(page('invalid'),/valid Service case type/);await assert.rejects(page('installation',-1),/valid Service page/);await assert.rejects(page('installation',null),/valid Service page/);});
 await check(async()=>{await db.exec(`reset role;create policy scoped_case on service_cases as restrictive for select to authenticated using(id<>'${first.rows[0].id}');set role authenticated`);const result=await page();assert.equal(result.total,1062);assert.equal((await page('installation',0,first.rows[0].id)).rows.length,0);assert.deepEqual(result.metrics,JSON.parse(JSON.stringify(context.serviceMetricValues(rows.filter(row=>row.case_type==='installation'&&row.id!==first.rows[0].id)))));});
 await check(async()=>{await db.exec('reset role;create policy hide_products on products as restrictive for select to authenticated using(false);create policy hide_sites on organizations as restrictive for select to authenticated using(false);set role authenticated');const result=await page();assert.equal(result.rows[0].display.product_name,'Product unavailable');assert.equal(result.rows[0].display.organization_name,'Client unavailable');assert.equal(result.total,1062);});
 await check(async()=>{await db.exec('reset role;set role anon');await assert.rejects(page(),/permission denied/);await db.exec('reset role');assert.deepEqual((await db.query("select prosecdef,provolatile from pg_proc where proname='service_case_page'")).rows[0],{prosecdef:false,provolatile:'s'});assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname='service_case_events_latest_idx'")).rows[0].n,1);});
 console.log(`PASS: ${checks} Service page database checks; 1068 cases, 50-row bound, full metric/order parity, latest event/handoff, deep links, reviewed identity, RLS/MFA/access and anonymous denial.`);
}finally{await db.close();}
