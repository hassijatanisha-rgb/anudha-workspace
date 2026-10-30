'use strict';
// Read-only reports from recorded history. One report is chosen at a time from a list; stock movements are owner-only.
let reportTab='work',reportPeriod='this_week',reportFrom='',reportTo='',reportEpoch=0,reportRows=[],reportColumns=[],reportPage=0,reportPageData=null;
const reportActivityColumns=[['inquiries','Inquiries recorded'],['qualified','Passed to sales'],['won','Leads won'],['lost','Leads lost'],['proformas','Pro formas created'],['sent','Pro formas sent'],['accepted','Pro formas accepted'],['delivered','Deliveries signed'],['serviceReports','Service reports completed'],['pendingCreated','Pending orders recorded'],['pendingFulfilled','Pending orders fulfilled'],['stepsDone','Handed-over steps done']];
const reportMovementLabels={opening_balance:'Opening balance',opening_adjustment:'Opening correction',transfer_dispatch:'Sent to another godown',transfer_receipt:'Received from another godown',quarantine_receipt:'Received into quarantine',break_pack:'Carton opened',consumer_issue:'Issued to customer',consumer_return:'Returned by customer',return_release:'Return checked, back into stock',return_write_off:'Return written off',return_to_supplier:'Return sent back to supplier'};
function clearReports(){reportEpoch++;reportRows=[];reportColumns=[];reportPage=0;reportPageData=null;}
const reportDepartments={sales:'Sales',accounts:'Accounts',stores:'Stores & delivery',service:'Service',marketing:'Marketing',management:'Management','':'No department'};
function reportHours(ms){if(ms==null)return '—';const hours=ms/3600000;return hours<48?`${hours.toFixed(1)} h`:`${(hours/24).toFixed(1)} days`;}
// Work done per person in the period, plus what is open and overdue right now. A step counts as finished when its
// holder marked it done or it moved on to the next person; cancelled steps are not counted. Department rows are
// subtotals (excluded from the company total).
function reportWork({finished=[],open=[],delays=[],departments=new Map(),now=Date.now(),overdue=row=>false}){
 const people=new Map(),person=id=>{if(!people.has(id))people.set(id,{actor:id,finished:0,stepMs:0,open_now:0,overdue_now:0,longestMs:null,delays:0});return people.get(id);};
 for(const row of finished)if(['done','handed_on'].includes(row.status)&&row.assignee_user_id){const p=person(row.assignee_user_id);p.finished++;p.stepMs+=Math.max(0,Date.parse(row.closed_at)-Date.parse(row.created_at));}
 for(const row of open){const p=person(row.assignee_user_id);p.open_now++;if(overdue(row))p.overdue_now++;const wait=now-Date.parse(row.created_at);if(p.longestMs==null||wait>p.longestMs)p.longestMs=wait;}
 for(const d of delays)if(d.assignee_user_id)person(d.assignee_user_id).delays++;
 return reportWorkTotals([...people.values()].map(p=>({...p,department:departments.get(p.actor)||''})));
}
function reportWorkTotals(people){
 const rows=people.map(p=>({...p,avgMs:p.finished?p.stepMs/p.finished:null}));
 const dept=new Map();for(const r of rows){if(!dept.has(r.department))dept.set(r.department,{department:r.department,finished:0,stepMs:0,open_now:0,overdue_now:0,longestMs:null,delays:0,people:0});const d=dept.get(r.department);d.people++;d.finished+=r.finished;d.stepMs+=r.stepMs;d.open_now+=r.open_now;d.overdue_now+=r.overdue_now;d.delays+=r.delays;if(r.longestMs!=null&&(d.longestMs==null||r.longestMs>d.longestMs))d.longestMs=r.longestMs;}
 const order=Object.keys(reportDepartments);
 return {people:rows.sort((a,b)=>order.indexOf(a.department)-order.indexOf(b.department)||b.overdue_now-a.overdue_now||String(a.actor).localeCompare(String(b.actor))),
  departments:[...dept.values()].map(d=>({...d,avgMs:d.finished?d.stepMs/d.finished:null})).sort((a,b)=>order.indexOf(a.department)-order.indexOf(b.department))};
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
 return reportActivityTotals([...out.entries()].map(([actor,counts])=>({actor,...counts})));
}
function reportActivityTotals(rows){return rows.map(row=>({...row,total:reportActivityColumns.reduce((sum,[key])=>sum+row[key],0)})).sort((a,b)=>b.total-a.total||employeeName(a.actor).localeCompare(employeeName(b.actor)));}
async function reportFetchSummary(kind,from,to){
 const now=new Date(),params={p_since:new Date(`${from}T00:00:00`).toISOString(),p_until:new Date(`${to}T00:00:00`).toISOString()};
 if(kind==='work')Object.assign(params,{p_now:now.toISOString(),p_today:reportIsoDate(now)});
 const result=await client.rpc(kind==='work'?'report_work_summary':'report_activity_summary',params);
 if(result.error)throw Error(result.error.message);
 const counts=kind==='work'?['finished','open_now','overdue_now','delays']:reportActivityColumns.map(([key])=>key),rows=result.data;
 if(!Array.isArray(rows)||rows.some(row=>!row||(row.actor!==null&&typeof row.actor!=='string')||counts.some(key=>!Number.isSafeInteger(row[key])||row[key]<0)
  ||(kind==='work'&&(typeof row.department!=='string'||!Number.isFinite(row.stepMs)||row.stepMs<0||(row.longestMs!==null&&!Number.isFinite(row.longestMs))))))throw Error('The report summary is incomplete. Reopen the report.');
 return rows;
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
const reportChoices=[['work','Work done by each person'],['tasks','Tasks: done on time and late'],['activity','Sales activity by person'],['proformas','Pro formas and sales value'],['leads','Leads by how they contacted us'],['deliveries','Deliveries and how long they took'],['purchasing','Purchasing by supplier'],['service','Installations and service by engineer'],['travel','Travel: trips and days away'],['movements','Stock movements (owner)']];
// A report reads one part of the software; someone without that part saw "No recorded activity" instead of nothing.
const reportChoiceAreas={proformas:'proformas',leads:'leads',deliveries:'deliveries',purchasing:'purchasing',service:'service',travel:'travel'};
function reportChoiceAllowed(key){if(key==='movements')return me?.role==='owner';const area=reportChoiceAreas[key];return !area||typeof hasArea!=='function'||hasArea(area)}
function reportDays(ms){return ms==null?'—':`${(ms/86400000).toFixed(1)} days`}
function reportMoney(minor,currency='TZS'){const digits=currency==='TZS'?0:2;return new Intl.NumberFormat('en-TZ',{style:'currency',currency,currencyDisplay:currency==='TZS'?'code':'symbol',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(minor||0)/100)}
// Pro formas made in the period, per person and currency (values in different currencies are never added together).
function reportProformas(rows){
 const out=new Map();
 for(const r of rows){if(r.deleted_at)continue;const key=`${r.prepared_by||''}|${r.currency||'TZS'}`;if(!out.has(key))out.set(key,{actor:r.prepared_by||'',currency:r.currency||'TZS',made:0,quoted:0,accepted:0,acceptedValue:0});const o=out.get(key);o.made++;o.quoted+=Number(r.total_minor)||0;if(r.status==='accepted'){o.accepted++;o.acceptedValue+=Number(r.total_minor)||0;}}
 return [...out.values()].map(o=>({...o,rate:o.made?Math.round(o.accepted*100/o.made):0}));
}
// Leads recorded in the period, by how the customer contacted us.
function reportLeads(rows){
 const out=new Map();
 for(const r of rows){const k=r.source||'other';if(!out.has(k))out.set(k,{source:k,recorded:0,won:0,lost:0,open:0});const o=out.get(k);o.recorded++;if(r.stage==='won')o.won++;else if(r.stage==='lost')o.lost++;else o.open++;}
 return [...out.values()].map(o=>({...o,rate:o.won+o.lost?Math.round(o.won*100/(o.won+o.lost)):0})).sort((a,b)=>b.recorded-a.recorded);
}
// Deliveries signed in the period: time from the customer accepting the Pro forma to the signed delivery note.
function reportDeliveries(notes,proformas){
 const accepted=new Map(proformas.map(p=>[p.id,p.accepted_at]));
 return notes.filter(n=>n.status==='delivered'&&n.delivered_at).map(n=>{const start=accepted.get(n.proforma_id)||n.created_at,ms=Math.max(0,Date.parse(n.delivered_at)-Date.parse(start));return {...n,ms};}).sort((a,b)=>b.ms-a.ms);
}
// Purchase requests made in the period, per supplier.
function reportPurchasing(orders){
 const out=new Map();
 for(const o of orders){const k=o.supplier_id||'';if(!out.has(k))out.set(k,{supplier_id:k,requests:0,waiting:0,ordered:0,arrived:0,cancelled:0,arrivalMs:0});const r=out.get(k);r.requests++;if(o.status==='requested'||o.status==='approved')r.waiting++;else if(o.status==='ordered')r.ordered++;else if(o.status==='closed'){r.arrived++;r.arrivalMs+=Math.max(0,Date.parse(o.closed_at)-Date.parse(o.created_at));}else if(o.status==='cancelled')r.cancelled++;}
 return [...out.values()].map(r=>({...r,avgMs:r.arrived?r.arrivalMs/r.arrived:null})).sort((a,b)=>b.requests-a.requests);
}
// Service and installation jobs created in the period, per engineer; "late now" counts open jobs past their date.
function reportService(cases,now=Date.now()){
 const out=new Map();
 for(const c of cases){const k=c.assigned_user_id||'';if(!out.has(k))out.set(k,{actor:k,installations:0,services:0,completed:0,open:0,late:0,doneMs:0});const r=out.get(k);if(c.case_type==='installation')r.installations++;else r.services++;if(c.status==='completed'){r.completed++;r.doneMs+=Math.max(0,Date.parse(c.completed_at)-Date.parse(c.created_at));}else if(c.status!=='cancelled'){r.open++;if(c.scheduled_for&&c.scheduled_for<companyDate(0,new Date(now)))r.late++;}}
 return [...out.values()].map(r=>({...r,avgMs:r.completed?r.doneMs/r.completed:null}));
}
// Team tasks due in the period, per person given the task.
function reportTasks(tasks,now=Date.now()){
 const out=new Map();
 for(const t of tasks){const k=t.assignee_user_id;if(!out.has(k))out.set(k,{actor:k,given:0,onTime:0,late:0,open:0,lateNow:0});const r=out.get(k);r.given++;if(t.status==='done'){if(Date.parse(t.closed_at)<=Date.parse(t.due_at))r.onTime++;else r.late++;}else if(t.status==='open'){r.open++;if(Date.parse(t.due_at)<now)r.lateNow++;}}
 return [...out.values()].sort((a,b)=>b.lateNow-a.lateNow||b.given-a.given);
}
// Approved or finished trips leaving in the period, per traveller.
function reportTravel(trips){
 const out=new Map();
 for(const t of trips){if(!['approved','done'].includes(t.status))continue;const ms=Math.max(0,Date.parse(t.return_at)-Date.parse(t.depart_at));for(const p of t.travellers||[]){if(!out.has(p))out.set(p,{actor:p,trips:0,ms:0,clients:new Set()});const r=out.get(p);r.trips++;r.ms+=ms;for(const stop of t.itinerary?.length?t.itinerary:[t])r.clients.add(stop.organization_id||stop.destination);}}
 return [...out.values()].map(r=>({actor:r.actor,trips:r.trips,days:Number((r.ms/86400000).toFixed(1)),places:r.clients.size})).sort((a,b)=>b.days-a.days);
}
function reportProductName(id){if(!id)return 'Unknown product';const product=typeof inventoryProduct==='function'?inventoryProduct(id):products.find(p=>p.id===id);return product?.name||'Unknown product';}
function reportLocationName(id){return (typeof inventoryLocations!=='undefined'?inventoryLocations:[]).find(l=>l.id===id)?.name||reportLocationNames.get(id)||'Unknown location';}
let reportLocationNames=new Map();
async function reportFetchRange(table,columns,column,from,to,filter){
 // Start with one page so a quiet period does not request three empty pages.
 const since=new Date(`${from}T00:00:00`).toISOString(),until=new Date(`${to}T00:00:00`).toISOString(),out=[];
 for(let offset=0,size=1;offset<=50000;){
  const pages=await Promise.all(Array.from({length:size},(_,page)=>{const start=offset+page*1000;let query=client.from(table).select(columns).gte(column,since).lt(column,until);if(filter)query=filter(query);return query.order(column).order('id').range(start,start+999);}));
  for(const result of pages)if(result.error)throw Error(`${table}: ${result.error.message}`);
  for(const result of pages){out.push(...(result.data||[]));if(out.length>50000)throw Error('This period has more than 50,000 records. Choose a shorter period.');if((result.data||[]).length<1000)return out;}
  offset+=size*1000;size=Math.min(4,(51000-offset)/1000);
 }
 throw Error('This period has more than 50,000 records. Choose a shorter period.');
}
function reportCsv(columns,rows){
 const cell=value=>{const text=String(value??'');return /[",\n]/.test(text)||/^[=+\-@]/.test(text)?`"${(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')}"`:text;};
 return [columns.map(([,label])=>cell(label)).join(','),...rows.map(row=>columns.map(([key])=>cell(row[key])).join(','))].join('\r\n');
}
const reportPageNumeric={tasks:['given','onTime','late','open','lateNow'],proformas:['made','quoted','accepted','acceptedValue','rate'],leads:['recorded','won','lost','open','rate'],purchasing:['requests','waiting','ordered','arrived','cancelled','arrivalMs'],service:['installations','services','completed','open','late','doneMs'],travel:['trips','ms','days','places'],movements:['count','pieces_in','pieces_out','net'],deliveries:['ms','days']};
const reportPageTotals={tasks:['given','onTime','late','open','lateNow'],proformas:['made','accepted'],leads:['recorded','won','lost','open'],purchasing:['requests','waiting','ordered','arrived','cancelled'],service:['installations','services','completed','open','late'],travel:['trips','days','places'],movements:['count','pieces_in','pieces_out','net'],deliveries:['days']};
function reportPageIdentity(kind,row){return JSON.stringify(kind==='proformas'?[row.actor,row.currency]:kind==='leads'?[row.source]:kind==='purchasing'?[row.supplier_id]:kind==='movements'?[row.product_id,row.location_id,row.movement_type]:kind==='deliveries'?[row.id]:[row.actor]);}
const reportPageText={tasks:[],proformas:['actor','currency'],leads:['source'],purchasing:['supplier_id','supplier'],service:['actor'],travel:['actor'],movements:['product_id','location_id','movement_type','product','location'],deliveries:['id','delivery','proforma','client','delivered_at']};
async function reportFetchPage(kind,from,to,page=0,params=null){
 const now=new Date(),request=params||{p_kind:kind,p_since:new Date(`${from}T00:00:00`).toISOString(),p_until:new Date(`${to}T00:00:00`).toISOString(),p_now:now.toISOString(),p_today:companyDate(0,now)};
 const result=await client.rpc('report_period_page',{...request,p_page:page});if(result.error)throw Error(result.error.message);
 const data=result.data,numeric=reportPageNumeric[kind],totals=reportPageTotals[kind];
 const validNumber=(value,key)=>Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER&&(key==='days'||Number.isSafeInteger(value))&&(key==='net'||value>=0);
 if(!data||data.kind!==kind||!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages!==Math.max(1,Math.ceil(data.total/50))||data.page!==Math.min(page,data.pages-1)||data.rows.length!==Math.min(50,data.total-data.page*50)||!data.totals||totals.some(key=>!validNumber(data.totals[key],key))||data.rows.some(row=>!row||numeric.some(key=>!validNumber(row[key],key))||reportPageText[kind].some(key=>typeof row[key]!=='string')||(kind==='tasks'&&row.actor!==null&&typeof row.actor!=='string')||(['purchasing','service'].includes(kind)&&row.avgMs!==null&&(!Number.isFinite(row.avgMs)||row.avgMs<0)))||new Set(data.rows.map(row=>reportPageIdentity(kind,row))).size!==data.rows.length)throw Error('The report page is incomplete. Reopen the report.');
 return {...data,request};
}
function reportFormatPage(kind,rows){
 if(kind==='proformas')return {rows:rows.map(r=>({employee:employeeName(r.actor),currency:r.currency,made:r.made,quoted:reportMoney(r.quoted,r.currency),accepted:r.accepted,acceptedValue:reportMoney(r.acceptedValue,r.currency),rate:`${r.rate}%`})),columns:[['employee','Prepared by'],['currency','Currency'],['made','Pro formas made'],['quoted','Value quoted'],['accepted','Accepted'],['acceptedValue','Value accepted'],['rate','Accepted %']]};
 if(kind==='leads'){const sources=typeof leadSources!=='undefined'?leadSources:{};return {rows:rows.map(r=>({...r,source:sources[r.source]||r.source,rate:`${r.rate}%`})),columns:[['source','How they contacted us'],['recorded','Leads recorded'],['won','Won'],['lost','Lost'],['open','Still open'],['rate','Won % of closed']]};}
 if(kind==='deliveries')return {rows:rows.map(r=>({...r,delivered:new Date(r.delivered_at).toLocaleDateString(),days:Number((r.ms/86400000).toFixed(1))})),columns:[['delivery','Delivery note'],['proforma','Pro forma'],['client','Client'],['delivered','Delivered on'],['days','Days from acceptance to delivery']]};
 if(kind==='purchasing')return {rows:rows.map(r=>({...r,avg:reportDays(r.avgMs)})),columns:[['supplier','Supplier'],['requests','Requests'],['waiting','Waiting to be ordered'],['ordered','Ordered, not arrived'],['arrived','Arrived'],['cancelled','Cancelled'],['avg','Average days to arrive']]};
 if(kind==='service')return {rows:rows.map(r=>({...r,employee:r.actor?employeeName(r.actor):'No engineer yet',avg:reportDays(r.avgMs)})),columns:[['employee','Engineer'],['installations','Installations'],['services','Service jobs'],['completed','Completed'],['open','Still open'],['late','Late now'],['avg','Average days to complete']]};
 if(kind==='travel')return {rows:rows.map(r=>({...r,days:Number((r.ms/86400000).toFixed(1)),employee:employeeName(r.actor)})),columns:[['employee','Employee'],['trips','Trips'],['days','Days away'],['places','Different places']]};
 if(kind==='tasks')return {rows:rows.map(r=>({...r,employee:employeeName(r.actor)})),columns:[['employee','Employee'],['given','Tasks due'],['onTime','Done on time'],['late','Done late'],['open','Not done yet'],['lateNow','Late now']]};
 return {rows:rows.map(r=>({...r,type:reportMovementLabels[r.movement_type]||r.movement_type})),columns:[['product','Product'],['location','Godown'],['type','Movement'],['count','Entries'],['pieces_in','Pieces in'],['pieces_out','Pieces out'],['net','Net pieces']]};
}
async function reportsWorkspace(){
 const epoch=++reportEpoch,session=me,actor=me?.user_id;syncWorkspaceNavigation();
 if(!reportChoiceAllowed(reportTab))reportTab='work';
 const tab=reportTab,current=()=>epoch===reportEpoch&&me===session&&me?.user_id===actor&&view==='reports'&&reportTab===tab;
 let range;try{range=reportRange(reportPeriod,new Date(),reportFrom,reportTo);}catch(error){range=null;renderReports(null,error.message);return;}
 $('#content').innerHTML=workspaceSkeleton('report','Building report…');
 const [from,to]=range;reportPageData=null;
 try{
  if(reportTab==='work'){
   const people=await reportFetchSummary('work',from,to);
   if(!current())return;
   const result=reportWorkTotals(people);
   reportRows=[...result.people.map(p=>({employee:employeeName(p.actor),department:reportDepartments[p.department],finished:p.finished,avg:reportHours(p.avgMs),open_now:p.open_now,overdue_now:p.overdue_now,longest:reportHours(p.longestMs),delays:p.delays})),
    ...result.departments.map(d=>({_subtotal:true,employee:`All ${reportDepartments[d.department]} (${d.people})`,department:reportDepartments[d.department],finished:d.finished,avg:reportHours(d.avgMs),open_now:d.open_now,overdue_now:d.overdue_now,longest:reportHours(d.longestMs),delays:d.delays}))];
   reportColumns=[['employee','Employee'],['department','Department'],['finished','Steps finished'],['avg','Average time per step'],['open_now','Open now'],['overdue_now','Overdue now'],['longest','Longest waiting now'],['delays','Delays reported']];
  }else if(reportTab==='activity'){
   const people=await reportFetchSummary('activity',from,to);
   if(!current())return;
   reportRows=reportActivityTotals(people).map(row=>({...row,employee:employeeName(row.actor)}));
   reportColumns=[['employee','Employee'],...reportActivityColumns,['total','Total']];

  }else{
   if(reportTab==='movements'&&me?.role!=='owner')throw Error('Stock reports are for the owner only.');
   const data=await reportFetchPage(tab,from,to,reportPage);if(!current())return;
   const formatted=reportFormatPage(tab,data.rows);reportPageData=data;reportPage=data.page;reportRows=formatted.rows;reportColumns=formatted.columns;
  }
  renderReports(range);
 }catch(error){if(current())renderReports(range,error.message);}
}
function renderReports(range,error=''){
 const session=me,epoch=reportEpoch,tab=reportTab,pageData=reportPageData,current=()=>me===session&&epoch===reportEpoch&&view==='reports'&&reportTab===tab;
 const [from,to]=range||['',''],last=to?reportIsoDate(new Date(new Date(`${to}T00:00:00`).getTime()-86400000)):'';
 // Department subtotal rows are not added again into the company total; text columns have no total.
 const numericColumns=new Set([...(reportPageNumeric[tab]||[]),...reportActivityColumns.map(([key])=>key),'avg','longest','finished','open_now','overdue_now','delays']);
 const totals=reportColumns.slice(1).map(([key])=>{if(pageData)return pageData.totals[key]??'';const rows=reportRows.filter(row=>!row._subtotal);return rows.some(row=>typeof row[key]==='number')?rows.reduce((sum,row)=>sum+(typeof row[key]==='number'?row[key]:0),0):'';});
 $('#content').innerHTML=`<section class="reports-workspace">${workspacePageHeader({title:'Reports',subtitle:'Choose a report and a period.'})}<form id="reportPeriod" class="grid"><label><span>Which report?</span><select name="report">${reportChoices.filter(([key])=>reportChoiceAllowed(key)).map(([key,label])=>`<option value="${key}" ${reportTab===key?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Period</span><select name="period">${[['this_week','This week'],['last_week','Last week'],['this_month','This month'],['last_month','Last month'],['custom','Choose dates']].map(([key,label])=>`<option value="${key}" ${reportPeriod===key?'selected':''}>${label}</option>`).join('')}</select></label>${reportPeriod==='custom'?`<label><span>From</span><input name="from" type="date" value="${esc(reportFrom)}" required></label><label><span>To</span><input name="to" type="date" value="${esc(reportTo)}" required></label>`:''}<div class="actions"><button type="submit">Show report</button>${reportRows.length&&!error&&(reportTab!=='movements'||me?.role==='owner')?'<button type="button" id="reportCsv">Download CSV</button>':''}</div></form>${error?`<p class="notice error" role="alert">${esc(error)}</p>`:''}${range&&!error?`<p class="muted">${esc(from)} to ${esc(last)} · ${pageData?pageData.total:reportRows.length} row${(pageData?pageData.total:reportRows.length)===1?'':'s'}${pageData?' · totals cover the whole period':''}</p>${reportRows.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Report results"><table><thead><tr>${reportColumns.map(([key,label])=>`<th${numericColumns.has(key)?' class="numeric-cell"':''}>${esc(label)}</th>`).join('')}</tr></thead><tbody>${reportRows.map(row=>`<tr${row._subtotal?' class="report-subtotal"':''}>${reportColumns.map(([key])=>`<td${numericColumns.has(key)?' class="numeric-cell"':''}>${esc(row[key])}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th>${pageData?'Period total':'Total'}</th>${totals.map((value,i)=>`<td${numericColumns.has(reportColumns[i+1][0])?' class="numeric-cell"':''}>${reportColumns[i+1][0]==='location'||reportColumns[i+1][0]==='type'?'':esc(value)}</td>`).join('')}</tr></tfoot></table></div>`:'<p class="muted">No recorded activity in this period.</p>'}${pageData?`<div class="actions"><button type="button" id="reportPrevious" ${pageData.page===0?'disabled':''}>Previous</button><span id="reportPageStatus" tabindex="-1">Page ${pageData.page+1} of ${pageData.pages}</span><button type="button" id="reportNext" ${pageData.page+1>=pageData.pages?'disabled':''}>Next</button></div>`:''}`:''}</section>`;
 const form=$('#reportPeriod'),controlsCurrent=()=>me===session&&view==='reports'&&reportTab===tab;
 form.elements.report.onchange=event=>{if(!controlsCurrent())return;reportPage=0;reportPageData=null;reportEpoch++;reportTab=event.target.value;reportRows=[];if(reportPeriod==='custom'&&!(reportFrom&&reportTo))renderReports(null);else run(reportsWorkspace);};
 form.elements.period.onchange=event=>{if(!controlsCurrent())return;reportPage=0;reportPageData=null;reportEpoch++;reportPeriod=event.target.value;if(reportPeriod==='custom'){reportRows=[];renderReports(null);}else run(reportsWorkspace);};
 form.onsubmit=event=>{event.preventDefault();if(!controlsCurrent())return;reportPage=0;reportPageData=null;if(reportPeriod==='custom'){reportFrom=form.elements.from.value;reportTo=form.elements.to.value;}run(reportsWorkspace);};
 if(pageData&&!error)for(const [direction,step] of [['Previous',-1],['Next',1]])$('#report'+direction).onclick=()=>run(async()=>{if(!current())return;reportPage+=step;const nextEpoch=reportEpoch+1;await reportsWorkspace();if(me===session&&view==='reports'&&reportTab===tab&&reportEpoch===nextEpoch){const button=$('#report'+direction);(button?.disabled?$('#reportPageStatus'):button)?.focus({preventScroll:true});}});
 $('#reportCsv')?.addEventListener('click',()=>run(async()=>{
  if(!current())return;let rows=reportRows;
  if(pageData){rows=[];const seen=new Set();for(let page=0;page<pageData.pages;page++){
   const result=await reportFetchPage(tab,from,to,page,pageData.request);if(!current())return;
   if(result.total!==pageData.total||result.page!==page||JSON.stringify(result.totals)!==JSON.stringify(pageData.totals)||result.rows.some(row=>seen.has(reportPageIdentity(tab,row))))throw Error('The report changed while the CSV was loading. Refresh and retry the export.');
   result.rows.forEach(row=>seen.add(reportPageIdentity(tab,row)));rows.push(...reportFormatPage(tab,result.rows).rows);
  }}
  const blob=new Blob(['﻿'+reportCsv(reportColumns,rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`anudha-${tab==='work'?'work-by-person':tab==='activity'?'sales-activity':tab==='movements'?'stock-movements':tab}-${from}-to-${last}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }));
}
