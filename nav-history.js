'use strict';
// The phone or browser Back button goes to the previous ERP page instead of leaving the ERP (which meant signing in
// again). Each menu choice is recorded as #/go/<view>/<section>; going Back reopens that page.
// Client and branch pages keep their own #/clients… addresses (client-profile-pages.js).
let navReplaying=false,navReplayPending=false,navPendingHash='',navPendingContext=null,navLastHash=location.hash,navHistoryAttempt=null,navHistoryRestoring=null;
let navHistoryBranch=typeof history.state?.erpNavigationBranch==='string'?history.state.erpNavigationBranch:crypto.randomUUID();
function navEntryIndex(){const index=history.state?.erpNavigationIndex;return history.state?.erpNavigationBranch===navHistoryBranch&&Number.isSafeInteger(index)?index:null;}
let navLastIndex=navEntryIndex()??0;
history.replaceState({...history.state,erpNavigationBranch:navHistoryBranch,erpNavigationIndex:navLastIndex},'',location.hash);
navListScrollMode();
const navListEntries=new Map();let navListRestoring=null,navListScrollIntent=0;
function navListEntryKey(){return navHistoryBranch+':'+navLastIndex;}
function navListKind(hash){return hash==='#/go/inventory/catalog'?'catalog':hash==='#/go/sales/proformas'?'proformas':['#/clients','#/go/contacts'].includes(hash)?'clients':null;}
function navListScrollMode(){history.scrollRestoration=navListKind(location.hash)||['product','proforma','client','branch'].includes(workspaceRecordRoute(location.hash)?.kind)?'manual':'auto';}
function navListValues(kind){
 if(kind==='catalog')return [catalogCategory,catalogSearch,catalogMachineId,catalogSort,catalogPage,catalogColour,catalogMachineProduct?.id===catalogMachineId?catalogMachineProduct.name:''];
 if(kind==='proformas')return [salesProformaSearch,salesProformaFilter,salesProformaPage,salesShown];
 return [search,filter,page];
}
function navListIsOpen(kind){return kind==='catalog'?view==='inventory'&&inventorySection==='catalog':kind==='proformas'?view==='sales'&&salesSection==='proformas'&&!salesFocusedProforma&&!salesEditing:kind==='clients'&&view==='contacts'&&!selected;}
function navListEntry(key){const entry=navListEntries.get(key);return entry&&entry.actor===me&&entry.epoch===sessionLoadEpoch?entry:null;}
function navListStore(key,entry){navListEntries.delete(key);navListEntries.set(key,entry);while(navListEntries.size>100)navListEntries.delete(navListEntries.keys().next().value);}
function navRememberListPlace(){
 if(typeof me==='undefined'||!me||navListRestoring||navReplaying)return;
 const kind=navListKind(navLastHash);if(!kind||!navListIsOpen(kind))return;
 const key=navListEntryKey(),previous=navListEntry(key)?.place,here=location.hash===navLastHash;
 const place={kind,values:navListValues(kind),x:here?window.scrollX:previous?.x??window.scrollX,y:here?window.scrollY:previous?.y??window.scrollY};
 navListStore(key,{actor:me,epoch:sessionLoadEpoch,place});
}
function navListFollowEntry(hash,sourceKey){
 if(!me||sourceKey===navListEntryKey())return;
 const source=navListEntry(sourceKey),origin=source?.place?sourceKey:source?.origin,place=navListEntry(origin)?.place,kind=navListKind(hash),record=workspaceRecordRoute(hash),recordKind={product:'catalog',proforma:'proformas',client:'clients',branch:'clients'}[record?.kind];
 if(!place||place.kind!==(kind||recordKind))return;
 navListStore(navListEntryKey(),{actor:me,epoch:sessionLoadEpoch,...(kind?{place:{...place,values:[...place.values]}}:{origin})});
}
async function navRenderListPlace(renderScreen,{reuse=false}={}){
 const place=navListEntry(navListEntryKey())?.place,kind=navListKind(location.hash);
 if(!place||place.kind!==kind||!navListIsOpen(kind))return renderScreen();
 if(!reuse){
  if(kind==='catalog'){[catalogCategory,catalogSearch,catalogMachineId,catalogSort,catalogPage,catalogColour]=place.values;catalogMachineProduct=catalogMachineId?{id:catalogMachineId,name:place.values[6]}:null;}
  else if(kind==='proformas')[salesProformaSearch,salesProformaFilter,salesProformaPage,salesShown]=place.values;
  else [search,filter,page]=place.values;
 }
 const state={actor:me,epoch:sessionLoadEpoch,key:navListEntryKey(),hash:location.hash,root:$('#content'),intent:navListScrollIntent};navListRestoring=state;
 try{
  // These three landing renderers begin synchronously; Sales establishes its
  // guarded read context before its first await.
  const pending=renderScreen(),sequence=workspaceLeaveSequence;await pending;
  const ready=kind==='catalog'?!!catalogResult&&!!$('#catalogResults'):kind==='proformas'?!!salesProformaPageData&&!!$('#proformaSearch'):!!clientDirectoryData&&!!$('#orgSearch');
  if(navListRestoring===state&&state.actor===me&&state.epoch===sessionLoadEpoch&&sequence===workspaceLeaveSequence&&state.key===navListEntryKey()&&state.hash===location.hash&&navListIsOpen(kind)&&state.root?.isConnected&&$('#content')===state.root&&state.intent===navListScrollIntent&&ready&&JSON.stringify(navListValues(kind))===JSON.stringify(place.values))window.scrollTo({left:place.x,top:place.y,behavior:'instant'});
 }finally{if(navListRestoring===state)navListRestoring=null;}
}
function clearWorkspaceNavigation(){workspaceLeaveSequence++;navWhileBusy=null;navReplayPending=false;navPendingHash='';navPendingContext=null;navHistoryAttempt=null;navHistoryRestoring=null;navReplaying=false;navListEntries.clear();navListRestoring=null;navListScrollIntent++;}
function navHash(button){return `#/go/${button.dataset.view}${button.dataset.workspaceSection?'/'+button.dataset.workspaceSection:''}`;}
function navButtonFor(hash){
 const m=String(hash||'').match(/^#\/go\/([a-z]+)(?:\/([a-z-]+))?$/);
 const view=m?m[1]:'dashboard',section=m?.[2];
 return [...document.querySelectorAll(`#nav [data-view="${view}"]`)].find(b=>(b.dataset.workspaceSection||'')===(section||''))
  ||document.querySelector(`#nav [data-view="${view}"]`);
}
function navReplay(hash,context=workspaceNavigationContext()){navPendingHash=hash;navPendingContext=context;navReplayPending=true;navResumePending();}
// Bootstrap and accounting permissions resume the requested page once they finish.
async function navResumePending(){
 if(!navReplayPending||typeof me==='undefined'||!me||(typeof busy!=='undefined'&&busy))return;
 const hash=navPendingHash,context=navPendingContext||(navPendingContext=workspaceNavigationContext());
 if(location.hash!==hash||context&&!context.current()){navReplayPending=false;navPendingHash='';navPendingContext=null;return;}
 const record=workspaceRecordRoute(hash),profile=!record&&/^#\/(clients|client|branch)\b/.test(hash),button=record?workspaceRecordButton(record.kind):profile?null:navButtonFor(hash);
 if(record?!workspaceRecordAllowed(button):!profile&&(!button||button.hidden))return;
 navReplayPending=false;navPendingHash='';navPendingContext=null;navReplaying=true;
 try{if(record)await run(()=>openWorkspaceRecord(record.kind,record.id,{replay:true,context}));else if(profile){const route=readProfileRoute();await run(()=>goProfile(route.kind,route.id,{context}));}else await navigateWorkspace(button,{replay:true,context});}
 finally{navReplaying=false;}
}
function navRecordPage(hash,{replace=false}={}){
 navRememberListPlace();const sourceKey=navListEntryKey();
 navReplayPending=false;navPendingHash='';navPendingContext=null;
 if(location.hash!==hash){
  const index=replace?navLastIndex:navLastIndex+1,state={...history.state,erp:1,erpNavigationBranch:navHistoryBranch,erpNavigationIndex:index};
  if(replace)history.replaceState(state,'',hash);else history.pushState(state,'',hash);
  navLastIndex=index;
 }
 navLastHash=hash;navListScrollMode();
 navListFollowEntry(hash,sourceKey);
}
function navRecordMenuPage(button){navRecordPage(navHash(button));}
// A page opened by a button rather than the menu (Create Pro forma on a lead, Order from supplier, Open on My tasks)
// is recorded too, so Back returns to the page the button was on. Called when the menu highlights the open page.
function navRecordOpenPage(button){
 if(!button||navReplaying||navReplayPending||/^#\/(clients|client|branch)\b/.test(location.hash))return;
 const record=workspaceRecordRoute(location.hash);if(record&&workspaceRecordMatchesPage(record,button))return;
 const hash=navHash(button);if(location.hash===hash)return;
 navRecordPage(hash,{replace:!/^#\/go\//.test(location.hash)});
}
async function navHistoryChanged(){
 const hash=location.hash,stateIndex=navEntryIndex(),index=stateIndex===navLastIndex&&hash!==navLastHash?null:stateIndex;
 if(navHistoryRestoring?.hash===hash&&navHistoryRestoring.index===index){navHistoryRestoring=null;return;}
 if(hash===navLastHash){if(index!==null&&index!==navLastIndex){workspaceLeaveSequence++;navHistoryAttempt=null;navLastIndex=index;}return;}
 if(navHistoryAttempt?.hash===hash)return;
 navRememberListPlace();const sourceKey=navListEntryKey();
 // Before sign-in hydration, defer context capture just like the initial deep link.
 const context=typeof me!=='undefined'&&me?workspaceNavigationContext():null,attempt={hash},previous=navLastHash,previousIndex=navLastIndex;navHistoryAttempt=attempt;
 try{
  const allowed=context?await confirmWorkspaceLeave(context.current):true;
  if(context&&!context.current()||navHistoryAttempt!==attempt)return;
  if(!allowed){
   if(index!==null&&index!==previousIndex){navHistoryRestoring={hash:previous,index:previousIndex};history.go(previousIndex-index);}
   // A legacy/unindexed destination has no recoverable cursor distance. Keep it
   // intact and append the retained page instead of overwriting that entry.
   else{navHistoryBranch=crypto.randomUUID();navLastIndex=-1;navRecordPage(previous);}
   return;
  }
  navLastHash=hash;
  if(index===null){navHistoryBranch=crypto.randomUUID();navLastIndex=0;history.replaceState({...history.state,erpNavigationBranch:navHistoryBranch,erpNavigationIndex:navLastIndex},'',hash);navListFollowEntry(hash,sourceKey);}else navLastIndex=index;
  navListScrollMode();navReplay(hash,context);
 }finally{if(navHistoryAttempt===attempt)navHistoryAttempt=null;}
}
window.addEventListener('popstate',navHistoryChanged);
window.addEventListener('hashchange',navHistoryChanged);
window.addEventListener('scroll',()=>{if(location.hash===navLastHash)navRememberListPlace();},{passive:true});
document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link&&/^#\/(clients|client|branch)\b/.test(link.getAttribute('href')))navRememberListPlace();},true);
for(const event of ['wheel','touchmove'])window.addEventListener(event,()=>{if(navListRestoring)navListScrollIntent++;},{passive:true});
document.addEventListener('keydown',event=>{if(navListRestoring&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)&&!event.target.closest('input,textarea,select,[contenteditable]')&&!(event.key===' '&&event.target.closest('button')))navListScrollIntent++;},true);
document.addEventListener('pointerdown',event=>{if(navListRestoring&&(event.target===document.documentElement||event.target===document.body))navListScrollIntent++;},true);
// Reloading the page reopens the page that was showing.
if(/^#\/go\//.test(location.hash)||workspaceRecordRoute(location.hash))navReplay(location.hash,null);
