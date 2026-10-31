import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPageHeader} from './helpers/page-header.mjs';
import {readFileSync} from 'node:fs';

function fixture(){
 const content={innerHTML:''},calls=[];
 const query={select(){return this},order(){return this},limit(){return this},then(ok){return Promise.resolve({data:[]}).then(ok)}};
 const ctx=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,
  document:{addEventListener(){},querySelectorAll(){return []}},$ :selector=>selector==='#content'?content:null,
  esc:String,client:{from:()=>query,rpc:async(name,args)=>{calls.push({name,args});return {data:name==='inventory_operations_page'?{section:args.p_section,rows:[],page:0,pages:1,total:0,totals:{all:0,active:0,dispatch_hub:0,requested:0,in_transit:0,received:0,quarantine:0,cancelled:0}}:{}}}},
  all:async table=>{if(table==='product_detail_reviews')throw Error('Correction connection unavailable');return [];},products:[{id:'p',name:'Raw source identity',source:{}}],
  view:'inventory',me:{role:'owner',user_id:'owner'},organizations:[],syncWorkspaceNavigation(){},message(){},
  inventoryStockTotals:()=>({cartons:0,loose:0,reserved:0,freeLoose:0,invoiceableLoose:0}),crypto:{randomUUID:()=> 'fixture-id'},
  FormData:class{constructor(form){this.fields=form.fields||{}}get(key){return this.fields[key]??''}}
 });
 installPageHeader(ctx);
 vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);
 for(const file of ['business-date.js','product-review-ui.js','inventory-operations.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx,{filename:file});
 return {ctx,content,calls};
}

for(const section of ['stock','transfers'])test(`${section} fails closed on unavailable corrections, including direct rerenders`,async()=>{
 const {ctx,content}=fixture();
 vm.runInContext(`inventorySection='${section}'`,ctx);
 await ctx.loadInventoryOperations();content.innerHTML=section==='stock'?ctx.inventoryStock():ctx.inventoryTransferRequestForm();
 assert.match(content.innerHTML,/Product corrections could not be loaded/);
 assert.match(content.innerHTML,/inventoryRefresh/);
 assert.doesNotMatch(content.innerHTML,/data-inventory-action=|Raw source identity/);
 const direct=section==='stock'?ctx.inventoryStock():ctx.inventoryTransferRequestForm();
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
 const {ctx,content,calls}=fixture();await ctx.loadInventoryOperations();
 ctx.all=async table=>table==='product_detail_reviews'?[{product_id:'p',version:1,name:'Reviewed identity',company:'Maker',specification:'Model'}]:[];
 await ctx.loadInventoryOperations();content.innerHTML=ctx.inventoryStock();
 assert.match(content.innerHTML,/data-inventory-action="pack"/);
 assert.match(content.innerHTML,/Reviewed identity/);
 assert.doesNotMatch(content.innerHTML,/Product corrections could not be loaded|Raw source identity/);
 assert.match(ctx.inventoryTransferRequestForm(),/data-inventory-action="request"/);
 ctx.inventoryWorkspace=async()=>{};await ctx.submitInventoryForm({dataset:{inventoryAction:'request'}});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'request_inventory_transfer');
});

test('godown setup remains accessible and saveable during correction failure',async()=>{
 const {ctx,content,calls}=fixture();vm.runInContext("inventorySection='locations'",ctx);
 await ctx.inventoryWorkspace(true);
 assert.match(content.innerHTML,/data-inventory-action="location"/);
 content.isConnected=true;ctx.refreshSavedInventoryOperation=async()=>{await ctx.client.rpc('inventory_operations_page',{p_section:'locations',p_page:0})};
 await ctx.submitInventoryForm({dataset:{inventoryAction:'location'},isConnected:true,contains:()=>false,querySelector:()=>null,fields:{name:'Godown',code:'G1',locationType:'godown'}});
 assert.deepEqual(calls.map(row=>row.name),['inventory_operations_page','save_inventory_location','inventory_operations_page']);
});

test('fresh paged catalog details permit classification after an unrelated full-load failure, never stock writes',async()=>{
 const {ctx,calls}=fixture();await ctx.loadInventoryOperations();
 vm.runInContext(readFileSync(new URL('../catalog-inventory.js',import.meta.url),'utf8'),ctx);
 vm.runInContext("inventorySection='catalog';catalogDetailRows.set('p',{id:'p',catalog_current:true,original:{id:'p'},catalog_classification:{version:4}})",ctx);
 const context={current:()=>true};let refreshed;ctx.catalogSaveContext=()=>context;ctx.refreshCatalogSavedProduct=async(...args)=>{refreshed=args};ctx.inventoryWorkspace=()=>assert.fail('Whole inventory refresh');
 await ctx.submitInventoryForm({dataset:{inventoryAction:'classification',product:'p',version:'4'},fields:{category:'machines',reason:'Label checked'}});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'save_product_inventory_classification');assert.equal(calls[0].args.p_expected_version,4);assert.equal(refreshed[0],'p');assert.equal(refreshed[1],'Inventory category saved.');assert.equal(refreshed[2],context);assert.equal(refreshed[3].classification,5);
 await assert.rejects(ctx.submitInventoryForm({dataset:{inventoryAction:'request',product:'p'}}),/Refresh product corrections/);
 vm.runInContext("inventorySection='stock'",ctx);
 await assert.rejects(ctx.submitInventoryForm({dataset:{inventoryAction:'classification',product:'p'}}),/Refresh product corrections/);
 vm.runInContext("inventorySection='catalog';catalogDetailRows.clear()",ctx);
 await assert.rejects(ctx.submitInventoryForm({dataset:{inventoryAction:'classification',product:'p'}}),/Refresh product corrections/);
 assert.equal(calls.length,1);
});

for(const outcome of ['success','error','rejection'])test(`stale classification ${outcome} cannot trigger a workspace rebuild or saved-product reconciliation`,async()=>{
 const {ctx,calls}=fixture();await ctx.loadInventoryOperations();vm.runInContext(readFileSync(new URL('../catalog-inventory.js',import.meta.url),'utf8'),ctx);vm.runInContext("inventorySection='catalog';catalogDetailRows.set('p',{id:'p',catalog_current:true,original:{id:'p'},catalog_classification:{version:4}})",ctx);let current=true,resolve,reject;ctx.catalogSaveContext=()=>({current:()=>current});ctx.refreshCatalogSavedProduct=()=>assert.fail('Stale reconciliation');ctx.inventoryWorkspace=()=>assert.fail('Stale workspace');ctx.client.rpc=(name,args)=>{calls.push({name,args});return new Promise((a,b)=>{resolve=a;reject=b})};const pending=ctx.submitInventoryForm({dataset:{inventoryAction:'classification',product:'p',version:'4'},fields:{category:'machines',reason:'Label checked'}});current=false;if(outcome==='rejection')reject(Error('Late rejection'));else resolve(outcome==='error'?{error:Error('Late error')}:{data:{}});await pending;assert.equal(calls.length,1);
});
