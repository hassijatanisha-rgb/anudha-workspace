import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
import {installLookupDom} from './helpers/lookup-dom.mjs';

function fixture(markup,attach=true){
 const document=dom();installNativeFormControls(document);document.body.innerHTML='<main><form>'+markup+'</form></main>';
 const ctx=vm.createContext({document,window:{},setWorkspacePopover:(node,open)=>{node.hidden=!open;},inventorySelectableProducts:()=>[]});
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),ctx);installLookupDom(ctx);
 const source=document.querySelector('[name]');if(attach)ctx.lookupAttach(source);
 return {ctx,document,source,proxy:()=>source._lookupBox.querySelector('input.lookup-input')};
}
const choices=Array.from({length:16},(_,i)=>`<option value="contact-${i}">Mr. Fictional Contact ${i+1}</option>`).join('');

test('actual enhanced contact select takes only its caption, excluding every option, help and validation message',()=>{
 const f=fixture(`<label><span>Named contact</span><select name="contactId" required aria-describedby="contactHelp"><option value="">Choose named contact</option>${choices}</select><small>Choose the branch first.</small><span id="contactHelp">Search for a saved contact.</span><small class="field-error">⚠ Complete this field.</small><span role="status">Options loaded</span><span hidden>Hidden text</span><span aria-hidden="true">Decoration</span></label>`);
 assert.equal(f.proxy().getAttribute('aria-label'),'Named contact');assert.equal(f.proxy().getAttribute('aria-describedby'),'contactHelp');assert.equal(f.source.options.length,17);assert.equal(f.source.name,'contactId');assert.equal(f.proxy().name,'');assert.equal(f.source.value,'');
 f.ctx.lookupPick(f.source._lookupBox,{value:'contact-3',label:'Mr. Fictional Contact 4'});assert.equal(f.source.value,'contact-3');assert.equal(f.proxy().value,'Mr. Fictional Contact 4');assert.equal(f.proxy().getAttribute('aria-label'),'Named contact');
});

test('implicit plain text and nested caption text retain Unicode, punctuation and meaningful words',()=>{
 const f=fixture('<label>  Équipe <strong>client</strong> / branch <select name="branch" data-lookup><option value="">Choose branch</option></select><small>Helper only</small></label>');assert.equal(f.proxy().getAttribute('aria-label'),'Équipe client / branch');
});

test('explicit associated labels are preserved in DOM order, without an unrelated wrapping label',()=>{
 const f=fixture('<label for="branch">Client account</label><label for="other">Unrelated wrapper<select id="branch" name="branch" data-lookup><option value="">Choose branch</option></select></label><label for="branch">Delivery branch <small>Helper</small></label>');assert.equal(f.proxy().getAttribute('aria-label'),'Client account Delivery branch');
});

test('explicit aria-labelledby and aria-label retain their native precedence and fallback semantics',()=>{
 for(const attrs of ['aria-labelledby="caption qualifier" aria-label="Explicit fallback"','aria-label="Explicit client label"','aria-labelledby="caption qualifier"']){
  const f=fixture(`<span id="caption">Client</span><span id="qualifier">branch</span><label>Other caption<select name="client" data-lookup ${attrs}><option value="">Choose client</option></select></label>`);
  assert.equal(f.proxy().getAttribute('aria-labelledby'),f.source.getAttribute('aria-labelledby'));assert.equal(f.proxy().getAttribute('aria-label'),f.source.getAttribute('aria-label'));
 }
});

test('product lookup names exclude pre-existing errors while validation retains one visible error and valid descriptions',()=>{
 const f=fixture('<label><span>Product</span><input name="productChoice" list="products" required aria-describedby="priceHelp"></label><datalist id="products" data-lookup-values="products"></datalist><p id="priceHelp">Configured price.</p>',false);
 f.ctx.showFieldError(f.source,'Missing product');const old=f.document.querySelector('.field-error').id;f.ctx.lookupAttach(f.source);assert.equal(f.proxy().getAttribute('aria-label'),'Product');assert.equal(f.proxy().getAttribute('aria-describedby'),'priceHelp');f.ctx.showFieldErrors(f.source.form,f.ctx.nativeFormErrors(f.source.form));assert.equal(f.document.querySelectorAll('.field-error').length,1);assert.ok(!f.proxy().getAttribute('aria-describedby').split(' ').includes(old));for(const id of f.proxy().getAttribute('aria-describedby').split(' '))assert.ok(f.document.getElementById(id));assert.ok(f.document.activeElement===f.proxy());
});

test('explicit label strings are set as attributes rather than injected markup',()=>{
 const f=fixture('<label>Client<select name="client" data-lookup aria-label="&lt;img src=x&gt; &amp; client" aria-describedby="help"><option value="">Choose client</option></select></label><p id="help">Help</p>');assert.equal(f.proxy().getAttribute('aria-label'),'<img src=x> & client');assert.equal(f.document.querySelector('img'),null);assert.equal(f.proxy().getAttribute('aria-describedby'),'help');
});

test('an unlabelled bound field uses its canonical name, and a free-text datalist retains its own control',()=>{
 const f=fixture('<select name="contactId" data-lookup><option value="">Choose contact</option></select>');assert.equal(f.proxy().getAttribute('aria-label'),'contactId');
 const free=fixture('<label>Reference<input name="reference" list="references" aria-describedby="referenceHelp"></label><datalist id="references"><option value="Known"></option></datalist><p id="referenceHelp">Any reference</p>');assert.equal(free.proxy(),free.source);assert.equal(free.source.getAttribute('aria-label'),null);assert.equal(free.source.getAttribute('aria-describedby'),'referenceHelp');
});

test('label extraction never visits the select option subtree',()=>{
 const f=fixture(`<label>Named contact<select name="contact" data-lookup>${choices}</select></label>`,false);Object.defineProperty(f.source,'childNodes',{get(){throw Error('Option subtree must not be traversed');}});assert.equal(f.ctx.lookupLabelText(f.source.closest('label'),f.source),'Named contact');
});
