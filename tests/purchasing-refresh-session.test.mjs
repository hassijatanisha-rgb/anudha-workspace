import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const requests=[],context=vm.createContext({me:{user_id:'first'},view:'purchasing',renders:0,$:()=>null});
 const query={select(){return this},eq(){return this},or(){return this},order(){return this},maybeSingle(){return new Promise((resolve,reject)=>requests.push({resolve,reject}))},limit(){return this.maybeSingle()}};
 context.client={from:()=>query};
 vm.runInContext(readFileSync(new URL('../purchasing.js',import.meta.url),'utf8'),context);
 vm.runInContext("purchaseLoaded=true;purchaseSearch='PO123';renderPurchasing=()=>{renders++}",context);
 return {context,requests,get:code=>vm.runInContext(code,context)};
}
for(const kind of ['refresh','search']){
 const begin=f=>kind==='refresh'?f.context.purchaseRefreshOne('po'):f.context.purchaseSearchOlder('PO123');
 const data=()=>kind==='refresh'?{id:'po',purchase_order_lines:[{id:'line'}]}:[{id:'po',purchase_order_lines:[{id:'line'}]}];
 test(`${kind} current data updates order and lines`,async()=>{const f=fixture(),p=begin(f);f.requests[0].resolve({data:data()});await p;assert.equal(f.get('purchaseOrders.length'),1);assert.equal(f.get('purchaseLines.length'),1);assert.equal(f.context.renders,1)});
 test(`${kind} ignores result for replaced same-ID session`,async()=>{const f=fixture(),p=begin(f);f.context.me={user_id:'first'};f.requests[0].resolve({data:data()});await p;assert.equal(f.get('purchaseOrders.length'),0);assert.equal(f.context.renders,0)});
 test(`${kind} ignores late transport rejection after clear`,async()=>{const f=fixture(),p=begin(f);f.context.clearPurchasing();f.requests[0].reject(Error('Obsolete network failure'));await assert.doesNotReject(p);assert.equal(f.context.renders,0)});
}
test('refresh current error remains visible to caller',async()=>{const f=fixture(),p=f.context.purchaseRefreshOne('po');f.requests[0].resolve({error:{message:'Current failure'}});await assert.rejects(p,/Current failure/)});
test('refresh ignores stale server error after clear',async()=>{const f=fixture(),p=f.context.purchaseRefreshOne('po');f.context.clearPurchasing();f.requests[0].resolve({error:{message:'Old failure'}});await assert.doesNotReject(p)});
