'use strict';
// Personal profile, display settings (this browser only), and an honest list of outside connections.
// Device preferences apply without changing account permissions or saved records.
const textSizes={normal:{label:'Normal',scale:'1'},large:{label:'Large',scale:'1.15'},xlarge:{label:'Extra large',scale:'1.3'}};
// Status only changes here after a real provider is configured and tested; nothing is simulated.
const externalConnections=[
 {name:'Email notifications',status:'Not connected',detail:'Work sent to you and stock-arrival notices show inside the ERP. No emails are sent yet.'},
 {name:'WhatsApp messages',status:'Not connected',detail:'No WhatsApp provider has been set up. No messages are sent.'},
 {name:'Tally',status:'Not connected',detail:'Optional legacy import/export only. Post new orders in Accounts → Customer invoices. Do not create a second invoice in Tally for the same sale. No direct connection is configured.'},
 {name:'VFD / tax invoice device',status:'Not connected',detail:'Tax invoices are posted here in Accounts. Fiscal-device integration is not connected; record the genuine TRA receipt separately when issued. Tally import/export is optional and does not replace ERP posting.'}
];
const workspaceThemes={system:'System',light:'Light',dark:'Dark'};
function readWorkspaceTheme(){try{const value=localStorage.getItem('anudha.theme');return ['system','light','dark'].includes(value)?value:'system';}catch{return 'system';}}
let workspaceTheme=readWorkspaceTheme();
function applyWorkspaceTheme(theme=workspaceTheme){if(!['system','light','dark'].includes(theme))throw Error('Choose Light, Dark or System.');workspaceTheme=theme;document.documentElement.dataset.theme=theme;}
function saveWorkspaceTheme(theme){applyWorkspaceTheme(theme);try{localStorage.setItem('anudha.theme',theme);return true;}catch{return false;}}
function readTextSize(){try{const value=localStorage.getItem('anudha.textSize');return textSizes[value]?value:'normal';}catch{return 'normal';}}
function applyTextSize(size=readTextSize()){document.documentElement.style.zoom=(textSizes[size]||textSizes.normal).scale;document.documentElement.dataset.textSize=textSizes[size]?size:'normal';}
function saveTextSize(size){if(!textSizes[size])throw Error('Choose a text size from the list.');try{localStorage.setItem('anudha.textSize',size);}catch{}applyTextSize(size);}
function settingsProfileRow(row,actor){
 if(!row||row.user_id!==actor.user_id||!Number.isInteger(row.name_version)||row.name_version<0||!['display_name','phone','contact_email'].every(key=>typeof row[key]==='string'||row[key]===null)||typeof row.role!=='string'||typeof row.department!=='string')throw Error('The server did not return your profile. Reload and try again.');
 return row;
}
let settingsProfileDraft=null;
const settingsProfileFields=['display_name','phone','contact_email'];
function settingsProfileExpected(profile){
 return {display_name:profile.display_name,name_version:profile.name_version,phone:profile.phone,contact_email:profile.contact_email};
}
function settingsProfileForm(profile){
 return `<form id="settingsProfileForm"><p data-profile-validation class="error" role="alert"></p><div class="grid"><label class="wide"><span>Full name</span><input name="display_name" autocomplete="name" required maxlength="120" value="${esc(profile.display_name)}"></label><label><span>Phone with country code (optional)</span><input name="phone" type="tel" autocomplete="tel" maxlength="24" placeholder="+255712345678" value="${esc(profile.phone)}"><small>Include the country code.</small></label><label><span>Contact email (optional)</span><input name="contact_email" type="email" autocomplete="email" maxlength="254" aria-describedby="settingsContactEmailHelp" value="${esc(profile.contact_email)}"></label></div><p id="settingsContactEmailHelp" class="muted">Use a personal or shared contact email, or leave it empty; your sign-in stays the same.</p><div class="details"><div><small>Role</small><strong data-profile-role>${esc(roleLabels[profile.role]||profile.role)}</strong></div><div><small>Department</small><strong data-profile-department>${esc(profile.department?departmentLabel(profile.department):'Not assigned')}</strong></div></div><p class="muted">Your administrator assigns your role and department.</p><div class="actions"><button type="submit">Save profile</button><button type="button" data-profile-reload hidden>Reload saved details</button></div><p data-profile-status role="status" aria-live="polite"></p><p data-profile-error class="error" role="alert"></p><p data-profile-reload-help class="muted" hidden>Reloading replaces your unsaved edits with the saved profile.</p></form>`;
}
async function loadSettingsProfile(section){
 const actor=me,epoch=sessionLoadEpoch,session=actionFeedbackEpoch,request=(section.settingsProfileRequest||0)+1;section.settingsProfileRequest=request;let form=null;
 const current=()=>me===actor&&sessionLoadEpoch===epoch&&actionFeedbackEpoch===session&&view==='settings'&&section.isConnected&&section.settingsProfileRequest===request&&(!form||form.isConnected&&section.querySelector('form')===form);
 if(!actor||!current())return;
 // Loading another page refreshes the staff row and load epoch. The sign-in epoch survives navigation.
 if(settingsProfileDraft&&(settingsProfileDraft.userId!==actor.user_id||settingsProfileDraft.session!==session))settingsProfileDraft=null;
 section.innerHTML=workspaceSkeleton('profile','Loading your profile…');
 try{
  const result=await client.rpc('get_my_staff_profile');if(!current())return;
  if(result.error)throw Error(result.error.message||'Your profile could not load.');
  let profile=settingsProfileRow(result.data,actor);
  section.innerHTML=settingsProfileForm(profile);
  form=section.querySelector('form');const status=form.querySelector('[data-profile-status]'),error=form.querySelector('[data-profile-error]'),summary=form.querySelector('[data-profile-validation]'),reload=form.querySelector('[data-profile-reload]'),reloadHelp=form.querySelector('[data-profile-reload-help]');
  let saving=false,validationSubmitted=false;
  let expected=settingsProfileExpected(profile);
  if(settingsProfileDraft){
   const draft=settingsProfileDraft,changed=Object.keys(expected).some(key=>expected[key]!==draft.expected[key]);
   expected=draft.expected;
   for(const key of settingsProfileFields)form.elements[key].value=draft.values[key];
   const details=section.closest('details');if(details)details.open=true;
   status.textContent=changed?'Your unsaved edits are restored. The saved profile has changed. Reload saved details to use the current version.':'Your unsaved profile edits are restored.';
   reload.hidden=false;reloadHelp.hidden=false;
  }
  const remember=()=>{
   if(saving||!current())return;
   const values=Object.fromEntries(settingsProfileFields.map(key=>[key,form.elements[key].value]));
   settingsProfileDraft=settingsProfileFields.some(key=>values[key]!==String(expected[key]??''))?{userId:actor.user_id,session,expected,values}:null;
  };
  form.addEventListener('input',remember);form.addEventListener('change',remember);
  const phoneValue=value=>value.trim().replace(/[\s()-]/g,'');
  const fieldProblem=control=>{
   const native=nativeFieldError(control);if(control===form.elements.display_name&&!control.value.trim()&&!control.validity.customError)return 'Enter your full name.';
   if(native)return native;
   if(control===form.elements.phone){const value=phoneValue(control.value);if(value&&!/^\+[0-9]{8,15}$/.test(value))return 'Enter the phone with country code, for example +255712345678, or leave it empty.';}
   return '';
  };
  const collectErrors=()=>{const errors=nativeFormErrors(form);for(const control of [form.elements.display_name,form.elements.phone]){const problem=fieldProblem(control);if(problem)errors.set(control,problem);}return errors;};
  form.noValidate=true;
  form.addEventListener('focusout',event=>{const control=event.target;if(saving||!current()||!form.contains(control)||!control.matches('input,select,textarea')||fieldBlurToAction(event))return;showFieldError(control,fieldProblem(control));if(validationSubmitted)summary.textContent=fieldErrorSummary(form.querySelectorAll('.field-error').length);});
  reload.onclick=()=>{if(current()&&!saving)return run(()=>{settingsProfileDraft=null;return loadSettingsProfile(section);},{origin:reload,errorTarget:error,busyLabel:'Reloading profile…'})};
  form.onsubmit=async event=>{
   event.preventDefault();if(saving||!current())return;
   const button=form.querySelector('[type="submit"]');if(busy){actionFeedbackRefuse(button,error);return;}
   remember();
   const errors=collectErrors();validationSubmitted=errors.size>0;summary.textContent=fieldErrorSummary(errors.size);showFieldErrors(form,errors);if(errors.size)return;
   const values={display_name:form.elements.display_name.value.trim(),phone:phoneValue(form.elements.phone.value),contact_email:form.elements.contact_email.value.trim().toLowerCase()};
   error.textContent='';status.textContent='';
   actionFeedbackShow(actionFeedbackReference(button),'');
   const submitted=settingsProfileDraft;
   saving=true;const controls=[...form.querySelectorAll('input,button')];controls.forEach(control=>control.disabled=true);status.textContent='Saving profile…';
   return run(async()=>{
   try{
    const result=await client.rpc('save_my_staff_profile',{p_expected_values:expected,p_values:values});
    if(result.error)throw Error(result.error.message||'Your profile could not be saved.');
    const saved=settingsProfileRow(result.data,actor);
    if(saved.name_version<profile.name_version||saved.display_name!==values.display_name||(saved.phone||'')!==values.phone||(saved.contact_email||'')!==values.contact_email)throw Error('The server did not confirm these profile details. Reload to check the saved profile.');
    if(settingsProfileDraft===submitted&&actionFeedbackEpoch===session&&me?.user_id===actor.user_id)settingsProfileDraft=null;
    if(!current())return;
    profile=saved;expected=settingsProfileExpected(saved);
    for(const key of settingsProfileFields)form.elements[key].value=saved[key]||'';
    form.querySelector('[data-profile-role]').textContent=roleLabels[saved.role]||saved.role;
    form.querySelector('[data-profile-department]').textContent=saved.department?departmentLabel(saved.department):'Not assigned';
    employeeDirectory.set(actor.user_id,{...employeeDirectory.get(actor.user_id),user_id:actor.user_id,display_name:saved.display_name,name_version:saved.name_version});
    const name=$('#identity .identity-name');if(name)name.textContent=saved.display_name;
    $('#accountMenu > summary')?.setAttribute('aria-label',`Account options for ${saved.display_name}`);
    status.textContent='Profile saved.';reload.hidden=true;reloadHelp.hidden=true;message('Profile saved.');
   }catch(cause){if(current()){status.textContent='';error.textContent=`Profile save was not confirmed. ${cause.message||'Check your connection and try again.'} Your edits are still here.`;reload.hidden=false;reloadHelp.hidden=false;}}
   finally{saving=false;if(current())controls.forEach(control=>control.disabled=false);}
   },{origin:button,errorTarget:error,busyLabel:'Saving profile…'});
  };
 }catch(cause){
  if(!current())return;
  section.innerHTML=`<p class="error" role="alert">Your profile could not load: ${esc(cause.message||'Check your connection and try again.')}</p><button type="button" data-profile-reload>Reload profile</button>`;
  const reload=section.querySelector('[data-profile-reload]');reload.onclick=()=>{if(current())return run(()=>loadSettingsProfile(section),{origin:reload,errorTarget:section.querySelector('[role="alert"]'),busyLabel:'Reloading profile…'})};
 }
}
function settingsWorkspace(){
 syncWorkspaceNavigation();
 const size=readTextSize();
 const themeDescription=theme=>theme==='system'?'Follows this device’s appearance.':workspaceThemes[theme]+' appearance on this device.';
 $('#content').innerHTML=`<section class="settings-workspace">
  ${workspacePageHeader({title:'My settings'})}
  <div class="settings-columns">
   <div class="settings-group">
    <section class="card"><h2>My account</h2>
     <details class="settings-disclosure"><summary>Edit personal details</summary><div id="settingsProfile"></div></details>
     <div class="actions"><button type="button" id="settingsPassword">Change password</button></div>
    </section>
    <div id="settingsSecurity"></div>
   </div>
   <div class="settings-group">
    <section class="card"><h2>Display</h2>
     <fieldset class="settings-choice"><legend>Appearance</legend><div class="text-size-options">${Object.entries(workspaceThemes).map(([key,label])=>`<label><input type="radio" name="workspaceTheme" value="${key}" ${key===workspaceTheme?'checked':''}><span>${label}</span></label>`).join('')}</div></fieldset>
     <p class="muted" id="settingsThemeStatus" role="status">${themeDescription(workspaceTheme)}</p>
     <fieldset class="settings-choice"><legend>Text size</legend><div class="text-size-options">${Object.entries(textSizes).map(([key,option])=>`<label><input type="radio" name="textSize" value="${key}" ${key===size?'checked':''}><span class="text-size-sample text-size-${key}">${option.label}</span></label>`).join('')}</div></fieldset>
    </section>
    <details class="card settings-disclosure"><summary>Workspace information</summary><h3>Language</h3><p>English</p><h3>Notifications</h3><p>Open the bell for updates or My tasks for work assigned to you.</p><h3>External connections</h3>
     <ul class="connection-list">${externalConnections.map(c=>`<li><strong>${esc(c.name)}</strong> <span class="tag">${esc(c.status)}</span><br><small>${esc(c.detail)}</small></li>`).join('')}</ul>
    </details>
   </div>
  </div>
  ${me?.role==='owner'?`<div id="settingsOwnerTools"><section class="card"><h2>Discount approval</h2><div id="settingsDiscountPolicy"></div></section>${booksCutoverChecklist()}</div>`:''}
 </section>`;
 document.querySelectorAll('[name="workspaceTheme"]').forEach(input=>input.onchange=()=>{const saved=saveWorkspaceTheme(input.value);const status=$('#settingsThemeStatus');status.textContent=saved?themeDescription(input.value):'Appearance changed for this visit. This browser could not save the preference.';message(saved?'Appearance updated.':'Appearance updated for this visit.');});
 document.querySelectorAll('[name="textSize"]').forEach(input=>input.onchange=()=>{saveTextSize(input.value);message(`Text size set to ${textSizes[input.value].label.toLowerCase()} on this device.`);});
 $('#settingsPassword').onclick=()=>run(async()=>openChangePassword());
 loadSettingsProfile($('#settingsProfile'));
 if(me?.role==='owner')loadSettingsDiscountPolicy($('#settingsDiscountPolicy'));
 if(typeof renderTwoStepSettings==='function')renderTwoStepSettings($('#settingsSecurity')).catch(()=>{});
}
applyTextSize();
applyWorkspaceTheme();
