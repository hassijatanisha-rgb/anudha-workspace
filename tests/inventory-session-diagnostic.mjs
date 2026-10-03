// Actual inventory loader, fictional deferred reads; no database/network.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let release;
const delayed=new Promise(resolve=>{release=resolve});
const query={select(){return this},order(){return this},limit(){return this},then(ok){return Promise.resolve({data:[]}).then(ok)}};
const ctx=vm.createContext({me:{user_id:'first'},productReviewLoadError:'',productDetailReviews:new Map(),
 document:{addEventListener(){}},client:{from:()=>query},
 all:async table=>table==='inventory_locations'?delayed:[]});
vm.runInContext(readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8'),ctx);
const pending=ctx.loadInventoryOperations();
await new Promise(resolve=>setImmediate(resolve));
ctx.me={user_id:'second'};
release([{id:'old-location',name:'Fictional old session location'}]);
await pending;
assert.equal(vm.runInContext('inventoryLocations.length',ctx),0,'old account response must not populate inventory cache after account switch');
console.log('PASS: inventory loader rejects prior account response.');
