import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPageHeader} from './helpers/page-header.mjs';
import {installStockTransition} from './helpers/stock-transition.mjs';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
function pageData(page=0){return {rows:Array.from({length:50},(_,i)=>({id:`lot-${page*50+i}`,product_id:'p',location_id:'hub',pack_definition_id:'pack',stock_status:'available',sealed_cartons:2,loose_units:100,reserved_units:10,version:7})),products:[{id:'p',name:'Reviewed stock product',sku:'SKU',source:{company:'Maker',specification:'100ml'}}],locations:[{id:'hub',name:'Haadi',code:'HAA',active:true,is_dispatch_hub:true}],packs:[{id:'pack',base_unit:'bottle',units_per_carton:10,version:1}],total:8537,scope_count:8537,page,pages:171,totals:{cartons:17074,loose:853700,reserved:85370,freeLoose:768330,invoiceableLoose:768330}}}
function fixture(){
 const content={innerHTML:'',isConnected:true},calls=[];
 const ctx=vm.createContext({sessionLoadEpoch:1,location:{hash:'#/go/inventory/stock'},document:{querySelectorAll:()=>[],addEventListener(){}},$:id=>id==='#content'?content:null,view:'inventory',me:{user_id:'owner',role:'owner'},products:[{id:'shared-product',name:'Unrelated cached product'}],organizations:[],orgIndex:new Map(),lookupRowSources:{},productReviewLoadError:'',
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),rowById:(rows,id)=>rows.find(row=>row.id===id),reviewedCatalogProduct:row=>row,
  companyDate:()=> '2026-10-29',canEditRecords:()=>true,hasArea:()=>true,syncWorkspaceNavigation(){},workspaceLoading(){},message(){},run:fn=>fn(),
  loadLists:async()=>{throw Error('Shared lists must stay lazy')},all:async()=>{throw Error('Full inventory must stay lazy')},decorateSerialTools:async()=>{throw Error('Serial tools must stay lazy')},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:pageData(args.p_page)}}}
 });
 installPageHeader(ctx);installStockTransition(ctx);
 for(const file of ['status-ui.js','inventory-domain.js','inventory-operations.js'])vm.runInContext(read(file),ctx);
 return {ctx,content,calls,set:code=>vm.runInContext(code,ctx),get:code=>vm.runInContext(code,ctx)};
}
test('cold Stock uses exactly one RPC and 50 rows without full lists, histories, serial tools or shared-cache replacement',async()=>{
 const {ctx,content,calls,get}=fixture(),products=ctx.products;
 await ctx.inventoryWorkspace();assert.equal(calls.length,1);assert.equal(calls[0].name,'inventory_stock_page');assert.equal((content.innerHTML.match(/<tr data-stock-lot=/g)||[]).length,50);
 assert.match(content.innerHTML,/853,700/);assert.match(content.innerHTML,/Reviewed stock product/);assert.doesNotMatch(content.innerHTML,/data-inventory-action=|data-serial-tools|Recent stock activity/);
 assert.equal(ctx.products,products);assert.equal(get('inventoryLots.length'),0);assert.equal(get('inventoryLoaded'),false);
 assert.ok((content.innerHTML.match(/<[a-z][a-z0-9-]*(?:\s|>)/gi)||[]).length<1000);
 await ctx.inventoryWorkspace();assert.equal(calls.length,1);await ctx.inventoryWorkspace(true);assert.equal(calls.length,2);
});
test('server receives every filter and page; full-scope totals remain server totals',async()=>{
 const {ctx,calls,set,content}=fixture();await ctx.inventoryWorkspace();
 set("inventoryStockPage=3;inventorySearch='Reviewed';inventoryStockLocation='hub';inventoryStockStatus='quarantine'");await ctx.renderInventoryStock();
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args)),{p_query:'Reviewed',p_location_id:'hub',p_status:'quarantine',p_page:3,p_product_id:null});assert.match(content.innerHTML,/151–200 of 8,537/);assert.match(content.innerHTML,/853,700/);
 set("inventoryProductId='p'");await ctx.renderInventoryStock();assert.equal(calls[2].args.p_product_id,'p');assert.equal(calls[2].args.p_page,0);assert.equal(calls[2].args.p_location_id,null);
});
test('replacement staff objects clear cached stock and action state before requesting current data',async()=>{
 for(const userId of ['owner','replacement']){
  const {ctx,calls,set,get,content}=fixture();await ctx.inventoryWorkspace();
  set("inventoryStockSetup=true;inventoryStockSerialTools=true;inventoryStockActionsReady=true;inventoryStockLotId='lot-0';inventoryLoaded=true;inventoryLots=[{id:'old-private-lot'}]");
  ctx.me={user_id:userId,role:'staff'};let finish;
  ctx.client.rpc=(name,args)=>{calls.push({name,args});return new Promise(resolve=>finish=resolve)};
  const pending=ctx.inventoryWorkspace(true);
  assert.equal(calls.length,2);assert.equal(get('inventoryStockPageData'),null);assert.equal(get('inventoryLoaded'),false);assert.equal(get('inventoryLots.length'),0);
  assert.equal(get('inventoryStockSetup||inventoryStockSerialTools||inventoryStockActionsReady'),false);assert.equal(get('inventoryStockLotId'),'');
  const data=pageData();data.products[0].name='Current actor product';finish({data});await pending;
  assert.match(content.innerHTML,/Current actor product/);assert.doesNotMatch(content.innerHTML,/Reviewed stock product|data-inventory-action=/);
  assert.equal(get('inventoryActor'),ctx.me);
 }
});
test('a previous actor stock refresh cannot replace the current actor page',async()=>{
 const {ctx,content}=fixture();await ctx.inventoryWorkspace();const pending=[];
 ctx.client.rpc=()=>new Promise(resolve=>pending.push(resolve));
 const old=ctx.inventoryWorkspace(true);ctx.me={...ctx.me};const fresh=ctx.inventoryWorkspace();
 const data=pageData();data.products[0].name='Current actor product';pending[1]({data});await fresh;
 pending[0]({data:pageData()});await old;
 assert.match(content.innerHTML,/Current actor product/);assert.doesNotMatch(content.innerHTML,/Reviewed stock product/);
});
test('new searches, navigation and session clear discard late stock pages',async()=>{
 for(const change of ['search','navigation','session']){
  const {ctx,set,content,get}=fixture();let release;ctx.client.rpc=()=>new Promise(resolve=>release=resolve);
  const pending=ctx.inventoryWorkspace();
  if(change==='search')set("inventorySearch='new';inventoryStockPageRequest++");
  else if(change==='navigation')ctx.view='sales';
  else ctx.clearInventoryOperations();
  content.innerHTML='Current screen';release({data:pageData()});await pending;assert.equal(content.innerHTML,'Current screen');assert.equal(get('inventoryStockPageData'),null);
 }
});
test('failed or malformed Stock reads show an error without plausible counts or actions',async()=>{
 for(const result of [{error:{message:'Correction connection unavailable'}},{data:{...pageData(),rows:Array(51).fill(pageData().rows[0])}},{data:{...pageData(),totals:{...pageData().totals,loose:Infinity}}}]){
  const {ctx,content}=fixture();ctx.client.rpc=async()=>result;await ctx.inventoryWorkspace();assert.match(content.innerHTML,/Stock could not be loaded/);assert.doesNotMatch(content.innerHTML,/inventory-metrics|data-inventory-action=/);
 }
});
test('page reads never substitute stale shared identities when RLS hides product metadata',async()=>{
 const {ctx,content}=fixture();ctx.products.push({id:'p',name:'Old restricted identity'});ctx.client.rpc=async()=>({data:{...pageData(),products:[]}});
 await ctx.inventoryWorkspace();assert.match(content.innerHTML,/Unknown product/);assert.doesNotMatch(content.innerHTML,/Old restricted identity/);
});
test('lot actions explicitly hydrate existing caches and require successful correction and serial reads',async()=>{
 const {ctx,get,set,content}=fixture();await ctx.inventoryWorkspace();const loads=[];
 ctx.loadLists=async()=>loads.push('lists');ctx.loadInventoryOperations=async()=>{loads.push('stock');set("inventoryLoaded=true;inventoryLots="+JSON.stringify(pageData().rows)+";inventoryLocations="+JSON.stringify(pageData().locations)+";inventoryPacks="+JSON.stringify(pageData().packs));};
 ctx.loadSerialSettings=async()=>{loads.push('serials');return true};ctx.bindReceivingSerialForms=()=>loads.push('bind serials');
 await ctx.openInventoryStockTools('lot-0');assert.deepEqual(loads,['lists','stock','serials','bind serials']);assert.equal(get('inventoryStockLotId'),'lot-0');assert.match(content.innerHTML,/data-inventory-action="correct" data-lot="lot-0" data-version="7"/);
 ctx.productReviewLoadError='Corrections unavailable';await assert.rejects(ctx.openInventoryStockTools('lot-1'),/Corrections unavailable/);assert.equal(get('inventoryStockLotId'),'');
 ctx.productReviewLoadError='';ctx.loadSerialSettings=async()=>false;await assert.rejects(ctx.openInventoryStockTools('lot-1'),/Serial requirements/);assert.equal(get('inventoryStockLotId'),'');
});
test('serial settings list and picker stay bounded with thousands of products',()=>{
 const {ctx,set}=fixture();ctx.products=Array.from({length:8537},(_,i)=>({id:'product-'+i,name:'Product '+i}));
 ctx.inventoryClassification=()=>({category:'machines'});ctx.inventoryProduct=id=>ctx.products.find(row=>row.id===id);
 vm.runInContext(read('serial-numbers.js'),ctx);
 let html=ctx.serialFlaggedHtml();assert.equal((html.match(/<li>/g)||[]).length,50);assert.match(html,/8537 matching products/);
 set("serialToolsPage=170");html=ctx.serialFlaggedHtml();assert.equal((html.match(/<li>/g)||[]).length,37);
 set("serialToolsSearch='product-8536';serialToolsPage=0");html=ctx.serialFlaggedHtml();assert.equal((html.match(/<li>/g)||[]).length,1);assert.match(html,/Product 8536/);assert.equal(ctx.inventoryProductChoices(),'');
});
test('pending or failed action prerequisites reject stale form submissions before RPC',async()=>{
 const {ctx,set,calls}=fixture();await ctx.inventoryWorkspace();ctx.FormData=class{get(){return ''}};
 set('inventoryStockActionsReady=false');await assert.rejects(ctx.submitInventoryForm({dataset:{inventoryAction:'request'}}),/Reopen stock tools/);assert.equal(calls.length,1);
});
test('a later action selection supersedes an earlier full-cache load',async()=>{
 const {ctx,set,get}=fixture();await ctx.inventoryWorkspace();const pending=[];
 ctx.loadLists=()=>new Promise(resolve=>pending.push(resolve));ctx.loadInventoryOperations=async()=>set("inventoryLoaded=true;inventoryLots="+JSON.stringify(pageData().rows)+";inventoryLocations="+JSON.stringify(pageData().locations)+";inventoryPacks="+JSON.stringify(pageData().packs));ctx.loadSerialSettings=async()=>true;
 const first=ctx.openInventoryStockTools('lot-0'),second=ctx.openInventoryStockTools('lot-1');pending[1]();await second;pending[0]();await first;assert.equal(get('inventoryStockLotId'),'lot-1');
});
