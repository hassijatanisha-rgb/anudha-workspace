'use strict';
let accountingPage=0,accountingRequest=0;
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
 const session=me,request=++accountingRequest;
 const actor=await requireAccountingAccess(client,()=>me);
 const current=()=>me===session&&me?.user_id===actor&&view==='accounting'&&accountingRequest===request;
 if(!current())return;
 workspaceLoading('Loading accounting drafts…');
 const r=await client.from('accounting_drafts').select('id,kind,version,organization_id,contact_id,body,updated_at,customer:organizations(name)').order('updated_at',{ascending:false}).order('id').range(accountingPage*25,accountingPage*25+24);
 if(!current())return;
 if(r.error)throw Error(`Accounting drafts could not load: ${r.error.message}`);
 const rows=r.data||[];
 $('#content').innerHTML=`${workspacePageHeader({title:'Accounting',subtitle:'Prepare, save and print company forms.'})}<section class="card"><h2>Create a draft</h2><div class="actions">${Object.entries(companyFormDefinitions()).map(([kind,d])=>`<button data-accounting-new="${kind}">${esc(d.title)}</button>`).join('')}</div></section><section class="card"><h2>Saved drafts</h2>${rows.map(row=>`<article class="contact"><strong>${esc(companyFormDefinition(row.kind).title)} · ${esc(row.body.number||'Number not assigned')}</strong><p>${esc(row.customer?.name||(row.organization_id?'Customer unavailable':'Customer not selected'))} · revision ${row.version}</p><button data-accounting-open="${row.id}">Open saved draft</button></article>`).join('')||'<p>No saved drafts on this page.</p>'}<div class="actions"><button id="accountingPrevious" ${accountingPage===0?'disabled':''}>Previous</button><span>Page ${accountingPage+1}</span><button id="accountingNext" ${rows.length<25?'disabled':''}>Next</button></div></section>`;
 document.querySelectorAll('[data-accounting-new]').forEach(b=>b.onclick=()=>run(()=>accountingEditor({id:crypto.randomUUID(),kind:b.dataset.accountingNew,version:0,body:{}},actor)));
 document.querySelectorAll('[data-accounting-open]').forEach(b=>b.onclick=()=>run(()=>accountingEditor(rows.find(r=>r.id===b.dataset.accountingOpen),actor)));
 $('#accountingPrevious').onclick=()=>run(()=>{accountingPage--;return accountingWorkspace()});$('#accountingNext').onclick=()=>run(()=>{accountingPage++;return accountingWorkspace()});
 const queue=document.createElement('section');queue.className='card';queue.id='proformaAccountingQueue';
 $('#content').querySelector('section').before(queue);
 await mountProformaAccountingQueue(queue,actor);
}
async function accountingEditor(row,actor){
 const session=me;await requireAccountingAccess(client,()=>me);if(me!==session||me?.user_id!==actor||view!=='accounting')return;
 if(!listsLoaded){await (listsLoading||loadLists());if(me!==session||me?.user_id!==actor||view!=='accounting')return;if(!listsLoaded)throw Error('Customer records could not load. Reopen the draft.');}
 const partyLabel=row.kind==='purchase'?'supplier / branch':'customer / branch';
 $('#content').innerHTML=`${workspacePageHeader({title:companyFormDefinition(row.kind).title,back:'<button id="accountingBack">← Saved drafts</button>'})}<section class="card"><p id="accountingLinkHelp">Search, then choose a linked record. Searching keeps your current selection. Links do not change the names or other text entered on the form below.</p><label for="accountingCustomerSearch">Search ${partyLabel}</label><input id="accountingCustomerSearch" type="search" autocomplete="off" aria-controls="accountingCustomer" aria-describedby="accountingLinkHelp accountingCustomerResults"><label for="accountingCustomer"><span>Link ${partyLabel}</span><select id="accountingCustomer" aria-describedby="accountingCustomerResults"></select></label><p id="accountingCustomerResults" role="status" aria-atomic="true"></p><label for="accountingContactSearch">Search specific contact person</label><input id="accountingContactSearch" type="search" autocomplete="off" aria-controls="accountingContact" aria-describedby="accountingLinkHelp accountingContactResults"><label for="accountingContact"><span>Link specific contact person</span><select id="accountingContact" aria-describedby="accountingContactResults"></select></label><p id="accountingContactResults" role="status" aria-atomic="true"></p><button id="accountingSave" type="button">Save draft</button><p id="accountingSaveStatus" role="status"></p></section><section id="accountingForm"></section>`;
 const target=$('#accountingForm');mountCompanyForm(target,row.kind,row.body);
 const status=$('#accountingSaveStatus');status.textContent=row.version?`Saved revision ${row.version}. Further edits are unsaved until you press Save draft.`:'New draft — not yet saved.';
 const attachments=document.createElement('button');attachments.type='button';attachments.textContent='Upload / view documents';attachments.disabled=!row.version;
 attachments.title=row.version?'Documents linked to this saved accounting draft':'Save the draft before attaching documents';
 attachments.onclick=()=>run(()=>openDocumentAttachments('accounting',row.id,row.body.number||companyFormDefinition(row.kind).title));
 if(typeof openDocumentAttachments==='function')status.after(attachments);
 const posting=document.createElement('div');status.after(posting);
 if(typeof mountReturnCreditPosting==='function')mountReturnCreditPosting(posting,row);
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
 $('#accountingBack').onclick=()=>run(async()=>{const context=workspaceNavigationContext();if(!await confirmWorkspaceLeave(context.current)||!context.current())return;return accountingWorkspace();});
 const saveButton=$('#accountingSave'),form=target.querySelector('form'),root=$('#content'),customer=$('#accountingCustomer'),contact=$('#accountingContact'),summary=form.querySelector('[data-company-form-error]'),links=saveButton.closest('section');
 const current=()=>me===session&&me?.user_id===actor&&view==='accounting'&&target.isConnected&&target.querySelector('form')===form&&$('#content')===root;
 const draftErrors=()=>{const errors=nativeFormErrors(form),organizationId=customer.value||null,contactId=contact.value||null;
  if(organizationId&&!organizations.some(org=>org.id===organizationId&&!org.deleted_at))errors.set(customer,'Choose an available customer or supplier branch, or clear the saved link');
  if(contactId&&(!organizationId||!contacts.some(person=>person.id===contactId&&person.organization_id===organizationId&&!person.deleted_at)))errors.set(contact,'Choose a contact belonging to the selected branch, or clear the saved contact link');
  return errors;
 };
 const updateSummary=()=>{if(current())summary.textContent=fieldErrorSummary(links.querySelectorAll('.field-error').length+form.querySelectorAll('.field-error').length);};
 form.addEventListener('submit',updateSummary);
 form.addEventListener('click',event=>{if(event.target.closest('[data-remove-company-line]'))updateSummary();});
 for(const scope of [links,form])scope.addEventListener('focusout',event=>{if(fieldBlurToAction(event)||!current()||busy||saveButton.disabled)return;const control=fieldValidationSource(event.target);if(control===customer||control===contact){const errors=draftErrors();showFieldError(control,errors.get(control)||'');if(control===customer&&contact.getAttribute('aria-invalid')==='true')showFieldError(contact,errors.get(contact)||'');}else if(!form.contains(control))return;updateSummary();});
 saveButton.onclick=async()=>{
  const button=saveButton;if(button.disabled)return;
  if(busy)return run(async()=>{},{origin:button,errorTarget:status});
  if(!current())return;
  const errors=draftErrors();summary.textContent=fieldErrorSummary(errors.size);showFieldErrors(root,errors);if(errors.size)return;
  button.disabled=true;
  await run(async()=>{try{
   if(me!==session||me?.user_id!==actor||view!=='accounting'||!target.isConnected)throw Error('Login or page changed. Reopen accounting.');
   const body=companyFormRead(row.kind,target.querySelector('form'));
   const organizationId=$('#accountingCustomer').value||null,contactId=$('#accountingContact').value||null;
   if(organizationId&&!organizations.some(org=>org.id===organizationId&&!org.deleted_at))throw Error('Choose an available customer or supplier branch, or clear the saved link');
   if(contactId&&(!organizationId||!contacts.some(contact=>contact.id===contactId&&contact.organization_id===organizationId&&!contact.deleted_at)))throw Error('Choose a contact belonging to the selected branch, or clear the saved contact link');
   const result=await client.rpc('save_accounting_draft',{p_id:row.id,p_kind:row.kind,p_expected_version:row.version,p_organization_id:organizationId,p_contact_id:contactId,p_body:body});
   if(me!==session||me?.user_id!==actor||view!=='accounting'||!target.isConnected)return;
   if(result.error)throw result.error;
   const saved=Array.isArray(result.data)?result.data[0]:result.data;if(!saved?.version)throw Error('Server did not confirm the saved revision.');
   row=saved;if(typeof mountReturnCreditPosting==='function')mountReturnCreditPosting(posting,row);attachments.disabled=false;attachments.title='Documents linked to this saved accounting draft';status.textContent=`Saved revision ${row.version}. This is a draft; no accounting or stock was posted.`;
   target.querySelector('[role="status"]').textContent='Draft editor. Use Save draft after each change. Printing does not save changes.';
   message(status.textContent);
  }catch(error){if(me===session&&me?.user_id===actor&&view==='accounting'&&target.isConnected){status.textContent=`Not confirmed saved: ${error.message}. Reopen the saved list to check before retrying.`;message(status.textContent,true);}}
  finally{button.disabled=false;}
  },{origin:button,errorTarget:status,busyLabel:'Saving draft…'});
 };
}
