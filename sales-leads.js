'use strict';
// Inquiries → leads → opportunities → won (linked Pro forma) or lost. Writes go through save/advance RPCs only.
let leadSection='inquiries',leadFilter='open',leadSearch='',leadPage=0,leadRows=[],leadLoaded=false,leadLoadError='',leadEpoch=0,leadEditing='';
let leadFocusId='';
// Open one lead from elsewhere (e.g. a task): the section is chosen from its stage once the list has loaded.
function focusLead(id){leadFocusId=id;leadEditing='';leadPage=0;view='leads';}
function openLeadSection(section){leadSection=section||'inquiries';leadPage=0;leadEditing='';}
function clearLeads(){leadEpoch++;leadFocusId='';leadRows=[];leadLoaded=false;leadEditing='';leadPendingSave=null;if(typeof clearSalesPrefill==='function')clearSalesPrefill();}
const leadStages={inquiry:'Inquiry',lead:'Lead',opportunity:'Opportunity',won:'Won',lost:'Lost'};
const leadSources={phone:'Phone call',email:'Email',walk_in:'Walk-in',whatsapp:'WhatsApp',referral:'Referral',website:'Website',other:'Other'};
function leadToday(){return new Date().toISOString().slice(0,10);}
function leadOverdue(row,today=leadToday()){return !['won','lost'].includes(row.stage)&&!!row.next_action_on&&row.next_action_on<today;}
function leadClientLabel(row){const org=orgIndex.get(row.organization_id);return org?`${org.name}${org.location?' · '+org.location:''}`:[row.caller_organization,row.caller_name].filter(Boolean).join(' · ')||'Unknown caller';}
function leadMoney(minor,currency){return minor==null||minor===''?'':new Intl.NumberFormat('en-TZ',{style:'currency',currency:currency||'TZS'}).format(Number(minor)/100);}
function leadVisibleRows(rows,{section,filter,search,actor,today=leadToday()}){
 const q=String(search||'').trim().toLowerCase();
 const closed=row=>['won','lost'].includes(row.stage)?1:0;
 return rows.filter(row=>section==='inquiries'?row.stage==='inquiry':row.stage!=='inquiry')
  .filter(row=>section==='inquiries'||filter==='all'||(filter==='open'?['lead','opportunity'].includes(row.stage):filter==='mine'?row.owner_user_id===actor&&!['won','lost'].includes(row.stage):row.stage===filter))
  .filter(row=>!q||[row.lead_number,row.subject,row.details,row.caller_name,row.caller_phone,row.caller_organization,leadClientLabel(row),employeeName(row.owner_user_id),row.next_action].join(' ').toLowerCase().includes(q))
  .sort((a,b)=>closed(a)-closed(b)||Number(leadOverdue(b,today))-Number(leadOverdue(a,today))||String(a.next_action_on||'9999').localeCompare(String(b.next_action_on||'9999'))||String(b.created_at).localeCompare(String(a.created_at))||a.id.localeCompare(b.id));
}
function leadActions(row){
 const open=!['won','lost'].includes(row.stage),buttons=[];
 if(open)buttons.push(`<button type="button" data-lead-edit="${esc(row.id)}">Edit</button>`,`<button type="button" data-lead-action="assign" data-id="${esc(row.id)}">${row.owner_user_id?'Reassign':'Assign salesperson'}</button>`);
 if(row.stage==='inquiry')buttons.push(`<button type="button" data-lead-action="qualify" data-id="${esc(row.id)}">Pass to sales as lead</button>`);
 if(row.stage==='lead')buttons.push(`<button type="button" data-lead-action="opportunity" data-id="${esc(row.id)}">Mark as opportunity</button>`);
 if(['lead','opportunity'].includes(row.stage))buttons.push(`<button type="button" data-lead-proforma="${esc(row.id)}">Create Pro forma</button>`,`<button type="button" data-lead-action="won" data-id="${esc(row.id)}">Mark won</button>`);
 if(open)buttons.push(`<button type="button" data-lead-action="lost" data-id="${esc(row.id)}">Mark lost</button>`);
 if(row.stage==='lost')buttons.push(`<button type="button" data-lead-action="reopen" data-id="${esc(row.id)}">Reopen</button>`);
 buttons.push(`<button type="button" data-lead-history="${esc(row.id)}">History</button>`);
 return buttons.join('');
}
function leadCard(row){
 const proforma=salesProformas.find(p=>p.id===row.proforma_id),overdue=leadOverdue(row);
 return `<article class="card lead-card${overdue?' attention':''}" data-lead-card="${esc(row.id)}"><div class="heading"><div><small>${esc(row.lead_number)} · ${esc(leadSources[row.source]||row.source)}</small><h2>${esc(row.subject)}</h2><p>${esc(leadClientLabel(row))}${row.caller_phone?' · '+esc(row.caller_phone):''}</p></div><span class="tag">${esc(leadStages[row.stage]||row.stage)}</span></div>${row.details?`<p class="lead-details">${esc(row.details)}</p>`:''}<div class="details"><div><small>Salesperson</small>${esc(row.owner_user_id?employeeName(row.owner_user_id):'Not assigned')}</div><div><small>Next action</small>${esc(row.next_action||'None set')}${row.next_action_on?` · <strong${overdue?' class="overdue"':''}>${overdue?'Overdue ':''}${esc(row.next_action_on)}</strong>`:''}</div><div><small>Estimated value</small>${esc(leadMoney(row.estimated_value_minor,row.currency)||'Not estimated')}</div>${row.stage==='won'?`<div><small>Pro forma</small>${esc(proforma?.document_number||'Linked')}</div>`:''}${row.stage==='lost'?`<div><small>Lost because</small>${esc(row.lost_reason)}</div>`:''}</div><div class="actions">${leadActions(row)}</div><div data-lead-history-output="${esc(row.id)}"></div></article>`;
}
function leadEmployeeOptions(selected=''){return [...employeeDirectory.values()].filter(row=>row.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id))).map(row=>inventoryOption(row.user_id,employeeName(row.user_id),row.user_id===selected)).join('');}
function leadEditor(row){
 const value=row?.estimated_value_minor==null?'':(Number(row.estimated_value_minor)/100).toFixed(2);
 return `<section class="card document-editor"><div class="heading"><div><small>${row?esc(row.lead_number):'NEW'}</small><h2>${row?'Edit '+esc(leadStages[row.stage]).toLowerCase():'New inquiry'}</h2></div><button type="button" id="closeLeadEditor">Close</button></div><form id="leadForm" data-id="${esc(row?.id||'')}" data-version="${row?.version||0}"><p class="muted">Choose an existing client, or type the caller's name and phone number for someone new.</p><div class="grid"><label><span>Existing client · optional</span><select name="organizationId"><option value="">New caller (not in client list)</option>${salesOrganizationOptions(row?.organization_id||'')}</select></label><label><span>Contact · optional</span><select name="contactId"><option value="">No named contact</option>${salesContactOptions(row?.organization_id||'',row?.contact_id||'')}</select></label><label><span>Caller name</span><input name="callerName" maxlength="200" value="${esc(row?.caller_name||'')}"></label><label><span>Caller phone</span><input name="callerPhone" maxlength="60" inputmode="tel" value="${esc(row?.caller_phone||'')}"></label><label class="wide"><span>Caller's organisation · if new</span><input name="callerOrganization" maxlength="300" value="${esc(row?.caller_organization||'')}"></label><label><span>How they contacted us</span><select name="source">${Object.entries(leadSources).map(([key,label])=>`<option value="${key}" ${(row?.source||'phone')===key?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Salesperson · optional</span><select name="ownerUserId"${row?' disabled':''}><option value="">Not assigned yet</option>${leadEmployeeOptions(row?.owner_user_id||'')}</select></label><label class="wide"><span>What do they need?</span><input name="subject" required minlength="2" maxlength="300" value="${esc(row?.subject||'')}"></label><label class="wide"><span>Details · products, quantities, machines</span><textarea name="details" maxlength="8000">${esc(row?.details||'')}</textarea></label><label><span>Next action</span><input name="nextAction" maxlength="500" placeholder="Call back with price" value="${esc(row?.next_action||'')}"></label><label><span>Next action date</span><input name="nextActionOn" type="date" value="${esc(row?.next_action_on||'')}"></label><label><span>Currency</span><select name="currency">${['TZS','USD','EUR'].map(c=>`<option ${(row?.currency||'TZS')===c?'selected':''}>${c}</option>`).join('')}</select></label><label><span>Estimated value · optional</span><input name="estimatedValue" type="number" min="0" step="0.01" value="${value}"></label></div><p role="alert" id="leadFormError"></p><div class="actions"><button type="submit">${row?'Save changes':'Save inquiry'}</button></div></form></section>`;
}
function leadFormValues(form){
 const f=new FormData(form),organizationId=f.get('organizationId')||'',value=String(f.get('estimatedValue')||'').trim();
 const fields={organization_id:organizationId,contact_id:organizationId?f.get('contactId')||'':'',caller_name:String(f.get('callerName')||'').trim(),caller_phone:String(f.get('callerPhone')||'').trim(),caller_organization:String(f.get('callerOrganization')||'').trim(),source:f.get('source')||'phone',subject:String(f.get('subject')||'').trim(),details:String(f.get('details')||''),next_action:String(f.get('nextAction')||'').trim(),next_action_on:f.get('nextActionOn')||'',currency:f.get('currency')||'TZS',estimated_value_minor:''};
 if(f.has('ownerUserId'))fields.owner_user_id=f.get('ownerUserId')||'';
 if(value){const amount=Number(value);if(!Number.isFinite(amount)||amount<0)throw Error('Enter a valid estimated value.');fields.estimated_value_minor=String(Math.round(amount*100));}
 if(fields.subject.length<2)throw Error('Describe what the customer needs.');
 if(!fields.organization_id&&(fields.caller_name.length<2||fields.caller_phone.replace(/\D/g,'').length<6))throw Error('Choose an existing client, or enter the caller’s name and a phone number.');
 return fields;
}
let leadPendingSave=null;
async function saveLeadForm(form){
 const fields=leadFormValues(form),id=form.dataset.id||'',version=Number(form.dataset.version||0);
 // Keep one request ID for a new inquiry until it is confirmed, so a retry cannot create a duplicate.
 if(!id&&(!leadPendingSave||leadPendingSave.subject!==fields.subject))leadPendingSave={id:crypto.randomUUID(),subject:fields.subject};
 const requestId=id||leadPendingSave.id,actor=me?.user_id;
 const result=await client.rpc('save_sales_lead',{p_id:requestId,p_expected_version:version,p_fields:fields});
 if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
 if(result.error)throw Error(result.error.message);
 const saved=Array.isArray(result.data)?result.data[0]:result.data;
 if(saved?.id!==requestId)throw Error('The server did not confirm the save. Press Save again to retry safely.');
 leadPendingSave=null;leadEditing='';await leadsWorkspace(true);message(`${saved.lead_number} saved.`);
}
async function loadLeads(){
 const epoch=++leadEpoch,actor=me?.user_id;
 const [rows,proformas]=await Promise.all([all('sales_leads','id,lead_number,stage,source,organization_id,contact_id,caller_name,caller_phone,caller_organization,subject,details,estimated_value_minor,currency,owner_user_id,next_action,next_action_on,lost_reason,proforma_id,version,created_by,created_at,updated_at'),salesLoaded?Promise.resolve(null):all('sales_proformas','id,document_number,organization_id,status,deleted_at')]);
 if(epoch!==leadEpoch||me?.user_id!==actor)return false;
 leadRows=rows;if(proformas&&!salesLoaded)salesProformas=proformas;leadLoaded=true;leadLoadError='';return true;
}
async function leadsWorkspace(force=false){
 const actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!leadLoaded){
  $('#content').innerHTML='<p role="status">Loading inquiries and leads…</p>';
  try{if(!(await loadLeads()))return;}catch(error){if(me?.user_id!==actor)return;leadLoadError=error.message;leadLoaded=false;}
 }
 if(view!=='leads'||me?.user_id!==actor)return;
 if(leadFocusId){const row=leadRows.find(r=>r.id===leadFocusId);leadFocusId='';if(row){leadSection=row.stage==='inquiry'?'inquiries':'pipeline';leadFilter='all';leadSearch=row.lead_number;}}
 renderLeads();
}
function renderLeads(){
 const inquiries=leadSection==='inquiries',rows=leadVisibleRows(leadRows,{section:leadSection,filter:leadFilter,search:leadSearch,actor:me?.user_id});
 const pages=Math.max(1,Math.ceil(rows.length/20));leadPage=Math.min(Math.max(leadPage,0),pages-1);
 const editing=leadEditing==='new'?null:leadRows.find(row=>row.id===leadEditing);
 const counts={open:leadRows.filter(r=>['lead','opportunity'].includes(r.stage)).length,inquiry:leadRows.filter(r=>r.stage==='inquiry').length,overdue:leadRows.filter(r=>leadOverdue(r)).length};
 $('#content').innerHTML=`<section class="leads-workspace"><div class="heading"><div><small>ORDERS</small><h1>${inquiries?'Inquiries':'Leads & opportunities'}</h1><p class="muted">${inquiries?'Record every phone call, email or walk-in, then pass it to a salesperson.':'Follow up each lead until it becomes a Pro forma or is closed as lost.'}</p></div><div class="actions"><button type="button" id="leadRefresh">Refresh</button>${inquiries?'<button type="button" id="newLead">New inquiry</button>':''}</div></div>${leadLoadError?`<p class="notice error" role="alert">Leads could not load: ${esc(leadLoadError)}. Nothing was changed.</p>`:''}<div class="help-strip"><strong>${counts.inquiry} new ${counts.inquiry===1?'inquiry':'inquiries'} · ${counts.open} open ${counts.open===1?'lead':'leads'} · ${counts.overdue} overdue follow-up${counts.overdue===1?'':'s'}</strong><span>Overdue follow-ups are listed first.</span></div>${leadEditing?leadEditor(editing):''}${inquiries?'':`<div class="tabs" role="group" aria-label="Filter leads">${[['open','Open'],['mine','Mine'],['opportunity','Opportunities'],['won','Won'],['lost','Lost'],['all','All']].map(([key,label])=>`<button type="button" data-lead-filter="${key}" class="${leadFilter===key?'active':''}" aria-pressed="${leadFilter===key}">${label}</button>`).join('')}</div>`}<label class="search"><span>Search</span><input id="leadSearch" type="search" placeholder="Name, phone, client, product or LD number" value="${esc(leadSearch)}"></label><p class="muted">${rows.length} matching</p>${rows.slice(leadPage*20,leadPage*20+20).map(leadCard).join('')||`<p class="muted">${inquiries?'No new inquiries. Press New inquiry to record one.':'No leads match this filter.'}</p>`}<div class="actions"><button type="button" id="leadPrev" ${leadPage===0?'disabled':''}>Previous</button><span>Page ${leadPage+1} of ${pages}</span><button type="button" id="leadNext" ${leadPage>=pages-1?'disabled':''}>Next</button></div></section>`;
 bindLeads();
}
function bindLeads(){
 $('#leadRefresh').onclick=()=>run(()=>leadsWorkspace(true));
 $('#newLead')?.addEventListener('click',()=>{leadEditing='new';leadPendingSave=null;renderLeads();$('#leadForm [name="subject"]')?.focus();});
 $('#closeLeadEditor')?.addEventListener('click',()=>{leadEditing='';leadPendingSave=null;renderLeads();});
 const form=$('#leadForm');
 if(form){
  form.elements.organizationId.onchange=event=>{form.elements.contactId.innerHTML='<option value="">No named contact</option>'+salesContactOptions(event.target.value);};
  form.onsubmit=event=>{event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;$('#leadFormError').textContent='';
   run(async()=>{try{await saveLeadForm(form)}catch(error){if($('#leadFormError'))$('#leadFormError').textContent=error.message;throw error;}finally{if(button.isConnected)button.disabled=false;}});};
 }
 $('#leadSearch').oninput=event=>{leadSearch=event.target.value;leadPage=0;renderSearchPreservingPosition(event.target,renderLeads);};
 $('#leadPrev').onclick=()=>{leadPage--;renderLeads();};$('#leadNext').onclick=()=>{leadPage++;renderLeads();};
 document.querySelectorAll('[data-lead-filter]').forEach(button=>button.onclick=()=>{leadFilter=button.dataset.leadFilter;leadPage=0;renderLeads();});
 document.querySelectorAll('[data-lead-edit]').forEach(button=>button.onclick=()=>{leadEditing=button.dataset.leadEdit;renderLeads();$('#leadForm')?.scrollIntoView({block:'start'});});
 document.querySelectorAll('[data-lead-action]').forEach(button=>button.onclick=()=>openLeadAction(leadRows.find(row=>row.id===button.dataset.id),button.dataset.leadAction));
 document.querySelectorAll('[data-lead-proforma]').forEach(button=>button.onclick=()=>startProformaFromLead(leadRows.find(row=>row.id===button.dataset.leadProforma)));
 document.querySelectorAll('[data-lead-history]').forEach(button=>button.onclick=()=>run(()=>showLeadHistory(button.dataset.leadHistory)));
 if(typeof decorateWorkHandoffs==='function')decorateWorkHandoffs().catch(()=>{});
}
function openLeadAction(row,action){
 if(!row)return;
 const titles={assign:'Assign salesperson',qualify:'Pass inquiry to sales',opportunity:'Mark as opportunity',won:'Mark lead as won',lost:'Mark lead as lost',reopen:'Reopen lead'};
 const needsAssignee=action==='assign'||(action==='qualify'&&!row.owner_user_id);
 const proformas=salesProformas.filter(p=>!p.deleted_at&&(!row.organization_id||p.organization_id===row.organization_id));
 const fields=`<p><strong>${esc(row.lead_number)}</strong> · ${esc(row.subject)} · ${esc(leadClientLabel(row))}</p>${needsAssignee?`<label><span>Salesperson</span><select name="assignee" required><option value="">Choose employee</option>${leadEmployeeOptions(row.owner_user_id||'')}</select></label>`:''}${action==='won'?(proformas.length?`<label><span>Pro forma for this lead</span><select name="proforma" required><option value="">Choose Pro forma</option>${proformas.map(p=>inventoryOption(p.id,`${p.document_number} · ${salesStatus?.(p.status)||p.status}`)).join('')}</select></label>`:'<p class="notice">No Pro forma exists for this client yet. Use Create Pro forma first.</p>'):''}<label><span>${action==='lost'?'Why was it lost?':'Note · optional'}</span><textarea name="note" maxlength="1000" ${action==='lost'?'required minlength="3"':''}></textarea></label>`;
 actionForm(titles[action],fields,async values=>{
  const actor=me?.user_id,result=await client.rpc('advance_sales_lead',{p_id:row.id,p_expected_version:row.version,p_action:action,p_assigned_user_id:values.assignee||null,p_note:values.note||'',p_proforma_id:values.proforma||null});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the lead.');
  if(result.error)throw Error(result.error.message);
  await leadsWorkspace(true);message(`${row.lead_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
function startProformaFromLead(row){
 if(!row)return;
 if(!row.organization_id){message('Add this caller to the client list first, then choose the client on the lead (Edit), so the Pro forma has a real customer.',true);return;}
 salesPrefill={organizationId:row.organization_id,contactId:row.contact_id||'',leadNumber:row.lead_number};
 view='sales';salesSection='proformas';salesEditing='new';render();
 message(`New Pro forma for ${row.lead_number}. After saving it, return to the lead and press Mark won.`);
}
async function showLeadHistory(id){
 const output=document.querySelector(`[data-lead-history-output="${CSS.escape(id)}"]`),actor=me?.user_id;if(!output)return;
 output.textContent='Loading history…';
 const result=await client.from('sales_lead_events').select('action,from_stage,to_stage,assigned_user_id,note,actor_user_id,created_at').eq('lead_id',id).order('created_at').limit(200);
 if(me?.user_id!==actor||!output.isConnected)return;
 if(result.error){output.textContent=`History could not load: ${result.error.message}`;return;}
 output.innerHTML=`<ol class="lead-history">${(result.data||[]).map(event=>`<li>${esc(new Date(event.created_at).toLocaleString())} · <strong>${esc(employeeName(event.actor_user_id))}</strong> · ${esc(event.action)}${event.from_stage&&event.from_stage!==event.to_stage?` · ${esc(leadStages[event.from_stage])} → ${esc(leadStages[event.to_stage])}`:''}${event.assigned_user_id?` · salesperson ${esc(employeeName(event.assigned_user_id))}`:''}${event.note?` · ${esc(event.note)}`:''}</li>`).join('')}</ol>`;
}
