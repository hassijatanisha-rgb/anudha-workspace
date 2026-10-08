import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const requests=[],output={innerHTML:'Clients'};
 const context=vm.createContext({me:{user_id:'first'},view:'service',renders:0,$:()=>output,syncWorkspaceNavigation(){},client:{from(){
  const q={select(){return q},order(){return q},limit(){return q},then(resolve,reject){requests.push({resolve,reject})}};return q;
 }}});
 vm.runInContext(readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8'),context);
 vm.runInContext("installationScreen=()=>{renders++;return 'Jobs'};serviceUnavailable=()=> 'Unavailable';bindServiceWorkflow=()=>{}",context);
 return {context,output,requests,get:code=>vm.runInContext(code,context),async started(){await Promise.resolve();await Promise.resolve()},resolve(start=0,data=[]){requests.slice(start,start+7).forEach(r=>r.resolve({data}))}};
}
test('service callback off-view does not touch replacement content',async()=>{
 const f=fixture();f.context.view='clients';const p=f.context.serviceWorkspace();await f.started();f.resolve();await p;
 assert.equal(f.output.innerHTML,'Clients');assert.equal(f.requests.length,0);
});
test('navigation during service load discards rows and render',async()=>{
 const f=fixture(),p=f.context.serviceWorkspace();await f.started();f.context.view='clients';f.output.innerHTML='Client page';f.resolve(0,[{id:'stale'}]);await p;
 assert.equal(f.output.innerHTML,'Client page');assert.equal(f.get('serviceCases.length'),0);
});
test('same-ID replacement session cannot receive old service rows',async()=>{
 const f=fixture(),p=f.context.serviceWorkspace();await f.started();f.context.me={user_id:'first'};f.resolve(0,[{id:'stale'}]);await p;
 assert.equal(f.get('serviceCases.length'),0);assert.equal(f.context.renders,0);
});
test('old rejected refresh cannot override latest successful service load',async()=>{
 const f=fixture(),old=f.context.serviceWorkspace(true);await f.started();const fresh=f.context.serviceWorkspace(true);await f.started();
 f.resolve(7,[{id:'new'}]);await fresh;f.requests[0].reject(Error('Old failure'));f.resolve();await old;
 assert.equal(f.get('serviceCases[0].id'),'new');assert.equal(f.get('serviceLoadError'),'');assert.equal(f.context.renders,1);
});
test('current service load renders once and reuses same-session cache',async()=>{
 const f=fixture(),p=f.context.serviceWorkspace();await f.started();f.resolve(0,[{id:'current'}]);await p;
 assert.equal(f.output.innerHTML,'Jobs');assert.equal(f.get('serviceCases[0].id'),'current');
 await f.context.serviceWorkspace();assert.equal(f.requests.length,7);assert.equal(f.context.renders,2);
});
test('replacement session reloads instead of using previous actor cache',async()=>{
 const f=fixture(),first=f.context.serviceWorkspace();await f.started();f.resolve(0,[{id:'old'}]);await first;
 f.context.me={user_id:'second'};const second=f.context.serviceWorkspace();await f.started();
 assert.equal(f.requests.length,14);assert.match(f.output.innerHTML,/Loading/);
 f.resolve(7,[{id:'replacement'}]);await second;assert.equal(f.get('serviceCases[0].id'),'replacement');
});
for(const kind of ['rejection','error response'])test(`current ${kind} clears cached service rows and permits retry`,async()=>{
 const f=fixture(),first=f.context.serviceWorkspace();await f.started();f.resolve(0,[{id:'old'}]);await first;
 const failed=f.context.serviceWorkspace(true);await f.started();
 if(kind==='rejection')f.requests[7].reject(Error('Fixture unavailable'));
 else f.requests[7].resolve({error:{message:'Fixture unavailable'}});
 f.resolve(7);await failed;
 assert.equal(f.get('serviceCases.length'),0);assert.equal(f.get('serviceLoaded'),false);
 assert.equal(f.get('serviceLoadError'),'Fixture unavailable');assert.equal(f.output.innerHTML,'Unavailable');
 const retry=f.context.serviceWorkspace();await f.started();f.resolve(14,[{id:'recovered'}]);await retry;
 assert.equal(f.get('serviceCases[0].id'),'recovered');assert.equal(f.get('serviceLoadError'),'');
});
test('older successful service request cannot overwrite latest rows',async()=>{
 const f=fixture(),old=f.context.serviceWorkspace(true);await f.started();const current=f.context.serviceWorkspace(true);await f.started();
 f.resolve(7,[{id:'latest'}]);await current;f.resolve(0,[{id:'old'}]);await old;
 assert.equal(f.get('serviceCases[0].id'),'latest');assert.equal(f.context.renders,1);
});
test('signed-out service callback performs no requests or rendering',async()=>{
 const f=fixture();f.context.me=null;await f.context.serviceWorkspace();
 assert.equal(f.requests.length,0);assert.equal(f.output.innerHTML,'Clients');
});
