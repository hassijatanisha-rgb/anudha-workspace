import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){
 const ctx=vm.createContext({products:[{id:'p1',name:'Blood bag'}],employeeName:id=>({a:'Asha',b:'Baraka'}[id]||'Employee name not set'),Date,Math,Number,String,Object,Map,Set});
 vm.runInContext(readFileSync(new URL('../reports.js',import.meta.url),'utf8'),ctx);return ctx;
}
test('periods: weeks start Monday, months are calendar months, custom end date is inclusive',()=>{
 const ctx=load(),wednesday=new Date(2026,8,30);
 assert.deepEqual([...ctx.reportRange('this_week',wednesday)],['2026-09-28','2026-10-05']);
 assert.deepEqual([...ctx.reportRange('last_week',wednesday)],['2026-09-21','2026-09-28']);
 assert.deepEqual([...ctx.reportRange('this_month',wednesday)],['2026-09-01','2026-10-01']);
 assert.deepEqual([...ctx.reportRange('last_month',new Date(2026,0,15))],['2025-12-01','2026-01-01']);
 assert.deepEqual([...ctx.reportRange('this_week',new Date(2026,9,4))],['2026-09-28','2026-10-05'],'Sunday belongs to the week that started Monday');
 assert.deepEqual([...ctx.reportRange('custom',wednesday,'2026-09-01','2026-09-30')],['2026-09-01','2026-10-01']);
 assert.throws(()=>ctx.reportRange('custom',wednesday,'2026-09-30','2026-09-01'),/end date/);
 assert.throws(()=>ctx.reportRange('custom',wednesday,'',''),/start date/);
});
test('activity counts each event once per employee and ignores repeated statuses',()=>{
 const ctx=load();
 const rows=ctx.reportActivity({
  leadEvents:[{action:'create',actor_user_id:'a'},{action:'create',actor_user_id:'a'},{action:'qualify',actor_user_id:'b'},{action:'assign',from_stage:'inquiry',actor_user_id:'b'},{action:'assign',from_stage:'lead',actor_user_id:'b'},{action:'won',actor_user_id:'a'},{action:'lost',actor_user_id:'b'},{action:'edit',actor_user_id:'a'}],
  proformaEvents:[{from_status:null,to_status:'draft',actor_user_id:'a'},{from_status:'draft',to_status:'draft',actor_user_id:'a'},{from_status:'draft',to_status:'sent',actor_user_id:'a'},{from_status:'sent',to_status:'accepted',actor_user_id:'b'}],
  deliveryEvents:[{from_status:'out_for_delivery',to_status:'delivered',actor_user_id:'b'}],
  serviceEvents:[{from_status:'report_required',to_status:'completed',actor_user_id:'b'}],
  pendingEvents:[{action:'create',actor_user_id:'a'},{action:'extend',actor_user_id:'a'},{action:'fulfil',actor_user_id:'a'}],
  steps:[{status:'done',closed_by:'b'},{status:'cancelled',closed_by:'b'}]});
 const byActor=Object.fromEntries(rows.map(r=>[r.actor,r]));
 assert.equal(byActor.a.inquiries,2);assert.equal(byActor.b.qualified,2);assert.equal(byActor.a.won,1);assert.equal(byActor.b.lost,1);
 assert.equal(byActor.a.proformas,1,'a revision save is not a new Pro forma');assert.equal(byActor.a.sent,1);assert.equal(byActor.b.accepted,1);
 assert.equal(byActor.b.delivered,1);assert.equal(byActor.b.serviceReports,1);assert.equal(byActor.a.pendingCreated,1);assert.equal(byActor.a.pendingFulfilled,1);assert.equal(byActor.b.stepsDone,1);
 assert.equal(byActor.a.total,7);assert.equal(byActor.b.total,7);assert.equal(rows[0].actor,'a','equal totals sort by name');
 const busier=ctx.reportActivity({leadEvents:[{action:'create',actor_user_id:'a'}],steps:[{status:'done',closed_by:'b'},{status:'done',closed_by:'b'}]});assert.equal(busier[0].actor,'b','busiest employee first');
});
test('stock movements sum pieces in and out per product, godown and movement type',()=>{
 const ctx=load(),lots=[{id:'l1',product_id:'p1',location_id:'g1'},{id:'l2',product_id:'p1',location_id:'g2'}];
 const rows=ctx.reportMovements([{lot_id:'l1',movement_type:'consumer_issue',base_unit_change:-5},{lot_id:'l1',movement_type:'consumer_issue',base_unit_change:-3},{lot_id:'l1',movement_type:'consumer_return',base_unit_change:2},{lot_id:'l2',movement_type:'transfer_receipt',base_unit_change:20},{lot_id:'gone',movement_type:'opening_balance',base_unit_change:7}],lots);
 const find=(lot,type)=>rows.find(r=>r.location_id===lot&&r.movement_type===type);
 assert.deepEqual({...find('g1','consumer_issue')},{product_id:'p1',location_id:'g1',movement_type:'consumer_issue',count:2,pieces_in:0,pieces_out:8});
 assert.equal(find('g1','consumer_return').pieces_in,2);assert.equal(find('g2','transfer_receipt').pieces_in,20);
 assert.equal(rows.find(r=>r.product_id==='').pieces_in,7,'movements whose lot is missing stay visible as unknown');
});
test('CSV quotes separators and neutralises spreadsheet formulas',()=>{
 const ctx=load(),csv=ctx.reportCsv([['a','Name'],['b','Value']],[{a:'Hospital, Dar',b:'=HYPERLINK("x")'},{a:'Plain',b:5}]);
 assert.equal(csv,'Name,Value\r\n"Hospital, Dar","\'=HYPERLINK(""x"")"\r\nPlain,5');
});
test('menu, router, sign-out and script order are wired',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),html=read('index.html');
 assert.match(read('workspace-navigation.js'),/\['Reports','reports'\]/);assert.match(read('app.js'),/view==='reports'\)return reportsWorkspace\(\)/);assert.match(read('app.js'),/typeof clearReports==='function'\)clearReports\(\)/);
 assert.ok(html.indexOf('reports.js')>html.indexOf('work-assignments.js')&&html.indexOf('reports.js')<html.indexOf('app.js'));
});
