import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Stock & availability draws 50 lots at a time; search still covers every lot and redraws only the list.
const nodes={};
const ctx=vm.createContext({document:{addEventListener(){}},companyDate:()=> '2026-10-30',inventoryStockTotals:()=>({cartons:0,loose:0,reserved:0,freeLoose:0,invoiceableLoose:0}),me:{role:'staff'},esc:String,$:s=>nodes[s]||null});
vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8'),ctx);
vm.runInContext(`inventoryProduct=id=>({id,name:id==='p1730'?'Rare reagent':'Glucose strip',sku:id});inventoryLocation=()=>({name:'Haadi',code:'HAA'});inventoryHeader=()=>'';inventorySetupProgress=()=>'';inventoryLotCard=x=>'<b>'+x.id+'</b>';
inventoryLots=Array.from({length:1752},(_,i)=>({id:'lot'+i,product_id:'p'+i,stock_status:'available'}));`,ctx);
const cards=html=>(html.match(/<b>lot\d+<\/b>/g)||[]).length;
test('First view draws 50 of 1,752 lots with a Show more button',()=>{
 const html=ctx.inventoryStock();
 assert.equal(cards(html),50);
 assert.match(html,/1,752 of 1,752 non-quarantined lots · showing the first 50/);
 assert.match(html,/id="moreStockLots">Show 50 more \(1,702 left\)/);
});
test('Show more adds 50 and only redraws the list',()=>{
 const box={innerHTML:''};nodes['#inventoryStockList']=box;
 const more={};nodes['#moreStockLots']=more;
 vm.runInContext('bindInventoryStockList()',ctx);more.onclick();
 assert.equal(cards(box.innerHTML),100);assert.match(box.innerHTML,/1,652 left/);
});
test('Search finds a lot beyond the first 50 and resets paging',()=>{
 vm.runInContext("inventorySearch='rare';inventoryStockShown=50",ctx);
 const html=ctx.inventoryStock();
 assert.equal(cards(html),1);assert.match(html,/<b>lot1730<\/b>/);assert.doesNotMatch(html,/moreStockLots/);
});
test('No match shows the empty message',()=>{
 vm.runInContext("inventorySearch='nothing like this'",ctx);
 assert.match(ctx.inventoryStock(),/No stock matches this search/);
});
