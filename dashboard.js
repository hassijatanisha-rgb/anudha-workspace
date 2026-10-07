'use strict';
// Dashboard: counts of open work, of what was created in a chosen period and of what was finished in a chosen period.
// One read (dashboard_counts, migration 067) under the signed-in person's own read rules: a count from an area they
// cannot open comes back empty and its card is left out. Counts only, never amounts. Days are Dar es Salaam days.
// Which table and filter feed each card: docs/DASHBOARD-CARDS.md.
let dashboardPeriodic={preset:'yesterday',from:'',to:''},dashboardResult={preset:'today',from:'',to:''};
let dashboardData=null,dashboardError='',dashboardEpoch=0;
const dashboardZone='Africa/Dar_es_Salaam';
const dashboardPresets=[['today','Today'],['yesterday','Yesterday'],['week','This week'],['month','This month'],['custom','Custom range']];
// [key, label, colour, where a click goes]. No target: no existing list shows exactly these records.
// Calls and WhatsApps are left out: nothing in the ERP records them. New accounts and contacts per period are left
// out: those tables keep no creation date.
const dashboardCards={
 open:[
  ['overdue','Overdues','overdue',null],['due_today','Due Today','due',null],
  ['opportunities','Opportunities','leads',{view:'leads',filter:'open'}],['cases','Cases','cases',{view:'service',section:'schedule'}],
  ['accounts','Accounts','accounts',{view:'contacts'}],['scheduled_service','Scheduled Service Activities','schedule',{view:'service',section:'schedule'}],
  ['quotes','Quotes','quotes',{view:'sales',section:'proformas'}],['webqueries','Webqueries','web',{view:'requests',section:'inquiries',filter:'open'}],
  ['contacts','Contacts','contacts',null],['tasks','Tasks','tasks',{view:'personal',section:'task'}]],
 periodic:[
  ['opportunities','Opportunities','leads',null],['cases','Cases','cases',null],['scheduled_service','Scheduled Service Activities','schedule',null],
  ['quotes','Quotes','quotes',null],['webqueries','Webqueries','web',null],['tasks','Tasks','tasks',null]],
 // A fifth item lists the parts of a grouped card; the group shows their total.
 result:[
  ['cases','Cases','cases',null,[['cases_cancelled','Canceled Cases','cases',null],['cases_resolved','Resolved Cases','cases',null]]],
  ['opportunities','Opportunities','leads',null,[['opportunities_won','Closed Won','won',{view:'leads',filter:'won'}],['opportunities_lost','Closed Lost','lost',{view:'leads',filter:'lost'}]]],
  ['quotes_closed','Close Quotes','quotes',null],['tasks_completed','Completed Tasks','tasks',null],
  ['webqueries_closed','Close Webqueries','web',{view:'requests',section:'inquiries',filter:'done'}]]
};
const dashboardParts=[['leads','Lead follow-ups'],['tasks','Tasks'],['steps','Order steps'],['service','Service visits']];
function clearDashboard(){dashboardEpoch++;dashboardData=null;dashboardError='';}

// Dates are 'YYYY-MM-DD' strings for the Dar es Salaam calendar day.
function dashboardDay(now=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:dashboardZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
function dashboardAddDays(day,n){return new Date(Date.parse(day+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);}
function dashboardValidDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(String(day||''))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
// Inclusive first and last day of a choice. Weeks start on Monday.
function dashboardRange(choice,today=dashboardDay()){
 if(choice.preset==='today')return {from:today,to:today};
 if(choice.preset==='yesterday'){const day=dashboardAddDays(today,-1);return {from:day,to:day};}
 if(choice.preset==='week')return {from:dashboardAddDays(today,-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)),to:today};
 if(choice.preset==='month')return {from:today.slice(0,8)+'01',to:today};
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
 const body=`<span>${esc(tile.label)}</span><strong>${esc(dashboardNumber(tile.value))}</strong>${tile.breakdown?`<small>${esc(tile.breakdown)}</small>`:''}`;
 return tile.target?`<button type="button" class="dashboard-tile dashboard-${tile.tone}" data-dashboard-open="${column}:${tile.key}" aria-label="${esc(tile.label)}: ${esc(tile.value)}. Open the list">${body}</button>`
  :`<div class="dashboard-tile dashboard-${tile.tone}">${body}</div>`;
}
function dashboardGroup(column,tile){
 if(!tile.items)return dashboardTile(column,tile);
 return `<div class="dashboard-tile dashboard-group dashboard-${tile.tone}"><h3>${esc(tile.label)} <strong>(${esc(dashboardNumber(tile.value))})</strong></h3><div class="dashboard-group-parts">${tile.items.map(item=>dashboardTile(column,item)).join('')}</div></div>`;
}
function dashboardPicker(column,choice,range){
 return `<div class="dashboard-period"><p class="dashboard-range">${esc(dashboardRangeLabel(choice,range))}</p><label><span>Show</span><select data-dashboard-preset="${column}">${dashboardPresets.map(([key,label])=>`<option value="${key}"${choice.preset===key?' selected':''}>${label}</option>`).join('')}</select></label>${choice.preset==='custom'?`<div class="dashboard-custom"><label><span>From</span><input type="date" data-dashboard-from="${column}" value="${esc(choice.from)}"></label><label><span>To</span><input type="date" data-dashboard-to="${column}" value="${esc(choice.to)}"></label><button type="button" data-dashboard-apply="${column}">Show</button></div>`:''}</div>`;
}
function dashboardColumn(column,title,picker){
 const tiles=dashboardTiles(column,dashboardData);
 return `<section class="dashboard-column dashboard-${column}" aria-label="${title}"><h2>${title}</h2>${picker||''}<div class="dashboard-tiles">${tiles.map(tile=>dashboardGroup(column,tile)).join('')||'<p class="muted">Nothing to show for your areas.</p>'}</div></section>`;
}
function renderDashboard(periodic,result){
 $('#content').innerHTML=`<section class="dashboard"><div class="heading"><div><small>MAIN</small><h1>Dashboard</h1><p class="muted">What is open now, what came in and what was finished. Press a card to open its list.</p></div><button type="button" id="dashboardRefresh">Refresh</button></div>${dashboardError?`<p class="notice error" role="alert">The dashboard could not load: ${esc(dashboardError)}. Press Refresh to try again.</p>`:''}${dashboardData?`<div class="dashboard-columns">${dashboardColumn('open','Open')}${dashboardColumn('periodic','Periodic',dashboardPicker('periodic',dashboardPeriodic,periodic))}${dashboardColumn('result','Result',dashboardPicker('result',dashboardResult,result))}</div>`:''}</section>`;
 $('#dashboardRefresh').onclick=()=>run(dashboardWorkspace);
 document.querySelectorAll('[data-dashboard-open]').forEach(button=>button.onclick=()=>{const [column,key]=button.dataset.dashboardOpen.split(':');dashboardOpen(dashboardTarget(column,key));});
 const choiceFor=column=>column==='periodic'?dashboardPeriodic:dashboardResult;
 document.querySelectorAll('[data-dashboard-preset]').forEach(select=>select.onchange=()=>{
  const choice=choiceFor(select.dataset.dashboardPreset),range=dashboardRange(choice);
  // Custom starts from the dates on screen, so the person only changes what they need.
  if(select.value==='custom'){Object.assign(choice,{preset:'custom',from:range.from,to:range.to});return renderDashboard(periodic,result);}
  choice.preset=select.value;run(dashboardWorkspace);
 });
 document.querySelectorAll('[data-dashboard-apply]').forEach(button=>button.onclick=()=>run(async()=>{
  const column=button.dataset.dashboardApply,choice={preset:'custom',from:$(`[data-dashboard-from="${column}"]`).value,to:$(`[data-dashboard-to="${column}"]`).value};
  dashboardRange(choice);Object.assign(choiceFor(column),choice);await dashboardWorkspace();
 }));
}
async function dashboardWorkspace(){
 const epoch=++dashboardEpoch,actor=me?.user_id;syncWorkspaceNavigation();
 const today=dashboardDay(),periodic=dashboardRange(dashboardPeriodic,today),result=dashboardRange(dashboardResult,today);
 if(!dashboardData)$('#content').innerHTML='<p role="status">Loading the dashboard…</p>';
 const r=await client.rpc('dashboard_counts',{p_periodic_from:periodic.from,p_periodic_to:periodic.to,p_result_from:result.from,p_result_to:result.to});
 if(epoch!==dashboardEpoch||me?.user_id!==actor||view!=='dashboard')return;
 if(r.error)dashboardError=r.error.message||'Unknown error';else{dashboardData=r.data;dashboardError='';}
 renderDashboard(periodic,result);
}
