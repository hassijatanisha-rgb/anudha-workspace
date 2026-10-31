'use strict';

let workspaceSearchState=null,workspaceSearchInstalled=false,workspaceSearchSequence=0;
const workspaceSearchGroups=[['clients','Clients',['client','branch']],['products','Products',['product']],['proformas','Pro formas',['proforma']],['invoices','Invoices',['invoice','opening_balance']]];
function workspaceSearchLocked(){
 const invoice=document.querySelector('#booksInvoiceForm'),post=document.querySelector('#booksInvoicePost');
 // An uncertain invoice keeps its submitted fieldset locked while enabling only its safe retry.
 const invoiceUncertain=!!invoice?.querySelector('fieldset:disabled')&&!!post&&!post.disabled;
 return busy||financialImportIsPosting()||openingReceivablesState?.busy||openingReceivablesState?.uncertain||returnCreditPostingState?.busy||returnCreditPostingState?.uncertain||document.querySelector('#proformaForm,#deliveryForm')?.dataset.saving==='true'||invoiceUncertain;
}
function workspaceSearchResult(data,query){
 const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
 if(!keys(data,['query','groups'])||data.query!==query||!keys(data.groups,workspaceSearchGroups.map(([key])=>key)))throw Error('Search returned incomplete results. Try again.');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 return workspaceSearchGroups.map(([key,label,kinds])=>{
  const group=data.groups[key];
  if(!keys(group,['available','rows','has_more'])||typeof group.available!=='boolean'||typeof group.has_more!=='boolean'||!Array.isArray(group.rows)||group.rows.length>5||!group.available&&(group.rows.length||group.has_more)||group.has_more&&group.rows.length!==5||['clients','products'].includes(key)&&!group.available)throw Error('Search returned incomplete results. Try again.');
  const seen=new Set(),rows=group.rows.map(row=>{
   if(!keys(row,['id','title','subtitle','kind'])||typeof row.id!=='string'||!uuid.test(row.id)||seen.has(row.id.toLowerCase())||!kinds.includes(row.kind)||typeof row.title!=='string'||!row.title.trim()||[...row.title].length>180||typeof row.subtitle!=='string'||[...row.subtitle].length>180)throw Error('Search returned incomplete results. Try again.');
   seen.add(row.id.toLowerCase());return {id:row.id,kind:row.kind,title:row.title,subtitle:row.subtitle};
  });
  return {key,label,available:group.available,hasMore:group.has_more,rows};
 });
}
function clearWorkspaceSearch(){
 workspaceSearchState?.dispose();
 document.getElementById('workspaceSearch')?.remove();
}
function openWorkspaceSearch(trigger=document.getElementById('workspaceSearch')){
 if(!me?.user_id||workspaceSearchLocked()||[...document.querySelectorAll('dialog')].some(dialog=>dialog.open&&dialog!==workspaceSearchState?.dialog))return false;
 if(workspaceSearchState){if(workspaceSearchState.current()){workspaceSearchState.input.focus({preventScroll:true});return true;}workspaceSearchState.dispose();}
 const actor=me,epoch=sessionLoadEpoch,sourceView=view,scope=workspaceRefreshScope(),hash=location.hash;
 const dialog=document.createElement('dialog');dialog.id='workspaceSearchDialog';dialog.className='workspace-search no-print';
 const id='workspace-search-'+(++workspaceSearchSequence);
 dialog.innerHTML=`<div class="workspace-search-heading"><h2>Search workspace</h2><button type="button" class="button-quiet" data-search-close>Close</button></div><label class="workspace-search-label" for="${id}-input">Clients, products, Pro formas and invoices</label><input id="${id}-input" type="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-results" aria-describedby="${id}-status" autocomplete="off" spellcheck="false"><p id="${id}-status" class="workspace-search-status">Type at least 2 characters.</p><div id="${id}-results" class="workspace-search-results" role="listbox" aria-label="Search results"></div>`;
 document.body.append(dialog);
 const input=dialog.querySelector('input'),status=dialog.querySelector('.workspace-search-status'),results=dialog.querySelector('[role="listbox"]'),close=dialog.querySelector('[data-search-close]');
 const state={dialog,input,request:0,timer:null,selecting:false,disposed:false,options:[],active:-1,query:'',observer:null};
 const identity=()=>workspaceSearchState===state&&!state.disposed&&me===actor&&sessionLoadEpoch===epoch&&dialog.isConnected&&dialog.open;
 const current=()=>identity()&&view===sourceView&&workspaceRefreshScope()===scope&&location.hash===hash;
 state.current=current;
 const feedback=text=>{actionFeedbackShow(actionFeedbackReference(input),'','success',status);const announcement=document.createElement('span');announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');announcement.textContent=text;status.replaceChildren(announcement);};
 const resetResults=()=>{state.options=[];state.active=-1;state.query='';results.replaceChildren();input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
 const dispose=()=>{
  if(state.disposed)return;state.disposed=true;clearTimeout(state.timer);state.request++;
  state.observer?.disconnect();window.removeEventListener('hashchange',check);window.removeEventListener('popstate',check);
  actionFeedbackShow(actionFeedbackReference(input),'','success',status);
  // A committed route or session change must not return focus to the old page.
  dialog.getAnimations().forEach(animation=>animation.cancel());if(dialog.open)dialog.close();dialog.remove();
  state.options=[];if(workspaceSearchState===state)workspaceSearchState=null;
 };
 state.dispose=dispose;workspaceSearchState=state;
 const check=()=>{if(!identity()||!state.selecting&&!current())dispose();};
 const activate=index=>{
  state.active=index;state.options.forEach((option,i)=>option.node.setAttribute('aria-selected',String(i===index)));
  if(index<0){input.removeAttribute('aria-activedescendant');return;}
  const node=state.options[index].node;input.setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});
 };
 const choose=option=>{
  if(!current()||state.selecting||dialog.inert||!state.options.includes(option)||state.query!==input.value.trim())return;
  if(busy){actionFeedbackRefuse(option.node,status);return;}
  if(workspaceSearchLocked()){actionFeedbackShow(actionFeedbackReference(option.node),'Finish or reconcile the current action before opening another record.','error',status);return;}
  const navigation=workspaceNavigationContext(),navigationRequest=workspaceLeaveSequence,request=state.request,query=state.query;
  const context={current:()=>current()&&navigation.current()&&request===state.request&&query===state.query&&query===input.value.trim()&&state.options.includes(option)};
  state.selecting=true;input.readOnly=true;
  return run(async()=>{
   try{
    if(!context.current())return;
    const opened=await openWorkspaceRecord(option.kind,option.id,{context});
    if(opened===true&&identity()){
     const destinationHash=location.hash,destinationView=view,destinationScope=workspaceRefreshScope(),root=document.querySelector('#content'),route=workspaceRecordRoute(destinationHash),focused=document.activeElement;
     const focusDestination=navigationRequest===workspaceLeaveSequence&&request===state.request&&query===state.query&&query===input.value.trim()&&route?.kind===(option.kind==='opening_balance'?'invoice':option.kind)&&route.id===option.id.toLowerCase()&&(dialog.contains(focused)||focused===document.body);
     dispose();
     if(focusDestination&&me===actor&&sessionLoadEpoch===epoch&&navigationRequest===workspaceLeaveSequence&&location.hash===destinationHash&&view===destinationView&&workspaceRefreshScope()===destinationScope&&root?.isConnected&&document.querySelector('#content')===root&&![...document.querySelectorAll('dialog')].some(dialog=>dialog.open)&&(document.activeElement===document.body||document.activeElement===focused)){
      const heading=root.querySelector('.workspace-page-header h1');if(heading){if(heading.getAttribute('tabindex')===null)heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
     }
    }
   }catch(error){if(context.current())throw error;}
   finally{state.selecting=false;if(identity()){input.readOnly=false;if(!current())dispose();}}
  },{origin:option.node,errorTarget:status,successOrigin:{node:null,id:'',data:[],container:null}});
 };
 const draw=groups=>{
  resetResults();state.query=input.value.trim();let more=false;
  for(const group of groups){
   if(!group.available||!group.rows.length)continue;more||=group.hasMore;
   const section=document.createElement('div'),heading=document.createElement('h3');heading.id=id+'-'+group.key;heading.textContent=group.label;section.setAttribute('role','group');section.setAttribute('aria-labelledby',heading.id);section.append(heading);
   for(const row of group.rows){
    const node=document.createElement('button'),title=document.createElement('strong'),subtitle=document.createElement('span');node.type='button';node.className='workspace-search-option';node.id=id+'-option-'+state.options.length;node.tabIndex=-1;node.setAttribute('role','option');node.setAttribute('aria-selected','false');title.textContent=row.title;subtitle.textContent=row.subtitle;node.append(title,subtitle);section.append(node);
    const option={...row,node};state.options.push(option);
    node.addEventListener('pointerdown',event=>event.preventDefault());
    node.onclick=event=>{event.preventDefault();event.stopPropagation();return choose(option);};
   }
   results.append(section);
  }
  input.setAttribute('aria-expanded',String(state.options.length>0));
  feedback(state.options.length?`${state.options.length} results.${more?' Refine your search for more matches.':''}`:'No matching records.');
 };
 const read=async(request,query)=>{
  const active=()=>current()&&!dialog.inert&&request===state.request&&query===input.value.trim();
  if(!active())return;
  results.setAttribute('aria-busy','true');actionFeedbackShow(actionFeedbackReference(input),'Searching…','busy',status);
  try{
   const response=await client.rpc('workspace_search',{p_query:query});
   if(!active())return;if(response.error)throw Error(response.error.message||'Search could not load.');
   draw(workspaceSearchResult(response.data,query));
  }catch(error){if(active()){resetResults();actionFeedbackShow(actionFeedbackReference(input),`Search could not load. ${friendlyError(error)} Edit the search to try again.`,'error',status);}}
  finally{if(active())results.removeAttribute('aria-busy');}
 };
 input.addEventListener('input',event=>{
  clearTimeout(state.timer);state.request++;resetResults();results.removeAttribute('aria-busy');actionFeedbackShow(actionFeedbackReference(input),'','success',status);
  if(!current()){dispose();return;}
  const query=input.value.trim(),length=[...query].length;
  if([...input.value].length>120){status.textContent='Use 120 characters or fewer.';return;}
  status.textContent=length<2?'Type at least 2 characters.':'Waiting for your search…';
  if(length>=2&&!event.isComposing){const request=state.request;state.timer=setTimeout(()=>read(request,query),250);}
 });
 input.addEventListener('keydown',event=>{
  if(event.isComposing||state.selecting||dialog.inert)return;
  if(['ArrowDown','ArrowUp'].includes(event.key)){
   event.preventDefault();if(!state.options.length)return;activate(state.active<0?(event.key==='ArrowDown'?0:state.options.length-1):(state.active+(event.key==='ArrowDown'?1:-1)+state.options.length)%state.options.length);
  }else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(state.active>=0)return choose(state.options[state.active]);}
 });
 const dismiss=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>state.selecting});
 close.onclick=event=>{event.preventDefault();event.stopPropagation();return dismiss();};
 dialog.addEventListener('close',dispose);
 actionFeedbackRememberDialog(dialog);showWorkspaceDialog(dialog,{trigger,size:'medium'});input.focus({preventScroll:true});
 state.observer=new MutationObserver(check);state.observer.observe(document.body,{childList:true,subtree:true});
 window.addEventListener('hashchange',check);window.addEventListener('popstate',check);
 return true;
}
function installWorkspaceSearch(){
 if(!workspaceSearchInstalled){
  workspaceSearchInstalled=true;
  document.addEventListener('keydown',event=>{
   if(event.defaultPrevented||event.isComposing||event.repeat||event.altKey||!event.ctrlKey&&!event.metaKey||event.key.toLowerCase()!=='k')return;
   if(openWorkspaceSearch()){event.preventDefault();event.stopPropagation();}
  });
 }
 if(!me?.user_id){clearWorkspaceSearch();return;}
 const identity=document.getElementById('identity');if(!identity)return;
 let button=document.getElementById('workspaceSearch');
 if(!button){button=document.createElement('button');button.id='workspaceSearch';button.type='button';button.className='workspace-search-trigger button-quiet';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-label','Search Ctrl / ⌘ K');button.setAttribute('aria-keyshortcuts','Control+k Meta+k');button.innerHTML='<svg class="workspace-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Search</span> <kbd aria-hidden="true">Ctrl / ⌘ K</kbd>';identity.insertBefore(button,identity.querySelector('#howToUse'));}
 button.onclick=event=>{event.preventDefault();event.stopPropagation();openWorkspaceSearch(button);};
}
