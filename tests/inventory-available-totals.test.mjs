import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../inventory-domain.js',import.meta.url),'utf8'),c);
test('Available loose stock excludes invoice reservations and quarantine',()=>{
 const result=c.inventoryAvailableTotals([{stock_status:'available',sealed_cartons:2,loose_units:50,reserved_units:20},{stock_status:'quarantine',sealed_cartons:10,loose_units:500,reserved_units:0}]);
 assert.equal(result.cartons,2);assert.equal(result.loose,30);assert.equal(result.reserved,20);
});
test('Invalid reservation cannot become a plausible available count',()=>{
 assert.throws(()=>c.inventoryAvailableTotals([{stock_status:'available',sealed_cartons:0,loose_units:1,reserved_units:2}]),/reservation/i);
});
