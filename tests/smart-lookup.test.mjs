import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../smart-lookup.js',import.meta.url),'utf8');
const ctx=vm.createContext({workspacePageHeader,HTMLSelectElement:function(){},document:{addEventListener(){},documentElement:{}},MutationObserver:function(){this.observe=()=>{}},requestAnimationFrame(){}});
ctx.HTMLSelectElement.prototype=Object.create(null,{value:{get(){return ''},set(){},configurable:true,enumerable:true}});
vm.runInContext(source,ctx);
const items=['Muhimbili National Hospital · Dar es Salaam','Aga Khan Hospital · Mwanza','Hospital Supplies Ltd','Baby incubator · YP-90A'].map(label=>({value:label,label,search:ctx.lookupNormal(label)}));
test('every typed word must appear, in any order',()=>{
 assert.deepEqual([...ctx.lookupRank(items,'mwanza hospital').rows].map(r=>r.label),['Aga Khan Hospital · Mwanza']);
 assert.equal(ctx.lookupRank(items,'incubator baby').total,1);
});
test('names starting with the typed text come first',()=>{
 assert.equal(ctx.lookupRank(items,'hospital').rows[0].label,'Hospital Supplies Ltd');
});
test('case and punctuation do not matter',()=>{
 assert.equal(ctx.lookupRank(items,'YP90').total,1);
 assert.equal(ctx.lookupRank(items,'yp 90a').total,1);
 assert.equal(ctx.lookupRank(items,'MUHIMBILI').total,1);
});
test('internal record IDs are not shown',()=>{
 assert.equal(ctx.lookupTidy('Autoclave 50L · Acme · Specification needs review · 0d3f2a1e-1111-4222-8333-444455556666'),'Autoclave 50L · Acme');
});
test('task results must say something',()=>{
 const tctx=vm.createContext({workspacePageHeader,});vm.runInContext(readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8').match(/function teamTaskResultProblem[\s\S]*?\n}\n/)[0],tctx);
 for(const bad of ['xxx','XXX XXX XXX','ok done','done','test test test','.....'])assert.ok(tctx.teamTaskResultProblem(bad),bad);
 for(const good of ['Called Nisha, wants 2 ultrasound quotes','Visited Muhimbili, no new needs today'])assert.equal(tctx.teamTaskResultProblem(good),'',good);
});

test('product search tolerates repeated, omitted and reordered spaces without losing model digits',()=>{
 for(const query of ['  BABY    incubator  ', 'incubator baby', 'babyincubator', 'YP90A incubator', '90a   yp'])assert.equal(ctx.lookupRank(items,query).total,1,query);
 for(const query of ['YP91A', 'incubator ultrasound', 'mwanza dar'])assert.equal(ctx.lookupRank(items,query).total,0,query);
 const products=['Babyincubator supplies','Baby incubator · YP-90A'].map(label=>({label,value:label,search:ctx.lookupNormal(label)}));
 assert.equal(ctx.lookupRank(products,'babyincubator').rows[0].label,'Babyincubator supplies','literal matches retain priority over compact matches');
});

const products=[
 {id:'00000000-0000-4000-8000-000000000001',name:'CRP reagent',sku:'R-XL200',source:{company:'Acme',specification:'For XL-200 chemistry analyzer',category:'reagents'}},
 {id:'00000000-0000-4000-8000-000000000002',name:'Chemistry analyzer',sku:'M-002',source:{company:'Acme',model:'XL-200',category:'machines'}},
 {id:'00000000-0000-4000-8000-000000000003',name:'Pump',sku:'M-003',source:{company:'Acme',model:'DP100',category:'machines'}},
 {id:'00000000-0000-4000-8000-000000000004',name:'Pump',sku:'M-004',source:{company:'Acme',model:'DP10',category:'machines'}},
 {id:'00000000-0000-4000-8000-000000000005',name:'Incubator',sku:'M-005',source:{company:'Acme',model:'YP-90A',category:'machines'}},
 {id:'00000000-0000-4000-8000-000000000006',name:'XL-200 lamp',sku:'S-006',source:{company:'Acme',model:'XL-200',category:'spares'}},
 {id:'00000000-0000-4000-8000-000000000007',name:'Microscope',sku:'M-007',source:{company:'Acme',model:'YJ-700',specification:'LED illumination',category:'machines'}},
];
ctx.inventorySelectableProducts=()=>products;
ctx.inventoryClassification=()=>undefined;
ctx.catalogCategoryOf=product=>product.source.category;
ctx.catalogLabel=category=>({machines:'Machines',reagents:'Reagents',spares:'Spares'}[category]);
ctx.inventoryProductIdentity=product=>`${product.name} · ${product.source.company} · ${product.source.specification||product.source.model} · ${product.sku}`;
ctx.inventoryProductChoice=product=>`${ctx.inventoryProductIdentity(product)} · ${product.id}`;
const productRows=ctx.lookupOptionsOf({dataset:{},tagName:'INPUT',_lookupList:{dataset:{lookupValues:'products'}}});
test('product rows keep canonical identity and display category, reviewed model and code without UUID',()=>{
 const row=productRows[1];
 assert.equal(row.value,ctx.inventoryProductChoice(products[1]));
 assert.equal(row.label,'Chemistry analyzer · Acme · XL-200 · M-002 · Machines');
 assert.ok(!row.label.includes(products[1].id));
 assert.match(productRows[6].label,/LED illumination.*M-007.*YJ-700.*Machines/);
});
test('exact machine models precede compatible reagents and spares without losing word searches',()=>{
 for(const query of ['XL200','xl 200','XL-200','200']){
  const result=ctx.lookupRank(productRows,query);assert.equal(result.total,3,query);assert.equal(result.rows[0].value,ctx.inventoryProductChoice(products[1]),query);
 }
 assert.equal(ctx.lookupRank(productRows,'reagent XL200').rows[0].value,ctx.inventoryProductChoice(products[0]));
 assert.equal(ctx.lookupRank(productRows,'spares lamp').total,1);
 assert.equal(ctx.lookupRank(productRows,'acme chemistry').total,2);
});
test('product model digits reject substring collisions but allow printed separators and alphabetic suffixes',()=>{
 for(const query of ['DP10','dp 10','10'])assert.deepEqual([...ctx.lookupRank(productRows,query).rows].map(row=>row.value),[ctx.inventoryProductChoice(products[3])],query);
 for(const query of ['YP90','YP90A','yp 90a','90a yp'])assert.equal(ctx.lookupRank(productRows,query).total,1,query);
 for(const query of ['DP1','20','YP91'])assert.equal(ctx.lookupRank(productRows,query).total,0,query);
});
test('highlighted catalog labels are escaped',()=>{
 assert.equal(ctx.lookupMark('<img src=x onerror="alert(1)">','img'), '&lt;<mark>img</mark> src=x onerror=&quot;alert(1)&quot;&gt;');
});
