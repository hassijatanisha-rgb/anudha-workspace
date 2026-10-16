'use strict';
// Business documents use Tanzania's civil day, irrespective of the device timezone.
function companyDate(offset=0,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=type=>parts.find(part=>part.type===type).value;
 const day=new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`);
 day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10);
}
