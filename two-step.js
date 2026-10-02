'use strict';
// Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator…). The database refuses
// everything except the person's own staff row until the 6-digit code is entered (migration 058), so these screens
// are the way in, not the protection itself.

// Returns true when the session still needs the code. Called by load() before any business data is read.
async function twoStepNeeded(){
 const level=await client.auth.mfa.getAuthenticatorAssuranceLevel();
 return !level.error&&level.data?.nextLevel==='aal2'&&level.data?.currentLevel!=='aal2';
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
 $('#content').innerHTML=`<form id="twoStepLogin" class="login card"><small>ANUDHA WORKSPACE</small><h1>Enter your code</h1><p class="muted">Open the authenticator app on your phone and type the 6 numbers shown for Anudha ERP.</p>${twoStepCodeField()}<button type="submit">Continue</button><button type="button" id="twoStepSignOut">Sign out</button><p class="muted">Lost your phone? Ask the owner to reset your two-step sign-in.</p></form>`;
 $('#twoStepLogin [name="code"]').focus();
 $('#twoStepSignOut').onclick=()=>run(async()=>{await client.auth.signOut();login();});
 $('#twoStepLogin').onsubmit=event=>{event.preventDefault();run(async()=>{
  const code=twoStepCode(new FormData(event.target).get('code')),factor=await twoStepFactor();
  if(!factor)throw Error('No authenticator is set up for this login. Ask the owner.');
  const result=await client.auth.mfa.challengeAndVerify({factorId:factor.id,code});
  if(result.error)throw Error(/invalid|expired/i.test(result.error.message)?'That code is not right or has expired. Type the new code.':result.error.message);
  await onDone();
 });};
}
// My settings card.
async function renderTwoStepSettings(target){
 const box=document.createElement('section');box.className='card two-step-settings';box.innerHTML='<h2>Two-step sign-in</h2><p role="status">Checking…</p>';target.append(box);
 let factor;try{factor=await twoStepFactor();}catch(error){box.innerHTML=`<h2>Two-step sign-in</h2><p role="alert">Could not check: ${esc(error.message)}</p>`;return;}
 box.innerHTML=factor
  ?`<h2>Two-step sign-in <span class="tag two-step-on">On</span></h2><p class="muted">When you sign in, you type your password and then the 6-digit code from your phone. Someone who steals your password still cannot get in.</p><button type="button" id="twoStepOff" class="danger">Turn off</button>`
  :`<h2>Two-step sign-in <span class="tag">Off</span></h2><p class="muted">Protects your login if someone learns your password. You will need your phone each time you sign in.</p><button type="button" id="twoStepOn" class="primary-action">Turn on</button>`;
 $('#twoStepOn')?.addEventListener('click',()=>run(()=>startTwoStepSetup(box)));
 $('#twoStepOff')?.addEventListener('click',()=>run(async()=>{
  if(!confirm('Turn off two-step sign-in? Your login will be protected by your password only.'))return;
  const result=await client.auth.mfa.unenroll({factorId:factor.id});if(result.error)throw Error(result.error.message);
  await client.auth.refreshSession();box.remove();await renderTwoStepSettings(target);message('Two-step sign-in is off.');
 }));
}
async function startTwoStepSetup(box){
 // An earlier unfinished setup is removed first so the new code is the only one.
 const existing=await client.auth.mfa.listFactors();
 for(const f of existing.data?.all||[])if(f.factor_type==='totp'&&f.status!=='verified')await client.auth.mfa.unenroll({factorId:f.id});
 const enrolled=await client.auth.mfa.enroll({factorType:'totp',friendlyName:`Anudha ERP ${new Date().toISOString().slice(0,16)}`,issuer:'Anudha ERP'});
 if(enrolled.error)throw Error(enrolled.error.message);
 const {id,totp}=enrolled.data;
 box.innerHTML=`<h2>Turn on two-step sign-in</h2><ol class="howto-steps"><li>On your phone, install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong>.</li><li>In the app, add an account and scan this picture.</li><li>Type the 6 numbers the app shows, then press Confirm.</li></ol><img class="two-step-qr" src="${esc(totp.qr_code)}" alt="Code to scan with the authenticator app" width="200" height="200"><p class="muted">Cannot scan? Type this key into the app instead: <code>${esc(totp.secret)}</code></p><form id="twoStepConfirm">${twoStepCodeField()}<div class="actions"><button type="submit">Confirm</button><button type="button" id="twoStepCancel">Cancel</button></div></form>`;
 $('#twoStepConfirm [name="code"]').focus();
 $('#twoStepCancel').onclick=()=>run(async()=>{await client.auth.mfa.unenroll({factorId:id});settingsWorkspace();});
 $('#twoStepConfirm').onsubmit=event=>{event.preventDefault();run(async()=>{
  const code=twoStepCode(new FormData(event.target).get('code'));
  const result=await client.auth.mfa.challengeAndVerify({factorId:id,code});
  if(result.error)throw Error(/invalid|expired/i.test(result.error.message)?'That code is not right. Wait for a new code in the app and try again.':result.error.message);
  settingsWorkspace();message('Two-step sign-in is on. You will need your phone each time you sign in.');
 });};
}
// Staff page (owner): who has it on, and a reset for a lost phone.
async function decorateStaffTwoStep(){
 if(me?.role!=='owner')return;
 const result=await client.rpc('staff_two_step_status');if(result.error)return;
 const on=new Map((result.data||[]).map(r=>[r.user_id,r.enabled]));
 document.querySelectorAll('[data-staff-reset]').forEach(button=>{
  const id=button.dataset.staffReset,cell=button.closest('.actions');if(!cell||cell.querySelector('[data-two-step-reset]'))return;
  cell.insertAdjacentHTML('beforeend',on.get(id)?`<button type="button" data-two-step-reset="${esc(id)}">Reset two-step</button>`:'<span class="muted two-step-off">Two-step off</span>');
 });
 document.querySelectorAll('[data-two-step-reset]').forEach(button=>button.onclick=()=>run(async()=>{
  const name=employeeName(button.dataset.twoStepReset);
  if(!confirm(`Reset two-step sign-in for ${name}? Use this when their phone is lost. They can sign in with their password and turn it on again.`))return;
  await staffAccountsCall({action:'reset_two_step',user_id:button.dataset.twoStepReset});
  button.replaceWith(Object.assign(document.createElement('span'),{className:'muted',textContent:'Two-step reset'}));message(`Two-step sign-in reset for ${name}.`);
 }));
}
