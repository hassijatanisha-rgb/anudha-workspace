import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../customer-requests.js',import.meta.url),'utf8');
const row=(id='request',extra={})=>({id,request_number:'REQ-1',kind:'inquiry',status:'received',name:'Example person',organization:'Example clinic',created_at:'2026-10-29T08:00:00Z',phone:'0712345678',message:'Long complete request',version:1,...extra});
const page=(rows=[row()])=>({rows,total:rows.length,page:0,pages:1,counts:{all:rows.length,open:rows.length,new:rows.length,mine:0,done:0}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const calls=[],nodes=new Map(),content={innerHTML:'Previous page',isConnected:true},card={isConnected:true,querySelector:()=>({}),replaceWith(next){calls.push(['replace-card',next.html]);}};
 const node=()=>({addEventListener(){}}),ctx=vm.createContext({statusTone,me:{user_id:'actor'},view:'requests',Date,encodeURIComponent,CSS:{escape:String},esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:()=> 'Employee',syncWorkspaceNavigation(){},workspaceLoading(){},message:(...args)=>calls.push(['message',...args]),
  $:selector=>{if(selector==='#content')return content;if(selector==='#requestSearch'&&!content.innerHTML.includes('id="requestSearch"'))return null;if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},
  document:{activeElement:null,querySelectorAll:()=>[],querySelector:()=>card,createElement:()=>({set innerHTML(html){this.content={firstElementChild:{html}};}})},
  client:{rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:page()};},from:table=>{calls.push(['from',table]);return {select:columns=>({eq:(key,id)=>({maybeSingle:async()=>{calls.push(['detail',columns,key,id]);return {data:row(id)};}})})};}},
  actionForm:(title,fields,save)=>{ctx.save=save;calls.push(['form',title]);},run:fn=>fn(),renderSearchPreservingPosition:(input,render)=>render()
 });installPageHeader(ctx);vm.runInContext(source,ctx);return {ctx,calls,content,read:code=>vm.runInContext(code,ctx)};
}
test('website request landing makes one bounded RPC, with no full collection or detail reads',async()=>{
 const f=fixture();await f.ctx.customerRequestsWorkspace();
 assert.deepEqual(f.calls.filter(c=>c[0]==='rpc').map(c=>c[1]),['customer_request_page']);assert.equal(f.calls.some(c=>c[0]==='from'),false);
 assert.equal(f.read('requestRows.length'),0);assert.equal(f.read('requestPageData.rows.length'),1);assert.match(f.content.innerHTML,/data-request-open/);assert.doesNotMatch(f.content.innerHTML,/Long complete request|data-request-action/);
});
test('paging and search forward only typed values and preserve the complete-detail cache boundary',async()=>{
 const f=fixture();f.read("requestPage=2;requestFilter='mine';requestSearch='needle';");await f.ctx.customerRequestsWorkspace();
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][2])),{p_section:'inquiries',p_filter:'mine',p_query:'needle',p_page:2});assert.equal(f.read('requestRows.length'),0);
});
test('explicit opening reads exactly the selected request and exposes existing actions',async()=>{
 const f=fixture();f.read("requestSelected='selected';");await f.ctx.customerRequestsWorkspace();
 assert.deepEqual(f.calls.filter(c=>c[0]==='detail'),[['detail','*','id','selected']]);assert.equal(f.calls.some(c=>c[0]==='rpc'),false);assert.match(f.content.innerHTML,/Long complete request/);assert.match(f.content.innerHTML,/data-request-action="resolve"/);
});
test('the next request page cannot be overwritten by an older response',async()=>{
 const f=fixture(),old=deferred();let n=0;f.ctx.client.rpc=()=>++n===1?old.promise:Promise.resolve({data:page([row('new')])});
 const first=f.ctx.customerRequestsWorkspace();await f.ctx.customerRequestsWorkspace();old.resolve({data:page([row('old')])});await first;
 assert.equal(f.read('requestPageData.rows[0].id'),'new');
});
test('late failures after navigation do not replace another workspace',async()=>{
 const f=fixture(),old=deferred();f.ctx.client.rpc=()=>old.promise;const first=f.ctx.customerRequestsWorkspace();f.ctx.view='settings';f.content.innerHTML='Settings';old.reject(Error('Old failure'));await first;assert.equal(f.content.innerHTML,'Settings');
});
test('invalid and oversized pages fail visibly instead of rendering uncontrolled rows',async()=>{
 for(const data of [{...page(),rows:Array.from({length:26},()=>row())},{...page(),page:-1},{...page(),pages:0}]){const f=fixture();f.ctx.client.rpc=async()=>({data});await f.ctx.customerRequestsWorkspace();assert.match(f.content.innerHTML,/could not be confirmed/);assert.equal(f.read('requestPageData'),null);}
});
test('summary rows escape identity and omit full messages, contact methods and write buttons',()=>{
 const f=fixture(),html=f.ctx.requestSummaryCard(row('id',{name:'<img src=x>',message:'PRIVATE NARRATIVE',phone:'0712345678',email:'person@example.invalid'}));
 assert.doesNotMatch(html,/<img|PRIVATE NARRATIVE|0712345678|person@example|data-request-action/);assert.equal((html.match(/<button/g)||[]).length,1);assert.match(html,/&#60;img/);
});
test('confirmed request change replaces only the selected card without rereading',async()=>{
 const f=fixture(),current=row();f.read("requestSelected='request';requestRows=[];");f.ctx.client.rpc=async(name,args)=>{f.calls.push(['rpc',name,args]);return {data:row('request',{status:'in_progress',version:2,assigned_user_id:'actor'})};};
 await f.ctx.openRequestAction(current,'take');await f.ctx.save({});assert.equal(f.calls.filter(c=>c[0]==='rpc').length,1);assert.equal(f.calls.filter(c=>c[0]==='replace-card').length,1);assert.equal(f.content.innerHTML,'Previous page');assert.equal(f.read('requestRows[0].status'),'in_progress');
});
test('unverified save removes stale controls and leaves a persistent recovery message',async()=>{
 const f=fixture();f.read("requestSelected='request';");f.ctx.client.rpc=async()=>({data:{id:'wrong',version:2}});await f.ctx.openRequestAction(row(),'take');await f.ctx.save({});assert.equal(f.content.innerHTML,'Previous page');assert.equal(f.read('requestRows.length'),0);assert.equal(f.calls.filter(c=>c[0]==='detail').length,1);assert.equal(f.calls.some(c=>c[0]==='replace-card'),false);
});
test('an action from an older selected request cannot write or paint into the current request',async()=>{
 const f=fixture();f.read("requestSelected='request';");await f.ctx.openRequestAction(row(),'take');f.read("requestSelected='other';");await assert.rejects(f.ctx.save({}),/request changed/);assert.equal(f.calls.some(c=>c[0]==='rpc'),false);
});
