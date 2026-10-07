import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(role='staff',user='a'){
 const ctx=vm.createContext({me:{user_id:user,role},products:[{id:'p1',name:'Blood bag'},{id:'p2',name:'Cannula'}],esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>id,Intl,Number,String,Date});
 for(const file of ['row-index.js','purchasing.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 vm.runInContext(`suppliers=[{id:'s1',name:'Fixture Medical',active:true}];purchaseLines=[{purchase_order_id:'o1',line_number:1,product_id:'p1',quantity:10,unit_price_minor:500},{purchase_order_id:'o1',line_number:2,product_id:'p2',quantity:2,unit_price_minor:1000},{purchase_order_id:'o2',line_number:1,product_id:'p2',quantity:5,unit_price_minor:null}];`,ctx);
 return ctx;
}
const order=(id,status,extra={})=>({id,status,po_number:'PO-'+id,created_at:'2026-09-0'+id.length,requested_by:'a',...extra});
test('filters, search and overdue-first ordering',()=>{
 const ctx=load(),orders=[order('o1','ordered',{supplier_id:'s1',expected_on:'2099-01-01'}),order('o2','ordered',{expected_on:'2026-09-01',lpo_reference:'LPO-77'}),order('o3','requested'),order('o4','closed'),order('o5','cancelled')];
 const ids=(filter,search='')=>ctx.purchaseVisibleOrders(orders,{filter,search,today:'2026-09-30'}).map(o=>o.id);
 assert.deepEqual(ids('ordered'),['o2','o1'],'overdue arrival first');
 assert.deepEqual(ids('requested'),['o3']);assert.deepEqual(ids('finished').sort(),['o4','o5']);assert.equal(ids('all').length,5);
 assert.deepEqual(ids('all','fixture'),['o1']);assert.deepEqual(ids('all','lpo-77'),['o2']);assert.deepEqual(ids('all','blood bag'),['o1']);
});
test('quoted total only when every item has a price',()=>{
 const ctx=load();
 assert.equal(ctx.purchaseOrderTotal(order('o1','requested')),7000);
 assert.equal(ctx.purchaseOrderTotal(order('o2','requested')),null);
});
test('buttons follow status and role: owner approves, requester edits and cancels own request',()=>{
 const acts=(ctx,o)=>[...ctx.purchaseActions(o).matchAll(/data-purchase-(?:action="([a-z]+)"|(edit|history))/g)].map(m=>m[1]||m[2]);
 const staff=load('staff','a'),other=load('staff','b'),owner=load('owner','o');
 assert.deepEqual(acts(staff,order('x','requested')),['edit','cancel','history']);
 assert.deepEqual(acts(other,order('x','requested')),['history']);
 assert.deepEqual(acts(owner,order('x','requested')),['edit','approve','cancel','history']);
 assert.deepEqual(acts(staff,order('x','approved')),['order','history'],'only the owner cancels after approval');
 assert.deepEqual(acts(owner,order('x','ordered')),['close','cancel','history']);
 assert.deepEqual(acts(owner,order('x','closed')),['history']);
});
test('overdue only applies to ordered purchases past their expected date',()=>{
 const ctx=load();
 assert.equal(ctx.purchaseOverdue({status:'ordered',expected_on:'2026-09-01'},'2026-09-30'),true);
 assert.equal(ctx.purchaseOverdue({status:'approved',expected_on:'2026-09-01'},'2026-09-30'),false);
 assert.equal(ctx.purchaseOverdue({status:'ordered',expected_on:null},'2026-09-30'),false);
});
test('menu, router, sign-out, pending link and script order are wired',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),html=read('index.src.html');
 assert.match(read('workspace-navigation.js'),/\['Purchasing','purchasing','orders'\],\['Suppliers','purchasing','suppliers'\]/);
 assert.match(read('app.js'),/view==='purchasing'\)return purchasingWorkspace\(\)/);assert.match(read('app.js'),/typeof clearPurchasing==='function'\)clearPurchasing\(\)/);
 assert.match(read('pending-stock.js'),/typeof startPurchaseFromPending==='function'/);
 assert.ok(html.indexOf('purchasing.js')>html.indexOf('work-assignments.js')&&html.indexOf('purchasing.js')<html.indexOf('app.js'));
});
test('loads every open order but only six months of finished ones, items nested per order',async()=>{
 const ctx=load(),calls=[];
 ctx.all=async(table,columns,filter)=>{const q={or(v){calls.push([table,columns,v]);return q;}};if(filter)filter(q);else calls.push([table,columns,null]);
  return table==='purchase_orders'?[{id:'o9',status:'requested',purchase_order_lines:[{purchase_order_id:'o9',line_number:1,product_id:'p1',quantity:3}]}]:[{id:'s1',name:'Fixture Medical',active:true}];};
 assert.equal(await ctx.loadPurchasing(),true);
 const orders=calls.find(c=>c[0]==='purchase_orders');
 assert.equal(orders[1],'*,purchase_order_lines(*)');
 assert.match(orders[2],/^status\.in\.\(requested,approved,ordered\),updated_at\.gte\.\d{4}-/);
 const since=new Date(orders[2].split('updated_at.gte.')[1]);
 assert.ok(Math.abs((Date.now()-since)/864e5-183)<1,'window is six months');
 assert.deepEqual(vmJson(ctx,'purchaseOrders.map(o=>[o.id,"purchase_order_lines" in o])'),[['o9',false]]);
 assert.equal(vmJson(ctx,'purchaseOrderLines("o9").length'),1);
});
function vmJson(ctx,expr){return JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,ctx));}
test('after a step only that order is read again; the rest of the list is kept',async()=>{
 const ctx=load('owner');let asked=0,full=0;
 ctx.client={from:()=>{asked++;const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'o1',status:'approved',purchase_order_lines:[{purchase_order_id:'o1',line_number:1,product_id:'p2',quantity:4}]}})};return q;}};
 vm.runInContext(`purchaseLoaded=true;view='purchasing';purchaseOrders=[{id:'o1',status:'requested'},{id:'o2',status:'requested'}];renderPurchasing=()=>{};purchasingWorkspace=async()=>{globalThis.fullReload=(globalThis.fullReload||0)+1};`,ctx);
 await ctx.purchaseRefreshOne('o1');
 assert.equal(asked,1);assert.equal(vmJson(ctx,'globalThis.fullReload||0'),0,'no full reload');
 assert.deepEqual(vmJson(ctx,'purchaseOrders.map(o=>o.id+":"+o.status).sort()'),['o1:approved','o2:requested']);
 assert.deepEqual(vmJson(ctx,'purchaseOrderLines("o1").map(l=>l.product_id)'),['p2'],'old items replaced by the saved ones');
});
