import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceRoot=process.env.ERP_PARALLEL_SOURCE_ROOT||fileURLToPath(new URL('..',import.meta.url));
const source=file=>readFileSync(resolve(sourceRoot,file),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const value=(ctx,expression)=>vm.runInContext(expression,ctx);
const plain=x=>JSON.parse(JSON.stringify(x));
function load(file,globals){const ctx=vm.createContext(globals);vm.runInContext(source(file),ctx,{filename:file});return ctx;}

function inventoryFixture(){
 const calls=[],requests=new Map(),links=deferred();
 const request=table=>{calls.push(table);const pending=deferred();requests.set(table,pending);return pending.promise;};
 const ctx=load('inventory-operations.js',{me:{user_id:'actor'},productDetailReviews:new Map(),productReviewLoadError:'',document:{addEventListener(){}},
  loadProductMachineLinks:()=>{calls.push('machine-links');return links.promise;},all:request,
  client:{from:table=>{const promise=request(table);const query={select:()=>query,order:()=>query,limit:()=>query,then:(yes,no)=>promise.then(yes,no)};return query;}}});
 const finish=()=>{links.resolve();for(const [table,pending] of requests)pending.resolve(table==='inventory_issues'||table==='inventory_movements'?{data:[]}:table==='product_detail_reviews'?[{product_id:'p',version:1},{product_id:'p',version:3}]:[]);};
 return {ctx,calls,requests,links,finish};
}
test('inventory starts links, corrections and all stock reads before any answer',async()=>{
 const f=inventoryFixture(),pending=f.ctx.loadInventoryOperations();await tick();
 assert.deepEqual(new Set(f.calls),new Set(['machine-links','product_detail_reviews','inventory_locations','product_pack_definitions','inventory_lots','inventory_transfers','inventory_issues','inventory_movements','product_inventory_classifications']));
 assert.equal(value(f.ctx,'inventoryLoaded'),false);f.finish();assert.equal(await pending,true);
 assert.equal(value(f.ctx,"productDetailReviews.get('p').version"),3);assert.equal(value(f.ctx,'productReviewLoadError'),'');
});
test('inventory retains soft correction failures and hard stock failures',async()=>{
 for(const table of ['product_detail_reviews','inventory_lots']){
  const f=inventoryFixture(),pending=f.ctx.loadInventoryOperations();await tick();f.requests.get(table).reject(Error('Read unavailable'));f.finish();await pending;
  assert.equal(value(f.ctx,'inventoryLoaded'),table==='product_detail_reviews');
  assert.equal(value(f.ctx,table==='product_detail_reviews'?'productReviewLoadError':'inventoryLoadError'),'Read unavailable');
 }
});
test('inventory keeps malformed correction results advisory without publishing a partial map',async()=>{
 const f=inventoryFixture(),pending=f.ctx.loadInventoryOperations();await tick();f.requests.get('product_detail_reviews').resolve(null);f.finish();
 assert.equal(await pending,true);assert.equal(value(f.ctx,'productDetailReviews.size'),0);assert.notEqual(value(f.ctx,'productReviewLoadError'),'');
});
test('inventory ignores a replacement actor and superseded epoch',async()=>{
 for(const invalidate of [f=>{f.ctx.me={user_id:'actor'};},f=>value(f.ctx,'inventoryEpoch++')]){
  const f=inventoryFixture(),pending=f.ctx.loadInventoryOperations();await tick();invalidate(f);f.finish();assert.equal(await pending,false);
  assert.equal(value(f.ctx,'inventoryLoaded'),false);assert.equal(value(f.ctx,'productDetailReviews.size'),0);
 }
});
test('inventory observes a later table rejection after an earlier link failure',async()=>{
 const f=inventoryFixture(),pending=f.ctx.loadInventoryOperations();await tick();f.links.reject(Error('Links unavailable'));
 await assert.rejects(pending,/Links unavailable/);f.requests.get('inventory_issues').reject(Error('Late table failure'));f.finish();await tick();
 assert.equal(value(f.ctx,'inventoryLoaded'),false);
});

function pendingFixture(){
 const calls=[],requests=new Map();
 const ctx=load('pending-stock.js',{me:{user_id:'actor'},salesLoaded:false,salesProformas:[],all:table=>{calls.push(table);const pending=deferred();requests.set(table,pending);return pending.promise;}});
 const finish=()=>{for(const [table,pending] of requests)pending.resolve(table==='pending_stock_requests'?[{id:'request'}]:table==='sales_proformas'?[{id:'proforma'}]:table==='inventory_lots'?[{product_id:'p',location_id:'l',pack_definition_id:'pack',stock_status:'available',sealed_cartons:2,loose_units:3,reserved_units:1}]:table==='product_pack_definitions'?[{id:'pack',units_per_carton:5}]:[{id:'l',active:true}]);};
 return {ctx,calls,requests,finish};
}
test('pending requests and availability start together and retain availability arithmetic',async()=>{
 const f=pendingFixture(),pending=f.ctx.loadPendingStock();
 assert.deepEqual(new Set(f.calls),new Set(['pending_stock_requests','sales_proformas','inventory_lots','product_pack_definitions','inventory_locations']));
 f.finish();assert.equal(await pending,true);assert.equal(value(f.ctx,"pendingAvailability.get('p')"),12);assert.equal(value(f.ctx,'pendingRows[0].id'),'request');assert.equal(f.ctx.salesProformas[0].id,'proforma');
});
test('pending availability failure remains advisory and preserves request rows',async()=>{
 const f=pendingFixture(),pending=f.ctx.loadPendingStock();f.requests.get('inventory_lots').reject(Error('Stock offline'));f.finish();assert.equal(await pending,true);
 assert.equal(value(f.ctx,'pendingRows[0].id'),'request');assert.equal(value(f.ctx,'pendingAvailabilityError'),'Stock offline');assert.equal(value(f.ctx,'pendingAvailability.size'),0);
});
test('pending stale actor or epoch cannot apply any result',async()=>{
 for(const invalidate of [f=>{f.ctx.me={user_id:'actor'};},f=>value(f.ctx,'pendingEpoch++')]){
  const f=pendingFixture(),pending=f.ctx.loadPendingStock();invalidate(f);f.finish();assert.equal(await pending,false);
  assert.equal(value(f.ctx,'pendingRows.length'),0);assert.equal(value(f.ctx,'pendingAvailability.size'),0);
 }
});
test('pending observes rejected advisory reads after request failure',async()=>{
 const f=pendingFixture(),pending=f.ctx.loadPendingStock();f.requests.get('pending_stock_requests').reject(Error('Requests offline'));
 await assert.rejects(pending,/Requests offline/);f.requests.get('inventory_lots').reject(Error('Late stock failure'));f.finish();await tick();assert.equal(value(f.ctx,'pendingLoaded'),false);
});

function serialFixture(count=201){
 const calls=[],plans=[],settings=deferred(),serials=deferred(),messages=[];
 const notes=Array.from({length:count},(_,i)=>({id:'note-'+i}));
 const ctx=load('serial-numbers.js',{me:{user_id:'actor'},sessionLoadEpoch:4,salesDeliveryNotes:notes,deliveryLines:()=>[],message:text=>messages.push(text),
  document:{querySelectorAll:selector=>selector==='[data-document-card]'?notes.map(note=>({dataset:{documentCard:note.id}})):[]},
  client:{from:table=>({select:columns=>{calls.push({table,columns});return settings.promise;}}),rpc:(name,args)=>{calls.push({name,args});const pending=deferred();plans.push(pending);return pending.promise;}},
  salesRowsFor:(...args)=>{calls.push({rows:args});return serials.promise;}});
 const finish=()=>{settings.resolve({data:[{product_id:'p',serial_required:true}]});plans.forEach((pending,i)=>pending.resolve({data:[{delivery_line_id:'line-'+i}]}));serials.resolve({data:[{serial_number:'SERIAL-1'}]});};
 return {ctx,calls,plans,settings,serials,messages,finish};
}
test('delivery settings, all 100-note plan chunks and serial rows start before answers',async()=>{
 const f=serialFixture(),pending=f.ctx.decorateDeliverySerials();assert.equal(f.calls.length,5);
 assert.deepEqual(f.calls.filter(call=>call.name).map(call=>call.args.p_delivery_note_ids.length),[100,100,1]);
 assert.deepEqual(plain(f.calls.find(call=>call.rows).rows),['delivery_line_serials','delivery_note_id',Array.from({length:201},(_,i)=>'note-'+i),'serial_number']);
 f.finish();await pending;assert.equal(value(f.ctx,'plannedSerialLines.size'),3);assert.equal(value(f.ctx,'deliverySerials[0].serial_number'),'SERIAL-1');
});
test('delivery keeps settings and planned-error precedence without publishing partial serial data',async()=>{
 for(const failure of ['settings','planned','serials']){
  const f=serialFixture(1),pending=f.ctx.decorateDeliverySerials();
  if(failure==='settings')f.settings.resolve({error:{message:'Settings unavailable'}});
  if(failure==='planned')f.plans[0].resolve({error:{message:'Plan unavailable'}});
  f.serials.resolve({error:{message:'Serials unavailable'}});f.finish();await pending;
  assert.equal(f.messages.length,failure==='settings'?0:1);
  if(failure!=='settings')assert.match(f.messages[0],failure==='planned'?/Serial requirements.*Plan unavailable/:/Serial numbers.*Serials unavailable/);
  assert.equal(value(f.ctx,'plannedSerialLines.size'),0);assert.equal(value(f.ctx,'deliverySerials.length'),0);
 }
});
test('delivery rejects results from replacement actors, newer decorations and replaced sessions',async()=>{
 for(const invalidate of [f=>{f.ctx.me={user_id:'actor'};},f=>value(f.ctx,'serialDecorationRequest++'),f=>{f.ctx.sessionLoadEpoch++;}]){
  const f=serialFixture(1),pending=f.ctx.decorateDeliverySerials();invalidate(f);f.finish();await pending;
  assert.equal(value(f.ctx,'plannedSerialLines.size'),0);assert.equal(value(f.ctx,'deliverySerials.length'),0);assert.deepEqual(f.messages,[]);
 }
});
test('delivery observes unused failures after settings deny the read',async()=>{
 const f=serialFixture(1),pending=f.ctx.decorateDeliverySerials();f.settings.resolve({error:{message:'Settings unavailable'}});await pending;
 f.plans[0].reject(Error('Late plan failure'));f.serials.reject(Error('Late serial failure'));await tick();assert.deepEqual(f.messages,[]);
});
test('delivery keeps plan transport errors before later serial failures',async()=>{
 const f=serialFixture(1),pending=f.ctx.decorateDeliverySerials();f.settings.resolve({data:[]});f.plans[0].reject(Error('Plan transport failure'));f.serials.reject(Error('Serial transport failure'));
 await assert.rejects(pending,/Plan transport failure/);assert.equal(value(f.ctx,'deliverySerials.length'),0);
});
test('delivery retains the first plan-chunk error when a later parallel chunk rejects',async()=>{
 const f=serialFixture(101),pending=f.ctx.decorateDeliverySerials();f.settings.resolve({data:[]});f.plans[0].resolve({error:{message:'First plan error'}});f.plans[1].reject(Error('Later transport error'));f.serials.reject(Error('Unused serial failure'));
 await pending;assert.equal(f.messages.length,1);assert.match(f.messages[0],/Serial requirements.*First plan error/);assert.equal(value(f.ctx,'deliverySerials.length'),0);
});

function workFixture(){
 const calls=[];
 const ctx=load('work-assignments.js',{me:{user_id:'actor'},client:{from:table=>{
  const call={table,filters:[]},query={select:columns=>(call.columns=columns,query),eq:(key,val)=>(call.filters.push([key,val]),query),in:(key,val)=>(call.filters.push([key,val]),query),order:()=>query,
   range:(first,last)=>{const pending=deferred();Object.assign(call,{first,last,pending});calls.push(call);return pending.promise;}};return query;
 }}});
 return {ctx,calls};
}
test('handoffs combine history, current owner and open delays in concurrent 100-record reads',async()=>{
 const f=workFixture(),ids=Array.from({length:250},(_,i)=>'r'+i),pending=f.ctx.loadRecordWork('delivery',ids);
 assert.equal(f.calls.length,3);assert.deepEqual(f.calls.map(call=>call.filters[1][1].length),[100,100,50]);
 for(const call of f.calls){assert.equal(call.table,'work_assignments');assert.match(call.columns,/work_delays\(id,assignment_id,reason,expected_on,recorded_by,recorded_at\)/);assert.deepEqual(plain(call.filters[0]),['record_type','delivery']);assert.equal(call.first,0);assert.equal(call.last,999);}
 f.calls[0].pending.resolve({data:[{id:'old',record_id:'r0',status:'done',work_delays:[{id:'old-delay'}]},{id:'open',record_id:'r0',status:'open',version:7,work_delays:[{id:'active-delay',assignment_id:'open'}]}]});
 f.calls[1].pending.resolve({data:[]});f.calls[2].pending.resolve({data:[]});const result=await pending;
 assert.equal(result.open.get('r0').version,7);assert.equal(result.history.length,2);assert.equal(result.history.some(row=>'work_delays' in row),false);assert.deepEqual(plain(result.delays),[{id:'active-delay',assignment_id:'open'}]);
});
test('combined handoff reads retain pagination beyond the 1000-row server cap',async()=>{
 const f=workFixture(),pending=f.ctx.loadRecordWork('delivery',['record']);
 f.calls[0].pending.resolve({data:Array.from({length:1000},(_,i)=>({id:'old-'+i,record_id:'record',status:'done',work_delays:[]}))});await tick();
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].first,1000);assert.equal(f.calls[1].last,1999);
 f.calls[1].pending.resolve({data:[{id:'now',record_id:'record',status:'open',work_delays:[]}]});const result=await pending;
 assert.equal(result.history.length,1001);assert.equal(result.open.get('record').id,'now');
});
test('combined handoff reads reject errors and discard stale actor or epoch results',async()=>{
 for(const invalidation of ['error','actor','epoch']){
  const f=workFixture(),pending=f.ctx.loadRecordWork('delivery',['record']);
  if(invalidation==='actor')f.ctx.me={user_id:'actor'};if(invalidation==='epoch')value(f.ctx,'workEpoch++');
  f.calls[0].pending.resolve(invalidation==='error'?{error:{message:'Unavailable'}}:{data:[{id:'old',record_id:'record',status:'open',work_delays:[{id:'delay'}]}]});
  if(invalidation==='error')await assert.rejects(pending,/Unavailable/);else{const result=await pending;assert.equal(result.open.size,0);assert.equal(result.history.length,0);assert.equal(result.delays.length,0);}
 }
});
test('all displayed handoff record types begin loading before the first type finishes',async()=>{
 const loads=[],boxes=[],cards=['delivery','service'].map(type=>({type,id:type,card:{querySelector:()=>({before(){}})}}));
 const document={createElement:()=>{const box={dataset:{},isConnected:true,classList:{toggle(){}},querySelectorAll:()=>[],querySelector:()=>null};boxes.push(box);return box;}};
 const ctx=load('work-assignments.js',{me:{user_id:'actor'},document,esc:String});ctx.workRecordCards=()=>cards;
 ctx.loadRecordWork=type=>{const pending=deferred();loads.push({type,pending});return pending.promise;};
 const loading=ctx.decorateWorkHandoffs();assert.deepEqual(loads.map(x=>x.type),['delivery','service']);
 ctx.me={user_id:'actor'};for(const request of loads)request.pending.resolve({open:new Map(),history:[],delays:[]});await loading;
 for(const box of boxes)assert.match(box.innerHTML,/work-responsible-skeleton/);
});
