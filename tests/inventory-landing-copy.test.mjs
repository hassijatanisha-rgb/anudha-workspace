import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';

const stock={rows:Array.from({length:50},(_,i)=>({id:'lot-'+i,product_id:'p',location_id:'hub',pack_definition_id:'pack',stock_status:i===0?'quarantine':'available',expiry_date:i===1?'2000-01-01':null,sealed_cartons:2,loose_units:100,reserved_units:10,version:7})),products:[{id:'p',name:'Fictional stock product',sku:'SKU',source:{company:'Maker',specification:'100ml'}}],locations:[{id:'hub',name:'Haadi',code:'HAA',active:true,is_dispatch_hub:true}],packs:[{id:'pack',base_unit:'bottle',units_per_carton:10,version:1}],total:8537,scope_count:8537,page:0,pages:171,totals:{cartons:17074,loose:853700,reserved:85370,freeLoose:768330,invoiceableLoose:768330}};
const catalog={rows:Array.from({length:25},(_,i)=>({id:'product-'+i,name:'Fictional product '+i,sku:'SKU-'+i,catalog_current:true,catalog_duplicate_count:1,catalog_classification:{category:'machines',version:1},source:{company:'Maker',specification:'Model',sale_status:'active',category:'machines'}})),total:105,page:0,pages:5,metrics:{products:105,review:105,active:105,manufacturers:1},category_counts:{review:105,all:105,machines:105},colour_counts:{ok:105}};
function visibleText(node){
 if(node.hidden||node.getAttribute?.('hidden')!=null)return '';
 const children=node.tag==='details'&&!node.open?[node.querySelector('summary')]:node.children;
 return [node._text||'',...(children||[]).filter(Boolean).map(visibleText)].join(' ').replace(/\s+/g,' ').trim();
}
const content=f=>f.document.querySelector('#content');

test('Stock collapses explanatory copy while keeping the subtitle, filters and 50 live lot actions',async t=>{
 const f=mainPageFixture({rpcs:{inventory_stock_page:stock}});await f.open({view:'inventory',inventorySection:'stock'});
 const page=content(f),help=page.querySelector('details'),before=visibleText(page);
 assert.equal(page.querySelectorAll('details').length,1);assert.equal(help.open,false);assert.equal(help.querySelector('summary').textContent,'How this page works');
 assert.doesNotMatch(before,/Totals cover all lots|Only unexpired|Open a lot for counts/);
 help.open=true;assert.match(visibleText(page),/Totals cover all lots/);assert.match(visibleText(page),/Only unexpired, free loose units at an active dispatch hub/);assert.match(visibleText(page),/saved transaction rechecks stock/);
 t.diagnostic(`${visibleText(page).split(/\s+/).length-before.split(/\s+/).length} explanatory words behind Stock disclosure`);
 const heading=page.querySelector('.workspace-page-header');assert.equal(heading.querySelectorAll('p').length,1);assert.equal(heading.querySelector('p').textContent,'Stock by godown, batch and availability.');
 assert.equal(page.querySelectorAll('[data-stock-lot]').length,50);assert.match(page.querySelector('#inventoryStockPageStatus').textContent,/1–50 of 8,537/);
 for(const id of ['inventorySearch','inventoryStockLocation','inventoryStockStatus','inventoryStockPrevious','inventoryStockNext'])assert.ok(page.querySelector('#'+id));
 for(const button of page.querySelectorAll('[data-inventory-lot]'))assert.equal(typeof button.onclick,'function');
 const tools=page.querySelector('#inventoryStockOpenTools');assert.equal(tools.textContent,'Receive stock, carton sizes & activity');assert.equal(typeof tools.onclick,'function');assert.equal(tools.closest('details'),null);
 assert.equal(f.calls.filter(call=>call.name==='inventory_stock_page').length,1);
});

test('Quarantined and expired stock remains visible outside guidance and errors stay visible',async()=>{
 const f=mainPageFixture({rpcs:{inventory_stock_page:stock}});await f.open({view:'inventory',inventorySection:'stock'});
 const page=content(f);
 for(const [id,label]of [['lot-0','Quarantined'],['lot-1','Expired']]){
  const row=page.querySelector(`[data-stock-lot="${id}"]`),chip=row.querySelector('.chip');
  assert.match(visibleText(row),new RegExp(label));assert.equal(chip.closest('details'),null);assert.equal(row.querySelector('[data-inventory-lot]').dataset.inventoryLot,id);
 }
 const failed=mainPageFixture({rpcs:{inventory_stock_page:()=>{throw Error('Stock read unavailable');}},tables:{product_serial_settings:query=>{assert.equal(query.columns,'product_id,serial_required');return [];}}});await failed.open({view:'inventory',inventorySection:'stock'});
 assert.match(visibleText(content(failed)),/Stock read unavailable/);assert.equal(content(failed).querySelector('[role="alert"]').closest('details'),null);assert.equal(content(failed).querySelectorAll('[data-stock-lot]').length,0);
});

for(const role of ['owner','staff'])test(`Products keeps one Add product action and collapses import targets for ${role} with Records access`,async()=>{
 const f=mainPageFixture({role,access:['records'],rpcs:{catalog_page:catalog}});await f.open({view:'inventory',inventorySection:'catalog'});
 const page=content(f),hero=page.querySelector('.workspace-page-header'),tools=page.querySelector('details'),add=hero.querySelector('#newProduct');
 assert.equal(tools.open,false);assert.equal(tools.querySelector('summary').textContent,'Import and mapping tools');
 assert.equal(add.classList.contains('button-primary'),true);assert.equal(add.closest('details'),null);assert.equal(hero.querySelectorAll('.button-primary').length,1);assert.match(visibleText(hero),/Add product/);
 assert.doesNotMatch(visibleText(hero),/Check stock mapping file|Apply product list file/);
 assert.ok(tools.querySelector('[data-product-mapping-preview]'));const file=tools.querySelector('#productListFile');assert.equal(file.getAttribute('accept'),'.json,application/json');assert.equal(typeof file.onchange,'function');
 tools.open=true;assert.match(visibleText(tools),/Check stock mapping file/);assert.match(visibleText(tools),/Apply product list file/);
 assert.ok(page.querySelector('#catalogSearch'));assert.ok(page.querySelectorAll('[role="group"]').some(node=>node.getAttribute('aria-label')==='Product categories'));assert.equal(page.querySelectorAll('[data-catalog-row]').length,25);assert.match(page.querySelector('#catalogPageStatus').textContent,/25 products per page/);
 for(const row of page.querySelectorAll('[data-catalog-row]')){assert.equal(row.querySelectorAll('button').length,1);assert.equal(row.querySelector('button').textContent,'Open product');}
 assert.equal(f.calls.filter(call=>call.name==='catalog_page').length,1);
});

test('Products keeps its existing Records-access restrictions while search and Open product remain available',async()=>{
 const f=mainPageFixture({role:'staff',rpcs:{catalog_page:catalog}});await f.open({view:'inventory',inventorySection:'catalog'});
 const page=content(f);assert.equal(page.querySelector('#newProduct'),null);assert.equal(page.querySelector('#productListFile'),null);assert.equal(page.querySelector('[data-product-mapping-preview]'),null);
 assert.match(visibleText(page),/Clients & items data access/);assert.ok(page.querySelector('#catalogSearch'));assert.equal(page.querySelectorAll('[data-workbench-detail]').length,25);
});
