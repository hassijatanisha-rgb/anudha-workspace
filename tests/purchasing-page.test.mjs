import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(section='orders'){
 const controls=new Map(),nodes=[],calls=[],loads=[],timers=new Map();let lastRun=null,timerId=0;
 const document={activeElement:null,getElementById:id=>controls.get('#'+id)||null,querySelectorAll:selector=>nodes.filter(node=>Object.hasOwn(node.dataset,selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())))};
 const content={html:'',isConnected:true};Object.defineProperty(content,'innerHTML',{get(){return this.html;},set(html){this.html=html;for(const node of nodes)node.isConnected=false;controls.clear();nodes.length=0;for(const [,tag,attrs] of html.matchAll(/<(button|input|form|tbody|p)\b([^>]*)>/g)){
  const node={id:attrs.match(/\bid="([^"]*)"/)?.[1]||'',dataset:{},isConnected:true,disabled:/\bdisabled\b/.test(attrs),value:attrs.match(/\bvalue="([^"]*)"/)?.[1]||'',selectionStart:0,selectionEnd:0,selectionDirection:'none',scrollLeft:0,parentElement:null,addEventListener(type,fn){this['on'+type]=fn;},focus(){document.activeElement=this;},setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},scrollIntoView(){},querySelector(selector){return controls.get(selector)||null;},querySelectorAll(){return [];}};
  for(const [,key,value] of attrs.matchAll(/data-([\w-]+)(?:="([^"]*)")?/g))node.dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value||'';
  nodes.push(node);if(node.id)controls.set('#'+node.id,node);
 }}});
 const ctx=vm.createContext({busy:false,statusTone,me:{user_id:'actor',role:'owner'},view:'purchasing',listsLoaded:false,products:[],document,window:{scrollX:12,scrollY:340,scrollTo(){}},esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:()=> 'Asha',
  $:selector=>selector==='#content'?content:controls.get(selector)||null,syncWorkspaceNavigation(){},workspaceLoading(){content.innerHTML='<p>Skeleton fixture</p>';},
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),run:fn=>(lastRun=Promise.resolve().then(fn)),
  loadLists:async()=>{loads.push('lists');ctx.listsLoaded=true;},all:async table=>{loads.push(table);return table==='suppliers'?[{id:'supplier',name:'Fixture supplier',supplier_number:'SUP-1',active:true}]:[];},
  decorateWorkHandoffs:async()=>loads.push('handoffs'),inventoryOption:()=>'',salesProductChoices:()=>'',message(){},
  client:{rpc:async(name,args)=>{calls.push({name,args:{...args}});return {data:page(args)};},from(){throw Error('Unexpected detail read');}}
 });
 installWorkspaceDialogFixture(ctx);installPageHeader(ctx);for(const file of ['business-date.js','row-index.js','search-state.js','purchasing.js'])vm.runInContext(read(file),ctx);
 const get=code=>vm.runInContext(code,ctx);get(`purchaseSection='${section}';purchaseOrders=[{id:'cached-order'}];purchaseLines=[{id:'cached-line'}];suppliers=[{id:'cached-supplier'}]`);
 function page(args){const total=args.p_query==='empty'?0:45,number=Math.min(args.p_page,Math.max(0,Math.ceil(total/20)-1));return {section:args.p_section,filter:args.p_filter,query:args.p_query,total,page:number,pages:Math.max(1,Math.ceil(total/20)),counts:{all:45,requested:45,approved:0,ordered:0,overdue:0},rows:Array.from({length:Math.min(20,total-number*20)},(_,i)=>args.p_section==='orders'?{id:'order-'+(number*20+i),kind:'orders',register_summary:true,po_number:'PO-'+(number*20+i),status:'requested',supplier_name:'Supplier <safe>',expected_on:null,lpo_reference:''}:{id:'supplier-'+(number*20+i),kind:'suppliers',register_summary:true,name:'Supplier <safe> '+i,supplier_number:'SUP-'+i,active:true,country:'Tanzania',contact_name:'Named <contact>'})};}
 return {ctx,get,calls,loads,content,document,controls,nodes,page,async click(selector){const node=controls.get(selector);assert.ok(node,selector);node.onclick();await lastRun;},async clickData(key,index=0){const node=nodes.filter(row=>Object.hasOwn(row.dataset,key))[index];assert.ok(node,key);node.onclick();await lastRun;},async search(value){const input=controls.get('#purchaseSearch');input.value=value;input.selectionStart=value.length;input.selectionEnd=value.length;input.focus();input.oninput({target:input});for(const [id,fn] of [...timers]){timers.delete(id);fn();}await lastRun;},async flush(){await lastRun;}};
}
for(const section of ['orders','suppliers'])test(`${section} cold landing reads one page, renders 20 summaries and keeps complete caches separate`,async()=>{
 const f=fixture(section);await f.ctx.purchasingWorkspace();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'purchasing_page');assert.deepEqual(f.loads,[]);assert.equal(f.nodes.filter(n=>n.dataset.purchaseOpen).length,20);assert.equal((f.content.html.match(/<small>/g)||[]).length,20*4,'four facts per summary');assert.doesNotMatch(f.content.html,/<table|data-purchase-card|data-supplier-card|<safe>|<contact>/);assert.ok((f.content.html.match(/<[^/!][^>]*>/g)||[]).length<2000);assert.deepEqual(f.get('[purchaseOrders[0].id,purchaseLines[0].id,suppliers[0].id]').join(','),'cached-order,cached-line,cached-supplier');await f.ctx.purchasingWorkspace();assert.equal(f.calls.length,1,'repeat page stays cached');
 await f.click('#purchaseNext');assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_page,1);await f.click('#purchaseNext');assert.equal(f.nodes.filter(n=>n.dataset.purchaseOpen).length,5);assert.equal(f.controls.get('#purchaseNext').disabled,true);await f.click('#purchasePrev');assert.equal(f.calls.length,4);assert.equal(f.get('purchasePage'),1);
 await f.search('empty');assert.equal(f.calls.length,5,'one RPC per settled search');assert.equal(f.calls.at(-1).args.p_page,0);assert.equal(f.document.activeElement.id,'purchaseSearch');assert.equal(f.document.activeElement.selectionStart,5);assert.match(f.content.html,/0 .*Page 1 of 1/);assert.equal(f.controls.get('#purchasePrev').disabled,true);
});
test('order filter performs one server read and keeps its selected label',async()=>{const f=fixture();await f.ctx.purchasingWorkspace();await f.clickData('purchaseFilter',4);assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_filter,'all');assert.match(f.content.html,/data-purchase-filter="all" class="active" aria-pressed="true"/);});
test('explicit Open hydrates existing full context, fetches an older selected order, and Back restores page/search',async()=>{
 const f=fixture();f.get("purchaseFilter='all';purchaseSearch='LPO-OLDER';purchasePage=1");await f.ctx.purchasingWorkspace();let reads=0;
 f.ctx.client.from=table=>{assert.equal(table,'purchase_orders');const q={select(){return this;},eq(column,value){assert.equal(column,'id');assert.equal(value,'order-20');return this;},async maybeSingle(){reads++;return {data:{id:'order-20',po_number:'PO-OLDER',status:'approved',supplier_id:'supplier',requested_by:'actor',purchase_order_lines:[{id:'line',purchase_order_id:'order-20',product_id:'p',quantity:3,line_number:1}]}};}};return q;};
 await f.clickData('purchaseOpen');assert.deepEqual(f.loads,['lists','purchase_orders','suppliers','handoffs']);assert.equal(reads,1);assert.match(f.content.html,/data-purchase-card="order-20"/);assert.match(f.content.html,/Place order with supplier/);assert.equal(f.get('purchaseOrderLines("order-20").length'),1);await f.click('#purchaseBack');assert.equal(f.get('purchaseSearch'),'LPO-OLDER');assert.equal(f.get('purchasePage'),1);assert.equal(f.calls.length,1,'return uses unchanged bounded page');assert.equal(f.nodes.filter(n=>n.dataset.purchaseOpen).length,20);
});
for(const section of ['orders','suppliers'])test(`${section} New waits for existing prerequisites before rendering its editor`,async()=>{const f=fixture(section);await f.ctx.purchasingWorkspace();await f.click(section==='orders'?'#newPurchase':'#newSupplier');assert.deepEqual(f.loads,['lists','purchase_orders','suppliers','handoffs']);assert.ok(f.controls.has(section==='orders'?'#purchaseForm':'#supplierForm'));assert.equal(f.ctx.purchasingLanding(),false);});
test('actor replacement, sign-out, navigation and changed query discard pending pages',async()=>{
 for(const change of [f=>{f.ctx.me={user_id:'actor',role:'owner'};},f=>f.ctx.clearPurchasing(),f=>{f.ctx.view='personal';},f=>f.get("purchaseSearch='changed'"),f=>f.ctx.openPurchaseSection('suppliers')]){
  const f=fixture(),wait=deferred();let args;f.ctx.client.rpc=async(name,input)=>{args=input;return wait.promise;};const loading=f.ctx.purchasingWorkspace();change(f);f.content.innerHTML='<p>Replacement</p>';wait.resolve({data:f.page(args)});await loading;assert.equal(f.content.html,'<p>Replacement</p>');assert.equal(f.get('purchasePageData'),null);assert.deepEqual(f.loads,[]);
 }
});
test('a newer page wins when requests finish out of order; same-user replacement cannot reuse its old page cache',async()=>{
 const f=fixture(),wait=deferred();let firstArgs;f.ctx.client.rpc=async(name,args)=>{f.calls.push(args);if(f.calls.length===1){firstArgs=args;return wait.promise;}return {data:f.page(args)};};const first=f.ctx.purchasingWorkspace();f.get('purchasePage=1');await f.ctx.purchasingWorkspace();wait.resolve({data:f.page(firstArgs)});await first;assert.equal(f.get('purchasePage'),1);assert.equal(f.get('purchasePageData.page'),1);f.ctx.me={user_id:'actor',role:'owner'};await f.ctx.purchasingWorkspace();assert.equal(f.calls.length,3);
});
test('missing, malformed or rejected pages fail visibly without a bulk-read fallback',async()=>{
 for(const mutate of [()=>null,data=>({...data,total:99}),data=>({...data,rows:[]}),data=>({...data,counts:{}}),data=>({...data,rows:data.rows.map((row,i)=>i?row:{...row,status:'made_up'})}),data=>({...data,rows:data.rows.map(row=>({...row,id:'same'}))})]){
  const f=fixture();f.ctx.client.rpc=async(name,args)=>({data:mutate(f.page(args))});await f.ctx.purchasingWorkspace();assert.match(f.content.html,/complete purchasing page/);assert.equal(f.get('purchasePageData'),null);assert.deepEqual(f.loads,[]);
 }
 const f=fixture();f.ctx.client.rpc=async()=>({error:{message:'Permission denied'}});await f.ctx.purchasingWorkspace();assert.match(f.content.html,/Permission denied/);assert.deepEqual(f.loads,[]);
});
test('detail prerequisites cannot repopulate another actor or open another page after navigation',async()=>{
 for(const changedActor of [true,false]){const f=fixture(),wait=deferred();await f.ctx.purchasingWorkspace();f.ctx.loadLists=()=>wait.promise;f.nodes.find(n=>n.dataset.purchaseOpen).onclick();await Promise.resolve();if(changedActor)f.ctx.me={user_id:'other'};else f.ctx.view='personal';f.content.innerHTML='<p>Replacement</p>';wait.resolve();await f.flush();assert.equal(f.content.html,'<p>Replacement</p>');assert.deepEqual(f.loads,[]);}
});
test('Supplier Open hydrates the existing record and its Edit action; Back retains its search',async()=>{
 const f=fixture('suppliers');
 await f.ctx.purchasingWorkspace();f.ctx.all=async table=>{f.loads.push(table);return table==='suppliers'?[{id:'supplier-0',supplier_number:'SUP-0',name:'Full supplier',active:true,contact_name:'Named',phone:'123',email:'full@example.test',tin:'TIN-1',payment_terms:'30 days'}]:[];};
 await f.clickData('purchaseOpen');assert.match(f.content.html,/data-supplier-card="supplier-0"/);assert.match(f.content.html,/full@example.test/);assert.ok(f.nodes.some(node=>node.dataset.supplierEdit==='supplier-0'));await f.click('#purchaseBack');assert.equal(f.nodes.filter(node=>node.dataset.purchaseOpen).length,20);assert.equal(f.calls.length,1);
});
// Confirmed create/save races are exercised with actual DOM in purchasing-record-update.test.mjs.
