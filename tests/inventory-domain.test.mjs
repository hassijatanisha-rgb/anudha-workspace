import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context={};
vm.createContext(context);
vm.runInContext(fs.readFileSync('inventory-domain.js','utf8'),context);

assert.deepEqual(
 JSON.parse(JSON.stringify(context.planCartonTransfer({cartons:3,unitsPerCarton:24,availableCartons:4}))),
 {cartons:3,baseUnits:72}
);
assert.throws(()=>context.planCartonTransfer({cartons:5,unitsPerCarton:24,availableCartons:4}),/Only 4 sealed cartons/);
assert.throws(()=>context.planCartonTransfer({cartons:1.5,unitsPerCarton:24,availableCartons:4}),/whole cartons/);

assert.deepEqual(
 JSON.parse(JSON.stringify(context.planBreakPack({location:{name:'Haadi',isDispatchHub:true},cartons:2,unitsPerCarton:50,availableCartons:3,looseUnits:7}))),
 {sealedCartonChange:-2,looseUnitChange:100,remainingCartons:1,resultingLooseUnits:107,totalBaseUnitChange:0}
);
assert.throws(()=>context.planBreakPack({location:{name:'Main godown',isDispatchHub:false},cartons:1,unitsPerCarton:50,availableCartons:3,looseUnits:0}),/dispatch hub/);

assert.equal(context.receiptOutcome({expectedUnits:72,actualUnits:72,inspection:'pass'}),'received');
assert.equal(context.receiptOutcome({expectedUnits:72,actualUnits:71,inspection:'pass'}),'quarantine');
assert.equal(context.receiptOutcome({expectedUnits:72,actualUnits:72,inspection:'damaged'}),'quarantine');

assert.deepEqual(
 JSON.parse(JSON.stringify(context.stockPosition({sealedCartons:2,looseUnits:7,unitsPerCarton:50,reservedUnits:12}))),
 {totalBaseUnits:107,availableBaseUnits:95}
);
assert.throws(()=>context.stockPosition({sealedCartons:2,looseUnits:7,unitsPerCarton:50,reservedUnits:108}),/exceed/);

console.log('PASS: inventory domain conserves stock through transfer, receipt and Haadi carton opening.');
