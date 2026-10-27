'use strict';
// Personal profile, display settings (this browser only), and an honest list of outside connections.
// zoom, not root font-size: the stylesheets use fixed pixel sizes, which zoom scales together with spacing.
const textSizes={normal:{label:'Normal',scale:'1'},large:{label:'Large',scale:'1.15'},xlarge:{label:'Extra large',scale:'1.3'}};
// Status only changes here after a real provider is configured and tested; nothing is simulated.
const externalConnections=[
 {name:'Email notifications',status:'Not connected',detail:'Work sent to you and stock-arrival notices show inside the ERP. No emails are sent yet.'},
 {name:'WhatsApp messages',status:'Not connected',detail:'No WhatsApp provider has been set up. No messages are sent.'},
 {name:'Tally',status:'Not connected',detail:'Optional legacy import/export only. Post new orders in Accounts → Customer invoices. Do not create a second invoice in Tally for the same sale. No direct connection is configured.'},
 {name:'VFD / tax invoice device',status:'Not connected',detail:'Tax invoices are posted here in Accounts. Fiscal-device integration is not connected; record the genuine TRA receipt separately when issued. Tally import/export is optional and does not replace ERP posting.'}
];
function readTextSize(){try{const value=localStorage.getItem('anudha.textSize');return textSizes[value]?value:'normal';}catch{return 'normal';}}
function applyTextSize(size=readTextSize()){document.documentElement.style.zoom=(textSizes[size]||textSizes.normal).scale;document.documentElement.dataset.textSize=textSizes[size]?size:'normal';}
function saveTextSize(size){if(!textSizes[size])throw Error('Choose a text size from the list.');try{localStorage.setItem('anudha.textSize',size);}catch{}applyTextSize(size);}
function settingsProfileRow(row,actor){
 if(!row||row.user_id!==actor.user_id||!Number.isInteger(row.name_version)||row.name_version<0||!['display_name','phone','contact_email'].every(key=>typeof row[key]==='string'||row[key]===null)||typeof row.role!=='string'||typeof row.department!=='string')throw Error('The server did not return your profile. Reload and try again.');
 return row;
}
function settingsProfileForm(profile){
 return `<form id="settingsProfileForm"><div class="grid"><label class="wide"><span>Full name</span><input name="display_name" autocomplete="name" required maxlength="120" value="${esc(profile.display_name)}"></label><label><span>Phone · with country code</span><input name="phone" type="tel" autocomplete="tel" maxlength="24" placeholder="+255712345678" value="${esc(profile.phone)}"><small>Optional. Include the country code.</small></label><label><span>Contact email</span><input name="contact_email" type="email" autocomplete="email" maxlength="254" aria-describedby="settingsContactEmailHelp" value="${esc(profile.contact_email)}"></label></div><p id="settingsContactEmailHelp" class="muted">This email is for contact details. Your sign-in stays the same. You may use a shared department email or leave it empty.</p><div class="details"><div><small>Role</small><strong data-profile-role>${esc(roleLabels[profile.role]||profile.role)}</strong></div><div><small>Department</small><strong data-profile-department>${esc(profile.department?departmentLabel(profile.department):'Not assigned')}</strong></div></div><p class="muted">Your administrator assigns your role and department.</p><div class="actions"><button type="submit">Save profile</button><button type="button" data-profile-reload hidden>Reload saved details</button></div><p data-profile-status role="status" aria-live="polite"></p><p data-profile-error class="error" role="alert"></p><p data-profile-reload-help class="muted" hidden>Reloading replaces your unsaved edits with the saved profile.</p></form>`;
}
async function loadSettingsProfile(section){
 const actor=me,current=()=>me===actor&&view==='settings'&&section.isConnected;
 if(!actor||!current())return;
 section.innerHTML='<p role="status">Loading your profile…</p>';
 try{
  const result=await client.rpc('get_my_staff_profile');if(!current())return;
  if(result.error)throw Error(result.error.message||'Your profile could not load.');
  let profile=settingsProfileRow(result.data,actor);
  section.innerHTML=settingsProfileForm(profile);
  const form=section.querySelector('form'),status=form.querySelector('[data-profile-status]'),error=form.querySelector('[data-profile-error]'),reload=form.querySelector('[data-profile-reload]'),reloadHelp=form.querySelector('[data-profile-reload-help]');
  let saving=false;
  reload.onclick=()=>{if(current()&&!saving)return loadSettingsProfile(section)};
  form.onsubmit=async event=>{
   event.preventDefault();if(saving||!current()||!form.reportValidity())return;
   const values={display_name:form.elements.display_name.value.trim(),phone:form.elements.phone.value.trim().replace(/[\s()-]/g,''),contact_email:form.elements.contact_email.value.trim().toLowerCase()};
   error.textContent='';status.textContent='';
   if(!values.display_name){error.textContent='Enter your full name.';return;}
   if(values.phone&&!/^\+[0-9]{8,15}$/.test(values.phone)){error.textContent='Enter the phone with country code, for example +255712345678, or leave it empty.';return;}
   const expected={display_name:profile.display_name,name_version:profile.name_version,phone:profile.phone,contact_email:profile.contact_email};
   saving=true;const controls=[...form.querySelectorAll('input,button')];controls.forEach(control=>control.disabled=true);status.textContent='Saving profile…';
   try{
    const result=await client.rpc('save_my_staff_profile',{p_expected_values:expected,p_values:values});if(!current())return;
    if(result.error)throw Error(result.error.message||'Your profile could not be saved.');
    const saved=settingsProfileRow(result.data,actor);
    if(saved.name_version<profile.name_version||saved.display_name!==values.display_name||(saved.phone||'')!==values.phone||(saved.contact_email||'')!==values.contact_email)throw Error('The server did not confirm these profile details. Reload to check the saved profile.');
    profile=saved;
    for(const key of ['display_name','phone','contact_email'])form.elements[key].value=saved[key]||'';
    form.querySelector('[data-profile-role]').textContent=roleLabels[saved.role]||saved.role;
    form.querySelector('[data-profile-department]').textContent=saved.department?departmentLabel(saved.department):'Not assigned';
    employeeDirectory.set(actor.user_id,{...employeeDirectory.get(actor.user_id),user_id:actor.user_id,display_name:saved.display_name,name_version:saved.name_version});
    const name=$('#identity .identity-name');if(name)name.textContent=saved.display_name;
    $('#accountMenu > summary')?.setAttribute('aria-label',`Account options for ${saved.display_name}`);
    status.textContent='Profile saved.';reload.hidden=true;reloadHelp.hidden=true;
   }catch(cause){if(current()){status.textContent='';error.textContent=`Profile save was not confirmed. ${cause.message||'Check your connection and try again.'} Your edits are still here.`;reload.hidden=false;reloadHelp.hidden=false;}}
   finally{saving=false;if(current())controls.forEach(control=>control.disabled=false);}
  };
 }catch(cause){
  if(!current())return;
  section.innerHTML=`<p class="error" role="alert">Your profile could not load: ${esc(cause.message||'Check your connection and try again.')}</p><button type="button" data-profile-reload>Reload profile</button>`;
  section.querySelector('[data-profile-reload]').onclick=()=>{if(current())return loadSettingsProfile(section)};
 }
}
function settingsWorkspace(){
 syncWorkspaceNavigation();
 const size=readTextSize();
 $('#content').innerHTML=`<section class="settings-workspace"><div class="heading"><div><small>SYSTEM</small><h1>My settings</h1></div></div><section class="card"><h2>My account</h2><div id="settingsProfile"></div><button type="button" id="settingsPassword">Change password</button></section><section class="card"><h2>Text size</h2><p class="muted">Makes every page easier to read on this computer or phone.</p><div class="text-size-options" role="radiogroup" aria-label="Text size">${Object.entries(textSizes).map(([key,option])=>`<label><input type="radio" name="textSize" value="${key}" ${key===size?'checked':''}> <span class="text-size-sample text-size-${key}">${option.label}</span></label>`).join('')}</div></section><section class="card"><h2>Language</h2><p>English. Kiswahili, Chinese and Hindi have been requested but are not available yet.</p></section><section class="card"><h2>In-app updates</h2><p>Use the bell and My tasks for assigned work and order updates. The bell checks while the ERP is open, on navigation and every two minutes. Open the bell and press Refresh updates to check now. Email and WhatsApp are not active delivery channels.</p></section><section class="card"><h2>Connections to other systems</h2><ul class="connection-list">${externalConnections.map(c=>`<li><strong>${esc(c.name)}</strong> <span class="tag">${esc(c.status)}</span><br><small>${esc(c.detail)}</small></li>`).join('')}</ul></section></section>`;
 document.querySelectorAll('[name="textSize"]').forEach(input=>input.onchange=()=>{saveTextSize(input.value);message(`Text size set to ${textSizes[input.value].label.toLowerCase()} on this device.`);});
 $('#settingsPassword').onclick=()=>run(async()=>openChangePassword());
 loadSettingsProfile($('#settingsProfile'));
 if(typeof renderTwoStepSettings==='function')renderTwoStepSettings($('.settings-workspace')).catch(()=>{});
}
applyTextSize();
