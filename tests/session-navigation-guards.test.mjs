import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const rows=[{user_id:'employee',role:'staff',active:true,phone:'',department:'sales',access:[]}];
function staffFixture(){
 const document=dom();document.body.innerHTML='<main id="content"></main>';
 const root=document.querySelector('#content'),queries=[],names=[],bound=[],decorated=[];
 const c=vm.createContext({document,workspacePageHeader,esc,me:{user_id:'head',role:'head',department:'sales'},view:'staff',sessionLoadEpoch:1,$:selector=>document.querySelector(selector),run:fn=>fn(),
  client:{from:table=>({select:columns=>{const pending=deferred();queries.push({table,columns,...pending});return pending.promise;}})},
  refreshEmployeeNamesFor:async ids=>names.push([...ids]),staffListHtml:data=>data.map(row=>`<p>${esc(row.user_id)}</p>`).join(''),bindStaffList:data=>bound.push(data),decorateStaffTwoStep:async()=>decorated.push(true)
 });
 vm.runInContext('function workspaceSkeleton(kind,label)'+source('workspace-refresh.js').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],c);
 vm.runInContext(source('staff-access.js'),c);
 return {c,document,root,queries,names,bound,decorated,list:()=>document.querySelector('#staffList')};
}
function navFixture(){
 const document=dom();document.body.innerHTML='<nav id="nav"><button data-accounting-only hidden>Accounting</button><button data-accounting-only hidden>Books</button></nav>';
 const nav=document.querySelector('#nav'),items=[...nav.querySelectorAll('button')],queries=[],resumed=[];
 const c=vm.createContext({document,me:{user_id:'owner',role:'owner'},sessionLoadEpoch:1,client:{rpc:name=>{const pending=deferred();queries.push({name,...pending});return pending.promise;}},navResumePending:()=>resumed.push(true)});
 vm.runInContext(source('workspace-navigation.js').split('let navWhileBusy=')[0],c);
 return {c,document,nav,items,queries,resumed};
}

test('current head load preserves the staff query, name hydration and directory binding',async()=>{
 const f=staffFixture(),pending=f.c.headStaffPage();assert.equal(f.document.querySelectorAll('h1').length,1);assert.equal(f.queries[0].table,'staff');assert.equal(f.queries[0].columns,'user_id,role,active,phone,department,access');
 f.queries[0].resolve({data:rows});await pending;assert.equal(f.list().textContent,'employee');assert.deepEqual(f.names,[['employee']]);assert.equal(f.bound[0],rows);assert.equal(f.decorated.length,1);
});
test('current head failures remain visible or reject without binding stale controls',async()=>{
 const f=staffFixture(),pending=f.c.headStaffPage();f.queries[0].resolve({error:{message:'<offline>'}});await pending;assert.match(f.list().textContent,/Staff could not load: <offline>/);assert.equal(f.list().querySelector('offline'),null);assert.deepEqual(f.names,[]);assert.deepEqual(f.bound,[]);
 const thrown=staffFixture(),request=thrown.c.headStaffPage();thrown.queries[0].reject(Error('Current failure'));await assert.rejects(request,/Current failure/);
});
const staffChanges={
 'same-ID replacement actor':f=>{f.c.me={...f.c.me,department:'service'};},
 'new session epoch':f=>{f.c.sessionLoadEpoch++;},
 'different view':f=>{f.c.view='personal';},
 'replacement content root':f=>{const replacement=f.document.createElement('main');replacement.setAttribute('id','content');replacement.innerHTML='<div id="staffList">New session</div>';f.root.replaceWith(replacement);},
 'disconnected root':f=>{f.root.remove();},
 'replacement list in same root':f=>{f.root.innerHTML='<div id="staffList">New page</div>';},
 'new owner/head load request':f=>{f.root.staffLoadRequest++;}
};
for(const [label,change] of Object.entries(staffChanges))test(`head read cannot publish after ${label}`,async()=>{
 for(const outcome of ['rows','error','reject']){
  const f=staffFixture(),pending=f.c.headStaffPage(),original=f.list();change(f);const target=f.list()||original,html=target.innerHTML;
  if(outcome==='reject')f.queries[0].reject(Error('Old failure'));else f.queries[0].resolve(outcome==='rows'?{data:rows}:{error:{message:'Old failure'}});
  await pending;assert.equal(target.innerHTML,html);assert.deepEqual(f.names,[]);assert.deepEqual(f.bound,[]);assert.deepEqual(f.decorated,[]);
 }
});
for(const [label,change] of Object.entries(staffChanges))test(`head name hydration cannot publish after ${label}`,async()=>{
 for(const reject of [false,true]){
  const f=staffFixture(),names=deferred(),started=deferred();f.c.refreshEmployeeNamesFor=()=>{started.resolve();return names.promise;};const pending=f.c.headStaffPage();f.queries[0].resolve({data:rows});await started.promise;const original=f.list();change(f);const target=f.list()||original,html=target.innerHTML;
  if(reject)names.reject(Error('Old names failure'));else names.resolve();await pending;assert.equal(target.innerHTML,html);assert.deepEqual(f.bound,[]);assert.deepEqual(f.decorated,[]);
 }
});
test('overlapping head loads publish only the latest directory',async()=>{
 const f=staffFixture(),first=f.c.headStaffPage(),second=f.c.headStaffPage(),latest=[{...rows[0],user_id:'latest'}];f.queries[1].resolve({data:latest});await second;const rendered=f.list().firstElementChild;f.queries[0].resolve({data:rows});await first;assert.equal(f.list().firstElementChild,rendered);assert.equal(f.list().textContent,'latest');assert.deepEqual(f.names,[['latest']]);assert.equal(f.bound.length,1);
});

test('current accounting result reveals only allowed links and resumes the pending route once',async()=>{
 for(const allowed of [true,false]){
  const f=navFixture(),pending=f.c.showAccountingNavigation();assert.deepEqual(f.items.map(item=>item.hidden),[true,true]);assert.equal(f.queries[0].name,'accounting_access');f.queries[0].resolve({data:allowed});await pending;assert.deepEqual(f.items.map(item=>item.hidden),[!allowed,!allowed]);assert.equal(f.resumed.length,1);
 }
 const failed=navFixture(),pending=failed.c.showAccountingNavigation();failed.queries[0].reject(Error('Unavailable'));await pending;assert.deepEqual(failed.items.map(item=>item.hidden),[true,true]);assert.equal(failed.resumed.length,1);
});
const navChanges={
 'replacement staff actor':f=>{f.c.me={user_id:'staff',role:'staff'};},
 'same-ID replacement actor':f=>{f.c.me={...f.c.me};},
 'new session epoch':f=>{f.c.sessionLoadEpoch++;},
 'replaced nav root':f=>{const replacement=f.document.createElement('nav');replacement.setAttribute('id','nav');replacement.innerHTML='<button data-accounting-only hidden>New accounting</button>';f.nav.replaceWith(replacement);},
 'disconnected nav':f=>{f.nav.remove();},
 'replaced menu items':f=>{f.nav.innerHTML='<button data-accounting-only hidden>New accounting</button>';},
 'original item moved outside nav':f=>{f.document.body.append(f.items[0]);}
};
for(const [label,change] of Object.entries(navChanges))test(`old accounting grant cannot unhide links or resume after ${label}`,async()=>{
 for(const reject of [false,true]){
  const f=navFixture(),pending=f.c.showAccountingNavigation();change(f);if(reject)f.queries[0].reject(Error('Old failure'));else f.queries[0].resolve({data:true});await pending;assert.ok(f.items.every(item=>item.hidden));assert.ok(f.document.querySelectorAll('[data-accounting-only]').every(item=>item.hidden));assert.deepEqual(f.resumed,[]);
 }
});
test('older accounting grants, denials and failures cannot overwrite the latest decision',async()=>{
 for(const latest of [true,false])for(const old of [true,false,'reject']){
  const f=navFixture(),first=f.c.showAccountingNavigation(),second=f.c.showAccountingNavigation();f.queries[1].resolve({data:latest});await second;if(old==='reject')f.queries[0].reject(Error('Old failure'));else f.queries[0].resolve({data:old});await first;assert.deepEqual(f.items.map(item=>item.hidden),[!latest,!latest]);assert.equal(f.resumed.length,1);
 }
});
test('an accounting read for a missing actor or disconnected menu does not start',async()=>{
 for(const change of [f=>{f.c.me=null;},f=>{f.nav.remove();}]){const f=navFixture();change(f);await f.c.showAccountingNavigation();assert.equal(f.queries.length,0);assert.deepEqual(f.resumed,[]);}
});
