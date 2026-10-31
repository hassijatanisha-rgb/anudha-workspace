import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../customer-returns.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(){
 const document=dom(),content=document.createElement('main');document.body.append(content);const calls=[],messages=[],scrolls=[];let callback,hook,readHook,id=0;
 const note={id:'note',delivery_number:'DN-1',status:'delivered',delivered_at:new Date().toISOString()},line={id:'line',return_id:'return',delivery_line_id:'delivery-line',product_id:'product',quantity:1,resolution:null},ret={id:'return',delivery_note_id:'note',version:1,return_number:'RT-1',category:'unopened',credit_note_draft_id:null};
 const data={returns:[ret],lines:[line],serials:[{id:'serial',delivery_note_id:'note',delivery_line_id:'delivery-line',serial_number:'SN1',returned_at:null}]};
 const c=vm.createContext({document,me:{user_id:'owner',role:'owner'},view:'sales',salesEpoch:1,salesWorkspaceRequest:1,salesLoaded:true,salesSerialsLoading:Promise.resolve(),salesDeliveryNotes:[note],deliverySerials:data.serials,inventoryLoaded:true,inventoryEpoch:7,inventoryStockPageKey:'stock',inventoryOperationsKey:'ops',inventoryStockActionsReady:true,CSS:{escape:x=>x},crypto:{randomUUID:()=> 'new-'+(++id)},askConfirm:async()=>true,$:()=>content,
 esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),salesProduct:()=>({name:'Product <name>'}),deliveryLines:()=>[{id:'delivery-line',product_id:'product',quantity:5}],deliverySerialPanelHtml:(_note,_lines,serials)=>`<div data-serial-panel="note">${serials.map(row=>row.serial_number).join(',')}</div>`,decorateReturnedSerials:()=>{},actionForm:(_title,_html,fn)=>{callback=fn},message:(...args)=>messages.push(args),run:fn=>fn(),window:{scrollX:5,scrollY:800,scrollTo:value=>scrolls.push(value)},salesDeliveryWorkspace:()=>assert.fail('No entire delivery reload'),loadInventoryOperations:()=>assert.fail('No entire inventory reload'),
 salesRowsFor:async(table,key,ids,order)=>{calls.push({table,key,ids,order});const result={data:structuredClone(table==='sales_returns'?data.returns:table==='sales_return_lines'?data.lines:data.serials)};return readHook?readHook(table,result):result},
 client:{rpc:async(name,args)=>{calls.push({name,args});if(name==='accounting_access')return {data:true};if(hook)return hook(name,args);
 if(name==='record_sales_return'){data.returns.push({...ret,id:args.p_id,return_number:'RT-2'});data.lines.push({...line,id:'new-line',return_id:args.p_id});return {data:data.returns.at(-1)}}
 if(name==='resolve_sales_return_line'){data.returns[0]={...ret,version:2};data.lines[0]={...line,resolution:args.p_resolution,resolution_note:args.p_note};return {data:data.returns[0]}}
 data.returns[0]={...ret,version:2,credit_note_draft_id:args.p_draft_id};return {data:{id:args.p_draft_id,kind:'credit_note'}};
 }}});
 vm.runInContext(source,c);c.seedReturns=data.returns.slice();c.seedLines=data.lines.slice();vm.runInContext('customerReturns=seedReturns;customerReturnLines=seedLines',c);
 content.innerHTML=`<header><input id="search"></header><article data-document-card="note">${c.returnsPanelHtml(note,data.returns,data.lines,c.me,true)}<div data-serial-panel="note">Old serials</div><div class="actions"><button>Delivery action</button></div></article><article id="other">Unchanged</article>`;
 return {c,note,line,ret,data,content,document,calls,messages,scrolls,setHook:fn=>hook=fn,setRead:fn=>readHook=fn,async open(kind){if(kind==='record')c.openRecordReturn(note);else if(kind==='inspect')c.openInspectReturnLine(line);},save:values=>callback(values)};
}
const values={category:'unopened',notes:'Accepted',qty_line:1,'qty_delivery-line':1,resolution:'restock',note:'Seal checked',confirmed:'on'};
test('record/inspection/credit refresh only returns and serial panels, preserving the delivery, shell and unrelated controls',async()=>{
 for(const kind of ['record','inspect','credit']){
  const f=fixture(),header=f.content.querySelector('header'),card=f.content.querySelector('[data-document-card]'),other=f.content.querySelector('#other'),actions=card.querySelector('.actions'),search=f.content.querySelector('#search');search.focus();
  if(kind==='credit')await f.c.createReturnCreditNote(f.ret);else{await f.open(kind);await f.save(values);}
  assert.equal(f.content.querySelector('header'),header);assert.equal(f.content.querySelector('[data-document-card]'),card);assert.equal(f.content.querySelector('#other'),other);assert.equal(card.querySelector('.actions'),actions);assert.equal(f.document.activeElement,search);
  assert.equal(f.calls.filter(x=>x.name&&x.name!=='accounting_access').length,1);assert.equal(f.calls.filter(x=>x.table).length,3);for(const call of f.calls.filter(x=>x.table))assert.deepEqual([...call.ids],call.table==='sales_return_lines'?(kind==='record'?['return','new-1']:['return']):['note']);
  if(kind!=='credit'){assert.equal(f.c.inventoryLoaded,false);assert.equal(f.c.inventoryEpoch,8);assert.equal(f.c.salesLoaded,false);}else assert.equal(f.c.inventoryEpoch,7);
  assert.ok(f.scrolls.every(value=>value.left===5&&value.top===800));assert.match(card.textContent,kind==='inspect'?/Back into stock/:kind==='credit'?/Credit Note draft created/:/RT-2/);
 }
});
test('a confirmed return with failed reads removes stale return actions and retry never repeats the write',async()=>{
 const f=fixture(),card=f.content.querySelector('[data-document-card]');f.setRead(()=>({error:{message:'Offline <now>'}}));await f.open('record');await f.save(values);
 const panel=card.querySelector('[data-returns-panel]');assert.match(panel.textContent,/Return recorded.*could not refresh.*Offline <now>/);assert.equal(panel.querySelector('[data-return-record]'),null);assert.equal(panel.querySelector('[data-return-inspect]'),null);assert.equal(panel.querySelector('[data-return-credit]'),null);assert.match(card.querySelector('[data-serial-panel]').textContent,/Refresh return details/);
 f.setRead(null);await panel.querySelector('[data-return-retry]').onclick();assert.equal(f.calls.filter(x=>x.name==='record_sales_return').length,1);assert.match(card.querySelector('[data-returns-panel]').textContent,/RT-2/);assert.equal(card.querySelector('[data-return-retry]'),null);
});
test('inspection and credit keep original version arguments and reject unverified saved versions',async()=>{
 for(const kind of ['inspect','credit']){
  const f=fixture();f.setRead((table,result)=>table==='sales_returns'?{data:[f.ret]}:result);
  if(kind==='credit')await f.c.createReturnCreditNote(f.ret);else{await f.open(kind);await f.save(values);}
  assert.equal(f.calls[0].args.p_expected_version,1);assert.match(f.content.querySelector('[role="alert"]').textContent,/saved return version could not be verified/);assert.equal(f.calls.filter(x=>x.name&&x.name!=='accounting_access').length,1);
 }
});
test('record retry retains its existing request identity and quantities, without reads after a failed write',async()=>{
 const f=fixture();await f.open('record');f.setHook(()=>({error:{message:'Connection uncertain'}}));await assert.rejects(f.save(values));assert.equal(f.calls.length,1);f.setHook(null);await f.save(values);assert.equal(f.calls[0].args.p_id,f.calls[1].args.p_id);assert.equal(f.calls[1].args.p_lines[0].deliveryLineId,'delivery-line');assert.equal(f.calls[1].args.p_lines[0].quantity,1);
});
test('old return callbacks cannot repaint another actor, route or newer workspace, including rejected network requests',async()=>{
 for(const kind of ['record','inspect','credit'])for(const mode of ['actor','route','request'])for(const outcome of ['success','error','reject']){
  const f=fixture(),wait=deferred();f.setHook(()=>wait.promise);let pending;if(kind==='credit')pending=f.c.createReturnCreditNote(f.ret);else{await f.open(kind);pending=f.save(values);}
  if(kind==='credit')await new Promise(setImmediate);
  if(mode==='actor')f.c.me={...f.c.me};else if(mode==='route')f.c.view='personal';else f.c.salesWorkspaceRequest++;
  const html=f.content.innerHTML;if(outcome==='reject')wait.reject(Error('Old network'));else wait.resolve(outcome==='error'?{error:{message:'Old error'}}:{data:{}});await pending;assert.equal(f.content.innerHTML,html);assert.equal(f.messages.length,0);assert.equal(f.calls.length,1);if(mode==='actor')assert.equal(f.c.inventoryEpoch,7);
 }
});
test('a late return read never replaces another page or publishes success',async()=>{
 const f=fixture(),wait=deferred();f.setRead((table,result)=>table==='sales_returns'?wait.promise:result);await f.open('record');const pending=f.save(values);await new Promise(resolve=>setImmediate(resolve));f.c.view='personal';f.content.innerHTML='<p>Current page</p>';wait.resolve({data:f.data.returns});await pending;assert.equal(f.content.textContent,'Current page');assert.equal(f.messages.length,0);
});

test('Credit Note draft requires explicit acceptance with a specific consequence and keeps the writer contract',async()=>{
 for(const answer of [false,true]){
  const f=fixture(),questions=[];f.c.askConfirm=async options=>{questions.push(options);return answer;};await f.c.createReturnCreditNote(f.ret);
  assert.deepEqual(JSON.parse(JSON.stringify(questions)),[{title:'Create a Credit Note draft for RT-1?',body:'The draft is priced from the original Pro forma and added to Accounting drafts for review.',confirmLabel:'Create Credit Note draft',tone:'normal'}]);
  const writes=f.calls.filter(call=>call.name==='create_return_credit_note');assert.equal(writes.length,answer?1:0);if(answer)assert.deepEqual(JSON.parse(JSON.stringify(writes[0].args)),{p_return_id:'return',p_expected_version:1,p_draft_id:'new-1'});else{assert.equal(f.calls.length,0);assert.equal(f.messages.length,0);}
 }
});

test('delayed Credit Note approval cannot act on a changed actor, route, page, panel or selected return',async()=>{
 for(const mode of ['actor','route','request','epoch','card','panel','trigger','selection','id','version','already-created']){
  const f=fixture(),wait=deferred();f.c.askConfirm=()=>wait.promise;const pending=f.c.createReturnCreditNote(f.ret);assert.equal(f.calls.length,0);
  if(mode==='actor')f.c.me={...f.c.me};else if(mode==='route')f.c.view='personal';else if(mode==='request')f.c.salesWorkspaceRequest++;else if(mode==='epoch')f.c.salesEpoch++;else if(mode==='card')f.content.querySelector('[data-document-card]').remove();else if(mode==='panel')f.content.querySelector('[data-returns-panel]').remove();else if(mode==='trigger')f.content.querySelector('[data-return-credit]').remove();else if(mode==='id')f.ret.id='other-return';else if(mode==='selection')vm.runInContext('customerReturns=customerReturns.map(row=>({...row}))',f.c);else if(mode==='version')f.ret.version++;else f.ret.credit_note_draft_id='another-draft';
  wait.resolve(true);await pending;assert.equal(f.calls.length,0,mode);assert.equal(f.messages.length,0,mode);
 }
 const f=fixture(),wait=deferred();f.c.askConfirm=()=>wait.promise;const pending=f.c.createReturnCreditNote(f.ret);wait.resolve(true);await pending;assert.equal(f.calls.filter(call=>call.name==='create_return_credit_note').length,1);
});
