import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';

const emptyGroup={rows:[],total:0,page:0,pages:1};
const emptyTasks={groups:Object.fromEntries(['forMe','gave','results','finished'].map(key=>[key,emptyGroup]))};
const emptyService={...emptyGroup,metrics:{awaiting_engineer:0,awaiting_date:0,oldest_engineer_days:null,oldest_date_days:null,due_30:0,overdue:0}};
const board={now:new Date().toISOString(),amber_minutes:20,overdue_minutes:30,can_release:true,mine:null,waiting:[],packing:[],coming:{count:0,items:[]}};
function visibleText(node){
 if(node.hidden||node.getAttribute?.('hidden')!==null&&node.getAttribute?.('hidden')!==undefined)return '';
 const children=node.tag==='details'&&!node.open?[node.querySelector('summary')]:node.children;
 return [node._text||'',...(children||[]).filter(Boolean).map(visibleText)].join(' ').replace(/\s+/g,' ').trim();
}
const words=node=>visibleText(node).split(/\s+/).filter(Boolean).length;
const content=f=>f.document.querySelector('#content');
function noProvisionalCopy(node){assert.doesNotMatch(visibleText(node),/\b(?:demo|rehearsal|training|launch)\b/i);}

for(const role of ['owner','staff'])test(`Empty My tasks stays under 300 visible words for ${role} with New task available`,async t=>{
 const f=mainPageFixture({role,rpcs:{team_task_page:emptyTasks,my_handoff_page:emptyGroup,deadline_request_page:{...emptyGroup,identities:[]},unowned_work:[]},tables:{work_notices:()=>[]}});
 await f.open({view:'personal',personalSection:'task'});
 const page=content(f),count=words(page);t.diagnostic(`Empty My tasks (${role}): ${count} visible words`);
 assert.match(visibleText(page),/My tasks/);assert.ok(count<300);noProvisionalCopy(page);
 assert.equal(page.querySelectorAll('[data-team-task-more]').length,0);assert.equal(page.querySelectorAll('.primary-action').length,1);
 assert.equal(page.querySelector('#teamTaskNew').disabled,false);assert.equal(typeof page.querySelector('#teamTaskNew').onclick,'function');
 assert.equal(page.querySelector('.workspace-page-header').querySelectorAll('p').length,1);
});

test('Empty installations keep one create action, short visible copy and collapsed guidance',async t=>{
 const f=mainPageFixture({rpcs:{service_case_page:emptyService}});await f.open({view:'service',serviceSection:'installations'});
 const page=content(f),count=words(page),help=page.querySelector('details');t.diagnostic(`Empty installations: ${count} visible words`);
 assert.match(visibleText(page),/Machines to install/);assert.ok(count<300);noProvisionalCopy(page);
 assert.equal(help.open,false);assert.equal(help.querySelector('summary').textContent,'How this page works');
 assert.doesNotMatch(visibleText(page),/Jobs awaiting an engineer or work date appear first/);help.open=true;assert.match(visibleText(page),/on-site work and reports require signed delivery/);
 assert.equal(page.querySelectorAll('[data-service-page]').length,0);assert.equal(page.querySelectorAll('.primary-action').length,1);
 assert.equal(page.querySelector('#serviceOpenIntake').disabled,false);assert.ok(page.querySelector('#serviceOpenIntake').events.click.length);
 assert.equal(page.querySelector('.workspace-page-header').querySelectorAll('p').length,1);
});

test('Task and installation summaries retain identity, person/customer, status and date with one Open action',async()=>{
 const f=mainPageFixture({rpcs:{service_case_page:emptyService}});await f.open({view:'service',serviceSection:'installations'});
 const task={id:'task',task_number:'TK-1',title:'Call the clinic',assignee_user_id:'actor',assigned_by:'actor',status:'open',urgency:'normal',due_at:'2099-01-01T09:00:00Z',details:'Private full instructions'};
 const job={id:'job',case_number:'INS-1',status:'new',scheduled_for:'2099-01-02',display:{product_name:'Analyzer',organization_name:'Clinic'},problem_summary:'Private service detail'};
 for(const [html,action,labels]of [[f.ctx.teamTaskSummaryCard(task),'data-team-task-open',['Call the clinic','Your own task','Due']], [f.ctx.serviceSummaryCard(job),'data-service-open',['Analyzer','Clinic','Work date: 2099-01-02']]]){
  const node=f.document.createElement('section');node.innerHTML=html;assert.equal(node.querySelectorAll('button').length,1);assert.equal(node.querySelectorAll('.primary-action').length,1);assert.ok(node.querySelector(`[${action}]`));assert.equal(node.querySelectorAll('.chip').length,1);
  for(const label of labels)assert.ok(visibleText(node).includes(label));assert.doesNotMatch(visibleText(node),/Private full instructions|Private service detail/);
 }
});

test('Saved task reconciliation hides empty paging controls and reuses them when tasks return',async()=>{
 const row={id:'task',task_number:'TK-1',title:'Call the clinic',assignee_user_id:'actor',assigned_by:'actor',status:'open',urgency:'normal',due_at:'2099-01-01T09:00:00Z'},tasks=structuredClone(emptyTasks);
 tasks.groups.forMe={rows:[row],total:1,page:0,pages:1};
 const f=mainPageFixture({rpcs:{team_task_page:tasks,my_handoff_page:emptyGroup,deadline_request_page:{...emptyGroup,identities:[]}},tables:{work_notices:()=>[]}});await f.open({view:'personal',personalSection:'task'});
 const pager=content(f).querySelector('[data-team-task-more]').closest('.actions');
 f.ctx.reconcileSavedTeamTaskGroups(emptyTasks.groups);assert.equal(pager.isConnected,true);assert.equal(pager.hidden,true);assert.doesNotMatch(visibleText(pager),/Previous|Next/);
 f.ctx.reconcileSavedTeamTaskGroups(tasks.groups);assert.equal(pager,content(f).querySelector('[data-team-task-more]').closest('.actions'));assert.equal(pager.hidden,false);assert.match(visibleText(pager),/1–1 of 1 tasks/);
});

test('Service amounts display whole TZS and two foreign-currency decimals without changing minor units',()=>{
 const f=mainPageFixture(),amount=125000050;
 assert.match(f.ctx.serviceMoney(125000000,'TZS'),/1,250,000$/);assert.doesNotMatch(f.ctx.serviceMoney(amount,'TZS'),/\.\d/);
 assert.match(f.ctx.serviceMoney(125050,'USD'),/1,250\.50$/);assert.match(f.ctx.serviceMoney(125000,'EUR'),/1,250\.00$/);
 assert.match(f.ctx.serviceMoney(amount,'TZS'),/1,250,001$/);assert.equal(f.ctx.serviceMoney(125000000),f.ctx.serviceMoney(125000000,'TZS'));
});

test('Packing puts repeated guidance behind one disclosure and keeps its primary action',async t=>{
 const f=mainPageFixture({rpcs:{packing_queue_board:board}});await f.open({view:'packing',packingSection:'queue'});
 const page=content(f),count=words(page),help=page.querySelector('details');t.diagnostic(`Empty Packing: ${count} visible words`);
 assert.equal(help.open,false);assert.equal(help.querySelector('summary').textContent,'How this page works');noProvisionalCopy(page);
 assert.doesNotMatch(visibleText(page),/Check every item|oldest delivery|stock reservation/);help.open=true;assert.match(visibleText(page),/Check every item before pressing Packed/);
 assert.equal(page.querySelectorAll('[data-packing-take]').length,1);assert.equal(page.querySelectorAll('.primary-action').length,1);
 assert.equal(page.querySelector('.workspace-page-header').querySelectorAll('p').length,1);
});

test('Packing shows overdue and stock warnings outside details; own order stays open and writes remain present',async()=>{
 const old=new Date(Date.now()-40*60000).toISOString(),row={id:'mine',delivery_number:'DN-1',version:4,organization:'Clinic',location:'Ward',packer_name:'Engineer',taken_at:old,queued_at:old,items:[{name:'Private item detail',quantity:2}],promised_by:old,call_customer:true,customer_waiting:false};
 const waiting={...row,id:'waiting',blocked_reason:'Stock reservation unavailable'},other={...row,id:'other',packer_name:'Other packer'};
 const f=mainPageFixture({rpcs:{packing_queue_board:{...board,now:new Date().toISOString(),mine:row.id,packing:[row,other],waiting:[waiting]}}});await f.open({view:'packing',packingSection:'queue'});
 const page=content(f),mine=page.querySelector('[data-packing-id="mine"]'),peer=page.querySelector('[data-packing-id="other"]');
 assert.equal(mine.querySelector('details').open,true);assert.equal(peer.querySelector('details').open,false);assert.doesNotMatch(visibleText(peer),/Private item detail|Packed by/);
 assert.match(visibleText(peer),/Over 30 minutes/);assert.match(visibleText(peer),/Call the customer/);assert.match(visibleText(page.querySelector('[data-packing-waiting-id="waiting"]')),/Stock reservation unavailable/);
 for(const card of [mine,peer]){assert.equal(card.querySelectorAll('.primary-action').length,1);assert.equal(card.querySelector('[data-packing-packed]').dataset.version,'4');assert.equal(card.querySelector('[data-packing-release]').dataset.version,'4');assert.equal(typeof card.querySelector('[data-packing-packed]').onclick,'function');assert.equal(typeof card.querySelector('[data-packing-release]').onclick,'function');}
 peer.querySelector('details').open=true;assert.match(visibleText(peer),/Private item detail/);assert.match(visibleText(peer),/Packed by Other packer/);
});
