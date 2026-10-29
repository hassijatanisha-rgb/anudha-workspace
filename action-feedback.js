'use strict';

let actionFeedbackEvent=null,actionFeedbackActive=null,actionFeedbackEpoch=0,actionFeedbackOpeners=new WeakMap();
const actionFeedbackEntries=new Set();

function actionFeedbackOrigin(){return (actionFeedbackEvent?.event.eventPhase?actionFeedbackEvent.node:null)||actionFeedbackActive?.origin?.node||null;}
function actionFeedbackReference(node){
 if(!node)return null;
 const container=node.closest('form,.actions,td,.heading,article,section');
 return {node,id:node.id,data:Object.entries(node.dataset||{}),container:container?.id==='content'?null:container};
}
function actionFeedbackResolve(reference){
 if(!reference)return null;
 const visible=node=>node?.isConnected&&!node.hidden&&(!node.closest('dialog')||node.closest('dialog').open);
 if(visible(reference.node))return reference.node;
 const byId=reference.id&&document.getElementById(reference.id);
 if(visible(byId))return byId;
 if(reference.data.length){
  const match=[...document.querySelectorAll('button,input,select,textarea,[role="button"]')].find(node=>visible(node)&&reference.data.every(([key,value])=>node.dataset[key]===value));
  if(match)return match;
 }
 return visible(reference.container)?reference.container:null;
}
function actionFeedbackCurrent(context){return context.epoch===actionFeedbackEpoch&&(!context.actor||context.actor===me?.user_id);}
function actionFeedbackRemove(entry){clearTimeout(entry.timer);entry.node.remove();actionFeedbackEntries.delete(entry);}
function clearActionFeedback(session=false){
 for(const entry of actionFeedbackEntries)if(session||entry.kind!=='busy')actionFeedbackRemove(entry);
 const notice=document.querySelector('#notice');if(notice){notice.textContent='';notice.className='';}
 if(session){actionFeedbackEpoch++;actionFeedbackEvent=null;actionFeedbackOpeners=new WeakMap();if(typeof navWhileBusy!=='undefined')navWhileBusy=null;}
}
function actionFeedbackPlace(entry){
 const anchor=actionFeedbackResolve(entry.reference);
 if(anchor){
  const actions=anchor.closest('.actions');
  if(actions)actions.after(entry.node);
  else if(anchor.matches('form,section,article,.heading,td'))anchor.append(entry.node);
  else anchor.after(entry.node);
 }else document.querySelector('#content')?.prepend(entry.node);
}
function actionFeedbackReanchor(){for(const entry of actionFeedbackEntries)if(!entry.node.isConnected)actionFeedbackPlace(entry);}
function actionFeedbackShow(reference,text,kind='success',target=null){
 if(target?.isConnected){target.textContent=text;target.setAttribute('aria-live','polite');return null;}
 for(const entry of actionFeedbackEntries)if(entry.reference?.node===reference?.node)actionFeedbackRemove(entry);
 if(!text)return null;
 const node=document.createElement('span'),entry={node,reference,kind,timer:null};
 node.className='action-feedback action-feedback-'+kind;
 if(kind==='busy'&&reference?.node.matches('button,input[type="submit"],input[type="button"]'))node.classList.add('action-feedback-sr-only');
 node.setAttribute('role',kind==='error'?'alert':'status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');node.textContent=text;
 actionFeedbackEntries.add(entry);actionFeedbackPlace(entry);
 if(kind==='success')entry.timer=setTimeout(()=>actionFeedbackRemove(entry),5000);
 return entry;
}
function actionFeedbackMessage(text,error=false){
 const context=actionFeedbackActive;
 if(context){
  if(!actionFeedbackCurrent(context))return true;
  if(!context.origin)return false;
  const reference=!error&&context.successOrigin?context.successOrigin:context.origin;
  actionFeedbackShow(reference,text,error?'error':'success',error?context.errorTarget:null);return true;
 }
 const origin=actionFeedbackOrigin();if(!origin)return false;
 actionFeedbackShow(actionFeedbackReference(origin),text,error?'error':'success');return true;
}
function actionFeedbackRefuse(origin=actionFeedbackOrigin(),target=null){
 const text='Another action is still running. Wait for it to finish, then try again.';
 if(origin||target)actionFeedbackShow(actionFeedbackReference(origin),text,'error',target);else message(text,true);
}
function actionFeedbackQueueNavigation(button){
 for(const entry of actionFeedbackEntries)if(entry.kind==='queued')actionFeedbackRemove(entry);
 actionFeedbackShow(actionFeedbackReference(button),'Will open when the current action finishes.','queued');
}
function actionFeedbackRememberDialog(dialog){clearActionFeedback();actionFeedbackOpeners.set(dialog,actionFeedbackReference(actionFeedbackOrigin()));}
function actionFeedbackBegin(options={}){
 const node=options.origin||actionFeedbackOrigin(),origin=actionFeedbackReference(node),dialog=node?.closest('dialog');
 const context={origin,dialog,wasFocused:node===document.activeElement,successOrigin:options.successOrigin||actionFeedbackOpeners.get(dialog),errorTarget:options.errorTarget,epoch:actionFeedbackEpoch,actor:typeof me==='undefined'?null:me?.user_id,state:null,pending:null};
 clearActionFeedback();if(context.errorTarget)context.errorTarget.textContent='';
 if(node){
  const button=node.matches('button,input[type="submit"],input[type="button"]'),label=options.busyLabel||(node.dataset.view?'Loading…':/refresh/i.test(node.textContent||node.value||'')?'Refreshing…':node.type==='submit'&&node.form?'Saving…':'Working…');
  context.state={node,button,label,disabled:node.disabled,busy:node.getAttribute('aria-busy'),hadClass:node.classList.contains('action-is-busy'),children:button&&node.tagName==='BUTTON'?[...node.childNodes]:null,value:node.value};
  node.setAttribute('aria-busy','true');node.classList.add('action-is-busy');
  if(button){node.disabled=true;if(node.tagName==='BUTTON'){node.textContent=label;context.state.busyChildren=[...node.childNodes];}else node.value=label;}
  context.pending=actionFeedbackShow(origin,label,'busy');
 }
 actionFeedbackActive=context;return context;
}
function actionFeedbackFinish(context){
 if(!context)return;
 if(context.pending&&actionFeedbackEntries.has(context.pending))actionFeedbackRemove(context.pending);
 const state=context.state;
 if(state){
  const {node}=state;
  if(state.button){
   // Forms that disabled before run own their final disabled state and may set a retry label.
   if(!state.disabled)node.disabled=false;
   if(state.children){if(node.textContent===state.label&&node.childNodes.length===state.busyChildren.length&&[...node.childNodes].every((child,index)=>child===state.busyChildren[index]))node.replaceChildren(...state.children);}
   else if(node.value===state.label)node.value=state.value;
  }
  if(state.busy===null)node.removeAttribute('aria-busy');else node.setAttribute('aria-busy',state.busy);
  if(!state.hadClass)node.classList.remove('action-is-busy');
 }
 if(actionFeedbackActive===context)actionFeedbackActive=null;
 actionFeedbackReanchor();
 const {dialog}=context,active=document.activeElement;
 let target=null;
 if(actionFeedbackCurrent(context)&&![...document.querySelectorAll('dialog')].some(other=>other!==dialog&&other.open)){
  if(dialog&&(active===document.body||!dialog.open&&active?.closest('dialog')===dialog))target=dialog.open?context.origin?.node:actionFeedbackResolve(context.successOrigin);
  else if(!dialog&&context.wasFocused&&active===document.body)target=actionFeedbackResolve(context.origin);
 }
 if(target?.isConnected&&!target.disabled&&!target.closest('[hidden],[inert]')&&target.matches('button,input,select,textarea,a[href],[tabindex]')&&target.getClientRects().length&&getComputedStyle(target).visibility!=='hidden')target.focus({preventScroll:true});
}

// Capture only the event being dispatched; a later background refresh has no originating control.
for(const type of ['click','submit','change'])document.addEventListener(type,event=>{
 const node=type==='submit'?event.submitter||event.target.querySelector('[type="submit"],button:not([type])')||event.target:event.target.closest('button,input,select,textarea,[role="button"]');
 if(!node)return;
 clearActionFeedback();const capture={node,event};actionFeedbackEvent=capture;
 setTimeout(()=>{if(actionFeedbackEvent===capture)actionFeedbackEvent=null;},0);
},true);
