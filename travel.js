'use strict';
// Travel requests: who is going, where, why, who they meet and for how long. The owner approves; afterwards the trip
// is marked done with how it went. Writes go through save_travel_request / advance_travel_request only.
let travelRows=[],travelFilter='upcoming',travelEpoch=0,travelLoaded=false;
const travelPurposes=[['meeting','Meeting'],['installation','Installation'],['service','Service or repair'],['delivery','Delivery'],['training','Training'],['other','Other']];
const travelFilters=[['upcoming','Upcoming and away now'],['waiting','Waiting for approval'],['mine','My trips'],['past','Past']];
function clearTravel(){travelEpoch++;travelRows=[];travelLoaded=false;}
function travelPurpose(key){return travelPurposes.find(([value])=>value===key)?.[1]||key}
function travelDuration(depart,ret){
 const ms=Date.parse(ret)-Date.parse(depart);if(!(ms>0))return '';
 const hours=Math.round(ms/3600000),days=Math.floor(hours/24),rest=hours%24;
 return days?`${days} day${days===1?'':'s'}${rest?` ${rest} h`:''}`:`${hours} h`;
}
function travelState(row,now=Date.now()){
 if(row.status==='approved'&&Date.parse(row.depart_at)<=now&&Date.parse(row.return_at)>=now)return ['away','Away now'];
 return ({requested:['waiting','Waiting for approval'],approved:['approved','Approved'],declined:['closed','Declined'],cancelled:['closed','Cancelled'],done:['done','Trip done']})[row.status]||['closed',row.status];
}
function travelPlace(row){const org=row.organization_id?orgIndex.get(row.organization_id):null;return org?`${org.name}${org.location?' · '+org.location:''}`:row.destination}
function travelVisible(rows,filter,actor,now=Date.now()){
 const mine=row=>row.created_by===actor||row.travellers.includes(actor);
 const list=rows.filter(row=>filter==='waiting'?row.status==='requested':filter==='mine'?mine(row):filter==='past'?['done','declined','cancelled'].includes(row.status)||(row.status==='approved'&&Date.parse(row.return_at)<now):['requested','approved'].includes(row.status)&&Date.parse(row.return_at)>=now);
 return list.sort((a,b)=>filter==='past'?Date.parse(b.depart_at)-Date.parse(a.depart_at):Date.parse(a.depart_at)-Date.parse(b.depart_at));
}
function travelWhen(value){return new Date(value).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
function travelCard(row){
 const [state,label]=travelState(row),owner=me?.role==='owner',asker=row.created_by===me?.user_id,traveller=row.travellers.includes(me?.user_id),buttons=[];
 if(row.status==='requested'&&owner)buttons.push(`<button type="button" data-travel-action="approve" data-id="${esc(row.id)}">Approve</button>`,`<button type="button" class="danger" data-travel-action="decline" data-id="${esc(row.id)}">Decline</button>`);
 if(row.status==='requested'&&(asker||owner))buttons.push(`<button type="button" data-travel-edit="${esc(row.id)}">Edit</button>`);
 if(row.status==='approved'&&(traveller||asker||owner))buttons.push(`<button type="button" data-travel-action="done" data-id="${esc(row.id)}">Trip done</button>`);
 if(['requested','approved'].includes(row.status)&&(asker||owner))buttons.push(`<button type="button" class="danger" data-travel-action="cancel" data-id="${esc(row.id)}">Cancel trip</button>`);
 return `<article class="card travel-card travel-${state}"><div class="heading"><div><span class="travel-tag travel-tag-${state}">${esc(label)}</span><h3>${esc(travelPlace(row))}</h3><p>${esc(travelPurpose(row.purpose))}${row.meeting_with?` · meeting ${esc(row.meeting_with)}`:''}</p></div><small>${esc(row.request_number)}</small></div>
 <div class="details"><div><small>Who is going</small>${row.travellers.map(id=>esc(employeeName(id))).join(', ')}</div><div><small>When</small>${esc(travelWhen(row.depart_at))} → ${esc(travelWhen(row.return_at))}<br><strong>${esc(travelDuration(row.depart_at,row.return_at))}</strong></div>${row.transport?`<div><small>Transport</small>${esc(row.transport)}</div>`:''}<div><small>Asked by</small>${esc(employeeName(row.created_by))}</div></div>
 ${row.notes?`<p class="muted">${esc(row.notes)}</p>`:''}${row.decision_note&&row.status!=='requested'?`<p><small>${row.status==='declined'?'Declined':'Owner note'}:</small> ${esc(row.decision_note)}</p>`:''}${row.outcome_note?`<p><small>${row.status==='cancelled'?'Cancelled':'How it went'}:</small> ${esc(row.outcome_note)}</p>`:''}
 ${buttons.length?`<div class="actions">${buttons.join('')}</div>`:''}</article>`;
}
async function travelWorkspace(force=false){
 const epoch=++travelEpoch,actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!travelLoaded){
  $('#content').innerHTML='<p role="status">Loading travel requests…</p>';
  const result=await client.from('travel_requests').select('*').order('depart_at',{ascending:false}).limit(500);
  if(epoch!==travelEpoch||me?.user_id!==actor||view!=='travel')return;
  if(result.error){$('#content').innerHTML=`<h1>Travel requests</h1><p role="alert">Travel requests could not load: ${esc(result.error.message)}</p>`;return;}
  travelRows=result.data||[];travelLoaded=true;
 }
 renderTravel();
}
function renderTravel(){
 const rows=travelVisible(travelRows,travelFilter,me?.user_id),count=key=>travelVisible(travelRows,key,me?.user_id).length;
 $('#content').innerHTML=`<section class="travel-workspace"><div class="heading"><div><small>MAIN</small><h1>Travel requests</h1><p class="muted">Who is going where, why, and for how long. The owner approves each trip.</p></div><div class="actions"><button type="button" id="travelRefresh">Refresh</button><button type="button" class="primary-action" id="travelNew">+ New travel request</button></div></div>
 <div class="tabs" role="group" aria-label="Show trips">${travelFilters.map(([key,label])=>{const n=key==='past'?0:count(key);return `<button type="button" data-travel-filter="${key}" class="${travelFilter===key?'active':''}" aria-pressed="${travelFilter===key}">${label}${n?` · ${n}`:''}</button>`}).join('')}</div>
 ${rows.map(travelCard).join('')||'<p class="muted">No trips here.</p>'}</section>`;
 $('#travelRefresh').onclick=()=>run(()=>travelWorkspace(true));
 $('#travelNew').onclick=()=>openTravelEditor(null);
 document.querySelectorAll('[data-travel-filter]').forEach(button=>button.onclick=()=>{travelFilter=button.dataset.travelFilter;renderTravel();});
 document.querySelectorAll('[data-travel-edit]').forEach(button=>button.onclick=()=>openTravelEditor(travelRows.find(row=>row.id===button.dataset.travelEdit)));
 document.querySelectorAll('[data-travel-action]').forEach(button=>button.onclick=()=>openTravelAction(travelRows.find(row=>row.id===button.dataset.id),button.dataset.travelAction));
}
function travelLocalInput(value){if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function openTravelEditor(row){
 const people=row?.travellers||[me.user_id],client=row?Boolean(row.organization_id):true,id=row?.id||crypto.randomUUID(),actor=me?.user_id;
 const employees=[...employeeDirectory.values()].filter(e=>e.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(8,0,0,0);const back=new Date(tomorrow);back.setHours(17,0,0,0);
 const fields=`<fieldset class="travel-step"><legend>1. Who is going?</legend><div class="travel-people">${employees.map(e=>`<label><input type="checkbox" name="traveller" value="${esc(e.user_id)}"${people.includes(e.user_id)?' checked':''}> ${esc(employeeName(e.user_id))}</label>`).join('')}</div></fieldset>
 <fieldset class="travel-step"><legend>2. Where?</legend><div class="lead-who"><label><input type="radio" name="where" value="client"${client?' checked':''}> A client</label><label><input type="radio" name="where" value="other"${client?'':' checked'}> Another place</label></div>
 <label data-where="client"${client?'':' hidden'}><span>Client or hospital</span><select name="organizationId"><option value="">Choose the client</option>${salesOrganizationOptions(row?.organization_id||'')}</select></label>
 <label data-where="other"${client?' hidden':''}><span>Place</span><input name="destination" maxlength="300" value="${esc(row?.destination||'')}" placeholder="For example: Ministry of Health, Dodoma"></label></fieldset>
 <fieldset class="travel-step"><legend>3. Why?</legend><div class="lead-sources">${travelPurposes.map(([key,label])=>`<label><input type="radio" name="purpose" value="${key}"${(row?.purpose||'meeting')===key?' checked':''}> ${label}</label>`).join('')}</div><label><span>Meeting with · optional</span><input name="meetingWith" maxlength="300" value="${esc(row?.meeting_with||'')}" placeholder="For example: Dr Mushi, lab manager"></label></fieldset>
 <fieldset class="travel-step"><legend>4. When?</legend><div class="grid"><label><span>Leave</span><input type="datetime-local" name="depart" required value="${travelLocalInput(row?.depart_at||tomorrow)}"></label><label><span>Back</span><input type="datetime-local" name="return" required value="${travelLocalInput(row?.return_at||back)}"></label></div><p class="muted" id="travelLength"></p></fieldset>
 <label><span>Transport · optional</span><input name="transport" maxlength="200" value="${esc(row?.transport||'')}" placeholder="Company car, bus, flight…"></label>
 <label><span>Notes · optional</span><textarea name="notes" maxlength="2000">${esc(row?.notes||'')}</textarea></label>`;
 const form=actionForm(row?'Edit travel request':'New travel request',fields,async values=>{
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the request.');
  const travellers=[...form.querySelectorAll('[name="traveller"]:checked')].map(input=>input.value);
  if(!travellers.length)throw Error('Choose who is going.');
  const depart=new Date(values.depart),ret=new Date(values.return);
  if(!Number.isFinite(depart.getTime())||!Number.isFinite(ret.getTime()))throw Error('Choose when you leave and when you are back.');
  if(ret<=depart)throw Error('The return must be after you leave.');
  const toClient=values.where==='client';
  const result=await client.rpc('save_travel_request',{p_id:id,p_expected_version:row?.version||0,p_travellers:travellers,p_organization_id:toClient?values.organizationId||null:null,p_destination:toClient?'':values.destination||'',p_purpose:values.purpose,p_meeting_with:values.meetingWith||'',p_depart_at:depart.toISOString(),p_return_at:ret.toISOString(),p_transport:values.transport||'',p_notes:values.notes||''});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  await travelWorkspace(true);message(`${saved?.request_number||'Travel request'} ${row?'updated':'sent for approval'}.`);
 });
 const length=()=>{const el=form.querySelector('#travelLength');if(el)el.textContent=travelDuration(new Date(form.elements.depart.value),new Date(form.elements.return.value))?`Trip length: ${travelDuration(new Date(form.elements.depart.value),new Date(form.elements.return.value))}`:'';};
 form.elements.depart.oninput=length;form.elements.return.oninput=length;length();
 form.querySelectorAll('[name="where"]').forEach(input=>input.onchange=()=>form.querySelectorAll('[data-where]').forEach(group=>group.hidden=group.dataset.where!==input.value));
}
function openTravelAction(row,action){
 if(!row)return;
 const titles={approve:'Approve trip',decline:'Decline trip',done:'Trip done',cancel:'Cancel trip'};
 const label={approve:'Note · optional',decline:'Why is it declined?',done:'How did it go?',cancel:'Why is it cancelled? · optional'}[action];
 const fields=`<p><strong>${esc(row.request_number)}</strong> · ${esc(travelPlace(row))} · ${esc(travelDuration(row.depart_at,row.return_at))}</p><label><span>${label}</span><textarea name="note" maxlength="2000"${['decline','done'].includes(action)?' required minlength="3"':''}></textarea></label>`;
 actionForm(titles[action],fields,async values=>{
  const actor=me?.user_id,result=await client.rpc('advance_travel_request',{p_id:row.id,p_expected_version:row.version,p_action:action,p_note:values.note||''});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the trip.');
  if(result.error)throw Error(result.error.message);
  await travelWorkspace(true);message(`${row.request_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
