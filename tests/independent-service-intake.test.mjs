import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('service-domain.js','utf8')+'\n'+fs.readFileSync('service-workflow.js','utf8');
function fixture(){
 const fields=Object.fromEntries(['assetId','organizationId','siteOrganizationId','contactId','source','productId','model','serial','serialUnknown','location','projectName','problem'].map(name=>[name,{name,value:'',disabled:false,checked:false,required:false,innerHTML:''}]));
 const button={disabled:false},handlers={},form={dataset:{caseType:'service'},elements:{namedItem:name=>fields[name]},querySelector:()=>button,addEventListener:(type,handler)=>{handlers[type]=handler;}};
 const calls=[],messages=[],errors=[];let refreshes=0,pending;
 class FormDataFixture{constructor(){this.rows=Object.values(fields).filter(f=>!f.disabled&&(f.name!=='serialUnknown'||f.checked)).map(f=>[f.name,f.name==='serialUnknown'?'on':f.value]);}[Symbol.iterator](){return this.rows[Symbol.iterator]();}}
 const ctx=vm.createContext({me:{user_id:'engineer'},view:'service',crypto:{randomUUID:()=> 'stable-request-id'},FormData:FormDataFixture,console,
  organizations:[{id:'customer',name:'Distributor',location:'Warehouse'},{id:'site',name:'Hospital',location:'Ward'}],orgIndex:new Map([['customer',{name:'Distributor',location:'Warehouse'}],['site',{name:'Hospital',location:'Ward'}]]),
  contacts:[{id:'customer-contact',organization_id:'customer',status:'valid'},{id:'site-contact',organization_id:'site',status:'valid'}],products:[{id:'machine',name:'Analyzer'}],
  inventoryOption:(value,label,selected)=>`<option value="${value}"${selected?' selected':''}>${label}</option>`,inventoryProduct:()=>({name:'Analyzer'}),salesContactName:id=>id,
  esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),companyDate:()=> '2026-10-20',employeeName:()=> 'Engineer Name',
  message:text=>messages.push(text),run:fn=>{pending=Promise.resolve().then(fn).catch(error=>errors.push(error));},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'created'},error:null};}}});
 vm.runInContext(source,ctx);ctx.refresh=()=>{refreshes++;};vm.runInContext("serviceWorkspace=async()=>refresh();serviceSection='schedule'",ctx);ctx.bindServiceIntake(form);
 Object.assign(fields.organizationId,{value:'customer'});Object.assign(fields.source,{value:'third_party'});Object.assign(fields.productId,{value:'machine'});Object.assign(fields.model,{value:'Known model'});Object.assign(fields.serial,{value:'EXT-01'});Object.assign(fields.location,{value:'Ward'});Object.assign(fields.problem,{value:'Repair power fault'});
 const submit=()=>{handlers.submit({preventDefault(){}});return pending;};
 return {ctx,fields,button,calls,messages,errors,submit,form,get refreshes(){return refreshes;}};
}
test('unknown serial is an explicit empty value and intake retains request details',async()=>{
 const f=fixture();f.fields.serialUnknown.checked=true;f.fields.serialUnknown.onchange();assert.equal(f.fields.serial.disabled,true);assert.equal(f.fields.serial.required,false);
 await f.submit();const {name,args}=f.calls[0];assert.equal(name,'create_service_intake');assert.equal(args.p_serial_number,null);assert.equal(args.p_serial_unknown,true);assert.equal(args.p_source,'third_party');assert.equal(args.p_model,'Known model');assert.equal(args.p_problem_summary,'Repair power fault');assert.equal(f.refreshes,1);
});
test('pending machines are selectable and existing identity is preserved while site details carry forward',async()=>{
 const f=fixture();vm.runInContext(`serviceAssets=[{id:'asset',organization_id:'customer',product_id:'machine',model:'Saved model',serial_number:null,serial_unknown:true,status:'pending_installation',updated_at:'2026-10-20T10:00:00Z'}];serviceCases=[{asset_id:'asset',site_organization_id:'site',site_location:'Known ward',contact_id:'site-contact',project_name:'Hospital project',intake_source:'distributor',created_at:'2026-10-20'}]`,f.ctx);
 assert.match(f.ctx.serviceAssetOptions(),/value="asset"/);f.fields.assetId.value='asset';f.fields.assetId.onchange();
 assert.equal(f.fields.organizationId.disabled,true);assert.equal(f.fields.productId.disabled,true);assert.equal(f.fields.model.disabled,true);assert.equal(f.fields.serialUnknown.disabled,true);assert.equal(f.fields.siteOrganizationId.value,'site');assert.equal(f.fields.contactId.value,'site-contact');assert.equal(f.fields.projectName.value,'Hospital project');assert.equal(f.fields.location.value,'Known ward');
 await f.submit();assert.equal(f.calls[0].args.p_organization_id,'customer');assert.equal(f.calls[0].args.p_site_organization_id,'site');assert.equal(f.calls[0].args.p_model,'Saved model');assert.equal(f.calls[0].args.p_serial_number,null);assert.equal(f.calls[0].args.p_expected_asset_updated_at,'2026-10-20T10:00:00Z');
});
test('destination changes refresh contact choices and reject a stale customer contact',async()=>{
 const f=fixture();f.fields.siteOrganizationId.value='site';f.fields.siteOrganizationId.onchange();assert.match(f.fields.contactId.innerHTML,/site-contact/);assert.doesNotMatch(f.fields.contactId.innerHTML,/customer-contact/);assert.equal(f.fields.location.value,'Ward');f.fields.contactId.value='customer-contact';await f.submit();assert.equal(f.calls.length,0);assert.match(f.errors[0].message,/destination site/);assert.equal(f.button.disabled,false);
});
test('uncertain save retries retain the same request identifier and prevent double submission',async()=>{
 const f=fixture();let finish;f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return await new Promise(resolve=>{finish=resolve;});};
 const first=f.submit();await Promise.resolve();f.submit();assert.equal(f.calls.length,1);finish({error:{message:'Connection unavailable'}});await first;assert.equal(f.button.disabled,false);
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {error:null};};await f.submit();assert.equal(f.calls[0].args.p_id,f.calls[1].args.p_id);
});
test('actor and workspace changes suppress stale form saves and stale response messages',async()=>{
 const f=fixture();f.ctx.me={user_id:'different'};await f.submit();assert.equal(f.calls.length,0);
 const g=fixture();let finish;g.ctx.client.rpc=async()=>await new Promise(resolve=>{finish=resolve;});const pending=g.submit();await Promise.resolve();g.ctx.me={user_id:'different'};finish({error:null});await pending;assert.equal(g.refreshes,0);assert.equal(g.messages.length,0);
});
test('installation and report forms expose independent intake and preserve known site/project/serial',()=>{
 const f=fixture();const form=f.ctx.serviceIntakeForm('installation');assert.match(form,/data-case-type="installation"/);assert.match(form,/No previous sale is required/);assert.match(form,/name="serialUnknown"/);
 vm.runInContext("serviceAssets=[{id:'asset',model:'Saved model',serial_number:'REAL-01',installation_location:'Old location'}];serviceTeam=[]",f.ctx);
 const report=f.ctx.reportFields({id:'case',case_number:'INS-1',case_type:'installation',organization_id:'customer',site_organization_id:'site',site_location:'Current ward',project_name:'Known project',asset_id:'asset',assigned_user_id:'engineer'});
 assert.match(report,/Hospital/);assert.match(report,/value="Known project"/);assert.match(report,/value="Current ward"/);assert.match(report,/value="REAL-01" readonly/);assert.match(report,/value="Engineer Name"/);
});
