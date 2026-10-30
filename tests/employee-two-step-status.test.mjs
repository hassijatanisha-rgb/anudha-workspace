import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dom} from './helpers/dom-identity.mjs';
import {statusTone} from './helpers/status-ui.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(){
 const document=dom();Object.defineProperty(Object.getPrototypeOf(document.body),'className',{get(){return this.attrs.class||'';},set(value){this.attrs.class=value;}});
 document.body.innerHTML='<main id="content"></main>';
 const calls=[],messages=[],state={enabled:true,required:false,factorError:null,statuses:[{user_id:'employee',enabled:true}],statusError:null,readWait:null,writeWait:null,writeError:null};
 const c=vm.createContext({workspacePageHeader,document,statusTone,esc,view:'staff',me:{user_id:'owner',role:'owner',department:'sales'},employeeName:id=>'Person <'+id+'> & Co',askConfirm:async()=>true,run:fn=>fn(),message:text=>messages.push(text),$:selector=>document.querySelector(selector),client:{
  rpc:async name=>{calls.push({rpc:name});if(name==='two_step_required')return {data:state.required};assert.equal(name,'staff_two_step_status');return state.readWait?state.readWait.promise:{data:state.statuses,error:state.statusError};},
  functions:{invoke:async(name,{body})=>{assert.equal(name,'staff-accounts');calls.push({account:JSON.parse(JSON.stringify(body))});if(state.writeWait)return {data:await state.writeWait.promise};return state.writeError?{error:{message:state.writeError}}:{data:{}};}},
  auth:{mfa:{listFactors:async()=>({data:{totp:state.enabled?[{id:'factor',status:'verified'}]:[]},error:state.factorError})}}
 }});
 for(const file of ['staff-access.js','employee-login.js','two-step.js'])vm.runInContext(source(file),c);
 const main=document.querySelector('main');
 const addRow=(id='employee',manage=true)=>{main.insertAdjacentHTML('beforeend',`<article data-staff-row="${id}"><span data-staff-two-step-status aria-live="polite">Two-step: checking…</span><div class="actions">${manage?'<button data-staff-reset="'+id+'">Reset password</button>':''}</div></article>`);return main.querySelector(`[data-staff-row="${id}"]`);};
 return {c,document,main,state,calls,messages,addRow};
}

test('login status chips preserve active/off labels, row states, escaped identity and role text',()=>{
 const f=fixture(),rows=[true,false].map((active,i)=>({user_id:'employee-'+i,role:'staff',active,department:'sales',access:['leads'],phone:''}));
 f.main.innerHTML=f.c.staffDirectoryRows(rows);
 for(const [i,active] of [true,false].entries()){
  const row=f.main.querySelector(`[data-staff-row="employee-${i}"]`),status=row.querySelector('.staff-login-state');
  assert.equal(status.textContent,active?'Active':'Switched off');assert.match(status.className,new RegExp('chip chip--'+(active?'success':'neutral')));assert.equal(row.dataset.staffState,active?'active':'inactive');
  assert.match(row.querySelector('.staff-role-cell').textContent,/RoleStaff/);assert.doesNotMatch(row.querySelector('.staff-role-cell').innerHTML,/chip--/);
 }
 assert.equal(f.main.querySelector('employee-0'),null);assert.match(f.main.textContent,/Person <employee-0> & Co/);
});

for(const [enabled,required,tone] of [[true,true,'success'],[true,false,'success'],[false,true,'warning'],[false,false,'neutral']])test(`settings ${enabled?'on':'off'} / ${required?'required':'optional'} uses ${tone} with existing controls`,async()=>{
 const f=fixture();Object.assign(f.state,{enabled,required});f.c.view='settings';await f.c.renderTwoStepSettings(f.main);
 const status=f.main.querySelector('.tag');assert.equal(status.textContent,enabled?'On':'Off');assert.match(status.className,new RegExp('chip--'+tone));
 assert.equal(!!f.main.querySelector('#twoStepOff'),enabled&&!required);assert.equal(!!f.main.querySelector('#twoStepOn'),!enabled);
 assert.deepEqual(f.calls,[{rpc:'two_step_required'}]);
});

test('unavailable factor settings keep the escaped alert instead of claiming two-step is off',async()=>{
 const f=fixture();f.state.factorError={message:'Offline <img src=x> & "retry"'};await f.c.renderTwoStepSettings(f.main);
 assert.match(f.main.querySelector('[role="alert"]').textContent,/Could not check: Offline <img src=x>/);assert.equal(f.main.querySelector('img'),null);assert.equal(f.main.querySelector('.chip'),null);assert.equal(f.calls.length,0);
});

test('staff two-step read distinguishes off from missing/failed results and retains live labels',async()=>{
 const f=fixture();f.state.statuses=[{user_id:'employee',enabled:true},{user_id:'off',enabled:false}];
 const rows=[f.addRow(),f.addRow('off'),f.addRow('unknown')];await f.c.decorateStaffTwoStep();
 for(const [index,tone,label] of [[0,'success','Two-step: on'],[1,'neutral','Two-step: off'],[2,'danger','Two-step unavailable']]){
  const status=rows[index].querySelector('[data-staff-two-step-status]');assert.equal(status.textContent,label);assert.equal(status.className,'chip chip--'+tone);assert.equal(status.getAttribute('aria-live'),'polite');
 }
 assert.equal(rows[1].querySelector('[data-two-step-reset]'),null);assert.equal(rows[2].querySelector('[data-two-step-reset]'),null);
 const error=fixture(),row=error.addRow();error.state.statusError={message:'Unavailable'};await error.c.decorateStaffTwoStep();assert.match(row.querySelector('[data-staff-two-step-status]').className,/chip--danger/);assert.equal(row.querySelector('[data-two-step-reset]'),null);
});

test('confirmed reset keeps the existing request and updates only its status and reset receipt',async()=>{
 const f=fixture(),row=f.addRow();await f.c.decorateStaffTwoStep();const status=row.querySelector('[data-staff-two-step-status]'),button=row.querySelector('[data-two-step-reset]');
 assert.equal(button.getAttribute('aria-label'),'Reset two-step for Person <employee> & Co');assert.equal(row.querySelector('employee'),null);
 await button.onclick();assert.equal(row.querySelector('[data-staff-two-step-status]'),status);assert.equal(status.textContent,'Two-step: off');assert.match(status.className,/chip--neutral/);
 assert.equal(row.querySelector('[data-two-step-reset]'),null);const receipt=row.querySelector('.muted');assert.equal(receipt.textContent,'Two-step reset');assert.match(receipt.className,/chip--success/);
 assert.deepEqual(f.calls,[{rpc:'staff_two_step_status'},{account:{action:'reset_two_step',user_id:'employee'}}]);assert.equal(f.messages.length,1);
});

test('failed reset retains the confirmed on status and retry control',async()=>{
 const f=fixture(),row=f.addRow();await f.c.decorateStaffTwoStep();const button=row.querySelector('[data-two-step-reset]');f.state.writeError='Reset refused';
 await assert.rejects(button.onclick(),/Reset refused/);assert.equal(row.querySelector('[data-two-step-reset]'),button);assert.equal(row.querySelector('[data-staff-two-step-status]').textContent,'Two-step: on');assert.match(row.querySelector('[data-staff-two-step-status]').className,/chip--success/);assert.equal(f.messages.length,0);
});

for(const change of ['actor','detached'])test(`late staff two-step read and reset do not recolour a ${change} context`,async()=>{
 const f=fixture(),row=f.addRow(),status=row.querySelector('[data-staff-two-step-status]');f.state.readWait=deferred();const reading=f.c.decorateStaffTwoStep();
 if(change==='actor')f.c.me={...f.c.me};else row.remove();f.state.readWait.resolve({data:[{user_id:'employee',enabled:true}]});await reading;
 assert.equal(status.textContent,'Two-step: checking…');assert.equal(status.className,'');
 const g=fixture(),savedRow=g.addRow();await g.c.decorateStaffTwoStep();const button=savedRow.querySelector('[data-two-step-reset]');g.state.writeWait=deferred();const saving=button.onclick();await new Promise(setImmediate);assert.equal(g.calls.filter(call=>call.account).length,1);
 if(change==='actor')g.c.me={...g.c.me};else savedRow.remove();g.state.writeWait.resolve({});await saving;
 assert.equal(savedRow.querySelector('[data-two-step-reset]'),button);assert.equal(savedRow.querySelector('[data-staff-two-step-status]').textContent,'Two-step: on');assert.equal(g.messages.length,0);
});

test('staff two-step reset remains unavailable to ordinary staff and rows without management controls',async()=>{
 const f=fixture();f.addRow();f.c.me={user_id:'employee',role:'staff'};await f.c.decorateStaffTwoStep();assert.equal(f.calls.length,0);
 const g=fixture(),row=g.addRow('employee',false);await g.c.decorateStaffTwoStep();assert.equal(row.querySelector('[data-staff-two-step-status]').textContent,'Two-step: on');assert.equal(row.querySelector('[data-two-step-reset]'),null);
});
