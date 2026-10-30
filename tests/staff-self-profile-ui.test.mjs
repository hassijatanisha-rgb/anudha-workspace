import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../user-settings.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const initial={user_id:'staff',display_name:'Original Name',name_version:2,phone:null,contact_email:'shared@example.com',role:'staff',department:'sales'};
function fixture({get=async()=>({data:{...initial}}),save=async(_name,args)=>({data:{...initial,...args.p_values,name_version:3}})}={}){
 const document=dom();installNativeFormControls(document);document.documentElement={style:{},dataset:{}};
 const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 document.body.innerHTML='<div id="identity"><span class="identity-name">Original Name</span></div><details id="accountMenu"><summary>Account</summary></details><section id="settingsProfile"></section>';
 const section=document.querySelector('#settingsProfile'),header=document.querySelector('.identity-name'),summary=document.querySelector('summary'),calls=[];
 const directory=new Map([['staff',{user_id:'staff',display_name:'Original Name',name_version:2}],['other',{user_id:'other',display_name:'Other person',name_version:4}]]);
 const ctx=vm.createContext({workspacePageHeader,busy:false,sessionLoadEpoch:1,run:fn=>fn(),actionFeedbackShow(){},actionFeedbackReference:node=>node,message(){},me:{user_id:'staff',role:'staff',access:['stock']},view:'settings',employeeDirectory:directory,
  document,window:{},localStorage:{getItem:()=>null},
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';'),roleLabels:{staff:'Staff',owner:'Owner',head:'Department head'},departmentLabel:value=>({sales:'Sales',service:'Service'})[value]||'No department',
  $:selector=>selector==='#identity .identity-name'?header:selector==='#accountMenu > summary'?summary:document.querySelector(selector),
  client:{rpc:(name,args)=>{calls.push({name,args});return name==='get_my_staff_profile'?get():save(name,args)}}});
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),ctx);
 vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);vm.runInContext(source,ctx);
 const form=()=>section.querySelector('form'),start=()=>ctx.loadSettingsProfile(section),send=()=>form().onsubmit({preventDefault(){}});
 const fill=(name='New Name',phone='+255 (712) 345-678',email='SHARED@example.com')=>{form().elements.display_name.value=name;form().elements.phone.value=phone;form().elements.contact_email.value=email;};
 return {ctx,calls,section,document,get form(){return form()},get elements(){return form()?.elements},get status(){return section.querySelector('[data-profile-status]')},get error(){return section.querySelector('[data-profile-error]')},get validation(){return section.querySelector('[data-profile-validation]')},get reload(){return section.querySelector('[data-profile-reload]')},get reloadHelp(){return section.querySelector('[data-profile-reload-help]')},get submit(){return form()?.querySelector('[type="submit"]')},header,summary,directory,start,send,fill,blur:name=>dispatchFocusout(form().elements[name])};
}
test('self profile escapes values, accepts contact email separately, and keeps role/department out of editable controls',()=>{
 const f=fixture(),html=f.ctx.settingsProfileForm({...initial,display_name:'Name " <script>',phone:'" onfocus="bad',contact_email:'a&b@example.com',role:'<owner>'});
 assert.match(html,/Name &#34; &#60;script&#62;/);assert.match(html,/&#34; onfocus=&#34;bad/);assert.match(html,/a&#38;b@example.com/);assert.doesNotMatch(html,/<script>|value="" onfocus/);
 assert.match(html,/name="contact_email" type="email"[^>]*maxlength="254"/);assert.match(html,/shared contact email/);assert.match(html,/personal or shared contact email, or leave it empty; your sign-in stays the same/);
 assert.match(html,/data-profile-role>&#60;owner&#62;/);assert.doesNotMatch(html,/name="(?:role|department|access|user_id|password)"/);
});
test('read-only department shows Not assigned when empty on load and save, and preserves assigned labels',async()=>{
 for(const [department,label] of [['','Not assigned'],['sales','Sales']]){
  const f=fixture({get:async()=>({data:{...initial,department}}),save:async(_name,args)=>({data:{...initial,...args.p_values,name_version:3,department}})});
  await f.start();assert.equal(f.form.querySelector('[data-profile-department]').textContent,label);
  f.fill();await f.send();assert.equal(f.status.textContent,'Profile saved.');assert.equal(f.form.querySelector('[data-profile-department]').textContent,label);
 }
});
test('save sends the exact loaded snapshot and only self-editable fields; confirmation updates the current header without changing the page',async()=>{
 const f=fixture();await f.start();f.fill();f.elements.role={value:'owner'};f.elements.department={value:'management'};
 await f.send();
 assert.deepEqual(plain(f.calls),[{name:'get_my_staff_profile'},{name:'save_my_staff_profile',args:{p_expected_values:{display_name:'Original Name',name_version:2,phone:null,contact_email:'shared@example.com'},p_values:{display_name:'New Name',phone:'+255712345678',contact_email:'shared@example.com'}}}]);
 assert.equal(f.header.textContent,'New Name');assert.equal(f.summary.getAttribute('aria-label'),'Account options for New Name');assert.equal(f.directory.get('staff').display_name,'New Name');assert.equal(f.directory.get('other').display_name,'Other person');
 assert.equal(f.ctx.view,'settings');assert.equal(f.ctx.me.role,'staff');assert.deepEqual(plain(f.ctx.me.access),['stock']);assert.equal(f.status.textContent,'Profile saved.');assert.equal(f.error.textContent,'');assert.equal(f.elements.phone.value,'+255712345678');
 f.fill('Next Name','','');await f.send();
 assert.deepEqual(plain(f.calls[2].args.p_expected_values),{display_name:'New Name',name_version:3,phone:'+255712345678',contact_email:'shared@example.com'});
});
test('profile saving disables controls and rejects duplicate submission while a request is pending',async()=>{
 const wait=deferred(),f=fixture({save:()=>wait.promise});await f.start();f.fill();const saving=f.send();
 assert.equal(f.submit.disabled,true);assert.equal(f.elements.display_name.disabled,true);assert.equal(f.status.textContent,'Saving profile…');
 await f.send();assert.equal(f.calls.filter(call=>call.name==='save_my_staff_profile').length,1);
 wait.resolve({data:{...initial,display_name:'New Name',name_version:3,phone:'+255712345678'}});await saving;
 assert.equal(f.submit.disabled,false);assert.equal(f.elements.display_name.disabled,false);assert.equal(f.status.textContent,'Profile saved.');
});
test('failed or unconfirmed saves retain the draft and previous snapshot, display an inline error, and never announce success',async()=>{
 for(const outcome of [{error:{message:'Profile changed. Reload.'}},{data:null},{data:{...initial,user_id:'other'}},{data:{...initial,display_name:'Wrong value'}},Error('Connection failed')]){
  const f=fixture({save:async()=>{if(outcome instanceof Error)throw outcome;return outcome}});await f.start();f.fill('Draft Name','+255 712345678','new@example.com');await f.send();
  assert.equal(f.elements.display_name.value,'Draft Name');assert.equal(f.elements.phone.value,'+255 712345678');assert.equal(f.elements.contact_email.value,'new@example.com');
  assert.match(f.error.textContent,/not confirmed.*Your edits are still here/);assert.equal(f.status.textContent,'');assert.equal(f.header.textContent,'Original Name');assert.equal(f.submit.disabled,false);assert.equal(f.reload.hidden,false);assert.equal(f.reloadHelp.hidden,false);
  await f.send();assert.deepEqual(plain(f.calls[2].args.p_expected_values),plain(f.calls[1].args.p_expected_values));
 }
});
test('read failures escape server text and offer reload without presenting an editable guessed profile',async()=>{
 let reads=0;const f=fixture({get:async()=>++reads===1?{error:{message:'Unavailable <unsafe>'}}:{data:{...initial}}});await f.start();
 assert.match(f.section.innerHTML,/Unavailable &#60;unsafe&#62;/);assert.match(f.section.innerHTML,/Reload profile/);assert.doesNotMatch(f.section.innerHTML,/<form/);
 await f.reload.onclick();assert.match(f.section.innerHTML,/<form/);assert.equal(f.calls.length,2);
});
test('stale session and detached-page responses cannot populate the profile or update another header/cache',async()=>{
 for(const phase of ['read','save'])for(const replacement of ['same-id-session','other-session','detached','other-view'])for(const rejected of [false,true]){
  const wait=deferred(),f=fixture(phase==='read'?{get:()=>wait.promise}:{save:()=>wait.promise});
  let pending;if(phase==='read')pending=f.start();else{await f.start();f.fill();pending=f.send();}
  if(replacement==='same-id-session')f.ctx.me={user_id:'staff',role:'staff'};
  if(replacement==='other-session')f.ctx.me={user_id:'other',role:'owner'};
  if(replacement==='detached')f.section.remove();
  if(replacement==='other-view')f.ctx.view='personal';
  const before=f.section.innerHTML;
  if(rejected)wait.reject(Error('Old failure'));else wait.resolve({data:{...initial,display_name:'New Name',name_version:3,phone:'+255712345678'}});
  await pending;assert.equal(f.section.innerHTML,before);assert.equal(f.header.textContent,'Original Name');assert.equal(f.directory.get('staff').display_name,'Original Name');assert.equal(f.error?.textContent||'','');
 }
});
test('invalid phone, blank name and invalid browser form block requests; shared email does not require uniqueness',async()=>{
 const f=fixture();await f.start();f.fill('   ');await f.send();assert.match(f.elements.display_name.closest('label').textContent,/full name/);assert.equal(f.validation.textContent,'1 field needs attention');
 f.fill('Name','0712345678');await f.send();assert.match(f.elements.phone.closest('label').textContent,/country code/);assert.equal(f.validation.textContent,'1 field needs attention');
 f.fill();f.elements.contact_email._nativeError='Enter a valid email address.';await f.send();assert.equal(f.calls.length,1);
 f.elements.contact_email._nativeError='';await f.send();assert.equal(f.status.textContent,'Profile saved.');assert.equal(f.calls[1].args.p_values.contact_email,'shared@example.com');
});
test('blur marks only the departed control, preserves entered values and focus, and retains email help',async()=>{
 const f=fixture();await f.start();f.fill('   ','0712345678','bad email');f.elements.contact_email._nativeError='Enter a valid email address.';f.elements.contact_email.focus();f.blur('phone');
 assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.elements.display_name.getAttribute('aria-invalid'),null);assert.equal(f.elements.phone.value,'0712345678');assert.equal(f.document.activeElement,f.elements.contact_email);assert.equal(f.validation.textContent,'');
 f.blur('contact_email');const descriptions=f.elements.contact_email.getAttribute('aria-describedby');assert.match(descriptions,/^settingsContactEmailHelp field-error-/);assert.equal(f.form.querySelectorAll('.field-error').length,2);
 f.elements.contact_email.value='shared@example.com';f.elements.contact_email._nativeError='';f.blur('contact_email');assert.equal(f.elements.contact_email.getAttribute('aria-describedby'),'settingsContactEmailHelp');assert.equal(f.elements.contact_email.getAttribute('aria-invalid'),null);assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.calls.length,1);
});
test('submit reports all invalid fields at the top before focusing the first and makes no write',async()=>{
 const f=fixture();await f.start();f.fill('   ','0712345678','bad email');f.elements.contact_email._nativeError='Enter a valid email address.';let summaryAtFocus;
 const focus=f.elements.display_name.focus;f.elements.display_name.focus=function(options){summaryAtFocus=f.validation.textContent;return focus.call(this,options);};await f.send();
 assert.equal(f.form.noValidate,true);assert.equal(f.form.firstElementChild,f.validation);assert.equal(summaryAtFocus,'3 fields need attention');assert.equal(f.document.activeElement,f.elements.display_name);assert.equal(f.elements.display_name.scrolledIntoView.block,'center');assert.equal(f.calls.length,1);assert.equal(f.elements.display_name.value,'   ');
 f.elements.display_name.value='Ready Name';f.blur('display_name');assert.equal(f.validation.textContent,'2 fields need attention');assert.equal(f.elements.phone.getAttribute('aria-invalid'),'true');assert.match(f.elements.phone.closest('label').textContent,/\(optional\)/);assert.match(f.elements.contact_email.closest('label').textContent,/\(optional\)/);
});
test('blur uses the unchanged normalized phone rule without changing the draft',async()=>{
 const f=fixture();await f.start();
 for(const [value,valid]of [['',true],[' () - ',true],['+12345678',true],['+123456789012345',true],[' +255 (712) 345-678 ',true],['+1234567',false],['+1234567890123456',false],['255712345678',false],['+255.712345678',false]]){
  f.elements.phone.value=value;f.blur('phone');assert.equal(f.elements.phone.getAttribute('aria-invalid')==='true',!valid,value);assert.equal(f.elements.phone.value,value);assert.equal(f.calls.length,1);
 }
});
test('native type, custom and programmatic length errors remain authoritative and escaped',async()=>{
 const f=fixture();await f.start();f.elements.contact_email._nativeError='Enter a valid email address.';f.blur('contact_email');assert.match(f.elements.contact_email.closest('label').textContent,/valid email/);
 f.elements.contact_email._nativeError='';f.elements.contact_email.setCustomValidity('<img src=x>');f.blur('contact_email');assert.equal(f.form.querySelector('img'),null);assert.match(f.elements.contact_email.closest('label').textContent,/<img src=x>/);
 f.elements.contact_email.setCustomValidity('');f.elements.display_name.value='A'.repeat(121);f.elements.phone.value=' '.repeat(25);f.elements.contact_email.value='e'.repeat(255);await f.send();assert.equal(f.validation.textContent,'3 fields need attention');assert.equal(f.calls.length,1);
});
test('correcting fields never clears an unconfirmed-save message or changes its expected snapshot',async()=>{
 const f=fixture({save:async()=>({data:null})});await f.start();f.fill();await f.send();const message=f.error.textContent,expected=plain(f.calls[1].args.p_expected_values);
 f.elements.phone.value='bad';f.blur('phone');await f.send();assert.equal(f.calls.length,2);assert.equal(f.error.textContent,message);assert.equal(f.validation.textContent,'1 field needs attention');
 f.elements.phone.value='+255 712345678';f.blur('phone');assert.equal(f.validation.textContent,'');assert.equal(f.error.textContent,message);assert.equal(f.elements.phone.value,'+255 712345678');await f.send();assert.deepEqual(plain(f.calls[2].args.p_expected_values),expected);
});
test('overlapping reads in one reused profile section ignore older success and failure',async()=>{
 for(const reject of [false,true]){
  const first=deferred(),second=deferred();let reads=0;const f=fixture({get:()=>++reads===1?first.promise:second.promise}),old=f.start(),fresh=f.start();second.resolve({data:{...initial,display_name:'Current read'}});await fresh;const form=f.form;
  if(reject)first.reject(Error('Old error'));else first.resolve({data:{...initial,display_name:'Old read'}});await old;assert.equal(f.form,form);assert.equal(f.elements.display_name.value,'Current read');assert.doesNotMatch(f.section.textContent,/Old error|Old read/);
 }
});
test('a reused section invalidates the old save and its blur/submit closures without touching its replacement',async()=>{
 for(const reject of [false,true]){
  const wait=deferred(),f=fixture({save:()=>wait.promise});await f.start();f.fill();const oldForm=f.form,saving=f.send();await f.start();const current=f.form;
  oldForm.elements.phone.value='bad';dispatchFocusout(oldForm.elements.phone);await oldForm.onsubmit({preventDefault(){}});
  if(reject)wait.reject(Error('Old failure'));else wait.resolve({data:{...initial,display_name:'New Name',name_version:3,phone:'+255712345678'}});await saving;
  assert.notEqual(current,oldForm);assert.equal(f.form,current);assert.equal(f.elements.display_name.value,'Original Name');assert.equal(f.header.textContent,'Original Name');assert.equal(f.directory.get('staff').display_name,'Original Name');assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.error.textContent,'');assert.equal(f.calls.filter(call=>call.name==='save_my_staff_profile').length,1);
 }
});
test('same-actor session epoch changes suppress old read, save and validation callbacks',async()=>{
 for(const phase of ['read','save']){
  const wait=deferred(),f=fixture(phase==='read'?{get:()=>wait.promise}:{save:()=>wait.promise});let pending;
  if(phase==='read')pending=f.start();else {await f.start();f.fill();pending=f.send();}
  f.ctx.sessionLoadEpoch++;const before=f.section.innerHTML;wait.resolve({data:{...initial,display_name:'New Name',name_version:3,phone:'+255712345678'}});await pending;assert.equal(f.section.innerHTML,before);assert.equal(f.header.textContent,'Original Name');
  if(f.form){f.elements.phone.value='bad';f.blur('phone');await f.send();assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.calls.filter(call=>call.name==='save_my_staff_profile').length,1);}
 }
});
