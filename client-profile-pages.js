'use strict';
let profileTab='contacts',branchHistoryMonth='',branchHistoryPeriod='';
const branchHistoryCache=new Map(),branchActivityCache=new Map();let branchHistoryEpoch=0;
let clientDirectoryData=null,clientDirectoryActor=null,clientDirectoryEpoch=0,clientDirectoryRequest=0,clientDirectoryLoading=null,clientDirectoryListsEpoch=0;
function clearClientDirectory(){clientDirectoryEpoch++;clientDirectoryRequest++;clientDirectoryData=null;clientDirectoryActor=null;clientDirectoryLoading=null;}
function clientDirectoryLanding(){return view==='review'||(view==='contacts'&&readProfileRoute().kind==='clients');}
function rememberContactRows(){for(const row of document.querySelectorAll('#contactResults [data-contact-id]'))row.contactMarkup=row.outerHTML;}
function contactSaveContext(){
 const actor=me,session=sessionLoadEpoch,section=view,hash=location.hash,root=$('#contactResults');
 const sessionCurrent=()=>!!actor&&actor===me&&session===sessionLoadEpoch;
 return {sessionCurrent,current:()=>sessionCurrent()&&view===section&&location.hash===hash&&root?.isConnected&&$('#contactResults')===root,root};
}
function contactReceiptCurrent(row,sent){return row?.id===sent.id&&Number.isSafeInteger(row.revision)&&row.revision>(sent.revision||0)&&listColumns.contacts.split(',').every(key=>Object.hasOwn(row,key));}
let organizationSaveRequest=0;
function organizationSaveContext(){
 const actor=me,session=sessionLoadEpoch,request=++organizationSaveRequest,section=view,hash=location.hash,root=document.querySelector('.client-pages');
 const sessionCurrent=()=>!!actor&&actor===me&&session===sessionLoadEpoch;
 const latest=()=>sessionCurrent()&&request===organizationSaveRequest;
 return {sessionCurrent,latest,current:()=>latest()&&view===section&&location.hash===hash&&root?.isConnected&&document.querySelector('.client-pages')===root,root};
}
function organizationReceiptCurrent(row,id){return row?.id===id&&listColumns.organizations.split(',').every(key=>Object.hasOwn(row,key));}
function invalidateOrganizationLists(){listsEpoch++;listsLoaded=false;listsLoading=null;clearClientDirectory();}
async function finishOrganizationSave(context,label,apply){
 try{const row=await apply();if(context.current()){$('#organizationSaveStatus')?.replaceChildren();message(label);}return row;}
 catch(error){
  if(!context.current())return;
  invalidateOrganizationLists();
  for(const control of context.root.querySelectorAll('[data-edit-account],[data-delete-org],[data-approve-org],[data-link-parent],[data-group],#ungroupAccount,#newOrg'))control.remove();
  if(!$('#organizationSaveStatus'))context.root.insertAdjacentHTML('beforeend','<div id="organizationSaveStatus"></div>');
  $('#organizationSaveStatus').innerHTML=`<p role="status">${esc(label)} The current profile could not be shown.</p><p role="alert">${esc(error.message||'Try loading the saved profile again.')}</p><button id="organizationSaveRetry">Retry saved profile</button>`;
  $('#organizationSaveRetry').onclick=()=>{if(context.current())return run(()=>finishOrganizationSave(context,label,apply));};
  message(`${label} Retry to show the current profile.`,true);
 }
}
async function applySavedOrganization(context,id,value,{invalidateApproval=false,created=false}={}){
 if(!context.latest())return;
 let row=value;
 if(!organizationReceiptCurrent(row,id)){
  invalidateOrganizationLists();const epoch=listsEpoch;
  const result=await client.from('organizations').select(listColumns.organizations).eq('id',id).is('deleted_at',null).single();
  if(!context.latest())return;if(epoch!==listsEpoch)throw Error('Client data changed while loading. Retry the saved profile.');if(result.error)throw result.error;row=result.data;
  if(!organizationReceiptCurrent(row,id))throw Error('The saved profile is not available yet.');
 }
 const index=organizations.findIndex(item=>item.id===id);if(index<0)organizations.push(row);else organizations[index]=row;
 scan();if(invalidateApproval){invalidateLocalApproval(id);scan();}
 if(context.current()){if(created){message('Account saved.');goProfile('client',id);}else refreshSavedOrganizationProfile();}
 return row;
}
async function approveOrganization(id){
 const context=organizationSaveContext();let result;
 try{result=await client.rpc('approve_organization',{p_id:id});}catch(error){if(context.current())throw error;return;}
 if(!context.sessionCurrent())return;if(result.error){if(context.current())throw result.error;return;}
 if(!context.latest()){invalidateOrganizationLists();return;}listsEpoch++;listsLoading=null;clearClientDirectory();
 const row=Array.isArray(result.data)?result.data[0]:result.data;
 return finishOrganizationSave(context,'Client profile approved.',()=>applySavedOrganization(context,id,row));
}
async function setOrganizationParent(id,parentId,context=organizationSaveContext()){
 if(!context.current())return;
 const branch=orgIndex.get(id),parent=parentId?orgIndex.get(parentId):null;if(!branch||parentId&&!parent)throw Error('Choose an existing account.');
 const ids=[...new Set([...familyIds(rootAccount(branch)),...familyIds(rootAccount(parent)),id])];let result;
 try{result=await client.rpc('set_organization_parent',{p_id:id,p_parent_id:parentId});}catch(error){if(context.current())throw error;return;}
 if(!context.sessionCurrent())return;if(result.error){if(context.current())throw result.error;return;}
 invalidateOrganizationLists();if(!context.latest())return;
 const label=parentId?'Branch group saved.':'Branch removed from group.';
 return finishOrganizationSave(context,label,async()=>{
  if(!context.latest())return;
  // The write has no guaranteed family receipt. Read the affected rows before changing relationships or approvals locally.
  const epoch=listsEpoch,rows=await all('organizations',listColumns.organizations,q=>q.in('id',ids).is('deleted_at',null));
  if(!context.latest())return;if(epoch!==listsEpoch)throw Error('Client data changed while loading. Retry the saved profile.');
  if(!rows.some(row=>row.id===id)||parentId&&!rows.some(row=>row.id===parentId)||rows.some(row=>!ids.includes(row.id)||!organizationReceiptCurrent(row,row.id)))throw Error('The saved branch group is not available yet.');
  const saved=new Map(rows.map(row=>[row.id,row]));organizations=organizations.filter(row=>!ids.includes(row.id)||saved.has(row.id)).map(row=>saved.get(row.id)||row);scan();
  if(context.current())refreshSavedOrganizationProfile();return saved.get(id);
 });
}
async function refreshArchivedClientRecord(kind,id,scope,context){
 if(!context.current())return;
 const label='Moved to the recycle bin.',epoch=listsEpoch,x=window.scrollX,y=window.scrollY;
 const status=()=>{if(!$('#organizationSaveStatus'))context.root.insertAdjacentHTML('beforeend','<div id="organizationSaveStatus"></div>');return $('#organizationSaveStatus');};
 try{
  // Legacy archive responses do not describe cascades. Only current, caller-visible rows determine what stays in the cache.
  const read=async(table,ids)=>{
   const rows=[];
   for(let offset=0;offset<ids.length;offset+=100){
    if(!context.current()||epoch!==listsEpoch)return rows;
    rows.push(...await all(table,listColumns[table]+',deleted_at',q=>q.in('id',ids.slice(offset,offset+100))));
   }
   return rows;
  };
  const [organizationRows,contactRows]=await Promise.all([read('organizations',scope.organizationIds),read('contacts',scope.contactIds)]);
  if(!context.current())return;if(epoch!==listsEpoch)throw Error('Client data changed while loading. Retry the saved deletion.');
  for(const [table,rows,ids] of [['organizations',organizationRows,scope.organizationIds],['contacts',contactRows,scope.contactIds]]){
   if(!Array.isArray(rows)||rows.some(row=>!ids.includes(row?.id)||!Object.hasOwn(row,'deleted_at')||listColumns[table].split(',').some(key=>!Object.hasOwn(row,key))))throw Error('The current records could not be verified.');
  }
  const target=(kind==='organization'?organizationRows:contactRows).find(row=>row.id===id);
  if(!target||typeof target.deleted_at!=='string'||!target.deleted_at)throw Error('The archived record could not be verified.');
  const currentOrganizations=new Map(organizationRows.filter(row=>!row.deleted_at).map(row=>[row.id,row])),currentContacts=new Map(contactRows.filter(row=>!row.deleted_at).map(row=>[row.id,row]));
  organizations=organizations.filter(row=>!scope.organizationIds.includes(row.id)||currentOrganizations.has(row.id)).map(row=>currentOrganizations.get(row.id)||row);
  contacts=contacts.filter(row=>!scope.contactIds.includes(row.id)||currentContacts.has(row.id)).map(row=>currentContacts.get(row.id)||row);scan();
  if(view==='review')refreshSavedContactResults();
  else if(orgIndex.has(scope.profileId))refreshSavedOrganizationProfile(scope.profileId);
  else{
   // The selected profile was deleted. Preserve its identity and shell, with no stale record actions.
   $('#profileOrganizationActions').innerHTML='<a class="button" href="#/clients">All clients</a>';
   $('#profileOrganizationBack').innerHTML='<a class="button button-quiet" href="#/clients" aria-label="Back to clients">Back</a>';
   $('#profileBreadcrumb').innerHTML=`<a href="#/clients">Clients</a><span aria-hidden="true">/</span><span aria-current="page">${esc($('#profileOrganizationName').textContent)} · deleted</span>`;
   const approval=document.querySelector('.profile-approval');if(approval)approval.innerHTML=`<span class="tag chip chip--${statusTone('archived')}">Deleted profile</span>`;
   for(const button of document.querySelectorAll('.profile-sections button'))button.disabled=true;
   $('#profile-panel')?.replaceChildren();$('#profileBranches')?.replaceChildren();
   if($('#profileBranchCount'))$('#profileBranchCount').textContent='Profile deleted';
   if($('#profileGroupSuggestions')){$('#profileGroupSuggestions').replaceChildren();$('#profileGroupSuggestions').hidden=true;}
  }
  status().innerHTML=`<p role="status">${label} You can restore the record there.</p>`;message(label);
 }catch(error){
  if(!context.current())return;
  for(const control of context.root.querySelectorAll('[data-edit-account],[data-delete-org],[data-approve-org],[data-link-parent],[data-group],#ungroupAccount'))control.remove();
  for(const card of context.root.querySelectorAll('[data-contact-id]'))if(scope.contactIds.includes(card.dataset.contactId))for(const button of card.querySelectorAll('button'))button.remove();
  if(scope.affectedIds.has(scope.profileId)){
   if($('#profile-panel'))$('#profile-panel').inert=true;
   if($('#profileBranches'))$('#profileBranches').inert=true;
   for(const button of document.querySelectorAll('.profile-sections button'))button.disabled=true;
  }
  status().innerHTML=`<p role="status">${label} The current records could not be shown.</p><p role="alert">${esc(error.message||'Try loading the saved deletion again.')}</p><button id="clientArchiveRetry">Retry saved deletion</button> <a href="#/clients">All clients</a>`;
  $('#clientArchiveRetry').onclick=()=>{if(context.current())return run(()=>refreshArchivedClientRecord(kind,id,scope,context));};
  message(`${label} Retry to show the current records.`,true);
 }
 if(context.current())window.scrollTo(x,y);
}
async function finishContactSave(context,apply){
 try{const row=await apply();if(context.current())message('Contact saved.');return row;}
 catch(error){
  if(!context.current())return;
  context.root.innerHTML=`<p role="status">Contact saved. The current contact details could not be shown.</p><p role="alert">${esc(error.message||'Try loading the saved contact again.')}</p><button id="contactSaveRetry">Retry saved contact</button>`;
  $('#contactSaveRetry').onclick=()=>{if(context.current())return run(()=>finishContactSave(context,apply));};
  message('Contact saved. Retry to show the current details.',true);
 }
}
function refreshSavedContactResults(){
 const root=$('#contactResults');if(!root)return;
 let rows,html,count,pages,label;
 if(view==='review'){
  const allRows=contactReviewQueue(contacts,organizations,duplicates),q=search.trim().toLowerCase();
  rows=allRows.filter(({contact,organization,reasons})=>`${contact.first_name||''} ${contact.last_name||''} ${organization.name||''} ${organization.location||''} ${reasons.join(' ')}`.toLowerCase().includes(q));
  count=rows.length;pages=Math.max(1,Math.ceil(count/30));page=Math.min(Math.max(page,0),pages-1);label='contacts needing revision';
  html=rows.slice(page*30,page*30+30).map(contactReviewCard).join('')||'<div class="empty"><strong>Nothing to fix here.</strong><br>No contacts match this search, or every active contact is complete.</div>';
  $('#contactCount').textContent=`${count} shown · ${allRows.length} contacts need revision`;
  bindContactReviewSearch({contacts,organizations,duplicates});
 }else if(view==='contacts'&&profileTab==='contacts'&&readProfileRoute().kind==='branch'){
  const organization=orgIndex.get(readProfileRoute().id),own=contacts.filter(row=>row.organization_id===organization?.id);if(!organization)return;
  rows=sortedContacts(own.filter(row=>inContactView(row,filter)));count=rows.length;pages=Math.max(1,Math.ceil(count/30));page=Math.min(Math.max(page,0),pages-1);label='contacts';
  html=rows.slice(page*30,page*30+30).map(card).join('')||'<div class="empty">No contacts in this view.</div>';
  for(const button of document.querySelectorAll('#contactFilters [data-filter]'))button.querySelector('small').textContent=own.filter(row=>inContactView(row,button.dataset.filter)).length;
  const approval=document.querySelector('.profile-approval'),replacement=document.createElement('template');replacement.innerHTML=profileApproval(organization);
  if(approval&&approval.outerHTML!==replacement.content.firstElementChild.outerHTML)approval.replaceWith(replacement.content.firstElementChild);
  document.querySelector('.account-head')?.classList.toggle('incomplete',needsRevision(organization));
 }else return;
 const template=document.createElement('template');template.innerHTML=html;
 const old=new Map([...root.querySelectorAll('[data-contact-id]')].map(row=>[row.dataset.contactId,row]));
 const next=[...template.content.children].map(row=>{const previous=old.get(row.dataset.contactId);if(previous?.contactMarkup===row.outerHTML)return previous;row.contactMarkup=row.outerHTML;if(previous){const open=[...previous.querySelectorAll('details')].map(node=>node.open);row.querySelectorAll('details').forEach((node,index)=>{node.open=!!open[index]});}return row;});
 const active=document.activeElement,focused=active?.closest('[data-contact-id]'),action=focused&&Object.entries(active.dataset||{}),x=window.scrollX,y=window.scrollY;
 for(const child of [...root.children])if(!next.includes(child))child.remove();
 let cursor=root.firstElementChild;for(const row of next){if(row===cursor)cursor=cursor.nextElementSibling;else root.insertBefore(row,cursor);}
 const paging=$('#contactPaging');template.innerHTML=profilePagination(count,pages,label);if(paging.innerHTML!==template.innerHTML)paging.innerHTML=template.innerHTML;
 if(focused&&active&&!active.isConnected&&action?.length){const replacement=[...root.querySelectorAll('button')].find(button=>action.every(([key,value])=>button.dataset[key]===value));replacement?.focus({preventScroll:true});}
 window.scrollTo(x,y);
}
async function withClientDirectoryLists(action,origin){
 const actor=me,section=view,hash=location.hash;
 if(!listsLoaded){const pending=listsLoading||loadLists(),epoch=listsEpoch;let loaded;try{loaded=await pending;}catch(error){if(me===actor&&epoch===listsEpoch&&view===section&&location.hash===hash&&(!origin||origin.isConnected))throw error;return;}if(me!==actor||epoch!==listsEpoch)return;if(!loaded||!listsLoaded)throw Error('Client details could not be loaded. Try again.');}
 if(me!==actor||view!==section||location.hash!==hash||origin&&!origin.isConnected)return;
 return action();
}
async function clientDirectoryWorkspace(force=false){
 if(!clientDirectoryLanding())return;
 if(force||clientDirectoryActor!==me||clientDirectoryListsEpoch!==listsEpoch){clearClientDirectory();clientDirectoryActor=me;clientDirectoryListsEpoch=listsEpoch;}
 const actor=me,epoch=clientDirectoryEpoch,request=++clientDirectoryRequest,section=view,hash=location.hash;
 const current=()=>actor===me&&epoch===clientDirectoryEpoch&&request===clientDirectoryRequest&&view===section&&location.hash===hash&&clientDirectoryLanding();
 try{
  if(!clientDirectoryData){
   workspaceLoading('Loading clients and contact checks…');
   if(!clientDirectoryLoading)clientDirectoryLoading=(async()=>{
    const result=await client.rpc('client_directory_snapshot');
    if(actor!==me||epoch!==clientDirectoryEpoch)return false;
    if(result.error)throw result.error;
    const data=result.data;if(!data||!Array.isArray(data.organizations)||!Array.isArray(data.contacts))throw Error('Client directory could not be loaded.');
    data.organizations.sort((a,b)=>a.name.localeCompare(b.name));
    // Keep the same JavaScript validation and duplicate rules, separate from complete editor caches.
    Object.assign(data,scan(data.organizations,data.contacts,{orgIndex:new Map(),childrenByParent:new Map(),contactIssues:new Map(),accountIssues:new Map(),accountReviewCounts:new Map(),duplicates:new Map()}));
    clientDirectoryData=data;return true;
   })().finally(()=>{if(actor===me&&epoch===clientDirectoryEpoch)clientDirectoryLoading=null;});
   await clientDirectoryLoading;
  }
  if(!current())return;
  if(section==='review')reviewQueue(clientDirectoryData);else{selected='';profileDirectory(clientDirectoryData);}
 }catch(error){if(!current())return;$('#content').innerHTML=`${workspacePageHeader({title:'Client directory unavailable',actions:'<button id="refresh" class="button-primary">Retry</button>'})}<section class="card"><p role="alert">${esc(error.message||'The directory could not be loaded.')}</p></section>`;}
}

function clearBranchHistory(){branchHistoryEpoch++;branchHistoryCache.clear();branchActivityCache.clear();branchHistoryMonth='';branchHistoryPeriod='';profileTab='contacts';}
function readProfileRoute(){
 const match=location.hash.match(/^#\/(clients|client|branch)(?:\/([^/?#]+))?\/?$/);
 if(!match||match[1]==='clients')return {kind:'clients',id:''};
 return {kind:match[1],id:match[2]||''};
}
async function goProfile(kind='clients',id='',{context=workspaceNavigationContext()}={}){
 if(!await confirmWorkspaceLeave(context.current)||!context.current())return false;
 const hash=kind==='clients'?'#/clients':`#/${kind}/${encodeURIComponent(id)}`;
 navRecordPage(hash);
 view='contacts';selected=id;filter='all';page=0;profileTab='contacts';await navRenderListPlace(render);return true;
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-profile-tab]');if(!button||busy)return;
 profileTab=button.dataset.profileTab;page=0;profileView();
 if(profileTab==='history'&&selected&&!branchHistoryCache.has(selected))run(()=>loadBranchHistory(selected));
 if(['orders','leads','service','contracts'].includes(profileTab)&&selected)run(()=>loadBranchActivity(selected,profileTab));
});
async function loadBranchHistory(organizationId,force=false){
 const actor=me,epoch=branchHistoryEpoch;
 if(!force&&branchHistoryCache.has(organizationId))return;
 if(!inventoryLoaded)await loadInventoryOperations();
 if(me!==actor||epoch!==branchHistoryEpoch)return;
 if(!inventoryLoaded)throw Error(inventoryLoadError||'Inventory history is unavailable.');
 const rows=await all('inventory_issues','*',q=>q.eq('organization_id',organizationId));
 if(me!==actor||epoch!==branchHistoryEpoch)return;
 branchHistoryCache.set(organizationId,rows.sort((a,b)=>String(b.issued_on).localeCompare(String(a.issued_on))));
 if(view==='contacts'&&profileTab==='history'&&selected===organizationId)profileView();
}
function historyCategory(issue){return catalogCategoryOf(inventoryProduct(issue.product_id))}
function historyCategoryLabel(category){return catalogLabel(category==='non_stock'?'non_stock':category)}
function historyMonthLabel(value){const [year,month]=value.split('-').map(Number);return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(new Date(year,month-1,1))}
function branchHistoryWindow(months,today=companyDate()){
 const [year,month,day]=today.split('-').map(Number),start=new Date(Date.UTC(year,month-1-Number(months),1));
 const lastDay=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
 start.setUTCDate(Math.min(day,lastDay));return {from:start.toISOString().slice(0,10),to:today};
}
function branchHistoryFilteredRows(rows,today=companyDate()){
 if(branchHistoryMonth)return rows.filter(row=>String(row.issued_on).startsWith(branchHistoryMonth));
 if(!branchHistoryPeriod)return rows;
 const window=branchHistoryWindow(branchHistoryPeriod,today);
 return rows.filter(row=>{const day=String(row.issued_on).slice(0,10);return day>=window.from&&day<=window.to;});
}
function branchConsumerHistory(o){
 if(!branchHistoryCache.has(o.id))return '<div class="card empty"><h2>Consumer history</h2><p>Loading real issued and delivered items for this branch…</p></div>';
 const allRows=branchHistoryCache.get(o.id),months=[...new Set(allRows.map(row=>String(row.issued_on).slice(0,7)))].sort().reverse();
 if(branchHistoryMonth&&!months.includes(branchHistoryMonth))branchHistoryMonth='';
 const today=companyDate(),rows=branchHistoryFilteredRows(allRows,today),window=branchHistoryPeriod?branchHistoryWindow(branchHistoryPeriod,today):null;
 const rangeLabel=window?`Last ${branchHistoryPeriod} months · ${window.from} to ${window.to}`:branchHistoryMonth?historyMonthLabel(branchHistoryMonth):'All recorded dates';
 const categories=['machines','reagents','consumables','spares'];
 const totals=new Map(categories.map(category=>[category,0]));
 let other=0;for(const row of rows){const category=historyCategory(row);if(totals.has(category))totals.set(category,totals.get(category)+row.quantity);else other+=row.quantity;}
 return `<div class="heading"><div><h2>Consumer history</h2><p class="muted">Real items issued or delivered to ${esc(o.name)}. Choose a recent period or a month; every row keeps its delivery or sale reference.</p></div><button type="button" id="refreshBranchHistory">Refresh history</button></div><div class="grid"><label class="directory-search"><span>Period</span><select id="branchHistoryPeriod"><option value="">All recorded dates</option><option value="6" ${branchHistoryPeriod==='6'?'selected':''}>Last 6 months</option><option value="12" ${branchHistoryPeriod==='12'?'selected':''}>Last 12 months</option></select></label><label class="directory-search"><span>Month</span><select id="branchHistoryMonth"><option value="">All months</option>${months.map(month=>`<option value="${month}" ${month===branchHistoryMonth?'selected':''}>${esc(historyMonthLabel(month))}</option>`).join('')}</select></label></div><p class="muted" role="status">${esc(rangeLabel)}</p><div class="inventory-metrics">${categories.map(category=>`<div><small>${esc(historyCategoryLabel(category))}</small><strong>${totals.get(category)}</strong></div>`).join('')}${other?`<div><small>Other / not sorted yet</small><strong>${other}</strong></div>`:''}</div><section class="card"><div class="heading"><div><h3>Issued items</h3><p class="muted">${rows.length} record${rows.length===1?'':'s'}</p></div></div>${rows.map(row=>{const product=inventoryProduct(row.product_id);return `<article class="activity-row"><div><strong>${esc(product.name)}</strong><small>${esc(historyCategoryLabel(historyCategory(row)))} · ${esc(row.reference)}${row.reason?' · '+esc(row.reason):''}</small></div><div class="activity-change"><strong>${row.quantity}</strong><small>${esc(row.issued_on)}</small></div></article>`}).join('')||(allRows.length?'<p class="empty">No issued or delivered items match this date window.</p>':'<p class="empty">No issued or delivered items are recorded for this branch yet.</p>')}</section>`;
}
document.addEventListener('change',event=>{
 if(event.target.id==='branchHistoryMonth'){branchHistoryMonth=event.target.value;branchHistoryPeriod='';}
 else if(event.target.id==='branchHistoryPeriod'){branchHistoryPeriod=['6','12'].includes(event.target.value)?event.target.value:'';branchHistoryMonth='';}
 else return;
 profileView();
});
document.addEventListener('click',event=>{
 if(event.target.id!=='refreshBranchHistory'||busy)return;
 run(()=>loadBranchHistory(selected,true));
});
function profileApproval(o,isParent=false){
 const scope=isParent?familyIds(o):new Set([o.id]);
 const ownContacts=contacts.filter(c=>scope.has(c.organization_id)&&c.status!=='incorrect');
 const incomplete=[...scope].some(id=>missingAccount(orgIndex.get(id)).length)||ownContacts.some(c=>(contactIssues.get(c.id)||[]).length);
 const pending=ownContacts.some(c=>c.status!=='kept');
 const emptyLeaf=[...scope].some(id=>!(childrenByParent.get(id)||[]).length&&!ownContacts.some(c=>c.organization_id===id));
 const blocked=incomplete||pending||!ownContacts.length||emptyLeaf;
 const approved=o.approval_status==='approved';
 return `<div class="profile-approval"><span class="tag ${approved?'':'warn'} chip chip--${statusTone(approved?'completed':'awaiting_approval')}">${approved?'Approved':'Needs approval'}</span>${canEditRecords()?`<button data-approve-org="${esc(o.id)}" ${blocked||approved?'disabled':''}>${approved?'Profile approved':'Approve profile'}</button>`:''}${blocked&&!approved?'<small>Complete required profile and contact details, then Keep every valid contact before approval.</small>':''}</div>`;
}
function profileBranchCard(o){
 const count=contacts.filter(c=>c.organization_id===o.id&&c.status!=='incorrect').length;
 return `<a data-organization-id="${esc(o.id)}" class="profile-tile ${needsRevision(o)?'incomplete':''}" href="#/branch/${esc(o.id)}"><h3>${esc(o.name||'Branch name missing')}</h3><p class="branch-location"><strong>${esc(o.location||'Location missing')}</strong><span> · ${esc(o.type||'Organisation type missing')}</span></p><small>${count} contact${count===1?'':'s'} · ${o.approval_status==='approved'?'Approved':'Needs approval'}</small>${needsRevision(o)?'<span class="revision-label">Needs revision</span>':''}<span class="tile-open">Open branch →</span></a>`;
}
function profileDirectory(data=clientDirectoryData){
 const {organizations,contacts,childrenByParent}=data,actor=me,session=sessionLoadEpoch;
 const query=search.trim().toLowerCase(),digits=query.replace(/\D/g,'');
 const matchingOrganizations=new Set();
 for(const o of organizations)if(`${o.name} ${o.location} ${o.type}`.toLowerCase().includes(query))matchingOrganizations.add(o.id);
 for(const c of contacts){
  const number=`${c.country_code||''}${c.phone||''}`.replace(/\D/g,'');
  if(digits&&/^[+\d\s().-]+$/.test(query)&&number.includes(digits))matchingOrganizations.add(c.organization_id);
 }
 const rows=sortedAccounts(organizations.filter(o=>!o.parent_id&&(!query||[...familyIds(o,childrenByParent)].some(id=>matchingOrganizations.has(id)))),data);
 const pageCount=Math.max(1,Math.ceil(rows.length/30));page=Math.min(Math.max(page,0),pageCount-1);
 $('#content').innerHTML=`<section class="client-pages">${workspacePageHeader({title:'Choose a client',subtitle:'Open a client to view its branches and contacts.',actions:'<button data-view="review">Fix contacts</button><button id="refresh">Refresh list</button>'+(canEditRecords()?'<button class="primary-action" id="newOrg">Add client</button>':'')})}<div class="help-strip"><strong>Yellow means action is needed.</strong><span>Clients that need revision are shown first.</span></div><label class="directory-search"><span>Search clients</span><input id="orgSearch" type="search" placeholder="Type a client, branch, location, or phone number" value="${esc(search)}"></label><p class="count">${rows.length} clients · ${rows.filter(o=>needsRevision(o,data)).length} need revision</p><div class="profile-grid">${rows.slice(page*30,page*30+30).map(o=>{const branches=childrenByParent.get(o.id)||[];return `<a class="profile-tile ${needsRevision(o,data)?'incomplete':''}" href="#/client/${esc(o.id)}"><h2>${esc(o.name||'Client name missing')}</h2><p><strong>${esc(o.location||'Location missing')}</strong> · ${esc(o.type||'Organisation type missing')}</p><small>${branches.length||1} branch${branches.length>1?'es':''} · ${o.approval_status==='approved'?'Approved':'Needs approval'}</small>${needsRevision(o,data)?'<span class="revision-label">Needs revision</span>':''}<span class="tile-open">Open client →</span></a>`}).join('')||'<div class="empty"><strong>No clients found.</strong><br>Try a different search.</div>'}</div>${profilePagination(rows.length,pageCount,'clients')}</section>`;
 $('#orgSearch').oninput=event=>{if(actor!==me||session!==sessionLoadEpoch||view!=='contacts'||!clientDirectoryLanding())return;search=event.target.value;page=0;renderSearchPreservingPosition(event.target,()=>{if(actor===me&&session===sessionLoadEpoch&&view==='contacts'&&clientDirectoryLanding())profileDirectory(data)},150)};
}
function profilePagination(count,pages,label){return `<div class="actions profile-pagination"><button id="prev" ${page===0?'disabled':''}>Previous</button><span>${count} ${label} · Page ${page+1} of ${pages}</span><button id="next" ${page+1>=pages?'disabled':''}>Next</button></div>`}
function profileOrganizationBreadcrumb(o,isParent){
 const parent=rootAccount(o);
 return `<a href="#/clients">Clients</a><span aria-hidden="true">/</span>${isParent?`<a href="#/client/${esc(o.id)}" aria-current="page">${esc(o.name)}</a>`:`<a href="#/client/${esc(parent.id)}">${esc(parent.name)}</a><span aria-hidden="true">/</span><a href="#/branch/${esc(o.id)}" aria-current="page">${esc(o.name)} · ${esc(o.location||'Location missing')}</a>`}`;
}
function profileOrganizationActions(o,isParent){return canEditRecords()?`<button data-edit-account="${esc(o.id)}">Edit ${isParent?'client':'branch'} profile</button><button class="danger" data-delete-org="${esc(o.id)}">Delete ${isParent?'client':'branch'}</button>${isParent?`<button data-link-parent="${esc(o.id)}">+ Link existing branch</button>`:o.parent_id?'<button id="ungroupAccount">Remove branch from group</button>':''}`:'';}
function profileOrganizationFacts(o){return `<strong>${esc(o.location||'Location missing')}</strong> · ${esc(o.type||'Organisation type missing')}`;}
function profileOrganizationBack(o,isParent){return `<a class="button button-quiet" href="${isParent?'#/clients':'#/client/'+esc(rootAccount(o).id)}" aria-label="${isParent?'Back to clients':'Back to client'}">Back</a>`;}
function profileOrganizationHeader(o,isParent){return `${workspacePageHeader({title:o.name||(isParent?'Client':'Branch')+' name missing',titleAttrs:'id="profileOrganizationName"',back:`<span id="profileOrganizationBack">${profileOrganizationBack(o,isParent)}</span>`,breadcrumbs:`<span id="profileBreadcrumb">${profileOrganizationBreadcrumb(o,isParent)}</span>`,actions:`<div class="actions" id="profileOrganizationActions">${profileOrganizationActions(o,isParent)}</div>`})}<section class="account-head ${needsRevision(o)?'incomplete':''}"><p id="profileOrganizationFacts"${isParent?'':' class="branch-location"'}>${profileOrganizationFacts(o)}</p>${profileApproval(o,isParent)}<div id="organizationSaveStatus"></div></section>`;}

function profileBranches(o){
 const children=sortedAccounts(childrenByParent.get(o.id)||[]);
 // A client with its own contacts also exposes that location as a separate branch page.
 return (!children.length||contacts.some(c=>c.organization_id===o.id))?[o,...children]:children;
}
function profileGroupSuggestions(o){
 const suggestions=canEditRecords()?groupSuggestions(o):[];
 return suggestions.length?`<details><summary>${suggestions.length} suggested branches · review before linking</summary>${suggestions.map(branch=>`<div class="suggested-branch"><span>${esc(branch.name)}<small><strong>${esc(branch.location||'Location missing')}</strong> · ${esc(branch.type||'Organisation type missing')}</small></span><button data-group="${esc(branch.id)}" data-parent="${esc(o.id)}">Review branch</button></div>`).join('')}</details>`:'';
}
function rememberOrganizationRows(){for(const row of document.querySelectorAll('#profileBranches [data-organization-id]'))row.organizationMarkup=row.outerHTML;}
function refreshSavedOrganizationProfile(organizationId=readProfileRoute().id){
 const route=readProfileRoute();if(view!=='contacts'||route.kind==='clients')return;
 const record=orgIndex.get(organizationId),isParent=route.kind==='client',o=isParent?rootAccount(record):record;
 if(!o)throw Error('This profile is no longer available. Return to Clients to choose a profile.');
 const active=document.activeElement,action=Object.entries(active?.dataset||{}),activeId=active?.id,x=window.scrollX,y=window.scrollY;
 const update=(selector,html)=>{const node=$(selector),template=document.createElement('template');template.innerHTML=html;if(node&&node.innerHTML!==template.innerHTML)node.innerHTML=html;};
 $('#profileOrganizationName').textContent=o.name||(isParent?'Client':'Branch')+' name missing';
 update('#profileOrganizationBack',profileOrganizationBack(o,isParent));update('#profileOrganizationFacts',profileOrganizationFacts(o));update('#profileBreadcrumb',profileOrganizationBreadcrumb(o,isParent));update('#profileOrganizationActions',profileOrganizationActions(o,isParent));
 const approval=document.querySelector('.profile-approval'),template=document.createElement('template');template.innerHTML=profileApproval(o,isParent);
 if(approval.outerHTML!==template.content.firstElementChild.outerHTML)approval.replaceWith(template.content.firstElementChild);
 document.querySelector('.account-head').classList.toggle('incomplete',needsRevision(o));
 if(isParent){
  const branches=profileBranches(o),root=$('#profileBranches');$('#profileBranchCount').textContent=`${branches.length} branch${branches.length===1?'':'es'}`;
  template.innerHTML=branches.map(profileBranchCard).join('');const old=new Map([...root.querySelectorAll('[data-organization-id]')].map(row=>[row.dataset.organizationId,row]));
  const next=[...template.content.children].map(row=>{const previous=old.get(row.dataset.organizationId);if(previous?.organizationMarkup===row.outerHTML)return previous;row.organizationMarkup=row.outerHTML;return row;});
  for(const child of [...root.children])if(!next.includes(child))child.remove();let cursor=root.firstElementChild;for(const row of next){if(row===cursor)cursor=cursor.nextElementSibling;else root.insertBefore(row,cursor);}
  const suggestions=profileGroupSuggestions(o),open=$('#profileGroupSuggestions details')?.open;update('#profileGroupSuggestions',suggestions);$('#profileGroupSuggestions').hidden=!suggestions;const details=$('#profileGroupSuggestions details');if(details)details.open=!!open;
 }else if(profileTab==='contacts'){
  $('#branchContactsDescription').textContent=`Contacts for ${o.location||o.name} only · email is optional.`;refreshSavedContactResults();
 }
 if(active&&!active.isConnected){const replacement=activeId?document.getElementById(activeId):action.length?[...document.querySelectorAll('.client-pages button')].find(button=>action.every(([key,value])=>button.dataset[key]===value)):null;replacement?.focus({preventScroll:true});}
 window.scrollTo(x,y);
}
function profileParent(o){
 const branches=profileBranches(o),suggestions=profileGroupSuggestions(o);
 $('#content').innerHTML=`<section class="client-pages">${profileOrganizationHeader(o,true)}<div class="heading"><h2>Branches</h2><a class="button" href="#/branch/${esc(o.id)}">Open account contacts &amp; contracts</a><span id="profileBranchCount" class="count">${branches.length} branch${branches.length===1?'':'es'}</span></div><div id="profileBranches" class="profile-grid">${branches.map(profileBranchCard).join('')}</div><section id="profileGroupSuggestions" class="group-panel" ${suggestions?'':'hidden'}>${suggestions}</section></section>`;
 rememberOrganizationRows();
}
function profileBranch(o){
 const ownContacts=contacts.filter(c=>c.organization_id===o.id);
 const rows=sortedContacts(ownContacts.filter(c=>inContactView(c,filter))),pages=Math.max(1,Math.ceil(rows.length/30));page=Math.min(Math.max(page,0),pages-1);
 const tabs=[['contacts','Contacts'],['orders','Active orders'],['leads','Leads'],['service','Service'],['contracts','Contracts'],['history','Consumer history']];
 const activeTab=tabs.find(([id])=>id===profileTab)||tabs[0];
 const panel=profileTab==='contacts'?`<div class="heading"><div><h2>Branch contacts</h2><p id="branchContactsDescription" class="muted">Contacts for ${esc(o.location||o.name)} only · email is optional.</p>${recordsLockedNote()}</div>${canEditRecords()?'<button id="newContact">+ Contact</button>':''}</div><div class="tabs" id="contactFilters" aria-label="Contact filters">${[['all','All contacts'],['revision','Needs fixing']].map(([id,label])=>`<button data-filter="${id}" class="${filter===id?'active':''}" aria-pressed="${filter===id}">${label} <small>${ownContacts.filter(c=>inContactView(c,id)).length}</small></button>`).join('')}</div><div id="contactResults">${rows.slice(page*30,page*30+30).map(card).join('')||'<div class="empty">No contacts in this view.</div>'}</div><div id="contactPaging">${profilePagination(rows.length,pages,'contacts')}</div>`:profileTab==='history'?branchConsumerHistory(o):branchActivity(o,profileTab);
 $('#content').innerHTML=`<section class="client-pages">${profileOrganizationHeader(o,false)}<div class="profile-sections" role="tablist" aria-label="Branch sections">${tabs.map(([id,label])=>`<button role="tab" id="profile-tab-${id}" aria-selected="${profileTab===id}" aria-controls="profile-panel" data-profile-tab="${id}" class="${profileTab===id?'current':''}">${label}</button>`).join('')}</div><section id="profile-panel" role="tabpanel" aria-labelledby="profile-tab-${activeTab[0]}">${panel}</section></section>`;
 rememberContactRows();
}
function profileView(){
 const route=readProfileRoute();
 if(route.kind==='clients'){selected='';return clientDirectoryWorkspace()}
 if(clientDirectoryData||clientDirectoryLoading)clearClientDirectory();
 const o=orgIndex.get(route.id);selected=route.id;
 if(!o){$('#content').innerHTML=workspacePageHeader({title:'Client profile not found',back:'<a href="#/clients">Back to clients</a>'})+'<section class="card"><p>This profile may have been removed or is unavailable.</p></section>';return}
 if(route.kind==='client'){const parent=rootAccount(o);selected=parent.id;return profileParent(parent)}
 return profileBranch(o);
}

const branchActivityTypes={contracts:{area:['proformas','service'],table:'customer_contracts',columns:'id,contract_number,title,kind,status,organization_id',type:'contract',number:'contract_number'},orders:{area:['proformas','deliveries'],table:'sales_proformas',columns:'id,document_number,status,organization_id',type:'proforma',number:'document_number'},leads:{area:'leads',table:'sales_leads',columns:'id,lead_number,subject,stage,organization_id',type:'lead',number:'lead_number'},service:{area:'service',table:'service_cases',columns:'id,case_number,case_type,status,organization_id',type:'service',number:'case_number'}};
async function loadBranchActivity(id,section){
 const config=branchActivityTypes[section],actor=me,epoch=branchHistoryEpoch,key=id+':'+section;
 if(!config||!hasArea(config.area))return;
 try{
  const rows=await all(config.table,config.columns,q=>{q=q.eq('organization_id',id);if(section==='orders')q=q.is('deleted_at',null).in('status',['draft','sent','accepted']);return q;});
  if(actor!==me||epoch!==branchHistoryEpoch)return;branchActivityCache.set(key,{rows});
 }catch(error){if(actor!==me||epoch!==branchHistoryEpoch)return;branchActivityCache.set(key,{error:error.message});}
 if(view==='contacts'&&selected===id&&profileTab===section)profileView();
}
function branchActivity(organization,section){
 const config=branchActivityTypes[section];if(!config)return '';
 if(!hasArea(config.area))return '<div class="card"><p>You do not have access to this area.</p></div>';
 const data=branchActivityCache.get(organization.id+':'+section);
 if(!data)return '<p role="status">Loading this branch’s records…</p>';
 if(data.error)return `<p role="alert">${esc(data.error)}</p><p>Choose this tab again to retry.</p>`;
 return data.rows.map(row=>`<article class="card"><strong>${esc(row[config.number])}</strong><p>${esc(row.title||row.subject||row.case_type||'')} · ${esc(row.status||row.stage)}</p>${section!=='orders'||hasArea('proformas')?`<button type="button" data-branch-record="${esc(row.id)}" data-branch-kind="${config.type}">Open record</button>`:''}</article>`).join('')||'<p class="empty">No records for this branch.</p>';
}
document.addEventListener('click',event=>{const button=event.target.closest?.('[data-branch-record]');if(button)run(()=>workOpenRecord({record_type:button.dataset.branchKind,record_id:button.dataset.branchRecord}));});
