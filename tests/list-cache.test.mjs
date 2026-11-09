import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fetchSrc=app.slice(app.indexOf('const listColumns='),app.indexOf('function loadLists()'));
// Runs list-cache.js and fetchLists with a fake server: tables hold rows; each call records its filter.
function load(tables,{cached=null,missingColumn=false,otherError=false,now=Date.now()}={}){
 const calls=[];
 const Clock=class extends Date{static now(){return typeof now==='function'?now():now;}};
 const ctx=vm.createContext({workspacePageHeader,Date:Clock,Map,Set,Number,String,Array,Object,Promise,Error,JSON,setTimeout});
 vm.runInContext(readFileSync(new URL('../list-cache.js',import.meta.url),'utf8'),ctx);
 ctx.listCacheRead=async()=>cached;
 ctx.all=async(table,cols,filter)=>{
  const chain=f=>({f,gte:(col,v)=>chain({...f,kind:f.kind||'gte',from:v}),neq:(col,v)=>chain({...f,not:v}),is:(col,v)=>chain({...f,kind:f.kind||'is'})});
  const raw=filter?filter(chain({})).f:null,f=raw&&{kind:raw.kind,v:raw.from,neq:raw.not};calls.push({table,cols,f});
  if(otherError)throw Error('network down');
  if(missingColumn&&cols.includes('updated_at'))throw Error('column organizations.updated_at does not exist');
  let rows=tables[table];if(f?.kind==='gte')rows=rows.filter(r=>Date.parse(r.updated_at)>=Date.parse(f.v)&&(f.neq===undefined||r.updated_at!==f.neq));if(f?.kind==='is')rows=rows.filter(r=>!r.deleted_at);
  return rows.map(r=>({...r}));
 };
 vm.runInContext(fetchSrc,ctx);
 return {ctx,calls};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const T=s=>`2026-10-16T${s}.000Z`;
const server=()=>({
 organizations:[{id:'o1',name:'Aga Khan',updated_at:T('06:00:00')},{id:'o2',name:'Old Clinic',updated_at:T('06:00:00'),deleted_at:'x'}],
 contacts:[{id:'c1',first_name:'Asha',updated_at:T('06:00:00')}],
 products:[{id:'p1',name:'Analyser',updated_at:T('06:00:00')},{id:'p2',name:'Archived item',deleted_at:'y',updated_at:T('06:00:00')}]
});
test('first visit downloads everything and keeps a copy with the latest change times',async()=>{
 const {ctx,calls}=load(server());
 const r=await ctx.fetchLists('u1');
 assert.deepEqual(r.o.map(x=>x.id),['o1'],'archived clients are not downloaded');
 assert.deepEqual(r.p.map(x=>x.id),['p1','p2'],'products keep archived rows as before');
 assert.equal(r.record.userId,'u1');assert.equal(r.record.since.contacts,T('06:00:00'));
 assert.ok(calls.every(c=>c.cols.includes('updated_at')));
});
test('a repeat visit asks only for changes since five minutes before the last one seen',async()=>{
 const s=server();
 s.organizations.push({id:'o3',name:'New Hospital',updated_at:T('08:00:00')});
 s.organizations[0]={...s.organizations[0],name:'Aga Khan Hospital',updated_at:T('08:01:00')};
 s.contacts.push({id:'c1',first_name:'Asha',deleted_at:'z',updated_at:T('08:02:00')});s.contacts.shift();
 const cached={userId:'u1',savedAt:Date.now(),since:{organizations:T('06:00:00'),contacts:T('06:00:00'),products:T('06:00:00')},
  organizations:[{id:'o1',name:'Aga Khan'}],contacts:[{id:'c1',first_name:'Asha'}],products:[{id:'p1',name:'Analyser'},{id:'p2',name:'Archived item',deleted_at:'y'}]};
 const {ctx,calls}=load(s,{cached});
 const r=await ctx.fetchLists('u1');
 assert.ok(calls.every(c=>c.f.kind==='gte'&&c.f.v===T('05:55:00')),'asks from 5 minutes before the last change');
 assert.deepEqual(plain(r.o.map(x=>`${x.id}:${x.name}`).sort()),['o1:Aga Khan Hospital','o3:New Hospital']);
 assert.deepEqual(plain(r.c),[],'a contact archived elsewhere leaves the list');
 assert.equal(r.p.length,2);
 assert.equal(r.record.since.organizations,T('08:01:00'));assert.equal(r.record.since.products,T('06:00:00'),'no product change keeps the old time');
 assert.equal(r.record.savedAt,cached.savedAt,'the 7-day full refresh clock is not reset by small updates');
});
test('before the server has change times the old full download is used and nothing is kept',async()=>{
 const {ctx,calls}=load(server(),{missingColumn:true});
 const r=await ctx.fetchLists('u1');
 assert.equal(r.record,null);assert.deepEqual(r.o.map(x=>x.id),['o1']);
 assert.ok(calls.slice(-3).every(c=>!c.cols.includes('updated_at')));
});
test('other failures are reported, not hidden',async()=>{
 const {ctx}=load(server(),{otherError:true});
 await assert.rejects(ctx.fetchLists('u1'),/network down/);
});
test('change-time helpers',()=>{
 const ctx=vm.createContext({workspacePageHeader,Date,Map,Number});
 vm.runInContext(readFileSync(new URL('../list-cache.js',import.meta.url),'utf8'),ctx);
 assert.equal(vm.runInContext(`listCacheLatest([{updated_at:'${T('07:00:00')}'},{updated_at:'${T('09:30:00')}'}],'${T('08:00:00')}')`,ctx),T('09:30:00'));
 assert.equal(vm.runInContext(`listCacheLatest([],'')`,ctx),'');
 assert.equal(vm.runInContext(`listCacheFrom('')`,ctx),'1970-01-01T00:00:00.000Z','no time seen yet asks for everything');
 assert.equal(vm.runInContext(`listCacheMerge([{id:'a'}],[{id:'a',deleted_at:'x'}],true)[0].deleted_at`,ctx),'x');
});
test('the saved copy is wiped whenever the sign-in page is shown',()=>{
 assert.match(app,/function login\(\)\{if\(typeof listCacheClear==='function'\)listCacheClear\(\);/);
});

test('rows that all share the last time seen are not downloaded again (the 16 Oct backfill)',async()=>{
 // Migration 089 gave all 20,404 contacts the same time, to the microsecond; each load asked again for all of them.
 const clump='2026-10-16T08:56:33.402029+00:00';
 const s={organizations:Array.from({length:500},(_,i)=>({id:'o'+i,name:'Clinic '+i,updated_at:clump})),contacts:[{id:'c1',first_name:'Asha',updated_at:clump}],products:[{id:'p1',name:'Analyser',updated_at:clump}]};
 const now=Date.now(),first=load(s,{now});const r1=await first.ctx.fetchLists('u1');
 assert.equal(r1.record.since.organizations,clump,'the exact time is kept, not rounded to milliseconds');
 const settled=load(s,{cached:plain(r1.record),now:now+5*60000});const checked=await settled.ctx.fetchLists('u1');
 assert.equal(settled.calls.find(c=>c.table==='organizations').f.neq,undefined,'the stabilization read still includes equality');
 const cached=plain(checked.record);
 // Once the overlap read confirms the historical watermark, repeat loads omit the unchanged group.
 const again=load(s,{cached,now:now+6*60000});let againRows=-1;const againAll=again.ctx.all;again.ctx.all=async(...a)=>{const rows=await againAll(...a);if(a[0]==='organizations')againRows=rows.length;return rows;};
 await again.ctx.fetchLists('u1');assert.equal(againRows,0,'none of the 500 rows sharing the last time are downloaded again');
 // Later one client is renamed: only that row comes back.
 s.organizations[7]={...s.organizations[7],name:'Clinic 7 renamed',updated_at:'2026-10-16T09:10:00.100000+00:00'};
 const second=load(s,{cached,now:now+7*60000});const r2=await second.ctx.fetchLists('u1');
 const downloaded=second.calls.find(c=>c.table==='organizations');
 assert.equal(downloaded.f.neq,clump);
 assert.equal(r2.o.length,500);assert.equal(r2.o.find(o=>o.id==='o7').name,'Clinic 7 renamed');
 assert.equal(r2.record.since.organizations,'2026-10-16T09:10:00.100000+00:00');
 // A third load right after gets nothing new, and keeps all 500.
 const settledNew=await load(s,{cached:plain(r2.record),now:now+12*60000}).ctx.fetchLists('u1');
 const third=load(s,{cached:plain(settledNew.record),now:now+13*60000});
 let fetched=0;const realAll=third.ctx.all;third.ctx.all=async(...a)=>{const rows=await realAll(...a);if(a[0]==='organizations')fetched=rows.length;return rows;};
 const r3=await third.ctx.fetchLists('u1');
 assert.equal(fetched,0,'nothing downloaded when nothing changed');assert.equal(r3.o.length,500);
});
test('a save that committed late, a little before the last time seen, is still picked up',async()=>{
 const last='2026-10-16T09:00:00.500000+00:00';
 const s={organizations:[{id:'o1',name:'A',updated_at:last},{id:'o2',name:'B late',updated_at:'2026-10-16T08:58:00.000000+00:00'}],contacts:[],products:[]};
 const cached={userId:'u1',savedAt:Date.now(),since:{organizations:last,contacts:'',products:''},organizations:[{id:'o1',name:'A'},{id:'o2',name:'B'}],contacts:[],products:[]};
 const {ctx}=load(s,{cached});const r=await ctx.fetchLists('u1');
 assert.equal(r.o.find(o=>o.id==='o2').name,'B late');
});

test('a copy saved before this fix (time rounded to milliseconds) takes the exact time on its next load',async()=>{
 const exact='2026-10-16T08:56:33.402029+00:00';
 assert.equal(vm.runInContext(`listCacheLatest([{updated_at:'${exact}'}],'2026-10-16T08:56:33.402Z')`,load({}).ctx),exact);
 assert.equal(vm.runInContext(`listCacheLatest([{updated_at:'2026-10-16T08:56:33.401999+00:00'}],'${exact}')`,load({}).ctx),exact,'an older row never replaces a newer time');
 assert.ok(vm.runInContext(`listCacheMicros('${exact}')-listCacheMicros('2026-10-16T08:56:33.402Z')`,load({}).ctx)===29);
});

test('a recent watermark includes a same-time row that committed after the saved copy',async()=>{
 const last=new Date(Date.now()-60000).toISOString();
 const s={organizations:[{id:'o1',name:'A',updated_at:last},{id:'o2',name:'Late committed client',updated_at:last}],contacts:[],products:[]};
 const cached={userId:'u1',savedAt:Date.now(),since:{organizations:last,contacts:'',products:''},organizations:[{id:'o1',name:'A',updated_at:last}],contacts:[],products:[]};
 const {ctx,calls}=load(s,{cached});const r=await ctx.fetchLists('u1');
 assert.equal(calls.find(c=>c.table==='organizations').f.neq,undefined);
 assert.equal(r.o.find(o=>o.id==='o2').name,'Late committed client');
});

test('a delayed refresh includes late same-time commits before confirming a watermark, even with a skewed clock',async()=>{
 const now=Date.parse('2026-11-09T10:00:00Z'),stamp='2026-11-09T08:00:00.123456+00:00';
 const s={organizations:[{id:'o1',name:'A',updated_at:stamp}],contacts:[],products:[]};
 const first=await load(s,{now}).ctx.fetchLists('u1');
 s.organizations.push({id:'o2',name:'Committed one minute later',updated_at:stamp});
 const delayed=load(s,{cached:plain(first.record),now:now+6*60000}),second=await delayed.ctx.fetchLists('u1');
 assert.equal(delayed.calls.find(c=>c.table==='organizations').f.neq,undefined);
 assert.deepEqual(Array.from(second.o,row=>row.id),['o1','o2']);
 const following=load(s,{cached:plain(second.record),now:now+7*60000}),third=await following.ctx.fetchLists('u1');
 assert.equal(following.calls.find(c=>c.table==='organizations').f.neq,stamp);
 assert.deepEqual(Array.from(third.o,row=>row.id),['o1','o2']);
 assert.equal(third.record.savedAt,first.record.savedAt);
});

test('legacy or invalid checkpoints reread equal-time rows before becoming eligible for exclusion',async()=>{
 const now=Date.parse('2026-11-09T10:00:00Z'),stamp='2026-10-16T08:56:33.402029+00:00';
 const s={organizations:[{id:'o1',name:'A',updated_at:stamp},{id:'o2',name:'Missing from old cache',updated_at:stamp}],contacts:[],products:[]};
 for(const checkpoint of [undefined,{since:stamp,confirmed:true},{since:stamp,firstSeenAt:'invalid',confirmed:true},{since:stamp,firstSeenAt:now+60000,confirmed:true}]){
  const cached={userId:'u1',savedAt:now,since:{organizations:stamp,contacts:'',products:''},organizations:[s.organizations[0]],contacts:[],products:[],checkpoints:{organizations:checkpoint}};
  const {ctx,calls}=load(s,{cached,now}),result=await ctx.fetchLists('u1');
  assert.equal(calls.find(c=>c.table==='organizations').f.neq,undefined);
  assert.equal(result.o.length,2);
 }
});

test('a slow initial read starts watermark observation on completion, before later stabilization',async()=>{
 const start=Date.parse('2026-11-09T10:00:00Z'),stamp='2026-11-09T10:04:00.123456+00:00';let clock=start;
 const s={organizations:[{id:'o1',name:'A',updated_at:stamp}],contacts:[],products:[]};
 const slow=load(s,{now:()=>clock}),read=slow.ctx.all;
 slow.ctx.all=async(...args)=>{const rows=await read(...args);clock=start+4*60000;return rows;};
 const first=await slow.ctx.fetchLists('u1');
 const early=await load(s,{cached:plain(first.record),now:start+6*60000}).ctx.fetchLists('u1');
 s.organizations.push({id:'o2',name:'Same transaction committed after the early refresh',updated_at:stamp});
 const later=load(s,{cached:plain(early.record),now:start+7*60000}),result=await later.ctx.fetchLists('u1');
 assert.equal(later.calls.find(c=>c.table==='organizations').f.neq,undefined);
 assert.equal(result.o.length,2);
 const stable=await load(s,{cached:plain(result.record),now:start+9*60000}).ctx.fetchLists('u1');
 const next=load(s,{cached:plain(stable.record),now:start+10*60000});
 assert.equal((await next.ctx.fetchLists('u1')).o.length,2);
 assert.equal(next.calls.find(c=>c.table==='organizations').f.neq,stamp);
});
