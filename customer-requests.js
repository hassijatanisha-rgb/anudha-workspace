'use strict';
// Website requests (migration 062): inquiries and quote requests (each also opened a lead in Leads), complaints and
// support requests. Every request has a number the customer keeps (REQ-2026-000123). Staff take a request, give it to
// someone, mark it resolved with what was done, close or reopen it; writes go through advance_customer_request only.
// If the automatic confirmation could not be sent, a button opens WhatsApp with the confirmation ready to send.
let requestSection='inquiries',requestFilter='open',requestRows=[],requestLoaded=false,requestEpoch=0,requestSearch='';
const requestKinds={inquiry:'Inquiry',quote:'Quote request',complaint:'Complaint',support:'Support request'};
const requestStatuses={received:'New',in_progress:'Being handled',resolved:'Resolved',closed:'Closed'};
const requestFilters=[['open','Open'],['new','New, nobody yet'],['mine','Mine'],['done','Resolved or closed'],['all','All']];
const requestSections={inquiries:{title:'Inquiries',kinds:['inquiry','quote'],intro:'Questions and quote requests from the website. Each one is also in Leads as "Needs a salesperson".'},
 complaints:{title:'Complaints',kinds:['complaint','support'],intro:'Complaints and support requests from the website. Take one, sort it out, and write what was done.'}};
const requestRecentDays=183;
function clearCustomerRequests(){requestEpoch++;requestRows=[];requestLoaded=false;}
function openRequestSection(section){requestSection=requestSections[section]?section:'inquiries';requestFilter='open';requestSearch='';}
function requestMatches(row,filter,actor){
 const open=['received','in_progress'].includes(row.status);
 return filter==='all'||(filter==='open'?open:filter==='new'?row.status==='received':filter==='mine'?open&&row.assigned_user_id===actor:!open);
}
function requestVisible(rows,{section,filter,search,actor}){
 const kinds=requestSections[section].kinds,q=String(search||'').trim().toLowerCase();
 return rows.filter(row=>kinds.includes(row.kind)&&requestMatches(row,filter,actor))
  .filter(row=>!q||[row.request_number,row.name,row.phone,row.email,row.organization,row.product,row.message].join(' ').toLowerCase().includes(q))
  .sort((a,b)=>Number(b.status==='received')-Number(a.status==='received')||String(b.created_at).localeCompare(String(a.created_at)));
}
// WhatsApp link to the customer, with a message ready to send (the number in international form: 07… → 2557…).
function requestWhatsAppNumber(phone){const digits=String(phone||'').replace(/[^0-9]/g,'');return /^0[67][0-9]{8}$/.test(digits)?'255'+digits.slice(1):digits;}
function requestConfirmationText(row){return `Hello ${row.name}, thank you for contacting Anudha Limited. We have received your ${(requestKinds[row.kind]||'request').toLowerCase()}. Your request number is ${row.request_number}. Our team will contact you soon.`;}
function requestWhatsAppLink(row,text){return `https://wa.me/${requestWhatsAppNumber(row.phone)}?text=${encodeURIComponent(text)}`;}
function requestWhen(value){return value?new Date(value).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';}
function requestCard(row){
 const open=['received','in_progress'].includes(row.status),buttons=[];
 if(open&&row.assigned_user_id!==me?.user_id)buttons.push(`<button type="button" data-request-action="take" data-id="${esc(row.id)}">Take it</button>`);
 if(open)buttons.push(`<button type="button" data-request-action="assign" data-id="${esc(row.id)}">Give to…</button>`,`<button type="button" class="primary-action" data-request-action="resolve" data-id="${esc(row.id)}">Mark resolved</button>`,`<button type="button" class="danger" data-request-action="close" data-id="${esc(row.id)}">Close</button>`);
 if(row.status==='resolved')buttons.push(`<button type="button" data-request-action="close" data-id="${esc(row.id)}">Close</button>`);
 if(!open)buttons.push(`<button type="button" data-request-action="reopen" data-id="${esc(row.id)}">Reopen</button>`);
 if(row.lead_id)buttons.push(`<button type="button" data-request-lead="${esc(row.lead_id)}">Open lead</button>`);
 const confirmation=row.confirmation_status==='sent'?'<span class="tag request-sent">Confirmation sent</span>'
  :`<a class="button" href="${esc(requestWhatsAppLink(row,requestConfirmationText(row)))}" target="_blank" rel="noopener">Send confirmation on WhatsApp</a><span class="muted"> Not sent automatically${row.confirmation_detail?`: ${esc(row.confirmation_detail)}`:''}</span>`;
 return `<article class="card request-card request-${esc(row.status)}" data-request-card="${esc(row.id)}"><div class="heading"><div><span class="travel-tag request-tag-${esc(row.status)}">${esc(requestStatuses[row.status]||row.status)}</span><h3>${esc(requestKinds[row.kind]||row.kind)}${row.product?` · ${esc(row.product)}`:''}</h3><p>${esc(row.name)}${row.organization?` · ${esc(row.organization)}`:''}</p></div><small>${esc(row.request_number)}<br>${esc(requestWhen(row.created_at))}</small></div>
 <p class="request-message">${esc(row.message)}</p>
 <div class="details"><div><small>Phone</small><a href="tel:${esc(row.phone)}">${esc(row.phone)}</a> · <a href="${esc(requestWhatsAppLink(row,`Hello ${row.name}, this is Anudha Limited about your request ${row.request_number}.`))}" target="_blank" rel="noopener">WhatsApp</a></div>${row.email?`<div><small>Email</small><a href="mailto:${esc(row.email)}?subject=${encodeURIComponent('Your request '+row.request_number)}">${esc(row.email)}</a></div>`:''}${row.quantity?`<div><small>Quantity</small>${esc(row.quantity)}</div>`:''}<div><small>Prefers</small>${esc({whatsapp:'WhatsApp',email:'Email',phone:'Phone call'}[row.contact_channel]||row.contact_channel)}</div><div><small>Handled by</small>${row.assigned_user_id?esc(employeeName(row.assigned_user_id)):'Nobody yet'}</div></div>
 ${row.resolution_note?`<p><small>What was done:</small> ${esc(row.resolution_note)}</p>`:''}
 <div class="actions request-confirmation">${confirmation}</div>
 ${buttons.length?`<div class="actions">${buttons.join('')}</div>`:''}</article>`;
}
async function customerRequestsWorkspace(force=false){
 const epoch=++requestEpoch,actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!requestLoaded){
  $('#content').innerHTML='<p role="status">Loading requests…</p>';
  const since=new Date(Date.now()-requestRecentDays*864e5).toISOString();
  try{requestRows=await all('customer_requests','*',q=>q.or(`status.in.(received,in_progress),updated_at.gte.${since}`));}
  catch(error){if(epoch!==requestEpoch||me?.user_id!==actor)return;$('#content').innerHTML=`<h1>${esc(requestSections[requestSection].title)}</h1><p role="alert">Requests could not load: ${esc(error.message)}</p><button type="button" id="requestRetry">Try again</button>`;$('#requestRetry').onclick=()=>run(()=>customerRequestsWorkspace(true));return;}
  if(epoch!==requestEpoch||me?.user_id!==actor||view!=='requests')return;
  requestLoaded=true;
 }
 renderCustomerRequests();
}
function renderCustomerRequests(){
 const section=requestSections[requestSection],actor=me?.user_id,rows=requestVisible(requestRows,{section:requestSection,filter:requestFilter,search:requestSearch,actor});
 const count=key=>requestVisible(requestRows,{section:requestSection,filter:key,search:'',actor}).length;
 $('#content').innerHTML=`<section class="requests-workspace"><div class="heading"><div><small>FROM THE WEBSITE</small><h1>${esc(section.title)}</h1><p class="muted">${esc(section.intro)}</p></div><div class="actions"><button type="button" id="requestRefresh">Refresh</button></div></div>
 <div class="tabs" role="group" aria-label="Show requests">${requestFilters.map(([key,label])=>{const n=['all','done'].includes(key)?0:count(key);return `<button type="button" data-request-filter="${key}" class="${requestFilter===key?'active':''}" aria-pressed="${requestFilter===key}">${label}${n?` · ${n}`:''}</button>`}).join('')}</div>
 ${['done','all'].includes(requestFilter)?'<p class="muted">Showing finished requests from the last 6 months.</p>':''}
 <label class="search"><span>Search</span><input id="requestSearch" type="search" placeholder="Request number, name, phone, product" value="${esc(requestSearch)}"></label>
 ${rows.map(requestCard).join('')||`<p class="muted">${requestRows.length?'Nothing here.':'No requests yet. They appear here as soon as someone sends one from the website.'}</p>`}</section>`;
 $('#requestRefresh').onclick=()=>run(()=>customerRequestsWorkspace(true));
 document.querySelectorAll('[data-request-filter]').forEach(button=>button.onclick=()=>{requestFilter=button.dataset.requestFilter;renderCustomerRequests();});
 $('#requestSearch').oninput=event=>{requestSearch=event.target.value;renderSearchPreservingPosition(event.target,renderCustomerRequests,150);};
 document.querySelectorAll('[data-request-action]').forEach(button=>button.onclick=()=>openRequestAction(requestRows.find(row=>row.id===button.dataset.id),button.dataset.requestAction));
 document.querySelectorAll('[data-request-lead]').forEach(button=>button.onclick=()=>{if(typeof focusLead==='function'){focusLead(button.dataset.requestLead);render();}});
}
function openRequestAction(row,action){
 if(!row)return;
 const titles={take:'Take this request',assign:'Give to someone',resolve:'Mark resolved',close:'Close request',reopen:'Reopen request'};
 const employees=[...employeeDirectory.values()].filter(e=>e.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 const fields=`<p><strong>${esc(row.request_number)}</strong> · ${esc(row.name)}</p>${action==='assign'?`<label><span>Who handles it</span><select name="assignee" required><option value="">Choose employee</option>${employees.map(e=>`<option value="${esc(e.user_id)}">${esc(employeeName(e.user_id))}</option>`).join('')}</select></label>`:''}${['resolve','close','assign'].includes(action)?`<label><span>${action==='resolve'?'What was done for the customer':action==='close'?'Why it is closed':'Note (optional)'}</span><textarea name="note" ${action==='assign'?'':row.status==='resolved'&&action==='close'?'':'required minlength="3"'} maxlength="2000"></textarea></label>`:''}`;
 actionForm(titles[action],fields,async values=>{
  const actor=me?.user_id,result=await client.rpc('advance_customer_request',{p_id:row.id,p_expected_version:row.version,p_action:action,p_assigned_user_id:values.assignee||null,p_note:values.note||''});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the request.');
  if(result.error)throw Error(result.error.message);
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved){requestRows=requestRows.map(r=>r.id===saved.id?saved:r);}
  if(view==='requests')renderCustomerRequests();message(`${row.request_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
