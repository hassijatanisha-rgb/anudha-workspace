'use strict';

const serviceStatuses=['new','assigned','scheduled','on_site','report_required','completed'];
const serviceStatusLabels={new:'New',assigned:'Assigned',scheduled:'Scheduled',on_site:'On site',report_required:'Report required',completed:'Completed',cancelled:'Cancelled'};

function serviceStatusLabel(status){return serviceStatusLabels[status]||String(status||'').replaceAll('_',' ')}
function serviceNextActions(status){return ({new:['assign'],assigned:['schedule','reassign'],scheduled:['start','reassign'],on_site:['submit_report'],report_required:[],completed:[],cancelled:[]})[status]||[]}
function serviceMaintenanceDate(actual,months){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(actual||''))||Number.isNaN(Date.parse(actual+'T00:00:00Z')))throw Error('Enter a valid work date.');
 if(![3,6,12,24,36].includes(Number(months)))throw Error('Choose a supported maintenance interval.');
 const [year,month,day]=actual.split('-').map(Number),targetMonth=month-1+Number(months),last=new Date(Date.UTC(year, targetMonth+1, 0));
 return new Date(Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),Math.min(day,last.getUTCDate()))).toISOString().slice(0,10);
}
function serviceProgress(status){const current=serviceStatuses.indexOf(status);return serviceStatuses.map((name,index)=>({name,label:serviceStatusLabel(name),state:status==='cancelled'?'':index<current?'complete':index===current?'current':''}))}
