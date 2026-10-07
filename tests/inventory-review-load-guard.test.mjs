import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function fixture(){
 const content={innerHTML:''},calls=[];
 const query={select(){return this},order(){return this},limit(){return this},then(ok){return Promise.resolve({data:[]}).then(ok)}};
 const ctx=vm.createContext({
  document:{addEventListener(){},querySelectorAll(){return []}},$ :selector=>selector==='#content'?content:null,
  esc:String,client:{from:()=>query,rpc:async(name,args)=>{calls.push({name,args});return {data:{}}}},
  all:async table=>{if(table==='product_detail_reviews')throw Error('Correction connection unavailable');return [];},products:[{id:'p',name:'Raw source identity',source:{}}],
  me:{role:'owner',user_id:'owner'},organizations:[],syncWorkspaceNavigation(){},message(){},
  inventoryAvailableTotals:()=>({cartons:0,loose:0}),crypto:{randomUUID:()=> 'fixture-id'},
  FormData:class{constructor(form){this.fields=form.fields||{}}get(key){return this.fields[key]??''}}
 });
 vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);
 for(const file of ['product-review-ui.js','inventory-operations.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx,{filename:file});
 return {ctx,content,calls};
}

for(const section of ['stock','transfers'])test(`${section} fails closed on unavailable corrections, including direct rerenders`,async()=>{
 const {ctx,content}=fixture();
 vm.runInContext(`inventorySection='${section}'`,ctx);
 await ctx.inventoryWorkspace(true);
 assert.match(content.innerHTML,/Product corrections could not be loaded/);
 assert.match(content.innerHTML,/inventoryRefresh/);
 assert.doesNotMatch(content.innerHTML,/data-inventory-action=|Raw source identity/);
 const direct=section==='stock'?ctx.inventoryStock():ctx.inventoryTransferScreen();
 assert.match(direct,/Product corrections could not be loaded/);
});

test('stale stock and transfer forms cannot call any RPC after correction loading fails',async()=>{
 const {ctx,calls}=fixture();await ctx.loadInventoryOperations();
 for(const action of ['pack','opening','correct','request','dispatch','receive','open','issue','classification']){
  await assert.rejects(ctx.submitInventoryForm({dataset:{inventoryAction:action}}),/Refresh product corrections/);
 }
 assert.equal(calls.length,0);
});

test('stock submissions remain blocked while a correction refresh is pending',async()=>{
 const {ctx,calls}=fixture();let release;
 ctx.all=table=>table==='product_detail_reviews'?new Promise(resolve=>{release=resolve}):Promise.resolve([]);
 const pending=ctx.loadInventoryOperations();
 ctx.inventoryWorkspace=async()=>{};
 await assert.rejects(ctx.submitInventoryForm({dataset:{inventoryAction:'request'}}),/Refresh product corrections/);
 assert.equal(calls.length,0);
 release([]);await pending;
});

test('a successful retry restores stock and transfer forms and submission',async()=>{
 const {ctx,content,calls}=fixture();await ctx.inventoryWorkspace(true);
 ctx.all=async table=>table==='product_detail_reviews'?[{product_id:'p',version:1,name:'Reviewed identity',company:'Maker',specification:'Model'}]:[];
 await ctx.inventoryWorkspace(true);
 assert.match(content.innerHTML,/data-inventory-action="pack"/);
 assert.match(content.innerHTML,/Reviewed identity/);
 assert.doesNotMatch(content.innerHTML,/Product corrections could not be loaded|Raw source identity/);
 assert.match(ctx.inventoryTransferScreen(),/data-inventory-action="request"/);
 await ctx.submitInventoryForm({dataset:{inventoryAction:'request'}});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'request_inventory_transfer');
});

test('godown setup remains accessible and saveable during correction failure',async()=>{
 const {ctx,content,calls}=fixture();vm.runInContext("inventorySection='locations'",ctx);
 await ctx.inventoryWorkspace(true);
 assert.match(content.innerHTML,/data-inventory-action="location"/);
 await ctx.submitInventoryForm({dataset:{inventoryAction:'location'},fields:{name:'Godown',code:'G1',locationType:'godown'}});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'save_inventory_location');
});
