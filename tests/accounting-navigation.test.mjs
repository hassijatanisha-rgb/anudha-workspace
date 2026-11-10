import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';

const flush=()=>new Promise(setImmediate),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({accounting=true,rpcs={},dirty=false}={}){
 const f=mainPageFixture({accounting,rpcs}),messages=[],renders=[];
 f.ctx.actor=f.actor;f.evaluate("me=actor;view='sales';salesSection='proformas';salesEditing='';sessionLoadEpoch=1");
 f.ctx.message=(text,error)=>messages.push({text,error});f.ctx.refreshNotificationBell=async()=>{};
 f.ctx.render=async()=>{f.ctx.syncWorkspaceNavigation();renders.push([f.evaluate('view'),f.evaluate('booksSection')]);};
 const nav=f.document.querySelector('#nav'),button=nav.querySelector('[data-view="books"]');nav.hidden=false;button.hidden=false;
 if(dirty){f.document.querySelector('#content').innerHTML='<form id="proformaForm"><input name="notes" value="Original"></form>';const form=f.document.querySelector('form'),input=form.querySelector('input');input.name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Unsaved';f.evaluate("salesEditing='draft'");}
 return {...f,nav,button,messages,renders,press:()=>f.ctx.navigateWorkspace(button)};
}

test('one Accounting entry checks current permission and opens the native overview',async()=>{
 const f=fixture();assert.equal(f.nav.querySelectorAll('[data-accounting-only]').length,1);assert.equal(f.button.textContent,'Accounting');assert.equal(f.button.dataset.workspaceSection,'overview');
 await f.press();assert.deepEqual(f.calls.map(call=>call.name),['accounting_access']);assert.deepEqual(f.renders,[['books','overview']]);assert.equal(f.ctx.location.hash,'#/go/books/overview');assert.equal(f.button.getAttribute('aria-current'),'page');
});

test('all internal accounting modules use their existing canonical routes and the same permission anchor',async()=>{
 const f=fixture(),sections=[...f.evaluate('booksSections').map(([key])=>key),'forms'];
 for(const section of sections){await f.ctx.openAccountingSection(section);assert.equal(f.evaluate('view'),section==='forms'?'accounting':'books');if(section!=='forms')assert.equal(f.evaluate('booksSection'),section);assert.equal(f.ctx.location.hash,section==='forms'?'#/go/accounting':`#/go/books/${section}`);assert.equal(f.button.getAttribute('aria-current'),'page');}
 assert.equal(f.calls.length,sections.length);assert.ok(f.calls.every(call=>call.name==='accounting_access'));
 const before=f.ctx.location.hash;await f.ctx.openAccountingSection('not-a-module');assert.equal(f.ctx.location.hash,before);assert.equal(f.calls.length,sections.length);
});

test('legacy module hashes wait for permission hydration and replay their own section rather than overview',async()=>{
 const f=fixture(),sections=[...f.evaluate('booksSections').map(([key])=>key),'forms'];
 for(const section of sections){
  const hash=section==='forms'?'#/go/accounting':`#/go/books/${section}`;f.button.hidden=true;f.ctx.location.hash=hash;const count=f.renders.length;f.ctx.navReplay(hash);await flush();assert.equal(f.renders.length,count);assert.equal(f.evaluate('navReplayPending'),true);
  f.button.hidden=false;await f.ctx.navResumePending();assert.equal(f.evaluate('view'),section==='forms'?'accounting':'books');if(section!=='forms')assert.equal(f.evaluate('booksSection'),section);assert.equal(f.ctx.location.hash,hash);assert.equal(f.evaluate('navReplayPending'),false);
 }
});

test('section sync preserves an invoice editor draft and selected transaction while recording the actual module',()=>{
 const f=fixture();f.evaluate("view='books';booksSection='invoices';booksDraft={proformaId:'original'};booksTransactionSelected='selected'");const draft=f.evaluate('booksDraft');
 f.ctx.syncWorkspaceNavigation();assert.equal(f.ctx.location.hash,'#/go/books/invoices');assert.equal(f.evaluate('booksDraft'),draft);assert.equal(f.evaluate('booksTransactionSelected'),'selected');
 f.ctx.location.hash='#/invoice/10000000-0000-4000-8000-000000000001';f.ctx.syncWorkspaceNavigation();assert.equal(f.ctx.location.hash,'#/invoice/10000000-0000-4000-8000-000000000001');assert.equal(f.evaluate('booksDraft'),draft);
});

test('internal accounting section changes keep the existing leave guards and discard cancellation',async()=>{
 const f=fixture({dirty:true});f.ctx.askConfirm=async()=>false;await f.ctx.openAccountingSection('receipts');assert.equal(f.calls.length,0);assert.deepEqual(f.renders,[]);assert.equal(f.ctx.salesEditorChanged(f.document.querySelector('form')),true);assert.equal(f.evaluate('view'),'sales');
 f.ctx.askConfirm=async()=>true;await f.ctx.openAccountingSection('receipts');assert.deepEqual(f.renders,[['books','receipts']]);assert.equal(f.ctx.location.hash,'#/go/books/receipts');
 for(const setup of ["booksSection='import';financialImportState={preview:{},uncertain:true}","booksSection='opening';openingReceivablesState={preview:{},busy:true}","booksSection='invoices';returnCreditPostingState={uncertain:true}"]){const g=fixture();g.evaluate("view='books';"+setup);await g.ctx.openAccountingSection('overview');assert.equal(g.calls.length,0);assert.deepEqual(g.renders,[]);}
});

test('denied, malformed and failed accounting permission checks cannot change the native route',async()=>{
 for(const permission of [false,null,'true']){const f=fixture({accounting:permission});await f.press();assert.deepEqual(f.renders,[]);assert.equal(f.evaluate('view'),'sales');assert.equal(f.ctx.location.hash,'');assert.match(f.messages.at(-1).text,/restricted to approved financial users/);}
 const failed=fixture({rpcs:{accounting_access:()=>{throw Error('Unavailable');}}});await failed.press();assert.deepEqual(failed.renders,[]);assert.match(failed.messages.at(-1).text,/could not be verified/);
 const errored=fixture();errored.ctx.__client.rpc=async()=>({data:true,error:{message:'Unavailable'}});await errored.press();assert.deepEqual(errored.renders,[]);assert.match(errored.messages.at(-1).text,/could not be verified/);
});

test('old permission results cannot navigate after source identity, route, attempt or anchor changes',async()=>{
 const changes={actor:f=>f.evaluate('me={...me}'),logout:f=>f.evaluate('me=null'),session:f=>f.evaluate('sessionLoadEpoch++'),view:f=>f.evaluate("view='personal'"),scope:f=>f.evaluate("salesSection='delivery'"),hash:f=>{f.ctx.location.hash='#/go/travel';},attempt:f=>f.ctx.workspaceNavigationContext(),hidden:f=>{f.button.hidden=true;},disabled:f=>{f.button.disabled=true;},nav:f=>{f.nav.hidden=true;},group:f=>{f.button.closest('.nav-group').hidden=true;},detached:f=>f.button.remove()};
 for(const [name,change]of Object.entries(changes)){const held=deferred(),f=fixture({rpcs:{accounting_access:()=>held.promise}}),opening=f.ctx.openAccountingSection('journal');await flush();assert.equal(f.calls.length,1,name);change(f);held.resolve(true);await opening;assert.deepEqual(f.renders,[],name);}
 const held=deferred(),f=fixture({rpcs:{accounting_access:()=>held.promise}}),opening=f.press();await flush();f.evaluate('me={...me}');held.reject(Error('Old failure'));await opening;assert.deepEqual(f.renders,[]);assert.equal(f.messages.filter(message=>message.error).length,0);
});

test('hidden, disabled and disconnected anchors cannot open accounting from an internal link',async()=>{
 for(const change of [f=>{f.button.hidden=true;},f=>{f.button.disabled=true;},f=>{f.nav.hidden=true;},f=>{f.button.closest('.nav-group').hidden=true;},f=>f.button.remove(),f=>f.evaluate('me=null')]){const f=fixture();change(f);await f.ctx.openAccountingSection('receipts');assert.equal(f.calls.length,0);assert.deepEqual(f.renders,[]);}
});

test('captured sidebar clicks accept only their own temporary feedback disable',async()=>{
 const held=deferred(),f=fixture({rpcs:{accounting_access:()=>held.promise}}),event={target:{closest:()=>f.button},eventPhase:1,preventDefault(){},stopImmediatePropagation(){}};
 const listeners=f.document.body.events.click,feedback=listeners.find(listener=>String(listener.fn).includes('actionFeedbackEvent=capture')).fn,navigate=listeners.find(listener=>String(listener.fn).includes('return navigateWorkspace(button)')).fn;
 feedback(event);const opening=navigate(event);await flush();assert.equal(f.button.disabled,true);assert.equal(f.button.getAttribute('aria-busy'),'true');event.eventPhase=0;held.resolve(true);await opening;assert.deepEqual(f.renders,[['books','overview']]);assert.equal(f.button.disabled,false);
});

test('busy internal section navigation queues the exact requested module and keeps its caller context',async()=>{
 const f=fixture(),held=deferred(),work=f.ctx.run(()=>held.promise),context=f.ctx.workspaceNavigationContext();await f.ctx.openAccountingSection('reports',{context});assert.equal(f.calls.length,0);assert.equal(f.evaluate('navWhileBusy.button'),f.button);assert.equal(f.evaluate('navWhileBusy.accountingSection'),'reports');assert.equal(f.evaluate('navWhileBusy.context'),context);
 held.resolve();await work;await flush();assert.deepEqual(f.renders,[['books','reports']]);assert.equal(f.ctx.location.hash,'#/go/books/reports');assert.equal(f.evaluate('navWhileBusy'),null);
});

function shellOrigin(f,kind){
 f.evaluate("view='books';booksSection='overview'");const epoch=f.evaluate('booksEpoch'),root=f.document.querySelector('#content');root.innerHTML=f.ctx.accountingShell('<p>Overview</p>','overview');
 const control=root.querySelector(kind==='picker'?'[data-accounting-picker]':'[data-accounting-section="journal"]');if(kind==='picker')control.value='overview';f.ctx.bindAccountingShell(()=>f.evaluate('booksEpoch')===epoch);
 return {control,press:()=>{if(kind==='picker'){control.value='journal';return control.onchange();}return control.onclick();}};
}
for(const kind of ['button','picker'])test(`shell ${kind} retains its origin guard through deferred accounting permission`,async()=>{
 for(const change of ['unchanged','epoch','detached']){
  const held=deferred(),f=fixture({rpcs:{accounting_access:()=>held.promise}}),origin=shellOrigin(f,kind),opening=origin.press();await flush();assert.equal(f.calls.length,1);
  if(change==='epoch')f.evaluate('booksEpoch++');if(change==='detached')origin.control.remove();held.resolve(true);await opening;
  assert.deepEqual(f.renders,change==='unchanged'?[['books','journal']]:[],change);assert.equal(f.evaluate('booksSection'),change==='unchanged'?'journal':'overview');
 }
});
for(const kind of ['button','picker'])test(`busy shell ${kind} replays only while its original control and render remain current`,async()=>{
 for(const change of ['unchanged','epoch','detached']){
  const f=fixture(),origin=shellOrigin(f,kind),held=deferred(),work=f.ctx.run(()=>held.promise);await origin.press();assert.equal(f.calls.length,0);assert.equal(f.evaluate('navWhileBusy.accountingSection'),'journal');
  if(change==='epoch')f.evaluate('booksEpoch++');if(change==='detached')origin.control.remove();held.resolve();await work;await flush();
  assert.deepEqual(f.renders,change==='unchanged'?[['books','journal']]:[],change);assert.equal(f.calls.length,change==='unchanged'?1:0);assert.equal(f.evaluate('navWhileBusy'),null);
 }
});
