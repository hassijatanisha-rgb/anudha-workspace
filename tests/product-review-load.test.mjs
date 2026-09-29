import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Failed correction loading is visible and never silently shows raw product data as current',async()=>{
 const content={innerHTML:''};
 const query={select(){return this},order(){return this},limit(){return this},then(ok){return Promise.resolve({data:[]}).then(ok)}};
 const context=vm.createContext({document:{addEventListener(){}},$ :()=>content,esc:String,client:{from:()=>query},all:async()=>{throw Error('Connection unavailable')},products:[],me:{role:'staff'}});
 for(const file of ['product-review-ui.js','inventory-operations.js','catalog-inventory.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 await context.loadInventoryOperations();
 assert.match(vm.runInContext('productReviewLoadError',context),/Connection unavailable/);
 context.catalogInventory();
 assert.match(content.innerHTML,/corrections could not be loaded/i);
 assert.doesNotMatch(content.innerHTML,/Active for sale/);
 context.all=async()=>[];await context.loadInventoryOperations();
 assert.equal(vm.runInContext('productReviewLoadError',context),'');
});
