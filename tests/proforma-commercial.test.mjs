import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';');
function context(extra={}){
 const ctx=vm.createContext({me:{user_id:'sales'},view:'sales',esc,companyDate:()=> '2026-10-20',organizations:[],orgIndex:new Map(),contacts:[],products:[],window:{addEventListener(){}},document:{querySelector:()=>null,querySelectorAll:()=>[]},$:()=>null,...extra});
 for(const file of ['customer-contracts.js','proforma-commercial.js','sales-delivery.js'])vm.runInContext(read(file),ctx);
 return {ctx,run:source=>vm.runInContext(source,ctx)};
}
function clientFor(answer){const calls=[];return {calls,from(table){const query={table,args:[]};calls.push(query);const builder=new Proxy({},{get(_,method){if(method==='then')return (ok,bad)=>Promise.resolve(answer(query)).then(ok,bad);return (...args)=>{query.args.push([method,...args]);return builder;};}});return builder;}};}
test('placement contract loader reads all pages with matching category and excludes cancelled rows',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({id:'c'+i,organization_id:'branch',kind:'placement'})),client=clientFor(query=>{const range=query.args.find(([key])=>key==='range');return {data:rows.slice(range[1],range[2]+1)};}),f=context({client});
 await f.ctx.loadProformaContracts();assert.equal(f.run('salesPlacementContracts.length'),1001);assert.equal(client.calls.length,2);
 for(const query of client.calls){assert.ok(query.args.some(args=>JSON.stringify(args)===JSON.stringify(['eq','kind','placement'])));assert.ok(query.args.some(args=>JSON.stringify(args)===JSON.stringify(['neq','status','cancelled'])));}
});
test('contract loading drops stale-session data and propagates failures instead of showing an empty ready list',async()=>{
 let resolve;const f=context({client:clientFor(()=>new Promise(r=>{resolve=r;}))});const pending=f.ctx.loadProformaContracts();await new Promise(r=>setImmediate(r));f.ctx.clearSalesDelivery();resolve({data:[{id:'stale'}]});await pending;assert.equal(f.run('salesPlacementContracts.length'),0);
 f.ctx.client=clientFor(()=>({error:Error('Contracts unavailable')}));await assert.rejects(f.ctx.loadProformaContracts(),/Contracts unavailable/);
});
test('contract choices include only the selected customer branch and escape names',()=>{
 const f=context();f.run(`salesPlacementContracts=[{id:'a',organization_id:'branch',contract_number:'CT-1',title:'<signed>',status:'approved',starts_on:'2027-01-01'},{id:'b',organization_id:'other',contract_number:'CT-2',title:'Other branch',status:'draft'}]`);
 const html=f.ctx.proformaContractOptions('branch','a');assert.match(html,/value="a" selected/);assert.match(html,/&#60;signed&#62;/);assert.match(html,/outside effective dates/);assert.doesNotMatch(html,/Other branch|CT-2|<signed>/);
});
test('changing customer rebuilds placement options without retaining the other branch contract',()=>{
 const select={value:'old',innerHTML:''},organization={value:'new-branch'},form={querySelector:selector=>selector==='[name="contractId"]'?select:organization},f=context({$:()=>form});
 f.run(`salesPlacementContracts=[{id:'old',organization_id:'old-branch',contract_number:'OLD',title:'Old',status:'draft'},{id:'new',organization_id:'new-branch',contract_number:'NEW',title:'New',status:'draft'}]`);f.ctx.proformaUpdateContractChoices();
 assert.match(select.innerHTML,/value="new"/);assert.doesNotMatch(select.innerHTML,/value="old"/);assert.match(select.innerHTML,/Choose this branch/);
});
test('commercial category toggles required contract selection and retains dirty-form tracking',()=>{
 const handlers={},kind={name:'commercialKind',value:'sale',addEventListener:(event,fn)=>{handlers[event]=fn;}},select={name:'contractId',value:'',required:false},placement={hidden:true},help={hidden:true},nodes={'[name="commercialKind"]':kind,'[name="contractId"]':select,'[data-placement-contract]':placement,'[data-placement-help]':help},form={dataset:{},querySelector:selector=>nodes[selector],querySelectorAll:()=>[kind,select]},f=context({$:()=>form});
 f.ctx.proformaBindCommercial();assert.equal(f.ctx.salesEditorChanged(form),false);kind.value='placement';handlers.change();assert.equal(select.required,true);assert.equal(placement.hidden,false);assert.equal(help.hidden,false);assert.equal(f.ctx.salesEditorChanged(form),true);kind.value='sale';handlers.change();assert.equal(select.required,false);assert.equal(placement.hidden,true);
});
test('commercial summary isolates escaped internal remarks from customer-facing service terms',()=>{
 const f=context(),html=f.ctx.proformaCommercialSummary({commercial_kind:'placement',contract_id:'<contract>',installation_required:false,installation_charge_notes:'Agreed <service> terms',internal_notes:'Private <script>alert(1)</script>'});
 assert.match(html,/Installation not requested/);assert.match(html,/Agreed &#60;service&#62; terms/);assert.match(html,/<aside class="no-print">[\s\S]*Private &#60;script&#62;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-proforma-contract="&#60;contract&#62;"/);
 const styles=read('company-forms.css');assert.match(styles,/@media print\{[\s\S]*\.no-print\{display:none!important\}/);
});
test('an older editor contract load cannot replace the choices from a newer workspace request',async()=>{
 const pending=[],f=context({client:clientFor(()=>new Promise(resolve=>pending.push(resolve)))});
 f.run('salesWorkspaceRequest=1');const older=f.ctx.loadProformaContracts();await new Promise(r=>setImmediate(r));
 f.run('salesWorkspaceRequest=2');const newer=f.ctx.loadProformaContracts();await new Promise(r=>setImmediate(r));
 pending[1]({data:[{id:'new-approved-contract'}]});await newer;pending[0]({data:[{id:'old-contract'}]});await older;
 assert.equal(f.run('salesPlacementContracts[0].id'),'new-approved-contract');
});
