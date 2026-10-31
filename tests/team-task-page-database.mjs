// Disposable PostgreSQL only; exercise the real invoker migration under caller RLS.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite(),read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,STAFF=id(9001),OTHER=id(9002),OWNER=id(9003),INACTIVE=id(9004),keys=['forMe','gave','results','finished'];let checks=0;
const check=async fn=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text);
 insert into staff values('${STAFF}',true,'staff'),('${OTHER}',true,'staff'),('${OWNER}',true,'owner'),('${INACTIVE}',false,'staff');
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active) and current_setting('test.mfa',true)='yes'$$;
 create function inventory_owner() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select inventory_active_staff() and exists(select 1 from staff where user_id=auth.uid() and role='owner')$$;
 create table team_tasks(id uuid primary key,task_number text,title text,details text,urgency text,due_at timestamptz,assignee_user_id uuid,assigned_by uuid,status text,close_note text,closed_at timestamptz,version integer,reschedule_count integer);
 alter table team_tasks enable row level security;grant usage on schema auth to authenticated;grant select on team_tasks to authenticated;
 create policy team_tasks_read on team_tasks for select to authenticated using ((select inventory_active_staff()) and ((select auth.uid()) in (assignee_user_id,assigned_by) or (select inventory_owner())));
 set test.mfa='yes';`);
 await db.exec(read('supabase/migrations/202610290140_team_task_page.sql'));
 await db.exec('begin');const now=(await db.query("select to_jsonb(date_trunc('milliseconds',now())) value")).rows[0].value,ms=Date.parse(now),date=delta=>new Date(ms+delta).toISOString();
 const rows=Array.from({length:1867},(_,n)=>{const group=n%7,status=group<2?'open':n%2?'done':'cancelled';return {id:id(n+1),task_number:'TK-'+(n+1),title:'Fixture <task> '+n,details:'Private instructions '.repeat(100),urgency:['normal','urgent','do_now'][n%3],due_at:`2099-01-${String(n%20+1).padStart(2,'0')}T09:00:00.${n%2?'123999':'123001'}+00:00`,assignee_user_id:group===1||group===2||group===4?OTHER:group===5?OWNER:STAFF,assigned_by:group===1||group===2||group===3?STAFF:OTHER,status,close_note:'Private result '.repeat(100),closed_at:status==='open'?null:date(-(group===2||group===4?2:group===6?40:10)*864e5),version:3,reschedule_count:n%4};});
 const extra=(n,values)=>({...rows[0],id:id(5000+n),task_number:'TK-EDGE-'+n,status:'done',assignee_user_id:OTHER,assigned_by:STAFF,closed_at:date(-7*864e5),...values});
 rows.push(extra(1,{}),extra(2,{closed_at:date(-7*864e5+1)}),extra(3,{closed_at:date(-30*864e5)}),extra(4,{closed_at:date(-30*864e5-1)}),extra(5,{closed_at:date(-2*864e5),assignee_user_id:STAFF}),extra(6,{closed_at:date(-7*864e5).replace(/(\d{3})Z$/,'$1001Z')}));
 await db.query('insert into team_tasks select * from jsonb_to_recordset($1::jsonb) as x(id uuid,task_number text,title text,details text,urgency text,due_at timestamptz,assignee_user_id uuid,assigned_by uuid,status text,close_note text,closed_at timestamptz,version int,reschedule_count int)',[JSON.stringify(rows)]);
 const legacy=vm.createContext({});vm.runInContext(read('team-tasks.js'),legacy);
 const expected=(actor=STAFF,source=rows)=>legacy.teamTaskGroups(legacy.teamTaskOrder(source.filter(row=>(row.assignee_user_id===actor||row.assigned_by===actor)&&(row.status==='open'||Date.parse(row.closed_at)>=ms-30*864e5))),{user_id:actor},ms);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,true)",[actor]);await db.exec('set local role authenticated');};
 const page=async(offsets=[0,0,0,0])=>(await db.query('select team_task_page($1,$2,$3,$4) value',offsets)).rows[0].value;
 await as(STAFF);const first=await page(),want=expected();
 await check(async()=>{assert.equal(Date.parse(first.as_of),ms);for(const key of keys){assert.equal(first.groups[key].total,want[key].length,key);assert.equal(first.groups[key].rows.length,Math.min(20,want[key].length));assert.equal(first.groups[key].pages,Math.max(1,Math.ceil(want[key].length/20)));}assert.equal(keys.reduce((n,key)=>n+first.groups[key].rows.length,0),80);assert.ok(!JSON.stringify(first).includes('Private instructions'));assert.ok(!JSON.stringify(first).includes('Private result'));assert.ok(!Object.hasOwn(first.groups.forMe.rows[0],'version'));});
 await check(async()=>{for(const [i,key] of keys.entries()){const seen=[];for(let n=0;n<first.groups[key].pages;n++){const offsets=[0,0,0,0];offsets[i]=n;const result=await page(offsets);assert.equal(result.groups[key].page,n);for(const other of keys.filter(x=>x!==key))assert.equal(result.groups[other].page,0);assert.ok(result.groups[key].rows.length<=20);seen.push(...result.groups[key].rows.map(row=>row.id));}assert.deepEqual(seen,Array.from(want[key],row=>row.id),key);assert.equal(new Set(seen).size,seen.length);}});
 await check(async()=>{const result=await page([1000000,1000000,1000000,1000000]);for(const key of keys)assert.equal(result.groups[key].page,result.groups[key].pages-1);assert.ok(want.finished.some(row=>row.id===id(5001)));assert.ok(want.results.some(row=>row.id===id(5002)));assert.ok(want.finished.some(row=>row.id===id(5003)));assert.ok(!Object.values(want).some(group=>group.some(row=>row.id===id(5004))));assert.ok(want.finished.some(row=>row.id===id(5005)));assert.ok(want.finished.some(row=>row.id===id(5006)));});
 await check(async()=>{await as(OWNER);const result=await page(),own=expected(OWNER);for(const key of keys)assert.equal(result.groups[key].total,own[key].length);assert.ok(result.groups.finished.rows.every(row=>row.assignee_user_id===OWNER||row.assigned_by===OWNER));await as(OTHER);const other=await page();for(const key of keys)assert.equal(other.groups[key].total,expected(OTHER)[key].length);await as(STAFF);});
 await check(async()=>{const hidden=first.groups.forMe.rows[0].id;await db.exec(`reset role;create policy hidden_task on team_tasks as restrictive for select to authenticated using(id<>'${hidden}');set local role authenticated`);const result=await page(),allowed=expected(STAFF,rows.filter(row=>row.id!==hidden));assert.equal(result.groups.forMe.total,allowed.forMe.length);assert.deepEqual(result.groups.forMe.rows.map(row=>row.id),Array.from(allowed.forMe.slice(0,20),row=>row.id));assert.ok(!JSON.stringify(result).includes(hidden));});
 await check(async()=>{const before=await page();await db.exec("set local timezone='Europe/Berlin'");const after=await page();for(const key of keys){assert.equal(after.groups[key].total,before.groups[key].total);assert.deepEqual(after.groups[key].rows.map(row=>row.id),before.groups[key].rows.map(row=>row.id));}await db.exec("set local timezone='UTC'");});
 await check(async()=>{await as(INACTIVE);await assert.rejects(page(),/Active staff/);});
 // PostgreSQL exceptions abort transactions; start fresh for denial and input checks after rolling back the fixture.
 await db.exec('rollback');
 const deny=async(sql,pattern)=>{await db.exec('begin');try{await as(STAFF);await assert.rejects(db.query(sql),pattern);}finally{await db.exec('rollback');}};
 await check(async()=>{await db.exec('begin');await as(STAFF);await db.exec("set local test.mfa='no'");await assert.rejects(page(),/Active staff/);await db.exec('rollback');});
 await check(async()=>{for(const values of ['-1,0,0,0','0,null,0,0','0,0,1000001,0'])await deny('select team_task_page('+values+')',/Invalid task page/);});
 await check(async()=>{await db.exec('set role anon');await assert.rejects(page(),/permission denied/);await db.exec('reset role');const config=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where proname='team_task_page'")).rows[0];assert.equal(config.prosecdef,false);assert.equal(config.provolatile,'s');assert.deepEqual(config.proconfig,['search_path=public, pg_temp']);});
 console.log(`PASS: ${checks} team-task page database checks; 1,873 tasks, complete four-group traversal, exact legacy counts/sort/recent boundaries, caller RLS, owner personal scope, active/MFA and anonymous denial.`);
}finally{await db.close();}
