import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {installLookupDom} from './helpers/lookup-dom.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({unlisted=false}={}){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 Object.defineProperty(prototype,'inert',{configurable:true,get(){return !!this._inert;},set(value){this._inert=value;}});
 prototype.getBoundingClientRect=()=>({left:40,top:40,bottom:84,width:180,height:44});prototype.getClientRects=function(){return this.isConnected?[{}]:[];};
 Object.defineProperties(prototype,{type:{configurable:true,get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}},form:{configurable:true,get(){return this.closest('form');}},classList:{configurable:true,get(){return {add:name=>this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' '),remove:name=>this.className=this.className.split(' ').filter(value=>value!==name).join(' '),contains:name=>this.className.split(' ').includes(name)};}},style:{configurable:true,get(){return this._style||=(Object.assign({setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}},{width:''}));}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};
 document.body.innerHTML='<div id="notice"></div><main id="content"><button id="countRefresh">Refresh</button><div id="entry"></div></main>';
 const calls=[],messages=[],focus=[],actor={user_id:'staff',role:'staff'};let sequence=0,renders=0;
 class Fields{constructor(form){this.form=form;}get(name){return this.form.querySelector(`[name="${name}"]`)?.value??null;}}
 const ctx=vm.createContext({document,$:selector=>document.querySelector(selector),FormData:Fields,me:actor,busy:false,getComputedStyle:()=>({visibility:'visible'}),clearTimeout(){},setTimeout:()=>1,sessionLoadEpoch:1,view:'stockcount',esc,window:{ERP_CONFIG:{},addEventListener(){}},CSS:{escape:value=>value},crypto:{randomUUID:()=> 'request-'+(++sequence)},message:text=>messages.push(text),run:fn=>fn(),client:{rpc:async(name,args)=>{calls.push({name,args:plain(args)});return f.write?f.write(name,args):{data:{id:args.p_id,session_id:args.p_session_id,godown:args.p_godown,code:args.p_code||null,unlisted:args.p_unlisted,quantity:args.p_quantity,unit:args.p_unit,condition:args.p_condition,batch:args.p_batch,expiry:args.p_expiry,notes:args.p_notes,counted_by:actor.user_id,counted_at:'2026-10-30T10:00:00.123456Z',status:'recorded',version:1}};}}});
 for(const file of ['client-rules.js','stock-count.js'])vm.runInContext(read(file),ctx);
 const get=code=>vm.runInContext(code,ctx);
 get(`countActor=me;countPageReady=true;countGodown='Haadi';countSessions=[{id:'session',status:'open',version:4}];countCatalogue=[{code:'AN-00001',product:'Fictional reagent',company:'Example maker',specification:'Bottle',category:'Consumable'}];countPicked=${unlisted?"'unlisted'":"'AN-00001'"};`);
 document.querySelector('#entry').innerHTML=ctx.countPickedForm(unlisted?'unlisted':get('countCatalogue[0]'));
 ctx.renderStockCount=()=>renders++;
 ctx.bindStockCount();
 const app=read('app.js');vm.runInContext(read('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),ctx);
 const form=document.querySelector('#countForm'),field=name=>form.querySelector(`[name="${name}"]`);
 field('quantity').value='1.001';field('unit').value='KG';field('condition').value='good';if(unlisted)field('unlisted').value='Fictional product';
 const oldFocus=prototype.focus;prototype.focus=function(options){focus.push({node:this,summary:form.querySelector('#countFormError').textContent});return oldFocus.call(this,options);};
 const f={ctx,get,document,form,actor,calls,messages,focus,field,write:null,blur:control=>dispatchFocusout(control),summary:()=>form.querySelector('#countFormError').textContent,submit:()=>form.onsubmit({preventDefault(){}}),get ids(){return sequence},get renders(){return renders}};
 return f;
}

test('count entry keeps labels and native attributes with one top summary before editable controls',()=>{
 const f=fixture({unlisted:true});assert.equal(f.form.noValidate,true);assert.ok(f.form.innerHTML.indexOf('id="countFormError"')<f.form.innerHTML.indexOf('name="unlisted"'));assert.equal(f.form.querySelectorAll('#countFormError').length,1);
 for(const name of ['unlisted','quantity','unit','condition','batch','expiry','notes'])assert.ok(f.field(name).closest('label'));
 assert.equal(f.field('quantity').type,'number');assert.equal(f.field('quantity').getAttribute('min'),'0');assert.equal(f.field('quantity').getAttribute('max'),'10000000');assert.equal(f.field('quantity').getAttribute('step'),'any');assert.equal(f.field('expiry').getAttribute('min'),'2000-01-01');
});

test('standard focusout validates only the departed control and preserves value, focus and help',()=>{
 const f=fixture({unlisted:true}),quantity=f.field('quantity');f.field('unlisted').value='';quantity.value='1.0001';quantity.setAttribute('aria-describedby','quantity-help');f.field('notes').focus();f.blur(quantity);
 assert.equal(quantity.value,'1.0001');assert.equal(f.document.activeElement,f.field('notes'));assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.match(quantity.closest('label').textContent,/at most three decimal places/);assert.match(quantity.getAttribute('aria-describedby'),/^quantity-help /);assert.equal(f.field('unlisted').getAttribute('aria-invalid'),null);assert.equal(f.calls.length,0);
 quantity.value='1.001';f.blur(quantity);assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(quantity.getAttribute('aria-describedby'),'quantity-help');assert.equal(quantity.getAttribute('aria-invalid'),null);
});

test('submit counts native and exact domain errors before DOM-order first focus, without allocating a write ID',async()=>{
 const f=fixture({unlisted:true});f.field('unlisted').value='  ';f.field('quantity').value='1e3';f.field('expiry')._nativeError='Choose a date on or after 01/01/2000.';await f.submit();
 assert.equal(f.summary(),'3 fields need attention');assert.equal(f.focus.at(-1).summary,'3 fields need attention');assert.equal(f.document.activeElement,f.field('unlisted'));assert.equal(f.field('unlisted').scrolledIntoView.block,'center');assert.equal(f.field('quantity').value,'1e3');assert.equal(f.calls.length,0);assert.equal(f.ids,0);assert.equal(f.get('countPendingSave'),null);
 f.field('unlisted').value='  Item  ';f.blur(f.field('unlisted'));assert.equal(f.summary(),'2 fields need attention');f.field('quantity').value='0';f.blur(f.field('quantity'));assert.equal(f.summary(),'1 field needs attention');f.field('expiry')._nativeError='';f.blur(f.field('expiry'));assert.equal(f.summary(),'');
});

test('quantity validation and writer share the existing exact thousandths rules',()=>{
 const f=fixture(),quantity=f.field('quantity');
 for(const value of ['0','0.001','1.001','1.005','1.230','9999999.999','10000000','10000000.000']){quantity.value=value;assert.equal(f.ctx.countFieldError(quantity),'',value);assert.equal(f.ctx.countFormValues(f.form).quantity,Number(value));}
 for(const value of ['0.0001','1.0000','-1','-0.001','10000000.001','10000001','99999999999999999','',' ','Infinity','NaN','1e3']){quantity.value=value;assert.notEqual(f.ctx.countFieldError(quantity),'',value);assert.throws(()=>f.ctx.countFormValues(f.form),undefined,value);assert.equal(quantity.value,value);}
});

test('native date, custom validity and optional length errors remain visible without HTML injection',async()=>{
 const f=fixture(),expiry=f.field('expiry');expiry._nativeError='<img src=x> Date is before the minimum.';f.field('batch').value='b'.repeat(81);f.field('notes').value='n'.repeat(1001);await f.submit();assert.equal(f.summary(),'3 fields need attention');assert.equal(f.document.activeElement,f.field('batch'));assert.equal(f.form.querySelector('img'),null);assert.match(expiry.closest('label').textContent,/<img src=x>/);assert.equal(f.calls.length,0);
 expiry._nativeError='';f.field('batch').value='';f.field('notes').value='';expiry.setCustomValidity('Date requires review');assert.equal(f.ctx.countFieldError(expiry),'Date requires review');expiry.setCustomValidity('');f.blur(expiry);assert.equal(expiry.getAttribute('aria-invalid'),null);
});

test('disabled, readonly and hidden controls keep their native exclusion semantics',()=>{
 const f=fixture(),quantity=f.field('quantity');quantity.value='invalid';for(const state of ['disabled','readOnly']){quantity[state]=true;assert.equal(f.ctx.countFormErrors(f.form).size,0);quantity[state]=false;}
 f.field('batch').setAttribute('type','hidden');f.field('batch').value='b'.repeat(100);quantity.value='1';assert.equal(f.ctx.countFormErrors(f.form).size,0);assert.equal(quantity.value,'1');
});

test('actual unit lookup validates the visible proxy once and retains the canonical selected unit',async()=>{
 const f=fixture();Object.assign(f.ctx,{setWorkspacePopover:(node,open)=>{node.hidden=!open;}});installLookupDom(f.ctx);const unit=f.field('unit');for(const option of unit.options)option.value=option.textContent;f.ctx.lookupAttach(unit);const proxy=unit._lookupBox.querySelector('input.lookup-input');proxy.focus();proxy.value='Not a unit';proxy.dispatchEvent(new f.ctx.Event('input',{bubbles:true}));f.blur(proxy);await f.submit();
 assert.equal(f.summary(),'1 field needs attention');assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.document.activeElement,proxy);assert.equal(unit.getAttribute('aria-invalid'),null);assert.equal(proxy.value,'Not a unit');assert.equal(f.calls.length,0);
 f.ctx.lookupPick(unit._lookupBox,{value:'KG',label:'KG'});f.blur(proxy);assert.equal(f.summary(),'');assert.equal(unit.value,'KG');assert.equal(f.ctx.countFormErrors(f.form).size,0);
});

test('valid named and unlisted submissions retain the exact writer arguments and receipt semantics',async()=>{
 for(const unlisted of [false,true]){const f=fixture({unlisted});f.field('quantity').value='1.005';f.field('batch').value=' Lot A ';f.field('expiry').value='2027-01-01';f.field('notes').value=' Count <notes> ';if(unlisted)f.field('unlisted').value='  Unlisted <item>  ';await f.submit();
  assert.deepEqual(f.calls,[{name:'record_stock_count',args:{p_id:'request-1',p_session_id:'session',p_godown:'Haadi',p_code:unlisted?'':'AN-00001',p_unlisted:unlisted?'Unlisted <item>':'',p_quantity:1.005,p_unit:'KG',p_batch:'Lot A',p_expiry:'2027-01-01',p_condition:'good',p_notes:'Count <notes>'}}]);assert.equal(f.get('countPendingSave'),null);assert.equal(f.get('countEntries[0].quantity'),1.005);assert.equal(f.form.dataset.countSaved,'true');assert.equal(f.form.inert,true);assert.equal(f.renders,1);
 }
});

test('uncertain count writes retain typed values and the same request UUID for the existing explicit retry',async()=>{
 const f=fixture();f.write=()=>{throw Error('Response unavailable');};await f.submit();assert.equal(f.summary(),'Response unavailable');assert.equal(f.form.inert,false);assert.equal(f.form.querySelector('#countSave').disabled,false);assert.equal(f.field('quantity').value,'1.001');const request=f.calls[0].args.p_id;f.write=null;await f.submit();assert.equal(f.calls[1].args.p_id,request);assert.equal(f.ids,1);assert.equal(f.get('countEntries.length'),1);
});

test('rebinding a retained form removes the old listener and captures the latest request',()=>{
 const f=fixture(),first=f.form.events.focusout[0].fn;f.get('countPageRequest++');f.ctx.bindStockCount(true);assert.equal(f.form.events.focusout.length,1);assert.notEqual(f.form.events.focusout[0].fn,first);f.field('quantity').value='1.0001';f.blur(f.field('quantity'));assert.equal(f.form.querySelectorAll('.field-error').length,1);f.field('quantity').value='1.001';f.blur(f.field('quantity'));assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('stale actor, session, count request, selected item, godown, route and form cannot validate or submit',async()=>{
 for(const mode of ['actor','sessionEpoch','countEpoch','request','picked','godown','session','view','tab','form']){
  const f=fixture();f.field('quantity').value='1.0001';if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='sessionEpoch')f.ctx.sessionLoadEpoch++;else if(mode==='countEpoch')f.get('countEpoch++');else if(mode==='request')f.get('countPageRequest++');else if(mode==='picked')f.get("countPicked='unlisted'");else if(mode==='godown')f.get("countGodown='Main store'");else if(mode==='session')f.get("countSessions=[{id:'other-session',status:'open'}]");else if(mode==='view')f.ctx.view='personal';else if(mode==='tab')f.get("countTab='review'");else{f.form.id='oldCountForm';f.document.querySelector('#entry').insertAdjacentHTML('beforeend','<form id="countForm"><input name="quantity" value="New count"></form>');}
  f.blur(f.field('quantity'));await f.submit();assert.equal(f.form.querySelectorAll('.field-error').length,0,mode);assert.equal(f.calls.length,0,mode);assert.equal(f.ids,0,mode);
 }
});

test('late rejected writes do not mark a replacement editor or unlock the old session controls',async()=>{
 for(const mode of ['actor','sessionEpoch','form']){const f=fixture(),held=deferred();f.write=()=>held.promise;const saving=f.submit(),button=f.form.querySelector('#countSave');if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='sessionEpoch')f.ctx.sessionLoadEpoch++;else{f.form.id='oldCountForm';f.document.querySelector('#entry').insertAdjacentHTML('beforeend','<form id="countForm"><p id="replacementError">Current editor</p></form>');}held.reject(Error('Old failure'));await saving;assert.equal(f.summary(),'');assert.doesNotMatch(f.document.body.textContent,/Old failure/);assert.equal(f.ctx.busy,false);assert.equal(button.disabled,true);if(mode==='form')assert.equal(f.document.querySelector('#replacementError').textContent,'Current editor');}
});

test('saving and confirmed forms do not change their field errors on blur',()=>{
 for(const state of ['saving','countSaved']){const f=fixture();f.form.dataset[state]='true';f.field('quantity').value='bad';f.blur(f.field('quantity'));assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.calls.length,0);}
});


test('actual shared run refuses a busy save before disabling it and preserves the pressed origin',async()=>{
 const f=fixture(),button=f.form.querySelector('#countSave'),label=button.textContent;f.ctx.busy=true;await f.submit();assert.equal(f.calls.length,0);assert.equal(f.ids,0);assert.equal(button.disabled,false);assert.equal(button.textContent,label);assert.match(f.summary(),/Another action is still running/);assert.equal(f.form.inert,false);
 f.ctx.busy=false;const held=deferred();f.write=()=>held.promise;button.focus();const pending=f.submit();assert.equal(f.calls.length,1);assert.equal(f.get('actionFeedbackActive.origin.node')===button,true);assert.equal(f.get('actionFeedbackActive.errorTarget')===f.form.querySelector('#countFormError'),true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.classList.contains('action-is-busy'),true);assert.equal(button.textContent,label);assert.equal(button.disabled,true);assert.equal(f.form.inert,true);await f.submit();assert.equal(f.calls.length,1);
 held.resolve({error:{code:'P0001',message:'This count session was closed.'}});await pending;assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);assert.equal(button.textContent,label);assert.equal(f.form.inert,false);assert.match(f.summary(),/count session was closed/);assert.equal(f.ctx.busy,false);
});

test('actual shared run preserves caller-owned disabled state after a confirmed count',async()=>{
 const f=fixture(),button=f.form.querySelector('#countSave');await f.submit();assert.equal(f.calls.length,1);assert.equal(f.form.dataset.countSaved,'true');assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);assert.equal(f.ctx.busy,false);await f.submit();assert.equal(f.calls.length,1);
});
