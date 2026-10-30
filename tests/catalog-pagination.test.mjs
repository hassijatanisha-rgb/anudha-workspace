import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPageHeader} from './helpers/page-header.mjs';
import {readFileSync} from 'node:fs';
const recordSource=readFileSync(new URL('../record-navigation.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../catalog-inventory.js',import.meta.url),'utf8');
const response=(rows=[],total=rows.length)=>({data:{rows,total,page:0,pages:Math.max(1,Math.ceil(total/25)),metrics:{products:total,review:0,active:total,manufacturers:1},category_counts:{all:total},colour_counts:{ok:total}}});
function fixture(rpc=async()=>response()){
 const nodes=new Map(['#catalogResults','#catalogStatus','#catalogSearch','#catalogPrev','#catalogNext','#catalogRetry'].map(id=>[id,{innerHTML:'',textContent:'',setAttribute(){}}])),calls=[],renders=[];
 const handlers=[];
 const ctx=vm.createContext({workspaceLeaveSequence:0,sessionLoadEpoch:0,location:{hash:''},document:{addEventListener(event,handler){if(event==='click')handlers.push(handler)},activeElement:null},$:selector=>nodes.get(selector),esc:String,me:{user_id:'staff'},view:'inventory',inventorySection:'catalog',products:[{id:'shared-cache'}],reviewedCatalogProduct:p=>p,run:fn=>fn(),client:{rpc:async(name,args)=>{calls.push({name,args});return rpc(name,args)}},all:()=>{throw Error('full list load is forbidden')}});
 vm.runInContext(recordSource,ctx);vm.runInContext(source,ctx);ctx.catalogRender=data=>renders.push(data);
 return {ctx,calls,renders,nodes,handlers};
}
test('search and paging each issue one bounded RPC without changing the October full-list cache',async()=>{
 const rows=Array.from({length:25},(_,n)=>({id:String(n)})),f=fixture(async()=>response(rows,101));
 vm.runInContext("catalogSearch='Correct maker';catalogCategory='machines';catalogColour='yellow';catalogSort='company';catalogPage=2;catalogMachineId='machine-id'",f.ctx);
 await f.ctx.catalogInventory();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'catalog_page');
 assert.deepEqual({...f.calls[0].args},{p_query:'Correct maker',p_category:'machines',p_colour:'yellow',p_sort:'company',p_page:2,p_machine_id:'machine-id',p_product_id:null});
 assert.equal(f.renders[0].rows.length,25);assert.equal(f.ctx.products[0].id,'shared-cache');assert.equal(f.ctx.products.length,1);
 vm.runInContext('catalogPage=1',f.ctx);await f.ctx.catalogInventory();assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_page,1);
});
test('a later search response wins when requests finish out of order',async()=>{
 const pending=[],f=fixture(()=>new Promise(resolve=>pending.push(resolve)));
 const first=f.ctx.catalogInventory();vm.runInContext("catalogSearch='new'",f.ctx);const second=f.ctx.catalogInventory();
 pending[1](response([{id:'new'}]));await second;pending[0](response([{id:'old'}]));await first;
 assert.equal(f.renders.length,1);assert.equal(f.renders[0].rows[0].id,'new');
});
test('sign-out or leaving Products discards pending rows and detail source',async()=>{
 for(const leave of [ctx=>{ctx.me={user_id:'other'}},ctx=>{ctx.view='personal'},ctx=>ctx.clearCatalogInventory()]){
  let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve)),work=f.ctx.catalogInventory();leave(f.ctx);finish(response([{id:'private'}]));await work;assert.equal(f.renders.length,0);
 }
 let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve)),work=f.ctx.loadCatalogProduct('p');f.ctx.clearCatalogInventory();finish(response([{id:'p',original:{id:'p',source:{private:'row'}}}]));await assert.rejects(work,/Login changed/);assert.equal(vm.runInContext('catalogDetailRows.size',f.ctx),0);
});
test('missing RPC and malformed pagination show an error instead of a full-list fallback or fake total',async()=>{
 for(const result of [{error:{message:'catalog_page is unavailable'}},{data:{rows:[]}}]){
  const f=fixture(async()=>result);await f.ctx.catalogInventory();assert.match(f.nodes.get('#catalogResults').innerHTML,/role="alert"/);assert.equal(f.calls.length,1);assert.equal(f.renders.length,0);assert.equal(vm.runInContext('catalogResult',f.ctx),null);
 }
});
test('full product source is requested only when a detail action opens and returned raw for name/code revision',async()=>{
 const raw={id:'p',name:'Imported name',revision:4,source:{raw:{Particulars:'Original'}}},f=fixture(async(_name,args)=>args.p_product_id?response([{id:'p',name:'Reviewed name',catalog_current:true,original:raw}]):response([{id:'p',name:'Reviewed name',catalog_current:true}]));
 await f.ctx.catalogInventory();assert.equal(f.calls[0].args.p_product_id,null);assert.equal(vm.runInContext('catalogDetailRows.size',f.ctx),0);
 const product=await f.ctx.loadCatalogProduct('p');assert.deepEqual(product,raw);assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_product_id,'p');assert.equal(f.ctx.catalogRows()[0].name,'Reviewed name');
});

test('late machine navigation cannot replace a newer category or back navigation',async()=>{
 let resolveDetail;const f=fixture(async(_name,args)=>args.p_product_id?new Promise(resolve=>resolveDetail=resolve):response());
 const button={dataset:{catalogMachine:'m'},closest:()=>true,hasAttribute:name=>name==='data-catalog-machine'};
 f.handlers[0]({target:{closest:()=>button}});
 vm.runInContext("catalogCategory='furniture';catalogSearch='new selection'",f.ctx);await f.ctx.catalogInventory();
 resolveDetail(response([{id:'m',original:{id:'m'}}]));await new Promise(setImmediate);
 assert.equal(vm.runInContext('catalogMachineId',f.ctx),'');assert.equal(vm.runInContext('catalogCategory',f.ctx),'furniture');assert.equal(vm.runInContext('catalogSearch',f.ctx),'new selection');assert.equal(f.calls.length,2);
});

test('successful current catalog reads invalidate only the bounded stock cache key',async()=>{
 const f=fixture();f.ctx.inventoryStockPageKey='cached-stock-page';f.ctx.inventoryStockPageData={products:[{id:'p',name:'Prior identity'}]};
 const products=f.ctx.products,stock=f.ctx.inventoryStockPageData;
 await f.ctx.catalogInventory();assert.equal(f.ctx.inventoryStockPageKey,'');assert.equal(f.ctx.products,products);assert.equal(f.ctx.inventoryStockPageData,stock);
 f.ctx.inventoryStockPageKey='newer-stock-page';let finish;f.ctx.client.rpc=()=>new Promise(resolve=>finish=resolve);
 const pending=f.ctx.catalogInventory();f.ctx.view='inventory';f.ctx.inventorySection='stock';finish(response());await pending;
 assert.equal(f.ctx.inventoryStockPageKey,'newer-stock-page');
});

test('cold Products render, debounced search and opening details stay within three requests',async()=>{
 const nodes=new Map(),timers=new Map(),calls=[],initialHtml=[],products=[{id:'october-cache'}];let timer=0;
 function element(id){const node={id,isConnected:true,textContent:'',value:'',setAttribute(){},addEventListener(event,fn){this[event]=fn}};let html='';Object.defineProperty(node,'innerHTML',{get:()=>html,set(value){html=value;if(id==='content')nodes.clear();for(const [,child] of value.matchAll(/id="([^"]+)"/g))if(!nodes.has('#'+child))nodes.set('#'+child,element(child));}});return node;}
 const content=element('content');
 const ctx=vm.createContext({workspaceLeaveSequence:0,sessionLoadEpoch:0,location:{hash:''},me:{user_id:'staff'},view:'inventory',inventorySection:'catalog',products,document:{addEventListener(){},querySelectorAll:()=>[],activeElement:null},$:selector=>selector==='#content'?content:nodes.get(selector),esc:String,canEditRecords:()=>false,recordsLockedNote:()=>'',bindInventoryWorkspace(){},bindProductWorkbench(){},productWorkbenchTable:rows=>`<table>${rows.map(p=>p.name).join('')}</table>`,reviewedCatalogProduct:p=>p,all:()=>{throw Error('Unexpected full-list load')},setTimeout:fn=>{timers.set(++timer,fn);return timer},clearTimeout:id=>timers.delete(id),client:{rpc:async(name,args)=>{calls.push({name,args});initialHtml.push(content.innerHTML);return args.p_product_id?response([{id:'p',name:'Corrected product',original:{id:'p',name:'Raw source',source:{}}}]):response([{id:'p',name:'Corrected product'}]);}}});
 installPageHeader(ctx);
 vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);vm.runInContext(readFileSync(new URL('../search-state.js',import.meta.url),'utf8'),ctx);vm.runInContext(recordSource,ctx);vm.runInContext(source,ctx);
 await ctx.catalogInventory();assert.equal(calls.length,1);assert.match(initialHtml[0],/workspace-skeleton--metrics/);assert.match(initialHtml[0],/workspace-skeleton--catalog-table/);assert.equal((initialHtml[0].match(/Loading products…/g)||[]).length,1);assert.ok(nodes.has('#catalogSearch'));assert.match(content.innerHTML,/25 products per page/);
 const input=nodes.get('#catalogSearch');input.value='Corre';input.input({target:input});input.value='Correct maker';input.input({target:input});assert.equal(timers.size,1);assert.equal(calls.length,1);
 [...timers.values()][0]();await new Promise(setImmediate);assert.equal(calls.length,2);assert.equal(calls[1].args.p_query,'Correct maker');assert.ok(calls.every(call=>call.args.p_product_id===null));
 await ctx.loadCatalogProduct('p');assert.equal(calls.length,3);assert.equal(calls[2].args.p_product_id,'p');assert.equal(products.length,1);assert.equal(products[0].id,'october-cache');
});
