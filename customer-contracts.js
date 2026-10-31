'use strict';
let contractEpoch=0,contractPage=0,contractKind='',contractCustomer='',contractFocus='',contractCustomerFilterOpen=false;
const contractCardReads=new WeakMap();
const contractKinds=[['service','Service'],['placement','Placement'],['payment_terms','Payment terms']];
function clearCustomerContracts(){contractEpoch++;contractPage=0;contractKind='';contractCustomer='';contractFocus='';contractCustomerFilterOpen=false;}
function contractKindLabel(kind){return contractKinds.find(([id])=>id===kind)?.[1]||kind;}
function contractKindsAllowed(){return contractKinds.filter(([kind])=>hasArea(kind==='service'?'service':'proformas'));}
function contractCustomerLabel(id){return organizations.find(row=>row.id===id)?.name||'Customer unavailable';}
function contractActive(row,on=companyDate()){return row?.status==='approved'&&row.starts_on<=on&&(!row.ends_on||row.ends_on>=on);}
function contractSummary(row){return `<strong>${esc(row.contract_number)} · ${esc(row.title)}</strong><p>${esc(contractKindLabel(row.kind))} · ${esc(Object.hasOwn(row,'customer')?row.customer?.name||'Customer unavailable':contractCustomerLabel(row.organization_id))} · ${esc(row.status)}${row.status==='approved'&&!contractActive(row)?' · outside effective dates':''}</p><p>${esc(row.starts_on)} — ${esc(row.ends_on||'No end date')} · ${esc(row.reference||'No reference')}</p>`;}
function contractCardContent(row,expanded=!!contractFocus){return `${expanded?contractSummary(row):`<strong>${esc(row.contract_number)} · ${esc(row.title)}</strong><p>${esc(row.customer?.name||'Customer unavailable')}</p><p>${esc(contractKindLabel(row.kind))} · ${esc(row.status)}</p>`}${expanded&&row.notes?`<p>${esc(row.notes)}</p>`:''}${expanded&&row.approved_at?`<p>Approved by ${esc(employeeName(row.approved_by))} · ${esc(row.approved_at)}<br>Approved file ID: <code>${esc(row.approved_attachment_id)}</code></p>`:''}<div class="actions">${!expanded?`<button type="button" data-contract-open="${esc(row.id)}">Open contract</button>`:`${row.status==='draft'?`<button type="button" data-contract-edit="${esc(row.id)}">Edit draft</button>`:''}<button type="button" data-contract-files="${esc(row.id)}">Contract documents</button><button type="button" data-contract-history="${esc(row.id)}">History</button>${me.role==='owner'&&row.status==='draft'?`<button type="button" data-contract-approve="${esc(row.id)}">Approve contract</button>`:''}${me.role==='owner'&&row.status!=='cancelled'?`<button type="button" data-contract-cancel="${esc(row.id)}">Cancel contract</button>`:''}`}</div>`;}
function bindContractCard(card,row,current){
 for(const [action,handler] of [['edit',()=>openContractEditor(row)],['files',()=>openDocumentAttachments('contract',row.id,row.contract_number)],['history',()=>openContractHistory(row)],['approve',()=>openContractDecision(row,'approve')],['cancel',()=>openContractDecision(row,'cancel')]])card.querySelector(`[data-contract-${action}]`)?.addEventListener('click',()=>run(()=>{if(current()&&card.isConnected)return handler();}));
}
async function updateConfirmedContract(saved,text,current){
 const target=$('#content');if(!current()||!target?.isConnected)return;
 let card=[...target.querySelectorAll('[data-contract-card]')].find(node=>node.dataset.contractCard===saved.id);
 if(!card){
  const left=window.scrollX,top=window.scrollY;
  card=document.createElement('article');card.className='card';card.dataset.contractCard=saved.id;
  const first=target.querySelector('[data-contract-card]'),empty=target.querySelector('.empty');
  if(first)target.insertBefore(card,first);else if(empty)empty.replaceWith(card);else target.append(card);
  window.scrollTo({left,top,behavior:'instant'});
 }
 const token={};contractCardReads.set(card,token);
 const active=()=>current()&&target===$('#content')&&target.isConnected&&card.isConnected&&contractCardReads.get(card)===token;
 // The write receipt has no caller-visible customer join. Keep actions gated until that scoped read completes.
 const receipt={...saved,customer:null};
 function patch(row,notice=''){
  const focused=card.contains(document.activeElement),left=window.scrollX,top=window.scrollY;
  card.innerHTML=contractCardContent(row,true);card.tabIndex=-1;
  if(notice){card.querySelector('.actions').innerHTML=notice;}
  else bindContractCard(card,row,active);
  const focus=card.querySelector('[data-contract-retry-saved]')||card.querySelector('[data-contract-edit]')||card.querySelector('[data-contract-files]')||card;
  if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
  if(focused)focus.focus({preventScroll:true});
  window.scrollTo({left,top,behavior:'instant'});
 }
 async function reload(){
  if(!active())return;
  patch(receipt,'<p role="status">Saved. Loading current contract details…</p>');
  try{
   const result=await client.from('customer_contracts').select('*,customer:organizations(name)').eq('id',saved.id).maybeSingle();
   if(!active())return;if(result.error)throw result.error;
   const row=result.data;
   if(row?.id!==saved.id||!Number.isInteger(row.version)||row.version<saved.version||!['draft','approved','cancelled'].includes(row.status)||!contractKinds.some(([kind])=>kind===row.kind)||!['contract_number','organization_id','title','starts_on','reference','notes'].every(key=>typeof row[key]==='string')||!Object.hasOwn(row,'customer')||(row.status==='approved'&&(!row.approved_attachment_id||!row.approved_by||!row.approved_at)))throw Error('Current contract details are unavailable.');
   patch(row);message(text);
  }catch(error){
   if(!active())return;
   patch(receipt,`<p role="alert">${esc(text)} Current details could not load: ${esc(error.message)} Use Retry saved contract before taking another action.</p><button type="button" data-contract-retry-saved>Retry saved contract</button>`);
   card.querySelector('[data-contract-retry-saved]').onclick=()=>run(reload);
   message(text+' Current details could not load. Use Retry saved contract.');
  }
 }
 await reload();
}
async function contractsWorkspace(){
 const actor=me,epoch=++contractEpoch,current=()=>me===actor&&contractEpoch===epoch&&view==='contracts';
 const target=$('#content');if(!listsLoaded)contractCustomerFilterOpen=false;workspaceLoading('Loading contracts…');
 try{
  let query=client.from('customer_contracts').select(contractFocus?'*,customer:organizations(name)':'id,contract_number,organization_id,kind,title,status,starts_on,ends_on,customer:organizations(name)').order('updated_at',{ascending:false}).order('id',{ascending:false});
  if(contractFocus)query=query.eq('id',contractFocus);else {if(contractKind)query=query.eq('kind',contractKind);if(contractCustomer)query=query.eq('organization_id',contractCustomer);query=query.range(contractPage*30,contractPage*30+30);}
  const result=await query;if(!current())return;if(result.error)throw result.error;
  const rows=(result.data||[]).slice(0,30);
  target.innerHTML=`${workspacePageHeader({title:contractFocus?rows[0]?.contract_number||'Contracts':'Contracts',subtitle:'Service, placement and payment terms.',back:contractFocus?'<button type="button" data-contract-back>← All contracts</button>':'',actions:'<button type="button" data-contract-refresh>Refresh</button><button type="button" class="primary-action" data-contract-new>New contract</button>'})}<p>The owner approves a specific uploaded contract file.</p>${contractFocus?'':`<div class="grid"><label>Category<select data-contract-kind><option value="">All categories</option>${contractKindsAllowed().map(([id,label])=>`<option value="${id}" ${contractKind===id?'selected':''}>${label}</option>`).join('')}</select></label><div data-contract-customer-filter>${contractCustomerFilterOpen?contractCustomerFilterHtml():`<button type="button" data-contract-customer-open>${contractCustomer?'Change customer filter':'Filter by customer'}</button>${contractCustomer?'<button type="button" data-contract-customer-clear>All customers</button>':''}`}</div></div>`}${rows.map(row=>`<article class="card" data-contract-card="${esc(row.id)}">${contractCardContent(row)}</article>`).join('')||'<p class="empty">No contracts in this view.</p>'}${contractFocus?'':`<div class="actions"><button type="button" data-contract-previous ${contractPage===0?'disabled':''}>Previous</button><span>Page ${contractPage+1}</span><button type="button" data-contract-next ${result.data.length<=30?'disabled':''}>Next</button></div>`}`;
  target.querySelector('[data-contract-new]').onclick=()=>run(()=>openContractEditor());
  target.querySelectorAll('[data-contract-open]').forEach(button=>button.onclick=()=>run(()=>{if(!current())return;contractFocus=button.dataset.contractOpen;return contractsWorkspace();}));
  target.querySelector('[data-contract-customer-open]')?.addEventListener('click',()=>run(async()=>{await loadContractCustomers();if(!current())return;contractCustomerFilterOpen=true;const host=target.querySelector('[data-contract-customer-filter]');host.innerHTML=contractCustomerFilterHtml();const select=host.querySelector('[data-contract-customer]');select.onchange=()=>{if(!current())return;contractCustomer=select.value;contractPage=0;run(contractsWorkspace);};select.focus();}));
  target.querySelector('[data-contract-customer-clear]')?.addEventListener('click',()=>run(()=>{if(!current())return;contractCustomer='';contractPage=0;return contractsWorkspace();}));
  target.querySelector('[data-contract-refresh]').onclick=()=>run(contractsWorkspace);
  target.querySelector('[data-contract-back]')?.addEventListener('click',()=>{contractFocus='';run(contractsWorkspace);});
  for(const [key,set] of [['kind',value=>contractKind=value],['customer',value=>contractCustomer=value]])target.querySelector(`[data-contract-${key}]`)?.addEventListener('change',event=>{set(event.target.value);contractPage=0;run(contractsWorkspace);});
  for(const [key,delta] of [['previous',-1],['next',1]])target.querySelector(`[data-contract-${key}]`)?.addEventListener('click',()=>{contractPage+=delta;run(contractsWorkspace);});
  target.querySelectorAll('[data-contract-card]').forEach(card=>bindContractCard(card,rows.find(row=>row.id===card.dataset.contractCard),current));
 }catch(error){if(current())target.innerHTML=`${workspacePageHeader({title:'Contracts',actions:'<button type="button" data-contract-retry>Retry</button>'})}<p role="alert">${esc(error.message)}</p>`;target.querySelector('[data-contract-retry]')?.addEventListener('click',()=>run(contractsWorkspace));}
}
function contractCustomerFilterHtml(){return `<label>Customer<select data-contract-customer data-lookup-rows="organizations"><option value="">All customers</option>${salesOrganizationOptions(contractCustomer)}</select></label>`;}
async function loadContractCustomers(){
 const actor=me,epoch=contractEpoch;if(!listsLoaded)await (listsLoading||loadLists());
 if(me!==actor||contractEpoch!==epoch||view!=='contracts')return false;
 if(!listsLoaded)throw Error('Customer records could not load. Reopen the contract.');return true;
}
async function openContractEditor(row=null){
 const actor=me,epoch=contractEpoch,id=row?.id||crypto.randomUUID(),requestId=crypto.randomUUID();
 if(!(await loadContractCustomers())||me!==actor||contractEpoch!==epoch)return;
 return actionForm(row?'Edit '+row.contract_number:'New customer contract',`<label>Customer branch<select name="customer" data-lookup-rows="organizations" required><option value="">Choose customer</option>${salesOrganizationOptions(row?.organization_id||contractCustomer)}</select></label><label>Category<select name="kind" required>${contractKindsAllowed().map(([kind,label])=>`<option value="${kind}" ${row?.kind===kind?'selected':''}>${label}</option>`).join('')}</select></label><label>Title<input name="title" required maxlength="200" value="${esc(row?.title||'')}"></label><label>Reference<input name="reference" maxlength="500" value="${esc(row?.reference||'')}"></label><div class="grid"><label>Starts on<input name="starts" type="date" required value="${esc(row?.starts_on||companyDate())}"></label><label>Ends on · optional<input name="ends" type="date" value="${esc(row?.ends_on||'')}"></label></div><label>Internal notes<textarea name="notes" maxlength="4000">${esc(row?.notes||'')}</textarea></label><p>Save the draft, upload the contract, then ask the owner to approve its document. Approved terms cannot be edited.</p>`,async values=>{
  if(me!==actor||contractEpoch!==epoch||view!=='contracts')throw Error('Reopen the contract before saving.');
  const result=await client.rpc('save_customer_contract',{p_request_id:requestId,p_id:id,p_expected_version:row?.version||0,p_organization_id:values.customer,p_kind:values.kind,p_title:values.title,p_reference:values.reference,p_starts_on:values.starts,p_ends_on:values.ends||null,p_notes:values.notes});
  if(me!==actor||contractEpoch!==epoch||view!=='contracts')return;if(result.error)throw result.error;
  const saved=Array.isArray(result.data)?result.data[0]:result.data;if(saved?.id!==id||saved.version!==(row?.version||0)+1)throw Error('The server did not confirm this contract version. Retry with the same values.');
  branchActivityCache.clear();await updateConfirmedContract(saved,'Contract draft saved.',()=>me===actor&&contractEpoch===epoch&&view==='contracts');
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
  branchActivityCache.clear();await updateConfirmedContract(saved,`Contract ${action==='approve'?'approved':'cancelled'}.`,current);
 });
}
async function openContractHistory(row){
 const actor=me,epoch=contractEpoch,trigger=document.activeElement;const result=await client.from('customer_contract_events').select('id,action,actor_user_id,request,snapshot,created_at').eq('contract_id',row.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(101);
 if(me!==actor||contractEpoch!==epoch||view!=='contracts')return;if(result.error)throw result.error;
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label',row.contract_number+' history');
 dialog.innerHTML=`<h2>${esc(row.contract_number)} · history</h2>${(result.data||[]).slice(0,100).map(event=>`<article><strong>${esc(event.action)} · version ${esc(event.snapshot.version)}</strong><p>${esc(employeeName(event.actor_user_id))} · ${esc(event.created_at)}</p><p>${esc(event.request.reference||event.snapshot.reference||'')}</p><details><summary>Saved terms</summary>${contractSummary(event.snapshot)}<p>${esc(event.snapshot.notes||'')}</p></details></article>`).join('')}${result.data.length>100?'<p>Latest 100 events shown.</p>':''}<button type="button">Close</button>`;
 const requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>false,isDirty:()=>false});
 dialog.querySelector('button').onclick=requestClose;dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);showWorkspaceDialog(dialog,{size:'large',trigger});
}
