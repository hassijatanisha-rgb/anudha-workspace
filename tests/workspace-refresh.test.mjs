import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function fixture(){
 const nodes=[],listeners=new Map(),classes=new Set(),windowListeners=new Map(),observers=[],timers=new Map();let timerId=0;
 const target={get children(){return nodes;},firstChild:null,attrs:{},classList:{add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle:(n,on)=>on?classes.add(n):classes.delete(n)},getAttribute(n){return this.attrs[n]??null;},setAttribute(n,v){this.attrs[n]=v;},removeAttribute(n){delete this.attrs[n];},replaceChildren(node){this.firstChild=node;nodes.splice(0,nodes.length,node);},querySelectorAll(tag){return nodes.filter(n=>n.tagName?.toLowerCase()===tag);},contains(node){return nodes.includes(node);}};
 const body={isConnected:true},document={body,documentElement:{style:{overflowAnchor:''}},activeElement:body,querySelector:()=>target,createElement:tag=>({tagName:tag.toUpperCase(),setAttribute(){}}),addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}};
 const window={innerWidth:1200,innerHeight:660,scrollX:0,scrollY:600,addEventListener:(type,fn)=>windowListeners.set(type,fn),removeEventListener:(type,fn)=>{if(windowListeners.get(type)===fn)windowListeners.delete(type);},scrollTo({left,top}){this.scrollX=left;this.scrollY=top;}};
 const ctx=vm.createContext({document,window,MutationObserver:class{constructor(fn){this.notify=fn;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),me:{user_id:'a'},view:'inventory',inventorySection:'stock'});vm.runInContext(source,ctx);
 const render=node=>{target.replaceChildren(node);document.activeElement=body;window.scrollY=0;};
 const button=id=>({tagName:'BUTTON',id,dataset:{},isConnected:true,focus(){document.activeElement=this;},closest(){return null;}});
 return {ctx,target,document,window,render,button,classes,observers,timers,windowListeners,run:fn=>ctx.workspaceRefreshRun(fn,null,[])};
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
  assert.equal(f.target.firstChild.tagName,'DIV');assert.match(f.target.firstChild.innerHTML,/workspace-skeleton/);assert.equal(f.classes.has('workspace-first-load'),true);waiting.resolve();await pending;assert.equal(f.window.scrollY,0);
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

test('refresh anchors the same line while late record panels arrive and releases on user input',async()=>{
 for(const type of ['wheel','touchstart','keydown','mousedown']){
  const f=fixture(),record={tagName:'ARTICLE',innerText:'Packing in progress',dataset:{documentCard:'00000000-0000-4000-8000-000000000001'},y:500},line={tagName:'P',innerText:'Packing in progress',dataset:{},parentElement:record,y:820};
  record.parentElement=f.target;record.querySelectorAll=()=>[line];record.getBoundingClientRect=()=>({top:record.y-f.window.scrollY});line.getBoundingClientRect=()=>({top:line.y-f.window.scrollY});f.target.contains=node=>node===record||node===line;f.document.elementFromPoint=()=>line;
  await f.run(()=>f.render(record));f.window.scrollY=600;const next={...record},nextLine={...line,parentElement:next};next.querySelectorAll=()=>[nextLine];next.getBoundingClientRect=()=>({top:next.y-f.window.scrollY});nextLine.getBoundingClientRect=()=>({top:nextLine.y-f.window.scrollY});
  await f.run(()=>{next.y=200;nextLine.y=520;f.render(next);});assert.equal(f.window.scrollY,300);assert.equal(f.document.documentElement.style.overflowAnchor,'none');
  next.y=500;nextLine.y=820;const observer=f.observers.at(-1);observer.notify();assert.equal(f.window.scrollY,600);assert.equal(nextLine.getBoundingClientRect().top,220);
  f.windowListeners.get(type)();f.window.scrollY=123;nextLine.y=1000;observer.notify();assert.equal(f.window.scrollY,123);assert.equal(observer.connected,false);assert.equal(f.document.documentElement.style.overflowAnchor,'');assert.equal(f.timers.size,0);
 }
});

test('late anchoring releases on expiry, actor, route, target replacement and session cleanup',async()=>{
 for(const reason of ['expiry','actor','route','target','clear']){
  const f=fixture();f.document.documentElement.style.overflowAnchor='auto';await f.run(()=>f.render(f.button('old')));f.window.scrollY=600;await f.run(()=>f.render(f.button('new')));const observer=f.observers.at(-1);
  if(reason==='expiry')[...f.timers.values()][0]();if(reason==='actor')f.ctx.me={user_id:'b'};if(reason==='route')f.ctx.inventorySection='locations';if(reason==='target')f.target.firstChild=f.button('replacement');if(reason==='clear')f.ctx.clearWorkspaceRefresh();
  f.window.scrollY=70;observer.notify();assert.equal(f.window.scrollY,70);assert.equal(observer.connected,false);assert.equal(f.document.documentElement.style.overflowAnchor,'auto');
 }
});

test('continued scrolling cancels a hold without a new pointer event',async()=>{
 for(const first of ['scroll','mutation']){const f=fixture();await f.run(()=>f.render(f.button('old')));f.window.scrollY=450;await f.run(()=>f.render(f.button('new')));const observer=f.observers.at(-1);
 f.windowListeners.get('scroll')();assert.equal(observer.connected,true,'our own scroll keeps the hold');f.window.scrollY=300;if(first==='scroll')f.windowListeners.get('scroll')();observer.notify();assert.equal(f.window.scrollY,300);assert.equal(observer.connected,false);}
});

test('replaced content root during refresh cannot take scroll or install a late observer',async()=>{
 const f=fixture();await f.run(()=>f.render(f.button('old')));const wait=defer(),pending=f.run(async()=>{await wait.promise;f.render(f.button('new'));});f.document.querySelector=()=>({});wait.resolve();await pending;assert.equal(f.window.scrollY,0);assert.equal(f.observers.length,0);assert.equal(f.document.documentElement.style.overflowAnchor,'');
});
