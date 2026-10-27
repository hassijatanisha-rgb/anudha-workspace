import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const files=['staff-access.js','employee-login.js','two-step.js'];
function context(me={user_id:'owner',role:'owner'}){
 const names=new Map([['owner','Fixture Owner'],['employee','Alexandra Laboratory Support'],['other','Other Department'],['off','Former Employee']]);
 const ctx=vm.createContext({me,busy:false,employeeName:id=>names.get(id)||id,esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';')});
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

test('staff directory retains every employee with an active default and explicit area/account disclosures',()=>{
 const html=context().staffListHtml(rows);
 assert.match(html,/value="active">Active \(3\)/);assert.match(html,/value="all">All staff \(4\)/);assert.match(html,/value="inactive">Switched off \(1\)/);
 assert.match(rowHtml(html,'off'),/data-staff-state="inactive" hidden/);
 assert.match(rowHtml(html,'employee'),/Workflow areas for Alexandra Laboratory Support: 2/);
 assert.match(rowHtml(html,'employee'),/<summary>[\s\S]*data-staff-two-step-status[\s\S]*data-staff-accounting-status[\s\S]*<\/summary><div class="actions">/);
 assert.match(html,/scope="col">Actions/);assert.match(html,/aria-label="Edit phone for Alexandra Laboratory Support"/);
 assert.match(html,/aria-label="Reset password for Alexandra Laboratory Support"/);
 assert.match(html,/<table[^>]+role="table"/);assert.equal((html.match(/role="columnheader"/g)||[]).length,6);
 assert.equal((rowHtml(html,'employee').match(/class="staff-cell-label" aria-hidden="true"/g)||[]).length,6);
});

test('compact actions preserve owner self restrictions and department-head management boundaries',()=>{
 const owner=context().staffListHtml(rows),self=rowHtml(owner,'owner');
 assert.doesNotMatch(self,/data-staff-reset=|data-staff-phone=|data-staff-role=|data-staff-active=/);
 assert.match(self,/data-staff-department="owner"/);
 const head=context({user_id:'head',role:'head',department:'service',access:['service']}).staffListHtml(rows);
 assert.match(rowHtml(head,'employee'),/data-staff-reset="employee"/);assert.match(rowHtml(head,'employee'),/data-staff-access="employee"/);
 assert.doesNotMatch(rowHtml(head,'other'),/data-staff-reset=|data-staff-phone=|data-staff-access=|data-staff-active=/);
 assert.doesNotMatch(head,/data-staff-role=|data-staff-department=|data-staff-accounting-status/);
 assert.doesNotMatch(head,/Department changes save automatically/);
});

test('employee and phone text are escaped in visible identity, labels and searchable attributes',()=>{
 const ctx=context();ctx.employeeName=()=>'<img src=x onerror=bad()> & Example';
 const html=ctx.staffListHtml([{...rows[1],phone:'" onmouseover="bad()'}]);
 assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&#60;img/);assert.match(html,/&#34; onmouseover=&#34;bad\(\)/);
});

function directory(entries){
 const search={value:''},filter={value:'active'},count={},empty={hidden:true};
 return {search,filter,count,empty,entries,querySelector:selector=>({'[data-staff-search]':search,'[data-staff-filter]':filter,'[data-staff-count]':count,'[data-staff-empty]':empty})[selector],querySelectorAll:()=>entries};
}
const entry=(id,state,text)=>({dataset:{staffRow:id,staffState:state,staffSearchValue:text},hidden:false});
test('search and status filters combine without reordering or changing employee identities',()=>{
 const list=directory([entry('first','active','alex laboratory service +255700000001'),entry('second','active','sam laboratory sales'),entry('third','inactive','alex former service')]),ctx=context();
 ctx.document={querySelectorAll:selector=>selector==='[data-staff-directory]'?[list]:[]};ctx.bindStaffList([]);
 assert.deepEqual(list.entries.map(row=>row.hidden),[false,false,true]);
 list.search.value='LAB service';list.search.oninput();assert.deepEqual(list.entries.map(row=>row.hidden),[false,true,true]);
 list.filter.value='all';list.search.value='alex';list.filter.onchange();assert.deepEqual(list.entries.map(row=>row.hidden),[false,true,false]);
 list.filter.value='inactive';list.filter.onchange();assert.deepEqual(list.entries.map(row=>row.hidden),[true,true,false]);
 assert.match(list.count.textContent,/1 switched off employees · 3 total/);
 list.search.value='no match';list.search.oninput();assert.equal(list.empty.hidden,false);
 assert.deepEqual(list.entries.map(row=>row.dataset.staffRow),['first','second','third']);
});

test('department-head list filters remain independent for own and other departments',()=>{
 const mine=directory([entry('mine','active','alex service')]),other=directory([entry('other','active','sam sales')]),ctx=context();
 ctx.document={querySelectorAll:selector=>selector==='[data-staff-directory]'?[mine,other]:[]};ctx.bindStaffList([]);
 mine.search.value='missing';mine.search.oninput();assert.equal(mine.entries[0].hidden,true);assert.equal(other.entries[0].hidden,false);
 assert.match(other.count.textContent,/1 active employees/);
});

test('filtering does not change the employee targeted by an account action',()=>{
 const list=directory([entry('employee','active','alexandra service'),entry('other','active','other sales')]),ctx=context(),opened=[];
 const buttons=list.entries.map(row=>({dataset:{staffPhone:row.dataset.staffRow,phone:'+255700000001'}}));
 ctx.document={querySelectorAll:selector=>selector==='[data-staff-directory]'?[list]:selector==='[data-staff-phone]'?buttons:[]};
 ctx.openStaffPhone=(...args)=>opened.push(args);ctx.bindStaffList(rows);
 list.search.value='other';list.search.oninput();assert.equal(list.entries[0].hidden,true);
 buttons[1].onclick();assert.deepEqual(opened,[['other','Other Department','+255700000001']]);
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
