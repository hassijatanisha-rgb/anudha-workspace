import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){
 const ctx=vm.createContext({esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>({a:'Asha',b:'Baraka'}[id]||'Employee name not set'),Date,Math,Number,String});
 vm.runInContext(readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8'),ctx);return ctx;
}
test('elapsed time reads in minutes, hours, then days',()=>{
 const ctx=load(),now=Date.parse('2026-09-30T12:00:00Z');
 assert.equal(ctx.workSince('2026-09-30T11:45:00Z',now),'15 min');
 assert.equal(ctx.workSince('2026-09-30T02:00:00Z',now),'10 h');
 assert.equal(ctx.workSince('2026-09-25T12:00:00Z',now),'5 days');
 assert.equal(ctx.workSince('2026-10-01T12:00:00Z',now),'0 min','clock skew never shows negative time');
});
test('only open handoffs past their due date are overdue',()=>{
 const ctx=load();
 assert.equal(ctx.workOverdue({status:'open',due_on:'2026-09-29'},'2026-09-30'),true);
 assert.equal(ctx.workOverdue({status:'open',due_on:'2026-09-30'},'2026-09-30'),false);
 assert.equal(ctx.workOverdue({status:'done',due_on:'2026-01-01'},'2026-09-30'),false);
 assert.equal(ctx.workOverdue({status:'open',due_on:null},'2026-09-30'),false);
});
test('responsible line names assignee, task and sender and escapes text',()=>{
 const ctx=load();
 assert.match(ctx.workResponsibleHtml(null),/nobody assigned/);
 const html=ctx.workResponsibleHtml({assignee_user_id:'a',assigned_by:'b',task:'<b>Pack</b>',due_on:null,created_at:new Date().toISOString(),status:'open'});
 assert.match(html,/Asha/);assert.match(html,/sent by Baraka/);assert.match(html,/&#60;b&#62;Pack/);assert.doesNotMatch(html,/<b>Pack/);
});
test('every workflow screen, the task list, sign-out and print are wired',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
 for(const file of ['sales-delivery.js','service-workflow.js','sales-leads.js','pending-stock.js'])assert.match(read(file),/typeof decorateWorkHandoffs==='function'\)decorateWorkHandoffs\(\)\.catch/,file);
 assert.match(read('personal-workspace.js'),/kind==='task'&&typeof renderMyHandoffs==='function'\)renderMyHandoffs\(target\)/);
 assert.match(read('app.js'),/typeof clearWorkAssignments==='function'\)clearWorkAssignments\(\)/);
 assert.match(read('style.css'),/@media print\{\.work-handoff\{display:none!important\}\}/);
 const html=read('index.html');assert.ok(html.indexOf('work-assignments.js')>html.indexOf('pending-stock.js')&&html.indexOf('work-assignments.js')<html.indexOf('app.js'));
});
