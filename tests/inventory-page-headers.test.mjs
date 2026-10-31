import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function fixture(editable=true){
 const document=dom(),content=document.createElement('main'),events={};content.setAttribute('id','content');document.body.append(content);document.addEventListener=(name,handler)=>events[name]=handler;
 const ctx=vm.createContext({location:{hash:''},document,$:selector=>document.querySelector(selector),esc,me:{user_id:'actor',role:editable?'owner':'staff'},view:'inventory',products:[],canEditRecords:()=>editable,recordsLockedNote:()=>editable?'':'<p class="muted">Records are locked.</p>',productWorkbenchTable:()=>'',bindProductWorkbench(){},renderSearchPreservingPosition(){},run:fn=>fn()});
 installPageHeader(ctx);for(const file of ['record-navigation.js','inventory-operations.js','catalog-inventory.js','tally-stock-review.js'])vm.runInContext(read(file),ctx);
 ctx.bindInventoryWorkspace=()=>{};
 return {ctx,document,content,events,set:code=>vm.runInContext(code,ctx)};
}
const catalogPage={rows:[],total:0,page:0,pages:1,metrics:{products:0,review:0,active:0,manufacturers:0},category_counts:{},colour_counts:{}};
for(const [section,title] of [['stock','Stock & availability'],['locations','Godowns & locations'],['transfers','Move stock'],['review','Tally stock review']])test(`${section} uses one shared page title with its existing refresh hook and no Back`,()=>{
 const f=fixture();f.set(`inventorySection='${section}'`);f.content.innerHTML=f.ctx.inventoryHeader();
 assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(f.content.querySelector('h1').textContent,title);assert.equal(f.content.querySelectorAll('.workspace-page-header').length,1);
 assert.equal(f.content.querySelector('.workspace-page-back'),null);assert.equal(f.content.querySelector('.workspace-page-breadcrumbs'),null);
 assert.equal(f.content.querySelector('.workspace-page-actions').querySelector('button').id,'inventoryRefresh');
});
test('Tally renders one title while preserving cleanup consequences, query and action targets',()=>{
 const f=fixture();f.ctx.page={rows:[],total:0,page:0,pages:1,scope:{total:0,reviewed:0,negative:0,missingQuantity:0},readiness:{rows:[],total:0,page:0,pages:1}};
 f.set("inventorySection='review';tallyActor=me;tallyPageData=page");f.ctx.renderTallyStock();
 assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(f.content.querySelector('h1').textContent,'Tally stock review');
 const header=f.content.querySelector('.workspace-page-header');assert.match(header.textContent,/Match source rows to products and record verified pieces/);
 assert.match(f.content.textContent,/Corrections preserve original balances and do not post operational stock/);
 for(const id of ['inventoryRefresh','tallyMetrics','tallyRegister','tallySearch','tallyFile','tallyPrev','tallyNext','tallyStatus','godownReadiness'])assert.ok(f.content.querySelector('#'+id),id);
 assert.equal(header.querySelector('#tallyFile'),null);
});
test('Catalog landing keeps Refresh then the sole primary Add product, with import tools below the header',()=>{
 const f=fixture();f.set("inventorySection='catalog'");f.ctx.catalogRender(catalogPage);
 const header=f.content.querySelector('.workspace-page-header'),actions=header.querySelector('.workspace-page-actions');
 assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(f.content.querySelector('h1').textContent,'Products');assert.equal(f.content.querySelector('[data-catalog-back]'),null);
 assert.deepEqual(actions.querySelectorAll('button').map(node=>node.id),['refresh','newProduct']);assert.equal(actions.querySelectorAll('.button-primary').length,1);assert.equal(actions.children.at(-1).id,'newProduct');
 const tools=f.content.querySelector('details');assert.match(tools.textContent,/Import and mapping tools/);assert.equal(header.contains(tools),false);assert.ok(f.content.children.indexOf(tools)>f.content.children.indexOf(header));
 for(const id of ['productListFile','catalogSearch','catalogSort','catalogColour','catalogResults','catalogDetail','catalogSaveNotice','catalogPrev','catalogNext'])assert.ok(f.content.querySelector('#'+id),id);
});
test('Catalog read-only landing keeps Refresh and the lock note without editor/import controls',()=>{
 const f=fixture(false);f.set("inventorySection='catalog'");f.ctx.catalogRender(catalogPage);const header=f.content.querySelector('.workspace-page-header');
 assert.deepEqual(header.querySelectorAll('button').map(node=>node.id),['refresh']);assert.equal(f.content.querySelector('#newProduct'),null);assert.equal(f.content.querySelector('#productListFile'),null);assert.equal(f.content.querySelector('[data-product-mapping-preview]'),null);
 assert.match(f.content.textContent,/Records are locked/);assert.doesNotMatch(header.textContent,/Records are locked/);
});
test('Catalog machine scope moves the existing Back hook before the title and escapes machine identity',()=>{
 const f=fixture();f.ctx.machine={id:'machine',name:'Analyzer <img src=x onerror=bad()> & Co'};f.set("inventorySection='catalog';catalogMachineId='machine';catalogMachineProduct=machine");f.ctx.catalogRender(catalogPage);
 const header=f.content.querySelector('.workspace-page-header'),back=f.content.querySelector('[data-catalog-back]');
 assert.equal(f.content.querySelectorAll('[data-catalog-back]').length,1);assert.equal(back.parentElement,header.querySelector('.workspace-page-back'));assert.equal(header.querySelector('.workspace-page-toolbar').firstElementChild,back.parentElement);assert.equal(f.content.querySelectorAll('h1').length,1);
 assert.match(f.content.querySelector('h2').textContent,/Analyzer <img src=x onerror=bad\(\)> & Co/);assert.equal(f.content.querySelector('img'),null);assert.equal(f.content.querySelector('[data-workbench-detail]').dataset.workbenchDetail,'machine');
});
test('Catalog Back retains the exact local filter transition and does not introduce route navigation',()=>{
 const f=fixture();f.set("inventorySection='catalog';catalogMachineId='machine';catalogMachineProduct={name:'Analyzer'};catalogPage=4;catalogSearch='Retained';catalogCategory='reagents';catalogSort='company';catalogColour='yellow'");f.ctx.catalogRender(catalogPage);
 const back=f.content.querySelector('[data-catalog-back]');back.hasAttribute=key=>back.getAttribute(key)!==null;let reloads=0;f.ctx.catalogInventory=async()=>{reloads++};
 f.events.click({target:back});assert.equal(reloads,1);assert.deepEqual(JSON.parse(f.set('JSON.stringify([catalogMachineId,catalogMachineProduct,catalogPage,catalogSearch,catalogCategory,catalogSort,catalogColour])')),['',null,0,'Retained','reagents','company','yellow']);
});
