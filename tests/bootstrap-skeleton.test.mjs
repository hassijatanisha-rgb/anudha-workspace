import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),app=read('app.js');
const line=prefix=>{const result=app.split('\n').find(row=>row.startsWith(prefix));assert.ok(result,prefix);return result;};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
function fixture({shared=false,view='dashboard',signedIn=false}={}){
 let document;
 class Node{
  constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.children=[];this.parentElement=null;this.text='';}
  get firstElementChild(){return this.children.find(child=>child.tagName!=='#TEXT')||null;}get firstChild(){return this.children[0]||null;}
  get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){this.replaceChildren(...parse(value));}get innerHTML(){return this.children.map(child=>child.outerHTML).join('');}
  get outerHTML(){return this.tagName==='#TEXT'?this.text:`<${this.tagName.toLowerCase()}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('')}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=nodes;for(const child of nodes)child.parentElement=this;}
  matches(selector){if(selector[0]==='#')return this.attrs.id===selector.slice(1);if(selector[0]==='.')return (this.attrs.class||'').split(' ').includes(selector.slice(1));if(selector[0]==='['){const [,key,value]=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)||[];return key in this.attrs&&(value===undefined||value===this.attrs[key]);}return this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){document.activeElement=this;}
  get classList(){return {remove(){},add(){},toggle(){}};}
 }
 function parse(html){const root=new Node('root'),stack=[root];for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}let node;if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};for(const [,key,value] of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[key]=value??'';node=new Node(tag,attrs);stack.at(-1).children.push(node);node.parentElement=stack.at(-1);if(!['input','br','hr','img','link','meta'].includes(tag))stack.push(node);}else{node=new Node('#text');node.text=token;stack.at(-1).children.push(node);node.parentElement=stack.at(-1);}}return root.children;}
 document={createElement:tag=>new Node(tag),addEventListener(){},removeEventListener(){}};document.body=new Node('body');document.body.innerHTML='<nav id="nav"></nav><div id="identity"></div><main id="content"></main>';document.querySelector=selector=>document.body.querySelector(selector);document.querySelectorAll=selector=>document.body.querySelectorAll(selector);document.activeElement=document.body;
 const target=document.querySelector('#content'),calls=[],messages=[],actor={user_id:'actor',role:'owner',active:true};
 const c=vm.createContext({workspacePageHeader,document,$:selector=>document.querySelector(selector),view,me:signedIn?actor:null,sessionLoadEpoch:0,listsEpoch:0,listsLoaded:false,listsLoading:null,organizations:[],contacts:[],products:[],selected:'',inventorySection:'stock',booksSection:'overview',personalSection:'event',personalPage:0,personalMonth:'2026-10',salesSection:'proformas',salesEditing:'',salesFocusedProforma:'',salesFocusedDelivery:'',shared,
  esc:value=>String(value??'').replace(/[&<>"']/g,ch=>'&#'+ch.charCodeAt(0)+';'),friendlyError:error=>error.message,message:(text,error)=>messages.push({text,error}),employeeName:()=> 'Current employee',syncWorkspaceNavigation(){},workspaceUsesSharedLists:()=>c.shared,firstAccount:()=> 'first-client',scan(){},
  client:{auth:{getUser:async()=>{calls.push('auth');return c.authWait?c.authWait.promise:{data:{user:{id:'actor'}}};},signOut:async()=>{calls.push('signOut');c.me=null;c.sessionLoadEpoch++;}}},
  twoStepNeeded:async()=>{calls.push('mfa');return c.mfaWait?c.mfaWait.promise:!!c.mfa;},requirePasswordChange:()=>{calls.push('password');if(c.passwordRequired)target.innerHTML='<section id="passwordGate">Choose password</section>';return !!c.passwordRequired;},twoStepSetupRequired:async()=>{calls.push('setup');return !!c.setup;},
  showTwoStepPrompt:()=>{calls.push('mfaGate');target.innerHTML='<section id="mfaGate">Verification</section>';},showTwoStepSetupRequired:()=>{calls.push('setupGate');target.innerHTML='<section id="setupGate">Enroll</section>';},
  loadMyStaffRow:async()=>{calls.push('staff');return c.staffWait?c.staffWait.promise:{data:actor};},loadEmployeeNames:async()=>{calls.push('names');if(c.namesWait)await c.namesWait.promise;},fetchLists:async()=>{calls.push('lists');if(c.listWait)return c.listWait.promise;return {o:[],c:[],p:[],record:null};},
  login:()=>{calls.push('login');c.me=null;c.sessionLoadEpoch++;target.innerHTML='<form id="login">Sign in</form>';},run:fn=>{c.running=fn();return c.running;}
 });
 for(const name of ['dashboardWorkspace','personalWorkspace','inventoryWorkspace','profileView'])c[name]=()=>{calls.push(name);target.innerHTML='<article id="loaded">Current page</article>';};
 vm.runInContext(read('ui-motion.js'),c);
 vm.runInContext(read('workspace-refresh.js').split('async function workspaceRefreshRun')[0],c);
 vm.runInContext(app.slice(app.indexOf('function loadLists(){'),app.indexOf('function firstAccount()'))+'\n'+line('function workspaceLoadFailure(')+'\n'+line('async function load(){')+'\n'+line('function render(){'),c);
 return {c,target,document,calls,messages,actor};
}
test('blank startup shows only neutral static shapes before auth, with no business reads or duplicate loading notice',async()=>{
 const f=fixture();f.c.authWait=deferred();const loading=f.c.load();assert.ok(f.target.querySelector('.workspace-skeleton--cards'));assert.equal(f.target.querySelectorAll('[role="status"]').length,1);assert.equal(f.target.textContent,'Loading your workspace…');assert.deepEqual(f.calls,['auth']);assert.deepEqual(f.messages,[{text:'',error:undefined}]);assert.equal(f.target.querySelector('button'),null);
 f.c.authWait.resolve({data:{user:{id:'actor'}}});await loading;assert.deepEqual(f.calls,['auth','mfa','password','setup','staff','names','dashboardWorkspace']);assert.equal(f.target.querySelector('.workspace-skeleton'),null);
});
test('bootstrap preserves MFA, temporary password and enrollment order before any staff/list/name reads',async()=>{
 for(const [flag,expected,gate] of [['mfa',['auth','mfa','mfaGate'],'mfaGate'],['passwordRequired',['auth','mfa','password'],'passwordGate'],['setup',['auth','mfa','password','setup','setupGate'],'setupGate']]){const f=fixture({shared:true});f.c[flag]=true;await f.c.load();assert.deepEqual(f.calls,expected);assert.ok(f.target.querySelector('#'+gate));assert.equal(f.target.querySelector('.workspace-skeleton'),null);}
 const f=fixture();f.c.authWait=deferred();const load=f.c.load();f.c.authWait.resolve({error:{message:'No session'},data:{user:null}});await load;assert.deepEqual(f.calls,['auth','login']);assert.ok(f.target.querySelector('#login'));
});
test('an inactive staff response still signs out, restores sign-in and surfaces the existing authorization error',async()=>{
 const f=fixture();f.c.staffWait=deferred();const loading=f.c.load();await tick();f.c.staffWait.resolve({data:{...f.actor,active:false}});await assert.rejects(loading,/not on the active staff list/);assert.deepEqual(f.calls,['auth','mfa','password','setup','staff','signOut','login']);assert.ok(f.target.querySelector('#login'));assert.equal(f.target.querySelector('[data-workspace-retry]'),null);
});
test('signed-in refresh retains existing nodes, disclosure state, focused draft and scroll while auth/names load',async()=>{
 const f=fixture({signedIn:true});f.target.innerHTML='<article><details open><summary>Current record</summary><input id="draft" value="Unsaved"></details><button id="refresh">Refresh</button></article>';const card=f.target.firstElementChild,input=f.target.querySelector('#draft');input.focus();f.target.scrollTop=340;f.c.authWait=deferred();f.c.namesWait=deferred();const loading=f.c.load();assert.equal(f.target.firstElementChild,card);assert.equal(f.document.activeElement,input);f.c.authWait.resolve({data:{user:{id:'actor'}}});await tick();assert.equal(f.target.firstElementChild,card);assert.equal(f.target.scrollTop,340);assert.ok(f.target.querySelector('[open]'));assert.equal(f.target.querySelector('.workspace-skeleton'),null);f.c.namesWait.resolve();await loading;assert.equal(f.calls.filter(value=>value==='auth').length,1);
});
test('blank shared-list gate shows route geometry and shares the in-flight read without duplicate loading labels',async()=>{
 const f=fixture({shared:true,view:'inventory',signedIn:true});f.c.listWait=deferred();const first=f.c.render(),second=f.c.render();assert.ok(f.target.querySelector('.workspace-skeleton--stock-lots'));assert.equal(f.target.querySelectorAll('[role="status"]').length,1);assert.equal(f.calls.filter(value=>value==='lists').length,1);assert.deepEqual(f.messages.map(row=>row.text),['','']);f.c.listWait.resolve({o:[],c:[],p:[],record:null});await Promise.all([first,second]);assert.equal(f.calls.filter(value=>value==='inventoryWorkspace').length,1);assert.ok(f.target.querySelector('#loaded'));
});
test('shared-list refresh retains the current page and does not replace it with placeholders',async()=>{
 const f=fixture({shared:true,view:'contacts',signedIn:true});f.target.innerHTML='<article><input id="search" value="Clinic"><details open><summary>Branch</summary></details><button id="refresh">Refresh</button></article>';const card=f.target.firstElementChild,input=f.target.querySelector('#search');input.focus();f.c.listWait=deferred();const pending=f.c.render();assert.equal(f.target.firstElementChild,card);assert.equal(f.document.activeElement,input);f.c.listWait.reject(Error('Offline'));await pending;assert.equal(f.target.firstElementChild,card);assert.equal(f.document.activeElement,input);assert.ok(f.target.querySelector('[open]'));assert.match(f.messages.at(-1).text,/Offline/);assert.equal(f.target.querySelector('.workspace-skeleton'),null);
});
test('initial auth/names/list failures replace only the owned skeleton with escaped error and guarded read-only Retry',async()=>{
 for(const stage of ['authWait','namesWait','listWait']){const f=fixture({shared:stage==='listWait',view:stage==='listWait'?'contacts':'dashboard',signedIn:stage==='listWait'});f.c[stage]=deferred();const pending=stage==='listWait'?f.c.render():f.c.load();await tick();f.c[stage].reject(Error('Offline <private>'));if(stage==='listWait')await pending;else await assert.rejects(pending,/Offline/);assert.equal(f.target.querySelector('.workspace-skeleton'),null);assert.match(f.target.innerHTML,/Offline &#60;private&#62;/);const retry=f.target.querySelector('[data-workspace-retry]');assert.ok(retry);f.c[stage]=null;await retry.onclick();assert.ok(f.target.querySelector('#loaded'));assert.equal(f.calls.filter(value=>value==='auth').length,stage==='listWait'?0:2);assert.equal(f.calls.filter(value=>value==='lists').length,stage==='listWait'?2:0);}
});
test('stale startup and list responses or Retry callbacks cannot repaint another actor, route, epoch or content root',async()=>{
 for(const kind of ['startup','lists'])for(const change of ['actor','route','epoch','root']){const f=fixture({shared:kind==='lists',view:kind==='lists'?'contacts':'dashboard',signedIn:kind==='lists'}),wait=deferred();if(kind==='startup')f.c.namesWait=wait;else f.c.listWait=wait;const pending=kind==='startup'?f.c.load():f.c.render();await tick();
  if(change==='actor')f.c.me={...f.actor};if(change==='route')f.c.view='inventory';if(change==='epoch')f.c.sessionLoadEpoch++;if(change==='root'){const replacement=f.document.createElement('main');replacement.attrs.id='content';f.document.body.replaceChildren(replacement);}const current=f.document.querySelector('#content');current.innerHTML='<article id="newer">New screen</article>';wait.reject(Error('Old read'));if(kind==='startup')await assert.rejects(pending,/Old read/);else await pending;assert.ok(current.querySelector('#newer'));assert.equal(current.querySelector('[data-workspace-retry]'),null);
 }
 const f=fixture();f.c.namesWait=deferred();const pending=f.c.load();await tick();f.c.namesWait.reject(Error('Offline'));await assert.rejects(pending);const retry=f.target.querySelector('[data-workspace-retry]'),before=f.calls.length;f.c.me={...f.actor};await retry.onclick();assert.equal(f.calls.length,before);
});
test('shared-list completion cannot draw after navigation and bootstrap keeps the original concurrent list/name ordering',async()=>{
 const f=fixture({shared:true,view:'contacts'});f.c.listWait=deferred();f.c.namesWait=deferred();const pending=f.c.load();await tick();assert.deepEqual(f.calls,['auth','mfa','password','setup','staff','lists','names']);f.c.namesWait.resolve();f.c.listWait.resolve({o:[],c:[],p:[],record:null});await pending;assert.equal(f.calls.filter(value=>value==='lists').length,1);assert.ok(f.calls.includes('profileView'));
 const g=fixture({shared:true,view:'contacts',signedIn:true});g.c.listWait=deferred();const loading=g.c.render();g.c.view='inventory';g.target.innerHTML='<article>New inventory route</article>';g.c.listWait.resolve({o:[],c:[],p:[],record:null});await loading;assert.equal(g.target.textContent,'New inventory route');assert.equal(g.calls.includes('profileView'),false);
});

test('authored source loads the helper before app startup and after every wrapped workspace renderer',()=>{
 const scripts=[...read('index.src.html').matchAll(/<script src="([^"?]+)/g)].map(match=>match[1]),helper=scripts.indexOf('workspace-refresh.js'),appIndex=scripts.indexOf('app.js');assert.ok(helper>=0&&helper<appIndex);
 for(const file of ['inventory-operations.js','sales-delivery.js','service-workflow.js','purchasing.js','sales-leads.js','customer-requests.js','personal-workspace.js','team-tasks.js','accounting-workspace.js','accounting-ledger.js','pending-stock.js','customer-contracts.js','product-pricing.js','travel.js','stock-count.js','tally-invoices.js','project-approvals.js'])assert.ok(scripts.indexOf(file)<helper,file);
 const context=vm.createContext({workspacePageHeader,});vm.runInContext(read('workspace-refresh.js'),context);assert.match(context.workspaceSkeleton('cards','Loading your workspace…'),/workspace-skeleton--cards/);
});

test('a busy Retry refusal keeps its existing error and recovery control intact',async()=>{
 const f=fixture();f.c.authWait=deferred();const loading=f.c.load();f.c.authWait.reject(Error('Offline'));await assert.rejects(loading);const retry=f.target.querySelector('[data-workspace-retry]'),error=f.target.firstElementChild,before=f.calls.length;f.c.run=()=>{};await retry.onclick();assert.equal(f.target.firstElementChild,error);assert.equal(f.target.querySelector('[data-workspace-retry]'),retry);assert.equal(f.calls.length,before);
});
