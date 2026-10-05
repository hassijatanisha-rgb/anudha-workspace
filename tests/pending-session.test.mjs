import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function fixture(all=async()=>[]){
 const content={innerHTML:'Clients'};
 const c=vm.createContext({me:{user_id:'first'},view:'pending',all,salesLoaded:true,salesProformas:[],syncWorkspaceNavigation(){},$:()=>content});
 vm.runInContext(source,c);
 vm.runInContext("renderPendingStock=()=>{$('#content').innerHTML=pendingLoadError||'Current pending orders'}",c);
 return {c,content,get:expression=>vm.runInContext(expression,c)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('pending workspace does not paint loading over another route',async()=>{
 const {c,content}=fixture();c.view='clients';await c.pendingStockWorkspace();assert.equal(content.innerHTML,'Clients');
});
test('availability failure from an old actor cannot replace current cache state',async()=>{
 const delay=deferred();const {c,get}=fixture(table=>table==='inventory_lots'?delay.promise:Promise.resolve([]));
 const load=c.loadPendingStock();await tick();c.me={user_id:'second'};delay.reject(Error('Old stock error'));await load;
 assert.equal(get('pendingAvailabilityError'),'');assert.equal(get('pendingLoaded'),false);
});
test('same user ID in a replacement session rejects stale pending rows',async()=>{
 const delay=deferred();const {c,get}=fixture(table=>table==='pending_stock_requests'?delay.promise:Promise.resolve([]));
 const load=c.loadPendingStock();c.me={user_id:'first'};delay.resolve([{id:'old-session'}]);await load;assert.equal(get('pendingRows.length'),0);
});
test('old failed load cannot overwrite newer successful refresh',async()=>{
 const delay=deferred();let reads=0;const {c,content,get}=fixture(table=>table==='pending_stock_requests'&&++reads===1?delay.promise:Promise.resolve([]));
 const old=c.pendingStockWorkspace(true);await tick();await c.pendingStockWorkspace(true);delay.reject(Error('Old load failed'));await old;
 assert.equal(content.innerHTML,'Current pending orders');assert.equal(get('pendingLoadError'),'');assert.equal(get('pendingLoaded'),true);
});
test('clear invalidates old failure even when the identical actor is restored',async()=>{
 const delay=deferred();const {c,content,get}=fixture(table=>table==='pending_stock_requests'?delay.promise:Promise.resolve([]));
 const old=c.pendingStockWorkspace();const actor=c.me;c.clearPendingStock();c.me=actor;content.innerHTML='New session';delay.reject(Error('Prior session error'));await old;
 assert.equal(content.innerHTML,'New session');assert.equal(get('pendingLoadError'),'');
});
test('clear resets private filters and errors as well as cached rows',()=>{
 const {c,get}=fixture();vm.runInContext("pendingSearch='Private hospital';pendingFilter='mine';pendingPage=4;pendingLoadError='old error';pendingAvailabilityError='old stock error'",c);
 c.clearPendingStock();assert.equal(get('pendingSearch'),'');assert.equal(get('pendingFilter'),'waiting');assert.equal(get('pendingPage'),0);assert.equal(get('pendingLoadError'),'');assert.equal(get('pendingAvailabilityError'),'');
});
test('current pending error remains visible',async()=>{
 const {c,content}=fixture(async()=>{throw Error('Current error')});await c.pendingStockWorkspace();assert.equal(content.innerHTML,'Current error');
});
test('current availability error preserves pending requests',async()=>{
 const {c,get}=fixture(async table=>{if(table==='inventory_lots')throw Error('Unavailable');return table==='pending_stock_requests'?[{id:'current'}]:[];});
 assert.equal(await c.loadPendingStock(),true);assert.equal(get('pendingRows[0].id'),'current');assert.equal(get('pendingAvailabilityError'),'Unavailable');
});
