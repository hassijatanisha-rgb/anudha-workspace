import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
function fixture(){
 let handler,resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b;}),opened=[];
 const root={isConnected:true},ctx=vm.createContext({workspacePageHeader,me:{user_id:'actor'},view:'inventory',inventorySection:'catalog',busy:false,products:[{id:'cached',revision:3}],
  document:{addEventListener:(event,fn)=>{if(event==='click')handler=fn;}},$:()=>root,canEditRecords:()=>true,run:fn=>fn(),openProductForm:row=>opened.push(row),client:{rpc:()=>pending}});
 vm.runInContext(read('catalog-inventory.js'),ctx);
 const app=read('app.js'),start=app.indexOf("document.addEventListener('click',async e=>{");vm.runInContext(app.slice(start,app.indexOf('\n(async()=>{const cfg=',start)),ctx);
 const run=code=>vm.runInContext(code,ctx);
 return {ctx,root,opened,resolve,reject,run,click:(id='product')=>handler({target:{closest:()=>({dataset:{productEdit:id}})}})};
}
const response=()=>({data:{rows:[{id:'product',original:{id:'product',revision:7,name:'Raw source'}}],total:1,page:0,pages:1,metrics:{products:1},category_counts:{},colour_counts:{}}});
test('actual app product opener uses the current raw detail receipt',async()=>{
 const f=fixture(),pending=f.click();f.resolve(response());await pending;assert.deepEqual(f.opened,[{id:'product',revision:7,name:'Raw source'}]);
});
test('late raw detail results and failures are silent after same-user replacement, session, request, route or root changes',async()=>{
 for(const change of ["me={...me}",'clearCatalogInventory()','catalogRequest++',"view='personal'","inventorySection='stock'",null])for(const failure of [false,true]){
  const f=fixture(),pending=f.click();if(change)f.run(change);else f.root.isConnected=false;
  if(failure)f.reject(Error('Late detail read'));else f.resolve(response());await pending;assert.deepEqual(f.opened,[],change);
 }
});
test('current detail errors still surface and the non-catalog cached product path remains compatible',async()=>{
 const f=fixture(),pending=f.click();f.reject(Error('Current detail read failed'));await assert.rejects(pending,/Current detail read failed/);assert.deepEqual(f.opened,[]);
 const legacy=fixture();legacy.run("inventorySection='stock'");await legacy.click('cached');assert.deepEqual(legacy.opened,[{id:'cached',revision:3}]);await assert.rejects(legacy.click('missing'),/Product unavailable/);
});
