import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../user-settings.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const initial={user_id:'staff',display_name:'Original Name',name_version:2,phone:null,contact_email:'shared@example.com',role:'staff',department:'sales'};
function fixture({get=async()=>({data:{...initial}}),save=async(_name,args)=>({data:{...initial,...args.p_values,name_version:3}})}={}){
 const calls=[],status={textContent:''},error={textContent:''},role={textContent:'Staff'},department={textContent:'Sales'},reloadHelp={hidden:true},reload={hidden:true,disabled:false},submit={disabled:false};
 const elements=Object.fromEntries(['display_name','phone','contact_email'].map(key=>[key,{value:'',disabled:false}]));
 const map={'[data-profile-status]':status,'[data-profile-error]':error,'[data-profile-role]':role,'[data-profile-department]':department,'[data-profile-reload]':reload,'[data-profile-reload-help]':reloadHelp};
 const form={elements,valid:true,reportValidity(){return this.valid},querySelector:selector=>map[selector],querySelectorAll:()=>[...Object.values(elements),submit,reload]};
 let html='';
 const section={isConnected:true,querySelector:selector=>selector==='form'?form:map[selector],set innerHTML(value){html=value;if(value.includes('<form'))for(const key of Object.keys(elements)){const raw=value.match(new RegExp('name="'+key+'"[^>]*value="([^"]*)"'))?.[1]||'';elements[key].value=raw.replace(/&#(\d+);/g,(_all,n)=>String.fromCharCode(Number(n)));}},get innerHTML(){return html}};
 const header={textContent:'Original Name'},summary={attributes:{},setAttribute(key,value){this.attributes[key]=value}};
 const directory=new Map([['staff',{user_id:'staff',display_name:'Original Name',name_version:2}],['other',{user_id:'other',display_name:'Other person',name_version:4}]]);
 const ctx=vm.createContext({me:{user_id:'staff',role:'staff',access:['stock']},view:'settings',employeeDirectory:directory,
  document:{documentElement:{style:{},dataset:{}}},localStorage:{getItem:()=>null},
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';'),roleLabels:{staff:'Staff',owner:'Owner',head:'Department head'},departmentLabel:value=>({sales:'Sales',service:'Service'})[value]||'No department',
  $:selector=>selector==='#identity .identity-name'?header:selector==='#accountMenu > summary'?summary:null,
  client:{rpc:(name,args)=>{calls.push({name,args});return name==='get_my_staff_profile'?get():save(name,args)}}});
 vm.runInContext(source,ctx);
 const start=()=>ctx.loadSettingsProfile(section),send=()=>form.onsubmit({preventDefault(){}});
 const fill=(name='New Name',phone='+255 (712) 345-678',email='SHARED@example.com')=>{elements.display_name.value=name;elements.phone.value=phone;elements.contact_email.value=email;};
 return {ctx,calls,section,form,elements,status,error,reload,reloadHelp,submit,header,summary,directory,start,send,fill};
}
test('self profile escapes values, accepts contact email separately, and keeps role/department out of editable controls',()=>{
 const f=fixture(),html=f.ctx.settingsProfileForm({...initial,display_name:'Name " <script>',phone:'" onfocus="bad',contact_email:'a&b@example.com',role:'<owner>'});
 assert.match(html,/Name &#34; &#60;script&#62;/);assert.match(html,/&#34; onfocus=&#34;bad/);assert.match(html,/a&#38;b@example.com/);assert.doesNotMatch(html,/<script>|value="" onfocus/);
 assert.match(html,/name="contact_email" type="email"[^>]*maxlength="254"/);assert.match(html,/shared department email/);assert.match(html,/This email is for contact details\. Your sign-in stays the same/);
 assert.match(html,/data-profile-role>&#60;owner&#62;/);assert.doesNotMatch(html,/name="(?:role|department|access|user_id|password)"/);
});
test('read-only department shows Not assigned when empty on load and save, and preserves assigned labels',async()=>{
 for(const [department,label] of [['','Not assigned'],['sales','Sales']]){
  const f=fixture({get:async()=>({data:{...initial,department}}),save:async(_name,args)=>({data:{...initial,...args.p_values,name_version:3,department}})});
  await f.start();assert.match(f.section.innerHTML,new RegExp('data-profile-department>'+label+'</strong>'));
  f.fill();await f.send();assert.equal(f.status.textContent,'Profile saved.');assert.equal(f.form.querySelector('[data-profile-department]').textContent,label);
 }
});
test('save sends the exact loaded snapshot and only self-editable fields; confirmation updates the current header without changing the page',async()=>{
 const f=fixture();await f.start();f.fill();f.elements.role={value:'owner'};f.elements.department={value:'management'};
 await f.send();
 assert.deepEqual(plain(f.calls),[{name:'get_my_staff_profile'},{name:'save_my_staff_profile',args:{p_expected_values:{display_name:'Original Name',name_version:2,phone:null,contact_email:'shared@example.com'},p_values:{display_name:'New Name',phone:'+255712345678',contact_email:'shared@example.com'}}}]);
 assert.equal(f.header.textContent,'New Name');assert.equal(f.summary.attributes['aria-label'],'Account options for New Name');assert.equal(f.directory.get('staff').display_name,'New Name');assert.equal(f.directory.get('other').display_name,'Other person');
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
  if(replacement==='detached')f.section.isConnected=false;
  if(replacement==='other-view')f.ctx.view='personal';
  const before=f.section.innerHTML;
  if(rejected)wait.reject(Error('Old failure'));else wait.resolve({data:{...initial,display_name:'New Name',name_version:3,phone:'+255712345678'}});
  await pending;assert.equal(f.section.innerHTML,before);assert.equal(f.header.textContent,'Original Name');assert.equal(f.directory.get('staff').display_name,'Original Name');assert.equal(f.error.textContent,'');
 }
});
test('invalid phone, blank name and invalid browser form block requests; shared email does not require uniqueness',async()=>{
 const f=fixture();await f.start();f.fill('   ');await f.send();assert.match(f.error.textContent,/full name/);
 f.fill('Name','0712345678');await f.send();assert.match(f.error.textContent,/country code/);
 f.fill();f.form.valid=false;await f.send();assert.equal(f.calls.length,1);
 f.form.valid=true;await f.send();assert.equal(f.status.textContent,'Profile saved.');assert.equal(f.calls[1].args.p_values.contact_email,'shared@example.com');
});
