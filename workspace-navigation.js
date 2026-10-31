'use strict';

// Navigation only: these links reuse the existing permission-checked workflows.
const workspaceGroups=[
 {name:'Workspace',tone:'workspace',items:[
  ['Dashboard','dashboard'],['My tasks','personal','task'],['Reports','reports'],
  ['My notes & reminders','personal','note'],['My calendar','personal','event'],['Travel requests','travel']
 ]},
 {name:'Sales',tone:'sales',items:[
  ['Client accounts','contacts'],['Leads','leads','leads'],['Website inquiries','requests','inquiries'],['Complaints','requests','complaints'],['Pro formas','sales','proformas'],['Contracts','contracts'],['Product prices','prices']
 ]},
 {name:'Stores',tone:'stores',items:[
  ['Product search','inventory','catalog'],['Delivery progress','sales','delivery'],['Packing queue','packing','queue'],['Packing TV screen','packing','screen'],['Pending stock orders','pending'],['Purchasing','purchasing','orders'],['Suppliers','purchasing','suppliers'],
  ['Stock & availability','inventory','stock'],['Move stock','inventory','transfers'],['Godowns & locations','inventory','locations'],['Stock count','stockcount','count'],['Review stock counts','stockcount','review'],['Tally stock review','inventory','review']
 ]},
 {name:'Service',tone:'service',items:[
  ['Machines to install','service','installations'],['Service & maintenance schedule','service','schedule'],
  ['Service forms','service','forms']
 ]},
 {name:'Accounts',tone:'accounts',items:[
  ['Accounting forms','accounting'],['Books overview','books','overview'],['Customer invoices','books','invoices'],['Customer receipts','books','receipts'],['Journal entries','books','journal'],['Chart of accounts','books','accounts'],['Financial reports','books','reports'],['Import Excel','books','import'],['Opening receivables','books','opening']
 ]},
 {name:'Admin',tone:'admin',items:[
  ['How to use','guide'],['Staff','staff'],['My settings','settings'],['Deleted items','recycle'],['Questions for the owner','approvals']
 ]}
];
// Shown only once the signed-in person is known to be the owner (app.js load) or to have accounting access.
// Keys are a view, or view:section for one page of a view.
const ownerOnlyViews=new Set(['staff','approvals','recycle','stockcount:review','inventory:review']);
let accountingNavigationRequest=0;
async function showAccountingNavigation(){
 const actor=me,epoch=sessionLoadEpoch,request=++accountingNavigationRequest,nav=document.querySelector('#nav'),items=[...document.querySelectorAll('#nav [data-accounting-only]')];if(!actor||!nav?.isConnected||!items.length)return;
 const current=()=>me===actor&&sessionLoadEpoch===epoch&&accountingNavigationRequest===request&&document.querySelector('#nav')===nav&&nav.isConnected&&items.every(item=>item.isConnected&&nav.contains(item));
 items.forEach(item=>item.hidden=true);
 let allowed=false;try{const result=await client.rpc('accounting_access');allowed=result?.data===true}catch{allowed=false}
 if(!current())return;
 items.forEach(item=>item.hidden=!allowed);
 if(typeof navResumePending==='function')navResumePending();
}
let navWhileBusy=null,workspaceLeaveSequence=0;
function workspaceNavigationContext(){
 clearWorkspaceStockTransition();
 const actor=me,epoch=sessionLoadEpoch,sourceView=view,scope=workspaceRefreshScope(),hash=location.hash,request=++workspaceLeaveSequence;
 return {current:()=>me===actor&&sessionLoadEpoch===epoch&&view===sourceView&&workspaceRefreshScope()===scope&&location.hash===hash&&request===workspaceLeaveSequence};
}
async function confirmWorkspaceLeave(current=workspaceNavigationContext().current){
 for(const guard of [returnCreditPostingConfirmLeave,financialImportConfirmLeave,openingReceivablesConfirmLeave,salesConfirmLeave,inventoryConfirmLeave,confirmPurchasingLeave]){
  if(!current()||!await guard(current))return false;
 }
 return current();
}
async function navigateWorkspace(button,{replay=false,context=null}={}){
 if(!me||context&&!context.current())return;
 context||=workspaceNavigationContext();
 if(!await confirmWorkspaceLeave(context.current)||!button.isConnected||button.hidden)return;
 if(busy){navWhileBusy={button,context,replay};actionFeedbackQueueNavigation(button);return;}
 return run(async()=>{
  if(!context.current()||!button.isConnected||button.hidden)return;
  navRememberListPlace();
  const target=button.dataset.view,section=button.dataset.workspaceSection,previousHash=location.hash,previousScope=workspaceRefreshScope();
  if(button.closest('#nav')&&document.getElementById('workspaceMenuToggle'))navMobileSet(false,true);
  if(target==='contacts')return goProfile('clients');
  message('');
  if(target==='personal'){personalSection=section||'event';personalPage=0;}
  if(target==='leads')openLeadSection(section);
  if(target==='purchasing')openPurchaseSection(section);
  if(target==='stockcount')openStockCountSection(section);
  if(target==='packing')openPackingSection(section);
  if(target==='sales'){clearSalesPrefill();salesLoaded=false;salesFocusedProforma='';salesFocusedDelivery='';salesSection=section==='new'?'proformas':section||'proformas';salesEditing=section==='new'?'new':'';}
  if(target==='contracts'){contractFocus='';contractPage=0;}
  if(target==='service'){serviceLoaded=false;serviceSection=section||'installations';}
  if(target==='books')openBooksSection(section);
  if(target==='requests')openRequestSection(section);
  if(target==='inventory')inventorySection=section||'stock';
  if(!replay)navRecordMenuPage(button);
  view=target;search='';page=0;
  if(target==='inventory'&&inventorySection==='stock'&&(previousHash!==location.hash||previousScope!==workspaceRefreshScope()))beginWorkspaceStockTransition();
  const rendered=navRenderListPlace(render);
  // The renderer establishes its guarded request synchronously before its first await.
  const actor=me,epoch=sessionLoadEpoch,hash=location.hash,scope=workspaceRefreshScope(),root=$('#content'),request=workspaceLeaveSequence;
  const current=()=>me===actor&&sessionLoadEpoch===epoch&&location.hash===hash&&workspaceRefreshScope()===scope&&$('#content')===root&&request===workspaceLeaveSequence;
  await rendered;
  if(target==='sales'&&salesSection==='proformas'&&current())await restoreProformaDraft({current});
 });
}
function installWorkspaceNavigation(){
 const nav=document.querySelector('#nav');
 // The stock count screen is temporary; ERP_CONFIG.stockCountEnabled=false removes it from the menu.
 const shown=([,target])=>target!=='stockcount'||globalThis.ERP_CONFIG?.stockCountEnabled!==false;
 nav.innerHTML=workspaceGroups.map(group=>`<section class="nav-group nav-${group.tone}" aria-label="${group.name}"><h2>${group.name}</h2>${group.items.filter(shown).map(([label,target,section])=>target?`<button type="button" data-view="${target}"${section?` data-workspace-section="${section}"`:''}${target==='staff'?' id="staffNav" hidden':''}${ownerOnlyViews.has(target)||ownerOnlyViews.has(`${target}:${section}`)?' data-owner-only hidden':''}${target==='accounting'||target==='books'?' data-accounting-only hidden':''}>${label}</button>`:`<div class="nav-unavailable">${label}<small>Not connected yet</small></div>`).join('')}</section>`).join('');
 nav.setAttribute('aria-label','Workspace sections');
 document.querySelector('main').before(nav);
 const header=document.querySelector('body>header');
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{
  document.documentElement.style.setProperty('--workspace-header-height',`${header.getBoundingClientRect().height}px`);
 }).observe(header);
 document.addEventListener('click',event=>{
  const button=event.target.closest('#nav [data-view]');if(!button)return;
  // Consume the original event before awaiting: history and app listeners must not navigate yet.
  event.preventDefault();event.stopImmediatePropagation();
  return navigateWorkspace(button);
 },true);
}
function syncWorkspaceNavigation(){
 if(typeof applyStockProtection==='function')applyStockProtection();
 // The packing TV screen hides the header and menu; any other page brings them back.
 if(typeof syncPackingScreenMode==='function')syncPackingScreenMode();
 // The Dashboard is for the owner and department heads; staff start on My tasks.
 document.querySelectorAll('#nav [data-view="dashboard"]').forEach(button=>button.hidden=me?.role==='staff');
 // My tasks refreshes once after both panes settle and their seen cutoffs are saved.
 if(view==='personal'&&personalSection==='task'){if(typeof bellInstall==='function')bellInstall();}
 else if(typeof refreshNotificationBell==='function')refreshNotificationBell().catch(()=>{});
 document.querySelectorAll('#nav [data-view]').forEach(button=>{
  const target=button.dataset.view,section=button.dataset.workspaceSection;
  const current=target==='sales'?salesSection:target==='service'?serviceSection:target==='inventory'?inventorySection:target==='personal'?personalSection:target==='leads'&&typeof leadSection!=='undefined'?leadSection:target==='purchasing'&&typeof purchaseSection!=='undefined'?purchaseSection:target==='stockcount'&&typeof countTab!=='undefined'?countTab:target==='requests'&&typeof requestSection!=='undefined'?requestSection:target==='packing'&&typeof packingSection!=='undefined'?packingSection:target==='books'&&typeof booksSection!=='undefined'?booksSection:null;
  const active=target===view&&(!section||section===current);
  button.classList.toggle('active',active);
  if(active){button.setAttribute('aria-current','page');if(typeof navRecordOpenPage==='function')navRecordOpenPage(button);}else button.removeAttribute('aria-current');
 });
}
installWorkspaceNavigation();
