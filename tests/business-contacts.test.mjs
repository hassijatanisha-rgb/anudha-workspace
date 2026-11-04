import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const initial=()=>({id:'old-request',organization_id:'org',version:3,emails:[{value:'office@example.org',purpose:'Reception'}],phones:[{value:'+255 (22) 123-4567',purpose:'Main line'}],website:'https://example.org',physical_address:'Building 1\nMain Road',postal_address:'P.O. Box 100',source_url:'https://example.org/contact',source_checked_on:'2026-11-03',evidence_note:'Checked the official contact page.'});
function fixture({row=initial(),allowed=true}={}){
 const document=dom();installNativeFormControls(document);document.addEventListener=()=>{};
 const calls=[],errors=[],organization={id:'org',name:'Example Hospital',location:'Dar es Salaam'};
 const c=vm.createContext({document,URL,contacts:[],me:{user_id:'owner'},sessionLoadEpoch:1,view:'contacts',location:{hash:'#/branch/org'},busy:false,actionFeedbackEpoch:1,allowed,crypto:{randomUUID:()=> 'request-id'},companyDate:()=> '2026-11-04',recordsLockedText:'Records access required',canEditRecords:()=>c.allowed,
  esc:value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),actionFeedbackReference:node=>({node}),actionFeedbackShow:(_ref,text,_kind,target)=>{target.textContent=text;},actionFeedbackRefuse:(_button,target)=>{target.textContent='Busy';},actionFeedbackRememberDialog(){}});
 const f={c,document,calls,errors,organization,row};
 c.client={rpc:async(name,args)=>{
  calls.push({name,args:plain(args)});
  if(name==='organization_business_contacts')return f.read?f.read(args):{data:f.row?[f.row]:[]};
  assert.equal(name,'save_organization_business_contacts');
  if(f.write)return f.write(args);
  f.row={id:args.p_request_id,organization_id:args.p_organization_id,version:args.p_expected_version+1,...Object.fromEntries(Object.entries(args).filter(([key])=>!['p_request_id','p_organization_id','p_expected_version'].includes(key)).map(([key,value])=>[key.slice(2),value]))};
  return {data:f.row};
 }};
 installWorkspaceDialogFixture(c);
 for(const file of ['client-rules.js','action-forms.js','business-contacts.js'])vm.runInContext(read(file),c);
 c.run=async(fn,options={})=>{try{return await fn();}catch(error){if(options.errorTarget)options.errorTarget.textContent=error.message;else errors.push(error.message);}};
 const host=document.createElement('main');host.innerHTML=c.businessContactSection(organization)+'<section id="namedContacts"><p>Named contact remains here</p></section>';document.body.append(host);
 const root=document.querySelector('#businessContactDetails'),named=document.querySelector('#namedContacts');
 Object.assign(f,{root,named,form:document.querySelector('form'),dialog:document.querySelector('dialog'),get:code=>vm.runInContext(code,c),mount:()=>c.mountBusinessContactDetails(organization),field:name=>f.form.querySelector(`[name="${name}"]`),submit:()=>f.form.events.submit[0].fn({preventDefault(){}}),error:()=>document.querySelector('#actionError').textContent,writes:()=>calls.filter(call=>call.name==='save_organization_business_contacts'),async open(){await f.mount();return c.openBusinessContactEditor(root.businessContactContext);}});
 return f;
}

test('public contact data is escaped and unsafe URLs cannot become active links',()=>{
 const f=fixture(),row=initial();row.emails[0].purpose='<img src=x onerror=alert(1)>';row.physical_address='<script>bad()</script>';row.website='javascript:alert(1)';row.source_url='https://user:password@example.org';row.evidence_note='<b>untrusted</b>';
 const html=f.c.businessContactContent(row);assert.doesNotMatch(html,/<script|<img|<b>|href="javascript:|href="https:\/\/user:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/mailto:office%40example.org/);assert.match(f.c.businessContactContent(initial()),/rel="noopener noreferrer"/);
});

test('contact email disclosure deduplicates only direct active contact emails without reassigning ownership',()=>{
 const f=fixture(),seed=[
  {organization_id:'org',email:' Shared@example.org ',title:'Dr',first_name:'Asha',last_name:'Kato',status:'kept'},
  {organization_id:'org',email:'shared@example.org',first_name:'<img src=x>',status:'pending'},
  {organization_id:'child',email:'child@example.org',first_name:'Branch'},
  {organization_id:'org',email:'incorrect@example.org',status:'incorrect'},
  {organization_id:'org',email:'deleted@example.org',status:'deleted'},
  {organization_id:'org',email:'archived@example.org',deleted_at:'2026-11-04'},
  {organization_id:'org',email:'bad@@example.org'},
  {organization_id:'org',email:'not an email'}
 ];
 f.c.contacts=seed;const before=plain(seed);f.c.refreshBusinessContactEmails();const disclosure=f.root.querySelector('[data-business-person-emails]');
 assert.match(disclosure.textContent,/Emails from contacts \(1\)/);assert.match(disclosure.textContent,/Dr Asha Kato/);assert.match(f.c.businessContactPersonEmailContent('org'),/&lt;img src=x&gt;/);assert.equal(disclosure.querySelectorAll('a').length,1);assert.equal(disclosure.querySelector('img'),null);assert.doesNotMatch(disclosure.textContent,/child@example|incorrect@example|deleted@example|archived@example/);assert.deepEqual(seed,before);assert.equal(f.calls.length,0);
 disclosure.querySelector('details').open=true;f.c.contacts=[];f.c.refreshBusinessContactEmails();assert.equal(disclosure.querySelector('details').open,true);assert.match(disclosure.textContent,/Emails from contacts \(0\)/);
});

test('reopening the editor reads the current version and a failed read does not open stale data',async()=>{
 const f=fixture();await f.mount();f.row={...initial(),version:6,postal_address:'Latest address'};await f.root.querySelector('[data-business-edit]').onclick();assert.equal(f.field('postal_address').value,'Latest address');await f.submit();assert.equal(f.writes()[0].args.p_expected_version,6);
 f.read=async()=>({error:{message:'Offline'}});await f.root.querySelector('[data-business-edit]').onclick();assert.equal(f.dialog.open,false);assert.match(f.root.textContent,/Offline/);
});

test('a confirmed active profile refresh restores the business section after archive-read recovery',async()=>{
 const f=fixture();await f.mount();f.root.inert=true;assert.equal(f.root.businessContactContext.current(),false);f.c.refreshBusinessContactDetails({...f.organization,name:'Updated clinic'});assert.equal(f.root.inert,false);assert.equal(f.root.businessContactContext.current(),true);assert.equal(f.root.businessContactContext.organization.name,'Updated clinic');assert.equal(f.calls.length,1);
});

test('profile read is limited to the selected organization; empty data has a clear add action',async()=>{
 const f=fixture({row:null});assert.equal(f.calls.length,0);await f.mount();assert.deepEqual(f.calls,[{name:'organization_business_contacts',args:{p_organization_id:'org'}}]);assert.match(f.root.textContent,/Add business details/);assert.equal(f.root.querySelector('[data-business-content]').getAttribute('aria-busy'),'false');
});

test('read failure offers a retry without an edit action; stale reads do not replace a newer profile',async()=>{
 const f=fixture();f.read=async()=>({error:{message:'Connection unavailable'}});await f.mount();assert.match(f.root.textContent,/Connection unavailable/);assert.equal(f.root.querySelector('[data-business-edit]'),null);delete f.read;await f.root.querySelector('[data-business-retry]').onclick();assert.match(f.root.textContent,/office@example.org/);
 const wait=deferred();f.read=()=>wait.promise;const pending=f.mount();f.c.location.hash='#/branch/other';wait.resolve({data:[{...initial(),website:'https://stale.example'}]});await pending;assert.doesNotMatch(f.root.textContent,/stale.example/);
});

test('save sends versioned organization data and evidence, preserving named contact DOM',async()=>{
 const f=fixture();await f.open();f.field('emails0Purpose').value='Appointments';f.field('evidence_note').value='Verified official page today.';await f.submit();
 assert.equal(f.writes().length,1);const args=f.writes()[0].args;
 assert.deepEqual(args,{p_request_id:'request-id',p_organization_id:'org',p_expected_version:3,p_emails:[{value:'office@example.org',purpose:'Appointments'}],p_phones:[{value:'+255 (22) 123-4567',purpose:'Main line'}],p_website:'https://example.org',p_physical_address:'Building 1\nMain Road',p_postal_address:'P.O. Box 100',p_source_url:'https://example.org/contact',p_source_checked_on:'2026-11-03',p_evidence_note:'Verified official page today.'});
 assert.equal(f.dialog.open,false);assert.equal(f.document.querySelector('#namedContacts'),f.named);assert.match(f.root.textContent,/Appointments/);assert.match(f.root.textContent,/Business contact details saved/);assert.equal(f.root.businessContactContext.row.version,4);
});

test('multiple purpose-labelled entries can be added and removed, with a 20-entry bound',async()=>{
 const f=fixture({row:null});await f.open();const add=f.form.querySelector('[data-business-add="emails"]');for(let n=0;n<21;n++)add.onclick();assert.equal(f.form.querySelectorAll('[data-business-entry="emails"]').length,20);assert.equal(add.disabled,true);
 f.form.querySelector('[data-business-remove]').onclick();assert.equal(add.disabled,false);assert.equal(f.form.querySelectorAll('[data-business-entry="emails"]').length,19);
});

test('invalid source protocols, phone content, future dates and missing evidence are refused before writes',async()=>{
 const f=fixture();await f.open();f.field('website').value='javascript:alert(1)';f.field('phones0Value').value='Call someone';f.field('source_checked_on').value='2027-01-01';await f.submit();assert.equal(f.writes().length,0);assert.match(f.error(),/highlighted/);assert.equal(f.form.querySelectorAll('.field-error').length,3);
 f.field('website').value='';f.field('phones0Value').value='123';f.field('source_checked_on').value='';f.field('evidence_note').value='';await f.submit();assert.equal(f.writes().length,0);assert.match(f.error(),/field needs attention/);
});

test('URL whitespace and controls are rejected before fields are locked or any write is sent',async()=>{
 for(const url of ['https://example.org/a b','https://example.org/a\tb','https://example.org/a\u007fb']){
  const f=fixture();await f.open();f.field('website').value=url;await f.submit();assert.equal(f.writes().length,0);assert.equal(f.field('website').disabled,false);assert.match(f.error(),/highlighted/);
 }
});

test('records permission and navigation/actor guards prevent stale writes',async()=>{
 const locked=fixture({allowed:false});await locked.mount();assert.equal(locked.root.querySelector('[data-business-edit]'),null);assert.throws(()=>locked.c.openBusinessContactEditor(locked.root.businessContactContext),/Records access/);
 for(const stale of ['route','actor','permission','archived']){const f=fixture();await f.open();if(stale==='route')f.c.location.hash='#/branch/other';if(stale==='actor')f.c.me={user_id:'other'};if(stale==='permission')f.c.allowed=false;if(stale==='archived')f.root.inert=true;await f.submit();assert.equal(f.writes().length,0);}
});

test('uncertain retry retains request ID and exact payload and rejects edited retry content',async()=>{
 const f=fixture();await f.open();f.write=async()=>{throw Error('Network lost');};await f.submit();assert.match(f.error(),/Save not confirmed/);const first=f.writes()[0].args;
 assert.ok(f.form.querySelector('.business-contact-editor').querySelectorAll('input,textarea,button').every(control=>control.disabled));assert.equal(f.document.querySelector('#actionCancel').disabled,false);
 f.field('postal_address').value='Changed';await f.submit();assert.equal(f.writes().length,1);assert.match(f.error(),/previous save was not confirmed/);
 f.field('postal_address').value='P.O. Box 100';delete f.write;await f.submit();assert.equal(f.writes().length,2);assert.deepEqual(f.writes()[1].args,first);assert.equal(f.dialog.open,false);
});

test('an idempotent retry displays a newer revision instead of the original committed receipt',async()=>{
 const f=fixture();await f.open();const receipt={...initial(),id:'request-id',version:4};let insertions=0;
 f.write=async()=>{if(!insertions){insertions++;throw Error('Response lost after commit');}return {data:receipt};};
 await f.submit();f.row={...receipt,id:'another-request',version:5,postal_address:'Newer confirmed address'};await f.submit();
 assert.equal(insertions,1);assert.equal(f.writes().length,2);assert.deepEqual(f.writes()[1].args,f.writes()[0].args);assert.equal(f.root.businessContactContext.row.version,5);assert.match(f.root.textContent,/Newer confirmed address/);assert.match(f.root.textContent,/Showing the latest revision/);assert.equal(f.dialog.open,false);
});

test('version conflict leaves the editor open and never applies an optimistic local replacement',async()=>{
 const f=fixture();await f.open();f.write=async()=>({error:{message:'Business contact details changed; refresh before saving'}});f.field('postal_address').value='New address';await f.submit();assert.equal(f.dialog.open,true);assert.equal(f.root.businessContactContext.row.postal_address,'P.O. Box 100');assert.match(f.error(),/Close and reopen to compare/);
});

test('confirmed write followed by failed receipt verification retries only the read',async()=>{
 const f=fixture();await f.open();const saved={...initial(),id:'request-id',version:4};f.write=async()=>({data:{id:'request-id'}});f.read=async()=>({error:{message:'Offline'}});await f.submit();assert.equal(f.writes().length,1);assert.match(f.error(),/were saved/);assert.equal(f.dialog.open,true);
 assert.ok(f.form.querySelector('.business-contact-editor').querySelectorAll('input,textarea,button').every(control=>control.disabled));assert.equal(f.document.querySelector('#actionCancel').disabled,false);assert.equal(f.form.querySelector('[type="submit"]').textContent,'Retry saved details');
 f.read=async()=>({data:[saved]});await f.submit();assert.equal(f.writes().length,1);assert.equal(f.dialog.open,false);assert.equal(f.root.businessContactContext.row.version,4);
});

test('business detail fields and entry actions lock during the RPC and stay locked after an uncertain response',async()=>{
 const f=fixture();await f.open();const wait=deferred();f.write=()=>wait.promise;const pending=f.submit(),editor=f.form.querySelector('.business-contact-editor'),before=f.form.querySelectorAll('[data-business-entry]').length;
 assert.ok(editor.querySelectorAll('input,textarea,button').every(control=>control.disabled));assert.equal(f.document.querySelector('#actionCancel').disabled,true);f.form.querySelector('[data-business-add="emails"]').onclick();f.form.querySelector('[data-business-remove]').onclick();assert.equal(f.form.querySelectorAll('[data-business-entry]').length,before);
 wait.resolve({error:{message:'Connection lost before confirmation'}});await pending;assert.equal(f.dialog.open,true);assert.ok(editor.querySelectorAll('input,textarea,button').every(control=>control.disabled));assert.equal(f.document.querySelector('#actionCancel').disabled,false);assert.equal(f.writes().length,1);
});

test('a confirmed save with an incomplete receipt accepts a newer current revision on read recovery',async()=>{
 const f=fixture();await f.open();f.write=async()=>({data:null});f.read=async()=>({data:[{...initial(),id:'another-request',version:5,postal_address:'Latest version'}]});await f.submit();assert.equal(f.writes().length,1);assert.equal(f.root.businessContactContext.row.version,5);assert.equal(f.dialog.open,false);
});

test('new records can keep unknown fields blank and existing shared-dialog duplicate-submit lock applies',async()=>{
 const f=fixture({row:null});await f.open();f.field('evidence_note').value='No public contact details found on the checked website.';const wait=deferred();f.write=()=>wait.promise;const pending=f.submit();await f.submit();assert.equal(f.writes().length,1);const args=f.writes()[0].args;assert.equal(args.p_expected_version,0);assert.deepEqual(args.p_emails,[]);assert.deepEqual(args.p_phones,[]);assert.equal(args.p_source_checked_on,null);
 wait.resolve({data:{...initial(),id:'request-id',version:1,emails:[],phones:[],website:'',physical_address:'',postal_address:'',source_url:'',source_checked_on:null,evidence_note:args.p_evidence_note}});await pending;assert.equal(f.dialog.open,false);
});

test('source integration remains lazy on both client and branch profiles',()=>{
 const source=read('client-profile-pages.js'),index=read('index.src.html');assert.match(source,/businessContactSection\(o\)/);for(const name of ['profileParent','profileBranch'])assert.match(source.slice(source.indexOf(`function ${name}(`)).split('\n}')[0],/mountBusinessContactDetails\(o\)/);assert.match(index,/src="business-contacts\.js"/);assert.match(index,/href="business-contacts\.css"/);
});
