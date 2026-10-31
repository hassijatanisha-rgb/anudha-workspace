import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
import {draftFixture,receipt,revisionReceipt,recordId,tick} from './helpers/proforma-draft-fixture.mjs';

// Keep the authored loader/navigation chain; add the native-control boundary on
// a local prototype without changing the shared budget fixture's descriptors.
function nativeControls(document){
 const base=Object.getPrototypeOf(document.body),prototype=Object.create(base),html=Object.getOwnPropertyDescriptor(base,'innerHTML');
 Object.defineProperty(prototype,'innerHTML',{...html,configurable:true});Object.setPrototypeOf(document.body,prototype);installNativeFormControls(document);
 Object.defineProperty(prototype,'type',{configurable:true,get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}});Object.defineProperty(prototype,'required',{configurable:true,get(){return this.getAttribute('required')!==null;},set(value){if(value)this.setAttribute('required','');else this.removeAttribute('required');}});
 const native=Object.getOwnPropertyDescriptor(prototype,'innerHTML'),adopt=node=>{Object.setPrototypeOf(node,prototype);for(const child of node.children)adopt(child);};
 Object.defineProperty(prototype,'innerHTML',{...native,set(value){native.set.call(this,value);for(const child of this.children)adopt(child);}});adopt(document.body);
 const create=document.createElement;document.createElement=tag=>{const node=create(tag);adopt(node);return node;};
}
async function stored({existing=false,pending=false,canonical=false}={}){
 const f=draftFixture();if(existing)await f.submit();
 f.field('notes').value='Recover this exact typed note';
 // Capture route from the form context as it was when opened on the record URL.
 const draft=f.ctx.proformaDraftCapture(f.state());draft.route=canonical?`#/proforma/${recordId}`:'#/go/sales/proformas';
 if(pending){f.write=()=>{throw Error('Lost response');};await assert.rejects(f.submit());draft.pending=f.calls.at(-1).args;}
 return {draft,server:existing?receipt(f.calls[0].args):null,args:existing?f.calls[0].args:null};
}
function fixture(saved,{holdPage=null}={}){
 const tables={sales_proformas:q=>q.single?saved.server:[saved.server].filter(Boolean),sales_delivery_notes:()=>[],sales_proforma_lines:()=>[],sales_proforma_revisions:q=>q.single?revisionReceipt(saved.args||saved.draft.pending):[revisionReceipt(saved.args||saved.draft.pending)],product_sale_prices:()=>[{product_id:'product',currency:'TZS',unit_price_minor:10000}],customer_contracts:()=>[],sales_proforma_events:()=>[],work_assignments:()=>[],work_delays:()=>[],work_step_owners:()=>[],document_attachments:()=>[],proforma_discount_approvals:()=>[]};
 const f=mainPageFixture({tables,rpcs:{sales_proforma_page:()=>holdPage||{rows:[],total:0,page:0,pages:1,counts:{all:0,mine:0,placement:0},live_status:[],discount_policy:{head_limit_basis_points:1000}},order_live_status:()=>[],work_assignments_for_records:()=>[],save_sales_proforma:args=>receipt(args,{revision:saved.draft.revision+1,actor:'actor'})}});nativeControls(f.document);
 class Fields{constructor(form){this.rows=form.querySelectorAll('[name]').filter(n=>!n.disabled).map(n=>[n.name,n.value]);}get(name){return this.rows.find(([key])=>key===name)?.[1]??null;}}f.ctx.FormData=Fields;
 f.ctx.actor=f.actor;f.ctx.seed=saved.server;f.evaluate("me=actor;sessionLoadEpoch=1;view='dashboard';listsLoaded=true;inventoryLoaded=true;salesLoaded=true;organizations=[{id:'branch',name:'Fictional clinic'}];contacts=[{id:'contact',organization_id:'branch',status:'kept',first_name:'Named',last_name:'Contact'}];products=[{id:'product',name:'Fictional reagent'}];orgIndex=new Map(organizations.map(row=>[row.id,row]));salesProformas=seed?[seed]:[];productPricingActor=me;productSalePrices.set('product:TZS',{unit_price_minor:10000});");
 f.document.querySelector('#nav').hidden=false;
 const draft={...saved.draft,actor:f.actor.user_id};if(draft.pending&&saved.server)saved.server.prepared_by=f.actor.user_id;
 f.ctx.sessionStorage.setItem('anudha:proforma-draft:1:'+f.actor.user_id,JSON.stringify(draft));
 return f;
}

test('actual menu navigation and render restore a new draft only after the landing commits',async()=>{
 const saved=await stored(),f=fixture(saved),button=f.ctx.workspaceRecordButton('proforma');
 await f.ctx.navigateWorkspace(button);
 assert.equal(f.ctx.location.hash,'#/go/sales/proformas');assert.ok(f.document.querySelector('#proformaForm'),'new draft editor restored by the real navigation hook');assert.equal(f.document.querySelector('[name="notes"]').value,saved.draft.fields.notes);assert.equal(f.evaluate('salesEditing'),'new');assert.equal(f.calls.some(call=>call.name==='save_sales_proforma'),false);
});

test('actual canonical record navigation retains a restored editor URL after confirmation and later synchronization',async()=>{
 const saved=await stored({existing:true,canonical:true}),f=fixture(saved);assert.equal(await f.ctx.openWorkspaceRecord('proforma',recordId),true);
 assert.equal(f.ctx.location.hash,`#/proforma/${recordId}`);assert.equal(f.document.querySelector('[name="notes"]')?.value,saved.draft.fields.notes,f.document.querySelector('#content').textContent+JSON.stringify(f.calls));assert.equal(f.evaluate('salesEditing'),recordId);f.ctx.syncWorkspaceNavigation();assert.equal(f.ctx.location.hash,`#/proforma/${recordId}`);
 await f.ctx.saveProformaForm(f.document.querySelector('#proformaForm'));assert.equal(f.evaluate('proformaDraftActive.pending'),null);assert.equal(f.evaluate('proformaDraftActive.draft'),null);f.ctx.syncWorkspaceNavigation();assert.equal(f.ctx.location.hash,`#/proforma/${recordId}`,'confirmed receipt cleanup does not invalidate the same restored form identity');assert.equal(f.calls.filter(call=>call.name==='save_sales_proforma').length,1);
});

for(const mode of ['actor','session','hash','attempt'])test(`committed menu restoration cannot mount a stored draft after ${mode} drift`,async()=>{
 let resolve;const page=new Promise(r=>resolve=r),saved=await stored(),f=fixture(saved,{holdPage:page}),opening=f.ctx.navigateWorkspace(f.ctx.workspaceRecordButton('proforma'));await tick();await tick();
 if(mode==='actor')f.evaluate('me={...me}');if(mode==='session')f.evaluate('sessionLoadEpoch++');if(mode==='hash')f.ctx.location.hash='#/go/settings';if(mode==='attempt')f.ctx.workspaceNavigationContext();
 resolve({rows:[],total:0,page:0,pages:1,counts:{all:0,mine:0,placement:0},live_status:[],discount_policy:{head_limit_basis_points:1000}});await opening;
 assert.equal(f.document.querySelector('#proformaForm'),null);assert.doesNotMatch(f.document.querySelector('#content').textContent,/Recover this exact typed note/);assert.equal(f.calls.some(call=>call.name==='save_sales_proforma'),false);
});

for(const existing of [false,true])test(`actual ${existing?'canonical existing':'menu new'} pending restore locks the original attempt without resending`,async()=>{
 const saved=await stored({existing,pending:true,canonical:existing}),f=fixture(saved);
 if(existing)await f.ctx.openWorkspaceRecord('proforma',recordId);else await f.ctx.navigateWorkspace(f.ctx.workspaceRecordButton('proforma'));
 const form=f.document.querySelector('#proformaForm'),state=f.evaluate('proformaDraftActive');assert.ok(form);assert.equal(form.querySelector('[name="notes"]').disabled,true);assert.deepEqual(JSON.parse(JSON.stringify(state.pending)),saved.draft.pending);assert.equal(f.calls.some(call=>call.name==='save_sales_proforma'),false);assert.ok(form.querySelector('[data-proforma-check]'));assert.ok(form.querySelector('[data-proforma-retry]'));
});

for(const existing of [false,true])test(`Review pending save returns through actual ${existing?'record':'menu'} routing without overwriting the previous attempt`,async()=>{
 const saved=await stored({existing,pending:true,canonical:existing}),f=fixture(saved);f.evaluate("view='sales';salesEditing='new'");await f.ctx.salesDeliveryWorkspace();
 const form=f.document.querySelector('#proformaForm'),button=form.querySelector('[data-proforma-prior-pending] button'),before=f.ctx.sessionStorage.getItem('anudha:proforma-draft:1:'+f.actor.user_id);assert.ok(button);assert.equal(form.querySelector('[type="submit"]').disabled,true);
 await button.onclick();assert.notEqual(f.document.querySelector('#proformaForm'),form);assert.equal(f.evaluate('proformaDraftActive.pending.p_id'),recordId);assert.equal(f.document.querySelector('[name="notes"]').value,saved.draft.fields.notes);assert.equal(f.ctx.sessionStorage.getItem('anudha:proforma-draft:1:'+f.actor.user_id),before);assert.equal(f.calls.some(call=>call.name==='save_sales_proforma'),false);assert.equal(f.ctx.location.hash,existing?`#/proforma/${recordId}`:'#/go/sales/proformas');
});

for(const mode of ['actor','session','permission','route','attempt-replaced'])test(`Review pending save does not navigate after ${mode} changes`,async()=>{
 const saved=await stored({existing:true,pending:true,canonical:true}),f=fixture(saved);f.evaluate("view='sales';salesEditing='new'");await f.ctx.salesDeliveryWorkspace();const form=f.document.querySelector('#proformaForm'),button=form.querySelector('[data-proforma-prior-pending] button');
 if(mode==='actor')f.evaluate('me={...me}');if(mode==='session')f.evaluate('sessionLoadEpoch++');if(mode==='permission')f.ctx.workspaceRecordButton('proforma').hidden=true;if(mode==='route')f.ctx.location.hash='#/go/settings';if(mode==='attempt-replaced'){const key='anudha:proforma-draft:1:'+f.actor.user_id,draft=JSON.parse(f.ctx.sessionStorage.getItem(key));draft.route='#/proforma/00000000-0000-4000-8000-000000000009';f.ctx.sessionStorage.setItem(key,JSON.stringify(draft));}
 const before=f.calls.length,hash=f.ctx.location.hash;await button.onclick();assert.equal(f.calls.length,before);assert.equal(f.ctx.location.hash,hash);assert.equal(f.document.querySelector('#proformaForm'),form);
});

for(const existing of [false,true])for(const accepted of [false,true])test(`Review prior ${existing?'record':'new'} draft ${accepted?'accepts':'cancels'} discarding only the current visible editor`,async()=>{
 const saved=await stored({existing,canonical:existing}),f=fixture(saved);f.evaluate("view='sales';salesEditing='new'");await f.ctx.salesDeliveryWorkspace();const form=f.document.querySelector('#proformaForm');form.querySelector('[name="notes"]').value='Keep these new visible terms on Cancel';const before=f.ctx.sessionStorage.getItem('anudha:proforma-draft:1:'+f.actor.user_id);let prompts=0;f.ctx.askConfirm=async()=>{prompts++;return accepted;};
 await form.querySelector('[data-proforma-review-prior]').onclick();assert.equal(prompts,1);assert.equal(f.ctx.sessionStorage.getItem('anudha:proforma-draft:1:'+f.actor.user_id),before);assert.equal(f.calls.some(call=>call.name==='save_sales_proforma'),false);
 if(accepted){assert.notEqual(f.document.querySelector('#proformaForm'),form);assert.equal(f.document.querySelector('[name="notes"]').value,saved.draft.fields.notes);assert.equal(f.evaluate('proformaDraftActive.draft.id'),recordId);}else{assert.equal(f.document.querySelector('#proformaForm'),form);assert.equal(form.querySelector('[name="notes"]').value,'Keep these new visible terms on Cancel');assert.ok(form.querySelector('[data-proforma-review-prior]'));}
});
