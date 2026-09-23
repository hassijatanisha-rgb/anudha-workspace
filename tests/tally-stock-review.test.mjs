import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({products:[],document:{addEventListener(){}}});
for(const file of ['product-review.js','product-review-ui.js','tally-stock-review.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),c);
test('Tally negatives remain an unresolved source row until corrected',()=>{
 const row={id:'r',product_name:'Example',quantity:-4,unit:'PCS'};
 const result=c.tallyRowReview(row);
 assert.equal(result.result.reported,-4);assert.equal(result.result.saleable,null);
 assert.ok(result.result.issues.includes('Choose the matching catalog product'));
});
test('Correction does not mutate the original source balance',()=>{
 c.products.push({id:'p',name:'Example',source:{company:'Maker',specification:'Model',sale_status:'active',batch_required:false,expiry_required:false}});
 vm.runInContext("tallyCorrections.set('r',{product_id:'p',pieces:5})",c);
 const row={id:'r',product_name:'Example',quantity:-4,unit:'PCS'};
 assert.equal(c.tallyRowReview(row).result.saleable,5);assert.equal(row.quantity,-4);
});
test('Tally UI does not expose raw financial export columns',()=>{
 const source=readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8');
 assert.ok(!source.includes("all('tally_stock_sources','*')"));
 assert.ok(source.includes('do not post operational stock'));
});
