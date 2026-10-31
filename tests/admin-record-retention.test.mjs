import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../admin-records.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(kind='product'){
 const document=dom();document.addEventListener=()=>{};const target=document.createElement('main');target.setAttribute('id','content');document.body.append(target);Object.getPrototypeOf(target).removeAttribute=function(key){delete this.attrs[key]};
 target.innerHTML='<header>Retained header<input id="search"></header><div id="catalogSaveNotice"></div><div id="catalogDetail"><article>Opened product</article></div><input id="catalogSearch"><p id="catalogStatus"></p><article data-document-card="one"><button>Delete draft</button></article><section data-order-workflow="one">Old workflow</section><article id="other">Unchanged record</article>';
 const calls=[],messages=[],pages=[],scrolls=[];let submit,readHook,writeHook,revision=0;
 const record={id:'one',name:'Product <name>',document_number:'PF-1',version:3,revision:1,status:'draft',deleted_at:null,deleted_by:null,updated_at:'2026-10-28T10:00:00Z'},actor={user_id:'owner',role:'owner'};
 const c=vm.createContext({document,me:actor,view:kind==='product'?'inventory':'sales',CSS:{escape:value=>value},salesWorkspaceRequest:1,salesEpoch:1,salesEditing:'',sessionLoadEpoch:1,salesLoaded:true,salesProformaPageKey:'cached',salesProformas:[record],products:[record],catalogDetailRows:new Map([['one',record]]),catalogMachineChoices:[record],catalogSelectedProduct:'one',catalogSearch:'retained',catalogCategory:'reagents',catalogColour:'',catalogSort:'name',catalogPage:2,catalogMachineId:'',
  $:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),canEditRecords:()=>true,recordsLockedText:'Locked',catalogIsActive:()=>kind==='product',catalogSaveContext:()=>{const own=revision;return {actor:c.me,current:()=>c.me===actor&&revision===own&&c.view==='inventory'&&target.isConnected}},
  loadCatalogProduct:async()=>record,salesProforma:id=>c.salesProformas.find(row=>row.id===id),salesConfirmedRow:(_kind,previous,data)=>{const row=Array.isArray(data)&&data.length===1?data[0]:data;if(!row||row.id!==previous.id||row.status!=='draft'||row.version!==previous.version+1||Object.keys(previous).some(key=>!Object.hasOwn(row,key)))throw Error('The draft response could not be verified.');return row;},actionFeedbackReference:node=>({node}),actionFeedbackUndo:()=>{},actionForm:(_title,_body,fn)=>{submit=fn;return null},catalogInvalidateProductCaches:()=>calls.push('invalidate'),catalogProductRefreshPending:(id,pending)=>calls.push(['gate',id,pending]),
  requestCatalogPage:async args=>{calls.push(['read',args]);return readHook?readHook():{rows:[{id:'two'}],total:1}},catalogReconcilePage:data=>pages.push(data),bindSalesDelivery:()=>calls.push('bind'),load:()=>assert.fail('No whole-workspace load'),message:(...args)=>messages.push(args),run:fn=>fn(),window:{scrollX:2,scrollY:600,scrollTo:value=>scrolls.push(value)},client:{rpc:async(name,args)=>{calls.push(['write',name,args]);return writeHook?writeHook():{data:{...record,version:4,deleted_at:'2026-10-29T10:00:00Z',deleted_by:'owner',updated_at:'2026-10-29T10:00:00Z'}}}}
 });vm.runInContext(source,c);
 return {c,target,document,record,calls,messages,pages,scrolls,setRead:fn=>readHook=fn,setWrite:fn=>writeHook=fn,advance:()=>revision++,open:()=>c.openArchiveBusinessRecord(kind,'one'),save:()=>submit()};
}
test('product archive uses unchanged writer arguments and one filtered page read, preserving the shell',async()=>{
 const f=fixture(),header=f.target.querySelector('header'),other=f.target.querySelector('#other');await f.open();await f.save();
 assert.equal(f.target.querySelector('header'),header);assert.equal(f.target.querySelector('#other'),other);assert.equal(f.target.querySelector('#catalogDetail').children.length,0);assert.equal(f.c.catalogDetailRows.has('one'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(x=>Array.isArray(x)&&x[0]==='write'))),[['write','set_product_archived',{p_id:'one',p_archived:true}]]);
 assert.equal(f.calls.filter(x=>x[0]==='read').length,1);assert.equal(f.calls.find(x=>x[0]==='read')[1].p_query,'retained');assert.equal(f.calls.find(x=>x[0]==='read')[1].p_page,2);assert.equal(f.pages.length,1);assert.ok(f.scrolls.every(value=>value.left===2&&value.top===600));
});
test('archive read failure reports the committed result and retry performs no write',async()=>{
 const f=fixture();f.setRead(()=>{throw Error('<Offline>')});await f.open();await f.save();
 assert.match(f.target.querySelector('#catalogSaveNotice').textContent,/Moved to Deleted Items.*could not refresh.*<Offline>/);assert.equal(f.target.querySelector('#catalogStatus').textContent,'Product counts need refresh.');
 const retry=f.target.querySelector('[data-archive-retry]');f.setRead(null);await retry.onclick();assert.equal(f.calls.filter(x=>x[0]==='write').length,1);assert.equal(f.calls.filter(x=>x[0]==='read').length,2);assert.equal(f.pages.length,1);
});
test('draft archive patches only the opened card and removes stale workflow actions',async()=>{
 const f=fixture('proforma'),header=f.target.querySelector('header'),other=f.target.querySelector('#other'),card=f.target.querySelector('[data-document-card="one"]');await f.open();
 assert.equal(f.target.querySelector('header'),header);assert.equal(f.target.querySelector('#other'),other);assert.equal(f.target.querySelector('[data-document-card="one"]'),card);assert.match(card.textContent,/PF-1 moved to Deleted Items/);assert.equal(f.target.querySelector('[data-order-workflow]').hidden,true);assert.equal(f.target.querySelector('[data-order-workflow]').children.length,0);assert.ok(card.querySelector('[data-proforma-back]'));assert.equal(f.c.salesProformas[0].version,4);assert.equal(f.c.salesLoaded,false);assert.equal(f.c.salesProformaPageKey,'');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(x=>x[0]==='write'))),['write','set_draft_proforma_archived',{p_id:'one',p_archived:true,p_expected_version:3}]);assert.equal(f.calls.some(x=>x[0]==='read'),false);
});
test('unknown archive receipt never removes current records or starts refresh',async()=>{
 for(const kind of ['product','proforma']){const f=fixture(kind);f.setWrite(()=>({data:{id:'one'}}));if(kind==='product'){await f.open();await assert.rejects(f.save(),/response could not be verified/);}else{await assert.rejects(f.open(),/response could not be verified/);assert.match(f.target.textContent,/Check saved status/);assert.equal(f.calls.filter(x=>x[0]==='write').length,1);}assert.equal(f.pages.length,0);assert.equal(f.messages.length,0);assert.ok(f.target.querySelector('[data-document-card]'));}
});
test('replacement actor, navigation and request suppress old write results and failures',async()=>{
 for(const kind of ['product','proforma'])for(const mode of ['actor','route','request'])for(const failure of [false,true]){
  const f=fixture(kind),wait=deferred();f.setWrite(()=>wait.promise);let pending;if(kind==='product'){await f.open();pending=f.save();}else pending=f.open();if(mode==='actor')f.c.me={...f.c.me};else if(mode==='route')f.c.view='personal';else if(kind==='product')f.advance();else f.c.salesWorkspaceRequest++;
  const before=f.target.innerHTML;if(failure)wait.reject(Error('Old failure'));else wait.resolve({data:{...f.record,version:4,deleted_at:'2026-10-29'}});await pending;
  assert.equal(f.target.innerHTML,before);assert.equal(f.messages.length,0);assert.equal(f.pages.length,0);
 }
});
test('late catalog reread cannot repaint or publish feedback in another route',async()=>{
 const f=fixture(),wait=deferred();f.setRead(()=>wait.promise);await f.open();const pending=f.save();await new Promise(resolve=>setImmediate(resolve));f.c.view='personal';f.target.innerHTML='<p>Current workspace</p>';wait.resolve({rows:[]});await pending;assert.equal(f.target.textContent,'Current workspace');assert.equal(f.messages.length,0);assert.equal(f.pages.length,0);
});
