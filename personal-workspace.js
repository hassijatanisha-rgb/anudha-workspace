'use strict';
let personalSection='event',personalPage=0,personalRows=[],personalEpoch=0;
let personalMonth=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
const personalLabels={event:'My calendar',task:'My tasks',note:'My notes & reminders'};
function personalLocalInput(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function personalDisplayDate(value){return value?new Date(value).toLocaleString():'No date set'}
function personalMonthGrid(rows){
 return `<label>Calendar month<input id="personalMonth" type="month" value="${personalMonth}"></label><div class="personal-calendar" aria-label="Calendar month">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<strong>${day}</strong>`).join('')}${personalMonthDays(personalMonth).map(day=>day?`<section class="calendar-day"><h3>${Number(day.slice(-2))}</h3>${rows.filter(row=>personalLocalInput(row.starts_at).slice(0,10)===day).map(row=>`<p class="${row.visibility==='company'?'company-event':'personal-event'}"><small>${row.visibility==='company'?'Company':'Personal'}</small><br>${esc(row.title)}</p>`).join('')}</section>`:'<div></div>').join('')}</div>`;
}
function personalCard(row){
 const editable=row.visibility==='company'?me.role==='owner':row.owner_id===me.user_id;
 return `<article class="card personal-entry ${row.visibility==='company'?'company-event':'personal-event'}"><small>${row.visibility==='company'?'Company event / meeting':row.kind==='task'?'Reminder':row.kind==='note'?'Note':'Personal · only you'}${row.priority==='urgent'?' · URGENT':''}</small><h2>${esc(row.title)}</h2><p>${esc(row.body||'')}</p>${row.starts_at?`<p>${esc(personalDisplayDate(row.starts_at))}${row.ends_at?' — '+esc(personalDisplayDate(row.ends_at)):''}</p>`:''}${row.remind_at?`<p>Remind me: ${esc(personalDisplayDate(row.remind_at))}</p>`:''}${row.kind==='task'?`<span class="tag">${row.completed?'Done':'Not done yet'}</span>`:''}${editable?`<button type="button" data-personal-edit="${esc(row.id)}">Edit</button>`:''}</article>`;
}
async function personalWorkspace(){
 // My tasks are team tasks (team-tasks.js); personal to-dos are kept as reminders on the notes page.
 if(personalSection==='task'&&typeof teamTasksWorkspace==='function')return teamTasksWorkspace();
 const epoch=++personalEpoch,actor=me?.user_id,kind=personalSection,target=$('#content');
 target.innerHTML='<p role="status">Loading your workspace…</p>';
 let query=client.from('workspace_entries').select('*').is('deleted_at',null);
 query=kind==='note'?query.in('kind',['note','task']):query.eq('kind',kind);
 if(kind==='event'){
  const [year,month]=personalMonth.split('-').map(Number);
  query=query.gte('starts_at',new Date(year,month-1,1).toISOString()).lt('starts_at',new Date(year,month,1).toISOString());
 }
 const result=await query.order('completed').order('priority',{ascending:false}).order('starts_at',{nullsFirst:false}).order('id').range(personalPage*100,personalPage*100+99);
 if(epoch!==personalEpoch||view!=='personal'||me?.user_id!==actor)return;
 if(result.error){target.innerHTML=`<h1>${personalLabels[kind]}</h1><p role="alert">This workspace could not be loaded. ${esc(result.error.message)}</p><button id="personalRetry">Retry</button>`;$('#personalRetry').onclick=()=>run(personalWorkspace);return;}
 personalRows=result.data||[];
 const rows=kind==='note'?personalTaskOrder(personalRows):personalRows,due=personalDueReminders(rows);
 target.innerHTML=`<section><div class="heading"><div><h1>${personalLabels[kind]}</h1><p class="muted">${kind==='event'?'Green: company events and meetings. White: your personal entries.':'Only you can see these. A note is something to keep; a reminder has a time, for example: call Dr Mushi at 10:00.'}</p></div><div class="actions">${kind==='note'?'<button id="personalNewNote" class="primary-action">+ Note</button><button id="personalNew" class="primary-action">+ Reminder</button>':'<button id="personalNew" class="primary-action">+ Add event</button>'}</div></div>${due.length?`<section class="card" role="status"><h2>Reminders due</h2>${due.map(row=>`<p>${esc(row.title)} · ${esc(personalDisplayDate(row.remind_at))}</p>`).join('')}</section>`:''}<button id="personalRefresh">Refresh</button>${rows.map(personalCard).join('')||`<p class="muted">${kind==='note'?'No notes or reminders yet.':'Nothing in this month.'}</p>`}<div class="actions"><button id="personalPrevious" ${personalPage===0?'disabled':''}>Previous</button><span>Page ${personalPage+1}</span><button id="personalNext" ${rows.length<100?'disabled':''}>Next</button></div></section>`;
 $('#personalNew').onclick=()=>personalEditor(null,epoch,actor,kind==='note'?'task':'event');
 $('#personalNewNote')?.addEventListener('click',()=>personalEditor(null,epoch,actor,'note'));
 if(kind==='event'){
  $('#personalRefresh').insertAdjacentHTML('afterend',personalMonthGrid(rows));
  $('#personalMonth').onchange=event=>{if(!event.target.value)return;personalMonthDays(event.target.value);personalMonth=event.target.value;personalPage=0;run(personalWorkspace)};
 }
 $('#personalRefresh').onclick=()=>run(personalWorkspace);
 $('#personalPrevious').onclick=()=>{personalPage--;run(personalWorkspace)};
 $('#personalNext').onclick=()=>{personalPage++;run(personalWorkspace)};
 target.querySelectorAll('[data-personal-edit]').forEach(button=>button.onclick=()=>personalEditor(rows.find(row=>row.id===button.dataset.personalEdit),epoch,actor));
}
function personalEditor(record,epoch,actor,newKind){
 const kind=record?.kind||newKind||personalSection;
 // A reminder (stored as kind 'task') needs a time; a note has none; an event needs a start.
 const fields=`<label><span>${kind==='task'?'Remind me to…':'Title'}</span><input name="title" maxlength="200" value="${esc(record?.title||'')}" required${kind==='task'?' placeholder="For example: call Dr Mushi about the analyser"':''}></label><label><span>Details · optional</span><textarea name="body" maxlength="4000">${esc(record?.body||'')}</textarea></label>${kind==='event'&&!record&&me.role==='owner'?'<label><span>Visible to</span><select name="visibility"><option value="personal">Personal — only me</option><option value="company">Company event — all active staff</option></select></label>':''}${kind==='event'?`<label><span>Starts</span><input type="datetime-local" name="starts" value="${personalLocalInput(record?.starts_at)}" required></label><label><span>Ends</span><input type="datetime-local" name="ends" value="${personalLocalInput(record?.ends_at)}"></label>`:''}${kind==='task'?`<label><span>When</span><input type="datetime-local" name="reminder" value="${personalLocalInput(record?.remind_at||record?.starts_at)}" required></label><label class="check-row"><input type="checkbox" name="urgent" value="true"${record?.priority==='urgent'?' checked':''}> Urgent</label>${record?`<label class="check-row"><input type="checkbox" name="completed" value="true"${record.completed?' checked':''}> Done</label>`:''}`:''}`;
 const id=record?.id||crypto.randomUUID();
 actionForm(record?'Edit':kind==='task'?'New reminder':kind==='note'?'New note':'New event',fields,async values=>{
  if(view!=='personal'||epoch!==personalEpoch||me?.user_id!==actor)throw Error('Your page or login changed. Reopen this form.');
  const iso=value=>value?new Date(value).toISOString():null;
  if(kind==='task'&&!values.reminder)throw Error('Choose when to be reminded.');
  const row=validatePersonalEntry({kind,visibility:record?.visibility||values.visibility||'personal',title:values.title,starts_at:kind==='task'?iso(values.reminder):iso(values.starts),ends_at:iso(values.ends)});
  const result=await client.rpc('save_workspace_entry',{p_id:id,p_expected_version:record?.version||0,p_kind:kind,p_visibility:row.visibility,p_title:row.title,p_body:values.body||'',p_starts_at:row.starts_at,p_ends_at:row.ends_at,p_remind_at:kind==='task'?iso(values.reminder):(record?.remind_at||null),p_priority:kind==='task'?(values.urgent==='true'?'urgent':'normal'):(record?.priority||'normal'),p_completed:kind==='task'?values.completed==='true':(kind==='note'&&!!record?.completed),p_deleted:false});
  if(view!=='personal'||epoch!==personalEpoch||me?.user_id!==actor)return;
  if(result.error)throw result.error;
  await personalWorkspace();
  if(view==='personal'&&me?.user_id===actor)message('Saved.');
 });
}
