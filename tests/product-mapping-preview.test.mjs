import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync,existsSync} from 'node:fs';
function domain(){const ctx=vm.createContext({});for(const file of ['product-identity.js','product-mapping-preview.js']){const path=new URL('../'+file,import.meta.url);if(existsSync(path))vm.runInContext(readFileSync(path,'utf8'),ctx)}return ctx;}
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
const catalog=[{id:a,name:'Albumin',source:{company:'Maker A',specification:'200 ml',units:'bottle'}},{id:b,name:'Albumin',source:{company:'Maker B',specification:'200 ml',units:'bottle'}}];
function envelope(patch={}){const original={name:'Old label',manufacturer:'Maker A',model:'200 ml',units:'bottle',totalStock:-2,locations:'Godown A',source:'Original workbook'};return {schema:'anudha-product-mapping-v1',exportedAt:'2026-09-28T16:00:00Z',rows:[{sourceKey:'source-1',original,corrected:{...original,name:'Albumin',...patch},editedLocally:true,editedAt:123}]};}
test('mapping keeps source keys, corrections and negative stock; never merges different makers',()=>{
 const ctx=domain();assert.equal(typeof ctx.buildProductMappingPreview,'function');const source=envelope(),before=JSON.stringify(source);
 const result=ctx.buildProductMappingPreview(source,catalog),row=result.rows[0];
 assert.equal(row.sourceKey,'source-1');assert.equal(row.original.name,'Old label');assert.equal(row.corrected.name,'Albumin');
 assert.equal(row.corrected.totalStock,-2);assert.ok(row.issues.includes('negative_stock'));assert.equal(row.match.productIds[0],a);
 assert.equal(row.match.autoMerge,false);assert.equal(JSON.stringify(source),before);
 assert.equal(ctx.buildProductMappingPreview(envelope({manufacturer:'Maker B'}),catalog).rows[0].match.productIds[0],b);
});
test('missing units/manufacturer and multiple matching IDs require review',()=>{
 const ctx=domain();assert.equal(typeof ctx.buildProductMappingPreview,'function');
 assert.equal(ctx.buildProductMappingPreview(envelope({manufacturer:''}),catalog).rows[0].match.status,'needs_review');
 assert.equal(ctx.buildProductMappingPreview(envelope(),[...catalog,{...catalog[0],id:'duplicate'}]).rows[0].match.status,'ambiguous');
 const unknownUnit=envelope({units:''});unknownUnit.rows[0].original.units='';
 assert.equal(ctx.buildProductMappingPreview(unknownUnit,catalog).rows[0].match.status,'needs_review');
});
test('mapping rejects ambiguous provenance and strips financial fields',()=>{
 const ctx=domain();assert.equal(typeof ctx.buildProductMappingPreview,'function');
 const data=envelope({price:999,currency:'USD'});data.rows[0].original.price=1;
 assert.doesNotMatch(JSON.stringify(ctx.buildProductMappingPreview(data,catalog)),/price|currency/);
 data.rows.push(data.rows[0]);assert.throws(()=>ctx.buildProductMappingPreview(data,catalog),/duplicate/i);
 assert.throws(()=>ctx.buildProductMappingPreview({...envelope(),schema:'wrong'},catalog),/format/i);
 assert.throws(()=>ctx.buildProductMappingPreview(envelope({locations:'Changed warehouse'}),catalog),/stock|source/i);
});
test('blank stock remains unknown, zero remains zero, source manufacturer is never inferred',()=>{
 const ctx=domain();assert.equal(typeof ctx.buildProductMappingPreview,'function');
 const data=envelope();data.rows[0].original.totalStock='';data.rows[0].corrected.totalStock='';
 assert.equal(ctx.buildProductMappingPreview(data,catalog).rows[0].corrected.totalStock,'');
 data.rows[0].original.totalStock=0;data.rows[0].corrected.totalStock=0;
 assert.equal(ctx.buildProductMappingPreview(data,catalog).rows[0].corrected.totalStock,0);
 data.rows[0].original.totalStock=null;data.rows[0].corrected.totalStock=null;
 assert.equal(ctx.buildProductMappingPreview(data,catalog).rows[0].original.totalStock,null);
});
test('whitespace-only stock is flagged as unreported without rewriting source',()=>{
 const ctx=domain();
 for(const value of ['   ','\t','\n']){
  const data=envelope();data.rows[0].original.totalStock=value;data.rows[0].corrected.totalStock=value;
  const row=ctx.buildProductMappingPreview(data,catalog).rows[0];
  assert.ok(row.issues.includes('stock_not_reported'));
  assert.equal(row.original.totalStock,value);assert.equal(row.corrected.totalStock,value);
 }
});
