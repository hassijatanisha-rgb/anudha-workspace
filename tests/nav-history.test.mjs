import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fixture(hash='#/go/service/installations'){
 const location={hash},clicks=[],listeners={};
 const buttons=[['service','installations'],['dashboard',''],['books','invoices']].map(([view,section])=>({dataset:{view,...(section?{workspaceSection:section}:{})},hidden:view==='books',isConnected:true,click(){clicks.push(view);listeners.click?.({target:{closest:()=>this}});}}));
 const c=vm.createContext({location,me:null,busy:false,navWhileBusy:null,message(){},friendlyError:e=>e.message,window:{addEventListener(){}},
  document:{querySelectorAll(selector){return selector.includes('data-accounting-only')?[buttons[2]]:buttons.filter(button=>selector.includes(`"${button.dataset.view}"`));},querySelector:()=>null,addEventListener(name,fn){listeners[name]=fn;}},
  history:{pushState(_state,_title,hash){location.hash=hash;},replaceState(_state,_title,hash){location.hash=hash;}},
  setTimeout(){throw Error('Navigation must wait for readiness, not retry timers.');}});
 vm.runInContext(read('nav-history.js'),c);
 for(const prefix of ['async function run(','function replayQueuedNavigation('])vm.runInContext(read('app.js').split('\n').find(line=>line.startsWith(prefix)),c);
 return {c,location,buttons,clicks,get:code=>vm.runInContext(code,c)};
}
test('a deep link survives an unfinished bootstrap and resumes once busy is released',async()=>{
 const {c,location,buttons,clicks,get}=fixture();let finish;
 const loading=c.run(()=>new Promise(resolve=>{finish=resolve;}));
 c.navRecordOpenPage(buttons[1]);
 assert.equal(location.hash,'#/go/service/installations');assert.equal(get('navReplayPending'),true);assert.deepEqual(clicks,[]);
 c.me={user_id:'actor'};c.navResumePending();assert.deepEqual(clicks,[]);
 finish();await loading;assert.deepEqual(clicks,['service']);assert.equal(get('navReplayPending'),false);
 c.replayQueuedNavigation();assert.deepEqual(clicks,['service']);
});
test('a deferred accounting deep link resumes when accounting access reveals its button',async()=>{
 const {c,clicks}=fixture('#/go/books/invoices');
 c.me={user_id:'actor'};c.navResumePending();assert.deepEqual(clicks,[]);
 c.client={rpc:async()=>({data:true})};
 const source=read('workspace-navigation.js');
 vm.runInContext(source.slice(source.indexOf('async function showAccountingNavigation()'),source.indexOf('let navWhileBusy=')),c);
 await c.showAccountingNavigation();assert.deepEqual(clicks,['books']);
});
test('an explicit queued menu choice takes precedence over the startup deep link',async()=>{
 const {c,buttons,clicks,location,get}=fixture();let finish;
 const loading=c.run(()=>new Promise(resolve=>{finish=resolve;}));
 c.navWhileBusy=buttons[1];c.me={user_id:'actor'};finish();await loading;
 assert.deepEqual(clicks,['dashboard']);assert.equal(location.hash,'#/go/dashboard');assert.equal(get('navReplayPending'),false);
 c.navResumePending();assert.deepEqual(clicks,['dashboard']);
});
