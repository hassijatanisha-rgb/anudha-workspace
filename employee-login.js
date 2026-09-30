'use strict';
// Employee IDs are derived from names and sign in as <id>@<staffLoginDomain>; real emails keep working.
const employeeIdPattern=/^[a-z0-9]+(?:\.[a-z0-9]+)*$/;
function employeeLoginDomain(){return String(window.ERP_CONFIG?.staffLoginDomain||'staff.anudha.com').toLowerCase();}
function employeeLoginEmail(input){
 const value=String(input??'').trim().toLowerCase();
 if(value.includes('@'))return value;
 if(value.length<2||value.length>40||!employeeIdPattern.test(value))throw Error('Enter your employee ID (for example jagroop) or your work email.');
 return `${value}@${employeeLoginDomain()}`;
}
function employeeIdPart(word){return String(word??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function employeeIdCandidates(fullName){
 const words=String(fullName??'').trim().split(/\s+/).map(employeeIdPart).filter(Boolean);
 if(!words.length)return [];
 const first=words[0].slice(0,30),last=words.length>1?words.at(-1).slice(0,30):'',base=[first];
 if(last){base.push(`${first}.${last[0]}`,`${first}.${last}`);}
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
function openStaffOnboarding(){
 if(me?.role!=='owner')throw Error('Only the owner can add employees.');
 const actor=me.user_id,current=()=>me?.user_id===actor&&me?.role==='owner'&&dialog.isConnected;
 const dialog=document.createElement('dialog');dialog.className='staff-onboarding';dialog.setAttribute('aria-label','Add employee');
 dialog.innerHTML=`<form data-step="name"><h2>Add employee</h2><label><span>Full name</span><input name="fullName" required maxlength="120" autocomplete="off"></label><label><span>Role</span><select name="role"><option value="staff">Staff</option><option value="owner">Owner</option></select></label><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Create employee ID</button></div></form><section data-step="create" hidden></section>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.showModal();
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]'),step=dialog.querySelector('[data-step="create"]');
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;
  const fullName=form.elements.fullName.value.trim().replace(/\s+/g,' '),role=form.elements.role.value;
  button.disabled=true;alert.textContent='Checking which IDs are free…';
  try{
   const id=await suggestEmployeeId(fullName);if(!current())return;
   const email=`${id}@${employeeLoginDomain()}`,password=employeeTemporaryPassword();
   form.hidden=true;step.hidden=false;
   step.innerHTML=`<h2>${esc(fullName)}</h2><p>Employee ID: <strong data-employee-id>${esc(id)}</strong></p><ol><li>Open <a href="https://supabase.com/dashboard/project/udncxdbrbaptcefvjucj/auth/users" target="_blank" rel="noopener">Supabase logins ↗</a>, choose <strong>Add user → Create new user</strong>.</li><li>Email: <code data-login-email>${esc(email)}</code><br>Password: <code data-temporary-password>${esc(password)}</code><br>Tick <strong>Auto Confirm User</strong>, then create the user.</li><li>Come back here and press <strong>Enable access</strong>.</li></ol><p>Give the employee their ID and temporary password in person. They can change the password after signing in.</p><p role="alert"></p><div class="actions"><button type="button" data-close>Close</button><button type="button" data-enable>Enable access</button></div>`;
   step.querySelector('[data-close]').onclick=()=>dialog.close();
   const enable=step.querySelector('[data-enable]'),stepAlert=step.querySelector('[role="alert"]');
   enable.onclick=async()=>{
    if(enable.disabled||!current())return;enable.disabled=true;stepAlert.textContent='Enabling access…';
    try{
     const membership=await client.rpc('manage_staff_email',{p_email:email,p_role:role,p_active:true});
     if(!current())return;if(membership.error)throw Error(membership.error.message||'Access could not be enabled');
     await saveEmployeeNameByEmail(email,fullName);if(!current())return;
     await loadEmployeeNames();
     stepAlert.textContent=`Done. ${fullName} can now sign in with employee ID ${id}.`;enable.hidden=true;
     if(view==='staff')await staff();
    }catch(error){if(current()){stepAlert.textContent=`Not enabled yet: ${error.message}`;enable.disabled=false;}}
   };
  }catch(error){if(current()){alert.textContent=error.message;button.disabled=false;}}
 };
}
function openChangePassword(){
 if(!me?.user_id)throw Error('Sign in first.');
 const actor=me.user_id,dialog=document.createElement('dialog');dialog.className='change-password';dialog.setAttribute('aria-label','Change my password');
 dialog.innerHTML=`<form><h2>Change my password</h2><label><span>New password (at least 10 characters)</span><input name="password" type="password" minlength="10" maxlength="72" required autocomplete="new-password"></label><label><span>Type it again</span><input name="confirm" type="password" minlength="10" maxlength="72" required autocomplete="new-password"></label><p role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="submit">Save new password</button></div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.showModal();
 const form=dialog.querySelector('form'),alert=form.querySelector('[role="alert"]');
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;
  const password=form.elements.password.value,confirm=form.elements.confirm.value;
  if(password.length<10)return alert.textContent='Use at least 10 characters.';
  if(password!==confirm)return alert.textContent='The two passwords do not match.';
  button.disabled=true;alert.textContent='Saving…';
  try{
   const result=await client.auth.updateUser({password});
   if(me?.user_id!==actor||!dialog.isConnected)return;
   if(result.error)throw result.error;
   form.reset();alert.textContent='Password changed. Use it next time you sign in.';
  }catch(error){if(dialog.isConnected)alert.textContent=`Not changed: ${error.message}`;}
  finally{button.disabled=false;}
 };
}
