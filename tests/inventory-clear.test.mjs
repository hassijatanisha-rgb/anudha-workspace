import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('actual auth clear removes inventory caches and invalidates pending same-actor reads',async()=>{
 let release;
 const ctx=vm.createContext({me:{user_id:'owner'},organizations:[],contacts:[],products:[],duplicates:new Map(),clearEmployeeNames(){},$:()=>({}),document:{addEventListener(){},querySelectorAll:()=>[]},productDetailReviews:new Map(),productReviewLoadError:'',all:()=>new Promise(resolve=>{release=resolve})});
 for(const file of ['product-machine-links.js','inventory-operations.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 vm.runInContext(`inventoryLocations=[{id:'old'}];inventoryLoaded=true;inventoryImportPreview={old:true};inventoryLatestPacks.set('old',{});productDetailReviews.set('old',{});productMachineLinks.set('old',{});`,ctx);
 const actor=ctx.me,pending=ctx.loadProductMachineLinks();
 const clear=readFileSync(new URL('../app.js',import.meta.url),'utf8').split('\n').find(line=>line.startsWith('function clear(){'));
 vm.runInContext(clear,ctx);ctx.clear();ctx.me=actor;
 release([{product_id:'old',version:1,machine_ids:[]}]);await pending;
 assert.equal(vm.runInContext('inventoryLocations.length',ctx),0);
 assert.equal(vm.runInContext('inventoryLoaded',ctx),false);
 assert.equal(vm.runInContext('inventoryImportPreview',ctx),null);
 for(const name of ['inventoryLatestPacks','productDetailReviews','productMachineLinks'])assert.equal(vm.runInContext(name+'.size',ctx),0,name);
});
