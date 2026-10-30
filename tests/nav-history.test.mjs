import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const flush=()=>new Promise(setImmediate);
function fixture(hash='#/go/service/installations'){
 const f=mainPageFixture(),renders=[];f.ctx.location.hash=hash;f.ctx.render=async()=>{renders.push(f.evaluate('view'));};f.ctx.actor=f.actor;
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
