import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const ctx=vm.createContext({document:{addEventListener(){}},esc:String,me:{role:'staff'},products:[{id:'product-1',name:'Old name',sku:'SKU',source:{}},{id:'deleted-1',name:'Removed',deleted_at:'2026-09-28'}],inventoryAvailableTotals:()=>({cartons:0,loose:3})});
 vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);
 for(const file of ['product-review-ui.js','inventory-operations.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 ctx.realInventoryLotCard=ctx.inventoryLotCard;
 vm.runInContext(`productDetailReviews.set('product-1',{name:'Corrected reagent',company:'Maker A',specification:'200 ml'});inventoryLots=[{id:'lot-1',product_id:'product-1',stock_status:'available'}];inventoryHeader=()=>'';inventorySetupProgress=()=>'';inventoryLotCard=lot=>'<b>'+lot.id+'</b>';`,ctx);
 return ctx;
}
test('stock uses reviewed identity without changing source product or UUID',()=>{
 const ctx=fixture(),product=ctx.inventoryProduct('product-1');
 assert.equal(product.name,'Corrected reagent');assert.equal(product.source.company,'Maker A');assert.equal(product.id,'product-1');
 assert.equal(ctx.products[0].name,'Old name');
 assert.equal(ctx.inventoryProduct('missing').name,'Unknown product');
});
test('choices display corrected identity and resolve it to the same active UUID',()=>{
 const ctx=fixture();
 const choices=ctx.inventoryProductChoices();assert.match(choices,/Corrected reagent/);assert.doesNotMatch(choices,/Old name|Removed/);
 assert.equal(ctx.inventoryProductFromChoice(ctx.inventoryProductChoice(ctx.inventoryProduct('product-1')))?.id,'product-1');
 assert.equal(ctx.inventoryProductFromChoice(ctx.inventoryProductChoice(ctx.products[1])),undefined);
 assert.match(ctx.inventoryProductOptions(),/Corrected reagent/);
});
test('stock search includes reviewed manufacturer and specification',()=>{
 const ctx=fixture();
 for(const query of ['Corrected reagent','maker a','200 ml']){
  vm.runInContext('inventorySearch='+JSON.stringify(query),ctx);
  assert.match(ctx.inventoryStock(),/>lot-1</,query);
 }
 vm.runInContext("inventorySearch='Maker B'",ctx);assert.doesNotMatch(ctx.inventoryStock(),/>lot-1</);
});
test('stock selectors visibly distinguish manufacturer/specification and full UUID collisions',()=>{
 const ctx=fixture();
 const a={id:'12345678-0000-0000-0000-000000000001',name:'Albumin',source:{company:'Maker A',specification:'200 ml'}};
 const b={...a,id:'12345678-0000-0000-0000-000000000002'};
 ctx.products.push(a,b);
 assert.notEqual(ctx.inventoryProductChoice(a),ctx.inventoryProductChoice(b));
 assert.match(ctx.inventoryProductChoice(a),/Maker A.*200 ml/);
 assert.equal(ctx.inventoryProductFromChoice(ctx.inventoryProductChoice(b)).id,b.id);
 assert.match(ctx.inventoryProductOptions(),/Maker A.*200 ml/);
 vm.runInContext("inventoryPacks=[{id:'pack',product_id:'product-1',base_unit:'bottle',units_per_carton:10,version:1}]",ctx);
 assert.match(ctx.inventoryPackOptions(),/Maker A.*200 ml/);
 assert.match(ctx.inventoryLotLabel({product_id:'product-1',sealed_cartons:1,loose_units:2}),/Maker A.*200 ml/);
 assert.match(ctx.inventoryProductChoice({id:'unknown',name:'Unreviewed'}),/Manufacturer needs review/);
});
test('stock cards display reviewed manufacturer and specification beside the product name',()=>{
 const ctx=fixture();
 const html=ctx.realInventoryLotCard({product_id:'product-1',stock_status:'available',sealed_cartons:1,loose_units:0});
 assert.match(html,/<h3>Corrected reagent · Maker A · 200 ml/);
});
