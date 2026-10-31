import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../ui-motion.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(reduced=false){
 const document=dom(),animations=[],events={},create=document.createElement.bind(document);
 document.addEventListener=(name,callback)=>events[name]=callback;document.getElementById=id=>document.querySelector('#'+id);
 document.createElement=tag=>{const node=create(tag);node.style={};node.getBoundingClientRect=()=>({left:100,top:100,width:400,height:200});node.animate=(frames,options)=>{let finish,reject;const finished=new Promise((a,b)=>{finish=a;reject=b;});const animation={frames,options,finished,finish,cancel:()=>reject(Error('cancelled'))};animations.push(animation);return animation;};return node;};
 const ctx=vm.createContext({document,matchMedia:()=>({matches:reduced}),getComputedStyle:node=>({opacity:node.opacity??'1',transform:node.transform??'none',getPropertyValue:key=>({'--m-menu':'120ms','--m-fast':'100ms','--m-fade':'150ms','--ease-out':'ease-out'}[key])})});vm.runInContext(source,ctx);
 const panel=document.createElement('div');panel.hidden=true;document.body.append(panel);
 return {ctx,document,panel,animations,events,last:()=>animations.at(-1),complete:async()=>{animations.at(-1).finish();await tick();}};
}
test('popover enters from its anchor; content updates do not restart the animation',async()=>{
 const f=fixture(),anchor=f.document.createElement('button');anchor.getBoundingClientRect=()=>({left:20,top:20,width:44,height:44});
 const opening=f.ctx.setWorkspacePopover(f.panel,true,{anchor});assert.equal(f.panel.hidden,false);assert.equal(f.panel.inert,false);assert.equal(f.last().options.duration,120);assert.equal(f.last().frames[0].transform,'scale(.98)');assert.equal(f.panel.style.transformOrigin,'0px 0px');
 assert.equal(f.ctx.setWorkspacePopover(f.panel,true),opening);assert.equal(f.animations.length,1);await f.complete();assert.equal(await opening,true);
});
test('exit prevents selection immediately and hides only after its100ms fade',async()=>{
 const f=fixture();f.ctx.setWorkspacePopover(f.panel,true);await f.complete();const closing=f.ctx.setWorkspacePopover(f.panel,false);assert.equal(f.panel.inert,true);assert.equal(f.panel.hidden,false);assert.equal(f.last().options.duration,100);assert.equal(f.last().frames[0].transform,f.last().frames[1].transform);await f.complete();assert.equal(await closing,true);assert.equal(f.panel.hidden,true);assert.equal(f.panel.inert,false);
});
test('open-close-open reverses from the rendered frame and stale exits cannot hide the reopened menu',async()=>{
 const f=fixture(),first=f.ctx.setWorkspacePopover(f.panel,true);f.panel.opacity='.65';f.panel.transform='matrix(.99,0,0,.99,0,0)';const closing=f.ctx.setWorkspacePopover(f.panel,false),reopening=f.ctx.setWorkspacePopover(f.panel,true);assert.equal(f.last().frames[0].opacity,'.65');assert.equal(f.last().frames[0].transform,f.panel.transform);assert.equal(f.panel.inert,false);await f.complete();assert.equal(await first,false);assert.equal(await closing,false);assert.equal(await reopening,true);assert.equal(f.panel.hidden,false);
});
test('reduced motion keeps150ms fades with no transforms',async()=>{
 const f=fixture(true);f.ctx.setWorkspacePopover(f.panel,true);assert.equal(f.last().options.duration,150);assert.ok(f.last().frames.every(frame=>!('transform'in frame)));await f.complete();f.ctx.setWorkspacePopover(f.panel,false);assert.equal(f.last().options.duration,150);assert.ok(f.last().frames.every(frame=>!('transform'in frame)));await f.complete();
});
test('immediate cleanup cancels pending animation and preserves the original inert setting',async()=>{
 for(const original of [false,true]){const f=fixture();f.panel.inert=original;const opening=f.ctx.setWorkspacePopover(f.panel,true);await f.ctx.setWorkspacePopover(f.panel,false,{immediate:true});assert.equal(await opening,false);assert.equal(f.panel.hidden,true);assert.equal(f.panel.inert,original);}
});
test('account menu Escape returns focus after exit; reopening interrupts that focus return',async()=>{
 const f=fixture(),menu=f.document.createElement('details'),summary=f.document.createElement('summary');menu.setAttribute('id','accountMenu');f.panel.setAttribute('class','account-menu-actions');menu.append(summary,f.panel);f.document.body.append(menu);f.ctx.bindWorkspaceAccountMenu(menu);
 summary.onclick({preventDefault(){}});await f.complete();assert.equal(menu.open,true);menu.onkeydown({key:'Escape',preventDefault(){}});assert.equal(menu.open,true);summary.onclick({preventDefault(){}});await f.complete();assert.equal(menu.open,true);assert.notEqual(f.document.activeElement,summary);
 menu.onkeydown({key:'Escape',preventDefault(){}});await f.complete();assert.equal(menu.open,false);assert.equal(f.document.activeElement,summary);
});
test('outside click closes the current account menu without moving focus',async()=>{
 const f=fixture(),menu=f.document.createElement('details'),summary=f.document.createElement('summary'),outside=f.document.createElement('button');menu.setAttribute('id','accountMenu');f.panel.setAttribute('class','account-menu-actions');menu.append(summary,f.panel);f.document.body.append(menu,outside);f.ctx.bindWorkspaceAccountMenu(menu);summary.onclick({preventDefault(){}});await f.complete();outside.focus();f.events.click({target:outside});await f.complete();assert.equal(menu.open,false);assert.equal(f.document.activeElement,outside);
});

 test('clearing notification identity hides old updates immediately even during entry',async()=>{
 const f=fixture();f.ctx.setInterval=()=>0;vm.runInContext(readFileSync(new URL('../notification-bell.js',import.meta.url),'utf8'),f.ctx);const bell=f.document.createElement('div');bell.setAttribute('id','bell');f.panel.setAttribute('class','bell-panel');bell.append(f.panel);f.document.body.append(bell);f.panel.textContent='Previous employee update';const opening=f.ctx.setWorkspacePopover(f.panel,true);f.ctx.clearNotificationBell();assert.equal(f.panel.hidden,true);assert.equal(f.panel.textContent,'');assert.equal(await opening,false);
 });
