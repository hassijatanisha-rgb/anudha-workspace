import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const pending=[],content={innerHTML:''};
 const ctx=vm.createContext({me:{user_id:'first'},view:'service',syncWorkspaceNavigation(){},$:()=>content,
  client:{from(){const chain={select(){return chain},order(){return chain},limit(){return chain},then(resolve,reject){return new Promise((yes,no)=>pending.push({yes,no})).then(resolve,reject)}};return chain;}}});
 vm.runInContext(readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(`installationScreen=()=> 'SERVICE SCREEN';serviceUnavailable=()=> 'SERVICE ERROR';bindServiceWorkflow=()=>{};`,ctx);
 return {ctx,pending,content};
}
async function settle(pending){await new Promise(resolve=>setImmediate(resolve));for(const item of pending)item.yes({data:[{id:'old-account-record'}],error:null});}
test('service load from a previous account cannot populate the next account cache',async()=>{
 const {ctx,pending}=fixture(),loading=ctx.loadServiceWorkflow();
 ctx.me={user_id:'second'};await settle(pending);await loading;
 assert.equal(vm.runInContext('serviceCases.length',ctx),0);
 assert.equal(vm.runInContext('serviceLoaded',ctx),false);
});
test('navigation away during service loading does not overwrite another workspace',async()=>{
 const {ctx,pending,content}=fixture(),loading=ctx.serviceWorkspace(true);
 ctx.view='clients';content.innerHTML='CLIENT SCREEN';await settle(pending);await loading;
 assert.equal(content.innerHTML,'CLIENT SCREEN');
});
test('sign-out clear removes service records and invalidates in-flight requests',async()=>{
 const {ctx,pending}=fixture(),loading=ctx.loadServiceWorkflow();
 assert.equal(typeof ctx.clearServiceWorkflow,'function');
 ctx.clearServiceWorkflow();await settle(pending);await loading;
 assert.equal(vm.runInContext('serviceCases.length',ctx),0);
 assert.equal(vm.runInContext('serviceLoaded',ctx),false);
 assert.match(readFileSync(new URL('../app.js',import.meta.url),'utf8'),/typeof clearServiceWorkflow==='function'\)clearServiceWorkflow\(\)/);
});
test('an older successful request cannot replace the newest service data',async()=>{
 const {ctx,pending}=fixture(),first=ctx.loadServiceWorkflow();
 await new Promise(resolve=>setImmediate(resolve));const second=ctx.loadServiceWorkflow();
 await new Promise(resolve=>setImmediate(resolve));
 for(const item of pending.slice(7))item.yes({data:[{id:'newest'}],error:null});await second;
 for(const item of pending.slice(0,7))item.yes({data:[{id:'older'}],error:null});await first;
 assert.equal(vm.runInContext('serviceCases[0].id',ctx),'newest');
});
test('current-account query failure shows unavailable instead of cached service records',async()=>{
 const {ctx,pending,content}=fixture(),loading=ctx.serviceWorkspace(true);
 await new Promise(resolve=>setImmediate(resolve));
 for(const item of pending)item.yes({data:null,error:{message:'Fixture permission denied'}});await loading;
 assert.equal(content.innerHTML,'SERVICE ERROR');
 assert.equal(vm.runInContext('serviceLoaded',ctx),false);
});
