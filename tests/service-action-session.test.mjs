import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 let submit,resolve,reject;
 const calls=[],messages=[];
 const c=vm.createContext({me:{user_id:'fixture'},view:'service',esc:String,inventoryProduct:()=>({name:'Fixture machine'}),actionForm:(title,fields,fn)=>submit=fn,client:{rpc:(name,args)=>{calls.push({name,args});return new Promise((r,j)=>{resolve=r;reject=j})}},message:s=>messages.push(s)});
 vm.runInContext(readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8'),c);
 vm.runInContext("serviceWorkspace=async()=>{};serviceStatusLabel=s=>s",c);
 c.openServiceAction({id:'case',product_id:'product',version:2,case_number:'Fixture'},'start');
 return {c,calls,messages,submit:()=>submit({note:'Fixture work'}),finish:result=>resolve(result),reject:error=>reject(error)};
}
test('service action opened in previous identity cannot submit under replacement',async()=>{
 const f=fixture();f.c.me={user_id:'replacement'};
 const p=f.submit();if(f.calls.length)f.finish({data:{status:'in_progress'}});
 await assert.rejects(p,/session|reopen/i);assert.equal(f.calls.length,0);
});
for(const result of [{data:{status:'in_progress'}},{error:{message:'Old access denied'}}])test(`service action stale ${result.error?'error':'success'} stays out of replacement session`,async()=>{
 const f=fixture(),p=f.submit();f.c.me={user_id:'replacement'};f.finish(result);await p;
 assert.equal(f.messages.length,0);
});
test('current service action still sends guarded transition and confirms',async()=>{
 const f=fixture(),p=f.submit();f.finish({data:{status:'in_progress'}});await p;
 assert.equal(f.calls[0].name,'advance_service_case');assert.equal(f.calls[0].args.p_expected_version,2);assert.equal(f.messages.length,1);
});
test('current service action preserves server denial',async()=>{
 const f=fixture(),p=f.submit();f.finish({error:{message:'Permission denied'}});
 await assert.rejects(p,{message:'Permission denied'});assert.equal(f.messages.length,0);
});
for(const stale of [false,true])test(`transport rejection ${stale?'after navigation is suppressed':'in current session remains visible'}`,async()=>{
 const f=fixture(),p=f.submit();if(stale)f.c.view='clients';f.reject(Error('Fixture transport failure'));
 if(stale)await p;else await assert.rejects(p,/Fixture transport failure/);
 assert.equal(f.messages.length,0);
});
test('navigation before submission blocks the RPC',async()=>{
 const f=fixture();f.c.view='clients';await assert.rejects(f.submit(),/Reopen/);assert.equal(f.calls.length,0);
});
test('same-ID replacement session is not treated as original session',async()=>{
 const f=fixture();f.c.me={user_id:'fixture'};await assert.rejects(f.submit(),/session/);assert.equal(f.calls.length,0);
});
test('session replacement during post-save refresh suppresses old success toast',async()=>{
 const f=fixture();let release,started;
 const refreshing=new Promise(r=>started=r);
 f.c.serviceWorkspace=()=>new Promise(r=>{release=r;started()});
 const p=f.submit();f.finish({data:{status:'in_progress'}});await refreshing;
 assert.equal(typeof release,'function');f.c.me={user_id:'replacement'};release();await p;
 assert.equal(f.messages.length,0);assert.equal(f.calls.length,1);
});
