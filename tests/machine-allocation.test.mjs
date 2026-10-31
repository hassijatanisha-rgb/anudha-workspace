import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPageHeader} from './helpers/page-header.mjs';
import {readFileSync} from 'node:fs';
const node={innerHTML:'',insertAdjacentHTML(){},addEventListener(){}};
const records=[
 {id:'xl',name:'XL 500',source:{}},
 {id:'dhs',name:'DHS 220',source:{}},
 {id:'r-a',name:'Reagent',source:{company:'Maker A',machine_ids:['xl','dhs']}},
 {id:'r-b',name:'Reagent',source:{company:'Maker B',machine_ids:['xl']}}
];
const context=vm.createContext({products:records,document:{addEventListener(){},querySelectorAll:()=>[]},esc:String,$:()=>node,
 reviewedCatalogProduct:p=>p,productReviewDefaults:p=>p,productReviewIssues:()=>[],
 inventoryClassification:id=>({category:['xl','dhs'].includes(id)?'machines':'reagents'}),
 inventoryOption:()=>'',me:{role:'staff'},bindInventoryWorkspace(){},productWorkbenchTable:()=>'',bindProductWorkbench(){},canEditRecords:()=>true,recordsLockedNote:()=>''});
installPageHeader(context);
vm.runInContext(readFileSync(new URL('../catalog-inventory.js',import.meta.url),'utf8'),context);
vm.runInContext(readFileSync(new URL('../product-workbench.js',import.meta.url),'utf8'),context);
function renderMachine(id,rows){vm.runInContext(`catalogMachineId='${id}';catalogCategory='all'`,context);context.catalogRender({rows,total:rows.length,page:0,pages:1,metrics:{products:4,review:4,active:0,manufacturers:2},category_counts:{all:rows.length,reagents:rows.length},colour_counts:{}});}
test('Reviewed machines remain available as compatibility links',()=>{
 const html=context.catalogMachineLinks(records[2],records);
 assert.match(html,/data-catalog-machine="xl"/);assert.match(html,/data-catalog-machine="dhs"/);
});
test('Machine page renders server-selected shared IDs and separate manufacturers',()=>{
 renderMachine('xl',records.slice(2));
 assert.match(node.innerHTML,/2<\/strong> matching products/);
 assert.match(node.innerHTML,/Maker A/);assert.match(node.innerHTML,/Maker B/);
 assert.match(node.innerHTML,/data-workbench-detail="r-a"/);
 renderMachine('dhs',[records[2]]);
 assert.match(node.innerHTML,/1<\/strong> matching product/);
 assert.match(node.innerHTML,/data-workbench-detail="r-a"/);
 assert.doesNotMatch(node.innerHTML,/data-workbench-detail="r-b"/);
 assert.equal(records.length,4);
});
test('Machine detail exposes and binds exact-product stock navigation',()=>{
 let bound=0;context.bindProductWorkbench=()=>{bound++};
 renderMachine('xl',records.slice(2));
 assert.match(context.catalogProduct(records[2],records),/data-workbench-stock="r-a"/);
 assert.match(context.catalogProduct(records[3],records),/data-workbench-stock="r-b"/);
 assert.equal(bound,1);
});
test('Catalog search and details include specification when model is absent',()=>{
 const product={id:'spec-only',name:'Reagent',source:{company:'Maker A',specification:'200 ml kit'}};
 assert.equal(context.catalogMatches(product,'200 ml'),true);
 assert.match(context.catalogProduct(product,[product]),/200 ml kit/);
});
test('Malformed imported machine links are flagged, never guessed or allowed to crash',()=>{
 for(const machine_ids of ['xl,dhs',42,{xl:true},['xl',42]]){
  const product={id:'bad-link',name:'Reagent',source:{machine_ids}};
  assert.doesNotMatch(context.catalogMachineLinks(product,records),/data-catalog-machine=/);
  assert.ok(context.catalogProductIssues(product).includes('Compatible machine links need review'));
  assert.equal(context.catalogMachineIds(product),null);
 }
});
test('Product name and category edits are shown only to people with Clients & items data access',()=>{
 const html=context.catalogProduct(records[2],records);
 assert.match(html,/data-product-edit="r-a"/);assert.match(html,/data-inventory-action="classification"/);
 context.canEditRecords=()=>false;context.recordsLockedNote=()=>'<p>locked</p>';
 try{
  const locked=context.catalogProduct(records[2],records);
  assert.doesNotMatch(locked,/data-product-edit|data-inventory-action="classification"/);
  assert.match(locked,/data-workbench-stock="r-a"/,'stock and details stay visible');
 }finally{context.canEditRecords=()=>true;context.recordsLockedNote=()=>'';}
});
