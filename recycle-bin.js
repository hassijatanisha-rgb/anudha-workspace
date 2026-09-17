'use strict';
let recycleRequest=0;
let recycleOrganizations=[],recycleContacts=[];
async function openDeleteRecord(kind,id){
 if(!['organization','contact'].includes(kind))throw Error('Choose a client, branch or contact.');
 if(kind==='organization'&&me?.role!=='owner')throw Error('Owner access is required to delete client profiles.');
 const record=kind==='organization'?orgIndex.get(id):contacts.find(c=>c.id===id);
 if(!record)throw Error('This record is no longer available. Refresh and try again.');
 const affectedIds=kind==='organization'?familyIds(record):new Set();
 const affectedOrgs=kind==='organization'?organizations.filter(o=>affectedIds.has(o.id)):[];
 const affectedContacts=kind==='organization'?contacts.filter(c=>affectedIds.has(c.organization_id)):[record];
 const name=kind==='organization'?record.name:[record.first_name,record.last_name].filter(Boolean).join(' ');
 const details=`<p>Move <strong>${esc(name||'this record')}</strong> to the recycle bin?</p><p>The records below will leave the active client directory. They can be restored from the recycle bin.</p>${affectedOrgs.length?`<h3>${affectedOrgs.length} client / branch profile${affectedOrgs.length===1?'':'s'}</h3><ul class="recycle-affected">${affectedOrgs.map(o=>`<li>${esc(o.name)} · ${esc(o.location||'Location missing')}</li>`).join('')}</ul>`:''}<h3>${affectedContacts.length} contact${affectedContacts.length===1?'':'s'}</h3>${affectedContacts.length?`<ul class="recycle-affected">${affectedContacts.map(c=>`<li>${esc([c.title,c.first_name,c.last_name].filter(Boolean).join(' '))} <small>· ${esc(orgIndex.get(c.organization_id)?.name||'Branch')}</small></li>`).join('')}</ul>`:'<p class="muted">No contacts are attached to these profiles.</p>'}`;
 const form=actionForm('Move to recycle bin',details,async()=>{
  const result=await client.rpc('archive_record',{p_kind:kind,p_id:id});if(result.error)throw result.error;
  await load();message('Moved to the recycle bin.');
 });
 const submit=form?.querySelector('[type="submit"]');if(submit)submit.textContent='Move to recycle bin';
}
async function deletedRows(table,columns){
 const rows=[];
 for(let offset=0;;offset+=1000){const result=await client.from(table).select(columns).not('deleted_at','is',null).order('id').range(offset,offset+999);if(result.error)throw result.error;rows.push(...result.data);if(result.data.length<1000)return rows;}
}
function recycleDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown date':date.toLocaleString()}
async function renderRecycleBin(){
 const request=++recycleRequest;
 $('#content').innerHTML='<section class="client-pages"><h1>Recycle bin</h1><p role="status">Loading deleted client records…</p></section>';
 try{
  const [orgRows,contactRows]=await Promise.all([deletedRows('organizations','id,name,parent_id,deletion_batch,deleted_at'),deletedRows('contacts','id,first_name,last_name,organization_id,deletion_batch,deleted_at')]);
  if(request!==recycleRequest||view!=='recycle')return;
  recycleOrganizations=orgRows;recycleContacts=contactRows;
  const deletedOrgIds=new Set(orgRows.map(o=>o.id));
  const sortNewest=rows=>[...rows].sort((a,b)=>String(b.deleted_at).localeCompare(String(a.deleted_at))||a.id.localeCompare(b.id));
  const restoreButton=(kind,record)=>{
   const blocked=deletedOrgIds.has(kind==='organization'?record.parent_id:record.organization_id);
   if(blocked)return '<p class="recycle-parent-note">Restore the parent profile first.</p>';
   if(kind==='organization'&&me.role!=='owner')return '<p class="muted">An owner can restore this profile.</p>';
   return `<button data-restore-record="${esc(record.id)}" data-record-kind="${kind}">Restore ${kind==='organization'?'profile':'contact'}</button>`;
  };
  $('#content').innerHTML=`<section class="client-pages"><div class="heading"><div><small>CLIENT RECORDS</small><h1>Recycle bin</h1><p class="muted">Restore deleted clients, branches and contacts. Restore a parent profile before its deleted children.</p></div><button data-recycle-refresh>Refresh recycle bin</button></div><section class="card"><h2>Clients and branches <small>(${orgRows.length})</small></h2>${sortNewest(orgRows).map(o=>`<article class="recycle-record"><div><h3>${esc(o.name||'Unnamed profile')}</h3><p class="muted">Deleted ${esc(recycleDate(o.deleted_at))}</p>${o.parent_id?`<small>Parent: ${esc(orgRows.find(p=>p.id===o.parent_id)?.name||orgIndex.get(o.parent_id)?.name||'Unavailable profile')}</small>`:''}</div><div>${restoreButton('organization',o)}</div></article>`).join('')||'<p class="muted">No deleted client profiles.</p>'}</section><section class="card"><h2>Contacts <small>(${contactRows.length})</small></h2>${sortNewest(contactRows).map(c=>`<article class="recycle-record"><div><h3>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'Unnamed contact')}</h3><p class="muted">${esc(orgRows.find(o=>o.id===c.organization_id)?.name||orgIndex.get(c.organization_id)?.name||'Unavailable branch')} · Deleted ${esc(recycleDate(c.deleted_at))}</p></div><div>${restoreButton('contact',c)}</div></article>`).join('')||'<p class="muted">No deleted contacts.</p>'}</section></section>`;
 }catch(error){if(request===recycleRequest&&view==='recycle')$('#content').innerHTML='<section class="card"><h1>Recycle bin</h1><p>Deleted records could not be loaded. Try again.</p><button data-recycle-refresh>Retry</button></section>';throw error;}
}
async function restoreDeletedRecord(kind,id){
 if(!['organization','contact'].includes(kind))throw Error('Choose a deleted profile or contact.');
 if(kind==='organization'&&me?.role!=='owner')throw Error('Owner access is required to restore profiles.');
 const record=(kind==='organization'?recycleOrganizations:recycleContacts).find(r=>r.id===id);if(!record)throw Error('Refresh the recycle bin before restoring this record.');
 const parentId=kind==='organization'?record.parent_id:record.organization_id;
 if(recycleOrganizations.some(o=>o.id===parentId))throw Error('Restore the parent profile first.');
 const result=await client.rpc('restore_record',{p_kind:kind,p_id:id});if(result.error)throw result.error;
 await load();message('Record restored.');
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||busy)return;
 if(button.hasAttribute('data-recycle-refresh'))return run(renderRecycleBin);
 if(button.dataset.restoreRecord)return run(()=>restoreDeletedRecord(button.dataset.recordKind,button.dataset.restoreRecord));
});
