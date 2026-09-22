import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../project-approvals.js',import.meta.url),'utf8');
test('approval receipt validates every identity and payload field',()=>{
 const context=vm.createContext({window:{addEventListener(){}}});
 vm.runInContext(source,context);
 const attempt={p_id:'request',p_question_id:'question',p_version:1,p_answer:'Yes'};
 const receipt={id:'request',question_id:'question',question_version:1,answer:'Yes',answered_by:'owner'};
 assert.equal(context.approvalReceiptMatches(receipt,attempt,'owner'),true);
 for(const key of Object.keys(receipt))assert.equal(context.approvalReceiptMatches({...receipt,[key]:'wrong'},attempt,'owner'),false);
 assert.equal(context.approvalReceiptMatches(null,attempt,'owner'),false);
});
test('non-owner cannot query approval data',async()=>{
 const target={innerHTML:''};let calls=0;
 const context=vm.createContext({window:{addEventListener(){}},$:()=>target,me:{role:'staff',user_id:'staff'},client:{from(){calls++;}}});
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
function formHarness(rpc){
 const status={textContent:''},button={},input={value:'Yes'},summary={},tag={};
 const history={html:'',querySelector:()=>summary,insertAdjacentHTML(_,html){this.html+=html;}};
 const form={dataset:{approval:'q'},elements:{answer:input},querySelector:s=>s==='button'?button:status,parentElement:{querySelector:s=>s==='details'?history:tag}};
 const target={innerHTML:'',querySelectorAll:()=>[form]};
 const client={from(table){return {select(){return this;},order(){return this;},limit(){return Promise.resolve({data:table.endsWith('questions')?[{id:'q',version:1,title:'Question',question:'Decide'}]:[]});}};},rpc};
 const context=vm.createContext({window:{addEventListener(){}},$:()=>target,me:{role:'owner',user_id:'owner'},view:'approvals',client,crypto:{randomUUID:()=> 'request'},esc:s=>String(s).replaceAll('<','&lt;')});
 vm.runInContext(source,context);
 return {context,form,status,button,input,history,tag};
}
test('save renders returned history and disables duplicate submissions',async()=>{
 let calls=0;const h=formHarness(async(_,p)=>{calls++;return {data:{id:p.p_id,question_id:p.p_question_id,question_version:p.p_version,answer:p.p_answer,answered_by:'owner',created_at:'today'}};});
 await h.context.projectApprovals();await h.form.onsubmit({preventDefault(){}});
 assert.equal(h.status.textContent,'Answer recorded.');assert.match(h.history.html,/Yes/);assert.equal(h.history.open,true);assert.equal(h.button.disabled,true);
 await h.form.onsubmit({preventDefault(){}});assert.equal(calls,1);
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
