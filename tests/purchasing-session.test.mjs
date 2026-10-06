import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const requests=[],output={innerHTML:'Clients'},context=vm.createContext({me:{user_id:'first'},view:'purchasing',renders:0,$:()=>output,syncWorkspaceNavigation(){},all:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))});
 vm.runInContext(readFileSync(new URL('../purchasing.js',import.meta.url),'utf8'),context);
 vm.runInContext('renderPurchasing=()=>{renders++}',context);
 return {context,requests,output,get:code=>vm.runInContext(code,context),resolve(start=0){requests.slice(start,start+2).forEach(r=>r.resolve([]))}};
}
test('current purchasing request renders',async()=>{const f=fixture(),p=f.context.purchasingWorkspace();f.resolve();await p;assert.equal(f.context.renders,1)});
test('nested order items remain available after current load',async()=>{const f=fixture(),p=f.context.loadPurchasing();f.requests[0].resolve([{id:'po',purchase_order_lines:[{id:'line',purchase_order_id:'po'}]}]);f.requests[1].resolve([{id:'supplier'}]);assert.equal(await p,true);assert.equal(f.get('purchaseOrders[0].id'),'po');assert.equal(f.get('purchaseOrders[0].purchase_order_lines'),undefined);assert.equal(f.get('purchaseLines[0].purchase_order_id'),'po');assert.equal(f.get('suppliers[0].id'),'supplier');assert.equal(f.requests.length,2)});
test('off-view purchasing callback cannot replace content with loading',async()=>{const f=fixture();f.context.view='clients';const p=f.context.purchasingWorkspace();f.resolve();await p;assert.equal(f.output.innerHTML,'Clients');assert.equal(f.requests.length,0)});
test('same-ID replacement actor cannot receive old purchasing rows',async()=>{const f=fixture(),p=f.context.loadPurchasing();f.context.me={user_id:'first'};f.requests[0].resolve([{id:'old'}]);f.requests[1].resolve([]);await p;assert.equal(f.get('purchaseOrders.length'),0)});
test('old purchasing error cannot overwrite newer successful refresh',async()=>{const f=fixture(),old=f.context.purchasingWorkspace(true),fresh=f.context.purchasingWorkspace(true);f.resolve(2);await fresh;f.requests[0].reject(Error('Old error'));f.requests[1].resolve([]);await old;assert.equal(f.get('purchaseLoadError'),'');assert.equal(f.context.renders,1)});
test('same actor clear invalidates pending purchasing error',async()=>{const f=fixture(),p=f.context.purchasingWorkspace(true);f.context.clearPurchasing();f.requests[0].reject(Error('Old error'));f.requests[1].resolve([]);await p;assert.equal(f.get('purchaseLoadError'),'');assert.equal(f.context.renders,0)});
