'use strict';
let profileTab='contacts',branchHistoryMonth='';
const branchHistoryCache=new Map();
function readProfileRoute(){
 const match=location.hash.match(/^#\/(clients|client|branch)(?:\/([^/?#]+))?\/?$/);
 if(!match||match[1]==='clients')return {kind:'clients',id:''};
 return {kind:match[1],id:match[2]||''};
}
function goProfile(kind='clients',id=''){
 const hash=kind==='clients'?'#/clients':`#/${kind}/${encodeURIComponent(id)}`;
 view='contacts';filter='all';page=0;profileTab='contacts';
 if(location.hash===hash){selected=id;render()}else location.hash=hash;
}
window.addEventListener('hashchange',()=>{
 const route=readProfileRoute();view='contacts';selected=route.id;filter='all';page=0;profileTab='contacts';if(me)render();
});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-profile-tab]');if(!button||busy)return;
 profileTab=button.dataset.profileTab;page=0;profileView();
 if(profileTab==='history'&&selected&&!branchHistoryCache.has(selected))run(()=>loadBranchHistory(selected));
});
async function loadBranchHistory(organizationId,force=false){
 if(!force&&branchHistoryCache.has(organizationId))return;
 if(!inventoryLoaded)await loadInventoryOperations();
 if(!inventoryLoaded)throw Error(inventoryLoadError||'Inventory history is unavailable.');
 const result=await client.from('inventory_issues').select('*').eq('organization_id',organizationId).order('issued_on',{ascending:false}).limit(1000);
 if(result.error)throw result.error;
 branchHistoryCache.set(organizationId,result.data||[]);
 if(profileTab==='history'&&selected===organizationId)profileView();
}
function historyCategory(issue){return catalogCategoryOf(inventoryProduct(issue.product_id))}
function historyCategoryLabel(category){return catalogLabel(category==='non_stock'?'non_stock':category)}
function historyMonthLabel(value){const [year,month]=value.split('-').map(Number);return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(new Date(year,month-1,1))}
function branchConsumerHistory(o){
 if(!branchHistoryCache.has(o.id))return '<div class="card empty"><h2>Consumer history</h2><p>Loading real issued and delivered items for this branch…</p></div>';
 const allRows=branchHistoryCache.get(o.id),months=[...new Set(allRows.map(row=>String(row.issued_on).slice(0,7)))].sort().reverse();
 if(branchHistoryMonth&&!months.includes(branchHistoryMonth))branchHistoryMonth='';
 const rows=branchHistoryMonth?allRows.filter(row=>String(row.issued_on).startsWith(branchHistoryMonth)):allRows;
 const categories=['machines','reagents','consumables','spares'];
 const totals=new Map(categories.map(category=>[category,0]));
 let other=0;for(const row of rows){const category=historyCategory(row);if(totals.has(category))totals.set(category,totals.get(category)+row.quantity);else other+=row.quantity;}
 return `<div class="heading"><div><h2>Consumer history</h2><p class="muted">Real items issued or delivered to ${esc(o.name)}. Filter by month; every row keeps its delivery or sale reference.</p></div><button type="button" id="refreshBranchHistory">Refresh history</button></div><label class="directory-search"><span>Month</span><select id="branchHistoryMonth"><option value="">All months</option>${months.map(month=>`<option value="${month}" ${month===branchHistoryMonth?'selected':''}>${esc(historyMonthLabel(month))}</option>`).join('')}</select></label><div class="inventory-metrics">${categories.map(category=>`<div><small>${esc(historyCategoryLabel(category))}</small><strong>${totals.get(category)}</strong></div>`).join('')}${other?`<div><small>Other / not sorted yet</small><strong>${other}</strong></div>`:''}</div><section class="card"><div class="heading"><div><h3>Issued items</h3><p class="muted">${rows.length} record${rows.length===1?'':'s'}${allRows.length>=1000?' · first 1,000 shown':''}</p></div></div>${rows.map(row=>{const product=inventoryProduct(row.product_id);return `<article class="activity-row"><div><strong>${esc(product.name)}</strong><small>${esc(historyCategoryLabel(historyCategory(row)))} · ${esc(row.reference)}${row.reason?' · '+esc(row.reason):''}</small></div><div class="activity-change"><strong>${row.quantity}</strong><small>${esc(row.issued_on)}</small></div></article>`}).join('')||'<p class="empty">No issued or delivered items are recorded for this branch yet.</p>'}</section>`;
}
document.addEventListener('change',event=>{
 if(event.target.id!=='branchHistoryMonth')return;
 branchHistoryMonth=event.target.value;profileView();
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
 return `<div class="profile-approval"><span class="tag ${approved?'':'warn'}">${approved?'Approved':'Needs approval'}</span>${me.role==='owner'?`<button data-approve-org="${esc(o.id)}" ${blocked||approved?'disabled':''}>${approved?'Profile approved':'Approve profile'}</button>`:''}${blocked&&!approved?'<small>Complete required profile and contact details, then Keep every valid contact before approval.</small>':''}</div>`;
}
function profileBranchCard(o){
 const count=contacts.filter(c=>c.organization_id===o.id&&c.status!=='incorrect').length;
 return `<a class="profile-tile ${needsRevision(o)?'incomplete':''}" href="#/branch/${esc(o.id)}"><h3>${esc(o.name||'Branch name missing')}</h3><p class="branch-location"><strong>${esc(o.location||'Location missing')}</strong><span> · ${esc(o.type||'Organisation type missing')}</span></p><small>${count} contact${count===1?'':'s'} · ${o.approval_status==='approved'?'Approved':'Needs approval'}</small>${needsRevision(o)?'<span class="revision-label">Needs revision</span>':''}<span class="tile-open">Open branch →</span></a>`;
}
function profileDirectory(){
 const query=search.trim().toLowerCase(),digits=query.replace(/\D/g,'');
 const matchingOrganizations=new Set();
 for(const o of organizations)if(`${o.name} ${o.location} ${o.type}`.toLowerCase().includes(query))matchingOrganizations.add(o.id);
 for(const c of contacts){
  const number=`${c.country_code||''}${c.phone||''}`.replace(/\D/g,'');
  if(digits&&/^[+\d\s().-]+$/.test(query)&&number.includes(digits))matchingOrganizations.add(c.organization_id);
 }
 const rows=sortedAccounts(organizations.filter(o=>!o.parent_id&&(!query||[...familyIds(o)].some(id=>matchingOrganizations.has(id)))));
 const pageCount=Math.max(1,Math.ceil(rows.length/30));page=Math.min(Math.max(page,0),pageCount-1);
 $('#content').innerHTML=`<section class="client-pages"><div class="heading"><div><small>CLIENTS</small><h1>Choose a client</h1><p class="muted">Open a client, choose its branch, then view or fix the contacts there.</p></div><div class="actions">${me.role==='owner'?'<button class="primary-action" id="newOrg">+ Add client</button>':''}<button data-view="review">Fix contacts</button><button id="refresh">Refresh list</button></div></div><div class="help-strip"><strong>Yellow means action is needed.</strong><span>Clients that need revision are shown first.</span></div><label class="directory-search"><span>Search clients</span><input id="orgSearch" type="search" placeholder="Type a client, branch, location, or phone number" value="${esc(search)}"></label><p class="count">${rows.length} clients · ${rows.filter(needsRevision).length} need revision</p><div class="profile-grid">${rows.slice(page*30,page*30+30).map(o=>{const branches=childrenByParent.get(o.id)||[];return `<a class="profile-tile ${needsRevision(o)?'incomplete':''}" href="#/client/${esc(o.id)}"><h2>${esc(o.name||'Client name missing')}</h2><p><strong>${esc(o.location||'Location missing')}</strong> · ${esc(o.type||'Organisation type missing')}</p><small>${branches.length||1} branch${branches.length>1?'es':''} · ${o.approval_status==='approved'?'Approved':'Needs approval'}</small>${needsRevision(o)?'<span class="revision-label">Needs revision</span>':''}<span class="tile-open">Open client →</span></a>`}).join('')||'<div class="empty"><strong>No clients found.</strong><br>Try a different search.</div>'}</div>${profilePagination(rows.length,pageCount,'clients')}</section>`;
 $('#orgSearch').oninput=event=>{search=event.target.value;page=0;renderSearchPreservingPosition(event.target,profileDirectory)};
}
function profilePagination(count,pages,label){return `<div class="actions profile-pagination"><button id="prev" ${page===0?'disabled':''}>Previous</button><span>${count} ${label} · Page ${page+1} of ${pages}</span><button id="next" ${page+1>=pages?'disabled':''}>Next</button></div>`}
function profileParent(o){
 const children=sortedAccounts(childrenByParent.get(o.id)||[]);
 // A client with its own contacts also exposes that location as a separate branch page.
 const branches=(!children.length||contacts.some(c=>c.organization_id===o.id))?[o,...children]:children;
 const suggestions=me.role==='owner'?groupSuggestions(o):[];
 $('#content').innerHTML=`<section class="client-pages"><nav class="profile-breadcrumb" aria-label="Breadcrumb"><a href="#/clients">Clients</a><span aria-hidden="true">/</span><span aria-current="page">${esc(o.name)}</span></nav><section class="account-head ${needsRevision(o)?'incomplete':''}"><small>CLIENT PROFILE</small><h1>${esc(o.name||'Client name missing')}</h1><p><strong>${esc(o.location||'Location missing')}</strong> · ${esc(o.type||'Organisation type missing')}</p>${profileApproval(o,true)}${me.role==='owner'?`<div class="actions"><button data-edit-account="${esc(o.id)}">Edit client profile</button><button class="danger" data-delete-org="${esc(o.id)}">Delete client</button><button data-link-parent="${esc(o.id)}">+ Link existing branch</button></div>`:''}</section><div class="heading"><h2>Branches</h2><span class="count">${branches.length} branch${branches.length===1?'':'es'}</span></div><div class="profile-grid">${branches.map(profileBranchCard).join('')}</div>${suggestions.length?`<section class="group-panel"><details><summary>${suggestions.length} suggested branches · review before linking</summary>${suggestions.map(branch=>`<div class="suggested-branch"><span>${esc(branch.name)}<small><strong>${esc(branch.location||'Location missing')}</strong> · ${esc(branch.type||'Organisation type missing')}</small></span><button data-group="${esc(branch.id)}" data-parent="${esc(o.id)}">Review branch</button></div>`).join('')}</details></section>`:''}</section>`;
}
function profileBranch(o){
 const parent=rootAccount(o),ownContacts=contacts.filter(c=>c.organization_id===o.id);
 const rows=sortedContacts(ownContacts.filter(c=>inContactView(c,filter))),pages=Math.max(1,Math.ceil(rows.length/30));page=Math.min(Math.max(page,0),pages-1);
 const tabs=[['contacts','Contacts'],['orders','Active orders'],['leads','Leads'],['service','Service'],['history','Consumer history']];
 const activeTab=tabs.find(([id])=>id===profileTab)||tabs[0];
 const panel=profileTab==='contacts'?`<div class="heading"><div><h2>Branch contacts</h2><p class="muted">Contacts for ${esc(o.location||o.name)} only · email is optional.</p></div><button id="newContact">+ Contact</button></div><div class="tabs" aria-label="Contact filters">${[['all','All contacts'],['revision','Needs revision']].map(([id,label])=>`<button data-filter="${id}" class="${filter===id?'active':''}" aria-pressed="${filter===id}">${label} <small>${ownContacts.filter(c=>inContactView(c,id)).length}</small></button>`).join('')}</div>${rows.slice(page*30,page*30+30).map(card).join('')||'<div class="empty">No contacts in this view.</div>'}${profilePagination(rows.length,pages,'contacts')}`:profileTab==='history'?branchConsumerHistory(o):`<div class="card empty"><h2>${activeTab[1]}</h2><p>Not yet implemented.</p></div>`;
 $('#content').innerHTML=`<section class="client-pages"><nav class="profile-breadcrumb" aria-label="Breadcrumb"><a href="#/clients">Clients</a><span aria-hidden="true">/</span><a href="#/client/${esc(parent.id)}">${esc(parent.name)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(o.name)} · ${esc(o.location||'Location missing')}</span></nav><section class="account-head ${needsRevision(o)?'incomplete':''}"><small>BRANCH PROFILE</small><h1>${esc(o.name||'Branch name missing')}</h1><p class="branch-location"><strong>${esc(o.location||'Location missing')}</strong> · ${esc(o.type||'Organisation type missing')}</p>${profileApproval(o)}<div class="actions">${me.role==='owner'?`<button data-edit-account="${esc(o.id)}">Edit branch profile</button><button class="danger" data-delete-org="${esc(o.id)}">Delete branch</button>${o.parent_id?'<button id="ungroupAccount">Remove branch from group</button>':''}`:''}</div></section><div class="profile-sections" role="tablist" aria-label="Branch sections">${tabs.map(([id,label])=>`<button role="tab" id="profile-tab-${id}" aria-selected="${profileTab===id}" aria-controls="profile-panel" data-profile-tab="${id}" class="${profileTab===id?'current':''}">${label}</button>`).join('')}</div><section id="profile-panel" role="tabpanel" aria-labelledby="profile-tab-${activeTab[0]}">${panel}</section></section>`;
}
function profileView(){
 const route=readProfileRoute();
 if(route.kind==='clients'){selected='';return profileDirectory()}
 const o=orgIndex.get(route.id);selected=route.id;
 if(!o){$('#content').innerHTML='<section class="card"><h1>Client profile not found</h1><p>This profile may have been removed or is unavailable.</p><a href="#/clients">Back to clients</a></section>';return}
 if(route.kind==='client'){const parent=rootAccount(o);selected=parent.id;return profileParent(parent)}
 return profileBranch(o);
}
