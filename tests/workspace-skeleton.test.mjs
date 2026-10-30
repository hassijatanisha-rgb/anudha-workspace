import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('workspace-refresh.js');
// A minimal parsed DOM for static structure and lifecycle assertions; no native layout claims.
function fixture(extra={}){
 let document;
 class Element{
  constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.children=[];this.parentElement=null;this.text='';}
  get firstChild(){return this.children[0]||null;}get firstElementChild(){return this.children.find(node=>node.tagName!=='#TEXT')||null;}
  get textContent(){return this.text+this.children.map(node=>node.textContent).join('');}
  set innerHTML(html){this.replaceChildren(...parse(html));}get innerHTML(){return this.children.map(node=>node.outerHTML).join('');}
  get outerHTML(){return this.tagName==='#TEXT'?this.text:`<${this.tagName.toLowerCase()}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('')}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=nodes;for(const node of nodes)node.parentElement=this;}
  setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){if(selector.startsWith('.'))return (this.attrs.class||'').split(' ').includes(selector.slice(1));if(selector.startsWith('#'))return this.attrs.id===selector.slice(1);if(selector.startsWith('[')){const [,key,value]=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return key in this.attrs&&(value===undefined||this.attrs[key]===value);}return this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(selector.split(',').some(s=>child.matches(s.trim())))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  get classList(){const set=(name,on)=>{const values=new Set((this.attrs.class||'').split(' ').filter(Boolean));if(on)values.add(name);else values.delete(name);this.attrs.class=[...values].join(' ');};return {add:(...names)=>names.forEach(name=>set(name,true)),remove:(...names)=>names.forEach(name=>set(name,false)),toggle:set};}
 }
 function parse(html){const root=new Element('root'),stack=[root];for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}let node;if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];assert.ok(tag,'Only element markup expected');const attrs={};for(const [,key,value] of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[key]=value??'';node=new Element(tag,attrs);stack.at(-1).children.push(node);node.parentElement=stack.at(-1);if(!['input','br','hr','img','link','meta'].includes(tag))stack.push(node);}else{node=new Element('#text');node.text=token;stack.at(-1).children.push(node);node.parentElement=stack.at(-1);}}assert.equal(stack.length,1,'Balanced generated markup');return root.children;}
 document={createElement:tag=>new Element(tag),addEventListener(){},removeEventListener(){}};document.body=new Element('body');document.activeElement=document.body;const target=new Element('main',{id:'content'});document.body.replaceChildren(target);document.querySelector=selector=>document.body.querySelector(selector);document.querySelectorAll=selector=>document.body.querySelectorAll(selector);
 const c=vm.createContext({workspacePageHeader,me:{user_id:'one'},view:'inventory',inventorySection:'stock',document,window:{scrollX:0,scrollY:0,addEventListener(){},removeEventListener(){},scrollTo(){}},...extra});vm.runInContext(source,c);
 return {c,document,target,parse,render:(kind,label='Loading records…')=>{target.innerHTML=c.workspaceSkeleton(kind,label);return target.firstElementChild;}};
}
const shapes={cards:['.workspace-skeleton-card',3],table:['.workspace-skeleton-row',7],'stock-lots':['.workspace-skeleton-metrics',1],prices:['.workspace-skeleton-card',3],report:['.workspace-skeleton-table',1],calendar:['.workspace-skeleton-day',35],notes:['.workspace-skeleton-card',2],form:['.workspace-skeleton-fields',1],document:['.workspace-skeleton-table',1],overview:['.workspace-skeleton-table',2],accounting:['.workspace-skeleton-card',7],packing:['.workspace-skeleton-card',2],'packing-screen':['.workspace-skeleton-screen',1],recycle:['.workspace-skeleton-group',5],directory:['.workspace-skeleton-group',5],profile:['.workspace-skeleton-fields',1],'task-cards':['.workspace-skeleton-group',4],queue:['.workspace-skeleton-card',3],'catalog-table':['.workspace-skeleton-row',7],metrics:['.workspace-skeleton-card',4]};
test('finite skeleton layouts contain actual bounded header, card, table, disclosure and calendar elements',()=>{
 const f=fixture();for(const [kind,[selector,count]] of Object.entries(shapes)){const root=f.render(kind);assert.ok(root.matches('.workspace-skeleton--'+kind),kind);assert.equal(root.querySelectorAll(selector).length,count,kind);assert.ok(root.querySelectorAll('span').length<200,kind);assert.equal(root.querySelectorAll('[style]').length,0,kind);assert.equal(root.querySelectorAll('button,input,select,a,details').length,0,kind);}
});
test('each layout has one escaped status label and every grey shape is hidden from accessibility APIs',()=>{
 const f=fixture();for(const kind of Object.keys(shapes)){const root=f.render(kind,'Loading <img src=x onerror=alert(1)> & "staff"…');assert.equal(root.getAttribute('aria-busy'),'true');assert.equal(root.querySelectorAll('[role="status"]').length,1);assert.equal(root.querySelectorAll('img,script').length,0);assert.match(root.querySelector('[role="status"]').textContent,/&lt;img/);assert.match(root.innerHTML,/&amp; &quot;staff&quot;/);const hidden=root.querySelector('[aria-hidden="true"]');assert.ok(hidden);assert.equal(hidden.textContent,'');assert.equal(hidden.querySelectorAll('.workspace-skeleton-bar').length,root.querySelectorAll('.workspace-skeleton-bar').length);}
 const fragment=f.render('metrics','');assert.equal(fragment.querySelectorAll('[role="status"]').length,0);assert.equal(fragment.getAttribute('aria-busy'),null);assert.ok(f.render('bad\" onclick=\"alert(1)').matches('.workspace-skeleton--cards'));
});
test('real workspaceLoading chooses route geometry and keeps existing retained-refresh lifecycle',async()=>{
 const f=fixture();for(const [globals,kind] of [[{view:'inventory',inventorySection:'stock'},'stock-lots'],[{view:'inventory',inventorySection:'locations'},'table'],[{view:'books',booksSection:'accounts',booksDraft:null},'report'],[{view:'personal',personalSection:'event'},'calendar'],[{view:'personal',personalSection:'note'},'notes'],[{view:'accounting'},'accounting'],[{view:'sales',salesEditing:'new'},'document'],[{view:'service',serviceIntakeOpen:true},'form'],[{view:'reports'},'report'],[{view:'requests'},'cards']]){Object.assign(f.c,globals);f.c.workspaceLoading('Loading page…');assert.ok(f.target.querySelector('.workspace-skeleton--'+kind),kind);}
 f.c.view='inventory';f.c.inventorySection='stock';const original=f.document.createElement('article');original.attrs.id='retained';await f.c.workspaceRefreshRun(()=>f.target.replaceChildren(original),null,[]);let finish;const loading=f.c.workspaceRefreshRun(async()=>{f.c.workspaceLoading('Loading…');await new Promise(resolve=>finish=resolve);},null,[]);assert.equal(f.target.firstChild,original);assert.equal(original.inert,true);assert.equal(f.target.querySelector('.workspace-skeleton'),null);finish();await loading;assert.equal(original.inert,undefined);assert.equal(f.target.getAttribute('aria-busy'),null);
});
test('first-load failures remain retryable first loads and never seed retained-ready state',async()=>{
 const f=fixture();await assert.rejects(f.c.workspaceRefreshRun(async()=>{f.c.workspaceLoading('Loading stock…');throw Error('Offline');},null,[]),/Offline/);assert.equal(vm.runInContext('workspaceRefreshReady',f.c),null);await assert.rejects(f.c.workspaceRefreshRun(async()=>{f.c.workspaceLoading('Loading stock…');f.target.innerHTML='<p role="alert">Offline</p><button>Retry</button>';throw Error('Offline');},null,[]),/Offline/);assert.equal(f.target.querySelector('[role="alert"]').textContent,'Offline');assert.equal(f.target.getAttribute('aria-busy'),null);
 // The caller owns the error UI and retry. A new actor can never retain an old actor's data.
 f.c.me={user_id:'two'};let finish;const retry=f.c.workspaceRefreshRun(async()=>{f.c.workspaceLoading('Loading stock…');await new Promise(resolve=>finish=resolve);f.target.innerHTML='<article>Current data</article>';},null,[]);assert.ok(f.target.querySelector('.workspace-skeleton--stock-lots'));finish();await retry;assert.equal(f.target.querySelector('.workspace-skeleton'),null);
});
test('packing queue and TV first loads use their real layouts; failed loading retains Retry and Exit actions',()=>{
 const f=fixture({view:'packing',esc:String,setInterval(){}});vm.runInContext(read('packing-queue.js'),f.c);f.target.innerHTML=f.c.packingQueueHtml();assert.ok(f.target.querySelector('.workspace-skeleton--packing'));f.target.innerHTML=f.c.packingScreenHtml();assert.ok(f.target.querySelector('.workspace-skeleton--packing-screen'));assert.ok(f.target.querySelector('[data-packing-exit]'));vm.runInContext("packingError='Offline'",f.c);f.target.innerHTML=f.c.packingQueueHtml();assert.ok(f.target.querySelector('[data-packing-refresh]'));assert.equal(f.target.querySelector('.workspace-skeleton'),null);f.target.innerHTML=f.c.packingScreenHtml();assert.equal(f.target.querySelector('[role="alert"]').textContent,'Offline');assert.ok(f.target.querySelector('[data-packing-exit]'));
});
test('actual profile loader mounts form geometry, then replaces it with its existing guarded read-failure Retry',async()=>{
 let finish;const f=fixture({view:'settings',sessionLoadEpoch:1,document:undefined});
 // Settings initialization reads local preference state; its profile target remains this parsed DOM.
 f.c.document=f.document;f.document.documentElement={style:{},dataset:{}};f.c.localStorage={getItem:()=>null};f.c.esc=String;f.c.client={rpc:()=>new Promise(resolve=>finish=resolve)};vm.runInContext(read('user-settings.js'),f.c);f.target.isConnected=true;
 const loading=f.c.loadSettingsProfile(f.target);assert.ok(f.target.querySelector('.workspace-skeleton--profile'));finish({error:{message:'Unavailable'}});await loading;assert.equal(f.target.querySelector('.workspace-skeleton'),null);assert.match(f.target.textContent,/Unavailable/);assert.ok(f.target.querySelector('[data-profile-reload]'));
});
test('approved inline main loaders call finite layouts and catalogue keeps only its existing loading announcement',()=>{
 for(const [file,kind] of [['team-tasks.js','task-cards'],['app.js','directory'],['staff-access.js','directory'],['proforma-accounting-queue.js','queue'],['recycle-bin.js','recycle'],['reports.js','report']])assert.ok(read(file).includes("workspaceSkeleton('"+kind+"',"),file);
 const catalog=read('catalog-inventory.js');assert.ok(catalog.includes("workspaceSkeleton('metrics','')"));assert.ok(catalog.includes("workspaceSkeleton('catalog-table','')"));assert.match(catalog,/id="catalogStatus" role="status"/);
});
test('standalone stylesheet preserves polish cascade, uses scalable static shapes and high-contrast alternatives',()=>{
 const css=read('workspace-skeleton.css'),html=read('index.src.html');assert.ok(html.indexOf('workspace-skeleton.css')<html.indexOf('ui-polish.css'));assert.doesNotMatch(css,/@keyframes|animation:|transition:|linear-gradient|background-image/);assert.match(css,/@media\(max-width:42rem\)/);assert.match(read('tokens.css'),/prefers-contrast:more/);assert.match(read('tokens.css'),/--skeleton-fill:var\(--ink-3\);--skeleton-edge:var\(--ink\)/);assert.match(css,/forced-colors:active/);assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);assert.doesNotMatch(read('ui-polish.css'),/workspace-first-load::after|manualTasks>p\[role="status"\]::after/);
});

test('stock has five metric placeholders, prices three, and Books overview/catalog retain four',()=>{
 const f=fixture();for(const [kind,count] of [['stock-lots',5],['prices',3],['overview',4],['metrics',4]]){const root=f.render(kind);assert.equal(root.querySelector('.workspace-skeleton-metrics').querySelectorAll('.workspace-skeleton-card').length,count);}
});
