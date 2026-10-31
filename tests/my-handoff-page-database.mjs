// Disposable PostgreSQL fixture only; migration 142 is exercised through authenticated invoker reads.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const OWNER=id(9001),HOLDER=id(9002),EMPTY=id(9003),INACTIVE=id(9004),now='2026-10-29T21:30:00.000Z',milliseconds=Date.parse(now),today='2026-10-30',utcToday='2026-10-29';let checks=0;
const check=async fn=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,role text,active boolean);
 insert into staff values('${OWNER}','owner',true),('${HOLDER}','staff',true),('${EMPTY}','head',true),('${INACTIVE}','staff',false);
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active) and current_setting('test.mfa',true)='yes'$$;
 create table work_assignments(id uuid primary key,record_type text,record_id uuid,record_label text,task text,note text,assignee_user_id uuid,assigned_by uuid,due_on date,status text,version integer,created_at timestamptz,close_note text);
 create table work_delays(id uuid primary key,assignment_id uuid,expected_on date,recorded_at timestamptz,reason text);
 create index work_assignments_assignee_open on work_assignments(assignee_user_id,due_on nulls last,id) where status='open';
 create index work_delays_assignment on work_delays(assignment_id,recorded_at desc);
 alter table work_assignments enable row level security;alter table work_delays enable row level security;
 create policy work_assignments_read on work_assignments for select to authenticated using ((select inventory_active_staff()));
 create policy work_delays_read on work_delays for select to authenticated using ((select inventory_active_staff()));
 grant select on work_assignments,work_delays to authenticated;grant usage on schema auth to authenticated;set test.mfa='yes';`);
 await db.exec(read('supabase/migrations/202610290142_my_handoff_page.sql'));
 const types=['proforma','delivery','service','lead','pending','purchase','tally_invoice'],ages=[1,24,24+1/3600000,48,48+1/3600000,-1,72,120],dates=[null,'2026-10-28','2026-10-29','2026-10-30','2026-10-31'];
 const assignments=Array.from({length:1200},(_,n)=>({id:id(10000+n),record_type:types[n%7],record_id:id(30000+n),record_label:'Record '+n,task:'Complete step '+n,note:'PRIVATE NOTE '.repeat(100),assignee_user_id:n<1100?HOLDER:OWNER,assigned_by:OWNER,due_on:dates[n%5],status:n%37===0?'done':'open',version:1+n%3,created_at:new Date(milliseconds-ages[n%8]*3600000).toISOString(),close_note:'PRIVATE CLOSED NOTE'}));
 const delays=assignments.filter((_,n)=>n%3===0).flatMap((row,n)=>[
  {id:id(50000+n*3),assignment_id:row.id,expected_on:'2026-10-28',recorded_at:'2026-10-28T00:00:00Z',reason:'OLD DELAY '.repeat(30)},
  {id:id(50001+n*3),assignment_id:row.id,expected_on:'2026-10-29',recorded_at:'2026-10-29T00:00:00Z',reason:'LOWER TIE '.repeat(30)},
  {id:id(50002+n*3),assignment_id:row.id,expected_on:dates[1+n%4],recorded_at:'2026-10-29T00:00:00Z',reason:'LATEST DELAY '.repeat(30)}]);
 await db.query('insert into work_assignments select * from jsonb_to_recordset($1::jsonb) as x(id uuid,record_type text,record_id uuid,record_label text,task text,note text,assignee_user_id uuid,assigned_by uuid,due_on date,status text,version integer,created_at timestamptz,close_note text)',[JSON.stringify(assignments)]);
 await db.query('insert into work_delays select * from jsonb_to_recordset($1::jsonb) as x(id uuid,assignment_id uuid,expected_on date,recorded_at timestamptz,reason text)',[JSON.stringify(delays)]);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');};
 const page=async(number=0,time=now,local=today,utc=utcToday)=>(await db.query('select my_handoff_page($1,$2,$3,$4) result',[number,time,local,utc])).rows[0].result;
 const legacy=vm.createContext({});vm.runInContext(read('work-assignments.js'),legacy);
 async function expected(actor,time=now,local=today,utc=utcToday){const rows=(await db.query('select to_jsonb(w) row from work_assignments w')).rows.map(r=>r.row).filter(row=>row.assignee_user_id===actor&&row.status==='open'),ds=legacy.workLatestDelays((await db.query('select to_jsonb(d) row from work_delays d')).rows.map(r=>r.row));
  const rank=row=>({red:2,yellow:1}[legacy.workAgeLevel(row,ds.get(row.id),Date.parse(time),local)]||0);
  rows.sort((a,b)=>rank(b)-rank(a)||Number(legacy.workOverdue(b,utc))-Number(legacy.workOverdue(a,utc))||String(a.due_on||'9999').localeCompare(String(b.due_on||'9999'))||String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
  return {rows,delays:ds};
 }
 async function collect(time=now,local=today,utc=utcToday){const first=await page(0,time,local,utc),rows=[...first.rows];for(let n=1;n<first.pages;n++)rows.push(...(await page(n,time,local,utc)).rows);assert.equal(rows.length,first.total);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);return {first,rows};}
 await as(HOLDER);
 await check(async()=>{const actual=await collect(),want=await expected(HOLDER);assert.ok(actual.first.total>1000);assert.equal(actual.first.rows.length,20);assert.deepEqual(actual.rows.map(row=>row.id),want.rows.map(row=>row.id));assert.equal(actual.first.pages,Math.ceil(want.rows.length/20));for(const row of actual.rows){assert.equal(row.age_level,legacy.workAgeLevel(row,want.delays.get(row.id),milliseconds,today));assert.equal(row.overdue,legacy.workOverdue(row,utcToday));assert.equal(row.expected_on,want.delays.get(row.id)?.expected_on||null);}assert.equal((await page(1000000)).page,actual.first.pages-1);});
 await check(async()=>{for(const [time,local,utc] of [[now,'2026-10-29','2026-10-29'],[now,'2026-10-28','2026-10-29'],['2026-10-30T00:30:00Z','2026-10-29','2026-10-30']]){const actual=await collect(time,local,utc),want=await expected(HOLDER,time,local,utc);assert.deepEqual(actual.rows.map(row=>row.id),want.rows.map(row=>row.id));for(const row of actual.rows){assert.equal(row.age_level,legacy.workAgeLevel(row,want.delays.get(row.id),Date.parse(time),local));assert.equal(row.overdue,legacy.workOverdue(row,utc));}}});
 await check(async()=>{const {rows}=await collect(),want=await expected(HOLDER);assert.deepEqual([...new Set(rows.map(row=>row.record_type))].sort(),[...types].sort());assert.ok(rows.some(row=>row.age_level==='yellow'));assert.ok(rows.some(row=>row.age_level==='red'&&!row.overdue));assert.ok(rows.some(row=>!row.age_level&&row.overdue),'future delay suppresses age warning but preserves UTC overdue secondary sort');assert.ok(rows.every(row=>row.status==='open'&&row.assignee_user_id===HOLDER));for(const row of rows.filter(row=>row.expected_on)){const latest=want.delays.get(row.id);assert.ok(latest.id===delays.filter(d=>d.assignment_id===row.id).at(-1).id);}});
 await check(async()=>{const result=await page();assert.ok(JSON.stringify(result).length<16000);assert.ok(result.rows.every(row=>!('note' in row)&&!('reason' in row)&&!('close_note' in row)));assert.ok(!JSON.stringify(result).includes('PRIVATE'));});
 await check(async()=>{await as(OWNER);const {rows}=await collect();assert.deepEqual(rows.map(row=>row.id),(await expected(OWNER)).rows.map(row=>row.id));assert.ok(rows.every(row=>row.assignee_user_id===OWNER),'owner still sees only own work on this page');await as(EMPTY);const result=await page();assert.deepEqual(result,{rows:[],total:0,page:0,pages:1});});
 await check(async()=>{await as(INACTIVE);await assert.rejects(page(),/Active staff/);await as(HOLDER);await db.exec("set test.mfa='no'");await assert.rejects(page(),/Active staff/);await db.exec("set test.mfa='yes'");await as('');await assert.rejects(page(),/Active staff/);await as(HOLDER);});
 await check(async()=>{for(const number of [null,-1,1000001])await assert.rejects(page(number),/valid handoff page/);for(const [time,local,utc] of [[null,today,utcToday],['infinity',today,utcToday],[now,null,utcToday],[now,'infinity',utcToday],[now,today,null],[now,today,'-infinity']])await assert.rejects(page(0,time,local,utc),/Valid browser time/);await assert.rejects(page(0,now,'not a date',utcToday),/invalid input/);});
 await check(async()=>{const hidden=assignments.find(row=>row.assignee_user_id===HOLDER&&row.status==='open');await db.exec(`reset role;create policy hidden_assignment on work_assignments as restrictive for select to authenticated using(id<>'${hidden.id}');create policy hidden_delay on work_delays as restrictive for select to authenticated using(id<>'${delays[5].id}');set role authenticated`);const {rows}=await collect();assert.deepEqual(rows.map(row=>row.id),(await expected(HOLDER)).rows.map(row=>row.id));assert.ok(!rows.some(row=>row.id===hidden.id));});
 await check(async()=>{await db.exec('reset role;create policy no_delays on work_delays as restrictive for select to authenticated using(false);set role authenticated');const {rows}=await collect();assert.deepEqual(rows.map(row=>row.id),(await expected(HOLDER)).rows.map(row=>row.id));assert.ok(rows.every(row=>row.expected_on===null));});
 await check(async()=>{await db.exec('reset role;set role anon');await assert.rejects(page(),/permission denied/);await db.exec('reset role');assert.deepEqual((await db.query("select prosecdef,provolatile from pg_proc where proname='my_handoff_page'")).rows[0],{prosecdef:false,provolatile:'s'});assert.equal((await db.query('select count(*)::int n from work_assignments')).rows[0].n,1200);assert.equal((await db.query('select count(*)::int n from work_delays')).rows[0].n,1200);});
 console.log(`PASS: ${checks} handoff-page database checks; 1200 assignments and delays, >1000 own open rows across 20-row pages, exact JS urgency/date/tie ordering, compact payload, caller isolation, MFA/RLS and anonymous denial.`);
}finally{await db.close();}
