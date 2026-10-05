import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Isolated acceptance diagnostic: no network or real service records.
function fixture(mode){
 let submit,resolve,reject;
 const messages=[],refreshes=[],calls=[];
 const ctx=vm.createContext({me:{user_id:'first'},view:'service',esc:String,
  inventoryProduct:()=>({name:'Fictional machine'}),serviceStatusLabel:String,
  actionForm(_title,_fields,callback){submit=callback;},
  message(value){messages.push(value);},
  client:{rpc(...args){calls.push(args);return new Promise((done,fail)=>{resolve=done;reject=fail;});}}});
 vm.runInContext(readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8'),ctx);
 ctx.serviceWorkspace=async()=>{refreshes.push(ctx.me?.user_id);};
 if(mode==='create'){
  let handler,task;
  const form={elements:{namedItem(){return {addEventListener(){}};}},addEventListener(type,callback){if(type==='submit')handler=callback;}};
  ctx.document={querySelectorAll:()=>[]};ctx.$=selector=>selector==='#newServiceCase'?form:null;
  ctx.contacts=[];ctx.crypto={randomUUID:()=> 'fictional-id'};
  ctx.FormData=class{constructor(form){assert.ok(form);return [['assetId','fixture-asset'],['contactId',''],['problem','Fixture repair']];}};
  ctx.run=callback=>{task=callback();return task;};
  ctx.bindServiceWorkflow();submit=()=>{handler({preventDefault(){},currentTarget:form});return task;};
 }else if(mode==='report'){ctx.reportFields=()=>'';ctx.openServiceReport({id:'fictional',version:1,case_type:'service'});}else ctx.openServiceAction({id:'fictional',version:1,case_number:'Fixture'},'start');
 return {ctx,messages,refreshes,calls,submit:()=>submit({note:'Fixture only',serviceCharge:'0',interval:'3'}),finish:(error=null)=>resolve({data:{status:'in_progress'},error}),fail:()=>reject(Error('Fixture transport failure'))};
}
for(const mode of ['action','report','create']){
test(mode+': '+'same-account service mutation reports completion',async()=>{
 const f=fixture(mode),pending=f.submit();f.finish();await pending;
 assert.equal(f.messages.length,1);assert.deepEqual(f.refreshes,['first']);
});
test(mode+': '+'old-account service save must not refresh or notify the new account',async()=>{
 const f=fixture(mode),pending=f.submit();f.ctx.me={user_id:'second'};f.finish();await pending;
 assert.deepEqual(f.refreshes,[]);assert.deepEqual(f.messages,[]);
});
test(mode+': '+'service save after navigation must not display a success toast on Clients',async()=>{
 const f=fixture(mode),pending=f.submit();f.ctx.view='clients';f.finish();await pending;
 assert.deepEqual(f.messages,[]);
});
test(mode+': '+'form opened by a previous actor cannot submit a service RPC',async()=>{
 const f=fixture(mode);f.ctx.me={user_id:'second'};
 const pending=f.submit();if(f.calls.length)f.finish();await pending;
 assert.equal(f.calls.length,0);
});
test(mode+': '+'clear invalidates saves even if the user id is unchanged',async()=>{
 const f=fixture(mode),pending=f.submit();f.ctx.clearServiceWorkflow();f.finish();await pending;
 assert.deepEqual(f.refreshes,[]);assert.deepEqual(f.messages,[]);
});
test(mode+': '+'account switch during refresh suppresses old completion notification',async()=>{
 const f=fixture(mode);f.ctx.serviceWorkspace=async()=>{f.ctx.me={user_id:'second'};};
 const pending=f.submit();f.finish();await pending;assert.deepEqual(f.messages,[]);
});
test(mode+': '+'current-session RPC errors remain visible to the form',async()=>{
 const f=fixture(mode),pending=f.submit();f.finish(Error('Fixture denied'));
 await assert.rejects(pending,/Fixture denied/);assert.deepEqual(f.messages,[]);
});
test(mode+': '+'old-session transport errors do not escape into the next account dialog',async()=>{
 const f=fixture(mode),pending=f.submit();f.ctx.me={user_id:'second'};f.fail();
 await pending;assert.deepEqual(f.messages,[]);
});
}
