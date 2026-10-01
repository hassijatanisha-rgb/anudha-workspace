import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function fixture(count,failAt=-1){
 const calls=[];let active=0,maxActive=0;
 const client={from(table){return {select(columns){return {order(key){return {async range(start,end){
  calls.push({table,columns,key,start,end});active++;maxActive=Math.max(maxActive,active);
  await Promise.resolve();active--;
  if(start===failAt)return {error:{message:'canceling statement due to statement timeout',code:'57014'}};
  return {data:Array.from({length:Math.max(0,Math.min(end+1,count)-start)},(_,i)=>({id:start+i}))};
 }}}}}}}};
 const ctx=vm.createContext({client});vm.runInContext(source.slice(source.indexOf('async function all('),source.indexOf('async function load(')),ctx);
 return {read:()=>ctx.all('products','id,name'),calls,maximum:()=>maxActive};
}
test('startup reads use at most 100 rows per request without overlapping pages',async()=>{
 const f=fixture(245),rows=await f.read();assert.equal(rows.length,245);
 assert.deepEqual(Array.from(rows,r=>r.id),Array.from({length:245},(_,i)=>i));
 assert.ok(f.calls.every(c=>c.end-c.start+1<=100));assert.equal(f.maximum(),1);
 assert.deepEqual(f.calls.map(c=>c.start),[0,100,200]);
});
test('empty and exact-page datasets stop correctly',async()=>{
 for(const count of [0,100,200]){const f=fixture(count);assert.equal((await f.read()).length,count);assert.equal(f.calls.length,count/100+1)}
});
test('failed page identifies dataset and offset and never returns partial data or retries',async()=>{
 const f=fixture(350,100);await assert.rejects(f.read(),error=>{
  assert.match(error.message,/products/);assert.match(error.message,/100/);assert.match(error.message,/statement timeout/);assert.equal(error.code,'57014');return true;
 });assert.deepEqual(f.calls.map(c=>c.start),[0,100]);
});
