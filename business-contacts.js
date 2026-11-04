'use strict';

function businessContactUrl(value){
 try{if(/[\s\x00-\x1f\x7f]/.test(value))return '';const url=new URL(value);return /^https?:\/\//i.test(value)&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function businessContactReceipt(row,id){
 return row?.organization_id===id&&typeof row.id==='string'&&Number.isSafeInteger(row.version)&&row.version>0
  &&['emails','phones'].every(key=>Array.isArray(row[key])&&row[key].length<=20&&row[key].every(item=>typeof item?.value==='string'&&(item.purpose===undefined||typeof item.purpose==='string')))
  &&['website','physical_address','postal_address','source_url','evidence_note'].every(key=>typeof row[key]==='string')
  &&(row.source_checked_on===null||typeof row.source_checked_on==='string');
}
function businessContactLink(value,label=value){
 const url=businessContactUrl(value);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:esc(label);
}
function businessContactContent(row){
 if(!row)return '<p class="muted">Add the public contact details for this client or branch.</p>';
 const entries=(kind,label)=>row[kind].length?`<div><dt>${label}</dt><dd><ul>${row[kind].map(item=>{
  const value=esc(item.value),href=kind==='emails'?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.value)?'mailto:'+encodeURIComponent(item.value):'':/^[+\d\s()./#xX-]+$/.test(item.value)?'tel:'+encodeURIComponent(item.value):'';
  return `<li>${href?`<a href="${esc(href)}">${value}</a>`:value}${item.purpose?`<span class="muted">${esc(item.purpose)}</span>`:''}</li>`;
 }).join('')}</ul></dd></div>`:'';
 const address=(key,label)=>row[key]?`<div><dt>${label}</dt><dd class="business-contact-text">${esc(row[key])}</dd></div>`:'';
 const details=entries('emails','Email')+entries('phones','Phone')+(row.website?`<div><dt>Website</dt><dd>${businessContactLink(row.website)}</dd></div>`:'')+address('physical_address','Physical address')+address('postal_address','Postal address');
 return `${details?`<dl class="business-contact-facts">${details}</dl>`:'<p class="muted">No public contact details recorded.</p>'}<details class="business-contact-evidence"><summary>Source &amp; verification</summary>${row.source_url?`<p>${businessContactLink(row.source_url)}</p>`:''}<p>${row.source_checked_on?`Source checked on ${esc(row.source_checked_on)}`:'Source check date not recorded'}</p><p class="business-contact-text">${esc(row.evidence_note)}</p></details>`;
}
function businessContactPersonEmails(organizationId,rows){
 const grouped=new Map();
 for(const row of rows){
  const email=String(row.email||'').trim();if(row.organization_id!==organizationId||row.deleted_at||['incorrect','deleted'].includes(row.status)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))continue;
  const key=email.toLowerCase(),entry=grouped.get(key)||{email,names:new Set()};entry.names.add([row.title,row.first_name,row.last_name].filter(Boolean).join(' ').trim()||'Unnamed contact');grouped.set(key,entry);
 }
 return [...grouped.values()].sort((a,b)=>a.email.localeCompare(b.email)).map(entry=>({email:entry.email,names:[...entry.names]}));
}
function businessContactPersonEmailContent(organizationId){
 const rows=businessContactPersonEmails(organizationId,contacts);
 return `<details class="business-contact-evidence business-contact-person-emails"><summary>Emails from contacts (${rows.length})</summary><p class="muted">Email addresses on contact records for this location.</p>${rows.length?`<ul>${rows.map(row=>`<li><a href="mailto:${esc(encodeURIComponent(row.email))}">${esc(row.email)}</a><span class="muted">${esc(row.names.join(' · '))}</span></li>`).join('')}</ul>`:'<p class="muted">No valid contact emails recorded for this location.</p>'}</details>`;
}
function refreshBusinessContactEmails(){
 const root=document.querySelector('#businessContactDetails'),target=root?.querySelector('[data-business-person-emails]');if(!target)return;
 const open=target.querySelector('details')?.open;target.innerHTML=businessContactPersonEmailContent(root.dataset.organizationId);target.querySelector('details').open=!!open;
}
function businessContactSection(organization){
 return `<section class="card business-contact-details" id="businessContactDetails" data-organization-id="${esc(organization.id)}" aria-labelledby="businessContactHeading"><div class="heading"><div><h2 id="businessContactHeading">Business contact details</h2><p class="muted">Public email, phone and address for this location.</p></div></div><div data-business-content aria-busy="true"><p role="status">Loading business contact details…</p></div><div data-business-person-emails>${businessContactPersonEmailContent(organization.id)}</div><p data-business-status role="status"></p></section>`;
}
function mountBusinessContactDetails(organization){
 const root=document.querySelector('#businessContactDetails');if(!root||root.dataset.organizationId!==organization.id)return;
 const actor=me,session=sessionLoadEpoch,hash=location.hash;
 const context={organization,root,current:()=>me===actor&&sessionLoadEpoch===session&&view==='contacts'&&location.hash===hash&&root.isConnected&&!root.inert&&document.querySelector('#businessContactDetails')===root,request:0,row:null};
 root.businessContactContext=context;
 return loadBusinessContactDetails(context);
}
function refreshBusinessContactDetails(organization){
 const root=document.querySelector('#businessContactDetails');if(!root)return;
 if(root.dataset.organizationId===organization.id&&root.businessContactContext){root.inert=false;root.businessContactContext.organization=organization;refreshBusinessContactEmails();return;}
 const template=document.createElement('template');template.innerHTML=businessContactSection(organization);root.replaceWith(template.content.firstElementChild);
 return mountBusinessContactDetails(organization);
}
async function readBusinessContactDetails(id){
 const result=await client.rpc('organization_business_contacts',{p_organization_id:id});
 if(result.error)throw result.error;
 if(!Array.isArray(result.data)||result.data.length>1||result.data.length&&!businessContactReceipt(result.data[0],id))throw Error('Business contact details could not be verified. Try loading them again.');
 return result.data[0]||null;
}
function renderBusinessContactDetails(context,notice=''){
 if(!context.current())return;
 const {root,row}=context,body=root.querySelector('[data-business-content]');body.innerHTML=businessContactContent(row);body.setAttribute('aria-busy','false');
 root.querySelector('[data-business-status]').textContent=notice;
 root.querySelector('[data-business-edit]')?.remove();
 if(canEditRecords()){
  const button=document.createElement('button');button.setAttribute('type','button');button.dataset.businessEdit='';button.textContent=row?'Edit business details':'Add business details';root.querySelector('.heading').append(button);
  button.onclick=()=>run(async()=>{if(await loadBusinessContactDetails(context))return openBusinessContactEditor(context);},{origin:button,busyLabel:'Opening…'});
 }
}
async function loadBusinessContactDetails(context){
 const request=++context.request,body=context.root.querySelector('[data-business-content]');
 if(!context.current())return;body.setAttribute('aria-busy','true');
 try{
  const row=await readBusinessContactDetails(context.organization.id);
  if(!context.current()||request!==context.request)return;
  context.row=row;renderBusinessContactDetails(context);return true;
 }catch(error){
  if(!context.current()||request!==context.request)return;
  body.setAttribute('aria-busy','false');body.innerHTML=`<p role="alert">${esc(error.message||'Business contact details could not be loaded.')}</p><button type="button" data-business-retry>Retry business details</button>`;
  body.querySelector('[data-business-retry]').onclick=()=>loadBusinessContactDetails(context);
 }
}
function businessContactEntryFields(kind,item,index){
 const email=kind==='emails',label=email?'Email':'Phone',prefix=kind+index;
 return `<fieldset class="business-contact-entry" data-business-entry="${kind}"><legend>${label} ${index+1}</legend><div class="grid"><label><span>${label}</span><input name="${prefix}Value" type="${email?'email':'tel'}" maxlength="${email?254:80}" required value="${esc(item.value||'')}"></label><label><span>Purpose (optional)</span><input name="${prefix}Purpose" maxlength="120" placeholder="e.g. Reception" value="${esc(item.purpose||'')}"></label></div><button type="button" data-business-remove aria-label="Remove ${label.toLowerCase()} ${index+1}">Remove</button></fieldset>`;
}
function businessContactValues(form){
 const value=name=>form.querySelector(`[name="${name}"]`).value.trim(),entries=kind=>[...form.querySelectorAll(`[data-business-entry="${kind}"]`)].map(row=>{
  const inputs=row.querySelectorAll('input');return {value:inputs[0].value.trim(),purpose:inputs[1].value.trim()};
 });
 return {emails:entries('emails'),phones:entries('phones'),website:value('website'),physical_address:value('physical_address'),postal_address:value('postal_address'),source_url:value('source_url'),source_checked_on:value('source_checked_on')||null,evidence_note:value('evidence_note')};
}
function validateBusinessContactFields(form){
 const errors={};
 for(const name of ['website','source_url']){const control=form.querySelector(`[name="${name}"]`);if(control.value.trim()&&!businessContactUrl(control.value.trim()))errors[name]='Use a full http:// or https:// address without login details.';}
 for(const row of form.querySelectorAll('[data-business-entry="phones"]')){const input=row.querySelector('input');if(!/^[\d+()/. #xX-]+$/.test(input.value.trim())||(input.value.match(/\d/g)||[]).length<3)errors[input.name]='Enter the published phone number using digits, spaces or phone punctuation, with at least 3 digits.';}
 const date=form.querySelector('[name="source_checked_on"]');if(date.value&&date.value>companyDate())errors.source_checked_on='The source check date cannot be in the future.';
 return errors;
}
function openBusinessContactEditor(context){
 if(!context.current())return;if(!canEditRecords())throw Error(recordsLockedText);
 const row=context.row||{emails:[],phones:[],website:'',physical_address:'',postal_address:'',source_url:'',source_checked_on:null,evidence_note:''},expected=row.version||0,requestId=crypto.randomUUID();
 let form,sent=null,committed=false;
 const current=()=>context.current()&&canEditRecords()&&actionSubmit===submit;
 const finish=async(saved,readCurrent=false)=>{
  if(readCurrent||!businessContactReceipt(saved,context.organization.id)||saved.id!==requestId||saved.version!==expected+1)saved=await readBusinessContactDetails(context.organization.id);
  if(!current())return;
  if(!businessContactReceipt(saved,context.organization.id)||saved.version<expected+1||saved.version===expected+1&&saved.id!==requestId)throw Error('The saved version could not be verified. Close and reopen business details before editing again.');
  context.row=saved;renderBusinessContactDetails(context,saved.version>expected+1?'Business contact details saved. Showing the latest revision, which includes a newer edit.':'Business contact details saved.');
 };
 const submit=async()=>{
  if(!current())throw Error('This profile or login changed. Close and reopen business details.');
  if(committed){await finish(null);return;}
  const errors=validateBusinessContactFields(form);if(Object.keys(errors).length){showFieldErrors(form,errors);throw Error('Check the highlighted business contact fields.');}
  const values=businessContactValues(form),payload={p_request_id:requestId,p_organization_id:context.organization.id,p_expected_version:expected,...Object.fromEntries(Object.entries(values).map(([key,value])=>['p_'+key,value]))};
  const fingerprint=JSON.stringify(payload),retry=sent!==null;if(sent&&sent!==fingerprint)throw Error('The previous save was not confirmed. Close and reopen to check the latest details before changing that submission.');sent=fingerprint;
  for(const control of form.querySelector('.business-contact-editor').querySelectorAll('input,textarea,select,button'))control.disabled=true;
  let result;
  try{result=await client.rpc('save_organization_business_contacts',payload);}catch(error){if(current())throw Error(`Save not confirmed: ${error.message||'Connection unavailable'}. Retry with the same details, or close and reopen to check the saved version.`);return;}
  if(!current())return;
  if(result.error)throw Error(`${result.error.message}. Close and reopen to compare the latest details before changing this submission.`);
  committed=true;actionSave.textContent='Retry saved details';
  try{await finish(Array.isArray(result.data)?result.data[0]:result.data,retry);}catch(error){if(current())throw Error(`Business details were saved, but could not be shown: ${error.message}`);}
 };
 const list=(kind,label)=>`<section><h3>${label}</h3><div data-business-list="${kind}">${row[kind].map((item,index)=>businessContactEntryFields(kind,item,index)).join('')}</div><button type="button" data-business-add="${kind}">Add ${kind==='emails'?'email':'phone'}</button></section>`;
 form=actionForm(context.row?'Edit business contact details':'Add business contact details',`<p>${esc(context.organization.name)} · ${esc(context.organization.location||'Location not recorded')}</p><div class="business-contact-editor">${list('emails','Email addresses')}${list('phones','Phone numbers')}<label><span>Website (optional)</span><input name="website" type="url" maxlength="2000" placeholder="https://" value="${esc(row.website)}"></label><div class="grid"><label><span>Physical address (optional)</span><textarea name="physical_address" maxlength="1000">${esc(row.physical_address)}</textarea></label><label><span>Postal address (optional)</span><textarea name="postal_address" maxlength="1000">${esc(row.postal_address)}</textarea></label></div><h3>Source &amp; verification</h3><label><span>Primary source URL (optional)</span><input name="source_url" type="url" maxlength="2000" placeholder="https://" value="${esc(row.source_url)}"></label><label><span>Source checked on (optional)</span><input name="source_checked_on" type="date" max="${esc(companyDate())}" value="${esc(row.source_checked_on||'')}"></label><label><span>Evidence note</span><textarea name="evidence_note" minlength="5" maxlength="2000" required placeholder="What was checked, any uncertainty, and additional source URLs">${esc(row.evidence_note)}</textarea></label></div>`,submit);
 actionSave.textContent='Save business details';
 const sequence={emails:row.emails.length,phones:row.phones.length};
 const sync=()=>{for(const kind of ['emails','phones'])form.querySelector(`[data-business-add="${kind}"]`).disabled=form.querySelectorAll(`[data-business-entry="${kind}"]`).length>=20;};
 const bindRemove=entry=>{entry.querySelector('[data-business-remove]').onclick=()=>{if(!current()||actionSaving||committed)return;entry.remove();sync();};};
 form.querySelectorAll('[data-business-entry]').forEach(bindRemove);
 for(const kind of ['emails','phones'])form.querySelector(`[data-business-add="${kind}"]`).onclick=()=>{
  if(!current()||actionSaving||committed||form.querySelectorAll(`[data-business-entry="${kind}"]`).length>=20)return;
  const list=form.querySelector(`[data-business-list="${kind}"]`);list.insertAdjacentHTML('beforeend',businessContactEntryFields(kind,{},sequence[kind]++));
  const entry=[...list.querySelectorAll('[data-business-entry]')].at(-1);bindRemove(entry);sync();entry.querySelector('input').focus();
 };
 sync();return form;
}
