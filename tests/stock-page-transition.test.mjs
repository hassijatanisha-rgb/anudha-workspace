import {parseCss} from '../scripts/audit-design-tokens.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function fixture({native=true}={}){
 const document=dom(),proto=Object.getPrototypeOf(document.body),transitions=[],animations=[],calls=[];
 Object.defineProperties(proto,{style:{get(){return this._style??={};}},classList:{get(){return {add:value=>this.attrs.class=[...new Set([...(this.attrs.class||'').split(' ').filter(Boolean),value])].join(' '),remove:value=>this.attrs.class=(this.attrs.class||'').split(' ').filter(item=>item!==value).join(' '),contains:value=>(this.attrs.class||'').split(' ').includes(value)};}}});
 proto.animate=function(frames,options){const wait=deferred(),item={node:this,frames,options,finished:wait.promise,finish:wait.resolve,cancel:()=>wait.reject(Error('Cancelled'))};animations.push(item);return item;};
 document.documentElement=document.body;document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.body.innerHTML='<header id="identity">Signed in</header><main id="content"><section><div class="workspace-page-header"><h1>Previous screen</h1></div><input value="Old draft"></section></main>';
 if(native)document.startViewTransition=callback=>{
  const update=deferred(),ready=deferred(),finished=deferred();let ran=false;
  const item={html:document.querySelector('#content').innerHTML,header:document.querySelector('.workspace-page-header'),updateCallbackDone:update.promise,ready:ready.promise,finished:finished.promise,finish:finished.resolve,rejectReady:ready.reject,rejectFinished:finished.reject,skipped:0,async commit(){if(ran)return;ran=true;try{await callback();update.resolve();ready.resolve();}catch(error){update.reject(error);ready.reject(error);finished.reject(error);}},skipTransition(){this.skipped++;queueMicrotask(()=>this.commit());finished.resolve();}};transitions.push(item);return item;
 };
 const ctx=vm.createContext({document,location:{hash:'#/go/inventory/stock'},sessionLoadEpoch:1,workspaceLeaveSequence:1,me:{user_id:'actor',role:'owner'},view:'inventory',inventorySection:'stock',$:selector=>document.querySelector(selector),workspaceRefreshScope:()=>JSON.stringify([ctx.view,vm.runInContext('inventorySection',ctx)]),getComputedStyle:()=>({getPropertyValue:key=>({'--m-fade':'150ms','--ease-out':'ease-out'}[key])}),matchMedia:()=>({matches:false}),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 vm.runInContext(read('ui-motion.js'),ctx);
 const root=document.querySelector('#content'),actor=ctx.me,current=()=>ctx.me===actor&&ctx.sessionLoadEpoch===1&&ctx.view==='inventory'&&ctx.location.hash==='#/go/inventory/stock'&&root.isConnected&&document.querySelector('#content')===root;
 const paint=()=>{calls.push('paint');root.innerHTML='<div class="workspace-page-header"><h1>Stock</h1></div><section><input value="New content"></section><section>Stock totals</section>';};
 const begin=()=>{ctx.beginWorkspaceStockTransition();return ctx.takeWorkspaceStockTransition();};
 return {ctx,document,root,actor,current,paint,begin,calls,transitions,animations,get:code=>vm.runInContext(code,ctx),last:()=>transitions.at(-1)};
}
test('native Stock paint snapshots only at commit, excludes the named header, and returns before motion completes',async()=>{
 const f=fixture(),old=f.root.querySelector('.workspace-page-header');old.style.viewTransitionName='existing-header';const pending=f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);assert.equal(f.transitions.length,1);assert.deepEqual(f.calls,[]);assert.equal(old.style.viewTransitionName,'workspace-stock-header');await f.last().commit();await pending;assert.deepEqual(f.calls,['paint']);assert.equal(f.root.querySelector('.workspace-page-header').style.viewTransitionName,'workspace-stock-header');assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),true);f.last().finish();await flush();assert.equal(old.style.viewTransitionName,'existing-header');assert.equal(f.root.querySelector('.workspace-page-header').style.viewTransitionName,'');assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),false);
});
test('unsupported browsers paint immediately and fade only Stock body siblings for150ms',async()=>{
 const f=fixture({native:false}),focus=f.document.querySelector('#identity');focus.focus();const pending=f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);assert.deepEqual(f.calls,['paint']);await pending;assert.equal(f.animations.length,2);for(const animation of f.animations){assert.equal(animation.options.duration,150);assert.ok(animation.frames.every(frame=>Object.keys(frame).every(key=>key==='opacity')));assert.equal(animation.node.matches('.workspace-page-header'),false);}assert.equal(f.document.activeElement,focus);f.ctx.clearWorkspaceStockTransition();await flush();assert.equal(f.get('workspaceStockTransitionActive'),null);
});
test('ordinary refresh, filter and paging paints have no navigation transition intent',async()=>{
 const f=fixture();for(let i=0;i<3;i++)await f.ctx.paintWorkspaceStockTransition(f.ctx.takeWorkspaceStockTransition(),f.paint,f.current);assert.equal(f.calls.length,3);assert.equal(f.transitions.length,0);assert.equal(f.animations.length,0);const intent=f.begin();assert.equal(f.ctx.takeWorkspaceStockTransition(),null);const pending=f.ctx.paintWorkspaceStockTransition(intent,f.paint,f.current);await f.last().commit();await pending;f.last().finish();await flush();await f.ctx.paintWorkspaceStockTransition(f.ctx.takeWorkspaceStockTransition(),f.paint,f.current);assert.equal(f.transitions.length,1);
});
test('a canceled navigation attempt skips motion but still commits otherwise-current Stock content',async()=>{
 const f=fixture(),pending=f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);f.ctx.workspaceLeaveSequence++;f.ctx.clearWorkspaceStockTransition();await pending;assert.equal(f.last().skipped,1);assert.deepEqual(f.calls,['paint']);assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),false);
});
for(const drift of ['actor','session','route','root'])test(`a ${drift} change before the native callback cannot paint old Stock data`,async()=>{
 const f=fixture(),pending=f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);if(drift==='actor')f.ctx.me={...f.actor};else if(drift==='session')f.ctx.sessionLoadEpoch++;else if(drift==='route')f.ctx.location.hash='#/go/service';else f.root.remove();f.ctx.clearWorkspaceStockTransition();await pending;assert.deepEqual(f.calls,[]);assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),false);
});
test('ready or finished animation rejection cannot fail an already applied page update',async()=>{
 for(const stage of ['ready','finished']){const f=fixture(),pending=f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);f.last()[stage==='ready'?'rejectReady':'rejectFinished'](Error('Motion unavailable'));await f.last().commit();await pending;assert.deepEqual(f.calls,['paint']);f.last().finish();await flush();assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),false);}
});
test('DOM callback rejection is surfaced once, without fallback painting a second time',async()=>{
 const f=fixture();let calls=0;const pending=f.ctx.paintWorkspaceStockTransition(f.begin(),()=>{calls++;throw Error('Render failed');},f.current);const rejection=assert.rejects(pending,/Render failed/);await f.last().commit();await rejection;await flush();assert.equal(calls,1);assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),false);
});
test('a synchronous native API failure falls back once without retaining transition styling',async()=>{
 const f=fixture();f.document.startViewTransition=()=>{throw Error('API unavailable');};await f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);assert.deepEqual(f.calls,['paint']);assert.equal(f.animations.length,2);assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),false);
});
test('a prior transition finishing after interruption cannot remove the newer transition header name or class',async()=>{
 const f=fixture(),first=f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);await f.last().commit();await first;const old=f.last();
 const next=f.ctx.paintWorkspaceStockTransition(f.begin(),f.paint,f.current);await old.finished;await flush();assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),true);assert.equal(f.root.querySelector('.workspace-page-header').style.viewTransitionName,'workspace-stock-header');await f.last().commit();await next;f.last().finish();await flush();assert.equal(f.document.documentElement.classList.contains('workspace-stock-transition'),false);
});
test('fallback paint errors retain their original failure and clear the active motion state',async()=>{
 const f=fixture({native:false});await assert.rejects(f.ctx.paintWorkspaceStockTransition(f.begin(),()=>{throw Error('Paint failed');},f.current),/Paint failed/);assert.equal(f.get('workspaceStockTransitionActive'),null);
});
test('Stock CSS uses150ms opacity only, disables group geometry, and leaves headers unanimated',()=>{
 const declarations=parseCss(read('ui-polish.css')).declarations.filter(rule=>rule.selector.includes('workspace-stock')||rule.contexts.some(context=>context.startsWith('@keyframes workspace-stock')));
 const value=(selector,property)=>declarations.find(rule=>rule.selector===selector&&rule.property===property)?.value;
 assert.match(read('tokens.css'),/--m-fade:150ms/);
 assert.equal(value('html.workspace-stock-transition','view-transition-name'),'none');
 assert.equal(value('html.workspace-stock-transition::view-transition-group(*)','animation'),'none');
 for(const [phase,direction]of [['old','out'],['new','in']])assert.match(value(`html.workspace-stock-transition::view-transition-${phase}(workspace-stock)`,'animation'),new RegExp(`^workspace-stock-${direction} var\\(--m-fade\\)`));
 assert.equal(value('html.workspace-stock-transition::view-transition-new(workspace-stock-header)','animation'),'none');
 assert.equal(value('html.workspace-stock-transition::view-transition-new(workspace-stock-header)','opacity'),'1');
 assert.ok(!declarations.some(rule=>/transform|width|height/.test(rule.property)));
});

function navigationFixture(){
 const f=mainPageFixture(),intents=[];f.ctx.actor=f.actor;f.evaluate("me=actor;view='dashboard';location.hash='#/go/dashboard'");f.ctx.render=async()=>{intents.push(f.ctx.takeWorkspaceStockTransition());};
 const stock=f.document.querySelectorAll('[data-view]').find(button=>button.dataset.view==='inventory'&&button.dataset.workspaceSection==='stock');return {...f,stock,intents};
}
test('actual approved menu navigation arms one Stock intent after committing scope and hash',async()=>{
 const f=navigationFixture();await f.ctx.navigateWorkspace(f.stock);assert.equal(f.intents.length,1);assert.equal(f.intents[0].current(),true);assert.equal(f.evaluate('view'),'inventory');assert.equal(f.ctx.location.hash,'#/go/inventory/stock');await f.ctx.navigateWorkspace(f.stock);assert.equal(f.intents[1],null,'Same Stock page navigation does not crossfade');
});
test('actual declined navigation never arms Stock motion; a new intent invalidates previously captured motion',async()=>{
 const f=navigationFixture();f.ctx.confirmWorkspaceLeave=async()=>false;await f.ctx.navigateWorkspace(f.stock);assert.equal(f.intents.length,0);assert.equal(f.evaluate('view'),'dashboard');f.ctx.confirmWorkspaceLeave=async current=>current();await f.ctx.navigateWorkspace(f.stock);const intent=f.intents[0];assert.equal(intent.current(),true);f.ctx.workspaceNavigationContext();assert.equal(intent.current(),false);assert.equal(f.ctx.takeWorkspaceStockTransition(),null);
});
test('actual queued navigation cannot arm Stock after its actor was replaced',async()=>{
 const f=navigationFixture();let finish;const loading=f.ctx.run(()=>new Promise(resolve=>{finish=resolve;}));await f.ctx.navigateWorkspace(f.stock);assert.equal(f.intents.length,0);f.ctx.replacement={...f.actor};f.evaluate('me=replacement');finish();await loading;await flush();assert.equal(f.intents.length,0);assert.equal(f.evaluate('view'),'dashboard');
});
test('actual navigation and renderer reach Stock once with unchanged readonly request count',async()=>{
 const data={rows:[],products:[],locations:[],packs:[],total:0,scope_count:0,page:0,pages:1,totals:{cartons:0,loose:0,reserved:0,freeLoose:0,invoiceableLoose:0}},f=mainPageFixture({rpcs:{inventory_stock_page:data}});f.ctx.actor=f.actor;f.evaluate("me=actor;view='dashboard';location.hash='#/go/dashboard'");
 let transitions=0,readCallsAtSnapshot=0;
 f.document.startViewTransition=callback=>{transitions++;readCallsAtSnapshot=f.calls.filter(call=>call.name==='inventory_stock_page').length;const updateCallbackDone=Promise.resolve().then(callback);return {updateCallbackDone,ready:updateCallbackDone,finished:updateCallbackDone,skipTransition(){}};};
 const stock=f.document.querySelectorAll('[data-view]').find(button=>button.dataset.view==='inventory'&&button.dataset.workspaceSection==='stock');await f.ctx.navigateWorkspace(stock);await f.settle();
 assert.equal(transitions,1);assert.equal(readCallsAtSnapshot,1);assert.equal(f.calls.filter(call=>call.name==='inventory_stock_page').length,1);assert.equal(f.calls.filter(call=>call.kind==='from').length,0);assert.match(f.document.querySelector('#content').textContent,/Stock & availability/);
 await f.ctx.inventoryWorkspace(true);await f.settle();assert.equal(transitions,1);assert.equal(f.calls.filter(call=>call.name==='inventory_stock_page').length,2);
});
test('actual session cleanup cancels pending Stock motion before a delayed callback can paint',async()=>{
 const f=navigationFixture();await f.ctx.navigateWorkspace(f.stock);let callback,skips=0;const update=deferred();f.document.startViewTransition=fn=>{callback=fn;return {updateCallbackDone:update.promise,ready:Promise.resolve(),finished:update.promise,skipTransition(){skips++;queueMicrotask(()=>{callback();update.resolve();});}};};
 let paints=0;const actor=f.evaluate('me'),epoch=f.evaluate('sessionLoadEpoch'),pending=f.ctx.paintWorkspaceStockTransition(f.intents[0],()=>paints++,()=>f.evaluate('me')===actor&&f.evaluate('sessionLoadEpoch')===epoch);f.ctx.clearCoreSession();await pending;assert.equal(skips,1);assert.equal(paints,0);assert.equal(f.evaluate('workspaceStockTransitionActive'),null);
});
function stockFixture(){
 const f=fixture(),wait=deferred(),data={rows:[],products:[],locations:[],packs:[],total:0,scope_count:0,page:0,pages:1,totals:{cartons:0,loose:0,reserved:0,freeLoose:0,invoiceableLoose:0}};
 Object.assign(f.ctx,{products:[],organizations:[],orgIndex:new Map(),lookupRowSources:{},productReviewLoadError:'',rowById:(rows,id)=>rows.find(row=>row.id===id),reviewedCatalogProduct:row=>row,companyDate:()=> '2026-10-29',canEditRecords:()=>true,hasArea:()=>true,syncWorkspaceNavigation(){},workspaceLoading(){f.root.innerHTML='<section>Loading Stock</section>';},message(){},run:fn=>fn(),client:{rpc:async(name,args)=>{f.calls.push({name,args});return wait.promise;}},renderSearchPreservingPosition:(_,render)=>render()});
 installPageHeader(f.ctx);for(const name of ['status-ui.js','inventory-domain.js','inventory-operations.js'])vm.runInContext(read(name),f.ctx);
 return {...f,wait,data};
}
test('actual Stock loader completes its sole readonly request before starting the synchronous transition',async()=>{
 const f=stockFixture();f.ctx.beginWorkspaceStockTransition();const pending=f.ctx.inventoryStockWorkspace();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'inventory_stock_page');assert.equal(f.transitions.length,0);assert.match(f.root.textContent,/Loading Stock/);f.wait.resolve({data:f.data});await flush();assert.equal(f.transitions.length,1);assert.match(f.last().html,/Loading Stock/);await f.last().commit();await pending;assert.match(f.root.textContent,/Stock & availability/);assert.equal(f.calls.length,1);f.last().finish();await flush();await f.ctx.inventoryStockWorkspace();assert.equal(f.transitions.length,1);assert.equal(f.calls.length,1);
});
test('an expired intent after canceled navigation never strands a valid Stock response behind its skeleton',async()=>{
 const f=stockFixture();f.ctx.beginWorkspaceStockTransition();const pending=f.ctx.inventoryStockWorkspace();f.ctx.workspaceLeaveSequence++;f.ctx.clearWorkspaceStockTransition();f.wait.resolve({data:f.data});await pending;assert.match(f.root.textContent,/Stock & availability/);assert.equal(f.transitions.length,0);assert.equal(f.calls.length,1);
});
test('an unsuccessful Stock read still paints its usable error page once after the request settles',async()=>{
 const f=stockFixture();f.ctx.beginWorkspaceStockTransition();const pending=f.ctx.inventoryStockWorkspace();f.wait.resolve({error:Error('Read denied')});await flush();assert.equal(f.transitions.length,1);await f.last().commit();await pending;assert.match(f.root.textContent,/Stock could not be loaded/);assert.match(f.root.textContent,/Read denied/);assert.equal(f.calls.length,1);f.last().finish();await flush();
});
test('a newer Stock request invalidates a scheduled native callback without a duplicate paint',async()=>{
 const f=stockFixture();f.ctx.beginWorkspaceStockTransition();const old=f.ctx.inventoryStockWorkspace();f.wait.resolve({data:f.data});await flush();assert.equal(f.transitions.length,1);f.get('inventoryStockPageRequest++');f.root.innerHTML='<p>Newer filter</p>';await f.last().commit();await old;assert.equal(f.root.textContent,'Newer filter');f.last().finish();await flush();
});
