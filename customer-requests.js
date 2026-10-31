'use strict';
// Website requests (migration 062): inquiries and quote requests (each also opened a lead in Leads), complaints and
// support requests. Every request has a number the customer keeps (REQ-2026-000123). Staff take a request, give it to
// someone, mark it resolved with what was done, close or reopen it; writes go through advance_customer_request only.
// If the automatic confirmation could not be sent, a button opens WhatsApp with the confirmation ready to send.
let requestSection='inquiries',requestFilter='open',requestRows=[],requestLoaded=false,requestEpoch=0,requestSearch='';
let requestPage=0,requestPageData=null,requestSelected='',requestLoadError='',requestActor=null;
const requestKinds={inquiry:'Inquiry',quote:'Quote request',complaint:'Complaint',support:'Support request'};
const requestStatuses={received:'New',in_progress:'Being handled',resolved:'Resolved',closed:'Closed'};
const requestFilters=[['open','Open'],['new','New, nobody yet'],['mine','Mine'],['done','Resolved or closed'],['all','All']];
const requestSections={inquiries:{title:'Inquiries',kinds:['inquiry','quote'],intro:'Questions and quote requests from the website. Each one is also in Leads as "Needs a salesperson".'},
 complaints:{title:'Complaints',kinds:['complaint','support'],intro:'Complaints and support requests from the website. Take one, sort it out, and write what was done.'}};
const requestRecentDays=183;
function clearCustomerRequests(){requestEpoch++;requestRows=[];requestLoaded=false;requestSearch='';requestFilter='open';requestPage=0;requestPageData=null;requestSelected='';requestLoadError='';requestActor=null;}
function openRequestSection(section){requestEpoch++;requestSection=requestSections[section]?section:'inquiries';requestFilter='open';requestSearch='';requestPage=0;requestPageData=null;requestSelected='';requestRows=[];}
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
function requestStatusTone(status){return statusTone({received:'waiting',in_progress:'in_progress',resolved:'resolved',closed:'archived'}[status]);}
function requestCard(row){
 const open=['received','in_progress'].includes(row.status),buttons=[];
 if(open&&row.assigned_user_id!==me?.user_id)buttons.push(`<button type="button" data-request-action="take" data-id="${esc(row.id)}">Take it</button>`);
 if(open)buttons.push(`<button type="button" data-request-action="assign" data-id="${esc(row.id)}">Give to…</button>`,`<button type="button" class="primary-action" data-request-action="resolve" data-id="${esc(row.id)}">Mark resolved</button>`,`<button type="button" class="danger" data-request-action="close" data-id="${esc(row.id)}">Close</button>`);
 if(row.status==='resolved')buttons.push(`<button type="button" data-request-action="close" data-id="${esc(row.id)}">Close</button>`);
 if(!open)buttons.push(`<button type="button" data-request-action="reopen" data-id="${esc(row.id)}">Reopen</button>`);
 if(row.lead_id)buttons.push(`<button type="button" data-request-lead="${esc(row.lead_id)}">Open lead</button>`);
 const confirmation=row.confirmation_status==='sent'?`<span class="tag request-sent chip chip--${statusTone('success')}">Confirmation sent</span>`
  :`<a class="button" href="${esc(requestWhatsAppLink(row,requestConfirmationText(row)))}" target="_blank" rel="noopener">Send confirmation on WhatsApp</a><span class="muted"> Not sent automatically${row.confirmation_detail?`: ${esc(row.confirmation_detail)}`:''}</span>`;
 return `<article class="card request-card request-${esc(row.status)}" data-request-card="${esc(row.id)}"><div class="heading"><div><span class="travel-tag request-tag-${esc(row.status)} chip chip--${requestStatusTone(row.status)}">${esc(requestStatuses[row.status]||row.status)}</span><h3>${esc(requestKinds[row.kind]||row.kind)}${row.product?` · ${esc(row.product)}`:''}</h3><p>${esc(row.name)}${row.organization?` · ${esc(row.organization)}`:''}</p></div><small>${esc(row.request_number)}<br>${esc(requestWhen(row.created_at))}</small></div>
 <p class="request-message">${esc(row.message)}</p>
 <div class="details"><div><small>Phone</small><a href="tel:${esc(row.phone)}">${esc(row.phone)}</a> · <a href="${esc(requestWhatsAppLink(row,`Hello ${row.name}, this is Anudha Limited about your request ${row.request_number}.`))}" target="_blank" rel="noopener">WhatsApp</a></div>${row.email?`<div><small>Email</small><a href="mailto:${esc(row.email)}?subject=${encodeURIComponent('Your request '+row.request_number)}">${esc(row.email)}</a></div>`:''}${row.quantity?`<div><small>Quantity</small>${esc(row.quantity)}</div>`:''}<div><small>Prefers</small>${esc({whatsapp:'WhatsApp',email:'Email',phone:'Phone call'}[row.contact_channel]||row.contact_channel)}</div><div><small>Handled by</small>${row.assigned_user_id?esc(employeeName(row.assigned_user_id)):'Nobody yet'}</div></div>
 ${row.resolution_note?`<p><small>What was done:</small> ${esc(row.resolution_note)}</p>`:''}
 <div class="actions request-confirmation">${confirmation}</div>
 ${buttons.length?`<div class="actions">${buttons.join('')}</div>`:''}</article>`;
}
function requestSummaryCard(row){
 return `<article class="card request-card request-${esc(row.status)}" data-request-summary="${esc(row.id)}"><div class="heading"><div><small>${esc(row.request_number)}</small><h2>${esc(requestKinds[row.kind]||row.kind)}</h2><p>${esc(row.name)}${row.organization?' · '+esc(row.organization):''}</p></div><span class="tag request-tag-${esc(row.status)} chip chip--${requestStatusTone(row.status)}">${esc(requestStatuses[row.status]||row.status)}</span></div><p class="muted">${esc(requestWhen(row.created_at))}</p><div class="actions"><button type="button" data-request-open="${esc(row.id)}">Open request</button></div></article>`;
}
async function customerRequestsWorkspace(force=false){
 const actor=me;if(!actor||view!=='requests')return;
 if(requestActor&&requestActor!==actor)clearCustomerRequests();requestActor=actor;
 const epoch=++requestEpoch,section=requestSection,selected=requestSelected,current=()=>me===actor&&view==='requests'&&requestEpoch===epoch&&requestSection===section;
 syncWorkspaceNavigation();const input=$('#requestSearch');if(!input&&!selected)workspaceLoading('Loading requests…');
 try{
  if(selected){
   const result=await client.from('customer_requests').select('*').eq('id',selected).maybeSingle();
   if(!current())return;if(result.error)throw result.error;
   if(!result.data||!requestSections[section].kinds.includes(result.data.kind))throw Error('This request is no longer available. Return to the list.');
   requestRows=[result.data];
  }else{
   const result=await client.rpc('customer_request_page',{p_section:section,p_filter:requestFilter,p_query:requestSearch,p_page:requestPage});
   if(!current())return;if(result.error)throw result.error;const data=result.data;
   if(!data||!Array.isArray(data.rows)||data.rows.length>25||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages<1||data.page>=data.pages||!data.counts)throw Error('The request page could not be confirmed. Refresh to retry.');
   requestPageData=data;requestPage=data.page;requestRows=[];
  }
  requestLoaded=true;requestLoadError='';
 }catch(error){if(!current())return;requestLoadError=error.message||'Check your connection and retry.';requestPageData=null;requestRows=[];requestLoaded=false;}
 if(!current())return;
 if(input&&document.activeElement===input)renderSearchPreservingPosition(input,renderCustomerRequests);else renderCustomerRequests();
}
function renderCustomerRequests(){
 const section=requestSections[requestSection],data=requestPageData,selected=requestSelected&&requestRows.find(row=>row.id===requestSelected);
 $('#content').innerHTML=`<section class="requests-workspace">${workspacePageHeader({title:selected?.request_number||section.title,subtitle:section.intro,back:requestSelected?'<button type="button" id="requestBack">Back to requests</button>':'',actions:'<button type="button" id="requestRefresh">Refresh</button>'})}
 ${requestLoadError?`<p class="notice error" role="alert">Requests could not load: ${esc(requestLoadError)}</p>`:''}
 ${requestSelected?(selected?requestCard(selected):''):`<div class="tabs" role="group" aria-label="Show requests">${requestFilters.map(([key,label])=>`<button type="button" data-request-filter="${key}" class="${requestFilter===key?'active':''}" aria-pressed="${requestFilter===key}">${label}${data?' · '+(data.counts[key]||0):''}</button>`).join('')}</div>
 ${['done','all'].includes(requestFilter)?'<p class="muted">Finished requests from the last 6 months.</p>':''}
 <label class="search"><span>Search</span><input id="requestSearch" type="search" maxlength="2000" placeholder="Request number, name, phone, product" value="${esc(requestSearch)}"></label>
 ${data?`<p role="status">${data.total} matching requests</p>${data.rows.map(requestSummaryCard).join('')||'<p class="muted">No requests match.</p>'}<div class="actions"><button type="button" id="requestPrevious" ${data.page===0?'disabled':''}>Previous</button><span>Page ${data.page+1} of ${data.pages}</span><button type="button" id="requestNext" ${data.page+1>=data.pages?'disabled':''}>Next</button></div>`:''}`}</section>`;
 $('#requestRefresh').onclick=()=>run(()=>customerRequestsWorkspace(true));
 $('#requestBack')?.addEventListener('click',()=>run(()=>{requestSelected='';return customerRequestsWorkspace();}));
 document.querySelectorAll('[data-request-filter]').forEach(button=>button.onclick=()=>run(()=>{requestFilter=button.dataset.requestFilter;requestPage=0;requestEpoch++;return customerRequestsWorkspace();}));
 const search=$('#requestSearch');if(search)search.oninput=event=>{requestSearch=event.target.value;requestPage=0;requestEpoch++;renderSearchPreservingPosition(event.target,()=>run(()=>customerRequestsWorkspace()),150);};
 $('#requestPrevious')?.addEventListener('click',()=>run(()=>{requestPage--;return customerRequestsWorkspace();}));
 $('#requestNext')?.addEventListener('click',()=>run(()=>{requestPage++;return customerRequestsWorkspace();}));
 document.querySelectorAll('[data-request-open]').forEach(button=>button.onclick=()=>run(()=>{requestSelected=button.dataset.requestOpen;return customerRequestsWorkspace();}));
 bindRequestCardActions();
}
function bindRequestCardActions(){
 document.querySelectorAll('[data-request-action]').forEach(button=>button.onclick=()=>run(()=>openRequestAction(requestRows.find(row=>row.id===button.dataset.id),button.dataset.requestAction)));
 document.querySelectorAll('[data-request-lead]').forEach(button=>button.onclick=()=>run(()=>{if(typeof focusLead==='function'){focusLead(button.dataset.requestLead);return render();}}));
}
async function openRequestAction(row,action){
 if(!row||view!=='requests'||requestSelected!==row.id)return;
 const openingActor=me,epoch=requestEpoch;let employees=[];
 if(action==='assign'){
  const result=await client.rpc('customer_request_assignees',{p_request_id:row.id});
  if(me!==openingActor||requestEpoch!==epoch||view!=='requests')return;
  if(result.error)throw Error(result.error.message);
  employees=(result.data||[]).sort((a,b)=>String(a.display_name||'').localeCompare(String(b.display_name||'')));
 }
 const titles={take:'Take this request',assign:'Give to someone',resolve:'Mark resolved',close:'Close request',reopen:'Reopen request'};
 const fields=`<p><strong>${esc(row.request_number)}</strong> · ${esc(row.name)}</p>${action==='assign'?`<label><span>Who handles it</span><select name="assignee" required><option value="">Choose employee</option>${employees.map(e=>`<option value="${esc(e.user_id)}">${esc(e.display_name||employeeName(e.user_id))}</option>`).join('')}</select></label>`:''}${['resolve','close','assign'].includes(action)?`<label><span>${action==='resolve'?'What was done for the customer':action==='close'?'Why it is closed':'Note (optional)'}</span><textarea name="note" ${action==='assign'?'':row.status==='resolved'&&action==='close'?'':'required minlength="3"'} maxlength="2000"></textarea></label>`:''}`;
 const target=$('#content');let committed=false;
 const current=()=>me===openingActor&&epoch===requestEpoch&&view==='requests'&&requestSelected===row.id&&target?.isConnected&&$('#content')===target;
 const valid=saved=>saved&&saved.id===row.id&&Number.isSafeInteger(saved.version)&&saved.version>=row.version+1&&Object.hasOwn(requestStatuses,saved.status)&&saved.kind===row.kind&&['request_number','name','phone','message','created_at'].every(key=>typeof saved[key]==='string');
 actionForm(titles[action],fields,async values=>{
  if(committed)return;
  if(!current())throw Error('Your login or request changed. Reopen the request.');
  let result;try{result=await client.rpc('advance_customer_request',{p_id:row.id,p_expected_version:row.version,p_action:action,p_assigned_user_id:values.assignee||null,p_note:values.note||''});}catch(error){if(current())throw error;return;}
  if(!current())return;if(result.error)throw Error(result.error.message);committed=true;
  const saved=Array.isArray(result.data)?(result.data.length===1?result.data[0]:null):result.data;
  const card=document.querySelector(`[data-request-card="${CSS.escape(row.id)}"]`),text=`${row.request_number}: ${titles[action].toLowerCase()} saved.`;
  requestPageData=null;
  const apply=record=>{
   requestRows=[record];requestLoadError='';
   if(card?.isConnected){const template=document.createElement('template');template.innerHTML=requestCard(record);card.replaceWith(template.content.firstElementChild);bindRequestCardActions();}
   message(text);
  };
  if(valid(saved)&&saved.version===row.version+1){apply(saved);return;}
  requestRows=[];
  if(!card?.isConnected){message('The change was saved. Reopen the request to see its updated details.',true);return;}
  const refresh=async()=>{
   if(!current()||!card.isConnected||card.requestRefreshing)return;card.requestRefreshing=true;
   card.innerHTML='<p role="status">Change saved. Refreshing this request…</p>';
   try{
    const response=await client.from('customer_requests').select('*').eq('id',row.id).maybeSingle();
    if(!current()||!card.isConnected)return;if(response.error)throw response.error;
    if(!valid(response.data))throw Error('The updated request could not be verified.');
    apply(response.data);
   }catch(error){
    if(!current()||!card.isConnected)return;
    card.innerHTML=`<p role="alert">The change was saved, but its details could not be verified: ${esc(error.message)}. Refresh before making another change.</p><button type="button" data-request-saved-retry>Retry refresh</button>`;
    card.querySelector('[data-request-saved-retry]').onclick=()=>run(refresh);
   }finally{card.requestRefreshing=false;}
  };
  await refresh();
 });
}
