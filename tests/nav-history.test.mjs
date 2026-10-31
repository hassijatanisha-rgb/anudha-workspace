import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const flush=()=>new Promise(setImmediate);
function fixture(hash='#/go/service/installations',options={}){
 const f=mainPageFixture(options),renders=[];f.ctx.location.hash=hash;f.ctx.render=async()=>{renders.push(f.evaluate('view'));};f.ctx.actor=f.actor;
 f.evaluate(`view='dashboard';navLastHash=${JSON.stringify(hash)};me=null;navReplay(${JSON.stringify(hash)},null)`);
 const buttons=[['service','installations'],['dashboard',''],['books','invoices']].map(([view,section])=>f.document.querySelectorAll('[data-view]').find(button=>button.dataset.view===view&&(button.dataset.workspaceSection||'')===section));
 buttons[0].hidden=buttons[1].hidden=false;
 return {...f,renders,buttons};
}
test('a deep link survives an unfinished bootstrap and resumes once busy is released',async()=>{
 const f=fixture();let finish;const loading=f.ctx.run(()=>new Promise(resolve=>{finish=resolve;}));
 f.ctx.navRecordOpenPage(f.buttons[1]);assert.equal(f.ctx.location.hash,'#/go/service/installations');assert.equal(f.evaluate('navReplayPending'),true);assert.deepEqual(f.renders,[]);
 f.evaluate('me=actor');await f.ctx.navResumePending();assert.deepEqual(f.renders,[]);
 finish();await loading;await flush();assert.deepEqual(f.renders,['service']);assert.equal(f.evaluate('navReplayPending'),false);
 f.ctx.replayQueuedNavigation();await flush();assert.deepEqual(f.renders,['service']);
});
test('a deferred accounting deep link resumes when accounting access reveals its button',async()=>{
 const f=fixture('#/go/books/invoices');f.evaluate('me=actor');await f.ctx.navResumePending();assert.deepEqual(f.renders,[]);
 await f.ctx.showAccountingNavigation();await flush();assert.deepEqual(f.renders,['books']);assert.equal(f.evaluate('booksSection'),'invoices');
});
test('an explicit queued menu choice takes precedence over the startup deep link',async()=>{
 const f=fixture();let finish;const loading=f.ctx.run(()=>new Promise(resolve=>{finish=resolve;}));
 f.evaluate('me=actor');await f.ctx.navigateWorkspace(f.buttons[1]);finish();await loading;await flush();
 assert.deepEqual(f.renders,['dashboard']);assert.equal(f.ctx.location.hash,'#/go/dashboard');assert.equal(f.evaluate('navReplayPending'),false);
 await f.ctx.navResumePending();assert.deepEqual(f.renders,['dashboard']);
});


function beginBootstrap(f){
 let release;const user=new Promise(resolve=>{release=resolve;});f.ctx.__client.auth.getUser=()=>user;
 const loading=f.ctx.run(f.ctx.load);
 return {loading,finish:()=>release({data:{user:{id:f.actor.user_id,user_metadata:{}}}}),signedOut:()=>release({data:{user:null}})};
}

test('pre-auth hash change to Stock survives actual load actor hydration and replays once after bootstrap',async()=>{
 const f=fixture('#/go/dashboard');f.evaluate('me=undefined');const boot=beginBootstrap(f);f.ctx.location.hash='#/go/inventory/stock';await Promise.all([f.ctx.navHistoryChanged(),f.ctx.navHistoryChanged()]);assert.equal(f.evaluate('busy'),true);assert.equal(f.evaluate('navPendingContext'),null);assert.deepEqual(f.renders,[]);
 boot.finish();await boot.loading;await f.settle();assert.deepEqual(f.renders,['dashboard','inventory']);assert.equal(f.evaluate('view'),'inventory');assert.equal(f.evaluate('inventorySection'),'stock');assert.equal(f.ctx.location.hash,'#/go/inventory/stock');assert.equal(f.evaluate('navReplayPending'),false);f.ctx.replayQueuedNavigation();await flush();assert.deepEqual(f.renders,['dashboard','inventory']);
});

test('multiple pre-auth route changes coalesce to the final destination before actual bootstrap completes',async()=>{
 const f=fixture('#/go/dashboard'),boot=beginBootstrap(f),pending=[];
 for(const hash of ['#/go/travel','#/go/service/installations','#/go/inventory/stock']){f.ctx.location.hash=hash;pending.push(f.ctx.navHistoryChanged(),f.ctx.navHistoryChanged());}
 await Promise.all(pending);assert.deepEqual(f.renders,[]);boot.finish();await boot.loading;await f.settle();assert.deepEqual(f.renders,['dashboard','inventory']);assert.equal(f.ctx.location.hash,'#/go/inventory/stock');assert.equal(f.evaluate('navPendingHash'),'');
});

test('pre-auth queued accounting destination still waits for access and pins the authenticated actor',async()=>{
 for(const changedActor of [false,true]){const f=fixture('#/go/dashboard',{accounting:false}),boot=beginBootstrap(f);f.ctx.location.hash='#/go/books/invoices';await f.ctx.navHistoryChanged();boot.finish();await boot.loading;await f.settle();assert.deepEqual(f.renders,['dashboard']);assert.equal(f.evaluate('navReplayPending'),true);assert.equal(f.buttons[2].hidden,true);if(changedActor)f.evaluate('me={...me}');f.buttons[2].hidden=false;await f.ctx.navResumePending();await flush();assert.deepEqual(f.renders,changedActor?['dashboard']:['dashboard','books']);assert.equal(f.evaluate('navReplayPending'),false);}
});

test('sign-out and session clearing discard pre-auth queued destinations before late bootstrap can replay',async()=>{
 for(const clear of [false,true]){const f=fixture('#/go/dashboard'),boot=beginBootstrap(f);f.ctx.location.hash='#/go/inventory/stock';await f.ctx.navHistoryChanged();if(clear){f.ctx.clearCoreSession();boot.finish();}else boot.signedOut();await boot.loading;await f.settle();assert.deepEqual(f.renders,[]);assert.equal(f.evaluate('navReplayPending'),false);assert.equal(f.evaluate('me')==null,true);f.evaluate('me=actor');await f.ctx.navResumePending();assert.deepEqual(f.renders,[]);}
});
