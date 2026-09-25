'use strict';
function personalMonthDays(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid month.');
 const [year,index]=month.split('-').map(Number),first=new Date(Date.UTC(year,index-1,1)),count=new Date(Date.UTC(year,index,0)).getUTCDate();
 return [...Array((first.getUTCDay()+6)%7).fill(null),...Array.from({length:count},(_,day)=>`${month}-${String(day+1).padStart(2,'0')}`)];
}
function personalTaskOrder(rows){return [...rows].sort((a,b)=>Number(!!a.completed)-Number(!!b.completed)||Number(b.priority==='urgent')-Number(a.priority==='urgent')||(Date.parse(a.starts_at)||Infinity)-(Date.parse(b.starts_at)||Infinity)||String(a.id).localeCompare(String(b.id)))}
function personalDueReminders(rows,now=new Date().toISOString()){return rows.filter(row=>!row.completed&&!row.deleted_at&&row.remind_at&&Date.parse(row.remind_at)<=Date.parse(now))}
function validatePersonalEntry(row){
 if(!['event','task','note'].includes(row.kind))throw Error('Choose calendar, task or note.');
 if(!['personal','company'].includes(row.visibility))throw Error('Choose personal or company visibility.');
 if(row.visibility==='company'&&row.kind!=='event')throw Error('Only events can be shared with the company.');
 if(!String(row.title||'').trim()||row.title.length>200)throw Error('Enter a title of 1–200 characters.');
 if(row.kind==='event'&&!Number.isFinite(Date.parse(row.starts_at)))throw Error('Choose the event start date and time.');
 for(const key of ['starts_at','ends_at','remind_at'])if(row[key]&&!Number.isFinite(Date.parse(row[key])))throw Error('Choose a valid date and time.');
 if(row.ends_at&&(!row.starts_at||Date.parse(row.ends_at)<=Date.parse(row.starts_at)))throw Error('The end must be after the start.');
 return row;
}
