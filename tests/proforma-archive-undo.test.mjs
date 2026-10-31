import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../admin-records.js',import.meta.url),'utf8');
const sales=readFileSync(new URL('../sales-delivery.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const salesHelpers=section(sales,'async function salesRowsFor(','async function loadSalesDelivery(')+section(sales,'function salesPatchStatusCard(','async function refreshDeliveryAfterStockChange(');
const run=app.split('\n').find(line=>line.startsWith('async function run('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const document=dom();document.addEventListener=()=>{};const target=document.createElement('main');target.setAttribute('id','content');document.body.append(target);
 Object.getPrototypeOf(target).removeAttribute=function(key){delete this.attrs[key]};
 target.innerHTML='<header><input id="search" value="retained"></header><article data-document-card="one"><details open><summary>History</summary>Original history</details><div class="actions"><button data-edit-proforma="one">Edit draft</button><button data-archive-business="proforma" data-id="one">Delete draft</button><button disabled>Unavailable action</button></div></article><section data-order-workflow="one"><button>Send draft</button></section><article id="other"><input value="Unrelated draft"></article>';
 let now=Date.parse('2026-10-29T10:00:00.000Z'),writeHook=null,readHook=null;
 class Clock extends Date{static now(){return now;}}
 const actor={user_id:'owner',role:'owner'},record={id:'one',document_number:'PF-1',version:3,revision:1,status:'draft',deleted_at:null,deleted_by:null,updated_at:'2026-10-28T10:00:00.000Z',total_minor:15000};
 const archived={...record,version:4,deleted_at:new Date(now).toISOString(),deleted_by:actor.user_id,updated_at:new Date(now).toISOString()};
 const restored={...record,version:5,updated_at:new Date(now+1000).toISOString()};
 const calls=[],messages=[],undos=[],scrolls=[];
 const c=vm.createContext({workspacePageHeader,document,Date:Clock,CSS:{escape:value=>value},me:actor,view:'sales',salesEditing:'',salesEpoch:1,salesWorkspaceRequest:1,sessionLoadEpoch:1,salesLoadRequest:1,salesLoaded:true,salesProformaPageKey:'page',salesDeliveryPageKey:'delivery',salesProformas:[record],salesProformaEvents:[{id:'old',proforma_id:'one'},{id:'unrelated',proforma_id:'other'}],busy:false,
  $:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),salesProforma:id=>c.salesProformas.find(row=>row.id===id),canEditRecords:()=>false,recordsLockedText:'Locked',actionForm:()=>assert.fail('Draft archive must not open a confirmation form'),
  actionFeedbackReference:node=>({node}),actionFeedbackUndo:(reference,text,duration,callback)=>{undos.push({reference,text,duration,callback});return {};},message:(text,error)=>messages.push({text,error}),friendlyError:error=>error.message,replayQueuedNavigation:()=>{},
  // Keep the real confirmed-row validator, scoped reader and card patcher. The small card
  // template isolates node retention from invoice formatting, covered by Sales tests.
  proformaCard:row=>`<article data-document-card="${row.id}"><details><summary>History</summary>Current history</details><div class="actions"><button data-edit-proforma="${row.id}">Edit draft</button><button data-archive-business="proforma" data-id="${row.id}">Delete draft</button></div></article>`,bindSalesRecordCard:()=>{},bindSalesDelivery:()=>{},orderWorkflowHtml:row=>`<section data-order-workflow="${row.id}"><button>Send restored draft</button></section>`,bindOrderWorkflow:()=>{},
  window:{scrollX:4,scrollY:650,scrollTo:value=>scrolls.push(value)},client:{rpc:async(name,args)=>{calls.push({kind:'write',name,args});return writeHook?writeHook(name,args):{data:name==='set_draft_proforma_archived'?archived:restored};},from:table=>{const args={table};const query={select:columns=>(args.columns=columns,query),eq:(column,value)=>(args.eq=[column,value],query),in:(column,values)=>(args.in=[column,values],query),order:column=>(args.order=[...(args.order||[]),column],query),range:(start,end)=>read({...args,range:[start,end]}),maybeSingle:()=>read({...args,single:true})};return query;}}
 });
 async function read(args){calls.push({kind:'read',...args});return readHook?readHook(args):{data:args.table==='sales_proformas'?archived:[{id:'archive',proforma_id:'one'},{id:'undo',proforma_id:'one'}]};}
 vm.runInContext(salesHelpers+run+source,c);
 return {c,document,target,record,archived,restored,calls,messages,undos,scrolls,now:value=>{now=value},advance:value=>{now+=value},setWrite:fn=>{writeHook=fn},setRead:fn=>{readHook=fn},open:()=>c.openArchiveBusinessRecord('proforma','one'),undo:()=>undos.at(-1).callback(),card:()=>target.querySelector('[data-document-card="one"]'),retry:()=>target.querySelector('[data-draft-archive-notice] button').onclick(),writes:()=>calls.filter(call=>call.kind==='write'),reads:()=>calls.filter(call=>call.kind==='read')};
}
test('confirmed delete is immediate, preserves unrelated nodes and offers only the original remaining Undo window',async()=>{
 const f=fixture(),card=f.card(),header=f.target.querySelector('header'),other=f.target.querySelector('#other');f.advance(2500);card.querySelector('[data-archive-business]').focus();await f.open();
 assert.equal(f.writes().length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.writes()[0])),{kind:'write',name:'set_draft_proforma_archived',args:{p_id:'one',p_archived:true,p_expected_version:3}});assert.equal(f.reads().length,0);
 assert.equal(f.card(),card);assert.equal(f.target.querySelector('header'),header);assert.equal(f.target.querySelector('#other'),other);assert.equal(other.querySelector('input').value,'Unrelated draft');assert.equal(f.target.querySelector('[data-order-workflow]').hidden,true);assert.equal(f.undos[0].duration,5500);assert.equal(f.document.activeElement,card.querySelector('[data-proforma-back]'));assert.equal(f.messages.length,0);assert.ok(f.scrolls.every(item=>item.left===4&&item.top===650));
});
test('double-clicking a pending delete issues one archive and gates its old actions',async()=>{
 const f=fixture(),wait=deferred();f.setWrite(()=>wait.promise);const pending=f.open();await f.open();assert.equal(f.writes().length,1);assert.ok(f.card().querySelectorAll('button').every(button=>button.disabled));assert.equal(f.target.querySelector('[data-order-workflow]').inert,true);wait.resolve({data:f.archived});await pending;assert.equal(f.undos.length,1);
});
test('definite rejection restores the original controls and busy state without offering Undo',async()=>{
 const f=fixture(),card=f.card(),controls=card.querySelectorAll('button'),disabled=controls.map(button=>button.disabled);f.setWrite(()=>({error:{code:'P0001',message:'Draft changed'}}));await assert.rejects(f.open(),/Draft changed/);assert.deepEqual(controls.map(button=>button.disabled),disabled);assert.equal(card.getAttribute('aria-busy'),null);assert.equal(card.draftArchiveState,null);assert.equal(f.target.querySelector('[data-order-workflow]').inert,undefined);assert.equal(f.undos.length,0);assert.equal(f.reads().length,0);
});
for(const [label,result] of [['missing response',undefined],['empty receipt',{data:null}],['incomplete receipt',{data:{id:'one'}}],['wrong actor',{data:{deleted_by:'someone'}}],['same-state receipt',{same:true}],['transport failure',{transport:true}],['unknown server failure',{error:{code:'503',message:'Unavailable'}}]])test(`${label} stays gated and checks the record without another archive`,async()=>{
 const f=fixture();f.setWrite(()=>{if(result?.transport)throw Error('Network lost');if(result?.same)return {data:{...f.archived,version:3}};if(label==='wrong actor')return {data:{...f.archived,deleted_by:'someone'}};return result;});await assert.rejects(f.open());assert.equal(f.undos.length,0);assert.equal(f.c.salesProformas[0],f.record);assert.match(f.card().textContent,/Check saved status/);assert.equal(f.card().querySelector('[data-edit-proforma]').disabled,true);
 f.advance(3000);await f.retry();assert.equal(f.writes().length,1);assert.equal(f.reads().length,1);assert.equal(f.reads()[0].table,'sales_proformas');assert.deepEqual(f.reads()[0].eq,['id','one']);assert.equal(f.undos.length,1);assert.equal(f.undos[0].duration,5000);
});
test('a read recovery never offers Undo for an unrelated later archive or an unchanged draft',async()=>{
 for(const value of ['later','unchanged']){const f=fixture();f.setWrite(()=>({data:null}));await assert.rejects(f.open());f.setRead(()=>({data:value==='later'?{...f.archived,version:6}:f.record}));await f.retry();await f.retry();assert.equal(f.writes().length,1);assert.equal(f.undos.length,0);assert.equal(f.c.salesProformas[0],f.record);assert.match(f.card().textContent,/Deletion is not confirmed/);}
});
test('an expired confirmed archive has no new Undo window, including read recovery',async()=>{
 for(const recover of [false,true]){const f=fixture();if(recover){f.setWrite(()=>({data:null}));await assert.rejects(f.open());}f.advance(8001);if(recover)await f.retry();else await f.open();assert.equal(f.undos.length,0);assert.match(f.card().textContent,/moved to Deleted Items/);assert.equal(f.writes().length,1);}
});
test('Undo uses archived version, keeps unrelated nodes and releases run while history is loading',async()=>{
 const f=fixture(),wait=deferred(),header=f.target.querySelector('header'),other=f.target.querySelector('#other');await f.c.run(f.open);assert.equal(f.c.busy,false);f.setRead(()=>wait.promise);await f.c.run(f.undo);assert.equal(f.c.busy,false);assert.equal(f.writes().length,2);assert.deepEqual(JSON.parse(JSON.stringify(f.writes()[1].args)),{p_id:'one',p_expected_version:4});assert.equal(f.reads().length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.reads()[0].in)),['proforma_id',['one']]);assert.equal(f.c.salesProformas[0].version,5);assert.match(f.card().textContent,/Draft restored. Updating its history/);assert.equal(f.card().querySelector('[data-edit-proforma]'),null);
 wait.resolve({data:[{id:'current',proforma_id:'one'}]});await settle();assert.equal(f.target.querySelector('header'),header);assert.equal(f.target.querySelector('#other'),other);assert.equal(f.card().querySelector('details').open,true);assert.equal(f.target.querySelector('[data-order-workflow]').textContent,'Send restored draft');assert.equal(f.document.activeElement,f.card().querySelector('[data-edit-proforma]'));assert.deepEqual(Array.from(f.c.salesProformaEvents,event=>event.id),['unrelated','current']);
});
test('confirmed Undo with failed history stays saved and retries only the scoped read',async()=>{
 const f=fixture();await f.open();f.setRead(()=>({error:{message:'Offline'}}));await f.undo();await settle();assert.match(f.card().textContent,/Draft restored.*history could not refresh/);assert.equal(f.card().querySelector('[data-edit-proforma]'),null);assert.equal(f.c.salesProformas[0].version,5);f.setRead(null);await f.retry();assert.equal(f.writes().length,2);assert.equal(f.reads().length,2);assert.ok(f.card().querySelector('[data-edit-proforma]'));
});
test('lost Undo response retries the original inverse proof after expiry without another archive',async()=>{
 const f=fixture();await f.open();let first=true;f.setWrite(name=>{assert.equal(name,'undo_draft_proforma_archive');if(first){first=false;throw Error('Response lost');}return {data:f.restored};});await assert.rejects(f.undo(),/Response lost/);assert.match(f.card().textContent,/Check Undo/);f.advance(9000);await f.retry();await settle();assert.deepEqual(f.writes().map(call=>call.name),['set_draft_proforma_archived','undo_draft_proforma_archive','undo_draft_proforma_archive']);assert.ok(f.writes().slice(1).every(call=>call.args.p_expected_version===4));assert.ok(f.card().querySelector('[data-edit-proforma]'));
});
test('definite expired Undo rejection offers a read-only state check',async()=>{
 const f=fixture();await f.open();f.setWrite(()=>({error:{code:'P0001',message:'Undo expired'}}));await assert.rejects(f.undo(),/Undo expired/);await f.retry();assert.equal(f.writes().length,2);assert.equal(f.reads().length,1);assert.match(f.card().textContent,/remains in Deleted Items/);assert.equal(f.card().querySelector('[data-draft-archive-notice] button'),null);
});
for(const change of ['actor','session','epoch','request','route','root','version'])test(`${change} change blocks the old Undo invocation`,async()=>{
 const f=fixture();await f.open();if(change==='actor')f.c.me={...f.c.me};if(change==='session')f.c.sessionLoadEpoch++;if(change==='epoch')f.c.salesEpoch++;if(change==='request')f.c.salesWorkspaceRequest++;if(change==='route')f.c.view='personal';if(change==='root')f.target.remove();if(change==='version')f.c.salesProformas=[{...f.archived,version:5}];await assert.rejects(f.undo(),/changed/);assert.equal(f.writes().length,1);
});
test('late Undo success or rejection cannot affect another actor, request or workspace',async()=>{
 for(const change of ['actor','request','root'])for(const rejected of [false,true]){const f=fixture(),wait=deferred();await f.open();f.setWrite(()=>wait.promise);const pending=f.undo();if(change==='actor')f.c.me={...f.c.me};if(change==='request')f.c.salesWorkspaceRequest++;if(change==='root')f.target.remove();const markup=f.target.innerHTML,messages=f.messages.length;if(rejected)wait.reject(Error('Old failure'));else wait.resolve({data:f.restored});await pending;assert.equal(f.target.innerHTML,markup);assert.equal(f.messages.length,messages);assert.equal(f.reads().length,0);}
});
test('late history failure or success cannot repaint another actor or a new request',async()=>{
 for(const change of ['actor','request'])for(const rejected of [false,true]){const f=fixture(),wait=deferred();await f.open();f.setRead(()=>wait.promise);await f.undo();if(change==='actor')f.c.me={...f.c.me};else f.c.salesWorkspaceRequest++;const markup=f.target.innerHTML,messages=f.messages.length;if(rejected)wait.reject(Error('Old history'));else wait.resolve({data:[]});await settle();assert.equal(f.target.innerHTML,markup);assert.equal(f.messages.length,messages);}
});
test('double-clicking Undo never repeats a pending inverse',async()=>{
 const f=fixture(),wait=deferred();await f.open();f.setWrite(()=>wait.promise);const pending=f.undo();await f.undo();assert.equal(f.writes().length,2);wait.resolve({data:f.restored});await pending;await settle();assert.equal(f.writes().length,2);assert.ok(f.card().querySelector('[data-edit-proforma]'));
});
test('missing or incomplete Undo receipts permit only the same original inverse proof',async()=>{
 for(const receipt of [undefined,{data:null},{data:{id:'one'}}]){const f=fixture();await f.open();f.setWrite(()=>receipt);await assert.rejects(f.undo());assert.match(f.card().textContent,/Check Undo/);assert.equal(f.c.salesProformas[0].version,4);f.setWrite(()=>({data:f.restored}));await f.retry();await settle();assert.equal(f.writes().length,3);assert.ok(f.writes().slice(1).every(call=>call.name==='undo_draft_proforma_archive'&&call.args.p_expected_version===4));}
});
test('a mismatched history result cannot expose restored draft controls',async()=>{
 const f=fixture();await f.open();f.setRead(()=>({data:[{id:'hidden',proforma_id:'other'}]}));await f.undo();await settle();assert.match(f.card().textContent,/history could not refresh/);assert.equal(f.card().querySelector('[data-edit-proforma]'),null);assert.deepEqual(Array.from(f.c.salesProformaEvents,event=>event.id),['old','unrelated']);f.setRead(null);await f.retry();assert.equal(f.writes().length,2);assert.ok(f.card().querySelector('[data-edit-proforma]'));
});
test('a late read recovery cannot publish or offer Undo in another login',async()=>{
 const f=fixture(),wait=deferred();f.setWrite(()=>({data:null}));await assert.rejects(f.open());f.setRead(()=>wait.promise);const pending=f.retry();f.c.me={...f.c.me};const markup=f.target.innerHTML;wait.resolve({data:f.archived});await pending;assert.equal(f.target.innerHTML,markup);assert.equal(f.undos.length,0);assert.equal(f.writes().length,1);
});
test('late archive and Undo responses invalidate only their own session cache after navigation',async()=>{
 for(const undo of [false,true])for(const failure of [false,true])for(const newActor of [false,true]){const f=fixture(),wait=deferred();if(undo)await f.open();f.setWrite(()=>wait.promise);const pending=undo?f.undo():f.open();f.c.view='personal';if(newActor)f.c.me={...f.c.me};f.c.salesLoaded=true;f.c.salesProformaPageKey='new-page';const markup=f.target.innerHTML;if(failure)wait.reject(Error('Lost response'));else wait.resolve({data:undo?f.restored:f.archived});await pending;assert.equal(f.c.salesLoaded,newActor);assert.equal(f.c.salesProformaPageKey,newActor?'new-page':'');assert.equal(f.target.innerHTML,markup);}
});
