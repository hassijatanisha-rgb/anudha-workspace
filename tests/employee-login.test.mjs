import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(lookup=()=>null){
 const calls=[];
 const ctx=vm.createContext({workspacePageHeader,window:{ERP_CONFIG:{staffLoginDomain:'staff.anudha.com'}},crypto:globalThis.crypto,Uint8Array,
  client:{rpc:async(name,args)=>{calls.push([name,args]);return {data:lookup(args.p_email)}}}});
 vm.runInContext(readFileSync(new URL('../employee-login.js',import.meta.url),'utf8'),ctx);
 return {ctx,calls};
}
test('employee ID signs in with the staff login domain; emails pass through',()=>{
 const {ctx}=load();
 assert.equal(ctx.employeeLoginEmail(' Jagroop '),'jagroop@staff.anudha.com');
 assert.equal(ctx.employeeLoginEmail('nisa.k'),'nisa.k@staff.anudha.com');
 assert.equal(ctx.employeeLoginEmail(' Owner@Example.com '),'owner@example.com');
 assert.equal(ctx.employeeLoginEmail(' Tanisha  Hassija '),'tanisha.hassija@staff.anudha.com','the name as typed works');
 assert.equal(ctx.employeeLoginEmail('José Ñúñez'),'jose.nunez@staff.anudha.com');
 for(const bad of ['','a','bad..dots','.lead','x'.repeat(41),'<script>'])assert.throws(()=>ctx.employeeLoginEmail(bad),/employee ID/);
});
test('IDs come from the name: first.last, then last initial, first name, then numbers',()=>{
 const {ctx}=load();
 assert.deepEqual([...ctx.employeeIdCandidates('Jagroop Singh')].slice(0,4),['jagroop.singh','jagroop.s','jagroop','jagroop.singh2']);
 assert.deepEqual([...ctx.employeeIdCandidates('  Anurag  ')].slice(0,2),['anurag','anurag2']);
 assert.equal(ctx.employeeIdCandidates('José Ñúñez')[0],'jose.nunez');
 assert.equal(ctx.employeeIdCandidates('   ').length,0);
});
test('suggestion skips IDs that already belong to a staff login',async()=>{
 const taken=new Set(['jagroop.sandhu@staff.anudha.com','jagroop.s@staff.anudha.com']);
 const {ctx,calls}=load(email=>taken.has(email)?{user_id:'existing',name_version:1}:null);
 assert.equal(await ctx.suggestEmployeeId('Jagroop Sandhu'),'jagroop');
 assert.deepEqual(calls.map(c=>c[1].p_email),['jagroop.sandhu@staff.anudha.com','jagroop.s@staff.anudha.com','jagroop@staff.anudha.com']);
});
test('lookup errors stop the suggestion instead of reusing a possibly taken ID',async()=>{
 const ctx=load().ctx;ctx.client={rpc:async()=>({error:{message:'Owner access required'}})};
 await assert.rejects(ctx.suggestEmployeeId('Ayaz Khan'),/Owner access required/);
});
test('temporary passwords are 14 unambiguous characters and differ',()=>{
 const {ctx}=load(),a=ctx.employeeTemporaryPassword(),b=ctx.employeeTemporaryPassword();
 assert.match(a,/^[A-HJ-NP-Za-km-z2-9]{14}$/);assert.notEqual(a,b);
});
test('login form, identity bar and staff page are wired to employee login',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.src.html',import.meta.url),'utf8');
 assert.match(app,/signInWithPassword\(\{email:employeeLoginEmail\(/);assert.match(app,/Employee ID or work email/);
 assert.match(app,/openChangePassword\(\)/);assert.match(app,/openStaffOnboarding\(\)/);
 assert.ok(html.indexOf('employee-login.js')>html.indexOf('employee-names.js')&&html.indexOf('employee-login.js')<html.indexOf('app.js'));
});
test('staff logins are created and reset through the owner-only server function, never in the browser',()=>{
 const src=readFileSync(new URL('../employee-login.js',import.meta.url),'utf8'),fn=readFileSync(new URL('../supabase/functions/staff-accounts/index.ts',import.meta.url),'utf8');
 assert.match(src,/functions\.invoke\('staff-accounts'/);assert.doesNotMatch(src,/service_role|auth\.admin/);
 assert.match(fn,/rpc\('is_owner'\)/);assert.match(fn,/must_change_password: true/);assert.match(fn,/ALLOWED_ORIGINS = \['https:\/\/hassijatanisha-rgb\.github\.io'\]/);
 assert.match(src,/data:\{must_change_password:false\}/);assert.match(readFileSync(new URL('../app.js',import.meta.url),'utf8'),/requirePasswordChange\(u\.data\.user\)/);
});
test('password changes accept eight characters, reject shorter or mismatched values, and preserve first-login replacement',async()=>{
 for(const required of [false,true]){
  const {ctx}=load(),updates=[],document=dom();installNativeFormControls(document);const proto=Object.getPrototypeOf(document.body),matches=proto.matches;proto.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};proto.reset=function(){for(const input of this.querySelectorAll('input'))input.value='';this.resetCalled=true;};
  ctx.view='settings';ctx.busy=false;ctx.run=fn=>fn();ctx.me={user_id:'actor'};ctx.document=document;ctx.message=()=>{};let loaded=false;ctx.load=async()=>{loaded=true;};
  ctx.client.auth={updateUser:async payload=>{updates.push(payload);return {};}};
  installWorkspaceDialogFixture(ctx);vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),ctx);ctx.openChangePassword({required});
  const dialog=document.querySelector('dialog'),form=dialog.querySelector('form'),button=form.querySelector('[type="submit"]'),alert=form.querySelector('[role="alert"]'),cancel=dialog.querySelector('[data-close]');
  assert.equal((dialog.innerHTML.match(/minlength="8"/g)||[]).length,2);
  assert.equal((dialog.innerHTML.match(/maxlength="72"/g)||[]).length,2);
  if(required){assert.equal(cancel.hidden,true);let prevented=false;for(const {fn}of dialog.events.cancel)fn({preventDefault(){prevented=true;}});assert.equal(prevented,true);}
  const submit=()=>form.onsubmit({preventDefault(){}});
  form.elements.password.value=form.elements.confirm.value='aBcD123';await submit();
  assert.equal(updates.length,0);assert.equal(alert.textContent,'2 fields need attention');assert.match(form.elements.password.closest('label').textContent,/at least 8/);
  form.elements.password.value='aBcD1234';form.elements.confirm.value='different';await submit();
  assert.equal(updates.length,0);assert.equal(alert.textContent,'1 field needs attention');assert.match(form.elements.confirm.closest('label').textContent,/do not match/);
  form.elements.confirm.value='aBcD1234';await submit();
  assert.equal(updates.length,1);assert.equal(updates[0].password,'aBcD1234');assert.equal(updates[0].data.must_change_password,false);
  assert.equal(form.resetCalled,true);assert.equal(button.disabled,false);assert.equal(loaded,required);assert.equal(!dialog.isConnected,required);
 }
});
