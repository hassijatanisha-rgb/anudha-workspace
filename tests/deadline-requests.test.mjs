import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({esc:s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`),employeeName:id=>({w:'Worker <W>',h:'Head'})[id]||id,teamTaskTime:v=>String(v).slice(0,10)});
vm.runInContext(fs.readFileSync(new URL('../deadline-requests.js',import.meta.url),'utf8'),context);
const req=(over={})=>({id:'r1',task_id:'t1',requested_by:'w',status:'pending',old_due_at:'2026-10-15T10:00Z',requested_due_at:'2026-10-20T10:00Z',reason:'Customer <away>',...over});

test('pending requests split into my own (by task) and those waiting for my decision',()=>{
 const rows=[req(),req({id:'r2',task_id:'t2',requested_by:'h'}),req({id:'r3',task_id:'t3',status:'approved'})];
 const forWorker=context.deadlineRequestGroups(rows,'w');
 assert.deepEqual([...forWorker.mine.keys()],['t1']);assert.deepEqual(forWorker.toDecide.map(r=>r.id),['r2']);
 const forHead=context.deadlineRequestGroups(rows,'h');
 assert.deepEqual([...forHead.mine.keys()],['t2']);assert.deepEqual(forHead.toDecide.map(r=>r.id),['r1'],'decided requests are not listed');
});

test('request and note text name both deadlines and escape user text',()=>{
 const html=context.deadlineRequestHtml(req());
 assert.match(html,/Worker &#60;W&#62; asks for more time/);assert.match(html,/2026-10-15 → asked <strong>2026-10-20<\/strong>/);
 assert.match(html,/Customer &#60;away&#62;/);assert.match(html,/data-deadline-decide="approved" data-id="r1"/);
 assert.match(context.deadlineRequestCardNote(req()),/waiting for your department head/);
});

test('My tasks offers Ask for more time to the person doing it and Reschedule only to the owner',()=>{
 const source=fs.readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8');
 assert.match(source,/owner\|\|typeof openDeadlineRequest!=='function'\?`<button type="button" data-team-task-move=/);
 assert.match(source,/data-team-task-ask="\$\{esc\(row\.id\)\}">Ask for more time/);
 assert.match(source,/else if\(d\.teamTaskAsk\)openDeadlineRequest/);
 assert.match(fs.readFileSync(new URL('../notification-bell.js',import.meta.url),'utf8'),/client\.rpc\('raise_team_task_overdue_alerts'\)/);
});
