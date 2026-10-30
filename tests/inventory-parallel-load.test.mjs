import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Opening Product search or Stock asks for machine links, product corrections and stock tables in one round trip.
test('Machine links, corrections and stock tables are all requested before any of them answers',async()=>{
 const asked=[],waiting=[];
 const later=value=>new Promise(resolve=>waiting.push(()=>resolve(value)));
 const query={select(){return this},order(){return this},limit(){return this},then(ok,bad){return later({data:[]}).then(ok,bad)}};
 const context=vm.createContext({document:{addEventListener(){}},$:()=>null,esc:String,me:{role:'staff'},products:[],
  client:{from:table=>{asked.push(table);return query}},all:table=>{asked.push(table);return later(table==='product_detail_reviews'?[{product_id:'p1',version:2,name:'Fixed'}]:[])}});
 for(const file of ['product-machine-links.js','product-review-ui.js','inventory-operations.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 const loading=context.loadInventoryOperations();
 await new Promise(resolve=>setTimeout(resolve,0));
 for(const table of ['product_machine_link_reviews','product_detail_reviews','inventory_locations','product_pack_definitions','inventory_lots','inventory_transfers','inventory_issues','inventory_movements','product_inventory_classifications'])
  assert.ok(asked.includes(table),`${table} requested before anything answered`);
 while(waiting.length)waiting.shift()();
 assert.equal(await loading,true);
 assert.equal(vm.runInContext('productReviewLoadError',context),'');
 assert.equal(vm.runInContext("productDetailReviews.get('p1').name",context),'Fixed');
});
