import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../two-step.js',import.meta.url),'utf8');
function load(level,factors,verify={}){
 const ctxRef={},calls=[],content={innerHTML:''},form={onsubmit:null,querySelector:()=>({focus(){}})};
 const ctx=vm.createContext({calls,content,esc:s=>String(s),message:()=>{},login:()=>calls.push('login'),run:fn=>{ctxRef.last=fn();return ctxRef.last;},FormData:class{constructor(f){this.f=f}get(){return this.f.code}},
  $:sel=>sel==='#content'?content:sel==='#twoStepLogin'?form:{focus(){},onclick:null},
  client:{auth:{signOut:async()=>{},mfa:{getAuthenticatorAssuranceLevel:async()=>({data:level}),listFactors:async()=>({data:{totp:factors}}),challengeAndVerify:async args=>{calls.push(args);return verify;}}}}});
 vm.runInContext(source,ctx);return {ctx,calls,content,form,settled:()=>ctxRef.last};
}
test('the code is asked for only when the login has two-step on and has not entered it yet',async()=>{
 assert.equal(await load({currentLevel:'aal1',nextLevel:'aal2'},[]).ctx.twoStepNeeded(),true);
 assert.equal(await load({currentLevel:'aal2',nextLevel:'aal2'},[]).ctx.twoStepNeeded(),false);
 assert.equal(await load({currentLevel:'aal1',nextLevel:'aal1'},[]).ctx.twoStepNeeded(),false);
});
test('a correct code continues sign-in; a wrong one shows a plain message',async()=>{
 const good=load({},[{id:'f1',status:'verified'}]);let done=0;
 good.ctx.showTwoStepPrompt(async()=>{done++});
 good.form.onsubmit({preventDefault(){},target:{code:' 123 456 '}});await good.settled();
 assert.deepEqual({...good.calls[0]},{factorId:'f1',code:'123456'});assert.equal(done,1);
 const bad=load({},[{id:'f1',status:'verified'}],{error:{message:'Invalid TOTP code entered'}});
 bad.ctx.showTwoStepPrompt(async()=>{throw Error('should not continue')});
 bad.form.onsubmit({preventDefault(){},target:{code:'000000'}});await assert.rejects(bad.settled(),/not right/);
 const none=load({},[]);none.ctx.showTwoStepPrompt(async()=>{});none.form.onsubmit({preventDefault(){},target:{code:'123456'}});await assert.rejects(none.settled(),/No authenticator/);
 assert.throws(()=>good.ctx.twoStepCode('12ab56'),/6 numbers/);
});
test('sign-in asks for the code before loading any data, and only the owner server function can reset it',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.ok(app.indexOf('twoStepNeeded()')<app.indexOf("client.from('staff')"),'the code is checked before business data is read');
 const fn=readFileSync(new URL('../supabase/functions/staff-accounts/index.ts',import.meta.url),'utf8');
 assert.ok(fn.indexOf("rpc('is_owner')")<fn.indexOf('reset_two_step'),'reset runs only after the owner check');
 assert.match(fn,/mfa\.deleteFactor/);
});
