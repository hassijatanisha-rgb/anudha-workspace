'use strict';

async function mountProformaAccountingQueue(target,actor){
 const current=()=>me?.user_id===actor&&view==='accounting'&&target.isConnected;
 if(!current())return;
 let page=0,loading=false;
 async function load(){
  if(!current()||loading)return;
  loading=true;
  try{
   await requireAccountingAccess(client,()=>me);
   if(!current())return;
   target.innerHTML='<p role="status">Loading submitted pro formas…</p>';
   const result=await client.from('sales_proformas').select('id,organization_id,document_number,revision,acceptance_reference,accepted_at,created_at').eq('status','accepted').order('accepted_at',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*25,page*25+24);
   if(!current())return;
   if(result.error){target.innerHTML='<p role="alert">Submitted pro formas could not load. Reopen accounting to retry.</p>';throw Error(`Submitted pro formas could not load: ${result.error.message}`);}
   const rows=result.data||[];
   target.innerHTML=`<h2>Submitted pro formas</h2><p>Customer-accepted records, including orders already approved by Accounts. Open the current record to review its workflow status. This list creates no invoice or stock impact.</p>${rows.map(row=>`<article class="contact"><strong>${esc(row.document_number)} · revision ${esc(row.revision)}</strong><p>${esc(organizations.find(org=>org.id===row.organization_id)?.name||'Customer unavailable')}</p><p>Acceptance reference: ${esc(row.acceptance_reference||'Not supplied')}</p><button type="button" data-proforma-accounting-open="${esc(row.id)}">Open current record</button></article>`).join('')||'<p>No submitted pro formas on this page.</p>'}<div class="actions"><button type="button" data-proforma-accounting-previous>Previous</button><span>Page ${page+1}</span><button type="button" data-proforma-accounting-next>Next</button></div>`;
   target.querySelectorAll('[data-proforma-accounting-open]').forEach(button=>button.onclick=()=>run(async()=>{
    if(!current())return;
    await requireAccountingAccess(client,()=>me);
    if(!current())return;
    const row=rows.find(record=>record.id===button.dataset.proformaAccountingOpen);
    if(!row)return;
    salesFocusedProforma=row.id;salesSection='proformas';salesEditing='';view='sales';
    await salesDeliveryWorkspace(true);
    if(me?.user_id!==actor||view!=='sales')return;
    const card=[...document.querySelectorAll('[data-document-card]')].find(element=>element.dataset.documentCard===row.id);
    if(card)card.scrollIntoView({behavior:'smooth',block:'start'});
    else message('The saved pro forma could not be displayed. Refresh the sales register and try again.',true);
   }));
   const previous=target.querySelector('[data-proforma-accounting-previous]'),next=target.querySelector('[data-proforma-accounting-next]');
   previous.disabled=page===0;next.disabled=rows.length<25;
   previous.onclick=()=>run(()=>{if(!current()||loading||page===0)return;page--;return load()});
   next.onclick=()=>run(()=>{if(!current()||loading||rows.length<25)return;page++;return load()});
  }finally{loading=false;}
 }
 await load();
}
