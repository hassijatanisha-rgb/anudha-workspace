import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('merged auth cleanup clears both inventory and service while rejecting in-flight results',async()=>{
 const pending=[];
 const ctx=vm.createContext({me:{user_id:'fixture'},organizations:[],contacts:[],products:[],duplicates:new Map(),clearEmployeeNames(){},$:()=>({}),document:{addEventListener(){},querySelectorAll:()=>[]},productDetailReviews:new Map(),productReviewLoadError:'',all:()=>new Promise(resolve=>pending.push(()=>resolve([]))),client:{from(){const q={select(){return q},order(){return q},limit(){return q},then(resolve,reject){return new Promise(done=>pending.push(()=>done({data:[{id:'stale'}],error:null}))).then(resolve,reject)}};return q;}}});
 for(const file of ['product-machine-links.js','inventory-operations.js','tally-stock-review.js','service-workflow.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 vm.runInContext("inventoryLocations=[{id:'old'}];inventoryLoaded=true;serviceCases=[{id:'old'}];serviceLoaded=true;tallyRows=[{id:'old'}];productMachineLinks.set('old',{});",ctx);
 const work=[ctx.loadServiceWorkflow(),ctx.loadProductMachineLinks()];
 await new Promise(resolve=>setImmediate(resolve));
 const actor=ctx.me;
 vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8').split('\n').find(l=>l.startsWith('function clear(){')),ctx);
 ctx.clear();assert.equal(ctx.me,null);ctx.me=actor;
 for(const finish of pending)finish();await Promise.all(work);
 for(const name of ['inventoryLocations','serviceCases','serviceAssets','serviceEvents','serviceReports','serviceAccessories','serviceAttendees','serviceTeam','tallyRows'])assert.equal(vm.runInContext(name+'.length',ctx),0,name);
 assert.equal(vm.runInContext('productMachineLinks.size',ctx),0);
 assert.equal(vm.runInContext('inventoryLoaded||serviceLoaded',ctx),false);
});
