import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

for(const [file,entry,bindings] of [
 ['sales-delivery.js','salesDeliveryWorkspace()',"salesSection='documents';officialDocumentsScreen=()=>'';bindSalesDelivery=()=>{};"],
 ['service-workflow.js','serviceWorkspace()',"serviceLoaded=true;installationScreen=()=>'';bindServiceWorkflow=()=>{};"],
 ['inventory-operations.js','inventoryWorkspace()',"inventorySection='catalog';inventoryLoaded=true;catalogInventory=()=>{};"]
])test(`${file} synchronizes sidebar when its page opens directly`,async()=>{
 let calls=0;
 const context=vm.createContext({$:()=>({innerHTML:''}),syncWorkspaceNavigation:()=>calls++});
 vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 vm.runInContext(bindings,context);
 await vm.runInContext(entry,context);
 assert.equal(calls,1);
});
