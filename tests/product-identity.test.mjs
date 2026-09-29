import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const domain=vm.createContext({});
vm.runInContext(readFileSync(new URL('../product-identity.js',import.meta.url),'utf8'),domain);
const identity={name:'Glucose',sku:'G1',manufacturer:'Maker A',specification:'Model-X',packUnit:'100 tests / kit'};
const run=(source,rows)=>JSON.parse(JSON.stringify(domain.productIdentityCandidates(source,rows)));

test('same name and SKU from distinct manufacturers retain distinct UUIDs',()=>{
 const rows=[{...identity,id:'uuid-a'},{...identity,id:'uuid-b',manufacturer:'Maker B'}];
 assert.deepEqual(run(identity,rows).productIds,['uuid-a']);
 assert.deepEqual(run({...identity,manufacturer:'Maker B'},rows).productIds,['uuid-b']);
 assert.equal(run(identity,rows).status,'exact');
 assert.equal(run(identity,rows).autoMerge,false);
});
test('normalizes only case and whitespace, preserving punctuation and model distinctions',()=>{
 assert.equal(domain.normalizeProductIdentityText('  Model-X   PLUS '),'model-x plus');
 assert.equal(run({...identity,name:' GLUCOSE ',manufacturer:' maker   a '},[{...identity,id:'a'}]).status,'exact');
 for(const specification of ['Model X','Model/X','ModelX'])assert.deepEqual(run({...identity,specification},[{...identity,id:'a'}]).productIds,[]);
});
test('specification, pack unit and conflicting SKU never match exactly',()=>{
 for(const change of [{specification:'Model-Y'},{packUnit:'50 tests / kit'},{sku:'G2'}]){
  const result=run({...identity,...change},[{...identity,id:'a'}]);
  assert.equal(result.status,'needs_review');assert.deepEqual(result.productIds,[]);assert.deepEqual(result.candidateIds,['a']);
 }
});
test('unknown manufacturer needs review and is not inferred from machine data',()=>{
 const result=run({...identity,manufacturer:'',machineManufacturer:'Maker A'},[{...identity,id:'a'}]);
 assert.equal(result.status,'needs_review');assert.deepEqual(result.productIds,[]);
 assert.ok(result.reasons.includes('source_missing_manufacturer'));
 assert.equal(run(identity,[{...identity,id:'a',manufacturer:null}]).status,'needs_review');
});
test('multiple matching product UUIDs are ambiguous and sorted stably',()=>{
 const rows=[{...identity,id:'z'},{...identity,id:'a'}];
 const result=run(identity,rows);
 assert.equal(result.status,'ambiguous');assert.deepEqual(result.productIds,[]);assert.deepEqual(result.candidateIds,['a','z']);
 assert.deepEqual(run(identity,rows.reverse()),result);
});
test('conflicting manufacturer records sharing a UUID cannot be selected as exact',()=>{
 const result=run(identity,[{...identity,id:'shared'},{...identity,id:'shared',manufacturer:'Maker B'}]);
 assert.equal(result.status,'needs_review');assert.deepEqual(result.productIds,[]);
 assert.ok(result.reasons.includes('conflicting_identity_for_product_id:shared'));
});
test('identical repeated machine references keep one UUID while incomplete alternatives require review',()=>{
 assert.deepEqual(run(identity,[{...identity,id:'shared',machineId:'one'},{...identity,id:'shared',machineId:'two'}]).productIds,['shared']);
 const result=run(identity,[{...identity,id:'exact'},{...identity,id:'unknown',manufacturer:''}]);
 assert.equal(result.status,'needs_review');assert.deepEqual(result.productIds,[]);
 assert.deepEqual(result.candidateIds,['exact','unknown']);
});
test('no stock arithmetic or input mutation; unrelated rows are not candidates',()=>{
 const rows=[{...identity,id:'a',stock:3},{...identity,id:'b',stock:8}];const before=JSON.stringify(rows);
 assert.equal('stock' in run(identity,rows),false);assert.equal(JSON.stringify(rows),before);
 assert.equal(run(identity,[{...identity,id:'other',name:'Urea',sku:'U1'}]).status,'unmatched');
 assert.throws(()=>domain.productIdentityCandidates(identity,[{...identity}]),/ID/);
});
