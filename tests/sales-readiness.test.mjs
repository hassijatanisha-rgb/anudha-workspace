import {deliveryApprovalFixture} from './helpers/delivery-approval-fixture.mjs';
import {draftFixture,receipt} from './helpers/proforma-draft-fixture.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
import {installLeaveContext} from './helpers/leave-context.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function context(extra={}){
 const listeners={},content={innerHTML:'Existing editor'},messages=[];
 const ctx=vm.createContext({statusTone,Intl,Date,console,crypto:{randomUUID:()=> 'request-id'},
  me:{user_id:'staff'},view:'sales',inventoryLoaded:true,organizations:[],contacts:[],products:[],orgIndex:new Map(),
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  document:{querySelector:()=>null,querySelectorAll:()=>[]},window:{addEventListener:(name,fn)=>{listeners[name]=fn}},
  $:()=>null,message:text=>messages.push(text),actionFeedbackReference:node=>({node}),actionFeedbackShow:(_reference,text,_kind,target)=>{target.textContent=text;},confirm:()=>false,syncWorkspaceNavigation:()=>{},run:fn=>fn(),
  ...extra});
 installPageHeader(ctx);
 for(const file of ['client-rules.js','row-index.js','business-date.js','company-forms.js','sales-domain.js','proforma-commercial.js','sales-delivery.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 installLeaveContext(ctx);return {ctx,listeners,content,messages,run:code=>vm.runInContext(code,ctx)};
}
function backend(tables){
 const reads=[];
 return {reads,from(table){
  let bounds=[0,999],filters=[],single=false;
  const query={select(){return this},order(){return this},range(a,b){bounds=[a,b];return this},
   in(key,values){filters.push(row=>values.includes(row[key]));return this},
   eq(key,value){filters.push(row=>row[key]===value);return this},single(){single=true;return this},
   then(ok,bad){reads.push({table,bounds});const rows=(tables[table]||[]).filter(row=>filters.every(filter=>filter(row))).slice(bounds[0],bounds[1]+1);return Promise.resolve({data:single?rows[0]:rows}).then(ok,bad)}};
  return query;
 }};
}
test('Pro forma and delivery status tones follow their real workflow meaning',()=>{
 const f=context();
 for(const [register_tag,status,tone] of [['draft','draft','neutral'],['waiting','accepted','warning'],['sent','sent','warning'],['delivery','accepted','info'],['partial','accepted','info'],['done','accepted','success'],['closed','rejected','danger'],['closed','cancelled','neutral']]){
  assert.match(f.ctx.proformaTagHtml({register_summary:true,register_tag,status}),new RegExp('chip--'+tone+'"'));
 }
 for(const [status,tone] of Object.entries({draft:'neutral',accounts_approved:'warning',tax_invoice_created:'info',sent_to_sales:'info',packing:'info',ready:'info',out_for_delivery:'info',delivered:'success',cancelled:'neutral',rejected:'danger'}))assert.equal(f.ctx.salesDeliveryTone(status),tone,status);
});
test('historical search and fulfillment include parents and relations after the first 1,000 rows',async()=>{
 const proformas=Array.from({length:1002},(_,i)=>({id:'p'+i,document_number:i===1001?'PF-HISTORICAL':'PF-'+i,status:'accepted',revision:1,currency:'TZS',total_minor:100}));
 const notes=proformas.map((row,i)=>({id:'d'+i,proforma_id:row.id,status:'delivered'}));
 const lines=proformas.map((row,i)=>({id:'l'+i,proforma_id:row.id,quantity:10,sort_order:1}));
 const deliveries=proformas.map((row,i)=>({id:'dl'+i,delivery_note_id:'d'+i,proforma_line_id:'l'+i,quantity:4}));
 const client=backend({sales_proformas:proformas,sales_delivery_notes:notes,sales_proforma_lines:lines,sales_delivery_lines:deliveries});
 const f=context({client});await f.ctx.loadSalesDelivery();
 assert.equal(f.run('salesProformas.length'),1002);assert.equal(f.run('salesDeliveryNotes.length'),1002);
 assert.equal(f.run("proformaTag(salesProforma('p1001'))"),'partial');
 f.run("salesProformaSearch='PF-HISTORICAL'");assert.match(f.ctx.proformaListScreen(),/PF-HISTORICAL/);
 for(const table of ['sales_proformas','sales_delivery_notes'])assert.ok(client.reads.some(read=>read.table===table&&read.bounds[0]===1000));
});
test('all lines must be delivered; reserved and cancelled quantities do not finish an order',()=>{
 const f=context();f.run("salesProformas=[{id:'p',status:'accepted'}];salesProformaLines=[{id:'l',proforma_id:'p',quantity:10},{id:'other',proforma_id:'p',quantity:2}];salesDeliveryNotes=[{id:'done',proforma_id:'p',status:'delivered'},{id:'open',proforma_id:'p',status:'ready'},{id:'cancelled',proforma_id:'p',status:'cancelled'}];salesDeliveryLines=[{delivery_note_id:'done',proforma_line_id:'l',quantity:4},{delivery_note_id:'open',proforma_line_id:'l',quantity:6},{delivery_note_id:'cancelled',proforma_line_id:'other',quantity:2}]");
 assert.equal(f.run('proformaTag(salesProformas[0])'),'partial');
 f.run("salesDeliveryNotes[1].status='delivered'");assert.equal(f.run('proformaTag(salesProformas[0])'),'partial');
 f.run("salesDeliveryLines.push({delivery_note_id:'done',proforma_line_id:'other',quantity:2})");assert.equal(f.run('proformaTag(salesProformas[0])'),'done');
});
test('clearing the session invalidates an outstanding sales load even for the same actor',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve});
 const client={from(){return {select(){return this},order(){return this},range(){return pending}}}};
 const f=context({client}),load=f.ctx.loadSalesDelivery();
 f.ctx.clearSalesDelivery();release({data:[{id:'old-session'}]});await load;
 assert.equal(f.run('salesLoaded'),false);assert.equal(f.run('salesProformas.length'),0);
});
test('dirty editor guards refresh, close/navigation and browser unload without discarding fields',async()=>{
 const input={name:'notes',value:'original',checked:false},form={isConnected:true,dataset:{},querySelectorAll:()=>[input]},content={innerHTML:'Editor'};
 const f=context({document:{querySelector:()=>form},$:()=>content});
 form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Unsaved notes';
 assert.equal(await f.ctx.salesConfirmLeave(),false);
 await f.ctx.salesDeliveryWorkspace(true);assert.equal(content.innerHTML,'Editor');assert.equal(input.value,'Unsaved notes');
 let prevented=false;const event={preventDefault(){prevented=true}};f.listeners.beforeunload(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
 let closed=false;await f.ctx.salesNavigate(()=>{closed=true});assert.equal(closed,false);
 f.ctx.askConfirm=async()=>true;await f.ctx.salesNavigate(()=>{closed=true});assert.equal(closed,true);
});

test('sales navigation gives the shared action handler the whole pending read and leaves state alone on refusal',async()=>{
 let resolve,called=0,allow=false;const read=new Promise(r=>resolve=r),f=context({run:fn=>allow?fn():undefined});
 const action=()=>{called++;return read;};f.ctx.salesNavigate(action);assert.equal(called,0);
 allow=true;f.ctx.askConfirm=async()=>true;const pending=f.ctx.salesNavigate(action);await new Promise(setImmediate);assert.equal(called,1);let done=false;pending.then(()=>{done=true;});assert.equal(done,false);resolve();await pending;assert.equal(done,true);
});
function editorFixture(){
 const f=draftFixture(),form=f.form(),draftState=f.state();form.dataset.id='p';form.dataset.version='3';f.state().revision=2;
 f.get("salesEditing='p';salesProformas=[{id:'p',version:3,revision:2},{id:'other',version:1}];salesProformaPageKey='cached';salesDeliveryPageKey='cached';");
 for(const [name,value]of Object.entries({commercialKind:'placement',contractId:'contract-1',installationRequired:'yes',installationChargeNotes:'Agreed service terms',internalNotes:'Internal planning notes',unitPrice:'0.00'}))f.field(name).value=value;
 const locked=f.document.createElement('input');locked.setAttribute('name','disabled');locked.disabled=true;form.append(locked);
 const controls=[f.field('organizationId'),f.field('contactId'),f.field('notes'),locked,f.field('commercialKind'),f.field('contractId'),f.field('installationRequired'),f.field('installationChargeNotes'),f.field('internalNotes'),form.querySelector('[type="submit"]')];
 form.dataset.initialState=f.ctx.salesEditorState(form);f.field('notes').value='Changed before save';
 let release,payload;const pending=new Promise(resolve=>release=resolve);f.write=(_name,args)=>{payload=args;return pending;};f.ctx.askConfirm=async()=>false;f.ctx.confirmWorkspaceLeave=current=>f.ctx.salesConfirmLeave(current);
 return {...f,form,controls,run:f.get,release,detach:()=>form.remove(),saved:(patch={},args=payload)=>({...receipt(args,{revision:draftState.revision+1}),...patch}),get payload(){return payload;}};
}
function savedEditorFixture(kind='proforma'){
 if(kind==='proforma'){const f=editorFixture();let reloads=0;f.ctx.salesDeliveryWorkspace=async()=>{reloads++};f.ctx.document.activeElement=f.controls.at(-1);return {...f,get payload(){return f.payload;},get children(){return f.form.querySelectorAll('[data-sales-saved]');},reloads:()=>reloads,feedback:()=>f.form.querySelector('[data-sales-saved]')};}
 const f=deliveryApprovalFixture(),form=f.form(),controls=[...form.querySelectorAll('input,select,textarea,button')];let reloads=0,release;
 f.ctx.crypto.randomUUID=()=> 'request-id';f.write=()=>new Promise(resolve=>release=resolve);f.ctx.document.activeElement=form.querySelector('[type="submit"]');f.ctx.salesDeliveryWorkspace=async()=>{reloads++};
 return {...f,form,controls,run:f.get,get children(){return form.querySelectorAll('[data-sales-saved]');},release:result=>release(result),detach:()=>form.remove(),reloads:()=>reloads,feedback:()=>form.querySelector('[data-sales-saved]')};
}
test('confirmed Pro forma save retains the editor and controls; opening the saved document is explicit',async()=>{
 const f=savedEditorFixture(),before=f.form,other=f.run('salesProformas[1]'),saving=f.ctx.saveProformaForm(f.form);
 f.release({data:f.saved({document_number:'PF-1'})});await saving;
 assert.equal(f.form,before);assert.equal(f.reloads(),0);assert.equal(f.form.dataset.version,'4');assert.equal(f.run('salesEditing'),'p');assert.equal(f.run('salesLoaded'),false);assert.equal(f.run('salesProformas[1]'),other);assert.equal(f.run('salesProformaPageKey'),'');assert.equal(f.ctx.salesEditorChanged(f.form),false);
 assert.equal(f.controls[2].value,'Changed before save');assert.equal(f.controls[2].disabled,false);assert.equal(f.controls[3].disabled,true);
 const feedback=f.feedback();assert.equal(feedback.children[0].textContent,'Pro forma saved.');assert.equal(feedback.children[0].getAttribute('role'),'status');assert.equal(f.ctx.document.activeElement,feedback.children[1]);
 await feedback.children[1].onclick();assert.equal(f.reloads(),1);assert.equal(f.run('salesFocusedProforma'),'p');assert.equal(f.run('salesEditing'),'');
});
test('the next Pro forma save uses the confirmed version and preserves unsaved field edits',async()=>{
 const f=savedEditorFixture();let args;f.ctx.client.rpc=async(name,payload)=>{args=payload;return {data:f.saved({document_number:'PF-1'},payload)}};
 await f.ctx.saveProformaForm(f.form);f.controls[2].value='Next revision';await f.feedback().children[1].onclick();assert.equal(f.reloads(),0);assert.equal(f.ctx.salesEditorChanged(f.form),true);
 await f.ctx.saveProformaForm(f.form);assert.equal(args.p_expected_version,4);assert.equal(args.p_notes,'Next revision');assert.equal(f.form.dataset.version,'5');assert.equal(f.children.length,1);assert.equal(f.reloads(),0);
});
test('saved editor navigation ignores detached, changed-user and replaced workspace callbacks',async()=>{
 for(const change of [f=>{f.detach()},f=>{f.ctx.me={user_id:'staff'}},f=>{f.run('salesWorkspaceRequest++')}]){
  const f=savedEditorFixture(),saving=f.ctx.saveProformaForm(f.form);f.release({data:f.saved()});await saving;change(f);await f.feedback().children[1].onclick();assert.equal(f.reloads(),0);
 }
});
test('a confirmed save after leaving Sales invalidates its own stale cache without changing the new screen',async()=>{
 for(const kind of ['proforma','delivery']){
  const f=savedEditorFixture(kind),saving=kind==='proforma'?f.ctx.saveProformaForm(f.form):f.ctx.createDeliveryForm(f.form);
  f.ctx.view='personal';f.detach();f.release({data:{id:kind==='proforma'?'p':'request-id',version:kind==='proforma'?4:1}});await saving;
  assert.equal(f.run('salesLoaded'),false);assert.equal(f.run('salesProformaPageKey'),'');assert.equal(f.reloads(),0);assert.equal(f.children.length,0);assert.equal(f.run('salesProformas[0].version'),3);
 }
});
test('delivery approval keeps its confirmed form in place and prevents a duplicate approval',async()=>{
 const f=savedEditorFixture('delivery'),calls=[];
 f.ctx.client.rpc=async(name,args)=>{calls.push({name,args});return {data:{id:'request-id',version:1}}};
 await f.ctx.createDeliveryForm(f.form);assert.equal(f.reloads(),0);assert.equal(calls.length,1);assert.equal(f.form.dataset.savedDelivery,'request-id');assert.ok(f.controls.every(control=>control.disabled));assert.equal(f.form.dataset.saving,'false');assert.equal(f.feedback().children[1].textContent,'Open delivery');
 await f.ctx.createDeliveryForm(f.form);assert.equal(calls.length,1);await f.feedback().children[1].onclick();assert.equal(f.reloads(),1);assert.equal(f.run('salesFocusedDelivery'),'request-id');assert.equal(f.run('salesSection'),'delivery');
});
test('a failed or unknown lobby mark preserves the completed approval and offers its saved delivery',async()=>{
 for(const thrown of [false,true]){
  const f=savedEditorFixture('delivery'),calls=[];f.select('lobby');
  f.ctx.client.rpc=async(name,args)=>{calls.push({name,args});if(name==='create_sales_delivery_note')return {data:{id:'request-id',version:1}};if(thrown)throw Error('Connection lost');return {error:{message:'Version changed'}}};
  await f.ctx.createDeliveryForm(f.form);assert.equal(f.form.dataset.savedDelivery,'request-id');assert.equal(f.reloads(),0);assert.equal(calls.length,2);assert.equal(f.feedback().children[0].getAttribute('role'),'alert');assert.match(f.feedback().children[0].textContent,/Delivery created.*waiting.*could not be confirmed/);
  await f.ctx.createDeliveryForm(f.form);assert.equal(calls.length,2);
 }
});
test('pending save locks every input, preserves submitted data and blocks leaving until failure',async()=>{
 const f=editorFixture(),save=f.ctx.saveProformaForm(f.form);
 assert.ok(f.controls.every(control=>control.disabled));assert.equal(f.payload.p_notes,'Changed before save');assert.equal(f.payload.p_commercial_kind,'placement');assert.equal(f.payload.p_contract_id,'contract-1');assert.equal(f.payload.p_installation_required,true);assert.equal(f.payload.p_installation_charge_notes,'Agreed service terms');assert.equal(f.payload.p_internal_notes,'Internal planning notes');
 assert.equal(await f.ctx.salesConfirmLeave(),false);assert.equal(f.form.dataset.version,'3');
 f.release({error:{message:'Version changed',code:'P0001'}});await assert.rejects(save,error=>error.message==='Version changed');
 assert.equal(f.controls[2].disabled,false);assert.equal(f.controls[3].disabled,true);assert.equal(f.controls[2].value,'Changed before save');
 assert.equal(f.form.dataset.version,'3');assert.equal(f.form.dataset.saving,'false');
});
test('late successful save after session reset cannot refocus or reload another session',async()=>{
 const f=editorFixture();let reloads=0;f.ctx.salesDeliveryWorkspace=async()=>{reloads++};
 const save=f.ctx.saveProformaForm(f.form);f.ctx.clearSalesDelivery();f.release({data:f.saved()});await save;
 assert.equal(reloads,0);assert.equal(f.run('salesFocusedProforma'),'');assert.equal(f.form.dataset.version,'3');
});
test('sent print uses saved names, terms and lines after current master data changes',async()=>{
 const snapshot={organizationName:'Original client',organizationLocation:'Original branch',contactName:'Original contact',currency:'TZS',validUntil:'2026-12-01',deliveryPeriod:'Original delivery',paymentTerms:'Original terms',notes:'Original notes',commercialKind:'placement',contractId:'saved-contract',installationRequired:false,installationChargeNotes:'Original service terms',subtotalMinor:10000,discountMinor:0,taxMinor:0,totalMinor:10000,lines:[{productId:'product',productName:'Original product <safe>',description:'Saved item',quantity:1,uom:'unit',unitPriceMinor:10000,discountBasisPoints:0,taxBasisPoints:0}]};
 const record={id:'p',revision:2,organization_id:'branch',contact_id:'contact',status:'sent',document_number:'PF-1',commercial_kind:'sale',contract_id:'changed-contract',installation_required:true,installation_charge_notes:'Changed service terms',internal_notes:'Internal current remarks'};
 const f=context({client:backend({sales_proforma_revisions:[{proforma_id:'p',revision:2,snapshot}]}),orgIndex:new Map([['branch',{name:'Changed client'}]]),contacts:[{id:'contact',first_name:'Changed contact'}],products:[{id:'product',name:'Changed product'}]});
 await f.ctx.loadSalesRevision(record);const html=f.ctx.proformaCard(record);
 for(const text of ['Original client','Original contact','Original product &lt;safe&gt;','Original terms','Saved item','Original service terms','Installation not requested','saved-contract'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/Changed client|Changed contact|Changed product|Changed service terms|changed-contract|<safe>/);
 delete snapshot.organizationName;delete snapshot.contactName;delete snapshot.lines[0].productName;
 const legacy=f.ctx.proformaCard(record);assert.match(legacy,/Historical client name not recorded/);assert.match(legacy,/Historical contact name not recorded/);assert.match(legacy,/Historical product name not recorded/);assert.doesNotMatch(legacy,/Changed client|Changed contact|Changed product/);
});
test('identity capture extends only new revisions and retains history mutation protection',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/202610160094_proforma_integrity.sql',import.meta.url),'utf8');
 assert.match(migration,/before insert on public\.sales_proforma_revisions/i);assert.match(migration,/security invoker/i);
 assert.match(migration,/revoke all.*from public,anon,authenticated/i);assert.doesNotMatch(migration,/update public\.sales_proforma_revisions|disable trigger|drop trigger/i);
 for(const name of ['organizationName','organizationLocation','contactName','productName'])assert.ok(migration.includes(name));
});
