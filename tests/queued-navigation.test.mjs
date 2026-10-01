import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const navSource=readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8');
function fixture(){
 const listeners=[],renders=[],nodes=new Map();
 const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',before(){},setAttribute(){},close(){}});return nodes.get(s)};
 const ctx=vm.createContext({busy:false,me:{user_id:'fixture'},view:'contacts',search:'',page:0,
  inventorySection:'stock',serviceSection:'forms',salesSection:'delivery',salesEditing:'',
  document:{querySelector:node,addEventListener:(type,fn,capture)=>{if(type==='click')listeners.push({fn,capture})}},
  $:node,message(){},render(){renders.push(ctx.view)},goProfile(){renders.push('contacts')},
 });
 vm.runInContext(navSource,ctx);
 vm.runInContext(app.slice(app.indexOf('async function run(fn)'),app.indexOf('(async()=>{const cfg=')),ctx);
 function button(view,section,nav=true){const b={dataset:{view,workspaceSection:section},isConnected:true};
  b.click=()=>{const event={target:{closest:selector=>selector==='#nav [data-view]'?(nav?b:null):b}};
   for(const h of listeners.filter(x=>x.capture))h.fn(event);
   for(const h of listeners.filter(x=>!x.capture))h.fn(event);
  };return b;
 }
 let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b});
 ctx.editing={};ctx.showFieldErrors=()=>{};ctx.FormData=class{*[Symbol.iterator](){}};ctx.save=()=>pending;
 return {ctx,renders,button,resolve,reject,start:()=>ctx.run(()=>pending),submit:()=>node('#editForm').onsubmit({preventDefault(){},target:{}})};
}
test('latest sidebar choice runs once after operation completes, never during it',async()=>{
 const f=fixture(),work=f.start();f.button('service','schedule').click();f.button('inventory','stock').click();
 assert.deepEqual(f.renders,[]);assert.equal(f.ctx.view,'contacts');
 f.resolve();await work;assert.deepEqual(f.renders,['inventory']);assert.equal(f.ctx.inventorySection,'stock');
});
test('failed operation discards navigation and preserves the current form',async()=>{
 const f=fixture(),work=f.start();f.button('inventory','stock').click();f.reject(Error('save rejected'));await work;
 assert.deepEqual(f.renders,[]);await f.ctx.run(async()=>{});assert.deepEqual(f.renders,[]);
});
test('queued navigation cannot cross account changes or use removed controls',async()=>{
 for(const change of ['account','removed']){
  const f=fixture(),work=f.start(),b=f.button('inventory','stock');b.click();
  if(change==='account')f.ctx.me={user_id:'other'};else b.isConnected=false;
  f.resolve();await work;assert.deepEqual(f.renders,[]);
 }
});
test('non-sidebar action buttons are never replayed after busy state',async()=>{
 const f=fixture(),work=f.start();f.button('inventory','stock',false).click();f.resolve();await work;assert.deepEqual(f.renders,[]);
});
test('contact save success flushes navigation; save failure discards it',async()=>{
 for(const success of [true,false]){
  const f=fixture(),work=f.submit();f.button('inventory','stock').click();assert.deepEqual(f.renders,[]);
  if(success)f.resolve();else f.reject(Error('validation failed'));await work;
  assert.deepEqual(f.renders,success?['inventory']:[]);
 }
});
