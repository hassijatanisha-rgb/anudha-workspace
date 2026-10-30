import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installStockTransition} from './helpers/stock-transition.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const response=(query='Fi',count=1)=>({query,groups:Object.fromEntries([['clients','client'],['products','product'],['proformas','proforma'],['invoices','invoice']].map(([key,kind],index)=>[key,{available:true,has_more:count===5,rows:Array.from({length:count},(_,n)=>({id:id(100*index+n),title:`${key} ${n}`,subtitle:'Fictional record',kind}))}]))});
function fixture({phone=false,reduced=false}={}){
 const document=dom(),proto=Object.getPrototypeOf(document.body),events=new Map(),windowEvents=new Map(),timers=new Map(),observers=[],animations=[],calls=[],opens=[];let now=0,timerId=0,exit=null;
 Object.defineProperties(proto,{
  id:{get(){return this.attrs.id||'';},set(value){this.attrs.id=value;}},className:{get(){return this.attrs.class||'';},set(value){this.attrs.class=value;}},type:{get(){return this.attrs.type||'';},set(value){this.attrs.type=value;}},
  style:{get(){return this._style??={setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}};}},
  classList:{get(){return {add:token=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),token])].join(' ');},remove:token=>{this.className=this.className.split(' ').filter(value=>value!==token).join(' ');},contains:token=>this.className.split(' ').includes(token)};}}
 });
 const matches=proto.matches;proto.matches=function(selector){if(selector.includes(','))return selector.split(',').some(value=>this.matches(value.trim()));if(selector.includes(':disabled')){if(!this.disabled)return false;selector=selector.replace(':disabled','');}return matches.call(this,selector);};
 proto.removeAttribute=function(name){delete this.attrs[name];};proto.prepend=function(node){this.insertBefore(node,this.firstElementChild);};
 proto.getBoundingClientRect=()=>({left:20,top:20,right:580,bottom:420,width:560,height:400});proto.getClientRects=function(){return this.isConnected?[{}]:[];};
 proto.scrollIntoView=function(options){this.scrolled=options;};
 proto.animate=function(frames,options){const wait=frames.at(-1).opacity===0&&exit?exit:deferred();if(wait!==exit)wait.resolve();const animation={node:this,frames,options,finished:wait.promise,cancel:()=>wait.reject(Error('Cancelled'))};animations.push(animation);return animation;};
 proto.getAnimations=function(){return animations.filter(animation=>animation.node===this);};
 proto.fire=function(type,extra={}){const event={target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const {fn}of this.events[type]||[])fn(event);return event;};
 document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};
 document.addEventListener=(type,fn)=>{if(!events.has(type))events.set(type,[]);events.get(type).push(fn);};
 document.body.innerHTML='<header><div id="identity"><button id="howToUse">Help</button></div></header><main><div id="notice"></div><section id="content"><input id="draft" value="Typed draft"><button id="destination">Destination</button></section></main>';
 const node=selector=>document.querySelector(selector),session={user_id:id(900)},ctx=vm.createContext({document,$:node,me:session,sessionLoadEpoch:7,view:'personal',scope:'task',location:{hash:'#/go/personal/task'},busy:false,workspaceLeaveSequence:0,navWhileBusy:null,
  financialImportIsPosting:()=>false,openingReceivablesState:null,returnCreditPostingState:null,
  workspaceRefreshScope:()=>JSON.stringify([ctx.view,ctx.scope]),friendlyError:error=>error.message,replayQueuedNavigation(){},
  getComputedStyle:()=>({opacity:'1',transform:'none',visibility:'visible',getPropertyValue:key=>({'--m-base':'200ms','--m-slow':'300ms','--m-fade':'150ms','--ease-in':'ease-out','--ease-out':'ease-in'}[key])}),
  matchMedia:query=>({matches:query.includes('reduced-motion')?reduced:phone}),
  setTimeout(fn,delay){const key=++timerId;timers.set(key,{fn,at:now+delay});return key;},clearTimeout:key=>timers.delete(key),
  addEventListener(type,fn){if(!windowEvents.has(type))windowEvents.set(type,new Set());windowEvents.get(type).add(fn);},removeEventListener(type,fn){windowEvents.get(type)?.delete(fn);},
  MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:response(args.p_query)};}},
  openWorkspaceRecord:async(kind,key,options)=>{opens.push({kind,id:key,...options});return false;}
 });ctx.window=ctx;
 for(const file of ['ui-dialogs.js','action-feedback.js','global-search.js'])vm.runInContext(read(file),ctx);
 installStockTransition(ctx);const navigation=read('workspace-navigation.js');vm.runInContext(navigation.slice(navigation.indexOf('function workspaceNavigationContext()'),navigation.indexOf('async function confirmWorkspaceLeave')),ctx);
 const records=read('record-navigation.js');vm.runInContext(records.slice(records.indexOf('function workspaceRecordRoute('),records.indexOf('function workspaceRecordButton(')),ctx);
 const app=read('app.js');vm.runInContext(app.split('\n').find(line=>line.startsWith('async function run(')),ctx);ctx.message=(text,error)=>ctx.actionFeedbackMessage(text,error);
 const get=code=>vm.runInContext(code,ctx);
 const key=(key,extra={})=>{const event={key,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const fn of events.get('keydown')||[])fn(event);return event;};
 const advance=async ms=>{now+=ms;for(const [key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}await flush();};
 const open=()=>{ctx.installWorkspaceSearch();node('#workspaceSearch').focus();ctx.openWorkspaceSearch(node('#workspaceSearch'));return node('dialog.workspace-search');};
 const type=(value,extra={})=>{const input=node('input[role="combobox"]');input.value=value;input.fire('input',extra);return input;};
 const click=node=>node.onclick({preventDefault(){},stopPropagation(){}});
 const ready=async()=>{open();type('Fi');await advance(250);};
 return {ctx,get,node,document,events,windowEvents,observers,animations,calls,opens,session,open,type,key,advance,click,ready,exit:wait=>exit=wait,mutate(fn){fn();observers.filter(observer=>observer.active).forEach(observer=>observer.fn());},hash(){for(const fn of windowEvents.get('hashchange')||[])fn();}};
}

test('explicit idempotent installation adds signed-in header trigger before Help and one shortcut listener; no eager data',()=>{
 const f=fixture();assert.equal(f.node('#workspaceSearch'),null);assert.equal(f.events.get('keydown'),undefined);f.ctx.installWorkspaceSearch();f.ctx.installWorkspaceSearch();assert.equal(f.events.get('keydown').length,1);assert.equal(f.node('#identity').children[0],f.node('#workspaceSearch'));assert.equal(f.node('#workspaceSearch').getAttribute('aria-keyshortcuts'),'Control+k Meta+k');assert.equal(f.calls.length,0);
 f.ctx.me=null;f.ctx.installWorkspaceSearch();assert.equal(f.node('#workspaceSearch'),null);f.ctx.me=f.session;f.ctx.installWorkspaceSearch();assert.equal(f.events.get('keydown').length,1);
});
test('Ctrl and Meta K open/focus one labelled dialog, preserve underlying draft, and ignore unrelated/composing/repeated keys',()=>{
 const f=fixture();f.ctx.installWorkspaceSearch();const draft=f.node('#draft');for(const modifiers of [{},{ctrlKey:true,altKey:true},{ctrlKey:true,isComposing:true},{metaKey:true,repeat:true},{ctrlKey:true,defaultPrevented:true}]){f.key('k',modifiers);assert.equal(f.node('dialog'),null);}
 assert.equal(f.key('K',{ctrlKey:true}).defaultPrevented,true);const dialog=f.node('dialog'),input=f.node('[role="combobox"]');assert.equal(dialog.getAttribute('aria-labelledby'),dialog.querySelector('h2').id);assert.equal(f.document.activeElement,input);assert.equal(input.getAttribute('aria-controls'),f.node('[role="listbox"]').id);assert.equal(f.key('k',{metaKey:true}).defaultPrevented,true);assert.equal(f.document.querySelectorAll('dialog').length,1);assert.equal(f.node('#draft'),draft);assert.equal(draft.value,'Typed draft');assert.equal(f.calls.length,0);
});
test('busy, uncertain and existing modal locks block opening without reads or native label guesses',()=>{
 for(const mode of ['busy','import','opening','return','sales','invoice','modal']){
  const f=fixture();f.ctx.installWorkspaceSearch();if(mode==='busy')f.ctx.busy=true;if(mode==='import')f.ctx.financialImportIsPosting=()=>true;if(mode==='opening')f.ctx.openingReceivablesState={uncertain:true};if(mode==='return')f.ctx.returnCreditPostingState={busy:true};if(mode==='sales')f.node('#content').innerHTML='<form id="proformaForm" data-saving="true"></form>';if(mode==='invoice')f.node('#content').innerHTML='<form id="booksInvoiceForm"><fieldset disabled></fieldset><button id="booksInvoicePost">Arbitrary label</button></form>';if(mode==='modal'){const dialog=f.document.createElement('dialog');f.document.body.append(dialog);dialog.showModal();}
  assert.equal(f.ctx.openWorkspaceSearch(),false,mode);assert.equal(f.key('k',{ctrlKey:true}).defaultPrevented,undefined);assert.equal(f.node('dialog.workspace-search'),null);assert.equal(f.calls.length,0);
 }
 const f=fixture();f.node('#content').innerHTML='<form id="booksInvoiceForm"><fieldset disabled></fieldset><button id="booksInvoicePost" disabled>Posted</button></form>';assert.ok(f.open(),'confirmed invoice is not the uncertain retry state');
});
test('250 ms debounce, two Unicode code points, composition and length caps; clears old results immediately',async()=>{
 const f=fixture(),dialog=f.open(),input=f.node('[role="combobox"]');for(const query of ['',' ','a','😀','\t\u00a0']){f.type(query);await f.advance(250);}assert.equal(f.calls.length,0);
 f.type('Fixture',{isComposing:true});await f.advance(250);assert.equal(f.calls.length,0);f.type('Fi');await f.advance(249);assert.equal(f.calls.length,0);await f.advance(1);assert.equal(f.calls.length,1);assert.equal(f.document.querySelectorAll('[role="option"]').length,4);
 f.type('Second');assert.equal(f.document.querySelectorAll('[role="option"]').length,0);assert.equal(input.getAttribute('aria-activedescendant'),null);f.type('Third');await f.advance(250);assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_query,'Third');assert.equal(f.node('dialog'),dialog);assert.equal(f.node('[role="combobox"]'),input);
 f.type('x'.repeat(121));await f.advance(250);assert.equal(f.calls.length,2);assert.match(f.node('.workspace-search-status').textContent,/120/);f.type('😀'.repeat(120));await f.advance(250);assert.equal(f.calls.length,3);assert.equal([...f.calls[2].args.p_query].length,120);
});
test('bounded response renders 20 text-only suggestions, stable input and exactly one result announcement',async()=>{
 const f=fixture();f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});const data=response(args.p_query,5);data.groups.clients.rows[0].title='<img src=x onerror=bad>';data.groups.clients.rows[0].subtitle='😀'.repeat(180);return {data};};await f.ready();assert.equal(f.document.querySelectorAll('[role="option"]').length,20);assert.equal(f.node('img'),null);assert.match(f.node('[role="option"]').textContent,/<img src=x/);assert.equal(f.node('.workspace-search-status').querySelectorAll('[aria-live="polite"]').length,1);assert.match(f.node('.workspace-search-status').textContent,/20 results.*Refine/);await f.advance(5000);assert.match(f.node('.workspace-search-status').textContent,/20 results/);
});
test('all malformed bounds, keys, UUIDs, kinds, duplicate IDs and mismatched query fail closed',async()=>{
 const invalid=[data=>data.query='Other',data=>delete data.groups.clients,data=>data.groups.extra={},data=>data.groups.clients.rows.push(...Array(5).fill(data.groups.clients.rows[0])),data=>data.groups.products.rows[0].id='javascript:alert(1)',data=>data.groups.products.rows[0].kind='invoice',data=>data.groups.clients.rows[0].title='x'.repeat(181),data=>data.groups.clients.rows[0].subtitle='😀'.repeat(181),data=>data.groups.clients.rows[0].phone='private',data=>data.groups.invoices.available=false,data=>data.groups.clients.has_more=true,data=>data.groups.clients.rows.push({...data.groups.clients.rows[0],kind:'branch'}),data=>data.groups.clients.available=false];
 for(const change of invalid){const f=fixture();f.ctx.client.rpc=async(_,args)=>{const data=response(args.p_query);change(data);return {data};};await f.ready();assert.equal(f.document.querySelectorAll('[role="option"]').length,0);assert.match(f.node('.workspace-search-status').textContent,/incomplete/);assert.equal(f.opens.length,0);}
});
test('late success and error never replace the latest query, including clear/reopen and exact same-ID actor drift',async()=>{
 for(const mode of ['query','clear','close','reopen','actor','epoch','view','scope','hash'])for(const reject of [false,true]){
  const f=fixture(),wait=deferred();f.ctx.client.rpc=()=>wait.promise;f.open();const old=f.node('dialog');f.type('Old');await f.advance(250);
  if(mode==='query'){f.ctx.client.rpc=async(_,args)=>({data:response(args.p_query)});f.type('New');await f.advance(250);}if(mode==='clear')f.type('');if(mode==='close'||mode==='reopen'){f.ctx.clearWorkspaceSearch();if(mode==='reopen')f.open();}if(mode==='actor')f.ctx.me={...f.session};if(mode==='epoch')f.ctx.sessionLoadEpoch++;if(mode==='view')f.ctx.view='books';if(mode==='scope')f.ctx.scope='note';if(mode==='hash')f.ctx.location.hash='#/other';
  const before=f.node('.workspace-search-status')?.textContent;if(reject)wait.reject(Error('Obsolete private error'));else wait.resolve({data:response('Old')});await flush();assert.equal(f.node('.workspace-search-status')?.textContent,before,mode);assert.doesNotMatch(f.document.body.textContent,/Obsolete private error/);if(mode==='query')assert.equal(f.get('workspaceSearchState.query'),'New');if(['close','reopen'].includes(mode))assert.equal(old.isConnected,false);
 }
});
test('current rejection reports an error and a new query clears its registry before recovery',async()=>{
 const f=fixture();f.ctx.client.rpc=async()=>{throw Error('<Network failure>');};await f.ready();assert.match(f.node('.workspace-search-status').textContent,/<Network failure>/);assert.equal(f.get("[...actionFeedbackEntries].filter(e=>e.kind==='error').length"),1);
 f.ctx.client.rpc=async(_,args)=>({data:response(args.p_query)});f.type('New');assert.equal(f.get("[...actionFeedbackEntries].filter(e=>e.kind==='error').length"),0);await f.advance(250);assert.equal(f.document.querySelectorAll('[role="option"]').length,4);assert.equal(f.node('[role="listbox"]').getAttribute('aria-busy'),null);
});
test('arrow navigation wraps and Enter opens only the active result through actual run and captured navigation context',async()=>{
 const f=fixture();await f.ready();const input=f.node('[role="combobox"]');input.fire('keydown',{key:'Enter'});assert.equal(f.opens.length,0);input.fire('keydown',{key:'ArrowUp'});assert.equal(input.getAttribute('aria-activedescendant'),f.document.querySelectorAll('[role="option"]')[3].id);input.fire('keydown',{key:'ArrowDown'});const first=f.node('[role="option"]');assert.equal(input.getAttribute('aria-activedescendant'),first.id);assert.equal(first.getAttribute('aria-selected'),'true');assert.equal(f.document.activeElement,input);
 const wait=deferred();f.ctx.openWorkspaceRecord=async(kind,key,{context})=>{f.opens.push({kind,id:key,context});return wait.promise;};input.fire('keydown',{key:'Enter'});assert.equal(f.ctx.busy,true);assert.equal(first.disabled,true);assert.equal(first.getAttribute('aria-busy'),'true');assert.equal(first.textContent,'clients 0Fictional record');assert.equal(input.readOnly,true);assert.equal(f.opens[0].context.current(),true);input.fire('keydown',{key:'Enter'});await f.click(first);assert.equal(f.opens.length,1);wait.resolve(false);await flush();assert.equal(f.node('dialog').open,true);assert.equal(f.ctx.busy,false);assert.equal(first.disabled,false);assert.equal(input.readOnly,false);
});
test('successful committed selection disposes only its palette without restoring focus to the old trigger',async()=>{
 const f=fixture();await f.ready();const trigger=f.node('#workspaceSearch'),destination=f.node('#destination');let restores=0;trigger.focus=()=>restores++;
 f.ctx.openWorkspaceRecord=async(kind,key,{context})=>{assert.equal(context.current(),true);f.ctx.view='inventory';f.ctx.scope='catalog';f.ctx.location.hash='#/product/'+key;destination.focus();f.mutate(()=>{});return true;};await f.click(f.node('[role="option"]'));assert.equal(f.node('dialog'),null);assert.equal(f.document.activeElement,destination);assert.equal(restores,0);assert.equal(f.ctx.busy,false);assert.equal(f.observers.every(observer=>!observer.active),true);assert.equal(f.get('actionFeedbackEntries.size'),0);
});
test('committed records and read-only unavailable destinations focus their heading only after the search modal closes',async()=>{
 for(const failed of [false,true])for(const kind of ['client','opening_balance']){
  const f=fixture();await f.ready();if(kind==='opening_balance'){f.ctx.client.rpc=async(_,args)=>{const data=response(args.p_query);data.groups.invoices.rows[0].kind=kind;return {data};};f.type('Open');await f.advance(250);}
  const option=kind==='client'?f.node('[role="option"]'):f.document.querySelectorAll('[role="option"]')[3];let focused=0;
  f.ctx.openWorkspaceRecord=async(_,key)=>{f.ctx.view=kind==='client'?'contacts':'books';f.ctx.scope=kind==='client'?'':'invoices';f.ctx.location.hash='#/'+(kind==='client'?'client':'invoice')+'/'+key;f.node('#content').innerHTML='<div class="workspace-page-header"><h1'+(failed?' tabindex="0"':'')+'>'+(failed?'Invoice unavailable':'Current record')+'</h1></div><p>'+(failed?'Retry loading record':'Record details')+'</p>';const heading=f.node('#content h1');heading.focus=options=>{assert.equal(f.node('dialog'),null);assert.deepEqual({...options},{preventScroll:true});focused++;f.document.activeElement=heading;};return true;};
  await f.click(option);assert.equal(focused,1);assert.equal(f.document.activeElement,f.node('#content h1'));assert.equal(f.node('#content h1').getAttribute('tabindex'),failed?'0':'-1');assert.equal(f.ctx.busy,false);
 }
});
test('committed search never steals focus after actor/session/navigation/query drift, another modal or intentional focus',async()=>{
 for(const mode of ['actor','epoch','navigation','other-route','query','modal','user-focus']){
  const f=fixture(),wait=deferred();await f.ready();let heading,other;
  f.ctx.openWorkspaceRecord=async(_,key)=>{await wait.promise;f.ctx.view='contacts';f.ctx.scope='';f.ctx.location.hash='#/client/'+key;f.node('#content').innerHTML='<div class="workspace-page-header"><h1>Committed record</h1></div><button id="newAction">New action</button>';heading=f.node('h1');heading.focus=()=>assert.fail('Stale or intentional focus must be preserved: '+mode);if(mode==='actor')f.ctx.me={...f.session};if(mode==='epoch')f.ctx.sessionLoadEpoch++;if(mode==='navigation')f.ctx.workspaceNavigationContext();if(mode==='other-route')f.ctx.location.hash='#/product/'+key;if(mode==='query')f.type('Changed');if(mode==='modal'){other=f.document.createElement('dialog');f.document.body.append(other);other.showModal();other.focus();}if(mode==='user-focus'){other=f.node('#newAction');other.focus();}return true;};
  const selecting=f.click(f.node('[role="option"]'));wait.resolve();await selecting;if(other)assert.equal(f.document.activeElement,other,mode);assert.equal(heading.getAttribute('tabindex'),null,mode);
 }
});
test('the guarded destination loader contract preserves committed Pro forma focus',async()=>{
 const f=fixture();await f.ready();const option=f.document.querySelectorAll('[role="option"]')[2];
 f.ctx.openWorkspaceRecord=async(kind,key,{context})=>{assert.equal(kind,'proforma');assert.equal(context.current(),true);f.ctx.view='sales';f.ctx.scope='proformas';f.ctx.location.hash='#/proforma/'+key;const sequence=f.ctx.workspaceLeaveSequence,loader={current:()=>f.ctx.location.hash==='#/proforma/'+key&&f.ctx.workspaceLeaveSequence===sequence};await Promise.resolve();assert.equal(loader.current(),true);f.node('#content').innerHTML='<div class="workspace-page-header"><h1>Pro forma PF-1</h1></div>';return true;};
 await f.click(option);assert.equal(f.node('dialog'),null);assert.equal(f.document.activeElement,f.node('h1'));assert.equal(f.node('h1').getAttribute('tabindex'),'-1');
});
test('close callbacks that replace the committed root, route or focus prevent destination focus',async()=>{
 for(const mode of ['root','route','actor','epoch','navigation','dialog','focus']){
  const f=fixture();await f.ready();let heading,other;const dialog=f.node('dialog');
  f.ctx.openWorkspaceRecord=async(_,key)=>{f.ctx.view='contacts';f.ctx.scope='';f.ctx.location.hash='#/client/'+key;f.node('#content').innerHTML='<div class="workspace-page-header"><h1>Destination</h1></div><button id="newAction">Another action</button>';heading=f.node('h1');heading.focus=()=>assert.fail('Close-time drift must not focus destination: '+mode);return true;};
  dialog.addEventListener('close',()=>{if(mode==='root'){f.node('#content').remove();}if(mode==='route')f.ctx.location.hash='#/go/personal/task';if(mode==='actor')f.ctx.me={...f.session};if(mode==='epoch')f.ctx.sessionLoadEpoch++;if(mode==='navigation')f.ctx.workspaceNavigationContext();if(mode==='dialog'){other=f.document.createElement('dialog');f.document.body.append(other);other.showModal();other.focus();}if(mode==='focus'){other=f.node('#newAction');other.focus();}});
  await f.click(f.node('[role="option"]'));assert.equal(heading.getAttribute('tabindex'),null,mode);if(other)assert.equal(f.document.activeElement,other);
 }
});
test('selection source context rejects query/token/actor/session/route drift and suppresses stale errors',async()=>{
 for(const mode of ['query','navigation','actor','epoch','view','hash','clear']){
  const f=fixture(),wait=deferred();await f.ready();let context;f.ctx.openWorkspaceRecord=async(_,__,options)=>{context=options.context;await wait.promise;return context.current();};const selecting=f.click(f.node('[role="option"]'));
  if(mode==='query')f.type('Different');if(mode==='navigation')f.ctx.workspaceNavigationContext();if(mode==='actor')f.ctx.me={...f.session};if(mode==='epoch')f.ctx.sessionLoadEpoch++;if(mode==='view')f.ctx.view='books';if(mode==='hash')f.ctx.location.hash='#/other';if(mode==='clear')f.ctx.clearWorkspaceSearch();assert.equal(context.current(),false,mode);wait.reject(Error('Stale opening error'));await selecting;assert.doesNotMatch(f.document.body.textContent,/Stale opening error/);assert.equal(f.ctx.busy,false);
 }
});
test('current navigation error stays in the palette with retryable results; busy refusal never invokes opener',async()=>{
 const f=fixture();await f.ready();f.ctx.busy=true;await f.click(f.node('[role="option"]'));assert.equal(f.opens.length,0);assert.match(f.node('.workspace-search-status').textContent,/Another action/);f.ctx.busy=false;f.ctx.openWorkspaceRecord=async()=>{throw Error('Record unavailable');};await f.click(f.node('[role="option"]'));assert.match(f.node('.workspace-search-status').textContent,/Record unavailable/);assert.equal(f.document.querySelectorAll('[role="option"]').length,4);assert.equal(f.node('dialog').open,true);
});
test('new query and close remove selection errors owned by the shared status target; later uncertainty blocks selection',async()=>{
 for(const mode of ['query','close']){const f=fixture();await f.ready();f.ctx.openWorkspaceRecord=async()=>{throw Error('Open failed');};await f.click(f.node('[role="option"]'));assert.equal(f.get("[...actionFeedbackEntries].filter(e=>e.kind==='error').length"),1);if(mode==='query')f.type('Changed');else f.ctx.clearWorkspaceSearch();assert.equal(f.get("[...actionFeedbackEntries].filter(e=>e.kind==='error').length"),0);}
 const f=fixture();await f.ready();f.ctx.openingReceivablesState={uncertain:true};await f.click(f.node('[role="option"]'));assert.equal(f.opens.length,0);assert.match(f.node('.workspace-search-status').textContent,/reconcile/);
});
test('permission-unavailable groups render no entries and approved branch/opening-balance kinds keep their exact dispatch',async()=>{
 const f=fixture();f.ctx.client.rpc=async(_,args)=>{const data=response(args.p_query);data.groups.products={available:true,rows:[],has_more:false};data.groups.proformas={available:false,rows:[],has_more:false};data.groups.clients.rows[0].kind='branch';data.groups.invoices.rows[0].kind='opening_balance';return {data};};await f.ready();assert.equal(f.document.querySelectorAll('[role="option"]').length,2);for(const option of f.document.querySelectorAll('[role="option"]'))await f.click(option);assert.deepEqual(f.opens.map(row=>row.kind),['branch','opening_balance']);
});
test('Escape/backdrop/Close use shared dismissal and restore trigger only on normal close; selection locks dismissal',async()=>{
 for(const mode of ['cancel','click','close']){const f=fixture(),dialog=f.open(),trigger=f.node('#workspaceSearch'),wait=deferred();f.exit(wait);if(mode==='close')f.click(dialog.querySelector('[data-search-close]'));else dialog.fire(mode,{clientX:0,clientY:0});assert.equal(dialog.inert,true);assert.equal(dialog.open,true);wait.resolve();await flush();assert.equal(dialog.isConnected,false);assert.equal(f.document.activeElement,trigger);}
 const f=fixture(),wait=deferred();await f.ready();f.ctx.openWorkspaceRecord=()=>wait.promise;const selecting=f.click(f.node('[role="option"]')),dialog=f.node('dialog');dialog.fire('cancel');await flush();assert.equal(dialog.open,true);assert.notEqual(dialog.inert,true);wait.resolve(false);await selecting;
});
test('session reset and passive route changes remove pending timers/results and every per-dialog listener',async()=>{
 for(const mode of ['reset','actor','epoch','scope','hash']){const f=fixture(),dialog=f.open();f.type('Pending');if(mode==='reset')f.ctx.clearWorkspaceSearch();else f.mutate(()=>{if(mode==='actor')f.ctx.me={...f.session};if(mode==='epoch')f.ctx.sessionLoadEpoch++;if(mode==='scope')f.ctx.scope='note';if(mode==='hash')f.ctx.location.hash='#/other';});await f.advance(250);assert.equal(f.calls.length,0);assert.equal(dialog.isConnected,false);assert.equal(f.get('workspaceSearchState'),null);assert.equal(f.observers.every(observer=>!observer.active),true);for(const name of ['popstate','hashchange'])assert.equal(f.windowEvents.get(name).size,0);}
});
test('phone and reduced-motion use actual shared dialog geometry/motion; stylesheet consumes semantic tokens',()=>{
 for(const mode of [{phone:true},{reduced:true}]){const f=fixture(mode),dialog=f.open();assert.equal(dialog.dataset.dialogSize,'medium');assert.equal(f.animations[0].options.duration,mode.reduced?150:300);if(mode.reduced)assert.ok(f.animations[0].frames.every(frame=>!Object.hasOwn(frame,'transform')));}
 const css=read('global-search.css');assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b|rgba?\(|font-size:\s*\d|--[\w-]+\s*:/i);assert.match(css,/max-height:min\(var\(--dialog-sm\),50dvh\)/);assert.match(css,/aria-selected="true"/);assert.match(css,/overflow-wrap:anywhere/);
});
