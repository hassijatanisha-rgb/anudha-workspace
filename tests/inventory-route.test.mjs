import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const profiles=readFileSync(new URL('../client-profile-pages.js',import.meta.url),'utf8');
function fixture(hash, signedIn=true){
 const events={},renders=[];
 const context=vm.createContext({location:{hash},document:{querySelector(){},addEventListener(){}},window:{addEventListener:(name,fn)=>events[name]=fn}});
 vm.runInContext(app.slice(0,app.indexOf('let orgIndex=')),context);
 vm.runInContext(profiles,context);
 context.render=()=>renders.push(vm.runInContext('view',context));
 vm.runInContext(`me=${signedIn?"{user_id:'fixture'}":"null"}`,context);
 return {context,events,renders,read:expression=>vm.runInContext(expression,context)};
}
test('inventory URL restores inventory at startup, including trailing slash',()=>{
 for(const hash of ['#/inventory','#/inventory/'])assert.equal(fixture(hash).read('view'),'inventory');
});
test('back navigation to inventory does not render client directory',()=>{
 const f=fixture('#/clients');f.context.location.hash='#/inventory';f.events.hashchange();
 assert.equal(f.read('view'),'inventory');assert.deepEqual(f.renders,['inventory']);
});
test('profile routes and unknown-route fallback remain client views',()=>{
 for(const hash of ['#/clients','#/client/example','#/branch/example','#/unknown','']){
  const f=fixture(hash);assert.equal(f.read('view'),'contacts');f.events.hashchange();
  assert.equal(f.read('view'),'contacts');
 }
});
test('inventory hash does not render protected content without a session',()=>{
 const f=fixture('#/clients',false);f.context.location.hash='#/inventory';f.events.hashchange();
 assert.deepEqual(f.renders,[]);
});
