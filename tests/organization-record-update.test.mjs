import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source,plain} from './helpers/client-directory-fixture.mjs';
import {contactDom} from './helpers/contact-dom-fixture.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const organization=(id,name,parent_id=null)=>({id,name,location:'Arusha',type:'Clinic',parent_id,approval_status:'approved'});
const contact=(id,organization_id)=>({id,organization_id,title:'Mr.',first_name:'Asha',last_name:id==='one'?'Mushi':'Kamau',position:'Lab',phone_country:'TZ',country_code:'+255',phone:id==='one'?'712345678':'712345679',email:'',status:'kept',reason:'',revision:3});
function fixture({route='client',tab='contacts'}={}){
 const document=contactDom(),events={};document.addEventListener=(name,fn)=>(events[name]??=[]).push(fn);document.getElementById=id=>document.querySelector('#'+id);
 installNativeFormControls(document);
 document.body.innerHTML='<main id="content"></main><dialog id="editor"><form id="editForm"><div id="fields"></div><p id="formError"></p><button id="closeEditor">Close</button></form></dialog><p id="notice"></p><form id="organizationEditor"></form>';
 const content=document.querySelector('#content'),descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');let writes=0;
 Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:value=>{writes++;descriptor.set.call(content,value);}});
 const rows=[organization('parent','Alpha Clinic'),organization('branch','Alpha Clinic Branch','parent'),organization('peer','Different Clinic','parent'),organization('candidate','Alpha Clinic Third'),organization('unrelated','Unrelated Clinic')];
 const calls=[],messages=[],scrolls=[],navigation=[],actor={user_id:'actor',role:'owner'},ctx=vm.createContext({workspacePageHeader,statusTone,document,console,Intl,Map,Set,setTimeout,clearTimeout,location:{hash:route==='client'?'#/client/parent':'#/branch/branch'},window:{addEventListener(){},scrollX:7,scrollY:140,scrollTo:(...args)=>scrolls.push(args)},
  workspaceFormSnapshot:()=>'',canEditRecords:()=>true,recordsLockedNote:()=>'',crypto:{randomUUID:()=> 'created'},syncWorkspaceNavigation(){},actor,seed:plain(rows),seedContacts:[contact('one','branch'),contact('two','peer')],showFieldErrors(){},hasArea:()=>true});
 for(const file of ['phone-rules.js','client-rules.js','client-profile-pages.js'])vm.runInContext(source(file),ctx);
 vm.runInContext(source('app.js').split('\n').filter(line=>!line.startsWith('(async()=>{const cfg=')).join('\n'),ctx);
 ctx.Option=function(label,value){const option=document.createElement('option');option.textContent=label;option.value=value;option.setAttribute('value',value);return option;};
 const action=source('action-forms.js');vm.runInContext(action.slice(action.indexOf('function openOrganizationForm('),action.indexOf('function openProductForm(')),ctx);
 vm.runInContext(action.slice(action.indexOf('function openBranchForm(')),ctx);
 const run=code=>vm.runInContext(code,ctx);
 ctx.transport={rpc:async(name,args)=>{calls.push({name,args});const old=rows.find(row=>row.id===args.p_id);if(name==='save_organization')return {data:{...old,id:args.p_id,name:args.p_name,location:args.p_location,type:args.p_type,parent_id:old?.parent_id||null,approval_status:'review'}};if(name==='approve_organization')return {data:{...old,approval_status:'approved'}};throw Error('Unexpected write');},from:table=>{
  const read={table};calls.push(read);const query={select(columns){read.columns=columns;return this;},eq(key,value){read[key]=value;return this;},in(key,value){read[key]=value;return this;},is(key,value){read[key]=value;return this;},order(){return this;},range:async()=>({data:plain(rows.filter(row=>read.id.includes(row.id)))}),single:async()=>({data:plain(rows.find(row=>row.id===read.id))})};return query;
 }};
 ctx.recordMessage=(...args)=>messages.push(args);ctx.noRender=()=>assert.fail('Organization save must not replace the workspace');ctx.recordNavigation=(...args)=>navigation.push(args);
 run("client=transport;me=actor;organizations=seed;contacts=seedContacts;listsLoaded=true;scan();message=recordMessage;render=noRender;run=fn=>fn();goProfile=recordNavigation;let actionSubmit=null,actionInitialValues='';const actionEditorForm=document.querySelector('#organizationEditor');actionForm=(title,fields,submit)=>{actionSubmit=submit;actionEditorForm.innerHTML=fields;const select=actionEditorForm.querySelector('select');if(select)select.add=option=>select.append(option);return actionEditorForm};");
 Object.defineProperty(document.querySelector('#organizationEditor'),'elements',{get:()=>({namedItem:name=>document.querySelector('#organizationEditor').querySelector(`[name="${name}"]`)})});
 run(`view='contacts';profileTab=${JSON.stringify(tab)};branchActivityCache.set('branch:orders',{rows:[{id:'order',document_number:'SO-1',status:'draft'}]});profileView()`);
 return {ctx,document,content,calls,messages,scrolls,navigation,run,rows,actor,writes:()=>writes,node:id=>document.querySelector('#'+id),branch:id=>document.querySelector(`[data-organization-id="${id}"]`),open:id=>run(`openOrganizationForm(orgIndex.get(${JSON.stringify(id)}))`),submit:values=>{ctx.values=values;return run('actionSubmit(values)');},async click(node){for(const handler of events.click||[])await handler({target:node});await new Promise(resolve=>setImmediate(resolve));}};
}
const editValues={name:'Renamed Clinic',location:'Mwanza',type:'Hospital'};

test('confirmed account edit retains profile shell, equal branch cards, focus and scroll with exact write args and no read',async()=>{
 const f=fixture(),shell=f.document.querySelector('.client-pages'),header=f.document.querySelector('.account-head'),breadcrumb=f.node('profileBreadcrumb'),branches=f.node('profileBranches'),peer=f.branch('peer'),branch=f.branch('branch'),button=f.document.querySelector('[data-link-parent]');button.focus();f.open('parent');
 await f.submit(editValues);assert.equal(f.writes(),1);assert.equal(f.document.querySelector('.client-pages'),shell);assert.equal(f.document.querySelector('.account-head'),header);assert.equal(f.node('profileBreadcrumb'),breadcrumb);assert.equal(f.node('profileBranches'),branches);assert.equal(f.branch('peer'),peer);assert.equal(f.branch('branch'),branch);assert.equal(f.document.activeElement,button);assert.match(f.node('profileOrganizationName').textContent,/Renamed Clinic/);assert.match(f.node('profileOrganizationFacts').textContent,/Mwanza.*Hospital/);assert.match(breadcrumb.textContent,/Renamed Clinic/);assert.deepEqual(plain(f.calls),[{name:'save_organization',args:{p_id:'parent',p_name:'Renamed Clinic',p_location:'Mwanza',p_type:'Hospital'}}]);assert.equal(f.run("orgIndex.get('parent').approval_status"),'review');assert.deepEqual(f.scrolls.at(-1),[7,140]);assert.deepEqual(f.messages.at(-1),['Account saved.']);
});

test('branch rename refreshes its visible contact identity while preserving filters and unrelated panels',async()=>{
 const f=fixture({route:'branch'}),tabs=f.document.querySelector('.profile-sections'),filters=f.node('contactFilters'),panel=f.node('profile-panel');f.open('branch');await f.submit(editValues);assert.match(f.node('contactResults').textContent,/Renamed Clinic/);assert.match(f.node('branchContactsDescription').textContent,/Mwanza/);assert.equal(f.node('contactFilters'),filters);assert.equal(f.node('profile-panel'),panel);assert.equal(f.document.querySelector('.profile-sections'),tabs);assert.equal(f.run("orgIndex.get('parent').approval_status"),'review');assert.equal(f.writes(),1);
 const activity=fixture({route:'branch',tab:'orders'}),oldPanel=activity.node('profile-panel'),order=oldPanel.firstElementChild;activity.open('branch');await activity.submit(editValues);assert.equal(activity.node('profile-panel'),oldPanel);assert.equal(oldPanel.firstElementChild,order);assert.match(oldPanel.textContent,/SO-1/);assert.equal(activity.writes(),1);
});

test('approve click consumes its confirmed receipt and retains directory cards and header',async()=>{
 const f=fixture();f.run("orgIndex.get('parent').approval_status='review';refreshSavedOrganizationProfile()");const header=f.document.querySelector('.account-head'),peer=f.branch('peer'),button=f.document.querySelector('[data-approve-org]');await f.click(button);assert.equal(f.run("orgIndex.get('parent').approval_status"),'approved');assert.equal(f.document.querySelector('.account-head'),header);assert.equal(f.branch('peer'),peer);assert.equal(f.writes(),1);assert.deepEqual(plain(f.calls),[{name:'approve_organization',args:{p_id:'parent'}}]);assert.deepEqual(f.messages.at(-1),['Client profile approved.']);
});

test('link reads the affected family once and uses authoritative approvals without touching unrelated cards or contact data',async()=>{
 const f=fixture(),peer=f.branch('peer'),contacts=f.run('contacts'),header=f.document.querySelector('.account-head');f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});f.rows.find(row=>row.id==='candidate').parent_id='parent';f.rows.find(row=>row.id==='parent').approval_status='review';return {data:null};};
 await f.ctx.linkBranch('candidate','parent');assert.equal(f.writes(),1);assert.equal(f.branch('peer'),peer);assert.equal(f.document.querySelector('.account-head'),header);assert.ok(f.branch('candidate'));assert.equal(f.run("orgIndex.get('candidate').parent_id"),'parent');assert.equal(f.run("orgIndex.get('candidate').approval_status"),'approved');assert.equal(f.run("orgIndex.get('parent').approval_status"),'review');assert.equal(f.run('contacts'),contacts);assert.match(f.node('profileBranchCount').textContent,/3 branches/);assert.equal(f.node('profileGroupSuggestions').textContent,'');assert.deepEqual(plain(f.calls[0]),{name:'set_organization_parent',args:{p_id:'candidate',p_parent_id:'parent'}});assert.equal(f.calls.length,2);assert.deepEqual(new Set(f.calls[1].id),new Set(['candidate','parent','branch','peer']));assert.equal(f.calls[1].table,'organizations');assert.equal(f.calls[1].deleted_at,null);
});

test('unlink click patches parent breadcrumb/actions and preserves the active activity panel',async()=>{
 const f=fixture({route:'branch',tab:'orders'}),panel=f.node('profile-panel'),tabs=f.document.querySelector('.profile-sections');f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});f.rows.find(row=>row.id==='branch').parent_id=null;return {data:{ignored:'Not an invented family receipt'}};};await f.click(f.node('ungroupAccount'));assert.equal(f.writes(),1);assert.equal(f.node('profile-panel'),panel);assert.equal(f.document.querySelector('.profile-sections'),tabs);assert.equal(f.node('ungroupAccount'),null);assert.match(f.node('profileBreadcrumb').textContent,/Alpha Clinic Branch/);assert.equal(f.run("orgIndex.get('branch').parent_id"),null);assert.deepEqual(plain(f.calls[0]),{name:'set_organization_parent',args:{p_id:'branch',p_parent_id:null}});assert.equal(f.calls.length,2);
});

test('failed group follow-up read keeps Saved with read-only Retry and never infers local parent or replays the write',async()=>{
 const f=fixture(),peer=f.branch('peer');f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});return {data:null};};const originalFrom=f.ctx.transport.from;f.ctx.transport.from=table=>{const query=originalFrom(table);query.range=async()=>({error:Error('<hidden> read failed')});return query;};await f.ctx.linkBranch('candidate','parent');assert.equal(f.run("orgIndex.get('candidate').parent_id"),null);assert.equal(f.branch('peer'),peer);assert.match(f.node('organizationSaveStatus').textContent,/Branch group saved/);assert.equal(f.node('organizationSaveStatus').querySelector('hidden'),null);assert.match(f.node('organizationSaveStatus').textContent,/<hidden> read failed/);assert.equal(f.document.querySelector('[data-link-parent]'),null);assert.equal(f.document.querySelector('[data-approve-org]'),null);assert.equal(f.document.querySelector('[data-group]'),null);assert.equal(f.run('listsLoaded'),false);
 f.ctx.transport.from=originalFrom;f.rows.find(row=>row.id==='candidate').parent_id='parent';await f.node('organizationSaveRetry').onclick();assert.equal(f.run("orgIndex.get('candidate').parent_id"),'parent');assert.ok(f.branch('candidate'));assert.equal(f.branch('peer'),peer);assert.ok(f.document.querySelector('[data-link-parent]'));assert.equal(f.node('organizationSaveStatus').textContent,'');assert.equal(f.calls.filter(row=>row.name==='set_organization_parent').length,1);assert.equal(f.calls.filter(row=>row.table).length,2);
});

test('missing save receipt recovers by a scoped row read and a failed read leaves Saved Retry without a second write',async()=>{
 const f=fixture();f.open('parent');f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{}};};const from=f.ctx.transport.from;f.ctx.transport.from=table=>{const query=from(table);query.single=async()=>({error:Error('Unavailable')});return query;};await f.submit(editValues);assert.match(f.node('organizationSaveStatus').textContent,/Account saved/);assert.equal(f.document.querySelector('[data-edit-account]'),null);f.ctx.transport.from=from;Object.assign(f.rows[0],editValues);await f.node('organizationSaveRetry').onclick();assert.equal(f.node('profileOrganizationName').textContent,'Renamed Clinic');assert.equal(f.calls.filter(row=>row.name==='save_organization').length,1);assert.equal(f.calls.filter(row=>row.table).length,2);assert.equal(f.calls[1].id,'parent');assert.equal(f.calls[1].columns,f.run('listColumns.organizations'));assert.equal(f.calls[1].deleted_at,null);
});

test('failed writes and stale actor, session or newer request completions leave original profile/cache untouched',async()=>{
 const failed=fixture();failed.open('parent');failed.ctx.transport.rpc=async()=>({error:Error('Permission denied')});await assert.rejects(failed.submit(editValues),/Permission denied/);assert.equal(failed.node('profileOrganizationName').textContent,'Alpha Clinic');assert.equal(failed.run("orgIndex.get('parent').name"),'Alpha Clinic');assert.deepEqual(failed.messages,[]);
 for(const change of ["me={...me}",'sessionLoadEpoch++','organizationSaveContext()']){const f=fixture(),wait=deferred();f.open('parent');f.ctx.transport.rpc=()=>wait.promise;const pending=f.submit(editValues);f.run(change);wait.resolve({data:{...f.rows[0],...editValues}});await pending;assert.equal(f.node('profileOrganizationName').textContent,'Alpha Clinic');assert.equal(f.run("orgIndex.get('parent').name"),'Alpha Clinic');assert.deepEqual(f.messages,[]);}
});

test('late family reads and old Retry buttons cannot mutate replacement actors or launch another read',async()=>{
 for(const change of ["me={...me}",'sessionLoadEpoch++','organizationSaveContext()']){const f=fixture(),wait=deferred(),started=deferred();f.ctx.transport.rpc=async()=>({data:null});f.ctx.all=()=>{started.resolve();return wait.promise;};const pending=f.ctx.linkBranch('candidate','parent');await started.promise;f.run(change);wait.resolve([{...f.rows[0],name:'Late parent'},{...f.rows[3],parent_id:'parent'}]);await pending;assert.equal(f.run("orgIndex.get('parent').name"),'Alpha Clinic');assert.equal(f.run("orgIndex.get('candidate').parent_id"),null);assert.deepEqual(f.messages,[]);}
 const f=fixture();f.ctx.transport.rpc=async()=>({data:null});let reads=0;f.ctx.all=async()=>{reads++;throw Error('Unavailable');};await f.ctx.linkBranch('candidate','parent');const retry=f.node('organizationSaveRetry');f.run('me={...me}');await retry.onclick();assert.equal(reads,1);
});

test('navigation during a save updates only the current actor cache and does not replace the new page',async()=>{
 const f=fixture(),wait=deferred();f.open('parent');f.ctx.transport.rpc=()=>wait.promise;const pending=f.submit(editValues);f.run("view='inventory'");f.content.innerHTML='<h1>New page</h1>';wait.resolve({data:{...f.rows[0],...editValues}});await pending;assert.equal(f.content.textContent,'New page');assert.equal(f.run("orgIndex.get('parent').name"),'Renamed Clinic');assert.deepEqual(f.messages,[]);
});

test('old edit form callbacks cannot write after actor/route replacement and creation keeps explicit navigation',async()=>{
 for(const change of ["me={...me}","view='inventory'",'sessionLoadEpoch++']){const f=fixture();f.open('parent');f.run(change);await f.submit(editValues);assert.equal(f.calls.length,0);}
 const f=fixture();f.run("location.hash='#/clients';clientDirectoryData={organizations,contacts,childrenByParent,orgIndex,contactIssues,accountIssues,accountReviewCounts,duplicates};profileDirectory();openOrganizationForm()");await f.submit(editValues);assert.equal(f.run("orgIndex.get('created').name"),'Renamed Clinic');assert.deepEqual(f.navigation,[['client','created']]);assert.equal(f.calls.length,1);
});

test('profile markup keeps all database identity text escaped',async()=>{
 const f=fixture();f.run("titleCase=value=>value");f.open('parent');await f.submit({name:'<script>bad</script>',location:'<img onerror="bad">',type:'<strong>Clinic</strong>'});assert.equal(f.document.querySelector('script'),null);assert.equal(f.document.querySelector('img'),null);assert.match(f.node('profileOrganizationFacts').textContent,/<img onerror=/);assert.match(f.node('profileBreadcrumb').textContent,/<script>bad<\/script>/);
});


test('branch dialog captures its actor/session/route at open and retains eligible-branch validation',async()=>{
 for(const change of ["me={...me}",'sessionLoadEpoch++',"view='inventory'"]){const f=fixture();f.run("openBranchForm(orgIndex.get('parent'))");f.run(change);await f.submit({branch_id:'candidate'});assert.equal(f.calls.length,0);}
 const f=fixture();f.run("openBranchForm(orgIndex.get('parent'))");await assert.rejects(f.submit({branch_id:'peer'}),/eligible branch/);assert.equal(f.calls.length,0);f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});f.rows.find(row=>row.id==='candidate').parent_id='parent';return {data:null};};await f.submit({branch_id:'candidate'});assert.equal(f.run("orgIndex.get('candidate').parent_id"),'parent');assert.equal(f.calls.length,2);
});

test('approve and grouping writes suppress late success and rejection for replaced actors and sessions',async()=>{
 for(const operation of ["approveOrganization('parent')","linkBranch('candidate','parent')"]){for(const change of ["me={...me}",'sessionLoadEpoch++']){for(const rejection of [false,true]){
  const f=fixture(),wait=deferred();f.ctx.transport.rpc=()=>wait.promise;const pending=f.run(operation);f.run(change);if(rejection)wait.reject(Error('Late failure'));else wait.resolve({data:{...f.rows[0],name:'Late receipt'}});await pending;assert.equal(f.run("orgIndex.get('parent').name"),'Alpha Clinic');assert.equal(f.run("orgIndex.get('candidate').parent_id"),null);assert.equal(f.calls.length,0);assert.deepEqual(f.messages,[]);
 }}}
});

test('a family member absent from the authoritative read leaves cache and branch list; a hidden edited row fails closed',async()=>{
 const f=fixture();f.ctx.transport.rpc=async()=>({data:null});f.ctx.all=async()=>f.rows.filter(row=>['parent','branch','candidate'].includes(row.id)).map(row=>({...row,parent_id:row.id==='candidate'?'parent':row.parent_id}));await f.ctx.linkBranch('candidate','parent');assert.equal(f.branch('peer'),null);assert.equal(f.run("orgIndex.has('peer')"),false);assert.equal(f.run("orgIndex.has('unrelated')"),true);assert.match(f.node('profileBranchCount').textContent,/2 branches/);
 const hidden=fixture();hidden.ctx.transport.rpc=async()=>({data:null});hidden.ctx.all=async()=>[hidden.rows[0]];await hidden.ctx.linkBranch('candidate','parent');assert.equal(hidden.run("orgIndex.get('candidate').parent_id"),null);assert.match(hidden.node('organizationSaveStatus').textContent,/Branch group saved/);assert.equal(hidden.document.querySelector('[data-link-parent]'),null);
});

test('a refresh failure after a valid receipt retries locally without another write or read',async()=>{
 const f=fixture();f.open('parent');const refresh=f.ctx.refreshSavedOrganizationProfile;let fail=true;f.ctx.refreshSavedOrganizationProfile=()=>{if(fail){fail=false;throw Error('Render failed');}return refresh();};await f.submit(editValues);assert.match(f.node('organizationSaveStatus').textContent,/Account saved/);assert.equal(f.run("orgIndex.get('parent').name"),'Renamed Clinic');await f.node('organizationSaveRetry').onclick();assert.equal(f.node('profileOrganizationName').textContent,'Renamed Clinic');assert.equal(f.calls.length,1);
});

test('an overlapping full-list refresh cannot be overwritten by an older saved-profile read',async()=>{
 const f=fixture(),wait=deferred(),started=deferred();f.ctx.transport.rpc=async()=>({data:null});f.ctx.all=()=>{started.resolve();return wait.promise;};const pending=f.ctx.linkBranch('candidate','parent');await started.promise;f.run("listsEpoch++;orgIndex.get('parent').name='Newer loaded identity'");wait.resolve(f.rows.filter(row=>row.id!=='unrelated'));await pending;assert.equal(f.run("orgIndex.get('parent').name"),'Newer loaded identity');assert.match(f.node('organizationSaveStatus').textContent,/Client data changed/);assert.equal(f.document.querySelector('[data-link-parent]'),null);
});

test('client and branch headers have one identity, real breadcrumbs and one Back destination',()=>{
 for(const route of ['client','branch']){
  const f=fixture({route}),header=f.document.querySelector('.workspace-page-header');
  assert.ok(header);assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(header.querySelectorAll('.workspace-page-back a').length,1);
  assert.equal(header.querySelector('.workspace-page-back a').getAttribute('href'),route==='client'?'#/clients':'#/client/parent');
  assert.equal(header.querySelector('.workspace-page-breadcrumbs').getAttribute('aria-label'),'Breadcrumb');
  assert.equal(f.node('profileBreadcrumb').querySelector('[aria-current="page"]').getAttribute('href'),route==='client'?'#/client/parent':'#/branch/branch');
  assert.ok(f.node('profileOrganizationFacts'));assert.ok(f.node('profileOrganizationActions'));
 }
});
