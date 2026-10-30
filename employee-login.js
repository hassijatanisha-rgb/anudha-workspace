'use strict';
// Employee IDs are derived from names and sign in as <id>@<staffLoginDomain>; real emails keep working.
const employeeIdPattern=/^[a-z0-9]+(?:\.[a-z0-9]+)*$/;
function employeeLoginDomain(){return String(window.ERP_CONFIG?.staffLoginDomain||'staff.anudha.com').toLowerCase();}
function employeeLoginEmail(input){
 let value=String(input??'').trim().toLowerCase();
 if(value.includes('@'))return value;
 // "Tanisha Hassija" is accepted as tanisha.hassija.
 if(/\s/.test(value))value=value.split(/\s+/).map(employeeIdPart).filter(Boolean).join('.');
 if(value.length<2||value.length>40||!employeeIdPattern.test(value))throw Error('Enter your employee ID or your work email.');
 return `${value}@${employeeLoginDomain()}`;
}
function employeeIdPart(word){return String(word??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function employeeIdCandidates(fullName){
 const words=String(fullName??'').trim().split(/\s+/).map(employeeIdPart).filter(Boolean);
 if(!words.length)return [];
 const first=words[0].slice(0,30),last=words.length>1?words.at(-1).slice(0,30):'',base=last?[`${first}.${last}`,`${first}.${last[0]}`,first]:[first];
 for(let n=2;n<=99;n++)base.push(`${last?`${first}.${last}`:first}${n}`);
 return [...new Set(base)].filter(id=>id.length>=2&&id.length<=40&&employeeIdPattern.test(id));
}
function employeeTemporaryPassword(){
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789',limit=256-256%alphabet.length;let out='';
 while(out.length<14)for(const byte of crypto.getRandomValues(new Uint8Array(32)))if(byte<limit&&out.length<14)out+=alphabet[byte%alphabet.length];
 return out;
}
async function employeeIdTaken(id){
 const found=await client.rpc('lookup_staff_display_name',{p_email:`${id}@${employeeLoginDomain()}`});
 if(found.error)throw Error(`Could not check employee ID ${id}: ${found.error.message||'lookup failed'}`);
 const row=Array.isArray(found.data)?found.data[0]:found.data;
 return !!row?.user_id;
}
async function suggestEmployeeId(fullName){
 for(const id of employeeIdCandidates(fullName))if(!(await employeeIdTaken(id)))return id;
 throw Error('Enter the employee’s first and last name to create an ID.');
}
// Owner-only login management goes through the staff-accounts Edge Function: the browser never holds an admin key.
async function staffAccountsCall(body){
 const result=await client.functions.invoke('staff-accounts',{body});
 if(result.error){let detail=result.error.message;try{const payload=await result.error.context?.json?.();if(payload?.error)detail=payload.error;}catch{}throw Error(detail||'The request failed');}
 if(!result.data||result.data.error)throw Error(result.data?.error||'The server did not confirm the change');
 return result.data;
}
function staffPasswordNotice(name,id,password,warnings=[]){
 return `<h2>${esc(name)}</h2>${id?`<p>Employee ID: <strong data-employee-id>${esc(id)}</strong></p>`:''}<p>Temporary password: <code data-temporary-password>${esc(password)}</code> <button type="button" data-copy-password>Copy</button></p><p class="muted">Give this to ${esc(name)} in person or by phone. It is shown only now. At first sign-in they must choose their own password; you will not know it.</p>${warnings.length?`<p role="alert">${warnings.map(esc).join(' ')}</p>`:''}<div class="actions"><button type="button" data-close>Done</button></div>`;
}
function bindPasswordNotice(section,dialog,password,requestClose){
 section.querySelector('[data-close]').onclick=requestClose;
 section.querySelector('[data-copy-password]').onclick=async event=>{try{await navigator.clipboard.writeText(password);event.target.textContent='Copied';}catch{event.target.textContent='Select and copy it';}};
}
function openStaffOnboarding(){
 if(me?.role!=='owner'&&me?.role!=='head')throw Error('Only the owner or a department head can add employees.');
 const owner=me.role==='owner',actor=me,role0=me.role,openingView=view,trigger=document.activeElement,directory=document.querySelector('[data-staff-directory]'),directoryEpoch=directory?.staffEpoch,current=()=>me===actor&&me?.role===role0&&view===openingView&&dialog.isConnected;
 const dialog=document.createElement('dialog');dialog.className='staff-onboarding';dialog.setAttribute('aria-label','Add employee');
 dialog.innerHTML=`<form><h2>Add employee</h2><p class="muted">No email needed. The employee ID is made from the name, for example Tanisha Hassija → tanisha.hassija.</p><label><span>Full name</span><input name="fullName" required minlength="2" maxlength="120" autocomplete="off"></label><label><span>Phone · with country code, optional</span><input name="phone" inputmode="tel" maxlength="24" placeholder="+255712345678" autocomplete="off"></label>${owner?`<label><span>Role</span><select name="role"><option value="staff">Staff</option><option value="head">Department head — manages their department's staff</option><option value="owner">Owner — full access, can manage staff</option></select></label><label><span>Department</span><select name="department">${departmentLabels.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>`:`<p>Department: <strong>${esc(departmentLabel(me.department))}</strong></p>`}<div data-access>${accessCheckboxes(startingAccess(owner?'':me.department))}</div><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Create login</button></div></form><section data-step="done" hidden></section>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]'),done=dialog.querySelector('[data-step="done"]');
 // New accounts start with their department's usual areas; owners need no list.
 const refreshAccess=()=>{const role=form.elements.role?.value||'staff',box=form.querySelector('[data-access]');box.hidden=role==='owner';if(owner)box.innerHTML=accessCheckboxes(startingAccess(form.elements.department.value));};
 form.elements.department?.addEventListener('change',refreshAccess);form.elements.role?.addEventListener('change',refreshAccess);
 let working=false,refreshing=false;const initial=workspaceFormSnapshot(form),requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>working||refreshing,isDirty:()=>!form.hidden&&workspaceFormSnapshot(form)!==initial});
 dialog.querySelector('[data-close]').onclick=requestClose;showWorkspaceDialog(dialog,{size:'large',trigger});
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled||!current())return;
  const fullName=form.elements.fullName.value.trim().replace(/\s+/g,' '),phone=form.elements.phone.value.trim(),role=owner?form.elements.role.value:'staff',department=owner?form.elements.department.value:me.department,access=role==='owner'?[]:checkedAreas(form);
  if(owner&&role==='head'&&!department){alert.textContent='Choose the department this head will manage.';return;}
  if(phone&&!/^\+[0-9][0-9\s()-]{7,20}$/.test(phone)){alert.textContent='Enter the phone with country code, for example +255712345678, or leave it empty.';return;}
  if(busy){actionFeedbackRefuse(button,alert);return;}button.disabled=true;working=true;
  return run(async()=>{alert.textContent='';
  try{
   const created=await staffAccountsCall({action:'create',full_name:fullName,phone,role,department,access});if(!current())return;
   form.hidden=true;done.hidden=false;done.innerHTML=staffPasswordNotice(created.full_name,created.employee_id,created.temporary_password,created.warnings||[]);
   bindPasswordNotice(done,dialog,created.temporary_password,requestClose);
   if(view==='staff'&&directory?.isConnected&&directory.staffEpoch===directoryEpoch){
    const status=document.createElement('p');status.setAttribute('role','status');done.append(status);
    const refresh=async()=>{
     if(!current()||view!=='staff'||!directory.isConnected||directory.staffEpoch!==directoryEpoch||status.staffRefreshing)return;status.staffRefreshing=true;refreshing=true;
     done.querySelector('[data-created-staff-retry]')?.remove();status.textContent='Login created. Refreshing this employee…';
     try{
      if(typeof created.user_id!=='string'||!created.user_id)throw Error('The created account identity could not be verified.');
      const [staffResult,nameResult]=await Promise.all([client.from('staff').select('user_id,role,active,phone,department,access').eq('user_id',created.user_id).single(),client.rpc('lookup_staff_display_name',{p_email:`${created.employee_id}@${employeeLoginDomain()}`})]);
      if(!current()||view!=='staff'||!directory.isConnected||directory.staffEpoch!==directoryEpoch)return;
      if(staffResult.error)throw staffResult.error;if(nameResult.error)throw nameResult.error;
      const row=staffSavedRecord(staffResult.data,created.user_id),name=employeeNameReceipt(nameResult.data,{user_id:created.user_id,name_version:1,display_name:created.full_name});
      employeeNamesEpoch++;const previous=employeeDirectory.get(row.user_id);if(!previous||previous.name_version<=name.name_version)employeeDirectory.set(row.user_id,name);
      const at=directory.staffRows.findIndex(person=>person.user_id===row.user_id);if(at<0)directory.staffRows.push(row);else directory.staffRows[at]=row;
      directory.staffRefresh();status.textContent='Login created. Employee list updated.';
     }catch(error){
      if(!current()||view!=='staff'||!directory.isConnected||directory.staffEpoch!==directoryEpoch)return;
      status.textContent=`Login created. The employee list could not refresh: ${error.message||'Try again.'}`;
      const retry=document.createElement('button');retry.setAttribute('type','button');retry.setAttribute('data-created-staff-retry','');retry.textContent='Retry refresh';done.append(retry);retry.onclick=()=>run(refresh,{origin:retry,errorTarget:status,busyLabel:'Refreshing…'});
     }finally{status.staffRefreshing=false;refreshing=false;}
    };
    await refresh();
   }
  }catch(error){if(current()){alert.textContent=`Not created: ${error.message}`;button.disabled=false;}}
  finally{working=false;}
  },{origin:button,errorTarget:alert,busyLabel:'Creating login…'});
 };
}
function openStaffPasswordReset(userId,name){
 if(me?.role!=='owner'&&me?.role!=='head')throw Error('Only the owner or a department head can reset passwords.');
 const actor=me,role=me.role,openingView=view,trigger=document.activeElement,dialog=document.createElement('dialog'),current=()=>me===actor&&me?.role===role&&view===openingView&&dialog.isConnected;dialog.className='staff-onboarding';dialog.setAttribute('aria-label','Reset password');
 dialog.innerHTML=`<form><h2>Reset password for ${esc(name)}</h2><p>Their current password stops working now. You get a temporary password to give them, and they must choose a new one when they sign in.</p><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit" class="danger">Reset password</button></div></form><section data-step="done" hidden></section>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]'),done=dialog.querySelector('[data-step="done"]');
 let working=false;const requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>working,isDirty:()=>false});
 dialog.querySelector('[data-close]').onclick=requestClose;showWorkspaceDialog(dialog,{size:'small',trigger});
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled||!current())return;if(busy){actionFeedbackRefuse(button,alert);return;}button.disabled=true;working=true;
  return run(async()=>{alert.textContent='';
  try{const reset=await staffAccountsCall({action:'reset',user_id:userId});if(!current())return;form.hidden=true;done.hidden=false;done.innerHTML=staffPasswordNotice(name,'',reset.temporary_password,reset.warnings||[]);bindPasswordNotice(done,dialog,reset.temporary_password,requestClose);}
  catch(error){if(current()){alert.textContent=`Not reset: ${error.message}`;button.disabled=false;}}
  finally{working=false;}
  },{origin:button,errorTarget:alert,busyLabel:'Resetting password…'});
 };
}
function openStaffPhone(userId,name,phone){
 const context=staffSaveContext(userId);
 actionForm(`Phone for ${name}`,`<label><span>Phone with country code · leave empty to remove</span><input name="phone" inputmode="tel" maxlength="24" value="${esc(phone||'')}" placeholder="+255712345678"></label>`,async values=>{
  if(!context.current())return;
  let result;try{result=await client.rpc('set_staff_phone',{p_user_id:userId,p_phone:values.phone||''});}catch(error){if(context.current())throw error;return;}
  if(!context.current())return;if(result.error)throw Error(result.error.message);
  await refreshSavedStaff(userId,result.data,`Phone saved for ${name}.`,context,{phone:(values.phone||'').replace(/[\s()-]/g,'')});
 });
}
function staffSaveContext(id,directory=[...document.querySelectorAll('[data-staff-directory]')][0]){
 const actor=me,epoch=directory?.staffEpoch;
 return {actor,directory,current:()=>!!actor&&me===actor&&(typeof view==='undefined'||view==='staff')&&directory?.isConnected&&directory.staffEpoch===epoch&&!directory.staffUnverified?.has(id)};
}
function staffSavedRecord(data,id,expected={}){
 const row=Array.isArray(data)?data.length===1?data[0]:null:data;
 if(!row||row.user_id!==id||!Object.hasOwn(roleLabels,row.role)||typeof row.active!=='boolean'||typeof row.phone!=='string'||!/^(?:|\+[0-9]{8,15})$/.test(row.phone)||!departmentLabels.some(([key])=>key===row.department)||!Array.isArray(row.access)||row.access.some(key=>typeof key!=='string'||!accessAreas.some(([value])=>value===key)))throw Error('The saved staff record could not be verified.');
 for(const [key,value] of Object.entries(expected))if(key==='access'?JSON.stringify([...new Set(row.access)].sort())!==JSON.stringify([...new Set(value)].sort()):row[key]!==value)throw Error('The saved staff changes could not be verified.');
 return {user_id:row.user_id,role:row.role,active:row.active,phone:row.phone,department:row.department,access:[...row.access]};
}
function staffPatchRow(old,row){
 const open=[...old.querySelectorAll('details')].map(node=>node.open);
 // Keep status nodes and their action bindings on the same connected row.
 for(const selector of ['[data-staff-two-step-status]','[data-staff-accounting-status]']){const status=old.querySelector(selector),target=row.querySelector(selector);if(status&&target)target.replaceWith(status);}
 for(const selector of ['[data-two-step-reset]','[data-accounting]']){const button=old.querySelector(selector);if(button&&(selector==='[data-accounting]'||row.querySelector('[data-staff-reset]')))row.querySelector('.actions')?.append(button);}
 row.querySelectorAll('details').forEach((node,index)=>node.open=!!open[index]);
 old.dataset.staffState=row.dataset.staffState;old.staffRowHtml=row.staffRowHtml;old.replaceChildren(...row.children);
}
function staffReconcileDirectory(directory,rows,state){
 const results=directory.querySelector('[data-staff-results]'),template=document.createElement('template');template.innerHTML=staffDirectoryGroups(rows,state);
 const groups=new Map([...results.querySelectorAll('[data-staff-group]')].map(group=>[group.dataset.staffGroup,group]));let added=false,cursor=results.firstElementChild;
 for(const group of [...template.content.querySelectorAll('[data-staff-group]')]){
  const old=groups.get(group.dataset.staffGroup);
  if(old){
   old.querySelector('summary').textContent=group.querySelector('summary').textContent;old.open=group.open;
   const table=old.querySelector('[data-staff-table]'),fresh=group.querySelector('[data-staff-table]');
   if(table&&fresh){
    const body=table.querySelector('tbody'),newBody=fresh.querySelector('tbody');
    if(body&&newBody){
     const existing=new Map([...body.querySelectorAll('[data-staff-row]')].map(row=>[row.dataset.staffRow,row]));let rowCursor=body.firstElementChild;
     for(const row of [...newBody.querySelectorAll('[data-staff-row]')]){
      row.staffRowHtml=row.outerHTML;const retained=existing.get(row.dataset.staffRow),next=retained||row;
      if(retained&&retained.staffRowHtml!==row.staffRowHtml)staffPatchRow(retained,row);if(!retained)added=true;
      if(next===rowCursor)rowCursor=rowCursor.nextElementSibling;else body.insertBefore(next,rowCursor);existing.delete(row.dataset.staffRow);
     }
     for(const row of existing.values())row.remove();
    }else{table.replaceChildren(...fresh.children);if(newBody)added=true;}
    for(const direction of ['previous','next'])old.querySelector(`[data-staff-page="${direction}"]`).disabled=group.querySelector(`[data-staff-page="${direction}"]`).disabled;
    old.querySelector('[data-staff-page-status]').textContent=group.querySelector('[data-staff-page-status]').textContent;
   }else{
    const summary=old.querySelector('summary');for(const child of [...old.children])if(child!==summary)child.remove();for(const child of [...group.children])if(child.tagName!=='SUMMARY'&&child!==group.querySelector('summary'))old.append(child);if(fresh)added=true;
   }
   if(old===cursor)cursor=cursor.nextElementSibling;else results.insertBefore(old,cursor);groups.delete(group.dataset.staffGroup);
  }else{results.insertBefore(group,cursor);if(group.querySelector('[data-staff-row]'))added=true;}
 }
 for(const group of groups.values())group.remove();
 results.querySelector('[data-staff-empty]')?.remove();const empty=template.content.querySelector('[data-staff-empty]');if(empty)results.insertBefore(empty,results.firstElementChild);
 results.querySelectorAll('[data-staff-row]').forEach(row=>{if(!row.staffRowHtml)row.staffRowHtml=row.outerHTML});
 const active=rows.filter(row=>row.active).length,filter=directory.querySelector('[data-staff-filter]');for(const [value,label,count] of [['active','Active',active],['all','All staff',rows.length],['inactive','Switched off',rows.length-active]])filter.querySelector(`[value="${value}"]`).textContent=`${label} (${count})`;
 directory.querySelector('[data-staff-count]').textContent=`${staffDirectoryPage(rows,state).filtered.length} matching · ${rows.length} total employees`;
 directory.staffBindGroups();bindStaffActions(rows);staffRefreshNotices(directory);
 if(added){if(typeof decorateStaffTwoStep==='function')decorateStaffTwoStep().catch(()=>{});if(typeof decorateStaffAccounting==='function')decorateStaffAccounting().catch(()=>{});}
}
function staffRefreshNotices(directory){
 const notice=directory.querySelector('[data-staff-save-notice]');notice.replaceChildren();
 for(const [id,item] of directory.staffSaveNotices){
  const box=document.createElement('div');box.innerHTML=`<p role="${item.error?'alert':'status'}">${esc(item.text)}</p>${item.retry?`<button type="button" data-staff-retry="${esc(id)}">Retry refresh</button>`:''}`;notice.append(box);
  if(item.retry){const retry=box.querySelector('button');retry.onclick=()=>run(item.retry,{origin:retry,errorTarget:box.querySelector('p'),busyLabel:'Refreshing…'});}
 }
 for(const row of directory.querySelectorAll('[data-staff-row]')){const locked=directory.staffUnverified.has(row.dataset.staffRow);if(locked||row.staffRefreshLocked)row.querySelectorAll('button,input,select,textarea').forEach(node=>node.disabled=locked);row.staffRefreshLocked=locked;}
}
async function refreshSavedStaff(id,receipt,text,context,expected={}){
 if(!context.current())return;
 const directory=context.directory,actor=context.actor,epoch=directory.staffEpoch;let request=(directory.staffReadRequests.get(id)||0)+1;directory.staffReadRequests.set(id,request);const current=()=>directory.staffReadRequests.get(id)===request&&me===actor&&(typeof view==='undefined'||view==='staff')&&directory.isConnected&&directory.staffEpoch===epoch;
 const rows=directory.staffRows,state=directory.staffState;
 const apply=row=>{const index=rows.findIndex(person=>person.user_id===id);if(index<0)throw Error('This employee is no longer in this directory.');rows[index]=row;directory.staffUnverified.delete(id);staffReconcileDirectory(directory,rows,state);};
 const focus=(active,scroll)=>{
  if(!current())return;
  if(active?.isConnected&&!active.disabled&&!active.closest('dialog'))active.focus({preventScroll:true});
  else if(!document.activeElement?.closest('dialog[open]')){
   const attributes=Object.entries(active?.dataset||{}),match=[...directory.querySelectorAll('button,input,select,textarea')].find(node=>!node.disabled&&attributes.length&&attributes.every(([key,value])=>node.dataset[key]===value));
   (match||directory.querySelector('[data-staff-page-status]')||directory.querySelector('[data-staff-count]'))?.focus({preventScroll:true});
  }
  if(scroll)window.scrollTo(scroll);
 };
 const active=document.activeElement,scroll=typeof window!=='undefined'?{left:window.scrollX,top:window.scrollY}:null;
 for(const [key,item] of directory.staffSaveNotices)if(key!==id&&!item.error)directory.staffSaveNotices.delete(key);
 directory.staffSaveNotices.set(id,{text:`${text} Refreshing employee details…`});
 let saved;try{saved=staffSavedRecord(receipt,id,expected);}catch{directory.staffUnverified.add(id);}
 if(saved)apply(saved);else staffRefreshNotices(directory);
 focus(active,scroll);
 const refresh=async()=>{
  if(!current())return;request++;directory.staffReadRequests.set(id,request);const active=document.activeElement,scroll=typeof window!=='undefined'?{left:window.scrollX,top:window.scrollY}:null;
  directory.staffSaveNotices.set(id,{text:`${text} Refreshing employee details…`});staffRefreshNotices(directory);
  try{
   const result=await client.from('staff').select('user_id,role,active,phone,department,access').eq('user_id',id).single();if(!current())return;if(result.error)throw Error(result.error.message);
   const row=staffSavedRecord(result.data,id);directory.staffSaveNotices.set(id,{text});apply(row);focus(active,scroll);
  }catch(error){
   if(!current())return;directory.staffSaveNotices.set(id,{text:`${text} Employee details could not refresh: ${error.message}. ${directory.staffUnverified.has(id)?'Refresh before making another change.':'The confirmed saved details remain visible.'}`,error:true,retry:refresh});staffRefreshNotices(directory);focus(active,scroll);
  }
 };
 await refresh();
}
function staffSearchValue(person){return employeeName(person.user_id).toLocaleLowerCase();}
async function saveStaffMembership(form){
 const directory=document.querySelector('[data-staff-directory]'),actor=me,epoch=directory?.staffEpoch;
 const current=()=>me===actor&&view==='staff'&&form.isConnected&&directory?.isConnected&&directory.staffEpoch===epoch;
 if(actor?.role!=='owner'||!current()||form.staffSavePending)return;
 const fields=new FormData(form),email=String(fields.get('email')||'').trim(),submit=form.querySelector('[type="submit"]');
 const controls=[...form.querySelectorAll('input,select,button')],states=controls.map(node=>node.disabled);form.staffSavePending=true;
 controls.forEach(node=>node.disabled=true);
 let notice=form.querySelector('[data-staff-membership-status]');if(!notice){notice=document.createElement('p');notice.setAttribute('data-staff-membership-status','');notice.setAttribute('role','status');form.append(notice);}notice.textContent='Saving staff membership…';
 const unlock=()=>{controls.forEach((node,index)=>node.disabled=states[index]);submit.disabled=false;submit.hidden=false;form.staffSavePending=false;};
 try{
  const result=await client.rpc('manage_staff_email',{p_email:email,p_role:fields.get('role'),p_active:fields.get('active')==='true'});
  if(!current())return;if(result.error)throw result.error;
 }catch(error){if(!current())return;unlock();notice.setAttribute('role','alert');notice.textContent=error.message||'Staff membership could not be saved.';throw error;}
 // The legacy writer has no guaranteed record receipt. Never replay it to recover a failed read.
 submit.hidden=true;
 const refresh=async()=>{
  if(!current())return;
  notice.textContent='Staff membership saved. Refreshing this employee…';notice.setAttribute('role','status');form.querySelector('[data-staff-membership-retry]')?.remove();
  try{
   const lookup=await client.rpc('lookup_staff_display_name',{p_email:email});if(!current())return;if(lookup.error)throw lookup.error;
   const name=Array.isArray(lookup.data)&&lookup.data.length===1?lookup.data[0]:lookup.data;if(!name?.user_id)throw Error('The saved account could not be identified.');
   const result=await client.from('staff').select('user_id,role,active,phone,department,access').eq('user_id',name.user_id).single();if(!current())return;if(result.error)throw result.error;
   const row=staffSavedRecord(result.data,name.user_id),index=directory.staffRows.findIndex(person=>person.user_id===row.user_id);
   if(index<0)directory.staffRows.push(row);else directory.staffRows[index]=row;
   if(typeof name.display_name==='string'&&Number.isSafeInteger(name.name_version)){employeeNamesEpoch++;employeeDirectory.set(row.user_id,name);}
   directory.staffRefresh();notice.textContent='Staff membership saved.';unlock();
  }catch(error){
   if(!current())return;notice.setAttribute('role','alert');notice.textContent=`Staff membership saved. Employee details could not refresh: ${error.message||'Try again.'}`;
   const retry=document.createElement('button');retry.type='button';retry.setAttribute('data-staff-membership-retry','');retry.textContent='Retry refresh';retry.onclick=()=>{if(!current()||retry.disabled)return;if(busy){actionFeedbackRefuse(retry,notice);return;}retry.disabled=true;return run(refresh,{origin:retry,errorTarget:notice,busyLabel:'Refreshing…'});};form.append(retry);
  }
 };
 await refresh();
}
const staffDirectoryPageSize=6;
function staffDirectoryPage(rows,state){
 const terms=state.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const filtered=rows.filter(row=>(state.filter==='all'||Boolean(row.active)===(state.filter==='active'))&&terms.every(term=>staffSearchValue(row).includes(term)));
 const departments=[...new Set(rows.map(row=>row.department||''))].sort((a,b)=>Number(b===(me?.department||''))-Number(a===(me?.department||''))||departmentLabel(a).localeCompare(departmentLabel(b)));
 if(state.search&&!filtered.some(row=>(row.department||'')===state.department))state.department=departments.find(department=>filtered.some(row=>(row.department||'')===department))??state.department;
 const current=filtered.filter(row=>(row.department||'')===state.department).sort((a,b)=>Number(b.active)-Number(a.active)||employeeName(a.user_id).localeCompare(employeeName(b.user_id))||String(a.user_id).localeCompare(String(b.user_id)));
 const pages=Math.max(1,Math.ceil(current.length/staffDirectoryPageSize));state.page=Math.max(0,Math.min(state.page,pages-1));
 return {departments,filtered,total:current.length,pages,visible:current.slice(state.page*staffDirectoryPageSize,(state.page+1)*staffDirectoryPageSize)};
}
function staffDirectoryRows(rows){
 const owner=me?.role==='owner';
 return `<div class="table-wrap"><table class="staff-directory-table" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Employee</th><th role="columnheader" scope="col">Department</th><th role="columnheader" scope="col">Role</th><th role="columnheader" scope="col">Two-step</th><th role="columnheader" scope="col">Account</th></tr></thead><tbody role="rowgroup">${rows.map(x=>{
  const self=x.user_id===me?.user_id,manage=canManagePerson(x)&&!self,id=esc(x.user_id),name=esc(employeeName(x.user_id));
  const areas=accessAreas.filter(([key])=>x.role==='owner'||(x.access||[]).includes(key));
  const role=owner&&!self?`<label>Role<select data-staff-role="${id}" aria-label="Role for ${name}">${Object.entries(roleLabels).map(([v,l])=>`<option value="${v}" ${x.role===v?'selected':''}>${l}</option>`).join('')}</select></label>`:'';
  const dept=owner?`<label>Department<select data-staff-department="${id}" aria-label="Department for ${name}" aria-describedby="staff-department-status-${id}">${departmentLabels.map(([v,l])=>`<option value="${v}" ${(x.department||'')===v?'selected':''}>${l}</option>`).join('')}</select><span class="staff-field-status" data-staff-department-status id="staff-department-status-${id}"></span></label>`:'';
  const access=`<details class="staff-area-details"><summary aria-label="Workflow areas for ${name}: ${areas.length}">${areas.length?`${areas.length} workflow ${areas.length===1?'area':'areas'}`:'No workflow areas'}</summary>${areas.length?`<ul>${areas.map(([,label])=>`<li>${esc(label)}</li>`).join('')}</ul>`:'<p>No workflow areas assigned.</p>'}${manage&&x.role!=='owner'?`<button type="button" data-staff-access="${id}" aria-label="Change access for ${name}">Change access</button>`:''}</details>`;
  const login=`<span class="staff-login-state${x.active?'':' is-off'} chip chip--${statusTone(x.active?'success':'inactive')}">${x.active?'Active':'Switched off'}</span>`;
  const phone=manage?`<button type="button" data-staff-phone="${id}" data-phone="${esc(x.phone||'')}" aria-label="Edit phone for ${name}">Edit phone</button>`:'';
  const accountActions=self?'<span class="muted">You · use Change password</span>':manage?`<button type="button" class="danger" data-staff-reset="${id}" aria-label="Reset password for ${name}">Reset password</button>${x.role!=='owner'?`<button type="button" data-staff-active="${id}" data-active="${x.active?'false':'true'}" aria-label="${x.active?'Switch off':'Switch on'} login for ${name}">${x.active?'Switch off login':'Switch on login'}</button>`:''}`:'';
  const account=`<details class="staff-account-details"><summary><span>${manage||self||owner?'Manage account':'Account details'}</span>${owner?'<span class="staff-account-status" data-staff-accounting-status>Accounting: checking…</span>':''}</summary><p class="staff-phone-value">${esc(x.phone||'No phone added')}</p>${role}${dept}${access}<div class="actions">${phone}${accountActions}</div></details>`;
  return `<tr data-staff-row="${id}" role="row" data-staff-state="${x.active?'active':'inactive'}"><th role="rowheader" scope="row" class="staff-identity"><span class="staff-cell-label" aria-hidden="true">Employee</span><strong>${name}${self?' <span class="staff-self">You</span>':''}</strong>${login}</th><td role="cell" class="staff-department-cell"><span class="staff-cell-label" aria-hidden="true">Department</span>${esc(x.department?departmentLabel(x.department):'No department')}</td><td role="cell" class="staff-role-cell"><span class="staff-cell-label" aria-hidden="true">Role</span>${esc(roleLabels[x.role]||x.role)}</td><td role="cell"><span class="staff-cell-label" aria-hidden="true">Two-step</span><span data-staff-two-step-status>Two-step: checking…</span></td><td role="cell" class="staff-actions-cell"><span class="staff-cell-label" aria-hidden="true">Account</span>${account}</td></tr>`;
 }).join('')}</tbody></table></div>`;
}
function staffDirectoryGroups(rows,state){
 const result=staffDirectoryPage(rows,state);
 return `${result.filtered.length?'':'<p data-staff-empty role="status">No employees match this search. Try another name or choose All staff.</p>'}${result.departments.map(department=>{
  const count=result.filtered.filter(row=>(row.department||'')===department).length,open=department===state.department;
  return `<details class="staff-department-group" data-staff-group="${esc(department)}"${open?' open':''}><summary>${esc(department?departmentLabel(department):'No department')} · ${count}</summary>${open?`<div data-staff-table>${result.visible.length?staffDirectoryRows(result.visible):'<p>No employees match in this department.</p>'}</div><div class="actions" role="group" aria-label="Staff pages"><button type="button" data-staff-page="previous" ${state.page===0?'disabled':''}>Previous</button><span data-staff-page-status role="status" tabindex="-1">Page ${state.page+1} of ${result.pages} · ${result.total} employees</span><button type="button" data-staff-page="next" ${state.page+1>=result.pages?'disabled':''}>Next</button></div>`:''}</details>`;
 }).join('')}`;
}
function staffListHtml(rows){
 if(!rows.length)return '<p class="muted">Nobody here yet.</p>';
 const active=rows.filter(x=>x.active).length,state={search:'',filter:'active',department:me?.department||'',page:0};
 return `<div class="staff-directory" data-staff-directory><div class="staff-directory-tools"><label><span>Find an employee</span><input type="search" data-staff-search placeholder="Search by name" autocomplete="off"></label><label><span>Show</span><select data-staff-filter><option value="active">Active (${active})</option><option value="all">All staff (${rows.length})</option><option value="inactive">Switched off (${rows.length-active})</option></select></label></div><p class="staff-directory-count" data-staff-count role="status" tabindex="-1">${active} active · ${rows.length} total employees</p><p class="staff-directory-help">Open a department to see up to ${staffDirectoryPageSize} people at a time. ${me?.role==='owner'?'Department changes save automatically. Wait for the saved confirmation.':'Open account details to see workflow access.'}</p><div data-staff-save-notice></div><div data-staff-results>${staffDirectoryGroups(rows,state)}</div></div>`;
}
function bindStaffList(rows=[]){
 document.querySelectorAll('[data-staff-directory]').forEach(directory=>{
  const actor=me,search=directory.querySelector('[data-staff-search]'),filter=directory.querySelector('[data-staff-filter]'),results=directory.querySelector('[data-staff-results]');
  const state={search:search.value,filter:filter.value,department:me?.department||'',page:0};
  directory.staffEpoch=(directory.staffEpoch||0)+1;directory.staffRows=rows;directory.staffState=state;directory.staffUnverified=new Set();directory.staffSaveNotices=new Map();directory.staffReadRequests=new Map();
  const update=(focus=null)=>{
   if(me!==actor||!directory.isConnected)return;
   results.innerHTML=staffDirectoryGroups(rows,state);
   const matching=staffDirectoryPage(rows,state).filtered.length;
   directory.querySelector('[data-staff-count]').textContent=`${matching} matching · ${rows.length} total employees`;
   results.querySelectorAll('[data-staff-row]').forEach(row=>row.staffRowHtml=row.outerHTML);
   bindGroups();bindStaffActions(rows);staffRefreshNotices(directory);
   if(typeof decorateStaffTwoStep==='function')decorateStaffTwoStep().catch(()=>{});
   if(typeof decorateStaffAccounting==='function')decorateStaffAccounting().catch(()=>{});
   if(focus){const target=results.querySelector(focus);(target&&!target.disabled?target:results.querySelector('[data-staff-group][open] > summary'))?.focus({preventScroll:true});}
  };
  const bindGroups=()=>{
   results.querySelectorAll('[data-staff-group]').forEach(group=>group.ontoggle=()=>{
    if(!group.isConnected||!group.open||group.dataset.staffGroup===state.department)return;
    state.department=group.dataset.staffGroup;state.page=0;update('[data-staff-group][open] > summary');
   });
   results.querySelectorAll('[data-staff-page]').forEach(button=>button.onclick=()=>{
    state.page+=button.dataset.staffPage==='next'?1:-1;update(`[data-staff-page="${button.dataset.staffPage}"]`);
   });
  };
  search.oninput=()=>{state.search=search.value;state.page=0;update();};
  filter.onchange=()=>{state.filter=filter.value;state.page=0;update();};
  directory.staffBindGroups=bindGroups;directory.staffRefresh=()=>staffReconcileDirectory(directory,rows,state);results.querySelectorAll('[data-staff-row]').forEach(row=>row.staffRowHtml=row.outerHTML);bindGroups();
 });
 bindStaffActions(rows);
}
function bindStaffActions(rows=[]){
 const row=id=>rows.find(r=>r.user_id===id),saved=(id,receipt,text,context,expected)=>refreshSavedStaff(id,receipt,text,context,expected);
 document.querySelectorAll('[data-staff-reset]').forEach(button=>button.onclick=()=>run(async()=>openStaffPasswordReset(button.dataset.staffReset,employeeName(button.dataset.staffReset))));
 document.querySelectorAll('[data-staff-department]').forEach(select=>select.onchange=()=>{
  const person=row(select.dataset.staffDepartment),status=select.parentElement.querySelector('[data-staff-department-status]');
  const state=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  if(busy){select.value=person.department||'';state('Not saved. Try again when the current change finishes.',true);message(`Department not saved for ${employeeName(person.user_id)}. Another change is still saving. Please try again.`,true);return;}
  const department=select.value,context=staffSaveContext(person.user_id,select.closest('[data-staff-directory]')),current=context.current;if(!current())return;
  select.disabled=true;state('Saving…');
  return run(async()=>{
   try{
    const r=await client.rpc('set_staff_department',{p_user_id:person.user_id,p_department:department});
    if(!current())return;if(r.error)throw Error(r.error.message);
    await saved(person.user_id,r.data,`Department saved for ${employeeName(person.user_id)}.`,context,{department});
   }catch(error){if(!current())return;select.value=row(person.user_id)?.department||'';state(error.message||'Not saved. Please try again.',true);throw error;}
   finally{if(current()&&select.isConnected)select.disabled=false;}
  });
 });
 document.querySelectorAll('[data-staff-phone]').forEach(button=>button.onclick=()=>openStaffPhone(button.dataset.staffPhone,employeeName(button.dataset.staffPhone),button.dataset.phone));
 document.querySelectorAll('[data-staff-access]').forEach(button=>button.onclick=()=>run(async()=>openStaffAccess(row(button.dataset.staffAccess),saved)));
 document.querySelectorAll('[data-staff-active]').forEach(button=>button.onclick=()=>run(()=>setStaffActive(row(button.dataset.staffActive),button.dataset.active==='true',saved)));
 document.querySelectorAll('[data-staff-role]').forEach(select=>select.onchange=()=>run(()=>setStaffRole(row(select.dataset.staffRole),select.value,saved).catch(error=>{if(select.isConnected)select.value=row(select.dataset.staffRole)?.role||'staff';throw error;})));
}
// required: first sign-in with a temporary password; the dialog cannot be dismissed until a new password is saved.
function requirePasswordChange(user){if(!user?.app_metadata?.must_change_password&&!user?.user_metadata?.must_change_password)return false;if(!document.querySelector('dialog.change-password')){clear();me={user_id:user.id};$('#content').innerHTML='<section class="card"><h1>Choose your own password</h1><p>Complete password replacement to open your workspace.</p></section>';openChangePassword({required:true});}return true;}
function openChangePassword({required=false}={}){
 if(!me?.user_id)throw Error('Sign in first.');
 const actor=me,openingView=view,trigger=document.activeElement,dialog=document.createElement('dialog'),scopeCurrent=()=>me===actor&&view===openingView,current=()=>scopeCurrent()&&dialog.isConnected;dialog.className='change-password';dialog.setAttribute('aria-label','Change my password');
 dialog.innerHTML=`<form><h2>${required?'Choose your own password':'Change my password'}</h2>${required?'<p>You signed in with a temporary password. Choose a password only you know before continuing.</p>':''}<label><span>New password (at least 8 characters)</span><input name="password" type="password" minlength="8" maxlength="72" required autocomplete="new-password"></label><label><span>Type it again</span><input name="confirm" type="password" minlength="8" maxlength="72" required autocomplete="new-password"></label><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Save new password</button></div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]');
 let working=false;const requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>required||working,isDirty:()=>!!form.elements.password.value||!!form.elements.confirm.value});
 dialog.querySelector('[data-close]').hidden=required;dialog.querySelector('[data-close]').onclick=requestClose;showWorkspaceDialog(dialog,{size:'small',trigger});
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled||!current())return;
  const password=form.elements.password.value,confirm=form.elements.confirm.value;
  if(password.length<8)return alert.textContent='Use at least 8 characters.';
  if(password!==confirm)return alert.textContent='The two passwords do not match.';
  if(busy){actionFeedbackRefuse(button,alert);return;}button.disabled=true;working=true;
  return run(async()=>{alert.textContent='';
  try{
   const result=await client.auth.updateUser({password,data:{must_change_password:false}});
   if(!current())return;
   if(result.error)throw result.error;
   form.reset();if(required){if(!await closeWorkspaceDialog(dialog)||!scopeCurrent())return;await load();message('Password saved. Use it from now on.');return;}alert.textContent='Password changed. Use it next time you sign in.';
  }catch(error){if(current())alert.textContent=`Not changed: ${error.message}`;}
  finally{working=false;if(me===actor)button.disabled=false;}
  },{origin:button,errorTarget:alert,busyLabel:'Saving password…'});
 };
}
