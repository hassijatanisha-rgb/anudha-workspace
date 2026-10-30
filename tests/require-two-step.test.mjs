import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {statusTone} from './helpers/status-ui.mjs';
const source=readFileSync(new URL('../two-step.js',import.meta.url),'utf8');
// Elements are created on demand, so each screen's buttons and forms can be pressed from the test.
function load({rpc={},factors=[],verify={}}={}){
 const els=new Map(),calls=[],pending=[];
 const el=sel=>{if(!els.has(sel))els.set(sel,{innerHTML:'',onclick:null,onsubmit:null,focus(){},addEventListener(type,fn){this['on'+type]=fn},querySelector(selector){return selector.startsWith('#')?(this.innerHTML.includes('id="'+selector.slice(1)+'"')?el(selector):null):{focus(){}};},remove(){}});return els.get(sel);};
 const ctx=vm.createContext({workspacePageHeader,statusTone,calls,me:{user_id:'employee',role:'staff'},view:'settings',esc:s=>String(s),message:m=>calls.push(['message',m]),login:()=>calls.push('login'),settingsWorkspace:()=>calls.push('settings'),
  run:fn=>{const p=Promise.resolve().then(fn);pending.push(p);return p;},askConfirm:async()=>true,
  FormData:class{constructor(f){this.f=f}get(){return this.f.code}},$:el,
  document:{createElement:()=>el('#settingsBox')},
  client:{rpc:async name=>{calls.push(['rpc',name]);const r=rpc[name];if(r instanceof Error)throw r;return r??{data:false};},
   auth:{signOut:async()=>calls.push('signOut'),refreshSession:async()=>{},mfa:{
    listFactors:async()=>({data:{totp:factors,all:factors}}),unenroll:async args=>{calls.push(['unenroll',args.factorId]);return {}},
    enroll:async()=>({data:{id:'new-factor',totp:{qr_code:'data:image/svg+xml,qr',secret:'SECRET'}}}),
    challengeAndVerify:async args=>{calls.push(['verify',args]);return verify;}}}}});
 vm.runInContext(source,ctx);
 return {ctx,calls,el,settled:async()=>{while(pending.length)await pending.shift();}};
}

test('setup is required only when the database says so; a failed or missing check never locks anyone out',async()=>{
 assert.equal(await load({rpc:{two_step_setup_required:{data:true}}}).ctx.twoStepSetupRequired(),true);
 assert.equal(await load({rpc:{two_step_setup_required:{data:false}}}).ctx.twoStepSetupRequired(),false);
 assert.equal(await load({rpc:{two_step_setup_required:{error:{message:'Could not find the function'}}}}).ctx.twoStepSetupRequired(),false);
 assert.equal(await load({rpc:{two_step_setup_required:new Error('offline')}}).ctx.twoStepSetupRequired(),false);
});

test('required setup screen explains why, then setup continues into the workspace',async()=>{
 const t=load({verify:{}});let done=0;
 t.ctx.showTwoStepSetupRequired(async()=>{done++});
 assert.match(t.el('#content').innerHTML,/Owners and accounts staff must sign in with a code/);
 t.el('#twoStepStart').onclick();await t.settled();
 assert.match(t.el('#twoStepRequired').innerHTML,/scan this picture/);
 t.el('#twoStepConfirm').onsubmit({preventDefault(){},target:{code:'123 456'}});await t.settled();
 assert.deepEqual({...t.calls.find(c=>c[0]==='verify')[1]},{factorId:'new-factor',code:'123456'});
 assert.equal(done,1,'load() runs again after the code is confirmed');
 assert.ok(!t.calls.includes('settings'),'does not drop the person on the settings page');
});

test('cancelling required setup removes the unfinished factor and returns to the setup screen; sign out still works',async()=>{
 const t=load();let done=0;
 t.ctx.showTwoStepSetupRequired(async()=>{done++});
 t.el('#twoStepStart').onclick();await t.settled();
 t.el('#twoStepCancel').onclick();await t.settled();
 assert.ok(t.calls.some(c=>c[0]==='unenroll'&&c[1]==='new-factor'));
 assert.match(t.el('#content').innerHTML,/Set up two-step sign-in/);assert.equal(done,0);
 t.el('#twoStepSignOut').onclick();await t.settled();
 assert.ok(t.calls.includes('signOut')&&t.calls.includes('login'));
});

test('people who must use two-step sign-in get no Turn off button; others keep it',async()=>{
 const required=load({rpc:{two_step_required:{data:true}},factors:[{id:'f1',status:'verified'}]});
 await required.ctx.renderTwoStepSettings({append(){}});
 assert.match(required.el('#settingsBox').innerHTML,/cannot be turned off/);assert.doesNotMatch(required.el('#settingsBox').innerHTML,/twoStepOff/);
 const optional=load({rpc:{two_step_required:{data:false}},factors:[{id:'f1',status:'verified'}]});
 await optional.ctx.renderTwoStepSettings({append(){}});
 assert.match(optional.el('#settingsBox').innerHTML,/id="twoStepOff"/);
});

test('sign-in checks required setup after the code check and before reading any staff or business data',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const body=app.slice(app.indexOf('async function load(){'));
 const code=body.indexOf('twoStepNeeded()'),setup=body.indexOf('twoStepSetupRequired()'),staff=body.indexOf('loadMyStaffRow(');
 assert.ok(code>0&&setup>code&&staff>setup,'order: code prompt, required setup, then staff row');
 assert.match(body,/showTwoStepSetupRequired\(load\)/);
});
