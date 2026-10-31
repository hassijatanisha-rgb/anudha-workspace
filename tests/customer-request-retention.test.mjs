import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../customer-requests.js',import.meta.url),'utf8'),row={id:'one',request_number:'REQ-1',kind:'inquiry',status:'received',name:'Name',phone:'0712000000',message:'Request details',created_at:'2026-10-29',version:1};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const document=dom(),root=document.createElement('main');root.setAttribute('id','content');document.body.append(root);const calls=[];let callback;
 const c=vm.createContext({statusTone,document,$:selector=>document.querySelector(selector),me:{user_id:'actor'},view:'requests',CSS:{escape:String},esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),employeeName:()=> 'Employee',message(){},run:fn=>fn(),actionForm:(title,fields,fn)=>callback=fn,client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'wrong'}};},from:table=>({select(columns){calls.push({table,columns});return this;},eq(key,id){calls.at(-1).eq=[key,id];return this;},maybeSingle:async()=>({data:{...row,status:'in_progress',version:2,assigned_user_id:'actor'}})})}});
 vm.runInContext(source,c);vm.runInContext("requestSelected='one';",c);root.innerHTML='<header>Inquiries</header><button id="back">Back</button>'+c.requestCard(row);
 return {c,document,root,calls,save:()=>callback({}),open:()=>c.openRequestAction(row,'take')};
}
test('incomplete receipt resolves through one scoped read while retaining the detail header and Back',async()=>{
 const f=fixture(),header=f.root.querySelector('header'),back=f.root.querySelector('#back');await f.open();await f.save();assert.equal(f.root.querySelector('header'),header);assert.equal(f.root.querySelector('#back'),back);assert.match(f.root.textContent,/Being handled/);assert.deepEqual(f.calls.map(c=>c.name||c.table),['advance_customer_request','customer_requests']);assert.deepEqual(f.calls[1].eq,['id','one']);await f.save();assert.equal(f.calls.length,2);
});
test('failed confirmed read removes stale mutators from only the affected card and retries reads only',async()=>{
 const f=fixture(),header=f.root.querySelector('header'),card=f.root.querySelector('[data-request-card]');let failed=true;f.c.client.from=table=>({select(){f.calls.push({table});return this;},eq(){return this;},maybeSingle:async()=>failed?{error:{message:'Offline <now>'}}:{data:{...row,status:'in_progress',version:2}}});await f.open();await f.save();assert.equal(f.root.querySelector('[data-request-card]'),card);assert.equal(f.root.querySelector('header'),header);assert.match(card.textContent,/change was saved.*Offline <now>/);assert.equal(card.querySelector('[data-request-action]'),null);assert.equal(card.querySelector('now'),null);failed=false;await card.querySelector('[data-request-saved-retry]').onclick();assert.match(f.root.textContent,/Being handled/);assert.equal(f.calls.filter(c=>c.name==='advance_customer_request').length,1);
});
test('obsolete or wrong-identity post-save rows cannot reopen write controls',async()=>{
 for(const saved of [{...row},{...row,id:'wrong',version:2},{...row,kind:'complaint',version:2},{...row,version:2,message:null}]){const f=fixture();f.c.client.from=()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:saved})});await f.open();await f.save();assert.equal(f.root.querySelector('[data-request-action]'),null);assert.match(f.root.textContent,/could not be verified/);}
});
test('late read results and failures cannot update a changed actor, page or disconnected detail',async()=>{
 for(const change of ['actor','route','epoch','detach'])for(const error of [false,true]){
  const f=fixture(),wait=deferred();f.c.client.from=()=>({select(){return this;},eq(){return this;},maybeSingle:()=>wait.promise});await f.open();const pending=f.save();await Promise.resolve();if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='sales';else if(change==='epoch')vm.runInContext('requestEpoch++',f.c);else f.root.remove();const before=f.root.innerHTML;wait.resolve(error?{error:{message:'Old failure'}}:{data:{...row,status:'in_progress',version:2}});await pending;assert.equal(f.root.innerHTML,before);
 }
});
