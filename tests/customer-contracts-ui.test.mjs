import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';');
const contract=(extra={})=>({id:'contract-1',contract_number:'CT-2026-000001',organization_id:'branch-1',kind:'placement',title:'Analyzer placement',reference:'Signed agreement',starts_on:'2026-10-01',ends_on:'2027-10-01',status:'draft',version:1,notes:'Internal contract note',...extra});
function backend(answer){const queries=[];return {queries,from(table){const query={table,calls:[]};queries.push(query);const builder=new Proxy({},{get(_,name){if(name==='then')return (ok,bad)=>Promise.resolve(answer(query)).then(ok,bad);return (...args)=>{query.calls.push([name,...args]);return builder;};}});return builder;}};}
function context(extra={}){
 const nodes=new Map(),target={innerHTML:'',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{addEventListener(){}});return nodes.get(selector);},querySelectorAll:()=>[]},dialogs=[];
 let sequence=0;const ctx=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,me:{user_id:'owner',role:'owner',access:[]},view:'contracts',organizations:[{id:'branch-1',name:'Fixture Clinic'}],esc,companyDate:()=> '2026-10-20',employeeName:id=>id,salesOrganizationOptions:()=>'',crypto:{randomUUID:()=>`request-${++sequence}`},branchActivityCache:new Map(),$:()=>target,run:fn=>fn(),message:()=>{},
  document:{createElement(){const dialog={innerHTML:'',setAttribute(){},querySelector:()=>({}),addEventListener(){},close(){},remove(){},showModal(){}};dialogs.push(dialog);return dialog;},body:{append(){}}},...extra});
 ctx.hasArea=area=>Array.isArray(area)?area.some(value=>ctx.hasArea(value)):ctx.me?.role==='owner'||ctx.me?.access?.includes(area);
 vm.runInContext(read('customer-contracts.js'),ctx);return {ctx,target,dialogs,run:source=>vm.runInContext(source,ctx)};
}
test('contract categories follow service/commercial permissions and effective dates are inclusive',()=>{
 const {ctx}=context();ctx.me={role:'staff',access:['service']};assert.equal(ctx.contractKindsAllowed().map(([id])=>id).join(','),'service');ctx.me.access=['proformas'];assert.equal(ctx.contractKindsAllowed().map(([id])=>id).join(','),'placement,payment_terms');
 assert.equal(ctx.contractActive(contract({status:'approved',starts_on:'2026-10-20',ends_on:'2026-10-20'})),true);assert.equal(ctx.contractActive(contract({status:'approved',starts_on:'2026-10-21'})),false);assert.equal(ctx.contractActive(contract({status:'approved',ends_on:'2026-10-19'})),false);assert.equal(ctx.contractActive(contract()),false);
});
test('contracts register uses bounded ordered paging, filters, and safe escaped output',async()=>{
 const client=backend(()=>({data:Array.from({length:31},(_,i)=>contract({id:'row-'+i,title:i===0?'<img onerror=bad>':'Agreement '+i}))})),f=context({client});
 f.run("contractKind='placement';contractCustomer='branch-1';contractPage=2");await f.ctx.contractsWorkspace();
 const calls=client.queries[0].calls;assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['range',60,90])));assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['eq','organization_id','branch-1'])));assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['order','id',{ascending:false}])));
 assert.equal((f.target.innerHTML.match(/data-contract-card=/g)||[]).length,30);assert.match(f.target.innerHTML,/&#60;img onerror=bad&#62;/);assert.doesNotMatch(f.target.innerHTML,/<img onerror/);assert.match(f.target.innerHTML,/Page 3/);
});
test('contracts loads cannot publish another session or a superseded response',async()=>{
 let resolve;const f=context({client:backend(()=>new Promise(r=>{resolve=r;}))});const pending=f.ctx.contractsWorkspace();await new Promise(r=>setImmediate(r));f.ctx.me={user_id:'owner',role:'owner'};resolve({data:[contract()]});await pending;assert.doesNotMatch(f.target.innerHTML,/Analyzer placement/);
 const second=f.ctx.contractsWorkspace();await new Promise(r=>setImmediate(r));f.ctx.clearCustomerContracts();resolve({data:[contract()]});await second;assert.doesNotMatch(f.target.innerHTML,/Analyzer placement/);
});
test('contract draft saves use stable request identity, explicit fields and expected version',async()=>{
 let form,attempt=0,refreshes=0;const calls=[],f=context({actionForm:(title,html,submit)=>{form={title,html,submit};},client:{rpc:async(name,args)=>{calls.push({name,args});return ++attempt===1?{error:Error('Response lost')}:{data:{id:args.p_id,version:args.p_expected_version+1}};}}});f.ctx.contractsWorkspace=async()=>{refreshes++;};
 f.ctx.openContractEditor(contract({title:'<script>bad</script>'}));assert.match(form.html,/&#60;script&#62;/);const values={customer:'branch-1',kind:'placement',title:'Updated placement',reference:'Revised document',starts:'2026-10-20',ends:'',notes:'Private notes'};
 await assert.rejects(form.submit(values),/Response lost/);await form.submit(values);assert.equal(calls[0].name,'save_customer_contract');assert.deepEqual(calls[0].args,calls[1].args);assert.equal(calls[0].args.p_expected_version,1);assert.equal(calls[0].args.p_ends_on,null);assert.equal(calls[0].args.p_notes,'Private notes');assert.equal(refreshes,1);assert.equal(f.run('contractFocus'),'contract-1');
});
test('contract edit rejects stale sessions before sending and suppresses stale success',async()=>{
 let form,resolve,calls=0;const f=context({actionForm:(_,__,submit)=>{form=submit;},client:{rpc:()=>{calls++;return new Promise(r=>{resolve=r;});}},message:()=>assert.fail('Stale confirmation')});f.ctx.contractsWorkspace=()=>assert.fail('Stale refresh');
 f.ctx.openContractEditor(contract());f.ctx.clearCustomerContracts();await assert.rejects(form({}),/Reopen/);assert.equal(calls,0);
 f.ctx.openContractEditor(contract());const pending=form({customer:'branch-1',kind:'placement',title:'Title',reference:'Reference',starts:'2026-10-20',ends:'',notes:''});f.ctx.me={user_id:'other',role:'staff'};resolve({data:{id:'contract-1',version:2}});await pending;assert.equal(calls,1);
});
test('owner decision identifies the selected document and rejects unconfirmed responses',async()=>{
 let form;const calls=[],client=backend(()=>({data:[{id:'file-1',original_filename:'<signed>.pdf',uploaded_at:'2026-10-20'},{id:'file-2',original_filename:'Second.pdf',uploaded_at:'2026-10-19'}]}));client.rpc=async(name,args)=>{calls.push({name,args});return {data:{id:'wrong-id',version:2}};};
 const f=context({client,actionForm:(title,html,submit)=>{form={title,html,submit};}});await f.ctx.openContractDecision(contract(),'approve');assert.match(form.html,/&#60;signed&#62;\.pdf/);assert.match(form.html,/Exact document/);
 for(let i=0;i<2;i++)await assert.rejects(form.submit({attachment:'file-2',reference:'Signed document reviewed'}),/did not confirm/);
 assert.equal(calls[0].name,'decide_customer_contract');assert.equal(calls[0].args.p_attachment_id,'file-2');assert.equal(calls[0].args.p_expected_version,1);assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.ok(client.queries[0].calls.some(call=>JSON.stringify(call)===JSON.stringify(['eq','record_id','contract-1'])));
});
test('approval requires an uploaded document and abandons late attachment reads',async()=>{
 const noFiles=context({client:backend(()=>({data:[]})),actionForm:()=>assert.fail('No file approval form')});await assert.rejects(noFiles.ctx.openContractDecision(contract(),'approve'),/Upload the contract/);
 let resolve;const stale=context({client:backend(()=>new Promise(r=>{resolve=r;})),actionForm:()=>assert.fail('Stale approval form')});const pending=stale.ctx.openContractDecision(contract(),'approve');await new Promise(r=>setImmediate(r));stale.ctx.clearCustomerContracts();resolve({data:[{id:'file-1'}]});await pending;
});
test('contract history renders saved terms safely and drops a response after session changes',async()=>{
 const event={action:'approve',snapshot:contract({title:'<b>Saved terms</b>',notes:'<script>private</script>'}),request:{reference:'Reviewed file'},actor_user_id:'owner',created_at:'2026-10-20'};
 const f=context({client:backend(()=>({data:[event]}))});await f.ctx.openContractHistory(contract());assert.equal(f.dialogs.length,1);assert.match(f.dialogs[0].innerHTML,/&#60;b&#62;Saved terms/);assert.match(f.dialogs[0].innerHTML,/&#60;script&#62;private/);assert.doesNotMatch(f.dialogs[0].innerHTML,/<script>/);
 let resolve;f.ctx.client=backend(()=>new Promise(r=>{resolve=r;}));const pending=f.ctx.openContractHistory(contract());await new Promise(r=>setImmediate(r));f.ctx.me={user_id:'other',role:'staff'};resolve({data:[event]});await pending;assert.equal(f.dialogs.length,1);
});
test('branch contracts are filtered by customer, permission gated and route to the exact contract',async()=>{
 const reads=[],f=context({view:'contacts',selected:'branch-1',window:{addEventListener(){}},document:{addEventListener(){}},all:async(table,columns,filter)=>{const calls=[],q={eq(...args){calls.push(args);return this;}};filter(q);reads.push({table,columns,calls});return [contract({title:'<private>'})];},render:()=>{}});
 vm.runInContext(read('client-profile-pages.js')+'\n'+read('work-assignments.js'),f.ctx);f.ctx.profileView=()=>{};f.run("profileTab='contracts'");await f.ctx.loadBranchActivity('branch-1','contracts');assert.equal(reads[0].table,'customer_contracts');assert.deepEqual(reads[0].calls,[['organization_id','branch-1']]);assert.match(f.ctx.branchActivity({id:'branch-1'},'contracts'),/data-branch-kind="contract"/);assert.match(f.ctx.branchActivity({id:'branch-1'},'contracts'),/&#60;private&#62;/);
 await f.ctx.workOpenRecord({record_type:'contract',record_id:'contract-1'});assert.equal(f.ctx.view,'contracts');assert.equal(f.run('contractFocus'),'contract-1');assert.equal(f.run('contractPage'),0);
 f.ctx.me={role:'staff',access:[]};await f.ctx.loadBranchActivity('branch-1','contracts');assert.equal(reads.length,1);assert.match(f.ctx.branchActivity({id:'branch-1'},'contracts'),/do not have access/);
});
