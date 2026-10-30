'use strict';
// My tasks: tasks one person gives another (or themselves), each with an urgency and a due date and time, shown
// together with the order steps handed to this person. Task changes and progress comments use their database RPCs.
// A task may be moved later at most 3 times, with a reason each time: by the owner directly,
// or by the person doing it with their department head's approval (deadline-requests.js, migration 083).
let teamTasks=[],teamTaskMoves=new Map(),teamTaskEvents=new Map(),teamTaskHistoryLoaded=new Set(),teamTaskRecordErrors=new Map(),teamTaskEpoch=0;
let teamTaskSaveSequence=0;
let teamTaskActor=null,teamTaskPageRequest=0,teamTaskDetailRequest=0,teamTaskSelectedId='',teamTaskPages={forMe:0,gave:0,results:0,finished:0},teamTaskExpanded=new Set(['forMe']);
function clearTeamTasks(){teamTaskSaveSequence++;teamTaskEpoch++;teamTaskPageRequest++;teamTaskDetailRequest++;teamTaskActor=null;teamTaskSelectedId='';teamTaskPages={forMe:0,gave:0,results:0,finished:0};teamTaskExpanded=new Set(['forMe']);teamTasks=[];teamTaskMoves.clear();teamTaskEvents.clear();teamTaskHistoryLoaded.clear();teamTaskRecordErrors.clear();teamTaskMore.clear();clearWorkspaceDisclosureMotion();}
function syncTeamTaskActor(){if(teamTaskActor!==me){clearTeamTasks();teamTaskActor=me;}}
const teamTaskMoveLimit=3;
const teamTaskUrgency=[['do_now','Do now'],['urgent','Urgent'],['normal','Normal']];
const teamTaskRank={do_now:0,urgent:1,normal:2};
function teamTaskOverdue(row,now=Date.now()){return row.status==='open'&&Date.parse(row.due_at)<now}
function teamTaskOrder(rows){return [...rows].sort((a,b)=>Number(a.status!=='open')-Number(b.status!=='open')||(teamTaskRank[a.urgency]??3)-(teamTaskRank[b.urgency]??3)||Date.parse(a.due_at)-Date.parse(b.due_at)||String(a.id).localeCompare(String(b.id)))}
function teamTaskTone(row){return statusTone(row.status==='done'?'done':row.status!=='open'?'inactive':teamTaskOverdue(row)||row.urgency==='do_now'?'overdue':row.urgency==='urgent'?'due_soon':'not_started');}
function teamTaskStatusLabel(row){return row.status==='open'?(teamTaskOverdue(row)?'Late · ':'')+teamTaskUrgencyLabel(row.urgency):row.status==='done'?'Done':'Cancelled';}
function teamTaskUrgencyLabel(key){return teamTaskUrgency.find(([value])=>value===key)?.[1]||key}
function teamTaskDue(row){return teamTaskTime(row.due_at)}
// One formatter for every card: toLocaleString with options builds a new one on each call, which was most of the page.
const teamTaskTimeFormat=new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
function teamTaskTime(value){const date=new Date(value);return isNaN(date)?date.toLocaleString():teamTaskTimeFormat.format(date)}
function teamTaskCanMove(row){return row.status==='open'&&row.assignee_user_id===me?.user_id&&(row.reschedule_count||0)<teamTaskMoveLimit}
function teamTaskHistory(moves){return moves.length?`<details class="team-task-moves"><summary>Reschedule history · ${moves.length}</summary><ol>${moves.map(e=>`<li>${esc(teamTaskTime(e.old_due_at))} → <strong>${esc(teamTaskTime(e.new_due_at))}</strong> · ${esc(e.note)} <small class="muted">${esc(employeeName(e.actor_user_id))}, ${esc(new Date(e.created_at).toLocaleString())}</small></li>`).join('')}</ol></details>`:''}
function teamTaskCommentList(events){return `<ol class="team-task-comments">${events.map(e=>`<li><p>${esc(e.note)}</p><small class="muted">${esc(employeeName(e.actor_user_id))} · ${esc(new Date(e.created_at).toLocaleString())}</small></li>`).join('')}</ol>`}
function teamTaskProgress(row){
 const events=teamTaskEvents.get(row.id)||[],comments=events.filter(e=>e.action==='progress').slice().reverse();
 if(!comments.length)return '';
 return `<section class="team-task-progress"><h4>Progress · ${comments.length}</h4>${teamTaskCommentList(comments.slice(0,4))}${comments.length>4?`<details><summary>Full progress history · ${comments.length}</summary>${teamTaskCommentList(comments)}</details>`:''}</section>`;
}
function teamTaskSnapshot(snapshot,label){
 if(!snapshot)return '';
 return `<div class="team-task-snapshot"><strong>${esc(label)}</strong><p>${esc(snapshot.title)}</p>${snapshot.details?`<p>${esc(snapshot.details)}</p>`:''}<small>For ${esc(employeeName(snapshot.assignee_user_id))} · From ${esc(employeeName(snapshot.assigned_by))} · ${esc(teamTaskUrgencyLabel(snapshot.urgency))} · Due ${esc(teamTaskTime(snapshot.due_at))}</small></div>`;
}
function teamTaskAssignments(row){
 const events=(teamTaskEvents.get(row.id)||[]).filter(e=>e.action==='assignment'||e.action==='create');
 if(!events.length)return '';
 return `<details class="team-task-assignments"><summary>Assignment and instructions history</summary><ol class="team-task-assignment-list">${events.map(e=>e.action==='create'?`<li><strong>Original task title</strong><p>${esc(e.note)}</p><small class="muted">${esc(employeeName(e.actor_user_id))} · ${esc(new Date(e.created_at).toLocaleString())}</small></li>`:`<li><strong>${esc(e.note)}</strong><small class="muted">${e.note==='Saved instructions when history began'?'Snapshot recorded':esc(employeeName(e.actor_user_id))} · ${esc(new Date(e.created_at).toLocaleString())}</small>${teamTaskSnapshot(e.old_assignment,'Before')}${teamTaskSnapshot(e.new_assignment,e.old_assignment?'After':'Instructions')}</li>`).join('')}</ol></details>`;
}
function teamTaskCard(row){
 const recovery=teamTaskRecordErrors.get(row.id);
 const mine=row.assignee_user_id===me?.user_id,gave=row.assigned_by===me?.user_id,owner=me?.role==='owner',overdue=teamTaskOverdue(row),open=row.status==='open';
 const who=mine&&gave?'Your own task':mine?`From ${employeeName(row.assigned_by)}`:`For ${employeeName(row.assignee_user_id)}`;
 const buttons=[];
 const moved=row.reschedule_count||0;
 if(open&&(mine||gave||owner))buttons.push(`<button type="button" data-team-task-comment="${esc(row.id)}">Add progress</button>`);
 if(open&&(mine||owner))buttons.push(`<button type="button" data-team-task-done="${esc(row.id)}">Complete assigned task</button>`);
 // Migration 083: only the owner moves a deadline directly; everyone else asks their department head.
 if(teamTaskCanMove(row))buttons.push(owner||typeof openDeadlineRequest!=='function'?`<button type="button" data-team-task-move="${esc(row.id)}">Reschedule</button>`:`<button type="button" data-team-task-ask="${esc(row.id)}">Ask for more time</button>`);
 if(open&&(gave||owner))buttons.push(`<button type="button" data-team-task-edit="${esc(row.id)}">Edit</button>`,`<button type="button" class="danger" data-team-task-cancel="${esc(row.id)}">Cancel task</button>`);
 return `<article class="card team-task${overdue?' overdue':''}${open?'':' closed'}" data-team-task="${esc(row.id)}"><div class="heading"><div><span class="urgency-tag urgency-${esc(row.urgency)} chip chip--${teamTaskTone(row)}">${esc(teamTaskStatusLabel(row))}</span>${moved?` <span class="urgency-tag moved-tag chip chip--${statusTone('in_progress')}">Rescheduled ${moved} of ${teamTaskMoveLimit}</span>`:''}<h3>${esc(row.title)}</h3></div><small>${esc(row.task_number)}</small></div>${row.details?`<p>${esc(row.details)}</p>`:''}<p class="team-task-meta"><strong${overdue?' class="overdue"':''}>${overdue?'Late · was due ':'Due '}${esc(teamTaskDue(row))}</strong> · ${esc(who)}${open?'':` · ${row.status==='done'?'Done':'Cancelled'} ${esc(new Date(row.closed_at).toLocaleDateString())}`}</p>${!open&&row.close_note?`<p class="team-task-result"><small>Result</small>${esc(row.close_note)}</p>`:''}${open&&mine&&!gave&&moved>=teamTaskMoveLimit?`<p class="muted">Already moved ${teamTaskMoveLimit} times. Mark it done, or ask ${esc(employeeName(row.assigned_by))} to change it.</p>`:''}${teamTaskProgress(row)}${teamTaskAssignments(row)}${teamTaskHistory(teamTaskMoves.get(row.id)||[])}${recovery?`<p class="notice error" role="alert">${esc(recovery.text)}</p>`:''}${buttons.length?`<div class="actions">${buttons.map(button=>recovery?button.replace('<button','<button disabled'):button).join('')}</div>`:''}${recovery?.retry?`<button type="button" data-team-task-retry="${esc(row.id)}">Retry saved task</button>`:''}${teamTaskSelectedId===row.id?`<button type="button" data-team-task-collapse="${esc(row.id)}">Close details</button>`:''}</article>`;
}
async function loadTeamTasks(){
 const actor=me,epoch=teamTaskEpoch,request=++teamTaskPageRequest;
 const current=()=>me===actor&&epoch===teamTaskEpoch&&request===teamTaskPageRequest;
 let result;try{result=await client.rpc('team_task_page',{p_for_me_page:teamTaskPages.forMe,p_gave_page:teamTaskPages.gave,p_results_page:teamTaskPages.results,p_finished_page:teamTaskPages.finished});}catch(error){if(!current())return null;throw error;}
 if(!current())return null;
 if(result.error)throw Error(result.error.message);
 const data=result.data;
 if(!data?.groups||!['forMe','gave','results','finished'].every(key=>{const group=data.groups[key];return group&&Array.isArray(group.rows)&&group.rows.length<=teamTaskShown&&Number.isSafeInteger(group.total)&&group.total>=0&&Number.isSafeInteger(group.page)&&group.page>=0&&Number.isSafeInteger(group.pages)&&group.pages>group.page;}))throw Error('The task page could not be confirmed. Refresh to retry.');
 return data.groups;
}
function teamTaskGroups(rows,actor,now=Date.now()){
 const forMe=rows.filter(row=>row.status==='open'&&row.assignee_user_id===actor.user_id),gave=rows.filter(row=>row.status==='open'&&row.assigned_by===actor.user_id&&row.assignee_user_id!==actor.user_id),results=rows.filter(row=>row.status!=='open'&&row.assigned_by===actor.user_id&&row.assignee_user_id!==actor.user_id&&Date.parse(row.closed_at)>now-7*86400000).sort((a,b)=>Date.parse(b.closed_at)-Date.parse(a.closed_at));
 const resultIds=new Set(results.map(row=>row.id)),finished=rows.filter(row=>row.status!=='open'&&(row.assignee_user_id===actor.user_id||row.assigned_by===actor.user_id)&&!resultIds.has(row.id));
 return {forMe,gave,results,finished};
}
async function loadTeamTaskHistory(ids,actor,epoch){
 const moves=new Map(),history=new Map();
 for(let i=0;i<ids.length;i+=100){
  const events=await all('team_task_events','id,task_id,action,old_due_at,new_due_at,note,actor_user_id,created_at,old_assignment,new_assignment',q=>q.in('task_id',ids.slice(i,i+100)).order('created_at').order('id'));
  if(me!==actor||epoch!==teamTaskEpoch)return null;
  for(const e of events.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)))){
   const map=e.action==='reschedule'?moves:history;
   if(!map.has(e.task_id))map.set(e.task_id,[]);
   map.get(e.task_id).push(e);
  }
 }
 return {moves,history};
}
// Page summaries never replace the complete records used by task editors.
const teamTaskShown=20;let teamTaskMore=new Map();
function teamTaskPageIds(){return teamTaskActor===me?[...new Set([...teamTaskMore.values()].flatMap(group=>group.rows.map(row=>row.id)))]:[];}
function teamTaskSummaryCard(row){
 const mine=row.assignee_user_id===me?.user_id,gave=row.assigned_by===me?.user_id,who=mine&&gave?'Your own task':mine?`From ${employeeName(row.assigned_by)}`:`For ${employeeName(row.assignee_user_id)}`,overdue=teamTaskOverdue(row);
 return `<article class="card team-task${overdue?' overdue':''}" data-team-task="${esc(row.id)}"><div class="heading"><div><small>${esc(row.task_number)}</small><h3>${esc(row.title)}</h3></div><span class="urgency-tag urgency-${esc(row.urgency)} chip chip--${teamTaskTone(row)}">${esc(teamTaskStatusLabel(row))}</span></div><p>${esc(who)}</p><p>Due ${esc(teamTaskDue(row))}</p><div class="actions"><button type="button" class="primary-action" data-team-task-open="${esc(row.id)}">Open task</button></div></article>`;
}
function teamTaskPage(key){
 const state=teamTaskMore.get(key);if(!state)return '';
 const {rows,page,total,pages}=state,start=page*teamTaskShown,end=start+rows.length;
 if(!total)return '<p class="muted">No tasks in this group.</p>';
 return (rows.map(row=>{const detail=row.id===teamTaskSelectedId&&teamTasks.find(task=>task.id===row.id);return detail?teamTaskCard(detail):teamTaskSummaryCard(row);}).join('')||'<p class="muted">No tasks in this group.</p>')+`<div class="actions"><span role="status">${total?start+1:0}–${end} of ${total} tasks</span><button type="button" data-team-task-more="${key}" data-direction="previous" ${page===0?'disabled':''}>Previous</button><button type="button" data-team-task-more="${key}" data-direction="next" ${page+1>=pages?'disabled':''}>Next</button></div>`;
}
function bindTeamTaskDisclosures(root){
 const actor=me,epoch=teamTaskEpoch,current=()=>me===actor&&epoch===teamTaskEpoch&&root.isConnected;
 root.querySelectorAll('.team-task-moves,.team-task-assignments,.team-task-progress details').forEach(details=>bindWorkspaceDisclosure(details,details.querySelector('ol'),{current}));
}
function renderTeamTaskGroups(){
 const group=(key,label)=>`<details class="team-task-group" data-team-task-group="${key}" ${teamTaskExpanded.has(key)?'open':''}><summary>${label} · ${teamTaskMore.get(key).total}</summary><div data-team-task-page="${key}">${teamTaskExpanded.has(key)?teamTaskPage(key):''}</div></details>`;
 $('#manualTasks').innerHTML=group('forMe','To do')+group('gave','Tasks I gave others');
 $('#teamTaskFinished').innerHTML=group('results','Results of tasks I gave · last 7 days')+group('finished','Finished in the last 30 days');
 const actor=me,epoch=teamTaskEpoch;
 document.querySelectorAll('[data-team-task-group]').forEach(details=>{details.ontoggle=()=>{if(me!==actor||epoch!==teamTaskEpoch||!details.isConnected)return;const key=details.dataset.teamTaskGroup,target=details.querySelector('[data-team-task-page]');if(workspaceDisclosureOpen(details)){teamTaskExpanded.add(key);if(!target.innerHTML){target.innerHTML=teamTaskPage(key);bindTeamTaskDisclosures(target);if(typeof decorateTaskDeadlineNotes==='function')decorateTaskDeadlineNotes(target);}}else{teamTaskExpanded.delete(key);target.innerHTML='';}};bindWorkspaceDisclosure(details,details.querySelector('[data-team-task-page]'),{current:()=>me===actor&&epoch===teamTaskEpoch&&details.isConnected,onRequest:open=>{if(open)teamTaskExpanded.add(details.dataset.teamTaskGroup);else teamTaskExpanded.delete(details.dataset.teamTaskGroup);}});});
 bindTeamTaskDisclosures($('#manualTasks'));bindTeamTaskDisclosures($('#teamTaskFinished'));
 const selected=teamTasks.find(row=>row.id===teamTaskSelectedId),card=selected&&document.querySelector(`[data-team-task="${CSS.escape(selected.id)}"]`);if(card)card.teamTaskMarkup=teamTaskCard(selected);
 if(typeof decorateTaskDeadlineNotes==='function')decorateTaskDeadlineNotes();
}
function setTeamTaskGroups(groups){
 for(const key of ['forMe','gave','results','finished']){teamTaskMore.set(key,groups[key]);teamTaskPages[key]=groups[key].page;}
}
async function changeTeamTaskPage(button){
 if(teamTaskActor!==me||view!=='personal'||personalSection!=='task')return;
 const key=button.dataset.teamTaskMore,state=teamTaskMore.get(key),target=button.closest('[data-team-task-page]');if(!state||!target)return;
 const actor=me,epoch=teamTaskEpoch,direction=button.dataset.direction,oldPage=teamTaskPages[key],previousIds=teamTaskPageIds().sort().join(',');
 teamTaskPages[key]=Math.max(0,Math.min(state.pages-1,state.page+(direction==='next'?1:-1)));teamTaskDetailRequest++;
 let groups;try{groups=await loadTeamTasks();}catch(error){if(me===actor&&epoch===teamTaskEpoch)teamTaskPages[key]=oldPage;throw error;}
 if(!groups||me!==actor||epoch!==teamTaskEpoch||view!=='personal'||personalSection!=='task'||!target.isConnected)return;
 setTeamTaskGroups(groups);renderTeamTaskGroups();
 if(previousIds!==teamTaskPageIds().sort().join(',')&&typeof renderDeadlineRequests==='function')renderDeadlineRequests($('#teamTaskRelated')).catch(()=>{});
 const nextTarget=document.querySelector(`[data-team-task-page="${key}"]`);if(!workspaceDisclosureOpen(nextTarget?.closest('[data-team-task-group]')))return;const next=nextTarget?.querySelector(`[data-direction="${direction}"]:not(:disabled)`)||nextTarget?.querySelector('button[data-direction]:not(:disabled)');
 next?.focus({preventScroll:true});nextTarget?.scrollIntoView({block:'start',behavior:'instant'});
}
async function openTeamTask(id){
 if(teamTaskActor!==me||view!=='personal'||personalSection!=='task')return;
 const actor=me,epoch=teamTaskEpoch,request=++teamTaskDetailRequest,card=document.querySelector(`[data-team-task="${CSS.escape(id)}"]`),group=card?.closest('[data-team-task-group]');
 const current=()=>me===actor&&epoch===teamTaskEpoch&&request===teamTaskDetailRequest&&view==='personal'&&personalSection==='task'&&card?.isConnected&&(!group||workspaceDisclosureOpen(group));
 if(!current()||![...teamTaskMore.values()].some(group=>group.rows.some(row=>row.id===id)))return;
 if(teamTaskRecordErrors.get(id)?.retry){await teamTaskRecordErrors.get(id).retry();return;}
 try{
  const result=await client.from('team_tasks').select('id,task_number,title,details,urgency,due_at,assignee_user_id,assigned_by,status,close_note,closed_at,version,reschedule_count').eq('id',id).maybeSingle();
  if(!current())return;if(result.error)throw Error(result.error.message);const row=result.data;
  if(!row||row.id!==id||!Number.isSafeInteger(row.version)||row.version<1||typeof row.title!=='string'||typeof row.details!=='string'||typeof row.task_number!=='string'||!Number.isFinite(Date.parse(row.due_at))||!['open','done','cancelled'].includes(row.status)||!teamTaskUrgency.some(([key])=>key===row.urgency)||!Number.isInteger(row.reschedule_count))throw Error('This task is unavailable. Refresh the list.');
  const history=await loadTeamTaskHistory([id],actor,epoch);if(!history||!current())return;
  teamTasks=teamTasks.filter(task=>task.id!==id);teamTasks.push(row);teamTaskMoves.set(id,history.moves.get(id)||[]);teamTaskEvents.set(id,history.history.get(id)||[]);teamTaskHistoryLoaded.add(id);teamTaskRecordErrors.delete(id);teamTaskSelectedId=id;
  renderTeamTaskGroups();document.querySelector(`[data-team-task="${CSS.escape(id)}"] button`)?.focus({preventScroll:true});
 }catch(error){if(!current())return;message(`Task details could not load: ${error.message}`,true);}
}
async function teamTasksWorkspace(){
 const actorChanged=teamTaskActor!==me;syncTeamTaskActor();teamTaskSelectedId='';teamTaskDetailRequest++;
 const epoch=++teamTaskEpoch,actor=me,target=$('#content');
 const current=()=>epoch===teamTaskEpoch&&me===actor&&view==='personal'&&personalSection==='task'&&target.isConnected;
 const markSeen=kinds=>{if(current()&&typeof bellMarkSeen==='function')bellMarkSeen(actor.user_id,kinds);};
 const refreshBell=()=>{if(current()&&typeof refreshNotificationBell==='function')refreshNotificationBell(true).catch(()=>{});};
 if(actorChanged||!workspaceRefreshRetaining())target.innerHTML=`<section class="team-tasks">${workspacePageHeader({title:'My tasks',subtitle:'Tasks from your team and work handed to you.',actions:'<button type="button" id="teamTaskRefresh">Refresh</button><button type="button" class="primary-action" id="teamTaskNew">New task</button>'})}<div class="team-task-columns"><section class="team-task-column" aria-labelledby="teamTaskHeading"><h2 id="teamTaskHeading">Team tasks</h2><div id="manualTasks">${workspaceSkeleton('task-cards','Loading your tasks…')}</div></section><div id="orderSteps" class="team-task-column"></div></div><div id="teamTaskRelated"></div><div id="teamTaskFinished"></div></section>`;
 const manual=$('#manualTasks'),finishedBox=$('#teamTaskFinished'),steps=$('#orderSteps'),related=$('#teamTaskRelated');
 $('#teamTaskRefresh').onclick=()=>run(teamTasksWorkspace);
 $('#teamTaskNew').disabled=true;$('#teamTaskNew').onclick=()=>openTeamTaskEditor(null);
 // Delegation keeps card actions active across group pages.
 target.querySelector('.team-tasks').onclick=event=>{
  if(!current())return;
  const button=event.target.closest('button');if(!button)return;const d=button.dataset,task=id=>teamTasks.find(row=>row.id===id);
  if(d.teamTaskOpen)run(()=>openTeamTask(d.teamTaskOpen));
  else if(d.teamTaskCollapse){teamTaskSelectedId='';teamTaskDetailRequest++;renderTeamTaskGroups();document.querySelector(`[data-team-task="${CSS.escape(d.teamTaskCollapse)}"] button`)?.focus({preventScroll:true});}
  else if(d.teamTaskRetry)run(()=>teamTaskRecordErrors.get(d.teamTaskRetry)?.retry?.());
  else if(d.teamTaskComment)openTeamTaskComment(task(d.teamTaskComment));
  else if(d.teamTaskEdit)openTeamTaskEditor(task(d.teamTaskEdit));
  else if(d.teamTaskDone)openTeamTaskClose(task(d.teamTaskDone),'done');
  else if(d.teamTaskMove)openTeamTaskReschedule(task(d.teamTaskMove));
  else if(d.teamTaskAsk)openDeadlineRequest(task(d.teamTaskAsk));
  else if(d.teamTaskCancel)openTeamTaskClose(task(d.teamTaskCancel),'cancel');
  else if(d.teamTaskMore)run(()=>changeTeamTaskPage(button));
 };
 // The handoff pane loads independently, including when task history is unavailable.
 const handoffs=typeof renderMyHandoffs==='function'?renderMyHandoffs(steps).then(shown=>{if(shown===true)markSeen(['work']);}).catch(()=>{}):Promise.resolve();
 if(typeof renderWorkNotices==='function')renderWorkNotices(related).catch(()=>{});
 if(me?.role==='owner'&&typeof renderUnownedWork==='function')renderUnownedWork(related,'',true).catch(()=>{});
 let loaded;try{loaded=await loadTeamTasks();}catch(error){
  if(current()){teamTaskMore.clear();manual.innerHTML=`<p role="alert">Tasks could not load: ${esc(error.message)}</p><button type="button" id="teamTaskRetry">Retry</button>`;finishedBox.innerHTML='';$('#teamTaskRetry').onclick=()=>run(teamTasksWorkspace);}
  await handoffs;refreshBell();return;
 }
 if(!current()||loaded===null)return;
 setTeamTaskGroups(loaded);renderTeamTaskGroups();$('#teamTaskNew').disabled=false;
 if(typeof renderDeadlineRequests==='function')renderDeadlineRequests(related).catch(()=>{});
 markSeen(['tasks','results']);
 await handoffs;
 refreshBell();
}
function openTeamTaskComment(row){
 if(!row||row.status!=='open'||!(row.assignee_user_id===me?.user_id||row.assigned_by===me?.user_id||me?.role==='owner'))return;
 const actor=me,epoch=teamTaskEpoch,requestId=crypto.randomUUID(),current=()=>me===actor&&epoch===teamTaskEpoch&&view==='personal'&&personalSection==='task';
 actionForm('Add progress',`<p><strong>${esc(row.title)}</strong></p><label><span>Progress comment</span><textarea name="note" required maxlength="1000" rows="4" placeholder="What has happened so far?"></textarea></label><p class="muted">Your comment is saved permanently with your name and date. The task stays open.</p>`,async values=>{
  if(!current())throw Error('Login or task view changed. Reopen the task.');
  const note=String(values.note||'').trim();if(!note||note.length>1000)throw Error('Write a progress comment (1 to 1000 characters).');
  const result=await client.rpc('append_team_task_progress',{p_id:requestId,p_task_id:row.id,p_note:note});
  if(!current())return;
  if(result.error)throw Error(result.error.message);
  const event=Array.isArray(result.data)?result.data[0]:result.data;
  if(!event||event.id!==requestId||event.task_id!==row.id||event.action!=='progress'){message('Progress was saved, but the comment could not be shown. Refresh the task before retrying.',true);return;}
  updateTeamTaskProgress(row,event);message('Progress added. The task stays open.');
 });
}
function updateTeamTaskProgress(row,event){
 const history=(teamTaskEvents.get(row.id)||[]).filter(item=>item.id!==event.id);history.push(event);
 history.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));teamTaskEvents.set(row.id,history);
 const card=document.querySelector(`[data-team-task="${CSS.escape(row.id)}"]`);if(!card)return;
 const previous=card.querySelector('.team-task-progress'),expanded=workspaceDisclosureOpen(previous?.querySelector('details'));
 const template=document.createElement('template');template.innerHTML=teamTaskProgress(row);const progress=template.content.firstElementChild;
 if(expanded&&progress.querySelector('details'))progress.querySelector('details').open=true;
 if(previous)previous.replaceWith(progress);else card.insertBefore(progress,card.querySelector('.team-task-assignments,.team-task-moves,.actions'));bindTeamTaskDisclosures(card);
}
async function updateTeamTaskRecord(row,data,actor,epoch){
 const current=()=>me===actor&&teamTaskEpoch===epoch&&view==='personal'&&personalSection==='task';
 if(!current())return false;
 const saved=Array.isArray(data)&&data.length===1?data[0]:Array.isArray(data)?null:data;
 if(!saved||saved.id!==row.id||saved.status!=='open'||saved.assignee_user_id!==row.assignee_user_id||saved.assigned_by!==row.assigned_by||saved.version!==row.version+1||typeof saved.title!=='string'||saved.title.trim().length<2||typeof saved.details!=='string'||typeof saved.task_number!=='string'||!saved.task_number||!Number.isFinite(Date.parse(saved.due_at))||!teamTaskUrgency.some(([key])=>key===saved.urgency)||!Number.isInteger(saved.reschedule_count)||saved.reschedule_count<0||saved.reschedule_count>teamTaskMoveLimit){
  const text='Task was saved, but its current details could not be verified. Refresh before making another change.';
  teamTaskRecordErrors.set(row.id,{kind:'record',text});
  const card=document.querySelector(`[data-team-task="${CSS.escape(row.id)}"]`);
  if(card){card.querySelectorAll('button').forEach(button=>button.disabled=true);const warning=document.createElement('p');warning.className='notice error';warning.setAttribute('role','alert');warning.textContent=text;card.append(warning);}
  message(text,true);return false;
 }
 let history,error;
 try{history=await loadTeamTaskHistory([saved.id],actor,epoch);}catch(failure){error=failure;}
 if(!current())return false;
 teamTasks=teamTasks.map(task=>task.id===saved.id?saved:task);
 for(const state of teamTaskMore.values())state.rows=state.rows.map(task=>task.id===saved.id?saved:task);
 if(history){teamTaskMoves.set(saved.id,history.moves.get(saved.id)||[]);teamTaskEvents.set(saved.id,history.history.get(saved.id)||[]);teamTaskHistoryLoaded.add(saved.id);teamTaskRecordErrors.delete(saved.id);}
 if(error){teamTaskHistoryLoaded.delete(saved.id);teamTaskRecordErrors.set(saved.id,{kind:'history',text:'Task saved. History could not refresh; refresh before making another change.'});}
 const previous=document.querySelector(`[data-team-task="${CSS.escape(saved.id)}"]`);
 if(previous){
  const template=document.createElement('template');template.innerHTML=teamTaskCard(saved);
  const next=template.content.firstElementChild;
  for(const selector of ['.team-task-assignments','.team-task-moves','.team-task-progress details'])if(workspaceDisclosureOpen(previous.querySelector(selector))&&next.querySelector(selector))next.querySelector(selector).open=true;
  previous.replaceWith(next);bindTeamTaskDisclosures(next);
  if(typeof decorateTaskDeadlineNotes==='function')decorateTaskDeadlineNotes(next);
 }
 if(error){message('Task saved. History could not refresh; refresh before making another change.',true);return false;}
 return true;
}
function teamTaskSavedRow(data,expected,read=false){
 const saved=Array.isArray(data)?(data.length===1?data[0]:null):data;
 if(!saved||saved.id!==expected.id||!Number.isSafeInteger(saved.version)||saved.version<(expected.version||1)||!read&&saved.version!==expected.version||typeof saved.title!=='string'||saved.title.trim().length<2||typeof saved.details!=='string'||typeof saved.task_number!=='string'||!saved.task_number||typeof saved.assignee_user_id!=='string'||!saved.assignee_user_id||typeof saved.assigned_by!=='string'||!saved.assigned_by||!Number.isFinite(Date.parse(saved.due_at))||!teamTaskUrgency.some(([key])=>key===saved.urgency)||!Number.isInteger(saved.reschedule_count)||saved.reschedule_count<0||saved.reschedule_count>teamTaskMoveLimit||!['open','done','cancelled'].includes(saved.status)||typeof saved.close_note!=='string'||(saved.status==='open'?saved.closed_at!==null:!Number.isFinite(Date.parse(saved.closed_at))))throw Error('The saved task details could not be verified.');
 if(!read&&Object.entries(expected).some(([key,value])=>key==='due_at'?Date.parse(saved[key])!==Date.parse(value):saved[key]!==value))throw Error('The saved task does not match the submitted change.');
 return saved;
}
function reconcileSavedTeamTaskGroups(groups){
 if(!['forMe','gave','results','finished'].every(key=>{const group=groups[key];return group&&Number.isSafeInteger(group.total)&&group.total>=0&&Number.isSafeInteger(group.page)&&group.page>=0&&group.pages===Math.max(1,Math.ceil(group.total/teamTaskShown))&&group.page<group.pages&&Array.isArray(group.rows)&&group.rows.length===Math.min(teamTaskShown,group.total-group.page*teamTaskShown)&&new Set(group.rows.map(row=>row.id)).size===group.rows.length&&group.rows.every(row=>['id','title','task_number','assignee_user_id','assigned_by'].every(field=>typeof row[field]==='string'&&row[field])&&Number.isFinite(Date.parse(row.due_at))&&teamTaskUrgency.some(([value])=>value===row.urgency)&&['open','done','cancelled'].includes(row.status));}))throw Error('The task register could not be confirmed.');
 const manual=$('#manualTasks'),finished=$('#teamTaskFinished'),before=new Map([...teamTaskMore.values()].flatMap(group=>group.rows.map(row=>[row.id,row]))),cards=new Map([...manual.querySelectorAll('[data-team-task]'),...finished.querySelectorAll('[data-team-task]')].map(card=>[card.dataset.teamTask,card])),keep=new Set();
 const cardFor=row=>{
  const full=row.id===teamTaskSelectedId&&teamTasks.find(task=>task.id===row.id),html=full?teamTaskCard(full):teamTaskSummaryCard(row);let card=cards.get(row.id);
  const previousHtml=card?.teamTaskMarkup||(!card?.querySelector('[data-team-task-open]')?'':before.has(row.id)?teamTaskSummaryCard(before.get(row.id)):'');
  if(!card||previousHtml!==html){const template=document.createElement('template');template.innerHTML=html;const next=template.content.firstElementChild;for(const selector of ['.team-task-assignments','.team-task-moves','.team-task-progress details'])if(workspaceDisclosureOpen(card?.querySelector(selector))&&next.querySelector(selector))next.querySelector(selector).open=true;card?.replaceWith(next);card=next;card.teamTaskMarkup=html;if(typeof decorateTaskDeadlineNotes==='function')decorateTaskDeadlineNotes(card);}
  keep.add(card);return card;
 };
 for(const key of ['forMe','gave','results','finished']){
  const state=groups[key],details=document.querySelector(`[data-team-task-group="${key}"]`),target=details.querySelector('[data-team-task-page]'),summary=details.querySelector('summary');summary.textContent=summary.textContent.replace(/ · \d+$/,'')+' · '+state.total;
  if(!workspaceDisclosureOpen(details))continue;
  let pager=target.querySelector('[data-team-task-more]')?.closest('.actions');
  if(!pager){const template=document.createElement('template');template.innerHTML=`<div class="actions"><span role="status"></span><button type="button" data-team-task-more="${key}" data-direction="previous">Previous</button><button type="button" data-team-task-more="${key}" data-direction="next">Next</button></div>`;pager=template.content.firstElementChild;target.append(pager);}
  state.rows.forEach((row,index)=>{const card=cardFor(row);if(target.children[index]!==card)target.insertBefore(card,target.children[index]||pager);});
  const empty=[...target.children].find(node=>node.matches('p.muted'));if(state.rows.length)empty?.remove();else if(!empty){const note=document.createElement('p');note.className='muted';note.textContent='No tasks in this group.';target.insertBefore(note,pager);}
  pager.querySelector('[role="status"]').textContent=`${state.total?state.page*teamTaskShown+1:0}–${state.page*teamTaskShown+state.rows.length} of ${state.total} tasks`;
  pager.hidden=!state.total;
  pager.querySelector('[data-direction="previous"]').disabled=state.page===0;pager.querySelector('[data-direction="next"]').disabled=state.page+1>=state.pages;
 }
 const selected=teamTasks.find(row=>row.id===teamTaskSelectedId);let slot=document.querySelector('[data-team-task-saved-detail]');
 if(selected&&![...keep].some(card=>card.dataset.teamTask===selected.id)){if(!slot){slot=document.createElement('section');slot.dataset.teamTaskSavedDetail='';manual.prepend(slot);}const card=cardFor(selected);if(slot.firstElementChild!==card)slot.replaceChildren(card);}else slot?.remove();
 for(const card of cards.values())if(!keep.has(card)&&card.isConnected)card.remove();
 setTeamTaskGroups(groups);bindTeamTaskDisclosures(manual);bindTeamTaskDisclosures(finished);
}
async function refreshSavedTeamTask(id,data,expected,text,actor,epoch){
 let manual=$('#manualTasks'),finished=$('#teamTaskFinished'),sequence=++teamTaskSaveSequence;
 const sessionCurrent=()=>me===actor&&teamTaskEpoch===epoch&&view==='personal'&&personalSection==='task'&&manual?.isConnected&&finished?.isConnected;
 const current=()=>sessionCurrent()&&sequence===teamTaskSaveSequence;
 if(!current())return false;
 let notice=document.querySelector('[data-team-task-save-notice]');if(!notice){notice=document.createElement('section');notice.className='notice';notice.dataset.teamTaskSaveNotice='';notice.setAttribute('role','status');manual.parentElement.insertBefore(notice,manual);}
 let focused=document.activeElement,restoreFocus=focused===document.body||!!focused?.closest('dialog')||!!focused?.closest('[data-team-task]')||notice.contains(focused),left=window.scrollX,top=window.scrollY;
 const focus=()=>{if(!current()||!restoreFocus)return;const target=notice.querySelector('button')||document.querySelector(`[data-team-task="${CSS.escape(id)}"] [data-team-task-collapse]`);target?.focus({preventScroll:true});};
 const after=()=>{if(!current())return;window.scrollTo({left,top,behavior:'instant'});if(typeof actionDialog!=='undefined'&&actionDialog.open)actionDialog.addEventListener('close',focus,{once:true});else focus();};
 const paint=()=>reconcileSavedTeamTaskGroups(Object.fromEntries(teamTaskMore));
 const failure=(kind,error)=>{
  if(!current())return;const warning=`${text} ${error.message} Retry saved details before making another change.`;
  teamTaskRecordErrors.set(id,{kind,text:warning,retry});notice.innerHTML=`<p>${esc(warning)}</p><button type="button" data-team-task-save-retry>Retry saved task</button>`;notice.querySelector('button').onclick=()=>run(retry);paint();after();
 };
 const apply=row=>{teamTaskDetailRequest++;teamTasks=teamTasks.filter(task=>task.id!==id);teamTasks.push(row);teamTaskSelectedId=id;teamTaskRecordErrors.set(id,{kind:'history',text:`${text} Refreshing task history and groups…`});paint();};
 const reconcile=async()=>{
  const request=sequence,reads=[loadTeamTaskHistory([id],actor,epoch),loadTeamTasks()],pageRequest=teamTaskPageRequest,results=await Promise.allSettled(reads);if(!current()||request!==sequence)return false;
  const history=results[0].status==='fulfilled'?results[0].value:null,groups=pageRequest===teamTaskPageRequest&&results[1].status==='fulfilled'?results[1].value:null;
  if(history){teamTaskMoves.set(id,history.moves.get(id)||[]);teamTaskEvents.set(id,history.history.get(id)||[]);teamTaskHistoryLoaded.add(id);}else teamTaskHistoryLoaded.delete(id);
  if(groups){try{reconcileSavedTeamTaskGroups(groups);}catch(error){failure('page',error);return false;}}
  if(!history){failure('history',Error('Task history could not refresh.'));return false;}
  if(!groups){failure('page',Error('The task register could not refresh.'));return false;}
  teamTaskRecordErrors.delete(id);paint();notice.textContent=text;after();return true;
 };
 async function retry(){
  if(me!==actor||view!=='personal'||personalSection!=='task'||teamTaskRecordErrors.get(id)?.retry!==retry)return;
  manual=$('#manualTasks');finished=$('#teamTaskFinished');epoch=teamTaskEpoch;if(!sessionCurrent())return;
  const request=sequence=++teamTaskSaveSequence;
  notice=document.querySelector('[data-team-task-save-notice]')||notice;
  if(!notice.isConnected)manual.parentElement.insertBefore(notice,manual);
  focused=document.activeElement;restoreFocus=focused===document.body||!!focused?.closest('dialog')||!!focused?.closest('[data-team-task]')||notice.contains(focused);left=window.scrollX;top=window.scrollY;
  const button=notice.querySelector('button');if(button)button.disabled=true;
  try{const result=await client.from('team_tasks').select('*').eq('id',id).maybeSingle();if(!current()||request!==sequence)return;if(result.error)throw Error(result.error.message);apply(teamTaskSavedRow(result.data,expected,true));await reconcile();}
  catch(error){if(request===sequence)failure('record',error);}
 }
 try{apply(teamTaskSavedRow(data,expected));}catch(error){failure('record',error);return false;}
 return reconcile().catch(error=>{failure('record',error);return false;});
}
function teamTaskDefaultDue(){const d=new Date();if(d.getHours()>=16)d.setDate(d.getDate()+1);d.setHours(17,0,0,0);return d}
function teamTaskLocalInput(date){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function openTeamTaskEditor(row){
 const employees=[...employeeDirectory.values()].filter(e=>e.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 const assignee=row?.assignee_user_id||me.user_id,id=row?.id||crypto.randomUUID(),actor=me,epoch=teamTaskEpoch,target=document.querySelector('#manualTasks');let committed=false,posting=false;
 const current=()=>me===actor&&epoch===teamTaskEpoch&&view==='personal'&&personalSection==='task'&&target===document.querySelector('#manualTasks');
 const fields=`<label><span>What needs doing?</span><input name="title" required minlength="2" maxlength="200" value="${esc(row?.title||'')}" placeholder="For example: send the service report to Aga Khan"></label>
 ${row&&me.role!=='owner'?'<p class="muted">To change the deadline, close this editor and use Ask for more time.</p>':''}
 <label><span>Who does it?</span><select name="assignee" required>${employees.map(e=>`<option value="${esc(e.user_id)}"${e.user_id===assignee?' selected':''}>${esc(employeeName(e.user_id))}${e.user_id===me.user_id?' (me)':''}</option>`).join('')}</select></label>
 <fieldset class="urgency-choice"><legend>How urgent?</legend>${teamTaskUrgency.map(([key,label])=>`<label class="urgency-${key}"><input type="radio" name="urgency" value="${key}" required${row?.urgency===key?' checked':''}> ${label}</label>`).join('')}</fieldset>
 <label><span>Due</span><input type="datetime-local" name="due" required ${row&&me.role!=='owner'?'readonly':''} value="${teamTaskLocalInput(row?new Date(row.due_at):teamTaskDefaultDue())}"></label>
 <label><span>Details · optional</span><textarea name="details" maxlength="4000">${esc(row?.details||'')}</textarea></label>`;
 actionForm(row?'Edit task':'New task',fields,async values=>{
  if(!current())throw Error('Login or task view changed. Reopen the task.');
  if(committed||posting)return;
  if(!values.urgency)throw Error('Choose how urgent it is.');
  const due=new Date(row&&me.role!=='owner'?row.due_at:values.due);if(!Number.isFinite(due.getTime()))throw Error('Choose the due date and time.');
  let result;posting=true;try{result=await client.rpc('save_team_task',{p_id:id,p_expected_version:row?.version||0,p_title:values.title,p_details:values.details||'',p_urgency:values.urgency,p_due_at:row&&me.role!=='owner'?row.due_at:due.toISOString(),p_assignee:values.assignee});}catch(error){if(current())throw error;return;}finally{posting=false;}
  if(!current())return;
  if(result.error)throw Error(result.error.message);committed=true;
  if(row&&values.assignee===row.assignee_user_id){if(await updateTeamTaskRecord(row,result.data,actor,epoch))message('Task updated.');return;}
  await refreshSavedTeamTask(id,result.data,{id,version:(row?.version||0)+1,status:'open',assigned_by:row?.assigned_by||actor.user_id,assignee_user_id:values.assignee,title:values.title.replace(/^ +| +$/g,''),details:values.details||'',urgency:values.urgency,due_at:row&&actor.role!=='owner'?row.due_at:due.toISOString()},row?'Task updated.':`Task sent to ${employeeName(values.assignee)}.`,actor,epoch);
 });
}
// A result must say something: at least 3 real words, not "xxx", "ok" or "done".
function teamTaskResultProblem(note){
 const words=String(note||'').toLowerCase().match(/[a-z\u00c0-\u024f0-9]{2,}/g)||[];
 const real=words.filter(w=>!/^(.)\1+$/.test(w)&&!['ok','okay','done','na','nil','none','yes','no','test','finished','complete','completed'].includes(w));
 return real.length<3?'Write what you did and what the result was, in a few words (for example: Called Nisha, wants 2 ultrasound quotes).':'';
}
function teamTaskDefiniteRejection(error){return /^(?:P0001|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3}|40001|40P01|57014)$/.test(error?.code||'');}
function teamTaskCloseFollowup(id,data,expected,text,actor,epoch){
 const target=document.querySelector('#manualTasks'),pending=refreshSavedTeamTask(id,data,expected,text,actor,epoch),sequence=teamTaskSaveSequence;
 // The receipt is committed; slow read-only follow-ups must not consume the Undo window under run's lock.
 pending.catch(error=>{if(me!==actor||teamTaskEpoch!==epoch||sequence!==teamTaskSaveSequence||view!=='personal'||personalSection!=='task'||!target?.isConnected||target!==document.querySelector('#manualTasks'))return;teamTaskRecordErrors.set(id,{...teamTaskRecordErrors.get(id),kind:'record',text:`${text} Details could not refresh. Retry saved details before making another change.`});message(`${text} Details could not refresh: ${error.message}`,true);});
 return pending;
}
function offerTeamTaskUndo(saved,actor,epoch,target){
 const remaining=Date.parse(saved.undo_expires_at)-Date.now();
 if(typeof actionFeedbackUndo!=='function'||saved.closed_by!==actor.user_id||!['done','cancelled'].includes(saved.status)||Date.parse(saved.undo_expires_at)-Date.parse(saved.closed_at)!==8000||!(remaining>0))return false;
 const sessionCurrent=(readEpoch=epoch,readTarget=target)=>me===actor&&teamTaskEpoch===readEpoch&&view==='personal'&&personalSection==='task'&&readTarget?.isConnected&&readTarget===document.querySelector('#manualTasks');
 let posting=false,completed=false,request=0;
 const retryState=(text,retry)=>{
  teamTaskRecordErrors.set(saved.id,{kind:'undo',text,retry});
  const notice=document.querySelector('[data-team-task-save-notice]');
  if(notice){notice.innerHTML=`<p>${esc(text)}</p><button type="button" data-team-task-save-retry>Check Undo</button>`;notice.querySelector('button').onclick=()=>run(retry);}
  reconcileSavedTeamTaskGroups(Object.fromEntries(teamTaskMore));
 };
 const refresh=async()=>{
  const readEpoch=teamTaskEpoch,readTarget=document.querySelector('#manualTasks');if(!sessionCurrent(readEpoch,readTarget)||teamTaskRecordErrors.get(saved.id)?.retry!==refresh)return;const sequence=++teamTaskSaveSequence;
  const result=await client.from('team_tasks').select('*').eq('id',saved.id).maybeSingle();if(!sessionCurrent(readEpoch,readTarget)||sequence!==teamTaskSaveSequence)return;if(result.error)throw Error(result.error.message);
  const row=teamTaskSavedRow(result.data,{id:saved.id,version:saved.version},true);
  await refreshSavedTeamTask(saved.id,row,{id:row.id,version:row.version,status:row.status},'Task refreshed.',actor,readEpoch);
 };
 const retryUndo=()=>undo(true);
 const undo=async(recovery=false)=>{
  const readEpoch=recovery?teamTaskEpoch:epoch,readTarget=recovery?document.querySelector('#manualTasks'):target;
  if(!sessionCurrent(readEpoch,readTarget)||recovery&&teamTaskRecordErrors.get(saved.id)?.retry!==retryUndo||teamTasks.find(row=>row.id===saved.id)?.version!==saved.version)throw Error('Task or login changed. Reopen the task.');
  if(posting||completed)return;posting=true;const read=++request,sequence=++teamTaskSaveSequence;
  const current=()=>sessionCurrent(readEpoch,readTarget)&&read===request&&sequence===teamTaskSaveSequence;
  try{
   let result;try{result=await client.rpc('undo_team_task',{p_id:saved.id,p_expected_version:saved.version});}catch(error){if(!current())return;retryState('Undo could not be confirmed. Check Undo safely before making another change.',retryUndo);throw error;}
   if(!current())return;
   if(result.error){retryState(`Undo could not be confirmed: ${result.error.message}`,teamTaskDefiniteRejection(result.error)?refresh:retryUndo);throw Error(result.error.message);}
   const expected={id:saved.id,version:saved.version+1,status:'open',assigned_by:saved.assigned_by,assignee_user_id:saved.assignee_user_id,title:saved.title,details:saved.details,urgency:saved.urgency,due_at:saved.due_at,reschedule_count:saved.reschedule_count,close_note:'',closed_by:null,closed_at:null,undo_expires_at:null};
   let restored;try{restored=teamTaskSavedRow(result.data,expected);}catch(error){retryState('Undo returned without complete details. Check Undo safely before making another change.',retryUndo);throw error;}
   completed=true;
   await refreshSavedTeamTask(saved.id,restored,expected,'Task reopened.',actor,readEpoch);
   if(sessionCurrent(readEpoch,readTarget))message('Task reopened.');
  }finally{posting=false;}
 };
 const anchor=document.querySelector(`[data-team-task="${CSS.escape(saved.id)}"] [data-team-task-collapse]`)||target;
 actionFeedbackUndo(actionFeedbackReference(anchor),saved.status==='done'?'Task marked done.':'Task cancelled.',remaining,()=>undo());return true;
}
function openTeamTaskClose(row,action){
 if(!row||row.status!=='open')return;
 const actor=me,epoch=teamTaskEpoch,target=document.querySelector('#manualTasks'),current=()=>me===actor&&epoch===teamTaskEpoch&&view==='personal'&&personalSection==='task'&&target?.isConnected&&target===document.querySelector('#manualTasks');
 let committed=false,posting=false,unconfirmed=false,expected=null,form,noteInput,preview=null,previous=null,readRequest=0;
 const rollback=()=>{if(current()&&preview?.isConnected&&previous)preview.replaceWith(previous);preview=null;};
 const paintPending=()=>{
  previous=document.querySelector(`[data-team-task="${CSS.escape(row.id)}"]`);if(!previous||action!=='done')return;
  const template=document.createElement('template');template.innerHTML=teamTaskCard(row);preview=template.content.firstElementChild;
  for(const selector of ['.team-task-assignments','.team-task-moves','.team-task-progress details'])if(workspaceDisclosureOpen(previous.querySelector(selector))&&preview.querySelector(selector))preview.querySelector(selector).open=true;
  preview.querySelectorAll('button').forEach(button=>button.disabled=true);preview.setAttribute('aria-busy','true');
  const label=preview.querySelector('.urgency-tag');if(label)label.textContent='Done · Saving…';
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Awaiting confirmation. The task counts will update when saved.';preview.append(status);previous.replaceWith(preview);
 };
 const publish=async(saved,readEpoch=epoch,readTarget=target)=>{
  if(teamTasks.find(task=>task.id===row.id)?.version>saved.version){committed=true;throw Error('A newer task version is already shown. Reopen the task.');}
  committed=true;unconfirmed=false;rollback();teamTaskRecordErrors.delete(row.id);
  const text=action==='done'?'Task marked done.':'Task cancelled.',pending=teamTaskCloseFollowup(row.id,saved,expected,text,actor,readEpoch);
  if(!offerTeamTaskUndo(saved,actor,readEpoch,readTarget))await pending;
 };
 const uncertain=text=>{
  rollback();unconfirmed=true;
  teamTaskRecordErrors.set(row.id,{kind:'close',text,retry:verify});
  const card=document.querySelector(`[data-team-task="${CSS.escape(row.id)}"]`);if(card){card.querySelectorAll('button').forEach(button=>button.disabled=true);let warning=card.querySelector('[data-team-task-close-pending]');if(!warning){warning=document.createElement('p');warning.dataset.teamTaskClosePending='';warning.setAttribute('role','alert');card.append(warning);}warning.textContent=text;let retry=card.querySelector('[data-team-task-close-check]');if(!retry){retry=document.createElement('button');retry.type='button';retry.dataset.teamTaskCloseCheck='';retry.dataset.teamTaskRetry=row.id;retry.textContent='Check saved status';card.append(retry);}retry.disabled=false;}
  if(noteInput?.isConnected&&form.querySelector('[name="note"]')===noteInput){const save=form.querySelector('[type="submit"]');if(save)save.textContent='Check saved status';noteInput.readOnly=true;}
 };
 async function verify(){
  const readEpoch=teamTaskEpoch,readTarget=document.querySelector('#manualTasks');
  const readCurrent=()=>me===actor&&readEpoch===teamTaskEpoch&&view==='personal'&&personalSection==='task'&&readTarget?.isConnected&&readTarget===document.querySelector('#manualTasks');
  if(!readCurrent()||teamTaskRecordErrors.get(row.id)?.retry!==verify)return;const request=++readRequest,sequence=teamTaskSaveSequence;
  try{const result=await client.from('team_tasks').select('*').eq('id',row.id).maybeSingle();if(!readCurrent()||request!==readRequest||sequence!==teamTaskSaveSequence)return;if(result.error)throw Error(result.error.message);const saved=teamTaskSavedRow(result.data,expected);await publish(saved,readEpoch,readTarget);}
  catch(error){if(!readCurrent()||request!==readRequest||sequence!==teamTaskSaveSequence)return;uncertain('Task close is not confirmed. Check saved status before making another change.');throw error;}
 }
 // Done needs a short result so the person who gave the task can see what happened. Follow-up work (a quote, a
 // lead, a complaint) is opened on its own page; the note only records the outcome.
 const fields=action==='done'
  ?`<p><strong>${esc(row.title)}</strong></p><label><span>What did you do? What was the result?</span><textarea name="note" maxlength="1000" required minlength="5" rows="4" placeholder="For example: Called Nisha. Interested in 2 ultrasound machines. Made Pro forma for her."></textarea></label><p class="muted">If the client wants a quote, has a complaint or is a new opportunity, also open it under Pro formas, Complaints or Leads so someone follows it up.</p>`
  :`<p><strong>${esc(row.title)}</strong></p><label><span>Why is it cancelled?</span><textarea name="note" maxlength="1000" required minlength="3"></textarea></label>`;
 form=actionForm(action==='done'?'Complete assigned task':'Cancel task',fields,async values=>{
  if(!current())throw Error('Login or task view changed. Reopen the task.');
  if(posting)return;if(unconfirmed)return verify();if(committed)return;
  const cached=teamTasks.find(task=>task.id===row.id);if(cached&&cached.version!==row.version)throw Error('Task changed. Reopen the task.');
  if(action==='done'){const problem=teamTaskResultProblem(values.note);if(problem)throw Error(problem);}
  expected={id:row.id,version:row.version+1,status:action==='done'?'done':'cancelled',assigned_by:row.assigned_by,assignee_user_id:row.assignee_user_id,close_note:values.note||'',closed_by:actor.user_id};
  posting=true;paintPending();
  try{
   let result;try{result=await client.rpc('close_team_task',{p_id:row.id,p_expected_version:row.version,p_action:action,p_note:values.note||''});}catch(error){if(!current())return;uncertain('Task close is not confirmed. Check saved status before making another change.');throw error;}
   if(!current())return;
   if(result.error){if(teamTaskDefiniteRejection(result.error))rollback();else uncertain('Task close is not confirmed. Check saved status before making another change.');throw Error(result.error.message);}
   let saved;try{saved=teamTaskSavedRow(result.data,expected);}catch(error){uncertain('Task close returned without complete details. Check saved status before making another change.');throw error;}
   await publish(saved);
  }finally{posting=false;}
 });
 noteInput=form?.querySelector('[name="note"]');
}
function openTeamTaskReschedule(row){
 if(!row||!teamTaskCanMove(row))return;
 const left=teamTaskMoveLimit-(row.reschedule_count||0),actor=me,epoch=teamTaskEpoch,due=new Date(Math.max(Date.parse(row.due_at),Date.now())+86400000);
 const fields=`<p><strong>${esc(row.title)}</strong><br>Now due ${esc(teamTaskDue(row))}</p><p class="muted">You can move this task ${left} more time${left===1?'':'s'}. After that, mark it done or ask ${esc(employeeName(row.assigned_by))}.</p>
 <label><span>New due date and time</span><input type="datetime-local" name="due" required value="${teamTaskLocalInput(due)}"></label>
 <label><span>Why are you moving it?</span><textarea name="reason" required minlength="5" maxlength="1000" placeholder="For example: Called, no answer; officials can't be called twice a day; trying again Thursday"></textarea></label>`;
 actionForm('Reschedule task',fields,async values=>{
  if(me!==actor||epoch!==teamTaskEpoch||view!=='personal'||personalSection!=='task')throw Error('Login or task view changed. Reopen the task.');
  const next=new Date(values.due);if(!Number.isFinite(next.getTime()))throw Error('Choose the new due date and time.');
  if(next.getTime()<=Date.now())throw Error('Choose a new time later than now.');
  if((values.reason||'').trim().length<5)throw Error('Write why the task is moved (at least 5 characters).');
  const result=await client.rpc('reschedule_team_task',{p_id:row.id,p_expected_version:row.version,p_new_due:next.toISOString(),p_reason:values.reason.trim()});
  if(me!==actor||epoch!==teamTaskEpoch||view!=='personal'||personalSection!=='task')return;
  if(result.error)throw Error(result.error.message);
  if(await updateTeamTaskRecord(row,result.data,actor,epoch))message(`Task moved to ${teamTaskTime(next)}.`);
 });
}
