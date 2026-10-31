'use strict';
// Dashboard: counts of open work, of what was created in a chosen period and of what was finished in a chosen period.
// One counts read under the signed-in person's own rules (dashboard_counts, or dashboard_open_counts while period totals are cached): a count from an area they
// cannot open comes back empty and its card is left out. Counts only, never amounts. Days are Dar es Salaam days.
// The owner and department heads also see Team tasks: open, completed and late per person (migration 068).
// One period, chosen with a button, applies to Periodic, Result and Team tasks; it is remembered per person on this
// device. Which table and filter feed each card: docs/DASHBOARD-CARDS.md.
const dashboardDefaultPeriod={preset:'today',from:'',to:''};
let dashboardPeriod={...dashboardDefaultPeriod},dashboardPeriodFor=null;
let dashboardDataActor=null,dashboardData=null,dashboardError='',dashboardEpoch=0,dashboardTeam=null,dashboardTeamError='',dashboardPerson=null,dashboardShownRange='',dashboardCountsLoading=false,dashboardTeamLoading=false;
const dashboardPeriodCache=new Map();
const dashboardZone='Africa/Dar_es_Salaam';
const dashboardPresets=[['today','Today'],['week','This week'],['month','This month'],['quarter','This quarter'],['year','This year'],['custom','Custom']];
// [key, label, colour, where a click goes]. No target: no existing list shows exactly these records.
// Calls and WhatsApps are left out: nothing in the ERP records them. New accounts and contacts per period are left
// out: those tables keep no creation date.
const dashboardCards={
 open:[
  ['overdue','Overdue work','overdue',null],['due_today','Due today','due',null],
  ['opportunities','Leads','leads',{view:'leads',filter:'open'}],['cases','Service jobs','cases',{view:'service',section:'schedule'}],
  ['accounts','Customer accounts','accounts',{view:'contacts'}],['scheduled_service','Scheduled visits','schedule',{view:'service',section:'schedule'}],
  ['quotes','Pro formas','quotes',{view:'sales',section:'proformas'}],['webqueries','Website inquiries','web',{view:'requests',section:'inquiries',filter:'open'}],
  ['contacts','Contacts','contacts',null],['tasks','Tasks','tasks',{view:'personal',section:'task'}]],
 periodic:[
  ['opportunities','Leads','leads',null],['cases','Service jobs','cases',null],['scheduled_service','Scheduled visits','schedule',null],
  ['quotes','Pro formas','quotes',null],['webqueries','Website inquiries','web',null],['tasks','Tasks','tasks',null]],
 // A fifth item lists the parts of a grouped card; the group shows their total.
 result:[
  ['cases','Service jobs','cases',null,[['cases_cancelled','Canceled Cases','cases',null],['cases_resolved','Resolved Cases','cases',null]]],
  ['opportunities','Leads','leads',null,[['opportunities_won','Closed Won','won',{view:'leads',filter:'won'}],['opportunities_lost','Closed Lost','lost',{view:'leads',filter:'lost'}]]],
  ['quotes_closed','Pro formas: accepted / rejected / cancelled','quotes',null],['tasks_completed','Completed Tasks','tasks',null],
  ['webqueries_closed','Closed website inquiries','web',{view:'requests',section:'inquiries',filter:'done'}]]
};
const dashboardParts=[['leads','Lead follow-ups'],['tasks','Tasks'],['steps','Order steps'],['service','Service visits']];
function clearDashboard(){dashboardEpoch++;dashboardDataActor=null;dashboardData=null;dashboardError='';dashboardTeam=null;dashboardTeamError='';dashboardPerson=null;dashboardPeriod={...dashboardDefaultPeriod};dashboardPeriodFor=null;dashboardShownRange='';dashboardCountsLoading=false;dashboardTeamLoading=false;dashboardPeriodCache.clear();}

// Dates are 'YYYY-MM-DD' strings for the Dar es Salaam calendar day.
function dashboardDay(now=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:dashboardZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
function dashboardAddDays(day,n){return new Date(Date.parse(day+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);}
function dashboardValidDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(String(day||''))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
// Inclusive first and last day of a choice. Weeks start on Monday; quarters on 1 January, April, July and October.
function dashboardRange(choice,today=dashboardDay()){
 if(choice.preset==='today')return {from:today,to:today};
 if(choice.preset==='week')return {from:dashboardAddDays(today,-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)),to:today};
 if(choice.preset==='month')return {from:today.slice(0,8)+'01',to:today};
 if(choice.preset==='quarter')return {from:`${today.slice(0,5)}${String(Math.floor((Number(today.slice(5,7))-1)/3)*3+1).padStart(2,'0')}-01`,to:today};
 if(choice.preset==='year')return {from:today.slice(0,5)+'01-01',to:today};
 if(choice.preset!=='custom')throw Error('Choose a period.');
 if(!dashboardValidDay(choice.from)||!dashboardValidDay(choice.to))throw Error('Choose a start and an end date.');
 if(choice.from>choice.to)throw Error('The start date must be on or before the end date.');
 if((Date.parse(choice.to)-Date.parse(choice.from))/864e5>366)throw Error('Choose a period of one year or less.');
 return {from:choice.from,to:choice.to};
}
function dashboardDate(day){const [y,m,d]=day.split('-');return `${d}/${m}/${y}`;}
function dashboardRangeLabel(choice,range){
 const name=dashboardPresets.find(([key])=>key===choice.preset)?.[1]||'';
 const dates=range.from===range.to?dashboardDate(range.from):`${dashboardDate(range.from)} – ${dashboardDate(range.to)}`;
 return choice.preset==='custom'?dates:`${name} (${dates})`;
}
// The cards one column shows, with their counts. A card whose count is null (no access) is left out.
function dashboardTiles(column,data){
 const counts=data?.[column]||{};
 return dashboardCards[column].map(([key,label,tone,target,parts])=>{
  if(parts){
   const items=parts.map(([k,l,t,g])=>({key:k,label:l,tone:t,target:g,value:counts[k]})).filter(item=>item.value!=null);
   return items.length?{key,label,tone,target:null,value:items.reduce((sum,item)=>sum+Number(item.value),0),items}:null;
  }
  return counts[key]==null?null:{key,label,tone,target,value:Number(counts[key]),breakdown:dashboardBreakdown(counts[key+'_parts'])};
 }).filter(Boolean);
}
// "Lead follow-ups 3 · Tasks 1": what an Overdues or Due Today count is made of (non-zero parts only).
function dashboardBreakdown(parts){return parts?dashboardParts.filter(([key])=>Number(parts[key])>0).map(([key,label])=>`${label} ${parts[key]}`).join(' · '):'';}
function dashboardTarget(column,key){
 for(const [k,,,target,parts] of dashboardCards[column]||[]){if(k===key)return target;const part=parts?.find(([p])=>p===key);if(part)return part[3];}
 return null;
}
// Open the list a card stands for, with the matching filter, the same way its menu entry does.
function dashboardOpen(target){
 if(!target)return;
 message('');search='';page=0;
 if(target.view==='contacts')return goProfile('clients');
 if(target.view==='leads'){if(typeof openLeadSection==='function')openLeadSection('leads');leadFilter=target.filter;leadSearch='';}
 if(target.view==='service')serviceSection=target.section;
 if(target.view==='sales'){if(typeof clearSalesPrefill==='function')clearSalesPrefill();salesFocusedProforma='';salesEditing='';salesSection=target.section;salesProformaFilter='all';salesProformaSearch='';}
 if(target.view==='requests'){openRequestSection(target.section);requestFilter=target.filter;}
 if(target.view==='personal'){personalSection=target.section;personalPage=0;}
 view=target.view;
 return run(async()=>render());
}

function dashboardNumber(n){return Number(n).toLocaleString('en-GB');}
function dashboardTile(column,tile){
 const body=`<span>${esc(tile.label)}</span> <strong>${esc(dashboardNumber(tile.value))}</strong>${tile.breakdown?` <small>${esc(tile.breakdown)}</small>`:''}`;
 return tile.target&&Number(tile.value)>0?`<button type="button" class="dashboard-tile dashboard-${tile.tone}" data-dashboard-count="${Number(tile.value)}" data-dashboard-open="${column}:${tile.key}">${body}</button>`
  :`<div class="dashboard-tile ${Number(tile.value)===0?'dashboard-zero':'dashboard-'+tile.tone}" data-dashboard-count="${Number(tile.value)}">${body}</div>`;
}
function dashboardGroup(column,tile){
 if(!tile.items)return dashboardTile(column,tile);
 return `<div class="dashboard-tile dashboard-group ${Number(tile.value)===0?'dashboard-zero':'dashboard-'+tile.tone}" data-dashboard-count="${Number(tile.value)}"><h3><span>${esc(tile.label)}</span><strong>${esc(dashboardNumber(tile.value))}</strong></h3><div class="dashboard-group-parts">${tile.items.map(item=>dashboardTile(column,item)).join('')}</div></div>`;
}
// The chosen period, remembered per person on this device. Storage can be missing or blocked (private window): the
// page then simply starts on Today.
function dashboardStorage(){try{return globalThis.localStorage||null}catch{return null}}
function dashboardPeriodKey(userId){return `anudha.dashboard.period.${userId}`;}
function dashboardLoadPeriod(userId,storage=dashboardStorage()){
 try{
  const saved=JSON.parse(storage?.getItem(dashboardPeriodKey(userId))||'null');
  if(saved&&dashboardPresets.some(([key])=>key===saved.preset)){const choice={preset:saved.preset,from:String(saved.from||''),to:String(saved.to||'')};dashboardRange(choice);return choice;}
 }catch{}
 return {...dashboardDefaultPeriod};
}
function dashboardSavePeriod(userId,choice,storage=dashboardStorage()){
 try{storage?.setItem(dashboardPeriodKey(userId),JSON.stringify({preset:choice.preset,from:choice.from||'',to:choice.to||''}));}catch{}
}
function dashboardPicker(range){
 const choice=dashboardPeriod;
 return `<div class="dashboard-period" role="group" aria-label="Reporting period"><div class="dashboard-period-heading"><span>Reporting period</span><p class="dashboard-range">${esc(dashboardRangeLabel(choice,range))}</p></div><div class="dashboard-presets">${dashboardPresets.map(([key,label])=>`<button type="button" data-dashboard-preset="${key}" aria-pressed="${choice.preset===key}"${choice.preset===key?' class="active"':''}>${label}</button>`).join('')}</div>${choice.preset==='custom'?`<div class="dashboard-custom"><label><span>From</span><input type="date" id="dashboardFrom" value="${esc(choice.from)}"></label><label><span>To</span><input type="date" id="dashboardTo" value="${esc(choice.to)}"></label><button type="button" id="dashboardApply">Show</button></div>`:''}<p class="dashboard-period-help">Applies to activity, outcomes${dashboardTeamVisible()?' and team tasks':''}. Current work shows all open items.</p></div>`;
}
function dashboardSkeleton(label){return `<div class="dashboard-skeleton" role="status" aria-label="${esc(label)}"><span class="muted">${esc(label)}</span><div aria-hidden="true">${'<span class="dashboard-skeleton-line"></span>'.repeat(4)}</div></div>`;}
function dashboardColumn(column,title,description){
 const tiles=dashboardTiles(column,dashboardData);
 return `<section class="dashboard-column dashboard-${column}" aria-labelledby="dashboard-${column}-title"><div class="dashboard-column-heading"><h2 id="dashboard-${column}-title">${esc(title)}</h2><p>${esc(description)}</p></div><div class="dashboard-tiles">${!dashboardData?.[column]?(dashboardCountsLoading?dashboardSkeleton('Loading '+title.toLowerCase()+'…'):'<p class="muted">Counts unavailable.</p>'):tiles.map(tile=>dashboardGroup(column,tile)).join('')||'<p class="muted">Nothing to show for your areas.</p>'}</div></section>`;
}

// Team tasks: the owner sees everyone, a department head their own department. The database decides who is listed.
function dashboardTeamVisible(){return me?.role==='owner'||me?.role==='head';}
function dashboardTeamCounts(row){return `${dashboardNumber(row.open_count)} open · ${dashboardNumber(row.completed_count)} completed · ${dashboardNumber(row.late_count)} late`;}
// "Jagroop: 4 open · 11 completed · 1 late"
function dashboardTeamLine(row){return `${employeeName(row.user_id)}: ${dashboardTeamCounts(row)}`;}
// Most late first, then most open, then by name.
function dashboardTeamOrder(rows){return [...rows].sort((a,b)=>Number(b.late_count)-Number(a.late_count)||Number(b.open_count)-Number(a.open_count)||employeeName(a.user_id).localeCompare(employeeName(b.user_id))||String(a.user_id).localeCompare(String(b.user_id)));}
function dashboardWhen(iso){return new Date(iso).toLocaleString('en-GB',{timeZone:dashboardZone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
function dashboardPersonTask(task,now=Date.now()){
 const open=task.status==='open',late=open?Date.parse(task.due_at)<now:Date.parse(task.closed_at)>Date.parse(task.due_at);
 const state=open?(late?'Late · not done yet':'Not done yet'):`Done ${dashboardWhen(task.closed_at)}${late?' · late':''}`;
 return `<li class="${late?'late':''}"><strong>${esc(task.title)}</strong> <small>${esc(task.task_number)}</small><br><small>${esc(state)} · due ${esc(dashboardWhen(task.due_at))} · from ${esc(employeeName(task.assigned_by))}</small>${task.close_note?`<p class="dashboard-task-result">Result: ${esc(task.close_note)}</p>`:''}</li>`;
}
function dashboardPersonPanel(person){
 if(person.error)return `<div class="dashboard-person-tasks"><p role="alert">Tasks could not load: ${esc(person.error)}</p></div>`;
 if(!person.rows)return '<div class="dashboard-person-tasks"><p role="status">Loading tasks…</p></div>';
 return `<div class="dashboard-person-tasks">${person.rows.length?`<ol>${person.rows.map(task=>dashboardPersonTask(task)).join('')}</ol>`:'<p class="muted">No tasks in this period.</p>'}</div>`;
}
function dashboardTeamList(rows){
 return `<ul class="dashboard-team-list">${rows.map(row=>{
  const active=Number(row.open_count)>0||Number(row.completed_count)>0||Number(row.late_count)>0,shown=active&&dashboardPerson?.user_id===row.user_id;
  const body=`<span class="dashboard-person-identity"><strong>${esc(employeeName(row.user_id))}</strong>${me?.role==='owner'&&row.department?` <small>${esc(row.department)}</small>`:''}</span> <span class="dashboard-person-counts">${esc(dashboardTeamCounts(row))}</span>`;
  return `<li>${active?`<button type="button" class="dashboard-person${Number(row.late_count)>0?' has-late':''}" data-dashboard-person="${esc(row.user_id)}" aria-expanded="${shown}" title="${shown?'Hide':'Show'} tasks">${body}</button>`:`<div class="dashboard-person dashboard-person-inactive">${body}</div>`}${shown?dashboardPersonPanel(dashboardPerson):''}</li>`;
 }).join('')}</ul>`;
}
function dashboardTeamSection(inactiveOpen=false){
 if(!dashboardTeamVisible())return '';
 const rows=dashboardTeam?dashboardTeamOrder(dashboardTeam):[];
 const active=[],inactive=[];
 for(const row of rows)(Number(row.open_count)>0||Number(row.completed_count)>0||Number(row.late_count)>0?active:inactive).push(row);
 const body=dashboardTeamError?`<p role="alert">Team tasks could not load: ${esc(dashboardTeamError)}</p>`:!dashboardTeam?(dashboardTeamLoading?dashboardSkeleton('Loading team tasks…'):''):rows.length?`${active.length?dashboardTeamList(active):'<p class="dashboard-team-empty">No task activity for this period.</p>'}${inactive.length?`<details id="dashboardTeamInactive" class="dashboard-team-inactive"${inactiveOpen?' open':''}><summary>People with no task activity <span>(${dashboardNumber(inactive.length)})</span></summary>${dashboardTeamList(inactive)}</details>`:''}`:'<p class="muted">Nobody in your department yet.</p>';
 return `<section class="dashboard-team" aria-labelledby="dashboard-team-title"><div class="dashboard-team-heading"><div><h2 id="dashboard-team-title">Team tasks</h2><p class="muted">${me?.role==='owner'?'Everyone':'People in your department'}. Select a person to view tasks and results.</p></div><details id="dashboardTeamKey" class="dashboard-team-key"><summary>How counts work</summary><p>Open: not done yet and due by the end of the period. Completed: marked done in the period. Late: still open after the due time, or done after it.</p></details></div>${body}</section>`;
}
async function dashboardOpenPerson(userId,range){
 if(dashboardPerson?.user_id===userId){dashboardPerson=null;return renderDashboardTeam(range,userId);}
 const epoch=dashboardEpoch,actor=me?.user_id;
 dashboardPerson={user_id:userId,rows:null,error:''};renderDashboardTeam(range,userId);
 const r=await client.rpc('team_member_tasks',{p_user_id:userId,p_from:range.from,p_to:range.to});
 if(epoch!==dashboardEpoch||me?.user_id!==actor||view!=='dashboard'||dashboardPerson?.user_id!==userId)return;
 dashboardPerson={user_id:userId,rows:r.error?null:(r.data||[]),error:r.error?(r.error.message||'Unknown error'):''};
 renderDashboardTeam(range);
}
function renderDashboard(range,focusPerson=''){
 const inactiveOpen=$('#dashboardTeamInactive')?.open;
 $('#content').innerHTML=`<section class="dashboard">${workspacePageHeader({title:'Dashboard',subtitle:'Your work, activity and team at a glance.',actions:'<button type="button" id="dashboardRefresh">Refresh</button>'})}<div id="dashboardStatus">${dashboardError?`<p class="notice error" role="alert">The dashboard could not load: ${esc(dashboardError)}. Press Refresh to try again.</p>`:''}</div>${dashboardPicker(range)}<div id="dashboardCounts" class="dashboard-columns" aria-busy="${dashboardCountsLoading}">${dashboardColumn('open','Current work','Open items and customer records')}${dashboardColumn('periodic','Activity','Created or scheduled in the period')}${dashboardColumn('result','Outcomes','Completed or closed in the period')}</div><div id="dashboardTeamPanel" aria-busy="${dashboardTeamLoading}">${dashboardTeamSection(inactiveOpen)}</div></section>`;
 $('#dashboardRefresh').onclick=()=>run(dashboardWorkspace);
 document.querySelectorAll('[data-dashboard-open]').forEach(button=>button.onclick=()=>{const [column,key]=button.dataset.dashboardOpen.split(':');dashboardOpen(dashboardTarget(column,key));});
 document.querySelectorAll('[data-dashboard-preset]').forEach(button=>button.onclick=()=>{
  const preset=button.dataset.dashboardPreset;
  // Custom starts from the dates on screen, so the person only changes what they need.
  if(preset==='custom'){dashboardPeriod={preset:'custom',from:range.from,to:range.to};return renderDashboard(range);}
  dashboardPeriod={preset,from:'',to:''};dashboardPerson=null;dashboardSavePeriod(me?.user_id,dashboardPeriod);run(dashboardWorkspace);
 });
 const apply=$('#dashboardApply');
 if(apply)apply.onclick=()=>run(async()=>{
  const choice={preset:'custom',from:$('#dashboardFrom').value,to:$('#dashboardTo').value};
  dashboardRange(choice);dashboardPeriod=choice;dashboardPerson=null;dashboardSavePeriod(me?.user_id,choice);await dashboardWorkspace();
 });
 document.querySelectorAll('[data-dashboard-person]').forEach(button=>button.onclick=()=>run(()=>dashboardOpenPerson(button.dataset.dashboardPerson,range)));
 if(focusPerson)[...document.querySelectorAll('[data-dashboard-person]')].find(button=>button.dataset.dashboardPerson===focusPerson)?.focus();
}
function renderDashboardCounts(){
 const target=$('#dashboardCounts');if(!target)return;
 target.innerHTML=dashboardColumn('open','Current work','Open items and customer records')+dashboardColumn('periodic','Activity','Created or scheduled in the period')+dashboardColumn('result','Outcomes','Completed or closed in the period');
 $('#dashboardStatus').innerHTML=dashboardError?`<p class="notice error" role="alert">The dashboard could not load: ${esc(dashboardError)}. Press Refresh to try again.</p>`:'';
 target.setAttribute('aria-busy',String(dashboardCountsLoading));
 target.querySelectorAll('[data-dashboard-open]').forEach(button=>button.onclick=()=>{const [column,key]=button.dataset.dashboardOpen.split(':');dashboardOpen(dashboardTarget(column,key));});
}
function renderDashboardTeam(range,focusPerson=''){
 const target=$('#dashboardTeamPanel');if(!target)return;
 const inactiveOpen=$('#dashboardTeamInactive')?.open,keyOpen=$('#dashboardTeamKey')?.open,active=document.activeElement;
 const focusedPerson=focusPerson||active?.dataset?.dashboardPerson,focusedSummary=active?.tagName==='SUMMARY'?active.parentElement?.id:'';
 target.innerHTML=dashboardTeamSection(inactiveOpen);target.setAttribute('aria-busy',String(dashboardTeamLoading));
 if(keyOpen&&$('#dashboardTeamKey'))$('#dashboardTeamKey').open=true;
 target.querySelectorAll('[data-dashboard-person]').forEach(button=>{button.onclick=()=>run(()=>dashboardOpenPerson(button.dataset.dashboardPerson,range));if(button.dataset.dashboardPerson===focusedPerson)button.focus({preventScroll:true});});
 if(focusedSummary&&['dashboardTeamInactive','dashboardTeamKey'].includes(focusedSummary))$('#'+focusedSummary)?.querySelector('summary')?.focus({preventScroll:true});
}
async function dashboardWorkspace(){
 const epoch=++dashboardEpoch,actor=me;syncWorkspaceNavigation();
 if(dashboardPeriodFor!==actor?.user_id){dashboardPeriod=dashboardLoadPeriod(actor?.user_id);dashboardPeriodFor=actor?.user_id;}
 if(dashboardDataActor!==actor){dashboardDataActor=actor;dashboardData=null;dashboardTeam=null;dashboardPerson=null;dashboardShownRange='';}
 const range=dashboardRange(dashboardPeriod,dashboardDay()),key=JSON.stringify([actor?.user_id,range.from,range.to]),team=dashboardTeamVisible(),person=team?dashboardPerson:null;
 const current=()=>epoch===dashboardEpoch&&me===actor&&view==='dashboard';
 for(const [cachedKey,item] of dashboardPeriodCache)if(Date.now()-item.at>=60000||item.actor!==actor)dashboardPeriodCache.delete(cachedKey);
 const cached=dashboardPeriodCache.get(key),changedRange=dashboardShownRange!==key;
 if(changedRange){dashboardData=dashboardData?.open?{open:dashboardData.open}:null;dashboardTeam=null;dashboardTeamError='';}
 if(cached)dashboardData={...dashboardData,periodic:cached.periodic,result:cached.result};
 dashboardShownRange=key;dashboardCountsLoading=true;dashboardTeamLoading=team;dashboardError='';
 if(changedRange||!$('#dashboardCounts'))renderDashboard(range);
 else{$('#dashboardCounts').setAttribute('aria-busy','true');if(team)$('#dashboardTeamPanel').setAttribute('aria-busy','true');}
 const counts=(async()=>{
  let r;try{r=await client.rpc(cached?'dashboard_open_counts':'dashboard_counts',cached?{}:{p_periodic_from:range.from,p_periodic_to:range.to,p_result_from:range.from,p_result_to:range.to});}catch(error){r={error};}
  if(!current())return;
  dashboardCountsLoading=false;
  if(r.error)dashboardError=r.error.message||'Unknown error';
  else{
   dashboardData=cached?{...r.data,periodic:cached.periodic,result:cached.result}:r.data;dashboardError='';
   if(!cached)dashboardPeriodCache.set(key,{actor,at:Date.now(),periodic:r.data?.periodic,result:r.data?.result});
  }
  renderDashboardCounts();
 })();
 const teamCounts=team?(async()=>{
  let result;try{result=await client.rpc('team_task_counts',{p_from:range.from,p_to:range.to});}catch(error){result={error};}
  if(!current())return;
  dashboardTeamLoading=false;dashboardTeamError=result.error?(result.error.message||'Unknown error'):'';dashboardTeam=result.error?null:(result.data||[]);renderDashboardTeam(range);
 })():null;
 const personTasks=person?(async()=>{
  let result;try{result=await client.rpc('team_member_tasks',{p_user_id:person.user_id,p_from:range.from,p_to:range.to});}catch(error){result={error};}
  if(!current()||dashboardPerson?.user_id!==person.user_id)return;
  dashboardPerson={user_id:person.user_id,rows:result.error?null:(result.data||[]),error:result.error?(result.error.message||'Unknown error'):''};renderDashboardTeam(range);
 })():null;
 // Each request paints its own region before this wait releases the Refresh action.
 await Promise.all([counts,teamCounts,personTasks]);
}
