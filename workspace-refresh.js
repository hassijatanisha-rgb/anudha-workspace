'use strict';

// Keep the current screen readable during a refresh. Workflow renderers still replace
// their markup so decorators and event handlers always receive the freshly fetched data.
let workspaceRefreshReady=null,workspaceRefreshActive=null,workspacePlaceHold=null;
function workspaceReadingPlace(target){
 const at=document.elementFromPoint?.(Math.round(window.innerWidth/2),Math.round(window.innerHeight/3));
 if(!at||!target.contains(at))return null;
 let mark=null;
 for(let node=at;node&&node!==target;node=node.parentElement){
  const text=(node.innerText||'').trim();if(!mark&&text&&text.length<=200)mark={tag:node.tagName,text,top:node.getBoundingClientRect().top};
  for(const [key,value]of Object.entries(node.dataset||{}))if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return {reference:{tag:node.tagName,data:[[key,value]]},top:node.getBoundingClientRect().top,mark};
 }
 return null;
}
function workspaceRestoreReadingPlace(state){
 const record=workspaceRefreshResolve(state.target,state.place?.reference),mark=state.place?.mark;
 const text=record&&mark&&[...(record.tagName===mark.tag?[record]:[]),...record.querySelectorAll(mark.tag.toLowerCase())].find(node=>(node.innerText||'').trim()===mark.text);
 const offset=text?text.getBoundingClientRect().top-mark.top:record?record.getBoundingClientRect().top-state.place.top:null;
 window.scrollTo({left:state.x,top:offset===null?state.y:window.scrollY+offset,behavior:'instant'});
}
function clearWorkspaceReadingPlace(){
 const hold=workspacePlaceHold;if(!hold)return;workspacePlaceHold=null;hold.observer.disconnect();clearTimeout(hold.timer);
 for(const type of ['wheel','touchstart','keydown','mousedown'])window.removeEventListener(type,hold.cancel,true);
 window.removeEventListener('scroll',hold.scroll);
 document.documentElement.style.overflowAnchor=hold.previousAnchor;
}
function holdWorkspaceReadingPlace(state){
 clearWorkspaceReadingPlace();
 const current=()=>me===state.actor&&workspaceRefreshScope()===state.scope&&document.querySelector('#content')===state.target&&state.target.firstChild===state.retainedFirst;
 const hold={current,x:window.scrollX,y:window.scrollY,previousAnchor:document.documentElement.style.overflowAnchor,cancel:()=>clearWorkspaceReadingPlace()};
 hold.scroll=()=>{if(window.scrollX!==hold.x||Math.abs(window.scrollY-hold.y)>.5)clearWorkspaceReadingPlace();};
 hold.observer=new MutationObserver(()=>{if(workspacePlaceHold!==hold)return;if(!current()||window.scrollX!==hold.x||Math.abs(window.scrollY-hold.y)>.5)return clearWorkspaceReadingPlace();workspaceRestoreReadingPlace(state);hold.x=window.scrollX;hold.y=window.scrollY;});
 workspacePlaceHold=hold;document.documentElement.style.overflowAnchor='none';hold.observer.observe(state.target,{childList:true,subtree:true});
 for(const type of ['wheel','touchstart','keydown','mousedown'])window.addEventListener(type,hold.cancel,{passive:true,capture:true});
 window.addEventListener('scroll',hold.scroll,{passive:true});
 hold.timer=setTimeout(()=>{if(workspacePlaceHold===hold)clearWorkspaceReadingPlace();},3000);
}
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
 clearWorkspaceReadingPlace();
 const state=workspaceRefreshActive;workspaceRefreshActive=null;workspaceRefreshReady=null;
 if(!state)return;
 const {target,capture}=state;
 document.removeEventListener('focusin',capture);document.removeEventListener('toggle',capture,true);window.removeEventListener('scroll',capture);
 target.classList.remove('workspace-first-load','workspace-refreshing');
 for(const item of state.inertNodes)item.node.inert=item.inert;
 if(state.previousBusy===null)target.removeAttribute('aria-busy');else target.setAttribute('aria-busy',state.previousBusy);
}
function syncWorkspaceRefresh(){
 if(workspacePlaceHold&&!workspacePlaceHold.current())clearWorkspaceReadingPlace();
 if(workspaceRefreshActive&&(workspaceRefreshActive.actor!==me||workspaceRefreshActive.scope!==workspaceRefreshScope()))clearWorkspaceRefresh();
}
function workspaceRefreshRetaining(){return workspaceRefreshActive?.retain===true;}
function workspaceSkeletonKind(){
 if(view==='inventory')return inventorySection==='stock'?'stock-lots':'table';
 if(view==='books')return typeof booksDraft!=='undefined'&&booksDraft||typeof booksTransactionSelected!=='undefined'&&booksTransactionSelected?'document':booksSection==='overview'?'overview':'report';
 if(view==='personal')return personalSection==='event'?'calendar':personalSection==='note'?'notes':'task-cards';
 if(view==='accounting')return 'accounting';
 if(view==='prices')return 'prices';
 if(view==='stockcount'||view==='tallyinvoices'||view==='reports')return 'report';
 if(view==='sales'&&(salesEditing||salesFocusedProforma||salesFocusedDelivery)||view==='purchasing'&&purchaseEditing)return 'document';
 if(view==='purchasing'&&supplierEditing||view==='leads'&&leadEditing||view==='pending'&&(pendingCreating||pendingSelectedId)||view==='service'&&(serviceIntakeOpen||serviceSelectedId))return 'form';
 return 'cards';
}
function workspaceSkeleton(kind,label){
 const bar=size=>`<span class="workspace-skeleton-bar workspace-skeleton-${size}"></span>`,repeat=(count,html)=>Array(count).fill(html).join('');
 const title=`<div class="workspace-skeleton-title">${bar('eyebrow')}${bar('heading')}${bar('copy')}</div>`;
 const header=`<div class="workspace-skeleton-header">${title}${bar('control')}</div>`;
 const toolbar=`<div class="workspace-skeleton-toolbar">${bar('search')}${bar('control')}${bar('control')}</div>`;
 const pager=`<div class="workspace-skeleton-pager">${bar('control')}${bar('short')}${bar('control')}</div>`;
 const facts=`<div class="workspace-skeleton-facts">${repeat(4,`<div>${bar('caption')}${bar('short')}</div>`)}</div>`;
 const card=`<div class="workspace-skeleton-card">${bar('subheading')}${facts}${bar('control')}</div>`;
 const cards=repeat(3,card);
 const row=`<div class="workspace-skeleton-row">${bar('copy')}${repeat(3,bar('short'))}${bar('control')}</div>`;
 const table=`<div class="workspace-skeleton-table"><div class="workspace-skeleton-row workspace-skeleton-table-head">${repeat(5,bar('caption'))}</div>${repeat(6,row)}</div>`;
 const metric=`<div class="workspace-skeleton-card">${bar('caption')}${bar('number')}</div>`,metrics=`<div class="workspace-skeleton-metrics">${repeat(4,metric)}</div>`;
 const fields=`<div class="workspace-skeleton-fields">${repeat(4,`<div>${bar('caption')}${bar('field')}</div>`)}</div>`;
 const group=`<div class="workspace-skeleton-group">${bar('subheading')}${bar('short')}</div>`;
 const layouts={
  cards:header+toolbar+cards+pager,
  table:header+toolbar+table+pager,
  'stock-lots':header+`<div class="workspace-skeleton-metrics">${repeat(5,metric)}</div>`+bar('copy')+toolbar+table+pager,
  prices:header+`<div class="workspace-skeleton-metrics">${repeat(3,metric)}</div>`+bar('copy')+toolbar+table+pager,
  report:header+toolbar+table+pager,
  form:header+`<div class="workspace-skeleton-card">${fields}${bar('multiline')}${bar('control')}</div>`,
  document:header+`<div class="workspace-skeleton-card">${fields}${table}${bar('control')}</div>`,
  overview:header+group+bar('copy')+metrics+bar('subheading')+table+bar('subheading')+table,
  calendar:header+bar('control')+`<div class="workspace-skeleton-calendar">${repeat(7,bar('caption'))}${repeat(35,`<div class="workspace-skeleton-day">${bar('caption')}</div>`)}</div>`,
  notes:header+repeat(2,`<div class="workspace-skeleton-card">${bar('subheading')}${bar('copy')}${bar('copy')}${bar('control')}</div>`)+pager,
  accounting:header+cards+`<div class="workspace-skeleton-card">${bar('subheading')}${toolbar}</div>`+cards,
  packing:header+card+bar('subheading')+repeat(3,row)+bar('subheading')+card,
  'packing-screen':`<div class="workspace-skeleton-screen"><div>${bar('heading')}${repeat(5,row)}</div><div>${bar('heading')}${repeat(3,card)}</div></div>`,
  recycle:header+group+repeat(2,row)+group+row+repeat(3,group),
  directory:toolbar+repeat(5,group),
  profile:fields+facts+bar('control'),
  'task-cards':group+repeat(2,card)+repeat(3,group),
  queue:bar('subheading')+cards+pager,
  'catalog-table':table,
  metrics
 };
 const selected=Object.hasOwn(layouts,kind)?kind:'cards',safe=String(label||'').replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));
 return `<section class="workspace-skeleton workspace-skeleton--${selected}"${safe?' aria-busy="true"':''}>${safe?`<p class="workspace-skeleton-status" role="status">${safe}</p>`:''}<div class="workspace-skeleton-shapes" aria-hidden="true">${layouts[selected]}</div></section>`;
}
function workspaceLoading(label){
 const target=document.querySelector('#content'),state=workspaceRefreshActive;
 if(!target)return;
 if(state?.target===target&&state.retain)return;
 const skeleton=document.createElement('div');skeleton.innerHTML=workspaceSkeleton(workspaceSkeletonKind(),label);
 target.replaceChildren(skeleton);if(state)state.loadingNode=skeleton;target.classList.add('workspace-first-load');
}
async function workspaceRefreshRun(renderScreen,receiver,args){
 const target=document.querySelector('#content'),actor=me,scope=workspaceRefreshScope();
 if(!target)return renderScreen.apply(receiver,args);
 // Nested renderers (My tasks inside personalWorkspace) share the outer lifecycle.
 if(workspaceRefreshActive?.target===target&&workspaceRefreshActive.actor===actor&&workspaceRefreshActive.scope===scope&&workspaceRefreshActive.rendering)return renderScreen.apply(receiver,args);
 clearWorkspaceReadingPlace();
 const previousState=workspaceRefreshActive;
 const retain=workspaceRefreshReady?.actor===actor&&workspaceRefreshReady.scope===scope&&target.firstChild===workspaceRefreshReady.first;
 const state={target,actor,scope,retain,rendering:true,first:target.firstChild,focus:null,details:[],x:window.scrollX,y:window.scrollY,previousBusy:previousState?.target===target?previousState.previousBusy:target.getAttribute('aria-busy'),inertNodes:previousState?.target===target?previousState.inertNodes:[]};
 workspaceRefreshActive=state;
 const capture=()=>{
  if(!retain||target.firstChild!==state.first)return;
  const active=document.activeElement;
  if(target.contains(active))state.focus=workspaceRefreshReference(active);else if(active!==document.body)state.focus=null;
  state.details=[...target.querySelectorAll('details')].map(node=>({reference:workspaceRefreshReference(node),open:node.open}));
  state.x=window.scrollX;state.y=window.scrollY;state.place=workspaceReadingPlace(target);
 };
 state.capture=capture;capture();document.addEventListener('focusin',capture);document.addEventListener('toggle',capture,true);window.addEventListener('scroll',capture,{passive:true});
 target.setAttribute('aria-busy','true');target.classList.toggle('workspace-refreshing',retain);if(retain)for(const node of target.children){if(!state.inertNodes.some(item=>item.node===node))state.inertNodes.push({node,inert:node.inert});node.inert=true;}
 try{const pending=renderScreen.apply(receiver,args);state.rendering=false;return await pending;}
 finally{
  state.rendering=false;document.removeEventListener('focusin',capture);document.removeEventListener('toggle',capture,true);window.removeEventListener('scroll',capture);
  if(workspaceRefreshActive===state){
   workspaceRefreshActive=null;target.classList.remove('workspace-first-load','workspace-refreshing');
   for(const item of state.inertNodes)item.node.inert=item.inert;if(state.previousBusy===null)target.removeAttribute('aria-busy');else target.setAttribute('aria-busy',state.previousBusy);
   if(me===actor&&workspaceRefreshScope()===scope&&document.querySelector('#content')===target){
    workspaceRefreshReady=target.firstChild===state.loadingNode?null:{actor,scope,first:target.firstChild};
    if(retain){
     for(const item of state.details){const node=workspaceRefreshResolve(target,item.reference);if(node)node.open=item.open;}
     const active=document.activeElement,node=workspaceRefreshResolve(target,state.focus);
     if(node&&!node.disabled&&(active===document.body||!active?.isConnected||target.contains(active)))node.focus({preventScroll:true});
     workspaceRestoreReadingPlace(state);
     if(target.firstChild!==state.first){state.retainedFirst=target.firstChild;holdWorkspaceReadingPlace(state);}
    }
   }else workspaceRefreshReady=null;
  }
 }
}
for(const name of ['inventoryWorkspace','salesDeliveryWorkspace','serviceWorkspace','purchasingWorkspace','leadsWorkspace','customerRequestsWorkspace','personalWorkspace','teamTasksWorkspace','accountingWorkspace','booksWorkspace','pendingStockWorkspace','contractsWorkspace','pricesWorkspace','travelWorkspace','stockCountWorkspace','tallyInvoicesWorkspace','projectApprovals']){
 const renderScreen=globalThis[name];
 if(typeof renderScreen==='function')globalThis[name]=function(...args){return workspaceRefreshRun(renderScreen,this,args);};
}
