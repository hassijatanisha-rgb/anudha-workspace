'use strict';

const workspaceDialogMotion=new WeakMap(),workspaceDialogTriggers=new WeakMap(),workspaceDialogDismissals=new WeakMap(),workspaceDialogVersions=new WeakMap(),workspaceDialogExitInert=new WeakMap(),workspaceDialogDrags=new WeakMap(),workspaceQuestions=new Set();
let workspaceQuestionSequence=0,workspaceDialogTitleSequence=0;
function workspaceDialogDuration(dialog,name){return parseFloat(getComputedStyle(dialog).getPropertyValue(name));}
function workspaceDialogHiddenTransform(dialog){return matchMedia('(max-width:600px)').matches?'translateY(100%)':dialog.dataset.dialogPlacement==='side'?'translateX(24px)':'scale(.96)';}
function showWorkspaceDialog(dialog,{trigger=document.activeElement,size='medium',placement='center'}={}){
 dialog.dataset.dialogPlacement=placement;
 const previous=workspaceDialogMotion.get(dialog),wasOpen=dialog.open;
 const rendered=wasOpen?getComputedStyle(dialog):null;
 const start=rendered?{opacity:rendered.opacity,transform:rendered.transform}:{opacity:0,transform:workspaceDialogHiddenTransform(dialog)};
 workspaceDialogDrags.get(dialog)?.exit?.interrupt();previous?.cancel();
 if(workspaceDialogExitInert.has(dialog)){dialog.inert=workspaceDialogExitInert.get(dialog);workspaceDialogExitInert.delete(dialog);}
 if(!wasOpen)workspaceDialogTriggers.set(dialog,trigger?.closest?.('#accountMenu')?.querySelector('summary')||trigger);
 workspaceDialogVersions.set(dialog,(workspaceDialogVersions.get(dialog)||0)+1);
 dialog.classList.add('workspace-dialog');dialog.dataset.dialogSize=size;
 const heading=dialog.querySelector('h1,h2,h3');
 if(heading&&!dialog.getAttribute('aria-labelledby')){if(!heading.id)heading.id='workspace-dialog-title-'+(++workspaceDialogTitleSequence);dialog.setAttribute('aria-labelledby',heading.id);}
 dialog.classList.remove('dialog-leaving');
 if(!wasOpen)dialog.showModal();
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const rect=dialog.getBoundingClientRect(),anchor=trigger?.getBoundingClientRect();
 if(anchor)dialog.style.setProperty('--dialog-origin',`${Math.max(0,Math.min(rect.width,anchor.left+anchor.width/2-rect.left))}px ${Math.max(0,Math.min(rect.height,anchor.top+anchor.height/2-rect.top))}px`);
 const frames=reduced?[{opacity:start.opacity},{opacity:1}]:[start,{opacity:1,transform:'none'}];
 const animation=dialog.animate(frames,{duration:workspaceDialogDuration(dialog,reduced?'--m-fade':matchMedia('(max-width:600px)').matches||placement==='side'?'--m-slow':'--m-base'),easing:getComputedStyle(dialog).getPropertyValue('--ease-in')});
 workspaceDialogMotion.set(dialog,animation);animation.finished.catch(()=>{});
 return dialog;
}
async function closeWorkspaceDialog(dialog){
 if(!dialog.open)return true;
 const drag=workspaceDialogDrags.get(dialog);
 const rendered=getComputedStyle(dialog),start={opacity:rendered.opacity,transform:rendered.transform},lastFocus=document.activeElement;
 drag?.exit?.interrupt();workspaceDialogMotion.get(dialog)?.cancel();dialog.classList.add('dialog-leaving');
 if(!workspaceDialogExitInert.has(dialog))workspaceDialogExitInert.set(dialog,!!dialog.inert);
 dialog.inert=true;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(drag?.release){
  // Only a clean, gesture-requested cancellation reaches here synchronously. Confirmed saves use the normal locked exit.
  const outcome=await drag.waitForExit(drag.release);
  if(!outcome||workspaceDialogMotion.get(dialog)!==outcome.animation)return false;
  if(!outcome.close){
   dialog.inert=workspaceDialogExitInert.get(dialog);workspaceDialogExitInert.delete(dialog);dialog.classList.remove('dialog-leaving');
   if(document.activeElement===document.body||document.activeElement===dialog){
    (dialog.contains(lastFocus)&&!lastFocus.disabled?lastFocus:dialog).focus({preventScroll:true});
   }
   return false;
  }
 }else{
  const animation=dialog.animate(reduced?[{opacity:start.opacity},{opacity:0}]:[start,{opacity:0,transform:workspaceDialogHiddenTransform(dialog)}],{duration:workspaceDialogDuration(dialog,!reduced&&!matchMedia('(max-width:600px)').matches&&dialog.dataset.dialogPlacement==='side'?'--m-base':'--m-fade'),easing:getComputedStyle(dialog).getPropertyValue('--ease-out')});
  workspaceDialogMotion.set(dialog,animation);
  try{await animation.finished;}catch{if(workspaceDialogMotion.get(dialog)===animation){dialog.inert=workspaceDialogExitInert.get(dialog);workspaceDialogExitInert.delete(dialog);dialog.classList.remove('dialog-leaving');}return false;}
  if(workspaceDialogMotion.get(dialog)!==animation)return false;
 }
 dialog.close();dialog.classList.remove('dialog-leaving');workspaceDialogMotion.delete(dialog);
 dialog.inert=workspaceDialogExitInert.get(dialog);workspaceDialogExitInert.delete(dialog);
 const trigger=workspaceDialogTriggers.get(dialog);workspaceDialogTriggers.delete(dialog);
 if(trigger?.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true});
 return true;
}
function clearWorkspaceQuestions(){for(const question of [...workspaceQuestions])question.cancel();}
function workspaceFormSnapshot(form){return JSON.stringify([...new FormData(form)].map(([name,value])=>[name,typeof value==='string'?value:[value.name,value.size,value.lastModified]]));}
function workspaceSheetSpring(dialog,release,closing){
 const response=workspaceDialogDuration(dialog,'--m-slow'),dampingRatio=1,frequency=2*Math.PI/response;
 const stiffness=frequency*frequency,friction=2*dampingRatio*frequency,step=4;
 const target=closing?release.height:0,opacityTarget=closing?0:1,frames=[];
 const lower=Math.min(release.offset,-release.height/8),upper=Math.max(release.offset,release.height);
 let offset=release.offset,velocity=release.velocity,opacity=release.opacity;
 // Integrate in milliseconds. Stop at subpixel rest; the cap also bounds work on extreme input.
 for(let time=0;time<1000;time+=step){
  frames.push({transform:`translateY(${offset}px)`,opacity});
  if(Math.abs(offset-target)<.25&&Math.abs(velocity)<.005&&Math.abs(opacity-opacityTarget)<.005)break;
  const acceleration=stiffness*(target-offset)-friction*velocity;
  velocity+=acceleration*step;
  offset+=velocity*step;
  if(offset<lower||offset>upper){offset=Math.max(lower,Math.min(upper,offset));velocity=0;}
  const elapsed=time+step;
  opacity=opacityTarget+(release.opacity-opacityTarget)*(1+frequency*elapsed)*Math.exp(-frequency*elapsed);
 }
 frames.push({transform:`translateY(${target}px)`,opacity:opacityTarget});
 return dialog.animate(frames,{duration:(frames.length-1)*step,easing:'linear'});
}
function bindWorkspaceDialogDrag(dialog,dismiss,canDrag=()=>true){
 const existing=workspaceDialogDrags.get(dialog);
 if(existing){existing.dismiss=dismiss;existing.canDrag=canDrag;return;}
 const handle=document.createElement('div');handle.className='dialog-drag-handle';handle.setAttribute('aria-hidden','true');dialog.insertBefore(handle,dialog.firstElementChild);
 const state={dismiss,canDrag,gesture:null,release:null,exit:null};workspaceDialogDrags.set(dialog,state);
 const current=gesture=>dialog.open&&dialog.isConnected&&(state.exit||(!dialog.inert&&state.canDrag()))&&gesture.actor===(typeof me==='undefined'?null:me)&&gesture.version===workspaceDialogVersions.get(dialog);
 const reset=()=>{dialog.style.removeProperty('transform');dialog.style.removeProperty('opacity');};
 const settle=(release,close)=>{
  const animation=matchMedia('(prefers-reduced-motion: reduce)').matches
   ?dialog.animate([{opacity:release.opacity},{opacity:close?0:1}],{duration:workspaceDialogDuration(dialog,'--m-fade'),easing:getComputedStyle(dialog).getPropertyValue('--ease-out')})
   :workspaceSheetSpring(dialog,release,close);
  workspaceDialogMotion.set(dialog,animation);return animation;
 };
 const track=(gesture,event)=>{
  const delta=event.clientY-gesture.y,raw=gesture.rawStart+delta;
  // Above the resting edge the sheet approaches a quarter of its height with increasing resistance.
  gesture.distance=delta;gesture.offset=raw<0?raw/(1-raw/gesture.limit):raw;
  gesture.opacity=Math.min(1,Math.max(.4,gesture.baseOpacity-(gesture.offset-gesture.baseOffset)/gesture.height));
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)dialog.style.transform=`translateY(${gesture.offset}px)`;
  dialog.style.opacity=String(gesture.opacity);
  const time=event.timeStamp;
  gesture.samples=gesture.samples.filter(sample=>time-sample.time<=100).slice(-11);
  gesture.samples.push({time,offset:gesture.offset});
 };
 const end=(event,cancelled=false)=>{
  const gesture=state.gesture;if(!gesture||gesture.id!==event.pointerId)return;state.gesture=null;
  if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
  if(!current(gesture)){state.exit?.interrupt();reset();return;}
  if(!cancelled&&Number.isFinite(event.clientY))track(gesture,event);
  const first=gesture.samples[0],last=gesture.samples.at(-1);
  const elapsed=last.time-first.time;
  const velocity=!cancelled&&elapsed>=8?Math.max(-3,Math.min(3,(last.offset-first.offset)/elapsed)):0;
  const release={height:gesture.height,offset:gesture.offset,opacity:gesture.opacity,velocity,actor:gesture.actor,version:gesture.version};
  // A deceleration rate of .998 per millisecond yields about 499ms of projected travel.
  const projected=release.offset+velocity*499;
  const close=!cancelled&&Math.abs(gesture.distance)>=10&&projected>=release.height/2;
  if(state.exit){state.exit.settle(release,close);reset();return;}
  if(close){
   // Only an immediate guarded dismissal inherits momentum. While a discard question is open the sheet returns to rest.
   state.release=release;
   try{state.dismiss();}finally{state.release=null;}
  }
  if(dialog.open&&!dialog.inert)settle(release,false).finished.catch(()=>{});
  reset();
 };
 const begin=(event,regrab=false)=>{
  if(event.button!==0||event.isPrimary===false||state.gesture||!matchMedia('(max-width:600px)').matches||!dialog.open||(!regrab&&(dialog.inert||!state.canDrag())))return;
  event.preventDefault();
  const rendered=getComputedStyle(dialog),baseOffset=new DOMMatrixReadOnly(rendered.transform==='none'?undefined:rendered.transform).m42,baseOpacity=Number(rendered.opacity);
  const height=Math.max(1,dialog.getBoundingClientRect().height),limit=height/4;
  const rawStart=baseOffset<0?baseOffset/Math.max(.01,1+baseOffset/limit):baseOffset;
  workspaceDialogMotion.get(dialog)?.cancel();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)dialog.style.transform=`translateY(${baseOffset}px)`;
  dialog.style.opacity=String(baseOpacity);
  state.gesture={id:event.pointerId,y:event.clientY,height,limit,rawStart,offset:baseOffset,distance:0,baseOffset,opacity:baseOpacity,baseOpacity,samples:[{time:event.timeStamp,offset:baseOffset}],actor:typeof me==='undefined'?null:me,version:workspaceDialogVersions.get(dialog)};handle.setPointerCapture(event.pointerId);
 };
 // Inert native modals retarget a press to the document root. Only their moving handle may capture it.
 state.waitForExit=release=>new Promise(resolve=>{
  const finish=outcome=>{
   if(state.exit!==flight)return;
   document.removeEventListener('pointerdown',regrab,true);state.exit=null;
   if(state.gesture&&handle.hasPointerCapture(state.gesture.id))handle.releasePointerCapture(state.gesture.id);
   state.gesture=null;reset();resolve(outcome);
  };
  const regrab=event=>{
   if(!current(release)){flight.interrupt();return;}
   if(event.target!==document.documentElement||event.defaultPrevented||event.isTrusted===false||!matchMedia('(max-width:600px)').matches||event.button!==0||event.isPrimary===false||state.gesture)return;
   // A root-retargeted event cannot identify which pane won hit testing beneath a stack of inert modals.
   if(document.querySelectorAll('dialog[open]').length!==1)return;
   const box=handle.getBoundingClientRect();
   if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)return;
   flight.animation=null;begin(event,true);
  };
  const flight={animation:null,interrupt:()=>finish(null),settle:(next,close)=>{
   dialog.classList[close?'add':'remove']('dialog-leaving');
   const animation=settle(next,close);flight.animation=animation;
   animation.finished.then(()=>{if(flight.animation===animation)finish(current(release)?{animation,close}:null);},()=>{if(flight.animation===animation)finish(current(release)?{animation,close:false}:null);});
  }};
  state.exit=flight;document.addEventListener('pointerdown',regrab,true);flight.settle(release,true);
 });
 handle.addEventListener('pointerdown',event=>begin(event));
 handle.addEventListener('pointermove',event=>{
  const gesture=state.gesture;if(!gesture||gesture.id!==event.pointerId)return;
  if(!current(gesture)){end(event,true);return;}
  track(gesture,event);
 });
 handle.addEventListener('pointerup',event=>end(event));handle.addEventListener('pointercancel',event=>end(event,true));handle.addEventListener('lostpointercapture',event=>end(event,true));
 dialog.addEventListener('close',()=>{state.exit?.interrupt();state.gesture=null;reset();});
}
function bindWorkspaceDialogDismiss(dialog,{isBusy=()=>false,isDirty=()=>false}={}){
 let pending=false;
 const requestClose=async()=>{
  if(pending||!dialog.open||isBusy())return false;
  const actor=typeof me==='undefined'?null:me,version=workspaceDialogVersions.get(dialog);
  pending=true;
  try{
   if(isDirty()&&!await askConfirm({title:'Discard changes?',body:'Your unsaved changes will be lost.',confirmLabel:'Discard changes',tone:'danger'}))return false;
   if(actor!==(typeof me==='undefined'?null:me)||version!==workspaceDialogVersions.get(dialog)||!dialog.isConnected||!dialog.open||isBusy())return false;
   return await closeWorkspaceDialog(dialog);
  }finally{pending=false;}
 };
 if(!workspaceDialogDismissals.has(dialog)){
  dialog.addEventListener('cancel',event=>{event.preventDefault();workspaceDialogDismissals.get(dialog)();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)workspaceDialogDismissals.get(dialog)();});
 }
 workspaceDialogDismissals.set(dialog,requestClose);bindWorkspaceDialogDrag(dialog,requestClose,()=>!pending&&!isBusy());return requestClose;
}
function askConfirm(options){return workspaceQuestion(options,false);}
function askText(options){return workspaceQuestion(options,true);}
function workspaceQuestion({title,body='',confirmLabel='Save',tone='normal',label='',value='',validate=()=>'',maxLength=2000},text){
 return new Promise(resolve=>{
  const actor=typeof me==='undefined'?null:me,dialog=document.createElement('dialog'),form=document.createElement('form');
  const heading=document.createElement('h2'),copy=document.createElement('p'),actions=document.createElement('div'),cancel=document.createElement('button'),confirm=document.createElement('button');
  const id='workspace-question-'+(++workspaceQuestionSequence);heading.id=id;heading.textContent=title;copy.textContent=body;
  dialog.setAttribute('aria-labelledby',id);dialog.setAttribute('aria-describedby',id+'-body');copy.id=id+'-body';
  cancel.type='button';cancel.textContent='Cancel';cancel.className='button-quiet';confirm.type='submit';confirm.textContent=confirmLabel;confirm.className=tone==='danger'?'button-destructive':'button-primary';actions.className='actions';
  form.append(heading,copy);let input,error;
  if(text){const field=document.createElement('label'),caption=document.createElement('span');caption.textContent=label;input=document.createElement('input');input.type='text';input.value=String(value);input.maxLength=maxLength;input.setAttribute('aria-describedby',id+'-error');error=document.createElement('p');error.id=id+'-error';error.className='error';error.setAttribute('role','alert');field.append(caption,input);form.append(field,error);}
  actions.append(cancel,confirm);form.append(actions);dialog.append(form);document.body.append(dialog);
  let settled=false,closing=false,checkingDiscard=false;
  const finish=result=>{if(settled)return;settled=true;workspaceQuestions.delete(question);dialog.remove();resolve(result);};
  const question={cancel:()=>{workspaceDialogMotion.get(dialog)?.cancel();if(dialog.open)dialog.close();finish(text?null:false);}};
  workspaceQuestions.add(question);
  const current=()=>actor===(typeof me==='undefined'?null:me)&&dialog.isConnected;
  const close=async result=>{if(closing||settled)return;closing=true;confirm.disabled=cancel.disabled=true;const closed=await closeWorkspaceDialog(dialog);if(!closed){closing=false;confirm.disabled=cancel.disabled=false;return;}finish(current()?result:text?null:false);};
  const dismiss=async()=>{if(closing||settled||checkingDiscard)return;if(text&&input.value!==String(value)){checkingDiscard=true;const discard=await askConfirm({title:'Discard changes?',body:'Your changes to this field will be lost.',confirmLabel:'Discard changes',tone:'danger'});checkingDiscard=false;if(!discard||!current())return;}await close(text?null:false);};
  bindWorkspaceDialogDrag(dialog,dismiss,()=>!closing&&!settled&&!checkingDiscard);
  cancel.onclick=event=>{event?.stopPropagation();return dismiss();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dismiss();});
  dialog.addEventListener('close',()=>{if(!closing)finish(text?null:false);});
  const check=()=>{const problem=String(validate(input.value)||'');error.textContent=problem;input.setAttribute('aria-invalid',String(!!problem));return !problem;};
  if(text)input.addEventListener('blur',event=>{if(!fieldBlurToAction(event))check();});
  form.addEventListener('submit',event=>{event.preventDefault();if(!current()){question.cancel();return;}if(text&&!check()){input.focus();return;}close(text?input.value:true);});
  showWorkspaceDialog(dialog,{size:'small'});(text?input:tone==='danger'?cancel:confirm).focus();
 });
}
