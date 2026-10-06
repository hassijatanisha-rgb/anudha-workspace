'use strict';
// Employee IDs are derived from names and sign in as <id>@<staffLoginDomain>; real emails keep working.
const employeeIdPattern=/^[a-z0-9]+(?:\.[a-z0-9]+)*$/;
function employeeLoginDomain(){return String(window.ERP_CONFIG?.staffLoginDomain||'staff.anudha.com').toLowerCase();}
function employeeLoginEmail(input){
 let value=String(input??'').trim().toLowerCase();
 if(value.includes('@'))return value;
 // "Tanisha Hassija" is accepted as tanisha.hassija.
 if(/\s/.test(value))value=value.split(/\s+/).map(employeeIdPart).filter(Boolean).join('.');
 if(value.length<2||value.length>40||!employeeIdPattern.test(value))throw Error('Enter your employee ID (for example jagroop) or your work email.');
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
function bindPasswordNotice(section,dialog,password){
 section.querySelector('[data-close]').onclick=()=>dialog.close();
 section.querySelector('[data-copy-password]').onclick=async event=>{try{await navigator.clipboard.writeText(password);event.target.textContent='Copied';}catch{event.target.textContent='Select and copy it';}};
}
function openStaffOnboarding(){
 if(me?.role!=='owner'&&me?.role!=='head')throw Error('Only the owner or a department head can add employees.');
 const owner=me.role==='owner',actor=me.user_id,role0=me.role,current=()=>me?.user_id===actor&&me?.role===role0&&dialog.isConnected;
 const dialog=document.createElement('dialog');dialog.className='staff-onboarding';dialog.setAttribute('aria-label','Add employee');
 dialog.innerHTML=`<form><h2>Add employee</h2><p class="muted">No email needed. The employee ID is made from the name, for example Tanisha Hassija → tanisha.hassija.</p><label><span>Full name</span><input name="fullName" required minlength="2" maxlength="120" autocomplete="off"></label><label><span>Phone · with country code, optional</span><input name="phone" inputmode="tel" maxlength="24" placeholder="+255712345678" autocomplete="off"></label>${owner?`<label><span>Role</span><select name="role"><option value="staff">Staff</option><option value="head">Department head — manages their department's staff</option><option value="owner">Owner — full access, can manage staff</option></select></label><label><span>Department</span><select name="department">${departmentLabels.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>`:`<p>Department: <strong>${esc(departmentLabel(me.department))}</strong></p>`}<div data-access>${accessCheckboxes(startingAccess(owner?'':me.department))}</div><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Create login</button></div></form><section data-step="done" hidden></section>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.showModal();
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]'),done=dialog.querySelector('[data-step="done"]');
 // New accounts start with their department's usual areas; owners need no list.
 const refreshAccess=()=>{const role=form.elements.role?.value||'staff',box=form.querySelector('[data-access]');box.hidden=role==='owner';if(owner)box.innerHTML=accessCheckboxes(startingAccess(form.elements.department.value));};
 form.elements.department?.addEventListener('change',refreshAccess);form.elements.role?.addEventListener('change',refreshAccess);
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;
  const fullName=form.elements.fullName.value.trim().replace(/\s+/g,' '),phone=form.elements.phone.value.trim(),role=owner?form.elements.role.value:'staff',department=owner?form.elements.department.value:me.department,access=role==='owner'?[]:checkedAreas(form);
  if(owner&&role==='head'&&!department){alert.textContent='Choose the department this head will manage.';return;}
  if(phone&&!/^\+[0-9][0-9\s()-]{7,20}$/.test(phone)){alert.textContent='Enter the phone with country code, for example +255712345678, or leave it empty.';return;}
  button.disabled=true;alert.textContent='Creating the login…';
  try{
   const created=await staffAccountsCall({action:'create',full_name:fullName,phone,role,department,access});if(!current())return;
   form.hidden=true;done.hidden=false;done.innerHTML=staffPasswordNotice(created.full_name,created.employee_id,created.temporary_password,created.warnings||[]);
   bindPasswordNotice(done,dialog,created.temporary_password);
   await loadEmployeeNames();if(view==='staff')await staff();
  }catch(error){if(current()){alert.textContent=`Not created: ${error.message}`;button.disabled=false;}}
 };
}
function openStaffPasswordReset(userId,name){
 if(me?.role!=='owner'&&me?.role!=='head')throw Error('Only the owner or a department head can reset passwords.');
 const dialog=document.createElement('dialog');dialog.className='staff-onboarding';dialog.setAttribute('aria-label','Reset password');
 dialog.innerHTML=`<form><h2>Reset password for ${esc(name)}</h2><p>Their current password stops working now. You get a temporary password to give them, and they must choose a new one when they sign in.</p><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit" class="danger">Reset password</button></div></form><section data-step="done" hidden></section>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.showModal();
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]'),done=dialog.querySelector('[data-step="done"]');
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;alert.textContent='Resetting…';
  try{const reset=await staffAccountsCall({action:'reset',user_id:userId});if(!dialog.isConnected)return;form.hidden=true;done.hidden=false;done.innerHTML=staffPasswordNotice(name,'',reset.temporary_password,reset.warnings||[]);bindPasswordNotice(done,dialog,reset.temporary_password);}
  catch(error){if(dialog.isConnected){alert.textContent=`Not reset: ${error.message}`;button.disabled=false;}}
 };
}
function openStaffPhone(userId,name,phone){
 actionForm(`Phone for ${name}`,`<label><span>Phone with country code · leave empty to remove</span><input name="phone" inputmode="tel" maxlength="24" value="${esc(phone||'')}" placeholder="+255712345678"></label>`,async values=>{
  const result=await client.rpc('set_staff_phone',{p_user_id:userId,p_phone:values.phone||''});if(result.error)throw Error(result.error.message);
  if(view==='staff')await staff();message(`Phone saved for ${name}.`);
 });
}
function staffListHtml(rows){
 const owner=me?.role==='owner',sorted=[...rows].sort((a,b)=>Number(b.active)-Number(a.active)||employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 if(!sorted.length)return '<p class="muted">Nobody here yet.</p>';
 return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Role</th><th>Department</th><th>Can use</th><th>Phone</th><th>Login</th><th></th></tr></thead><tbody>${sorted.map(x=>{
  const self=x.user_id===me?.user_id,manage=canManagePerson(x)&&!self,id=esc(x.user_id),name=esc(employeeName(x.user_id));
  const role=owner&&!self?`<select data-staff-role="${id}" aria-label="Role for ${name}">${Object.entries(roleLabels).map(([v,l])=>`<option value="${v}" ${x.role===v?'selected':''}>${l}</option>`).join('')}</select>`:esc(roleLabels[x.role]||x.role);
  const dept=owner?`<select data-staff-department="${id}" aria-label="Department for ${name}">${departmentLabels.map(([v,l])=>`<option value="${v}" ${(x.department||'')===v?'selected':''}>${l}</option>`).join('')}</select>`:esc(departmentLabel(x.department));
  const access=`${esc(accessSummary(x))}${manage&&x.role!=='owner'?` <button type="button" data-staff-access="${id}">Change access</button>`:''}`;
  const login=`${x.active?'Active':'Switched off'}${manage&&x.role!=='owner'?` <button type="button" data-staff-active="${id}" data-active="${x.active?'false':'true'}">${x.active?'Switch off':'Switch on'}</button>`:''}`;
  const actions=self?'<span class="muted">You · use Change password</span>':manage?`<button type="button" data-staff-reset="${id}">Reset password</button><button type="button" data-staff-phone="${id}" data-phone="${esc(x.phone||'')}">Phone</button>`:'';
  return `<tr><td>${name}</td><td>${role}</td><td>${dept}</td><td>${access}</td><td>${esc(x.phone||'—')}</td><td>${login}</td><td><div class="actions">${actions}</div></td></tr>`;}).join('')}</tbody></table></div>`;
}
function bindStaffList(rows=[]){
 const row=id=>rows.find(r=>r.user_id===id),reload=()=>staff();
 document.querySelectorAll('[data-staff-reset]').forEach(button=>button.onclick=()=>run(async()=>openStaffPasswordReset(button.dataset.staffReset,employeeName(button.dataset.staffReset))));
 document.querySelectorAll('[data-staff-department]').forEach(select=>select.onchange=()=>run(async()=>{const r=await client.rpc('set_staff_department',{p_user_id:select.dataset.staffDepartment,p_department:select.value});if(r.error)throw Error(r.error.message);message(`Department saved for ${employeeName(select.dataset.staffDepartment)}.`);}));
 document.querySelectorAll('[data-staff-phone]').forEach(button=>button.onclick=()=>openStaffPhone(button.dataset.staffPhone,employeeName(button.dataset.staffPhone),button.dataset.phone));
 document.querySelectorAll('[data-staff-access]').forEach(button=>button.onclick=()=>run(async()=>openStaffAccess(row(button.dataset.staffAccess),reload)));
 document.querySelectorAll('[data-staff-active]').forEach(button=>button.onclick=()=>run(()=>setStaffActive(row(button.dataset.staffActive),button.dataset.active==='true',reload)));
 document.querySelectorAll('[data-staff-role]').forEach(select=>select.onchange=()=>run(()=>setStaffRole(row(select.dataset.staffRole),select.value,reload).catch(error=>{select.value=row(select.dataset.staffRole)?.role||'staff';throw error;})));
}
// required: first sign-in with a temporary password; the dialog cannot be dismissed until a new password is saved.
function requirePasswordChange(user){if(user?.user_metadata?.must_change_password&&!document.querySelector('dialog.change-password'))openChangePassword({required:true});}
function openChangePassword({required=false}={}){
 if(!me?.user_id)throw Error('Sign in first.');
 const actor=me.user_id,dialog=document.createElement('dialog');dialog.className='change-password';dialog.setAttribute('aria-label','Change my password');
 dialog.innerHTML=`<form><h2>${required?'Choose your own password':'Change my password'}</h2>${required?'<p>You signed in with a temporary password. Choose a password only you know before continuing.</p>':''}<label><span>New password (at least 10 characters)</span><input name="password" type="password" minlength="10" maxlength="72" required autocomplete="new-password"></label><label><span>Type it again</span><input name="confirm" type="password" minlength="10" maxlength="72" required autocomplete="new-password"></label><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Save new password</button></div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 if(required){dialog.querySelector('[data-close]').hidden=true;dialog.addEventListener('cancel',event=>event.preventDefault());}
 else dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.showModal();
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]');
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;
  const password=form.elements.password.value,confirm=form.elements.confirm.value;
  if(password.length<10)return alert.textContent='Use at least 10 characters.';
  if(password!==confirm)return alert.textContent='The two passwords do not match.';
  button.disabled=true;alert.textContent='Saving…';
  try{
   const result=await client.auth.updateUser({password,data:{must_change_password:false}});
   if(me?.user_id!==actor||!dialog.isConnected)return;
   if(result.error)throw result.error;
   form.reset();if(required){dialog.close();message('Password saved. Use it from now on.');return;}alert.textContent='Password changed. Use it next time you sign in.';
  }catch(error){if(dialog.isConnected)alert.textContent=`Not changed: ${error.message}`;}
  finally{button.disabled=false;}
 };
}
