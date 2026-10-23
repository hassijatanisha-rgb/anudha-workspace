// Disposable PGlite: use the existing real-workflow fixture so deadline/MFA guards stay installed.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture(),{db,id,OWNER,SALES,ENGINEER,ACCOUNTS,OUTSIDER,as,admin,one,load}=f;
const LEGACY=id(710),TASK=id(711),COMMENT=id(720),OTHER=id(712);
const save=(task,version,title,details,assignee=ENGINEER,due=new Date(Date.now()+86400000).toISOString())=>one('select * from save_team_task($1,$2,$3,$4,$5,$6,$7)',[task,version,title,details,'normal',due,assignee]);
const progress=(request=COMMENT,task=TASK,note='Customer confirmed the visit')=>one('select * from append_team_task_progress($1,$2,$3)',[request,task,note]);
const history=task=>db.query('select * from team_task_events where task_id=$1 order by created_at,id',[task]).then(r=>r.rows);
const row=task=>one('select * from team_tasks where id=$1',[task]);
let checks=0;const check=async fn=>{await fn();checks++;};
try{
 await as(SALES);let legacy=await save(LEGACY,0,'Original legacy title','Old instructions');
 legacy=await save(LEGACY,1,'Current legacy title','Current instructions',ENGINEER,legacy.due_at);
 const beforeHistory=await history(LEGACY);
 const rpcMetadata=()=>db.query("select oid,proacl::text,prosrc,proconfig from pg_proc where oid in ('save_team_task(uuid,integer,text,text,text,timestamptz,uuid)'::regprocedure,'close_team_task(uuid,integer,text,text)'::regprocedure,'reschedule_team_task(uuid,integer,timestamptz,text)'::regprocedure) order by oid").then(r=>r.rows);
 const beforeRpc=await rpcMetadata();
 await db.exec('reset role');await load('202610200113_task_progress_history.sql');await db.exec('set role authenticated');
 await check(async()=>assert.deepEqual(await rpcMetadata(),beforeRpc,'existing save/close/deadline definitions, identity and grants are untouched'));
 await check(async()=>{
  const after=await history(LEGACY);
  assert.equal(after.length,beforeHistory.length+1);
  for(const previous of beforeHistory){const found=after.find(e=>e.id===previous.id);for(const key of Object.keys(previous))assert.deepEqual(found[key],previous[key]);}
  const baseline=after.find(e=>e.action==='assignment');
  assert.equal(baseline.note,'Saved instructions when history began');
  assert.equal(baseline.new_assignment.title,'Current legacy title');assert.equal(baseline.old_assignment,null);
  assert.equal(after.find(e=>e.action==='create').note,'Original legacy title');
 });
 let task=await save(TASK,0,'Call the clinic','First: confirm the model and serial.');
 const original=(await history(TASK)).find(e=>e.action==='assignment');
 await check(async()=>{assert.equal(original.note,'Original assignment');assert.equal(original.new_assignment.title,task.title);assert.equal(original.new_assignment.details,task.details);assert.equal(original.new_assignment.assignee_user_id,ENGINEER);});
 const first=await progress();
 await check(async()=>{assert.equal(first.actor_user_id,SALES);assert.equal(first.action,'progress');assert.ok(first.created_at);assert.equal((await row(TASK)).status,'open');assert.equal((await row(TASK)).version,1,'comments do not invalidate edits or deadline approvals');});
 await check(async()=>assert.equal((await progress()).id,first.id,'same request retries once'));
 await check(()=>assert.rejects(progress(COMMENT,TASK,'Changed retry'),/identifier already used/));
 for(const note of ['', '   ', 'x'.repeat(1001)])await check(()=>assert.rejects(progress(id(721),TASK,note),/1 to 1000/));
 await as(ENGINEER);await progress(id(722),TASK,'Engineer checked the requested model');
 await as(OWNER);await progress(id(723),TASK,'Owner confirmed approval');
 await check(async()=>assert.equal((await history(TASK)).filter(e=>e.action==='progress').length,3,'giver, assignee and owner can comment'));
 await admin("update staff set department='service' where user_id=$1",[ACCOUNTS]);await as(ACCOUNTS);
 await check(async()=>{assert.deepEqual(await history(TASK),[]);await assert.rejects(progress(id(724)),/Only the person/);});
 await as(OUTSIDER);await check(async()=>{assert.deepEqual(await history(TASK),[]);await assert.rejects(progress(id(725)),/Only the person/);});
 await as(SALES);
 task=await save(TASK,1,'Call the clinic again','Then: send the written confirmation.',OUTSIDER,task.due_at);
 await check(async()=>{
  const events=await history(TASK),change=events.find(e=>e.action==='assignment'&&e.old_assignment);
  assert.equal(change.old_assignment.details,'First: confirm the model and serial.');
  assert.equal(change.old_assignment.title,'Call the clinic');assert.equal(change.old_assignment.assignee_user_id,ENGINEER);
  assert.equal(change.new_assignment.details,'Then: send the written confirmation.');assert.equal(change.new_assignment.assignee_user_id,OUTSIDER);
  assert.deepEqual(events.find(e=>e.id===original.id),original,'original instructions stay unchanged');
 });
 await as(ENGINEER);await check(async()=>{assert.deepEqual(await history(TASK),[]);await assert.rejects(progress(id(726)),/Only the person/);});
 await as(OUTSIDER);await check(async()=>{assert.ok((await history(TASK)).some(e=>e.id===original.id),'new assignee sees original instructions');await progress(id(727));});
 await as(SALES);
 await check(()=>assert.rejects(save(TASK,task.version,'Call the clinic again','Different due',OUTSIDER,new Date(Date.now()+2*86400000).toISOString()),/department head's approval/));
 await as(OUTSIDER);
 await check(()=>assert.rejects(db.query('select reschedule_team_task($1,$2,now()+interval \'3 days\',$3)',[TASK,task.version,'Customer requested another day']),/department head's approval/));
 await as(OWNER);
 for(let n=0;n<3;n++)task=await one("select * from reschedule_team_task($1,$2,now()+($3::int * interval '1 day'),'Owner confirmed new date')",[TASK,task.version,n+3]);
 await check(()=>assert.rejects(db.query("select reschedule_team_task($1,$2,now()+interval '9 days','Needs another date')",[TASK,task.version]),/already moved 3 times/));
 await check(async()=>assert.equal((await history(TASK)).filter(e=>e.action==='assignment'&&e.old_assignment).length,4,'each changed deadline also retains before/after instructions'));
 await as(OUTSIDER);await one("select close_team_task($1,$2,'done','Called clinic manager and confirmed the visit')",[TASK,task.version]);
 await check(()=>assert.rejects(progress(id(728)),/already closed/));
 await as(SALES);await check(async()=>assert.equal((await progress()).id,COMMENT,'lost successful response remains retryable after closure'));
 await save(OTHER,0,'Other separate task','Independent instructions',ENGINEER);
 await check(()=>assert.rejects(progress(COMMENT,OTHER),/identifier already used/));
 for(const sql of ["update team_task_events set note='tamper'","delete from team_task_events","truncate team_task_events","insert into team_task_events(task_id,action,note,actor_user_id) values($1,'progress','forged',$2)"]){
  await check(()=>assert.rejects(db.query(sql,sql.includes('$1')?[OTHER,SALES]:[]),/permission denied/));
 }
 await check(async()=>{
  for(const sql of ["update team_task_events set note='tamper'","delete from team_task_events","truncate team_task_events"])await assert.rejects(admin(sql),/never changed/);
 });
 await admin(`create or replace function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('test.aal',true),''),'aal2'),'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))$$`);
 await as(OWNER);await db.query("select set_config('test.aal','aal1',false)");
 await check(async()=>{assert.deepEqual(await history(OTHER),[]);await assert.rejects(progress(id(729),OTHER),/Active staff/);});
 await db.query("select set_config('test.aal','aal2',false)");await as('');
 await check(async()=>{assert.deepEqual(await history(OTHER),[]);await assert.rejects(progress(id(730),OTHER),/Active staff/);});
 await as(ENGINEER);await admin('update staff set active=false where user_id=$1',[ENGINEER]);
 await check(async()=>{assert.deepEqual(await history(OTHER),[]);await assert.rejects(progress(id(731),OTHER),/Active staff/);});
 await as(SALES);
 await check(async()=>{
  for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'append_team_task_progress(uuid,uuid,text)','execute') allowed",[role])).allowed,role==='authenticated');
  for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'capture_team_task_assignment()','execute') allowed",[role])).allowed,false);
 });
 // The existing task is now assigned to inactive ENGINEER; age only this disposable fixture row.
 await admin("update team_tasks set due_at='2020-01-01T08:34:56.789Z' where id=$1",[OTHER]);
 await as(OUTSIDER);
 await check(async()=>{assert.equal(await row(OTHER),undefined);await assert.rejects(save(OTHER,1,'Other separate task','Independent instructions',OUTSIDER,'2020-01-01T08:34:56.789Z'),/Only the person who gave the task or the owner/);});
 await as(OWNER);const stranded=await row(OTHER),strandedHistory=await history(OTHER);
 await check(async()=>{
  assert.equal(stranded.assignee_user_id,ENGINEER);assert.ok(new Date(stranded.due_at)<new Date());
  const recovered=await save(OTHER,stranded.version,stranded.title,stranded.details,OUTSIDER,stranded.due_at);
  assert.equal(recovered.assignee_user_id,OUTSIDER);assert.equal(recovered.version,stranded.version+1);
  for(const key of ['title','details','urgency','due_at','assigned_by','status','close_note','closed_by','closed_at','reschedule_count'])assert.deepEqual(recovered[key],stranded[key],`${key} survives overdue reassignment`);
  const events=await history(OTHER);for(const event of strandedHistory)assert.deepEqual(events.find(e=>e.id===event.id),event);
  const change=events.find(e=>e.action==='assignment'&&e.old_assignment?.assignee_user_id===ENGINEER&&e.new_assignment?.assignee_user_id===OUTSIDER);
  assert.ok(change);assert.equal(change.old_assignment.due_at,change.new_assignment.due_at);assert.equal(change.actor_user_id,OWNER);
 });
 const count=(await history(LEGACY)).length;await db.exec('reset role');await load('202610200113_task_progress_history.sql');await db.exec('set role authenticated');
 await check(async()=>assert.equal((await history(LEGACY)).length,count,'rerunning migration preserves history without duplicate baselines'));
 console.log(`PASS: ${checks} task progress database checks; append-only comments, assignment snapshots, honest legacy baseline, no direct writes, current-task RLS, same-department head isolation, active staff/MFA, retry semantics, unchanged RPCs and deadline limits. Single-session PGlite does not exercise concurrent PostgreSQL lock contention.`);
}finally{await db.close();}
