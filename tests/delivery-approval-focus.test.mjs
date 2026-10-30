import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryApprovalFixture} from './helpers/delivery-approval-fixture.mjs';
import {recordId} from './helpers/proforma-draft-fixture.mjs';

function fixture(){
 const f=deliveryApprovalFixture({runtime:true}),form=f.form(),save=form.querySelector('[type="submit"]');
 // Native controls lose focus when disabled; the identity fixture does not model it.
 for(const control of form.querySelectorAll('button,input,select,textarea')){
  let disabled=control.disabled;
  Object.defineProperty(control,'disabled',{get:()=>disabled,set:value=>{disabled=!!value;if(disabled&&f.document.activeElement===control)f.document.activeElement=f.document.body;}});
 }
 const elsewhere=f.document.createElement('input');f.document.body.append(elsewhere);
 return Object.assign(f,{save,elsewhere,open:()=>form.querySelector('[data-sales-saved] button')});
}
function pending(f){let resolve;f.write=()=>new Promise(done=>resolve=done);return data=>resolve(data);}

for(const origin of ['submit','field'])test(`confirmed approval transfers ${origin} focus lost to the native lock to Open delivery`,async()=>{
 const f=fixture(),resolve=pending(f);(origin==='submit'?f.save:f.field('accountsReference')).focus();const saving=f.submitEvent();
 assert.equal(f.document.activeElement,f.document.body);assert.equal(f.save.disabled,true);assert.equal(f.save.getAttribute('aria-busy'),'true');assert.equal(f.calls.length,1);
 resolve({data:{id:recordId,version:7}});await saving;
 assert.ok(f.document.activeElement===f.open(),'Open delivery receives focus');assert.equal(f.open().textContent,'Open delivery');assert.equal(f.form().dataset.savedDelivery,recordId);assert.equal(f.save.disabled,true);assert.equal(f.field('accountsReference').disabled,true);assert.equal(f.save.textContent,'Approval saved');assert.equal(f.save.getAttribute('aria-busy'),null);
 assert.deepEqual(f.calls[0],{name:'create_sales_delivery_note',args:{p_id:recordId,p_proforma_id:'p',p_expected_proforma_version:3,p_accounts_reference:'Approved reference',p_expected_delivery_date:'2026-10-30',p_lines:[]}});
 await f.submitEvent();assert.equal(f.calls.length,1);
});

test('confirmed approval preserves focus and selection moved elsewhere while pending',async()=>{
 const f=fixture(),resolve=pending(f);f.save.focus();const saving=f.submitEvent();f.elsewhere.value='Keep this search';f.elsewhere.focus();f.elsewhere.setSelectionRange(5,9);
 resolve({data:{id:recordId,version:7}});await saving;
 assert.equal(f.document.activeElement,f.elsewhere);assert.equal(f.elsewhere.selectionStart,5);assert.equal(f.elsewhere.selectionEnd,9);assert.ok(f.open());assert.equal(f.save.disabled,true);
});

test('an approval submitted without form focus does not claim BODY focus',async()=>{
 const f=fixture();assert.equal(f.document.activeElement,f.document.body);await f.submitEvent();assert.ok(f.open());assert.equal(f.document.activeElement,f.document.body);
});

test('a confirmed approval with an unconfirmed lobby mark still offers the focused delivery receipt',async()=>{
 const f=fixture();f.select('lobby');f.write=name=>name==='create_sales_delivery_note'?{data:{id:recordId,version:7}}:{error:{message:'Lobby mark unconfirmed'}};f.save.focus();await f.submitEvent();
 assert.ok(f.document.activeElement===f.open(),'Open delivery receives focus');assert.match(f.form().querySelector('[data-sales-saved]').textContent,/mark could not be confirmed/);assert.equal(f.save.disabled,true);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].args,{p_id:recordId,p_expected_version:7,p_customer_waiting:true});
});

test('a rejected approval stays editable without a receipt focus target',async()=>{
 const f=fixture();f.write=()=>({error:{code:'P0001',message:'Not approved'}});f.save.focus();await f.submitEvent();assert.equal(f.open(),null);assert.equal(f.form().dataset.savedDelivery,undefined);assert.equal(f.save.disabled,false);assert.equal(f.field('accountsReference').disabled,false);assert.equal(f.form().dataset.requestId,recordId);assert.equal(f.calls.length,1);
});

for(const change of ['actor','session','request','hash','form','permission'])test(`a ${change} replacement prevents the late approval focus handoff`,async()=>{
 const f=fixture(),resolve=pending(f);f.save.focus();const saving=f.submitEvent();
 if(change==='actor')f.ctx.me={...f.actor};if(change==='session')f.ctx.sessionLoadEpoch++;if(change==='request')f.get('salesWorkspaceRequest++');if(change==='hash')f.ctx.location.hash='#/go/personal';if(change==='form')f.document.querySelector('#content').innerHTML='<form id="deliveryForm"></form>';if(change==='permission')f.actor.access=[];
 resolve({data:{id:recordId,version:7}});await saving;
 assert.equal(f.document.activeElement,f.document.body);assert.equal(f.open(),null);assert.equal(f.form().dataset.savedDelivery,undefined);assert.equal(f.save.disabled,true);assert.equal(f.calls.length,1);
});
