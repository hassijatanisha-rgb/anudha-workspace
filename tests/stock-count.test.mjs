import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function load(){
 const ctx=vm.createContext({me:{user_id:'a',role:'owner'},window:{ERP_CONFIG:{}},esc:s=>String(s??''),employeeName:id=>id,Number,String,JSON,Map,Date,Math});
 vm.runInContext(read('stock-count.js'),ctx);
 vm.runInContext(`countCatalogue=[{code:'AN-00001',product:'Patient Monitor with Printer',company:'',specification:'BT-770',category:'Machine',search_text:'bt 770'},{code:'AN-00002',product:'Blood Bag',company:'Fixture Co',specification:'450 ml',category:'Consumable',search_text:''},{code:'AN-00003',product:'Blood Bag Triple',company:'Other',specification:'',category:'Consumable',search_text:''},{code:'AN-00004',product:'Monitor Cable',company:'',specification:'',category:'Spare',search_text:''}];`,ctx);
 return ctx;
}
test('search needs every word, ranks exact code then names starting with the search',()=>{
 const ctx=load(),codes=q=>[...ctx.countMatches(vm.runInContext('countCatalogue',ctx),q).map(i=>i.code)];
 assert.deepEqual(codes(''),[]);
 assert.deepEqual(codes('blood bag'),['AN-00002','AN-00003'],'shorter name first');
 assert.deepEqual(codes('monitor'),['AN-00004','AN-00001'],'starts-with first');
 assert.deepEqual(codes('bt-770 printer'),['AN-00001']);
 assert.deepEqual(codes('an-00003'),['AN-00003']);
 assert.deepEqual(codes('fixture 450'),['AN-00002'],'company and specification are searched');
 assert.deepEqual(codes('blood cable'),[]);
});
test('accepted totals group by godown, unit, condition, batch and expiry and never add different units',()=>{
 const ctx=load(),e=(id,extra)=>({id,session_id:'s',code:'AN-00002',unlisted:'',godown:'New Dakawa',unit:'PCS',condition:'good',batch:'',expiry:null,quantity:'1',status:'accepted',...extra});
 const rows=ctx.countAcceptedTotals([e('1',{quantity:'3'}),e('2',{quantity:'2'}),e('3',{unit:'BOX'}),e('4',{godown:'Keko Manga A'}),e('5',{status:'recorded'}),e('6',{status:'void'}),e('7',{condition:'expired'}),e('8',{code:null,unlisted:'Grey pump'})]);
 const find=(godown,unit,condition='good',code='AN-00002')=>rows.find(r=>r.godown===godown&&r.unit===unit&&r.condition===condition&&r.code===code);
 assert.equal(find('New Dakawa','PCS').quantity,5);assert.equal(find('New Dakawa','PCS').counts,2);
 assert.equal(find('New Dakawa','BOX').quantity,1);assert.equal(find('Keko Manga A','PCS').quantity,1);assert.equal(find('New Dakawa','PCS','expired').quantity,1);
 assert.equal(rows.find(r=>r.unlisted==='Grey pump').quantity,1);assert.equal(rows.length,5,'recorded and void counts are excluded');
});
test('CSV export neutralises spreadsheet formulas and quotes commas',()=>{
 const ctx=load();vm.runInContext(`countCatalogue.push({code:'AN-00005',product:'=HYPERLINK("x")',company:'A, B',specification:'',category:'Spare'})`,ctx);
 const csv=ctx.countCsv([{code:'AN-00005',unlisted:'',godown:'New Dakawa',quantity:2,unit:'PCS',condition:'good',batch:'-1',expiry:'',counts:1}]);
 const line=csv.split('\r\n')[1];
 assert.match(line,/^AN-00005,"'=HYPERLINK\(""x""\)","A, B",/);assert.match(line,/"'-1"/);assert.match(csv.split('\r\n')[0],/^Code,Product,Company,Specification,Category/);
});
test('owner sees accept and reject; counter can void only their own; nothing after review',()=>{
 const ctx=load(),row=(role,user,entry)=>{ctx.me={user_id:user,role};return [...ctx.countEntryRow({id:'x',session_id:'s',code:'AN-00001',godown:'New Dakawa',quantity:1,unit:'PCS',condition:'good',counted_by:'c',counted_at:'2026-09-30T08:00:00Z',status:'recorded',...entry},{review:true}).matchAll(/data-count-action="([a-z]+)"/g)].map(m=>m[1]);};
 assert.deepEqual(row('owner','o'),['accept','reject','void']);assert.deepEqual(row('staff','c'),['void']);assert.deepEqual(row('staff','z'),[]);
 assert.deepEqual(row('owner','o',{status:'accepted'}),[]);
});
test('temporary screen can be switched off in config and is wired into the app',()=>{
 const ctx=load();assert.equal(ctx.stockCountEnabled(),true);ctx.window.ERP_CONFIG.stockCountEnabled=false;assert.equal(ctx.stockCountEnabled(),false);
 const nav=read('workspace-navigation.js'),html=read('index.src.html'),app=read('app.js');
 assert.match(nav,/\['Stock count','stockcount','count'\],\['Review stock counts','stockcount','review'\]/);assert.match(nav,/ERP_CONFIG\?\.stockCountEnabled!==false/);
 assert.match(app,/view==='stockcount'\)return stockCountWorkspace\(\)/);assert.match(app,/typeof clearStockCount==='function'\)clearStockCount\(\)/);
 assert.ok(html.indexOf('stock-count.js')>html.indexOf('purchasing.js')&&html.indexOf('stock-count.js')<html.indexOf('app.js'));
 assert.match(read('config.js'),/stockCountEnabled:true/);
 const sql=read('supabase/migrations/202610060065_count_godowns_haadi_main.sql'),godowns=[...read('stock-count.js').match(/const countGodowns=\[(.*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
 for(const g of godowns)assert.ok(sql.includes(`'${g}'`),g+' allowed by the database');
 assert.doesNotMatch(read('stock-count.js'),/from\('(inventory_lots|inventory_movements|products)'\)\.(insert|update|delete)/,'the count never writes stock');
});
test('product list file is validated before anything is sent',()=>{
 const ctx=load(),rows=r=>JSON.stringify({format:'anudha-count-catalogue-v1',rows:r}),ok={code:'AN-00001',product:'Blood Bag',category:'Consumable'};
 assert.throws(()=>ctx.countCatalogueRows('not json'),/not the product list/);
 assert.throws(()=>ctx.countCatalogueRows(JSON.stringify({rows:[ok]})),/not the product list/);
 assert.throws(()=>ctx.countCatalogueRows(rows([ok,ok])),/repeated AN code/);
 assert.throws(()=>ctx.countCatalogueRows(rows([{...ok,product:' '}])),/product name is empty/);
 assert.throws(()=>ctx.countCatalogueRows(rows([{...ok,category:'Toys'}])),/unknown category/);
 const [row]=ctx.countCatalogueRows(rows([{...ok,company:' Fixture ',erp_product_ids:['x']}]));
 assert.equal(row.company,'Fixture');assert.equal(row.specification,'');assert.equal(row.erp_product_ids.length,1);
});
test('product list file keeps the research note and suggested company',()=>{
 const ctx=load(),[row]=ctx.countCatalogueRows(JSON.stringify({format:'anudha-count-catalogue-v1',rows:[{code:'AN-00001',product:'Bag',category:'Consumable',company_note:'Found online: https://x.test',suggested_company:' Polymed '}]}));
 assert.equal(row.company_note,'Found online: https://x.test');assert.equal(row.suggested_company,'Polymed');
});
