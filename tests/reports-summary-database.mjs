// Disposable PGlite parity fixture; all identities and history are fictional.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,a=id(1),b=id(2),c=id(3),unknown=id(4);
const since='2026-09-30T21:00:00.000Z',until='2026-10-31T21:00:00.000Z',now='2026-10-29T21:30:00.123Z',today='2026-10-30';
const at=hours=>new Date(Date.parse(now)-hours*3600000).toISOString(),ctx=vm.createContext({Date,employeeName:actor=>({[a]:'Zoe',[b]:'Amy',[c]:'Chen'}[actor]||'Employee name not set')});
vm.runInContext(read('reports.js'),ctx);vm.runInContext(read('work-assignments.js'),ctx);
const prodFunction=(file,name)=>{const text=read(file),start=text.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`)),end=text.indexOf('$$;',text.indexOf('as $$',start));assert.ok(start>=0&&end>start);return text.slice(start,end+3)};
const list=async(sql,args=[])=>(await db.query(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') data from (${sql}) r`,args)).rows[0].data;
const work=async(args=[since,until,now,today])=>(await db.query('select report_work_summary($1,$2,$3,$4) data',args)).rows[0].data;
const activity=async(args=[since,until])=>(await db.query('select report_activity_summary($1,$2) data',args)).rows[0].data;
async function assertParity(){
 const finished=await list('select * from work_assignments where closed_at >= $1 and closed_at < $2 order by closed_at,id',[since,until]);
 const open=await list("select * from work_assignments where status='open' order by id"),departments=await list('select * from staff_departments()');
 const delays=await list('select d.*,w.assignee_user_id from work_delays d left join work_assignments w on w.id=d.assignment_id where d.recorded_at >= $1 and d.recorded_at < $2 order by d.recorded_at,d.id',[since,until]);
 const openDelays=await list("select d.* from work_delays d join work_assignments w on w.id=d.assignment_id where w.status='open' order by d.id"),latest=new Map();
 for(const d of openDelays)if(!latest.has(d.assignment_id)||latest.get(d.assignment_id).recorded_at<d.recorded_at)latest.set(d.assignment_id,d);
 const expected=ctx.reportWork({finished,open,delays,departments:new Map(departments.map(d=>[d.user_id,d.department])),now:Date.parse(now),overdue:row=>ctx.workAgeLevel(row,latest.get(row.id),Date.parse(now),today)==='red'});
 assert.deepEqual(plain(ctx.reportWorkTotals(await work())),plain(expected));
 const events={steps:finished};for(const [key,table] of [['leadEvents','sales_lead_events'],['proformaEvents','sales_proforma_events'],['deliveryEvents','sales_delivery_events'],['serviceEvents','service_case_events'],['pendingEvents','pending_stock_events']])events[key]=await list(`select * from ${table} where created_at >= $1 and created_at < $2 order by created_at,id`,[since,until]);
 assert.deepEqual(plain(ctx.reportActivityTotals(await activity())),plain(ctx.reportActivity(events)));
}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function mfa_satisfied() returns boolean language sql stable as $$select current_setting('test.mfa',true)='yes'$$;
 grant usage on schema auth to authenticated;
 create table staff(user_id uuid primary key,department text,active boolean,role text,access text[]);
 alter table staff enable row level security;create policy own_staff on staff for select to authenticated using(user_id=auth.uid());grant select on staff to authenticated;
 create table work_assignments(id uuid primary key,assignee_user_id uuid,status text,created_at timestamptz,closed_at timestamptz,closed_by uuid,due_on date);
 create table work_delays(id uuid primary key,assignment_id uuid,expected_on date,recorded_at timestamptz);
 create table sales_lead_events(id uuid primary key,actor_user_id uuid,action text,from_stage text,created_at timestamptz);
 create table sales_proforma_events(id uuid primary key,actor_user_id uuid,from_status text,to_status text,created_at timestamptz);
 create table sales_delivery_events(like sales_proforma_events including all);
 create table service_case_events(like sales_proforma_events including all);
 create table pending_stock_events(id uuid primary key,actor_user_id uuid,action text,created_at timestamptz);
 insert into staff values('${a}','sales',true,'owner','{}'),('${b}','stores',true,'staff','{leads,proformas,deliveries,service,reports}'),('${c}','accounts',false,'staff','{}');
 set test.actor='${a}';set test.mfa='yes';`);
 await db.exec(prodFunction('supabase/migrations/202610010058_two_step_sign_in.sql','inventory_active_staff'));
 await db.exec(prodFunction('supabase/migrations/202610050060_department_heads_and_access.sql','has_access'));
 await db.exec(prodFunction('supabase/migrations/202610010054_staff_departments.sql','staff_departments'));
 for(const [table,gate] of [['work_assignments','inventory_active_staff()'],['work_delays','inventory_active_staff()'],['pending_stock_events','inventory_active_staff()'],['sales_lead_events',"has_access('leads')"],['sales_proforma_events',"has_access('proformas')"],['sales_delivery_events',"has_access('deliveries')"],['service_case_events',"has_access('service')"]])await db.exec(`alter table ${table} enable row level security;create policy visible on ${table} for select to authenticated using((select ${gate}));grant select on ${table} to authenticated`);
 // More than one REST page of history, plus exact inclusive/exclusive and duration boundaries.
 await db.exec(`insert into work_assignments select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${a}','done','2026-10-01 00:00:00.999999+00','2026-10-01 01:00:00.000001+00','${b}',null from generate_series(1,1007)n;
 insert into sales_lead_events select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${a}','create',null,'2026-10-01' from generate_series(1,1007)n;`);
 const assignments=[
  [100,'done',a,'2026-09-30T20:00:00Z',since,b,null],
  [101,'done',a,at(10),until,b,null],
  [102,'done',a,at(10),'2026-09-30T20:59:59.999Z',b,null],
  [103,'handed_on',b,at(10),at(8),a,null],
  [104,'cancelled',b,at(10),at(8),a,null],
  [105,'done',b,at(1),at(2),a,null],
  [106,'done',null,at(10),at(8),a,null],
  [107,'cancelled',c,at(10),at(8),a,null],
  [108,'done',unknown,at(10),at(8),null,null],
  [200,'open',a,at(80),null,null,'2026-10-29'],
  [201,'open',a,at(80),null,null,'2026-11-01'],
  [202,'open',a,at(48),null,null,null],
  [203,'open',a,new Date(Date.parse(at(48))-1).toISOString(),null,null,null],
  [204,'open',b,at(100),null,null,'2026-10-01'],
  [205,'open',b,at(1),null,null,'2026-11-01'],
  [206,'open',b,at(100),null,null,null],
  [207,'open',b,at(1),null,null,null],
  [208,'open',null,at(-1),null,null,null],
  [209,'open',c,at(120),null,null,null]
 ];
 for(const [n,status,actor,created,closed,by,due] of assignments)await db.query('insert into work_assignments values($1,$2,$3,$4,$5,$6,$7)',[id(n),actor,status,created,closed,by,due]);
 const delays=[
  [300,204,'2026-10-01',at(3)],[301,204,'2026-10-30',at(2)], // Future/today expectation supersedes overdue due date and age.
  [302,205,'2026-10-29',at(1)], // Past expectation supersedes future due date.
  [303,206,'2026-10-29',at(1)],[304,206,'2026-11-01',at(1)], // Lowest id wins an exact timestamp tie.
  [305,207,'2026-10-01',at(1)],[306,207,'2026-11-01',until], // Latest expectation is not limited to the reporting period.
  [307,104,'2026-11-01',since],[308,107,'2026-11-01',at(1)], // Delays on cancelled/closed steps still count.
  [309,208,'2026-11-01',at(1)],[310,200,'2026-11-01','2026-09-30T20:59:59.999Z']
 ];
 for(const [n,assignment,expected,recorded] of delays)await db.query('insert into work_delays values($1,$2,$3,$4)',[id(n),id(assignment),expected,recorded]);
 let serial=400;
 for(const [action,from,actor,created] of [['create',null,b,since],['create',null,b,until],['create',null,b,'2026-09-30T20:59:59.999Z'],['qualify',null,b,at(1)],['assign','inquiry',b,at(1)],['assign','lead',b,at(1)],['won',null,a,at(1)],['lost',null,b,at(1)],['edit',null,c,at(1)],['create',null,null,at(1)]])await db.query('insert into sales_lead_events values($1,$2,$3,$4,$5)',[id(serial++),actor,action,from,created]);
 for(const table of ['sales_proforma_events','sales_delivery_events','service_case_events'])for(const [from,to] of [[null,'draft'],['','draft'],['draft','draft'],['draft','sent'],['sent','sent'],[null,'sent'],['sent','accepted'],['accepted','accepted'],[null,'accepted'],['out_for_delivery','delivered'],['delivered','delivered'],[null,'delivered'],['report_required','completed'],['completed','completed'],[null,'completed']])await db.query(`insert into ${table} values($1,$2,$3,$4,$5)`,[id(serial++),b,from,to,at(1)]);
 for(const action of ['create','fulfil','extend','cancel'])await db.query('insert into pending_stock_events values($1,$2,$3,$4)',[id(serial++),a,action,at(1)]);
 await db.exec(read('supabase/migrations/202610290137_report_summaries.sql'));await db.exec('set role authenticated');
 await assertParity();assert.equal((await work()).find(row=>row.actor===a).finished,1008);assert.equal((await activity()).find(row=>row.actor===a).inquiries,1007);
 assert.equal((await work()).find(row=>row.actor===b).overdue_now,2);assert.equal((await work()).find(row=>row.actor===c).department,'accounts');assert.equal((await list('select * from staff')).length,1,'departments use the existing safe directory, not wider staff RLS');
 assert.ok((await work()).some(row=>row.actor===null));assert.ok((await work()).some(row=>row.actor===unknown&&row.department===''));
 // Current departments, regardless of activity date or inactive assignee status.
 await db.exec(`reset role;update staff set department='service' where user_id='${b}';set role authenticated`);assert.equal((await work()).find(row=>row.actor===b).department,'service');await assertParity();
 // Per-area policies remove inaccessible event streams without losing visible work/pending counts.
 await db.exec(`reset role;update staff set access='{reports,leads}' where user_id='${b}';set test.actor='${b}';set role authenticated`);await assertParity();assert.ok((await activity()).every(row=>row.proformas===0&&row.delivered===0&&row.serviceReports===0));
 // Hidden linked assignments must not leak through otherwise visible delay rows; hidden delays cannot set lateness.
 await db.exec(`reset role;create policy hidden_assignment on work_assignments as restrictive for select to authenticated using(id<>'${id(104)}' and id<>'${id(107)}');create policy hidden_delay on work_delays as restrictive for select to authenticated using(id<>'${id(301)}');set role authenticated`);await assertParity();assert.equal((await work()).find(row=>row.actor===c).delays,0);assert.equal((await work()).find(row=>row.actor===b).overdue_now,3);
 for(const actor of [c,unknown]){await db.exec(`set test.actor='${actor}'`);await assert.rejects(work(),/Active staff access/);await assert.rejects(activity(),/Active staff access/);}
 await db.exec(`set test.actor='${b}';set test.mfa='no'`);await assert.rejects(work(),/Active staff access/);await assert.rejects(activity(),/Active staff access/);await db.exec("set test.mfa='yes'");
 for(const args of [[null,until,now,today],[since,null,now,today],[until,since,now,today],[since,since,now,today],['-infinity',until,now,today],[since,'infinity',now,today],[since,until,null,today],[since,until,'infinity',today],[since,until,now,null],[since,until,now,'infinity']])await assert.rejects(work(args),/valid report period/);
 for(const args of [[null,until],[since,null],[until,since],[since,since],['-infinity',until],[since,'infinity']])await assert.rejects(activity(args),/valid report period/);
 await db.exec('reset role;set role anon');await assert.rejects(work(),/permission denied/);await assert.rejects(activity(),/permission denied/);
 await db.exec('reset role');for(const table of ['work_assignments','work_delays','sales_lead_events','sales_proforma_events','sales_delivery_events','service_case_events','pending_stock_events'])await db.exec(`create policy hidden_all on ${table} as restrictive for select to authenticated using(false)`);
 await db.exec('set role authenticated');assert.deepEqual(await work(),[]);assert.deepEqual(await activity(),[]);
 await db.exec('reset role');const functions=(await db.query("select proname,prosecdef,provolatile from pg_proc where proname in('report_work_summary','report_activity_summary')")).rows;assert.equal(functions.length,2);assert.ok(functions.every(row=>!row.prosecdef&&row.provolatile==='s'));assert.equal((await db.query('select count(*)::integer n from work_assignments')).rows[0].n,1026);
 console.log('PASS: report Work/Activity parity across >1,000 events, local-date boundaries, cancelled/handed-on/null actors, exact durations, current departments, latest-delay precedence/ties, linked-row RLS, area restrictions, active/MFA gates, input bounds, empty results and anonymous denial.');
}finally{await db.close();}
