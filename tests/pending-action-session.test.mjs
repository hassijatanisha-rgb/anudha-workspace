import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8');
function fixture(){
 let reply,submit;const c=vm.createContext({me:{user_id:'owner',role:'owner'},view:'pending',messages:[],refreshes:0,calls:0,
 esc:String,products:[{id:'p',name:'Fixture product'}],orgIndex:new Map([['org',{name:'Fixture hospital'}]]),
 actionForm:(title,fields,callback)=>{submit=callback},client:{rpc(){c.calls++;return new Promise(resolve=>{reply=resolve})}},message:text=>c.messages.push(text)});
 vm.runInContext(source,c);vm.runInContext('pendingStockWorkspace=async()=>{refreshes++}',c);
 c.openPendingAction({id:'request',version:1,request_number:'PS-fixture',product_id:'p',organization_id:'org',quantity:1},'cancel');
 return {c,submit:()=>submit({note:'Client declined'}),reply:value=>reply(value)};
}
test('current pending action refreshes and notifies',async()=>{const f=fixture();const p=f.submit();f.reply({data:{}});await p;assert.equal(f.c.refreshes,1);assert.equal(f.c.messages.length,1)});
for(const change of ['navigation','replacement','clear'])test(`pending action ignores old completion after ${change}`,async()=>{
 const f=fixture();const p=f.submit();
 if(change==='navigation')f.c.view='clients';else if(change==='replacement')f.c.me={user_id:'owner',role:'owner'};else f.c.clearPendingStock();
 f.reply({data:{}});await p;assert.equal(f.c.refreshes,0);assert.equal(f.c.messages.length,0);
});
test('pending action opened before session clear cannot send RPC',async()=>{const f=fixture();f.c.clearPendingStock();const p=f.submit();if(f.c.calls)f.reply({data:{}});await p;assert.equal(f.c.calls,0)});
