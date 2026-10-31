import {installPageHeader} from './helpers/page-header.mjs';
import {installLeaveContext} from './helpers/leave-context.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const functionSource=(file,name)=>{const found=source(file).match(new RegExp('(?:async )?function '+name+'\\([\\s\\S]*?^}', 'm'));assert.ok(found,name);return found[0];};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({count=1,history=1,errorTable='',delayHistory=false,rpcOverride=null}={}){
 const nodes=new Map(),timers=new Map();let timer=0,ctx,recordButtons=[];
 const node=id=>({id,isConnected:true,addEventListener(event,fn){this[event]=fn;},focus(){ctx.document.activeElement=this;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},scrollLeft:0,parentElement:null,value:''});
 const reads=[],content=node('content');let html='';Object.defineProperty(content,'innerHTML',{get:()=>html,set:value=>{html=value;for(const item of nodes.values())item.isConnected=false;nodes.clear();for(const [,id] of value.matchAll(/id="([^"]+)"/g))nodes.set('#'+id,node(id));recordButtons=[...value.matchAll(/<button\b([^>]*)>/g)].map(([,attributes])=>({...node(''),dataset:Object.fromEntries([...attributes.matchAll(/data-([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value||'']))}));}});
 const actor={user_id:'owner',role:'owner'},tables={
  organizations:[{id:'org',name:'Fixture clinic',location:'Arusha',deleted_at:null}],contacts:[{id:'contact',organization_id:'org',first_name:'Named',last_name:'Contact',deleted_at:null}],products:[{id:'product',name:'Fixture reagent',sku:'FX-1'}],
  sales_proformas:Array.from({length:count},(_,i)=>({id:'p'+i,document_number:'PF-'+i,organization_id:'org',contact_id:'contact',status:'accepted',revision:1,currency:'TZS',total_minor:100,created_at:'2026-10-29T08:00:00Z'})),
  sales_delivery_notes:Array.from({length:count},(_,i)=>({id:'d'+i,delivery_number:'DN-'+i,proforma_id:'p'+i,organization_id:'org',contact_id:'contact',status:'delivered',expected_delivery_date:'2026-10-30',created_at:'2026-10-29T08:00:00Z'})),
  sales_proforma_lines:Array.from({length:count},(_,i)=>({id:'pl'+i,proforma_id:'p'+i,product_id:'product',sort_order:0,quantity:10})),
  sales_delivery_lines:Array.from({length:count},(_,i)=>({id:'dl'+i,delivery_note_id:'d'+i,proforma_line_id:'pl'+i,quantity:4})),
  sales_delivery_events:Array.from({length:history},(_,i)=>({id:'event'+i,delivery_note_id:'d0',created_at:'2026-10-29T08:00:00Z',to_status:'delivered'})),
  sales_proforma_revisions:[{proforma_id:'p0',revision:1,snapshot:{organizationName:'Fixture clinic',lines:[]}}],discount_policy:[{head_limit_basis_points:1000}]
 };
 let releaseHistory;
 const client={from(table){
  const filters=[],request={table,range:[0,999]},query={
   select(columns,options){request.columns=columns;request.options=options;return this;},order(){return this;},range(from,to){request.range=[from,to];return this;},limit(size){request.range=[0,size-1];return this;},
   eq(key,value){filters.push(row=>row[key]===value);return this;},is(key,value){filters.push(row=>(row[key]??null)===value);return this;},in(key,values){request.ids=[...values];filters.push(row=>values.includes(row[key]));return this;},single(){request.single=true;return this;},maybeSingle(){request.single=true;return this;},
   then(ok,bad){reads.push({...request});const rows=(tables[table]||[]).filter(row=>filters.every(filter=>filter(row))),paged=rows.slice(request.range[0],request.range[1]+1),result=table===errorTable?{error:{message:'Fixture '+table+' failure'}}:{data:request.single?paged[0]||null:paged,count:request.options?.count==='exact'?rows.length:null};
    if(delayHistory&&table==='sales_delivery_events')return new Promise(resolve=>{releaseHistory=()=>resolve(result);}).then(ok,bad);
    return Promise.resolve(result).then(ok,bad);
   }
  };return query;
 },rpc:async(name,args)=>{reads.push({rpc:name,args});if(rpcOverride)return rpcOverride(name,args);
  if(name==='sales_proforma_page'){const page=Math.min(args.p_page,Math.max(0,Math.ceil(count/50)-1)),rows=tables.sales_proformas.slice(page*50,page*50+50).map(row=>({...row,register_summary:true,register_tag:'partial',organization:{name:'Fixture clinic',location:'Arusha'},contact_name:'Named Contact',items_summary:'10 × Fixture reagent'}));return {data:{rows,total:count,page,pages:Math.max(1,Math.ceil(count/50)),counts:{all:count,mine:0,placement:0,partial:count},live_status:[],discount_policy:{head_limit_basis_points:1000}}};}
  if(name==='sales_delivery_page'){const page=Math.min(args.p_page,Math.max(0,Math.ceil(count/50)-1)),rows=(args.p_filter==='notes'?tables.sales_delivery_notes:tables.sales_proformas).slice(page*50,page*50+50).map(row=>({...row,register_summary:true,kind:args.p_filter==='notes'?'delivery':'awaiting',organization:{name:'Fixture clinic',location:'Arusha'},contact_name:'Named Contact',proforma_number:'PF-'+row.proforma_id,responsible:{assignee_user_id:'owner',assignee_name:'Asha <owner>',sender_name:'Baraka',task:'Arrange delivery',created_at:'2026-10-29T08:00:00Z'},responsible_delay:null}));return {data:{rows,total:count,page,pages:Math.max(1,Math.ceil(count/50)),filter:args.p_filter,counts:{notes:count,awaiting:count}}};}
  return {data:[]};}};
 const liveBoxes=()=>[...content.innerHTML.matchAll(/data-live-status="([^"]+)"/g)].map(match=>({dataset:{liveStatus:match[1],liveProformaStatus:'accepted'},classList:{toggle(){}},textContent:'',hidden:true}));
 ctx=vm.createContext({statusTone,client,me:actor,view:'sales',organizations:[],contacts:[],products:[],orgIndex:new Map(),
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),$:selector=>selector==='#content'?content:nodes.get(selector),
  document:{activeElement:null,getElementById:id=>nodes.get('#'+id),querySelector:()=>null,querySelectorAll:selector=>selector==='[data-live-status]'?liveBoxes():recordButtons.filter(button=>{const match=selector.match(/^\[data-([\w-]+)\]$/);return match&&Object.hasOwn(button.dataset,match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()));}),addEventListener(){}},
  window:{addEventListener(){},scrollX:0,scrollY:0,scrollTo(){}},setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:key=>timers.delete(key),
  syncWorkspaceNavigation(){},workspaceLoading(){content.innerHTML='<p>Loading</p>';},message(){},confirm:()=>true,pricingBindForm(){},proformaBindCommercial(){},run:fn=>fn(),
  productDetailReviews:new Map(),productReviewLoadError:'',productMachineLinks:new Map(),machineLinksEpoch:0,productMachineLinksError:'',
  orderLiveText:()=>'',liveStatusCache:new Map(),liveStatusAsk:0,
  employeeName:()=> 'Directory employee',scan(){ctx.orgIndex=new Map(ctx.organizations.map(row=>[row.id,row]));}
 });
 installPageHeader(ctx);
 const app=source('app.js');vm.runInContext(app.split('\n').find(line=>line.startsWith('async function all('))+'\n'+app.slice(app.indexOf('let listsLoaded='),app.indexOf('function firstAccount(')),ctx);
 for(const file of ['search-state.js','row-index.js','business-date.js','company-forms.js','sales-domain.js','proforma-commercial.js','sales-delivery.js','discount-approval.js'])vm.runInContext(source(file),ctx);
 vm.runInContext(source('inventory-operations.js')+'\n'+functionSource('product-machine-links.js','loadProductMachineLinks')+'\n'+functionSource('packing-queue.js','decorateOrderLiveStatus')+'\n'+functionSource('packing-queue.js','orderLiveHtml'),ctx);
 for(const name of ['packingTime','packingPromiseText','packingCallCustomer'])vm.runInContext(functionSource('packing-queue.js',name),ctx);
 installLeaveContext(ctx);const run=code=>vm.runInContext(code,ctx);
 return {ctx,reads,content,tables,run,nodes,timers,releaseHistory:()=>releaseHistory(),async open(){await ctx.salesDeliveryWorkspace();await flush();}};
}

test('actual cold Sales landing uses one bounded RPC, preserves shared caches and renders joined labels',async()=>{
 const f=fixture(),organizations=f.ctx.organizations,contacts=f.ctx.contacts,products=f.ctx.products;
 f.run("salesProformas=[{id:'legacy-cache'}]");await f.open();
 assert.equal(f.reads.length,1);assert.equal(f.reads[0].rpc,'sales_proforma_page');
 assert.match(f.content.innerHTML,/Fixture clinic/);assert.match(f.content.innerHTML,/Named Contact/);assert.match(f.content.innerHTML,/10 × Fixture reagent/);assert.match(f.content.innerHTML,/Partially delivered/);assert.match(f.content.innerHTML,/50 per page/);
 assert.equal(f.run('inventoryLoaded'),false);assert.equal(f.run('listsLoaded'),false);assert.equal(f.run('salesProformas[0].id'),'legacy-cache');
 assert.equal(f.ctx.organizations,organizations);assert.equal(f.ctx.contacts,contacts);assert.equal(f.ctx.products,products);
 assert.equal(f.run('salesDeliveryEvents.length'),0);
});

test('large-register paging, filter and debounced search each use one request without bulk reads',async()=>{
 const f=fixture({count:1001});await f.open();assert.equal(f.run('salesProformaPageData.rows.length'),50);assert.equal(f.run('salesProformaPageData.total'),1001);
 f.run('salesProformaPage=20');await f.ctx.salesDeliveryWorkspace();await flush();assert.equal(f.run('salesProformaPageData.rows.length'),1);assert.equal(f.reads.length,2);
 f.run("salesProformaFilter='partial';salesProformaPage=0");await f.ctx.salesDeliveryWorkspace();await flush();assert.equal(f.reads.length,3);assert.equal(f.reads.at(-1).args.p_filter,'partial');
 const input=f.nodes.get('#proformaSearch');input.value='Fixture';input.oninput({target:input});input.value='Fixture clinic';input.oninput({target:input});assert.equal(f.timers.size,1);assert.equal(f.reads.length,3);
 [...f.timers.values()][0]();await flush();assert.equal(f.reads.length,4);assert.equal(f.reads.at(-1).args.p_query,'Fixture clinic');assert.equal(f.reads.at(-1).args.p_page,0);
 assert.ok(f.reads.every(read=>read.rpc==='sales_proforma_page'));assert.equal(f.run('salesProformas.length'),0);
});

test('opening an order loads the actual inventory dependencies and only that delivery history once',async()=>{
 const f=fixture({count:2,history:1001});await f.open();f.reads.length=0;
 f.run("salesFocusedProforma='p0';proformaScreen=()=>'<p>Opened order</p>'");await f.ctx.salesDeliveryWorkspace();await flush();
 assert.equal(f.run('inventoryLoaded'),true);assert.equal(f.run('salesDeliveryEvents.length'),1001);
 assert.ok(f.reads.some(read=>read.table==='inventory_lots'));assert.ok(f.reads.some(read=>read.table==='product_detail_reviews'));
 const histories=f.reads.filter(read=>read.table==='sales_delivery_events');assert.equal(histories.length,2);assert.ok(histories.every(read=>read.ids.join()==='d0'));
 assert.ok(!f.reads.some(read=>read.table==='sales_proforma_events'));
 f.reads.length=0;await f.ctx.salesDeliveryWorkspace();await flush();assert.ok(!f.reads.some(read=>read.table==='sales_delivery_events'||read.table?.startsWith('inventory_')));
 f.run("salesFocusedProforma='';salesSection='delivery';salesFocusedDelivery='d1';deliveryScreen=()=>'<p>Opened delivery</p>'");
 await f.ctx.salesDeliveryWorkspace();await flush();assert.deepEqual(f.reads.filter(read=>read.table==='sales_delivery_events').map(read=>read.ids),[['d1']]);
 assert.equal(f.run('salesDeliveryEvents.length'),1001,'loading the next delivery preserves previously loaded history');
});

test('shared lists, inventory and history failures block detail rendering and show a retry',async()=>{
 for(const errorTable of ['organizations','inventory_lots','sales_delivery_events']){
  const f=fixture({errorTable});await f.open();f.run("salesFocusedProforma='p0';proformaScreen=()=>'<p>Incorrect detail</p>'");
  await f.ctx.salesDeliveryWorkspace();await flush();assert.match(f.content.innerHTML,new RegExp('Fixture '+errorTable+' failure'));assert.doesNotMatch(f.content.innerHTML,/Incorrect detail/);
  assert.equal(f.run('salesDeliveryHistoryLoaded.size'),0);
 }
});

test('late delivery history cannot populate a cleared or refreshed sales session',async()=>{
 for(const reset of ['clearSalesDelivery()','salesLoadRequest++',"me={user_id:'replacement'}"]){
  const f=fixture({delayHistory:true}),pending=f.ctx.loadSalesDeliveryHistory(['d0']);await flush();f.run(reset);f.releaseHistory();await pending;
  assert.equal(f.run('salesDeliveryEvents.length'),0);assert.equal(f.run('salesDeliveryHistoryLoaded.size'),0);
 }
});

test('stale page results cannot replace a newer search, actor, cleared session or another view',async()=>{
 const empty={data:{rows:[],total:0,page:0,pages:1,counts:{all:0,mine:0,placement:0},live_status:[],discount_policy:null}};
 const pending=[],f=fixture({rpcOverride:()=>new Promise(resolve=>pending.push(resolve))});
 const first=f.ctx.salesDeliveryWorkspace();await flush();f.run("salesProformaSearch='new'");const second=f.ctx.salesDeliveryWorkspace();await flush();
 pending[1](empty);await second;pending[0]({error:{message:'Stale failure'}});await first;assert.doesNotMatch(f.content.innerHTML,/Stale failure/);assert.equal(f.run('salesProformaPageData.total'),0);
 for(const leave of ["me={user_id:'other'}",'clearSalesDelivery()',"view='inventory'","salesEditing='new'"]){
  let finish;const g=fixture({rpcOverride:()=>new Promise(resolve=>finish=resolve)}),loading=g.ctx.salesDeliveryWorkspace();await flush();g.run(leave);finish(empty);await loading;
  assert.equal(g.run('salesProformaPageData'),null);
 }
 let fail;const g=fixture({rpcOverride:()=>new Promise(resolve=>fail=resolve)}),loading=g.ctx.salesDeliveryWorkspace();await flush();g.run("salesEditing='new'");g.content.innerHTML='Replacement editor';fail({error:{message:'Old page failed'}});await loading;assert.equal(g.content.innerHTML,'Replacement editor');
});

test('missing and malformed page responses show failure without falling back to full lists or fake totals',async()=>{
 for(const result of [{error:{message:'Page RPC unavailable'}},{data:{rows:[],total:10,page:0,pages:1,counts:{all:10,mine:0,placement:0},live_status:[],discount_policy:null}}]){
  const f=fixture({rpcOverride:async()=>result});await f.open();assert.equal(f.reads.length,1);assert.match(f.content.innerHTML,/could not be loaded/);assert.equal(f.run('salesProformaPageData'),null);assert.equal(f.run('listsLoaded'),false);
 }
});

test('actual cold delivery landing uses one page query, at most 50 summaries, joined names and no full caches or decorators',async()=>{
 const f=fixture({count:1064}),decorators=[];f.run("salesSection='delivery';salesDeliveryNotes=[{id:'complete-cache'}]");
 for(const name of ['decorateOrderLiveStatus','decorateDiscountApprovals','decorateCustomerReturns','decorateDeliverySerials','decorateWorkHandoffs'])f.ctx[name]=async()=>decorators.push(name);
 const caches=[f.ctx.organizations,f.ctx.contacts,f.ctx.products];await f.open();
 assert.equal(f.reads.length,1);assert.equal(f.reads[0].rpc,'sales_delivery_page');assert.equal(f.run('salesDeliveryPageData.rows.length'),50);assert.equal(f.run('salesDeliveryPageData.total'),1064);assert.equal(f.run('salesDeliveryNotes[0].id'),'complete-cache');
 assert.equal(f.run('inventoryLoaded'),false);assert.equal(f.run('listsLoaded'),false);assert.deepEqual([f.ctx.organizations,f.ctx.contacts,f.ctx.products],caches);assert.deepEqual(decorators,[]);
 assert.match(f.content.innerHTML,/Fixture clinic/);assert.match(f.content.innerHTML,/Named Contact/);assert.match(f.content.innerHTML,/Asha &lt;owner&gt;/);assert.match(f.content.innerHTML,/Arrange delivery/);assert.match(f.content.innerHTML,/Delivery note signed/);assert.match(f.content.innerHTML,/Expected 2026-10-30/);assert.doesNotMatch(f.content.innerHTML,/data-document-card|data-live-status|<table|data-delivery-action/);
 const elementCount=(f.content.innerHTML.match(/<[a-z][^>]*>/g)||[]).length,textCount=f.content.innerHTML.split(/<[^>]*>/).filter(part=>part.trim()).length;assert.ok(elementCount+textCount<=2000,`${elementCount+textCount} rendered element/text nodes`);
});

test('delivery Next, Previous, Awaiting and Notes controls each request exactly one bounded page',async()=>{
 const f=fixture({count:101});f.run("salesSection='delivery'");await f.open();
 f.nodes.get('#deliveryNext').click();await flush();assert.equal(f.run('salesDeliveryPage'),1);assert.equal(f.run('salesDeliveryPageData.rows[0].id'),'d50');
 f.nodes.get('#deliveryNext').click();await flush();assert.equal(f.run('salesDeliveryPageData.rows.length'),1);assert.match(f.content.innerHTML,/id="deliveryNext" disabled/);
 f.nodes.get('#deliveryPrev').click();await flush();assert.equal(f.run('salesDeliveryPage'),1);
 f.nodes.get('#deliveryAwaitingTab').click();await flush();assert.equal(f.run('salesDeliveryFilter'),'awaiting');assert.equal(f.run('salesDeliveryPage'),0);assert.match(f.content.innerHTML,/Orders with quantities still awaiting delivery/);assert.match(f.content.innerHTML,/data-create-delivery="p0"/);assert.match(f.content.innerHTML,/data-order-proforma="p0"/);
 f.nodes.get('#deliveryNotesTab').click();await flush();assert.equal(f.run('salesDeliveryFilter'),'notes');assert.equal(f.reads.length,6);assert.ok(f.reads.every(read=>read.rpc==='sales_delivery_page'));
});

test('busy delivery summaries remain under the DOM budget with promises, lobby marks and escaped owner details',async()=>{
 const f=fixture({count:50});for(const [n,note] of f.tables.sales_delivery_notes.entries())Object.assign(note,{status:n%2?'packing':'sent_to_sales',customer_waiting:n%3===0,packer_user_id:'owner',packer_name:'Packer <script>',packing_blocked_reason:'Waiting <stock>',promise_kind:'machines',promised_by:'2026-01-01T08:00:00Z'});
 f.run("salesSection='delivery'");await f.open();assert.match(f.content.innerHTML,/Packer &lt;script&gt;/);assert.match(f.content.innerHTML,/Waiting &lt;stock&gt;/);assert.match(f.content.innerHTML,/Customer waiting/);assert.match(f.content.innerHTML,/Call the customer/);assert.match(f.content.innerHTML,/Machine: by availability/);assert.doesNotMatch(f.content.innerHTML,/<script>|<stock>/);
 const elements=(f.content.innerHTML.match(/<[a-z][^>]*>/g)||[]).length,text=f.content.innerHTML.split(/<[^>]*>/).filter(part=>part.trim()).length;assert.ok(elements+text<=2000,`${elements+text} rendered element/text nodes`);assert.equal(f.reads.length,1);
});

test('opening a selected delivery hydrates full context only on demand and Back restores its register page',async()=>{
 const f=fixture({count:51});f.run("salesSection='delivery';salesDeliveryPage=1");await f.open();f.reads.length=0;
 f.ctx.document.querySelectorAll('[data-open-delivery]')[0].onclick();await flush();
 assert.equal(f.run('salesFocusedDelivery'),'d50');assert.equal(f.run('listsLoaded'),true);assert.equal(f.run('inventoryLoaded'),true);assert.equal(f.run('salesDeliveryNotes.length'),51);assert.match(f.content.innerHTML,/data-document-card="d50"/);assert.doesNotMatch(f.content.innerHTML,/data-document-card="d0"/);
 assert.deepEqual(f.reads.filter(read=>read.table==='sales_delivery_events').map(read=>read.ids),[['d50']]);
 f.reads.length=0;f.ctx.document.querySelectorAll('[data-delivery-back]')[0].onclick();await flush();assert.equal(f.run('salesDeliveryPage'),1);assert.equal(f.run('salesDeliveryFilter'),'notes');assert.equal(f.reads.length,1);assert.equal(f.reads[0].rpc,'sales_delivery_page');assert.match(f.content.innerHTML,/data-open-delivery="d50"/);
});

test('awaiting existing-invoice action hydrates editor context, then close restores its tab and page',async()=>{
 const f=fixture({count:51});f.run("salesSection='delivery';salesDeliveryFilter='awaiting';salesDeliveryPage=1");await f.open();
 f.ctx.document.querySelectorAll('[data-create-delivery]')[0].onclick();await flush();assert.equal(f.run('salesEditing'),'p50');assert.equal(f.run('listsLoaded'),true);assert.equal(f.run('inventoryLoaded'),true);assert.match(f.content.innerHTML,/id="deliveryForm"/);assert.ok(!f.reads.some(read=>read.table==='sales_delivery_events'));
 f.reads.length=0;f.nodes.get('#closeDeliveryEditor').click();await flush();assert.equal(f.run('salesDeliveryFilter'),'awaiting');assert.equal(f.run('salesDeliveryPage'),1);assert.equal(f.reads.length,1);assert.match(f.content.innerHTML,/data-create-delivery="p50"/);
});

test('late delivery pages cannot overwrite another filter, selected detail, navigation or actor session',async()=>{
 const page=filter=>({data:{rows:[],total:0,page:0,pages:1,filter,counts:{notes:0,awaiting:0}}});
 const pending=[],f=fixture({rpcOverride:()=>new Promise(resolve=>pending.push(resolve))});f.run("salesSection='delivery'");const first=f.ctx.salesDeliveryWorkspace();await flush();f.run("salesDeliveryFilter='awaiting'");const second=f.ctx.salesDeliveryWorkspace();await flush();pending[1](page('awaiting'));await second;pending[0]({error:{message:'Old failure'}});await first;assert.equal(f.run('salesDeliveryPageData.filter'),'awaiting');assert.doesNotMatch(f.content.innerHTML,/Old failure/);
 for(const leave of ["me={user_id:'owner',role:'owner'}",'clearSalesDelivery()',"view='service'","salesFocusedDelivery='d0'","salesEditing='p0'"]){
  let finish;const g=fixture({rpcOverride:()=>new Promise(resolve=>finish=resolve)});g.run("salesSection='delivery'");const loading=g.ctx.salesDeliveryWorkspace();await flush();g.run(leave);g.content.innerHTML='Replacement view';finish(page('notes'));await loading;assert.equal(g.run('salesDeliveryPageData'),null);assert.equal(g.content.innerHTML,'Replacement view');
 }
});

test('delivery RPC errors and incomplete rows fail without a bulk fallback or invented totals',async()=>{
 for(const response of [{error:{message:'Unavailable delivery RPC'}},{data:{rows:[],total:1,page:0,pages:1,filter:'notes',counts:{notes:1,awaiting:0}}},{data:{rows:[],total:0,page:0,pages:1,filter:'notes',counts:{notes:1,awaiting:0}}},{data:{rows:[{id:'d0',register_summary:true,kind:'delivery',organization:{name:'Partial'}}],total:1,page:0,pages:1,filter:'notes',counts:{notes:1,awaiting:0}}}]){
  const f=fixture({rpcOverride:async()=>response});f.run("salesSection='delivery'");await f.open();assert.equal(f.reads.length,1);assert.equal(f.run('salesDeliveryPageData'),null);assert.equal(f.run('listsLoaded'),false);assert.match(f.content.innerHTML,/could not be loaded/);
 }
});
