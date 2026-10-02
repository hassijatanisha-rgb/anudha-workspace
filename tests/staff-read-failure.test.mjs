import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function fixture(result,twoStep=false,throws=false){
 const events=[],nodes=new Map();
 const ctx=vm.createContext({me:{user_id:'previous'},message(){},$:key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'old',hidden:false});return nodes.get(key)},
  clear(){events.push('clear');ctx.me=null},login(){events.push('login');ctx.me=null},
  twoStepNeeded:async()=>twoStep,showTwoStepPrompt(){events.push('two-step')},
  loadEmployeeNames:async()=>{events.push('load-data');throw Error('fixture authenticated boundary')},
  client:{auth:{getUser:async()=>({data:{user:{id:'actor'}}}),signOut:async()=>{events.push('sign-out')}},
   from:table=>{events.push(table);const reply=async()=>{if(throws)throw result;return result};return {select:()=>({eq:()=>({single:reply,maybeSingle:reply})})}}}
 });
 vm.runInContext(app.slice(app.indexOf('async function load()'),app.indexOf('function missingAccount')),ctx);
 return {ctx,events,nodes};
}
test('staff lookup timeout blocks data without signing out or claiming membership revoked',async()=>{
 const f=fixture({error:{code:'57014',message:'statement timeout'}});
 await assert.rejects(f.ctx.load(),/Could not verify staff access.*statement timeout/);
 assert.equal(f.ctx.me,null);assert.equal(f.events.includes('sign-out'),false);assert.equal(f.events.includes('load-data'),false);
 assert.equal(f.nodes.get('#content').innerHTML,'');
});
test('missing and inactive staff remain denied and signed out',async()=>{
 for(const data of [null,{user_id:'actor',active:false}]){
  const f=fixture({data,error:null});await assert.rejects(f.ctx.load(),/not on the active staff list/);
  assert.equal(f.events.includes('sign-out'),true);assert.equal(f.events.includes('load-data'),false);assert.equal(f.ctx.me,null);
 }
});
test('transport rejection clears stale workspace without revoking login or loading data',async()=>{
 const f=fixture(Error('Network unavailable'),false,true);
 await assert.rejects(f.ctx.load(),/Could not verify staff access.*Network unavailable/);
 assert.equal(f.ctx.me,null);assert.equal(f.nodes.get('#content').innerHTML,'');
 assert.equal(f.events.includes('sign-out'),false);assert.equal(f.events.includes('load-data'),false);
});
test('two-step challenge happens before any staff or business query',async()=>{
 const f=fixture({data:{active:true}},true);await f.ctx.load();assert.deepEqual(f.events,['two-step']);
});
test('confirmed active membership reaches existing data loader',async()=>{
 const data={user_id:'actor',role:'staff',active:true},f=fixture({data,error:null});
 await assert.rejects(f.ctx.load(),/fixture authenticated boundary/);assert.equal(f.ctx.me,data);assert.equal(f.events.includes('sign-out'),false);
});
test('returned authentication transport errors clear stale data without querying staff',async()=>{
 const f=fixture({data:{active:true}});
 f.ctx.client.auth.getUser=async()=>({data:{user:null},error:{message:'Failed to fetch'}});
 await assert.rejects(f.ctx.load(),/Could not verify your session.*Failed to fetch/);
 assert.equal(f.ctx.me,null);assert.equal(f.nodes.get('#content').innerHTML,'');
 assert.deepEqual(f.events,['clear']);
});
test('thrown authentication transport errors clear stale data without querying staff',async()=>{
 const f=fixture({data:{active:true}});
 f.ctx.client.auth.getUser=async()=>{throw Error('Network unavailable')};
 await assert.rejects(f.ctx.load(),/Could not verify your session.*Network unavailable/);
 assert.equal(f.ctx.me,null);assert.equal(f.nodes.get('#content').innerHTML,'');
 assert.deepEqual(f.events,['clear']);
});
test('confirmed absence of session still opens login without staff query',async()=>{
 const f=fixture({data:{active:true}});
 f.ctx.client.auth.getUser=async()=>({data:{user:null},error:null});
 await f.ctx.load();assert.deepEqual(f.events,['login']);
});
test('SDK missing-session error still opens login',async()=>{
 const f=fixture({data:{active:true}});
 f.ctx.client.auth.getUser=async()=>({data:{user:null},error:{name:'AuthSessionMissingError',message:'Auth session missing!'}});
 await f.ctx.load();assert.deepEqual(f.events,['login']);
});
