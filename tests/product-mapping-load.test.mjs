import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const original={name:'Imported label',manufacturer:'Maker',model:'Model A',units:'bottle',totalStock:12,locations:'Godown A'};
const payload={schema:'anudha-product-mapping-v1',rows:[{sourceKey:'source-1',original,corrected:{...original,name:'Corrected product'}}]};
const file=value=>({size:100,text:async()=>JSON.stringify(value)});
function fixture(){
 const nodes=new Map(),listeners=new Map(),loads=[];
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',querySelector:node,querySelectorAll:()=>[]});return nodes.get(selector)};
 const dialog={isConnected:false,querySelector:node,addEventListener:(name,handler)=>listeners.set(name,handler),showModal(){},remove(){this.isConnected=false},close(){listeners.get('close')?.()}};
 const rows=[{id:'off-page',name:'Imported label',source:{company:'Maker',specification:'Model A',units:'bottle'}},{id:'archived',name:'Corrected product',source:{company:'Maker',specification:'Model A',units:'bottle'},deleted_at:'2026-10-29'}];
 const ctx=vm.createContext({showWorkspaceDialog:dialog=>dialog.showModal(),bindWorkspaceDialogDismiss:dialog=>async()=>{dialog.close();return true;},me:{user_id:'owner'},canEditRecords:()=>true,esc:String,document:{createElement:()=>dialog,addEventListener(){},body:{append:()=>{dialog.isConnected=true}}},products:[],inventoryLoaded:false,inventoryLoadError:'',productReviewLoadError:'Prior failed read',
  loadLists:async()=>{loads.push('lists');ctx.products=rows;return true},
  loadInventoryOperations:async()=>{loads.push('inventory');ctx.inventoryLoaded=true;ctx.productReviewLoadError='';return true},
  reviewedCatalogProduct:p=>({...p,name:'Corrected product'}),catalogRows:()=>{throw Error('A product page is not a complete mapping catalog')}
 });
 for(const name of ['product-identity.js','product-mapping-preview.js','product-mapping-ui.js'])vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),ctx);
 ctx.openProductMappingPreview();
 return {ctx,loads,dialog,rows,node,choose:value=>node('input').onchange({target:{files:[file(value)]}})};
}

test('mapping hydrates full identities only on file selection, preserving corrections and pack units beyond the visible page',async()=>{
 const f=fixture();assert.deepEqual(f.loads,[]);
 await f.choose(payload);assert.deepEqual(f.loads,['lists','inventory']);
 assert.match(f.node('[data-mapping-results]').innerHTML,/1 exact identity proposals/);
 assert.match(f.node('[data-mapping-results]').innerHTML,/off-page/);assert.doesNotMatch(f.node('[data-mapping-results]').innerHTML,/archived/);
 assert.match(f.node('[data-mapping-status]').textContent,/Comparison complete/);
 f.rows.push({...f.rows[0],id:'second-page-duplicate'});await f.choose(payload);
 assert.match(f.node('[data-mapping-results]').innerHTML,/0 exact identity proposals/);
 assert.match(f.node('[data-mapping-results]').innerHTML,/ambiguous/);
});

test('mapping never compares partial lists or failed correction loads',async()=>{
 for(const failure of ['lists','inventory','corrections']){
  const f=fixture();
  if(failure==='lists')f.ctx.loadLists=async()=>false;
  else f.ctx.loadInventoryOperations=async()=>{f.ctx.inventoryLoaded=failure==='corrections';f.ctx.productReviewLoadError='Corrections unavailable';return failure==='corrections'};
  await f.choose(payload);assert.equal(f.node('[data-mapping-results]').innerHTML,'');assert.doesNotMatch(f.node('[data-mapping-status]').textContent,/Comparison complete/);
  assert.match(f.node('[data-mapping-status]').textContent,/could not be loaded|Refresh product corrections/);
 }
});

test('replaced mapping files discard late loads and late errors',async()=>{
 for(const rejectOld of [false,true]){
  const f=fixture();let finish,fail;const load=f.ctx.loadLists;let calls=0;
  f.ctx.loadLists=()=>++calls===1?new Promise((resolve,reject)=>{finish=resolve;fail=reject}):load();
  const old=f.choose(payload);await new Promise(setImmediate);
  await f.choose({...payload,rows:[{...payload.rows[0],sourceKey:'new-file'}]});
  const html=f.node('[data-mapping-results]').innerHTML;
  if(rejectOld)fail(Error('Old failure'));else finish(true);await old;
  assert.match(html,/new-file/);assert.equal(f.node('[data-mapping-results]').innerHTML,html);assert.match(f.node('[data-mapping-status]').textContent,/Comparison complete/);
 }
});

test('closed dialogs and changed sessions discard pending mapping comparisons',async()=>{
 for(const change of [f=>f.dialog.close(),f=>{f.ctx.me={user_id:'owner'}}]){
  const f=fixture();let finish;f.ctx.loadLists=()=>new Promise(resolve=>finish=resolve);
  const pending=f.choose(payload);await new Promise(setImmediate);change(f);finish(true);await pending;
  assert.equal(f.node('[data-mapping-results]').innerHTML,'');assert.deepEqual(f.loads,[]);
 }
});
