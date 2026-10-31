import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cases,openMainPageScenario} from './helpers/main-page-scenarios.mjs';
import {parseCss} from '../scripts/audit-design-tokens.mjs';

const targets=[['Products','#newProduct'],['Pro formas','#newProforma'],['Leads','#newLead'],['Pending stock','#newPending'],['Purchasing','#newPurchase'],['Suppliers','#newSupplier'],['Travel','#travelNew'],['Contracts','[data-contract-new]']];
async function fixture(page='Products',role='owner'){
 const sizes=new Map(),observers=[],styles=new Map(),mutations=[];
 const f=await openMainPageScenario(cases.find(entry=>entry.name===page),role,f=>{
  f.ctx.ResizeObserver=class{constructor(callback){this.callback=callback;this.nodes=[];this.disconnected=false;observers.push(this);}observe(node){this.nodes.push(node);}disconnect(){this.disconnected=true;}};
  f.document.documentElement._style={setProperty:(key,value)=>styles.set(key,value),removeProperty:key=>styles.delete(key)};
 });
 const original=f.document.querySelector(targets.find(([name])=>name===page)?.[1]||'#not-a-primary');
 if(original)original.getBoundingClientRect=()=>({height:sizes.get(original)??52});
 // Use a delivered mutation batch, without making the read-budget fixture a browser emulator.
 f.ctx.MutationObserver=class{constructor(callback){this.callback=callback;mutations.push(this);}observe(node,options){this.node=node;this.options=options;}};
 f.evaluate('workspacePrimaryWatch.disconnect();workspacePrimaryWatch=null');f.ctx.installWorkspacePrimaryAction();
 return {...f,original,sizes,styles,observers,mutations,sync:()=>mutations[0].callback()};
}

for(const [page,selector] of targets)test(`${page}: every permitted role keeps its original primary control, handler and read budget`,async()=>{
 for(const role of cases.find(entry=>entry.name===page).roles){
  const f=await fixture(page,role),button=f.original,reads=f.calls.length;
  if(!button){assert.equal(f.document.querySelector('[data-workspace-primary]'),null);assert.equal(f.styles.size,0);continue;}
  const parent=button.parentElement,handler=button.onclick;
  if(page==='Products')assert.ok(f.document.body.events.click?.length,'Add product retains the app delegated click handler');else assert.ok(handler||button.events.click?.length,'Existing authored action is bound');
  assert.equal(f.ctx.workspacePrimaryCandidate(),button);assert.equal(button.hasAttribute('data-workspace-primary'),true);assert.equal(f.document.documentElement.hasAttribute('data-workspace-primary'),true);
  assert.equal(f.document.querySelectorAll(selector).length,1);assert.equal(f.observers.at(-1).nodes[0],button);assert.equal(f.styles.get('--workspace-primary-height'),'52px');
  f.sync();f.sync();assert.equal(f.document.querySelector(selector),button);assert.equal(button.parentElement,parent);assert.equal(button.onclick,handler);assert.equal(f.observers.length,1);assert.equal(f.calls.length,reads);
 }
});

test('wrapped labels reserve their rendered height and stale resize callbacks cannot affect a replacement',async()=>{
 const f=await fixture(),first=f.original,old=f.observers[0];f.sizes.set(first,91.25);old.callback();assert.equal(f.styles.get('--workspace-primary-height'),'92px');
 const next=f.document.createElement('button');next.id='newProduct';next.getBoundingClientRect=()=>({height:104});first.replaceWith(next);f.sync();
 assert.equal(old.disconnected,true);assert.equal(first.hasAttribute('data-workspace-primary'),false);assert.equal(f.styles.get('--workspace-primary-height'),'104px');
 f.sizes.set(first,900);old.callback();assert.equal(f.styles.get('--workspace-primary-height'),'104px');assert.equal(f.observers.at(-1).nodes[0],next);
 next.remove();f.observers.at(-1).callback();f.sync();assert.equal(f.styles.size,0);assert.equal(f.document.documentElement.hasAttribute('data-workspace-primary'),false);
});

test('hidden, inert, permission-removed and signed-out controls release their measurement',async()=>{
 const f=await fixture(),button=f.original,nav=f.document.getElementById('nav'),actions=button.parentElement;
 for(const [node,key] of [[button,'hidden'],[actions,'hidden'],[actions,'inert'],[nav,'hidden']]){
  const resize=f.observers.at(-1);node[key]=true;f.sync();assert.equal(f.ctx.workspacePrimaryCandidate(),null);assert.equal(button.hasAttribute('data-workspace-primary'),false);assert.equal(resize.disconnected,true);assert.equal(f.styles.size,0);
  resize.callback();assert.equal(f.styles.size,0);node[key]=false;f.sync();assert.equal(f.ctx.workspacePrimaryCandidate(),button);
 }
 button.disabled=true;f.sync();assert.equal(button.disabled,true,'Layout must not unlock an action');assert.equal(f.ctx.workspacePrimaryCandidate(),button);
 button.remove();f.sync();assert.equal(f.ctx.workspacePrimaryCandidate(),null);assert.equal(f.styles.size,0);
});

test('only the current landing header is eligible; detail and editor markers keep their normal actions',async()=>{
 for(const [page,marker] of [['Leads','<button id="leadBack">Back to leads</button>'],['Pending stock','<form id="pendingForm"></form>'],['Pending stock','<div data-pending-history-output="selected-request"></div>'],['Travel','<button id="travelClose">Close details</button>'],['Contracts','<button data-contract-back>All contracts</button>']]){
  const f=await fixture(page),host=f.document.createElement('section');host.innerHTML=marker;f.document.getElementById('content').append(host);f.sync();
  assert.equal(f.ctx.workspacePrimaryCandidate(),null,page);assert.equal(f.original.hasAttribute('data-workspace-primary'),false);host.remove();f.sync();assert.equal(f.ctx.workspacePrimaryCandidate(),f.original);
 }
 const f=await fixture();const actions=f.original.parentElement,form=f.document.createElement('form');actions.before(form);form.append(actions);f.sync();assert.equal(f.ctx.workspacePrimaryCandidate(),null,'A form is never a landing action');
});

test('unrelated primary, Refresh, packing and delivery buttons never receive a fixed action marker',async()=>{
 for(const page of ['Packing','Delivery','Prices','Books accounts']){
  const f=await fixture(page);assert.equal(f.ctx.workspacePrimaryCandidate(),null);assert.equal(f.document.querySelector('[data-workspace-primary]'),null);assert.equal(f.observers.length,0);
 }
 const f=await fixture(),outside=f.document.createElement('button');outside.id='newProduct';f.original.remove();f.document.getElementById('content').append(outside);f.sync();assert.equal(f.ctx.workspacePrimaryCandidate(),null,'Matching IDs outside the header are not enough');
});

test('a route or session replacement clears the original node without adding focus or click handlers',async()=>{
 const f=await fixture(),button=f.original,click=button.onclick,events=Object.keys(button.events),focused=f.document.querySelector('#catalogSearch');focused.focus();
 const content=f.document.getElementById('content');content.innerHTML=f.ctx.workspacePageHeader({title:'Another page',actions:'<button id="refresh">Refresh</button>'});f.sync();
 assert.equal(f.observers[0].disconnected,true);assert.equal(button.hasAttribute('data-workspace-primary'),false);assert.equal(button.onclick,click);assert.deepEqual(Object.keys(button.events),events);assert.equal(f.styles.size,0);assert.equal(f.document.activeElement,f.document.body,'No layout helper focus transfer');
});

test('phone CSS reserves measured space, keeps16px gutters and8px tab gap, and removes obscured actions from focusability',()=>{
 const css=readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8'),start=css.indexOf('/* Only the existing, eligible landing action'),end=css.indexOf('.workspace-page-breadcrumbs>#profileBreadcrumb',start),block=css.slice(start,end),rules=parseCss(block).declarations;
 assert.ok(start>0);for(const rule of rules)assert.deepEqual(rule.media,['@media screen and (max-width:600px)']);
 const values=selector=>new Map(rules.filter(rule=>rule.selector===selector).map(rule=>[rule.property,rule.value])),button=values('.workspace-page-actions>[data-workspace-primary]');
 assert.equal(button.get('position'),'fixed');assert.equal(button.get('z-index'),'4');assert.equal(button.get('min-height'),'52px');assert.equal(button.get('height'),undefined);assert.equal(button.get('left'),'16px');assert.equal(button.get('right'),'16px');assert.equal(button.get('padding'),'var(--space-1) var(--space-4)');assert.equal(button.get('bottom'),'calc(var(--workspace-shortcut-height,var(--shortcut-height)) + var(--space-2))');assert.equal(button.get('white-space'),'normal');assert.equal(button.get('width'),'auto');
 const reserve='calc(var(--workspace-shortcut-height,var(--shortcut-height)) + var(--workspace-primary-height,var(--control-phone)) + var(--space-5))';
 assert.equal(values('html[data-workspace-primary]').get('scroll-padding-bottom'),reserve);assert.equal(values('html[data-workspace-primary] body:has(#nav:not([hidden]))>main').get('padding-bottom'),reserve);
 const hidden=rules.find(rule=>rule.property==='visibility');assert.equal(hidden.value,'hidden');for(const scope of ['body:has(#nav[data-mobile-open="true"])','body:has(dialog[open])','body:not(:has(#nav:not([hidden])))'])assert.ok(hidden.selector.includes(scope));assert.equal(values(hidden.selector).get('pointer-events'),'none');
 // visibility:hidden, unlike opacity:0, removes the original button from native sequential and programmatic focus.
 assert.doesNotMatch(block,/opacity:0|transition|animation|\!important/);assert.equal(values('.workspace-page-actions:has(>[data-workspace-primary]:only-child)').get('display'),'contents');
});
