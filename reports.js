'use strict';
// Read-only reports from recorded history: weekly/monthly sales activity per employee and stock movements.
let reportTab='work',reportPeriod='this_week',reportFrom='',reportTo='',reportEpoch=0,reportRows=[],reportColumns=[];
const reportActivityColumns=[['inquiries','Inquiries recorded'],['qualified','Passed to sales'],['won','Leads won'],['lost','Leads lost'],['proformas','Pro formas created'],['sent','Pro formas sent'],['accepted','Pro formas accepted'],['delivered','Deliveries signed'],['serviceReports','Service reports completed'],['pendingCreated','Pending orders recorded'],['pendingFulfilled','Pending orders fulfilled'],['stepsDone','Handed-over steps done']];
const reportMovementLabels={opening_balance:'Opening balance',opening_adjustment:'Opening correction',transfer_dispatch:'Sent to another godown',transfer_receipt:'Received from another godown',quarantine_receipt:'Received into quarantine',break_pack:'Carton opened',consumer_issue:'Issued to customer',consumer_return:'Returned by customer'};
function clearReports(){reportEpoch++;reportRows=[];reportColumns=[];}
const reportDepartments={sales:'Sales',accounts:'Accounts',stores:'Stores & delivery',service:'Service',management:'Management','':'No department'};
function reportHours(ms){if(ms==null)return '—';const hours=ms/3600000;return hours<48?`${hours.toFixed(1)} h`:`${(hours/24).toFixed(1)} days`;}
// Work done per person in the period, plus what is open and overdue right now. A step counts as finished when its
// holder marked it done or it moved on to the next person; cancelled steps are not counted. Department rows are
// subtotals (excluded from the company total).
function reportWork({finished=[],open=[],delays=[],departments=new Map(),now=Date.now(),overdue=row=>false}){
 const people=new Map(),person=id=>{if(!people.has(id))people.set(id,{actor:id,finished:0,stepMs:0,open_now:0,overdue_now:0,longestMs:null,delays:0});return people.get(id);};
 for(const row of finished)if(['done','handed_on'].includes(row.status)&&row.assignee_user_id){const p=person(row.assignee_user_id);p.finished++;p.stepMs+=Math.max(0,Date.parse(row.closed_at)-Date.parse(row.created_at));}
 for(const row of open){const p=person(row.assignee_user_id);p.open_now++;if(overdue(row))p.overdue_now++;const wait=now-Date.parse(row.created_at);if(p.longestMs==null||wait>p.longestMs)p.longestMs=wait;}
 for(const d of delays)if(d.assignee_user_id)person(d.assignee_user_id).delays++;
 const rows=[...people.values()].map(p=>({...p,department:departments.get(p.actor)||'',avgMs:p.finished?p.stepMs/p.finished:null}));
 const dept=new Map();for(const r of rows){if(!dept.has(r.department))dept.set(r.department,{department:r.department,finished:0,stepMs:0,open_now:0,overdue_now:0,longestMs:null,delays:0,people:0});const d=dept.get(r.department);d.people++;d.finished+=r.finished;d.stepMs+=r.stepMs;d.open_now+=r.open_now;d.overdue_now+=r.overdue_now;d.delays+=r.delays;if(r.longestMs!=null&&(d.longestMs==null||r.longestMs>d.longestMs))d.longestMs=r.longestMs;}
 const order=Object.keys(reportDepartments);
 return {people:rows.sort((a,b)=>order.indexOf(a.department)-order.indexOf(b.department)||b.overdue_now-a.overdue_now||String(a.actor).localeCompare(String(b.actor))),
  departments:[...dept.values()].map(d=>({...d,avgMs:d.finished?d.stepMs/d.finished:null})).sort((a,b)=>order.indexOf(a.department)-order.indexOf(b.department))};
}
async function reportFetchOpenWork(){
 const out=[];for(let offset=0;;offset+=1000){const r=await client.from('work_assignments').select('id,assignee_user_id,status,created_at,due_on').eq('status','open').order('id').range(offset,offset+999);if(r.error)throw Error(r.error.message);out.push(...(r.data||[]));if((r.data||[]).length<1000)return out;}
}
function reportIsoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
// Returns [from, to) as local dates. Weeks start on Monday.
function reportRange(period,today=new Date(),from='',to=''){
 const day=new Date(today.getFullYear(),today.getMonth(),today.getDate()),monday=new Date(day);monday.setDate(day.getDate()-((day.getDay()+6)%7));
 const add=(date,days)=>{const next=new Date(date);next.setDate(next.getDate()+days);return next;};
 if(period==='this_week')return [reportIsoDate(monday),reportIsoDate(add(monday,7))];
 if(period==='last_week')return [reportIsoDate(add(monday,-7)),reportIsoDate(monday)];
 if(period==='this_month')return [reportIsoDate(new Date(day.getFullYear(),day.getMonth(),1)),reportIsoDate(new Date(day.getFullYear(),day.getMonth()+1,1))];
 if(period==='last_month')return [reportIsoDate(new Date(day.getFullYear(),day.getMonth()-1,1)),reportIsoDate(new Date(day.getFullYear(),day.getMonth(),1))];
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<from)throw Error('Choose a start date and an end date on or after it.');
 return [from,reportIsoDate(add(new Date(`${to}T00:00:00`),1))];
}
function reportBump(map,actor,key){if(!actor)return;if(!map.has(actor))map.set(actor,Object.fromEntries(reportActivityColumns.map(([k])=>[k,0])));map.get(actor)[key]++;}
function reportActivity({leadEvents=[],proformaEvents=[],deliveryEvents=[],serviceEvents=[],pendingEvents=[],steps=[]}){
 const out=new Map();
 for(const e of leadEvents){if(e.action==='create')reportBump(out,e.actor_user_id,'inquiries');if(e.action==='qualify'||(e.action==='assign'&&e.from_stage==='inquiry'))reportBump(out,e.actor_user_id,'qualified');if(e.action==='won')reportBump(out,e.actor_user_id,'won');if(e.action==='lost')reportBump(out,e.actor_user_id,'lost');}
 for(const e of proformaEvents){if(!e.from_status&&e.to_status==='draft')reportBump(out,e.actor_user_id,'proformas');if(e.to_status==='sent'&&e.from_status!=='sent')reportBump(out,e.actor_user_id,'sent');if(e.to_status==='accepted'&&e.from_status!=='accepted')reportBump(out,e.actor_user_id,'accepted');}
 for(const e of deliveryEvents)if(e.to_status==='delivered'&&e.from_status!=='delivered')reportBump(out,e.actor_user_id,'delivered');
 for(const e of serviceEvents)if(e.to_status==='completed'&&e.from_status!=='completed')reportBump(out,e.actor_user_id,'serviceReports');
 for(const e of pendingEvents){if(e.action==='create')reportBump(out,e.actor_user_id,'pendingCreated');if(e.action==='fulfil')reportBump(out,e.actor_user_id,'pendingFulfilled');}
 for(const s of steps)if(s.status==='done')reportBump(out,s.closed_by,'stepsDone');
 return [...out.entries()].map(([actor,counts])=>({actor,...counts,total:Object.values(counts).reduce((a,b)=>a+b,0)})).sort((a,b)=>b.total-a.total||employeeName(a.actor).localeCompare(employeeName(b.actor)));
}
// Sums signed base-unit changes per product, location and movement type. Pieces only; cartons are already converted by the database.
function reportMovements(movements,lots){
 const lotById=new Map(lots.map(lot=>[lot.id,lot])),out=new Map();
 for(const m of movements){
  const lot=lotById.get(m.lot_id),key=`${lot?.product_id||'unknown'}|${lot?.location_id||'unknown'}|${m.movement_type}`;
  if(!out.has(key))out.set(key,{product_id:lot?.product_id||'',location_id:lot?.location_id||'',movement_type:m.movement_type,count:0,pieces_in:0,pieces_out:0});
  const row=out.get(key),change=Number(m.base_unit_change)||0;row.count++;if(change>=0)row.pieces_in+=change;else row.pieces_out-=change;
 }
 return [...out.values()].sort((a,b)=>reportProductName(a.product_id).localeCompare(reportProductName(b.product_id))||a.movement_type.localeCompare(b.movement_type));
}
function reportProductName(id){if(!id)return 'Unknown product';const product=typeof inventoryProduct==='function'?inventoryProduct(id):products.find(p=>p.id===id);return product?.name||'Unknown product';}
function reportLocationName(id){return (typeof inventoryLocations!=='undefined'?inventoryLocations:[]).find(l=>l.id===id)?.name||reportLocationNames.get(id)||'Unknown location';}
let reportLocationNames=new Map();
async function reportFetchRange(table,columns,column,from,to){
 const out=[];
 for(let offset=0;offset<50000;offset+=1000){
  // Local midnight in the user's timezone (Dar es Salaam is UTC+3), sent as an exact instant.
  const result=await client.from(table).select(columns).gte(column,new Date(`${from}T00:00:00`).toISOString()).lt(column,new Date(`${to}T00:00:00`).toISOString()).order(column).order('id').range(offset,offset+999);
  if(result.error)throw Error(`${table}: ${result.error.message}`);
  out.push(...(result.data||[]));if((result.data||[]).length<1000)return out;
 }
 throw Error('This period has more than 50,000 records. Choose a shorter period.');
}
function reportCsv(columns,rows){
 const cell=value=>{const text=String(value??'');return /[",\n]/.test(text)||/^[=+\-@]/.test(text)?`"${(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')}"`:text;};
 return [columns.map(([,label])=>cell(label)).join(','),...rows.map(row=>columns.map(([key])=>cell(row[key])).join(','))].join('\r\n');
}
async function reportsWorkspace(){
 const epoch=++reportEpoch,actor=me?.user_id;syncWorkspaceNavigation();
 let range;try{range=reportRange(reportPeriod,new Date(),reportFrom,reportTo);}catch(error){range=null;renderReports(null,error.message);return;}
 $('#content').innerHTML='<p role="status">Building report…</p>';
 const [from,to]=range;
 try{
  if(reportTab==='work'){
   const [finished,open,delayRows,depts]=await Promise.all([reportFetchRange('work_assignments','id,assignee_user_id,status,created_at,closed_at','closed_at',from,to),reportFetchOpenWork(),reportFetchRange('work_delays','assignment_id,recorded_at','recorded_at',from,to),client.rpc('staff_departments')]);
   if(depts.error)throw Error(depts.error.message);
   const ids=[...new Set(delayRows.map(d=>d.assignment_id))],holders=new Map();
   for(let i=0;i<ids.length;i+=100){const r=await client.from('work_assignments').select('id,assignee_user_id').in('id',ids.slice(i,i+100));if(r.error)throw Error(r.error.message);for(const a of r.data||[])holders.set(a.id,a.assignee_user_id);}
   const openIds=open.map(o=>o.id),latest=new Map();
   for(let i=0;i<openIds.length;i+=100){const r=await client.from('work_delays').select('assignment_id,expected_on,recorded_at').in('assignment_id',openIds.slice(i,i+100));if(r.error)throw Error(r.error.message);for(const d of r.data||[])if(!latest.has(d.assignment_id)||latest.get(d.assignment_id).recorded_at<d.recorded_at)latest.set(d.assignment_id,d);}
   if(epoch!==reportEpoch||me?.user_id!==actor||view!=='reports')return;
   const result=reportWork({finished,open,delays:delayRows.map(d=>({...d,assignee_user_id:holders.get(d.assignment_id)})),departments:new Map((depts.data||[]).map(d=>[d.user_id,d.department])),overdue:row=>typeof workAgeLevel==='function'&&workAgeLevel(row,latest.get(row.id))==='red'});
   reportRows=[...result.people.map(p=>({employee:employeeName(p.actor),department:reportDepartments[p.department],finished:p.finished,avg:reportHours(p.avgMs),open_now:p.open_now,overdue_now:p.overdue_now,longest:reportHours(p.longestMs),delays:p.delays})),
    ...result.departments.map(d=>({_subtotal:true,employee:`All ${reportDepartments[d.department]} (${d.people})`,department:reportDepartments[d.department],finished:d.finished,avg:reportHours(d.avgMs),open_now:d.open_now,overdue_now:d.overdue_now,longest:reportHours(d.longestMs),delays:d.delays}))];
   reportColumns=[['employee','Employee'],['department','Department'],['finished','Steps finished'],['avg','Average time per step'],['open_now','Open now'],['overdue_now','Overdue now'],['longest','Longest waiting now'],['delays','Delays reported']];
  }else if(reportTab==='activity'){
   const [leadEvents,proformaEvents,deliveryEvents,serviceEvents,pendingEvents,steps]=await Promise.all([
    reportFetchRange('sales_lead_events','id,action,from_stage,to_stage,actor_user_id,created_at','created_at',from,to),
    reportFetchRange('sales_proforma_events','id,from_status,to_status,actor_user_id,created_at','created_at',from,to),
    reportFetchRange('sales_delivery_events','id,from_status,to_status,actor_user_id,created_at','created_at',from,to),
    reportFetchRange('service_case_events','id,from_status,to_status,actor_user_id,created_at','created_at',from,to),
    reportFetchRange('pending_stock_events','id,action,actor_user_id,created_at','created_at',from,to),
    reportFetchRange('work_assignments','id,status,closed_by,closed_at','closed_at',from,to)]);
   if(epoch!==reportEpoch||me?.user_id!==actor||view!=='reports')return;
   reportRows=reportActivity({leadEvents,proformaEvents,deliveryEvents,serviceEvents,pendingEvents,steps}).map(row=>({...row,employee:employeeName(row.actor)}));
   reportColumns=[['employee','Employee'],...reportActivityColumns,['total','Total']];
  }else{
   const movements=await reportFetchRange('inventory_movements','id,lot_id,movement_type,base_unit_change,created_at','created_at',from,to);
   const lotIds=[...new Set(movements.map(m=>m.lot_id))],lots=[];
   for(let i=0;i<lotIds.length;i+=100){const r=await client.from('inventory_lots').select('id,product_id,location_id').in('id',lotIds.slice(i,i+100));if(r.error)throw Error(r.error.message);lots.push(...(r.data||[]));}
   const locations=await client.from('inventory_locations').select('id,name');if(locations.error)throw Error(locations.error.message);
   if(epoch!==reportEpoch||me?.user_id!==actor||view!=='reports')return;
   reportLocationNames=new Map((locations.data||[]).map(l=>[l.id,l.name]));
   reportRows=reportMovements(movements,lots).map(row=>({...row,product:reportProductName(row.product_id),location:reportLocationName(row.location_id),type:reportMovementLabels[row.movement_type]||row.movement_type,net:row.pieces_in-row.pieces_out}));
   reportColumns=[['product','Product'],['location','Godown'],['type','Movement'],['count','Entries'],['pieces_in','Pieces in'],['pieces_out','Pieces out'],['net','Net pieces']];
  }
  renderReports(range);
 }catch(error){if(epoch===reportEpoch&&me?.user_id===actor&&view==='reports')renderReports(range,error.message);}
}
function renderReports(range,error=''){
 const [from,to]=range||['',''],last=to?reportIsoDate(new Date(new Date(`${to}T00:00:00`).getTime()-86400000)):'';
 // Department subtotal rows are not added again into the company total; text columns have no total.
 const totals=reportColumns.slice(1).map(([key])=>{const rows=reportRows.filter(row=>!row._subtotal);return rows.some(row=>typeof row[key]==='number')?rows.reduce((sum,row)=>sum+(typeof row[key]==='number'?row[key]:0),0):'';});
 $('#content').innerHTML=`<section class="reports-workspace"><div class="heading"><div><small>SYSTEM</small><h1>Reports</h1><p class="muted">Counts come from the saved history of each record. Nothing here changes any data.</p></div></div><div class="tabs" role="group" aria-label="Report">${[['work','Work by person and department'],['activity','Sales activity by employee'],['movements','Stock movements']].map(([key,label])=>`<button type="button" data-report-tab="${key}" class="${reportTab===key?'active':''}" aria-pressed="${reportTab===key}">${label}</button>`).join('')}</div><form id="reportPeriod" class="grid"><label><span>Period</span><select name="period">${[['this_week','This week'],['last_week','Last week'],['this_month','This month'],['last_month','Last month'],['custom','Choose dates']].map(([key,label])=>`<option value="${key}" ${reportPeriod===key?'selected':''}>${label}</option>`).join('')}</select></label>${reportPeriod==='custom'?`<label><span>From</span><input name="from" type="date" value="${esc(reportFrom)}" required></label><label><span>To</span><input name="to" type="date" value="${esc(reportTo)}" required></label>`:''}<div class="actions"><button type="submit">Show report</button>${reportRows.length&&!error?'<button type="button" id="reportCsv">Download CSV</button>':''}</div></form>${error?`<p class="notice error" role="alert">${esc(error)}</p>`:''}${range&&!error?`<p class="muted">${esc(from)} to ${esc(last)} · ${reportRows.length} row${reportRows.length===1?'':'s'}</p>${reportRows.length?`<div class="table-wrap"><table><thead><tr>${reportColumns.map(([,label])=>`<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${reportRows.map(row=>`<tr${row._subtotal?' class="report-subtotal"':''}>${reportColumns.map(([key])=>`<td>${esc(row[key])}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th>Total</th>${totals.map((value,i)=>`<th>${reportColumns[i+1][0]==='location'||reportColumns[i+1][0]==='type'?'':esc(value)}</th>`).join('')}</tr></tfoot></table></div>`:'<p class="muted">No recorded activity in this period.</p>'}`:''}</section>`;
 document.querySelectorAll('[data-report-tab]').forEach(button=>button.onclick=()=>{reportTab=button.dataset.reportTab;run(reportsWorkspace);});
 const form=$('#reportPeriod');
 form.elements.period.onchange=event=>{reportPeriod=event.target.value;if(reportPeriod==='custom'){reportRows=[];renderReports(null);}else run(reportsWorkspace);};
 form.onsubmit=event=>{event.preventDefault();if(reportPeriod==='custom'){reportFrom=form.elements.from.value;reportTo=form.elements.to.value;}run(reportsWorkspace);};
 $('#reportCsv')?.addEventListener('click',()=>{
  const blob=new Blob(['﻿'+reportCsv(reportColumns,reportRows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`anudha-${reportTab==='work'?'work-by-person':reportTab==='activity'?'sales-activity':'stock-movements'}-${from}-to-${last}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 });
}
