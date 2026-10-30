'use strict';
// Travel planning, owner approval and post-visit reporting use validated, versioned RPCs.
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
function travelStopPlace(stop){const org=stop.organization_id?orgIndex.get(stop.organization_id):null;return org?`${org.name}${org.location?' · '+org.location:''}`:stop.destination}
function travelPlace(row){return row.itinerary?.length?row.itinerary.map(travelStopPlace).join(' → '):travelStopPlace(row)}
function travelCosts(days,rate,intercity,local){
 const text=String(days);if(!/^\d+(?:\.\d{1,2})?$/.test(text)||Number(text)>60)throw Error('Allowance days must be between 0 and 60, with at most two decimals.');
 const hundredths=moneyMinor(text);
 if(![rate,intercity,local].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000000000))throw Error('Enter valid non-negative travel costs.');
 const perDiem=Math.floor((hundredths*rate+50)/100),total=perDiem+intercity+local;
 return {perDiem,total};
}
function travelBudget(row){
 const currency=row.currency||'TZS',cost=travelCosts(row.per_diem_days||0,Number(row.per_diem_rate_minor||0),Number(row.intercity_transport_minor||0),Number(row.local_transport_minor||0));
 return `<div class="details"><div><small>Per diem · daily total for all travellers × entered days</small>${esc(moneyDisplay(Number(row.per_diem_rate_minor||0),currency))} × ${esc(row.per_diem_days||0)} = <strong>${esc(moneyDisplay(cost.perDiem,currency))}</strong></div><div><small>Intercity transport</small>${esc(moneyDisplay(Number(row.intercity_transport_minor||0),currency))}</div><div><small>Local transport</small>${esc(moneyDisplay(Number(row.local_transport_minor||0),currency))}</div><div><small>Estimated trip total</small><strong>${esc(moneyDisplay(cost.total,currency))}</strong></div></div>`;
}
function travelItinerary(row){
 return (row.itinerary||[]).map((stop,i)=>{const result=(row.visit_outcomes||[]).find(outcome=>outcome.stop_id===stop.id);return `<section class="travel-step"><h4>Stop ${i+1}: ${esc(travelStopPlace(stop))}</h4><p>${esc(travelWhen(stop.appointment_at))} · ${esc(stop.contact_name)}<br>${esc(stop.appointment_purpose)}</p><p><strong>Preparation:</strong> ${esc(stop.preparation||'None recorded')}<br><strong>Resources to bring:</strong> ${esc(stop.resources||'None recorded')}</p>${result?`<p><strong>Outcome:</strong> ${esc(result.outcome)}<br><strong>Follow-up:</strong> ${esc(result.follow_up||'None recorded')}${result.follow_up_on?` · ${esc(result.follow_up_on)}`:''}</p>`:''}</section>`}).join('');
}
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
 if(row.status==='approved'&&(traveller||asker||owner))buttons.push(`<button type="button" data-travel-action="done" data-id="${esc(row.id)}">Post-visit report</button>`);
 if(['requested','approved'].includes(row.status)&&(asker||owner))buttons.push(`<button type="button" class="danger" data-travel-action="cancel" data-id="${esc(row.id)}">Cancel trip</button>`);
 return `<article class="card travel-card travel-${state}"><div class="heading"><div><span class="travel-tag travel-tag-${state}">${esc(label)}</span><h3>${esc(travelPlace(row))}</h3><p>${esc((row.purposes?.length?row.purposes:[row.purpose]).map(travelPurpose).join(', '))}</p></div><small>${esc(row.request_number)} · revision ${esc(row.version)}<br>${esc(row.form_document_number||'ERP-TRAVEL-01')} · form revision ${esc(row.form_revision||1)}<br>Standard ERP form</small></div>
 <div class="details"><div><small>Who is going</small>${row.travellers.map(id=>esc(employeeName(id))).join(', ')}</div><div><small>When</small>${esc(travelWhen(row.depart_at))} → ${esc(travelWhen(row.return_at))}<br><strong>${esc(travelDuration(row.depart_at,row.return_at))}</strong></div>${row.transport?`<div><small>Transport</small>${esc(row.transport)}</div>`:''}<div><small>Asked by</small>${esc(employeeName(row.created_by))}</div></div>
 ${travelBudget(row)}${row.itinerary?.length?`<details><summary>Itinerary · ${row.itinerary.length} stops</summary>${travelItinerary(row)}</details>`:''}
 ${row.post_visit_report?`<p><strong>Post-visit report:</strong> ${esc(row.post_visit_report)}</p>`:''}
 ${row.notes?`<p class="muted">${esc(row.notes)}</p>`:''}${row.decision_note&&row.status!=='requested'?`<p><small>${row.status==='declined'?'Declined':'Owner note'}:</small> ${esc(row.decision_note)}</p>`:''}${row.outcome_note&&!row.post_visit_report?`<p><small>${row.status==='cancelled'?'Cancelled':'How it went'}:</small> ${esc(row.outcome_note)}</p>`:''}
 ${buttons.length?`<div class="actions">${buttons.join('')}</div>`:''}</article>`;
}
async function travelWorkspace(force=false){
 const epoch=++travelEpoch,actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!travelLoaded){
  pageLoading('Loading travel requests…');
  const result=await client.from('travel_requests').select('*').order('depart_at',{ascending:false}).limit(500);
  if(epoch!==travelEpoch||me?.user_id!==actor||view!=='travel')return;
  if(result.error){$('#content').innerHTML=`<h1>Travel requests</h1><p role="alert">Travel requests could not load: ${esc(result.error.message)}</p>`;return;}
  travelRows=result.data||[];travelLoaded=true;
 }
 renderTravel();
}
function renderTravel(){
 const rows=travelVisible(travelRows,travelFilter,me?.user_id),count=key=>travelVisible(travelRows,key,me?.user_id).length;
 $('#content').innerHTML=`<section class="travel-workspace"><div class="heading"><div><small>MAIN</small><h1>Travel requests</h1><p class="muted">Plan each site, appointment and cost in one trip. The owner approves each trip.</p></div><div class="actions"><button type="button" id="travelRefresh">Refresh</button><button type="button" class="primary-action" id="travelNew">+ New travel request</button></div></div>
 <div class="tabs" role="group" aria-label="Show trips">${travelFilters.map(([key,label])=>{const n=key==='past'?0:count(key);return `<button type="button" data-travel-filter="${key}" class="${travelFilter===key?'active':''}" aria-pressed="${travelFilter===key}">${label}${n?` · ${n}`:''}</button>`}).join('')}</div>
 ${rows.map(travelCard).join('')||'<p class="muted">No trips here.</p>'}</section>`;
 $('#travelRefresh').onclick=()=>run(()=>travelWorkspace(true));
 $('#travelNew').onclick=()=>openTravelEditor(null);
 document.querySelectorAll('[data-travel-filter]').forEach(button=>button.onclick=()=>{travelFilter=button.dataset.travelFilter;renderTravel();});
 document.querySelectorAll('[data-travel-edit]').forEach(button=>button.onclick=()=>openTravelEditor(travelRows.find(row=>row.id===button.dataset.travelEdit)));
 document.querySelectorAll('[data-travel-action]').forEach(button=>button.onclick=()=>openTravelAction(travelRows.find(row=>row.id===button.dataset.id),button.dataset.travelAction));
}
function travelLocalInput(value){if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function travelStopEditor(stop={}){
 const id=stop.id||crypto.randomUUID(),name=key=>`stop_${id}_${key}`;
 return `<fieldset class="travel-step" data-travel-stop="${esc(id)}"><legend>Site / appointment</legend><label><span>Client or hospital · optional for another place</span><select name="${name('organization')}" data-stop-field="organization_id" data-lookup-rows="organizations"><option value="">Another place</option>${salesOrganizationOptions(stop.organization_id||'')}</select></label>
 <label><span>Site / place · required if no client selected</span><input name="${name('destination')}" data-stop-field="destination" maxlength="300" value="${esc(stop.destination||'')}" placeholder="For example: Ministry of Health, Dodoma"></label>
 <div class="grid"><label><span>Named contact(s)</span><input name="${name('contact')}" data-stop-field="contact_name" required minlength="2" maxlength="300" value="${esc(stop.contact_name||'')}" placeholder="Dr Mushi, lab manager"></label><label><span>Appointment time</span><input name="${name('at')}" data-stop-field="appointment_at" type="datetime-local" required value="${travelLocalInput(stop.appointment_at)}"></label></div>
 <label><span>Appointment purpose / agenda</span><textarea name="${name('purpose')}" data-stop-field="appointment_purpose" required minlength="3" maxlength="1000">${esc(stop.appointment_purpose||'')}</textarea></label>
 <label><span>Preparation needed</span><textarea name="${name('preparation')}" data-stop-field="preparation" maxlength="2000">${esc(stop.preparation||'')}</textarea></label>
 <label><span>Resources to bring · documents, products, tools, samples</span><textarea name="${name('resources')}" data-stop-field="resources" maxlength="2000">${esc(stop.resources||'')}</textarea></label>
 <div class="actions"><button type="button" data-stop-up>Move earlier</button><button type="button" data-stop-down>Move later</button><button type="button" data-stop-remove>Remove stop</button></div></fieldset>`;
}
function travelReadStops(form){
 const stops=[...form.querySelectorAll('[data-travel-stop]')].map(group=>{
  const stop={id:group.dataset.travelStop};group.querySelectorAll('[data-stop-field]').forEach(input=>stop[input.dataset.stopField]=input.value.trim());
  stop.organization_id=stop.organization_id||null;
  if(!stop.organization_id&&stop.destination.length<2)throw Error('Name the site for every stop.');
  const at=new Date(stop.appointment_at);if(!Number.isFinite(at.getTime()))throw Error('Choose each appointment time.');stop.appointment_at=at.toISOString();
  return stop;
 });
 if(!stops.length||stops.length>20)throw Error('Add between 1 and 20 itinerary stops.');return stops;
}
function openTravelEditor(row){
 const people=row?.travellers||[me.user_id],id=row?.id||crypto.randomUUID(),actor=me?.user_id,operation=crypto.randomUUID();
 const employees=[...employeeDirectory.values()].filter(e=>e.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(8,0,0,0);const back=new Date(tomorrow);back.setHours(17,0,0,0);
 const purposes=row?.purposes?.length?row.purposes:[row?.purpose||'meeting'];
 const stops=row?.itinerary?.length?row.itinerary:[{organization_id:row?.organization_id,destination:row?.destination,contact_name:row?.meeting_with,appointment_at:row?.depart_at||tomorrow}];
 const amount=key=>(Number(row?.[key]||0)/100).toFixed(2);
 const fields=`<p class="muted">ERP-TRAVEL-01 · form revision 1 · Standard ERP form</p><fieldset class="travel-step"><legend>1. Who is going?</legend><div class="travel-people">${employees.map(e=>`<label><input type="checkbox" name="traveller" value="${esc(e.user_id)}"${people.includes(e.user_id)?' checked':''}> ${esc(employeeName(e.user_id))}</label>`).join('')}</div></fieldset>
 <fieldset class="travel-step"><legend>2. Trip dates and purposes</legend><div class="grid"><label><span>Leave</span><input type="datetime-local" name="depart" required value="${travelLocalInput(row?.depart_at||tomorrow)}"></label><label><span>Back</span><input type="datetime-local" name="return" required value="${travelLocalInput(row?.return_at||back)}"></label></div><p class="muted" id="travelLength"></p>
 <div class="travel-people">${travelPurposes.map(([key,label])=>`<label><input type="checkbox" name="purpose" value="${key}"${purposes.includes(key)?' checked':''}> ${label}</label>`).join('')}</div></fieldset>
 <h3>3. Itinerary · in visit order</h3><div id="travelStops">${stops.map(travelStopEditor).join('')}</div><button type="button" id="travelAddStop">+ Add site / appointment</button>
 <fieldset class="travel-step"><legend>4. Transport and estimated costs</legend><label><span>Transport arrangements</span><input name="transport" maxlength="200" value="${esc(row?.transport||'')}" placeholder="Company car, bus, flight…"></label>
 <label><span>Currency</span><select name="currency">${['TZS','USD','EUR'].map(c=>`<option${(row?.currency||'TZS')===c?' selected':''}>${c}</option>`).join('')}</select></label>
 <div class="grid"><label><span>Allowance days · enter the agreed number</span><input name="perDiemDays" type="number" min="0" max="60" step="0.01" required value="${esc(row?.per_diem_days||0)}"></label><label><span>Per diem daily total · all travellers combined</span><input name="perDiemRate" inputmode="decimal" required value="${amount('per_diem_rate_minor')}"></label><label><span>Intercity transport cost · entire trip</span><input name="intercity" inputmode="decimal" required value="${amount('intercity_transport_minor')}"></label><label><span>Local transport cost · entire trip</span><input name="local" inputmode="decimal" required value="${amount('local_transport_minor')}"></label></div>
 <p class="muted">Enter agreed rates and costs. Zero means no allowance or cost entered. Per diem = daily total × entered allowance days.</p><p id="travelCostTotal" aria-live="polite"></p></fieldset>
 <label><span>Trip notes · optional</span><textarea name="notes" maxlength="2000">${esc(row?.notes||'')}</textarea></label>`;
 const form=actionForm(row?'Edit travel request':'New travel request',fields,async values=>{
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the request.');
  const travellers=[...form.querySelectorAll('[name="traveller"]:checked')].map(input=>input.value),selectedPurposes=[...form.querySelectorAll('[name="purpose"]:checked')].map(input=>input.value);
  if(!travellers.length)throw Error('Choose who is going.');if(!selectedPurposes.length)throw Error('Choose the trip purposes.');
  const depart=new Date(values.depart),ret=new Date(values.return);
  if(!Number.isFinite(depart.getTime())||!Number.isFinite(ret.getTime())||ret<=depart)throw Error('Choose a return after departure.');
  const itinerary=travelReadStops(form);if(itinerary.some(stop=>Date.parse(stop.appointment_at)<depart.getTime()||Date.parse(stop.appointment_at)>ret.getTime()))throw Error('Every appointment must fall within the trip.');
  const rate=moneyMinor(values.perDiemRate),intercity=moneyMinor(values.intercity),local=moneyMinor(values.local);travelCosts(values.perDiemDays,rate,intercity,local);
  const result=await client.rpc('save_travel_visit_plan',{p_id:id,p_expected_version:row?.version||0,p_operation_id:operation,p_travellers:travellers,p_depart_at:depart.toISOString(),p_return_at:ret.toISOString(),p_transport:values.transport||'',p_notes:values.notes||'',p_purposes:selectedPurposes,p_itinerary:itinerary,p_currency:values.currency,p_per_diem_days:Number(values.perDiemDays),p_per_diem_rate_minor:rate,p_intercity_transport_minor:intercity,p_local_transport_minor:local});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');if(result.error)throw Error(result.error.message);
  const saved=Array.isArray(result.data)?result.data[0]:result.data;await travelWorkspace(true);message(`${saved?.request_number||'Travel request'} ${row?'updated':'sent for approval'}.`);
 });
 const length=()=>{form.querySelector('#travelLength').textContent=`Trip duration: ${travelDuration(form.elements.depart.value,form.elements.return.value)||'Choose trip dates'}`;};
 form.elements.depart.oninput=length;form.elements.return.oninput=length;length();
 const cost=()=>{const el=form.querySelector('#travelCostTotal');try{const c=travelCosts(form.elements.perDiemDays.value,moneyMinor(form.elements.perDiemRate.value),moneyMinor(form.elements.intercity.value),moneyMinor(form.elements.local.value));el.textContent=`Per diem: ${moneyDisplay(c.perDiem,form.elements.currency.value)} · Estimated trip total: ${moneyDisplay(c.total,form.elements.currency.value)}`;}catch(error){el.textContent=error.message;}};
 ['perDiemDays','perDiemRate','intercity','local','currency'].forEach(name=>form.elements[name].oninput=cost);cost();
 const container=form.querySelector('#travelStops');
 form.querySelector('#travelAddStop').onclick=()=>{if(container.children.length>=20){message('A trip can have at most 20 stops.');return;}container.insertAdjacentHTML('beforeend',travelStopEditor({appointment_at:form.elements.depart.value}));};
 container.onclick=event=>{const button=event.target.closest('button'),group=button?.closest('[data-travel-stop]');if(!group)return;
  if(button.hasAttribute('data-stop-remove')){if(container.children.length===1){message('Keep at least one itinerary stop.');return;}group.remove();}
  if(button.hasAttribute('data-stop-up')&&group.previousElementSibling)container.insertBefore(group,group.previousElementSibling);
  if(button.hasAttribute('data-stop-down')&&group.nextElementSibling)container.insertBefore(group.nextElementSibling,group);
 };
}
function openTravelAction(row,action){
 if(!row)return;
 const actor=me?.user_id,operation=crypto.randomUUID(),titles={approve:'Approve trip',decline:'Decline trip',done:'Post-visit report',cancel:'Cancel trip'};
 const label={approve:'Note · optional',decline:'Why is it declined?',done:'Post-visit report · overall results, issues and recommendations',cancel:'Why is it cancelled? · optional'}[action];
 const outcomes=action==='done'?(row.itinerary||[]).map((stop,i)=>`<fieldset class="travel-step" data-travel-outcome="${esc(stop.id)}"><legend>Stop ${i+1}: ${esc(travelStopPlace(stop))}</legend><p>${esc(stop.contact_name)} · ${esc(stop.appointment_purpose)}</p><label><span>Visit outcome</span><textarea name="outcome_${esc(stop.id)}" data-outcome-field="outcome" required minlength="3" maxlength="2000"></textarea></label><label><span>Follow-up action · optional</span><textarea name="followup_${esc(stop.id)}" data-outcome-field="follow_up" maxlength="2000"></textarea></label><label><span>Follow-up date · optional</span><input name="followup_on_${esc(stop.id)}" data-outcome-field="follow_up_on" type="date"></label></fieldset>`).join(''):'';
 const fields=`<p><strong>${esc(row.request_number)}</strong> · ${esc(travelPlace(row))} · ${esc(travelDuration(row.depart_at,row.return_at))}</p>${outcomes}<label><span>${label}</span><textarea name="note" maxlength="${action==='done'?6000:['approve','decline'].includes(action)?1000:2000}"${['decline','done'].includes(action)?' required minlength="3"':''}></textarea></label>`;
 const form=actionForm(titles[action],fields,async values=>{
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the trip.');
  const outcomes=[...form.querySelectorAll('[data-travel-outcome]')].map(group=>{const item={stop_id:group.dataset.travelOutcome};group.querySelectorAll('[data-outcome-field]').forEach(input=>item[input.dataset.outcomeField]=input.value.trim());return item;});
  const result=await client.rpc('advance_travel_visit',{p_id:row.id,p_expected_version:row.version,p_operation_id:operation,p_action:action,p_note:values.note||'',p_outcomes:outcomes});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the trip.');if(result.error)throw Error(result.error.message);
  await travelWorkspace(true);message(`${row.request_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
