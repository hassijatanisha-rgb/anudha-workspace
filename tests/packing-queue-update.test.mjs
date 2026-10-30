import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../packing-queue.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const order=(id,extra={})=>({id,delivery_number:'DN-'+id,version:1,customer_waiting:false,organization:'Fictional clinic',location:'Dar',queued_at:'2026-10-29T08:00:00Z',items:[{name:'Reagent',quantity:2,uom:'kit'}],promise_kind:'consumables',promised_by:null,blocked_reason:null,call_customer:false,...extra});
const initial=()=>({now:'2026-10-29T08:30:00Z',offset:0,amber_minutes:20,overdue_minutes:30,can_release:true,mine:'mine',coming:{count:0},waiting:[order('wait-a'),order('wait-b')],packing:[order('mine',{taken_at:'2026-10-29T08:20:00Z',packer_name:'Me',packer_user_id:'actor'}),order('other',{taken_at:'2026-10-29T08:21:00Z',packer_name:'Other',packer_user_id:'other'})]});
function fixture(board=initial()){
 const body={isConnected:true},document={body,activeElement:body,hidden:false,addEventListener(){}};
 const window={scrollX:12,scrollY:640,scrollTo({left,top}){this.scrollX=left;this.scrollY=top;}};
 const calls=[],messages=[];let dialog=null;
 const basic=()=>({dataset:{},parent:null,disabled:false,hidden:false,textContent:'',get isConnected(){return this.parent?.isConnected||false;},focus(options){assert.deepEqual({...options},{preventScroll:true});document.activeElement=this;},remove(){const parent=this.parent;if(parent){parent.children.splice(parent.children.indexOf(this),1);this.parent=null;if(!document.activeElement.isConnected)document.activeElement=body;}},replaceWith(next){const parent=this.parent,index=parent.children.indexOf(this);this.remove();parent.children.splice(index,0,next);next.parent=parent;}});
 const container=()=>Object.assign(basic(),{children:[],insertBefore(child,before){if(child.parent){const old=child.parent.children;old.splice(old.indexOf(child),1);}const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child);child.parent=this;}});
 const row=(id,kind,version=1)=>{
  const node=container();node.dataset[kind==='waiting'?'packingWaitingId':'packingId']=id;
  const summary=basic(),details=basic(),place=basic(),packed=basic(),release=basic();for(const child of [summary,details,place,packed,release])child.parent=node;
  details.open=true;summary.open=true;packed.dataset={packingPacked:id,version:String(version)};release.dataset={packingRelease:id,version:String(version)};
  node.querySelector=selector=>selector==='summary'?summary:selector==='details'?details:selector==='.packing-place'?place:selector==='[data-packing-packed]'?packed:selector==='[data-packing-release]'?release:null;
  return node;
 };
 const page=container();page.isRoot=true;Object.defineProperty(page,'isConnected',{value:true,writable:true});
 const waiting=container(),others=container(),personal=container(),warning=basic(),waitingCount=basic(),activeCount=basic(),empty=basic(),othersEmpty=basic(),title=basic();
 for(const element of [waiting,others,personal,warning,waitingCount,activeCount,empty,othersEmpty,title])element.parent=page;
 const mountPersonal=html=>{
  for(const child of personal.children)child.parent=null;
  personal.children=[];
  const match=html.match(/data-packing-id="([^"]+)"/),entry=match?row(match[1],'packing',Number(html.match(/data-version="(\d+)"/)?.[1]||1)):basic();
  if(!match){entry.dataset.packingTake='';entry.disabled=html.includes('data-packing-take disabled');}
  personal.insertBefore(entry,null);const text=basic();text.parent=personal;
  personal.querySelector=selector=>selector==='p'?text:match?(selector.includes('data-packing-packed')?entry.querySelector('[data-packing-packed]'):null):selector.includes('data-packing-take')&&(!selector.includes(':not(:disabled)')||!entry.disabled)?entry:null;
  if(!document.activeElement.isConnected)document.activeElement=body;
 };
 Object.defineProperty(personal,'innerHTML',{set:mountPersonal});
 const selectors={'.packing-waiting-list':waiting,'[data-packing-others]':others,'[data-packing-personal]':personal,'[data-packing-error]':warning,'[data-packing-waiting-count]':waitingCount,'[data-packing-active-count]':activeCount,'[data-packing-empty]':empty,'[data-packing-others-empty]':othersEmpty,'[data-packing-title]':title};
 page.querySelector=selector=>selectors[selector]||null;
 const target={querySelector:selector=>selector==='.packing-page'?page:null};
 document.querySelector=selector=>selector==='#content'?target:selector==='dialog[open]'?dialog:selectors[selector]||null;
 document.querySelectorAll=()=>[...others.children,...personal.children].flatMap(node=>node.querySelector?[node.querySelector('[data-packing-packed]'),node.querySelector('[data-packing-release]')].filter(Boolean):[node]);
 document.createElement=tag=>{assert.equal(tag,'template');const template={content:{}};Object.defineProperty(template,'innerHTML',{set(html){const match=html.match(/data-packing-(waiting-id|id)="([^"]+)"/);assert.ok(match);template.content.firstElementChild=row(match[2],match[1]==='waiting-id'?'waiting':'packing',Number(html.match(/data-version="(\d+)"/)?.[1]||1));}});return template;};
 const ctx=vm.createContext({workspacePageHeader,statusTone,document,window,Date,setInterval(){},clearInterval(){},esc:v=>String(v??''),me:{user_id:'actor'},view:'packing',$:document.querySelector,message:(text,error)=>messages.push({text,error}),client:{rpc:async(name,args)=>{calls.push({name,args});throw Error('Unexpected RPC '+name);}}});
 vm.runInContext(source,ctx);ctx.__board=board;vm.runInContext('packingBoard=__board',ctx);ctx.bindPackingQueue=()=>{};
 board.waiting.forEach(item=>waiting.insertBefore(row(item.id,'waiting'),null));board.packing.filter(item=>item.id!==board.mine).forEach(item=>others.insertBefore(row(item.id,'packing'),null));personal.innerHTML=ctx.packingPersonalHtml();
 return {ctx,document,window,calls,messages,page,waiting,others,personal,warning,title,getBoard:()=>vm.runInContext('packingBoard',ctx),setDialog(value){dialog=value;},response(rows,waitingIds,packingIds,mine=board.mine){return {now:'2026-10-29T08:31:00Z',waiting_ids:waitingIds,packing_ids:packingIds,mine,can_release:true,rows};}};
}
test('Packed removes only the confirmed card, retains unrelated nodes and moves focus to Take next',async()=>{
 const f=fixture(),waiting=f.waiting.children.slice(),other=f.others.children[0],trigger=f.personal.querySelector('[data-packing-packed]');f.document.activeElement=trigger;
 await f.ctx.packingAct(async()=>({data:{id:'mine',status:'ready',delivery_number:'DN-mine',version:2}}),'Packed','packed',trigger);
 assert.deepEqual(f.calls,[]);assert.equal(f.getBoard().mine,null);assert.deepEqual(Array.from(f.getBoard().packing,row=>row.id),['other']);
 assert.deepEqual(f.waiting.children,waiting);assert.equal(f.others.children[0],other);assert.equal(f.document.activeElement,f.personal.querySelector('[data-packing-take]'));assert.equal(f.window.scrollY,640);assert.equal(f.window.scrollX,12);
});
test('a disabled action losing browser focus still falls back when its card disappears',async()=>{
 const f=fixture(),trigger=f.personal.querySelector('[data-packing-packed]');trigger.disabled=true;
 await f.ctx.packingAct(async()=>({data:{id:'mine',status:'ready'}}),'Packed','packed',trigger);
 assert.equal(f.document.activeElement,f.personal.querySelector('[data-packing-take]'));
});
test('Take next uses the scoped response, fills the boundary row and retains unchanged disclosures',async()=>{
 const board=initial();board.mine=null;board.packing=board.packing.filter(row=>row.id!=='mine');const f=fixture(board),kept=f.waiting.children[1],other=f.others.children[0],trigger=f.personal.querySelector('[data-packing-take]');f.document.activeElement=trigger;
 const claimed=order('wait-a',{status:'packing',version:2,taken_at:'2026-10-29T08:31:00Z',packer_name:'Me',packer_user_id:'actor'}),unchanged={...board.waiting[1],status:'sent_to_sales'},tail=order('tail',{status:'sent_to_sales'});
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:f.response([claimed,unchanged,tail],['wait-b','tail'],['other','wait-a'],'wait-a')};};
 await f.ctx.packingAct(async()=>({data:{id:'wait-a',status:'packing'}}),'Taken','take',trigger);
 assert.equal(f.calls[0].name,'packing_queue_records');assert.deepEqual(Array.from(f.calls[0].args.p_ids),['wait-a','wait-b']);assert.equal(f.waiting.children[0],kept);assert.equal(kept.querySelector('summary').open,true);assert.equal(f.others.children[0],other);
 assert.deepEqual(f.waiting.children.map(row=>row.dataset.packingWaitingId),['wait-b','tail']);assert.equal(f.personal.querySelector('[data-packing-packed]').dataset.version,'2');assert.equal(f.document.activeElement,f.personal.querySelector('[data-packing-packed]'));
});
test('release restores server queue order without duplicate cards and returns focus after dialog close',async()=>{
 const f=fixture(),trigger=f.others.children[0].querySelector('[data-packing-release]'),kept=f.waiting.children.slice(),dialog={isConnected:true,addEventListener(name,fn){assert.equal(name,'close');this.closeListener=fn;}};f.setDialog(dialog);f.document.activeElement=dialog;
 f.ctx.client.rpc=async()=>({data:f.response([order('other',{status:'sent_to_sales',version:2})],['wait-a','other','wait-b'],['mine'])});
 await f.ctx.packingAct(async()=>({data:{id:'other',status:'sent_to_sales'}}),'Released','release',trigger);
 assert.deepEqual(f.waiting.children.map(row=>row.dataset.packingWaitingId),['wait-a','other','wait-b']);assert.equal(f.waiting.children[0],kept[0]);assert.equal(f.waiting.children[2],kept[1]);assert.equal(f.others.children.length,0);assert.equal(f.document.activeElement,dialog);
 f.document.activeElement=f.document.body;f.setDialog(null);dialog.closeListener();assert.equal(f.document.activeElement,f.waiting.children[1].querySelector('summary'));assert.equal(f.window.scrollY,640);
});
test('null claim refreshes blocked visible rows without replacing unchanged rows',async()=>{
 const board=initial();board.mine=null;const f=fixture(board),unchanged=f.waiting.children[1],trigger=f.personal.querySelector('[data-packing-take]');
 f.ctx.client.rpc=async()=>({data:f.response([{...board.waiting[0],status:'sent_to_sales',blocked_reason:'Waiting for stock'},{...board.waiting[1],status:'sent_to_sales'}],['wait-a','wait-b'],['mine','other'],null)});
 await f.ctx.packingAct(async()=>({data:null}),'Nothing available','take',trigger);
 assert.equal(f.waiting.children[1],unchanged);assert.equal(f.getBoard().waiting[0].blocked_reason,'Waiting for stock');assert.equal(f.messages.at(-1).text,'Nothing available');
});
test('write failure leaves all cards unchanged and performs no follow-up read',async()=>{
 const f=fixture(),board=f.getBoard(),trigger=f.personal.querySelector('[data-packing-packed]');
 await assert.rejects(f.ctx.packingAct(async()=>({error:{message:'Version changed'}}),'Packed','packed',trigger),/Version changed/);assert.equal(f.getBoard(),board);assert.deepEqual(f.calls,[]);
});
test('read errors after a confirmed write retain cards, block stale actions and report saved outcome',async()=>{
 for(const failure of ['response','network']){const f=fixture(),board=f.getBoard(),trigger=f.others.children[0].querySelector('[data-packing-release]');f.ctx.client.rpc=async()=>{if(failure==='network')throw Error('Offline');return {error:{message:'Offline'}};};
  f.ctx.actionFeedbackActive={state:{node:trigger,disabled:false}};
  await f.ctx.packingAct(async()=>({data:{id:'other',status:'sent_to_sales'}}),'Released','release',trigger);
  assert.equal(f.getBoard(),board);assert.match(f.messages.at(-1).text,/Change saved.*Offline.*Refresh/);assert.equal(f.warning.hidden,false);assert.equal(trigger.disabled,true);
  assert.equal(f.ctx.actionFeedbackActive.state.disabled,true,'busy cleanup must not re-enable a stale action');
 }
});
test('same-user session replacement, route change and reset discard delayed write completion',async()=>{
 for(const change of [f=>f.ctx.me={user_id:'actor'},f=>f.ctx.view='staff',f=>f.ctx.clearPackingQueue()]){
  const f=fixture(),wait=deferred(),trigger=f.personal.querySelector('[data-packing-packed]'),pending=f.ctx.packingAct(()=>wait.promise,'Packed','packed',trigger);change(f);wait.resolve({data:{id:'mine',status:'ready'}});await pending;
  assert.deepEqual(f.messages,[]);assert.deepEqual(f.calls,[]);assert.equal(trigger.isConnected,true);
 }
});
test('navigation during the scoped read cannot mutate retained page data',async()=>{
 const f=fixture(),wait=deferred(),original=f.getBoard(),trigger=f.others.children[0].querySelector('[data-packing-release]');f.ctx.client.rpc=()=>wait.promise;
 const pending=f.ctx.packingAct(async()=>({data:{id:'other',status:'sent_to_sales'}}),'Released','release',trigger);await Promise.resolve();f.ctx.view='staff';wait.resolve({data:f.response([],[],[],null)});await pending;
 assert.equal(f.getBoard(),original);assert.deepEqual(f.messages,[]);
});
test('a full-board response begun before the action cannot overwrite the confirmed card removal',async()=>{
 const f=fixture(),wait=deferred(),original=f.getBoard(),trigger=f.personal.querySelector('[data-packing-packed]');f.ctx.client.rpc=()=>wait.promise;
 const read=f.ctx.loadPackingBoard();await f.ctx.packingAct(async()=>({data:{id:'mine',status:'ready'}}),'Packed','packed',trigger);wait.resolve({data:original});assert.equal(await read,false);assert.equal(f.getBoard().mine,null);
});
test('polling pauses only for the pending action and resumes after failure',async()=>{
 const f=fixture(),wait=deferred(),trigger=f.personal.querySelector('[data-packing-packed]');let reads=0;f.ctx.loadPackingBoard=async()=>{reads++;return false;};
 const pending=f.ctx.packingAct(()=>wait.promise,'Packed','packed',trigger);await f.ctx.packingRefresh();assert.equal(reads,0);wait.resolve({error:{message:'Rejected'}});await assert.rejects(pending,/Rejected/);await f.ctx.packingRefresh();assert.equal(reads,1);
});
test('incomplete, duplicate and wrong-status scoped responses never replace the prior model',()=>{
 for(const invalid of [f=>f.response([],['unknown'],[]),f=>f.response([],['wait-a','wait-a'],[]),f=>f.response([order('wait-a',{status:'packing'})],['wait-a'],[])]){
  const f=fixture(),original=f.getBoard();assert.throws(()=>f.ctx.packingApplyRecords(invalid(f)),/missing|duplicate|incomplete/);assert.equal(f.getBoard(),original);
 }
});

test('a changed waiting record preserves its open items and focused summary',async()=>{
 const board=initial();board.mine=null;const f=fixture(board),old=f.waiting.children[0],trigger=f.personal.querySelector('[data-packing-take]');f.document.activeElement=old.querySelector('summary');
 f.ctx.client.rpc=async()=>({data:f.response([{...board.waiting[0],status:'sent_to_sales',blocked_reason:'Waiting for stock'}],['wait-a','wait-b'],['mine','other'],null)});
 await f.ctx.packingAct(async()=>({data:null}),'Nothing available','take',trigger);
 assert.notEqual(f.waiting.children[0],old);assert.equal(f.waiting.children[0].querySelector('details').open,true);assert.equal(f.document.activeElement,f.waiting.children[0].querySelector('summary'));
});

test('claim outside the cached queue still rereads all 100 displayed waiting records',async()=>{
 const board=initial();board.mine=null;board.waiting=Array.from({length:100},(_,i)=>order('wait-'+i));const f=fixture(board),trigger=f.personal.querySelector('[data-packing-take]');
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:f.response([],board.waiting.map(row=>row.id),board.packing.map(row=>row.id),null)};};
 await f.ctx.packingAct(async()=>({data:{id:'new-claim',status:'packing'}}),'Taken','take',trigger);
 assert.equal(f.calls[0].args.p_ids.length,100);assert.ok(f.calls[0].args.p_ids.includes('wait-99'));
});

test('completing a capped packing window loads its new boundary card instead of assuming 99 remain',async()=>{
 const board=initial();board.packing=[board.packing[0],...Array.from({length:99},(_,i)=>order('packing-'+i,{taken_at:'2026-10-29T08:00:00Z'}))];const f=fixture(board),trigger=f.personal.querySelector('[data-packing-packed]'),other=f.others.children[0];
 const tail=order('packing-tail',{status:'packing',taken_at:'2026-10-29T08:29:00Z'}),ids=[...board.packing.slice(1).map(row=>row.id),tail.id];
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:f.response([tail],board.waiting.map(row=>row.id),ids,null)};};
 await f.ctx.packingAct(async()=>({data:{id:'mine',status:'ready'}}),'Packed','packed',trigger);
 assert.equal(f.calls[0].name,'packing_queue_records');assert.equal(f.getBoard().packing.length,100);assert.equal(f.others.children[0],other);assert.equal(f.others.children.at(-1).dataset.packingId,'packing-tail');assert.equal(f.getBoard().mine,null);
});
