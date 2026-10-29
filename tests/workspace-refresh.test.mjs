import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function fixture(){
 const nodes=[],listeners=new Map(),classes=new Set();
 const target={get children(){return nodes;},firstChild:null,attrs:{},classList:{add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle:(n,on)=>on?classes.add(n):classes.delete(n)},getAttribute(n){return this.attrs[n]??null;},setAttribute(n,v){this.attrs[n]=v;},removeAttribute(n){delete this.attrs[n];},replaceChildren(node){this.firstChild=node;nodes.splice(0,nodes.length,node);},querySelectorAll(tag){return nodes.filter(n=>n.tagName?.toLowerCase()===tag);},contains(node){return nodes.includes(node);}};
 const body={isConnected:true},document={body,activeElement:body,querySelector:()=>target,createElement:tag=>({tagName:tag.toUpperCase(),setAttribute(){}}),addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}};
 const window={scrollX:0,scrollY:600,addEventListener(){},removeEventListener(){},scrollTo({left,top}){this.scrollX=left;this.scrollY=top;}};
 const ctx=vm.createContext({document,window,me:{user_id:'a'},view:'inventory',inventorySection:'stock'});vm.runInContext(source,ctx);
 const render=node=>{target.replaceChildren(node);document.activeElement=body;window.scrollY=0;};
 const button=id=>({tagName:'BUTTON',id,dataset:{},isConnected:true,focus(){document.activeElement=this;},closest(){return null;}});
 return {ctx,target,document,window,render,button,classes,run:fn=>ctx.workspaceRefreshRun(fn,null,[])};
}
test('same-screen refresh retains live DOM during fetch, then uses fresh markup and restores focus and scroll',async()=>{
 const f=fixture(),first=f.button('refresh');await f.run(()=>{f.ctx.workspaceLoading('Loading…');f.render(first);});
 f.document.activeElement=first;f.window.scrollY=600;const waiting=defer(),next=f.button('refresh');
 const pending=f.run(async()=>{f.ctx.workspaceLoading('Loading…');await waiting.promise;f.render(next);});
 assert.equal(f.target.firstChild,first);assert.equal(f.target.attrs['aria-busy'],'true');assert.equal(f.classes.has('workspace-refreshing'),true);assert.equal(first.inert,true);
 waiting.resolve();await pending;assert.equal(f.target.firstChild,next);assert.equal(f.document.activeElement,next);assert.equal(f.window.scrollY,600);assert.equal(f.target.attrs['aria-busy'],undefined);
});
test('section and actor changes show first-load state and never restore the prior page position',async()=>{
 for(const change of [f=>f.ctx.inventorySection='locations',f=>f.ctx.me={user_id:'b'}]){
  const f=fixture();await f.run(()=>f.render(f.button('old')));change(f);const waiting=defer();
  const pending=f.run(async()=>{f.ctx.workspaceLoading('Loading current page…');await waiting.promise;f.render(f.button('new'));});
  assert.equal(f.target.firstChild.tagName,'P');assert.equal(f.classes.has('workspace-first-load'),true);waiting.resolve();await pending;assert.equal(f.window.scrollY,0);
 }
});
test('failed refresh leaves readable data and clears busy state; a late prior actor cannot restore position',async()=>{
 const f=fixture(),first=f.button('refresh');await f.run(()=>f.render(first));
 await assert.rejects(f.run(async()=>{f.ctx.workspaceLoading('Loading…');throw Error('offline');}),/offline/);
 assert.equal(f.target.firstChild,first);assert.equal(f.target.attrs['aria-busy'],undefined);
 const waiting=defer(),pending=f.run(async()=>{f.ctx.workspaceLoading('Loading…');await waiting.promise;});f.ctx.me={user_id:'b'};f.window.scrollY=123;waiting.resolve();await pending;assert.equal(f.window.scrollY,123);
});
test('a newer refresh owns cleanup when an older request completes',async()=>{
 const f=fixture();await f.run(()=>f.render(f.button('refresh')));const first=defer(),second=defer();
 const one=f.run(async()=>{f.ctx.workspaceLoading('Loading…');await first.promise;});
 const two=f.run(async()=>{f.ctx.workspaceLoading('Loading…');await second.promise;f.render(f.button('new'));});
 first.resolve();await one;assert.equal(f.target.attrs['aria-busy'],'true');second.resolve();await two;assert.equal(f.target.firstChild.id,'new');assert.equal(f.target.attrs['aria-busy'],undefined);assert.equal(f.target.inert,undefined);
});

test('replacing retained children leaves a new route interactive and reset removes stale busy state',async()=>{
 const f=fixture(),first=f.button('refresh');await f.run(()=>f.render(first));const waiting=defer();
 const pending=f.run(async()=>{f.ctx.workspaceLoading('Loading…');await waiting.promise;});
 const login=f.button('login');f.render(login);f.ctx.view='settings';f.ctx.syncWorkspaceRefresh();
 assert.equal(login.inert,undefined);assert.equal(first.inert,undefined);assert.equal(f.target.attrs['aria-busy'],undefined);
 waiting.resolve();await pending;assert.equal(f.target.firstChild,login);
});
