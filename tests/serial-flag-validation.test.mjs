import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('serial-numbers.js'),rules=read('client-rules.js'),runSource=read('app.js').match(/async function run\(fn\)\{[^\n]+/)[0];
const tick=()=>new Promise(setImmediate),copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
async function fixture(user={user_id:'owner',role:'owner'}){
 const document=dom();installNativeFormControls(document);document.body.innerHTML='<main id="content"><button id="inventoryRefresh">Refresh</button></main><button id="external">Other action</button>';
 const calls=[],messages=[],feedback=[];let write=null,reads=0;
 const product={id:'product-one',name:'Fictional reagent',sku:'R-1'},choice='Fictional reagent · R-1';
 class FormData{constructor(form){this.form=form}get(name){return this.form.elements[name]?.value??null}}
 const c=vm.createContext({document,FormData,me:user,view:'inventory',inventoryEpoch:3,sessionLoadEpoch:1,busy:false,products:[product],$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  inventoryClassification:()=>({category:'consumables'}),inventoryProduct:()=>product,inventoryProductChoices:()=>'<option value="'+choice+'"></option>',inventoryProductFromChoice:text=>text===choice?product:null,
  message:(...args)=>messages.push(args),friendlyError:error=>error.message,replayQueuedNavigation(){},actionFeedbackBegin:options=>{feedback.push(options);return null},actionFeedbackRefuse:(_button,target)=>{target.textContent='Another action is still running.'},
  client:{from:()=>({select:async()=>{reads++;return {data:[]}}}),rpc:async(name,args)=>{calls.push({name,args:copy(args)});return write?write(name,args):{data:[]}}}});
 vm.runInContext(rules+'\n'+runSource+'\n'+source,c);await c.decorateSerialTools();
 const form=()=>document.querySelector('#serialFlag');
 const submit=()=>{const event={preventDefault(){},target:form(),submitter:form().querySelector('[type="submit"]')};return form().onsubmit?form().onsubmit(event):form().events.submit[0].fn(event)};
 return {c,document,calls,messages,feedback,choice,form,input:()=>form()?.elements.product,button:()=>form()?.querySelector('[type="submit"]'),summary:()=>form()?.querySelector('[role="alert"]'),submit,setWrite:fn=>write=fn,reads:()=>reads,stale(mode){if(mode==='actor')c.me={...c.me};else if(mode==='role')c.me.role='staff';else if(mode==='epoch')c.inventoryEpoch++;else if(mode==='view')c.view='sales';else if(mode==='root')document.querySelector('#content').replaceWith(document.createElement('main'));else form().remove();}};
}
test('serial tools provide visible associated labels and keep search read-only with its exact payload',async()=>{
 const f=await fixture(),search=f.document.querySelector('#serialSearch'),input=search.elements.serial;
 assert.equal(input.closest('label').querySelector('span').textContent,'Serial number');assert.equal(f.input().closest('label').querySelector('span').textContent,'Product');
 assert.equal(f.form().firstElementChild,f.summary());assert.equal(f.form().noValidate,true);
 input.value='  Ab-42  ';search.onsubmit({preventDefault(){},target:search});await tick();assert.deepEqual(f.calls,[{name:'find_serial',args:{p_serial:'  Ab-42  '}}]);
});
for(const value of ['', '   ', 'Partial product'])test('serial flag rejects '+JSON.stringify(value)+' before saving and focuses the field',async()=>{
 const f=await fixture();f.input().value=value;f.button().focus();await f.submit();assert.equal(f.calls.length,0);assert.equal(f.summary().textContent,'1 field needs attention');assert.equal(f.document.activeElement,f.input());assert.equal(f.input().scrolledIntoView.block,'center');assert.equal(f.input().value,value);assert.equal(f.button().disabled,false);
});
test('serial flag preserves native/custom errors as safe text even for a valid product',async()=>{
 for(const custom of [false,true]){const f=await fixture();f.input().value=f.choice;if(custom)f.input().setCustomValidity('<img src=x> Check product');else f.input()._nativeError='Native product constraint';await f.submit();const error=f.form().querySelector('.field-error');assert.equal(f.calls.length,0);assert.equal(error.querySelector('img'),null);assert.match(error.textContent,custom?/<img src=x>/:/Native product constraint/);}
});
test('ordinary product blur updates inline errors without changing focus or calling the policy API',async()=>{
 const f=await fixture();f.input().setAttribute('aria-describedby','product-help');f.input().value='Missing';f.button().focus();dispatchFocusout(f.input());assert.equal(f.summary().textContent,'1 field needs attention');assert.equal(f.document.activeElement,f.button());assert.match(f.input().getAttribute('aria-describedby'),/^product-help field-error-/);
 f.input().value=f.choice;dispatchFocusout(f.input());assert.equal(f.summary().textContent,'');assert.equal(f.form().querySelector('.field-error'),null);assert.equal(f.input().getAttribute('aria-describedby'),'product-help');assert.equal(f.calls.length,0);
});
for(const action of ['submit','external','search'])test('correcting product then focusing '+action+' preserves error geometry until submit',async()=>{
 const f=await fixture(),form=f.form(),input=f.input(),button=f.button(),wait=deferred();dispatchFocusout(input);const error=form.querySelector('.field-error');assert.ok(error);
 input.value='  '+f.choice+'  ';for(const {fn}of form.events.change||[])fn({target:input});dispatchFocusout(input,action==='submit'?button:f.document.querySelector(action==='external'?'#external':'#serialSearch button'));
 assert.equal(form.querySelector('.field-error'),error);assert.equal(f.summary().textContent,'1 field needs attention');f.setWrite(()=>wait.promise);const pending=f.submit();
 assert.deepEqual(f.calls,[{name:'set_product_serial_required',args:{p_product_id:'product-one',p_required:true}}]);assert.equal(form.querySelector('.field-error'),null);assert.equal(f.summary().textContent,'');assert.equal(button.disabled,true);assert.equal(f.c.busy,true);await f.submit();assert.equal(f.calls.length,1);
 wait.resolve({data:[]});await pending;assert.equal(form.isConnected,false);assert.ok(f.form());assert.equal(f.messages.at(-1)[0],'Fictional reagent now needs serial numbers when received and packed.');assert.equal(f.c.busy,false);
});
test('global busy refuses submission before field validation or saving',async()=>{
 const f=await fixture();f.c.busy=true;await f.submit();dispatchFocusout(f.input());assert.equal(f.calls.length,0);assert.equal(f.summary().textContent,'Another action is still running.');assert.equal(f.form().querySelector('.field-error'),null);assert.equal(f.button().disabled,false);
});
for(const mode of ['actor','role','epoch','view','root','form'])test('stale '+mode+' refuses serial validation and save',async()=>{
 const f=await fixture(),form=f.form(),input=f.input(),button=f.button(),handler=form.onsubmit;input.value=f.choice;f.stale(mode);dispatchFocusout(input);await handler({preventDefault(){},target:form,submitter:button});assert.equal(f.calls.length,0);assert.equal(form.querySelector('.field-error'),null);assert.equal(button.disabled,false);
});
for(const mode of ['actor','role','epoch','view','root'])test('late policy response after '+mode+' change cannot refresh or publish success',async()=>{
 const f=await fixture(),form=f.form(),wait=deferred();f.input().value=f.choice;f.setWrite(()=>wait.promise);const pending=f.submit(),reads=f.reads();f.stale(mode);wait.resolve({data:[]});await pending;assert.equal(f.calls.length,1);assert.equal(f.reads(),reads);assert.equal(f.messages.length,0);if(mode!=='root')assert.equal(form.isConnected,true);
});
for(const failure of ['error receipt','rejection'])test('late '+failure+' after the inventory epoch changes stays silent',async()=>{
 const f=await fixture(),wait=deferred();f.input().value=f.choice;f.setWrite(()=>wait.promise.then(()=>{if(failure==='rejection')throw Error('Old policy request failed');return {error:{message:'Old policy request failed'}}}));const pending=f.submit();f.c.inventoryEpoch++;wait.resolve();await pending;assert.equal(f.calls.length,1);assert.equal(f.messages.length,0);assert.equal(f.reads(),1);
});
test('policy rejection retains the selected product and allows the unchanged explicit retry',async()=>{
 const f=await fixture(),form=f.form();f.input().value=f.choice;f.setWrite(()=>({error:{message:'Not permitted by policy'}}));await f.submit();assert.equal(f.form(),form);assert.equal(f.input().value,f.choice);assert.equal(f.button().disabled,false);assert.equal(f.c.busy,false);assert.match(f.messages.at(-1)[0],/Not permitted by policy/);
 f.setWrite(()=>({data:[]}));await f.submit();assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(form.isConnected,false);
});
for(const user of [{user_id:'head',role:'head',department:'stores'},{user_id:'staff',role:'staff',department:'stores'},{user_id:'head',role:'head',department:'sales'}])test('serial flag visibility and writer match '+user.role+' '+user.department,async()=>{
 const f=await fixture(user);if(user.department==='stores'&&user.role==='head'){assert.ok(f.form());f.input().value=f.choice;await f.submit();assert.equal(f.calls[0].name,'set_product_serial_required');}else{assert.equal(f.form(),null);assert.ok(f.document.querySelector('#serialSearch'));assert.equal(f.calls.length,0);}
});
