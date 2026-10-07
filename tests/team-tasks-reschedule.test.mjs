import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const giver='00000000-0000-4000-8000-0000000000d2',worker='00000000-0000-4000-8000-0000000000d3';
function load(user,role='staff'){
 const ctx=vm.createContext({me:{user_id:user,role},employeeName:id=>id===giver?'Asha':'Baraka',esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';')});
 vm.runInContext(read('team-tasks.js')+';Object.assign(globalThis,{teamTaskCard,teamTaskCanMove,setMoves:m=>{teamTaskMoves=m}});',ctx);return ctx;
}
const task=(extra={})=>({id:'t1',task_number:'TK-000001',title:'Call the official',details:'',urgency:'urgent',due_at:'2099-01-01T09:00:00Z',assignee_user_id:worker,assigned_by:giver,status:'open',version:1,reschedule_count:0,...extra});

test('the person doing a task sees Reschedule until 3 moves are used, never Edit',()=>{
 const {teamTaskCard}=load(worker);
 for(const n of [0,1,2]){const html=teamTaskCard(task({reschedule_count:n}));assert.match(html,/data-team-task-move=/);assert.match(html,/Mark done/);assert.doesNotMatch(html,/data-team-task-edit=/);}
 const used=teamTaskCard(task({reschedule_count:3}));
 assert.doesNotMatch(used,/data-team-task-move=/);assert.match(used,/Mark done/);assert.match(used,/Rescheduled 3 of 3/);assert.match(used,/ask Asha/);
 assert.doesNotMatch(teamTaskCard(task({status:'done',closed_at:'2099-01-01T00:00:00Z'})),/data-team-task-move=/);
});
test('the person who gave the task edits or cancels as before and does not reschedule',()=>{
 const html=load(giver).teamTaskCard(task({reschedule_count:3}));
 assert.match(html,/data-team-task-edit=/);assert.match(html,/data-team-task-cancel=/);assert.doesNotMatch(html,/data-team-task-move=/);
});
test('the card shows the tag and the history with old due, new due, reason and who',()=>{
 const ctx=load(giver);assert.doesNotMatch(ctx.teamTaskCard(task()),/Rescheduled|Reschedule history/);
 ctx.setMoves(new Map([['t1',[{task_id:'t1',old_due_at:'2099-01-01T09:00:00Z',new_due_at:'2099-01-03T09:00:00Z',note:'Called, no answer <again>',actor_user_id:worker,created_at:'2098-12-31T10:00:00Z'}]]]));
 const html=ctx.teamTaskCard(task({reschedule_count:1}));
 assert.match(html,/Rescheduled 1 of 3/);assert.match(html,/Reschedule history · 1/);assert.match(html,/Called, no answer &#60;again&#62;/);assert.match(html,/Baraka/);
});
test('the reschedule dialog uses actionForm and the database RPC',()=>{
 const js=read('team-tasks.js');
 assert.match(js,/actionForm\('Reschedule task'/);assert.match(js,/client\.rpc\('reschedule_team_task',\{p_id:row\.id,p_expected_version:row\.version,p_new_due:/);
});
test('the migration keeps the limit in the database and locks the function down',()=>{
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort(),at=files.indexOf('202610070068_task_reschedule.sql');
 assert.match(files[at-1],/^\d{8}0067_/,'next number in sequence');assert.equal(files.filter(f=>/^\d{8}0068_/.test(f)).length,1);
 const sql=read('supabase/migrations/202610070068_task_reschedule.sql');
 assert.match(sql,/^-- [\s\S]*?-- Rollback:/);assert.match(sql,/\nbegin;[\s\S]*\ncommit;\n$/);
 assert.match(sql,/reschedule_count integer not null default 0 check \(reschedule_count between 0 and 3\)/);
 assert.match(sql,/reschedule_count >= 3 then raise exception/);assert.match(sql,/security definer set search_path=public,pg_temp/);
 assert.match(sql,/revoke all on function public\.reschedule_team_task\(uuid,integer,timestamptz,text\) from public, anon;/);
 assert.match(sql,/grant execute on function public\.reschedule_team_task\(uuid,integer,timestamptz,text\) to authenticated;/);
});
