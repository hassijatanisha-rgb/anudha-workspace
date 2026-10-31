import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const record={user_id:'one',role:'head',active:true,phone:'+255700000001',department:'sales',access:['records']};
function fixture(){
 const document=dom(),root=document.createElement('main');document.body.append(root);root.innerHTML='<header>Staff</header><form><input name="email" value="employee@example.invalid"><select name="role"></select><select name="active"></select><button type="submit">Save staff access</button></form><div data-staff-directory><input id="search"><article>Employee</article></div>';
 const form=root.querySelector('form'),directory=root.querySelector('[data-staff-directory]');form.querySelector('[name="role"]').value='head';form.querySelector('[name="active"]').value='true';directory.staffEpoch=1;directory.staffRows=[{...record,role:'staff'}];let patches=0;directory.staffRefresh=()=>patches++;const calls=[];
 const c=vm.createContext({workspacePageHeader,document,busy:false,run:fn=>fn(),me:{user_id:'owner',role:'owner'},view:'staff',FormData:class{constructor(form){this.form=form;}get(name){return this.form.querySelector(`[name="${name}"]`).value;}},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='lookup_staff_display_name'?{user_id:'one',display_name:'Employee',name_version:2}:null};},from:table=>({select(columns){calls.push({table,columns});return this;},eq(key,id){calls.at(-1).eq=[key,id];return this;},single:async()=>({data:record})})},staff:()=>assert.fail('No Staff reload')});
 for(const file of ['employee-names.js','staff-access.js','employee-login.js'])vm.runInContext(source(file),c);
 return {c,root,form,directory,calls,patches:()=>patches,save:()=>c.saveStaffMembership(form)};
}
test('legacy membership write keeps the shell/form and refreshes only the confirmed employee',async()=>{
 const f=fixture(),header=f.root.querySelector('header'),search=f.root.querySelector('#search');await f.save();assert.equal(f.root.querySelector('header'),header);assert.equal(f.root.querySelector('#search'),search);assert.equal(f.root.querySelector('form'),f.form);assert.equal(f.patches(),1);assert.equal(f.directory.staffRows[0].role,'head');assert.equal(f.form.querySelector('[type="submit"]').disabled,false);assert.match(f.form.textContent,/Staff membership saved/);assert.deepEqual(f.calls.map(call=>call.name||call.table),['manage_staff_email','lookup_staff_display_name','staff']);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{p_email:'employee@example.invalid',p_role:'head',p_active:true});assert.deepEqual(f.calls[2].eq,['user_id','one']);
});
test('a successful write with unreadable details stays locked and retries reads only',async()=>{
 const f=fixture();f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({error:{message:'Offline <now>'}})});await f.save();assert.match(f.form.textContent,/Staff membership saved.*Offline <now>/);assert.equal(f.form.querySelector('[type="submit"]').hidden,true);assert.equal(f.form.staffSavePending,true);await f.save();assert.equal(f.calls.filter(call=>call.name==='manage_staff_email').length,1);f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({data:record})});await f.form.querySelector('[data-staff-membership-retry]').onclick();assert.equal(f.patches(),1);assert.equal(f.form.staffSavePending,false);assert.equal(f.form.querySelector('[type="submit"]').hidden,false);assert.equal(f.calls.filter(call=>call.name==='manage_staff_email').length,1);
});
test('known failed writes permit correction and do not fetch employees',async()=>{
 const f=fixture();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {error:{message:'Owner required'}};};await assert.rejects(f.save(),error=>error.message==='Owner required');assert.equal(f.calls.length,1);assert.equal(f.form.staffSavePending,false);assert.equal(f.form.querySelector('[name="email"]').value,'employee@example.invalid');assert.equal(f.form.querySelector('[type="submit"]').disabled,false);
});
test('replacement actor, directory and route suppress late successful writes and failures',async()=>{
 for(const change of ['actor','route','epoch','disconnect'])for(const fail of [false,true]){
  const f=fixture(),wait=deferred();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise;};const saving=f.save();if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else if(change==='epoch')f.directory.staffEpoch++;else f.directory.remove();if(fail)wait.reject(Error('Old error'));else wait.resolve({data:null});await saving;assert.equal(f.calls.length,1);assert.equal(f.patches(),0);assert.equal(f.directory.staffRows[0].role,'staff');
 }
});
test('newly created memberships join the retained directory only after a verified staff read',async()=>{
 const f=fixture();f.directory.staffRows=[];await f.save();assert.equal(f.directory.staffRows.length,1);assert.equal(f.directory.staffRows[0].user_id,'one');assert.equal(f.patches(),1);
});

test('Staff landing suppresses stale reads before loading names or rendering another actor’s directory',async()=>{
 const staffSource=source('app.js').split('\n').find(line=>line.startsWith('async function staff(){'));
 for(const change of ['actor','route','newer'])for(const fail of [false,true]){
  const f=fixture(),wait=deferred(),rendered=[];f.c.$=selector=>selector==='#content'?f.root:f.root.querySelector(selector);f.c.field=()=>'';f.c.openEmployeeNameEditor=()=>{};f.c.openStaffListImport=()=>{};f.c.openStaffOnboarding=()=>{};f.c.refreshEmployeeNamesFor=async()=>rendered.push('names');f.c.staffListHtml=()=>{rendered.push('rows');return '';};f.c.bindStaffList=()=>{};f.c.client.from=()=>({select:()=>wait.promise});vm.runInContext('function workspaceSkeleton(kind,label)'+source('workspace-refresh.js').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],f.c);vm.runInContext(staffSource,f.c);
  const pending=f.c.staff();if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else f.root.staffLoadRequest++;if(fail)wait.reject(Error('Old directory'));else wait.resolve({data:[record]});await pending;assert.deepEqual(rendered,[]);
 }
});
