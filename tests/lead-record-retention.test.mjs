import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const row=(id='one',version=3)=>({id,version,lead_number:'LD-'+id,stage:'lead',source:'phone',organization_id:'clinic',contact_id:null,caller_name:'Asha',caller_phone:'0712345678',caller_organization:'',caller_role:'doctor',subject:'Analyzer quote',details:'Need a quote',estimated_value_minor:null,currency:'TZS',owner_user_id:'actor',next_action:'Call back',next_action_on:'2099-01-01',lost_reason:'',proforma_id:null,created_by:'actor',created_at:'2026-10-01T12:00:00.123456Z',updated_at:'2026-10-01T12:00:00.123456Z'});
function fixture({editing='',selected='one'}={}){
 const document=dom();document.body.innerHTML='<main id="content"></main>';const content=document.querySelector('#content');
 const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');let writes=0;
 Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:value=>{writes++;descriptor.set.call(content,value);}});
 const calls=[],reads=[],forms=[],messages=[],scrolls=[],decorations=[],actor={user_id:'actor',role:'staff'};
 const c=vm.createContext({statusTone,document,me:actor,sessionLoadEpoch:1,view:'leads',CSS:{escape:String},crypto:{randomUUID:()=> 'new-id'},companyDate:()=> '2026-10-29',setTimeout,clearTimeout,
  window:{scrollX:9,scrollY:240,scrollTo:(...args)=>scrolls.push(args)},$:selector=>document.querySelector(selector),run:fn=>fn(),message:(...args)=>messages.push(args),
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  employeeName:id=>id==='other'?'Baraka':'Asha',employeeDirectory:new Map([['actor',{user_id:'actor'}],['other',{user_id:'other'}]]),orgIndex:new Map([['clinic',{name:'Fixture Clinic',location:'Dar'}]]),contacts:[],salesProformas:[{id:'pf',document_number:'PF-1',organization_id:'clinic',status:'accepted'}],salesLoaded:true,
  hasArea:()=>true,salesStatus:value=>value,salesOrganizationOptions:()=>'<option value="clinic">Fixture Clinic</option>',salesContactOptions:()=>'',inventoryOption:(id,label)=>`<option value="${id}">${label}</option>`,
  actionForm:(title,html,submit)=>{const form={title,html,submit};forms.push(form);return form;},syncWorkspaceNavigation(){},workspaceLoading:()=>assert.fail('A save must retain the workspace'),
  FormData:class{constructor(form){this.data=new Map(Object.entries(c.values));}get(key){return this.data.get(key)??null;}has(key){return this.data.has(key);}},
  client:{rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});return c.rpcResponse(name,args);},from:table=>{let id;const q={select:()=>q,eq:(key,value)=>{id=value;return q;},maybeSingle:async()=>{reads.push({table,id});return c.readResponse(id);}};return q;}},
 });
 installPageHeader(c);vm.runInContext(read('sales-leads.js'),c);const get=code=>vm.runInContext(code,c);
 c.values={who:'client',organizationId:'clinic',contactId:'',clientCallerName:'Asha',clientCallerPhone:'0712345678',callerRole:'doctor',subject:'Updated quote',details:'Need a quote',source:'phone',nextAction:'Call back',nextActionOn:'2099-01-01',currency:'TZS',estimatedValue:''};
 c.rpcResponse=(name,args)=>({data:name==='save_sales_lead'?{...row(args.p_id,args.p_expected_version+1),...args.p_fields}:{...row(),version:4,stage:name==='advance_sales_lead'?args.p_action:'lead',owner_user_id:args.p_new_owner_user_id||'actor',lost_reason:args.p_note}});
 c.readResponse=()=>({data:{...row(),version:4,stage:'lost',lost_reason:'No longer needed'}});
 const actualHandover=c.decorateLeadHandovers;c.decorateLeadHandovers=async()=>decorations.push('handover');c.decorateOrderLiveStatus=async()=>decorations.push('order');
 c.seed=[row(),row('two')];get(`leadRows=seed;leadLoaded=true;leadActor=me;leadSelectedId=${JSON.stringify(selected)};leadEditing=${JSON.stringify(editing)};leadSearch='quote';leadFilter='mine';leadPage=3;leadPageData={total:50};renderLeads();`);
 return {c,get,document,content,calls,reads,forms,messages,scrolls,decorations,actor,actualHandover,writes:()=>writes,node:selector=>document.querySelector(selector),card:id=>document.querySelector(`[data-lead-card="${id}"]`),open:(action='lost')=>{c.openLeadAction(get('leadRows[0]'),action);return forms.at(-1);}};
}

test('confirmed status receipt changes one card while retaining shell, header, Back, equal nodes and scroll',async()=>{
 const f=fixture(),shell=f.node('.leads-workspace'),header=f.node('.workspace-page-header'),back=f.node('#leadBack'),old=f.card('one');
 f.node('#leadDetail').insertAdjacentHTML('beforeend',f.c.leadCard(row('two')));f.c.bindLeadDetailActions();const peer=f.card('two'),focus=peer.querySelector('button');focus.focus();
 const form=f.open();await form.submit({note:'No longer needed'});
 assert.equal(f.writes(),1);assert.equal(f.node('.leads-workspace'),shell);assert.equal(f.node('.workspace-page-header'),header);assert.equal(f.node('#leadBack'),back);assert.equal(f.card('two'),peer);assert.equal(f.document.activeElement,focus);assert.notEqual(f.card('one'),old);
 assert.match(f.card('one').textContent,/Lost becauseNo longer needed/);assert.equal(f.reads.length,0);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{name:'advance_sales_lead',args:{p_id:'one',p_expected_version:3,p_action:'lost',p_assigned_user_id:null,p_note:'No longer needed',p_proforma_id:null}});
 assert.equal(f.get('leadPageData'),null);assert.equal(f.get('leadRows.find(row=>row.id==="one").version'),4);assert.equal(f.get('leadRows.find(row=>row.id==="one").updated_at'),'2026-10-01T12:00:00.123456Z');assert.deepEqual(f.scrolls.at(-1),[9,240]);assert.deepEqual(f.decorations.slice(-2),['order','handover']);
});

test('a version-only update retains the equal card and refreshes its versioned action closures',async()=>{
 const f=fixture(),card=f.card('one');f.c.rpcResponse=()=>({data:{...row(),version:4}});
 await f.open('assign').submit({assignee:'actor'});assert.equal(f.card('one'),card);f.c.rpcResponse=()=>({error:Error('Stop')});card.querySelector('[data-lead-action="lost"]').onclick();await assert.rejects(f.forms.at(-1).submit({note:'No longer needed'}),/Stop/);
 assert.equal(f.calls.at(-1).args.p_expected_version,4);
});

test('save edits consumes the full confirmed row and removes only the editor while retaining the workspace',async()=>{
 const f=fixture({editing:'one'}),header=f.node('.workspace-page-header'),back=f.node('#leadBack'),form=f.node('#leadForm');form.querySelector('[name="subject"]').focus();
 await f.c.saveLeadForm(form);assert.equal(f.writes(),1);assert.equal(f.node('.workspace-page-header'),header);assert.equal(f.node('#leadBack'),back);assert.equal(f.node('.lead-editor'),null);assert.match(f.card('one').textContent,/Updated quote/);assert.equal(f.get('leadEditing'),'');assert.equal(f.reads.length,0);assert.equal(f.calls[0].args.p_id,'one');assert.equal(f.calls[0].args.p_expected_version,3);assert.equal(f.document.activeElement,f.card('one').querySelector('[data-lead-edit]'));assert.deepEqual(f.messages.at(-1),['LD-one saved.']);
});

test('new inquiry keeps the client-generated ID and replaces only its editor with the confirmed lead',async()=>{
 const f=fixture({editing:'new',selected:''}),form=f.node('#leadForm'),header=f.node('.workspace-page-header');f.c.values.ownerUserId='';
 await f.c.saveLeadForm(form);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_id,'new-id');assert.equal(f.calls[0].args.p_expected_version,0);assert.equal(f.get('leadSelectedId'),'new-id');assert.equal(f.node('.workspace-page-header'),header);assert.equal(f.node('.lead-editor'),null);assert.match(f.card('new-id').textContent,/Updated quote/);assert.equal(f.writes(),1);assert.equal(f.reads.length,0);
});

test('handover retains the workspace and exact args; the confirmed owner and next action appear immediately',async()=>{
 const f=fixture(),header=f.node('.workspace-page-header');f.c.rpcResponse=()=>({data:{...row(),version:4,owner_user_id:'other',next_action:'Send brochure',next_action_on:'2099-02-01'}});f.c.openLeadHandover(f.get('leadRows[0]'));
 await f.forms.at(-1).submit({assignee:'other',note:'Please   call this customer back',nextAction:' Send brochure ',nextActionOn:'2099-02-01'});
 assert.deepEqual(f.calls[0],{name:'hand_over_sales_lead',args:{p_id:'one',p_expected_version:3,p_new_owner_user_id:'other',p_note:'Please call this customer back',p_next_action:'Send brochure',p_next_action_on:'2099-02-01'}});assert.equal(f.node('.workspace-page-header'),header);assert.match(f.card('one').textContent,/Baraka/);assert.match(f.card('one').textContent,/Send brochure/);assert.equal(f.reads.length,0);assert.equal(f.writes(),1);
});

for(const response of ['missing','partial','wrong-id','old-version'])test(`${response} receipt follows up with one scoped authoritative read`,async()=>{
 const f=fixture();f.c.rpcResponse=()=>({data:response==='missing'?null:response==='partial'?{id:'one',version:4}:response==='wrong-id'?row('other',4):row()});
 await f.open().submit({note:'No longer needed'});assert.deepEqual(f.reads,[{table:'sales_leads',id:'one'}]);assert.match(f.card('one').textContent,/Lost/);assert.equal(f.calls.length,1);assert.equal(f.writes(),1);
});

test('confirmed write followed by failed read stays Saved and read-only; Retry reads without replaying the write',async()=>{
 const f=fixture(),old=f.card('one'),header=f.node('.workspace-page-header');f.c.rpcResponse=()=>({data:null});f.c.readResponse=()=>({error:Error('Offline <script>')});const form=f.open();
 await form.submit({note:'No longer needed'});assert.equal(f.card('one'),old);assert.equal(f.node('#leadDetail').inert,true);assert.match(f.node('#leadSaveStatus').textContent,/saved.*Offline <script>/);assert.equal(f.node('#leadSaveStatus').querySelector('script'),null);assert.equal(f.node('.workspace-page-header'),header);assert.equal(f.writes(),1);
 await assert.rejects(form.submit({note:'No longer needed'}),/Lead saved/);assert.equal(f.calls.length,1);
 f.c.readResponse=()=>({data:{...row(),version:4,stage:'lost'}});await f.node('[data-lead-save-retry]').onclick();assert.equal(f.node('#leadDetail').inert,false);assert.equal(f.reads.length,2);assert.equal(f.calls.length,1);assert.match(f.card('one').textContent,/Lost/);assert.equal(f.writes(),1);
});

test('an incomplete confirmed edit locks its form; lookup-only Retry preserves the same save identity',async()=>{
 const f=fixture({editing:'one'}),form=f.node('#leadForm');f.c.rpcResponse=(_,args)=>({data:{...args.p_fields,id:args.p_id,version:4,lead_number:'LD-one'}});f.c.readResponse=()=>({error:Error('Offline')});
 await f.c.saveLeadForm(form);assert.equal(form.dataset.leadSaved,'true');assert.equal(form.querySelector('[type="submit"]').disabled,true);assert.equal(f.node('#leadDetail').inert,true);
 await assert.rejects(f.c.saveLeadForm(form),/Lead saved/);assert.equal(f.calls.length,1);
 f.c.readResponse=()=>({data:{...row(),...f.calls[0].args.p_fields,version:4}});await f.node('[data-lead-save-retry]').onclick();assert.equal(f.calls.length,1);assert.equal(f.node('.lead-editor'),null);assert.match(f.card('one').textContent,/Updated quote/);
});

test('a local render failure retries the retained confirmed receipt without another read or write',async()=>{
 const f=fixture(),create=f.document.createElement;let fail=true;f.document.createElement=tag=>{if(tag==='template'&&fail){fail=false;throw Error('Rendering unavailable');}return create(tag);};
 await f.open().submit({note:'No longer needed'});assert.match(f.node('#leadSaveStatus').textContent,/saved.*Rendering unavailable/);assert.equal(f.get('leadRows.find(row=>row.id==="one").version'),4);
 await f.node('[data-lead-save-retry]').onclick();assert.match(f.card('one').textContent,/Lost/);assert.equal(f.calls.length,1);assert.equal(f.reads.length,0);assert.equal(f.node('#leadDetail').inert,false);
});

for(const change of ['actor','session','route','request'])for(const reject of [false,true])test(`${change} change suppresses a pending ${reject?'rejection':'receipt'}`,async()=>{
 const f=fixture(),wait=deferred(),old=f.card('one');f.c.rpcResponse=()=>wait.promise;const pending=f.open().submit({note:'No longer needed'});
 f.get({actor:'me={...me}',session:'sessionLoadEpoch++',route:"view='staff'",request:'leadRenderEpoch++'}[change]);if(reject)wait.reject(Error('Late private failure'));else wait.resolve({data:{...row(),version:4,stage:'lost'}});await pending;
 assert.equal(f.card('one'),old);assert.equal(f.get('leadRows[0].version'),3);assert.equal(f.messages.length,0);assert.equal(f.reads.length,0);assert.equal(f.writes(),1);
});

for(const change of ['actor','session','route','request','detail'])test(`${change} change suppresses a pending scoped read and disables the old Retry`,async()=>{
 const f=fixture(),wait=deferred();f.c.rpcResponse=()=>({data:null});f.c.readResponse=()=>({error:Error('Offline')});await f.open().submit({note:'No longer needed'});const retry=f.node('[data-lead-save-retry]');f.c.readResponse=()=>wait.promise;const pending=retry.onclick();
 if(change==='detail')f.node('#leadDetail').replaceWith(f.document.createElement('div'));else f.get({actor:'me={...me}',session:'sessionLoadEpoch++',route:"view='staff'",request:'leadRenderEpoch++'}[change]);
 const before=f.content.innerHTML;wait.resolve({data:{...row(),version:4,stage:'lost'}});await pending;assert.equal(f.content.innerHTML,before);assert.equal(f.get('leadRows[0].version'),3);const readCount=f.reads.length;await retry.onclick();assert.equal(f.reads.length,readCount);assert.equal(f.calls.length,1);
});

test('late older receipt never overwrites a newer confirmed cached version',async()=>{
 const f=fixture(),wait=deferred();f.c.rpcResponse=()=>wait.promise;const pending=f.open().submit({note:'No longer needed'});f.get("leadRows[0]={...leadRows[0],version:5,subject:'Later confirmed update'}");wait.resolve({data:{...row(),version:4,stage:'lost'}});await pending;
 assert.equal(f.get('leadRows.find(row=>row.id==="one").version'),5);assert.match(f.card('one').textContent,/Later confirmed update/);assert.doesNotMatch(f.card('one').textContent,/Lost because/);
});

test('Back obtains authoritative changed membership and counts using the unchanged search/filter/page',async()=>{
 const f=fixture();await f.open().submit({note:'No longer needed'});f.c.workspaceLoading=()=>{};f.c.rpcResponse=(name,args)=>{assert.equal(name,'sales_lead_page');return {data:{rows:[],total:0,page:0,pages:1,counts:{all:1,open:0,mine:0,new:0,won:0,lost:1}}};};
 f.node('#leadBack').onclick();await new Promise(resolve=>setImmediate(resolve));const call=f.calls.at(-1);assert.equal(call.name,'sales_lead_page');assert.equal(call.args.p_query,'quote');assert.equal(call.args.p_filter,'mine');assert.equal(call.args.p_page,3);assert.match(f.content.textContent,/0 matching leads/);assert.match(f.content.textContent,/Lost · 1/);assert.equal(f.get('leadPage'),0);
});

test('late handover history cannot populate a replacement same-user session',async()=>{
 const f=fixture(),wait=deferred();f.c.decorateLeadHandovers=f.actualHandover;f.c.client.from=()=>{const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>wait.promise};return q;};const pending=f.c.decorateLeadHandovers();f.get('me={...me}');wait.resolve({data:[{lead_id:'one',note:'Private handover',created_at:'2026-10-29'}]});await pending;assert.equal(f.get('leadHandovers.size'),0);assert.doesNotMatch(f.content.textContent,/Private handover/);
});
