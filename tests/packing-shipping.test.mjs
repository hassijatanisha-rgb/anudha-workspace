import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function context(){
 const ctx=vm.createContext({document:{addEventListener(){}},setInterval(){},Date,esc:v=>String(v??'')});
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
