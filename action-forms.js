'use strict';

const actionDialog=document.createElement('dialog');
actionDialog.id='actionEditor';
actionDialog.setAttribute('aria-labelledby','actionTitle');
const actionEditorForm=document.createElement('form');
actionEditorForm.innerHTML='<h2 id="actionTitle"></h2><p>Fields are required unless marked (optional).</p><p id="actionError" class="error" role="alert"></p><div id="actionFields"></div><div class="actions"><button type="button" id="actionCancel" class="button-quiet">Cancel</button><button type="submit" class="button-primary">Save</button></div>';
actionEditorForm.noValidate=true;
actionDialog.append(actionEditorForm);
document.body.append(actionDialog);
let actionSubmit=null,actionSaving=false,actionInitialValues='',actionFormActor=null,actionFormEpoch=0,actionValidationSubmitted=false;
const actionFields=actionEditorForm.querySelector('#actionFields');
const actionError=actionEditorForm.querySelector('#actionError');
const actionSave=actionEditorForm.querySelector('[type="submit"]');
const actionCancel=actionEditorForm.querySelector('#actionCancel');
const dismissActionForm=bindWorkspaceDialogDismiss(actionDialog,{isBusy:()=>actionSaving,isDirty:()=>workspaceFormSnapshot(actionEditorForm)!==actionInitialValues});
actionCancel.addEventListener('click',dismissActionForm);
actionDialog.addEventListener('close',()=>{actionSubmit=null});
actionEditorForm.addEventListener('focusout',event=>{const control=event.target;if(actionSaving||me!==actionFormActor||actionFeedbackEpoch!==actionFormEpoch||!actionSubmit||!actionDialog.open||!actionFields.contains(control)||!control.matches('input,select,textarea'))return;showFieldError(control,nativeFieldError(control));if(actionValidationSubmitted)actionFeedbackShow(actionFeedbackReference(actionSave),fieldErrorSummary(actionFields.querySelectorAll('.field-error').length),'error',actionError);});
actionEditorForm.addEventListener('submit',async e=>{
 e.preventDefault();if(actionSaving||!actionSubmit)return;
 if(me!==actionFormActor||actionFeedbackEpoch!==actionFormEpoch){actionError.textContent='Login changed. Close and reopen this form.';return;}
 if(busy){actionFeedbackRefuse(actionSave,actionError);return;}
 const errors=nativeFormErrors(actionEditorForm);actionValidationSubmitted=errors.size>0;
 if(errors.size){actionFeedbackShow(actionFeedbackReference(actionSave),fieldErrorSummary(errors.size),'error',actionError);showFieldErrors(actionEditorForm,errors);return;}
 showFieldErrors(actionEditorForm,errors);
 const values=Object.fromEntries(new FormData(actionEditorForm));
 for(const key of Object.keys(values))if(typeof values[key]==='string')values[key]=values[key].trim();
 const submit=actionSubmit,actor=me,epoch=actionFeedbackEpoch;
 await run(async()=>{
  actionSaving=true;const cancelDisabled=actionCancel.disabled;actionCancel.disabled=true;
  try{await submit(values);if(me===actor&&actionFeedbackEpoch===epoch)await closeWorkspaceDialog(actionDialog)}
  finally{actionSaving=false;actionCancel.disabled=cancelDisabled}
 },{origin:actionSave,errorTarget:actionError,busyLabel:'Saving…'});
});

function actionForm(title,fields,onSubmit){
 if(actionSaving)return actionEditorForm;
 actionSave.textContent='Save';
 if(typeof actionFeedbackRememberDialog==='function')actionFeedbackRememberDialog(actionDialog);
 actionEditorForm.reset();actionEditorForm.querySelector('#actionTitle').textContent=title;
 actionFields.replaceChildren();
 if(typeof fields==='string')actionFields.innerHTML=fields;else actionFields.append(fields);
 actionError.textContent='';actionSubmit=onSubmit;actionFormActor=me;actionFormEpoch=actionFeedbackEpoch;actionValidationSubmitted=false;
 for(const control of actionFields.querySelectorAll('input,select,textarea')){
  if(control.required||control.type==='hidden'||control.readOnly||control.disabled)continue;
  const label=control.closest('label'),caption=label?.querySelector('span')||label?.firstChild;
  if(caption&&!/optional/i.test(caption.textContent))caption.textContent+=' (optional)';
 }
 actionInitialValues=workspaceFormSnapshot(actionEditorForm);
 showWorkspaceDialog(actionDialog);
 actionFields.querySelector('input,select,textarea')?.focus();
 return actionEditorForm;
}

function openOrganizationForm(o=null){
 if(!canEditRecords())throw Error(recordsLockedText);
 const id=o?.id||crypto.randomUUID(),context=organizationSaveContext();
 const current=()=>context.current()&&actionSubmit===submit;
 const submit=async values=>{
  if(!current())return;
  if(values.name!==titleCase(values.name)){showFieldErrors(actionEditorForm,{name:'Use Title Case, for example Shree Hindu Mandal.'});throw Error('Field invalid: account name must use Title Case.')}
  let result;try{result=await client.rpc('save_organization',{p_id:id,p_name:values.name,p_location:values.location,p_type:values.type});}catch(error){if(current())throw error;return;}
  if(!context.sessionCurrent())return;if(result.error){if(current())throw result.error;return;}
  if(!context.latest()){invalidateOrganizationLists();return;}listsEpoch++;listsLoading=null;clearClientDirectory();
  const row=Array.isArray(result.data)?result.data[0]:result.data;
  return finishOrganizationSave(context,'Account saved.',()=>applySavedOrganization(context,id,row,{invalidateApproval:true,created:!o}));
 };
 const form=actionForm(o?'Edit account':'Add account',field('name','Account name',o?.name||'','text',true)+field('location','Location',o?.location||'','text',true)+field('type','Organisation type',o?.type||'','text',true),submit),name=form.elements.namedItem('name');
 const checkName=()=>name.setCustomValidity(name.value.trim()===titleCase(name.value)?'':'Use Title Case, for example Shree Hindu Mandal.');name.addEventListener('input',checkName);checkName();return form;
}

function openProductForm(p=null){
 if(!canEditRecords())throw Error(recordsLockedText);
 const id=p?.id||crypto.randomUUID(),actor=me,paged=typeof catalogIsActive==='function'&&catalogIsActive(),context=paged?catalogSaveContext():null;
 const current=()=>me===actor&&(!paged||context.current())&&actionSubmit===submit;
 const submit=async values=>{
  if(!current())return;
  let r;
  try{r=p?await client.rpc('save_product',{p_id:id,p_revision:p.revision,p_name:values.name,p_sku:values.sku}):await client.rpc('add_product',{p_id:id,p_name:values.name,p_sku:values.sku,p_source:{origin:'manual'}});}
  catch(error){if(current())throw error;return;}
  if(!current())return;if(r.error)throw r.error;
  if(paged){if(!p)catalogSelectedProduct=id;await refreshCatalogSavedProduct(id,'Product saved.',context,{original:p?p.revision+1:1});return;}
  if(p){const row=Array.isArray(r.data)?r.data[0]:r.data;const index=products.findIndex(x=>x.id===id);if(index>=0)products[index]=row;render()}
  else{const saved=await client.from('products').select('*').eq('id',id).single();if(!current())return;if(saved.error)throw saved.error;products.push(saved.data);search='';page=0;render()}
  message('Product saved.');
 };
 return actionForm(p?'Edit product':'Add product',field('name','Product name',p?.name||'','text',true)+field('sku','Stock code (optional)',p?.sku||''),submit);
}

function openIncorrectForm(c){
 if(!canEditRecords())throw Error(recordsLockedText);
 return actionForm('Flag contact as incorrect',`<p>${esc([c.first_name,c.last_name].filter(Boolean).join(' '))} will move to Incorrect for review. The record is retained.</p><label><span>Reason</span><textarea name="reason" required maxlength="2000">${esc(c.reason||'')}</textarea></label>`,async values=>save({...c,status:'incorrect',reason:values.reason}));
}

function openMatchForm(p){
 if(!canEditRecords())throw Error(recordsLockedText);
 const candidates=products.filter(x=>x.id!==p.id&&normalize(x.name)===normalize(p.name));
 const current=products.find(x=>x.id===p.match_id);
 const options=candidates.map(x=>`<option value="${esc(x.id)}" ${x.id===p.match_id?'selected':''}>${esc(x.name)} · ${esc(x.sku||'No stock code')} · ${esc(x.source?.source_file||'Manual entry')} ${esc(x.source?.source_row?'row '+x.source.source_row:'')} · ${esc(x.id.slice(0,8))}</option>`).join('');
 return actionForm('Review product match',`<p>Review the exact-name candidates for <strong>${esc(p.name)}</strong>. Saving a match keeps both records separate.</p>${current?`<p>Current match: ${esc(current.name)} · ${esc(current.sku||'No stock code')}</p>`:''}<label><span>Matching product</span><select name="match_id"><option value="">Clear match · leave unreviewed</option>${options}</select></label>${candidates.length?'':'<p class="muted">No exact-name candidates found. You can clear the current match.</p>'}`,async values=>{
  if(values.match_id&&!candidates.some(x=>x.id===values.match_id))throw Error('Choose a listed product.');
  const r=await client.rpc('set_product_match',{p_id:p.id,p_revision:p.revision,p_match_id:values.match_id||null,p_match_status:values.match_id?'confirmed':'unreviewed'});
  if(r.error)throw r.error;
  const row=Array.isArray(r.data)?r.data[0]:r.data;const index=products.findIndex(x=>x.id===p.id);if(index>=0)products[index]=row;
  render();message('Product match saved. No records merged.');
 });
}

function openBranchForm(parent,initialBranch=null){
 if(!canEditRecords())throw Error(recordsLockedText);
 if(!parent||parent.parent_id)throw Error('Choose a main account before linking a branch.');
 const context=organizationSaveContext();
 const parents=new Set(organizations.map(x=>x.parent_id).filter(Boolean));const eligible=organizations.filter(x=>x.id!==parent.id&&!x.parent_id&&!parents.has(x.id));
 const form=actionForm('Link existing branch',`<p>Main account: <strong>${esc(parent.name)}</strong> · ${esc(parent.location||'Location missing')}</p><label><span>Find a branch</span><input name="branch_search" type="search" placeholder="Account name, location or type"></label><label><span>Existing branch account</span><select name="branch_id" required></select></label><p id="branchRelationship" class="warning" aria-live="polite"></p><p class="muted">Check ownership and location before saving. Contacts and source records stay separate.</p>`,async values=>{
  if(!context.current())return;
  if(!eligible.some(x=>x.id===values.branch_id))throw Error('Choose an eligible branch.');
  await linkBranch(values.branch_id,parent.id,context);
 });
 const searchInput=form.elements.namedItem('branch_search'),select=form.elements.namedItem('branch_id'),relationship=form.querySelector('#branchRelationship');
 const describe=()=>{const branch=eligible.find(x=>x.id===select.value);relationship.textContent=branch?`${branch.name} (${branch.location||'location missing'}) will become a branch under ${parent.name} (${parent.location||'location missing'}).`:'Choose the account to link as a branch.'};
 const populate=()=>{const previous=select.value||initialBranch?.id||'',q=searchInput.value.trim().toLowerCase(),rows=eligible.filter(x=>(x.name+' '+x.location+' '+x.type).toLowerCase().includes(q));select.replaceChildren(new Option(rows.length?'Choose an existing account':'No eligible accounts found',''));for(const x of rows)select.add(new Option(`${x.name} · ${x.location||'Location missing'} · ${x.type||'Type missing'}`,x.id));if(rows.some(x=>x.id===previous))select.value=previous;describe()};
 searchInput.addEventListener('input',populate);select.addEventListener('change',describe);populate();actionInitialValues=workspaceFormSnapshot(form);
 return form;
}
