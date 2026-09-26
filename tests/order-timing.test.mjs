import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
const file=new URL('../order-timing.js',import.meta.url);
if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);
const e=(id,from,to,hour)=>({id,from_status:from,to_status:to,created_at:`2026-09-25T${String(hour).padStart(2,'0')}:00:00Z`,actor_user_id:id});
const now=Date.parse('2026-09-25T15:00:00Z');
test('durations, actors, waiting and total derive from actual transitions',()=>{
 assert.equal(typeof context.orderTiming,'function');
 const result=context.orderTiming([e('b','draft','sent',11),e('a',null,'draft',10)],'sent',now);
 assert.equal(result.visits[0].durationMs,3600000);assert.equal(result.visits[0].endedBy,'b');
 assert.equal(result.waitingMs,4*3600000);assert.equal(result.totalMs,5*3600000);
});
test('duplicates and same-stage saves do not restart waiting; reversal is separate visit',()=>{
 const a=e('a',null,'draft',10);
 const result=context.orderTiming([a,a,e('b','draft','draft',11),e('c','draft','sent',12),e('d','sent','draft',13)],'draft',now);
 assert.equal(result.visits.length,3);assert.equal(result.visits[0].durationMs,2*3600000);assert.equal(result.waitingMs,2*3600000);assert.equal(result.totalMs,5*3600000);
});
test('cancelled and delivered totals stop at recorded terminal transition',()=>{
 for(const terminal of ['cancelled','delivered']){
  const result=context.orderTiming([e('a',null,'draft',10),e('b','draft',terminal,12)],terminal,now);
  assert.equal(result.totalMs,2*3600000);assert.equal(result.waitingMs,null);assert.equal(result.visits.at(-1).durationMs,0);
 }
});
test('missing, invalid, future, discontinuous, incomplete history is unknown',()=>{
 for(const events of [[],[e('a','sent','accepted',10)],[{...e('a',null,'draft',10),created_at:'invalid'}],[e('a',null,'draft',20)],[e('a',null,'draft',10),e('b','packing','ready',12)]])assert.equal(context.orderTiming(events,'ready',now).totalMs,null);
 assert.equal(context.orderTiming([e('a',null,'draft',10)],'sent',now).waitingMs,null);
 assert.equal(context.orderTiming([e('a',null,'draft',10)],'draft',now,false).totalMs,null);
});
test('archive controls only appear for owner active drafts and exclude deleted products',()=>{
 const ctx=vm.createContext({me:{role:'owner'},proformaNextActions:()=>[],products:[{id:'one',name:'Live'},{id:'two',name:'Deleted',deleted_at:'today'}],esc:String,inventoryProductChoice:p=>p.name});
 vm.runInContext(fs.readFileSync(new URL('../sales-delivery.js',import.meta.url),'utf8'),ctx);
 assert.match(ctx.proformaActions({id:'draft',status:'draft'}),/data-archive-business="proforma"/);
 assert.doesNotMatch(ctx.proformaActions({id:'sent',status:'sent'}),/data-archive-business/);
 ctx.me.role='staff';assert.doesNotMatch(ctx.proformaActions({id:'draft',status:'draft'}),/data-archive-business/);
 assert.doesNotMatch(ctx.salesProductChoices(),/Deleted/);
});
test('complete per-record pagination reads beyond global history caps and fails closed',async()=>{
 const calls=[];let fail=false;
 const backend={from(table){return {select(){return this},eq(column,id){calls.push([table,column,id]);return this},order(){return this},range(start,end){calls.push([start,end]);return Promise.resolve(fail?{error:{message:'Denied'}}:{data:start===0?Array.from({length:500},(_,i)=>({id:i})):[{id:501}]});}};}};
 assert.equal((await context.fetchOrderEvents(backend,'events','order_id','wanted')).length,501);
 assert.ok(calls.some(call=>call[0]===500&&call[1]===999));
 assert.ok(calls.some(call=>call[0]==='events'&&call[2]==='wanted'));
 fail=true;await assert.rejects(context.fetchOrderEvents(backend,'events','order_id','wanted'),/Denied/);
});
test('duration formatting exposes unknown and readable units',()=>{
 assert.equal(context.orderDuration(null),'Unknown');assert.equal(context.orderDuration(60000),'1m');
 assert.equal(context.orderDuration(3600000),'1h 0m');assert.equal(context.orderDuration(86400000),'1d 0h 0m');
});
