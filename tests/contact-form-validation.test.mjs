import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {installLookupDom} from './helpers/lookup-dom.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),app=source('app.js');
const valid={id:'contact',revision:0,organization_id:'branch',title:'Mr.',first_name:'Émile',last_name:'Contact',position:'Lab',phone_country:'TZ',country_code:'+255',phone:'712345678',email:'',status:'kept',reason:''};
function fixture(){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),html=Object.getOwnPropertyDescriptor(prototype,'innerHTML'),focus=[],scroll=[],writes=[];
 Object.defineProperties(prototype,{
  id:{get(){return this.attrs.id||''},set(value){this.attrs.id=value}},name:{get(){return this.attrs.name||''}},type:{get(){return this.attrs.type||''}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},
  elements:{get(){const rows=this.querySelectorAll('input,select,textarea');return {namedItem:name=>rows.find(row=>row.name===name)||null};}},
  innerHTML:{get(){return html.get.call(this)},set(value){html.set.call(this,value);for(const select of this.querySelectorAll('select')){const option=select.querySelector('option[selected]')||select.querySelector('option');select.value=option?.getAttribute('value')??option?.textContent??'';}}}
 });
 prototype.removeAttribute=function(name){delete this.attrs[name];};
 prototype.scrollIntoView=function(options){scroll.push({node:this,options});};
 prototype.focus=function(options){document.activeElement=this;focus.push({node:this,options,summary:document.querySelector('#formError')?.textContent});};
 document.body.innerHTML='<dialog id="editor"><form id="editForm"><h2>Edit contact</h2><div id="fields"></div><p id="formError" role="alert"></p><button type="button" id="closeEditor">Close</button><button type="submit">Save contact</button></form></dialog>';
 const actor={user_id:'actor'},organization={id:'branch',name:'Clinic',location:'Arusha',type:'Clinic'},ctx=vm.createContext({document,window:{},Intl,me:actor,editing:null,selected:'branch',actionFeedbackEpoch:1,orgIndex:new Map([['branch',organization]]),childrenByParent:new Map(),rootAccount:o=>o,familyIds:o=>[o.id],missingAccount:o=>o?.name?[]:['Name'],esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),$:selector=>document.querySelector(selector),client:{from:()=>({select(){return this},eq(){return this},single:async()=>({data:{source:null}})})}});
 installWorkspaceDialogFixture(ctx);
 ctx.actionFeedbackReference=node=>({node});ctx.actionFeedbackShow=(_reference,text,_kind,target)=>{target.textContent=text;};
 for(const name of ['phone-rules.js','client-rules.js'])vm.runInContext(source(name),ctx);
 vm.runInContext(app.split('\n').find(line=>line.startsWith('function field(')),ctx);
 vm.runInContext(app.slice(app.indexOf('async function edit(c)'),app.indexOf('async function save(c)')),ctx);
 vm.runInContext(app.slice(app.indexOf('let editSaving=false;'),app.indexOf("document.addEventListener('click',async e=>{",app.indexOf('let editSaving=false;'))),ctx);
 ctx.run=async(fn,options)=>{try{await fn()}catch(error){options.onError?.(error);options.errorTarget.textContent=error.message;}};
 ctx.save=async values=>{ctx.validate(values);writes.push(values);};
 const form=document.querySelector('#editForm'),node=name=>form.elements.namedItem(name),error=name=>node(name).closest('label').querySelector('.field-error');
 form.dataset=new Proxy(form.dataset,{deleteProperty:(_target,key)=>{form.removeAttribute('data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()));return true;}});
 return {ctx,document,form,actor,focus,scroll,writes,node,error,summary:()=>document.querySelector('#formError').textContent,open:async values=>{await ctx.edit({...valid,...values});focus.length=scroll.length=0;},blur:name=>dispatchFocusout(node(name)),submit:()=>form.onsubmit({target:form,submitter:form.querySelector('[type="submit"]'),preventDefault(){}})};
}

test('blur validates only the departed field without changing input, focus or unrelated errors',async()=>{
 const f=fixture();await f.open({first_name:'lowercase',last_name:''});f.node('position').focus();f.focus.length=0;
 f.blur('first_name');assert.match(f.error('first_name').textContent,/capital letter/);assert.equal(f.error('last_name'),null);assert.equal(f.node('first_name').value,'lowercase');assert.equal(f.document.activeElement,f.node('position'));assert.equal(f.focus.length,0);assert.equal(f.scroll.length,0);assert.equal(f.summary(),'');
 const prior=f.error('first_name');f.blur('last_name');assert.equal(f.error('first_name'),prior);assert.match(f.error('last_name').textContent,/required/);
 f.node('first_name').value='Émile';f.blur('first_name');assert.equal(f.error('first_name'),null);assert.ok(f.error('last_name'));assert.equal(f.node('first_name').getAttribute('aria-invalid'),null);
});

test('field errors preserve help descriptions, use text content, and never duplicate nodes or IDs',async()=>{
 const f=fixture();await f.open();const phone=f.node('phone');assert.equal(phone.getAttribute('aria-describedby'),'phoneHint');
 f.ctx.showFieldError(phone,'<img src=x onerror=bad()>');const error=f.error('phone'),id=error.id;assert.equal(error.querySelector('img'),null);assert.equal(error.textContent,'⚠ <img src=x onerror=bad()>');assert.equal(phone.getAttribute('aria-describedby'),'phoneHint '+id);
 f.ctx.showFieldError(phone,'Second message');assert.equal(f.error('phone'),error);assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(phone.getAttribute('aria-describedby'),'phoneHint '+id);
 phone.setAttribute('aria-describedby',phone.getAttribute('aria-describedby')+' extraHelp');f.ctx.showFieldError(phone,'');assert.equal(phone.getAttribute('aria-describedby'),'phoneHint extraHelp');assert.equal(phone.getAttribute('aria-invalid'),null);
 f.ctx.showFieldError(f.node('first_name'),'Name');f.ctx.showFieldError(f.node('last_name'),'Name');assert.notEqual(f.error('first_name').id,f.error('last_name').id);
});

test('the reused contact editor removes its previous focusout listener before binding the next record',async()=>{
 const f=fixture();let shown=0;const show=f.ctx.showFieldError;f.ctx.showFieldError=(...args)=>{shown++;return show(...args);};
 await f.open({first_name:'old'});const old=f.node('first_name');
 for(let i=0;i<3;i++)await f.open({id:'contact-'+i,first_name:'lowercase'});
 assert.equal(f.form.events.focusout.length,1);dispatchFocusout(old);assert.equal(shown,0);
 f.blur('first_name');assert.equal(shown,1);assert.equal(f.form.querySelectorAll('.field-error').length,1);
 f.node('first_name').value='Correct';f.blur('first_name');assert.equal(shown,2);assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('submit writes the count above fields before scrolling and focusing the first bad field in DOM order',async()=>{
 const f=fixture();await f.open({first_name:'lowercase',last_name:''});await f.submit();
 assert.equal(f.summary(),'2 fields need attention');assert.equal(f.form.children.indexOf(f.document.querySelector('#formError'))<f.form.children.indexOf(f.document.querySelector('#fields')),true);assert.equal(f.focus[0].node,f.node('first_name'));assert.equal(f.focus[0].summary,'2 fields need attention');assert.equal(f.scroll[0].node,f.node('first_name'));assert.equal(f.scroll[0].options.block,'center');assert.equal(f.focus[0].options.preventScroll,true);assert.equal(f.writes.length,0);assert.equal(f.document.querySelector('#editor').open,true);
 f.node('first_name').value='Émile';f.blur('first_name');assert.equal(f.summary(),'1 field needs attention');f.node('last_name').value='Contact';f.blur('last_name');assert.equal(f.summary(),'');
 await f.submit();assert.equal(f.writes.length,1);assert.equal(f.document.querySelector('#editor').open,false);
});

test('shared submit presentation follows DOM order rather than error-map insertion order',async()=>{
 const f=fixture();await f.open();f.ctx.showFieldErrors(f.form,{last_name:'Last',first_name:'First'});assert.equal(f.document.activeElement,f.node('first_name'));assert.equal(f.scroll.length,1);
});

test('country changes revalidate touched phone/code only and retain the national phone value',async()=>{
 const f=fixture();await f.open();f.node('phone_country').value='US';f.node('phone_country').onchange();assert.equal(f.node('country_code').value,'+1');assert.equal(f.error('phone'),null);assert.equal(f.node('phone').value,'712345678');
 f.blur('phone');assert.match(f.error('phone').textContent,/10 digits/);f.blur('country_code');f.node('phone_country').value='TZ';f.node('phone_country').onchange();assert.equal(f.error('phone'),null);assert.equal(f.node('phone').value,'712345678');assert.equal(f.node('country_code').value,'+255');assert.equal(f.focus.length,0);
 f.node('phone_country').value='';f.node('phone_country').onchange();assert.match(f.error('country_code').textContent,/Calling code/);assert.equal(f.error('phone_country'),null);assert.equal(f.node('phone').getAttribute('aria-describedby'),'phoneHint');
});

test('existing incorrect-record exemptions and reason requirements remain unchanged',async()=>{
 const f=fixture();await f.open({revision:3,status:'incorrect',reason:'Left the company',first_name:'',phone:''});f.blur('first_name');f.blur('phone');assert.equal(f.form.querySelectorAll('.field-error').length,0);await f.submit();assert.equal(f.writes.length,1);
 assert.throws(()=>f.ctx.validate({...valid,revision:3,status:'incorrect',reason:'',first_name:''}),error=>Object.keys(error.fields).join(',')==='reason');
 assert.throws(()=>f.ctx.validate({...valid,revision:0,status:'incorrect',reason:'Check',first_name:''}),error=>!!error.fields.first_name);
});

test('optional email, numbering rules and account completeness use the original domain errors',async()=>{
 const f=fixture();await f.open();f.blur('email');assert.equal(f.error('email'),null);f.node('email').value='invalid';f.blur('email');assert.match(f.error('email').textContent,/valid email/);
 f.node('phone').value='123456789';f.blur('phone');assert.match(f.error('phone').textContent,/numbering plan/);f.node('phone').value='712 345 678';f.blur('phone');assert.match(f.error('phone').textContent,/digits only/);
 f.ctx.orgIndex.set('branch',{id:'branch'});f.blur('organization_id');assert.match(f.error('organization_id').textContent,/Complete the branch profile first/);
});

test('stale actor, old editor closures and pending saves cannot change field feedback or calling code',async()=>{
 for(const change of ['actor','editor','saving','closed']){
  const f=fixture();await f.open({first_name:'lowercase'});const old=f.node('phone_country');
  if(change==='actor')f.ctx.me={...f.actor};else if(change==='editor')await f.open();else if(change==='saving')vm.runInContext('editSaving=true',f.ctx);else f.document.querySelector('#editor').close();
  old.value='US';old.onchange();dispatchFocusout(old);assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.node('country_code').value,'+255');
 }
});

test('a server error is retained when later blur occurs after an earlier invalid submit',async()=>{
 const f=fixture();await f.open({first_name:''});await f.submit();f.node('first_name').value='Émile';f.ctx.save=async()=>{throw Error('Permission denied')};await f.submit();assert.equal(f.summary(),'Permission denied');f.blur('first_name');assert.equal(f.summary(),'Permission denied');assert.equal(f.writes.length,0);
});

test('a delayed save cannot close or mark a replacement contact in the same shared editor',async()=>{
 for(const reject of [false,true]){
  const f=fixture();await f.open();let release;f.ctx.save=()=>new Promise((resolve,no)=>{release=()=>reject?no(Object.assign(Error('Old field error'),{fields:{first_name:'Old name'}})):resolve();});
  const saving=f.submit();await f.open({id:'replacement',first_name:'Replacement'});const fields=f.document.querySelector('#fields').firstElementChild;release();await saving;
  assert.equal(f.document.querySelector('#editor').open,true);assert.equal(f.document.querySelector('#fields').firstElementChild,fields);assert.equal(f.node('first_name').value,'Replacement');assert.equal(f.summary(),'');assert.equal(f.form.querySelectorAll('.field-error').length,0);
 }
});

test('actual enhanced contact select blur uses its canonical name and retains actor/editor guards',async()=>{
 const f=fixture();await f.open();f.ctx.setWorkspacePopover=(node,open)=>{node.hidden=!open;};installLookupDom(f.ctx);const country=f.node('phone_country');f.ctx.lookupAttach(country);const proxy=country._lookupBox.querySelector('input.lookup-input');country.value='';f.node('phone').focus();dispatchFocusout(proxy);assert.equal(proxy.name,'');assert.match(f.error('phone_country').textContent,/Choose a country/);assert.equal(f.document.activeElement,f.node('phone'));assert.equal(country.getAttribute('aria-invalid'),null);assert.equal(proxy.getAttribute('aria-invalid'),'true');
 f.ctx.lookupPick(country._lookupBox,{value:'TZ',label:'Tanzania (+255)'});dispatchFocusout(proxy);assert.equal(f.error('phone_country'),null);assert.equal(country.value,'TZ');assert.equal(f.node('country_code').value,'+255');f.ctx.me={...f.actor};country.value='';dispatchFocusout(proxy);assert.equal(f.error('phone_country'),null);assert.equal(f.writes.length,0);
});

for(const destination of ['submit','external'])test(`contact correction keeps the ${destination} action stable through blur and submits once`,async()=>{
 const f=fixture();await f.open({first_name:'lowercase'});await f.submit();const input=f.node('first_name'),error=f.error('first_name'),summary=f.summary();input.value='Correct';const action=destination==='submit'?f.form.querySelector('[type="submit"]'):f.document.createElement('button');if(destination==='external')f.document.body.append(action);
 dispatchFocusout(input,action);assert.equal(f.error('first_name'),error);assert.equal(f.summary(),summary);assert.equal(f.writes.length,0);await f.submit();assert.equal(f.writes.length,1);assert.equal(f.document.querySelector('#editor').open,false);
});
