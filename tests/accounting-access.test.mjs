import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
const file=new URL('../accounting-access.js',import.meta.url);
function context(client,identity){const ctx=vm.createContext({});if(existsSync(file))vm.runInContext(readFileSync(file,'utf8'),ctx);return ()=>ctx.requireAccountingAccess(client,identity)}
test('General owner role cannot bypass accounting membership',async()=>{
 const read=context({rpc:async()=>({data:false,error:null})},()=>({user_id:'owner',role:'owner'}));
 await assert.rejects(read,/Accounting access/);
});
test('Only explicit true permission is accepted',async()=>{
 for(const data of [null,undefined,'true',{},[]])await assert.rejects(context({rpc:async()=>({data,error:null})},()=>({user_id:'one'})),/Accounting access/);
 const read=context({rpc:async name=>{assert.equal(name,'accounting_access');return {data:true}}},()=>({user_id:'one'}));
 assert.equal(await read(),'one');
});
test('Changed login invalidates an in-flight permission response',async()=>{
 let release;let user={user_id:'one'};
 const read=context({rpc:()=>new Promise(resolve=>release=resolve)},()=>user);
 const pending=read();user={user_id:'two'};release({data:true});
 await assert.rejects(pending,/login changed/);
});
test('Missing login or backend check fails closed',async()=>{
 let calls=0;await assert.rejects(context({rpc:()=>calls++},()=>null),/Sign in/);assert.equal(calls,0);
 await assert.rejects(context({rpc:async()=>({error:{message:'database unavailable'}})},()=>({user_id:'one'})),/could not be verified/);
});
