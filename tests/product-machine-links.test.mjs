import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
function fixture(){
 const ctx=vm.createContext({me:{user_id:'fixture'},document:{addEventListener(){}},all:async()=>[],esc:String});
 const path=new URL('../product-machine-links.js',import.meta.url);
 if(existsSync(path))vm.runInContext(readFileSync(path,'utf8'),ctx);
 return ctx;
}
test('machine editor does not convert malformed source links into selections',()=>{
 const ctx=fixture();assert.equal(typeof ctx.machineLinkImportedIds,'function');
 for(const ids of ['a,b',42,{a:true},['a',42],[' a ']])assert.deepEqual(Array.from(ctx.machineLinkImportedIds({source:{machine_ids:ids}})),[]);
 const product={source:{machine_ids:['a','b']}};assert.deepEqual(Array.from(ctx.machineLinkImportedIds(product)),['a','b']);
 assert.deepEqual(product.source.machine_ids,['a','b']);
});
test('latest saved relationships overlay imported links without cloning products',async()=>{
 const ctx=fixture();assert.equal(typeof ctx.loadProductMachineLinks,'function');
 ctx.all=async()=>[{product_id:'r',version:2,machine_ids:['a','b']},{product_id:'r',version:1,machine_ids:['a']}];
 await ctx.loadProductMachineLinks();
 const source={id:'r',source:{machine_ids:['old'],company:'Maker A'}};
 const result=ctx.machineLinkReviewedProduct(source);
 assert.equal(result.id,'r');assert.deepEqual(Array.from(result.source.machine_ids),['a','b']);
 assert.deepEqual(source.source.machine_ids,['old']);assert.equal(result.source.company,'Maker A');
});
test('explicit empty review clears imported links and load failures do not claim current data',async()=>{
 const ctx=fixture();assert.equal(typeof ctx.loadProductMachineLinks,'function');
 ctx.all=async()=>[{product_id:'r',version:1,machine_ids:[]}];await ctx.loadProductMachineLinks();
 assert.equal(ctx.machineLinkReviewedProduct({id:'r',source:{machine_ids:['old']}}).source.machine_ids.length,0);
 ctx.all=async()=>{throw Error('Connection unavailable')};await ctx.loadProductMachineLinks();
 assert.match(vm.runInContext('productMachineLinksError',ctx),/Connection unavailable/);
 ctx.all=async()=>[];await ctx.loadProductMachineLinks();assert.equal(vm.runInContext('productMachineLinksError',ctx),'');
});
