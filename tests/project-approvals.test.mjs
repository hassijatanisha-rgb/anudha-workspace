import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../project-approvals.js',import.meta.url),'utf8');
test('approval receipt validates every identity and payload field',()=>{
 const context=vm.createContext({workspacePageHeader,statusTone,workspaceLoading(){},workspaceRefreshRetaining:()=>false,window:{addEventListener(){}}});
 vm.runInContext(source,context);
 const attempt={p_id:'request',p_question_id:'question',p_version:1,p_answer:'Yes'};
 const receipt={id:'request',question_id:'question',question_version:1,answer:'Yes',answered_by:'owner'};
 assert.equal(context.approvalReceiptMatches(receipt,attempt,'owner'),true);
 for(const key of Object.keys(receipt))assert.equal(context.approvalReceiptMatches({...receipt,[key]:'wrong'},attempt,'owner'),false);
 assert.equal(context.approvalReceiptMatches(null,attempt,'owner'),false);
});
test('non-owner cannot query approval data',async()=>{
 const target={innerHTML:''};let calls=0;
 const context=vm.createContext({workspacePageHeader,statusTone,workspaceLoading(){},workspaceRefreshRetaining:()=>false,window:{addEventListener(){}},$:()=>target,me:{role:'staff',user_id:'staff'},client:{from(){calls++;}}});
 vm.runInContext(source,context);await context.projectApprovals();
 assert.equal(calls,0);assert.match(target.innerHTML,/Owner access is required/);
});
test('approval SQL guards access, locks versions and protects history',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/202609220010_project_approvals.sql',import.meta.url),'utf8');
 assert.match(sql,/role='owner'/);assert.match(sql,/for update/);
 assert.match(sql,/q.version<>p_version/);assert.match(sql,/unique\(question_id,question_version\)/);
 assert.match(sql,/before update or delete/);assert.match(sql,/enable row level security/g);
 assert.match(sql,/a.answered_by=auth.uid\(\)/);
});
function formHarness(rpc,version=1){
 const status={textContent:''},button={},input={value:'Yes'},summary={},tag={};
 const history={html:'',querySelector:()=>summary,insertAdjacentHTML(_,html){this.html+=html;}};
 const form={dataset:{approval:'q'},elements:{answer:input},querySelector:s=>s==='button'?button:status,parentElement:{querySelector:s=>s==='details'?history:tag}};
 const target={innerHTML:'',querySelectorAll:()=>[form]};
 const client={from(table){return {select(){return this;},eq(){return this;},order(){return this;},range(){return this;},then(ok,bad){return Promise.resolve({data:table.endsWith('questions')?[{id:'q',version,title:'Question',question:'Decide'}]:[],count:table.endsWith('questions')?1:0}).then(ok,bad);}};},rpc};
 const context=vm.createContext({workspacePageHeader,statusTone,busy:false,actionFeedbackShow(){},actionFeedbackReference:node=>node,message(){},workspaceLoading(){},workspaceRefreshRetaining:()=>false,window:{addEventListener(){}},$:()=>target,me:{role:'owner',user_id:'owner'},view:'approvals',run:fn=>fn(),client,crypto:{randomUUID:()=> 'request'},esc:s=>String(s).replaceAll('<','&lt;')});
 vm.runInContext(source,context);
 vm.runInContext("approvalFocus='q'",context);return {context,form,status,button,input,history,tag,target};
}
test('save renders returned history and disables duplicate submissions',async()=>{
 let calls=0;const h=formHarness(async(_,p)=>{calls++;return {data:{id:p.p_id,question_id:p.p_question_id,question_version:p.p_version,answer:p.p_answer,answered_by:'owner',created_at:'today'}};});
 await h.context.projectApprovals();await h.form.onsubmit({preventDefault(){}});
 assert.equal(h.status.textContent,'Answer recorded.');assert.match(h.history.html,/Yes/);assert.equal(h.history.open,true);assert.equal(h.button.disabled,true);
 assert.equal(h.tag.className,'tag chip chip--success');assert.equal(h.tag.textContent,'Answered · recorded');
 await h.form.onsubmit({preventDefault(){}});assert.equal(calls,1);
});
test('approval status uses waiting and answered tones even when the current answer-history page is empty',async()=>{
 const waiting=formHarness(()=>assert.fail('Rendering must not write'));await waiting.context.projectApprovals();
 assert.match(waiting.target.innerHTML,/<span class="tag chip chip--warning">Awaiting your answer<\/span>/);
 const answered=formHarness(()=>assert.fail('Rendering must not write'),2);await answered.context.projectApprovals();
 assert.equal(answered.tag.className,'tag chip chip--success');assert.equal(answered.tag.textContent,'Answered · recorded');assert.equal(answered.history.html,'');
 const page=pageHarness();await page.ctx.projectApprovals();assert.match(page.target.innerHTML,/<span class="tag chip chip--warning">Awaiting an answer<\/span>/);assert.match(page.target.innerHTML,/<span class="tag chip chip--success">Answer recorded<\/span>/);assert.equal(page.queries.length,1);
});
test('uncertain network save retains the request when returning to page',async()=>{
 const attempts=[];const h=formHarness(async(_,p)=>{attempts.push({...p});throw Error('Network unavailable');});
 await h.context.projectApprovals();await h.form.onsubmit({preventDefault(){}});
 await h.context.projectApprovals();await h.form.onsubmit({preventDefault(){}});
 assert.deepEqual(attempts[0],attempts[1]);assert.equal(h.input.readOnly,true);assert.equal(h.button.disabled,false);
});
test('database rejection allows reloading the current version',async()=>{
 const h=formHarness(async()=>({error:{code:'P0001',message:'Another answer was saved'}}));
 await h.context.projectApprovals();await h.form.onsubmit({preventDefault(){}});
 assert.equal(h.button.textContent,'Reload current decision');assert.equal(typeof h.button.onclick,'function');assert.match(h.status.textContent,/Not saved/);
});
test('old form refuses submission after the signed-in account changes',async()=>{
 let calls=0;const h=formHarness(async()=>{calls++;return {error:{message:'wrong session'}};});
 await h.context.projectApprovals();
 h.context.me={role:'owner',user_id:'another-owner'};
 await h.form.onsubmit({preventDefault(){}});
 assert.equal(calls,0);
 assert.match(h.status.textContent,/session changed/i);
});
test('old form refuses submission after navigating away',async()=>{
 let calls=0;const h=formHarness(async()=>{calls++;return {};});
 await h.context.projectApprovals();h.context.view='inventory';
 await h.form.onsubmit({preventDefault(){}});
 assert.equal(calls,0);
});

function pageHarness(){
 const queries=[],nodes=new Map(),target={innerHTML:'',querySelectorAll:()=>[]},questions=Array.from({length:47},(_,i)=>({id:'q'+i,title:'Decision <'+i+'>',version:i%2+1,question:'Long private question '.repeat(200)}));
 const ctx=vm.createContext({workspacePageHeader,statusTone,window:{addEventListener(){}},workspaceLoading(){},me:{user_id:'owner',role:'owner'},view:'approvals',esc:s=>String(s??'').replaceAll('<','&lt;'),run:fn=>fn(),$:selector=>{if(selector==='#content')return target;if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);},client:{from(table){const calls=[],query={table,calls};queries.push(query);let begin=0,end=19,scope='';const builder={select(...args){calls.push(['select',...args]);return this;},eq(key,value){calls.push(['eq',key,value]);scope=value;return this;},order(...args){calls.push(['order',...args]);return this;},range(from,to){calls.push(['range',from,to]);begin=from;end=to;return this;},then(ok,bad){const rows=table.endsWith('questions')?(scope?questions.filter(q=>q.id===scope):questions.slice(begin,end+1)):[];return Promise.resolve({data:rows,count:table.endsWith('questions')?questions.length:51}).then(ok,bad);}};return builder;}}});vm.runInContext(source,ctx);
 return {ctx,target,queries,nodes,set:code=>vm.runInContext(code,ctx)};
}
test('owner questions show 20 bounded summaries with full paging and no answer read until Open',async()=>{
 const f=pageHarness();await f.ctx.projectApprovals();assert.equal(f.queries.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.queries[0].calls[0])),['select','id,title,version',{count:'exact'}]);assert.deepEqual(f.queries[0].calls.at(-1),['range',0,19]);assert.equal((f.target.innerHTML.match(/data-approval-open=/g)||[]).length,20);assert.doesNotMatch(f.target.innerHTML,/Long private question|textarea|data-approval=/);assert.match(f.target.innerHTML,/Decision &lt;0>/);
 await f.nodes.get('#approvalNext').onclick();await f.nodes.get('#approvalNext').onclick();assert.deepEqual(f.queries[2].calls.at(-1),['range',40,59]);assert.equal((f.target.innerHTML.match(/data-approval-open=/g)||[]).length,7);
 f.set("approvalFocus='q46';approvalHistoryPage=1");await f.ctx.projectApprovals();assert.equal(f.queries.length,5);assert.ok(f.queries[4].calls.some(call=>JSON.stringify(call)===JSON.stringify(['eq','question_id','q46'])));assert.deepEqual(f.queries[4].calls.at(-1),['range',25,49]);assert.match(f.target.innerHTML,/Long private question/);
});
test('a response after replacing the owner session cannot update an old answer form',async()=>{
 let release;const h=formHarness(()=>new Promise(resolve=>release=resolve));await h.context.projectApprovals();const pending=h.form.onsubmit({preventDefault(){}});h.context.me={...h.context.me};release({data:{id:'request',question_id:'q',question_version:1,answer:'Yes',answered_by:'owner'}});await pending;assert.equal(h.history.html,'');assert.notEqual(h.status.textContent,'Answer recorded.');
});
