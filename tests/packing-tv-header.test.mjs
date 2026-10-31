import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const board=()=>({waiting:[],packing:[],mine:null,can_release:false,coming:{count:0},offset:0,amber_minutes:20,overdue_minutes:30});
function fixture(data=null,error=''){
 const document=dom(),keys=[],exits=[],reads=[];document.body.innerHTML='<nav id="nav"><button data-view="packing" data-workspace-section="queue">Packing queue</button></nav><main id="content"></main>';
 document.addEventListener=(name,fn)=>{if(name==='keydown')keys.push(fn);};document.body.classList={contains:name=>name==='packing-tv'};
 document.querySelector('#nav button').click=()=>exits.push('queue');
 const c=vm.createContext({document,workspacePageHeader,statusTone,esc,Date,setInterval(){},clearInterval(){},view:'packing',$:selector=>document.querySelector(selector),__board:data,__error:error,client:{rpc:(...args)=>{reads.push(args);throw Error('Header must not read or write');}}});
 vm.runInContext('function workspaceSkeleton(kind,label)'+source('workspace-refresh.js').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],c);
 vm.runInContext(source('packing-queue.js'),c);vm.runInContext("packingSection='screen';packingBoard=__board;packingError=__error;",c);
 const root=document.querySelector('#content');root.innerHTML=c.packingScreenHtml();c.bindPackingQueue();
 return {c,root,document,exits,reads,key:event=>keys.forEach(fn=>fn(event))};
}
for(const [label,data,error] of [['loading',null,''],['error',null,'Could not load <script>unsafe</script>'],['empty',board(),''],['loaded',{...board(),waiting:[{id:'wait',delivery_number:'DN-000001',organization:'Client',queued_at:new Date().toISOString(),items:[]}],packing:[{id:'active',delivery_number:'DN-000002',organization:'Another client',packer_name:'Employee',taken_at:new Date().toISOString(),items:[]} ]},'']]){
 test(`Packing TV ${label} has one shared heading and one working Exit before the title`,()=>{
  const f=fixture(data,error),headers=f.root.querySelectorAll('.workspace-page-header'),heading=f.root.querySelector('h1'),exit=f.root.querySelector('[data-packing-exit]');
  assert.equal(headers.length,1);assert.equal(f.root.querySelectorAll('h1').length,1);assert.equal(heading.textContent,'Packing queue');assert.equal(f.root.querySelectorAll('[data-packing-exit]').length,1);
  assert.equal(exit.closest('.workspace-page-back')?.closest('.workspace-page-header'),headers[0]);assert.ok(headers[0].innerHTML.indexOf('data-packing-exit')<headers[0].innerHTML.indexOf('<h1'));assert.equal(exit.getAttribute('aria-label'),'Exit TV screen to packing queue');
  exit.onclick();assert.deepEqual(f.exits,['queue']);assert.deepEqual(f.reads,[]);
  if(error){assert.equal(f.root.querySelector('script'),null);assert.equal(f.root.querySelector('[role="alert"]').textContent,error);}
  if(data){assert.deepEqual(f.root.querySelectorAll('h2').map(node=>node.textContent),['Waiting '+data.waiting.length,'Packing now '+data.packing.length]);assert.ok(f.root.querySelector('[data-packing-updated]'));}
  else if(!error)assert.ok(f.root.querySelector('.workspace-skeleton-screen'));
 });
}
test('TV header preserves the bounded waiting list, totals, clocks and escaped operational detail',()=>{
 const b=board();b.waiting=Array.from({length:21},(_,n)=>({id:'w'+n,delivery_number:'DN-'+String(n+1).padStart(6,'0'),organization:'<img src=x> Client '+n,queued_at:new Date().toISOString(),customer_waiting:n===0,items:[{quantity:3,name:'<script>Item</script>'}]}));b.packing=[{id:'p',delivery_number:'DN-000030',organization:'<b>Lab</b>',packer_name:'<img> Employee',taken_at:new Date().toISOString(),items:[]}];
 const f=fixture(b);assert.equal(f.root.querySelectorAll('.packing-tv-waiting li').length,18);assert.equal(f.root.querySelector('.packing-tv-col h2').textContent,'Waiting 21');assert.match(f.root.querySelector('.packing-tv-more').textContent,/and 3 more/);assert.equal(f.root.querySelectorAll('[data-clock]').length,1);assert.equal(f.root.querySelector('img'),null);assert.equal(f.root.querySelector('script'),null);assert.match(f.root.textContent,/CUSTOMER WAITING/);assert.match(f.root.textContent,/3 <script>Item<\/script>/);
});
test('TV Escape still routes to the original queue control and respects an open dialog',()=>{
 const f=fixture(board());f.key({key:'Escape'});assert.deepEqual(f.exits,['queue']);const dialog=f.document.createElement('dialog');dialog.setAttribute('open','');f.document.body.append(dialog);f.key({key:'Escape'});assert.deepEqual(f.exits,['queue']);
});
test('normal Packing queue retains its own heading/actions with no TV Exit',()=>{
 const f=fixture(board());f.root.innerHTML=f.c.packingQueueHtml();assert.equal(f.root.querySelectorAll('h1').length,1);assert.equal(f.root.querySelector('h1').textContent,'Packing queue');assert.equal(f.root.querySelector('.workspace-page-back'),null);assert.ok(f.root.querySelector('[data-packing-refresh]'));assert.ok(f.root.querySelector('[data-packing-screen]'));assert.ok(f.root.querySelector('[data-packing-take]'));assert.equal(f.root.querySelector('[data-packing-exit]'),null);assert.deepEqual(f.reads,[]);
});
