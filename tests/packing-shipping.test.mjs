import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dom} from './helpers/dom-identity.mjs';
function context(){
 const ctx=vm.createContext({workspacePageHeader,statusTone,document:{addEventListener(){}},setInterval(){},Date,esc:v=>String(v??'')});
 vm.runInContext(readFileSync(new URL('../packing-queue.js',import.meta.url),'utf8'),ctx);return ctx;
}
test('a partially delivered order keeps its outstanding balance visible',()=>{
 const ctx=context();assert.equal(ctx.orderLiveText({status:'delivered',remaining_quantity:3}),'Partly delivered · 3 units still to deliver');
 assert.equal(ctx.orderLiveText({status:'delivered',remaining_quantity:0}),'Delivered');
});
test('stores head and owner can complete an order from the packing queue',()=>{
 const ctx=context();ctx.row={id:'one',version:2,delivery_number:'DN-1',items:[]};
 vm.runInContext('packingBoard={can_release:true,amber_minutes:20,overdue_minutes:30}',ctx);
 assert.match(ctx.packingCard(ctx.row),/data-packing-packed="one"/);
 vm.runInContext('packingBoard.can_release=false',ctx);assert.doesNotMatch(ctx.packingCard(ctx.row),/data-packing-packed/);
 assert.match(ctx.packingCard(ctx.row,true),/data-packing-packed="one"/);
});

test('Packed requires the inline item check and preserves the versioned writer',async()=>{
 const document=dom();document.addEventListener=()=>{};
 const calls=[],ctx=vm.createContext({workspacePageHeader,document,statusTone,setInterval(){},esc:v=>String(v??''),Date,run:fn=>fn(),client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'one'}}}}});
 vm.runInContext(readFileSync(new URL('../packing-queue.js',import.meta.url),'utf8'),ctx);
 vm.runInContext('packingBoard={can_release:false,amber_minutes:20,overdue_minutes:30};packingAct=save=>save()',ctx);
 document.body.innerHTML=ctx.packingCard({id:'one',version:2,delivery_number:'DN-1',items:[]},true);ctx.bindPackingQueue();
 const button=document.querySelector('[data-packing-packed]'),check=document.querySelector('[data-packing-checked]');
 assert.equal(button.disabled,true);await button.onclick();assert.equal(calls.length,0);
 check.checked=true;check.onchange();assert.equal(button.disabled,false);await button.onclick();assert.equal(calls.length,1);assert.equal(calls[0].name,'packing_mark_packed');assert.deepEqual({...calls[0].args},{p_id:'one',p_expected_version:2});
 check.checked=false;check.onchange();assert.equal(button.disabled,true);await button.onclick();assert.equal(calls.length,1);
 check.checked=true;vm.runInContext("packingError='Refresh before continuing.'",ctx);check.onchange();assert.equal(button.disabled,true);await button.onclick();assert.equal(calls.length,1);
 vm.runInContext("packingError='';packingPendingAction=2",ctx);check.onchange();assert.equal(button.disabled,true);await button.onclick();assert.equal(calls.length,1);
 vm.runInContext('packingPendingAction=0',ctx);button.remove();await button.onclick();assert.equal(calls.length,1);
});
