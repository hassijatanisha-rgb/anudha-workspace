'use strict';
let employeeDirectory=new Map(),employeeNamesEpoch=0;
function clearEmployeeNames(){employeeNamesEpoch++;employeeDirectory=new Map();}
function employeeName(id){if(!id)return 'Unassigned';return employeeDirectory.get(id)?.display_name?.trim()||(id===me?.user_id?'You':'Employee name not set');}
async function loadEmployeeNames(){
 const epoch=++employeeNamesEpoch,actor=me?.user_id,next=new Map(),seen=new Set();employeeDirectory=new Map();
 if(!actor)return false;
 let cursor=null;
 try{do{
  const r=await client.rpc('list_staff_display_names',{p_limit:100,p_after_id:cursor});
  if(epoch!==employeeNamesEpoch||me?.user_id!==actor)return false;
  if(r.error||!Array.isArray(r.data?.items))throw Error('Directory unavailable');
  for(const row of r.data.items)next.set(row.user_id,row);
  cursor=r.data.next_after_id;
  if(cursor&&seen.has(cursor))throw Error('Repeated directory page');
  if(cursor)seen.add(cursor);
 }while(cursor);employeeDirectory=next;return true;
 }catch{return false;}
}
async function saveEmployeeNameByEmail(email,name){
 const actor=me?.user_id;if(!actor||me?.role!=='owner')throw Error('Only the owner can set employee names.');
 const found=await client.rpc('lookup_staff_display_name',{p_email:String(email).trim()});
 if(me?.user_id!==actor||me?.role!=='owner')throw Error('Login changed. Reopen the form.');
 if(found.error)throw found.error;
 const row=Array.isArray(found.data)?found.data[0]:found.data;
 if(!row?.user_id)throw Error('No staff account found for that email.');
 const result=await client.rpc('set_staff_display_name',{p_user_id:row.user_id,p_expected_version:row.name_version,p_display_name:String(name).trim()});
 if(result.error)throw result.error;
 if(me?.user_id!==actor)throw Error('Login changed. Reopen the staff page.');
 return result.data;
}
function openEmployeeNameEditor(){
 if(me?.role!=='owner')return;
 const actor=me.user_id,dialog=document.createElement('dialog');
 dialog.innerHTML='<form><h2>Set employee name</h2><p>Use the employee’s existing sign-in email to identify the account. This changes the displayed name only—not their login or permissions.</p><label>Existing staff email<input name="email" type="email" required></label><label>Employee name<input name="displayName" maxlength="120" required></label><p role="alert"></p><button type="submit">Save name</button><button type="button">Cancel</button></form>';
 document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[type="button"]').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=async event=>{
  event.preventDefault();const button=dialog.querySelector('[type="submit"]');if(button.disabled||me?.user_id!==actor)return;button.disabled=true;
  try{const f=new FormData(event.target);await saveEmployeeNameByEmail(f.get('email'),f.get('displayName'));if(me?.user_id!==actor)return;await loadEmployeeNames();if(me?.user_id!==actor)return;dialog.close();if(view==='staff')await staff();message('Employee name saved.');}
  catch(error){if(dialog.isConnected&&me?.user_id===actor)dialog.querySelector('[role="alert"]').textContent=error.message||'Name could not be saved.';}
  finally{button.disabled=false;}
 };
}
