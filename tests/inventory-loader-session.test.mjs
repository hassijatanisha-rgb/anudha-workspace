import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8');
function fixture(){
 const query={select(){return this},order(){return this},limit(){return this},then(ok){return Promise.resolve({data:[]}).then(ok)}};
 const ctx=vm.createContext({me:{user_id:'first'},productReviewLoadError:'',productDetailReviews:new Map(),document:{addEventListener(){}},client:{from:()=>query},all:async()=>[]});
 vm.runInContext(source,ctx);return ctx;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('current inventory load fills cache',async()=>{
 const ctx=fixture();ctx.all=async table=>table==='inventory_locations'?[{id:'current',name:'Current'}]:[];
 await ctx.loadInventoryOperations();assert.equal(vm.runInContext('inventoryLocations[0].id',ctx),'current');
});
for(const outcome of ['success','error'])test(`old correction ${outcome} cannot overwrite next account review state`,async()=>{
 const ctx=fixture();let resolve,reject;
 ctx.all=()=>new Promise((yes,no)=>{resolve=yes;reject=no});
 const pending=ctx.loadInventoryOperations();await tick();
 ctx.me={user_id:'second'};ctx.productReviewLoadError='New session marker';
 if(outcome==='error')reject(Error('Old account error'));else resolve([{product_id:'old',version:1}]);
 await pending;assert.equal(ctx.productReviewLoadError,'New session marker');assert.equal(ctx.productDetailReviews.size,0);
});
test('older same-account load cannot replace newer inventory results',async()=>{
 const ctx=fixture();let release;
 ctx.all=async table=>table==='inventory_locations'?new Promise(resolve=>{release=resolve}):[];
 const first=ctx.loadInventoryOperations();await tick();
 ctx.all=async table=>table==='inventory_locations'?[{id:'new',name:'New'}]:[];
 await ctx.loadInventoryOperations();release([{id:'old',name:'Old'}]);await first;
 assert.equal(vm.runInContext('inventoryLocations[0].id',ctx),'new');
});
