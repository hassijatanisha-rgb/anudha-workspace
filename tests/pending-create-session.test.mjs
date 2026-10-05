import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8');
function fixture(){
 let reply;const form={isConnected:true};const c=vm.createContext({me:{user_id:'first'},view:'pending',messages:[],refreshes:0,
 FormData:class{get(key){return {organizationId:'org',productChoice:'Product',quantity:'2',notes:'Fixture'}[key]??null}},
 crypto:{randomUUID:()=> 'request-one'},inventoryProductFromChoice:()=>({id:'product'}),$:()=>form,
 client:{rpc:()=>new Promise(resolve=>reply=resolve)},message:text=>c.messages.push(text)});
 vm.runInContext(source,c);vm.runInContext('pendingStockWorkspace=async()=>{refreshes++};pendingCreating=true',c);
 return {c,form,reply:value=>reply(value),get:expr=>vm.runInContext(expr,c)};
}
test('current pending creation confirms and clears its retry ID',async()=>{const f=fixture();const p=f.c.savePendingForm(f.form);f.reply({data:{id:'request-one',request_number:'PS-fixture'}});await p;assert.equal(f.get('pendingRequestId'),null);assert.equal(f.c.messages.length,1)});
for(const change of ['clear','replace-form','navigate'])test(`old create response cannot affect new state after ${change}`,async()=>{
 const f=fixture();const p=f.c.savePendingForm(f.form);
 if(change==='clear'){f.c.clearPendingStock();f.c.me={user_id:'first'};}
 if(change==='replace-form'){f.form.isConnected=false;}
 if(change==='navigate'){f.c.view='clients';}
 vm.runInContext("pendingRequestId='new-request';pendingCreating=true",f.c);
 f.reply({data:{id:'request-one',request_number:'PS-old'}});await p;
 assert.equal(f.get('pendingRequestId'),'new-request');assert.equal(f.get('pendingCreating'),true);assert.equal(f.c.messages.length,0);assert.equal(f.c.refreshes,0);
});
