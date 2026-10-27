import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../order-workflow.js',import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture({permission=true,serviceAccess=true,invoiceError=false,serviceError=false,invoiceRows=[],serviceRows=[],quantities=null}={}){
 const reads=[],queries=[],calls=[],invoices={textContent:'',innerHTML:'',querySelector:()=>null},service={textContent:'',innerHTML:'',querySelectorAll:()=>[]};
 const panel={dataset:{orderWorkflow:'pf'},isConnected:true,querySelector:s=>s==='[data-order-invoices]'?invoices:service};
 const ctx=vm.createContext({me:{user_id:'actor'},view:'sales',salesEpoch:1,salesFocusedProforma:'pf',salesProformas:[{id:'pf',status:'accepted'}],salesDeliveryLines:[],salesDeliveryNotes:[{id:'dn',proforma_id:'pf',status:'delivered',delivery_number:'DN-1',packer_user_id:'actor',tracking_reference:'TRK'}],
  rowsWhere:(rows,k,v)=>rows.filter(r=>r[k]===v),salesFulfillment:()=> 'partial',salesStatus:s=>s,esc,employeeName:id=>id||'Not recorded',moneyDisplay:(n,c)=>c+' '+n/100,hasArea:()=>serviceAccess,
  client:{rpc:async(name)=>{calls.push(name);return {data:name==='accounting_access'?permission:quantities}},from:table=>{reads.push(table);const detail={table};queries.push(detail);let ids=[],bounds=[];const query={select(columns){detail.columns=columns;return this},in(k,v){ids=v;detail.ids=v;return this},order(){return this},range(a,b){bounds=[a,b];return this},then(resolve,reject){const rows=table==='acc_invoices'?invoiceRows:serviceRows,error=table==='acc_invoices'?invoiceError:serviceError;return Promise.resolve(error?{error:{message:'Offline'}}:{data:rows.slice(bounds[0],bounds[1]+1)}).then(resolve,reject)}};return query;}},document:{querySelectorAll:()=>[]}});
 vm.runInContext(source,ctx);return {ctx,reads,queries,calls,invoices,service,panel};
}
test('Whole order retains partial delivery warning and escapes linked identity text',()=>{
 const f=fixture();f.ctx.salesDeliveryNotes.push({id:'cancelled',proforma_id:'pf',status:'cancelled',delivery_number:'<img src=x>',tracking_reference:'<script>'});
 const html=f.ctx.orderWorkflowHtml({id:'pf',status:'accepted',revision:1,document_number:'PF-1',prepared_by:'actor'});
 assert.match(html,/Part delivered · balance outstanding/);assert.match(html,/1 active \/ completed · 1 cancelled/);assert.match(html,/data-order-delivery="dn"/);assert.doesNotMatch(html,/<img src=x>/);assert.match(html,/ERP invoice/);
});
test('Accounting denial does not read invoice data; service denial is explicit',async()=>{
 const f=fixture({permission:false,serviceAccess:false});await f.ctx.loadOrderWorkflow(f.panel);assert.deepEqual(f.reads,[]);assert.match(f.invoices.textContent,/approved accounting users/);assert.match(f.service.textContent,/Service jobs access/);
});
test('Linked invoice and machine cases use their own identities and status',async()=>{
 const f=fixture({invoiceRows:[{id:'inv',invoice_number:'INV-1',total_minor:11800,currency:'TZS'}],serviceRows:[{id:'case',case_number:'INS-1',status:'scheduled',assigned_user_id:'engineer',scheduled_for:'2026-10-19'}]});await f.ctx.loadOrderWorkflow(f.panel);
 assert.match(f.invoices.innerHTML,/INV-1/);assert.match(f.invoices.innerHTML,/TZS 118/);assert.match(f.service.innerHTML,/data-order-service-case="case"/);assert.match(f.service.innerHTML,/engineer/);assert.match(f.service.innerHTML,/2026-10-19/);
});
test('Lookup failures are not presented as absent invoices or absent cases',async()=>{
 const f=fixture({invoiceError:true,serviceError:true});await f.ctx.loadOrderWorkflow(f.panel);assert.match(f.invoices.textContent,/lookup unavailable: Offline/);assert.match(f.service.textContent,/lookup unavailable: Offline/);
});
test('Invoice-time plans load while packing and cancelled deliveries are excluded',async()=>{
 const f=fixture({serviceRows:[{id:'plan',case_number:'INS-PLAN',status:'assigned',delivery_ready:false,planned_unit_number:2,assigned_user_id:'engineer'}]});
 f.ctx.salesDeliveryNotes[0].status='packing';f.ctx.salesDeliveryNotes.push({id:'cancelled',proforma_id:'pf',status:'cancelled'});
 await f.ctx.loadOrderWorkflow(f.panel);
 const query=f.queries.find(row=>row.table==='service_cases');assert.deepEqual([...query.ids],['dn']);
 for(const column of ['planned_delivery_line_id','planned_unit_number','delivery_ready','reused_case_id'])assert.ok(query.columns.includes(column));
 assert.match(f.service.innerHTML,/Awaiting signed delivery · planning only/);assert.match(f.service.innerHTML,/Machine unit 2/);
 assert.match(f.service.innerHTML,/Engineer: engineer/);assert.doesNotMatch(f.service.innerHTML,/Signed delivery recorded/);
});
test('No active delivery waits for invoice planning without querying service cases',async()=>{
 const f=fixture();f.ctx.salesDeliveryNotes[0].status='cancelled';await f.ctx.loadOrderWorkflow(f.panel);
 assert.ok(!f.reads.includes('service_cases'));assert.match(f.service.textContent,/Awaiting invoice/);
});
test('Superseded plans open the preserved installation and escape displayed identity',async()=>{
 const f=fixture({serviceRows:[{id:'plan',case_number:'<script>plan',status:'cancelled',delivery_ready:true,reused_case_id:'existing-case'}]});
 await f.ctx.loadOrderWorkflow(f.panel);assert.match(f.service.innerHTML,/&lt;script&gt;plan/);
 assert.match(f.service.innerHTML,/data-order-service-case="existing-case"/);assert.match(f.service.innerHTML,/Open existing installation/);
 assert.match(f.service.innerHTML,/Signed delivery recorded/);assert.equal(f.reads.filter(table=>table==='service_cases').length,1);
});
test('Rows are paged through the final short page',async()=>{
 const rows=Array.from({length:1101},(_,i)=>({id:'case'+i,case_number:'INS-'+i,status:'awaiting_assignment'}));const f=fixture({serviceRows:rows});await f.ctx.loadOrderWorkflow(f.panel);assert.match(f.service.innerHTML,/INS-1100/);assert.equal(f.reads.filter(r=>r==='service_cases').length,3);
});
test('Signing out or navigating while accounting permission loads cannot reveal late data',async()=>{
 for(const change of [f=>f.ctx.me={user_id:'different'},f=>f.panel.isConnected=false,f=>f.ctx.salesFocusedProforma='different',f=>f.ctx.salesEpoch++]){
  const f=fixture({serviceAccess:false});let finish;f.ctx.client.rpc=()=>new Promise(resolve=>finish=resolve);const pending=f.ctx.loadOrderWorkflow(f.panel);change(f);finish({data:true});await pending;assert.equal(f.invoices.innerHTML,'');assert.deepEqual(f.reads,[]);
 }
});
test('Delivery ready action uses packer-checked RPC and preserves actor guard',()=>{
 const src=readFileSync(new URL('../sales-delivery.js',import.meta.url),'utf8');assert.match(src,/action==='ready'\)result=await client.rpc\('packing_mark_packed'/);
 const ctx=vm.createContext({me:{user_id:'one',role:'staff',department:'sales'}});vm.runInContext(src,ctx);assert.equal(ctx.deliveryCanFinishPacking({packer_user_id:'two'}),false);assert.equal(ctx.deliveryCanFinishPacking({packer_user_id:'one'}),true);ctx.me.role='head';ctx.me.department='stores';assert.equal(ctx.deliveryCanFinishPacking({packer_user_id:'two'}),true);
});
test('Opening a different task replaces delivery focus and opening a proforma clears it',async()=>{
 const ctx=vm.createContext({salesLoaded:true,salesFocusedDelivery:'old',salesFocusedProforma:'old-pf',salesSection:'delivery',salesEditing:'',view:'sales',render:()=>{}});
 vm.runInContext(readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8'),ctx);
 await ctx.workOpenRecord({record_type:'delivery',record_id:'new'});assert.equal(ctx.salesFocusedDelivery,'new');assert.equal(ctx.salesFocusedProforma,'');
 await ctx.workOpenRecord({record_type:'proforma',record_id:'pf'});assert.equal(ctx.salesFocusedDelivery,'');assert.equal(ctx.salesFocusedProforma,'pf');
});

test('A split order shows invoiced and signed delivered quantities independently',async()=>{
 const f=fixture({invoiceRows:[{id:'inv',invoice_number:'INV-2',total_minor:23600,currency:'TZS'}],quantities:{proforma_id:'pf',lines:[{proforma_line_id:'line',description:'X-ray <machine>',uom:'pcs',ordered_quantity:4,invoiced_quantity:2,remaining_quantity:2}]}});
 f.ctx.salesDeliveryLines=[{proforma_line_id:'line',delivery_note_id:'dn',quantity:2},{proforma_line_id:'line',delivery_note_id:'cancelled',quantity:9}];
 await f.ctx.loadOrderWorkflow(f.panel);
 assert.match(f.invoices.innerHTML,/X-ray &lt;machine&gt;/);assert.match(f.invoices.innerHTML,/<td>4<\/td><td>2<\/td><td>2<\/td><td>2<\/td>/);
 assert.match(f.invoices.innerHTML,/Pending invoice/);assert.match(f.invoices.innerHTML,/all quantities have signed delivery proof/);
 assert.match(f.invoices.innerHTML,/Part invoiced/);assert.match(f.invoices.innerHTML,/2 of 4 units invoiced · 2 pending invoice/);
 assert.match(f.invoices.innerHTML,/Open this order’s invoices/);
});
test('Invoiced units still in packing are not shown as delivered',()=>{
 const f=fixture();f.ctx.salesDeliveryNotes[0].status='packing';f.ctx.salesDeliveryLines=[{proforma_line_id:'line',delivery_note_id:'dn',quantity:2}];
 const html=f.ctx.orderQuantityHtml({proforma_id:'pf',lines:[{proforma_line_id:'line',description:'Machine',ordered_quantity:4,invoiced_quantity:2,remaining_quantity:2}]});
 assert.match(html,/<td>4<\/td><td>2<\/td><td>0<\/td><td>2<\/td>/);
});
test('Quantity rows show reviewed product identity alongside the historical description',()=>{
 const f=fixture();let requested;f.ctx.inventoryProduct=id=>{requested=id;return {name:'Reviewed <machine>',sku:'CODE & 1'};};
 const html=f.ctx.orderQuantityHtml({proforma_id:'pf',lines:[{product_id:'product-1',proforma_line_id:'line',description:'Historical item wording',ordered_quantity:4,invoiced_quantity:4,remaining_quantity:0}]});
 assert.equal(requested,'product-1');assert.match(html,/<strong>Reviewed &lt;machine&gt;<\/strong>/);assert.match(html,/CODE &amp; 1/);
 assert.match(html,/Historical item wording/);assert.match(html,/Fully invoiced/);assert.match(html,/0 pending invoice/);
 assert.doesNotMatch(html,/All quantities delivered/);
});
test('Workflow and commercial guidance describe invoice-time planning and delivery readiness',()=>{
 const f=fixture();const html=f.ctx.orderWorkflowHtml({id:'pf',status:'accepted',revision:1,document_number:'PF-1'});
 assert.match(html,/stock reserved, packing queued and machine installation planned/);
 assert.match(html,/Assign the engineer and work date before delivery/);
 assert.match(html,/Signed delivery records the delivered machine and serial/);
 assert.match(readFileSync(new URL('../proforma-commercial.js',import.meta.url),'utf8'),/create installation plans when invoiced/);
 assert.doesNotMatch(readFileSync(new URL('../how-to-use.js',import.meta.url),'utf8'),/A machine delivery creates an installation job/);
});

test('Cancelled split deliveries can be recreated while another invoice is still in packing',()=>{
 const ctx=vm.createContext({hasRemainingDelivery:()=>true,openDelivery:()=>({id:'other',status:'packing'})});
 vm.runInContext(readFileSync(new URL('../sales-delivery.js',import.meta.url),'utf8'),ctx);
 ctx.hasRemainingDelivery=()=>true;ctx.openDelivery=()=>({id:'other',status:'packing'});
 assert.equal(ctx.canCreateDelivery({id:'pf',status:'accepted'}),true);
 ctx.hasRemainingDelivery=()=>false;assert.equal(ctx.canCreateDelivery({id:'pf',status:'accepted'}),false);
});
