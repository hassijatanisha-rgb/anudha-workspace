import {workspacePageHeader} from './helpers/page-header.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {statusTone} from './helpers/status-ui.mjs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const event={preventDefault(){}};
function fixture(){
 const document=dom(),proto=Object.getPrototypeOf(document.body),matches=proto.matches;
 Object.defineProperty(proto,'className',{get(){return this.attrs.class||'';},set(value){this.attrs.class=value;}});
 Object.defineProperty(proto,'checked',{get(){return 'checked'in this.attrs;},set(value){if(value)this.attrs.checked='';else delete this.attrs.checked;}});
 proto.matches=function(selector){return (!selector.includes(':checked')||this.checked)&&matches.call(this,selector.replace(':checked',''));};
 document.body.innerHTML='<main id="content"><section data-staff-directory><article data-staff-row="employee"><span data-staff-accounting-status></span><span data-staff-two-step-status></span><div class="actions"><button data-staff-active="employee" data-active="false">Switch off login</button><button data-staff-reset="employee">Reset password</button></div></article></section></main>';
 const state={accept:true,confirmation:null,write:null,writeError:null,enabled:true},calls=[],questions=[],messages=[],saved=[];
 const c=vm.createContext({workspacePageHeader,document,statusTone,view:'staff',busy:false,me:{user_id:'owner',role:'owner',department:'sales'},employeeDirectory:new Map(),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),employeeName:()=>'<Test> Employee',message:text=>messages.push(text),$:selector=>document.querySelector(selector),run:fn=>fn(),actionFeedbackRefuse:()=>messages.push('busy refusal'),askConfirm:async options=>{questions.push(structuredClone(options));return state.confirmation?state.confirmation.promise:state.accept;},loadEmployeeNames:async()=>calls.push({read:'names'}),staff:()=>calls.push({refresh:'staff'}),client:{
  rpc:async(name,args)=>{calls.push({rpc:name,args:structuredClone(args)});if(name==='staff_accounting_access')return {data:[{user_id:'employee',active:true}]};if(name==='staff_two_step_status')return {data:[{user_id:'employee',enabled:true}]};if(name==='two_step_required')return {data:false};if(state.write)return state.write.promise;return {data:{user_id:'employee',active:false},error:state.writeError};},
  auth:{refreshSession:async()=>calls.push({refresh:'auth'}),mfa:{listFactors:async()=>({data:{totp:state.enabled?[{id:'original-factor',status:'verified'}]:[]}}),unenroll:async args=>{calls.push({unenroll:structuredClone(args)});if(state.write)return state.write.promise;if(!state.writeError)state.enabled=false;return {error:state.writeError};}}}
 }});
 const dialogs=installWorkspaceDialogFixture(c);
 for(const file of ['staff-access.js','two-step.js'])vm.runInContext(read(file),c);
 const employee=read('employee-login.js');vm.runInContext(employee.slice(employee.indexOf('function staffSaveContext('),employee.indexOf('function staffSavedRecord(')),c);
 c.staffAccountsCall=async args=>{calls.push({account:structuredClone(args)});if(state.write)return state.write.promise;if(state.writeError)throw Error(state.writeError.message);return {employee_id:'test.employee',temporary_password:'FICTIONAL-ONLY'};};
 const main=document.querySelector('main'),directory=main.querySelector('[data-staff-directory]'),row=directory.querySelector('[data-staff-row]'),person={user_id:'employee',active:true,role:'staff',department:'sales',access:['leads'],phone:''};
 directory.staffEpoch=1;directory.staffRows=[person];directory.staffUnverified=new Set();
 const writes=()=>calls.filter(call=>call.account||call.unenroll||['set_staff_active','set_accounting_access'].includes(call.rpc));
 return {c,dialogs,document,state,calls,questions,messages,saved,main,directory,row,person,writes};
}
async function action(kind){
 const f=fixture();let button,submit;
 if(kind==='login'){button=f.row.querySelector('[data-staff-active]');submit=()=>f.c.setStaffActive(f.person,false,(...args)=>f.saved.push(args));}
 if(kind==='accounting'){await f.c.decorateStaffAccounting();button=f.row.querySelector('[data-accounting]');submit=()=>button.onclick();}
 if(kind==='reset'){await f.c.decorateStaffTwoStep();button=f.row.querySelector('[data-two-step-reset]');submit=()=>button.onclick();}
 if(kind==='disable'){f.c.view='settings';await f.c.renderTwoStepSettings(f.main);button=f.main.querySelector('#twoStepOff');submit=()=>button.events.click[0].fn();}
 if(kind==='create'){
  f.c.openStaffListImport();const dialog=f.document.querySelector('dialog'),form=dialog.querySelector('form'),file=form.elements.file;
  file.files=[{text:async()=>JSON.stringify({format:'anudha-staff-list-v1',rows:[{full_name:'Selected Staff',role:'staff',department:'sales',start:true},{full_name:'Selected Head',role:'head',department:'sales',start:true}]})}];
  await file.onchange();button=form.querySelector('[type="submit"]');submit=()=>form.onsubmit(event);Object.assign(f,{dialog,form,file});
 }
 return {...f,button,submit};
}
for(const kind of ['login','accounting','reset','disable','create']){
 test(`${kind}: rejection writes nothing and leaves controls and displayed state unchanged`,async()=>{
  const f=await action(kind),before=f.main.innerHTML;f.state.accept=false;await f.submit();assert.equal(f.writes().length,0);assert.equal(f.main.innerHTML,before);assert.equal(f.button.disabled,false);assert.equal(f.messages.length,0);
  assert.equal(f.questions.length,1);assert.equal(f.questions[0].tone,kind==='create'?'normal':'danger');assert.equal(f.questions[0].confirmLabel,{login:'Switch off login',accounting:'Remove accounting access',reset:'Reset two-step sign-in',disable:'Turn off two-step sign-in',create:'Create selected logins'}[kind]);
 });
 test(`${kind}: acceptance keeps the exact server action and receipt behavior`,async()=>{
  const f=await action(kind);await f.submit();
  const expected={login:[{rpc:'set_staff_active',args:{p_user_id:'employee',p_active:false}}],accounting:[{rpc:'set_accounting_access',args:{p_user_id:'employee',p_active:false}}],reset:[{account:{action:'reset_two_step',user_id:'employee'}}],disable:[{unenroll:{factorId:'original-factor'}}],create:['Selected Head','Selected Staff'].map(full_name=>({account:{action:'create',full_name,phone:'',role:full_name.endsWith('Head')?'head':'staff',department:'sales',access:[]}}))};
  assert.deepEqual(f.writes(),expected[kind]);
  if(kind==='login')assert.equal(f.saved.length,1);
  if(kind==='accounting')assert.equal(f.row.querySelector('[data-staff-accounting-status]').textContent,'Accounting: off');
  if(kind==='reset')assert.equal(f.row.querySelector('[data-two-step-reset]'),null);
  if(kind==='disable')assert.equal(f.calls.filter(call=>call.refresh==='auth').length,1);
  if(kind==='create'){assert.equal(f.form.hidden,true);assert.match(f.dialog.textContent,/2 logins created/);assert.match(f.dialog.textContent,/FICTIONAL-ONLY/);}
 });
 for(const change of ['actor','role','route','detach','selection'])test(`${kind}: ${change} while confirmation is open cannot write`,async()=>{
  const f=await action(kind),wait=deferred();f.state.confirmation=wait;const pending=f.submit();assert.equal(f.questions.length,1);assert.equal(f.writes().length,0);
  if(change==='actor')f.c.me={...f.c.me};
  if(change==='role')f.c.me.role='staff';
  if(change==='route')f.c.view='personal';
  if(change==='detach')(kind==='create'?f.dialog:kind==='disable'?f.button.parentElement:f.row).remove();
  if(change==='selection'){
   if(kind==='login')f.directory.staffRows[0]={...f.person};
   if(kind==='accounting')f.button.dataset.on='false';
   if(kind==='reset'){await f.c.decorateStaffTwoStep();}
   if(kind==='disable')f.button.parentElement.innerHTML='<p>Replacement settings</p>';
   if(kind==='create')f.form.querySelector('[data-row]').checked=false;
  }
  wait.resolve(true);await pending;assert.equal(f.writes().length,0);assert.equal(f.saved.length,0);assert.equal(f.messages.length,0);
 });
}
test('bulk login confirmation rejects a replaced file, changed generation and a concurrent busy action without locking',async()=>{
 for(const change of ['file','generation','busy']){
  const f=await action('create'),wait=deferred();f.state.confirmation=wait;const pending=f.submit();
  if(change==='file')f.file.files=[{...f.file.files[0]}];
  if(change==='generation')await f.file.onchange();
  if(change==='busy')f.c.busy=true;
  wait.resolve(true);await pending;assert.equal(f.writes().length,0);assert.equal(f.button.disabled,false);assert.equal(f.file.disabled,false);assert.equal(f.form.hidden,false);
 }
});
test('repeated bulk submit during one confirmation creates only the accepted selection once',async()=>{
 const f=await action('create'),wait=deferred();f.state.confirmation=wait;const pending=f.submit();await f.submit();assert.equal(f.questions.length,1);wait.resolve(true);await pending;assert.equal(f.writes().length,2);
});
test('late bulk credentials and two-step disable results never continue in a replacement actor context',async()=>{
 for(const kind of ['create','disable']){
  const f=await action(kind),wait=deferred();f.state.write=wait;const pending=f.submit();await new Promise(setImmediate);assert.equal(f.writes().length,1);f.c.me={...f.c.me};wait.resolve(kind==='create'?{employee_id:'old.employee',temporary_password:'STALE-CREDENTIAL'}:{});await pending;
  assert.equal(f.writes().length,1);assert.equal(f.calls.filter(call=>call.read==='names'||call.refresh==='auth').length,0);assert.equal(f.messages.length,0);assert.doesNotMatch(f.document.body.textContent,/STALE-CREDENTIAL/);
 }
});
test('server refusal remains a failure after confirmation without a success receipt',async()=>{
 for(const kind of ['login','accounting','reset','disable']){
  const f=await action(kind),before=f.main.innerHTML;f.state.writeError={message:'Server refused'};await assert.rejects(f.submit(),/Server refused/);assert.equal(f.writes().length,1);assert.equal(f.main.innerHTML,before);assert.equal(f.saved.length,0);assert.equal(f.messages.length,0);
 }
});
test('bulk dialog preserves a selected list and blocks dismissal during confirmation and creation',async()=>{
 const f=await action('create'),binding=f.dialogs.bindings.get(f.dialog),close=f.form.querySelector('[data-close]'),confirm=deferred(),write=deferred();assert.equal(f.dialogs.opened[0].size,'large');assert.equal(binding.isDirty(),true);assert.equal(await close.onclick(),false);assert.equal(f.writes().length,0);
 f.state.confirmation=confirm;f.state.write=write;const pending=f.submit();assert.equal(binding.isBusy(),true);assert.equal(await close.onclick(),false);confirm.resolve(true);await new Promise(setImmediate);assert.equal(f.writes().length,1);assert.equal(await close.onclick(),false);
 f.state.write=null;write.resolve({employee_id:'test.employee',temporary_password:'FICTIONAL-ONLY'});await pending;assert.equal(binding.isBusy(),false);assert.equal(binding.isDirty(),false);await f.dialog.querySelector('[data-step="done"] [data-close]').onclick();assert.equal(f.dialog.isConnected,false);assert.equal(f.writes().length,2);
});
