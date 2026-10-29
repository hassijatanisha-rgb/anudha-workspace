import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.js'),runSource=app.slice(app.indexOf('function friendlyError('),app.indexOf("let editSaving=false;"));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};

// A small DOM fixture: production event handlers, timers and form callbacks run unchanged.
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.id='';this.dataset={};this.attributes={};this.childNodes=[];this.parentElement=null;this.listeners={};this.disabled=false;this.hidden=false;this.value='';this.type=tag==='button'?'submit':'';this.classes=new Set();this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name)};}
 get isConnected(){return this.tagName==='BODY'||!!this.parentElement?.isConnected}
 get form(){return this.closest('form')}
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
 getClientRects(){return this.isConnected&&!this.hidden?[{}]:[]}
 focus(options){this.focused=true;this.focusOptions=options;let root=this;while(root.parentElement)root=root.parentElement;if(root.ownerDocument)root.ownerDocument.activeElement=this}
 showModal(){this.open=true}
 close(){this.open=false;void this.emit('close')}
}
function fixture(){
 const body=new Element('body'),notice=new Element(),content=new Element('section');notice.id='notice';content.id='content';body.append(notice,content);
 const listeners={},timers=new Map();let timerId=0;
 const document={body,activeElement:body,createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener:(type,listener)=>(listeners[type]??=[]).push(listener)};body.ownerDocument=document;
 const ctx=vm.createContext({document,busy:false,me:{user_id:'actor'},navWhileBusy:null,queueMicrotask,getComputedStyle:node=>({visibility:node.visibility||'visible'}),FormData:class{constructor(form){this.values=Object.entries(form.values||{})}*[Symbol.iterator](){yield* this.values}},setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearTimeout:id=>timers.delete(id),$:selector=>document.querySelector(selector)});
 vm.runInContext(source('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+runSource,ctx);
 const button=(text='Save',parent=content,id='save')=>{const node=new Element('button');node.type='button';node.id=id;node.textContent=text;parent.append(node);return node};
 const feedback=()=>body.querySelectorAll('.action-feedback');
 return {ctx,body,notice,content,button,feedback,document,timers,capture:(type,node,extra={})=>{const event={target:node,eventPhase:1,...extra};for(const handler of listeners[type]||[])handler(event);queueMicrotask(()=>{event.eventPhase=0});return event},expire:()=>{for(const [id,timer] of [...timers]){if(timer.delay<=5000){timers.delete(id);timer.fn()}}}};
}

test('run gives immediate local busy feedback and refuses concurrent writes without queuing them',async()=>{
 const f=fixture(),first=f.button('Post invoice'),other=f.button('Move stock',f.content,'move'),wait=deferred();let writes=0;
 const saving=f.ctx.run(async()=>{writes++;await wait.promise;f.ctx.message('Invoice posted.')},{origin:first});
 assert.equal(first.disabled,true);assert.equal(first.textContent,'Working…');assert.equal(first.getAttribute('aria-busy'),'true');assert.match(f.feedback()[0].textContent,/Working/);
 await f.ctx.run(()=>{writes++},{origin:other});assert.equal(writes,1);assert.match(other.parentElement.textContent,/Another action is still running/);
 wait.resolve();await saving;assert.equal(writes,1);assert.equal(f.ctx.busy,false);assert.equal(first.disabled,false);assert.equal(first.textContent,'Post invoice');assert.equal(first.getAttribute('aria-busy'),null);
 assert.equal(f.notice.textContent,'');assert.match(f.feedback().find(node=>node.classList.contains('action-feedback-success')).textContent,/Invoice posted/);
});

test('failed actions restore exact button children and pre-existing state while actionable errors persist',async()=>{
 const f=fixture(),button=f.button('Save'),icon=new Element('strong');icon.textContent='icon';button.prepend(icon);button.disabled=true;button.setAttribute('aria-busy','false');const children=[...button.childNodes];
 await f.ctx.run(()=>{throw Error('<img src=x> Check the record before retrying.')},{origin:button});
 assert.equal(button.disabled,true);assert.deepEqual(button.childNodes,children);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(button.classList.contains('action-is-busy'),false);
 const error=f.feedback()[0];assert.equal(error.getAttribute('role'),'alert');assert.equal(error.textContent,'<img src=x> Check the record before retrying.');assert.equal(error.childNodes.length,1);
 f.expire();assert.equal(error.isConnected,true);
});

test('a form that owns its disabled state can re-enable submission after a failed save',async()=>{
 const f=fixture(),form=new Element('form');f.content.append(form);const button=f.button('Save request',form),wait=deferred();button.type='submit';f.capture('submit',form,{submitter:button});
 button.disabled=true;
 const saving=f.ctx.run(async()=>{try{await wait.promise}finally{if(button.isConnected)button.disabled=false}});
 assert.equal(button.disabled,true);assert.equal(button.textContent,'Saving…');wait.reject(Error('Check the request and try again.'));await saving;
 assert.equal(button.disabled,false,'the shared feedback must preserve the form handler’s final state');assert.equal(button.textContent,'Save request');assert.equal(f.ctx.busy,false);assert.equal(f.feedback()[0].textContent,'Check the request and try again.');
});

test('an uncertain invoice response keeps the callback’s explicit retry label',async()=>{
 const f=fixture(),button=f.button('Post invoice & reserve stock');button.disabled=true;
 await f.ctx.run(async()=>{try{throw Error('The result could not be confirmed.')}catch(error){button.textContent='Retry same invoice';throw error}finally{button.disabled=false}},{origin:button});
 assert.equal(button.textContent,'Retry same invoice');assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);
});

test('success is local, expires after five seconds and a new action clears stale feedback',async()=>{
 const f=fixture(),button=f.button();await f.ctx.run(()=>f.ctx.message('Saved.'),{origin:button});
 assert.equal(f.feedback()[0].parentElement,button.parentElement);assert.deepEqual([...f.timers.values()].map(timer=>timer.delay),[5000]);f.expire();assert.equal(f.feedback().length,0);
 await f.ctx.run(()=>{throw Error('Fix required field.')},{origin:button});assert.equal(f.feedback().length,1);f.capture('click',button);assert.equal(f.feedback().length,0);
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
 f.capture('submit',form,{submitter:submit});const wait=deferred(),saving=f.ctx.run(()=>wait.promise);assert.equal(submit.textContent,'Saving…');wait.resolve();await saving;
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
 const saving=form.emit('submit',{submitter:save});assert.equal(f.ctx.busy,true);assert.equal(save.textContent,'Saving…');assert.equal(save.disabled,true);assert.equal(cancel.disabled,true);await form.emit('submit',{submitter:save});assert.equal(calls,1);
 form.values.name='Changed during request';wait.resolve();await saving;assert.equal(received.name,'Clinic');assert.equal(dialog.open,false);assert.equal(save.textContent,'Save account');assert.equal(save.disabled,false);assert.equal(cancel.disabled,false);assert.equal(f.feedback()[0].parentElement,opener.parentElement);assert.equal(f.feedback()[0].textContent,'Account saved.');
});

test('shared modal preserves fields and stays open on failure or a busy refusal',async()=>{
 const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Edit');f.capture('click',opener);let calls=0;
 const form=f.ctx.actionForm('Edit','',()=>{calls++;throw Error('Choose a valid account.')});form.values={name:'Entered name'};const save=form.querySelector('[type="submit"]'),error=form.querySelector('#actionError'),dialog=form.closest('dialog');
 f.ctx.busy=true;await form.emit('submit',{submitter:save});assert.equal(calls,0);assert.match(error.textContent,/Another action/);assert.equal(dialog.open,true);
 f.ctx.busy=false;await form.emit('submit',{submitter:save});assert.equal(calls,1);assert.equal(error.textContent,'Choose a valid account.');assert.equal(form.values.name,'Entered name');assert.equal(dialog.open,true);assert.equal(save.disabled,false);assert.equal(save.textContent,'Save');assert.equal(f.ctx.busy,false);
 form.valid=false;await form.emit('submit',{submitter:save});assert.equal(calls,1,'native constraint validation runs before the callback');
});

test('shared modal closes after refreshing the same user but never closes a replacement session’s dialog',async()=>{
 for(const replaceSession of [false,true]){
  const f=fixture();vm.runInContext(source('action-forms.js'),f.ctx);const opener=f.button('Delete record');f.capture('click',opener);
  const form=f.ctx.actionForm('Delete record','',async()=>{if(replaceSession)f.ctx.clearActionFeedback(true);f.ctx.me={user_id:'actor'};f.ctx.message('Record moved to recycle bin.');}),save=form.querySelector('[type="submit"]'),dialog=form.closest('dialog');
  await form.emit('submit',{submitter:save});assert.equal(dialog.open,replaceSession);assert.equal(save.disabled,false);assert.equal(f.feedback().length,replaceSession?0:1);
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
 let calls=0,fieldErrors;const wait=deferred();f.ctx.editing={id:'contact',revision:2};f.ctx.showFieldErrors=(_form,errors)=>{fieldErrors=errors};f.ctx.save=async values=>{calls++;assert.equal(values.first_name,'Entered');await wait.promise;throw Object.assign(Error('Correct the highlighted fields.'),{fields:{first_name:'Use a capital letter.'}})};
 vm.runInContext(app.slice(app.indexOf('let editSaving=false;'),app.indexOf("document.addEventListener('click',e=>{",app.indexOf('let editSaving=false;'))),f.ctx);
 const event={target:form,submitter:save,preventDefault(){}},saving=form.onsubmit(event);await form.onsubmit(event);assert.equal(calls,1);assert.equal(save.disabled,true);assert.equal(close.disabled,true);let prevented=false;await dialog.emit('cancel',{preventDefault(){prevented=true}});assert.equal(prevented,true);
 wait.resolve();await saving;assert.equal(form.values.first_name,'Entered');assert.equal(fieldErrors.first_name,'Use a capital letter.');assert.equal(error.textContent,'Correct the highlighted fields.');assert.equal(dialog.open,true);assert.equal(save.textContent,'Save contact');assert.equal(close.disabled,false);assert.equal(f.ctx.busy,false);
});

test('contact editor closes only for the same signed-in user and session after a save',async()=>{
 for(const replaceSession of [false,true]){
  const f=fixture(),dialog=new Element('dialog'),form=new Element('form'),error=new Element('p');dialog.id='editor';form.id='editForm';error.id='formError';f.body.append(dialog);dialog.append(form);form.append(error);dialog.showModal();const save=f.button('Save contact',form);f.button('×',form,'closeEditor');save.type='submit';form.values={first_name:'Entered'};
  f.ctx.editing={id:'contact'};f.ctx.showFieldErrors=()=>{};f.ctx.save=async()=>{if(replaceSession)f.ctx.clearActionFeedback(true);f.ctx.me={user_id:'actor'}};
  vm.runInContext(app.slice(app.indexOf('let editSaving=false;'),app.indexOf("document.addEventListener('click',e=>{",app.indexOf('let editSaving=false;'))),f.ctx);
  await form.onsubmit({target:form,submitter:save,preventDefault(){}});assert.equal(dialog.open,replaceSession);assert.equal(save.disabled,false);
 }
});
