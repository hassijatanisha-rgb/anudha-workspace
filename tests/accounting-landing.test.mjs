import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(){
 const calls=[],nodes=new Map(),node=()=>({innerHTML:'',isConnected:true,before(){},querySelector:()=>node(),querySelectorAll:()=>[]});
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
 const ctx=vm.createContext({workspacePageHeader,me:{user_id:'owner',role:'owner'},view:'accounting',listsLoaded:false,listsLoading:null,$,workspaceLoading(){},esc:value=>String(value??'').replaceAll('<','&lt;'),document:{createElement:()=>node(),querySelectorAll:()=>[]},companyFormDefinitions:()=>({tax_invoice:{title:'Invoice draft'}}),companyFormDefinition:()=>({title:'Invoice draft'}),run:fn=>fn(),
  loadLists:async()=>{throw Error('Unexpected shared-list load');},
  client:{rpc:async name=>{calls.push({name});return {data:true};},from:table=>{const call={name:table},q={select(columns){call.columns=columns;return q;},eq(){return q;},order(){return q;},async range(start,end){calls.push({...call,start,end});if(ctx.response)return ctx.response;return {data:Array.from({length:25},(_,i)=>table==='accounting_drafts'?{id:'draft-'+i,kind:'tax_invoice',version:1,body:{number:'DRAFT-'+i},organization_id:'org',customer:{name:'Joined <customer>'}}:{id:'pf-'+i,document_number:'PF-'+i,revision:1,organization_id:'org',customer:{name:'Joined <customer>'}})};}};return q;}}
 });
 Object.defineProperty(ctx,'organizations',{get(){throw Error('Landing accessed the full customer cache');}});
 vm.runInContext('function workspaceSkeleton(kind,label)'+read('workspace-refresh.js').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);
 for(const file of ['accounting-access.js','proforma-accounting-queue.js','accounting-workspace.js'])vm.runInContext(read(file),ctx);
 return {ctx,calls,nodes,$};
}
test('accounting landing uses four permission-scoped requests and embedded names without shared lists',async()=>{
 const f=fixture();await f.ctx.accountingWorkspace();
 assert.deepEqual(f.calls.map(c=>c.name),['accounting_access','accounting_drafts','accounting_access','sales_proformas']);
 for(const call of f.calls.filter(c=>c.columns)){assert.match(call.columns,/customer:organizations\(name\)/);assert.equal(call.start,0);assert.equal(call.end,24);}
 assert.match(f.$('#content').innerHTML,/Joined &lt;customer>/);assert.equal(f.ctx.listsLoaded,false);
});
test('a request page or replacement login rejects stale joined accounting rows',async()=>{
 for(const replace of [ctx=>{ctx.me={...ctx.me};},ctx=>{ctx.view='sales';},ctx=>vm.runInContext('accountingRequest++',ctx)]){
  const f=fixture(),wait=deferred();f.ctx.response=wait.promise;const loading=f.ctx.accountingWorkspace();await new Promise(setImmediate);replace(f.ctx);f.$('#content').innerHTML='Current screen';wait.resolve({data:[{body:{number:'OLD PRIVATE'}}]});await loading;
  assert.equal(f.$('#content').innerHTML,'Current screen');assert.equal(f.calls.some(c=>c.name==='sales_proformas'),false);
 }
});
test('draft editor fetches full links only on explicit opening and stops on missing prerequisites',async()=>{
 const f=fixture();let loads=0;f.ctx.loadLists=async()=>{loads++;return false;};
 await assert.rejects(f.ctx.accountingEditor({id:'draft'},'owner'),/Customer records could not load/);assert.equal(loads,1);assert.equal(f.$('#content').innerHTML,'');
});
test('a replaced login during editor prerequisite loading cannot mount the old draft',async()=>{
 const f=fixture(),wait=deferred();f.ctx.loadLists=()=>wait.promise;const opening=f.ctx.accountingEditor({id:'draft'},'owner');await new Promise(setImmediate);
 f.ctx.me={...f.ctx.me};f.$('#content').innerHTML='Replacement';f.ctx.listsLoaded=true;wait.resolve(true);await opening;assert.equal(f.$('#content').innerHTML,'Replacement');
});
