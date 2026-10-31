import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const id='10000000-0000-4000-8000-000000000001',flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const hashes={catalog:'#/go/inventory/catalog',proformas:'#/go/sales/proformas',clients:'#/clients'},recordKinds={catalog:'product',proformas:'proforma',clients:'client'};
const values={catalog:['reagents','Maker','machine-id','company',3,'yellow','Machine'],proformas:['Clinic','partial',4,120],clients:['Clinic','revision',5]};
function fixture(kind,options={}){
 const f=mainPageFixture({tables:{discount_policy:()=>({id:true,version:1,head_limit_basis_points:1000})},...options}),entries=[{hash:hashes[kind],state:{erpNavigationBranch:'list-place',erpNavigationIndex:0,kept:'metadata'}}],scrolls=[],reads=[],windowEvents=new Map(),questions=[];let cursor=0,delay=null,fail=false,uuid=0;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const history={get state(){return entries[cursor].state;},scrollRestoration:'manual',pushState(state,_,hash){entries.splice(cursor+1);entries.push({hash,state:clone(state)});cursor++;f.ctx.location.hash=hash;},replaceState(state,_,hash){entries[cursor]={hash,state:clone(state)};f.ctx.location.hash=hash;},go(delta){setImmediate(()=>{cursor+=delta;f.ctx.location.hash=entries[cursor].hash;events();});}};
 f.ctx.crypto={randomUUID:()=> 'list-place-'+(++uuid)};f.ctx.history=history;f.ctx.location.hash=hashes[kind];f.ctx.actor=f.actor;f.evaluate("me=actor;navHistoryBranch='list-place';navLastIndex=0;navLastHash=location.hash;sessionLoadEpoch=1");f.document.querySelector('#nav').hidden=false;
 for(const name of ['product','proforma','client'])f.ctx.workspaceRecordButton(name).hidden=false;
 f.ctx.refreshNotificationBell=async()=>{};f.ctx.scrollX=11;f.ctx.scrollY=840;f.ctx.scrollTo=(options,second)=>{const [x,y]=typeof options==='object'?[options.left,options.top]:[options,second];scrolls.push([x,y]);f.ctx.scrollX=x;f.ctx.scrollY=y;};
 f.ctx.addEventListener=(name,fn)=>{const events=windowEvents.get(name)||[];events.push(fn);windowEvents.set(name,events);};
 const source=readFileSync(new URL('../nav-history.js',import.meta.url),'utf8');vm.runInContext(source.slice(source.indexOf("window.addEventListener('scroll'"),source.indexOf('// Reloading the page')),f.ctx);
 f.ctx.askConfirm=()=>{const question=deferred();questions.push(question);return question.promise;};
 const content=f.document.querySelector('#content');
 function setList(){if(kind==='catalog')f.evaluate("view='inventory';inventorySection='catalog';catalogSelectedProduct=''");else if(kind==='proformas')f.evaluate("view='sales';salesSection='proformas';salesFocusedProforma='';salesEditing=''");else f.evaluate("view='contacts';selected=''");}
 function setValues(next=values[kind]){f.ctx.next=next;if(kind==='catalog')f.evaluate("[catalogCategory,catalogSearch,catalogMachineId,catalogSort,catalogPage,catalogColour]=next;catalogMachineProduct={id:catalogMachineId,name:next[6]}");else if(kind==='proformas')f.evaluate('[salesProformaSearch,salesProformaFilter,salesProformaPage,salesShown]=next');else f.evaluate('[search,filter,page]=next');}
 function draw(){
  const route=f.ctx.workspaceRecordRoute(f.ctx.location.hash);
  if(route){content.innerHTML=`<h1>Selected record</h1><button data-proforma-back>Back</button><a href="#/clients" id="clientsBack">Clients</a>`;if(route.kind==='proforma')f.ctx.bindSalesDelivery();return;}
  if(kind==='catalog'){f.evaluate("catalogResult={rows:[]};catalogSelectedProduct=''");content.innerHTML='<input id="catalogSearch"><div id="catalogResults">Products</div>';content.querySelector('input').value=f.evaluate('catalogSearch');}
  else if(kind==='proformas'){f.evaluate('salesProformaPageData={rows:[]}');content.innerHTML='<input id="proformaSearch"><div>Pro formas</div>';content.querySelector('input').value=f.evaluate('salesProformaSearch');}
  else{f.evaluate('clientDirectoryData={organizations:[],contacts:[]}');content.innerHTML='<input id="orgSearch"><div>Clients</div>';content.querySelector('input').value=f.evaluate('search');}
 }
 async function load(){reads.push({hash:f.ctx.location.hash,values:clone(f.ctx.navListValues(kind))});if(delay)await delay.promise;if(fail){content.innerHTML='<p role="alert">Unavailable</p>';return;}draw();}
 const actual={render:f.ctx.render,salesDeliveryWorkspace:f.ctx.salesDeliveryWorkspace,catalogInventory:f.ctx.catalogInventory,catalogOpenRecord:f.ctx.catalogOpenRecord};
 f.ctx.render=load;f.ctx.salesDeliveryWorkspace=load;f.ctx.catalogInventory=load;f.ctx.catalogOpenRecord=async recordId=>{f.ctx.recordId=recordId;f.evaluate('catalogSelectedProduct=recordId');draw();};
 setList();setValues();draw();
 function events(){return Promise.all([f.ctx.navHistoryChanged(),f.ctx.navHistoryChanged()]);}
 async function move(delta){cursor+=delta;f.ctx.location.hash=entries[cursor].hash;await events();await flush();await flush();}
 async function open(){await f.ctx.openWorkspaceRecord(recordKinds[kind],id);await flush();}
 function native(hash){const listener=f.document.body.events.click.find(event=>String(event.fn).includes("link.getAttribute('href')")).fn,link=f.document.createElement('a');link.setAttribute('href',hash);content.append(link);listener({target:link});history.pushState({...history.state},'',hash);return events();}
 return {...f,kind,content,entries,scrolls,reads,questions,windowEvents,history,useActual:()=>Object.assign(f.ctx,actual),setValues,setList,draw,move,open,native,cursor:()=>cursor,values:()=>clone(f.ctx.navListValues(kind)),hold:()=>delay=deferred(),fail:()=>{fail=true;}};
}

for(const kind of ['catalog','proformas','clients'])test(`${kind}: browser Back and Forward retain exact list fields, indexed entries and scroll without extra reads`,async()=>{
 const f=fixture(kind);await f.open();assert.equal(f.entries.length,2);const before=JSON.stringify(f.entries);f.setValues(kind==='catalog'?['all','Changed','','name',0,'','']:kind==='proformas'?['Changed','all',0,120]:['Changed','all',0]);f.ctx.scrollX=0;f.ctx.scrollY=0;f.scrolls.length=0;const reads=f.reads.length,dbReads=f.calls.length;
 await f.move(-1);assert.deepEqual(f.values(),values[kind]);assert.deepEqual(f.scrolls,[[11,840]]);assert.equal(f.reads.length-reads,1);assert.equal(f.calls.length,dbReads,JSON.stringify(f.calls));assert.equal(JSON.stringify(f.entries),before);
 f.ctx.scrollY=960;for(const fn of f.windowEvents.get('scroll'))fn();await f.move(1);assert.match(f.ctx.location.hash,new RegExp('/'+recordKinds[kind]+'/'));await f.move(-1);assert.deepEqual(f.scrolls.at(-1),[11,960]);assert.equal(JSON.stringify(f.entries),before);
});

test('actual Pro forma Back restores register fields and scroll through its existing one-load callback',async()=>{
 const f=fixture('proformas');await f.open();f.setValues(['Other','all',0,120]);f.ctx.scrollY=0;f.scrolls.length=0;const before=f.reads.length,dbReads=f.calls.length;
 await f.content.querySelector('[data-proforma-back]').onclick();assert.equal(f.ctx.location.hash,hashes.proformas);assert.deepEqual(f.values(),values.proformas);assert.deepEqual(f.scrolls,[[11,840]]);assert.equal(f.reads.length-before,1);assert.equal(f.calls.length,dbReads,JSON.stringify(f.calls));
});

test('native client record links capture list state before hash change and their Clients Back restores the original page',async()=>{
 const f=fixture('clients');await f.native('#/client/'+id);await flush();await flush();assert.equal(f.evaluate('selected'),id);f.setValues(['Changed','all',0]);f.ctx.scrollY=0;f.scrolls.length=0;
 await f.native('#/clients');await flush();await flush();assert.deepEqual(f.values(),values.clients);assert.deepEqual(f.scrolls,[[11,840]]);assert.equal(f.content.querySelector('#orgSearch').value,'Clinic');assert.equal(f.calls.length,0,JSON.stringify(f.calls));
});

for(const change of ['actor','session','navigation','hash','entry','root','user-scroll','touch-scroll','keyboard-scroll','scrollbar','typed-filter'])test(`late list load does not restore scroll after ${change}`,async()=>{
 const f=fixture('proformas');await f.open();f.ctx.scrollY=0;f.scrolls.length=0;const held=f.hold(),moving=f.move(-1);await flush();
 if(change==='actor')f.evaluate('me={...me}');if(change==='session')f.evaluate('sessionLoadEpoch++');if(change==='navigation')f.ctx.workspaceNavigationContext();if(change==='hash')f.ctx.location.hash='#/go/travel';
 if(change==='entry')f.evaluate('navLastIndex++');if(change==='root'){const replacement=f.document.createElement('div');replacement.id='content';f.content.replaceWith(replacement);}
 if(change==='user-scroll'){for(const fn of f.windowEvents.get('wheel'))fn({});f.ctx.scrollY=125;for(const fn of f.windowEvents.get('scroll'))fn();}
 if(change==='touch-scroll')for(const fn of f.windowEvents.get('touchmove'))fn({});
 if(change==='keyboard-scroll')f.document.body.events.keydown.find(event=>String(event.fn).includes('navListScrollIntent')).fn({key:'PageDown',target:f.content});
 if(change==='scrollbar')f.document.body.events.pointerdown.find(event=>String(event.fn).includes('navListScrollIntent')).fn({target:f.document.documentElement});
 if(change==='typed-filter')f.evaluate("salesProformaSearch='newer typing'");held.resolve();await moving;await flush();assert.deepEqual(f.scrolls,[]);if(change==='user-scroll')assert.equal(f.ctx.scrollY,125);
});

test('failed list loading does not scroll to a stale successful snapshot',async()=>{
 const f=fixture('catalog');await f.open();f.ctx.scrollY=0;f.scrolls.length=0;f.fail();await f.move(-1);assert.deepEqual(f.scrolls,[]);assert.match(f.content.textContent,/Unavailable/);
});

test('declined Back from a dirty Pro forma preserves history, draft and list snapshot without restoring scroll',async()=>{
 const f=fixture('proformas');await f.open();f.evaluate("salesEditing='draft'");f.content.innerHTML='<form id="proformaForm"><input name="notes" value="Saved"></form>';const form=f.content.querySelector('form'),input=form.querySelector('input');input.name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Unsaved';f.scrolls.length=0;
 const before=JSON.stringify(f.entries),moving=f.move(-1);await flush();assert.equal(f.questions.length,1);f.questions[0].resolve(false);await moving;await flush();assert.equal(f.cursor(),1);assert.equal(JSON.stringify(f.entries),before);assert.equal(input.value,'Unsaved');assert.deepEqual(f.scrolls,[]);
});

test('entry snapshots and source origins are bounded, session-only and fully cleared with navigation',async()=>{
 const f=fixture('clients');for(let n=0;n<140;n++){f.setList();f.ctx.navRecordPage('#/clients');f.evaluate(`search='private query ${n}';page=${n}`);await f.ctx.openWorkspaceRecord('client',id);}
 assert.equal(f.evaluate('navListEntries.size'),100);assert.ok(f.evaluate('[...navListEntries.values()].some(entry=>entry.origin)'));assert.doesNotMatch(JSON.stringify(f.entries),/private query/);assert.equal(f.ctx.localStorage.length,0);
 f.ctx.clearWorkspaceNavigation();assert.equal(f.evaluate('navListEntries.size'),0);assert.equal(f.evaluate('navListRestoring'),null);
});

test('same-ID replacement actor cannot restore the prior person’s directory query or scroll',async()=>{
 const f=fixture('clients');await f.open();f.evaluate("me={...me};search='New actor query';page=0");f.scrolls.length=0;await f.move(-1);assert.equal(f.evaluate('search'),'New actor query');assert.equal(f.evaluate('page'),0);assert.deepEqual(f.scrolls,[]);
});

for(const kind of ['catalog','proformas','clients'])test(`${kind}: actual landing loader restores the requested page with exactly its existing single read`,async()=>{
 const rpcs={
  catalog_page:args=>({rows:Array.from({length:25},(_,n)=>({id:'product-'+n,name:'Maker Product '+n,sku:'SKU-'+n,catalog_current:true,catalog_classification:{category:'reagents',version:1},source:{company:'Maker',specification:'20 ml',sale_status:'active',category:'reagents',machine_ids:['machine-id']}})),page:args.p_page,pages:8,total:200,metrics:{products:200,review:200,active:200,manufacturers:1},category_counts:{all:200,reagents:200},colour_counts:{yellow:200}}),
  sales_proforma_page:args=>({rows:Array.from({length:50},(_,n)=>({id:'pf-'+n,document_number:'PF-'+n,status:'accepted',revision:1,currency:'TZS',total_minor:10000,created_at:'2026-10-29T08:00:00Z',register_summary:true,register_tag:'partial',organization:{name:'Clinic '+n,location:'Arusha'},contact_name:'Contact',items_summary:'10 × Reagent'})),total:300,page:args.p_page,pages:6,counts:{all:300,mine:0,placement:0,partial:300},live_status:[],discount_policy:{head_limit_basis_points:1000}}),
  client_directory_snapshot:{organizations:Array.from({length:200},(_,n)=>({id:'client-'+n,name:'Clinic '+String(n).padStart(3,'0'),location:'Arusha',type:'Clinic',parent_id:null,status:'approved',deleted_at:null})),contacts:[]}
 };
 const f=fixture(kind,{rpcs});await f.open();f.calls.length=0;f.scrolls.length=0;f.ctx.scrollY=0;f.useActual();await f.move(-1);await f.settle();
 assert.deepEqual(f.values(),values[kind]);assert.deepEqual(f.scrolls.at(-1),[11,840]);assert.deepEqual(f.calls.map(call=>call.name),[{catalog:'catalog_page',proformas:'sales_proforma_page',clients:'client_directory_snapshot'}[kind]]);assert.equal(f.evaluate('listsLoaded'),false);
 assert.equal(f.content.querySelector(kind==='catalog'?'#catalogSearch':kind==='proformas'?'#proformaSearch':'#orgSearch').value,values[kind][kind==='catalog'?1:0]);
 if(kind==='catalog')assert.equal(f.calls[0].args.p_page,3);if(kind==='proformas')assert.equal(f.calls[0].args.p_page,4);
});

test('only the three list/detail families use guarded manual scroll restoration',async()=>{
 const f=fixture('clients');f.ctx.navRecordPage('#/clients');assert.equal(f.history.scrollRestoration,'manual');await f.open();assert.equal(f.history.scrollRestoration,'manual');
 f.ctx.navRecordPage('#/go/travel');assert.equal(f.history.scrollRestoration,'auto');f.ctx.navRecordPage('#/invoice/'+id);assert.equal(f.history.scrollRestoration,'auto');
});

test('a layout-induced scroll during loading does not masquerade as user scroll intent',async()=>{
 const f=fixture('proformas');await f.open();f.scrolls.length=0;const held=f.hold(),moving=f.move(-1);await flush();f.ctx.scrollY=0;for(const fn of f.windowEvents.get('scroll'))fn();held.resolve();await moving;await flush();assert.deepEqual(f.scrolls,[[11,840]]);
});

test('page-scroll keys on a focused button cancel pending restoration while Space activation does not',async()=>{
 for(const key of ['PageDown','PageUp','Home','End','ArrowDown','ArrowUp',' ']){
  const f=fixture('proformas');await f.open();const button=f.content.querySelector('[data-proforma-back]');f.scrolls.length=0;const held=f.hold(),moving=f.move(-1);await flush();button.focus();f.document.body.events.keydown.find(event=>String(event.fn).includes('navListScrollIntent')).fn({key,target:button});f.ctx.scrollY=125;held.resolve();await moving;await flush();assert.deepEqual(f.scrolls,key===' '?[[11,840]]:[],key);
 }
});
