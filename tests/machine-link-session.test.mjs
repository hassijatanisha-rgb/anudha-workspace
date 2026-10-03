import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../product-machine-links.js',import.meta.url),'utf8');
for(const outcome of ['success','error'])test(`machine links ignore prior actor ${outcome}`,async()=>{
 let resolve,reject;const ctx=vm.createContext({me:{user_id:'first'},all:()=>new Promise((yes,no)=>{resolve=yes;reject=no})});
 ctx.document={addEventListener(){}};vm.runInContext(source,ctx);const pending=ctx.loadProductMachineLinks();ctx.me={user_id:'second'};
 vm.runInContext("productMachineLinksError='Current session'",ctx);
 if(outcome==='success')resolve([{product_id:'old',version:1,machine_ids:[]}]);else reject(Error('Old error'));
 await pending;
 assert.equal(vm.runInContext('productMachineLinks.size',ctx),0);
 assert.equal(vm.runInContext('productMachineLinksError',ctx),'Current session');
});
test('machine links keep newer refresh result',async()=>{
 let release;const ctx=vm.createContext({me:{user_id:'first'},all:()=>new Promise(resolve=>{release=resolve})});
 ctx.document={addEventListener(){}};vm.runInContext(source,ctx);const old=ctx.loadProductMachineLinks();
 ctx.all=async()=>[{product_id:'new',version:1,machine_ids:[]}];await ctx.loadProductMachineLinks();
 release([{product_id:'old',version:1,machine_ids:[]}]);await old;
 assert.equal(vm.runInContext('productMachineLinks.has("new")',ctx),true);
});
