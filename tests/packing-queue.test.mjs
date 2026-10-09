import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const migrationName=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>/_packing_queue\.sql$/.test(name));
const sql=read('supabase/migrations/'+migrationName);

function load(extra={}){
 const ctx=vm.createContext({document:{addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],body:{classList:{toggle(){}}}},setInterval(){},clearInterval(){},esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),Date,...extra});
 vm.runInContext(read('packing-queue.js'),ctx);return ctx;
}
const at=(base,minutes)=>new Date(base-minutes*60000).toISOString();

test('the migration is 078, in house style, and claims orders with skip locked',()=>{
 assert.match(migrationName,/^\d{8}0078_packing_queue\.sql$/);
 assert.match(sql,/^-- [\s\S]*Rollback:/);assert.match(sql,/\nbegin;\n/);assert.match(sql,/\ncommit;\n?$/);
 assert.match(sql,/for update skip locked/);assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/from public, anon;/);assert.match(sql,/to authenticated;/);
 for(const fn of ['packing_take_next','packing_mark_packed','packing_release','packing_queue_board','set_delivery_customer_waiting','order_live_status'])assert.match(sql,new RegExp(`create function public\\.${fn}\\([^)]*\\)[\\s\\S]*?security definer`),fn);
 assert.match(sql,/packing_mark_packed\(p_id uuid, p_expected_version integer\)/);
 assert.match(sql,/packing_release\(p_id uuid, p_expected_version integer, p_reason text\)/);
 // Reuses the existing steps and history rather than a second packing flow.
 assert.match(sql,/public\.start_sales_delivery_packing\(/);assert.match(sql,/public\.advance_sales_delivery\(p_id, p_expected_version, 'ready'/);
 // The overdue time is one setting, 30 minutes; amber at 20.
 assert.match(sql,/packing_overdue_minutes\(\) returns integer language sql immutable as \$\$ select 30 \$\$/);
 assert.match(sql,/packing_amber_minutes\(\) returns integer language sql immutable as \$\$ select 20 \$\$/);
 assert.doesNotMatch(sql,/interval '15 minutes'|interval '30 minutes'/,'no second copy of the threshold');
});

test('queue order: customer waiting in the lobby first, then delivery, first come first served',()=>{
 assert.match(sql,/order by customer_waiting desc, packing_queued_at nulls last, created_at, id\s+limit 1 for update skip locked/);
});

test('timer levels: amber from 20 minutes, red (alert) at 30',()=>{
 const ctx=load();
 assert.equal(ctx.packingLevel(19,20,30),'');assert.equal(ctx.packingLevel(20,20,30),'amber');
 assert.equal(ctx.packingLevel(29,20,30),'amber');assert.equal(ctx.packingLevel(30,20,30),'red');
 const now=Date.parse('2026-10-09T10:00:00Z');
 assert.equal(ctx.packingClock(at(now,7.5),now),'7:30');assert.equal(ctx.packingClock(at(now,61),now),'1:01:00');
 assert.equal(ctx.packingMinutes(at(now,31),now),31);
 assert.equal(ctx.packingShortNumber('DN-2026-000123'),'123');
});

test('live order line for each stage',()=>{
 const ctx=load(),now=Date.parse('2026-10-09T10:00:00Z');
 const ready=new Date(now-20*60000),hhmm=`${String(ready.getHours()).padStart(2,'0')}:${String(ready.getMinutes()).padStart(2,'0')}`;
 assert.equal(ctx.orderLiveText(null,now,'accepted'),'Submitted to accounting · waiting for approval');
 assert.equal(ctx.orderLiveText(null,now,'sent'),'');
 assert.equal(ctx.orderLiveText({status:'accounts_approved'},now),'Approved by accounts · tax invoice next');
 assert.equal(ctx.orderLiveText({status:'tax_invoice_created'},now),'Tax invoice made · going to packing next');
 assert.equal(ctx.orderLiveText({status:'sent_to_sales',queued_at:at(now,20),queue_position:3},now),'Sent to packing 20 min ago · waiting in the queue (position 3)');
 assert.equal(ctx.orderLiveText({status:'sent_to_sales',queued_at:at(now,5),queue_position:1,customer_waiting:true},now),'Sent to packing 5 min ago · waiting in the queue (position 1) · customer waiting');
 assert.equal(ctx.orderLiveText({status:'packing',packer_name:'Juma',taken_at:at(now,12)},now),'Being packed by Juma · 12 min');
 assert.equal(ctx.orderLiveText({status:'ready',ready_at:ready.toISOString()},now),`Packed · ready for delivery ${hhmm}`);
 assert.equal(ctx.orderLiveText({status:'out_for_delivery'},now),'Out for delivery');
 assert.match(ctx.orderLiveText({status:'delivered',delivered_at:ready.toISOString()},now),/^Delivered /);
 assert.equal(ctx.orderLiveText({status:'delivered'},now),'Delivered');
 assert.equal(ctx.orderLiveText({status:'cancelled'},now),'Delivery cancelled');
 assert.equal(ctx.orderLiveText({status:'out_for_delivery',call_customer:true},now),'Out for delivery · Call the customer');
});

test('delivery promise is shown, and "Call the customer" more than 2 days past it',()=>{
 const ctx=load(),now=Date.parse('2026-10-09T10:00:00Z');
 assert.match(ctx.packingPromiseText({promise_kind:'consumables',promised_by:'2026-10-10T07:00:00Z'},now),/^Promised by .*24 working hours/);
 assert.match(ctx.packingPromiseText({promise_kind:'machines',promised_by:'2026-10-12T21:00:00Z'},now),/^Machine: by availability, agreed with the customer/);
 assert.match(ctx.packingPromiseText({customer_waiting:true},now),/Customer waiting in the lobby/);
 assert.equal(ctx.packingCallCustomer({promised_by:new Date(now-49*3600000).toISOString(),status:'packing'},now),true);
 assert.equal(ctx.packingCallCustomer({promised_by:new Date(now-47*3600000).toISOString(),status:'packing'},now),false);
 assert.equal(ctx.packingCallCustomer({promised_by:new Date(now-90*3600000).toISOString(),status:'delivered'},now),false);
 assert.equal(ctx.packingCallCustomer({promised_by:new Date(now-90*3600000).toISOString(),customer_waiting:true},now),false);
});

test('Packing queue and TV screen are in the Orders menu and need Deliveries access',()=>{
 const nav=read('workspace-navigation.js'),access=read('staff-access.js'),app=read('app.js'),html=read('index.src.html');
 assert.match(nav,/\['Delivery progress','sales','delivery'\],\['Packing queue','packing','queue'\],\['Packing TV screen','packing','screen'\]/);
 assert.match(access,/if\(target==='packing'\)return 'deliveries';/);
 assert.match(app,/view==='packing'\)return packingWorkspace\(\)/);
 assert.match(nav,/syncPackingScreenMode\(\)/);
 assert.ok(html.indexOf('packing-queue.js')>0&&html.indexOf('packing-queue.css')>0);
 // #/go/packing/screen opens the TV screen through the menu entry (nav-history.js).
 const m='#/go/packing/screen'.match(/^#\/go\/([a-z]+)(?:\/([a-z-]+))?$/);assert.deepEqual([m[1],m[2]],['packing','screen']);
});

test('the TV screen hides the menu and shows big numbers, client, items and the clock',()=>{
 const ctx=load({view:'packing'});
 ctx.__board={now:'2026-10-09T10:00:00Z',offset:0,amber_minutes:20,overdue_minutes:30,can_release:false,mine:null,coming:{count:0},
  waiting:[{id:'a',delivery_number:'DN-2026-000041',customer_waiting:true,queued_at:new Date(Date.now()-300000).toISOString(),organization:'Lobby Clinic',items:[{name:'Strips',quantity:2,uom:'box'}]},
   {id:'b',delivery_number:'DN-2026-000040',customer_waiting:false,queued_at:new Date(Date.now()-900000).toISOString(),organization:'Far Hospital',items:[],call_customer:true}],
  packing:[{id:'c',delivery_number:'DN-2026-000039',packer_name:'Juma',taken_at:new Date(Date.now()-31*60000).toISOString(),organization:'Busy Lab',items:[{name:'Reagent',quantity:1}]}]};
 vm.runInContext('packingBoard=__board',ctx);
 const html=vm.runInContext('packingScreenHtml()',ctx);
 assert.match(html,/<li class="packing-tv-lobby"><b>41<\/b><span>Lobby Clinic/);
 assert.match(html,/2 Strips/);assert.match(html,/CALL THE CUSTOMER/);
 assert.match(html,/class="packing-tv-red"><b>39<\/b><span><strong>Juma<\/strong>Busy Lab/);
 assert.match(html,/data-packing-exit/);
 const css=read('packing-queue.css');assert.match(css,/body\.packing-tv>header,body\.packing-tv #nav/);
 const page=vm.runInContext('packingQueueHtml()',ctx);
 assert.match(page,/data-packing-take/);assert.match(page,/Waiting · 2/);assert.match(page,/Over 30 minutes\. The stores head and the owner have been told\./);
});

test('My orders today: Pro formas I prepared that moved today',()=>{
 const src=read('sales-delivery.js'),fn=src.split('\n').findIndex(line=>line.startsWith('function proformaMineToday('));
 const ctx=vm.createContext({});vm.runInContext(src.split('\n').slice(fn,fn+5).join('\n'),ctx);
 const now=new Date('2026-10-09T12:00:00'),today=new Date('2026-10-09T09:00:00').toISOString(),old=new Date('2026-10-01T09:00:00').toISOString();
 assert.equal(ctx.proformaMineToday({prepared_by:'u1',created_at:old,accepted_at:today},'u1',now),true);
 assert.equal(ctx.proformaMineToday({prepared_by:'u2',created_at:today},'u1',now),false);
 assert.equal(ctx.proformaMineToday({prepared_by:'u1',created_at:old,updated_at:old},'u1',now),false);
 assert.match(src,/data-proforma-filter="mine"[^>]*>My orders today/);
});

test('the lobby choice is asked at the Accounts approval hand-off',()=>{
 const src=read('sales-delivery.js');
 assert.match(src,/Customer waiting — cash, collecting now/);
 assert.match(src,/name="collection" value="lobby" required/);
 assert.match(src,/set_delivery_customer_waiting/);
 assert.match(src,/data-live-status|orderLiveHtml/);
});
