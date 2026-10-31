'use strict';
let employeeDirectory=new Map(),employeeNamesEpoch=0;
function clearEmployeeNames(){employeeNamesEpoch++;employeeDirectory=new Map();}
function employeeName(id){if(!id)return 'Unassigned';return employeeDirectory.get(id)?.display_name?.trim()||(id===me?.user_id?'You':'Employee name not set');}
// Someone added since this person signed in (for example by a department head) is not in the name list yet; the Staff
// page reloads the names then, instead of showing "Employee name not set".
async function refreshEmployeeNamesFor(ids){if(ids.some(id=>id&&!employeeDirectory.has(id)))await loadEmployeeNames();}
async function loadEmployeeNames(){
 const epoch=++employeeNamesEpoch,actor=me,next=new Map(),seen=new Set();employeeDirectory=new Map();
 if(!actor?.user_id)return false;
 let cursor=null;
 try{do{
  const r=await client.rpc('list_staff_display_names',{p_limit:100,p_after_id:cursor});
  if(epoch!==employeeNamesEpoch||me!==actor)return false;
  if(r.error||!Array.isArray(r.data?.items))throw Error('Directory unavailable');
  for(const row of r.data.items)next.set(row.user_id,row);
  cursor=r.data.next_after_id;
  if(cursor&&seen.has(cursor))throw Error('Repeated directory page');
  if(cursor)seen.add(cursor);
 }while(cursor);employeeDirectory=next;return true;
 }catch{return false;}
}
async function saveEmployeeNameByEmail(email,name){
 const actor=me;if(!actor?.user_id||me?.role!=='owner')throw Error('Only the owner can set employee names.');
 const found=await client.rpc('lookup_staff_display_name',{p_email:String(email).trim()});
 if(me!==actor||me?.role!=='owner')throw Error('Login changed. Reopen the form.');
 if(found.error)throw found.error;
 const row=Array.isArray(found.data)?found.data[0]:found.data;
 if(!row?.user_id)throw Error('No staff account found for that email.');
 const result=await client.rpc('set_staff_display_name',{p_user_id:row.user_id,p_expected_version:row.name_version,p_display_name:String(name).trim()});
 if(result.error)throw result.error;
 if(me!==actor)throw Error('Login changed. Reopen the staff page.');
 const expected={user_id:row.user_id,name_version:row.name_version+1,display_name:String(name).trim()};
 try{return employeeNameReceipt(result.data,expected);}catch(error){error.savedName=expected;throw error;}
}
function employeeNameReceipt(data,expected){
 const row=Array.isArray(data)&&data.length===1?data[0]:data;
 if(!row||row.user_id!==expected.user_id||!Number.isSafeInteger(row.name_version)||row.name_version<expected.name_version||typeof row.display_name!=='string'||!row.display_name.trim()||row.display_name.length>120||row.name_version===expected.name_version&&row.display_name!==expected.display_name)throw Error('The saved name could not be verified.');
 return row;
}
function openEmployeeNameEditor(){
 if(me?.role!=='owner')return;
 const actor=me,openingView=view,trigger=document.activeElement,directory=document.querySelector('[data-staff-directory]'),epoch=directory?.staffEpoch,dialog=document.createElement('dialog');
 dialog.innerHTML='<form><h2>Set employee name</h2><p>Email and employee name are required. This changes the displayed name.</p><p role="alert"></p><label>Existing staff email<input name="email" type="email" required></label><label>Employee name<input name="displayName" maxlength="120" required></label><div class="actions"><button type="button">Cancel</button><button type="submit" class="primary-action">Save name</button></div></form>';
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form');let working=false,committed=false;const initial=workspaceFormSnapshot(form),requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>working,isDirty:()=>!committed&&workspaceFormSnapshot(form)!==initial});
 dialog.querySelector('[type="button"]').onclick=requestClose;showWorkspaceDialog(dialog,{size:'medium',trigger});
 const current=()=>me===actor&&me?.role==='owner'&&view===openingView&&dialog.isConnected,apply=row=>{
  employeeNamesEpoch++;
  const previous=employeeDirectory.get(row.user_id);if(!previous||previous.name_version<=row.name_version)employeeDirectory.set(row.user_id,row);
  if(view==='staff'&&directory?.isConnected&&directory.staffEpoch===epoch)directory.staffRefresh();
  dialog.querySelector('[role="alert"]').textContent='Employee name saved.';
  dialog.querySelector('[type="button"]').textContent='Done';dialog.querySelector('[type="button"]').focus({preventScroll:true});
  message('Employee name saved.');
 };
 const validate=employeeFormValidation(form,form.querySelector('[role="alert"]'),()=>current()&&!working&&!committed,()=>nativeFormErrors(form));
 dialog.querySelector('form').onsubmit=async event=>{
  event.preventDefault();const button=dialog.querySelector('[type="submit"]'),notice=dialog.querySelector('[role="alert"]');if(button.disabled||!current())return;
  if(!validate())return;
  if(busy){actionFeedbackRefuse(button,notice);return;}actionFeedbackShow(actionFeedbackReference(button),'');button.disabled=true;working=true;
  return run(async()=>{
  const f=new FormData(event.target),email=f.get('email');
  try{const row=await saveEmployeeNameByEmail(email,f.get('displayName'));if(!current())return;committed=true;dialog.querySelectorAll('input').forEach(input=>input.disabled=true);apply(row);}
  catch(error){
   if(!current())return;
   if(error.savedName){
    committed=true;dialog.querySelectorAll('input').forEach(input=>input.disabled=true);const notice=dialog.querySelector('[role="alert"]'),retry=document.createElement('button');retry.type='button';retry.textContent='Retry refresh';notice.textContent='Name saved, but its confirmation could not be verified. Refresh the name before making another change.';notice.after(retry);
    retry.onclick=async()=>{
     if(!current()||retry.disabled)return;
     if(busy){actionFeedbackRefuse(retry,notice);return;}actionFeedbackShow(actionFeedbackReference(retry),'');retry.disabled=true;working=true;
     return run(async()=>{
     try{const result=await client.rpc('lookup_staff_display_name',{p_email:String(email).trim()});if(!current())return;if(result.error)throw result.error;const row=employeeNameReceipt(result.data,error.savedName);retry.remove();apply(row);}
     catch(readError){if(current())notice.textContent=`Name saved. Refresh failed: ${readError.message||'Try again.'}`;}
     finally{working=false;if(current())retry.disabled=false;}
     },{origin:retry,errorTarget:notice,busyLabel:'Refreshing name…'});
    };
   }else dialog.querySelector('[role="alert"]').textContent=error.message||'Name could not be saved.';
  }
  finally{working=false;if(current()&&!committed)button.disabled=false;}
  },{origin:button,errorTarget:notice,busyLabel:'Saving name…'});
 };
}
