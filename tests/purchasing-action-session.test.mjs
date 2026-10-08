import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const calls=[],messages=[],context=vm.createContext({me:{user_id:'first'},view:'purchasing',esc:String,message:value=>messages.push(value),actionForm:(title,fields,callback)=>{context.submit=callback},client:{rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))}});
 vm.runInContext(readFileSync(new URL('../purchasing.js',import.meta.url),'utf8'),context);
 vm.runInContext('purchaseRefreshOne=async()=>{}',context);
 context.openPurchaseAction({id:'po',version:3,po_number:'PO123'},'approve');
 return {context,calls,messages};
}
test('current approval sends expected version and confirms',async()=>{const f=fixture(),p=f.context.submit({note:'Reviewed'});assert.equal(f.calls[0].args.p_expected_version,3);f.calls[0].resolve({data:{id:'po'}});await p;assert.equal(f.messages.length,1)});
test('dialog from previous actor cannot submit as new actor',async()=>{const f=fixture();f.context.me={user_id:'second'};const p=f.context.submit({});f.calls.forEach(r=>r.resolve({data:{id:'po'}}));await p;assert.equal(f.calls.length,0)});
test('cleared dialog cannot submit under same actor',async()=>{const f=fixture();f.context.clearPurchasing();const p=f.context.submit({});f.calls.forEach(r=>r.resolve({data:{id:'po'}}));await p;assert.equal(f.calls.length,0)});
test('same-ID replacement cannot receive success toast',async()=>{const f=fixture(),p=f.context.submit({});f.context.me={user_id:'first'};f.calls[0].resolve({data:{id:'po'}});await p;assert.equal(f.messages.length,0)});
test('obsolete transport error does not escape after clear',async()=>{const f=fixture(),p=f.context.submit({});f.context.clearPurchasing();f.calls[0].reject(Error('Old error'));await assert.doesNotReject(p);assert.equal(f.messages.length,0)});
test('current server rejection stays visible',async()=>{const f=fixture(),p=f.context.submit({});f.calls[0].resolve({error:{message:'Not permitted'}});await assert.rejects(p,/Not permitted/);assert.equal(f.messages.length,0)});
test('account change during refresh prevents success notification',async()=>{const f=fixture();f.context.purchaseRefreshOne=async()=>{f.context.me={user_id:'second'}};const p=f.context.submit({});f.calls[0].resolve({data:{id:'po'}});await p;assert.equal(f.messages.length,0)});
test('navigation before submit does not call RPC',async()=>{const f=fixture();f.context.view='clients';const p=f.context.submit({});f.calls.forEach(r=>r.resolve({data:{id:'po'}}));await p;assert.equal(f.calls.length,0)});
