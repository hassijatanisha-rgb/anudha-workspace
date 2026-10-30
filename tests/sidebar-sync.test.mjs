import {installLeaveContext} from './helpers/leave-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

for(const [file,entry,bindings] of [
 ['sales-delivery.js','salesDeliveryWorkspace()',"salesSection='documents';officialDocumentsScreen=()=>'';bindSalesDelivery=()=>{};"],
 ['service-workflow.js','serviceWorkspace()',"loadServicePage=async()=>true;installationScreen=()=>'';bindServiceWorkflow=()=>{};"],
 ['inventory-operations.js','inventoryWorkspace()',"inventorySection='catalog';inventoryLoaded=true;catalogInventory=()=>{};"]
])test(`${file} synchronizes sidebar when its page opens directly`,async()=>{
 let calls=0;
 const context=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,me:{user_id:'fixture'},view:file==='sales-delivery.js'?'sales':file==='service-workflow.js'?'service':'inventory',document:{querySelector:()=>null,addEventListener(){}},$:()=>({innerHTML:''}),syncWorkspaceNavigation:()=>calls++});
 vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 installLeaveContext(context);vm.runInContext(bindings,context);
 await vm.runInContext(entry,context);
 assert.equal(calls,1);
});

test('My tasks installs the bell without duplicating its after-load refresh; other navigation still refreshes',()=>{
 const source=readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8'),start=source.indexOf('function syncWorkspaceNavigation(){'),end=source.indexOf('\ninstallWorkspaceNavigation();',start);
 const calls=[],ctx=vm.createContext({view:'personal',personalSection:'task',me:{role:'staff'},document:{querySelectorAll:()=>[]},bellInstall:()=>calls.push('install'),refreshNotificationBell:async()=>calls.push('refresh')});
 vm.runInContext(source.slice(start,end),ctx);ctx.syncWorkspaceNavigation();assert.deepEqual(calls,['install']);
 ctx.personalSection='note';ctx.syncWorkspaceNavigation();ctx.view='dashboard';ctx.syncWorkspaceNavigation();assert.deepEqual(calls,['install','refresh','refresh']);
});
