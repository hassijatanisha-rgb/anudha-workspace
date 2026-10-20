import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function context(extra={}){
 const listeners={},content={innerHTML:'Existing editor'},messages=[];
 const ctx=vm.createContext({Intl,Date,console,crypto:{randomUUID:()=> 'request-id'},
  me:{user_id:'staff'},view:'sales',inventoryLoaded:true,organizations:[],contacts:[],products:[],orgIndex:new Map(),
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  document:{querySelector:()=>null,querySelectorAll:()=>[]},window:{addEventListener:(name,fn)=>{listeners[name]=fn}},
  $:()=>null,message:text=>messages.push(text),confirm:()=>false,syncWorkspaceNavigation:()=>{},
  ...extra});
 for(const file of ['row-index.js','business-date.js','company-forms.js','sales-domain.js','proforma-commercial.js','sales-delivery.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 return {ctx,listeners,content,messages,run:code=>vm.runInContext(code,ctx)};
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
 const input={name:'notes',value:'original',checked:false},form={dataset:{},querySelectorAll:()=>[input]},content={innerHTML:'Editor'};
 const f=context({document:{querySelector:()=>form},$:()=>content});
 form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Unsaved notes';
 assert.equal(f.ctx.salesConfirmLeave(),false);
 await f.ctx.salesDeliveryWorkspace(true);assert.equal(content.innerHTML,'Editor');assert.equal(input.value,'Unsaved notes');
 let prevented=false;const event={preventDefault(){prevented=true}};f.listeners.beforeunload(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
 let closed=false;f.ctx.salesNavigate(()=>{closed=true});assert.equal(closed,false);
 f.ctx.confirm=()=>true;f.ctx.salesNavigate(()=>{closed=true});assert.equal(closed,true);
});
function editorFixture(){
 const controls=[{name:'organizationId',value:'branch',disabled:false},{name:'contactId',value:'contact',disabled:false},{name:'notes',value:'Unsaved notes',disabled:false},{name:'disabled',value:'locked',disabled:true},{name:'commercialKind',value:'placement',disabled:false},{name:'contractId',value:'contract-1',disabled:false},{name:'installationRequired',value:'yes',disabled:false},{name:'installationChargeNotes',value:'Agreed service terms',disabled:false},{name:'internalNotes',value:'Internal planning notes',disabled:false},{type:'submit',textContent:'Save',disabled:false}];
 const form={dataset:{id:'p',version:'3'},isConnected:true,querySelectorAll:()=>controls,querySelector:()=>controls.at(-1)};
 let release,payload;const pending=new Promise(resolve=>{release=resolve});
 const f=context({document:{querySelector:()=>form},FormData:class{constructor(form){this.values=new Map(form.querySelectorAll().filter(control=>!control.disabled&&control.name).map(control=>[control.name,control.value]))}get(name){return this.values.get(name)||''}},
  client:{rpc:async(name,args)=>{payload=args;return pending}}});
 f.run('readProformaLines=()=>[]');form.dataset.initialState=f.ctx.salesEditorState(form);
 controls[2].value='Changed before save';
 return {...f,controls,form,release,get payload(){return payload}};
}
test('pending save locks every input, preserves submitted data and blocks leaving until failure',async()=>{
 const f=editorFixture(),save=f.ctx.saveProformaForm(f.form);
 assert.ok(f.controls.every(control=>control.disabled));assert.equal(f.payload.p_notes,'Changed before save');assert.equal(f.payload.p_commercial_kind,'placement');assert.equal(f.payload.p_contract_id,'contract-1');assert.equal(f.payload.p_installation_required,true);assert.equal(f.payload.p_installation_charge_notes,'Agreed service terms');assert.equal(f.payload.p_internal_notes,'Internal planning notes');
 assert.equal(f.ctx.salesConfirmLeave(),false);assert.equal(f.form.dataset.version,'3');
 f.release({error:{message:'Version changed'}});await assert.rejects(save,error=>error.message==='Version changed');
 assert.equal(f.controls[2].disabled,false);assert.equal(f.controls[3].disabled,true);assert.equal(f.controls[2].value,'Changed before save');
 assert.equal(f.form.dataset.version,'3');assert.equal(f.form.dataset.saving,'false');
});
test('late successful save after session reset cannot refocus or reload another session',async()=>{
 const f=editorFixture();let reloads=0;f.ctx.salesDeliveryWorkspace=async()=>{reloads++};
 const save=f.ctx.saveProformaForm(f.form);f.ctx.clearSalesDelivery();f.release({data:{id:'p',version:4}});await save;
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
