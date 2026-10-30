import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
import {installLookupDom} from './helpers/lookup-dom.mjs';

function fixture(markup,attach=true){
 const document=dom();installNativeFormControls(document);document.body.innerHTML='<main><form>'+markup+'</form></main>';
 const ctx=vm.createContext({document,window:{},organizations:[{id:'client',name:'Clinic'}],inventorySelectableProducts:()=>[{id:'product',name:'Reagent'}],inventoryClassification:()=>({category:'reagents'}),inventoryProductIdentity:product=>product.name,inventoryProductChoice:product=>product.id,catalogLabel:()=> 'Reagent',setWorkspacePopover:(node,open)=>{node.hidden=!open;}});
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),ctx);installLookupDom(ctx);
 const form=document.querySelector('form'),source=form.querySelector('[name]');if(attach)ctx.lookupAttach(source);const proxy=source._lookupBox?.querySelector('input.lookup-input');
 return {ctx,document,form,source,proxy,errors:()=>ctx.nativeFormErrors(form),show:()=>ctx.showFieldErrors(form,ctx.nativeFormErrors(form))};
}
const client='<label>Client<select name="client" required data-lookup-rows="organizations" aria-describedby="client-help"><option value="">Choose client</option></select></label><p id="client-help">Pick a saved client.</p>';
const product='<label>Product<input name="product" required list="products" aria-describedby="price-help"></label><datalist id="products" data-lookup-values="products"></datalist><p id="price-help">Configured price.</p>';

test('actual required client lookup counts its canonical field once and focuses the visible search input',()=>{
 const f=fixture(client);assert.equal(f.source.tabIndex,-1);assert.equal(f.proxy.name,'');assert.equal(f.ctx.fieldValidationSource(f.proxy),f.source);assert.equal(f.errors().size,1);assert.ok(f.errors().has(f.source));f.show();assert.equal(f.document.activeElement,f.proxy);assert.equal(f.proxy.scrolledIntoView.block,'center');assert.equal(f.source.getAttribute('aria-invalid'),null);assert.equal(f.proxy.getAttribute('aria-invalid'),'true');assert.match(f.proxy.getAttribute('aria-describedby'),/^client-help field-error-/);assert.equal(f.form.querySelectorAll('.field-error').length,1);
});

test('mirrored product custom validity is one error, remains on its visible field, and escapes text',()=>{
 const f=fixture(product);f.source.setCustomValidity('<b>Missing configured price</b>');assert.equal(f.source.hidden,true);assert.equal(f.proxy.validationMessage,f.source.validationMessage);assert.equal(f.ctx.nativeFieldError(f.proxy),f.source.validationMessage);assert.equal(f.errors().size,1);f.show();assert.equal(f.document.activeElement,f.proxy);assert.equal(f.form.querySelector('b'),null);assert.equal(f.form.querySelector('.field-error').textContent,'⚠ <b>Missing configured price</b>');assert.match(f.proxy.getAttribute('aria-describedby'),/^price-help /);
 f.source.setCustomValidity('');f.ctx.lookupPick(f.source._lookupBox,{value:'product',label:'Reagent'});f.show();assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.proxy.getAttribute('aria-describedby'),'price-help');assert.equal(f.source.value,'product');assert.equal(f.proxy.name,'');
});

test('optional unmatched picker text is rejected immediately on blur, including before the lookup leave timer',()=>{
 const f=fixture(client.replace(' required',''));f.proxy.value='Unselected clinic';assert.equal(f.source.value,'');assert.equal(f.ctx.nativeFieldError(f.proxy),'Choose one from the list');assert.equal(f.errors().size,1);f.proxy.setCustomValidity('Choose one from the list');assert.equal(f.errors().size,1);
 f.ctx.lookupPick(f.source._lookupBox,{value:'client',label:'Clinic'});assert.equal(f.errors().size,0);assert.equal(f.source.value,'client');assert.equal(f.source.options.at(-1).value,'client');assert.equal(f.proxy.value,'Clinic');
});

test('disabled, readonly and actual hidden input exclusions take precedence over stale proxy validity',()=>{
 for(const mode of ['disabled','readonly','hidden']){const f=fixture(product);f.source.setCustomValidity('Old product error');if(mode==='disabled')f.source.disabled=true;else if(mode==='readonly')f.source.readOnly=true;else f.source.type='hidden';assert.equal(f.ctx.nativeFieldError(f.proxy),'');assert.equal(f.errors().size,0);f.show();assert.equal(f.document.activeElement,f.document.body);}
});

test('hidden or inert lookup parents are not focus targets; later visible errors remain reachable',()=>{
 for(const attr of ['hidden','inert']){const f=fixture(client+'<label>Notes<input name="notes" required></label>');f.source._lookupBox.setAttribute(attr,'');f.show();assert.equal(f.document.activeElement,f.form.querySelector('[name="notes"]'));assert.equal(f.errors().size,2);}
});

test('only a verified live wrapper pair is deduplicated, not names, unrelated search controls, or forged metadata',()=>{
 const f=fixture(client+'<label>Other<input name="client" required></label><label>Search<input type="search" required></label>');assert.equal(f.errors().size,3);const other=f.form.querySelectorAll('[name="client"]')[1];other._lookupBox=f.source._lookupBox;assert.equal(f.ctx.fieldValidationSource(other),other);assert.equal(f.errors().size,3);
 f.source._lookupBox._lookupSource=other;assert.equal(f.ctx.fieldValidationSource(f.proxy),f.proxy);assert.equal(f.ctx.fieldValidationSource(f.source),f.source);
});

test('object domain errors and canonical Map errors share one visible node and preserve help and prior aria state',()=>{
 const f=fixture(client);f.proxy.setAttribute('aria-describedby','visible-help');f.proxy.setAttribute('aria-invalid','grammar');f.ctx.showFieldErrors(f.form,{client:'Choose a complete account'});const error=f.form.querySelector('.field-error');f.ctx.showFieldErrors(f.form,f.errors());assert.equal(f.form.querySelector('.field-error'),error);assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.proxy.getAttribute('aria-describedby'),'visible-help client-help '+error.id);f.ctx.showFieldErrors(f.form,{});assert.equal(f.proxy.getAttribute('aria-invalid'),'grammar');assert.equal(f.proxy.getAttribute('aria-describedby'),'visible-help client-help');
});

test('ordinary unbound datalist input remains its own canonical field and accepts free text',()=>{
 const f=fixture('<label>Reference<input name="reference" list="references"></label><datalist id="references"><option value="Known"></option></datalist>');assert.equal(f.source,f.proxy);f.source.value='Free text';assert.equal(f.ctx.fieldValidationSource(f.source),f.source);assert.equal(f.errors().size,0);
});

test('lookup enhancement after an earlier validation moves the error without leaving a hidden-field duplicate',()=>{
 const f=fixture(client,false);f.show();assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.source.getAttribute('aria-invalid'),'true');f.ctx.lookupAttach(f.source);const proxy=f.source._lookupBox.querySelector('input.lookup-input');f.show();assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.source.getAttribute('aria-invalid'),null);assert.equal(f.source.getAttribute('aria-describedby'),'client-help');assert.ok(f.document.activeElement===proxy);assert.match(proxy.getAttribute('aria-describedby'),/^client-help field-error-/);
});
