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
 const input=(id,type='search')=>{
  let inert=false;const node={...button(id),tagName:'INPUT',type,value:'abcdef',selectionStart:type==='number'?null:0,selectionEnd:type==='number'?null:0,selectionDirection:'none',scrollLeft:0,selectionCalls:0,
   focus(){if(inert)return;document.activeElement=this;listeners.get('focusin')?.();},
   setSelectionRange(start,end,direction){assert.notEqual(this.type,'number');this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;this.selectionCalls++;}};
  Object.defineProperty(node,'inert',{get:()=>inert,set:value=>{inert=value;if(value&&document.activeElement===node)document.activeElement=body;}});return node;
 };
 return {ctx,target,document,window,render,button,input,classes,observers,timers,windowListeners,run:fn=>ctx.workspaceRefreshRun(fn,null,[])};
}
test('same-screen refresh retains live DOM during fetch, then uses fresh markup and restores focus and scroll',async()=>{
 const f=fixture(),first=f.button('refresh');await f.run(()=>{f.ctx.workspaceLoading('Loading…');f.render(first);});
 f.document.activeElement=first;f.window.scrollY=600;const waiting=defer(),next=f.button('refresh');
 const pending=f.run(async()=>{f.ctx.workspaceLoading('Loading…');await waiting.promise;f.render(next);});
 assert.equal(f.target.firstChild,first);assert.equal(f.target.attrs['aria-busy'],'true');assert.equal(f.classes.has('workspace-refreshing'),true);assert.equal(first.inert,true);
 waiting.resolve();await pending;assert.equal(f.target.firstChild,next);assert.equal(f.document.activeElement,next);assert.equal(f.window.scrollY,600);assert.equal(f.target.attrs['aria-busy'],undefined);
});
test('async refresh preserves text/search selection direction and horizontal scroll after inert blurs the field',async()=>{
 for(const type of ['text','search']){
  const f=fixture(),first=f.input('query',type);await f.run(()=>f.render(first));first.focus();first.setSelectionRange(2,5,'backward');first.scrollLeft=17;
  const waiting=defer(),next=f.input('query',type),pending=f.run(async()=>{await waiting.promise;f.render(next);});
  assert.equal(f.document.activeElement,f.document.body,'inert removes the active search before the response');waiting.resolve();await pending;
  assert.equal(f.document.activeElement,next);assert.deepEqual([next.selectionStart,next.selectionEnd,next.selectionDirection,next.scrollLeft],[2,5,'backward',17]);
 }
});
test('typing one character after each async refresh appends instead of reversing the query',async()=>{
 const f=fixture();let input=f.input('query');input.value='';await f.run(()=>f.render(input));input.focus();
 for(const character of 'hospital'){
  input.value=input.value.slice(0,input.selectionStart)+character+input.value.slice(input.selectionEnd);input.setSelectionRange(input.selectionStart+1,input.selectionStart+1,'none');
  const next=f.input('query');next.value=input.value;await f.run(async()=>{await Promise.resolve();f.render(next);});input=next;
 }
 assert.equal(input.value,'hospital');assert.equal(input.selectionStart,8);assert.equal(input.selectionEnd,8);
});
test('refresh resolves a search by data attribute and skips unsupported or changed input values',async()=>{
 for(const mode of ['data','number','changed-type','changed-value']){
  const f=fixture(),first=f.input(mode==='data'?'':'query',mode==='number'?'number':'search'),next=f.input(first.id,['number','changed-type'].includes(mode)?'number':'search');
  if(mode==='data'){first.dataset={priceSearch:''};next.dataset={priceSearch:''};}
  if(mode==='changed-value')next.value='new query';await f.run(()=>f.render(first));first.focus();if(mode!=='number')first.setSelectionRange(2,4,'backward');first.scrollLeft=17;
  await f.run(async()=>{await Promise.resolve();f.render(next);});assert.equal(f.document.activeElement,next);
  if(mode==='data')assert.deepEqual([next.selectionStart,next.selectionEnd,next.scrollLeft],[2,4,17]);else {assert.equal(next.selectionCalls,0);assert.equal(next.scrollLeft,0);}
 }
});
test('refresh does not replace a newer focused selection or take focus from another field',async()=>{
 for(const mode of ['selection','typed','inside','outside']){
  const f=fixture(),first=f.input('query'),next=f.input('query'),other=f.input('other');await f.run(()=>f.render(first));first.focus();first.setSelectionRange(2,5,'backward');first.scrollLeft=17;
  const pending=f.run(async()=>{
   await Promise.resolve();f.render(next);
   if(mode==='inside')f.target.children.push(other);
   if(['inside','outside'].includes(mode))other.focus();else{next.focus();if(mode==='typed')next.value='new query';next.setSelectionRange(1,3,'forward');next.scrollLeft=9;}
   await Promise.resolve();
  });await pending;
  if(['inside','outside'].includes(mode)){assert.equal(f.document.activeElement,other);assert.equal(next.selectionCalls,0);}
  else {assert.equal(f.document.activeElement,next);assert.deepEqual([next.selectionStart,next.selectionEnd,next.selectionDirection,next.scrollLeft],[1,3,'forward',9]);}
 }
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
