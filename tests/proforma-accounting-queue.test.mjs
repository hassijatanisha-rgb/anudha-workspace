import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(options={}){
 const calls=[],buttons=[],previous={},next={};
 const target={isConnected:true,innerHTML:'',querySelector:s=>s.includes('previous')?previous:next,querySelectorAll:()=>buttons};
 const row={id:'saved-1',organization_id:'org',document_number:'PF-1',revision:3,acceptance_reference:'LPO <one>'};
 let page=0;
 const query={select(value){calls.push(['select',value]);return this},eq(...args){calls.push(['eq',...args]);return this},order(...args){calls.push(['order',...args]);return this},range(start,end){calls.push(['range',start,end]);buttons.splice(0,buttons.length,...(start===0?[{dataset:{proformaAccountingOpen:row.id}}]:[]));return options.query?options.query():Promise.resolve(options.error?{error:{message:'Unavailable'}}:{data:page++===0?Array.from({length:25},(_,i)=>({...row,id:i?`saved-${i+1}`:row.id})):[]})}};
 const ctx=vm.createContext({me:{user_id:'one'},view:'accounting',organizations:[{id:'org',name:'Customer'}],client:{rpc:options.rpc|| (async()=>({data:true})),from:table=>{calls.push(['from',table]);return query}},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),run:fn=>fn(),salesSection:'delivery',salesEditing:'new',salesDeliveryWorkspace:async force=>{calls.push(['workspace',force])},document:{querySelectorAll:()=>[{dataset:{documentCard:'saved-1'},scrollIntoView:()=>calls.push(['scroll'])}]},message:()=>{}});
 ctx.salesFocusedProforma='';
 for(const file of ['accounting-access.js','proforma-accounting-queue.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 return {ctx,target,calls,buttons,previous,next};
}
test('accepted submissions render safely with bounded deterministic pagination',async()=>{
 const f=fixture();await f.ctx.mountProformaAccountingQueue(f.target,'one');
 assert.match(f.target.innerHTML,/Submitted pro formas/);assert.match(f.target.innerHTML,/Customer/);assert.match(f.target.innerHTML,/PF-1/);assert.match(f.target.innerHTML,/revision 3/i);assert.match(f.target.innerHTML,/LPO &lt;one&gt;/);assert.match(f.target.innerHTML,/no invoice or stock/i);
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='status'&&c[2]==='accepted'));
 assert.deepEqual(f.calls.filter(c=>c[0]==='order').map(c=>[c[1],c[2].ascending]),[['accepted_at',false],['created_at',false],['id',false]]);
 assert.deepEqual(f.calls.filter(c=>c[0]==='range'),[['range',0,24]]);
 assert.equal(f.previous.disabled,true);assert.equal(f.next.disabled,false);
 await f.next.onclick();assert.deepEqual(f.calls.filter(c=>c[0]==='range'),[['range',0,24],['range',25,49]]);assert.equal(f.previous.disabled,false);assert.equal(f.next.disabled,true);
 await f.previous.onclick();assert.deepEqual(f.calls.filter(c=>c[0]==='range').at(-1),['range',0,24]);
});
test('row opens saved current proforma in sales and scrolls',async()=>{
 const f=fixture();await f.ctx.mountProformaAccountingQueue(f.target,'one');await f.buttons[0].onclick();
 assert.equal(f.ctx.view,'sales');assert.equal(f.ctx.salesSection,'proformas');assert.equal(f.ctx.salesEditing,'');assert.equal(f.ctx.salesFocusedProforma,'saved-1');assert.ok(f.calls.some(c=>c[0]==='workspace'&&c[1]===true));assert.ok(f.calls.some(c=>c[0]==='scroll'));
});
test('detaching target or leaving accounting during query discards response',async()=>{
 for(const change of [f=>f.target.isConnected=false,f=>f.ctx.view='sales']){
  let finish,started;const queryStarted=new Promise(resolve=>started=resolve);const f=fixture({query:()=>new Promise(resolve=>{finish=resolve;started()})});const loading=f.ctx.mountProformaAccountingQueue(f.target,'one');await queryStarted;change(f);finish({data:[{document_number:'PRIVATE'}]});await loading;assert.doesNotMatch(f.target.innerHTML,/PRIVATE/);
 }
});
test('permission denial and query error fail closed',async()=>{
 const f=fixture({rpc:async()=>({data:false})});await assert.rejects(f.ctx.mountProformaAccountingQueue(f.target,'one'),/restricted/);assert.equal(f.calls.length,0);
 const g=fixture({error:true});await assert.rejects(g.ctx.mountProformaAccountingQueue(g.target,'one'),/could not load/);assert.doesNotMatch(g.target.innerHTML,/PF-1/);
});
test('stale actor, detached target, and wrong view do not query',async()=>{
 for(const change of [f=>f.ctx.me={user_id:'two'},f=>f.target.isConnected=false,f=>f.ctx.view='sales']){const f=fixture();change(f);await f.ctx.mountProformaAccountingQueue(f.target,'one');assert.equal(f.calls.length,0)}
});
test('actor switch during permission verification or query never renders data',async()=>{
 let release;const f=fixture({rpc:()=>new Promise(resolve=>release=resolve)});const pending=f.ctx.mountProformaAccountingQueue(f.target,'one');f.ctx.me={user_id:'two'};release({data:true});await assert.rejects(pending,/login changed/);assert.equal(f.calls.length,0);
 let finish,started;const queryStarted=new Promise(resolve=>started=resolve);const g=fixture({query:()=>new Promise(resolve=>{finish=resolve;started()})});const loading=g.ctx.mountProformaAccountingQueue(g.target,'one');await queryStarted;g.ctx.me={user_id:'two'};finish({data:[{document_number:'PRIVATE'}]});await loading;assert.doesNotMatch(g.target.innerHTML,/PRIVATE/);
});
