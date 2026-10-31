import {workspacePageHeader} from './helpers/page-header.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const code=readFileSync(new URL('../employee-names.js',import.meta.url),'utf8');
const feedback=readFileSync(new URL('../action-feedback.js',import.meta.url),'utf8'),app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const runSource=app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const saved={user_id:'person',display_name:'Fatima',name_version:5};
function fixture(){
 const document=dom(),prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 // Extend the identity fixture only for the real shared feedback lifecycle; no layout claim.
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 prototype.removeAttribute=function(key){delete this.attrs[key]};prototype.prepend=function(node){this.insertBefore(node,this.children[0]||null)};
 prototype.getBoundingClientRect=()=>({left:20,bottom:40,width:100,height:30});prototype.getClientRects=function(){return this.isConnected?[{}]:[]};
 Object.defineProperties(prototype,{type:{get(){return this.attrs.type||''},set(value){this.attrs.type=value}},form:{get(){return this.closest('form')}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},style:{get(){return this._style??={setProperty(key,value){this[key]=value}}}},classList:{get(){const node=this;return {contains:name=>node.className.split(' ').includes(name),add:name=>{if(!node.className.split(' ').includes(name))node.className=(node.className+' '+name).trim()},remove:name=>{node.className=node.className.split(' ').filter(value=>value!==name).join(' ')}}}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};
 const timers=new Map();let timerId=0;
 const root=document.createElement('section');root.setAttribute('id','content');document.body.append(root);root.innerHTML='<h1>Staff</h1><input id="search"><div data-staff-directory><details open><summary>Sales</summary><article>Employee</article></details></div>';const directory=root.querySelector('[data-staff-directory]');directory.staffEpoch=1;
 let patches=0;directory.staffRefresh=()=>patches++;const calls=[];
 const c=vm.createContext({workspacePageHeader,document,busy:false,me:{user_id:'owner',role:'owner'},view:'staff',$:selector=>document.querySelector(selector),getComputedStyle:()=>({visibility:'visible'}),setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearTimeout:id=>timers.delete(id),FormData:class{constructor(form){this.form=form;}get(name){return this.form.querySelector(`[name="${name}"]`).value;}},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='lookup_staff_display_name'?{user_id:'person',name_version:4}:saved};}},staff:()=>assert.fail('No Staff reload')});const dialogs=installWorkspaceDialogFixture(c);vm.runInContext(feedback+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+runSource+'\n'+code,c);c.openEmployeeNameEditor();const dialog=document.querySelector('dialog'),form=dialog.querySelector('form');form.querySelector('[name="email"]').value='person@example.invalid';form.querySelector('[name="displayName"]').value='Fatima';
 return {c,dialogs,document,root,directory,dialog,form,calls,timers,patches:()=>patches,save:()=>form.onsubmit({preventDefault(){},target:form})};
}
test('name saves update only the name cache and retained directory, without refetching names or Staff',async()=>{
 const f=fixture(),header=f.root.querySelector('h1'),search=f.root.querySelector('input'),group=f.directory.querySelector('details');await f.save();assert.equal(f.c.employeeName('person'),'Fatima');assert.equal(f.patches(),1);assert.equal(f.root.querySelector('h1'),header);assert.equal(f.root.querySelector('input'),search);assert.equal(f.directory.querySelector('details'),group);assert.equal(group.open,true);assert.deepEqual(f.calls.map(call=>call.name),['lookup_staff_display_name','set_staff_display_name']);assert.match(f.dialog.textContent,/Employee name saved/);assert.equal(f.form.querySelector('[type="submit"]').disabled,true);await f.save();assert.equal(f.calls.length,2);assert.equal(f.document.activeElement,f.dialog.querySelector('[type="button"]'));
});
test('incomplete success locks the form and retries only a scoped lookup',async()=>{
 const f=fixture();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:name==='lookup_staff_display_name'?{user_id:'person',name_version:4}:null};};await f.save();assert.equal(f.patches(),0);assert.equal(f.form.querySelector('[type="submit"]').disabled,true);const retry=f.dialog.querySelectorAll('button').find(button=>button.textContent==='Retry refresh');assert.ok(retry);f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {error:{message:'Offline <now>'}};};await retry.onclick();assert.match(f.dialog.textContent,/Refresh failed: Offline <now>/);assert.equal(f.patches(),0);f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:saved};};await retry.onclick();assert.equal(f.patches(),1);assert.equal(f.c.employeeName('person'),'Fatima');assert.equal(f.calls.filter(call=>call.name==='set_staff_display_name').length,1);assert.equal(retry.isConnected,false);
});
test('a refused write retains typed fields and allows correction',async()=>{
 const f=fixture();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return name==='lookup_staff_display_name'?{data:{user_id:'person',name_version:4}}:{error:{message:'Name changed; refresh'}};};await f.save();assert.equal(f.form.querySelector('[type="submit"]').disabled,false);assert.equal(f.form.querySelector('[name="displayName"]').value,'Fatima');assert.equal(f.patches(),0);assert.match(f.dialog.textContent,/Name changed; refresh/);
});
test('replaced actors and dismissed dialogs suppress late write and read-only recovery outcomes',async()=>{
 for(const change of ['actor','dialog'])for(const fail of [false,true]){
  const f=fixture(),wait=deferred();f.c.client.rpc=async name=>name==='lookup_staff_display_name'?{data:{user_id:'person',name_version:4}}:wait.promise;const pending=f.save();await new Promise(resolve=>setImmediate(resolve));if(change==='actor')f.c.me={...f.c.me};else f.dialog.close();if(fail)wait.reject(Error('Old write'));else wait.resolve({data:saved});await pending;assert.equal(f.patches(),0);assert.equal(f.c.employeeName('person'),'Employee name not set');
 }
});
test('same-user actor replacement during lookup stops the name write',async()=>{
 const f=fixture(),wait=deferred();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise;};const pending=f.save();f.c.me={...f.c.me};wait.resolve({data:{user_id:'person',name_version:4}});await pending;assert.equal(f.calls.length,1);assert.equal(f.patches(),0);
});
test('receipt validation rejects mismatched names, identifiers and older versions',()=>{
 const f=fixture();for(const row of [null,{}, {...saved,user_id:'other'}, {...saved,name_version:4},{...saved,display_name:'Wrong'}, {...saved,name_version:'5'}])assert.throws(()=>f.c.employeeNameReceipt(row,saved),/could not be verified/);assert.equal(f.c.employeeNameReceipt({...saved,name_version:6,display_name:'Newer name'},saved).display_name,'Newer name');
});
test('the actual Save callback shows immediate shared busy feedback and keeps its confirmed lock',async()=>{
 const f=fixture(),wait=deferred(),button=f.form.querySelector('[type="submit"]'),input=f.form.querySelector('[name="displayName"]'),rpc=f.c.client.rpc;button.setAttribute('aria-busy','false');button.focus();
 f.c.client.rpc=async(name,args)=>{if(name==='lookup_staff_display_name')await wait.promise;return rpc(name,args)};
 const pending=f.save();assert.equal(f.c.busy,true);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.classList.contains('action-is-busy'),true);assert.match(f.dialog.querySelector('[role="status"]').textContent,/Saving name/);assert.equal(input.value,'Fatima');assert.equal(f.document.activeElement,button);
 await f.save();assert.equal(f.calls.length,0);wait.resolve();await pending;
 assert.equal(f.calls.filter(call=>call.name==='set_staff_display_name').length,1);assert.equal(button.disabled,true);assert.equal(input.disabled,true);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(button.classList.contains('action-is-busy'),false);assert.equal(f.c.busy,false);assert.equal(f.document.activeElement,f.dialog.querySelector('[type="button"]'));
 const success=f.dialog.querySelector('.action-feedback-success');assert.equal(success.textContent,'Employee name saved.');const timer=[...f.timers.values()].find(timer=>timer.delay===4000);assert.ok(timer);timer.fn();assert.equal(success.isConnected,true);assert.equal(success.inert,true);assert.equal(success.classList.contains('action-feedback-leaving'),true);[...f.timers.values()].find(timer=>timer.delay===150).fn();assert.equal(success.isConnected,false);assert.equal(f.dialog.querySelector('[role="alert"]').textContent,'Employee name saved.');
});
test('busy refusal keeps Save enabled and fields intact; an accepted retry removes its prior refusal',async()=>{
 const f=fixture(),button=f.form.querySelector('[type="submit"]'),notice=f.form.querySelector('[role="alert"]');f.c.busy=true;await f.save();assert.equal(button.disabled,false);assert.equal(f.calls.length,0);assert.equal(button.getAttribute('aria-busy'),null);assert.match(notice.textContent,/Another action is still running/);assert.equal(f.form.querySelector('[name="displayName"]').value,'Fatima');
 f.c.busy=false;await f.save();assert.equal(f.calls.length,2);assert.equal(button.disabled,true);assert.equal(notice.textContent,'Employee name saved.');assert.equal(f.dialog.querySelector('.action-feedback-error'),null);
});
test('a failed write restores Save and its original accessibility state without clearing entered values',async()=>{
 const f=fixture(),wait=deferred(),button=f.form.querySelector('[type="submit"]');f.c.client.rpc=()=>wait.promise;
 const pending=f.save();assert.equal(button.getAttribute('aria-busy'),'true');wait.reject(Error('<img src=x> Offline'));await pending;
 assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);assert.equal(f.form.querySelector('[name="email"]').value,'person@example.invalid');assert.equal(f.form.querySelector('[name="displayName"]').value,'Fatima');assert.equal(f.dialog.querySelector('img'),null);assert.match(f.form.querySelector('[role="alert"]').textContent,/<img src=x> Offline/);assert.equal(f.dialog.querySelector('.action-feedback-success'),null);
});
test('read-only Retry has shared busy feedback and refuses concurrent work without unlocking the saved form',async()=>{
 const f=fixture(),button=f.form.querySelector('[type="submit"]');f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:name==='lookup_staff_display_name'?{user_id:'person',name_version:4}:null};};await f.save();const retry=f.dialog.querySelectorAll('button').find(node=>node.textContent==='Retry refresh'),wait=deferred();assert.ok(retry);
 f.c.busy=true;await retry.onclick();assert.equal(retry.disabled,false);assert.equal(f.calls.length,2);assert.equal(button.disabled,true);assert.match(f.form.querySelector('[role="alert"]').textContent,/Another action is still running/);
 f.c.busy=false;f.c.client.rpc=(name,args)=>{f.calls.push({name,args});return wait.promise;};const pending=retry.onclick();assert.equal(retry.disabled,true);assert.equal(retry.getAttribute('aria-busy'),'true');assert.equal(retry.classList.contains('action-is-busy'),true);assert.match(f.dialog.querySelector('[role="status"]').textContent,/Refreshing name/);await retry.onclick();assert.equal(f.calls.length,3);
 wait.resolve({error:{message:'Still offline'}});await pending;assert.equal(retry.disabled,false);assert.equal(retry.getAttribute('aria-busy'),null);assert.equal(retry.classList.contains('action-is-busy'),false);assert.equal(button.disabled,true);assert.match(f.form.querySelector('[role="alert"]').textContent,/Name saved\. Refresh failed: Still offline/);assert.equal(f.dialog.querySelector('.action-feedback-error'),null);
 f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:saved};};await retry.onclick();assert.equal(retry.isConnected,false);assert.equal(f.calls.filter(call=>call.name==='set_staff_display_name').length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.calls.slice(2).map(call=>call.args))),[{p_email:'person@example.invalid'},{p_email:'person@example.invalid'}]);assert.equal(button.disabled,true);assert.equal(f.patches(),1);assert.equal(f.document.activeElement,f.dialog.querySelector('[type="button"]'));assert.equal(f.dialog.querySelector('.action-feedback-success').textContent,'Employee name saved.');
});
test('read-only Retry suppresses late feedback and cache changes after actor replacement or dismissal',async()=>{
 for(const change of ['actor','dialog'])for(const fail of [false,true]){
  const f=fixture();f.c.client.rpc=async name=>({data:name==='lookup_staff_display_name'?{user_id:'person',name_version:4}:null});await f.save();const retry=f.dialog.querySelectorAll('button').find(node=>node.textContent==='Retry refresh'),wait=deferred();f.c.client.rpc=()=>wait.promise;const pending=retry.onclick();
  if(change==='actor')f.c.me={...f.c.me};else f.dialog.close();if(fail)wait.reject(Error('Old read'));else wait.resolve({data:saved});await pending;
  assert.equal(f.patches(),0);assert.equal(f.c.employeeName('person'),'Employee name not set');assert.equal(f.dialog.querySelector('.action-feedback-success'),null);assert.doesNotMatch(f.dialog.textContent,/Old read/);assert.equal(retry.getAttribute('aria-busy'),null);assert.equal(retry.classList.contains('action-is-busy'),false);assert.equal(f.c.busy,false);
 }
});
test('employee-name dirty dismissal retains input, blocks working saves, and permits Done only after confirmation',async()=>{
 const f=fixture(),close=f.dialog.querySelector('[type="button"]'),binding=f.dialogs.bindings.get(f.dialog),wait=deferred();assert.equal(f.dialogs.opened[0].size,'medium');assert.equal(binding.isDirty(),true);assert.equal(await close.onclick(),false);assert.equal(f.calls.length,0);
 const rpc=f.c.client.rpc;f.c.client.rpc=async(name,args)=>{if(name==='lookup_staff_display_name')await wait.promise;return rpc(name,args);};const pending=f.save();assert.equal(binding.isBusy(),true);assert.equal(await close.onclick(),false);wait.resolve();await pending;assert.equal(binding.isDirty(),false);assert.equal(binding.isBusy(),false);assert.equal(close.textContent,'Done');await close.onclick();assert.equal(f.dialog.isConnected,false);assert.equal(f.calls.filter(call=>call.name==='set_staff_display_name').length,1);
});
test('employee-name refusal stays dirty and read-only receipt recovery stays protected while working',async()=>{
 const f=fixture(),binding=f.dialogs.bindings.get(f.dialog),close=f.dialog.querySelector('[type="button"]');f.c.client.rpc=async name=>name==='lookup_staff_display_name'?{data:{user_id:'person',name_version:4}}:{error:{message:'Refused'}};await f.save();assert.equal(binding.isDirty(),true);assert.equal(await close.onclick(),false);
 f.c.client.rpc=async name=>({data:name==='lookup_staff_display_name'?{user_id:'person',name_version:4}:null});await f.save();assert.equal(binding.isDirty(),false);const retry=f.dialog.querySelectorAll('button').find(button=>button.textContent==='Retry refresh'),wait=deferred();f.c.client.rpc=()=>wait.promise;const pending=retry.onclick();assert.equal(binding.isBusy(),true);assert.equal(await close.onclick(),false);wait.resolve({data:saved});await pending;assert.equal(binding.isBusy(),false);assert.equal(binding.isDirty(),false);
});
