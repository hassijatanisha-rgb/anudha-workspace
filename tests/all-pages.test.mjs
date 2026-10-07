import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').split('\n').find(line=>line.startsWith('async function all('));

// A table of `rows` rows whose reported count is `counted` (a count can be stale by the time pages are read).
function table(rows,counted=rows,fail=-1){
 const calls=[];
 const client={from:name=>({select:(columns,options)=>{
  const q={filters:[],eq(k,v){this.filters.push([k,v]);return this},order(){return this},range(from,to){
   calls.push({name,columns,from,to,count:options?.count,filters:this.filters});
   const data=from===fail?null:Array.from({length:Math.max(0,Math.min(to+1,rows)-from)},(_,i)=>({id:from+i}));
   return Promise.resolve(from===fail?{error:Error('page failed')}:{data,count:options?.count?counted:null});
  }};return q;}})};
 const ctx=vm.createContext({client});vm.runInContext(source,ctx);
 return {all:(...a)=>vm.runInContext('all',ctx)(...a),calls};
}

test('all() reads every row once, in id order, whatever the size',async()=>{
 for(const rows of [0,1,999,1000,1001,3999,4000,4001,9540,20000,20400]){
  const t=table(rows),out=await t.all('contacts','id');
  assert.equal(out.length,rows,`${rows} rows`);assert.ok(out.every((r,i)=>r.id===i),`${rows} rows in order`);
 }
});

test('all() asks for the pages after the first four at once',async()=>{
 const t=table(20400);await t.all('contacts','id');
 assert.equal(t.calls.length,21);
 assert.deepEqual(t.calls.filter(c=>c.count).map(c=>c.from),[0],'only the first page is counted');
 const small=table(500);await small.all('x','id');assert.equal(small.calls.length,4,'up to 4000 rows: one round as before');
 const uncounted=table(9540,null);await uncounted.all('x','id');assert.equal(uncounted.calls.length,12,'no count: four pages per round as before');
});

test('a stale count never cuts the list short or loses the filter',async()=>{
 for(const counted of [0,null,5000,30000]){
  const t=table(20400,counted),out=await t.all('contacts','id',q=>q.eq('status','open'));
  assert.equal(out.length,20400,`count ${counted}`);
  assert.ok(t.calls.every(c=>c.filters.length===1&&c.filters[0][1]==='open'));
 }
});

test('a failed page fails the whole read',async()=>{
 await assert.rejects(table(20400,20400,12000).all('contacts','id'),/page failed/);
});
