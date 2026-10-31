import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};};
function fixture(hashes=['#/go/sales/proformas'],index=hashes.length-1,{dirty=false}={}){
 const f=mainPageFixture(),renders=[],questions=[],entries=hashes.map((hash,index)=>({hash,state:{erp:1,erpNavigationIndex:index,erpNavigationBranch:'test-history',kept:'metadata-'+index}})),goCalls=[];let cursor=index;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const history={get state(){return entries[cursor].state;},pushState(state,_,hash){entries.splice(cursor+1);entries.push({hash,state:clone(state)});cursor++;f.ctx.location.hash=hash;},replaceState(state,_,hash){entries[cursor]={hash,state:clone(state)};f.ctx.location.hash=hash;},go(delta){goCalls.push(delta);assert.ok(cursor+delta>=0&&cursor+delta<entries.length,'Restoration cursor is in range');setImmediate(()=>{cursor+=delta;f.ctx.location.hash=entries[cursor].hash;events();});}};
 let branchSequence=0;f.ctx.crypto.randomUUID=()=> 'fresh-history-'+(++branchSequence);f.ctx.history=history;f.ctx.location.hash=entries[cursor].hash;f.ctx.actor=f.actor;f.evaluate(`me=actor;view='sales';salesSection='proformas';salesEditing='';navLastHash=location.hash;navHistoryBranch='test-history';navLastIndex=${index}`);
 f.ctx.render=async()=>renders.push(f.evaluate('view'));f.ctx.askConfirm=options=>{const question=deferred();questions.push({...question,options});return question.promise;};
 function events(){return Promise.all([f.ctx.navHistoryChanged(),f.ctx.navHistoryChanged()]);}
 function move(delta){cursor+=delta;assert.ok(cursor>=0&&cursor<entries.length);f.ctx.location.hash=entries[cursor].hash;return events();}
 if(dirty){f.document.querySelector('#content').innerHTML='<form id="proformaForm"><input name="notes" value="Original"></form>';const form=f.document.querySelector('#proformaForm'),input=form.querySelector('input');input.name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Unsaved';f.evaluate("salesEditing='draft'");}
 const button=f.document.querySelector('[data-view="service"]');button.hidden=false;
 return {...f,renders,questions,entries,goCalls,history,move,events,button,cursor:()=>cursor};
}
const drifts={actor:f=>f.evaluate('me={...me}'),session:f=>f.evaluate('sessionLoadEpoch++'),view:f=>f.evaluate("view='personal'"),scope:f=>f.evaluate("salesSection='delivery'"),hash:f=>{f.ctx.location.hash='#/go/settings';},attempt:f=>f.ctx.workspaceNavigationContext()};

test('queued menu replay rejects every source-context drift, hidden and detached destinations',async()=>{
 for(const [name,change]of Object.entries({...drifts,hidden:f=>{f.button.hidden=true;},detached:f=>f.button.remove()})){
  const f=fixture(),held=deferred(),loading=f.ctx.run(()=>held.promise);await f.ctx.navigateWorkspace(f.button);assert.equal(f.evaluate('navWhileBusy.button'),f.button,name);
  change(f);const hash=f.ctx.location.hash;held.resolve();await loading;await flush();assert.deepEqual(f.renders,[],name);assert.equal(f.ctx.location.hash,hash,name);assert.equal(f.evaluate('navWhileBusy'),null,name);
 }
});

test('deferred authenticated history replay rejects actor, session, source scope, hash and newer attempt drift',async()=>{
 for(const [name,change]of Object.entries(drifts)){
  const f=fixture(),held=deferred(),loading=f.ctx.run(()=>held.promise);f.history.pushState({erp:1,erpNavigationIndex:1,erpNavigationBranch:'test-history'},'','#/go/service/installations');await f.events();assert.equal(f.evaluate('navReplayPending'),true,name);
  change(f);const hash=f.ctx.location.hash;held.resolve();await loading;await flush();assert.deepEqual(f.renders,[],name);assert.equal(f.ctx.location.hash,hash,name);assert.equal(f.evaluate('navReplayPending'),false,name);
 }
});

test('a newer queued destination replaces the previous choice and retains its own context',async()=>{
 const f=fixture(),held=deferred(),loading=f.ctx.run(()=>held.promise);await f.ctx.navigateWorkspace(f.button);const travel=f.document.querySelector('[data-view="travel"]');await f.ctx.navigateWorkspace(travel);held.resolve();await loading;await flush();assert.deepEqual(f.renders,['travel']);assert.equal(f.ctx.location.hash,'#/go/travel');
});

for(const direction of ['Back','Forward'])test(`declined ${direction} restores the cursor without replacing either history entry`,async()=>{
 const backward=direction==='Back',f=fixture(backward?['#/go/travel','#/go/sales/proformas']:['#/go/sales/proformas','#/go/travel'],backward?1:0,{dirty:true}),before=JSON.stringify(f.entries),pending=f.move(backward?-1:1);await flush();assert.equal(f.questions.length,1);
 f.questions[0].resolve(false);await pending;await flush();assert.equal(f.cursor(),backward?1:0);assert.equal(JSON.stringify(f.entries),before);assert.equal(f.ctx.location.hash,'#/go/sales/proformas');assert.equal(f.evaluate('view'),'sales');assert.equal(f.document.querySelector('input').value,'Unsaved');assert.equal(f.questions.length,1);assert.deepEqual(f.goCalls,[backward?1:-1]);assert.deepEqual(f.renders,[]);
});

test('rapid Back attempts coalesce their events and only the newest decline restores the current page',async()=>{
 const f=fixture(['#/go/travel','#/go/service/schedule','#/go/sales/proformas'],2,{dirty:true}),before=JSON.stringify(f.entries),first=f.move(-1);await flush();const second=f.move(-1);await flush();assert.equal(f.questions.length,2);
 f.questions[0].resolve(false);await first;assert.deepEqual(f.goCalls,[]);f.questions[1].resolve(false);await second;await flush();assert.deepEqual(f.goCalls,[2]);assert.equal(f.cursor(),2);assert.equal(JSON.stringify(f.entries),before);assert.equal(f.questions.length,2);assert.deepEqual(f.renders,[]);
});

test('traversing back to an earlier identical URL supersedes the old prompt and updates its cursor anchor',async()=>{
 const f=fixture(['#/go/travel','#/go/sales/proformas','#/go/service/schedule','#/go/sales/proformas'],3,{dirty:true}),old=f.move(-1);await flush();await f.move(-1);f.questions[0].resolve(false);await old;assert.equal(f.evaluate('navLastIndex'),1);assert.deepEqual(f.goCalls,[]);
 const next=f.move(-1);await flush();f.questions[1].resolve(false);await next;await flush();assert.deepEqual(f.goCalls,[1]);assert.equal(f.cursor(),1);
});

test('client/profile pushes share indexed history and declined Back preserves the profile destination',async()=>{
 const f=fixture();await f.ctx.goProfile('client','client-1');assert.equal(f.history.state.erpNavigationIndex,1);assert.equal(f.history.state.kept,'metadata-0');await f.ctx.navigateWorkspace(f.document.querySelector('[data-view="sales"][data-workspace-section="proformas"]'));assert.equal(f.history.state.erpNavigationIndex,2);
 f.document.querySelector('#content').innerHTML='<form id="proformaForm"><input name="notes" value="Original"></form>';const form=f.document.querySelector('#proformaForm');form.querySelector('input').name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);form.querySelector('input').value='Unsaved';const before=JSON.stringify(f.entries),pending=f.move(-1);await flush();f.questions[0].resolve(false);await pending;await flush();assert.equal(f.cursor(),2);assert.equal(JSON.stringify(f.entries),before);assert.equal(f.entries[1].hash,'#/client/client-1');
});

test('declined legacy history preserves its unindexed destination rather than overwriting it',async()=>{
 const f=fixture(['#/go/travel','#/go/sales/proformas'],1,{dirty:true});f.entries[0].state={legacy:'retained'};const pending=f.move(-1);await flush();f.questions[0].resolve(false);await pending;await flush();assert.deepEqual(f.entries[0],{hash:'#/go/travel',state:{legacy:'retained'}});assert.equal(f.ctx.location.hash,'#/go/sales/proformas');assert.equal(f.cursor(),1);assert.deepEqual(f.goCalls,[]);
});


test('accepted or declined legacy boundaries never reuse invalid distances to older indexed entries',async()=>{
 for(const accept of [false,true]){
  const f=fixture(['#/go/travel','#/client/legacy','#/go/sales/proformas'],2,{dirty:true});f.entries[1].state={legacy:'retained'};const pending=f.move(-1);await flush();f.questions[0].resolve(accept);await pending;await flush();assert.deepEqual(f.goCalls,[]);
  // Reopen the same dirty Sales form on the current branch without changing history.
  f.evaluate("view='sales';salesSection='proformas';salesEditing='draft'");const form=f.document.querySelector('#proformaForm');form.dataset.initialState='older';const amount=accept?-1:-2,next=f.move(amount);await flush();const question=f.questions.at(-1);question.resolve(false);await next;await flush();assert.deepEqual(f.goCalls,[]);assert.equal(f.entries[0].hash,'#/go/travel');assert.equal(f.entries[0].state.erpNavigationBranch,'test-history');
 }
});

test('a history answer that became stale cannot restore or commit a different session or source',async()=>{
 for(const [name,change]of Object.entries(drifts)){
  const f=fixture(['#/go/travel','#/go/sales/proformas'],1,{dirty:true}),before=JSON.stringify(f.entries),pending=f.move(-1);await flush();change(f);const hash=f.ctx.location.hash;f.questions[0].resolve(false);await pending;await flush();assert.deepEqual(f.goCalls,[],name);assert.deepEqual(f.renders,[],name);assert.equal(JSON.stringify(f.entries),before,name);assert.equal(f.ctx.location.hash,hash,name);
 }
});

test('unresolved accounting posting rejects traversal and restores its cursor without a discard prompt',async()=>{
 for(const setup of ["booksSection='import';financialImportState={uncertain:true}","booksSection='opening';openingReceivablesState={busy:true}","booksSection='invoices';returnCreditPostingState={uncertain:true}"]){
  const f=fixture(['#/go/travel','#/go/books/import'],1);f.evaluate("view='books';"+setup);const before=JSON.stringify(f.entries);await f.move(-1);await flush();assert.deepEqual(f.goCalls,[1]);assert.equal(f.cursor(),1);assert.equal(JSON.stringify(f.entries),before);assert.equal(f.questions.length,0);assert.deepEqual(f.renders,[]);
 }
});

for(const direction of ['Back','Forward'])test(`declined ${direction} to a record URL restores indexed history without overwriting either record`,async()=>{
 const record='#/proforma/10000000-0000-4000-8000-000000000001',other='#/invoice/20000000-0000-4000-8000-000000000002',backward=direction==='Back',f=fixture(backward?[other,record]:[record,other],backward?1:0,{dirty:true});
 const before=JSON.stringify(f.entries),pending=f.move(backward?-1:1);await flush();assert.equal(f.questions.length,1);f.questions[0].resolve(false);await pending;await flush();
 assert.equal(f.cursor(),backward?1:0);assert.equal(JSON.stringify(f.entries),before);assert.equal(f.ctx.location.hash,record);assert.deepEqual(f.goCalls,[backward?1:-1]);assert.equal(f.document.querySelector('input').value,'Unsaved');
});

test('accepted history traversal reopens the exact Pro forma once without another discard prompt or list URL rewrite',async()=>{
 const id='10000000-0000-4000-8000-000000000001',hash='#/proforma/'+id,f=fixture([hash,'#/go/sales/proformas'],1,{dirty:true}),opened=[];
 f.document.querySelector('#nav').hidden=false;f.ctx.salesDeliveryWorkspace=async()=>{opened.push(f.evaluate('salesFocusedProforma'));f.ctx.syncWorkspaceNavigation();};f.ctx.refreshNotificationBell=async()=>{};
 const before=JSON.stringify(f.entries),pending=f.move(-1);await flush();f.questions[0].resolve(true);await pending;await flush();assert.deepEqual(opened,[id]);assert.equal(f.questions.length,1);assert.equal(f.ctx.location.hash,hash);assert.equal(JSON.stringify(f.entries),before);assert.equal(f.cursor(),0);
});
