'use strict';
// Products: Clients & items data access (migration 071). Draft Pro formas: owner only.
function canArchiveBusiness(kind){return kind==='product'?canEditRecords():me?.role==='owner'}
async function openArchiveBusinessRecord(kind,id){
 if(!['product','proforma'].includes(kind))throw Error('Unsupported record type.');
 if(!canArchiveBusiness(kind))throw Error(kind==='product'?recordsLockedText:'Owner access is required.');
 const record=kind==='product'?products.find(p=>p.id===id):salesProforma(id);
 if(!record||record.deleted_at)throw Error('Record changed. Refresh before deleting.');
 if(kind==='proforma'&&record.status!=='draft')throw Error('Only draft pro formas can be deleted.');
 const form=actionForm('Move to Deleted Items',`<p>Delete <strong>${esc(record.name||record.document_number)}</strong> from the active list?</p><p>You can restore it from Deleted Items. Linked history remains intact. No reason is required.</p>`,async()=>{
  if(!canArchiveBusiness(kind))throw Error('Access changed. Nothing was deleted.');
  const args={p_id:id,p_archived:true};if(kind==='proforma')args.p_expected_version=record.version;
  const result=await client.rpc(kind==='product'?'set_product_archived':'set_draft_proforma_archived',args);if(result.error)throw result.error;
  if(kind==='proforma'){await loadSalesDelivery();if(salesLoadError)throw Error(salesLoadError);salesEditing=null;render();}else await load();
  message('Moved to Deleted Items.');
 });
 const button=form?.querySelector('[type="submit"]');if(button)button.textContent='Delete';
}
async function appendDeletedBusinessRecords(request){
 const owner=me?.role==='owner';if(!canArchiveBusiness('product')&&!owner)return;
 const actor=me.user_id;
 const [productRows,proformaRows]=await Promise.all([canArchiveBusiness('product')?deletedRows('products','id,name,deleted_at'):null,owner?deletedRows('sales_proformas','id,document_number,version,deleted_at'):null]);
 if(request!==recycleRequest||view!=='recycle'||me?.user_id!==actor)return;
 const html=(kind,title,rows)=>`<section class="card"><h2>${title}</h2>${rows.map(row=>`<article class="recycle-record"><div><strong>${esc(row.name||row.document_number)}</strong><p>Deleted ${esc(recycleDate(row.deleted_at))}</p></div><button data-restore-business="${kind}" data-id="${esc(row.id)}" data-version="${row.version||0}">Restore</button></article>`).join('')||'<p>No deleted records.</p>'}</section>`;
 $('#content').insertAdjacentHTML('beforeend',(productRows?html('product','Products',productRows):'')+(proformaRows?html('proforma','Draft pro formas',proformaRows):''));
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||busy)return;
 if(button.dataset.archiveBusiness)return run(()=>openArchiveBusinessRecord(button.dataset.archiveBusiness,button.dataset.id));
 if(button.dataset.restoreBusiness)return run(async()=>{
  const kind=button.dataset.restoreBusiness;if(!['product','proforma'].includes(kind))throw Error('Unsupported record type.');
  if(!canArchiveBusiness(kind))throw Error(kind==='product'?recordsLockedText:'Owner access is required.');
  const args={p_id:button.dataset.id,p_archived:false};if(kind==='proforma')args.p_expected_version=Number(button.dataset.version);
  const result=await client.rpc(kind==='product'?'set_product_archived':'set_draft_proforma_archived',args);if(result.error)throw result.error;
  await load();message('Record restored.');
 });
});
