import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import {installLookupDom} from './helpers/lookup-dom.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fixture(){
 const document=dom();installNativeFormControls(document);document.addEventListener=()=>{};
 const actor={user_id:'owner'},calls=[],effects=[],ctx=vm.createContext({document,me:actor,busy:false,actionFeedbackEpoch:1,crypto:{randomUUID:()=> 'new-id'},recordsLockedText:'Read only',canEditRecords:()=>true,
  esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),actionFeedbackReference:node=>({node}),actionFeedbackShow:(_ref,text,_kind,target)=>{target.textContent=text;},actionFeedbackRefuse:(_button,target)=>{target.textContent='Busy';},actionFeedbackRememberDialog(){},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:args.p_id,revision:args.p_revision+1}};}},catalogIsActive:()=>true,catalogSaveContext:()=>{const actor=ctx.me;return {current:()=>ctx.me===actor};},refreshCatalogSavedProduct:async(...args)=>effects.push(args),products:[],catalogSelectedProduct:''});
 installWorkspaceDialogFixture(ctx);vm.runInContext(read('client-rules.js'),ctx);vm.runInContext(read('app.js').split('\n').find(line=>line.startsWith('function field(')),ctx);vm.runInContext(read('action-forms.js'),ctx);
 ctx.run=async(fn,options)=>{try{await fn()}catch(error){options.errorTarget.textContent=error.message;}};
 const form=document.querySelector('form'),dialog=document.querySelector('dialog'),field=name=>form.elements.namedItem(name),submit=()=>form.events.submit[0].fn({preventDefault(){}});
 return {ctx,document,form,dialog,actor,calls,effects,field,submit,error:()=>document.querySelector('#actionError').textContent,blur:name=>dispatchFocusout(field(name)),open:(fields,fn)=>ctx.actionForm('Edit',fields,fn)};
}

test('the custom submit gate collects native validity, whitespace and trimmed length errors without calling the writer',async()=>{
 const f=fixture();let writes=0;f.open('<label>Name<input name="name" required value="   "></label><label>Reason<textarea name="reason" minlength="5"> abc </textarea></label><label>Email<input name="email" type="email" value="bad"></label>',()=>writes++);f.field('email')._nativeError='Enter an email address.';
 assert.equal(f.form.noValidate,true);await f.submit();assert.equal(writes,0);assert.equal(f.error(),'3 fields need attention');assert.equal(f.document.activeElement,f.field('name'));assert.equal(f.field('name').scrolledIntoView.block,'center');assert.equal(f.field('reason').value,' abc ');assert.equal(f.form.querySelectorAll('.field-error').length,3);
});

test('native constraint messages for type, range, step, pattern, date and custom validity remain authoritative',()=>{
 const f=fixture();f.open('<label>Value<input name="value"></label>',()=>{});const control=f.field('value');
 for(const message of ['Enter an email address.','Enter a URL.','Value must be 1 or more.','Use a valid step.','Match the required pattern.','Choose a later date.']){control._nativeError=message;assert.equal(f.ctx.nativeFieldError(control),message);}
 control.setCustomValidity('<b>Server-compatible constraint</b>');assert.equal(f.ctx.nativeFieldError(control),'<b>Server-compatible constraint</b>');f.ctx.showFieldError(control,f.ctx.nativeFieldError(control));assert.equal(f.form.querySelector('b'),null);
 control._nativeError='';control.setCustomValidity('');assert.equal(f.ctx.nativeFieldError(control),'');
});

test('length checks include programmatic values while disabled, readonly and hidden controls retain native exemption',async()=>{
 const f=fixture();f.open('<label>Text<input name="text" maxlength="3" value="long"></label><label>Disabled<input name="disabled" disabled required></label><label>Readonly<input name="readonly" required></label><input name="hidden" type="hidden" required>',()=>{});f.field('readonly').readOnly=true;
 const errors=f.ctx.nativeFormErrors(f.form);assert.equal(errors.size,1);assert.match(errors.get(f.field('text')),/no more than 3/);f.field('text').value='';assert.equal(f.ctx.nativeFormErrors(f.form).size,0);
});

test('blur keeps focus and help, validates only the departed field, and clears only its own error',async()=>{
 const f=fixture();f.open('<label>First<input name="first" required aria-describedby="help"></label><label>Second<input name="second" required></label><p id="help">Hint</p>',()=>{});f.field('second').focus();f.blur('first');assert.equal(f.document.activeElement,f.field('second'));assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.match(f.field('first').getAttribute('aria-describedby'),/^help /);assert.equal(f.field('first').value,'');f.field('first').value='Ready';f.blur('first');assert.equal(f.field('first').getAttribute('aria-describedby'),'help');assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('repeated names are distinct native fields and submit focus follows DOM order',async()=>{
 const f=fixture();f.open('<label>First<input name="item" required></label><label>Second<input name="item" required></label>',()=>{});await f.submit();const inputs=f.form.querySelectorAll('input');assert.equal(f.error(),'2 fields need attention');assert.equal(f.document.activeElement,inputs[0]);assert.notEqual(inputs[0].getAttribute('aria-describedby'),inputs[1].getAttribute('aria-describedby'));
});

test('reopening the shared action dialog keeps one focusout listener for the current fields',()=>{
 const f=fixture(),submit=()=>{};let shown=0;const show=f.ctx.showFieldError;f.ctx.showFieldError=(...args)=>{shown++;return show(...args);};
 for(let i=0;i<4;i++)f.open('<label>Name<input name="name" required></label>',submit);
 assert.equal(f.form.events.focusout.length,1);f.blur('name');assert.equal(shown,1);assert.equal(f.form.querySelectorAll('.field-error').length,1);
 f.field('name').value='Valid';f.blur('name');assert.equal(shown,2);assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('successful basic product save retains exact trimmed writer args, ID, revision and retained refresh',async()=>{
 const f=fixture();f.ctx.openProductForm({id:'product',revision:4,name:'Original',sku:'Code'});f.field('name').value='  Updated  ';f.field('sku').value=' New ';await f.submit();assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{name:'save_product',args:{p_id:'product',p_revision:4,p_name:'Updated',p_sku:'New'}}]);assert.equal(f.effects.length,1);assert.equal(f.dialog.open,false);
});

test('new product retains its stable ID and refuses invalid values before any RPC',async()=>{
 const f=fixture();f.ctx.openProductForm();await f.submit();assert.equal(f.calls.length,0);f.field('name').value='Reagent';await f.submit();assert.equal(f.calls[0].name,'add_product');assert.equal(f.calls[0].args.p_id,'new-id');assert.equal(f.calls[0].args.p_source.origin,'manual');
});

test('organization Title Case rule is available on blur and blocks submit before its unchanged callback',async()=>{
 const f=fixture();f.ctx.organizationSaveContext=()=>({current:()=>true});f.ctx.openOrganizationForm({id:'org',name:'lowercase clinic',location:'Arusha',type:'Clinic'});f.blur('name');assert.match(f.field('name').closest('label').querySelector('.field-error').textContent,/Title Case/);await f.submit();assert.equal(f.calls.length,0);assert.equal(f.error(),'1 field needs attention');
 f.field('name').value='Lowercase Clinic';f.field('name').events.input[0].fn();f.blur('name');assert.equal(f.ctx.nativeFormErrors(f.form).size,0);assert.equal(f.field('name').value,'Lowercase Clinic');
});

test('shared form labels mark optional controls without altering labels, values or required controls',()=>{
 const f=fixture();f.open('<label><span>Name</span><input name="name" required value="Keep"></label><label>Notes<textarea name="notes">Keep notes</textarea></label><label><span>Code (optional)</span><input name="code" value="Code"></label>',()=>{});assert.equal(f.field('name').closest('label').textContent,'Name');assert.match(f.field('notes').closest('label').textContent,/Notes \(optional\)/);assert.equal(f.field('code').closest('label').textContent,'Code (optional)');assert.equal(f.field('name').value,'Keep');assert.equal(f.field('notes').value,'Keep notes');
});

test('replacement actor/epoch and old blur closure cannot submit or mark a newly opened form',async()=>{
 for(const change of ['actor','epoch']){const f=fixture();let writes=0;f.open('<label>Name<input name="name" required></label>',()=>writes++);if(change==='actor')f.ctx.me={...f.actor};else f.ctx.actionFeedbackEpoch++;f.blur('name');await f.submit();assert.equal(writes,0);assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.match(f.error(),/Login changed/);}
 const f=fixture();f.open('<label>Old<input name="old" required></label>',()=>{});const old=f.field('old');f.open('<label>New<input name="new" required></label>',()=>{});dispatchFocusout(old);assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('shared action blur and submit use the actual lookup canonical constraint and pass only the selected value',async()=>{
 const f=fixture();let saved;f.open('<label>Client<select name="client" required data-lookup><option value="">Choose client</option><option value="client-id">Clinic</option></select></label>',values=>{saved=values.client;});f.ctx.setWorkspacePopover=(node,open)=>{node.hidden=!open;};installLookupDom(f.ctx);const source=f.field('client');f.ctx.lookupAttach(source);const proxy=source._lookupBox.querySelector('input.lookup-input');dispatchFocusout(proxy);assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(proxy.getAttribute('aria-invalid'),'true');assert.equal(source.getAttribute('aria-invalid'),null);await f.submit();assert.equal(f.error(),'1 field needs attention');assert.ok(f.document.activeElement===proxy);assert.equal(saved,undefined);
 f.ctx.lookupPick(source._lookupBox,{value:'client-id',label:'Clinic'});dispatchFocusout(proxy);assert.equal(f.form.querySelectorAll('.field-error').length,0);await f.submit();assert.equal(saved,'client-id');assert.equal(f.dialog.open,false);
});
