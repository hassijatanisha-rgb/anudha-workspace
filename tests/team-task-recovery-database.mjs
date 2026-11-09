// Disposable real-workflow fixture; no production connection or business records.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture(),{db,id,OWNER,SALES,ENGINEER,OUTSIDER,as,admin,one,load}=f;
const TASK=id(8501);let checks=0;
const check=async fn=>{await fn();checks++;};
try{
 await db.exec('reset role');
 for(const migration of ['202610200113_task_progress_history.sql','202610290140_team_task_page.sql','202611090163_inactive_team_task_page.sql'])await load(migration);
 await db.exec('grant select on staff to authenticated;set role authenticated');
 await as(SALES);
 const original=await one('select * from save_team_task($1,0,$2,$3,$4,now()+interval \'1 day\',$5)',[TASK,'Recover a fictional task','Keep the original instructions','normal',ENGINEER]);
 await admin("update team_tasks set due_at='2026-10-01T09:10:45.123456+00:00' where id=$1",[TASK]);
 await admin('update staff set active=false where user_id=$1',[ENGINEER]);
 await as(OWNER);
 const before=await one('select *,due_at::text as due_text from team_tasks where id=$1',[TASK]);
 await check(async()=>{const page=await one('select team_task_page() data');assert.deepEqual(page.data.groups.inactive.rows.map(row=>row.id),[TASK]);});
 await as(OUTSIDER);
 await check(async()=>{assert.equal((await one('select team_task_page() data')).data.groups.inactive.total,0);await assert.rejects(one('select * from save_team_task($1,$2,$3,$4,$5,$6,$7)',[TASK,before.version,before.title,before.details,before.urgency,before.due_text,OUTSIDER]),/Only the person/);});
 await as(OWNER);
 await check(()=>assert.rejects(one('select * from save_team_task($1,$2,$3,$4,$5,$6,$7)',[TASK,before.version,before.title,before.details,before.urgency,before.due_text,ENGINEER]),/Choose an active employee/));
 const saved=await one('select * from save_team_task($1,$2,$3,$4,$5,$6,$7)',[TASK,before.version,before.title,before.details,before.urgency,before.due_text,OUTSIDER]);
 await check(async()=>{assert.equal(saved.assignee_user_id,OUTSIDER);assert.equal((await one('select due_at::text as due_text from team_tasks where id=$1',[TASK])).due_text,before.due_text);assert.equal(saved.status,'open');assert.equal(saved.reschedule_count,before.reschedule_count);assert.equal(saved.version,original.version+1);assert.equal((await one('select team_task_page() data')).data.groups.inactive.total,0);});
 const history=(await db.query("select * from team_task_events where task_id=$1 and action='assignment' order by created_at,id",[TASK])).rows;
 await check(async()=>{const change=history.find(event=>event.old_assignment?.assignee_user_id===ENGINEER&&event.new_assignment?.assignee_user_id===OUTSIDER);assert.ok(change);assert.equal(change.new_assignment.assignee_user_id,OUTSIDER);assert.equal(change.old_assignment.due_at,change.new_assignment.due_at);assert.equal(change.actor_user_id,OWNER);});
 await as(OUTSIDER);
 await check(async()=>{const page=await one('select team_task_page() data');assert.ok(page.data.groups.forMe.rows.some(row=>row.id===TASK));assert.equal((await one('select * from team_tasks where id=$1',[TASK])).details,before.details);});
 console.log(`PASS: ${checks} inactive-task recovery workflow checks; actual save RPC, inactive choice rejected, owner-only recovery, exact overdue deadline, original instructions, unchanged status and immutable assignment history.`);
}finally{await db.close();}
