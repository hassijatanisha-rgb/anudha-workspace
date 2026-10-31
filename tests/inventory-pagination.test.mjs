import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPageHeader} from './helpers/page-header.mjs';
import {readFileSync} from 'node:fs';

function fixture(count=8537){
 const products=Array.from({length:count},(_,i)=>({id:`product-${i}`,name:`Product ${i}`,sku:`SKU-${i}`,source:{company:`Maker ${i%3}`,specification:`Specification ${i}`}}));
 const productIndex=new Map(products.map(row=>[row.id,row])),nodes=new Map([['#content',{isConnected:true}]]),buttons=[];
 const ctx=vm.createContext({view:'inventory',document:{querySelectorAll:selector=>selector==='[data-inventory-lot]'?buttons:[]},$:selector=>nodes.get(selector),products,
  me:{role:'owner',access:['stock','deliveries']},organizations:[],lookupRowSources:{},orgIndex:new Map(),companyDate:()=> '2026-10-29',
  rowById:(_rows,id)=>productIndex.get(id),reviewedCatalogProduct:row=>row,hasArea:()=>true,canEditRecords:()=>true,
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  run:fn=>fn(),renderSearchPreservingPosition:(_input,render)=>render()
 });
 installPageHeader(ctx);
 for(const file of ['status-ui.js','inventory-domain.js','inventory-operations.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 ctx.fixtureLots=products.map((product,i)=>({id:`lot-${i}`,product_id:product.id,location_id:i%2?'warehouse':'hub',pack_definition_id:`pack-${i}`,stock_status:i%5?'available':'quarantine',sealed_cartons:1,loose_units:100,reserved_units:10,batch_number:`Batch ${i}`,expiry_date:null,version:7}));
 ctx.fixturePacks=products.map((product,i)=>({id:`pack-${i}`,product_id:product.id,base_unit:'bottle',units_per_carton:10,version:1}));
 vm.runInContext("inventoryActor=me;inventoryLots=fixtureLots;inventoryPacks=fixturePacks;inventoryLocations=[{id:'hub',name:'Haadi',code:'HAA',active:true,is_dispatch_hub:true},{id:'warehouse',name:'Main godown',code:'MAIN',active:true,is_dispatch_hub:false}]",ctx);
 return {ctx,nodes,buttons,set:code=>vm.runInContext(code,ctx),get:code=>vm.runInContext(code,ctx)};
}
const rowIds=html=>[...html.matchAll(/<tr data-stock-lot="([^"]+)"/g)].map(match=>match[1]);
const elementCount=html=>(html.match(/<[a-z][a-z0-9-]*(?:\s|>)/gi)||[]).length;

test('8,537 cached lots render at most 50 compact rows with bounded owner markup and no eager pack options',()=>{
 const {ctx,set}=fixture();
 set("inventoryMovements=Array.from({length:200},(_,i)=>({id:'movement-'+i,lot_id:'lot-2',movement_type:'opening',base_unit_change:100,created_at:'2026-10-29T08:00:00Z'}));inventoryIssues=Array.from({length:200},(_,i)=>({id:'issue-'+i,product_id:'product-2',quantity:1,reference:'REF-'+i,issued_on:'2026-10-29'}))");
 const html=ctx.inventoryStock();
 assert.equal(rowIds(html).length,50);assert.equal(elementCount(html)<1400,true,`Expected bounded markup, got ${elementCount(html)} elements`);
 assert.match(html,/1–50 of 8,537 lots/);assert.match(html,/Loose units on hand<\/small><strong>853,700/);
 assert.ok(html.indexOf('inventory-metrics')<html.indexOf('Setup progress'));
 assert.doesNotMatch(html,/data-inventory-action="(?:correct|issue|open)"|<option value="pack-/);
 assert.equal(ctx.inventoryPackOptions(),'');
 ctx.bindInventoryWorkspace();assert.equal(ctx.lookupRowSources.inventoryPacks().length,8537);
 set('inventoryStockPage=170');const last=ctx.inventoryStock();assert.equal(rowIds(last).length,37);assert.match(last,/8,501–8,537 of 8,537 lots/);assert.match(last,/id="inventoryStockNext" disabled/);
 assert.match(last,/Loose units on hand<\/small><strong>853,700/);
});

test('every lot remains reachable once, with safe first, final and empty pages',()=>{
 const {ctx}=fixture(243),rows=ctx.fixtureLots,seen=[];
 for(let page=0;page<5;page++)seen.push(...ctx.inventoryStockPageRows(rows,page).rows.map(row=>row.id));
 assert.deepEqual(seen,rows.map(row=>row.id));
 assert.equal(ctx.inventoryStockPageRows(rows,-1).page,0);assert.equal(ctx.inventoryStockPageRows(rows,99).page,4);
 assert.equal(ctx.inventoryStockPageRows([],99).page,0);assert.equal(ctx.inventoryStockPageRows([],99).pages,1);
});

test('search, exact godown and status filters apply before pagination without changing totals or raw rows',()=>{
 const {ctx,set}=fixture(),before=JSON.stringify(ctx.fixtureLots);
 set("inventoryStockLocation='hub';inventoryStockStatus='quarantine'");
 const matching=ctx.inventoryFilteredStock(ctx.fixtureLots);assert.equal(matching.length,854);assert.ok(matching.every(row=>row.location_id==='hub'&&row.stock_status==='quarantine'));
 set("inventorySearch='SKU-8530';inventoryStockPage=99");const html=ctx.inventoryStock();assert.deepEqual(rowIds(html),['lot-8530']);assert.match(html,/Page 1 of 1/);assert.match(html,/853,700/);
 for(const search of ['Maker 1','Specification 8530','batch 8530','Haadi']){set(`inventorySearch=${JSON.stringify(search)}`);assert.ok(ctx.inventoryFilteredStock(ctx.fixtureLots).length>0);}
 set("inventorySearch='missing product'");assert.deepEqual(rowIds(ctx.inventoryStock()),[]);
 assert.equal(JSON.stringify(ctx.fixtureLots),before);
});

test('expired and empty filters preserve expiry-today and physical quantity semantics',()=>{
 const {ctx,set}=fixture(3);ctx.fixtureLots[0].expiry_date='2026-10-28';ctx.fixtureLots[1].expiry_date='2026-10-29';ctx.fixtureLots[2].sealed_cartons=0;ctx.fixtureLots[2].loose_units=0;ctx.fixtureLots[2].reserved_units=0;
 set("inventoryStockStatus='expired'");assert.deepEqual(Array.from(ctx.inventoryFilteredStock(ctx.fixtureLots),row=>row.id),['lot-0']);
 set("inventoryStockStatus='empty'");assert.deepEqual(Array.from(ctx.inventoryFilteredStock(ctx.fixtureLots),row=>row.id),['lot-2']);
});

test('only the selected visible lot renders existing versioned actions; filtering or paging removes stale detail',()=>{
 const {ctx,set}=fixture();set("inventoryStockLotId='lot-2'");const html=ctx.inventoryStock();
 assert.equal((html.match(/data-inventory-action="correct"/g)||[]).length,1);
 assert.equal((html.match(/data-inventory-action="open"/g)||[]).length,1);
 assert.equal((html.match(/data-inventory-action="issue"/g)||[]).length,1);
 assert.match(html,/data-inventory-action="correct" data-lot="lot-2" data-version="7"/);
 assert.equal(elementCount(html)<1600,true,`Expected bounded detail markup, got ${elementCount(html)} elements`);
 set('inventoryStockPage=1');assert.doesNotMatch(ctx.inventoryStock(),/data-inventory-action="correct"/);
 set("inventoryStockPage=0;inventoryStockLotId='lot-2';inventoryStockLocation='warehouse'");assert.doesNotMatch(ctx.inventoryStock(),/data-inventory-action="correct"/);
});

test('stock rows escape record text and IDs in cells, actions and accessible labels',()=>{
 const {ctx,set}=fixture(1),lot=ctx.fixtureLots[0];lot.id='lot-" onmouseover="alert(1)';lot.batch_number='<img src=x onerror=alert(1)>';
 ctx.products[0].name='<script>alert(1)</script>';ctx.products[0].source.company='" onclick="alert(1)';
 const html=ctx.inventoryStock();assert.doesNotMatch(html,/<script>|<img|" onmouseover="|" onclick="/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-inventory-lot="lot-&quot; onmouseover=&quot;alert\(1\)"/);
 set("inventorySearch='\" autofocus onfocus=alert(1)'");assert.match(ctx.inventoryStock(),/value="&quot; autofocus/);
});

test('list event handlers reset pages and detail, keep focus, and do not reload cached stock',async()=>{
 const {ctx,set,get,nodes,buttons}=fixture(1);let renders=0,focus='';
 for(const id of ['inventorySearch','inventoryStockLocation','inventoryStockStatus','inventoryStockPrevious','inventoryStockNext','inventoryStockPageStatus','inventoryStockDetail','inventoryStockClose'])nodes.set('#'+id,{value:'',focus(){focus=id}});
 buttons.push({dataset:{inventoryLot:'lot-0'},focus(){focus='lot-0'}});
 ctx.renderInventoryStock=()=>{renders++};ctx.paintInventoryStock=()=>{renders++};ctx.loadInventoryOperations=()=>{throw Error('List navigation must not reload raw stock')};
 ctx.bindInventoryWorkspace();set("inventoryStockPage=4;inventoryStockLotId='lot-0'");
 nodes.get('#inventoryStockLocation').value='hub';await nodes.get('#inventoryStockLocation').onchange();assert.equal(get('inventoryStockPage'),0);assert.equal(get('inventoryStockLotId'),'');assert.equal(get('inventoryStockLocation'),'hub');assert.equal(focus,'inventoryStockLocation');
 set('inventoryStockPage=4');await nodes.get('#inventorySearch').oninput({target:{value:'reagent'}});assert.equal(get('inventoryStockPage'),0);assert.equal(get('inventorySearch'),'reagent');
 await nodes.get('#inventoryStockNext').onclick();assert.equal(get('inventoryStockPage'),1);
 await buttons[0].onclick();assert.equal(get('inventoryStockLotId'),'lot-0');assert.equal(focus,'inventoryStockDetail');
 await nodes.get('#inventoryStockClose').onclick();assert.equal(get('inventoryStockLotId'),'');assert.equal(focus,'lot-0');assert.equal(renders,5);
});

test('changing product scope and clearing a session reset unrelated list selections',()=>{
 const {ctx,set,get}=fixture(2);set("inventoryStockPage=9;inventoryStockLocation='hub';inventoryStockStatus='quarantine';inventoryStockLotId='lot-0';inventoryProductId='product-1'");
 assert.deepEqual(rowIds(ctx.inventoryStock()),['lot-1']);assert.equal(get('inventoryStockPage'),0);assert.equal(get('inventoryStockLocation'),'');assert.equal(get('inventoryStockStatus'),'');assert.equal(get('inventoryStockLotId'),'');
 set("inventoryStockPage=8;inventoryStockLocation='hub';inventoryStockStatus='expired';inventoryStockLotId='lot-1'");ctx.clearInventoryOperations();
 assert.equal(get('inventoryStockPage'),0);assert.equal(get('inventoryStockLocation'),'');assert.equal(get('inventoryStockStatus'),'');assert.equal(get('inventoryStockLotId'),'');assert.equal(get('inventoryLots.length'),0);
});
