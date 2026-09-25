'use strict';
let accountingPage=0;
function accountingLinkLabel(record,kind){
 return kind==='contact'?[record.first_name,record.last_name].filter(Boolean).join(' ')||record.email||'Unnamed contact':[record.name,record.location].filter(Boolean).join(' · ')||'Unnamed customer / branch';
}
function accountingSearchLinks(records,query,selectedId,kind){
 const active=records.filter(record=>!record.deleted_at),needle=String(query||'').trim().toLocaleLowerCase();
 const matches=active.filter(record=>[accountingLinkLabel(record,kind),record.email,record.phone].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle));
 const rows=matches.slice(0,50),selected=active.find(record=>record.id===selectedId);
 if(selected&&!rows.some(record=>record.id===selectedId))rows.unshift(selected);
 return {rows,matches:matches.length};
}
async function accountingWorkspace(){
 const actor=await requireAccountingAccess(client,()=>me);
 if(me?.user_id!==actor||view!=='accounting')return;
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
 const partyLabel=row.kind==='purchase'?'supplier / branch':'customer / branch';
 $('#content').innerHTML=`<button id="accountingBack">← Saved drafts</button><section class="card"><p id="accountingLinkHelp">Search, then choose a linked record. Searching keeps your current selection. Links do not change the names or other text entered on the form below.</p><label for="accountingCustomerSearch">Search ${partyLabel}</label><input id="accountingCustomerSearch" type="search" autocomplete="off" aria-controls="accountingCustomer" aria-describedby="accountingLinkHelp accountingCustomerResults"><label for="accountingCustomer">Link ${partyLabel}</label><select id="accountingCustomer" aria-describedby="accountingCustomerResults"></select><p id="accountingCustomerResults" role="status" aria-atomic="true"></p><label for="accountingContactSearch">Search specific contact person</label><input id="accountingContactSearch" type="search" autocomplete="off" aria-controls="accountingContact" aria-describedby="accountingLinkHelp accountingContactResults"><label for="accountingContact">Link specific contact person</label><select id="accountingContact" aria-describedby="accountingContactResults"></select><p id="accountingContactResults" role="status" aria-atomic="true"></p><button id="accountingSave" type="button">Save draft</button><p id="accountingSaveStatus" role="status"></p></section><section id="accountingForm"></section>`;
 const target=$('#accountingForm');mountCompanyForm(target,row.kind,row.body);
 const status=$('#accountingSaveStatus');status.textContent=row.version?`Saved revision ${row.version}. Further edits are unsaved until you press Save draft.`:'New draft — not yet saved.';
 function linkOptions(prefix,records,selectedId,kind){
  const result=accountingSearchLinks(records,$(`#${prefix}Search`).value,selectedId,kind);
  const unavailable=selectedId&&!result.rows.some(record=>record.id===selectedId);
  $(`#${prefix}`).innerHTML='<option value="">Not selected yet</option>'+(unavailable?`<option value="${esc(selectedId)}">Saved link unavailable — clear or choose another</option>`:'')+result.rows.map(record=>`<option value="${esc(record.id)}">${esc(accountingLinkLabel(record,kind))}</option>`).join('');
  $(`#${prefix}`).value=selectedId||'';
  $(`#${prefix}Results`).textContent=`${result.matches} matching ${kind==='contact'?'contacts':'branches'}.${result.matches>50?' Showing the first 50; refine your search.':''}${selectedId?' Current selection retained.':''}${unavailable?' Saved link is unavailable in this list; clear it or choose another before saving.':''}`;
 }
 function contactOptions(selectedId){
  const org=$('#accountingCustomer').value;
  linkOptions('accountingContact',org?contacts.filter(contact=>contact.organization_id===org):[],selectedId,'contact');
  $('#accountingContactSearch').disabled=!org;
  if(!org&&!selectedId)$('#accountingContactResults').textContent='Choose a customer or supplier branch first.';
 }
 linkOptions('accountingCustomer',organizations,row.organization_id,'organization');contactOptions(row.contact_id);
 $('#accountingCustomerSearch').oninput=()=>linkOptions('accountingCustomer',organizations,$('#accountingCustomer').value,'organization');
 $('#accountingContactSearch').oninput=()=>contactOptions($('#accountingContact').value);
 $('#accountingCustomer').onchange=()=>{$('#accountingContactSearch').value='';contactOptions('');};
 $('#accountingBack').onclick=()=>run(()=>accountingWorkspace());
 $('#accountingSave').onclick=async()=>{
  const button=$('#accountingSave');if(button.disabled)return;button.disabled=true;
  try{
   if(me?.user_id!==actor||view!=='accounting'||!target.isConnected)throw Error('Login or page changed. Reopen accounting.');
   const body=companyFormRead(row.kind,target.querySelector('form'));
   const organizationId=$('#accountingCustomer').value||null,contactId=$('#accountingContact').value||null;
   if(organizationId&&!organizations.some(org=>org.id===organizationId&&!org.deleted_at))throw Error('Choose an available customer or supplier branch, or clear the saved link');
   if(contactId&&(!organizationId||!contacts.some(contact=>contact.id===contactId&&contact.organization_id===organizationId&&!contact.deleted_at)))throw Error('Choose a contact belonging to the selected branch, or clear the saved contact link');
   const result=await client.rpc('save_accounting_draft',{p_id:row.id,p_kind:row.kind,p_expected_version:row.version,p_organization_id:organizationId,p_contact_id:contactId,p_body:body});
   if(me?.user_id!==actor||view!=='accounting'||!target.isConnected)return;
   if(result.error)throw result.error;
   const saved=Array.isArray(result.data)?result.data[0]:result.data;if(!saved?.version)throw Error('Server did not confirm the saved revision.');
   row=saved;status.textContent=`Saved revision ${row.version}. This is a draft; no accounting or stock was posted.`;
   target.querySelector('[role="status"]').textContent='Draft editor. Use Save draft after each change. Printing does not save changes.';
  }catch(error){if(me?.user_id===actor&&target.isConnected)status.textContent=`Not confirmed saved: ${error.message}. Reopen the saved list to check before retrying.`;}
  finally{button.disabled=false;}
 };
}
