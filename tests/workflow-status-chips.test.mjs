import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {statusTone} from './helpers/status-ui.mjs';

const now=Date.parse('2026-10-29T10:00:00Z'),ago=minutes=>new Date(now-minutes*60000).toISOString();
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
function fixture(){
 const c=vm.createContext({workspacePageHeader,statusTone,Date:Clock,companyDate:()=> '2026-10-29',me:{user_id:'actor',role:'owner'},orgIndex:new Map(),salesProformas:[],employeeName:()=> 'Employee',document:{addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]},setInterval(){},clearInterval(){},esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 for(const name of ['sales-leads.js','packing-queue.js','work-assignments.js'])vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),c);return c;
}

test('Lead summary and detail distinguish active follow-up, won and closed-lost without styling contact roles as statuses',()=>{
 const c=fixture();
 for(const [stage,tone,label]of [['inquiry','warning','Needs a salesperson'],['lead','info','Following up'],['opportunity','info','Following up'],['won','success','Won'],['lost','neutral','Lost']]){
  const row={id:'lead',lead_number:'LD-1',subject:'Question',caller_name:'Caller',caller_role:'doctor',source:'phone',stage,next_action:'Call back',next_action_on:'2026-10-28'},before=JSON.stringify(row);
  for(const html of [c.leadCard(row),c.leadSummaryCard(row)])assert.ok(html.includes(`<span class="tag lead-tag-${stage} chip chip--${tone}">${label}</span>`));
  const detail=c.leadCard(row);assert.match(detail,/<span class="tag lead-role lead-role-doctor">Doctor \/ user<\/span>/);
  assert.equal(detail.includes('lead-next-late'),!['won','lost'].includes(stage));assert.equal(JSON.stringify(row),before);
 }
});

test('Customer-waiting badges use warning on phone and TV while elapsed-time alerts and queue priority are unchanged',()=>{
 const c=fixture(),row={id:'delivery',delivery_number:'DN-1',customer_waiting:true,taken_at:ago(31),queued_at:ago(40),organization:'Client',packer_name:'Employee',items:[],version:1},before=JSON.stringify(row);
 c.board={offset:0,amber_minutes:20,overdue_minutes:30,mine:row.id,can_release:false,waiting:[row],packing:[row]};vm.runInContext('packingBoard=board',c);
 assert.match(c.packingCard(row),/class="packing-badge chip chip--warning">Customer waiting<\/span>/);
 assert.match(c.packingWaitingRow(row,0),/class="packing-badge chip chip--warning">Customer waiting<\/span>/);
 assert.match(c.packingScreenHtml(),/class="packing-tv-badge chip chip--warning">CUSTOMER WAITING<\/em>/);
 assert.match(c.packingCard(row),/packing-red packing-lobby/);assert.match(c.packingCard(row),/Over 30 minutes/);
 assert.doesNotMatch(c.packingCard({...row,customer_waiting:false}),/packing-badge/);assert.equal(JSON.stringify(row),before);
});

test('Handoff closure is neutral because completion and cancellation both close the coordination task',()=>{
 const c=fixture();
 assert.match(c.workResponsibleHtml(null),/Handoff task: <strong class="chip chip--warning">unassigned<\/strong>/);
 for(const status of ['done','cancelled']){
  const timeline=c.workTimeline([{id:'step',status,task:'Call',assignee_user_id:'actor',created_at:ago(60),closed_at:ago(30)}]);
  assert.match(c.workResponsibleHtml(null,null,timeline),/Handoff task: <strong class="chip chip--neutral">closed<\/strong> · took 30 min in total/);
  assert.match(c.workResponsibleHtml(null,null,timeline,'service'),/Coordination handoff:/);
 }
});

test('Handoff history differentiates completed, handed-on and cancelled steps while an open step retains its elapsed text',()=>{
 const c=fixture();
 for(const [status,tone,label]of [['done','success','done'],['handed_on','info','handed on'],['cancelled','neutral','cancelled']]){
  const rows=[{id:'step',status,task:'Call',assignee_user_id:'actor',created_at:ago(60),closed_at:ago(30)}],before=JSON.stringify(rows),html=c.workTimelineHtml(c.workTimeline(rows));
  assert.ok(html.includes(`<span class="chip chip--${tone}">${label}</span>`));assert.equal(JSON.stringify(rows),before);
 }
 const open={id:'step',status:'open',task:'Call',assignee_user_id:'actor',created_at:ago(60)},html=c.workTimelineHtml(c.workTimeline([open]));
 assert.match(html,/1 h so far/);assert.doesNotMatch(html,/class="chip/);assert.doesNotMatch(c.workResponsibleHtml(open),/class="chip/);
});

test('Unrecognized historical state stays escaped and neutral',()=>{
 const c=fixture(),timeline=c.workTimeline([{id:'step',status:'<new-state>',task:'Call',created_at:ago(60),closed_at:ago(30)}]);
 assert.match(c.workTimelineHtml(timeline),/<span class="chip chip--neutral">&lt;new-state&gt;<\/span>/);
});
