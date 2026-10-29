'use strict';

// Keep the current screen readable during a refresh. Workflow renderers still replace
// their markup so decorators and event handlers always receive the freshly fetched data.
let workspaceRefreshReady=null,workspaceRefreshActive=null;
function workspaceRefreshScope(){
 const sections={inventory:()=>inventorySection,sales:()=>[salesSection,salesFocusedProforma,salesFocusedDelivery,salesEditing],service:()=>serviceSection,personal:()=>[personalSection,personalPage,personalMonth],purchasing:()=>[purchaseSection,purchaseEditing,supplierEditing],leads:()=>[leadSection,leadEditing],requests:()=>requestSection,books:()=>booksSection,stockcount:()=>countTab,packing:()=>packingSection};
 return JSON.stringify([view,sections[view]?.()]);
}
function workspaceRefreshReference(node){
 if(!node)return null;
 const data=Object.entries(node.dataset||{}).filter(([key])=>!['version','busy'].includes(key));
 if(node.id||data.length)return {tag:node.tagName,id:node.id,data};
 if(node.tagName==='DETAILS'){
  const card=node.closest('article,.card,section');
  return {tag:'DETAILS',summary:node.querySelector('summary')?.textContent,heading:card?.querySelector('h2,h3')?.textContent};
 }
 return null;
}
function workspaceRefreshResolve(target,reference){
 if(!reference)return null;
 const matches=[...target.querySelectorAll(reference.tag.toLowerCase())].filter(node=>{
  if(reference.id)return node.id===reference.id;
  if(reference.data?.length)return reference.data.every(([key,value])=>node.dataset[key]===value);
  const card=node.closest('article,.card,section');
  return node.querySelector('summary')?.textContent===reference.summary&&card?.querySelector('h2,h3')?.textContent===reference.heading;
 });
 return matches.length===1?matches[0]:null;
}
function clearWorkspaceRefresh(){
 const state=workspaceRefreshActive;workspaceRefreshActive=null;workspaceRefreshReady=null;
 if(!state)return;
 const {target,capture}=state;
 document.removeEventListener('focusin',capture);document.removeEventListener('toggle',capture,true);window.removeEventListener('scroll',capture);
 target.classList.remove('workspace-first-load','workspace-refreshing');
 for(const item of state.inertNodes)item.node.inert=item.inert;
 if(state.previousBusy===null)target.removeAttribute('aria-busy');else target.setAttribute('aria-busy',state.previousBusy);
}
function syncWorkspaceRefresh(){
 if(workspaceRefreshActive&&(workspaceRefreshActive.actor!==me||workspaceRefreshActive.scope!==workspaceRefreshScope()))clearWorkspaceRefresh();
}
function workspaceRefreshRetaining(){return workspaceRefreshActive?.retain===true;}
function workspaceLoading(label){
 const target=document.querySelector('#content'),state=workspaceRefreshActive;
 if(!target)return;
 if(state?.target===target&&state.retain)return;
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent=label;
 target.replaceChildren(status);if(state)state.loadingNode=status;target.classList.add('workspace-first-load');
}
async function workspaceRefreshRun(renderScreen,receiver,args){
 const target=document.querySelector('#content'),actor=me,scope=workspaceRefreshScope();
 if(!target)return renderScreen.apply(receiver,args);
 // Nested renderers (My tasks inside personalWorkspace) share the outer lifecycle.
 if(workspaceRefreshActive?.target===target&&workspaceRefreshActive.actor===actor&&workspaceRefreshActive.scope===scope&&workspaceRefreshActive.rendering)return renderScreen.apply(receiver,args);
 const previousState=workspaceRefreshActive;
 const retain=workspaceRefreshReady?.actor===actor&&workspaceRefreshReady.scope===scope&&target.firstChild===workspaceRefreshReady.first;
 const state={target,actor,scope,retain,rendering:true,first:target.firstChild,focus:null,details:[],x:window.scrollX,y:window.scrollY,previousBusy:previousState?.target===target?previousState.previousBusy:target.getAttribute('aria-busy'),inertNodes:previousState?.target===target?previousState.inertNodes:[]};
 workspaceRefreshActive=state;
 const capture=()=>{
  if(!retain||target.firstChild!==state.first)return;
  const active=document.activeElement;
  if(target.contains(active))state.focus=workspaceRefreshReference(active);else if(active!==document.body)state.focus=null;
  state.details=[...target.querySelectorAll('details')].map(node=>({reference:workspaceRefreshReference(node),open:node.open}));
  state.x=window.scrollX;state.y=window.scrollY;
 };
 state.capture=capture;capture();document.addEventListener('focusin',capture);document.addEventListener('toggle',capture,true);window.addEventListener('scroll',capture,{passive:true});
 target.setAttribute('aria-busy','true');target.classList.toggle('workspace-refreshing',retain);if(retain)for(const node of target.children){if(!state.inertNodes.some(item=>item.node===node))state.inertNodes.push({node,inert:node.inert});node.inert=true;}
 try{const pending=renderScreen.apply(receiver,args);state.rendering=false;return await pending;}
 finally{
  state.rendering=false;document.removeEventListener('focusin',capture);document.removeEventListener('toggle',capture,true);window.removeEventListener('scroll',capture);
  if(workspaceRefreshActive===state){
   workspaceRefreshActive=null;target.classList.remove('workspace-first-load','workspace-refreshing');
   for(const item of state.inertNodes)item.node.inert=item.inert;if(state.previousBusy===null)target.removeAttribute('aria-busy');else target.setAttribute('aria-busy',state.previousBusy);
   if(me===actor&&workspaceRefreshScope()===scope){
    workspaceRefreshReady=target.firstChild===state.loadingNode?null:{actor,scope,first:target.firstChild};
    if(retain){
     for(const item of state.details){const node=workspaceRefreshResolve(target,item.reference);if(node)node.open=item.open;}
     const active=document.activeElement,node=workspaceRefreshResolve(target,state.focus);
     if(node&&!node.disabled&&(active===document.body||!active?.isConnected||target.contains(active)))node.focus({preventScroll:true});
     window.scrollTo({left:state.x,top:state.y,behavior:'instant'});
    }
   }else workspaceRefreshReady=null;
  }
 }
}
for(const name of ['inventoryWorkspace','salesDeliveryWorkspace','serviceWorkspace','purchasingWorkspace','leadsWorkspace','customerRequestsWorkspace','personalWorkspace','teamTasksWorkspace','accountingWorkspace','booksWorkspace','pendingStockWorkspace','contractsWorkspace','pricesWorkspace','travelWorkspace','stockCountWorkspace','tallyInvoicesWorkspace','projectApprovals']){
 const renderScreen=globalThis[name];
 if(typeof renderScreen==='function')globalThis[name]=function(...args){return workspaceRefreshRun(renderScreen,this,args);};
}
