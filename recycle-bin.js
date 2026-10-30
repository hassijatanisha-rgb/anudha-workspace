'use strict';
let recycleRequest=0,recycleActor=null,recycleReady=false,recyclePages={};
const recyclePageSize=25;
const recycleSources={
 organization:['organizations','id,name,parent_id,deletion_batch,deleted_at,parent:organizations!parent_id(id,name,deleted_at)'],
 contact:['contacts','id,first_name,last_name,organization_id,deletion_batch,deleted_at,organization:organizations!organization_id(id,name,deleted_at)'],
 product:['products','id,name,deleted_at'],
 proforma:['sales_proformas','id,document_number,version,deleted_at']
};
function clearRecycleBin(){recycleRequest++;recycleActor=null;recycleReady=false;recyclePages={};}
function recycleCurrent(request,actor){return request===recycleRequest&&actor===me&&actor===recycleActor&&view==='recycle';}
async function openDeleteRecord(kind,id){
 if(!['organization','contact'].includes(kind))throw Error('Choose a client, branch or contact.');
 if(!canEditRecords())throw Error(recordsLockedText);
 const record=kind==='organization'?orgIndex.get(id):contacts.find(c=>c.id===id);
 if(!record)throw Error('This record is no longer available. Refresh and try again.');
 const affectedIds=kind==='organization'?familyIds(record):new Set();
 const affectedOrgs=kind==='organization'?organizations.filter(o=>affectedIds.has(o.id)):[];
 const affectedContacts=kind==='organization'?contacts.filter(c=>affectedIds.has(c.organization_id)):[record];
 const name=kind==='organization'?record.name:[record.first_name,record.last_name].filter(Boolean).join(' ');
 const details=`<p>Move <strong>${esc(name||'this record')}</strong> to the recycle bin?</p><p>The records below will leave the active client directory. They can be restored from the recycle bin.</p>${affectedOrgs.length?`<h3>${affectedOrgs.length} client / branch profile${affectedOrgs.length===1?'':'s'}</h3><ul class="recycle-affected">${affectedOrgs.map(o=>`<li>${esc(o.name)} · ${esc(o.location||'Location missing')}</li>`).join('')}</ul>`:''}<h3>${affectedContacts.length} contact${affectedContacts.length===1?'':'s'}</h3>${affectedContacts.length?`<ul class="recycle-affected">${affectedContacts.map(c=>`<li>${esc([c.title,c.first_name,c.last_name].filter(Boolean).join(' '))} <small>· ${esc(orgIndex.get(c.organization_id)?.name||'Branch')}</small></li>`).join('')}</ul>`:'<p class="muted">No contacts are attached to these profiles.</p>'}`;
 const context=organizationSaveContext(),scope={organizationIds:[...familyIds(rootAccount(kind==='organization'?record:orgIndex.get(record.organization_id)))],contactIds:affectedContacts.map(row=>row.id),affectedIds,profileId:selected};
 const form=actionForm('Move to recycle bin',details,async()=>{
  if(!context.current())return;
  if(!canEditRecords())throw Error(recordsLockedText);
  let result;try{result=await client.rpc('archive_record',{p_kind:kind,p_id:id});}catch(error){if(context.current())throw error;return;}
  if(!context.sessionCurrent())return;if(result.error){if(context.current())throw result.error;return;}
  invalidateOrganizationLists();if(!context.current())return;
  await refreshArchivedClientRecord(kind,id,scope,context);
 });
 const submit=form?.querySelector('[type="submit"]');if(submit)submit.textContent='Move to recycle bin';
}
async function deletedRows(table,columns,page=0){
 const fetchPage=async index=>{
  const result=await client.from(table).select(columns,{count:'exact'}).not('deleted_at','is',null).order('deleted_at',{ascending:false}).order('id',{ascending:true}).range(index*recyclePageSize,(index+1)*recyclePageSize-1);
  if(result.error)throw result.error;
  if(!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count<0||result.data.length>recyclePageSize)throw Error('Deleted records could not be verified. Refresh the recycle bin.');
  return {rows:result.data,total:result.count,page:index,pages:Math.max(1,Math.ceil(result.count/recyclePageSize))};
 };
 let result;
 try{result=await fetchPage(page);}catch(error){
  if(page===0||error.code!=='PGRST103')throw error;
  result=await fetchPage(0);if(result.pages>1)result=await fetchPage(result.pages-1);
 }
 if(result.page>=result.pages)result=await fetchPage(result.pages-1);
 if(result.page>=result.pages||result.rows.length!==Math.min(recyclePageSize,Math.max(0,result.total-result.page*recyclePageSize))||result.rows.some(row=>!row?.id||!row.deleted_at))throw Error('Deleted records could not be verified. Refresh the recycle bin.');
 return result;
}
function deletedRecyclePage(kind,page=0){const source=recycleSources[kind];if(!source)throw Error('Unsupported record type.');return deletedRows(...source,page);}
function recycleDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown date':date.toLocaleString()}
function recycleParentNote(kind,record){
 const parentId=kind==='organization'?record.parent_id:record.organization_id;if(!parentId)return '';
 const parent=kind==='organization'?record.parent:record.organization;
 if(!parent||parent.id!==parentId||!Object.hasOwn(parent,'deleted_at'))return 'The parent profile could not be verified. Refresh before restoring.';
 return parent.deleted_at?'Restore the parent profile first.':'';
}
function recycleSection(kind,title,data,rows){
 return `<section class="card" data-recycle-section="${kind}"><h2>${title} <small>(${data.total.toLocaleString()})</small></h2><div data-recycle-rows>${rows||'<p class="muted">No deleted records.</p>'}</div><div class="form-actions"><button data-recycle-page="${kind}" data-direction="-1" ${data.page===0?'disabled':''}>Previous</button><span role="status">Page ${data.page+1} of ${data.pages} · ${data.rows.length} shown</span><button data-recycle-page="${kind}" data-direction="1" ${data.page+1>=data.pages?'disabled':''}>Next</button></div></section>`;
}
function recycleClientSection(kind,title){
 const data=recyclePages[kind];
 return recycleSection(kind,title,data,data.rows.map(record=>{
  const profile=kind==='organization',parent=profile?record.parent:record.organization,name=profile?record.name:[record.first_name,record.last_name].filter(Boolean).join(' '),blocked=recycleParentNote(kind,record);
  const action=blocked?`<p class="recycle-parent-note">${esc(blocked)}</p>`:!canEditRecords()?`<p class="muted">${esc(recordsLockedText)}</p>`:`<button data-restore-record="${esc(record.id)}" data-record-kind="${kind}">Restore ${profile?'profile':'contact'}</button>`;
  return `<article class="recycle-record" data-recycle-record="${esc(record.id)}"><div><h3>${esc(name||(profile?'Unnamed profile':'Unnamed contact'))}</h3><p class="muted">Deleted ${esc(recycleDate(record.deleted_at))}</p>${profile&&!record.parent_id?'':`<small>${profile?'Parent':'Branch'}: ${esc(parent?.name||'Unavailable profile')}</small>`}</div><div>${action}</div></article>`;
 }).join(''));
}
function recycleContents(){
 $('#content').innerHTML=`<section class="client-pages">${workspacePageHeader({title:'Recycle bin',subtitle:'Restore a client before its branches and contacts.',actions:'<button data-recycle-refresh>Refresh recycle bin</button>'})}${recycleClientSection('organization','Clients and branches')}${recycleClientSection('contact','Contacts')}${deletedBusinessRecordsHtml(recyclePages)}</section>`;
}
function recycleFailed(){recycleReady=false;recyclePages={};$('#content').innerHTML=`<section>${workspacePageHeader({title:'Recycle bin',actions:'<button data-recycle-refresh>Retry</button>'})}<p>Deleted records could not be loaded. Try again.</p></section>`;}
async function renderRecycleBin(){
 if(recycleActor!==me){clearRecycleBin();recycleActor=me;}
 const request=++recycleRequest,actor=me;recycleReady=false;
 $('#content').innerHTML=workspaceSkeleton('recycle','Loading deleted records…');
 try{
  const [organization,contact,business]=await Promise.all([deletedRecyclePage('organization',recyclePages.organization?.page||0),deletedRecyclePage('contact',recyclePages.contact?.page||0),appendDeletedBusinessRecords(request)]);
  if(!recycleCurrent(request,actor))return;
  recyclePages={organization,contact,...business};recycleReady=true;recycleContents();
 }catch(error){if(!recycleCurrent(request,actor))return;recycleFailed();throw error;}
}
async function changeRecyclePage(kind,direction){
 if(!recycleReady||recycleActor!==me||view!=='recycle'||!recyclePages[kind]||![-1,1].includes(direction))return;
 const data=recyclePages[kind],page=data.page+direction;if(page<0||page>=data.pages)return;
 const request=++recycleRequest,actor=me;recycleReady=false;
 try{
  const result=await deletedRecyclePage(kind,page);if(!recycleCurrent(request,actor))return;
  recyclePages[kind]=result;recycleReady=true;recycleContents();
  const section=$('#content').querySelector(`[data-recycle-section="${kind}"]`);(section?.querySelector(`[data-direction="${direction}"]:not(:disabled)`)||section?.querySelector('button:not(:disabled)'))?.focus();
 }catch(error){if(!recycleCurrent(request,actor))return;recycleFailed();throw error;}
}
function recycleRestoreContext(kind,id){
 if(!recycleReady||recycleActor!==me||view!=='recycle')throw Error('Refresh the recycle bin before restoring this record.');
 const record=recyclePages[kind]?.rows.find(row=>row.id===id);if(!record)throw Error('Refresh the recycle bin before restoring this record.');
 return {record,actor:me,request:recycleRequest};
}
async function recycleRestored(context,kind){
 if(context.actor!==me||recycleActor!==context.actor)return;
 // Keep the disk copy: restored records carry updated_at and arrive in the next delta read.
 listsEpoch++;listsLoaded=false;listsLoading=null;
 if(kind==='proforma'&&typeof clearSalesDelivery==='function')clearSalesDelivery();
 if(!recycleCurrent(context.request,context.actor))return;
 const target=$('#content'),request=++recycleRequest,previous=recyclePages,origin=document.activeElement;
 recycleReady=false;
 const current=()=>recycleCurrent(request,context.actor)&&target===$('#content')&&target.isConnected;
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Record restored. Updating deleted records…';
 const affected=target.querySelector(`[data-recycle-section="${kind}"]`);
 (affected||target).append(status);
 target.querySelectorAll('[data-restore-record],[data-restore-business]').forEach(button=>button.disabled=true);
 async function reload(){
  if(!current())return;
  status.textContent='Record restored. Updating deleted records…';
  try{
   // Restoring a profile can restore its family. Refresh the visible bounded pages and preserve equal rows.
   const entries=await Promise.all(Object.entries(previous).map(async([key,data])=>[key,await deletedRecyclePage(key,data.page)]));
   if(!current())return;
   const pages=Object.fromEntries(entries);recyclePages=pages;
   for(const [key,data] of entries)reconcileRecycleSection(target,key,previous[key],data);
   recycleReady=true;status.remove();
   target.querySelectorAll('[data-restore-record],[data-restore-business]').forEach(button=>button.disabled=false);
   if(document.activeElement===document.body){const focus=origin?.isConnected&&!origin.disabled?origin:affected?.querySelector('button:not(:disabled)');if(focus){focus.focus({preventScroll:true});if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);}}
   message('Record restored.');
  }catch(error){
   if(!current())return;
   target.querySelectorAll('[data-recycle-section] h2 small,.form-actions [role="status"]').forEach(node=>node.textContent='Refresh needed');
   status.setAttribute('role','alert');status.textContent=`Record restored. The recycle bin could not reload: ${error.message||'Connection unavailable'}. Retry to see current records before restoring another.`;
   const retry=document.createElement('button');retry.type='button';retry.textContent='Retry deleted records';retry.onclick=()=>run(reload);status.append(retry);
   message('Record restored. The recycle bin could not reload; use Retry deleted records.',true);
  }
 }
 await reload();
}
function reconcileRecycleSection(target,kind,previous,data){
 const section=target.querySelector(`[data-recycle-section="${kind}"]`);
 if(!section)return;
 const template=document.createElement('template');
 template.innerHTML=kind==='organization'||kind==='contact'?recycleClientSection(kind,kind==='organization'?'Clients and branches':'Contacts'):deletedBusinessRecordsHtml({[kind]:data});
 const next=template.content.firstElementChild,rows=section.querySelector('[data-recycle-rows]'),nextRows=next.querySelector('[data-recycle-rows]');
 const existing=new Map([...rows.querySelectorAll('[data-recycle-record]')].map(node=>[node.dataset.recycleRecord,node]));
 const oldRows=new Map(previous.rows.map(row=>[row.id,row]));
 const active=document.activeElement,focused=rows.contains(active),left=window.scrollX,top=window.scrollY;
 for(const [id,node] of existing){const record=data.rows.find(row=>row.id===id);if(!record||JSON.stringify(oldRows.get(id))!==JSON.stringify(record))node.remove();}
 let cursor=rows.firstElementChild;
 for(const candidate of [...nextRows.children]){
  const id=candidate.dataset.recycleRecord,old=existing.get(id),record=data.rows.find(row=>row.id===id);
  const node=old&&JSON.stringify(oldRows.get(id))===JSON.stringify(record)?old:candidate;
  if(node!==cursor)rows.insertBefore(node,cursor);
  cursor=node.nextElementSibling;
 }
 while(cursor){const next=cursor.nextElementSibling;cursor.remove();cursor=next;}
 section.querySelector('h2 small').textContent=`(${data.total.toLocaleString()})`;
 section.querySelector('.form-actions [role="status"]').textContent=`Page ${data.page+1} of ${data.pages} · ${data.rows.length} shown`;
 section.querySelector('[data-direction="-1"]').disabled=data.page===0;
 section.querySelector('[data-direction="1"]').disabled=data.page+1>=data.pages;
 if(focused&&document.activeElement===document.body){const focus=active.isConnected?active:rows.querySelector('button')||section.querySelector('[data-recycle-page]:not(:disabled)');focus?.focus({preventScroll:true});}
 window.scrollTo({left,top,behavior:'instant'});
}
async function restoreDeletedRecord(kind,id){
 if(!['organization','contact'].includes(kind))throw Error('Choose a deleted profile or contact.');
 if(!canEditRecords())throw Error(recordsLockedText);
 const context=recycleRestoreContext(kind,id),blocked=recycleParentNote(kind,context.record);if(blocked)throw Error(blocked);
 const result=await client.rpc('restore_record',{p_kind:kind,p_id:id});if(context.actor!==me)return;if(result.error)throw result.error;
 await recycleRestored(context,kind);
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||busy)return;
 if(button.hasAttribute('data-recycle-refresh'))return run(renderRecycleBin);
 if(button.dataset.recyclePage)return run(()=>changeRecyclePage(button.dataset.recyclePage,Number(button.dataset.direction)));
 if(button.dataset.restoreRecord)return run(()=>restoreDeletedRecord(button.dataset.recordKind,button.dataset.restoreRecord));
});
