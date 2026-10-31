import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const id='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const flush=()=>new Promise(setImmediate),deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const product={id,name:'Reviewed <product>',sku:'SKU',catalog_current:true,catalog_duplicate_count:1,source:{company:'Maker',sale_status:'active',category:'machines',machine_ids:[]},original:{id,name:'Raw source',sku:'SKU',revision:1,source:{raw:{Particulars:'Source'}}}};
const page=rows=>({rows,total:rows.length,page:0,pages:1,metrics:{products:rows.length,review:0,active:rows.length,manufacturers:1},category_counts:{all:rows.length},colour_counts:{ok:rows.length}});
function fixture({dirty=false,rpcs={}}={}){
 const f=mainPageFixture({rpcs:{catalog_page:args=>page(args.p_product_id?[product]:[]),...rpcs}}),loads=[],questions=[],actualSalesWorkspace=f.ctx.salesDeliveryWorkspace;
 f.ctx.actor=f.actor;f.evaluate("me=actor;view='sales';salesSection='proformas';salesEditing='';sessionLoadEpoch=1");f.document.querySelector('#nav').hidden=false;
 for(const kind of ['product','proforma','client','invoice'])f.ctx.workspaceRecordButton(kind).hidden=false;
 f.ctx.refreshNotificationBell=async()=>{};f.ctx.render=async()=>loads.push(['profile',f.evaluate('selected')]);
 f.ctx.salesDeliveryWorkspace=async()=>loads.push(['proforma',f.evaluate('salesFocusedProforma')]);
 f.ctx.booksInvoiceRecordWorkspace=async recordId=>loads.push(['invoice',recordId,f.evaluate('view'),f.evaluate('booksSection')]);
 f.ctx.askConfirm=options=>{const question=deferred();questions.push({...question,options});return question.promise;};
 if(dirty){f.document.querySelector('#content').innerHTML='<form id="proformaForm"><input name="notes" value="Original"></form>';const form=f.document.querySelector('form'),input=form.querySelector('input');input.name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Unsaved';f.evaluate("salesEditing='draft'");}
 return {...f,loads,questions,actualSalesWorkspace};
}

test('record parser accepts only exact internal UUID routes and canonicalizes invoice aliases only at the opener',async()=>{
 const f=fixture();
 for(const kind of ['client','branch','product','proforma','invoice'])assert.deepEqual({...f.ctx.workspaceRecordRoute(`#/${kind}/${id}`)},{kind,id});
 for(const hash of [`#/opening_balance/${id}`,`https://outside.invalid/#/product/${id}`,`#/product/${id}/`,`#/product/${id}?q=raw`,`#/product/${id}#extra`,'#/product/<script>','#/product/not-a-uuid',`#/staff/${id}`])assert.equal(f.ctx.workspaceRecordRoute(hash),null,hash);
 for(const kind of ['toString','constructor','staff','Product',null])assert.equal(await f.ctx.openWorkspaceRecord(kind,id),false);
 assert.equal(await f.ctx.openWorkspaceRecord('product','<script>'),false);assert.equal(f.loads.length,0);assert.equal(f.calls.length,0);
 assert.equal(await f.ctx.openWorkspaceRecord('opening_balance',id),true);assert.equal(f.ctx.location.hash,`#/invoice/${id}`);assert.deepEqual(f.loads,[['invoice',id,'books','invoices']]);
});

test('client and branch reuse the original leave context once and return true only for a committed route',async()=>{
 for(const kind of ['client','branch']){
  const f=fixture({dirty:true}),context=f.ctx.workspaceNavigationContext(),pending=f.ctx.openWorkspaceRecord(kind,id,{context});await flush();assert.equal(f.questions.length,1);f.questions[0].resolve(true);assert.equal(await pending,true);
  assert.equal(f.ctx.location.hash,`#/${kind}/${id}`);assert.equal(f.evaluate('selected'),id);assert.deepEqual(f.loads,[['profile',id]]);assert.equal(f.questions.length,1);
 }
 const f=fixture({dirty:true}),pending=f.ctx.openWorkspaceRecord('client',id);await flush();f.questions[0].resolve(false);assert.equal(await pending,false);assert.equal(f.loads.length,0);
});

test('hidden, detached and hidden-container destinations never grant record access',async()=>{
 for(const kind of ['product','proforma','client','branch','invoice','opening_balance'])for(const mode of ['hidden','detached','container']){
  const f=fixture(),button=f.ctx.workspaceRecordButton(kind==='opening_balance'?'invoice':kind);
  if(mode==='hidden')button.hidden=true;else if(mode==='detached')button.remove();else button.parentElement.hidden=true;
  assert.equal(await f.ctx.openWorkspaceRecord(kind,id),false,kind+' '+mode);assert.equal(f.calls.length,0);assert.equal(f.loads.length,0);assert.equal(f.ctx.location.hash,'');
 }
});

test('original contexts reject a same-ID actor replacement, session, source view/hash/scope, newer attempt or hidden target during confirmation',async()=>{
 const changes={actor:f=>f.evaluate('me={...me}'),session:f=>f.evaluate('sessionLoadEpoch++'),view:f=>f.evaluate("view='personal'"),scope:f=>f.evaluate("salesSection='delivery'"),hash:f=>{f.ctx.location.hash='#/go/travel';},attempt:f=>f.ctx.workspaceNavigationContext(),hidden:f=>{f.ctx.workspaceRecordButton('proforma').hidden=true;}};
 for(const [name,change]of Object.entries(changes)){
  const f=fixture({dirty:true}),context=f.ctx.workspaceNavigationContext(),pending=f.ctx.openWorkspaceRecord('proforma',id,{context});await flush();change(f);const hash=f.ctx.location.hash;f.questions[0].resolve(true);assert.equal(await pending,false,name);assert.equal(f.loads.length,0,name);assert.equal(f.ctx.location.hash,hash,name);assert.equal(f.ctx.salesEditorChanged(f.document.querySelector('form')),true,name);
 }
});

test('Pro forma routes retain register state and menu highlighting cannot replace a valid record URL',async()=>{
 const f=fixture();f.evaluate("salesProformaSearch='retained';salesProformaFilter='accepted';salesProformaPage=4");assert.equal(await f.ctx.openWorkspaceRecord('proforma',id),true);
 f.ctx.syncWorkspaceNavigation();assert.equal(f.ctx.location.hash,`#/proforma/${id}`);assert.equal(f.evaluate('salesProformaSearch'),'retained');assert.equal(f.evaluate('salesProformaFilter'),'accepted');assert.equal(f.evaluate('salesProformaPage'),4);assert.equal(f.ctx.workspaceRecordButton('proforma').getAttribute('aria-current'),'page');
 f.evaluate("salesEditing='new';salesFocusedProforma=''");f.ctx.syncWorkspaceNavigation();assert.equal(f.ctx.location.hash,'#/go/sales/proformas');
});

test('product routes use scoped authoritative detail, preserve the complete cache and close to the catalog URL',async()=>{
 const f=fixture();f.evaluate("products=[{id:'complete-cache'}]");assert.equal(await f.ctx.openWorkspaceRecord('product',id),true);
 assert.equal(f.ctx.location.hash,`#/product/${id}`);assert.equal(f.evaluate('catalogSelectedProduct'),id);assert.match(f.document.querySelector('#catalogDetail').textContent,/Reviewed <product>/);assert.equal(f.document.querySelector('#catalogDetail img'),null);
 assert.deepEqual(f.calls.filter(call=>call.name==='catalog_page').map(call=>call.args.p_product_id),[null,id]);assert.equal(f.evaluate('products[0].id'),'complete-cache');
 f.ctx.syncWorkspaceNavigation();assert.equal(f.ctx.location.hash,`#/product/${id}`);const search=f.document.querySelector('#catalogSearch');f.document.querySelector('#workbenchBack').onclick();assert.equal(f.ctx.location.hash,'#/go/inventory/catalog');assert.equal(f.document.activeElement,search);
});

test('product refresh retains the selected route while a search intentionally returns to one bounded list read',async()=>{
 const f=fixture();await f.ctx.openWorkspaceRecord('product',id);let count=f.calls.length;await f.ctx.catalogInventory();assert.equal(f.calls.length-count,2);assert.equal(f.evaluate('catalogSelectedProduct'),id);assert.equal(f.ctx.location.hash,`#/product/${id}`);
 const input=f.document.querySelector('#catalogSearch');input.value='maker';input.events.input[0].fn({target:input});assert.equal(f.ctx.location.hash,'#/go/inventory/catalog');count=f.calls.length;await f.settle();assert.equal(f.calls.length-count,1);assert.equal(f.calls.at(-1).args.p_product_id,null);
});

test('committed read errors keep escaped target error, Back and read-only Retry without retrying a financial write',async()=>{
 for(const kind of ['product','proforma','invoice','client']){
  const f=fixture();let reads=0;
  const fail=async()=>{reads++;throw Error('Offline <img onerror="x">');};
  if(kind==='product')f.ctx.catalogInventory=fail;else if(kind==='proforma')f.ctx.salesDeliveryWorkspace=fail;else if(kind==='invoice')f.ctx.booksInvoiceRecordWorkspace=fail;else f.ctx.render=fail;
  assert.equal(await f.ctx.openWorkspaceRecord(kind,id),true);assert.equal(f.ctx.location.hash,`#/${kind}/${id}`);assert.match(f.document.querySelector('#content').textContent,/Offline <img/);assert.equal(f.document.querySelector('#content img'),null);assert.ok(f.document.querySelector('#recordBack'));
  await f.document.querySelector('#recordRetry').onclick();assert.equal(reads,2);assert.equal(f.calls.length,0);
 }
});

test('late product success and failure cannot repaint after session, route or selected request changes',async()=>{
 for(const failure of [false,true])for(const change of ['actor','session','route','request','attempt']){
  const held=deferred(),f=fixture({rpcs:{catalog_page:args=>args.p_product_id?held.promise:page([])}}),opening=f.ctx.openWorkspaceRecord('product',id);await flush();await flush();
  if(change==='actor')f.evaluate('me={...me}');if(change==='session')f.evaluate('sessionLoadEpoch++');if(change==='route'){f.evaluate("view='personal'");f.ctx.location.hash='#/go/personal/task';}if(change==='request')f.evaluate('catalogRequest++');if(change==='attempt')f.ctx.workspaceNavigationContext();
  const before=f.document.querySelector('#content').innerHTML;if(failure)held.reject(Error('Late private error'));else held.resolve(page([product]));assert.equal(await opening,true);assert.equal(f.document.querySelector('#content').innerHTML,before);assert.equal(f.document.querySelector('[data-catalog-detail]'),null);
 }
});

test('authenticated invoice replay waits for the original accounting menu and rejects stale pending actors',async()=>{
 for(const stale of [false,true]){
  const f=fixture(),button=f.ctx.workspaceRecordButton('invoice');button.hidden=true;f.ctx.location.hash=`#/invoice/${id}`;const context=f.ctx.workspaceNavigationContext();f.ctx.navReplay(f.ctx.location.hash,context);await flush();assert.equal(f.evaluate('navReplayPending'),true);assert.equal(f.loads.length,0);
  if(stale)f.evaluate('me={...me}');button.hidden=false;await f.ctx.navResumePending();assert.equal(f.evaluate('navReplayPending'),false);assert.equal(f.loads.length,stale?0:1);assert.equal(f.ctx.location.hash,`#/invoice/${id}`);
 }
});

test('record bootstrap preserves the URL until authentication and original-menu permission hydration complete',async()=>{
 const f=fixture();f.evaluate('clearWorkspaceNavigation();me=null');f.ctx.location.hash=`#/invoice/${id}`;
 vm.runInContext(readFileSync(new URL('../nav-history.js',import.meta.url),'utf8').split('// Reloading the page reopens the page that was showing.')[1],f.ctx);
 assert.equal(f.evaluate('navReplayPending'),true);assert.equal(f.evaluate('navPendingContext'),null);assert.equal(f.loads.length,0);
 f.evaluate('me=actor');f.ctx.workspaceRecordButton('invoice').hidden=true;await f.ctx.navResumePending();assert.equal(f.evaluate('navReplayPending'),true);
 f.ctx.navRecordOpenPage(f.document.querySelector('[data-view="dashboard"]'));assert.equal(f.ctx.location.hash,`#/invoice/${id}`);
 f.ctx.workspaceRecordButton('invoice').hidden=false;await f.ctx.navResumePending();assert.deepEqual(f.loads,[['invoice',id,'books','invoices']]);assert.equal(f.ctx.location.hash,`#/invoice/${id}`);
});

test('a collapsed phone menu does not remove permission supplied by its original allowed button',async()=>{
 const f=fixture(),button=f.ctx.workspaceRecordButton('proforma'),panel=f.document.createElement('div');panel.id='workspaceMenuPanel';panel.hidden=true;button.parentElement.before(panel);panel.append(button.parentElement);
 assert.equal(await f.ctx.openWorkspaceRecord('proforma',id),true);assert.deepEqual(f.loads,[['proforma',id]]);
});

test('the actual Sales detail loader cannot paint a previous record after hash or authentication-epoch drift',async()=>{
 for(const change of ['hash','session','actor','attempt']){
  const f=fixture(),held=deferred();f.ctx.salesDeliveryWorkspace=f.actualSalesWorkspace;f.evaluate('listsLoaded=true;salesLoaded=false;inventoryLoaded=true');
  f.ctx.loadSalesDelivery=async()=>{await held.promise;f.evaluate('salesLoaded=true');};f.ctx.bindSalesDelivery=()=>{};
  const opening=f.ctx.openWorkspaceRecord('proforma',id);await flush();const before=f.document.querySelector('#content').innerHTML;
  if(change==='attempt')f.ctx.workspaceNavigationContext();if(change==='hash')f.ctx.location.hash=`#/proforma/${other}`;if(change==='session')f.evaluate('sessionLoadEpoch++');if(change==='actor')f.evaluate('me={...me}');held.resolve();assert.equal(await opening,true);assert.equal(f.document.querySelector('#content').innerHTML,before,change);
 }
});

test('actual unavailable Pro forma detail keeps its exact URL, existing Refresh and local Back',async()=>{
 const f=fixture();f.ctx.salesDeliveryWorkspace=f.actualSalesWorkspace;f.evaluate('listsLoaded=true;salesLoaded=true;inventoryLoaded=true;salesProformas=[]');f.ctx.bindSalesDelivery=()=>{};
 assert.equal(await f.ctx.openWorkspaceRecord('proforma',id),true);assert.equal(f.ctx.location.hash,`#/proforma/${id}`);assert.match(f.document.querySelector('#content').textContent,/unavailable or you do not have access/);assert.ok(f.document.querySelector('[data-proforma-back]'));assert.ok(f.document.querySelector('#salesRefresh'));assert.equal(f.calls.length,0);
});

test('actual product and Pro forma opener buttons run once at the UI boundary and commit their record URLs',async()=>{
 const f=fixture();f.evaluate("view='inventory';inventorySection='catalog'");f.ctx.catalogRender(page([product]));await f.document.querySelector('[data-workbench-detail]').onclick();assert.equal(f.ctx.location.hash,`#/product/${id}`);assert.equal(f.evaluate('catalogSelectedProduct'),id);assert.deepEqual(f.calls.filter(call=>call.name==='catalog_page').map(call=>call.args.p_product_id),[id]);
 const g=fixture();g.document.querySelector('#content').innerHTML=`<button data-open-proforma="${id}">Open Pro forma</button>`;g.ctx.bindSalesDelivery();await g.document.querySelector('[data-open-proforma]').onclick();assert.equal(g.ctx.location.hash,`#/proforma/${id}`);assert.deepEqual(g.loads,[['proforma',id]]);assert.equal(g.evaluate('busy'),false);
});

test('initial catalog page failure keeps a product target with Back and one read-only retry',async()=>{
 let fails=true;const f=fixture({rpcs:{catalog_page:args=>{if(fails)throw Error('Catalog temporarily unavailable');return page(args.p_product_id?[product]:[]);}}});
 assert.equal(await f.ctx.openWorkspaceRecord('product',id),true);assert.equal(f.calls.length,1);assert.equal(f.ctx.location.hash,`#/product/${id}`);assert.ok(f.document.querySelector('#recordBack'));fails=false;
 await f.document.querySelector('#recordRetry').onclick();assert.equal(f.calls.length,3);assert.equal(f.evaluate('catalogSelectedProduct'),id);
});

test('an initial catalog page response cannot overwrite a newer record hash',async()=>{
 const held=deferred(),f=fixture({rpcs:{catalog_page:()=>held.promise}}),opening=f.ctx.openWorkspaceRecord('product',id);await flush();const before=f.document.querySelector('#content').innerHTML;f.ctx.location.hash=`#/product/${other}`;held.resolve(page([]));assert.equal(await opening,true);assert.equal(f.document.querySelector('#content').innerHTML,before);assert.equal(f.calls.length,1);
});

test('actual Pro forma detail loader keeps the committing navigation sequence for palette destination focus',async()=>{
 const f=fixture();f.ctx.salesDeliveryWorkspace=f.actualSalesWorkspace;f.evaluate('listsLoaded=true;salesLoaded=true;inventoryLoaded=true;salesProformas=[]');f.ctx.bindSalesDelivery=()=>{};
 const context=f.ctx.workspaceNavigationContext(),sequence=f.evaluate('workspaceLeaveSequence');assert.equal(await f.ctx.openWorkspaceRecord('proforma',id,{context}),true);assert.equal(f.evaluate('workspaceLeaveSequence'),sequence);assert.ok(f.document.querySelector('.workspace-page-header h1'));
});
