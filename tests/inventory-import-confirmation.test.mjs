import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve}};
function fixture(count=501){
 const document=dom();document.body.innerHTML='<main id="content"><input id="inventoryProductImport" type="file"><button id="inventoryImportCommit">Import new product names only</button></main>';
 const input=document.querySelector('#inventoryProductImport');input.files=[];
 const calls=[],questions=[],messages=[],reloads=[],plan={newProducts:Array.from({length:count},(_,i)=>({id:'product-'+i,name:'Product '+i,sku:'',source:{source_rows:[i+1]}}))};
 const c=vm.createContext({document,$:selector=>document.querySelector(selector),me:{user_id:'owner',role:'owner'},view:'inventory',products:[],run:fn=>fn(),askConfirm:async options=>{questions.push(options);return true},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_products.length}}},load:async()=>reloads.push('load'),message:(...args)=>messages.push(args),seed:plan});
 vm.runInContext(read('inventory-operations.js'),c);const get=code=>vm.runInContext(code,c);get("inventoryImportPreview=seed;inventoryImportFileName='Prepared.json';inventoryActor=me");c.bindInventoryWorkspace();
 const button=document.querySelector('#inventoryImportCommit');return {c,document,input,button,calls,questions,messages,reloads,plan,get,submit:()=>button.onclick()};
}

test('confirmed product-name import keeps its 250-row batches, stable IDs and explicit no-stock consequence',async()=>{
 const f=fixture();await f.submit();assert.deepEqual(JSON.parse(JSON.stringify(f.questions)),[{title:'Import 501 product names?',body:'Existing exact-name matches will be skipped. No stock quantities will be created.',confirmLabel:'Import product names',tone:'normal'}]);
 assert.deepEqual(f.calls.map(call=>call.name),['import_records','import_records','import_records']);assert.deepEqual(f.calls.map(call=>call.args.p_products.length),[250,250,1]);assert.deepEqual(f.calls.flatMap(call=>call.args.p_products),f.plan.newProducts);assert.equal(f.get('inventoryImportPreview'),null);assert.equal(f.get('inventoryImportFileName'),'');assert.deepEqual(f.reloads,['load']);assert.equal(f.messages.length,1);
});

test('rejecting product import preserves the selected preview without any write or reload',async()=>{
 const f=fixture();f.c.askConfirm=async()=>false;await f.submit();assert.equal(f.get('inventoryImportPreview'),f.plan);assert.equal(f.get('inventoryImportFileName'),'Prepared.json');assert.equal(f.calls.length,0);assert.equal(f.reloads.length,0);assert.equal(f.messages.length,0);
});

test('delayed import approval is bound to its actor, epoch, page, preview and selected file',async()=>{
 for(const mode of ['actor','epoch','route','section','preview','file','input','root','button']){
  const f=fixture(),wait=deferred();f.c.askConfirm=()=>wait.promise;const pending=f.submit();assert.equal(f.calls.length,0);
  if(mode==='actor')f.c.me={...f.c.me};else if(mode==='epoch')f.get('inventoryEpoch++');else if(mode==='route')f.c.view='sales';else if(mode==='section')f.get("inventorySection='catalog'");else if(mode==='preview')f.get('inventoryImportPreview={...inventoryImportPreview}');else if(mode==='file')f.input.files=[{name:'Replacement.json'}];else if(mode==='input')f.input.remove();else if(mode==='root')f.document.querySelector('#content').remove();else f.button.remove();
  wait.resolve(true);await pending;assert.equal(f.calls.length,0,mode);assert.equal(f.reloads.length,0,mode);assert.equal(f.messages.length,0,mode);
 }
 const f=fixture(1),wait=deferred();f.c.askConfirm=()=>wait.promise;const pending=f.submit();wait.resolve(true);await pending;assert.equal(f.calls.length,1);
});

test('a changed session stops later import batches and cannot clear a newer preview or reload it',async()=>{
 const f=fixture(),wait=deferred();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise};const pending=f.submit();await new Promise(setImmediate);assert.equal(f.calls.length,1);f.c.me={...f.c.me};f.get('inventoryImportPreview={newProducts:[]}');wait.resolve({data:250});await pending;assert.equal(f.calls.length,1);assert.equal(f.reloads.length,0);assert.equal(f.messages.length,0);assert.equal(f.get('inventoryImportPreview.newProducts.length'),0);
});

test('failed product batch retains the existing retry guidance and same product identifiers',async()=>{
 const f=fixture();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return f.calls.length===2?{error:{message:'Denied'}}:{data:250}};await assert.rejects(f.submit(),/Import stopped at product 250\. Completed batches are safe to retry\. Denied/);assert.equal(f.calls.length,2);assert.equal(f.get('inventoryImportPreview'),f.plan);assert.equal(f.reloads.length,0);assert.equal(f.messages.length,0);
});

test('these explicit confirmations use the shared question API rather than native confirmation boxes',()=>{
 for(const file of ['customer-returns.js','tally-stock-review.js','inventory-operations.js']){const source=read(file);assert.doesNotMatch(source,/(?<![\w])(?:window\.)?confirm\s*\(/);assert.match(source,/await askConfirm\(/);}
});
