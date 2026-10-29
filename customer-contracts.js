'use strict';
let contractEpoch=0,contractPage=0,contractKind='',contractCustomer='',contractFocus='';
const contractKinds=[['service','Service'],['placement','Placement'],['payment_terms','Payment terms']];
function clearCustomerContracts(){contractEpoch++;contractPage=0;contractKind='';contractCustomer='';contractFocus='';}
function contractKindLabel(kind){return contractKinds.find(([id])=>id===kind)?.[1]||kind;}
function contractKindsAllowed(){return contractKinds.filter(([kind])=>hasArea(kind==='service'?'service':'proformas'));}
function contractCustomerLabel(id){return organizations.find(row=>row.id===id)?.name||'Customer unavailable';}
function contractActive(row,on=companyDate()){return row?.status==='approved'&&row.starts_on<=on&&(!row.ends_on||row.ends_on>=on);}
function contractSummary(row){return `<strong>${esc(row.contract_number)} · ${esc(row.title)}</strong><p>${esc(contractKindLabel(row.kind))} · ${esc(contractCustomerLabel(row.organization_id))} · ${esc(row.status)}${row.status==='approved'&&!contractActive(row)?' · outside effective dates':''}</p><p>${esc(row.starts_on)} — ${esc(row.ends_on||'No end date')} · ${esc(row.reference||'No reference')}</p>`;}
async function contractsWorkspace(){
 const actor=me,epoch=++contractEpoch,current=()=>me===actor&&contractEpoch===epoch&&view==='contracts';
 const target=$('#content');workspaceLoading('Loading contracts…');
 try{
  let query=client.from('customer_contracts').select('*').order('updated_at',{ascending:false}).order('id',{ascending:false});
  if(contractFocus)query=query.eq('id',contractFocus);else {if(contractKind)query=query.eq('kind',contractKind);if(contractCustomer)query=query.eq('organization_id',contractCustomer);query=query.range(contractPage*30,contractPage*30+30);}
  const result=await query;if(!current())return;if(result.error)throw result.error;
  const rows=(result.data||[]).slice(0,30);
  target.innerHTML=`<div class="heading"><div><small>CUSTOMER AGREEMENTS</small><h1>Contracts</h1><p>Service, placement and payment terms. The owner approves a specific uploaded contract file.</p></div><div class="actions"><button type="button" data-contract-new>New contract</button><button type="button" data-contract-refresh>Refresh</button></div></div>${contractFocus?'<button type="button" data-contract-back>← All contracts</button>':`<div class="grid"><label>Category<select data-contract-kind><option value="">All categories</option>${contractKindsAllowed().map(([id,label])=>`<option value="${id}" ${contractKind===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Customer<select data-contract-customer data-lookup-rows="organizations"><option value="">All customers</option>${salesOrganizationOptions(contractCustomer)}</select></label></div>`}${rows.map(row=>`<article class="card" data-contract-card="${esc(row.id)}">${contractSummary(row)}${row.notes?`<p>${esc(row.notes)}</p>`:''}${row.approved_at?`<p>Approved by ${esc(employeeName(row.approved_by))} · ${esc(row.approved_at)}<br>Approved file ID: <code>${esc(row.approved_attachment_id)}</code></p>`:''}<div class="actions">${row.status==='draft'?`<button type="button" data-contract-edit="${esc(row.id)}">Edit draft</button>`:''}<button type="button" data-contract-files="${esc(row.id)}">Contract documents</button><button type="button" data-contract-history="${esc(row.id)}">History</button>${me.role==='owner'&&row.status==='draft'?`<button type="button" data-contract-approve="${esc(row.id)}">Approve contract</button>`:''}${me.role==='owner'&&row.status!=='cancelled'?`<button type="button" data-contract-cancel="${esc(row.id)}">Cancel contract</button>`:''}</div></article>`).join('')||'<p class="empty">No contracts in this view.</p>'}${contractFocus?'':`<div class="actions"><button type="button" data-contract-previous ${contractPage===0?'disabled':''}>Previous</button><span>Page ${contractPage+1}</span><button type="button" data-contract-next ${result.data.length<=30?'disabled':''}>Next</button></div>`}`;
  target.querySelector('[data-contract-new]').onclick=()=>openContractEditor();
  target.querySelector('[data-contract-refresh]').onclick=()=>run(contractsWorkspace);
  target.querySelector('[data-contract-back]')?.addEventListener('click',()=>{contractFocus='';run(contractsWorkspace);});
  for(const [key,set] of [['kind',value=>contractKind=value],['customer',value=>contractCustomer=value]])target.querySelector(`[data-contract-${key}]`)?.addEventListener('change',event=>{set(event.target.value);contractPage=0;run(contractsWorkspace);});
  for(const [key,delta] of [['previous',-1],['next',1]])target.querySelector(`[data-contract-${key}]`)?.addEventListener('click',()=>{contractPage+=delta;run(contractsWorkspace);});
  for(const [key,fn] of [['edit',openContractEditor],['files',row=>openDocumentAttachments('contract',row.id,row.contract_number)],['history',openContractHistory],['approve',row=>openContractDecision(row,'approve')],['cancel',row=>openContractDecision(row,'cancel')]])target.querySelectorAll(`[data-contract-${key}]`).forEach(button=>button.onclick=()=>run(()=>fn(rows.find(row=>row.id===button.getAttribute(`data-contract-${key}`)))));
 }catch(error){if(current())target.innerHTML=`<h1>Contracts</h1><p role="alert">${esc(error.message)}</p><button type="button" data-contract-retry>Retry</button>`;target.querySelector('[data-contract-retry]')?.addEventListener('click',()=>run(contractsWorkspace));}
}
function openContractEditor(row=null){
 const actor=me,epoch=contractEpoch,id=row?.id||crypto.randomUUID(),requestId=crypto.randomUUID();
 return actionForm(row?'Edit '+row.contract_number:'New customer contract',`<label>Customer branch<select name="customer" data-lookup-rows="organizations" required><option value="">Choose customer</option>${salesOrganizationOptions(row?.organization_id||contractCustomer)}</select></label><label>Category<select name="kind" required>${contractKindsAllowed().map(([kind,label])=>`<option value="${kind}" ${row?.kind===kind?'selected':''}>${label}</option>`).join('')}</select></label><label>Title<input name="title" required maxlength="200" value="${esc(row?.title||'')}"></label><label>Reference<input name="reference" maxlength="500" value="${esc(row?.reference||'')}"></label><div class="grid"><label>Starts on<input name="starts" type="date" required value="${esc(row?.starts_on||companyDate())}"></label><label>Ends on · optional<input name="ends" type="date" value="${esc(row?.ends_on||'')}"></label></div><label>Internal notes<textarea name="notes" maxlength="4000">${esc(row?.notes||'')}</textarea></label><p>Save the draft, upload the contract, then ask the owner to approve its document. Approved terms cannot be edited.</p>`,async values=>{
  if(me!==actor||contractEpoch!==epoch||view!=='contracts')throw Error('Reopen the contract before saving.');
  const result=await client.rpc('save_customer_contract',{p_request_id:requestId,p_id:id,p_expected_version:row?.version||0,p_organization_id:values.customer,p_kind:values.kind,p_title:values.title,p_reference:values.reference,p_starts_on:values.starts,p_ends_on:values.ends||null,p_notes:values.notes});
  if(me!==actor||contractEpoch!==epoch||view!=='contracts')return;if(result.error)throw result.error;
  const saved=Array.isArray(result.data)?result.data[0]:result.data;if(saved?.id!==id||saved.version!==(row?.version||0)+1)throw Error('The server did not confirm this contract version. Retry with the same values.');
  contractFocus=id;branchActivityCache.clear();await contractsWorkspace();if(me===actor&&view==='contracts')message('Contract draft saved.');
 });
}
async function openContractDecision(row,action){
 const actor=me,epoch=contractEpoch,current=()=>me===actor&&contractEpoch===epoch&&view==='contracts';let files=[];
 if(action==='approve'){const result=await client.from('document_attachments').select('id,original_filename,uploaded_at').eq('record_type','contract').eq('record_id',row.id).order('uploaded_at',{ascending:false}).limit(100);if(!current())return;if(result.error)throw result.error;files=result.data||[];if(!files.length)throw Error('Upload the contract document first.');}
 const requestId=crypto.randomUUID();
 actionForm(action==='approve'?'Approve '+row.contract_number:'Cancel '+row.contract_number,`${contractSummary(row)}${action==='approve'?`<label>Exact document being approved<select name="attachment" required>${files.map(file=>`<option value="${esc(file.id)}">${esc(file.original_filename)} · ${esc(file.uploaded_at)} · ${esc(file.id)}</option>`).join('')}</select></label><p>Review the selected file under Contract documents first. Approval locks these terms and identifies this exact file.</p>`:'<p>Cancelled contracts cannot authorize new placement orders.</p>'}<label>Decision reference / reason<textarea name="reference" required minlength="2" maxlength="1000"></textarea></label>`,async values=>{
  if(!current())throw Error('Reopen the contract before deciding.');
  const result=await client.rpc('decide_customer_contract',{p_request_id:requestId,p_id:row.id,p_expected_version:row.version,p_action:action,p_attachment_id:values.attachment||null,p_reference:values.reference});
  if(!current())return;if(result.error)throw result.error;const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved?.id!==row.id||saved.version!==row.version+1)throw Error('The server did not confirm the decision. Retry with the same values.');
  branchActivityCache.clear();await contractsWorkspace();if(me===actor&&view==='contracts')message(`Contract ${action==='approve'?'approved':'cancelled'}.`);
 });
}
async function openContractHistory(row){
 const actor=me,epoch=contractEpoch;const result=await client.from('customer_contract_events').select('id,action,actor_user_id,request,snapshot,created_at').eq('contract_id',row.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(101);
 if(me!==actor||contractEpoch!==epoch||view!=='contracts')return;if(result.error)throw result.error;
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label',row.contract_number+' history');
 dialog.innerHTML=`<h2>${esc(row.contract_number)} · history</h2>${(result.data||[]).slice(0,100).map(event=>`<article><strong>${esc(event.action)} · version ${esc(event.snapshot.version)}</strong><p>${esc(employeeName(event.actor_user_id))} · ${esc(event.created_at)}</p><p>${esc(event.request.reference||event.snapshot.reference||'')}</p><details><summary>Saved terms</summary>${contractSummary(event.snapshot)}<p>${esc(event.snapshot.notes||'')}</p></details></article>`).join('')}${result.data.length>100?'<p>Latest 100 events shown.</p>':''}<button type="button">Close</button>`;
 dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
