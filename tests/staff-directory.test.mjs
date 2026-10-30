import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {statusTone} from './helpers/status-ui.mjs';

const files=['staff-access.js','employee-login.js','two-step.js'];
function context(me={user_id:'owner',role:'owner',department:'management'}){
 const names=new Map([['owner','Fixture Owner'],['employee','Alexandra Laboratory Support'],['other','Other Department'],['off','Former Employee']]);
 const ctx=vm.createContext({workspacePageHeader,statusTone,me,busy:false,employeeName:id=>names.get(id)||id,esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';')});
 for(const file of files)vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 return ctx;
}
const rows=[
 {user_id:'owner',role:'owner',active:true,department:'management',access:[],phone:''},
 {user_id:'employee',role:'staff',active:true,department:'service',access:['service','stock'],phone:'+255700000001'},
 {user_id:'other',role:'staff',active:true,department:'sales',access:['proformas'],phone:''},
 {user_id:'off',role:'staff',active:false,department:'service',access:[],phone:''}
];
const rowHtml=(html,id)=>html.match(new RegExp(`<tr data-staff-row="${id}"[\\s\\S]*?</tr>`))[0];

test('staff directory starts with only the signed-in department and compact primary identity',()=>{
 const html=context().staffListHtml(rows);
 assert.match(html,/value="active">Active \(3\)/);assert.match(html,/value="all">All staff \(4\)/);assert.match(html,/value="inactive">Switched off \(1\)/);
 assert.match(html,/data-staff-group="management" open/);assert.match(html,/data-staff-group="service"><summary/);
 assert.equal((html.match(/data-staff-row=/g)||[]).length,1);assert.doesNotMatch(html,/data-staff-row="employee"|data-staff-row="off"/);
 const self=rowHtml(html,'owner');assert.match(self,/data-staff-two-step-status/);
 assert.match(html,/<table[^>]+role="table"/);assert.equal((html.match(/role="columnheader"/g)||[]).length,5);
 assert.equal((self.match(/class="staff-cell-label" aria-hidden="true"/g)||[]).length,5);
 assert.ok(self.indexOf('data-staff-two-step-status')<self.indexOf('staff-account-details'));
});

test('actual paging keeps a large directory under its DOM and text budget, including expanded controls',()=>{
 const ctx=context({user_id:'owner',role:'owner',department:'service'});
 const large=Array.from({length:500},(_,i)=>({user_id:'employee-'+String(i).padStart(3,'0'),role:'staff',active:true,department:i<250?'service':'sales',access:['leads','proformas','deliveries','service','purchasing','stock','stock_count','travel','reports','records'],phone:'+255700000001'}));
 const state={search:'',filter:'active',department:'service',page:0},first=ctx.staffDirectoryGroups(large,state);
 assert.equal((first.match(/data-staff-row=/g)||[]).length,6);assert.doesNotMatch(first,/employee-006/);assert.doesNotMatch(first,/employee-250/);
 assert.ok((first.match(/<[a-z][^>]*>/g)||[]).length<1500);assert.ok(first.replace(/<[^>]*>/g,' ').split(/\s+/).length<1500);
 state.page=1;const second=ctx.staffDirectoryGroups(large,state);assert.match(second,/employee-006/);assert.doesNotMatch(second,/data-staff-row="employee-000"/);
 state.page=999;const last=ctx.staffDirectoryPage(large,state);assert.equal(state.page,41);assert.equal(last.visible.length,4);assert.equal(last.pages,42);
});

test('compact actions preserve owner self restrictions and department-head management boundaries',()=>{
 const owner=context().staffDirectoryRows(rows),self=rowHtml(owner,'owner');
 assert.doesNotMatch(self,/data-staff-reset=|data-staff-phone=|data-staff-role=|data-staff-active=/);assert.match(self,/data-staff-department="owner"/);
 const head=context({user_id:'head',role:'head',department:'service',access:['service']}).staffDirectoryRows(rows);
 assert.match(rowHtml(head,'employee'),/data-staff-reset="employee"/);assert.match(rowHtml(head,'employee'),/data-staff-access="employee"/);
 assert.doesNotMatch(rowHtml(head,'other'),/data-staff-reset=|data-staff-phone=|data-staff-access=|data-staff-active=/);
 assert.doesNotMatch(head,/data-staff-role=|data-staff-department=|data-staff-accounting-status/);
 assert.match(rowHtml(head,'other'),/data-staff-two-step-status/);
 assert.match(rowHtml(owner,'employee'),/staff-account-details[\s\S]*data-staff-role="employee"[\s\S]*data-staff-department="employee"[\s\S]*<div class="actions">[\s\S]*data-staff-reset="employee"/);
});

test('employee and phone text are escaped in visible identity and controls',()=>{
 const ctx=context();ctx.employeeName=()=>'<img src=x onerror=bad()> & Example';
 const html=ctx.staffDirectoryRows([{...rows[1],phone:'" onmouseover="bad()'}]);
 assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&#60;img/);assert.match(html,/&#34; onmouseover=&#34;bad\(\)/);
});

test('name search spans departments and status filtering changes the actual rendered slice',()=>{
 const ctx=context(),state={search:'LABORATORY Support',filter:'active',department:'management',page:5};
 const result=ctx.staffDirectoryPage(rows,state);assert.equal(state.department,'service');assert.equal(state.page,0);assert.deepEqual([...result.visible.map(row=>row.user_id)],['employee']);
 state.search='';state.filter='inactive';const inactive=ctx.staffDirectoryGroups(rows,state);assert.match(inactive,/data-staff-row="off"/);assert.doesNotMatch(inactive,/data-staff-row="employee"/);
 state.search='no match';const empty=ctx.staffDirectoryGroups(rows,state);assert.equal((empty.match(/data-staff-row=/g)||[]).length,0);
});

test('page and group changes refresh decorators on new rows without replacing the search field',()=>{
 const ctx=context(),search={value:''},filter={value:'active'},count={},focus=[],calls=[];
 let group={isConnected:true,open:false,dataset:{staffGroup:'service'}},next={dataset:{staffPage:'next'}};
 const results={innerHTML:'',querySelectorAll:selector=>selector==='[data-staff-group]'?[group]:selector==='[data-staff-page]'?[next]:[],querySelector:selector=>({focus:()=>focus.push(selector)})};
 const directory={isConnected:true,querySelectorAll:()=>[],querySelector:selector=>({'[data-staff-save-notice]':{replaceChildren(){}},'[data-staff-search]':search,'[data-staff-filter]':filter,'[data-staff-results]':results,'[data-staff-count]':count})[selector]};
 ctx.document={querySelectorAll:selector=>selector==='[data-staff-directory]'?[directory]:[]};
 ctx.decorateStaffTwoStep=async()=>calls.push('two-step');ctx.decorateStaffAccounting=async()=>calls.push('accounting');ctx.bindStaffList(rows);
 group.open=true;group.ontoggle();assert.match(results.innerHTML,/data-staff-group="service" open/);assert.match(results.innerHTML,/data-staff-row="employee"/);assert.deepEqual(calls,['two-step','accounting']);
 search.value='Other';search.oninput();assert.match(results.innerHTML,/data-staff-group="sales" open/);assert.match(results.innerHTML,/data-staff-row="other"/);assert.doesNotMatch(results.innerHTML,/data-staff-row="employee"/);assert.equal(search.value,'Other');
 const previous=results.innerHTML;ctx.me={user_id:'replacement',role:'owner'};search.value='Fixture';search.oninput();assert.equal(results.innerHTML,previous);
});

test('paged account controls keep the exact employee identity',()=>{
 const ctx=context(),opened=[],button={dataset:{staffPhone:'other',phone:'+255700000001'}};
 ctx.document={querySelectorAll:selector=>selector==='[data-staff-phone]'?[button]:[]};ctx.openStaffPhone=(...args)=>opened.push(args);
 ctx.bindStaffActions(rows);button.onclick();assert.deepEqual(opened,[['other','Other Department','+255700000001']]);
});

test('two-step status stays visible for self but reset actions follow the existing management control',async()=>{
 const ctx=context(),statuses=[{},{},{}],inserted=[];
 const list=['owner','employee','other'].map((id,index)=>{
  const cell={querySelector:()=>null,insertAdjacentHTML:(_,html)=>inserted.push({id,html})};
  return {isConnected:true,dataset:{staffRow:id},querySelector:selector=>selector==='[data-staff-two-step-status]'?statuses[index]:selector==='[data-staff-reset]'&&id==='employee'?{closest:()=>cell}:null,querySelectorAll:()=>[]};
 });
 ctx.document={querySelectorAll:()=>list};ctx.client={rpc:async()=>({data:list.map(row=>({user_id:row.dataset.staffRow,enabled:true}))})};
 await ctx.decorateStaffTwoStep();assert.deepEqual(statuses.map(status=>status.textContent),['Two-step: on','Two-step: on','Two-step: on']);
 assert.equal(inserted.length,1);assert.equal(inserted[0].id,'employee');assert.match(inserted[0].html,/aria-label="Reset two-step for Alexandra Laboratory Support"/);
});

test('failed status requests show unavailable instead of claiming account protection is off',async()=>{
 for(const kind of ['two-step','accounting']){
  const ctx=context(),status={textContent:'checking'},row={isConnected:true,dataset:{staffRow:'employee'},querySelector:selector=>selector.includes('status')?status:null,querySelectorAll:()=>[]};
  ctx.document={querySelectorAll:()=>[row]};ctx.client={rpc:async()=>({error:{message:'Unavailable'}})};
  if(kind==='two-step')await ctx.decorateStaffTwoStep();else await ctx.decorateStaffAccounting();assert.match(status.textContent,/unavailable/);
 }
});

test('late account-status responses leave detached Staff rows and replacement sessions untouched',async()=>{
 for(const kind of ['two-step','accounting'])for(const change of ['detached','session']){
  const ctx=context(),status={textContent:'checking'},row={isConnected:true,dataset:{staffRow:'employee'},querySelector:selector=>selector.includes('status')?status:null,querySelectorAll:()=>[]};let finish;
  ctx.document={querySelectorAll:()=>[row]};ctx.client={rpc:()=>new Promise(resolve=>{finish=resolve;})};
  const pending=kind==='two-step'?ctx.decorateStaffTwoStep():ctx.decorateStaffAccounting();
  if(change==='detached')row.isConnected=false;else ctx.me={user_id:'owner',role:'owner'};
  finish({data:[{user_id:'employee',enabled:true,active:true}]});await pending;assert.equal(status.textContent,'checking');
 }
});
