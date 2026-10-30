'use strict';
// Who can use which part of the software. The owner has everything; a department head or staff member has the areas
// ticked on their staff record (migration 060). The database refuses reads and saves outside those areas, so hiding
// menu items here only keeps the screen tidy. A head manages the staff of their own department and can only give
// areas they have themselves.
const accessAreas=[
 ['leads','Leads','Record inquiries and follow them up'],
 ['proformas','Pro formas & current orders','Create, send and follow Pro formas'],
 ['deliveries','Deliveries','Packing and delivery progress'],
 ['service','Service jobs','Installations, service schedule and forms'],
 ['purchasing','Purchasing & suppliers','Purchase requests and the supplier list'],
 ['stock','Stock & availability','Stock levels, moving stock, godowns'],
 ['stock_count','Stock counts','Counting stock'],
 ['travel','Travel requests','Request and see trips'],
 ['reports','Reports','Work and activity reports'],
 ['records','Clients & items data','Add, change or delete clients, contacts and products (owner gives this)']
];
// Starting ticks for a new account in each department; the head or owner changes them before saving.
const departmentAccess={
 sales:['leads','proformas','deliveries','stock','travel','reports'],
 accounts:['proformas','deliveries','purchasing','stock','travel','reports'],
 stores:['deliveries','purchasing','stock','stock_count','travel'],
 service:['service','deliveries','stock','travel','reports'],
 marketing:['leads','proformas','stock','travel','reports'],
 management:accessAreas.map(([key])=>key).filter(key=>key!=='records'),
 '':['travel']
};
const departmentLabels=[['','Choose'],['sales','Sales'],['accounts','Accounts'],['stores','Stores & delivery'],['service','Service'],['marketing','Marketing'],['management','Management']];
const roleLabels={owner:'Owner',head:'Department head',staff:'Staff'};
function departmentLabel(key){return departmentLabels.find(([k])=>k===key)?.[1]||'No department'}
function isHead(){return me?.role==='head'}
// area may be a list: any one of them is enough.
function hasArea(area,person=me){if(Array.isArray(area))return area.some(a=>hasArea(a,person));return !area||person?.role==='owner'||(person?.access||[]).includes(area)}
// Areas the signed-in person may hand out. Clients & items data is given and removed by the owner only (migration 071).
function canGrantArea(key){return key==='records'?me?.role==='owner':hasArea(key)}
function grantableAreas(){return accessAreas.filter(([key])=>canGrantArea(key))}
// Adding, changing or deleting clients, contacts and products. Everyone else still uses them in leads, quotes and orders.
const recordsLockedText='Only people with Clients & items data access can change this. Ask the owner.';
function canEditRecords(){return hasArea('records')}
function recordsLockedNote(){return canEditRecords()?'':`<p class="muted records-locked">${esc(recordsLockedText)}</p>`}
function canManagePerson(row){
 if(!row||!me)return false;
 if(me.role==='owner')return true;
 return isHead()&&!!me.department&&row.role==='staff'&&row.department===me.department&&row.user_id!==me.user_id;
}
// Menu entry or open screen → area. null means everyone (or owner-only, handled elsewhere).
function viewArea(target,section){
 if(target==='contracts')return ['proformas','service'];
 if(target==='prices')return 'proformas';
 if(target==='leads')return 'leads';
 if(target==='packing')return 'deliveries';
 if(target==='sales')return section==='delivery'?'deliveries':'proformas';
 if(target==='purchasing')return 'purchasing';
 if(target==='service')return 'service';
 if(target==='inventory')return section==='catalog'||section==='review'?null:'stock';
 if(target==='stockcount')return section==='review'?null:'stock_count';
 if(target==='reports')return 'reports';
 if(target==='travel')return 'travel';
 if(target==='requests')return section==='complaints'?['leads','service']:'leads';
 return null;
}
function applyAccessNavigation(){
 document.querySelectorAll('#nav [data-view]').forEach(button=>{
  if(button.hasAttribute('data-owner-only')&&me?.role!=='owner')return;
  const area=viewArea(button.dataset.view,button.dataset.workspaceSection);
  if(area)button.hidden=!hasArea(area);
 });
}
function currentSection(){return view==='sales'?(salesEditing==='new'?'new':salesSection):view==='inventory'?inventorySection:view==='stockcount'&&typeof countTab!=='undefined'?countTab:view==='requests'&&typeof requestSection!=='undefined'?requestSection:null}
// Shown instead of a screen the person has no access to (for example a link from a task).
function accessBlocked(){
 const area=viewArea(view,currentSection());
 if(!area||hasArea(area))return false;
 const first=Array.isArray(area)?area[0]:area,label=accessAreas.find(([key])=>key===first)?.[1]||first;
 $('#content').innerHTML=`${workspacePageHeader({title:label})}<section class="card"><p>You do not have access to this part yet. Ask your department head to tick <strong>${esc(label)}</strong> for you on the Staff page.</p></section>`;
 return true;
}
function accessSummary(row){
 if(row.role==='owner')return 'Everything';
 const names=accessAreas.filter(([key])=>(row.access||[]).includes(key)).map(([,label])=>label);
 return names.length?names.join(', '):'Nothing yet';
}
// Checkbox list. Only areas the signed-in person has can be ticked; others are shown greyed out with the reason.
function accessCheckboxes(selected){
 return `<fieldset class="access-areas"><legend>What this person can use</legend><p class="muted">Everyone always has My tasks, notes and reminders, calendar, client accounts, product search and How to use.</p>${accessAreas.map(([key,label,hint])=>{const allowed=canGrantArea(key);return `<label class="access-area${allowed?'':' muted'}"><input type="checkbox" name="access" value="${key}" ${selected.includes(key)?'checked':''} ${allowed?'':'disabled'}> <span><strong>${esc(label)}</strong> · ${esc(hint)}${allowed?'':key==='records'?' · only the owner can give or remove it':' · only someone who has it can give it'}</span></label>`}).join('')}</fieldset>`;
}
function checkedAreas(form){return [...form.querySelectorAll('[name="access"]:checked')].map(input=>input.value).filter(key=>canGrantArea(key))}
function startingAccess(department){return (departmentAccess[department]||departmentAccess['']).filter(key=>canGrantArea(key))}
function openStaffAccess(row,onSaved){
 if(!canManagePerson(row)||row.role==='owner')throw Error('You can only change access for people in your own department.');
 const name=employeeName(row.user_id),context=staffSaveContext(row.user_id);
 actionForm(`Access for ${name}`,accessCheckboxes(row.access||[]),async()=>{
  if(!context.current())return;const areas=checkedAreas(actionEditorForm);
  // Only the owner changes Clients & items data; a head's save keeps whatever the owner set.
  if(!canGrantArea('records')&&(row.access||[]).includes('records'))areas.push('records');
  let result;try{result=await client.rpc('set_staff_access',{p_user_id:row.user_id,p_access:areas});}catch(error){if(context.current())throw error;return;}
  if(!context.current())return;if(result.error)throw Error(result.error.message);
  await onSaved(row.user_id,result.data,`Access saved for ${name}.`,context,{access:areas});
 });
}
async function setStaffActive(row,active,onSaved){
 const name=employeeName(row.user_id),context=staffSaveContext(row.user_id);
 if(!context.current())return;
 if(!active){
  const button=context.directory.querySelector(`[data-staff-active="${row.user_id}"]`),state=JSON.stringify(row);
  if(!await askConfirm({title:`Switch off login for ${name}?`,body:'They will not be able to sign in until it is switched on again. Their records stay.',confirmLabel:'Switch off login',tone:'danger'}))return;
  if(!context.current()||!canManagePerson(row)||!button?.isConnected||button.dataset.active!=='false'||context.directory.staffRows.find(person=>person.user_id===row.user_id)!==row||JSON.stringify(row)!==state)return;
 }
 let result;try{result=await client.rpc('set_staff_active',{p_user_id:row.user_id,p_active:active});}catch(error){if(context.current())throw error;return;}
 if(!context.current())return;if(result.error)throw Error(result.error.message);
 await onSaved(row.user_id,result.data,`${name}: login switched ${active?'on':'off'}.`,context,{active});
}
async function setStaffRole(row,role,onSaved){
 const name=employeeName(row.user_id),context=staffSaveContext(row.user_id);if(!context.current())return;
 let result;try{result=await client.rpc('manage_staff',{p_user_id:row.user_id,p_role:role,p_active:row.active});}catch(error){if(context.current())throw error;return;}
 if(!context.current())return;if(result.error)throw Error(result.error.message);
 await onSaved(row.user_id,result.data,`${name} is now ${roleLabels[role]}.`,context,{role,active:row.active});
}
// Staff page for a department head: the whole staff list (read only for other departments) and tools for their own.
async function headStaffPage(){
 const actor=me,epoch=sessionLoadEpoch,target=$('#content'),request=target.staffLoadRequest=(target.staffLoadRequest||0)+1,dept=departmentLabel(me.department);
 target.innerHTML=`${workspacePageHeader({title:'Staff',actions:me.department?'<button type="button" id="addEmployee" class="primary-action">Add employee</button>':''})}<section class="card"><h2>${esc(dept)} team</h2>${me.department?`<p class="muted">Add people to ${esc(dept)}, choose what each person can use, reset a forgotten password, and switch a login off when someone leaves. You can only give access you have yourself.</p>`:'<p role="alert">Ask the owner to set your department first. Then you can add your team here.</p>'}<div id="staffList">${workspaceSkeleton('directory','Loading staff…')}</div></section>`;
 const list=target.querySelector('#staffList'),current=()=>me===actor&&sessionLoadEpoch===epoch&&view==='staff'&&target.isConnected&&$('#content')===target&&target.staffLoadRequest===request&&target.querySelector('#staffList')===list;
 $('#addEmployee')?.addEventListener('click',()=>run(async()=>openStaffOnboarding()));
 let r;try{r=await client.from('staff').select('user_id,role,active,phone,department,access');}catch(error){if(current())throw error;return;}
 if(!current())return;
 if(r.error){list.innerHTML=`<p role="alert">Staff could not load: ${esc(r.error.message)}</p>`;return;}
 try{await refreshEmployeeNamesFor(r.data.map(x=>x.user_id));}catch(error){if(current())throw error;return;}if(!current())return;
 list.innerHTML=staffListHtml(r.data);
 bindStaffList(r.data);
 if(typeof decorateStaffTwoStep==='function')decorateStaffTwoStep().catch(()=>{});
}
// Staff page (owner only): who can use the accounting forms, with a switch per person. Changes are logged.
async function decorateStaffAccounting(){
 if(me?.role!=='owner')return;
 const actor=me,rows=[...document.querySelectorAll('[data-staff-row]')],result=await client.rpc('staff_accounting_access');if(me!==actor)return;
 const on=new Set((result.data||[]).filter(r=>r.active).map(r=>r.user_id));
 rows.forEach(row=>{
  if(!row.isConnected)return;
  const id=row.dataset.staffRow,status=row.querySelector('[data-staff-accounting-status]'),cell=row.querySelector('.actions');
  if(status){status.textContent=result.error?'Accounting unavailable':on.has(id)?'Accounting: on':'Accounting: off';status.className='staff-account-status chip chip--'+statusTone(result.error?'failed':on.has(id)?'success':'inactive');}
  if(result.error||!cell)return;
  if(!cell.querySelector('[data-accounting]'))cell.insertAdjacentHTML('beforeend',`<button type="button" data-accounting="${esc(id)}" data-on="${on.has(id)}" aria-label="${on.has(id)?'Remove':'Give'} accounting access for ${esc(employeeName(id))}">${on.has(id)?'Remove accounting access':'Give accounting access'}</button>`);
  const button=cell.querySelector('[data-accounting]');button.onclick=()=>run(async()=>{
   const state=button.dataset.on,turnOn=state!=='true',name=employeeName(id),binding=button.onclick,current=()=>me===actor&&me?.role==='owner'&&view==='staff'&&row.isConnected&&row.dataset.staffRow===id&&button.isConnected&&row.querySelector('[data-accounting]')===button&&button.onclick===binding&&button.dataset.on===state;
   if(!current())return;
   if(!turnOn&&!await askConfirm({title:`Remove accounting access for ${name}?`,body:'They will no longer be able to use the accounting forms.',confirmLabel:'Remove accounting access',tone:'danger'}))return;
   if(!current())return;
   const r=await client.rpc('set_accounting_access',{p_user_id:id,p_active:turnOn});if(!current())return;if(r.error)throw Error(r.error.message);
   button.dataset.on=String(turnOn);button.textContent=turnOn?'Remove accounting access':'Give accounting access';
   button.setAttribute('aria-label',`${turnOn?'Remove':'Give'} accounting access for ${name}`);if(status){status.textContent=turnOn?'Accounting: on':'Accounting: off';status.className='staff-account-status chip chip--'+statusTone(turnOn?'success':'inactive');}
   message(`Accounting access ${turnOn?'given to':'removed for'} ${name}.`);
  });
 });
}

// Staff page (owner): create many logins from a prepared list (format anudha-staff-list-v1). The owner ticks who to
// create now (heads come pre-ticked); logins are created one at a time through the staff-accounts server function,
// heads before their teams. Temporary passwords are shown once, on this screen only, to copy or save for handing out.
const staffListRoles=['owner','head','staff'];
function staffListRows(text){
 let data;try{data=JSON.parse(text);}catch{throw Error('This is not a staff list file.');}
 if(data?.format!=='anudha-staff-list-v1'||!Array.isArray(data.rows)||!data.rows.length)throw Error('This is not a staff list file.');
 if(data.rows.length>200)throw Error('The list has more than 200 people; split it.');
 const seen=new Set();
 return data.rows.map((row,i)=>{
  const name=String(row.full_name||'').trim().replace(/\s+/g,' '),role=String(row.role||'staff'),department=String(row.department||'');
  if(name.length<2)throw Error(`Row ${i+1} has no name.`);
  if(seen.has(name.toLowerCase()))throw Error(`${name} is in the list twice.`);seen.add(name.toLowerCase());
  if(!staffListRoles.includes(role))throw Error(`${name}: role must be owner, head or staff.`);
  if(!departmentLabels.some(([k])=>k===department))throw Error(`${name}: unknown department ${department}.`);
  const access=(Array.isArray(row.access)?row.access:[]).map(String);
  if(access.some(a=>!accessAreas.some(([k])=>k===a)))throw Error(`${name}: unknown area in access.`);
  return {name,role,department,access:role==='owner'?[]:access,phone:String(row.phone||'').trim(),designation:String(row.designation||'').trim(),reports_to:String(row.reports_to||'').trim(),start:row.start===true};
 });
}
function staffListExisting(name){const n=name.toLowerCase();return [...employeeDirectory.values()].some(e=>String(e.display_name||'').trim().toLowerCase()===n);}
function staffListOrder(rows){const rank={owner:0,head:1,staff:2};return [...rows].sort((a,b)=>rank[a.role]-rank[b.role]);}
function openStaffListImport(){
 if(me?.role!=='owner')throw Error('Only the owner can add employees from a list.');
 const actor=me,trigger=document.activeElement,dialog=document.createElement('dialog'),current=()=>me===actor&&me?.role==='owner'&&view==='staff'&&dialog.isConnected&&dialog.open;dialog.className='staff-onboarding staff-list-import';dialog.setAttribute('aria-label','Add employees from a list');
 dialog.innerHTML=`<form><h2>Add employees from a list</h2><p class="muted">Choose the staff list file. Tick who should get a login now; department heads are ticked already. People who already have a login are skipped.</p><label><span>Staff list file</span><input type="file" name="file" accept=".json,application/json" required></label><div data-preview></div><p role="alert"></p><div class="actions"><button type="button" data-close>Close</button><button type="submit" disabled>Create selected logins</button></div></form><section data-step="done" hidden></section>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]'),preview=form.querySelector('[data-preview]'),submit=form.querySelector('[type="submit"]');
 let rows=[],fileGeneration=0,confirming=false,working=false;
 const initial=workspaceFormSnapshot(form),requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>working||confirming||busy,isDirty:()=>!form.hidden&&(!!form.elements.file.files?.length||workspaceFormSnapshot(form)!==initial)});
 dialog.querySelector('[data-close]').onclick=requestClose;showWorkspaceDialog(dialog,{size:'large',trigger});
 form.elements.file.onchange=async()=>{
  if(form.elements.file.disabled)return;const generation=++fileGeneration,file=form.elements.file.files[0],readActor=me;rows=[];alert.textContent='';preview.innerHTML='';submit.disabled=true;
  const current=()=>me===readActor&&dialog.isConnected&&generation===fileGeneration&&form.elements.file.files[0]===file;
  if(busy){form.elements.file.value='';actionFeedbackRefuse(form.elements.file,alert);return;}
  return run(async()=>{
  try{const text=await file.text();if(!current())return;rows=staffListRows(text);}catch(error){if(current())alert.textContent=error.message;return;}
  preview.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Create</th><th>Name</th><th>Role</th><th>Department</th><th>Reports to</th><th>Can use</th></tr></thead><tbody>${rows.map((r,i)=>{const exists=staffListExisting(r.name);return `<tr><td>${exists?`<span class="muted chip chip--${statusTone('neutral')}">Has a login</span>`:`<input type="checkbox" data-row="${i}" ${r.start?'checked':''} aria-label="Create a login for ${esc(r.name)}">`}</td><td>${esc(r.name)}${r.designation?`<br><small class="muted">${esc(r.designation)}</small>`:''}</td><td>${esc(roleLabels[r.role])}</td><td>${esc(departmentLabel(r.department))}</td><td>${esc(r.reports_to||'—')}</td><td>${esc(accessSummary({role:r.role,access:r.access}))}</td></tr>`}).join('')}</tbody></table></div><p class="muted" data-count></p>`;
  const count=()=>{const n=preview.querySelectorAll('[data-row]:checked').length;preview.querySelector('[data-count]').textContent=`${n} selected`;submit.disabled=!n;};
  preview.querySelectorAll('[data-row]').forEach(box=>box.onchange=count);count();
  },{origin:form.elements.file,errorTarget:alert,busyLabel:'Reading staff list…'});
 };
 form.onsubmit=async event=>{
  event.preventDefault();if(submit.disabled||confirming||!current())return;if(busy){actionFeedbackRefuse(submit,alert);return;}
  const selected=[...preview.querySelectorAll('[data-row]:checked')],chosen=staffListOrder(selected.map(box=>rows[Number(box.dataset.row)])),generation=fileGeneration,file=form.elements.file.files[0];
  confirming=true;let accepted;try{accepted=await askConfirm({title:`Create ${chosen.length} logins?`,body:'Create the selected logins now, with department heads first. Temporary passwords will be shown once.',confirmLabel:'Create selected logins',tone:'normal'});}finally{confirming=false;}
  const selectedNow=[...preview.querySelectorAll('[data-row]:checked')];
  if(!accepted||!current()||generation!==fileGeneration||form.elements.file.files[0]!==file||selectedNow.length!==selected.length||selectedNow.some((box,index)=>box!==selected[index]))return;
  if(busy){actionFeedbackRefuse(submit,alert);return;}
  submit.disabled=true;form.elements.file.disabled=true;working=true;
  return run(async()=>{try{const results=[];
  for(const [i,r] of chosen.entries()){
   if(!current())return;
   alert.textContent=`Creating ${i+1} of ${chosen.length}: ${r.name}…`;
   try{const made=await staffAccountsCall({action:'create',full_name:r.name,phone:r.phone,role:r.role,department:r.department,access:r.access});if(!current())return;results.push({...r,employee_id:made.employee_id,password:made.temporary_password,warnings:(made.warnings||[]).join(' ')});}
   catch(error){if(!current())return;results.push({...r,error:error.message});}
  }
  await loadEmployeeNames();if(!current())return;
  const ok=results.filter(r=>!r.error),failed=results.filter(r=>r.error);
  form.hidden=true;const done=dialog.querySelector('[data-step="done"]');done.hidden=false;
  done.innerHTML=`<h2>${ok.length} logins created${failed.length?`, ${failed.length} not created`:''}</h2><p role="alert">Copy or save these now. The temporary passwords are shown only once. Each person chooses their own password at first sign-in.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Employee ID</th><th>Temporary password</th><th>Note</th></tr></thead><tbody>${results.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.employee_id||'—')}</td><td>${r.password?`<code>${esc(r.password)}</code>`:'—'}</td><td>${esc(r.error?`Not created: ${r.error}`:r.warnings||'')}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button type="button" data-copy>Copy all</button><button type="button" data-save>Save as file</button><button type="button" data-close>Done</button></div>`;
  const text=['Name\tEmployee ID\tTemporary password\tNote',...results.map(r=>[r.name,r.employee_id||'',r.password||'',r.error?'Not created: '+r.error:r.warnings||''].join('\t'))].join('\n');
  done.querySelector('[data-copy]').onclick=async event=>{try{await navigator.clipboard.writeText(text);event.target.textContent='Copied';}catch{event.target.textContent='Select the table and copy it';}};
  done.querySelector('[data-save]').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/tab-separated-values'}));a.download='anudha-new-logins.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  done.querySelector('[data-close]').onclick=requestClose;
  if(view==='staff')staff();
  }finally{working=false;}
  },{origin:submit,errorTarget:alert,busyLabel:'Creating logins…'});
 };
}
