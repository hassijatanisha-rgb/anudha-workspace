import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {draftFixture,receipt,revisionReceipt,plain,tick} from './helpers/proforma-draft-fixture.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=read('app.js'),runtime=read('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
function fixture(){
 const f=draftFixture(),proto=Object.getPrototypeOf(f.document.body);
 proto.getBoundingClientRect=()=>({left:40,top:40,bottom:84,width:180,height:44});proto.getClientRects=function(){return this.isConnected?[{}]:[];};
 Object.defineProperties(proto,{classList:{get(){return {add:name=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(value=>value!==name).join(' ');},contains:name=>this.className.split(' ').includes(name)};}},form:{get(){return this.closest('form');}}});
 f.document.addEventListener=()=>{};f.document.documentElement={clientWidth:1280,clientHeight:900};f.ctx.getComputedStyle=()=>({visibility:'visible'});const notice=f.document.createElement('div');notice.setAttribute('id','notice');f.document.body.append(notice);
 vm.runInContext(runtime,f.ctx);const form=f.form(),save=form.querySelector('[type="submit"]');return Object.assign(f,{save,submitEvent:()=>form.events.submit[0].fn({preventDefault(){},currentTarget:form,submitter:save})});
}

test('busy refusal leaves the Save and fields unlocked without starting a request',async()=>{
 const f=fixture();f.ctx.busy=true;await f.submitEvent();assert.equal(f.save.disabled,false);assert.equal(f.field('notes').disabled,false);assert.equal(f.calls.length,0);assert.match(f.form().querySelector('[data-proforma-errors]').textContent,/Another action is still running/);
});

test('actual run keeps the Save label and spinner, then enables the confirmed editor',async()=>{
 const f=fixture(),label=f.save.textContent;let resolve;f.write=(_name,args)=>new Promise(done=>resolve=()=>done({data:receipt(args)}));const pending=f.submitEvent();
 assert.equal(f.save.disabled,true);assert.equal(f.save.textContent,label);assert.equal(f.save.getAttribute('aria-busy'),'true');assert.ok(f.save.classList.contains('action-is-busy'));assert.equal(f.field('notes').disabled,true);await f.submitEvent();assert.equal(f.calls.length,1);
 resolve();await pending;assert.equal(f.save.disabled,false);assert.equal(f.save.textContent,label);assert.equal(f.save.getAttribute('aria-busy'),null);assert.equal(f.field('notes').disabled,false);assert.equal(f.field('discountAmount').disabled,true);assert.equal(f.form().dataset.version,'1');assert.equal(f.ctx.busy,false);
});

test('uncertain Save remains disabled after actual feedback finish; explicit same-save retry owns recovery',async()=>{
 const f=fixture(),label=f.save.textContent;f.write=()=>{throw Error('Lost response');};await f.submitEvent();const args=plain(f.calls[0].args);
 assert.equal(f.save.disabled,true);assert.equal(f.save.textContent,label);assert.equal(f.save.getAttribute('aria-busy'),null);assert.equal(f.field('notes').disabled,true);assert.ok(f.state().pending);await f.submitEvent();assert.equal(f.calls.length,1);
 const retry=f.form().querySelector('[data-proforma-retry]');assert.equal(retry.disabled,false);f.write=(_name,payload)=>({data:receipt(payload)});await retry.onclick();assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].args,args);assert.equal(f.save.disabled,false);assert.equal(f.field('notes').disabled,false);assert.equal(f.state().pending,null);assert.equal(f.form().dataset.version,'1');
});

test('a definitive first rejection and validation failure restore Save while retaining input',async()=>{
 const f=fixture();f.field('notes').value='Retained terms';f.write=()=>({error:{code:'P0001',message:'Configured price changed'}});await f.submitEvent();assert.equal(f.save.disabled,false);assert.equal(f.field('notes').disabled,false);assert.equal(f.field('notes').value,'Retained terms');assert.equal(f.state().pending,null);assert.equal(f.calls.length,1);assert.match(f.form().querySelector('[data-proforma-errors]').textContent,/Configured price changed/);
 f.field('paymentTerms').value='';await f.submitEvent();assert.equal(f.save.disabled,false);assert.equal(f.calls.length,1);assert.equal(f.document.activeElement,f.field('paymentTerms'));
});

for(const drift of ['actor','session','request'])test(`a late receipt after ${drift} replacement cannot unlock the stale editor`,async()=>{
 const f=fixture();let resolve;f.write=(_name,args)=>new Promise(done=>resolve=()=>done({data:receipt(args)}));const pending=f.submitEvent();await tick();if(drift==='actor')f.ctx.me={...f.actor};if(drift==='session')f.ctx.sessionLoadEpoch++;if(drift==='request')f.get('salesWorkspaceRequest++');resolve();await pending;
 assert.equal(f.save.disabled,true);assert.equal(f.field('notes').disabled,true);assert.equal(f.form().dataset.version,'0');assert.equal(f.form().querySelector('[data-sales-saved]'),null);assert.ok(f.state().pending);assert.equal(f.calls.length,1);
});

test('an ordinary draft appearing before Save blocks replacement and keeps its button disabled after feedback',async()=>{
 const f=fixture(),prior=draftFixture();prior.field('notes').value='Another stored draft';prior.flush();const [key,value]=[...prior.storage.rows.entries()][0];f.storage.rows.set(key,value);await f.submitEvent();assert.equal(f.calls.length,0);assert.equal(f.save.disabled,true);assert.equal(f.field('notes').disabled,false);assert.ok(f.form().querySelector('[data-proforma-prior-draft]'));assert.equal(f.storage.rows.get(key),value);
});

test('another pending draft arriving during a successful Save remains authoritative after feedback cleanup',async()=>{
 const f=fixture(),other=draftFixture();other.ctx.crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000003';other.write=()=>{throw Error('Unconfirmed other save');};await assert.rejects(other.submit());const [key,value]=[...other.storage.rows.entries()][0];let resolve;f.write=(_name,args)=>new Promise(done=>resolve=()=>done({data:receipt(args)}));const pending=f.submitEvent();f.storage.rows.set(key,value);resolve();await pending;
 assert.equal(f.form().dataset.version,'1');assert.equal(f.save.disabled,true);assert.equal(f.field('notes').disabled,false);assert.equal(f.state().pending,null);assert.ok(f.form().querySelector('[data-proforma-prior-pending]'));assert.equal(f.storage.rows.get(key),value);assert.equal(f.calls.length,1);
});


test('a read-only status check confirms the pending receipt and restores Save without another writer',async()=>{
 const f=fixture();f.write=()=>{throw Error('Lost response');};await f.submitEvent();const args=f.calls[0].args;f.server=[receipt(args)];f.revisions=[revisionReceipt(args)];assert.equal(f.save.disabled,true);
 await f.form().querySelector('[data-proforma-check]').onclick();assert.equal(f.calls.length,1);assert.equal(f.reads.length,2);assert.equal(f.save.disabled,false);assert.equal(f.state().pending,null);assert.equal(f.field('notes').disabled,false);assert.equal(f.form().dataset.version,'1');
});
