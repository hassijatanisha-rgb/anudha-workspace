import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function load(){const ctx=vm.createContext({esc:s=>String(s??''),catalogCategoryOf:p=>p.category||'unclassified'});vm.runInContext(read('data-quality.js'),ctx);return ctx;}
const product=(extra={})=>({id:'p',name:'Blood Bag',sku:'AN-00001',category:'consumables',source:{company:'Fixture Co',specification:'450 ml'},...extra});
test('no colour when complete, yellow for one problem, red for two or more',()=>{
 const ctx=load(),level=p=>ctx.productQuality(p,null).level;
 assert.equal(level(product()),'');
 assert.equal(level(product({source:{company:'',specification:'450 ml'}})),'yellow');
 assert.equal(level(product({source:{company:'',specification:''}})),'red');
 assert.equal(level(product({category:'unclassified',sku:''})),'red');
 assert.equal(ctx.qualityLevel(0),'');assert.equal(ctx.qualityLevel(1),'yellow');assert.equal(ctx.qualityLevel(5),'red');
});
test('a suggested company is shown but does not count as known',()=>{
 const ctx=load(),q=ctx.productQuality(product({source:{company:'',specification:'450 ml',suggested_company:'Polymed'}}),null);
 assert.equal(q.level,'yellow');assert.match(q.issues[0],/suggested: Polymed/);
});
test('identical name, company and specification is a possible duplicate',()=>{
 const ctx=load(),a=product({id:'a'}),b=product({id:'b',name:' blood  BAG '}),c=product({id:'c',source:{company:'Other',specification:'450 ml'}});
 const counts=ctx.productDuplicateCounts([a,b,c]);
 assert.equal(ctx.productQuality(a,counts).level,'yellow');assert.equal(ctx.productQuality(c,counts).level,'');
});
test('contacts use the same rule, counting field problems and duplicates',()=>{
 const ctx=load();
 assert.equal(ctx.contactQuality([],[]).level,'');
 assert.equal(ctx.contactQuality(['Phone number is required.'],[]).level,'yellow');
 assert.equal(ctx.contactQuality(['Phone number is required.'],[{reason:'Same phone'}]).level,'red');
 assert.match(ctx.qualityBadge('red',['a','b']),/quality-red.*Red · 2 to fix/);assert.equal(ctx.qualityBadge('',[]),'');
});
test('colours, Furniture and the owner upload are wired into the pages',()=>{
 assert.match(read('product-workbench.js'),/quality-'\+quality\.level/);assert.match(read('app.js'),/contactQuality\(missing,hits\)/);
 assert.match(read('catalog-inventory.js'),/\['furniture','Furniture'\]/);assert.match(read('catalog-inventory.js'),/id="productListFile"/);
 assert.match(read('stock-count.js'),/applyProductListFile\(file\)/);
 const html=read('index.src.html');assert.ok(html.indexOf('data-quality.js')>0&&html.indexOf('data-quality.js')<html.indexOf('app.js'));
 assert.match(read('supabase/migrations/202609300048_apply_product_list.sql'),/'machines','furniture','reagents'/);
});
test('product pickers label reviewed products so a choice can be found again',()=>{
 const ctx=vm.createContext({products:[{id:'p1',name:'Old name',sku:'',source:{}}],reviewedCatalogProduct:p=>({...p,name:'Reviewed name',source:{company:'Co',specification:'S'}}),esc:s=>String(s),inventoryProductChoice:p=>`${p.name} · ${p.id}`});
 vm.runInContext(read('sales-delivery.js').match(/function salesProductChoices\(\)\{.*\}/)[0],ctx);
 assert.match(ctx.salesProductChoices(),/Reviewed name · p1/);assert.doesNotMatch(ctx.salesProductChoices(),/Old name/);
});
