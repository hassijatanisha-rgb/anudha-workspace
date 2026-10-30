import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryApprovalFixture} from './helpers/delivery-approval-fixture.mjs';
import {recordId,tick} from './helpers/proforma-draft-fixture.mjs';
const summary=f=>f.form().querySelector('[data-delivery-errors]');
const radios=f=>f.form().querySelectorAll('[name="collection"]');

test('submit counts the collection group once and focuses the first invalid field after the top summary',async()=>{
 const f=deliveryApprovalFixture(),form=f.form();f.field('accountsReference').value=' ';f.field('expectedDeliveryDate')._nativeError='Choose a valid delivery date.';f.select('');radios(f).forEach(control=>control._nativeError='Select one of these options.');await f.submit();
 assert.equal(form.noValidate,true);assert.equal(form.children[0],summary(f));assert.equal(summary(f).textContent,'3 fields need attention');assert.equal(form.querySelectorAll('.field-error').length,3);assert.equal(f.document.activeElement,f.field('accountsReference'));assert.equal(f.field('accountsReference').value,' ');assert.equal(f.calls.length,0);assert.equal(form.dataset.requestId,undefined);
 const group=form.querySelector('.collection-choice'),host=group.querySelector('[data-delivery-collection-errors]');assert.equal(group.querySelectorAll('.field-error').length,1);assert.equal(host.querySelectorAll('.field-error').length,1);assert.equal(group.getAttribute('aria-describedby'),host.id);assert.match(radios(f)[0].getAttribute('aria-describedby'),/field-error-/);assert.equal(radios(f)[1].getAttribute('aria-invalid'),null);
});

test('native bubbling focusout validates only the departed field and preserves help and focus',()=>{
 const f=deliveryApprovalFixture(),reference=f.field('accountsReference');reference.setAttribute('aria-describedby','approval-help');reference.value='';f.field('expectedDeliveryDate')._nativeError='Date invalid';f.field('expectedDeliveryDate').focus();f.blur(reference);
 assert.equal(f.form().onfocusout,undefined);assert.ok(f.form().events.focusout?.length);assert.equal(f.form().querySelectorAll('.field-error').length,1);assert.equal(f.document.activeElement,f.field('expectedDeliveryDate'));assert.equal(f.field('expectedDeliveryDate').getAttribute('aria-invalid'),null);assert.match(reference.getAttribute('aria-describedby'),/^approval-help /);
 reference.value='Approved reference';f.blur(reference);assert.equal(reference.getAttribute('aria-describedby'),'approval-help');assert.equal(f.form().querySelectorAll('.field-error').length,0);
});

test('either departed radio presents the same visible group error; choosing a value clears it without shifting focus',()=>{
 const f=deliveryApprovalFixture();f.select('');radios(f)[1].focus();f.blur(radios(f)[1]);const host=f.form().querySelector('[data-delivery-collection-errors]');assert.equal(host.querySelectorAll('.field-error').length,1);assert.equal(f.document.activeElement,radios(f)[1]);f.blur(radios(f)[0]);assert.equal(host.querySelectorAll('.field-error').length,1);
 f.select('lobby');f.fire(radios(f)[0],'change');assert.equal(host.querySelectorAll('.field-error').length,0);assert.equal(radios(f)[0].getAttribute('aria-invalid'),null);assert.equal(f.document.activeElement,radios(f)[1]);assert.equal(f.calls.length,0);
});

test('the radio group is the first submit target when the other fields are valid',async()=>{
 const f=deliveryApprovalFixture();f.select('');await f.submit();assert.equal(summary(f).textContent,'1 field needs attention');assert.equal(f.document.activeElement,radios(f)[0]);assert.equal(radios(f)[0].scrolledIntoView.block,'center');f.select('delivery');f.fire(radios(f)[1],'change');assert.equal(summary(f).textContent,'');
});

test('native date/custom constraints and programmatic maximum length block the writer',async()=>{
 const f=deliveryApprovalFixture();f.field('accountsReference').value='x'.repeat(121);f.field('expectedDeliveryDate')._nativeError='Choose a date on or after today.';await f.submit();assert.equal(f.calls.length,0);assert.equal(summary(f).textContent,'2 fields need attention');assert.match(f.field('accountsReference').closest('label').textContent,/no more than 120/);assert.equal(f.field('expectedDeliveryDate').value,'2026-10-30');
});

test('valid approval keeps the exact UUID/version arguments, stable working label and final disabled receipt',async()=>{
 const f=deliveryApprovalFixture({runtime:true}),form=f.form(),save=form.querySelector('[type="submit"]'),label=save.textContent;f.field('accountsReference').value='  Approval email  ';let resolve;f.write=()=>new Promise(done=>resolve=done);const saving=f.submitEvent();
 assert.equal(save.textContent,label);assert.equal(save.getAttribute('aria-busy'),'true');assert.equal(save.disabled,true);await f.submitEvent();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{name:'create_sales_delivery_note',args:{p_id:recordId,p_proforma_id:'p',p_expected_proforma_version:3,p_accounts_reference:'  Approval email  ',p_expected_delivery_date:'2026-10-30',p_lines:[]}});
 resolve({data:{id:recordId,version:7}});await saving;assert.equal(form.dataset.savedDelivery,recordId);assert.equal(save.textContent,'Approval saved');assert.equal(save.disabled,true);assert.equal(f.field('accountsReference').disabled,true);assert.equal(form.querySelector('[data-sales-saved] button').textContent,'Open delivery');assert.equal(f.form(),form);await f.submitEvent();assert.equal(f.calls.length,1);
});

test('lobby marking follows confirmed approval version and a failed mark retains the approved receipt',async()=>{
 const f=deliveryApprovalFixture({runtime:true});f.select('lobby');f.write=name=>name==='create_sales_delivery_note'?{data:{id:recordId,version:7}}:{error:{message:'Lobby mark unconfirmed'}};await f.submitEvent();assert.deepEqual(f.calls.map(call=>call.name),['create_sales_delivery_note','set_delivery_customer_waiting']);assert.deepEqual(f.calls[1].args,{p_id:recordId,p_expected_version:7,p_customer_waiting:true});assert.equal(f.form().dataset.savedDelivery,recordId);assert.match(f.form().querySelector('[data-sales-saved]').textContent,/Delivery created.*mark could not be confirmed/);assert.equal(f.form().querySelector('[type="submit"]').disabled,true);await f.submitEvent();assert.equal(f.calls.length,2);
});

test('failed approval keeps its request ID and values for the existing explicit retry behavior',async()=>{
 const f=deliveryApprovalFixture({runtime:true});f.write=()=>({error:{message:'Not approved',code:'P0001'}});await f.submitEvent();const id=f.form().dataset.requestId;assert.equal(f.form().querySelector('[type="submit"]').disabled,false);assert.equal(f.field('accountsReference').value,'Approved reference');assert.match(summary(f).textContent,/Not approved/);f.write=()=>({data:{id,version:1}});await f.submitEvent();assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_id,id);
});

for(const mode of ['actor','session','request','hash','form','permission'])test(`validation and saving ignore a ${mode} replacement`,async()=>{
 const f=deliveryApprovalFixture(),form=f.form(),reference=f.field('accountsReference');reference.value='';if(mode==='actor')f.ctx.me={...f.actor};if(mode==='session')f.ctx.sessionLoadEpoch++;if(mode==='request')f.get('salesWorkspaceRequest++');if(mode==='hash')f.ctx.location.hash='#/go/personal';if(mode==='form')f.document.querySelector('#content').innerHTML='<form id="deliveryForm"></form>';if(mode==='permission')f.actor.access=[];
 f.blur(reference);assert.equal(form.querySelectorAll('.field-error').length,0);await assert.rejects(f.submit(),/Reopen Accounts approval/);assert.equal(f.calls.length,0);
});

test('an in-flight approval cannot mark lobby or publish a receipt after session replacement',async()=>{
 const f=deliveryApprovalFixture();f.select('lobby');let resolve;f.write=()=>new Promise(done=>resolve=done);const saving=f.submit();await tick();f.ctx.sessionLoadEpoch++;resolve({data:{id:recordId,version:1}});await saving;assert.equal(f.calls.length,1);assert.equal(f.form().dataset.savedDelivery,undefined);assert.equal(f.form().querySelector('[data-sales-saved]'),null);
});


test('busy refusal does not validate, disable or allocate an approval request',async()=>{
 const f=deliveryApprovalFixture({runtime:true});f.ctx.busy=true;f.field('accountsReference').value='';await f.submitEvent();assert.equal(f.form().querySelector('[type="submit"]').disabled,false);assert.equal(f.field('accountsReference').disabled,false);assert.equal(f.form().querySelectorAll('.field-error').length,0);assert.equal(f.form().dataset.requestId,undefined);assert.equal(f.calls.length,0);
});

for(const mode of ['actor','session','request'])test(`late transport rejection after ${mode} replacement leaves stale controls locked and publishes no error`,async()=>{
 const f=deliveryApprovalFixture({runtime:true});let reject;f.write=()=>new Promise((_resolve,fail)=>reject=fail);const saving=f.submitEvent();await tick();if(mode==='actor')f.ctx.me={...f.actor};if(mode==='session')f.ctx.sessionLoadEpoch++;if(mode==='request')f.get('salesWorkspaceRequest++');reject(Error('Old session transport error'));await saving;
 assert.equal(f.form().querySelector('[type="submit"]').disabled,true);assert.equal(f.field('accountsReference').disabled,true);assert.equal(f.form().dataset.savedDelivery,undefined);assert.doesNotMatch(summary(f).textContent,/Old session transport error/);assert.equal(f.calls.length,1);
});

test('an unconfirmed response retains the existing explicit-retry request ID without publishing a saved receipt',async()=>{
 const f=deliveryApprovalFixture({runtime:true});f.write=()=>({data:null});await f.submitEvent();const id=f.form().dataset.requestId;assert.equal(f.form().dataset.savedDelivery,undefined);assert.equal(f.form().querySelector('[data-sales-saved]'),null);assert.equal(f.form().querySelector('[type="submit"]').disabled,false);assert.match(summary(f).textContent,/did not confirm/);f.write=()=>({data:{id,version:1}});await f.submitEvent();assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_id,id);
});
