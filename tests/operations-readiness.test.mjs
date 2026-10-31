import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import {installLeaveContext} from './helpers/leave-context.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
function fixture(files,extra={}){
 const ctx=vm.createContext({statusTone,me:{user_id:'actor',role:'owner'},view:'stockcount',window:{ERP_CONFIG:{}},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),employeeName:id=>id,
  products:[{id:'product',name:'Original product'},{id:'other',name:'Different product'}],
  document:{querySelectorAll:()=>[]},$:()=>null,render:()=>{},message:()=>{},syncWorkspaceNavigation:()=>{},
  inventoryOption:()=>'',inventoryProductChoice:row=>row.name,salesProductChoices:()=>'',...extra});
 installDisclosureMotion(ctx);
 for(const file of ['business-date.js','row-index.js',...files])vm.runInContext(read(file),ctx);
 return {ctx,run:code=>vm.runInContext(code,ctx)};
}
function backend(tables){
 const calls=[];
 return {calls,from(table){
  let bounds=[0,999],filters=[],orders=[];
  const query={select(){return this},order(key){orders.push(key);return this},range(a,b){bounds=[a,b];return this},
   eq(key,value){filters.push(row=>row[key]===value);return this},in(key,values){filters.push(row=>values.includes(row[key]));return this},
   then(ok,bad){calls.push({table,bounds,orders});return Promise.resolve({data:(tables[table]||[]).filter(row=>filters.every(filter=>filter(row))).slice(bounds[0],bounds[1]+1)}).then(ok,bad)}};
  return query;
 }};
}
test('stock review and complete export select a closed session while staff continue the open count',async()=>{
 let exported;const reads=[];
 const controls={'#countRefresh':{},'#countExport':{}};
 const sessions=[{id:'open',name:'October',status:'open',opened_at:'2026-10-01'},{id:'closed',name:'September',status:'closed',opened_at:'2026-09-01'}],entries=[{id:'old',session_id:'closed',status:'accepted',quantity:4,unit:'PCS',condition:'good',godown:'Haadi',unlisted:'Historical product',counted_at:'2026-09-01'},{id:'new',session_id:'open',status:'accepted',quantity:99,unit:'PCS',condition:'good',godown:'Haadi',unlisted:'Current product'}];
 const f=fixture(['stock-count.js'],{$:selector=>controls[selector]||null,run:fn=>fn(),Blob:class{},URL:{createObjectURL:()=> 'blob:test'},setTimeout:()=>{},
  all:async(table,columns,filter)=>{const where={};if(filter)filter({eq(key,value){where[key]=value;return this}});reads.push({table,where});return table==='count_catalogue'?[]:entries.filter(row=>Object.entries(where).every(([key,value])=>row[key]===value));},
  document:{querySelectorAll:()=>[],body:{append(){}},createElement:()=>({click(){},remove(){}})}});
 f.run(`countActor=me;countPageReady=true;countTab='review';countReviewSessionId='closed';countReviewFilter='all';countPageData=${JSON.stringify({open_session:sessions[0],session:sessions[1],sessions:{rows:sessions,total:2,page:0,pages:1},entries:{rows:entries.slice(0,1),total:1,page:0,pages:1},stats:{recorded:0,accepted:1,rejected:0,void:0,accepted_lines:1,godowns:[{godown:'Haadi',total:1}]}})}`);
 assert.equal(f.ctx.countOpenSession().id,'open');assert.equal(f.ctx.countReviewSession().id,'closed');
 const html=f.ctx.renderCountReview(f.ctx.countReviewSession());assert.match(html,/September · Closed/);assert.match(html,/Historical product/);assert.doesNotMatch(html,/Current product/);
 f.ctx.countCsv=rows=>{exported=rows;return ''};f.ctx.bindStockCount();await controls['#countExport'].onclick();
 assert.equal(exported.length,1);assert.equal(exported[0].quantity,4);assert.equal(f.ctx.countOpenSession().id,'open');assert.deepEqual(reads[0].where,{session_id:'closed',status:'accepted'});
});
test('explicit stock refresh reads fresh page identities without loading a complete catalogue',async()=>{
 const calls=[],session={id:'open',name:'October',status:'open',opened_at:'2026-10-01',opened_by:'actor',version:1};
 const f=fixture(['stock-count.js'],{workspaceLoading(){},all:()=>{throw Error('Complete catalogue must stay lazy')},client:{rpc:async(name,args)=>{
  calls.push({name,args});const row={id:'entry',session_id:'open',code:'AN-00001',status:'recorded',version:1,catalogue:{code:'AN-00001',product:calls.length===1?'Old product':'Corrected product'}};
  return {data:{catalogue_total:1067,open_session:session,session,sessions:{rows:[session],total:1,page:0,pages:1},entries:{rows:[row],total:1,page:0,pages:1},stats:{all:1,recorded:1,accepted:0,rejected:0,void:0,accepted_lines:0,godowns:[{godown:'Haadi',total:1}]}}};
 }}});
 f.ctx.renderStockCount=()=>{};f.run("countActor=me;countGodown='Haadi';countCatalogue=[{code:'AN-00001',product:'Old cached product'}]");await f.ctx.stockCountWorkspace();assert.equal(f.ctx.countLabel(f.run('countPageData.entries.rows[0]')),'Old product');
 await f.ctx.stockCountWorkspace(true);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.name==='stock_count_page'));assert.equal(f.ctx.countLabel(f.run('countPageData.entries.rows[0]')),'Corrected product');
});
test('ordinary purchase open and New clear an abandoned prefill while explicit handoff retains its visible link',()=>{
 const controls={'#purchaseRefresh':{},'#purchaseSearch':{},'#newPurchase':{}};
 const f=fixture(['purchasing.js'],{$:selector=>controls[selector]||null,clearTimeout,run:fn=>fn()});
 f.ctx.startPurchaseFromPending({id:'pending',product_id:'product',quantity:4,request_number:'PS-42'});
 assert.equal(f.run('purchasePrefill.lines[0].pending_request_id'),'pending');assert.match(f.ctx.purchaseEditor(null),/For pending order PS-42/);
 f.ctx.openPurchaseSection('orders');assert.equal(f.run('purchasePrefill'),null);
 f.ctx.startPurchaseFromPending({id:'pending',product_id:'product',quantity:4,request_number:'PS-42'});
 f.ctx.bindPurchasing();f.ctx.purchasingWorkspace=async()=>{};controls['#newPurchase'].onclick();assert.equal(f.run('purchasePrefill'),null);assert.equal(f.run('purchaseEditing'),'new');
});
test('changing a linked purchase item clears the pending relationship before saving',()=>{
 const label={textContent:'For pending order PS-42'},fields={productChoice:{value:'Different product'},quantity:{value:'4'},note:{value:''}};
 const row={dataset:{pending:'pending',product:'product',price:''},querySelector:selector=>selector==='[data-purchase-pending]'?label:fields[selector.match(/name="([^"]+)"/)[1]]};
 const f=fixture(['purchasing.js'],{FormData:class{get(name){return name==='supplierId'?'supplier':name==='currency'?'TZS':''}},inventoryProductFromChoice:choice=>({id:choice==='Original product'?'product':'other'})});
 const form={querySelectorAll:()=>[row]};let values=f.ctx.purchaseFormValues(form);
 assert.equal(values.lines[0].pending_request_id,null);assert.equal(label.textContent,'For stock');
 row.dataset.pending='pending';fields.productChoice.value='Original product';values=f.ctx.purchaseFormValues(form);assert.equal(values.lines[0].pending_request_id,'pending');
});
test('purchase history includes events beyond the former cap and uses a stable page order',async()=>{
 const events=Array.from({length:1001},(_,i)=>({id:'e'+i,purchase_order_id:'order',action:'edit',note:'Revision '+i,created_at:'2026-10-01',actor_user_id:'actor'}));
 const client=backend({purchase_order_events:events}),output={isConnected:true,innerHTML:''};
 const f=fixture(['purchasing.js'],{client,CSS:{escape:value=>value},document:{querySelector:()=>output}});
 await f.ctx.showPurchaseHistory('order');assert.match(output.innerHTML,/Revision 1000/);assert.equal(client.calls.length,2);assert.ok(client.calls.every(call=>call.orders.join(',')==='created_at,id'));
});
test('handoff history and delays load every related row with deterministic page ordering',async()=>{
 const history=Array.from({length:2501},(_,i)=>({id:'h'+i,record_type:'service',record_id:'case',status:'done'}));
 const delays=Array.from({length:2101},(_,i)=>({id:'d'+i,assignment_id:'assignment',recorded_at:'2026-10-01'}));
 const client=backend({work_assignments:history,work_delays:delays}),f=fixture(['work-assignments.js'],{client});
 assert.equal((await f.ctx.loadWorkHistory('service',['case'])).length,2501);
 assert.equal((await f.ctx.loadWorkDelays(['assignment'])).length,2101);
 assert.ok(client.calls.filter(call=>call.table==='work_assignments').every(call=>call.orders.join(',')==='created_at,id'));
 assert.ok(client.calls.filter(call=>call.table==='work_delays').every(call=>call.orders.join(',')==='recorded_at,id'));
});
test('my handoffs pages a register beyond the server limit without loading its full history',async()=>{
 const rows=Array.from({length:1002},(_,i)=>({id:'h'+i,record_type:'purchase',record_id:'purchase'+i,assignee_user_id:'actor',assigned_by:'sender',status:'open',version:1,created_at:'2026-10-01T00:00:00Z',record_label:'CASE-'+i,task:'Inspect',due_on:null,expected_on:null,age_level:'red',overdue:false})),calls=[];
 const client={from(){throw Error('Unexpected full handoff/history read');},rpc:async(name,args)=>{calls.push({name,args});return {data:{rows:rows.slice(args.p_page*20,args.p_page*20+20),total:rows.length,page:args.p_page,pages:51}};}};
 const box={isConnected:true,innerHTML:'',setAttribute(){},querySelectorAll:()=>[]},target={isConnected:true,querySelector:()=>box};
 const f=fixture(['work-assignments.js'],{client,view:'personal',personalSection:'task'});
 assert.equal(await f.ctx.renderMyHandoffs(target),true);assert.match(box.innerHTML,/Work handed to me · 1002/);assert.match(box.innerHTML,/CASE-19</);assert.doesNotMatch(box.innerHTML,/CASE-20</);assert.equal(calls.length,1);assert.equal(calls[0].name,'my_handoff_page');
 assert.equal(await f.ctx.renderMyHandoffs(target,50),true);assert.match(box.innerHTML,/CASE-1001</);assert.equal(calls.length,2);
});
test('clearing handoffs while a page is pending discards the response and stops pagination',async()=>{
 let release,calls=0;const pending=new Promise(resolve=>{release=resolve});
 const f=fixture(['work-assignments.js'],{client:{from(){calls++;return {select(){return this},eq(){return this},in(){return this},order(){return this},range(){return pending}}}}});
 const loading=f.ctx.loadWorkHistory('service',['case']);f.ctx.clearWorkAssignments();release({data:Array.from({length:1000},()=>({id:'old'}))});
 assert.equal((await loading).length,0);assert.equal(calls,1);
});
test('service handoff delegates the exact permitted record to the service focus hook',async()=>{
 const seen=[],f=fixture(['work-assignments.js'],{focusServiceCase:async id=>{seen.push(id)}});
 f.ctx.countTab='count';installLeaveContext(f.ctx);await f.ctx.workOpenRecord({record_type:'service',record_id:'maintenance-case'});assert.deepEqual(seen,['maintenance-case']);assert.equal(f.ctx.view,'stockcount');
});
test('deadline requests use one bounded page and request-scoped identities',async()=>{
 const requests=Array.from({length:20},(_,i)=>({id:'r'+i,task_id:'t'+i,status:'pending'})),calls=[];
 const client={from(){throw Error('No full deadline stream');},rpc:async(name,args)=>{calls.push({name,args});return {data:{rows:requests,identities:requests.map(row=>({request_id:row.id,task_number:'TK-'+row.id,task_title:'Original task '+row.id})),total:1002,page:0,pages:51}};}};
 const f=fixture(['deadline-requests.js'],{client,teamTaskPageIds:()=>['my-task']});const rows=await f.ctx.loadDeadlineRequests();
 assert.equal(rows.length,20);assert.equal(rows.at(-1).task_title,'Original task r19');assert.equal(calls.length,1);assert.equal(calls[0].name,'deadline_request_page');assert.deepEqual(calls[0].args.p_task_ids,['my-task']);assert.equal(f.run('deadlinePageData.total'),1002);
});

test('deadline card and decision identify and escape the original task; unavailable identity prevents deciding',()=>{
 let dialog,errors=[];const f=fixture(['deadline-requests.js'],{teamTaskEpoch:1,teamTaskTime:value=>value,actionForm:(title,html)=>{dialog=html},message:text=>errors.push(text)});
 const request={id:'r',task_id:'t',requested_by:'worker',task_number:'TK-42',task_title:'Check <pump>',old_due_at:'2026-10-15',requested_due_at:'2026-10-20'};
 assert.match(f.ctx.deadlineRequestHtml(request),/TK-42 · Check &lt;pump&gt;/);f.ctx.openDeadlineDecision(request,'approved');assert.match(dialog,/TK-42 · Check &lt;pump&gt;/);assert.doesNotMatch(dialog,/<pump>/);
 dialog=null;delete request.task_title;f.ctx.openDeadlineDecision(request,'approved');assert.equal(dialog,null);assert.equal(errors.length,1);assert.match(f.ctx.deadlineRequestHtml(request),/disabled>Approve/);
});
test('deadline identity arriving after session reset is discarded',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve});
 const client=backend({team_task_reschedule_requests:[{id:'request',task_id:'task',status:'pending'}]});client.rpc=()=>pending;
 const f=fixture(['deadline-requests.js'],{client}),loading=f.ctx.loadDeadlineRequests();
 await new Promise(resolve=>setImmediate(resolve));f.ctx.clearDeadlineRequests();release({data:[{request_id:'request',task_number:'TK-1',task_title:'Old session'}]});
 assert.equal(await loading,null);assert.equal(f.run('deadlineRequests.length'),0);
});
test('deadline identity RPC preserves the request reader boundary and exposes no task details',()=>{
 const sql=read('supabase/migrations/202610160097_deadline_identity.sql');
 assert.match(sql,/returns table\(request_id uuid,task_number text,task_title text\)/);assert.match(sql,/inventory_active_staff\(\)/);
 assert.match(sql,/cardinality\(p_request_ids\) not between 1 and 100/);assert.match(sql,/r\.requested_by=auth\.uid\(\) or public\.inventory_owner\(\)/);
 assert.match(sql,/approval\.id=any\(r\.approval_task_ids\) and approval\.assignee_user_id=auth\.uid\(\)/);
 assert.doesNotMatch(sql,/alter policy|grant select|t\.details/);assert.match(sql,/revoke all.*from public,anon/);
});
