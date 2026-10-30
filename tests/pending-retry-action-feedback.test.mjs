import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.js'),runtime=source('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(){
 const document=dom(),proto=Object.getPrototypeOf(document.body),matches=proto.matches,listeners={};
 proto.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()))};
 proto.removeAttribute=function(key){delete this.attrs[key]};proto.prepend=function(node){this.insertBefore(node,this.children[0]||null)};
 proto.getBoundingClientRect=()=>({left:40,top:40,bottom:84,width:180,height:44});proto.getClientRects=function(){return this.isConnected?[{}]:[]};
 Object.defineProperties(proto,{className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},classList:{get(){return {add:name=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' ')},remove:name=>{this.className=this.className.split(' ').filter(value=>value!==name).join(' ')},contains:name=>this.className.split(' ').includes(name)}}},style:{get(){return this._style??={}}}});
 document.addEventListener=(type,handler)=>(listeners[type]??=[]).push(handler);document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};
 document.body.innerHTML='<div id="notice"></div><main id="content"></main>';
 const calls=[],timers=new Map();let timer=0,read;
 const c=vm.createContext({statusTone,document,me:{user_id:'owner',role:'owner'},view:'pending',busy:false,employeeDirectory:new Map(),getComputedStyle:()=>({visibility:'visible'}),window:{addEventListener(){},scrollX:0,scrollY:120,scrollTo(){}},setTimeout:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer},clearTimeout:id=>timers.delete(id),$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),client:{rpc:async(name,args)=>{assert.equal(name,'pending_stock_page','Retry can only reread the bounded register');calls.push({name,args});return read();}},all:()=>assert.fail('Retry must not reload complete collections')});
 installPageHeader(c);vm.runInContext(runtime+'\n'+source('pending-stock.js'),c);
 const page={rows:[],total:0,page:0,pages:1,as_of:c.pendingToday(),availability_error:false,mine_arrived:0,counts:{all:0,waiting:0,arrived:0,mine:0,due:0,closed:0}};
 c.initial=page;vm.runInContext("pendingPageData=initial;pendingRegisterError='Earlier read failed';renderPendingStock()",c);read=()=>({data:page});
 const node=selector=>document.querySelector(selector),click=button=>{const event={target:button,eventPhase:1};for(const handler of listeners.click||[])handler(event);try{return button.onclick();}finally{event.eventPhase=0;}};
 return {c,document,calls,page,node,click,setRead:fn=>read=fn,get:code=>vm.runInContext(code,c)};
}

test('Pending register Retry runs its real bounded read once despite the shared runner disabling its origin',async()=>{
 const f=fixture(),button=f.node('#pendingRetryRegister'),search=f.node('#pendingSearch'),filter=f.node('[data-pending-filter="waiting"]'),wait=deferred();f.setRead(()=>wait.promise);button.focus();
 const pending=f.click(button);assert.equal(f.calls.length,1);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.textContent,'Retry register refresh');await f.click(button);assert.equal(f.calls.length,1);
 wait.resolve({data:f.page});await pending;assert.equal(f.node('#pendingRegisterNotice').textContent,'');assert.equal(f.node('#pendingSearch'),search);assert.equal(f.node('[data-pending-filter="waiting"]'),filter);assert.equal(f.document.activeElement,f.node('#pendingPageStatus'));assert.equal(f.c.busy,false);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{p_query:'',p_filter:'waiting',p_page:0,p_salesperson_ids:[]});
});
test('a failed register retry keeps Saved feedback and a usable replacement Retry, then succeeds without a write',async()=>{
 const f=fixture(),button=f.node('#pendingRetryRegister');f.setRead(()=>({error:{message:'Still offline'}}));button.focus();await f.click(button);
 const retry=f.node('#pendingRetryRegister');assert.equal(f.calls.length,1);assert.notEqual(retry,button);assert.equal(retry.disabled,false);assert.equal(f.document.activeElement,retry);assert.match(f.node('#pendingRegisterNotice').textContent,/Saved, but the register could not refresh: Still offline/);
 f.setRead(()=>({data:f.page}));await f.click(retry);assert.equal(f.calls.length,2);assert.equal(f.node('#pendingRegisterNotice').textContent,'');assert.equal(f.document.activeElement,f.node('#pendingPageStatus'));
});
test('disabled or busy Retry never reads, and an accepted later attempt remains usable',async()=>{
 const f=fixture(),button=f.node('#pendingRetryRegister');button.disabled=true;await f.click(button);assert.equal(f.calls.length,0);button.disabled=false;f.c.busy=true;await f.click(button);assert.equal(f.calls.length,0);assert.equal(button.disabled,false);assert.match(f.document.body.textContent,/Another action is still running/);
 f.c.busy=false;await f.click(button);assert.equal(f.calls.length,1);assert.equal(f.node('#pendingRegisterNotice').textContent,'');
});
test('stale actor, route and render epoch prevent Retry reads and suppress late success or error',async()=>{
 for(const change of ['actor','route','epoch'])for(const stage of ['before','success','error']){
  const f=fixture(),button=f.node('#pendingRetryRegister'),wait=deferred(),notice=f.node('#pendingRegisterNotice').textContent;f.setRead(()=>wait.promise);
  const stale=()=>{if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='reports';else f.get('pendingRenderEpoch++');};
  if(stage==='before')stale();const pending=f.click(button);
  if(stage==='before'){await pending;assert.equal(f.calls.length,0);continue;}
  assert.equal(f.calls.length,1);stale();if(stage==='success')wait.resolve({data:f.page});else wait.reject(Error('Old error'));await pending;
  assert.equal(f.node('#pendingRetryRegister'),button);assert.equal(f.node('#pendingRegisterNotice').textContent,notice);assert.equal(f.get('pendingRegisterError'),'Earlier read failed');assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);
 }
});
