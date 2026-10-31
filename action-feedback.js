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
function actionFeedbackDismiss(entry){
 if(!actionFeedbackEntries.has(entry)||entry.leaving)return;
 if(!entry.node.isConnected){actionFeedbackRemove(entry);return;}
 const rendered=getComputedStyle(entry.node);
 entry.node.style.setProperty('--feedback-exit-opacity',rendered.opacity);
 entry.node.style.setProperty('--feedback-exit-transform',rendered.transform);
 clearTimeout(entry.timer);entry.leaving=true;
 if(entry.node.contains(document.activeElement)){const origin=actionFeedbackResolve(entry.reference);if(origin&&!origin.disabled)origin.focus({preventScroll:true});}
 entry.node.inert=true;entry.node.classList.add('action-feedback-leaving');
 entry.timer=setTimeout(()=>actionFeedbackRemove(entry),150);
}
function clearActionFeedback(session=false){
 for(const entry of actionFeedbackEntries)if(session||!['busy','error','undo'].includes(entry.kind))actionFeedbackRemove(entry);
 const notice=document.querySelector('#notice');if(notice){notice.textContent='';notice.className='';}
 if(session){actionFeedbackEpoch++;actionFeedbackEvent=null;actionFeedbackOpeners=new WeakMap();if(typeof navWhileBusy!=='undefined')navWhileBusy=null;}
}
function actionFeedbackPlace(entry){
 const anchor=actionFeedbackResolve(entry.reference);
 if(entry.target?.isConnected){if(entry.node.parentElement!==entry.target)entry.target.replaceChildren(entry.node);return;}
 if(anchor){
  const actions=anchor.closest('.actions');
  if(!entry.node.isConnected){
   if(actions)actions.after(entry.node);
   else if(anchor.matches('form,section,article,.heading,td'))anchor.append(entry.node);
   else anchor.after(entry.node);
  }
  if(entry.kind!=='busy'&&anchor.matches('button,input,select,textarea,[role="button"]')){
   entry.node.classList.add('action-feedback-anchored');
   const rect=anchor.getBoundingClientRect(),box=entry.node.getBoundingClientRect(),width=document.documentElement.clientWidth,height=document.documentElement.clientHeight;
   entry.node.style.left=Math.max(8,Math.min(rect.left,width-box.width-8))+'px';
   entry.node.style.top=Math.max(8,rect.bottom+8+box.height<=height?rect.bottom+8:rect.top-box.height-8)+'px';
  }
 }else document.querySelector('#content')?.prepend(entry.node);
}
function actionFeedbackReanchor(){
 for(const entry of actionFeedbackEntries){
  if(entry.scope!==null&&entry.scope!==workspaceRefreshScope()){actionFeedbackRemove(entry);continue;}
  if((entry.leaving||entry.kind==='error'&&!actionFeedbackResolve(entry.reference))&&!entry.node.isConnected){actionFeedbackRemove(entry);continue;}
  actionFeedbackPlace(entry);
 }
}
function actionFeedbackShow(reference,text,kind='success',target=null){
 const resolved=actionFeedbackResolve(reference);
 for(const entry of actionFeedbackEntries)if((entry.reference?.node===reference?.node||resolved&&actionFeedbackResolve(entry.reference)===resolved||target&&entry.target===target)&&!(kind==='busy'&&entry.kind==='error')&&!(entry.kind==='undo'&&kind!=='undo'))actionFeedbackRemove(entry);
 if(!text)return null;
 const node=document.createElement('span'),entry={node,reference,kind,target,timer:null,scope:typeof workspaceRefreshScope==='function'?workspaceRefreshScope():null};
 node.className='action-feedback action-feedback-'+kind;
 if(kind==='busy'&&reference?.node.matches('button,input[type="submit"],input[type="button"]'))node.classList.add('action-feedback-sr-only');
 node.setAttribute('role',kind==='error'?'alert':'status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');node.textContent=text;
 if(kind==='error'){
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='action-feedback-dismiss';dismiss.setAttribute('aria-label','Dismiss error');dismiss.title='Dismiss error';
  dismiss.addEventListener('click',()=>actionFeedbackDismiss(entry));node.append(dismiss);
 }
 actionFeedbackEntries.add(entry);actionFeedbackPlace(entry);
 if(kind==='success')entry.timer=setTimeout(()=>actionFeedbackDismiss(entry),4000);
 return entry;
}
function actionFeedbackUndo(reference,text,remainingMs,undo){
 if(!Number.isFinite(remainingMs)||remainingMs<=0)return null;
 const duration=Math.min(8000,remainingMs);
 const epoch=actionFeedbackEpoch,actor=typeof me==='undefined'?null:me;
 const entry=actionFeedbackShow(reference,text,'undo'),button=document.createElement('button');
 button.type='button';button.textContent='Undo';entry.node.append(button);
 let pending=false,expired=false;
 button.addEventListener('click',async()=>{
  if(pending||expired||entry.leaving||!actionFeedbackEntries.has(entry)||epoch!==actionFeedbackEpoch||actor!==me)return;
  await run(async()=>{
   pending=true;
   try{await undo();actionFeedbackDismiss(entry);}
   finally{pending=false;if(expired)actionFeedbackDismiss(entry);}
  },{origin:button,successOrigin:reference,busyLabel:'Undoing…'});
 });
 // Expiry still runs during an in-flight undo; the server independently enforces its deadline.
 entry.timer=setTimeout(()=>{expired=true;if(!pending)actionFeedbackDismiss(entry);},duration);
 actionFeedbackPlace(entry);return entry;
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
function actionFeedbackRememberDialog(dialog){
 const origin=actionFeedbackReference(actionFeedbackOrigin());
 // A dialog can hand off to another after its own trigger has disappeared.
 const opener=actionFeedbackResolve(origin)?origin:actionFeedbackActive?.successOrigin||origin;
 for(const entry of actionFeedbackEntries)if(entry.kind==='error'&&(entry.target?.closest('dialog')===dialog||entry.reference?.node?.closest('dialog')===dialog))actionFeedbackRemove(entry);
 clearActionFeedback();actionFeedbackOpeners.set(dialog,opener);
}
function actionFeedbackBegin(options={}){
 const node=options.origin||actionFeedbackOrigin(),origin=actionFeedbackReference(node),dialog=node?.closest('dialog');
 const context={origin,dialog,wasFocused:node===document.activeElement,successOrigin:options.successOrigin||actionFeedbackOpeners.get(dialog),errorTarget:options.errorTarget,epoch:actionFeedbackEpoch,actor:typeof me==='undefined'?null:me?.user_id,state:null,pending:null};
 for(const entry of actionFeedbackEntries)if(entry.kind==='error'&&context.errorTarget&&entry.target===context.errorTarget)actionFeedbackRemove(entry);
 clearActionFeedback();
 if(node){
  const button=node.matches('button,input[type="submit"],input[type="button"]'),label=options.busyLabel||(node.dataset.view?'Loading…':/refresh/i.test(node.textContent||node.value||'')?'Refreshing…':node.type==='submit'&&node.form?'Saving…':'Working…');
  context.state={node,button,label,disabled:node.disabled,busy:node.getAttribute('aria-busy'),hadClass:node.classList.contains('action-is-busy')};
  node.setAttribute('aria-busy','true');node.classList.add('action-is-busy');
  if(button)node.disabled=true;
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

// Touch-down is earlier than click on phones. A cancelled gesture must release the visual state.
let actionPressed=null;
document.addEventListener('touchstart',event=>{
 actionPressed?.classList.remove('action-is-pressed');
 actionPressed=event.target.closest('button,.button,[role="button"]');
 if(actionPressed?.disabled||actionPressed?.getAttribute('aria-disabled')==='true')actionPressed=null;
 actionPressed?.classList.add('action-is-pressed');
},{passive:true});
for(const type of ['touchend','touchcancel'])document.addEventListener(type,()=>{actionPressed?.classList.remove('action-is-pressed');actionPressed=null;},{passive:true});
document.addEventListener('scroll',actionFeedbackReanchor,{capture:true,passive:true});
if(typeof window!=='undefined')window.addEventListener('resize',actionFeedbackReanchor,{passive:true});
