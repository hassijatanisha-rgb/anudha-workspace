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
 previous?.cancel();
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
 const rendered=getComputedStyle(dialog),start={opacity:rendered.opacity,transform:rendered.transform};
 workspaceDialogMotion.get(dialog)?.cancel();dialog.classList.add('dialog-leaving');
 if(!workspaceDialogExitInert.has(dialog))workspaceDialogExitInert.set(dialog,!!dialog.inert);
 dialog.inert=true;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const animation=dialog.animate(reduced?[{opacity:start.opacity},{opacity:0}]:[start,{opacity:0,transform:workspaceDialogHiddenTransform(dialog)}],{duration:workspaceDialogDuration(dialog,!reduced&&!matchMedia('(max-width:600px)').matches&&dialog.dataset.dialogPlacement==='side'?'--m-base':'--m-fade'),easing:getComputedStyle(dialog).getPropertyValue('--ease-out')});
 workspaceDialogMotion.set(dialog,animation);
 try{await animation.finished;}catch{if(workspaceDialogMotion.get(dialog)===animation){dialog.inert=workspaceDialogExitInert.get(dialog);workspaceDialogExitInert.delete(dialog);dialog.classList.remove('dialog-leaving');}return false;}
 if(workspaceDialogMotion.get(dialog)!==animation)return false;
 dialog.close();dialog.classList.remove('dialog-leaving');workspaceDialogMotion.delete(dialog);
 dialog.inert=workspaceDialogExitInert.get(dialog);workspaceDialogExitInert.delete(dialog);
 const trigger=workspaceDialogTriggers.get(dialog);workspaceDialogTriggers.delete(dialog);
 if(trigger?.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true});
 return true;
}
function clearWorkspaceQuestions(){for(const question of [...workspaceQuestions])question.cancel();}
function workspaceFormSnapshot(form){return JSON.stringify([...new FormData(form)].map(([name,value])=>[name,typeof value==='string'?value:[value.name,value.size,value.lastModified]]));}
function bindWorkspaceDialogDrag(dialog,dismiss,canDrag=()=>true){
 const existing=workspaceDialogDrags.get(dialog);
 if(existing){existing.dismiss=dismiss;existing.canDrag=canDrag;return;}
 const handle=document.createElement('div');handle.className='dialog-drag-handle';handle.setAttribute('aria-hidden','true');dialog.insertBefore(handle,dialog.firstElementChild);
 const state={dismiss,canDrag,gesture:null};workspaceDialogDrags.set(dialog,state);
 const current=gesture=>dialog.open&&!dialog.inert&&dialog.isConnected&&state.canDrag()&&gesture.actor===(typeof me==='undefined'?null:me)&&gesture.version===workspaceDialogVersions.get(dialog);
 const reset=()=>{dialog.style.removeProperty('transform');dialog.style.removeProperty('opacity');};
 const end=(event,cancelled=false)=>{
  const gesture=state.gesture;if(!gesture||gesture.id!==event.pointerId)return;state.gesture=null;
  if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
  const rendered=getComputedStyle(dialog),start={opacity:rendered.opacity,transform:rendered.transform};reset();
  if(!current(gesture))return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation=dialog.animate(reduced?[{opacity:start.opacity},{opacity:1}]:[start,{opacity:1,transform:'none'}],{duration:workspaceDialogDuration(dialog,reduced?'--m-fade':'--m-base'),easing:rendered.getPropertyValue('--ease-out')});
  workspaceDialogMotion.set(dialog,animation);animation.finished.catch(()=>{});
  if(!cancelled&&gesture.distance>=Math.min(80,dialog.getBoundingClientRect().height/4))state.dismiss();
 };
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.isPrimary===false||!matchMedia('(max-width:600px)').matches||!dialog.open||dialog.inert||!state.canDrag())return;
  event.preventDefault();
  const rendered=getComputedStyle(dialog),baseOffset=new DOMMatrixReadOnly(rendered.transform==='none'?undefined:rendered.transform).m42,baseOpacity=Number(rendered.opacity);
  workspaceDialogMotion.get(dialog)?.cancel();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)dialog.style.transform=`translateY(${baseOffset}px)`;
  dialog.style.opacity=String(baseOpacity);
  state.gesture={id:event.pointerId,y:event.clientY,offset:baseOffset,distance:0,baseOffset,baseOpacity,actor:typeof me==='undefined'?null:me,version:workspaceDialogVersions.get(dialog)};handle.setPointerCapture(event.pointerId);
 });
 handle.addEventListener('pointermove',event=>{
  const gesture=state.gesture;if(!gesture||gesture.id!==event.pointerId)return;
  if(!current(gesture)){end(event,true);return;}
  const delta=event.clientY-gesture.y;gesture.distance=Math.max(0,delta);gesture.offset=Math.max(0,gesture.baseOffset+delta);
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)dialog.style.transform=`translateY(${gesture.offset}px)`;
  dialog.style.opacity=String(Math.min(1,Math.max(.4,gesture.baseOpacity-delta/Math.max(1,dialog.getBoundingClientRect().height))));
 });
 handle.addEventListener('pointerup',event=>end(event));handle.addEventListener('pointercancel',event=>end(event,true));handle.addEventListener('lostpointercapture',event=>end(event,true));
 dialog.addEventListener('close',()=>{state.gesture=null;reset();});
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
