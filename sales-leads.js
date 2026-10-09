'use strict';
// One Leads page: a new inquiry is recorded here and followed up here until won (linked Pro forma) or lost.
// Writes go through save/advance RPCs only. leadSection is kept for older callers but no longer splits the page.
let leadSection='leads',leadFilter='open',leadSearch='',leadPage=0,leadRows=[],leadLoaded=false,leadLoadError='',leadEpoch=0,leadEditing='';
let leadFocusId='';
// Open one lead from elsewhere (e.g. a task): the section is chosen from its stage once the list has loaded.
function focusLead(id){leadFocusId=id;leadEditing='';leadPage=0;view='leads';}
function openLeadSection(section){leadSection='leads';leadPage=0;if(section==='new'){leadEditing='new';leadPendingSave=null;}else leadEditing='';}
function clearLeads(){leadEpoch++;leadHandoverEpoch++;leadHandovers=new Map();leadFocusId='';leadRows=[];leadLoaded=false;leadEditing='';leadPendingSave=null;if(typeof clearSalesPrefill==='function')clearSalesPrefill();}
const leadStages={inquiry:'Needs a salesperson',lead:'Following up',opportunity:'Following up',won:'Won',lost:'Lost'};
const leadSources={phone:'Phone call',email:'Email',walk_in:'Walk-in',whatsapp:'WhatsApp',referral:'Referral',website:'Website',other:'Other'};
// The role of the person we spoke to changes how sales handles the lead (a buyer wants a price, a doctor a demo).
const leadRoles={doctor:'Doctor / user',head_of_department:'Head of department',procurement:'Procurement / purchasing',management:'Management / director',biomedical:'Biomedical engineer',other:'Other'};
function leadToday(){return new Date().toISOString().slice(0,10);}
function leadDay(date){return date?new Date(date+'T00:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).replace(',',''):'';}
function leadWords(text){return String(text||'').trim().split(/\s+/).filter(Boolean).length;}
// Who we spoke to: the linked contact when there is one, otherwise the name and phone typed on the lead.
function leadSpokeTo(row){
 const contact=row.contact_id&&typeof contacts!=='undefined'?contacts.find(c=>c.id===row.contact_id):null;
 const name=contact&&typeof salesContactName==='function'?salesContactName(contact.id):row.caller_name||'';
 return {name,phone:contact?.phone||row.caller_phone||'',role:leadRoles[row.caller_role]||'',position:contact?.position||''};
}
function leadSpokeToHtml(row){
 const p=leadSpokeTo(row);if(!p.name&&!p.phone&&!p.role)return '';
 return `<p class="lead-spoke-to"><small>Spoke to</small> <strong>${esc(p.name||'Name not recorded')}</strong>${p.phone?' · '+esc(p.phone):''}${p.role?` <span class="tag lead-role lead-role-${esc(row.caller_role)}">${esc(p.role)}</span>`:' <span class="muted">· role not recorded</span>'}${p.position?` <span class="muted">(${esc(p.position)})</span>`:''}</p>`;
}
// The next step, in words, for the top of the card: "Call Mr Bob · Thu 10 Oct".
function leadNextStep(row,today=leadToday()){
 if(['won','lost'].includes(row.stage))return null;
 const what=String(row.next_action||'').trim(),due=row.next_action_on||'';
 const state=!what&&!due?'none':due&&due<today?'late':due===today?'today':'planned';
 const when=due?(state==='today'?'Today':leadDay(due)):'';
 return {state,text:what||(due?'Follow up':'No next step yet. Press Edit or Hand over to set one.'),when};
}
function leadNextStepHtml(row){
 const step=leadNextStep(row);if(!step)return '';
 return `<div class="lead-next-step lead-next-${step.state}"><small>${step.state==='late'?'Next step · LATE':'Next step'}</small><strong>${esc(step.text)}${step.when?` · ${esc(step.when)}`:''}</strong></div>`;
}
// Handovers on the card, newest first: who handed to whom, when, and the note.
let leadHandovers=new Map(),leadHandoverEpoch=0;
function leadHandoverHtml(events){
 if(!events?.length)return '';
 const item=e=>`<li><strong>${esc(employeeName(e.from_user_id||e.actor_user_id))}</strong> → <strong>${esc(employeeName(e.assigned_user_id))}</strong> · ${esc(new Date(e.created_at).toLocaleString('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}${e.actor_user_id&&e.from_user_id&&e.actor_user_id!==e.from_user_id?` · by ${esc(employeeName(e.actor_user_id))}`:''}<br>“${esc(e.note)}”</li>`;
 const [latest,...older]=[...events].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 return `<div class="lead-handovers"><small>Handed over</small><ol>${item(latest)}</ol>${older.length?`<details><summary>Earlier handovers · ${older.length}</summary><ol>${older.map(item).join('')}</ol></details>`:''}</div>`;
}
async function decorateLeadHandovers(){
 const boxes=[...document.querySelectorAll('[data-lead-handovers]')];if(!boxes.length)return;
 const epoch=++leadHandoverEpoch,actor=me?.user_id,missing=boxes.map(b=>b.dataset.leadHandovers).filter(id=>!leadHandovers.has(id));
 if(missing.length){
  const result=await client.from('sales_lead_events').select('lead_id,action,assigned_user_id,from_user_id,actor_user_id,note,created_at').eq('action','handover').in('lead_id',missing).order('created_at').limit(1000);
  if(epoch!==leadHandoverEpoch||me?.user_id!==actor||result.error)return;
  for(const id of missing)leadHandovers.set(id,[]);
  for(const e of result.data||[])leadHandovers.get(e.lead_id)?.push(e);
 }
 for(const box of boxes)if(box.isConnected)box.innerHTML=leadHandoverHtml(leadHandovers.get(box.dataset.leadHandovers));
}
function leadOverdue(row,today=leadToday()){return !['won','lost'].includes(row.stage)&&!!row.next_action_on&&row.next_action_on<today;}
function leadClientLabel(row){const org=orgIndex.get(row.organization_id);return org?`${org.name}${org.location?' · '+org.location:''}`:[row.caller_organization,row.caller_name].filter(Boolean).join(' · ')||'Unknown caller';}
function leadMoney(minor,currency){return minor==null||minor===''?'':new Intl.NumberFormat('en-TZ',{style:'currency',currency:currency||'TZS'}).format(Number(minor)/100);}
const leadFilters=[['open','Open'],['new','Needs a salesperson'],['mine','Mine'],['won','Won'],['lost','Lost'],['all','All']];
function leadMatchesFilter(row,filter,actor){
 const open=!['won','lost'].includes(row.stage);
 return filter==='all'||(filter==='open'?open:filter==='new'?row.stage==='inquiry':filter==='mine'?open&&row.owner_user_id===actor:row.stage===filter);
}
// The order does not depend on the filter or the search, so the whole list is sorted once (again when it is
// replaced or the day changes) with each lead's keys worked out once; a filter or a typed search then only picks
// rows in that order. A lead's search text is kept until the client list or its salesperson's name changes.
let leadSortCache=null;const leadSearchText=new WeakMap();
function leadSorted(rows,today){
 const cache=leadSortCache;if(cache?.rows===rows&&cache.length===rows.length&&cache.today===today)return cache.sorted;
 const keyed=rows.map(row=>({row,closed:['won','lost'].includes(row.stage)?1:0,overdue:leadOverdue(row,today)?1:0,next:String(row.next_action_on||'9999'),created:String(row.created_at)}));
 keyed.sort((a,b)=>a.closed-b.closed||b.overdue-a.overdue||a.next.localeCompare(b.next)||b.created.localeCompare(a.created)||a.row.id.localeCompare(b.row.id));
 leadSortCache={rows,length:rows.length,today,sorted:keyed.map(k=>k.row)};return leadSortCache.sorted;
}
function leadText(row){
 const org=typeof orgIndex==='undefined'?null:orgIndex,owner=employeeName(row.owner_user_id);let hit=leadSearchText.get(row);
 if(!hit||hit.org!==org||hit.owner!==owner){hit={org,owner,text:[row.lead_number,row.subject,row.details,row.caller_name,row.caller_phone,row.caller_organization,leadRoles[row.caller_role],leadClientLabel(row),owner,row.next_action].join(' ').toLowerCase()};leadSearchText.set(row,hit);}
 return hit.text;
}
// Tab counts, once per list and person.
let leadCountCache=null;
function leadCounts(rows,actor){
 const cache=leadCountCache;if(cache?.rows===rows&&cache.length===rows.length&&cache.actor===actor)return cache.counts;
 const counts=Object.fromEntries(leadFilters.map(([key])=>[key,rows.filter(row=>leadMatchesFilter(row,key,actor)).length]));
 leadCountCache={rows,length:rows.length,actor,counts};return counts;
}
// Search text is made for every lead in idle moments after the page is drawn, so the first letter typed does not
// wait for thousands of them. Stops when the list is replaced.
let leadWarming=null;
function leadWarmSearch(){
 const rows=leadRows;if(leadWarming===rows||!rows.length)return;leadWarming=rows;let at=0;
 const slice=deadline=>{if(leadWarming!==rows)return;const until=performance.now()+(deadline?Math.min(Math.max(deadline.timeRemaining(),4),10):8);while(at<rows.length&&performance.now()<until)for(const end=Math.min(rows.length,at+200);at<end;at++)leadText(rows[at]);if(at<rows.length)next();};
 const next=()=>typeof requestIdleCallback==='function'?requestIdleCallback(slice,{timeout:2000}):setTimeout(slice,20);
 next();
}
function leadVisibleRows(rows,{filter,search,actor,today=leadToday()}){
 const q=String(search||'').trim().toLowerCase();
 return leadSorted(rows,today).filter(row=>leadMatchesFilter(row,filter,actor)&&(!q||leadText(row).includes(q)));
}
function leadActions(row){
 const open=!['won','lost'].includes(row.stage),buttons=[];
 if(open)buttons.push(`<button type="button" data-lead-edit="${esc(row.id)}">Edit</button>`);
 if(row.stage==='inquiry')buttons.push(`<button type="button" data-lead-action="qualify" data-id="${esc(row.id)}">Pass to sales as lead</button>`);
 else if(open)buttons.push(`<button type="button" data-lead-handover="${esc(row.id)}">Hand over</button>`);
 if(['lead','opportunity'].includes(row.stage)&&(typeof hasArea!=='function'||hasArea('proformas')))buttons.push(`<button type="button" data-lead-proforma="${esc(row.id)}">Create Pro forma</button>`);
 if(['lead','opportunity'].includes(row.stage))buttons.push(`<button type="button" data-lead-action="won" data-id="${esc(row.id)}">Mark won</button>`);
 if(open)buttons.push(`<button type="button" data-lead-action="lost" data-id="${esc(row.id)}">Mark lost</button>`);
 if(row.stage==='lost')buttons.push(`<button type="button" data-lead-action="reopen" data-id="${esc(row.id)}">Reopen</button>`);
 buttons.push(`<button type="button" data-lead-history="${esc(row.id)}">History</button>`);
 return buttons.join('');
}
function leadCard(row){
 const proforma=salesProformas.find(p=>p.id===row.proforma_id),overdue=leadOverdue(row);
 return `<article class="card lead-card${overdue?' attention':''}" data-lead-card="${esc(row.id)}"><div class="heading"><div><small>${esc(row.lead_number)} · ${esc(leadSources[row.source]||row.source)}</small><h2>${esc(row.subject)}</h2><p>${esc(leadClientLabel(row))}</p></div><span class="tag lead-tag-${esc(row.stage)}">${esc(leadStages[row.stage]||row.stage)}</span></div>${leadNextStepHtml(row)}${leadSpokeToHtml(row)}${row.details?`<p class="lead-details">${esc(row.details)}</p>`:''}<div class="details"><div><small>Salesperson</small>${esc(row.owner_user_id?employeeName(row.owner_user_id):'Not assigned')}</div>${row.estimated_value_minor!=null&&row.estimated_value_minor!==''?`<div><small>Estimated value</small>${esc(leadMoney(row.estimated_value_minor,row.currency))}</div>`:''}${row.stage==='won'?`<div><small>Pro forma</small>${esc(proforma?.document_number||'Linked')}</div>`:''}${row.stage==='lost'?`<div><small>Lost because</small>${esc(row.lost_reason)}</div>`:''}</div><div data-lead-handovers="${esc(row.id)}">${leadHandoverHtml(leadHandovers.get(row.id))}</div><div class="actions">${leadActions(row)}</div><div data-lead-history-output="${esc(row.id)}"></div></article>`;
}
function leadEmployeeOptions(selected=''){return [...employeeDirectory.values()].filter(row=>row.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id))).map(row=>inventoryOption(row.user_id,employeeName(row.user_id),row.user_id===selected)).join('');}
function leadEditor(row){
 const existing=row?Boolean(row.organization_id):true;
 // Values no longer asked for (estimated value, currency) are carried through unchanged when editing.
 return `<section class="card document-editor lead-editor"><div class="heading"><div><small>${row?esc(row.lead_number):'NEW'}</small><h2>${row?'Edit lead':'New inquiry'}</h2></div><button type="button" id="closeLeadEditor">Close</button></div><form id="leadForm" data-id="${esc(row?.id||'')}" data-version="${row?.version||0}"><input type="hidden" name="currency" value="${esc(row?.currency||'TZS')}"><input type="hidden" name="estimatedValue" value="${row?.estimated_value_minor==null||row?.estimated_value_minor===''?'':(Number(row.estimated_value_minor)/100).toFixed(2)}">
 <fieldset class="lead-step"><legend>1. Who is it?</legend><div class="lead-who" role="radiogroup" aria-label="Who is it"><label><input type="radio" name="who" value="client" ${existing?'checked':''}> A client we already have</label><label><input type="radio" name="who" value="new" ${existing?'':'checked'}> Someone new</label></div>
 <div class="grid" data-who="client"${existing?'':' hidden'}><label><span>Client</span><select name="organizationId" data-lookup-rows="organizations"><option value="">Choose the client</option>${salesOrganizationOptions(row?.organization_id||'')}</select></label><label><span>Person we spoke to · optional</span><select name="contactId"><option value="">Not a named contact</option>${salesContactOptions(row?.organization_id||'',row?.contact_id||'')}</select></label><label data-caller-extra${row?.contact_id?' hidden':''}><span>Their name · if not a named contact</span><input name="clientCallerName" maxlength="200" value="${esc(existing&&!row?.contact_id?row?.caller_name||'':'')}"></label><label data-caller-extra${row?.contact_id?' hidden':''}><span>Their phone number · optional</span><input name="clientCallerPhone" maxlength="60" inputmode="tel" placeholder="+255…" value="${esc(existing&&!row?.contact_id?row?.caller_phone||'':'')}"></label></div>
 <div class="grid" data-who="new"${existing?' hidden':''}><label><span>Their name</span><input name="callerName" maxlength="200" value="${esc(row?.caller_name||'')}"></label><label><span>Their phone number</span><input name="callerPhone" maxlength="60" inputmode="tel" placeholder="+255…" value="${esc(row?.caller_phone||'')}"></label><label class="wide"><span>Hospital, lab or company · optional</span><input name="callerOrganization" maxlength="300" value="${esc(row?.caller_organization||'')}"></label></div>
 <label class="lead-role-pick"><span>Their role</span><select name="callerRole" required><option value="">Choose their role</option>${Object.entries(leadRoles).map(([key,label])=>`<option value="${key}" ${row?.caller_role===key?'selected':''}>${label}</option>`).join('')}</select><small class="muted">Sales handles a buyer very differently from a doctor.</small></label></fieldset>
 <fieldset class="lead-step"><legend>2. What do they need?</legend><label><span>In a few words</span><input name="subject" required minlength="2" maxlength="300" placeholder="For example: price for 2 centrifuges" value="${esc(row?.subject||'')}"></label><label><span>More detail · optional</span><textarea name="details" maxlength="8000" placeholder="Products, quantities, machine model…">${esc(row?.details||'')}</textarea></label></fieldset>
 <fieldset class="lead-step"><legend>3. How did they contact us?</legend><div class="lead-sources">${Object.entries(leadSources).map(([key,label])=>`<label><input type="radio" name="source" value="${key}" ${(row?.source||'phone')===key?'checked':''}> ${label}</label>`).join('')}</div></fieldset>
 <fieldset class="lead-step"><legend>4. Who follows up, and when?</legend><div class="grid">${row?'':`<label><span>Salesperson · leave empty if you are not sure</span><select name="ownerUserId"><option value="">Not decided yet</option>${leadEmployeeOptions('')}</select></label>`}<label><span>Follow up on</span><input name="nextActionOn" type="date" value="${esc(row?.next_action_on||'')}"></label><label class="wide"><span>What to do next · optional</span><input name="nextAction" maxlength="500" placeholder="For example: call back with the price" value="${esc(row?.next_action||'')}"></label></div></fieldset>
 <p role="alert" id="leadFormError"></p><div class="actions"><button type="submit">${row?'Save changes':'Save inquiry'}</button></div></form></section>`;
}
function leadFormValues(form){
 const f=new FormData(form),who=f.get('who')||'client',organizationId=who==='client'?f.get('organizationId')||'':'',value=String(f.get('estimatedValue')||'').trim();
 const contactId=organizationId?f.get('contactId')||'':'',clientCaller=who==='client'&&!contactId;
 const fields={organization_id:organizationId,contact_id:contactId,caller_name:who==='new'?String(f.get('callerName')||'').trim():clientCaller?String(f.get('clientCallerName')||'').trim():'',caller_phone:who==='new'?String(f.get('callerPhone')||'').trim():clientCaller?String(f.get('clientCallerPhone')||'').trim():'',caller_role:f.get('callerRole')||'',caller_organization:who==='new'?String(f.get('callerOrganization')||'').trim():'',source:f.get('source')||'phone',subject:String(f.get('subject')||'').trim(),details:String(f.get('details')||''),next_action:String(f.get('nextAction')||'').trim(),next_action_on:f.get('nextActionOn')||'',currency:f.get('currency')||'TZS',estimated_value_minor:''};
 if(f.has('ownerUserId'))fields.owner_user_id=f.get('ownerUserId')||'';
 if(value){const amount=Number(value);if(!Number.isFinite(amount)||amount<0)throw Error('Enter a valid estimated value.');fields.estimated_value_minor=String(Math.round(amount*100));}
 if(fields.subject.length<2)throw Error('Describe what the customer needs.');
 if(who==='client'&&!fields.organization_id)throw Error('Choose the client, or pick Someone new.');
 if(who==='new'&&(fields.caller_name.length<2||fields.caller_phone.replace(/\D/g,'').length<6))throw Error('Enter their name and phone number.');
 if(!fields.caller_role)throw Error('Choose the role of the person we spoke to.');
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
 leadPendingSave=null;leadEditing='';await leadRefreshOne(saved.id);message(`${saved.lead_number} saved.`);
}
// Every open lead is loaded; won and lost leads only from the last six months, so the page stays fast as years
// of leads build up. Typing in Search also looks up older leads on the server.
const leadRecentDays=183,leadColumns='id,lead_number,stage,source,organization_id,contact_id,caller_name,caller_phone,caller_organization,caller_role,subject,details,estimated_value_minor,currency,owner_user_id,next_action,next_action_on,lost_reason,proforma_id,version,created_by,created_at,updated_at';
let leadSearchTimer=0;
function leadSearchTerm(text){return String(text||'').replace(/[^\p{L}\p{N}@.+\- ]/gu,' ').trim().replace(/\s+/g,' ');}
async function leadSearchOlder(text){
 const term=leadSearchTerm(text),epoch=leadEpoch,actor=me?.user_id;if(term.length<3)return;
 const like=`*${term}*`;
 const result=await client.from('sales_leads').select(leadColumns).or(['lead_number','subject','caller_name','caller_phone','caller_organization'].map(c=>`${c}.ilike.${like}`).join(',')).order('updated_at',{ascending:false}).limit(50);
 if(result.error||epoch!==leadEpoch||me?.user_id!==actor||view!=='leads'||leadSearch!==text)return;
 const known=new Set(leadRows.map(r=>r.id)),extra=(result.data||[]).filter(r=>!known.has(r.id));
 if(!extra.length)return;
 leadRows=leadRows.concat(extra);const box=$('#leadSearch');if(box)renderSearchPreservingPosition(box,renderLeads);else renderLeads();
}
// After a save or a step, only that lead is read again, so the page stays quick however many leads are listed.
async function leadRefreshOne(id){
 if(!leadLoaded||!id)return leadsWorkspace(true);
 const epoch=leadEpoch,actor=me?.user_id;
 const result=await client.from('sales_leads').select(leadColumns).eq('id',id).maybeSingle();
 if(result.error)throw Error(result.error.message);
 if(epoch!==leadEpoch||me?.user_id!==actor)return;
 leadRows=leadRows.filter(r=>r.id!==id);if(result.data)leadRows.push(result.data);leadHandovers.delete(id);
 if(view==='leads')renderLeads();
}
async function loadLeads(){
 const epoch=++leadEpoch,actor=me?.user_id;
 const since=new Date(Date.now()-leadRecentDays*864e5).toISOString();
 const [rows,proformas]=await Promise.all([all('sales_leads',leadColumns,q=>q.or(`stage.not.in.(won,lost),updated_at.gte.${since}`)),salesLoaded?Promise.resolve(null):all('sales_proformas','id,document_number,organization_id,status,deleted_at')]);
 if(epoch!==leadEpoch||me?.user_id!==actor)return false;
 leadRows=rows;leadHandovers=new Map();if(proformas&&!salesLoaded)salesProformas=proformas;leadLoaded=true;leadLoadError='';return true;
}
async function leadsWorkspace(force=false){
 const actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!leadLoaded){
  $('#content').innerHTML='<p role="status">Loading inquiries and leads…</p>';
  try{if(!(await loadLeads()))return;}catch(error){if(me?.user_id!==actor)return;leadLoadError=error.message;leadLoaded=false;}
 }
 if(view!=='leads'||me?.user_id!==actor)return;
 if(leadFocusId&&!leadRows.some(r=>r.id===leadFocusId)){const older=await client.from('sales_leads').select(leadColumns).eq('id',leadFocusId).maybeSingle();if(view!=='leads'||me?.user_id!==actor)return;if(older.data)leadRows=leadRows.concat(older.data);}
 if(leadFocusId){const row=leadRows.find(r=>r.id===leadFocusId);leadFocusId='';if(row){leadFilter='all';leadSearch=row.lead_number;}}
 renderLeads();
}
function renderLeads(){
 const rows=leadVisibleRows(leadRows,{filter:leadFilter,search:leadSearch,actor:me?.user_id});
 const pages=Math.max(1,Math.ceil(rows.length/20));leadPage=Math.min(Math.max(leadPage,0),pages-1);
 const editing=leadEditing==='new'?null:leadRows.find(row=>row.id===leadEditing);
 const count=key=>leadCounts(leadRows,me?.user_id)[key];
 $('#content').innerHTML=`<section class="leads-workspace"><div class="heading"><div><small>ORDERS</small><h1>Leads</h1><p class="muted">Record every call, message or walk-in here, then follow it up until it becomes a Pro forma. Late follow-ups are at the top.</p></div><div class="actions"><button type="button" id="leadRefresh">Refresh</button><button type="button" id="newLead" class="primary-action">+ New inquiry</button></div></div>${leadLoadError?`<p class="notice error" role="alert">Leads could not load: ${esc(leadLoadError)}. Nothing was changed.</p>`:''}${leadEditing?leadEditor(editing):''}<div class="tabs" role="group" aria-label="Show leads">${leadFilters.map(([key,label])=>{const n=key==='all'?0:count(key);return `<button type="button" data-lead-filter="${key}" class="${leadFilter===key?'active':''}" aria-pressed="${leadFilter===key}">${label}${n?` · ${n}`:''}</button>`}).join('')}</div>${['won','lost','all'].includes(leadFilter)?'<p class="muted">Showing closed leads from the last 6 months. Search finds older ones.</p>':''}<label class="search"><span>Search</span><input id="leadSearch" type="search" placeholder="Name, phone, client, product or LD number" value="${esc(leadSearch)}"></label>${rows.slice(leadPage*20,leadPage*20+20).map(leadCard).join('')||`<p class="muted">${leadRows.length?'No leads here.':'No leads yet. Press + New inquiry to record one.'}</p>`}${pages>1?`<div class="actions"><button type="button" id="leadPrev" ${leadPage===0?'disabled':''}>Previous</button><span>Page ${leadPage+1} of ${pages}</span><button type="button" id="leadNext" ${leadPage>=pages-1?'disabled':''}>Next</button></div>`:''}</section>`;
 bindLeads();leadWarmSearch();
}
function bindLeads(){
 $('#leadRefresh').onclick=()=>run(()=>leadsWorkspace(true));
 $('#newLead')?.addEventListener('click',()=>{leadEditing='new';leadPendingSave=null;renderLeads();$('#leadForm [name="subject"]')?.focus();});
 $('#closeLeadEditor')?.addEventListener('click',()=>{leadEditing='';leadPendingSave=null;renderLeads();});
 const form=$('#leadForm');
 if(form){
  const callerExtra=()=>form.querySelectorAll('[data-caller-extra]').forEach(label=>label.hidden=!!form.elements.contactId.value);
  form.elements.organizationId.onchange=event=>{form.elements.contactId.innerHTML='<option value="">Not a named contact</option>'+salesContactOptions(event.target.value);callerExtra();};
  form.elements.contactId.onchange=callerExtra;
  form.querySelectorAll('[name="who"]').forEach(input=>input.onchange=()=>form.querySelectorAll('[data-who]').forEach(group=>group.hidden=group.dataset.who!==input.value));
  form.onsubmit=event=>{event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;$('#leadFormError').textContent='';
   run(async()=>{try{await saveLeadForm(form)}catch(error){if($('#leadFormError'))$('#leadFormError').textContent=error.message;throw error;}finally{if(button.isConnected)button.disabled=false;}});};
 }
 $('#leadSearch').oninput=event=>{leadSearch=event.target.value;leadPage=0;renderSearchPreservingPosition(event.target,renderLeads,150);clearTimeout(leadSearchTimer);const text=leadSearch;leadSearchTimer=setTimeout(()=>leadSearchOlder(text).catch(()=>{}),400);};
 if($('#leadPrev')){$('#leadPrev').onclick=()=>{leadPage--;renderLeads();};$('#leadNext').onclick=()=>{leadPage++;renderLeads();};}
 document.querySelectorAll('[data-lead-filter]').forEach(button=>button.onclick=()=>{leadFilter=button.dataset.leadFilter;leadPage=0;renderLeads();});
 document.querySelectorAll('[data-lead-edit]').forEach(button=>button.onclick=()=>{leadEditing=button.dataset.leadEdit;renderLeads();$('#leadForm')?.scrollIntoView({block:'start'});});
 document.querySelectorAll('[data-lead-action]').forEach(button=>button.onclick=()=>openLeadAction(leadRows.find(row=>row.id===button.dataset.id),button.dataset.leadAction));
 document.querySelectorAll('[data-lead-proforma]').forEach(button=>button.onclick=()=>startProformaFromLead(leadRows.find(row=>row.id===button.dataset.leadProforma)));
 document.querySelectorAll('[data-lead-history]').forEach(button=>button.onclick=()=>run(()=>showLeadHistory(button.dataset.leadHistory)));
 document.querySelectorAll('[data-lead-handover]').forEach(button=>button.onclick=()=>openLeadHandover(leadRows.find(row=>row.id===button.dataset.leadHandover)));
 decorateLeadHandovers().catch(()=>{});
 // The salesperson is the person responsible for a lead, so lead cards do not repeat the responsible-person bar.
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
  await leadRefreshOne(row.id);message(`${row.lead_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
// Hand a lead to another salesperson. The note (5 words or more) tells them what the customer wants and what to do;
// the lead then appears on their "Work handed to me" list with the note and the next step.
function openLeadHandover(row){
 if(!row)return;
 const options=[...employeeDirectory.values()].filter(e=>e.active!==false&&e.user_id!==row.owner_user_id).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id))).map(e=>inventoryOption(e.user_id,employeeName(e.user_id))).join('');
 const fields=`<p><strong>${esc(row.lead_number)}</strong> · ${esc(row.subject)} · ${esc(leadClientLabel(row))}<br><small>Now with ${esc(row.owner_user_id?employeeName(row.owner_user_id):'nobody')}</small></p><label><span>Hand over to</span><select name="assignee" required data-lookup><option value="">Type a name to search</option>${options}</select></label><label><span>Handover note · at least 5 words</span><textarea name="note" required minlength="10" maxlength="1000" placeholder="For example: Head of radiology at Aga Khan, wants a general ultrasound, compare quotes, call Mr Bob 0556…"></textarea></label><div class="grid"><label><span>Next step</span><input name="nextAction" maxlength="500" placeholder="For example: Call Mr Bob" value="${esc(row.next_action||'')}"></label><label><span>By</span><input name="nextActionOn" type="date" min="${leadToday()}" value="${esc(row.next_action_on&&row.next_action_on>=leadToday()?row.next_action_on:'')}"></label></div><p class="muted">They will see this lead, your note and the next step in their Work handed to me list. Your name and the time are kept on the lead.</p>`;
 actionForm('Hand over lead',fields,async values=>{
  const note=String(values.note||'').trim().replace(/\s+/g,' ');
  if(!values.assignee)throw Error('Choose who takes over the lead.');
  if(leadWords(note)<5)throw Error('Write a handover note of at least 5 words, so they know what to do.');
  const actor=me?.user_id,result=await client.rpc('hand_over_sales_lead',{p_id:row.id,p_expected_version:row.version,p_new_owner_user_id:values.assignee,p_note:note,p_next_action:String(values.nextAction||'').trim()||null,p_next_action_on:values.nextActionOn||null});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the lead.');
  if(result.error)throw Error(result.error.message);
  await leadRefreshOne(row.id);message(`${row.lead_number} handed over to ${employeeName(values.assignee)}.`);
 });
}
function startProformaFromLead(row){
 if(!row)return;
 if(!row.organization_id){message('Add this caller to the client list first, then choose the client on the lead (Edit), so the Pro forma has a real customer.',true);return;}
 salesPrefill={organizationId:row.organization_id,contactId:row.contact_id||'',leadNumber:row.lead_number};
 view='sales';salesSection='proformas';salesEditing='new';render();
 message(`New Pro forma for ${row.lead_number}. After saving it, return to the lead and press Mark won.`);
}
const leadEventLabels={create:'recorded',edit:'edited',qualify:'passed to sales',assign:'salesperson set',handover:'handed over',opportunity:'opportunity',won:'won',lost:'lost',reopen:'reopened'};
async function showLeadHistory(id){
 const output=document.querySelector(`[data-lead-history-output="${CSS.escape(id)}"]`),actor=me?.user_id;if(!output)return;
 output.textContent='Loading history…';
 const result=await client.from('sales_lead_events').select('action,from_stage,to_stage,assigned_user_id,from_user_id,note,actor_user_id,created_at').eq('lead_id',id).order('created_at').limit(200);
 if(me?.user_id!==actor||!output.isConnected)return;
 if(result.error){output.textContent=`History could not load: ${result.error.message}`;return;}
 output.innerHTML=`<ol class="lead-history">${(result.data||[]).map(event=>`<li>${esc(new Date(event.created_at).toLocaleString())} · <strong>${esc(employeeName(event.actor_user_id))}</strong> · ${esc(leadEventLabels[event.action]||event.action)}${event.action==='handover'?` from ${esc(employeeName(event.from_user_id))} to ${esc(employeeName(event.assigned_user_id))}`:''}${event.from_stage&&event.from_stage!==event.to_stage?` · ${esc(leadStages[event.from_stage])} → ${esc(leadStages[event.to_stage])}`:''}${event.assigned_user_id&&event.action!=='handover'?` · salesperson ${esc(employeeName(event.assigned_user_id))}`:''}${event.note?` · ${esc(event.note)}`:''}</li>`).join('')}</ol>`;
}
