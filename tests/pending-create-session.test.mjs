import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8');
function fixture(){
 let reply,reject;const form={isConnected:true};const c=vm.createContext({me:{user_id:'first'},view:'pending',messages:[],refreshes:0,calls:[],
 FormData:class{get(key){return {organizationId:'org',productChoice:'Product',quantity:'2',notes:'Fixture'}[key]??null}},
 crypto:{randomUUID:()=> 'request-one'},inventoryProductFromChoice:()=>({id:'product'}),$:()=>form,
 client:{rpc:(name,args)=>{c.calls.push({name,args});return new Promise((resolve,no)=>{reply=resolve;reject=no})}},message:text=>c.messages.push(text)});
 vm.runInContext(source,c);vm.runInContext('pendingStockWorkspace=async()=>{refreshes++};pendingCreating=true',c);
 return {c,form,reply:value=>reply(value),reject:error=>reject(error),get:expr=>vm.runInContext(expr,c)};
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
for(const kind of ['transport','server','unconfirmed'])test(`${kind} failure retains retry ID and identical retry payload`,async()=>{
 const f=fixture();const first=f.c.savePendingForm(f.form);const rejected=assert.rejects(first);
 if(kind==='transport')f.reject(Error('Connection lost'));
 else if(kind==='server')f.reply({error:{message:'Fixture server error'}});
 else f.reply({data:{id:'wrong'}});
 await rejected;assert.equal(f.get('pendingRequestId'),'request-one');assert.equal(f.get('pendingCreating'),true);assert.equal(f.c.messages.length,0);
 const retry=f.c.savePendingForm(f.form);assert.deepEqual(f.c.calls[1],f.c.calls[0]);
 f.reply({data:{id:'request-one',request_number:'PS-fixture'}});await retry;assert.equal(f.get('pendingRequestId'),null);assert.equal(f.c.messages.length,1);
});
test('old transport error cannot surface in a replacement form',async()=>{
 const f=fixture();const p=f.c.savePendingForm(f.form);f.form.isConnected=false;vm.runInContext("pendingRequestId='replacement'",f.c);
 f.reject(Error('Old connection error'));await p;assert.equal(f.get('pendingRequestId'),'replacement');assert.equal(f.c.messages.length,0);
});
