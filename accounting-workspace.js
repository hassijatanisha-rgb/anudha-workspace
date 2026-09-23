'use strict';
let accountingPage=0;
async function accountingWorkspace(){
 const actor=await requireAccountingAccess(client,()=>me);
 $('#content').innerHTML='<p role="status">Loading accounting drafts…</p>';
 const r=await client.from('accounting_drafts').select('id,kind,version,organization_id,contact_id,body,updated_at').order('updated_at',{ascending:false}).range(accountingPage*25,accountingPage*25+24);
 if(me?.user_id!==actor||view!=='accounting')return;
 if(r.error)throw Error(`Accounting drafts could not load: ${r.error.message}`);
 const rows=r.data||[];
 $('#content').innerHTML=`<h1>Accounting</h1><p>Prepare, save, reopen and print company forms. Drafts are not issued invoices, ledger postings or proof of payment.</p><section class="card"><h2>Create a draft</h2><div class="actions">${Object.entries(companyFormDefinitions()).map(([kind,d])=>`<button data-accounting-new="${kind}">${esc(d.title)}</button>`).join('')}</div></section><section class="card"><h2>Saved drafts</h2>${rows.map(row=>`<article class="contact"><strong>${esc(companyFormDefinition(row.kind).title)} · ${esc(row.body.number||'Number not assigned')}</strong><p>${esc(organizations.find(o=>o.id===row.organization_id)?.name||'Customer not selected')} · revision ${row.version}</p><button data-accounting-open="${row.id}">Open saved draft</button></article>`).join('')||'<p>No saved drafts on this page.</p>'}<div class="actions"><button id="accountingPrevious" ${accountingPage===0?'disabled':''}>Previous</button><span>Page ${accountingPage+1}</span><button id="accountingNext" ${rows.length<25?'disabled':''}>Next</button></div></section>`;
 document.querySelectorAll('[data-accounting-new]').forEach(b=>b.onclick=()=>run(()=>accountingEditor({id:crypto.randomUUID(),kind:b.dataset.accountingNew,version:0,body:{}},actor)));
 document.querySelectorAll('[data-accounting-open]').forEach(b=>b.onclick=()=>run(()=>accountingEditor(rows.find(r=>r.id===b.dataset.accountingOpen),actor)));
 $('#accountingPrevious').onclick=()=>run(()=>{accountingPage--;return accountingWorkspace()});$('#accountingNext').onclick=()=>run(()=>{accountingPage++;return accountingWorkspace()});
}
async function accountingEditor(row,actor){
 await requireAccountingAccess(client,()=>me);if(me?.user_id!==actor||view!=='accounting')return;
 $('#content').innerHTML='<button id="accountingBack">← Saved drafts</button><section class="card"><label>Link customer / branch<select id="accountingCustomer"><option value="">Not selected yet</option>'+organizations.map(o=>`<option value="${esc(o.id)}" ${o.id===row.organization_id?'selected':''}>${esc(o.name)} · ${esc(o.location||'')}</option>`).join('')+'</select></label><label>Link specific contact<select id="accountingContact"></select></label><button id="accountingSave" type="button">Save draft</button><p id="accountingSaveStatus" role="status"></p></section><section id="accountingForm"></section>';
 const target=$('#accountingForm');mountCompanyForm(target,row.kind,row.body);
 const status=$('#accountingSaveStatus');status.textContent=row.version?`Saved revision ${row.version}. Further edits are unsaved until you press Save draft.`:'New draft — not yet saved.';
 function contactOptions(){const org=$('#accountingCustomer').value;$('#accountingContact').innerHTML='<option value="">Not selected yet</option>'+contacts.filter(c=>c.organization_id===org&&!c.deleted_at).map(c=>`<option value="${esc(c.id)}" ${c.id===row.contact_id?'selected':''}>${esc([c.first_name,c.last_name].filter(Boolean).join(' '))}</option>`).join('');}
 contactOptions();$('#accountingCustomer').onchange=contactOptions;
 $('#accountingBack').onclick=()=>run(()=>accountingWorkspace());
 $('#accountingSave').onclick=async()=>{
  const button=$('#accountingSave');if(button.disabled)return;button.disabled=true;
  try{
   if(me?.user_id!==actor||view!=='accounting'||!target.isConnected)throw Error('Login or page changed. Reopen accounting.');
   const body=companyFormRead(row.kind,target.querySelector('form'));
   const result=await client.rpc('save_accounting_draft',{p_id:row.id,p_kind:row.kind,p_expected_version:row.version,p_organization_id:$('#accountingCustomer').value||null,p_contact_id:$('#accountingContact').value||null,p_body:body});
   if(me?.user_id!==actor||view!=='accounting'||!target.isConnected)return;
   if(result.error)throw result.error;
   const saved=Array.isArray(result.data)?result.data[0]:result.data;if(!saved?.version)throw Error('Server did not confirm the saved revision.');
   row=saved;status.textContent=`Saved revision ${row.version}. This is a draft; no accounting or stock was posted.`;
   target.querySelector('[role="status"]').textContent='Draft editor. Use Save draft after each change. Printing does not save changes.';
  }catch(error){if(me?.user_id===actor&&target.isConnected)status.textContent=`Not confirmed saved: ${error.message}. Reopen the saved list to check before retrying.`;}
  finally{button.disabled=false;}
 };
}
