'use strict';

const actionDialog=document.createElement('dialog');
actionDialog.id='actionEditor';
actionDialog.setAttribute('aria-labelledby','actionTitle');
const actionEditorForm=document.createElement('form');
actionEditorForm.innerHTML='<h2 id="actionTitle"></h2><div id="actionFields"></div><p id="actionError" class="error" role="alert"></p><div class="actions"><button type="submit">Save</button><button type="button" id="actionCancel">Cancel</button></div>';
actionDialog.append(actionEditorForm);
document.body.append(actionDialog);
let actionSubmit=null,actionSaving=false;
const actionFields=actionEditorForm.querySelector('#actionFields');
const actionError=actionEditorForm.querySelector('#actionError');
const actionSave=actionEditorForm.querySelector('[type="submit"]');
const actionCancel=actionEditorForm.querySelector('#actionCancel');
actionCancel.addEventListener('click',()=>{if(!actionSaving)actionDialog.close()});
actionDialog.addEventListener('cancel',e=>{if(actionSaving)e.preventDefault()});
actionDialog.addEventListener('close',()=>{actionSubmit=null});
actionEditorForm.addEventListener('submit',async e=>{
 e.preventDefault();if(actionSaving||!actionSubmit)return;
 const values=Object.fromEntries(new FormData(actionEditorForm));
 for(const key of Object.keys(values))if(typeof values[key]==='string')values[key]=values[key].trim();
 for(const control of actionFields.querySelectorAll('[required]'))if(!values[control.name]){actionError.textContent='Complete '+(control.labels?.[0]?.textContent.trim()||'the required field')+'.';control.focus();return;}
 actionSaving=true;actionSave.disabled=true;actionCancel.disabled=true;actionSave.textContent='Saving…';actionError.textContent='';
 try{await actionSubmit(values);actionDialog.close()}
 catch(error){actionError.textContent=error.message||'Could not save. Please retry.'}
 finally{actionSaving=false;actionSave.disabled=false;actionCancel.disabled=false;actionSave.textContent='Save'}
});

function actionForm(title,fields,onSubmit){
 if(actionSaving)return actionEditorForm;
 actionEditorForm.reset();actionEditorForm.querySelector('#actionTitle').textContent=title;
 actionFields.replaceChildren();
 if(typeof fields==='string')actionFields.innerHTML=fields;else actionFields.append(fields);
 actionError.textContent='';actionSubmit=onSubmit;
 if(!actionDialog.open)actionDialog.showModal();
 actionFields.querySelector('input,select,textarea')?.focus();
 return actionEditorForm;
}

function openOrganizationForm(o=null){
 if(me?.role!=='owner')throw Error('Owner access is required to edit accounts.');
 const id=o?.id||crypto.randomUUID();
 return actionForm(o?'Edit account':'Add account',
  field('name','Account name',o?.name||'','text',true)+field('location','Location',o?.location||'','text',true)+field('type','Organisation type',o?.type||'','text',true),
  async values=>{
   if(values.name!==titleCase(values.name)){showFieldErrors(actionEditorForm,{name:'Use Title Case, for example Shree Hindu Mandal.'});throw Error('Field invalid: account name must use Title Case.')}
   const r=await client.rpc('save_organization',{p_id:id,p_name:values.name,p_location:values.location,p_type:values.type});
   if(r.error)throw r.error;
   const row=Array.isArray(r.data)?r.data[0]:r.data;const index=organizations.findIndex(x=>x.id===id);if(index<0)organizations.push(row);else organizations[index]=row;selected=id;invalidateLocalApproval(id);scan();if(!o)goProfile('client',id);else render();message('Account saved.');
  });
}

function openProductForm(p=null){
 if(!p&&me?.role!=='owner')throw Error('Owner access is required to add products.');
 const id=p?.id||crypto.randomUUID();
 return actionForm(p?'Edit product':'Add product',field('name','Product name',p?.name||'','text',true)+field('sku','Stock code · optional',p?.sku||''),async values=>{
  const r=p?await client.rpc('save_product',{p_id:id,p_revision:p.revision,p_name:values.name,p_sku:values.sku}):await client.rpc('import_records',{p_products:[{id,name:values.name,sku:values.sku,source:{origin:'manual'}}]});
  if(r.error)throw r.error;
  if(p){const row=Array.isArray(r.data)?r.data[0]:r.data;const index=products.findIndex(x=>x.id===id);if(index>=0)products[index]=row;render()}
  else{const saved=await client.from('products').select('*').eq('id',id).single();if(saved.error)throw saved.error;products.push(saved.data);search='';page=0;render()}
  message('Product saved.');
 });
}

function openIncorrectForm(c){
 return actionForm('Flag contact as incorrect',`<p>${esc([c.first_name,c.last_name].filter(Boolean).join(' '))} will move to Incorrect for review. The record is retained.</p><label><span>Reason</span><textarea name="reason" required maxlength="2000">${esc(c.reason||'')}</textarea></label>`,async values=>save({...c,status:'incorrect',reason:values.reason}));
}

function openMatchForm(p){
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
 if(me?.role!=='owner')throw Error('Owner access is required to link branches.');
 if(!parent||parent.parent_id)throw Error('Choose a main account before linking a branch.');
 const parents=new Set(organizations.map(x=>x.parent_id).filter(Boolean));const eligible=organizations.filter(x=>x.id!==parent.id&&!x.parent_id&&!parents.has(x.id));
 const form=actionForm('Link existing branch',`<p>Main account: <strong>${esc(parent.name)}</strong> · ${esc(parent.location||'Location missing')}</p><label><span>Find a branch</span><input name="branch_search" type="search" placeholder="Account name, location or type"></label><label><span>Existing branch account</span><select name="branch_id" required></select></label><p id="branchRelationship" class="warning" aria-live="polite"></p><p class="muted">Check ownership and location before saving. Contacts and source records stay separate.</p>`,async values=>{
  if(!eligible.some(x=>x.id===values.branch_id))throw Error('Choose an eligible branch.');
  await linkBranch(values.branch_id,parent.id);
 });
 const searchInput=form.elements.namedItem('branch_search'),select=form.elements.namedItem('branch_id'),relationship=form.querySelector('#branchRelationship');
 const describe=()=>{const branch=eligible.find(x=>x.id===select.value);relationship.textContent=branch?`${branch.name} (${branch.location||'location missing'}) will become a branch under ${parent.name} (${parent.location||'location missing'}).`:'Choose the account to link as a branch.'};
 const populate=()=>{const previous=select.value||initialBranch?.id||'',q=searchInput.value.trim().toLowerCase(),rows=eligible.filter(x=>(x.name+' '+x.location+' '+x.type).toLowerCase().includes(q));select.replaceChildren(new Option(rows.length?'Choose an existing account':'No eligible accounts found',''));for(const x of rows)select.add(new Option(`${x.name} · ${x.location||'Location missing'} · ${x.type||'Type missing'}`,x.id));if(rows.some(x=>x.id===previous))select.value=previous;describe()};
 searchInput.addEventListener('input',populate);select.addEventListener('change',describe);populate();
 return form;
}
