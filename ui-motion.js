'use strict';

const workspacePopovers=new WeakMap(),workspaceAccountMenus=new WeakMap();
function setWorkspacePopover(panel,open,{anchor,immediate=false}={}){
 const previous=workspacePopovers.get(panel);
 if(previous?.open===open&&!immediate)return previous.finished;
 if(!previous&&panel.hidden===!open)return Promise.resolve(true);
 const wasHidden=panel.hidden,rendered=wasHidden?null:getComputedStyle(panel);
 const start={opacity:rendered?.opacity||0,transform:rendered?.transform||'scale(.98)'};
 previous?.animation?.cancel();
 const state={open,inert:previous?.inert??!!panel.inert,animation:null,finished:null};
 workspacePopovers.set(panel,state);
 if(immediate){panel.hidden=!open;panel.inert=state.inert;state.finished=Promise.resolve(true);return state.finished;}
 panel.hidden=false;panel.inert=open?state.inert:true;
 if(anchor){const rect=panel.getBoundingClientRect(),button=anchor.getBoundingClientRect();panel.style.transformOrigin=`${Math.max(0,Math.min(rect.width,button.left+button.width/2-rect.left))}px ${Math.max(0,Math.min(rect.height,button.top+button.height/2-rect.top))}px`;}
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,style=getComputedStyle(panel);
 const frames=reduced?[{opacity:start.opacity},{opacity:open?1:0}]:open?[start,{opacity:1,transform:'none'}]:[start,{opacity:0,transform:start.transform}];
 const animation=panel.animate(frames,{duration:parseFloat(style.getPropertyValue(reduced?'--m-fade':open?'--m-menu':'--m-fast')),easing:style.getPropertyValue('--ease-out')});state.animation=animation;
 state.finished=animation.finished.then(()=>{
  if(workspacePopovers.get(panel)!==state)return false;
  panel.hidden=!open;panel.inert=state.inert;state.animation=null;return true;
 },()=>false);
 return state.finished;
}
function bindWorkspaceAccountMenu(menu){
 const summary=menu.querySelector('summary'),panel=menu.querySelector('.account-menu-actions');
 panel.hidden=!menu.open;let wanted=menu.open,version=0;
 const set=async(open,restoreFocus=false)=>{
  wanted=open;const request=++version;if(open)menu.open=true;summary.setAttribute('aria-expanded',String(open));
  const finished=await setWorkspacePopover(panel,open,{anchor:summary});
  if(finished&&request===version&&menu.isConnected){if(!open)menu.open=false;if(restoreFocus)summary.focus({preventScroll:true});}
 };
 summary.setAttribute('aria-expanded',String(wanted));summary.onclick=event=>{event.preventDefault();return set(!wanted);};
 menu.onkeydown=event=>{if(event.key==='Escape'&&wanted){event.preventDefault();set(false,true);}};
 menu.onclick=event=>{if(event.target.closest('button'))set(false);};
 workspaceAccountMenus.set(menu,()=>set(false));
}
document.addEventListener('click',event=>{const menu=document.getElementById('accountMenu');if(menu?.open&&!menu.contains(event.target))workspaceAccountMenus.get(menu)?.();});

const workspaceDisclosures=new WeakMap(),workspaceDisclosureAnimations=new Set();
function workspaceDisclosureOpen(details){const state=workspaceDisclosures.get(details);return !!details?.open&&(!state?.animation||state.wanted);}
function clearWorkspaceDisclosureMotion(){for(const state of [...workspaceDisclosureAnimations])state.cancel(true);}
function bindWorkspaceDisclosure(details,panel,{current,onRequest=()=>{}}){
 const summary=details.querySelector('summary'),previous=workspaceDisclosures.get(details);
 if(previous?.panel===panel&&previous.summary===summary){previous.current=current;previous.onRequest=onRequest;return;}
 previous?.unbind();
 const state={details,panel,summary,current,onRequest,wanted:details.open,inert:!!panel.inert,animation:null,version:0};
 const active=()=>workspaceDisclosures.get(details)===state&&details.isConnected&&panel.isConnected&&details.contains(panel)&&state.current();
 const cancel=close=>{state.version++;state.animation?.cancel();state.animation=null;workspaceDisclosureAnimations.delete(state);panel.inert=state.inert;if(close){state.wanted=false;details.open=false;summary.setAttribute('aria-expanded','false');}};
 state.cancel=cancel;
 const set=open=>{
  if(!active()){cancel(true);return Promise.resolve(false);}
  const rendered=state.animation?getComputedStyle(panel):null,start={opacity:rendered?.opacity??(state.wanted?'1':'0'),transform:rendered?.transform??(state.wanted?'none':'translateY(calc(-1 * var(--space-1)))')};
  cancel(false);const version=state.version;state.wanted=open;state.onRequest(open);summary.setAttribute('aria-expanded',String(open));
  if(open)details.open=true;else if(panel.contains(document.activeElement))summary.focus({preventScroll:true});
  panel.inert=open?state.inert:true;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,style=getComputedStyle(panel);
  const frames=reduced?[{opacity:start.opacity},{opacity:open?1:0}]:[start,{opacity:open?1:0,transform:open?'none':'translateY(calc(-1 * var(--space-1)))'}];
  const animation=panel.animate(frames,{duration:parseFloat(style.getPropertyValue(reduced?'--m-fade':'--m-base')),easing:style.getPropertyValue('--ease-out')});state.animation=animation;workspaceDisclosureAnimations.add(state);
  return animation.finished.then(()=>{
   if(state.version!==version)return false;
   if(!active()){cancel(true);return false;}
   state.animation=null;workspaceDisclosureAnimations.delete(state);if(!open)details.open=false;panel.inert=state.inert;return true;
  },()=>false);
 };
 const click=event=>{if(event.defaultPrevented)return;event.preventDefault();return set(!workspaceDisclosureOpen(details));};
 // A queued native open event can arrive during exit, while open deliberately stays true.
 const toggle=()=>{if(details.open!==state.wanted&&(!state.animation||!details.open))set(details.open);};
 const keydown=event=>{if(event.defaultPrevented||event.key!=='Escape'||!workspaceDisclosureOpen(details))return;event.preventDefault();event.stopPropagation();return set(false);};
 state.unbind=()=>{cancel(false);summary.removeEventListener('click',click);details.removeEventListener('toggle',toggle);details.removeEventListener('keydown',keydown);};
 workspaceDisclosures.set(details,state);summary.setAttribute('aria-expanded',String(state.wanted));summary.addEventListener('click',click);details.addEventListener('toggle',toggle);details.addEventListener('keydown',keydown);
}

let workspaceStockTransitionIntent=null,workspaceStockTransitionActive=null;
function clearWorkspaceStockTransition(){
 workspaceStockTransitionIntent=null;
 const state=workspaceStockTransitionActive;if(!state)return;
 state.transition?.skipTransition();for(const animation of state.animations)animation.cancel();state.cleanup();
}
function beginWorkspaceStockTransition(){
 clearWorkspaceStockTransition();
 const actor=me,epoch=sessionLoadEpoch,sequence=workspaceLeaveSequence,hash=location.hash,scope=workspaceRefreshScope(),root=document.querySelector('#content');
 if(!actor||view!=='inventory'||inventorySection!=='stock'||!root?.isConnected)return;
 workspaceStockTransitionIntent={root,current:()=>me===actor&&sessionLoadEpoch===epoch&&workspaceLeaveSequence===sequence&&location.hash===hash&&workspaceRefreshScope()===scope&&root.isConnected&&document.querySelector('#content')===root};
}
function takeWorkspaceStockTransition(){const intent=workspaceStockTransitionIntent;workspaceStockTransitionIntent=null;if(intent?.current())return intent;clearWorkspaceStockTransition();return null;}
async function paintWorkspaceStockTransition(intent,paint,current){
 if(!current())return;
 // Motion intent may expire after a declined navigation; valid data must still paint.
 if(!intent?.current()){paint();return;}
 const root=intent.root,headers=new Map(),state={transition:null,animations:[],cleanup:null};
 const nameHeader=()=>{const header=root.querySelector('.workspace-page-header');if(header&&!headers.has(header)){headers.set(header,header.style.viewTransitionName||'');header.style.viewTransitionName='workspace-stock-header';}};
 state.cleanup=()=>{if(workspaceStockTransitionActive!==state)return;for(const [header,name]of headers)header.style.viewTransitionName=name;document.documentElement.classList.remove('workspace-stock-transition');workspaceStockTransitionActive=null;};
 workspaceStockTransitionActive=state;
 const fallback=()=>{
  if(!current()){state.cleanup();return;}
  try{
   paint();const style=getComputedStyle(root);
   for(const node of root.children)if(!node.matches('.workspace-page-header'))state.animations.push(node.animate([{opacity:0},{opacity:1}],{duration:parseFloat(style.getPropertyValue('--m-fade')),easing:style.getPropertyValue('--ease-out')}));
   Promise.allSettled(state.animations.map(animation=>animation.finished)).then(state.cleanup);
  }catch(error){state.cleanup();throw error;}
 };
 if(!document.startViewTransition){fallback();return;}
 document.documentElement.classList.add('workspace-stock-transition');nameHeader();let invoked=false;
 try{
  state.transition=document.startViewTransition(()=>{invoked=true;if(!current())return;paint();if(workspaceStockTransitionActive===state)nameHeader();});
 }catch(error){state.cleanup();if(invoked)throw error;workspaceStockTransitionActive=state;fallback();return;}
 state.transition.ready.catch(()=>{});state.transition.finished.then(state.cleanup,state.cleanup);
 // Only DOM failure rejects the loader. Motion cancellation is never a page error.
 await state.transition.updateCallbackDone;
}
