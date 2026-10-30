import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source,plain} from './helpers/client-directory-fixture.mjs';
import {contactDom} from './helpers/contact-dom-fixture.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const org=(id,name,parent_id=null)=>({id,name,location:'Arusha',type:'Clinic',parent_id,approval_status:'approved',deleted_at:null});
const person=(id,organization_id,n=1)=>({id,organization_id,title:'Mr.',first_name:'Person'+n,last_name:'Contact',position:'Lab',phone_country:'TZ',country_code:'+255',phone:'71'+String(n).padStart(7,'0'),email:'',status:'kept',reason:'',revision:3,deleted_at:null});
function fixture({route='branch',review=false,rows=null}={}){
 const document=contactDom(),events={};document.addEventListener=(event,fn)=>(events[event]??=[]).push(fn);document.getElementById=id=>document.querySelector('#'+id);
 document.body.innerHTML='<main id="content"></main><dialog id="editor"><form id="editForm"><div id="fields"></div><p id="formError"></p><button id="closeEditor">Close</button></form></dialog><form id="deleteForm"><button type="submit">Delete</button></form><p id="notice"></p>';
 const content=document.querySelector('#content'),descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');let writes=0;
 Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:value=>{writes++;descriptor.set.call(content,value);}});
 const data={organizations:[org('parent','Main Clinic'),org('branch','Branch Clinic','parent'),org('peer','Peer Clinic','parent'),org('unrelated','Unrelated Clinic')],contacts:rows||[person('one','branch',1),person('two','branch',2),person('three','peer',3)]};
 const calls=[],messages=[],scrolls=[],actor={user_id:'actor',role:'owner'},ctx=vm.createContext({workspacePageHeader,statusTone,document,console,Intl,Map,Set,setTimeout,clearTimeout,location:{hash:review?'#/clients':route==='branch'?'#/branch/branch':'#/client/parent'},window:{addEventListener(){},scrollX:5,scrollY:160,scrollTo:(...args)=>scrolls.push(args)},canEditRecords:()=>true,recordsLockedText:'Records permission required',recordsLockedNote:()=>'',crypto:globalThis.crypto,syncWorkspaceNavigation(){},renderSearchPreservingPosition:(_,fn)=>fn(),actor,seed:plain(data),hasArea:()=>true});
 for(const file of ['phone-rules.js','client-rules.js','client-profile-pages.js','recycle-bin.js'])vm.runInContext(source(file),ctx);
 vm.runInContext(source('app.js').split('\n').filter(line=>!line.startsWith('(async()=>{const cfg=')).join('\n'),ctx);const run=code=>vm.runInContext(code,ctx);
 ctx.transport={rpc:async(name,args)=>{calls.push({name,args});const table=args.p_kind==='organization'?'organizations':'contacts';data[table].find(row=>row.id===args.p_id).deleted_at='2026-10-29T12:00:00Z';return {data:{kind:args.p_kind,id:args.p_id}};},from:table=>{
  const read={table};calls.push(read);return {select(columns){read.columns=columns;return this;},in(key,ids){read.key=key;read.ids=ids;return this;},order(){return this;},range:async(start,end)=>{read.range=[start,end];const rows=data[table].filter(row=>read.ids.includes(row.id));return {data:plain(rows.slice(start,end+1)),count:rows.length};}};
 }};
 ctx.recordMessage=(...args)=>messages.push(args);ctx.failReload=()=>assert.fail('Archive must not reload auth or the workspace');
 run("client=transport;me=actor;organizations=seed.organizations;contacts=seed.contacts;listsLoaded=true;scan();message=recordMessage;render=failReload;load=failReload;run=fn=>fn();let deletionSubmit=null;actionForm=(title,html,submit)=>{deletionSubmit=submit;return document.querySelector('#deleteForm')};");
 run(review?"view='review';reviewQueue()":"view='contacts';profileView()");
 return {ctx,document,data,calls,messages,scrolls,run,content,writes:()=>writes,node:id=>document.querySelector('#'+id),card:id=>document.querySelector(`[data-contact-id="${id}"]`),branch:id=>document.querySelector(`[data-organization-id="${id}"]`),open:(kind,id)=>ctx.openDeleteRecord(kind,id),submit:()=>run('deletionSubmit()')};
}

test('contact archive reads authoritative rows and retains shell, header, filters, equal cards and focus',async()=>{
 const f=fixture(),shell=f.document.querySelector('.client-pages'),header=f.document.querySelector('.account-head'),tabs=f.document.querySelector('.profile-sections'),filters=f.node('contactFilters'),peer=f.card('two'),button=peer.querySelector('[data-edit]');button.focus();await f.open('contact','one');await f.submit();assert.equal(f.writes(),1);assert.equal(f.card('one'),null);assert.equal(f.card('two'),peer);assert.equal(f.document.activeElement,button);assert.equal(f.document.querySelector('.client-pages'),shell);assert.equal(f.document.querySelector('.account-head'),header);assert.equal(f.document.querySelector('.profile-sections'),tabs);assert.equal(f.node('contactFilters'),filters);assert.match(filters.textContent,/All contacts 1/);assert.equal(f.run("contacts.some(row=>row.id==='one')"),false);assert.equal(f.run('listsLoaded'),false);assert.deepEqual(plain(f.calls[0]),{name:'archive_record',args:{p_kind:'contact',p_id:'one'}});assert.equal(f.calls.length,3);assert.equal(f.calls.find(row=>row.table==='contacts').columns,f.run("listColumns.contacts+',deleted_at'"));assert.deepEqual(f.scrolls.at(-1),[5,160]);assert.deepEqual(f.messages.at(-1),['Moved to the recycle bin.']);
});

test('contact review deletion retains search and equal rows, and recalculates membership/counts',async()=>{
 const rows=[person('one','branch',1),person('two','branch',2)].map(row=>({...row,status:'review'})),f=fixture({review:true,rows}),search=f.node('reviewSearch'),peer=f.card('two');search.focus();await f.open('contact','one');await f.submit();assert.equal(f.node('reviewSearch'),search);assert.equal(f.document.activeElement,search);assert.equal(f.card('two'),peer);assert.equal(f.card('one'),null);assert.match(f.node('contactCount').textContent,/1 shown · 1 contacts/);search.oninput({target:{value:'Person1'}});assert.equal(f.card('one'),null);assert.match(f.node('contactCount').textContent,/0 shown · 1 contacts/);
});

test('archive removes duplicate warnings from a related peer without replacing an unrelated row',async()=>{
 const rows=[person('one','branch',1),{...person('two','branch',2),phone:person('one','branch',1).phone},person('four','branch',4)],f=fixture({rows}),peer=f.card('two'),unrelated=f.card('four');assert.match(peer.textContent,/Possible duplicate/);await f.open('contact','one');await f.submit();assert.notEqual(f.card('two'),peer);assert.doesNotMatch(f.card('two').textContent,/Possible duplicate/);assert.equal(f.card('four'),unrelated);
});

test('branch archive on a parent profile uses returned cascade rows and retains equal sibling cards',async()=>{
 const f=fixture({route:'client'}),peer=f.branch('peer'),header=f.document.querySelector('.account-head');f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});f.data.organizations.find(row=>row.id==='branch').deleted_at='2026-10-29T12:00:00Z';f.data.contacts.find(row=>row.id==='one').deleted_at='2026-10-29T12:00:00Z';return {data:null};};await f.open('organization','branch');await f.submit();assert.equal(f.branch('branch'),null);assert.equal(f.branch('peer'),peer);assert.equal(f.document.querySelector('.account-head'),header);assert.match(f.node('profileBranchCount').textContent,/1 branch/);assert.equal(f.run("contacts.some(row=>row.id==='one')"),false);assert.equal(f.run("contacts.some(row=>row.id==='two')"),true,'an active returned contact is retained, not guessed to be part of the cascade');assert.equal(f.run("orgIndex.has('unrelated')"),true);assert.equal(f.writes(),1);
});

test('deleting the displayed branch retains its header and shell with read-only body and All clients',async()=>{
 const f=fixture(),header=f.document.querySelector('.account-head'),shell=f.document.querySelector('.client-pages'),panel=f.node('profile-panel');await f.open('organization','branch');await f.submit();assert.equal(f.writes(),1);assert.equal(f.document.querySelector('.client-pages'),shell);assert.equal(f.document.querySelector('.account-head'),header);assert.equal(f.node('profile-panel'),panel);assert.equal(panel.textContent,'');assert.match(f.node('profileOrganizationName').textContent,/Branch Clinic/);assert.match(f.document.querySelector('.profile-approval').textContent,/Deleted profile/);assert.match(f.document.querySelector('.profile-approval').innerHTML,/class="tag chip chip--neutral">Deleted profile<\/span>/);assert.equal(f.document.querySelector('[data-edit-account]'),null);assert.equal(f.document.querySelector('[data-delete-org]'),null);assert.equal(f.document.querySelector('[data-edit]'),null);assert.match(f.node('profileOrganizationActions').textContent,/All clients/);assert.ok(f.document.querySelectorAll('.profile-sections button').every(button=>button.disabled));
});

test('deleting the displayed client keeps its name and removes branch mutation/navigation region',async()=>{
 const f=fixture({route:'client'}),header=f.document.querySelector('.account-head'),grid=f.node('profileBranches');await f.open('organization','parent');await f.submit();assert.equal(f.document.querySelector('.account-head'),header);assert.equal(f.node('profileBranches'),grid);assert.equal(grid.children.length,0);assert.equal(f.node('profileBranchCount').textContent,'Profile deleted');assert.equal(f.run("orgIndex.has('branch')"),true,'active returned child is not silently treated as deleted');assert.equal(f.node('profileGroupSuggestions').hidden,true);assert.equal(f.writes(),1);
});

test('failed follow-up preserves unrelated rows and presents saved read-only Retry without replaying archive',async()=>{
 const f=fixture(),peer=f.card('two'),from=f.ctx.transport.from;f.ctx.transport.from=table=>{const query=from(table);query.range=async()=>({error:Error('<offline>')});return query;};await f.open('contact','one');await f.submit();assert.equal(f.card('two'),peer);assert.ok(f.card('one'));assert.equal(f.card('one').querySelector('button'),null);assert.ok(peer.querySelector('[data-edit]'));assert.match(f.node('organizationSaveStatus').textContent,/Moved to the recycle bin/);assert.equal(f.node('organizationSaveStatus').querySelector('offline'),null);assert.equal(f.run('listsLoaded'),false);f.ctx.transport.from=from;await f.node('clientArchiveRetry').onclick();assert.equal(f.card('one'),null);assert.equal(f.card('two'),peer);assert.equal(f.calls.filter(row=>row.name==='archive_record').length,1);assert.equal(f.node('clientArchiveRetry'),null);
});

test('an unverified target stays closed with Retry; missing RLS-visible related rows leave the cache',async()=>{
 const f=fixture(),from=f.ctx.transport.from;f.ctx.transport.from=table=>{const query=from(table);if(table==='contacts')query.range=async()=>({data:[],count:0});return query;};await f.open('contact','one');await f.submit();assert.ok(f.card('one'));assert.equal(f.card('one').querySelector('button'),null);assert.match(f.node('organizationSaveStatus').textContent,/archived record could not be verified/);assert.equal(f.run("contacts.some(row=>row.id==='one')"),true);f.ctx.transport.from=from;await f.node('clientArchiveRetry').onclick();assert.equal(f.card('one'),null);
 const hidden=fixture({route:'client'});hidden.ctx.all=async table=>table==='organizations'?hidden.data.organizations.filter(row=>['parent','branch'].includes(row.id)):hidden.data.contacts.filter(row=>['one','two'].includes(row.id));await hidden.open('organization','branch');await hidden.submit();assert.equal(hidden.run("orgIndex.has('peer')"),false);assert.equal(hidden.run("orgIndex.has('unrelated')"),true);
});

test('write failure does not invalidate or remove rows, and permissions are checked again before submission',async()=>{
 const f=fixture(),row=f.card('one');await f.open('contact','one');f.ctx.transport.rpc=async()=>({error:Error('Forbidden')});await assert.rejects(f.submit(),/Forbidden/);assert.equal(f.card('one'),row);assert.equal(f.run('listsLoaded'),true);assert.deepEqual(f.messages,[]);f.ctx.canEditRecords=()=>false;await assert.rejects(f.submit(),/Records permission/);assert.equal(f.calls.length,0);
});

test('old dialog callbacks and late archive receipts cannot act for a replacement actor/session or route',async()=>{
 for(const change of ["me={...me}",'sessionLoadEpoch++',"view='inventory'"]){const f=fixture();await f.open('contact','one');f.run(change);await f.submit();assert.equal(f.calls.length,0);}
 for(const change of ["me={...me}",'sessionLoadEpoch++',"view='inventory'",'organizationSaveContext()'])for(const reject of [false,true]){const f=fixture(),wait=deferred();await f.open('contact','one');f.ctx.transport.rpc=()=>wait.promise;const pending=f.submit();f.run(change);if(reject)wait.reject(Error('Old write error'));else wait.resolve({data:null});await pending;assert.ok(f.card('one'));assert.equal(f.calls.length,0);assert.deepEqual(f.messages,[]);}
});

test('late scoped reads and Retry from an old actor cannot change the replacement cache or page',async()=>{
 for(const change of ["me={...me}",'sessionLoadEpoch++',"view='inventory'",'organizationSaveContext()']){const f=fixture(),wait=deferred(),started=deferred();await f.open('contact','one');f.ctx.all=table=>{started.resolve();return table==='contacts'?wait.promise:Promise.resolve(f.data.organizations.filter(row=>row.id!=='unrelated'));};const pending=f.submit();await started.promise;f.run(change);wait.resolve(f.data.contacts.filter(row=>row.id==='one'));await pending;assert.ok(f.card('one'));assert.equal(f.run("contacts.some(row=>row.id==='one')"),true);assert.deepEqual(f.messages,[]);}
 const f=fixture();await f.open('contact','one');let reads=0;f.ctx.all=async()=>{reads++;throw Error('Offline');};await f.submit();const retry=f.node('clientArchiveRetry'),before=reads;f.run('me={...me}');await retry.onclick();assert.equal(reads,before);
});

test('post-commit rendering failure is retried from scoped reads without replaying the archive',async()=>{
 const f=fixture(),refresh=f.ctx.refreshSavedOrganizationProfile;let fail=true;f.ctx.refreshSavedOrganizationProfile=id=>{if(fail){fail=false;throw Error('Render failure');}return refresh(id);};await f.open('contact','one');await f.submit();assert.match(f.node('organizationSaveStatus').textContent,/Moved to the recycle bin/);assert.equal(f.run("contacts.some(row=>row.id==='one')"),false);await f.node('clientArchiveRetry').onclick();assert.equal(f.card('one'),null);assert.equal(f.calls.filter(row=>row.name==='archive_record').length,1);
});

test('large affected families are completely reread with bounded ID filters and no guessed cascade removals',async()=>{
 const rows=Array.from({length:1007},(_,i)=>person('c'+i,'branch',i+1)),f=fixture({rows});f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});f.data.organizations.find(row=>row.id==='branch').deleted_at='2026-10-29T12:00:00Z';for(const [i,row] of f.data.contacts.entries())if(i%2===0)row.deleted_at='2026-10-29T12:00:00Z';return {data:{}};};await f.open('organization','branch');await f.submit();const reads=f.calls.filter(row=>row.table==='contacts');assert.equal(reads.length,11);assert.ok(reads.every(row=>row.ids.length<=100));assert.equal(new Set(reads.flatMap(row=>[...row.ids])).size,1007);assert.equal(f.run('contacts.length'),503);assert.equal(f.run("contacts.some(row=>row.id==='c1006')"),false);assert.equal(f.run("contacts.some(row=>row.id==='c1005')"),true);assert.equal(f.writes(),1);
});

test('newer list epochs stop old archive reads before they can replace current cached values',async()=>{
 const f=fixture(),wait=deferred(),started=deferred();await f.open('contact','one');f.ctx.all=table=>{if(table==='contacts'){started.resolve();return wait.promise;}return Promise.resolve(f.data.organizations.filter(row=>row.id!=='unrelated'));};const pending=f.submit();await started.promise;f.run("listsEpoch++;orgIndex.get('parent').name='Newer name'");wait.resolve(f.data.contacts.filter(row=>row.id==='one'));await pending;assert.equal(f.run("orgIndex.get('parent').name"),'Newer name');assert.ok(f.card('one'));assert.equal(f.card('one').querySelector('button'),null);assert.match(f.node('organizationSaveStatus').textContent,/Client data changed/);
});

test('archiving an account viewed as its own branch removes dead Back and breadcrumb links',async()=>{
 const f=fixture();f.run("location.hash='#/branch/parent';profileView()");const header=f.document.querySelector('.workspace-page-header');
 assert.equal(f.node('profileOrganizationBack').querySelector('a').getAttribute('href'),'#/client/parent');
 await f.open('organization','parent');await f.submit();
 assert.equal(f.document.querySelector('.workspace-page-header'),header);
 assert.equal(f.node('profileOrganizationBack').querySelector('a').getAttribute('href'),'#/clients');
 assert.deepEqual(f.node('profileBreadcrumb').querySelectorAll('a').map(link=>link.getAttribute('href')),['#/clients']);
 assert.match(f.node('profileBreadcrumb').textContent,/deleted/);
});
