import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.js'),runSource=app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const profile={user_id:'actor',display_name:'Original Name',name_version:2,phone:null,contact_email:'shared@example.com',role:'owner',department:'sales'};
function fixture(view){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 // Only DOM identity is modelled; actual feedback/run and both user callbacks execute unchanged.
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 prototype.removeAttribute=function(key){delete this.attrs[key]};prototype.prepend=function(node){this.insertBefore(node,this.children[0]||null)};
 prototype.getBoundingClientRect=()=>({left:20,bottom:40,width:100,height:30});prototype.getClientRects=function(){return this.isConnected?[{}]:[]};prototype.reportValidity=function(){return this.valid!==false};
 Object.defineProperties(prototype,{type:{get(){return this.attrs.type||''},set(value){this.attrs.type=value}},form:{get(){return this.closest('form')}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},style:{get(){return this._style??={}}},classList:{get(){const node=this;return {contains:name=>node.className.split(' ').includes(name),add:name=>{if(!node.className.split(' ').includes(name))node.className=(node.className+' '+name).trim()},remove:name=>{node.className=node.className.split(' ').filter(value=>value!==name).join(' ')}}}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={style:{},dataset:{},clientWidth:1280,clientHeight:900};
 document.body.innerHTML='<div id="identity"><span class="identity-name">Original Name</span></div><div id="notice"></div><section id="content"><h1>My settings</h1><div id="settingsProfile"></div></section>';
 const timers=new Map(),calls=[],reads=[],handlers={};let timerId=0,requestId=0;
 const f={document,calls,reads,timers,handlers,root:document.querySelector('#content'),section:document.querySelector('#settingsProfile')};
 f.read=table=>({data:table.endsWith('questions')?[{id:'q',title:'Decision',question:'Choose the delivery day',version:2}]:[],count:table.endsWith('questions')?1:0});
 handlers.get_my_staff_profile=()=>({data:{...profile}});handlers.save_my_staff_profile=args=>({data:{...profile,...args.p_values,name_version:3}});handlers.record_project_approval=args=>({data:{id:args.p_id,question_id:args.p_question_id,question_version:args.p_version,answer:args.p_answer,answered_by:'actor',created_at:'2026-10-29'}});
 const c=f.c=vm.createContext({workspacePageHeader,statusTone,document,window:{addEventListener(){}},busy:false,sessionLoadEpoch:1,me:{user_id:'actor',role:'owner'},view,$:selector=>document.querySelector(selector),employeeDirectory:new Map(),roleLabels:{owner:'Owner'},departmentLabel:value=>value,localStorage:{getItem:()=>null},esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getComputedStyle:()=>({visibility:'visible'}),setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=>`request-${++requestId}`},client:{rpc:(name,args)=>{calls.push({name,args:args&&plain(args)});return handlers[name](args)},from:table=>{reads.push(table);return {select(){return this},eq(){return this},order(){return this},range(){return this},then(ok,no){return Promise.resolve().then(()=>f.read(table)).then(ok,no)}}}}});
 vm.runInContext(source('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+runSource,c);
 vm.runInContext('function workspaceSkeleton(kind,label)'+source('workspace-refresh.js').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],c);
 c.workspaceLoading=label=>{f.root.innerHTML=c.workspaceSkeleton('cards',label)};
 vm.runInContext(source('client-rules.js'),c);
 vm.runInContext(source('user-settings.js')+'\n'+source('project-approvals.js'),c);vm.runInContext("approvalFocus='q'",c);
 f.start=()=>view==='settings'?c.loadSettingsProfile(f.section):c.projectApprovals();
 f.form=()=>f.root.querySelector('form');f.submit=()=>f.form().querySelector('[type="submit"]');f.send=()=>f.form().onsubmit({preventDefault(){}});
 f.fill=()=>{const form=f.form();if(view==='settings'){form.elements.display_name.value='New Name';form.elements.phone.value='+255 (712) 345-678';form.elements.contact_email.value='SHARED@example.com';}else form.elements.answer.value='Approved <Friday>';};
 return f;
}
function pending(button,label){assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.classList.contains('action-is-busy'),true);assert.match(button.closest('form').textContent,new RegExp(label));}
function finished(button,disabled){assert.equal(button.disabled,disabled);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);}

test('profile Save shows shared progress, retains DOM/fields, refuses duplicate work, and publishes transient success',async()=>{
 const f=fixture('settings');await f.start();f.fill();const form=f.form(),button=f.submit(),header=f.root.querySelector('h1'),wait=deferred();f.handlers.save_my_staff_profile=()=>wait.promise;button.focus();
 const saving=f.send();pending(button,'Saving profile');assert.equal(button.textContent,'Save profile');assert.equal(form.elements.display_name.disabled,true);assert.equal(f.form(),form);assert.equal(f.root.querySelector('h1'),header);await f.send();assert.equal(f.calls.length,2);
 wait.resolve({data:{...profile,display_name:'New Name',phone:'+255712345678',name_version:3}});await saving;finished(button,false);assert.equal(form.elements.display_name.disabled,false);assert.equal(f.form(),form);assert.equal(f.document.activeElement,button);assert.equal(f.document.querySelector('.identity-name').textContent,'New Name');assert.equal(f.root.querySelector('.action-feedback-success').textContent,'Profile saved.');assert.ok([...f.timers.values()].some(timer=>timer.delay===4000));
 assert.deepEqual(f.calls[1].args,{p_expected_values:{display_name:'Original Name',name_version:2,phone:null,contact_email:'shared@example.com'},p_values:{display_name:'New Name',phone:'+255712345678',contact_email:'shared@example.com'}});
});
test('profile busy refusal preserves edits and does not disable controls or modify the expected snapshot',async()=>{
 const f=fixture('settings');await f.start();f.fill();const button=f.submit();f.c.busy=true;await f.send();finished(button,false);assert.equal(f.calls.length,1);assert.equal(f.form().elements.display_name.value,'New Name');assert.match(f.root.querySelector('[data-profile-error]').textContent,/Another action/);
 f.c.busy=false;await f.send();assert.equal(f.calls.length,2);assert.equal(f.root.querySelector('[data-profile-error]').textContent,'');assert.equal(f.root.querySelector('.action-feedback-error'),null);
});
test('unconfirmed profile Save keeps the draft and the explicit reload performs only a read with feedback',async()=>{
 const f=fixture('settings');await f.start();f.fill();const form=f.form(),button=f.submit();f.handlers.save_my_staff_profile=()=>({data:null});await f.send();finished(button,false);assert.equal(form.elements.phone.value,'+255 (712) 345-678');assert.match(form.querySelector('[data-profile-error]').textContent,/not confirmed/);assert.equal(f.root.querySelector('.action-feedback-success'),null);
 const reload=form.querySelector('[data-profile-reload]'),wait=deferred();f.c.busy=true;await reload.onclick();assert.equal(f.calls.length,2);assert.equal(f.form(),form);assert.match(form.querySelector('[data-profile-error]').textContent,/Another action/);
 f.c.busy=false;f.handlers.get_my_staff_profile=()=>wait.promise;const loading=reload.onclick();assert.equal(reload.getAttribute('aria-busy'),'true');assert.ok(f.section.querySelector('.workspace-skeleton'));assert.equal(f.calls.at(-1).name,'get_my_staff_profile');wait.resolve({data:{...profile}});await loading;finished(reload,false);assert.notEqual(f.form(),form);assert.equal(f.form().elements.display_name.value,'Original Name');assert.equal(f.calls.filter(call=>call.name==='save_my_staff_profile').length,1);
});
test('initial profile Reload refuses busy work and ignores a late response after the actor changes',async()=>{
 const f=fixture('settings');f.handlers.get_my_staff_profile=()=>({error:{message:'Offline <img>'}});await f.start();const reload=f.section.querySelector('[data-profile-reload]');assert.equal(f.section.querySelector('img'),null);f.c.busy=true;await reload.onclick();assert.equal(f.calls.length,1);finished(reload,false);
 f.c.busy=false;const wait=deferred();f.handlers.get_my_staff_profile=()=>wait.promise;const loading=reload.onclick();assert.equal(reload.getAttribute('aria-busy'),'true');f.c.me={...f.c.me};const before=f.section.innerHTML;wait.resolve({data:{...profile,display_name:'Old response'}});await loading;assert.equal(f.section.innerHTML,before);assert.equal(f.document.querySelector('.identity-name').textContent,'Original Name');assert.equal(f.c.busy,false);finished(reload,false);
});
test('approval Save has immediate feedback, one versioned write, and keeps Recorded disabled',async()=>{
 const f=fixture('approvals');await f.start();f.fill();const form=f.form(),button=f.submit(),wait=deferred();f.handlers.record_project_approval=()=>wait.promise;const saving=f.send();pending(button,'Saving answer');assert.equal(button.textContent,'Record answer');assert.equal(form.elements.answer.readOnly,true);await f.send();assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0],{name:'record_project_approval',args:{p_id:'request-1',p_question_id:'q',p_version:2,p_answer:'Approved <Friday>'}});wait.resolve({data:{id:'request-1',question_id:'q',question_version:2,answer:'Approved <Friday>',answered_by:'actor',created_at:'2026-10-29'}});await saving;finished(button,true);assert.equal(button.textContent,'Recorded');assert.equal(f.form(),form);assert.equal(f.root.querySelector('details').open,true);assert.equal(f.root.querySelector('friday'),null);assert.equal(f.root.querySelector('.action-feedback-success').textContent,'Answer recorded.');assert.ok([...f.timers.values()].some(timer=>timer.delay===4000));await f.send();assert.equal(f.calls.length,1);
});
test('approval busy refusal creates no attempt; uncertain retries retain the original identity and answer',async()=>{
 const f=fixture('approvals');await f.start();f.fill();const button=f.submit();f.c.busy=true;await f.send();assert.equal(f.calls.length,0);assert.equal(vm.runInContext('approvalAttempts.size',f.c),0);finished(button,false);assert.match(f.root.querySelector('.approvalStatus').textContent,/Another action/);
 f.c.busy=false;f.handlers.record_project_approval=()=>{throw Error('Connection lost')};await f.send();finished(button,false);assert.equal(button.textContent,'Retry same answer');assert.equal(f.form().elements.answer.readOnly,true);assert.equal(f.root.querySelector('.action-feedback-success'),null);assert.equal(f.root.querySelector('.action-feedback-error'),null);f.form().elements.answer.value='Must not replace the pending answer';await f.send();assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.calls[0].args.p_id,'request-1');
});
test('rejected approval offers a guarded read-only Reload with progress and cannot repeat the write',async()=>{
 const f=fixture('approvals');await f.start();f.fill();const button=f.submit();f.handlers.record_project_approval=()=>({error:{code:'P0001',message:'Version changed'}});await f.send();finished(button,false);assert.equal(button.textContent,'Reload current decision');assert.equal(button.type,'button');assert.equal(vm.runInContext('approvalAttempts.size',f.c),0);const reads=f.reads.length;
 f.c.busy=true;await button.onclick();assert.equal(f.reads.length,reads);assert.match(f.root.querySelector('.approvalStatus').textContent,/Another action/);f.c.busy=false;const wait=deferred(),read=f.read;f.read=()=>wait.promise;const loading=button.onclick();assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(f.calls.length,1);wait.resolve({data:[],count:0});await loading;finished(button,false);assert.equal(f.reads.length,reads+2);assert.equal(f.calls.length,1);f.read=read;
});
test('initial approval Retry uses shared progress and cannot reload a stale route',async()=>{
 const f=fixture('approvals');f.read=()=>({error:{message:'Unavailable'}});await f.start();const retry=f.root.querySelector('#retryApprovals'),reads=f.reads.length;f.c.busy=true;await retry.onclick();assert.equal(f.reads.length,reads);finished(retry,false);assert.match(f.root.querySelector('[role="alert"]').textContent,/Another action/);
 f.c.busy=false;const wait=deferred();f.read=()=>wait.promise;const loading=retry.onclick();assert.equal(retry.getAttribute('aria-busy'),'true');f.c.view='inventory';const before=f.root.innerHTML;wait.resolve({data:[],count:0});await loading;assert.equal(f.root.innerHTML,before);finished(retry,false);assert.equal(f.c.busy,false);const after=f.reads.length;await retry.onclick();assert.equal(f.reads.length,after);
});
test('both saves suppress late success/error feedback after same-user actor replacement',async()=>{
 for(const view of ['settings','approvals'])for(const rejected of [false,true]){
  const f=fixture(view);await f.start();f.fill();const wait=deferred(),button=f.submit(),handler=view==='settings'?'save_my_staff_profile':'record_project_approval';f.handlers[handler]=()=>wait.promise;const saving=f.send();f.c.me={...f.c.me};const before=f.root.innerHTML;if(rejected)wait.reject(Error('Old failure'));else wait.resolve({data:{...profile,display_name:'Old response'}});await saving;
  assert.doesNotMatch(f.root.textContent,/Old failure|Old response/);assert.equal(f.root.querySelector('.action-feedback-success'),null);assert.equal(f.c.employeeDirectory.size,0);assert.equal(f.c.busy,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);assert.ok(before.includes('action-is-busy'));
 }
});
