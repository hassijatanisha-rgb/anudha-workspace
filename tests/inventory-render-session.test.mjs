import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
for(const section of ['stock','review','catalog'])for(const change of ['account','navigation'])test(`${section} does not render after ${change}`,async()=>{
 let release;const content={innerHTML:''};let renders=0;
 const ctx=vm.createContext({me:{user_id:'first'},view:'inventory',document:{addEventListener(){}},$:()=>content,syncWorkspaceNavigation(){}});
 vm.runInContext(readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(`inventorySection='${section}'`,ctx);
 ctx.loadInventoryOperations=()=>new Promise(resolve=>{release=resolve});
 ctx.tallyStockScreen=ctx.catalogInventory=()=>{renders++;content.innerHTML='Old inventory'};
 ctx.inventoryUnavailable=()=>{renders++;return 'Old unavailable'};ctx.bindInventoryWorkspace=()=>{};
 const pending=ctx.inventoryWorkspace();
 if(change==='account')ctx.me={user_id:'second'};else ctx.view='clients';
 content.innerHTML='New page';release();await pending;
 assert.equal(content.innerHTML,'New page');assert.equal(renders,0);
});
