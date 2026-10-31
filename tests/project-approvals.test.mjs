import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
const source=readFileSync(new URL('../project-approvals.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function validationFixture(){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body);Object.defineProperty(prototype,'type',{configurable:true,get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}});document.body.innerHTML='<main id="content"></main><button id="external">Other action</button>';
 const calls=[],ids=[],feedback=[],messages=[];let write=null;
 const receipt=args=>({id:args.p_id,question_id:args.p_question_id,question_version:args.p_version,answer:args.p_answer,answered_by:'owner',created_at:'2026-10-31'});
 const c=vm.createContext({workspacePageHeader,statusTone,document,window:{addEventListener(){}},$:selector=>document.querySelector(selector),me:{role:'owner',user_id:'owner'},view:'approvals',busy:false,workspaceLoading(){},crypto:{randomUUID:()=>{const id='attempt-'+(ids.length+1);ids.push(id);return id;}},esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),message:(...args)=>messages.push(args),actionFeedbackReference:node=>node,actionFeedbackShow(){},actionFeedbackRefuse:(_button,target)=>{target.textContent='Another action is still running.';},run:async(fn,options)=>{feedback.push(options);return fn();},client:{from(table){return {select(){return this;},eq(){return this;},order(){return this;},range(){return this;},then(ok,bad){return Promise.resolve({data:table.endsWith('questions')?[{id:'q',version:3,title:'Decision',question:'Choose the next step'}]:[],count:table.endsWith('questions')?1:0}).then(ok,bad);}};},rpc:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return write?write(name,args):{data:receipt(args)};}}});
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8')+'\n'+source,c);vm.runInContext("approvalFocus='q'",c);await c.projectApprovals();
 const form=()=>document.querySelector('[data-approval]');
 return {c,document,calls,ids,feedback,messages,receipt,form,input:()=>form().elements.answer,button:()=>form().querySelector('button'),summary:()=>form().querySelector('[role="alert"]'),status:()=>form().querySelector('.approvalStatus'),submit:()=>form().onsubmit({preventDefault(){}}),setWrite:fn=>write=fn,get:code=>vm.runInContext(code,c),stale(mode){if(mode==='actor')c.me={...c.me};else if(mode==='role')c.me.role='staff';else if(mode==='view')c.view='inventory';else if(mode==='load')vm.runInContext('approvalLoad++',c);else form().remove();}};
}

test('owner-answer validation: departed blank text reports at the top without moving focus or reserving an attempt',async()=>{
 const f=await validationFixture(),form=f.form(),input=f.input(),button=f.button();input.setAttribute('aria-describedby','answer-help');input.value='   ';button.focus();dispatchFocusout(input);assert.ok(f.summary());assert.equal(f.summary().textContent,'1 field needs attention');assert.equal(form.noValidate,true);assert.equal(form.querySelectorAll('.field-error').length,1);assert.equal(f.document.activeElement,button);assert.match(input.getAttribute('aria-describedby'),/^answer-help field-error-/);assert.ok(form.children.indexOf(f.summary())<form.children.indexOf(input.closest('label')));assert.equal(f.status().textContent,'');assert.equal(f.ids.length,0);assert.equal(f.calls.length,0);
 input.value='Proceed';dispatchFocusout(input);assert.equal(f.summary().textContent,'');assert.equal(input.getAttribute('aria-describedby'),'answer-help');assert.equal(input.getAttribute('aria-invalid'),null);assert.equal(f.calls.length,0);
});
test('owner-answer validation: empty, whitespace and overlong answers stop before UUID allocation and focus the textarea',async()=>{
 for(const value of ['', '  \n ', 'x'.repeat(4001)]){const f=await validationFixture();f.input().value=value;f.button().focus();await f.submit();assert.equal(f.ids.length,0,value.slice(0,10));assert.equal(f.calls.length,0);assert.equal(f.get('approvalAttempts.size'),0);assert.equal(f.summary().textContent,'1 field needs attention');assert.equal(f.document.activeElement,f.input());assert.equal(f.input().scrolledIntoView.block,'center');assert.equal(f.input().readOnly,undefined);assert.equal(f.button().disabled,false);assert.equal(f.input().value,value);}
});
test('owner-answer validation: native and custom errors render only text and block the writer',async()=>{
 for(const native of [true,false]){const f=await validationFixture();f.input().value='Proceed';if(native)f.input()._nativeError='Check this answer.';else f.input().setCustomValidity('<img src=x> Check answer');await f.submit();assert.equal(f.calls.length,0);assert.equal(f.ids.length,0);const error=f.form().querySelector('.field-error');assert.ok(error);assert.equal(error.querySelector('img'),null);assert.match(error.textContent,native?/Check this answer/:/<img src=x> Check answer/);}
});
test('owner-answer validation: corrected text keeps action geometry until first submit writes the exact trimmed payload once',async()=>{
 for(const action of ['submit','back','external']){const f=await validationFixture(),input=f.input(),wait=deferred();dispatchFocusout(input);const node=f.form().querySelector('.field-error');assert.ok(node);input.value='  Proceed <safely>  ';for(const {fn}of f.form().events.change||[])fn({target:input});dispatchFocusout(input,action==='submit'?f.button():f.document.querySelector(action==='back'?'#approvalBack':'#external'));assert.equal(f.form().querySelector('.field-error'),node,action);assert.equal(f.summary().textContent,'1 field needs attention',action);f.setWrite(()=>wait.promise);const saving=f.submit();assert.deepEqual(f.calls,[{name:'record_project_approval',args:{p_id:'attempt-1',p_question_id:'q',p_version:3,p_answer:'Proceed <safely>'}}]);assert.equal(f.summary().textContent,'');assert.equal(f.form().querySelector('.field-error'),null);assert.equal(f.button().disabled,true);assert.equal(input.readOnly,true);await f.submit();assert.equal(f.calls.length,1);wait.resolve({data:f.receipt(f.calls[0].args)});await saving;assert.equal(f.status().textContent,'Answer recorded.');assert.equal(f.form().parentElement.querySelector('details').querySelector('safely'),null);assert.equal(f.get('approvalAttempts.size'),0);await f.submit();assert.equal(f.calls.length,1);}
});
test('owner-answer validation: unknown outcome and page revisit retain exact identity despite invalid changed readonly text',async()=>{
 const f=await validationFixture();f.input().value='  Proceed  ';f.setWrite(()=>{throw Error('Offline');});await f.submit();assert.equal(f.button().textContent,'Retry same answer');assert.equal(f.input().readOnly,true);assert.equal(f.get('approvalAttempts.size'),1);const status=f.status().textContent;f.input().value='';f.input().setCustomValidity('Ignore changed readonly input');dispatchFocusout(f.input());assert.equal(f.summary().textContent,'');assert.equal(f.status().textContent,status);f.setWrite(null);await f.c.projectApprovals();assert.equal(f.input().value,'Proceed');assert.equal(f.input().readOnly,true);f.input().value='';f.input().setCustomValidity('Ignore changed readonly input');await f.submit();assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.ids.length,1);assert.equal(f.get('approvalAttempts.size'),0);assert.equal(f.status().textContent,'Answer recorded.');
});
test('owner-answer validation: busy, stale, readonly and saving states do not render new field errors',async()=>{
 for(const mode of ['actor','role','view','load','detach','busy']){const f=await validationFixture(),form=f.form(),input=f.input();if(mode==='busy')f.c.busy=true;else f.stale(mode);dispatchFocusout(input);assert.equal(form.querySelector('.field-error'),null,mode);if(mode!=='detach')await f.submit();assert.equal(f.calls.length,0,mode);assert.equal(f.ids.length,0,mode);}
 const f=await validationFixture(),wait=deferred();f.input().value='Proceed';f.setWrite(()=>wait.promise);const saving=f.submit();f.input().value='';dispatchFocusout(f.input());assert.equal(f.form().querySelector('.field-error'),null);assert.equal(f.status().textContent,'Saving…');wait.resolve({data:f.receipt(f.calls[0].args)});await saving;dispatchFocusout(f.input());assert.equal(f.form().querySelector('.field-error'),null);assert.equal(f.status().textContent,'Answer recorded.');
});
test('owner-answer validation: definitive version rejection retains the existing reload-only recovery',async()=>{
 const f=await validationFixture();f.input().value='Proceed';f.setWrite(()=>({error:{code:'P0001',message:'Version changed'}}));await f.submit();assert.equal(f.get('approvalAttempts.size'),0);assert.equal(f.button().type,'button');assert.equal(f.button().textContent,'Reload current decision');assert.equal(f.input().readOnly,true);const status=f.status().textContent;f.input().value='';dispatchFocusout(f.input());assert.equal(f.form().querySelector('.field-error'),null);assert.equal(f.status().textContent,status);await f.button().onclick();assert.equal(f.calls.length,1);assert.equal(f.ids.length,1);assert.equal(f.input().readOnly,undefined);assert.equal(f.button().textContent,'Record answer');
});
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
 const form={addEventListener(){},querySelectorAll:()=>[],dataset:{approval:'q'},elements:{answer:input},querySelector:s=>s==='button'?button:status,parentElement:{querySelector:s=>s==='details'?history:tag}};
 const target={innerHTML:'',querySelectorAll:()=>[form]};
 const client={from(table){return {select(){return this;},eq(){return this;},order(){return this;},range(){return this;},then(ok,bad){return Promise.resolve({data:table.endsWith('questions')?[{id:'q',version,title:'Question',question:'Decide'}]:[],count:table.endsWith('questions')?1:0}).then(ok,bad);}};},rpc};
 const context=vm.createContext({workspacePageHeader,statusTone,busy:false,actionFeedbackShow(){},actionFeedbackReference:node=>node,message(){},workspaceLoading(){},workspaceRefreshRetaining:()=>false,window:{addEventListener(){}},$:()=>target,me:{role:'owner',user_id:'owner'},view:'approvals',run:fn=>fn(),client,crypto:{randomUUID:()=> 'request'},esc:s=>String(s).replaceAll('<','&lt;')});
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8')+'\n'+source,context);
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
