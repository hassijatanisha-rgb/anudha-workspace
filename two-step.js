'use strict';
// Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator…). The database refuses
// everything except the person's own staff row until the 6-digit code is entered (migration 058), so these screens
// are the way in, not the protection itself.

// Returns true when the session still needs the code. Called by load() before any business data is read.
// If the check itself fails, sign-in continues: the database still refuses data without the code.
async function twoStepNeeded(){
 try{
  const level=await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if(level.error)return false;
  if(level.data?.nextLevel==='aal2'&&level.data?.currentLevel!=='aal2')return true;
  // The database accepts a code for 30 days (migration 088); after that it asks again, even on a trusted device.
  return level.data?.currentLevel==='aal2'&&twoStepCodeStale(level.data?.currentAuthenticationMethods);
 }catch{return false;}
}
function twoStepCodeStale(methods,now=Date.now()){
 const last=Math.max(0,...(methods||[]).filter(m=>m?.method==='totp').map(m=>Number(m.timestamp)||0));
 return last*1000<now-30*86400000;
}
async function twoStepFactor(){
 const factors=await client.auth.mfa.listFactors();
 if(factors.error)throw Error(factors.error.message);
 return (factors.data?.totp||[]).find(f=>f.status==='verified')||null;
}
function twoStepCodeField(label='6-digit code'){return `<label><span>${label}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="123456"></label>`}
function twoStepCode(value){const code=String(value||'').replace(/\s/g,'');if(!/^\d{6}$/.test(code))throw Error('Type the 6 numbers shown in your authenticator app.');return code;}
// Sign-in step two. onDone runs load() again once the code is accepted.
function showTwoStepPrompt(onDone){
 $('#content').innerHTML=`<form id="twoStepLogin" class="login card"><small>ANUDHA WORKSPACE</small><h1>Enter your code</h1><p class="muted">Open the authenticator app on your phone and type the 6 numbers shown for Anudha ERP.</p>${twoStepCodeField()}${typeof deviceTrustField==='function'?deviceTrustField():''}<button type="submit">Continue</button><button type="button" id="twoStepSignOut">Sign out</button><p class="muted">Lost your phone? Ask the owner to reset your two-step sign-in.</p></form>`;
 $('#twoStepLogin [name="code"]').focus();
 $('#twoStepSignOut').onclick=()=>run(async()=>{if(typeof forgetThisDevice==='function')forgetThisDevice();await client.auth.signOut();login();});
 $('#twoStepLogin').onsubmit=event=>{event.preventDefault();run(async()=>{
  const code=twoStepCode(new FormData(event.target).get('code')),factor=await twoStepFactor();
  if(!factor)throw Error('No authenticator is set up for this login. Ask the owner.');
  const result=await client.auth.mfa.challengeAndVerify({factorId:factor.id,code});
  if(result.error)throw Error(/invalid|expired/i.test(result.error.message)?'That code is not right or has expired. Type the new code.':result.error.message);
  if(event.target.trustDevice?.checked&&typeof trustThisDevice==='function')trustThisDevice();
  await onDone();
 });};
}
// My settings card.
async function renderTwoStepSettings(target){
 const actor=me,role=me?.role,box=document.createElement('section');box.className='card two-step-settings';box.innerHTML='<h2>Two-step sign-in</h2><p role="status">Checking…</p>';target.append(box);
 let factor;try{factor=await twoStepFactor();}catch(error){box.innerHTML=`<h2>Two-step sign-in</h2><p role="alert">Could not check: ${esc(error.message)}</p>`;return;}
 const required=await twoStepRequired();
 box.innerHTML=factor
  ?`<h2>Two-step sign-in <span class="tag two-step-on chip chip--${statusTone('success')}">On</span></h2><p class="muted">When you sign in, you type your password and then the 6-digit code from your phone. Someone who steals your password still cannot get in.</p>${required?'<p class="muted">Required for owners and accounts, so it cannot be turned off. If you lose your phone, ask the owner to reset it.</p>':'<button type="button" id="twoStepOff" class="danger">Turn off</button>'}`
  :`<h2>Two-step sign-in <span class="tag chip chip--${statusTone(required?'waiting':'inactive')}">Off</span></h2><p class="muted">Protects your login if someone learns your password. You will need your phone each time you sign in.</p><button type="button" id="twoStepOn" class="primary-action">Turn on</button>`;
 $('#twoStepOn')?.addEventListener('click',()=>run(()=>startTwoStepSetup(box)));
 const off=box.querySelector('#twoStepOff');off?.addEventListener('click',()=>run(async()=>{
  const current=()=>me===actor&&me?.role===role&&view==='settings'&&target.isConnected&&box.isConnected&&box.querySelector('#twoStepOff')===off;
  if(!current()||!await askConfirm({title:'Turn off two-step sign-in?',body:'Your login will be protected by your password only.',confirmLabel:'Turn off two-step sign-in',tone:'danger'}))return;
  if(!current())return;
  const result=await client.auth.mfa.unenroll({factorId:factor.id});if(!current())return;if(result.error)throw Error(result.error.message);
  await client.auth.refreshSession();if(!current())return;box.remove();await renderTwoStepSettings(target);if(me===actor&&view==='settings'&&target.isConnected)message('Two-step sign-in is off.');
 }));
}
// Owners and accounts must use two-step sign-in (migration 080). These ask the database about the signed-in person
// only; if the check fails or is not installed, the answer is "not required" and the database still decides access.
async function twoStepRequired(){try{const r=await client.rpc('two_step_required');return !r.error&&r.data===true;}catch{return false;}}
async function twoStepSetupRequired(){try{const r=await client.rpc('two_step_setup_required');return !r.error&&r.data===true;}catch{return false;}}
// Sign-in for someone who must use two-step sign-in but has not set it up. onDone runs load() again afterwards.
function showTwoStepSetupRequired(onDone){
 $('#content').innerHTML=`<section class="login card" id="twoStepRequired"><small>ANUDHA WORKSPACE</small><h1>Set up two-step sign-in</h1><p class="muted">Owners and accounts staff must sign in with a code from their phone as well as their password. This keeps company money and records safe if a password is stolen. It takes about two minutes.</p><div class="actions"><button type="button" id="twoStepStart" class="primary-action">Set up now</button><button type="button" id="twoStepSignOut">Sign out</button></div></section>`;
 $('#twoStepSignOut').onclick=()=>run(async()=>{if(typeof forgetThisDevice==='function')forgetThisDevice();await client.auth.signOut();login();});
 $('#twoStepStart').onclick=()=>run(()=>startTwoStepSetup($('#twoStepRequired'),onDone));
}
async function startTwoStepSetup(box,onDone=null){
 // An earlier unfinished setup is removed first so the new code is the only one.
 const existing=await client.auth.mfa.listFactors();
 for(const f of existing.data?.all||[])if(f.factor_type==='totp'&&f.status!=='verified')await client.auth.mfa.unenroll({factorId:f.id});
 const enrolled=await client.auth.mfa.enroll({factorType:'totp',friendlyName:`Anudha ERP ${new Date().toISOString().slice(0,16)}`,issuer:'Anudha ERP'});
 if(enrolled.error)throw Error(enrolled.error.message);
 const {id,totp}=enrolled.data;
 box.innerHTML=`<h2>Turn on two-step sign-in</h2><ol class="howto-steps"><li>On your phone, install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong>.</li><li>In the app, add an account and scan this picture.</li><li>Type the 6 numbers the app shows, then press Confirm.</li></ol><img class="two-step-qr" src="${esc(totp.qr_code)}" alt="Code to scan with the authenticator app" width="200" height="200"><p class="muted">Cannot scan? Type this key into the app instead: <code>${esc(totp.secret)}</code></p><form id="twoStepConfirm">${twoStepCodeField()}${typeof deviceTrustField==='function'?deviceTrustField():''}<div class="actions"><button type="submit">Confirm</button><button type="button" id="twoStepCancel">Cancel</button></div></form>`;
 $('#twoStepConfirm [name="code"]').focus();
 $('#twoStepCancel').onclick=()=>run(async()=>{await client.auth.mfa.unenroll({factorId:id});if(onDone)showTwoStepSetupRequired(onDone);else settingsWorkspace();});
 $('#twoStepConfirm').onsubmit=event=>{event.preventDefault();run(async()=>{
  const code=twoStepCode(new FormData(event.target).get('code'));
  const result=await client.auth.mfa.challengeAndVerify({factorId:id,code});
  if(result.error)throw Error(/invalid|expired/i.test(result.error.message)?'That code is not right. Wait for a new code in the app and try again.':result.error.message);
  if(event.target.trustDevice?.checked&&typeof trustThisDevice==='function')trustThisDevice();
  if(onDone)await onDone();else settingsWorkspace();message('Two-step sign-in is on. You will need your phone each time you sign in.');
 });};
}
// Staff page (owner, or a head for their own department): who has it on, and a reset for a lost phone.
async function decorateStaffTwoStep(){
 if(me?.role!=='owner'&&me?.role!=='head')return;
 const actor=me,rows=[...document.querySelectorAll('[data-staff-row]')],result=await client.rpc('staff_two_step_status');if(me!==actor)return;
 const on=new Map((result.data||[]).map(r=>[r.user_id,r.enabled]));
 rows.forEach(row=>{
  if(!row.isConnected)return;
  const id=row.dataset.staffRow,status=row.querySelector('[data-staff-two-step-status]');
  if(status){status.textContent=result.error||!on.has(id)?'Two-step unavailable':on.get(id)?'Two-step: on':'Two-step: off';status.className='chip chip--'+statusTone(result.error||!on.has(id)?'failed':on.get(id)?'success':'inactive');}
  const cell=row.querySelector('[data-staff-reset]')?.closest('.actions');
  if(!result.error&&on.get(id)&&cell&&!cell.querySelector('[data-two-step-reset]'))cell.insertAdjacentHTML('beforeend',`<button type="button" class="danger" data-two-step-reset="${esc(id)}" aria-label="Reset two-step for ${esc(employeeName(id))}">Reset two-step</button>`);
  row.querySelectorAll('[data-two-step-reset]').forEach(button=>button.onclick=()=>run(async()=>{
   const name=employeeName(id),role=me?.role,department=me?.department,binding=button.onclick,current=()=>me===actor&&(me?.role==='owner'||me?.role==='head')&&me.role===role&&me.department===department&&view==='staff'&&row.isConnected&&row.dataset.staffRow===id&&button.isConnected&&row.querySelector('[data-two-step-reset]')===button&&button.onclick===binding;
   if(!current()||!await askConfirm({title:`Reset two-step sign-in for ${name}?`,body:'Use this when their phone is lost. They can sign in with their password and turn it on again.',confirmLabel:'Reset two-step sign-in',tone:'danger'}))return;
   if(!current())return;
   await staffAccountsCall({action:'reset_two_step',user_id:id});if(!current())return;
   if(status){status.textContent='Two-step: off';status.className='chip chip--'+statusTone('inactive');}
   button.replaceWith(Object.assign(document.createElement('span'),{className:'muted chip chip--'+statusTone('done'),textContent:'Two-step reset'}));message(`Two-step sign-in reset for ${name}.`);
  }));
 });
}
