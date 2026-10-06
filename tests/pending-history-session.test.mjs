import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8');
function fixture(){
 let resolve,reject;const requests=[],output={isConnected:true,textContent:'',innerHTML:''};
 const query={select(){return this},eq(){return this},order(){return this},limit(){return new Promise((done,fail)=>{resolve=done;reject=fail;requests.push({resolve:done,reject:fail})})}};
 const context=vm.createContext({me:{user_id:'first'},view:'pending',CSS:{escape:value=>value},document:{querySelector:()=>output},client:{from:()=>query},esc:String,employeeName:()=> 'Fixture Employee'});
 vm.runInContext(source,context);
 return {context,output,requests,resolve:value=>resolve(value),reject:error=>reject(error)};
}
test('current pending history renders',async()=>{
 const f=fixture(),request=f.context.showPendingHistory('fixture');
 f.resolve({data:[{action:'created',actor_user_id:'first',created_at:'2026-10-01',expires_on:'2027-04-01'}]});await request;
 assert.match(f.output.innerHTML,/created/);
});
for(const kind of ['success','error','transport'])test(`older history ${kind} cannot overwrite a newer read of the same card`,async()=>{
 const f=fixture(),first=f.context.showPendingHistory('fixture'),second=f.context.showPendingHistory('fixture');
 f.requests[1].resolve({data:[{action:'newer',created_at:'2026-10-06',expires_on:'2027-04-06'}]});await second;
 const expected={text:f.output.textContent,html:f.output.innerHTML};
 if(kind==='transport')f.requests[0].reject(Error('Old transport'));
 else f.requests[0].resolve(kind==='error'?{error:{message:'Old server'}}:{data:[{action:'older',created_at:'2026-10-01'}]});
 await first;assert.equal(f.output.innerHTML,expected.html);assert.equal(f.output.textContent,expected.text);
});
test('current history transport failure produces an inline error',async()=>{
 const f=fixture(),request=f.context.showPendingHistory('fixture');
 f.reject(Error('Connection lost'));await request;
 assert.equal(f.output.textContent,'History could not load: Connection lost');
});
test('stale history transport failure does not escape into global errors',async()=>{
 const f=fixture(),request=f.context.showPendingHistory('fixture');
 f.context.clearPendingStock();f.output.textContent='New view';
 f.reject(Error('Old connection lost'));await request;
 assert.equal(f.output.textContent,'New view');
});
for(const change of ['clear-same-actor','replace-same-id','navigate'])for(const error of [false,true])test(`pending history ignores ${error?'error':'result'} after ${change}`,async()=>{
 const f=fixture(),request=f.context.showPendingHistory('fixture');
 if(change==='clear-same-actor')f.context.clearPendingStock();
 if(change==='replace-same-id')f.context.me={user_id:'first'};
 if(change==='navigate')f.context.view='clients';
 f.output.textContent='New view';f.output.innerHTML='New view';
 f.resolve(error?{error:{message:'Old failure'}}:{data:[{action:'created',created_at:'2026-10-01'}]});await request;
 assert.equal(f.output.textContent,'New view');assert.equal(f.output.innerHTML,'New view');
});
