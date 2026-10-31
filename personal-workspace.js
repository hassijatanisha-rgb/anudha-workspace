'use strict';
let personalSection='event',personalPage=0,personalRows=[],personalEpoch=0;
let personalMonth=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
function clearPersonalWorkspace(){personalEpoch++;personalRows=[];personalPage=0;}
const personalLabels={event:'My calendar',task:'My tasks',note:'My notes & reminders'};
function personalLocalInput(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function personalDisplayDate(value){return value?new Date(value).toLocaleString():'No date set'}
function personalMonthGrid(rows){
 return `<label>Calendar month<input id="personalMonth" type="month" value="${personalMonth}"></label><div class="personal-calendar" role="group" aria-label="Calendar month">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<strong>${day}</strong>`).join('')}${personalMonthDays(personalMonth).map(day=>day?`<section class="calendar-day" data-personal-day="${day}"><h2>${Number(day.slice(-2))}</h2>${rows.filter(row=>personalLocalInput(row.starts_at).slice(0,10)===day).map(row=>`<p class="${row.visibility==='company'?'company-event':'personal-event'}"><small>${row.visibility==='company'?'Company':'Personal'}</small><br>${esc(row.title)}</p>`).join('')}</section>`:'<div></div>').join('')}</div>`;
}
function personalCard(row){
 const editable=row.visibility==='company'?me.role==='owner':row.owner_id===me.user_id;
 return `<article data-personal-entry="${esc(row.id)}" class="card personal-entry ${row.visibility==='company'?'company-event':'personal-event'}"><small>${row.visibility==='company'?'Company event / meeting':row.kind==='task'?'Reminder':row.kind==='note'?'Note':'Personal · only you'}${row.priority==='urgent'?' · URGENT':''}</small><h2>${esc(row.title)}</h2><p>${esc(row.body||'')}</p>${row.starts_at?`<p>${esc(personalDisplayDate(row.starts_at))}${row.ends_at?' — '+esc(personalDisplayDate(row.ends_at)):''}</p>`:''}${row.remind_at?`<p>Remind me: ${esc(personalDisplayDate(row.remind_at))}</p>`:''}${row.kind==='task'?`<span class="tag">${row.completed?'Done':'Not done yet'}</span>`:''}${editable?`<button type="button" data-personal-edit="${esc(row.id)}">Edit</button>`:''}</article>`;
}
function readPersonalPage(kind,month,page){
 let query=client.from('workspace_entries').select('*').is('deleted_at',null);
 query=kind==='note'?query.in('kind',['note','task']):query.eq('kind',kind);
 if(kind==='event'){
  const [year,monthNumber]=month.split('-').map(Number);
  query=query.gte('starts_at',new Date(year,monthNumber-1,1).toISOString()).lt('starts_at',new Date(year,monthNumber,1).toISOString());
 }
 return query.order('completed').order('priority',{ascending:false}).order('starts_at',{nullsFirst:false}).order('id').range(page*100,page*100+99);
}
async function personalWorkspace(){
 // My tasks are team tasks (team-tasks.js); personal to-dos are kept as reminders on the notes page.
 if(personalSection==='task'&&typeof teamTasksWorkspace==='function')return teamTasksWorkspace();
 const epoch=++personalEpoch,actor=me,kind=personalSection,target=$('#content');
 workspaceLoading('Loading your workspace…');
 const result=await readPersonalPage(kind,personalMonth,personalPage);
 if(epoch!==personalEpoch||view!=='personal'||me!==actor)return;
 if(result.error){target.innerHTML=`${workspacePageHeader({title:personalLabels[kind]})}<p role="alert">This workspace could not be loaded. ${esc(result.error.message)}</p><button id="personalRetry">Retry</button>`;$('#personalRetry').onclick=()=>run(personalWorkspace);return;}
 personalRows=result.data||[];
 const rows=kind==='note'?personalTaskOrder(personalRows):personalRows;
 target.innerHTML=`<section>${workspacePageHeader({title:personalLabels[kind],subtitle:kind==='event'?'Company events and your personal calendar.':'Your private notes and reminders.',actions:kind==='note'?'<button id="personalNew">New reminder</button><button id="personalNewNote" class="primary-action">New note</button>':'<button id="personalNew" class="primary-action">Add event</button>'})}<div id="personalDue">${personalDueHtml(rows)}</div><div id="personalSaveStatus"></div><button id="personalRefresh">Refresh</button><div id="personalEntries">${personalEntriesHtml(rows,kind)}</div><div class="actions"><button id="personalPrevious" ${personalPage===0?'disabled':''}>Previous</button><span id="personalPageStatus" tabindex="-1">Page ${personalPage+1}</span><button id="personalNext" ${rows.length<100?'disabled':''}>Next</button></div></section>`;
 $('#personalNew').onclick=()=>personalEditor(null,epoch,actor,kind==='note'?'task':'event');
 $('#personalNewNote')?.addEventListener('click',()=>personalEditor(null,epoch,actor,'note'));
 if(kind==='event'){
  $('#personalRefresh').insertAdjacentHTML('afterend',personalMonthGrid(rows));
  $('#personalMonth').onchange=event=>{if(!event.target.value)return;personalMonthDays(event.target.value);personalMonth=event.target.value;personalPage=0;run(personalWorkspace)};
 }
 $('#personalRefresh').onclick=()=>run(personalWorkspace);
 $('#personalPrevious').onclick=()=>{personalPage--;run(personalWorkspace)};
 $('#personalNext').onclick=()=>{personalPage++;run(personalWorkspace)};
 bindPersonalEntries(target,epoch,actor);
}
function personalEntriesHtml(rows,kind){return rows.map(personalCard).join('')||`<p class="muted">${kind==='note'?'No notes or reminders yet.':'Nothing in this month.'}</p>`;}
function personalDueHtml(rows){const due=personalDueReminders(rows);return due.length?`<section class="card" role="status"><h2>Reminders due</h2>${due.map(row=>`<p>${esc(row.title)} · ${esc(personalDisplayDate(row.remind_at))}</p>`).join('')}</section>`:'';}
function bindPersonalEntries(target,epoch,actor){
 target.querySelectorAll('[data-personal-entry]').forEach(row=>row.personalMarkup=row.outerHTML);
 target.querySelectorAll('[data-personal-edit]').forEach(button=>button.onclick=()=>{if(me===actor&&epoch===personalEpoch&&button.isConnected&&!button.disabled)personalEditor(personalRows.find(row=>row.id===button.dataset.personalEdit),epoch,actor);});
}
async function refreshSavedPersonalPage(current,kind,month,page,epoch,actor){
 if(!current())return;
 const target=$('#content'),notice=$('#personalSaveStatus'),active=()=>current()&&target.isConnected&&$('#content')===target;
 const controls=()=>target.querySelectorAll('[data-personal-edit],#personalNew,#personalNewNote');
 const refresh=async()=>{
  if(!active())return;
  controls().forEach(button=>button.disabled=true);notice.innerHTML='<p role="status">Saved. Refreshing this page…</p>';
  try{
   const result=await readPersonalPage(kind,month,page);if(!active())return;if(result.error)throw result.error;
   if(!Array.isArray(result.data)||result.data.length>100||result.data.some(row=>!row?.id||!Number.isSafeInteger(row.version)||typeof row.title!=='string'||!['note','task','event'].includes(row.kind)))throw Error('The saved entries could not be verified.');
   personalRows=result.data;const rows=kind==='note'?personalTaskOrder(personalRows):personalRows,entries=$('#personalEntries'),template=document.createElement('template');template.innerHTML=personalEntriesHtml(rows,kind);
   const old=new Map([...entries.querySelectorAll('[data-personal-entry]')].map(row=>[row.dataset.personalEntry,row]));
   const next=[...template.content.children].map(row=>{const previous=old.get(row.dataset.personalEntry);return previous?.personalMarkup===row.outerHTML?previous:row;});
   const focused=document.activeElement,entry=focused?.closest('[data-personal-entry]'),scroll={left:window.scrollX,top:window.scrollY};
   for(const row of [...entries.children])if(!next.includes(row))row.remove();
   let cursor=entries.firstElementChild;for(const row of next){if(row===cursor)cursor=cursor.nextElementSibling;else entries.insertBefore(row,cursor);}
   template.innerHTML=personalDueHtml(rows);if($('#personalDue').innerHTML!==template.innerHTML)$('#personalDue').replaceChildren(...template.content.children);
   if(kind==='event'){
    template.innerHTML=personalMonthGrid(rows);const calendar=target.querySelector('.personal-calendar');
    for(const day of template.content.querySelectorAll('[data-personal-day]')){const previous=calendar.querySelector(`[data-personal-day="${day.dataset.personalDay}"]`);if(previous&&previous.outerHTML!==day.outerHTML)previous.replaceWith(day);}
   }
   $('#personalPrevious').disabled=page===0;$('#personalNext').disabled=rows.length<100;
   controls().forEach(button=>button.disabled=false);bindPersonalEntries(target,epoch,actor);notice.replaceChildren();
   if(entry&&!focused.isConnected){const replacement=[...target.querySelectorAll('[data-personal-edit]')].find(button=>button.dataset.personalEdit===entry.dataset.personalEntry);(replacement||$('#personalPageStatus'))?.focus({preventScroll:true});}
   window.scrollTo(scroll);message('Saved.');
  }catch(error){
   if(!active())return;
   notice.innerHTML=`<p role="status">Saved. The page could not refresh.</p><p role="alert">${esc(error.message||'Try again.')}</p><button type="button" data-personal-save-retry>Retry refresh</button>`;
   notice.querySelector('button').onclick=()=>{if(active())return run(refresh);};message('Saved. Retry refresh to see current entries.',true);
  }
 };
 await refresh();
}
function personalEditor(record,epoch,actor,newKind){
 const kind=record?.kind||newKind||personalSection,section=personalSection,month=personalMonth,page=personalPage;let committed=false;
 const current=()=>me===actor&&view==='personal'&&epoch===personalEpoch&&personalSection===section&&personalMonth===month&&personalPage===page;
 // A reminder (stored as kind 'task') needs a time; a note has none; an event needs a start.
 const fields=`<label><span>${kind==='task'?'Remind me to…':'Title'}</span><input name="title" maxlength="200" value="${esc(record?.title||'')}" required${kind==='task'?' placeholder="For example: call Dr Mushi about the analyser"':''}></label><label><span>Details · optional</span><textarea name="body" maxlength="4000">${esc(record?.body||'')}</textarea></label>${kind==='event'&&!record&&me.role==='owner'?'<label><span>Visible to</span><select name="visibility"><option value="personal">Personal — only me</option><option value="company">Company event — all active staff</option></select></label>':''}${kind==='event'?`<label><span>Starts</span><input type="datetime-local" name="starts" value="${personalLocalInput(record?.starts_at)}" required></label><label><span>Ends</span><input type="datetime-local" name="ends" value="${personalLocalInput(record?.ends_at)}"></label>`:''}${kind==='task'?`<label><span>When</span><input type="datetime-local" name="reminder" value="${personalLocalInput(record?.remind_at||record?.starts_at)}" required></label><label class="check-row"><input type="checkbox" name="urgent" value="true"${record?.priority==='urgent'?' checked':''}> Urgent</label>${record?`<label class="check-row"><input type="checkbox" name="completed" value="true"${record.completed?' checked':''}> Done</label>`:''}`:''}`;
 const id=record?.id||crypto.randomUUID();
 actionForm(record?'Edit':kind==='task'?'New reminder':kind==='note'?'New note':'New event',fields,async values=>{
  if(!current())throw Error('Your page or login changed. Reopen this form.');if(committed)throw Error('Already saved. Use Retry refresh to show the current page.');
  const iso=value=>value?new Date(value).toISOString():null;
  if(kind==='task'&&!values.reminder)throw Error('Choose when to be reminded.');
  const row=validatePersonalEntry({kind,visibility:record?.visibility||values.visibility||'personal',title:values.title,starts_at:kind==='task'?iso(values.reminder):iso(values.starts),ends_at:iso(values.ends)});
  let result;try{result=await client.rpc('save_workspace_entry',{p_id:id,p_expected_version:record?.version||0,p_kind:kind,p_visibility:row.visibility,p_title:row.title,p_body:values.body||'',p_starts_at:row.starts_at,p_ends_at:row.ends_at,p_remind_at:kind==='task'?iso(values.reminder):(record?.remind_at||null),p_priority:kind==='task'?(values.urgent==='true'?'urgent':'normal'):(record?.priority||'normal'),p_completed:kind==='task'?values.completed==='true':(kind==='note'&&!!record?.completed),p_deleted:false});}catch(error){if(current())throw error;return;}
  if(!current())return;
  if(result.error)throw result.error;
  committed=true;await refreshSavedPersonalPage(current,section,month,page,epoch,actor);
 });
}
