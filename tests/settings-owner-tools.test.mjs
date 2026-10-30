import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function fixture(role='owner'){
 const document=dom();document.documentElement={style:{},dataset:{}};document.body.innerHTML='<main id="content"></main>';
 const calls=[],forms=[],messages=[],policy={id:true,head_limit_basis_points:1500,version:3,updated_by:'owner',updated_at:'2026-10-29T08:00:00Z'};
 let readHook,writeHook,loading;
 const c=vm.createContext({workspacePageHeader,document,window:{scrollX:4,scrollY:500},localStorage:{getItem:()=>null},me:{user_id:'owner',role},view:'settings',syncWorkspaceNavigation(){},$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),run:(fn,options)=>fn(),message:(...args)=>messages.push(args),actionForm:(title,fields,save)=>forms.push({title,fields,save}),client:{
  from(table){const call={table};calls.push(call);return {select(columns){call.columns=columns;return this;},async maybeSingle(){call.single=true;return readHook?readHook():{data:{...policy}};}};},
  async rpc(name,args){calls.push({name,args:JSON.parse(JSON.stringify(args))});if(writeHook)return writeHook(args);Object.assign(policy,{version:policy.version+1,head_limit_basis_points:args.p_head_limit_basis_points});return {data:{...policy}};}
 }});
 vm.runInContext('function workspaceSkeleton(kind,label)'+read('workspace-refresh.js').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],c);
 vm.runInContext(read('accounting-ledger.js').slice(read('accounting-ledger.js').indexOf('function booksCutoverChecklist(){'),read('accounting-ledger.js').indexOf('async function booksOverview(')),c);
 vm.runInContext(read('discount-approval.js')+'\n'+read('user-settings.js'),c);
 c.loadSettingsProfile=section=>{section.innerHTML='<input id="profileDraft" value="Unsaved name"><details id="profileDetails" open><summary>Profile details</summary></details>';};
 const load=c.loadSettingsDiscountPolicy;c.loadSettingsDiscountPolicy=(...args)=>(loading=load(...args));
 return {c,document,calls,forms,messages,policy,node:selector=>document.querySelector(selector),get:code=>vm.runInContext(code,c),async start(){c.settingsWorkspace();await loading;},setRead:fn=>readHook=fn,setWrite:fn=>writeHook=fn,load:()=>c.loadSettingsDiscountPolicy(document.querySelector('#settingsDiscountPolicy')),save:values=>forms.at(-1).save(values)};
}

test('only owner Settings renders the policy and cutover tools, with exactly one declared policy read',async()=>{
 const f=fixture();await f.start();assert.ok(f.node('#settingsOwnerTools'));assert.ok(f.node('#settingsDiscountPolicy'));assert.match(f.node('#settingsOwnerTools').textContent,/Opening books and stock/);
 assert.deepEqual(f.calls,[{table:'discount_policy',columns:'id,head_limit_basis_points,version,updated_by,updated_at',single:true}]);assert.equal(f.node('[data-discount-limit-value]').textContent,'15%');
 const connections=f.node('.connection-list').closest('details');assert.equal(connections.open,false);assert.equal(f.node('.connection-list').querySelectorAll('li').length,4);assert.match(connections.textContent,/No emails are sent yet|No messages are sent/);
 f.c.view='sales';assert.equal(f.c.discountPolicyHtml(),'');f.c.openDiscountLimit();assert.equal(f.forms.length,0);
 for(const role of ['head','staff']){const other=fixture(role);await other.start();assert.equal(other.node('#settingsOwnerTools'),null);assert.equal(other.calls.length,0);other.c.openDiscountLimit();assert.equal(other.forms.length,0);}
});

test('failed or malformed policy reads expose only read-only recovery and never a cached editor',async()=>{
 for(const response of [{error:{message:'Denied <img>'}},{data:null},{data:{id:true,version:0,head_limit_basis_points:null}},{data:{id:true,version:3,head_limit_basis_points:0}}]){
  const f=fixture();f.setRead(()=>response);await f.start();assert.equal(f.node('[data-discount-limit]'),null);assert.ok(f.node('#settingsDiscountPolicy [role="alert"]'));assert.equal(f.node('img'),null);f.c.openDiscountLimit();assert.equal(f.forms.length,0);
  f.setRead(null);await f.node('#settingsDiscountPolicy button').onclick();assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.table==='discount_policy'));assert.equal(f.node('[data-discount-limit]').disabled,false);
 }
});

test('late owner-policy reads cannot populate another actor, role, route, detached pane or newer request',async()=>{
 for(const mode of ['actor','role','route','detach','request'])for(const failure of [false,true]){
  const f=fixture(),wait=deferred();f.setRead(()=>wait.promise);const pending=f.start(),section=f.node('#settingsDiscountPolicy');
  if(mode==='actor')f.c.me={...f.c.me};if(mode==='role')f.c.me.role='staff';if(mode==='route')f.c.view='sales';if(mode==='detach')section.remove();if(mode==='request')f.get('discountSettingsRequest++');
  const before=section.innerHTML;if(failure)wait.reject(Error('Old response'));else wait.resolve({data:f.policy});await pending;assert.equal(section.innerHTML,before);assert.equal(f.get('discountPolicy'),null);assert.equal(f.messages.length,0);
 }
});

test('a confirmed policy save retains the Settings shell, profile edits, disclosures and policy control',async()=>{
 const f=fixture();await f.start();const root=f.node('#content'),section=f.node('#settingsOwnerTools'),button=f.node('[data-discount-limit]'),value=f.node('[data-discount-limit-value]'),profile=f.node('#profileDraft'),details=f.node('#profileDetails');profile.value='Keep my unsaved name';profile.focus();button.onclick();
 await f.save({limit:'12.25'});assert.equal(f.node('#content'),root);assert.equal(f.node('#settingsOwnerTools'),section);assert.equal(f.node('[data-discount-limit]'),button);assert.equal(f.node('[data-discount-limit-value]'),value);assert.equal(value.textContent,'12.25%');assert.equal(button.disabled,false);assert.equal(f.node('#profileDraft'),profile);assert.equal(profile.value,'Keep my unsaved name');assert.equal(details.open,true);assert.equal(f.document.activeElement,profile);
 assert.deepEqual(f.calls[1],{name:'set_discount_policy',args:{p_expected_version:3,p_head_limit_basis_points:1225}});assert.equal(f.calls.length,3);assert.equal(f.calls[2].table,'discount_policy');assert.equal(f.c.window.scrollY,500);assert.equal(f.messages.at(-1)[0],'Discount limit saved.');
});

test('policy refusal and invalid input retain the original policy without a follow-up read or success',async()=>{
 const f=fixture();await f.start();f.node('[data-discount-limit]').onclick();const old=f.node('[data-discount-limit-value]');
 for(const limit of ['-1','101','not-a-number'])await assert.rejects(f.save({limit}),/Enter a limit/);assert.equal(f.calls.length,1);
 f.setWrite(()=>({error:{code:'P0001',message:'Discount limit changed; refresh'}}));await assert.rejects(f.save({limit:'12'}),error=>error.code==='P0001'&&error.message==='Discount limit changed; refresh');assert.equal(f.calls.length,2);assert.equal(f.node('[data-discount-limit-value]'),old);assert.equal(old.textContent,'15%');assert.equal(f.messages.length,0);
});

test('saved policy remains visible and locked after failed or stale reread; Retry only reads',async()=>{
 for(const stale of [false,true]){
  const f=fixture();await f.start();const button=f.node('[data-discount-limit]');button.onclick();f.setRead(()=>stale?{data:{...f.policy,version:3,head_limit_basis_points:1500}}:{error:{message:'Offline'}});await f.save({limit:'12'});
  assert.equal(f.node('[data-discount-limit-value]').textContent,'12%');assert.equal(button.disabled,true);assert.match(f.node('#settingsDiscountPolicy [role="alert"]').textContent,/Discount limit saved.*could not refresh/);f.c.openDiscountLimit();assert.equal(f.forms.length,1);
  f.setRead(null);await f.node('#settingsDiscountPolicy [role="alert"]').querySelector('button').onclick();assert.equal(f.node('[data-discount-limit]'),button);assert.equal(button.disabled,false);assert.equal(f.calls.filter(call=>call.name).length,1);assert.equal(f.node('[data-discount-limit-value]').textContent,'12%');
 }
});

test('an owner change after opening the editor refuses saving before the versioned write',async()=>{
 for(const mode of ['actor','role','route','request','detach']){
  const f=fixture();await f.start();f.node('[data-discount-limit]').onclick();if(mode==='actor')f.c.me={...f.c.me};if(mode==='role')f.c.me.role='staff';if(mode==='route')f.c.view='sales';if(mode==='request')f.get('discountSettingsRequest++');if(mode==='detach')f.node('#settingsDiscountPolicy').remove();
  await assert.rejects(f.save({limit:'12'}),/Reopen the discount limit/);assert.equal(f.calls.length,1);
 }
});

test('clearing the policy preserves the null argument and its owner-required meaning',async()=>{
 const f=fixture();await f.start();f.node('[data-discount-limit]').onclick();await f.save({limit:''});assert.equal(f.calls[1].args.p_head_limit_basis_points,null);assert.match(f.node('[data-discount-limit-value]').textContent,/not set: every discount needs you/);
});
