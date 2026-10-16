import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fetchSrc=app.slice(app.indexOf('const listColumns='),app.indexOf('function loadLists()'));
// Runs list-cache.js and fetchLists with a fake server: tables hold rows; each call records its filter.
function load(tables,{cached=null,missingColumn=false,otherError=false}={}){
 const calls=[];
 const ctx=vm.createContext({Date,Map,Set,Number,String,Array,Object,Promise,Error,JSON,setTimeout});
 vm.runInContext(readFileSync(new URL('../list-cache.js',import.meta.url),'utf8'),ctx);
 ctx.listCacheRead=async()=>cached;
 ctx.all=async(table,cols,filter)=>{
  const q={gte:(col,v)=>({kind:'gte',col,v}),is:(col,v)=>({kind:'is',col,v})};const f=filter?filter(q):null;calls.push({table,cols,f});
  if(otherError)throw Error('network down');
  if(missingColumn&&cols.includes('updated_at'))throw Error('column organizations.updated_at does not exist');
  let rows=tables[table];if(f?.kind==='gte')rows=rows.filter(r=>r.updated_at>=f.v);if(f?.kind==='is')rows=rows.filter(r=>!r.deleted_at);
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
 const ctx=vm.createContext({Date,Map,Number});
 vm.runInContext(readFileSync(new URL('../list-cache.js',import.meta.url),'utf8'),ctx);
 assert.equal(vm.runInContext(`listCacheLatest([{updated_at:'${T('07:00:00')}'},{updated_at:'${T('09:30:00')}'}],'${T('08:00:00')}')`,ctx),T('09:30:00'));
 assert.equal(vm.runInContext(`listCacheLatest([],'')`,ctx),'');
 assert.equal(vm.runInContext(`listCacheFrom('')`,ctx),'1970-01-01T00:00:00.000Z','no time seen yet asks for everything');
 assert.equal(vm.runInContext(`listCacheMerge([{id:'a'}],[{id:'a',deleted_at:'x'}],true)[0].deleted_at`,ctx),'x');
});
test('the saved copy is wiped whenever the sign-in page is shown',()=>{
 assert.match(app,/function login\(\)\{if\(typeof listCacheClear==='function'\)listCacheClear\(\);/);
});
