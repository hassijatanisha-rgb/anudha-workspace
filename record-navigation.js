'use strict';
const workspaceRecordKinds={client:['contacts',''],branch:['contacts',''],product:['inventory','catalog'],proforma:['sales','proformas'],invoice:['books','invoices']};
function workspaceRecordRoute(hash){
 const match=String(hash||'').match(/^#\/(client|branch|product|proforma|invoice)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
 return match?{kind:match[1].toLowerCase(),id:match[2].toLowerCase()}:null;
}
function workspaceRecordButton(kind){
 const target=workspaceRecordKinds[kind];if(!target)return null;
 return [...document.querySelectorAll('#nav [data-view]')].find(button=>button.dataset.view===target[0]&&(button.dataset.workspaceSection||'')===target[1])||null;
}
function workspaceRecordAllowed(button){return !!me&&!!button?.isConnected&&!button.hidden&&!button.closest('#nav')?.hidden&&!button.closest('.nav-group')?.hidden;}
function workspaceRecordMatchesPage(route,button){
 const target=workspaceRecordKinds[route.kind];
 if(button.dataset.view!==target[0]||(button.dataset.workspaceSection||'')!==target[1])return false;
 if(route.kind==='proforma')return salesFocusedProforma===route.id&&(!salesEditing||(salesEditing===route.id&&proformaDraftMatchesRecord(route.id)));
 return true;
}
function workspaceRecordFailure(kind,id,error,current){
 if(!current())return;
 const button=workspaceRecordButton(kind),title={product:'Product',proforma:'Pro forma',invoice:'Invoice',client:'Client',branch:'Branch'}[kind];
 $('#content').innerHTML=workspacePageHeader({title:title+' unavailable',back:'<button type="button" id="recordBack">← Back to register</button>'})+`<section class="card"><p role="alert">${esc(error.message||'This record could not be loaded.')}</p><button type="button" id="recordRetry">Retry loading record</button></section>`;
 $('#recordBack').onclick=()=>{if(current()&&workspaceRecordAllowed(button))return navigateWorkspace(button);};
 const retry=$('#recordRetry');retry.onclick=()=>{if(current()&&retry.isConnected)return run(()=>openWorkspaceRecord(kind,id),{origin:retry,errorTarget:retry.parentElement});};
}
async function openWorkspaceRecord(kind,id,{context=workspaceNavigationContext(),replay=false}={}){
 if(kind==='opening_balance')kind='invoice';
 if(!Object.hasOwn(workspaceRecordKinds,kind)||typeof id!=='string')return false;
 const route=workspaceRecordRoute(`#/${kind}/${id}`),button=workspaceRecordButton(kind);
 if(!route||!context?.current()||!workspaceRecordAllowed(button))return false;
 id=route.id;
 const source={current:()=>context.current()&&workspaceRecordAllowed(button)},hash=`#/${kind}/${id}`;
 if(kind==='client'||kind==='branch'){
  const actor=me,session=sessionLoadEpoch;
  try{return await goProfile(kind,id,{context:source});}
  catch(error){
   const current=()=>me===actor&&sessionLoadEpoch===session&&view==='contacts'&&selected===id&&location.hash===hash&&workspaceRecordAllowed(button);
   if(current()){workspaceRecordFailure(kind,id,error,current);return true;}
   return false;
  }
 }
 if(!await confirmWorkspaceLeave(source.current)||!source.current())return false;
 navRememberListPlace();
 const actor=me,session=sessionLoadEpoch;
 if(kind==='product'){view='inventory';inventorySection='catalog';}
 else if(kind==='proforma'){view='sales';salesSection='proformas';salesFocusedProforma=id;salesFocusedDelivery='';salesEditing='';clearSalesPrefill();}
 else{view='books';openBooksSection('invoices');}
 if(!replay)navRecordPage(hash);else if(location.hash!==hash)navRecordPage(hash,{replace:true});
 const scope=workspaceRefreshScope(),navigationRequest=workspaceLeaveSequence,current=()=>navigationRequest===workspaceLeaveSequence&&me===actor&&sessionLoadEpoch===session&&location.hash===hash&&workspaceRefreshScope()===scope&&workspaceRecordAllowed(button);
 syncWorkspaceNavigation();
 try{
  if(kind==='product'){
   if(!$('#catalogResults'))await catalogInventory();
   else if(current())await catalogOpenRecord(id);
  }else if(kind==='proforma'){await salesDeliveryWorkspace(false,{current});if(current()){window.scrollTo?.(0,0);await restoreProformaDraft({current});}}
  else await booksInvoiceRecordWorkspace(id);
 }catch(error){workspaceRecordFailure(kind,id,error,current);}
 return true;
}
