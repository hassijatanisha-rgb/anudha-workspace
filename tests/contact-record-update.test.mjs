import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source,plain} from './helpers/client-directory-fixture.mjs';
import {contactDom} from './helpers/contact-dom-fixture.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const contact=(id='one',n=1)=>({id,organization_id:'branch',title:'Mr.',first_name:'Person'+n,last_name:'Contact',position:'Lab',phone_country:'TZ',country_code:'+255',phone:'71'+String(n).padStart(7,'0'),email:'',status:'kept',reason:'',revision:3});
function fixture({review=false,rows=[contact(),contact('two',2),contact('three',3)]}={}){
 const document=contactDom(),events={};document.addEventListener=(name,fn)=>(events[name]??=[]).push(fn);document.getElementById=id=>document.querySelector('#'+id);
 document.body.innerHTML='<main id="content"></main><dialog id="editor"><form id="editForm"><div id="fields"></div><p id="formError"></p><button id="closeEditor">Close</button></form></dialog><p id="notice"></p>';
 const content=document.querySelector('#content'),descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');let writes=0;
 Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:value=>{writes++;descriptor.set.call(content,value);}});
 const calls=[],messages=[],scrolls=[],actor={user_id:'actor',role:'owner'},ctx=vm.createContext({workspacePageHeader,statusTone,document,console,Intl,Map,Set,setTimeout,clearTimeout,location:{hash:review?'#/clients':'#/branch/branch'},window:{addEventListener(){},scrollX:3,scrollY:120,scrollTo:(...args)=>scrolls.push(args)},
  canEditRecords:()=>true,recordsLockedNote:()=>'',crypto:globalThis.crypto,syncWorkspaceNavigation(){},renderSearchPreservingPosition:(_,fn)=>fn(),actor,seed:rows});
 for(const file of ['phone-rules.js','client-rules.js','client-profile-pages.js'])vm.runInContext(source(file),ctx);
 vm.runInContext(source('app.js').split('\n').filter(line=>!line.startsWith('(async()=>{const cfg=')).join('\n'),ctx);
 const run=code=>vm.runInContext(code,ctx);
 ctx.transport={rpc:async(name,args)=>{calls.push({name,args});return {data:{...rows.find(row=>row.id===args.p_id),...args.p_values,id:args.p_id,revision:args.p_revision+1}};},from:()=>{calls.push({read:'contact'});return {select(){return this;},eq(){return this;},is(){return this;},single:async()=>({error:Error('Saved read unavailable')})};}};
 ctx.recordMessage=(...args)=>messages.push(args);ctx.noRender=()=>assert.fail('A contact save must not replace the workspace');
 run("client=transport;me=actor;organizations=[{id:'branch',name:'Fixture Clinic',location:'Arusha',type:'Clinic',approval_status:'approved',parent_id:null},{id:'other',name:'Other Clinic',location:'Mwanza',type:'Clinic',approval_status:'approved',parent_id:null}];contacts=seed;listsLoaded=true;scan();message=recordMessage;render=noRender;run=fn=>fn();");
 run(review?"view='review';reviewQueue()":"view='contacts';profileView()");
 return {ctx,document,content,calls,messages,scrolls,run,rows,actor,writes:()=>writes,node:id=>document.querySelector('#'+id),card:id=>document.querySelector(`[data-contact-id="${id}"]`),save:values=>ctx.save({...rows[0],...values})};
}

test('one confirmed contact update retains equal cards, shell, filters, focus, dialog and scroll without another read',async()=>{
 const f=fixture(),unchanged=f.card('two'),third=f.card('three'),heading=f.document.querySelector('.account-head'),tabs=f.document.querySelector('.profile-sections'),filters=f.node('contactFilters'),paging=f.node('contactPaging'),button=unchanged.querySelector('[data-edit]');button.focus();f.node('editor').showModal();
 await f.save({position:'Procurement'});
 assert.equal(f.writes(),1);assert.equal(f.card('two'),unchanged);assert.equal(f.card('three'),third);assert.equal(f.document.querySelector('.account-head'),heading);assert.equal(f.document.querySelector('.profile-sections'),tabs);assert.equal(f.node('contactFilters'),filters);assert.equal(f.node('contactPaging'),paging);assert.equal(f.document.activeElement,button);assert.equal(f.node('editor').open,true);
 assert.match(f.card('one').textContent,/Procurement/);assert.equal(f.run("contacts.find(row=>row.id==='one').revision"),4);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'save_contact');assert.equal(f.calls[0].args.p_revision,3);assert.equal(f.calls[0].args.p_values.position,'Procurement');assert.deepEqual(f.scrolls.at(-1),[3,120]);assert.deepEqual(f.messages.at(-1),['Contact saved.']);
});

test('changing duplicate phone refreshes its peer and counts while an unrelated card stays identical',async()=>{
 const rows=[contact(),{...contact('two',2),phone:contact().phone},contact('three',3)],f=fixture({rows}),oldPeer=f.card('two'),unrelated=f.card('three');
 assert.match(oldPeer.textContent,/Possible duplicate/);await f.save({phone:'799999999'});assert.notEqual(f.card('two'),oldPeer);assert.doesNotMatch(f.card('two').textContent,/Possible duplicate/);assert.equal(f.card('three'),unrelated);assert.match(f.node('contactFilters').textContent,/Needs fixing 0/);assert.equal(f.writes(),1);
});

test('review completion removes only the completed card and updates exact counts without replacing search',async()=>{
 const rows=[contact(),contact('two',2),contact('three',3)].map(row=>({...row,status:'review'})),f=fixture({review:true,rows}),search=f.node('reviewSearch'),peer=f.card('two');search.focus();
 await f.save({status:'kept'});assert.equal(f.card('one'),null);assert.equal(f.card('two'),peer);assert.equal(f.node('reviewSearch'),search);assert.equal(f.document.activeElement,search);assert.match(f.node('contactCount').textContent,/2 shown · 2 contacts/);assert.equal(f.writes(),1);assert.equal(f.run('clientDirectoryData'),null);
 search.oninput({target:{value:'Person1'}});assert.equal(f.card('one'),null);assert.match(f.node('contactCount').textContent,/0 shown · 2 contacts/);
});

test('moving a contact updates branch membership/count and invalidates both branch approvals',async()=>{
 const f=fixture(),peer=f.card('two');await f.save({organization_id:'other'});assert.equal(f.card('one'),null);assert.equal(f.card('two'),peer);assert.match(f.node('contactFilters').textContent,/All contacts 2/);assert.equal(f.run("orgIndex.get('branch').approval_status"),'review');assert.equal(f.run("orgIndex.get('other').approval_status"),'review');assert.equal(f.writes(),1);
});

test('last review-page removal clamps only contact results and pagination to the previous page',async()=>{
 const rows=Array.from({length:61},(_,i)=>({...contact('c'+i,i+1),status:'review'})),f=fixture({review:true,rows});f.run('page=2;reviewQueue()');const search=f.node('reviewSearch'),last=f.node('contactResults').querySelector('[data-contact-id]');
 const row=rows.find(item=>item.id===last.dataset.contactId);await f.ctx.save({...row,status:'kept'});assert.equal(f.run('page'),1);assert.equal(f.node('contactResults').querySelectorAll('[data-contact-id]').length,30);assert.equal(f.node('reviewSearch'),search);assert.match(f.node('contactPaging').textContent,/Page 2 of 2/);assert.equal(f.writes(),2);
});

test('write errors leave the old card and cache intact; late actor/session receipts cannot alter either',async()=>{
 const failed=fixture(),old=failed.card('one');failed.ctx.transport.rpc=async()=>({error:Error('Version changed')});await assert.rejects(failed.save({position:'New'}),/Version changed/);assert.equal(failed.card('one'),old);assert.equal(failed.run('contacts[0].revision'),3);
 for(const change of ["me={...me}",'sessionLoadEpoch++']){const f=fixture(),wait=deferred(),card=f.card('one');f.ctx.transport.rpc=()=>wait.promise;const saving=f.save({position:'New'});f.run(change);wait.resolve({data:{...contact(),position:'New',revision:4}});await saving;assert.equal(f.card('one'),card);assert.equal(f.run('contacts[0].revision'),3);assert.deepEqual(f.messages,[]);}
});

test('navigation during a confirmed save updates only its actor cache without replacing the new route',async()=>{
 const f=fixture(),wait=deferred();f.ctx.transport.rpc=()=>wait.promise;const saving=f.save({position:'New'});f.run("view='inventory'");f.content.innerHTML='<h1>New route</h1>';wait.resolve({data:{...contact(),position:'New',revision:4}});await saving;assert.equal(f.content.textContent,'New route');assert.equal(f.run('contacts[0].revision'),4);assert.deepEqual(f.messages,[]);
});

test('confirmed save with missing receipt and failed scoped read shows Saved plus read-only Retry, never replays write',async()=>{
 const f=fixture();f.ctx.transport.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{}};};await f.save({position:'New'});assert.match(f.node('contactResults').textContent,/Contact saved/);assert.equal(f.node('contactResults').querySelector('[data-edit]'),null);assert.equal(f.run('listsLoaded'),false);assert.equal(f.calls.filter(row=>row.name==='save_contact').length,1);
 f.ctx.transport.from=()=>{f.calls.push({read:'contact'});return {select(){return this;},eq(){return this;},is(){return this;},single:async()=>({data:{...contact(),position:'New',revision:4}})};};
 await f.node('contactSaveRetry').onclick();assert.match(f.card('one').textContent,/New/);assert.equal(f.calls.filter(row=>row.name==='save_contact').length,1);assert.equal(f.calls.filter(row=>row.read).length,2);assert.deepEqual(f.messages.at(-1),['Contact saved.']);
});

test('a local refresh failure after a valid receipt retries from confirmed cache without any read/write replay',async()=>{
 const f=fixture(),create=f.document.createElement;let fail=true;f.document.createElement=tag=>{if(fail&&tag==='template'){fail=false;throw Error('Fixture render failure');}return create(tag);};await f.save({position:'New'});assert.equal(f.run('contacts[0].revision'),4);assert.match(f.node('contactResults').textContent,/Contact saved/);await f.node('contactSaveRetry').onclick();assert.match(f.card('one').textContent,/New/);assert.equal(f.calls.length,1);
});

test('a newer confirmed cache revision is never replaced by an older completed save receipt',async()=>{
 const f=fixture(),wait=deferred();f.ctx.transport.rpc=()=>wait.promise;const saving=f.save({position:'Earlier edit'});f.run("contacts[0]={...contacts[0],revision:5,position:'Later confirmed edit'}");wait.resolve({data:{...contact(),position:'Earlier edit',revision:4}});await saving;assert.equal(f.run('contacts[0].revision'),5);assert.match(f.card('one').textContent,/Later confirmed edit/);assert.doesNotMatch(f.card('one').textContent,/Earlier edit/);
});

test('a Retry left behind by an old actor cannot read or mutate the replacement session',async()=>{
 const f=fixture();f.ctx.transport.rpc=async()=>({data:{}});await f.save({position:'New'});const retry=f.node('contactSaveRetry'),reads=f.calls.length;f.run("me={...me}");await retry.onclick();assert.equal(f.calls.length,reads);assert.equal(f.run('contacts[0].revision'),3);
});
