import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.js'),runSource=app.slice(app.indexOf('function friendlyError('),app.indexOf("let editSaving=false;"));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};

// A small DOM fixture: production event handlers, timers and form callbacks run unchanged.
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.id='';this.dataset={};this.attributes={};this.childNodes=[];this.parentElement=null;this.listeners={};this.disabled=false;this.hidden=false;this.style={setProperty:(name,value)=>this.style[name]=value,removeProperty:name=>delete this.style[name]};this.value='';this.type=tag==='button'?'submit':'';this.classes=new Set();this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name)};}
 get isConnected(){return this.tagName==='BODY'||!!this.parentElement?.isConnected}
 get form(){return this.closest('form')}
 contains(node){return node===this||this.childNodes.some(child=>child.contains?.(node))}
 get className(){return [...this.classes].join(' ')}
 set className(value){this.classes=new Set(value.split(' ').filter(Boolean))}
 get textContent(){return this.childNodes.map(node=>node.textContent||'').join('')}
 set textContent(value){this.replaceChildren({textContent:String(value),parentElement:null,remove(){if(this.parentElement)this.parentElement.childNodes=this.parentElement.childNodes.filter(node=>node!==this);this.parentElement=null}})}
 set innerHTML(value){
  this.replaceChildren();
  if(value.includes('id="actionTitle"')){
   for(const [tag,id,type,text] of [['h2','actionTitle'],['div','actionFields'],['p','actionError'],['button','','submit','Save'],['button','actionCancel','button','Cancel']]){const node=new Element(tag);node.id=id;if(type)node.type=type;if(text)node.textContent=text;this.append(node);}
  }
 }
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.childNodes.push(node)}}
 get firstElementChild(){return this.childNodes.find(node=>node instanceof Element)||null}
 insertBefore(node,before){if(!before)return this.append(node);const at=this.childNodes.indexOf(before);assert.notEqual(at,-1);node.remove();node.parentElement=this;this.childNodes.splice(at,0,node)}
 prepend(node){node.remove();node.parentElement=this;this.childNodes.unshift(node)}
 after(node){const parent=this.parentElement;node.remove();node.parentElement=parent;parent.childNodes.splice(parent.childNodes.indexOf(this)+1,0,node)}
 remove(){if(this.parentElement)this.parentElement.childNodes=this.parentElement.childNodes.filter(node=>node!==this);this.parentElement=null}
 replaceChildren(...nodes){for(const node of [...this.childNodes])node.remove();this.append(...nodes)}
 setAttribute(name,value){this.attributes[name]=String(value)}
 getAttribute(name){return this.attributes[name]??null}
 removeAttribute(name){delete this.attributes[name]}
 matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part[0]==='#')return this.id===part.slice(1);if(part[0]==='.')return this.classList.contains(part.slice(1));const match=part.match(/^([a-z]+)?(?:\[([^=\]]+)(?:="?([^"\]]+)"?)?\])?$/);if(!match)return false;return (!match[1]||this.tagName===match[1].toUpperCase())&&(!match[2]||(match[3]!==undefined?String(this[match[2]]||this.attributes[match[2]])===match[3]:this.attributes[match[2]]!==undefined))})}
 closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches?.(selector))return node;return null}
 querySelectorAll(selector){const nodes=[];for(const child of this.childNodes)if(child instanceof Element){if(child.matches(selector))nodes.push(child);nodes.push(...child.querySelectorAll(selector))}return nodes}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 addEventListener(type,listener){(this.listeners[type]??=[]).push(listener)}
 emit(type,event={}){return Promise.all((this.listeners[type]||[]).map(listener=>listener({target:this,preventDefault(){},...event})))}
 reset(){}
 reportValidity(){return this.valid!==false}
 getBoundingClientRect(){return this.rect||{left:100,top:100,right:240,bottom:144,width:140,height:44};}
 getClientRects(){return this.isConnected&&!this.hidden?[{}]:[]}
 focus(options){this.focused=true;this.focusOptions=options;let root=this;while(root.parentElement)root=root.parentElement;if(root.ownerDocument)root.ownerDocument.activeElement=this}
 animate(){return {finished:Promise.resolve(),cancel(){}}}
 showModal(){this.open=true}
 close(){this.open=false;void this.emit('close')}
}
function fixture(){
 const body=new Element('body'),notice=new Element(),content=new Element('section');notice.id='notice';content.id='content';body.append(notice,content);
 const listeners={},timers=new Map();let timerId=0;
 const document={body,documentElement:{clientWidth:1280,clientHeight:900},activeElement:body,createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener:(type,listener)=>(listeners[type]??=[]).push(listener)};body.ownerDocument=document;
 const ctx=vm.createContext({workspacePageHeader,document,busy:false,me:{user_id:'actor'},navWhileBusy:null,queueMicrotask,matchMedia:()=>({matches:false}),getComputedStyle:node=>({visibility:node.visibility||'visible',opacity:node.renderedOpacity||'1',transform:node.renderedTransform||'none',getPropertyValue:key=>({'--m-base':'200ms','--m-fade':'150ms','--ease-in':'ease-out','--ease-out':'ease-out'}[key])}),FormData:class{constructor(form){this.values=Object.entries(form.values||{})}*[Symbol.iterator](){yield* this.values}},setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearTimeout:id=>timers.delete(id),$:selector=>document.querySelector(selector)});
 vm.runInContext(source('client-rules.js')+'\n'+source('ui-dialogs.js')+'\n'+source('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+runSource,ctx);
 const button=(text='Save',parent=content,id='save')=>{const node=new Element('button');node.type='button';node.id=id;node.textContent=text;parent.append(node);return node};
 const feedback=()=>body.querySelectorAll('.action-feedback');
 return {ctx,body,notice,content,button,feedback,document,timers,advance:delay=>{for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}},capture:(type,node,extra={})=>{const event={target:node,eventPhase:1,...extra};for(const handler of listeners[type]||[])handler(event);queueMicrotask(()=>{event.eventPhase=0});return event},expire:()=>{for(const [id,timer] of [...timers]){if(timer.delay<=5000){timers.delete(id);timer.fn()}}}};
}

test('run gives immediate local busy feedback and refuses concurrent writes without queuing them',async()=>{
 const f=fixture(),first=f.button('Post invoice'),other=f.button('Move stock',f.content,'move'),wait=deferred();let writes=0;
 const saving=f.ctx.run(async()=>{writes++;await wait.promise;f.ctx.message('Invoice posted.')},{origin:first});
 assert.equal(first.disabled,true);assert.equal(first.textContent,'Post invoice');assert.equal(first.getAttribute('aria-busy'),'true');assert.match(f.feedback()[0].textContent,/Working/);
 await f.ctx.run(()=>{writes++},{origin:other});assert.equal(writes,1);assert.match(other.parentElement.textContent,/Another action is still running/);
 wait.resolve();await saving;assert.equal(writes,1);assert.equal(f.ctx.busy,false);assert.equal(first.disabled,false);assert.equal(first.textContent,'Post invoice');assert.equal(first.getAttribute('aria-busy'),null);
 assert.equal(f.notice.textContent,'');assert.match(f.feedback().find(node=>node.classList.contains('action-feedback-success')).textContent,/Invoice posted/);
});

test('failed actions restore exact button children and pre-existing state while actionable errors persist',async()=>{
 const f=fixture(),button=f.button('Save'),icon=new Element('strong');icon.textContent='icon';button.prepend(icon);button.disabled=true;button.setAttribute('aria-busy','false');const children=[...button.childNodes];
 await f.ctx.run(()=>{throw Error('<img src=x> Check the record before retrying.')},{origin:button});
 assert.equal(button.disabled,true);assert.deepEqual(button.childNodes,children);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(button.classList.contains('action-is-busy'),false);
 const error=f.feedback()[0];assert.equal(error.getAttribute('role'),'alert');assert.equal(error.textContent,'<img src=x> Check the record before retrying.');assert.equal(error.childNodes.length,2);
 f.expire();assert.equal(error.isConnected,true);
});

test('a form that owns its disabled state can re-enable submission after a failed save',async()=>{
 const f=fixture(),form=new Element('form');f.content.append(form);const button=f.button('Save request',form),wait=deferred();button.type='submit';f.capture('submit',form,{submitter:button});
 button.disabled=true;
 const saving=f.ctx.run(async()=>{try{await wait.promise}finally{if(button.isConnected)button.disabled=false}});
 assert.equal(button.disabled,true);assert.equal(button.textContent,'Save request');wait.reject(Error('Check the request and try again.'));await saving;
 assert.equal(button.disabled,false,'the shared feedback must preserve the form handler’s final state');assert.equal(button.textContent,'Save request');assert.equal(f.ctx.busy,false);assert.equal(f.feedback()[0].textContent,'Check the request and try again.');
});

test('an uncertain invoice response keeps the callback’s explicit retry label',async()=>{
 const f=fixture(),button=f.button('Post invoice & reserve stock');button.disabled=true;
 await f.ctx.run(async()=>{try{throw Error('The result could not be confirmed.')}catch(error){button.textContent='Retry same invoice';throw error}finally{button.disabled=false}},{origin:button});
 assert.equal(button.textContent,'Retry same invoice');assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);
});

test('success is local, expires after four seconds and errors survive unrelated presses',async()=>{
 const f=fixture(),button=f.button();await f.ctx.run(()=>f.ctx.message('Saved.'),{origin:button});
 assert.equal(f.feedback()[0].parentElement,button.parentElement);assert.deepEqual([...f.timers.values()].map(timer=>timer.delay),[4000]);f.advance(4000);assert.equal(f.feedback()[0].inert,true);f.advance(150);assert.equal(f.feedback().length,0);
 await f.ctx.run(()=>{throw Error('Fix required field.')},{origin:button});assert.equal(f.feedback().length,1);f.capture('click',button);assert.equal(f.feedback().length,1);const dismiss=f.feedback()[0].querySelector('button');dismiss.emit('click');f.advance(150);assert.equal(f.feedback().length,0);
});

test('button busy announcements do not split action rows and final feedback follows the whole group',async()=>{
 const f=fixture(),actions=new Element('div');actions.className='actions';f.content.append(actions);const save=f.button('Save',actions),cancel=f.button('Cancel',actions,'cancel'),wait=deferred();
 const saving=f.ctx.run(async()=>{await wait.promise;f.ctx.message('Saved.')},{origin:save});
 assert.deepEqual(actions.childNodes,[save,cancel]);assert.equal(f.feedback()[0].classList.contains('action-feedback-sr-only'),true);assert.equal(f.feedback()[0].getAttribute('aria-live'),'polite');
 wait.resolve();await saving;assert.deepEqual(actions.childNodes,[save,cancel]);assert.equal(f.content.childNodes[1],f.feedback()[0]);assert.equal(f.feedback()[0].classList.contains('action-feedback-sr-only'),false);assert.equal(f.feedback()[0].textContent,'Saved.');
});

test('background messages retain the global fallback and opening or cancelling a dialog invents no success',async()=>{
 const f=fixture();f.ctx.message('Background update.');assert.equal(f.notice.textContent,'Background update.');
 const button=f.button();await f.ctx.run(()=>{}, {origin:button});assert.equal(f.feedback().length,0);
 const dialog=new Element('dialog');f.body.append(dialog);await f.ctx.run(()=>dialog.showModal(),{origin:button});assert.equal(dialog.open,true);assert.equal(f.feedback().length,0);
});

test('event capture covers keyboard submit and expires before an unrelated background task',async()=>{
 const f=fixture(),form=new Element('form');f.content.append(form);const submit=f.button('Save',form);submit.type='submit';
 f.capture('submit',form,{submitter:submit});const wait=deferred(),saving=f.ctx.run(()=>wait.promise);assert.equal(submit.textContent,'Save');wait.resolve();await saving;
 await Promise.resolve();f.ctx.message('Background');assert.equal(f.notice.textContent,'Background');
});

test('capture survives a microtask checkpoint during native event dispatch',async()=>{
 const f=fixture(),button=f.button('Refresh'),event=f.capture('click',button);await Promise.resolve();event.eventPhase=2;
 await f.ctx.run(()=>f.ctx.message('Updated.'));assert.equal(f.feedback()[0].textContent,'Updated.');event.eventPhase=0;f.ctx.message('Background after dispatch.');assert.equal(f.notice.textContent,'Background after dispatch.');
});

test('replaced controls resolve by stable data attributes and lost controls fall back inside content',async()=>{
 const f=fixture(),button=f.button('Save');button.id='';button.dataset.recordId='record-1';button.dataset.action='save';
 await f.ctx.run(()=>{button.remove();const replacement=f.button('Save');replacement.id='';replacement.dataset={recordId:'record-1',action:'save'};f.ctx.message('Updated.')},{origin:button});
 assert.equal(f.feedback()[0].parentElement,f.content);assert.equal(f.content.childNodes.at(-2).dataset.recordId,'record-1');
 const status=f.feedback()[0];f.content.replaceChildren();f.ctx.actionFeedbackReanchor();assert.equal(status.parentElement,f.content);
});

test('refresh restores initially focused button after replacement without scrolling',async()=>{
 const f=fixture(),button=f.button('Refresh',f.content,'refresh');button.focus();let replacement;
 await f.ctx.run(async()=>{f.document.activeElement=f.body;button.remove();replacement=f.button('Refresh',f.content,'refresh')},{origin:button});
 assert.equal(f.document.activeElement,replacement);assert.equal(replacement.focusOptions.preventScroll,true);
});

test('ordinary actions preserve focus moved by the user and do not focus an untouched control',async()=>{
 for(const initiallyFocused of [false,true]){
  const f=fixture(),button=f.button('Refresh'),input=new Element('input');f.content.append(input);if(initiallyFocused)button.focus();
  await f.ctx.run(async()=>{if(initiallyFocused)input.focus()},{origin:button});
  assert.equal(f.document.activeElement,initiallyFocused?input:f.body);assert.equal(button.focusOptions,undefined);
 }
});

test('signed-out and replaced actors cannot publish late success or error feedback',async()=>{
 for(const reject of [false,true]){
  const f=fixture(),button=f.button(),wait=deferred();const saving=f.ctx.run(async()=>{await wait.promise;f.ctx.message('Saved for former actor.')},{origin:button});
  f.ctx.clearActionFeedback(true);f.ctx.me={user_id:'next-actor'};if(reject)wait.reject(Error('Former actor error'));else wait.resolve();await saving;
  assert.equal(f.feedback().length,0);assert.equal(f.notice.textContent,'');assert.equal(button.textContent,'Save');assert.equal(f.ctx.busy,false);
 }
 const f=fixture(),button=f.button(),wait=deferred(),saving=f.ctx.run(async()=>{await wait.promise;f.ctx.message('Wrong actor.')},{origin:button});f.ctx.me={user_id:'replacement'};wait.resolve();await saving;assert.equal(f.feedback().length,0);
});

test('refreshing the current actor record does not hide feedback for that same signed-in person',async()=>{
 const f=fixture(),button=f.button('Refresh');await f.ctx.run(()=>{f.ctx.me={user_id:'actor'};f.ctx.message('Refreshed.')},{origin:button});assert.equal(f.feedback()[0].textContent,'Refreshed.');
});

test('queued navigation has specific local feedback and is the only queued action',()=>{
 const f=fixture(),first=f.button('Orders'),second=f.button('Stock',f.content,'stock');f.ctx.actionFeedbackQueueNavigation(first);assert.equal(f.feedback()[0].textContent,'Will open when the current action finishes.');f.ctx.actionFeedbackQueueNavigation(second);assert.equal(f.feedback().length,1);assert.equal(f.content.childNodes.at(-2),second);
});

test('shared modal saves through the same lock, preserves submitted values, and sends success to its opener',async()=>{
 const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Edit account');f.capture('click',opener);let received,calls=0;const wait=deferred();
 const form=f.ctx.actionForm('Edit account','',async values=>{calls++;received=values;await wait.promise;f.ctx.message('Account saved.')});form.values={name:'  Clinic  '};const save=form.querySelector('[type="submit"]'),cancel=form.querySelector('#actionCancel'),dialog=form.closest('dialog');save.textContent='Save account';
 const saving=form.emit('submit',{submitter:save});assert.equal(f.ctx.busy,true);assert.equal(save.textContent,'Save account');assert.equal(save.disabled,true);assert.equal(cancel.disabled,true);await form.emit('submit',{submitter:save});assert.equal(calls,1);
 form.values.name='Changed during request';wait.resolve();await saving;assert.equal(received.name,'Clinic');assert.equal(dialog.open,false);assert.equal(save.textContent,'Save account');assert.equal(save.disabled,false);assert.equal(cancel.disabled,false);assert.equal(f.feedback()[0].parentElement,opener.parentElement);assert.equal(f.feedback()[0].textContent,'Account saved.');
});

test('a dialog handoff preserves the visible original opener after its inner control disappears',async()=>{
 for(const detached of [false,true]){
  const f=fixture(),opener=f.button('Documents'),first=new Element('dialog'),second=new Element('dialog');
  f.body.append(first,second);
  await f.ctx.run(()=>{f.ctx.actionFeedbackRememberDialog(first);first.showModal();},{origin:opener});
  const handoff=f.button('Upload source files',first,'upload');
  await f.ctx.run(()=>{first.close();if(detached)first.remove();f.ctx.actionFeedbackRememberDialog(second);second.showModal();},{origin:handoff});
  const save=f.button('Save attachment',second,'save-attachment');
  await f.ctx.run(()=>{second.close();f.ctx.message('Attachment saved.');},{origin:save});
  const feedback=f.feedback().find(node=>node.classList.contains('action-feedback-success'));
  assert.equal(feedback.parentElement,opener.parentElement);assert.equal(f.content.childNodes.at(-2),opener);
  assert.equal(feedback.textContent,'Attachment saved.');
 }
});

test('reusing a form clears only its previous record error and cannot resurrect it on scroll',async()=>{
 const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);
 const outside=f.button('Refresh list');
 f.ctx.actionFeedbackShow(f.ctx.actionFeedbackReference(outside),'List is unavailable.','error');
 const form=f.ctx.actionForm('First record','',()=>{throw Error('First record error.');});
 await form.emit('submit',{submitter:form.querySelector('[type="submit"]')});
 assert.equal(form.querySelector('#actionError').textContent,'First record error.');
 form.closest('dialog').close();
 f.ctx.actionForm('Second record','',()=>{});f.ctx.actionFeedbackReanchor();
 assert.equal(form.querySelector('#actionError').textContent,'');
 assert.deepEqual(f.feedback().map(node=>node.textContent),['List is unavailable.']);
});

test('a new accepted action clears the shared error target without resurrecting a previous control error',async()=>{
 const f=fixture(),first=f.button('Download A'),second=f.button('Download B',f.content,'download-b'),status=new Element('p');f.content.append(status);
 await f.ctx.run(()=>{throw Error('File A unavailable.');},{origin:first,errorTarget:status});
 assert.equal(status.textContent,'File A unavailable.');
 await f.ctx.run(()=>f.ctx.message('File B downloaded.'),{origin:second,errorTarget:status});
 f.ctx.actionFeedbackReanchor();assert.equal(status.textContent,'');
 assert.deepEqual(f.feedback().map(node=>node.textContent),['File B downloaded.']);
});

test('replacing a shared target error removes its old registered entry',()=>{
 const f=fixture(),first=f.button('A'),second=f.button('B',f.content,'b'),status=new Element('p');f.content.append(status);
 f.ctx.actionFeedbackShow(f.ctx.actionFeedbackReference(first),'First error','error',status);
 f.ctx.actionFeedbackShow(f.ctx.actionFeedbackReference(second),'Second error','error',status);
 f.ctx.actionFeedbackReanchor();assert.deepEqual(f.feedback().map(node=>node.textContent),['Second error']);
 const error=f.feedback()[0];error.querySelector('button').emit('click');f.advance(150);f.ctx.actionFeedbackReanchor();assert.equal(status.textContent,'');
});

test('shared modal preserves fields and stays open on failure or a busy refusal',async()=>{
 const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Edit');f.capture('click',opener);let calls=0;
 const form=f.ctx.actionForm('Edit','',()=>{calls++;throw Error('Choose a valid account.')});form.values={name:'Entered name'};const save=form.querySelector('[type="submit"]'),error=form.querySelector('#actionError'),dialog=form.closest('dialog');
 f.ctx.busy=true;await form.emit('submit',{submitter:save});assert.equal(calls,0);assert.match(error.textContent,/Another action/);assert.equal(dialog.open,true);
 f.ctx.busy=false;await form.emit('submit',{submitter:save});assert.equal(calls,1);assert.equal(error.textContent,'Choose a valid account.');assert.equal(form.values.name,'Entered name');assert.equal(dialog.open,true);assert.equal(save.disabled,false);assert.equal(save.textContent,'Save');assert.equal(f.ctx.busy,false);
 const invalid=new Element('input');invalid.name='required';invalid.willValidate=true;invalid.validity={valid:false};invalid.validationMessage='Complete this field.';invalid.scrollIntoView=()=>{};form.append(invalid);await form.emit('submit',{submitter:save});assert.equal(calls,1,'native constraint validation runs before the callback');
});

test('a new shared form resets the prior action’s recovery label',()=>{
 const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);
 const form=f.ctx.actionForm('Close task','',()=>{}),save=form.querySelector('[type="submit"]');save.textContent='Check saved status';form.closest('dialog').close();
 f.ctx.actionForm('Edit account','',()=>{});assert.equal(save.textContent,'Save');
});

test('shared modal closes only for the same actor object and session after a save',async()=>{
 for(const change of ['none','actor','epoch']){
  const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Delete record');f.capture('click',opener);
  const form=f.ctx.actionForm('Delete record','',async()=>{if(change==='epoch')f.ctx.clearActionFeedback(true);if(change==='actor')f.ctx.me={...f.ctx.me};f.ctx.message('Record moved to recycle bin.');}),save=form.querySelector('[type="submit"]'),dialog=form.closest('dialog');
  await form.emit('submit',{submitter:save});assert.equal(dialog.open,change!=='none');assert.equal(save.disabled,false);assert.equal(f.feedback().length,change==='epoch'?0:1);
 }
});

test('successful modal saves focus the replacement opener without scrolling after a rerender',async()=>{
 const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Edit task',f.content,'edit-task');f.capture('click',opener);let replacement;
 const form=f.ctx.actionForm('Edit task','',async()=>{opener.remove();replacement=f.button('Edit task',f.content,'edit-task');f.document.activeElement=f.body;f.ctx.message('Task saved.');}),save=form.querySelector('[type="submit"]');
 await form.emit('submit',{submitter:save});assert.equal(f.document.activeElement,replacement);assert.equal(replacement.focusOptions.preventScroll,true);assert.equal(form.closest('dialog').open,false);
});

test('failed modal saves restore blurred submit focus but leave an already focused field alone',async()=>{
 for(const focusField of [false,true]){
  const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Edit task');f.capture('click',opener);const input=new Element('input');
  const form=f.ctx.actionForm('Edit task','',async()=>{f.document.activeElement=focusField?input:f.body;throw Error('Fix this field.');}),save=form.querySelector('[type="submit"]');form.append(input);
  await form.emit('submit',{submitter:save});assert.equal(f.document.activeElement,focusField?input:save);assert.equal(opener.focused,undefined);assert.equal(form.closest('dialog').open,true);if(!focusField)assert.equal(save.focusOptions.preventScroll,true);
 }
});

test('modal completion never steals focus from another dialog or a replacement session',async()=>{
 for(const changedSession of [false,true]){
  const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Edit task');f.capture('click',opener);const other=new Element('dialog');f.body.append(other);
  const form=f.ctx.actionForm('Edit task','',async()=>{if(changedSession)f.ctx.clearActionFeedback(true);else other.showModal();f.document.activeElement=f.body;}),save=form.querySelector('[type="submit"]');
  await form.emit('submit',{submitter:save});assert.equal(f.document.activeElement,f.body);assert.equal(opener.focused,undefined);
 }
});

test('contact editor retains its field errors, values and duplicate guard while using shared feedback',async()=>{
 const f=fixture(),dialog=new Element('dialog'),form=new Element('form'),error=new Element('p');dialog.id='editor';form.id='editForm';error.id='formError';f.body.append(dialog);dialog.append(form);form.append(error);dialog.showModal();const save=f.button('Save contact',form),close=f.button('×',form,'closeEditor');save.type='submit';form.values={first_name:'Entered'};
 const fields=new Element('div');fields.id='fields';form.append(fields);
 vm.runInContext(app.split('\n').find(line=>line.startsWith('function showContactValidationSummary(')),f.ctx);
 let calls=0,fieldErrors;const wait=deferred();f.ctx.editing={id:'contact',revision:2};f.ctx.showFieldErrors=(_form,errors)=>{fieldErrors=errors};f.ctx.save=async values=>{calls++;assert.equal(values.first_name,'Entered');await wait.promise;throw Object.assign(Error('Correct the highlighted fields.'),{fields:{first_name:'Use a capital letter.'}})};
 vm.runInContext(app.slice(app.indexOf('let editSaving=false;'),app.indexOf("document.addEventListener('click',async e=>{",app.indexOf('let editSaving=false;'))),f.ctx);
 vm.runInContext("const form=$('#editForm'),initial=workspaceFormSnapshot(form);"+app.split('\n').find(line=>line.includes("$('#closeEditor').onclick=bindWorkspaceDialogDismiss")),f.ctx);
 const event={target:form,submitter:save,preventDefault(){}},saving=form.onsubmit(event);await form.onsubmit(event);assert.equal(calls,1);assert.equal(save.disabled,true);assert.equal(close.disabled,true);let prevented=false;await dialog.emit('cancel',{preventDefault(){prevented=true}});assert.equal(prevented,true);
 wait.resolve();await saving;assert.equal(form.values.first_name,'Entered');assert.equal(fieldErrors.first_name,'Use a capital letter.');assert.equal(error.textContent,'1 field needs attention');assert.equal(dialog.open,true);assert.equal(save.textContent,'Save contact');assert.equal(close.disabled,false);assert.equal(f.ctx.busy,false);
});

test('contact editor closes only for the same signed-in user and session after a save',async()=>{
 for(const replaceSession of ['none','actor','epoch']){
  const f=fixture(),dialog=new Element('dialog'),form=new Element('form'),error=new Element('p');dialog.id='editor';form.id='editForm';error.id='formError';f.body.append(dialog);dialog.append(form);form.append(error);dialog.showModal();const save=f.button('Save contact',form);f.button('×',form,'closeEditor');save.type='submit';form.values={first_name:'Entered'};
  const fields=new Element('div');fields.id='fields';form.append(fields);
  f.ctx.editing={id:'contact'};f.ctx.showFieldErrors=()=>{};f.ctx.save=async()=>{if(replaceSession==='epoch')f.ctx.clearActionFeedback(true);if(replaceSession==='actor')f.ctx.me={user_id:'actor'}};
  vm.runInContext(app.slice(app.indexOf('let editSaving=false;'),app.indexOf("document.addEventListener('click',async e=>{",app.indexOf('let editSaving=false;'))),f.ctx);
 vm.runInContext("const form=$('#editForm'),initial=workspaceFormSnapshot(form);"+app.split('\n').find(line=>line.includes("$('#closeEditor').onclick=bindWorkspaceDialogDismiss")),f.ctx);
  await form.onsubmit({target:form,submitter:save,preventDefault(){}});assert.equal(dialog.open,replaceSession!=='none');assert.equal(save.disabled,false);
 }
});

test('correcting contact errors updates the registered summary so reanchoring cannot resurrect an old count',()=>{
 const f=fixture(),form=new Element('form'),target=new Element('p');form.id='editForm';target.id='formError';f.body.append(form);form.append(target);const save=f.button('Save contact',form);save.type='submit';
 vm.runInContext(app.split('\n').find(line=>line.startsWith('function showContactValidationSummary(')),f.ctx);
 f.ctx.showContactValidationSummary(form,2);assert.equal(target.textContent,'2 fields need attention');f.ctx.showContactValidationSummary(form,1);f.ctx.actionFeedbackReanchor();assert.equal(target.textContent,'1 field needs attention');
 f.ctx.showContactValidationSummary(form,0);f.ctx.actionFeedbackReanchor();assert.equal(target.textContent,'');assert.equal(f.feedback('error').length,0);
});


test('touch-down uses the shared press state and cancelled gestures release it',()=>{
 const f=fixture(),button=f.button();f.capture('touchstart',button);assert.equal(button.classList.contains('action-is-pressed'),true);f.capture('touchcancel',button);assert.equal(button.classList.contains('action-is-pressed'),false);
 button.disabled=true;f.capture('touchstart',button);assert.equal(button.classList.contains('action-is-pressed'),false);
});
test('feedback anchors eight pixels from the pressed control and follows scrolling without clearing errors',async()=>{
 const f=fixture(),button=f.button();await f.ctx.run(()=>{throw Error('Quantity exceeds available stock.')},{origin:button});const error=f.feedback()[0];assert.equal(error.style.top,'152px');assert.equal(error.style.left,'100px');
 button.rect={left:300,top:200,right:440,bottom:244,width:140,height:44};f.ctx.actionFeedbackReanchor();assert.equal(error.style.top,'252px');assert.equal(error.style.left,'300px');assert.equal(error.isConnected,true);
 const other=f.button('Refresh',f.content,'refresh');await f.ctx.run(()=>f.ctx.message('Refreshed.'),{origin:other});assert.equal(error.isConnected,true);assert.equal(f.feedback().length,2);
});
test('working state preserves label children and button width; spinner uses no layout space',async()=>{
 const f=fixture(),button=f.button('Save request'),icon=new Element('strong');icon.textContent='+';button.prepend(icon);const children=[...button.childNodes],wait=deferred();const saving=f.ctx.run(()=>wait.promise,{origin:button,busyLabel:'Saving…'});
 assert.deepEqual(button.childNodes,children);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(f.feedback()[0].textContent,'Saving…');wait.resolve();await saving;assert.deepEqual(button.childNodes,children);
 const css=source('ui-polish.css');assert.match(css,/button\.action-is-busy::after\{position:absolute/);assert.doesNotMatch(css,/filter:brightness\(\.94\)/);
});

test('Undo lasts at most eight seconds and runs only once while pending',async()=>{
 const f=fixture(),origin=f.button('Complete task'),wait=deferred();let calls=0;
 const entry=f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',12000,async()=>{calls++;await wait.promise;f.ctx.message('Task reopened.');});
 assert.equal([...f.timers.values()].at(-1).delay,8000);const undo=entry.node.querySelector('button'),first=undo.emit('click');await undo.emit('click');assert.equal(calls,1);assert.equal(undo.disabled,true);wait.resolve();await first;assert.equal(entry.node.inert,true);f.advance(150);assert.equal(entry.node.isConnected,false);assert.equal(f.feedback().at(-1).textContent,'Task reopened.');
});
test('expired Undo cannot start a write and invalid server windows offer no action',async()=>{
 const f=fixture(),origin=f.button();let calls=0;
 for(const value of [0,-1,NaN,Infinity])assert.equal(f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',value,()=>calls++),null);
 const entry=f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',120,()=>calls++),undo=entry.node.querySelector('button');const timer=[...f.timers.values()].find(t=>t.delay===120);timer.fn();await undo.emit('click');assert.equal(calls,0);assert.equal(entry.node.inert,true);f.advance(150);assert.equal(entry.node.isConnected,false);
});

test('failed Undo stays available only until its original deadline, without extending it',async()=>{
 const f=fixture(),origin=f.button();let calls=0;
 const entry=f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',2500,async()=>{calls++;throw Error('Task changed; refresh.');});const undo=entry.node.querySelector('button'),deadline=[...f.timers.values()].find(t=>t.delay===2500);
 await undo.emit('click');assert.equal(calls,1);assert.equal(entry.node.isConnected,true);assert.equal(undo.disabled,false);assert.equal([...f.timers.values()].filter(t=>t.delay===2500).length,1);
 deadline.fn();await undo.emit('click');assert.equal(calls,1);assert.equal(entry.node.inert,true);f.advance(150);assert.equal(entry.node.isConnected,false);
});
test('Undo expiry while a confirmed request is pending does not discard its result',async()=>{
 const f=fixture(),origin=f.button(),wait=deferred();let calls=0;
 const entry=f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',500,async()=>{calls++;await wait.promise;f.ctx.message('Task reopened.');}),undo=entry.node.querySelector('button'),pending=undo.emit('click');
 [...f.timers.values()].find(t=>t.delay===500).fn();await undo.emit('click');assert.equal(calls,1);wait.resolve();await pending;f.advance(150);assert.equal(entry.node.isConnected,false);assert.equal(f.feedback().at(-1).textContent,'Task reopened.');
});
test('a signed-out session or replaced actor cannot submit an old Undo',async()=>{
 for(const changed of ['session','actor']){const f=fixture(),origin=f.button();let calls=0;const entry=f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',8000,()=>calls++),undo=entry.node.querySelector('button');if(changed==='session')f.ctx.clearActionFeedback(true);else f.ctx.me={user_id:'actor'};await undo.emit('click');assert.equal(calls,0);}
});

test('ordinary feedback at the same control cannot remove or renew an active Undo',async()=>{
 const f=fixture(),origin=f.button(),reference=f.ctx.actionFeedbackReference(origin);let calls=0;
 const entry=f.ctx.actionFeedbackUndo(reference,'Draft moved to Deleted Items.',3000,()=>{calls++;f.ctx.message('Draft restored.');}),timer=entry.timer;
 await f.ctx.run(()=>f.ctx.message('Moved to Deleted Items.'),{origin});
 assert.equal(entry.node.isConnected,true);assert.equal(entry.timer,timer);assert.equal(f.timers.get(timer).delay,3000);
 await entry.node.querySelector('button').emit('click');assert.equal(calls,1);f.advance(150);assert.equal(entry.node.isConnected,false);assert.equal(f.feedback().at(-1).textContent,'Draft restored.');
});

test('exit interrupts entrance at the rendered opacity and transform without changing the anchor',()=>{
 const f=fixture(),origin=f.button(),entry=f.ctx.actionFeedbackShow(f.ctx.actionFeedbackReference(origin),'Saved.');
 entry.node.renderedOpacity='.35';entry.node.renderedTransform='matrix(1, 0, 0, 1, 0, 5)';
 const position={left:entry.node.style.left,top:entry.node.style.top};
 f.advance(4000);
 assert.equal(entry.node.style['--feedback-exit-opacity'],'.35');assert.equal(entry.node.style['--feedback-exit-transform'],'matrix(1, 0, 0, 1, 0, 5)');
 assert.deepEqual({left:entry.node.style.left,top:entry.node.style.top},position);assert.equal(entry.node.classList.contains('action-feedback-leaving'),true);assert.equal(entry.node.inert,true);assert.equal(entry.node.isConnected,true);
 assert.deepEqual([...f.timers.values()].map(timer=>timer.delay),[150]);f.advance(149);assert.equal(entry.node.isConnected,true);f.advance(150);assert.equal(entry.node.isConnected,false);
});

test('error dismissal fades once and restores focused dismiss control to its opener without scrolling',async()=>{
 const f=fixture(),origin=f.button(),entry=f.ctx.actionFeedbackShow(f.ctx.actionFeedbackReference(origin),'Try again.','error'),dismiss=entry.node.querySelector('button');
 assert.equal(f.timers.size,0,'errors have no expiry');dismiss.focus();await dismiss.emit('click');const timer=entry.timer;
 assert.equal(f.document.activeElement,origin);assert.equal(origin.focusOptions.preventScroll,true);assert.equal(entry.node.inert,true);assert.equal(entry.node.isConnected,true);
 await dismiss.emit('click');assert.equal(entry.timer,timer,'a repeated dismissal does not extend the fade');f.advance(150);assert.equal(entry.node.isConnected,false);
});

test('Undo becomes unavailable at its deadline while the inert toast completes its exit',async()=>{
 const f=fixture(),origin=f.button();let calls=0;
 const entry=f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',8000,()=>calls++),undo=entry.node.querySelector('button');undo.focus();
 assert.equal(entry.node.inert,undefined);f.advance(8000);assert.equal(entry.node.isConnected,true);assert.equal(entry.node.inert,true);assert.equal(f.document.activeElement,origin);
 await undo.emit('click');assert.equal(calls,0);f.advance(150);assert.equal(entry.node.isConnected,false);
});

test('a completed Undo cannot write again while its exit is visible',async()=>{
 const f=fixture(),origin=f.button();let calls=0;
 const entry=f.ctx.actionFeedbackUndo(f.ctx.actionFeedbackReference(origin),'Done',8000,()=>calls++),undo=entry.node.querySelector('button');
 await undo.emit('click');assert.equal(calls,1);assert.equal(entry.node.isConnected,true);assert.equal(entry.node.inert,true);
 await undo.emit('click');assert.equal(calls,1);f.advance(150);assert.equal(entry.node.isConnected,false);
});

test('session or route cleanup interrupts a fade immediately and stale completion cannot resurrect it',()=>{
 for(const cleanup of ['session','route']){
  const f=fixture(),origin=f.button();let scope='sales';f.ctx.workspaceRefreshScope=()=>scope;
  const entry=f.ctx.actionFeedbackShow(f.ctx.actionFeedbackReference(origin),'Saved.');f.advance(4000);const completion=f.timers.get(entry.timer).fn;
  if(cleanup==='session')f.ctx.clearActionFeedback(true);else{scope='books';f.ctx.actionFeedbackReanchor();}
  assert.equal(entry.node.isConnected,false);assert.equal(f.timers.size,0);completion();f.ctx.actionFeedbackReanchor();assert.equal(f.feedback().length,0);
 }
});

test('replacement feedback survives an old exit and detached exiting feedback cannot reanchor',()=>{
 const f=fixture(),origin=f.button(),reference=f.ctx.actionFeedbackReference(origin),old=f.ctx.actionFeedbackShow(reference,'Old.');f.advance(4000);const completion=f.timers.get(old.timer).fn;
 const current=f.ctx.actionFeedbackShow(reference,'New.');completion();f.ctx.actionFeedbackReanchor();assert.deepEqual(f.feedback(),[current.node]);
 f.advance(4000);current.node.remove();f.ctx.actionFeedbackReanchor();assert.equal(f.feedback().length,0);assert.equal(f.timers.size,0);
});

test('feedback CSS uses token durations, translation only on entry and reduced-motion fades',()=>{
 const css=source('ui-polish.css'),tokens=source('tokens.css');
 assert.match(tokens,/--m-fade:150ms;--m-fast:100ms;--m-base:200ms/);
 assert.match(css,/\.action-feedback:not\(\.action-feedback-busy\)\{animation:action-feedback-enter var\(--m-base\) var\(--ease-out\)\}/);
 assert.match(css,/@keyframes action-feedback-enter\{from\{opacity:0;transform:translateY\(8px\)\}to\{opacity:1;transform:translateY\(0\)\}\}/);
 assert.match(css,/@keyframes action-feedback-exit\{from\{opacity:var\(--feedback-exit-opacity\)\}to\{opacity:0\}\}/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.action-feedback:not\(\.action-feedback-busy\):not\(\.action-feedback-leaving\)\{animation:action-feedback-enter-fade var\(--m-fade\) var\(--ease-out\)\}\.action-feedback.action-feedback-leaving\{transform:none\}/);
 assert.doesNotMatch(css,/animation:action-feedback-fade/);
});
