import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const saved=args=>({id:args.p_id,case_number:'SRV-FICTIONAL',case_type:args.p_case_type,status:'new',version:1,asset_id:args.p_asset_id||'asset',product_id:args.p_product_id,organization_id:args.p_organization_id,updated_at:'2026-10-30T12:00:00Z'});
function fixture({caseType='service'}={}){
 const document=dom();installNativeFormControls(document);const proto=Object.getPrototypeOf(document.body),matches=proto.matches;
 proto.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};proto.prepend=function(node){this.insertBefore(node,this.children[0]||null)};proto.getBoundingClientRect=()=>({left:20,top:20,bottom:64,width:200,height:44});proto.getClientRects=function(){return this.isConnected?[{}]:[]};
 Object.defineProperties(proto,{required:{configurable:true,get(){return this.getAttribute('required')!==null},set(value){if(value)this.setAttribute('required','');else this.removeAttribute('required')}},form:{get(){return this.closest('form')}},style:{get(){return this._style??={}}},classList:{get(){return {contains:name=>this.className.split(' ').includes(name),add:name=>{if(!this.className.split(' ').includes(name))this.className=(this.className+' '+name).trim()},remove:name=>{this.className=this.className.split(' ').filter(part=>part!==name).join(' ')}}}}});
 const html=Object.getOwnPropertyDescriptor(proto,'innerHTML');Object.defineProperty(proto,'innerHTML',{configurable:true,get:html.get,set(value){html.set.call(this,value);if(this.tag==='select'){const option=this.querySelector('option[selected]')||this.querySelector('option');this.value=option?.getAttribute('value')??option?.textContent??'';}}});
 Object.defineProperty(proto,'type',{configurable:true,get(){return this.getAttribute('type')||''},set(value){this.setAttribute('type',value)}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={style:{},dataset:{},clientWidth:1280,clientHeight:900};document.body.innerHTML='<div id="notice"></div><main id="content"><input id="unrelated" value="keep"><section id="serviceIntake"></section></main>';
 const calls=[],confirmations=[],actor={user_id:'engineer'},organizations=[{id:'customer',name:'Distributor',location:'Warehouse'},{id:'site',name:'Hospital',location:'Ward'}];let ids=0,running;
 const c=vm.createContext({document,window:{addEventListener(){}},busy:false,me:actor,view:'service',$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getComputedStyle:()=>({visibility:'visible'}),setTimeout:()=>1,clearTimeout(){},crypto:{randomUUID:()=>`request-${++ids}`},FormData:class{constructor(form){this.rows=form.querySelectorAll('[name]').filter(control=>!control.disabled&&!(['checkbox','radio'].includes(control.type)&&!control.checked)).map(control=>[control.name,control.type==='checkbox'?'on':control.value]);}[Symbol.iterator](){return this.rows[Symbol.iterator]();}},organizations,orgIndex:new Map(organizations.map(row=>[row.id,row])),contacts:[{id:'customer-contact',organization_id:'customer',status:'valid'},{id:'site-contact',organization_id:'site',status:'valid'}],products:[{id:'machine',name:'Analyzer'}],inventoryOption:(id,label,selected)=>`<option value="${id}"${selected?' selected':''}>${label}</option>`,inventoryProduct:()=>({name:'Analyzer'}),salesContactName:id=>id,companyDate:()=> '2026-10-30',employeeName:()=> 'Engineer'});
 for(const name of ['client-rules.js','service-domain.js','service-workflow.js','action-feedback.js'])vm.runInContext(read(name),c);
 const app=read('app.js');vm.runInContext(app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),c);const actualRun=c.run;c.run=(...args)=>running=actualRun(...args);
 const get=code=>vm.runInContext(code,c),node=selector=>document.querySelector(selector);get(`serviceSection='${caseType==='installation'?'installations':'schedule'}';serviceEpoch=10;servicePageRequest=5;serviceIntakeOpen=true;serviceLoaded=true`);node('#serviceIntake').innerHTML=c.serviceIntakeForm(caseType);const form=node('#newServiceCase'),field=name=>form.elements.namedItem(name),post=form.querySelector('[type="submit"]');
 const f={c,get,node,document,actor,form,field,post,calls,confirmations,ids:()=>ids,write:async args=>({data:saved(args)}),blur:dispatchFocusout};
 c.client={rpc:async(name,args)=>{calls.push({name,args:plain(args)});return f.write(args)}};c.serviceAfterSavedCase=async(...args)=>confirmations.push(args);c.bindServiceIntake(form);
 for(const [name,value]of Object.entries({organizationId:'customer',source:'third_party',productId:'machine',model:'Known model',serial:'EXT-01',location:'Ward',problem:'Repair power fault'}))field(name).value=value;field('organizationId').onchange();
 f.summary=()=>form.querySelector('[data-service-intake-errors]');f.error=control=>control.closest('label').querySelector('.field-error')?.textContent||'';
 f.change=control=>{control.onchange?.();for(let node=control;node;node=node.parentElement)for(const {fn}of node.events.change||[])fn({target:control,currentTarget:node});};
 f.submit=()=>{running=null;form.events.submit[0].fn({preventDefault(){},currentTarget:form,submitter:post});return running;};
 f.replace=kind=>{if(kind==='actor')c.me={...actor};else if(kind==='view')c.view='personal';else if(kind==='section')get("serviceSection='forms'");else if(kind==='epoch')get('serviceEpoch++');else if(kind==='page')get('servicePageRequest++');else form.remove();};return f;
}

test('busy refusal leaves intake editable and performs no validation or write',async()=>{
 const f=fixture();f.c.busy=true;f.field('model').value='';await f.submit();assert.equal(f.post.disabled,false);assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.calls.length,0);assert.equal(f.ids(),1);
});

test('intake has required cues and a separate top error summary',()=>{
 const f=fixture();assert.equal(f.form.noValidate,true);assert.equal(f.form.firstElementChild,f.summary());assert.equal(f.summary().getAttribute('role'),'alert');
 for(const name of ['organizationId','source','productId','model','serial','location','problem'])assert.match(f.field(name).closest('label').textContent,/required/);assert.match(f.field('serial').closest('label').textContent,/unless unknown/);
});

test('blur validates only the departed control while preserving help and deliberate focus',()=>{
 const f=fixture(),control=f.field('model');control.setAttribute('aria-describedby','model-help');control.value=' ';f.field('problem').value='';f.field('location').focus();f.blur(control);
 assert.match(f.error(control),/Complete this field/);assert.equal(f.error(f.field('problem')),'');assert.equal(f.summary().textContent,'1 field needs attention');assert.equal(f.document.activeElement,f.field('location'));assert.match(control.getAttribute('aria-describedby'),/^model-help field-error-/);
 control.value='Known model';f.blur(control);assert.equal(f.error(control),'');assert.equal(control.getAttribute('aria-describedby'),'model-help');assert.equal(f.summary().textContent,'');assert.equal(f.calls.length,0);
});

test('submit shows every native error count before focusing the DOM-first invalid field',async()=>{
 const f=fixture();f.field('organizationId').value='';f.field('model').value=' ';f.field('location').value='A';f.field('problem').value='';const focus=f.field('organizationId').focus;f.field('organizationId').focus=function(...args){assert.equal(f.summary().textContent,'4 fields need attention');return focus.apply(this,args)};
 await f.submit();assert.equal(f.summary().textContent,'4 fields need attention');assert.equal(f.document.activeElement,f.field('organizationId'));assert.deepEqual(plain(f.field('organizationId').scrolledIntoView),{block:'center',behavior:'instant'});assert.equal(f.calls.length,0);assert.equal(f.post.disabled,false);assert.equal(f.ids(),1);
});

test('native custom and length constraints stay attached to their controls',async()=>{
 const f=fixture();f.field('model').setCustomValidity('Model needs review');f.field('location').value='A';f.field('projectName').value='x'.repeat(201);f.field('problem').value='x'.repeat(4001);await f.submit();
 assert.equal(f.summary().textContent,'4 fields need attention');assert.match(f.error(f.field('model')),/Model needs review/);assert.match(f.error(f.field('location')),/at least 2/);assert.match(f.error(f.field('projectName')),/200/);assert.match(f.error(f.field('problem')),/4000/);assert.equal(f.calls.length,0);
});

test('contact validation uses the existing destination rule and native errors take priority',async()=>{
 const f=fixture();f.field('siteOrganizationId').value='site';f.change(f.field('siteOrganizationId'));f.field('contactId').value='customer-contact';f.blur(f.field('contactId'));assert.match(f.error(f.field('contactId')),/destination site/);await f.submit();assert.equal(f.document.activeElement,f.field('contactId'));assert.equal(f.calls.length,0);
 f.field('contactId').setCustomValidity('Choose a valid contact');f.blur(f.field('contactId'));assert.match(f.error(f.field('contactId')),/Choose a valid contact/);f.field('contactId').setCustomValidity('');f.field('contactId').value='site-contact';f.blur(f.field('contactId'));assert.equal(f.summary().textContent,'');await f.submit();assert.equal(f.calls[0].args.p_site_organization_id,'site');assert.equal(f.calls[0].args.p_contact_id,'site-contact');
});

test('unknown serial clears its shown error and preserves the explicit null serial payload',async()=>{
 const f=fixture();f.field('serial').value='';f.blur(f.field('serial'));assert.match(f.error(f.field('serial')),/Complete/);f.field('serialUnknown').checked=true;f.change(f.field('serialUnknown'));
 assert.equal(f.field('serial').disabled,true);assert.equal(f.field('serial').required,false);assert.equal(f.error(f.field('serial')),'');assert.equal(f.summary().textContent,'');await f.submit();assert.equal(f.calls[0].args.p_serial_number,null);assert.equal(f.calls[0].args.p_serial_unknown,true);
});

test('existing machine identity stays disabled and the original version/site payload is retained',async()=>{
 const f=fixture();f.field('model').value='';f.blur(f.field('model'));f.get(`serviceAssets=[{id:'asset',organization_id:'customer',product_id:'machine',model:'Saved model',serial_number:null,serial_unknown:true,status:'pending_installation',updated_at:'2026-10-20T10:00:00Z'}];serviceCases=[{asset_id:'asset',site_organization_id:'site',site_location:'Known ward',contact_id:'site-contact',project_name:'Hospital project',intake_source:'distributor',created_at:'2026-10-20'}]`);f.field('assetId').value='asset';f.change(f.field('assetId'));
 assert.equal(f.error(f.field('model')),'');assert.equal(f.summary().textContent,'');for(const name of ['organizationId','productId','model','serial','serialUnknown'])assert.equal(f.field(name).disabled,true);await f.submit();assert.deepEqual(f.calls[0].args,{p_id:'request-1',p_case_type:'service',p_asset_id:'asset',p_expected_asset_updated_at:'2026-10-20T10:00:00Z',p_organization_id:'customer',p_site_organization_id:'site',p_contact_id:'site-contact',p_product_id:'machine',p_model:'Saved model',p_serial_number:null,p_serial_unknown:true,p_location:'Known ward',p_project_name:'Hospital project',p_problem_summary:'Repair power fault',p_source:'distributor'});
});

for(const caseType of ['service','installation'])test(`${caseType} posting retains the exact request, pending lock, label and confirmation contract`,async()=>{
 const f=fixture({caseType}),wait=deferred();f.write=()=>wait.promise;f.field('model').value='  Known model  ';f.field('serial').value=' EXT-01 ';const label=f.post.textContent,saving=f.submit();
 assert.equal(f.post.disabled,true);assert.equal(f.post.textContent,label);assert.equal(f.post.getAttribute('aria-busy'),'true');await f.submit();assert.equal(f.calls.length,1);assert.equal(f.confirmations.length,0);
 assert.deepEqual(f.calls[0],{name:'create_service_intake',args:{p_id:'request-1',p_case_type:caseType,p_asset_id:null,p_expected_asset_updated_at:null,p_organization_id:'customer',p_site_organization_id:null,p_contact_id:null,p_product_id:'machine',p_model:'Known model',p_serial_number:'EXT-01',p_serial_unknown:false,p_location:'Ward',p_project_name:'',p_problem_summary:'Repair power fault',p_source:'third_party'}});
 wait.resolve({data:saved(f.calls[0].args)});await saving;assert.equal(f.confirmations.length,1);assert.equal(f.confirmations[0][1],false);assert.equal(f.confirmations[0][2](),true);assert.equal(f.post.disabled,false);assert.equal(f.post.getAttribute('aria-busy'),null);assert.equal(f.ids(),1);
});

test('failed and unconfirmed saves retain the stable request ID and existing editable retry behavior',async()=>{
 const f=fixture();for(const response of [{error:{message:'Connection unavailable'}},{data:null}]){f.write=async()=>response;await f.submit();assert.equal(f.confirmations.length,0);assert.equal(f.post.disabled,false);assert.match(f.summary().textContent,/Connection unavailable|could not be confirmed/);}
 f.write=async args=>({data:saved(args)});await f.submit();assert.equal(f.confirmations.length,1);assert.deepEqual(f.calls.map(call=>call.args.p_id),['request-1','request-1','request-1']);assert.equal(f.ids(),1);
});

for(const change of ['actor','view','section','epoch','page','detach'])test(`${change} replacement suppresses stale validation, posting and late confirmation`,async()=>{
 const f=fixture();f.replace(change);f.field('model').value='';f.blur(f.field('model'));await f.submit();assert.equal(f.summary().textContent,'');assert.equal(f.calls.length,0);
 const g=fixture(),wait=deferred();g.write=()=>wait.promise;const saving=g.submit();g.replace(change);wait.resolve({data:saved(g.calls[0].args)});await saving;assert.equal(g.confirmations.length,0);assert.equal(g.summary().textContent,'');
});
