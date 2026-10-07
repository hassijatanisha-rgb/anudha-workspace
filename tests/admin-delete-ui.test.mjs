import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
test('Staff cannot open product deletion or send any archive RPC',async()=>{
 const ctx=vm.createContext({me:{role:'staff'},document:{addEventListener(){}},client:{rpc(){throw Error('RPC must not run')}}});
 vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);
 const file=new URL('../admin-records.js',import.meta.url);if(existsSync(file))vm.runInContext(readFileSync(file,'utf8'),ctx);
 assert.equal(typeof ctx.openArchiveBusinessRecord,'function');
 await assert.rejects(ctx.openArchiveBusinessRecord('product','test'),/Clients & items data/);
 await assert.rejects(ctx.openArchiveBusinessRecord('proforma','test'),/Owner access/);
});
test('Owners archive a product without a reason and retain a confirmation',async()=>{
 let submit,args;const ctx=vm.createContext({me:{role:'owner'},products:[{id:'test',name:'Fixture'}],esc:x=>x,document:{addEventListener(){}},actionForm:(title,html,fn)=>{assert.match(html,/restore/i);assert.doesNotMatch(html,/textarea/);submit=fn;return null},client:{rpc:async(name,params)=>{args={name,params};return {}}},load:async()=>{},message(){}});
 vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);
 const file=new URL('../admin-records.js',import.meta.url);if(existsSync(file))vm.runInContext(readFileSync(file,'utf8'),ctx);
 assert.equal(typeof ctx.openArchiveBusinessRecord,'function');await ctx.openArchiveBusinessRecord('product','test');await submit();
 assert.equal(args.name,'set_product_archived');assert.equal(args.params.p_archived,true);
});
test('Clients & items data lets a staff member delete products but not draft Pro formas',async()=>{
 let submit,args;const ctx=vm.createContext({me:{role:'staff',access:['proformas','records']},products:[{id:'test',name:'Fixture'}],salesProforma:()=>({id:'pf',status:'draft',version:1,document_number:'PF-1'}),esc:x=>x,document:{addEventListener(){}},actionForm:(title,html,fn)=>{submit=fn;return null},client:{rpc:async(name,params)=>{args={name,params};return {}}},load:async()=>{},message(){}});
 vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(readFileSync(new URL('../admin-records.js',import.meta.url),'utf8'),ctx);
 await ctx.openArchiveBusinessRecord('product','test');await submit();
 assert.equal(args.name,'set_product_archived');
 await assert.rejects(ctx.openArchiveBusinessRecord('proforma','pf'),/Owner access/);
});
