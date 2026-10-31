import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};};
const flush=()=>new Promise(setImmediate);
function fixture(){
 const f=mainPageFixture(),questions=[],renders=[];f.ctx.actor=f.actor;f.evaluate("me=actor;view='sales';salesSection='proformas';salesEditing='draft';sessionLoadEpoch=1");
 f.ctx.render=async()=>{renders.push(f.evaluate('view'));};f.ctx.askConfirm=options=>{const pending=deferred();questions.push({...pending,options});return pending.promise;};
 f.document.querySelector('#content').innerHTML='<form id="proformaForm"><input name="notes" value="Original"></form>';
 const form=f.document.querySelector('#proformaForm');form.querySelector('input').name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);form.querySelector('input').value='Unsaved';
 const button=f.document.querySelector('[data-view="service"]');button.hidden=false;
 const listener=f.document.body.events.click.find(event=>String(event.fn).includes('return navigateWorkspace(button)')).fn;
 const press=(target=button)=>{const event={target:{closest:()=>target},preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};return {event,promise:listener(event)};};
 return {...f,questions,renders,form,button,press};
}

test('sidebar consumes capture before awaiting and cancellation leaves route, hash and edited fields unchanged',async()=>{
 const f=fixture(),before=f.ctx.location.hash,{event,promise}=f.press();
 assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(f.evaluate('view'),'sales');assert.equal(f.ctx.location.hash,before);await flush();
 assert.equal(f.questions.length,1);assert.equal(f.questions[0].options.tone,'danger');f.questions[0].resolve(false);await promise;
 assert.equal(f.evaluate('view'),'sales');assert.equal(f.ctx.location.hash,before);assert.equal(f.form.querySelector('input').value,'Unsaved');assert.equal(f.ctx.salesEditorChanged(f.form),true);assert.deepEqual(f.renders,[]);
});

test('accepted sidebar navigation commits once after confirmation and refreshes the selected workflow',async()=>{
 const f=fixture(),{promise}=f.press();await flush();f.questions[0].resolve(true);await promise;
 assert.equal(f.evaluate('view'),'service');assert.equal(f.evaluate('serviceSection'),'installations');assert.equal(f.evaluate('serviceLoaded'),false);assert.equal(f.ctx.location.hash,'#/go/service/installations');assert.deepEqual(f.renders,['service']);
});

test('late answers cannot mutate a replaced actor, session, route, hash, detached form or changed draft',async()=>{
 for(const change of [f=>f.evaluate('me={...me}'),f=>f.ctx.clearCoreSession(),f=>f.evaluate("view='personal'"),f=>{f.ctx.location.hash='#/go/staff';},f=>f.form.remove(),f=>{f.form.querySelector('input').value='Newer unsaved edit';}]){
  const f=fixture(),{promise}=f.press();await flush();change(f);const expected=f.evaluate('view'),hash=f.ctx.location.hash;f.questions[0].resolve(true);await promise;
  assert.equal(f.evaluate('view'),expected);assert.equal(f.ctx.location.hash,hash);assert.deepEqual(f.renders,[]);
 }
});

test('a newer navigation attempt supersedes an older answer without applying its destination',async()=>{
 const f=fixture(),first=f.press();await flush();const target=f.document.querySelector('[data-view="travel"]'),second=f.press(target);await flush();
 assert.equal(f.questions.length,2);f.questions[0].resolve(true);await first.promise;assert.equal(f.evaluate('view'),'sales');assert.equal(f.ctx.salesEditorChanged(f.form),true);
 f.questions[1].resolve(true);await second.promise;assert.deepEqual(f.renders,['travel']);assert.equal(f.ctx.location.hash,'#/go/travel');
});

test('saving Sales and unresolved financial posting block navigation without a discard question',async()=>{
 for(const setup of [f=>{f.form.dataset.saving='true';},f=>f.evaluate("view='books';booksSection='import';financialImportState={preview:{},uncertain:true}"),f=>f.evaluate("view='books';booksSection='opening';openingReceivablesState={preview:{},busy:true}"),f=>f.evaluate("returnCreditPostingState={uncertain:true}")]){
  const f=fixture();setup(f);const view=f.evaluate('view');await f.press().promise;assert.equal(f.evaluate('view'),view);assert.equal(f.questions.length,0);assert.deepEqual(f.renders,[]);
 }
});

test('import confirmations pin the exact preview and never clear a replacement or newly posting state',async()=>{
 for(const [section,prefix]of [['import','financialImport'],['opening','openingReceivables']])for(const change of ['preview','actor','busy','clear']){
  const f=fixture();f.form.remove();f.evaluate(`view='books';booksSection='${section}';${prefix}State={preview:{},busy:false,uncertain:false}`);
  const pending=f.press().promise;await flush();assert.equal(f.questions.length,1);
  if(change==='preview')f.evaluate(`${prefix}State.preview={newer:true}`);
  if(change==='actor')f.evaluate('me={...me}');
  if(change==='busy')f.evaluate(`${prefix}State.busy=true`);
  if(change==='clear')f.ctx['clear'+prefix[0].toUpperCase()+prefix.slice(1)]();
  f.questions[0].resolve(true);await pending;assert.equal(f.evaluate('view'),'books');assert.deepEqual(f.renders,[]);
  if(change!=='clear')assert.notEqual(f.evaluate(prefix+'State'),null);
 }
});

test('direct client navigation awaits confirmation before changing view or browser history',async()=>{
 const f=fixture(),pending=f.ctx.goProfile('client','client-id');await flush();assert.equal(f.evaluate('view'),'sales');f.questions[0].resolve(false);await pending;assert.deepEqual(f.renders,[]);
 const accepted=f.ctx.goProfile('client','client-id');await flush();f.questions[1].resolve(true);await accepted;
 assert.equal(f.evaluate('view'),'contacts');assert.equal(f.evaluate('selected'),'client-id');assert.equal(f.ctx.location.hash,'#/client/client-id');assert.deepEqual(f.renders,['contacts']);
});

test('history popstate/hashchange coalesce and cancellation restores only its own pending hash',async()=>{
 const f=fixture();f.ctx.location.hash='#/go/travel';const first=f.ctx.navHistoryChanged(),duplicate=f.ctx.navHistoryChanged();await flush();assert.equal(f.questions.length,1);
 f.questions[0].resolve(false);await Promise.all([first,duplicate]);assert.equal(f.ctx.location.hash,'');assert.equal(f.evaluate('view'),'sales');assert.deepEqual(f.renders,[]);
 const g=fixture();g.ctx.location.hash='#/go/travel';const old=g.ctx.navHistoryChanged();await flush();g.ctx.location.hash='#/go/service/schedule';const fresh=g.ctx.navHistoryChanged();await flush();g.questions[0].resolve(false);await old;assert.equal(g.ctx.location.hash,'#/go/service/schedule');g.questions[1].resolve(true);await fresh;await flush();assert.equal(g.evaluate('view'),'service');assert.equal(g.evaluate('serviceSection'),'schedule');assert.deepEqual(g.renders,['service']);
});

test('queued navigation waits for the active read, then commits without synthetic click replay',async()=>{
 const f=fixture();f.form.dataset.initialState=f.ctx.salesEditorState(f.form);const pending=deferred(),work=f.ctx.run(()=>pending.promise);await f.press().promise;assert.equal(f.evaluate('view'),'sales');assert.equal(f.evaluate('navWhileBusy.button'),f.button);
 pending.resolve();await work;await flush();assert.deepEqual(f.renders,['service']);assert.equal(f.evaluate('navWhileBusy'),null);assert.equal(f.evaluate('navReplayPending'),false);
});

test('non-sidebar My settings uses the same awaited guard instead of changing view first',async()=>{
 const f=fixture(),button=f.document.createElement('button');button.dataset.view='settings';f.document.body.append(button);
 const handler=f.document.body.events.click.find(event=>String(event.fn).includes('if(b.dataset.view)return navigateWorkspace(b)')).fn;
 const pending=handler({target:{closest:()=>button}});await flush();assert.equal(f.evaluate('view'),'sales');f.questions[0].resolve(false);await pending;assert.deepEqual(f.renders,[]);
});

for(const action of ['refresh','logout'])test(`global ${action} protects edits and rejects stale discard answers`,async()=>{
 for(const change of ['cancel','actor','route','draft','detach','accept']){
  const f=fixture(),button=f.document.createElement('button'),calls=[];button.id=action;f.document.body.append(button);
  f.ctx.load=async()=>{calls.push('refresh');};f.evaluate('client').auth.signOut=async()=>{calls.push('logout');};f.ctx.login=()=>{};f.ctx.forgetThisDevice=()=>{};
  const handler=f.document.body.events.click.find(event=>String(event.fn).includes('if(b.dataset.view)return navigateWorkspace(b)')).fn;
  const pending=handler({target:{closest:()=>button}});await flush();assert.equal(f.questions.length,1);assert.deepEqual(calls,[]);
  if(change==='actor')f.evaluate('me={...me}');if(change==='route')f.ctx.location.hash='#/go/travel';if(change==='draft')f.form.querySelector('input').value='Newer edit';if(change==='detach')button.remove();
  f.questions[0].resolve(change!=='cancel');await pending;assert.deepEqual(calls,change==='accept'?[action]:[],change);
 }
});

test('global Refresh keeps its captured origin and pending lock after the clean leave guard yields',async()=>{
 for(const rejected of [false,true]){
  const f=fixture(),button=f.document.createElement('button'),wait=deferred(),prototype=Object.getPrototypeOf(button),matches=prototype.matches;prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};f.ctx.getComputedStyle=()=>({visibility:'visible'});button.id='refresh';button.type='button';button.textContent='Refresh';f.document.body.append(button);f.form.dataset.initialState=f.ctx.salesEditorState(f.form);let calls=0;
  f.ctx.load=async()=>{calls++;await wait.promise;if(rejected)throw Error('Read unavailable');};
  const capture=f.document.body.events.click.find(event=>String(event.fn).includes('actionFeedbackEvent=capture')).fn,handler=f.document.body.events.click.find(event=>String(event.fn).includes('if(b.dataset.view)return navigateWorkspace(b)')).fn;
  const event={target:button,eventPhase:2};button.focus();capture(event);const pending=handler(event);event.eventPhase=0;await flush();
  assert.equal(f.questions.length,0);assert.equal(calls,1);assert.equal(f.evaluate('actionFeedbackOrigin()'),button);assert.equal(f.evaluate('actionFeedbackActive.origin.node'),button);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.textContent,'Refresh');
  wait.resolve();await pending;assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(f.evaluate('busy'),false);
  if(rejected){const error=f.document.querySelector('.action-feedback-error');assert.ok(error);assert.match(error.textContent,/Read unavailable/);assert.equal(f.evaluate('[...actionFeedbackEntries].find(entry=>entry.kind==="error").reference.node'),button);}
 }
});

test('Books section buttons await their exact current preview and keep it on Cancel',async()=>{
 const f=mainPageFixture({tables:{acc_settings:()=>[{version:2,locked_through:null}]}});await f.open({view:'books',booksSection:'import'});
 f.evaluate('financialImportState.preview={entries:[],rows:[],errors:[]}');const pending=deferred();f.ctx.askConfirm=()=>pending.promise;
 const button=f.document.querySelector('[data-books-section="overview"]'),opening=button.onclick();await flush();assert.equal(f.evaluate('booksSection'),'import');pending.resolve(false);await opening;
 assert.equal(f.evaluate('booksSection'),'import');assert.notEqual(f.evaluate('financialImportState.preview'),null);assert.equal(button.isConnected,true);
});

test('staff bulk import confirmation sends no batches after Cancel or a stale actor, route, file or render',async()=>{
 for(const change of ['cancel','actor','session','hash','attempt','route','file','render']){
  const writes=[],f=mainPageFixture({rpcs:{import_records:args=>{writes.push(args);return [];}}});await f.open({view:'staff'});
  const input=f.document.querySelector('#import'),file={text:async()=>JSON.stringify({organizations:[{id:'org'}],contacts:[],products:[]})};input.files=[file];
  const pending=deferred();let asked=0;f.ctx.askConfirm=()=>{asked++;return pending.promise;};
  const action=input.onchange({target:input});await flush();assert.equal(asked,1);assert.equal(writes.length,0);
  if(change==='actor')f.evaluate('me={...me}');if(change==='session')f.evaluate('sessionLoadEpoch++');if(change==='hash')f.ctx.location.hash='#/go/travel';if(change==='attempt')f.ctx.workspaceNavigationContext();if(change==='route')f.evaluate("view='personal'");if(change==='file')input.files=[{text:async()=>''}];if(change==='render')f.document.querySelector('#content').staffLoadRequest++;
  pending.resolve(change!=='cancel');await action;assert.equal(writes.length,0);
 }
});

test('accepted staff import keeps exact batch payloads and stops after a superseded response',async()=>{
 const writes=[],f=mainPageFixture({rpcs:{import_records:args=>{writes.push(args);return [];}}});await f.open({view:'staff'});
 const data={organizations:Array.from({length:251},(_,i)=>({id:'org-'+i})),contacts:[{id:'contact'}],products:[{id:'product'}]},input=f.document.querySelector('#import');input.files=[{text:async()=>JSON.stringify(data)}];f.ctx.askConfirm=async()=>true;let reloads=0;f.ctx.load=async()=>{reloads++;};
 await input.onchange({target:input});assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{p_organizations:data.organizations.slice(0,250)},{p_organizations:data.organizations.slice(250)},{p_contacts:data.contacts},{p_products:data.products}]);assert.equal(reloads,1);
 const held=deferred(),g=mainPageFixture({rpcs:{import_records:()=>held.promise}});await g.open({view:'staff'});const source=g.document.querySelector('#import');source.files=[{text:async()=>JSON.stringify(data)}];g.ctx.askConfirm=async()=>true;const action=source.onchange({target:source});await flush();g.evaluate('me={...me}');held.resolve([]);await action;assert.equal(g.calls.filter(call=>call.name==='import_records').length,1);
});

test('approved sidebar navigation closes the mobile menu only after the leave decision',async()=>{
 const f=fixture(),toggle=f.document.createElement('button');toggle.id='workspaceMenuToggle';f.document.body.append(toggle);let closed=0;f.ctx.navMobileSet=(open,restore)=>{assert.equal(open,false);assert.equal(restore,true);closed++;};
 const rejected=f.press();await flush();assert.equal(closed,0);f.questions[0].resolve(false);await rejected.promise;assert.equal(closed,0);
 const approved=f.press();await flush();f.questions[1].resolve(true);await approved.promise;assert.equal(closed,1);f.ctx.refreshNotificationBell=async()=>{};f.ctx.syncWorkspaceNavigation();assert.equal(closed,1);
});

test('handoff record and notification task links await the same cancellation and actor guards',async()=>{
 for(const action of [f=>f.ctx.workOpenRecord({record_type:'contract',record_id:'contract-1'}),f=>f.ctx.bellGoToTasks()]){
  const f=fixture(),cancelled=action(f);await flush();f.questions[0].resolve(false);await cancelled;assert.equal(f.evaluate('view'),'sales');assert.deepEqual(f.renders,[]);
  const stale=action(f);await flush();f.evaluate('me={...me}');f.questions[1].resolve(true);await stale;assert.equal(f.evaluate('view'),'sales');assert.deepEqual(f.renders,[]);
  const accepted=action(f);await flush();f.questions[2].resolve(true);await accepted;assert.equal(f.renders.length,1);assert.notEqual(f.evaluate('view'),'sales');
 }
});
