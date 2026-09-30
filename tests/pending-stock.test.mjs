import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){
 const ctx=vm.createContext({orgIndex:new Map([['org',{name:'Fixture Hospital',location:'Dar'}]]),products:[{id:'p1',name:'Blood bag'},{id:'p2',name:'Cannula'}],me:{user_id:'a',role:'staff'},
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>({a:'Asha',b:'Baraka'}[id]||'Employee name not set'),Date,Math,Number,String});
 vm.runInContext(readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8'),ctx);return ctx;
}
test('available pieces count cartons, loose and reservations only at active available locations',()=>{
 const ctx=load();
 const packs=[{id:'box10',units_per_carton:10}],locations=[{id:'main',active:true},{id:'old',active:false}];
 const lots=[
  {product_id:'p1',location_id:'main',pack_definition_id:'box10',sealed_cartons:2,loose_units:5,reserved_units:3,stock_status:'available'},
  {product_id:'p1',location_id:'main',pack_definition_id:'box10',sealed_cartons:1,loose_units:0,reserved_units:0,stock_status:'quarantine'},
  {product_id:'p1',location_id:'old',pack_definition_id:'box10',sealed_cartons:9,loose_units:9,reserved_units:0,stock_status:'available'},
  {product_id:'p2',location_id:'main',pack_definition_id:'missing',sealed_cartons:1,loose_units:1,reserved_units:0,stock_status:'available'},
  {product_id:'p2',location_id:'main',pack_definition_id:'box10',sealed_cartons:0,loose_units:1,reserved_units:4,stock_status:'available'}];
 const totals=ctx.pendingAvailableByProduct(lots,packs,locations);
 assert.equal(totals.get('p1'),22);assert.equal(totals.has('p2'),false,'unknown pack sizes and impossible reservations are not counted');
});
test('state labels: arrived, partial, waiting, due and unknown availability',()=>{
 const ctx=load(),waiting={status:'waiting',quantity:10,expires_on:'2027-03-30'},today='2026-09-30';
 assert.equal(ctx.pendingStockState(waiting,12,today).key,'arrived');
 assert.equal(ctx.pendingStockState(waiting,4,today).key,'partial');
 assert.equal(ctx.pendingStockState(waiting,0,today).key,'waiting');
 assert.equal(ctx.pendingStockState(waiting,null,today).key,'unknown');
 assert.equal(ctx.pendingStockState({...waiting,expires_on:'2026-09-29'},99,today).key,'due');
 assert.equal(ctx.pendingStockState({...waiting,status:'fulfilled'},99,today).key,'closed');
});
test('products with no stock lots are waiting, not unknown; a failed stock check is unknown',()=>{
 const ctx=load(),rows=[{id:'r1',status:'waiting',product_id:'p2',quantity:1,organization_id:'org',salesperson_user_id:'a',expires_on:'2027-01-01'}];
 assert.equal(ctx.pendingVisibleRows(rows,{filter:'all',search:'',actor:'a',availability:new Map(),today:'2026-09-30'})[0].state.key,'waiting');
 assert.equal(ctx.pendingVisibleRows(rows,{filter:'all',search:'',actor:'a',availability:null,today:'2026-09-30'})[0].state.key,'unknown');
});
test('filters and ordering: overdue first, then arrived, then waiting; closed apart',()=>{
 const ctx=load(),base={status:'waiting',quantity:5,organization_id:'org',salesperson_user_id:'b'};
 const rows=[{...base,id:'wait',product_id:'p2',expires_on:'2027-03-01'},{...base,id:'arrived',product_id:'p1',expires_on:'2027-02-01'},{...base,id:'due',product_id:'p2',expires_on:'2026-09-01'},{...base,id:'mine',product_id:'p2',expires_on:'2026-10-05',salesperson_user_id:'a'},{...base,id:'done',product_id:'p1',status:'fulfilled',expires_on:'2027-01-01',close_note:'INV-1'}];
 const ids=filter=>ctx.pendingVisibleRows(rows,{filter,search:'',actor:'a',availability:new Map([['p1',9]]),today:'2026-09-30'}).map(x=>x.row.id);
 assert.deepEqual(ids('waiting'),['due','arrived','mine','wait']);
 assert.deepEqual(ids('arrived'),['arrived']);assert.deepEqual(ids('mine'),['mine']);
 assert.deepEqual(ids('due'),['due','mine']);assert.deepEqual(ids('closed'),['done']);
 assert.deepEqual(ctx.pendingVisibleRows(rows,{filter:'all',search:'syringe',actor:'a',availability:new Map(),today:'2026-09-30'}).length,0);
 assert.deepEqual(ctx.pendingVisibleRows(rows,{filter:'all',search:'blood',actor:'a',availability:new Map(),today:'2026-09-30'}).map(x=>x.row.id).sort(),['arrived','done']);
});
test('only the salesperson or owner sees close actions; only the owner can extend',()=>{
 const ctx=load(),row={id:'r',status:'waiting',salesperson_user_id:'b',extension_count:0,expires_on:'2099-01-01'};
 assert.doesNotMatch(ctx.pendingActions(row),/fulfil|extend/);
 ctx.me={user_id:'b',role:'staff'};assert.match(ctx.pendingActions(row),/fulfil/);assert.doesNotMatch(ctx.pendingActions(row),/extend/);
 ctx.me={user_id:'o',role:'owner'};assert.match(ctx.pendingActions(row),/extend/);
 assert.doesNotMatch(ctx.pendingActions({...row,extension_count:4}),/extend/);
});
test('menu, router, sign-out and script order are wired',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),html=read('index.html');
 assert.match(read('app.js'),/view==='pending'\)return pendingStockWorkspace\(\)/);assert.match(read('app.js'),/typeof clearPendingStock==='function'\)clearPendingStock\(\)/);
 assert.ok(html.indexOf('pending-stock.js')>html.indexOf('sales-leads.js')&&html.indexOf('pending-stock.js')<html.indexOf('app.js'));
});
