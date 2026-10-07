'use strict';
// My tasks: tasks one person gives another (or themselves), each with an urgency and a due date and time, shown
// together with the order steps handed to this person. Writes go through save_team_task / close_team_task /
// reschedule_team_task only. The person doing a task may move it later at most 3 times, with a reason each time.
let teamTasks=[],teamTaskMoves=new Map(),teamTaskEpoch=0;
const teamTaskMoveLimit=3;
const teamTaskUrgency=[['do_now','Do now'],['urgent','Urgent'],['normal','Normal']];
const teamTaskRank={do_now:0,urgent:1,normal:2};
function teamTaskOverdue(row,now=Date.now()){return row.status==='open'&&Date.parse(row.due_at)<now}
function teamTaskOrder(rows){return [...rows].sort((a,b)=>Number(a.status!=='open')-Number(b.status!=='open')||(teamTaskRank[a.urgency]??3)-(teamTaskRank[b.urgency]??3)||Date.parse(a.due_at)-Date.parse(b.due_at)||String(a.id).localeCompare(String(b.id)))}
function teamTaskUrgencyLabel(key){return teamTaskUrgency.find(([value])=>value===key)?.[1]||key}
function teamTaskDue(row){return teamTaskTime(row.due_at)}
function teamTaskTime(value){return new Date(value).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
function teamTaskCanMove(row){return row.status==='open'&&row.assignee_user_id===me?.user_id&&(row.reschedule_count||0)<teamTaskMoveLimit}
function teamTaskHistory(moves){return moves.length?`<details class="team-task-moves"><summary>Reschedule history · ${moves.length}</summary><ol>${moves.map(e=>`<li>${esc(teamTaskTime(e.old_due_at))} → <strong>${esc(teamTaskTime(e.new_due_at))}</strong> · ${esc(e.note)} <small class="muted">${esc(employeeName(e.actor_user_id))}, ${esc(new Date(e.created_at).toLocaleString())}</small></li>`).join('')}</ol></details>`:''}
function teamTaskCard(row){
 const mine=row.assignee_user_id===me?.user_id,gave=row.assigned_by===me?.user_id,owner=me?.role==='owner',overdue=teamTaskOverdue(row),open=row.status==='open';
 const who=mine&&gave?'Your own task':mine?`From ${employeeName(row.assigned_by)}`:`For ${employeeName(row.assignee_user_id)}`;
 const buttons=[];
 const moved=row.reschedule_count||0;
 if(open&&(mine||owner))buttons.push(`<button type="button" data-team-task-done="${esc(row.id)}">Mark done</button>`);
 if(teamTaskCanMove(row))buttons.push(`<button type="button" data-team-task-move="${esc(row.id)}">Reschedule</button>`);
 if(open&&(gave||owner))buttons.push(`<button type="button" data-team-task-edit="${esc(row.id)}">Edit</button>`,`<button type="button" class="danger" data-team-task-cancel="${esc(row.id)}">Cancel task</button>`);
 return `<article class="card team-task${overdue?' overdue':''}${open?'':' closed'}" data-team-task="${esc(row.id)}"><div class="heading"><div><span class="urgency-tag urgency-${esc(row.urgency)}">${esc(teamTaskUrgencyLabel(row.urgency))}</span>${moved?` <span class="urgency-tag moved-tag">Rescheduled ${moved} of ${teamTaskMoveLimit}</span>`:''}<h3>${esc(row.title)}</h3></div><small>${esc(row.task_number)}</small></div>${row.details?`<p>${esc(row.details)}</p>`:''}<p class="team-task-meta"><strong${overdue?' class="overdue"':''}>${overdue?'Late · was due ':'Due '}${esc(teamTaskDue(row))}</strong> · ${esc(who)}${open?'':` · ${row.status==='done'?'Done':'Cancelled'} ${esc(new Date(row.closed_at).toLocaleDateString())}${row.close_note?' · '+esc(row.close_note):''}`}</p>${open&&mine&&!gave&&moved>=teamTaskMoveLimit?`<p class="muted">Already moved ${teamTaskMoveLimit} times. Mark it done, or ask ${esc(employeeName(row.assigned_by))} to change it.</p>`:''}${teamTaskHistory(teamTaskMoves.get(row.id)||[])}${buttons.length?`<div class="actions">${buttons.join('')}</div>`:''}</article>`;
}
async function loadTeamTasks(){
 const actor=me?.user_id,since=new Date(Date.now()-30*86400000).toISOString();
 const result=await client.from('team_tasks').select('*').or(`status.eq.open,closed_at.gte.${since}`).order('due_at').limit(500);
 if(me?.user_id!==actor)return null;
 if(result.error)throw Error(result.error.message);
 const rows=result.data||[],moved=rows.filter(row=>row.reschedule_count>0).map(row=>row.id),moves=new Map();
 for(let i=0;i<moved.length;i+=100){
  const events=await client.from('team_task_events').select('task_id,old_due_at,new_due_at,note,actor_user_id,created_at').eq('action','reschedule').in('task_id',moved.slice(i,i+100)).order('created_at');
  if(me?.user_id!==actor)return null;
  if(events.error)throw Error(events.error.message);
  for(const e of events.data||[])moves.set(e.task_id,[...(moves.get(e.task_id)||[]),e]);
 }
 return {rows,moves};
}
async function teamTasksWorkspace(){
 const epoch=++teamTaskEpoch,actor=me?.user_id,target=$('#content');
 target.innerHTML='<p role="status">Loading your tasks…</p>';
 let loaded;try{loaded=await loadTeamTasks();}catch(error){if(epoch!==teamTaskEpoch)return;target.innerHTML=`<h1>My tasks</h1><p role="alert">Tasks could not load: ${esc(error.message)}</p><button type="button" id="teamTaskRetry">Retry</button>`;$('#teamTaskRetry').onclick=()=>run(teamTasksWorkspace);return;}
 if(epoch!==teamTaskEpoch||loaded===null||me?.user_id!==actor||view!=='personal'||personalSection!=='task')return;
 teamTasks=teamTaskOrder(loaded.rows);teamTaskMoves=loaded.moves;
 const forMe=teamTasks.filter(row=>row.status==='open'&&row.assignee_user_id===actor),gave=teamTasks.filter(row=>row.status==='open'&&row.assigned_by===actor&&row.assignee_user_id!==actor),finished=teamTasks.filter(row=>row.status!=='open'&&(row.assignee_user_id===actor||row.assigned_by===actor));
 target.innerHTML=`<section class="team-tasks"><div class="heading"><div><h1>My tasks</h1><p class="muted">Tasks given to you by the team or your head of department, most urgent first. Every task has an urgency and a due time.</p></div><div class="actions"><button type="button" id="teamTaskRefresh">Refresh</button><button type="button" class="primary-action" id="teamTaskNew">+ New task</button></div></div>
 <section class="team-task-group"><h2>To do · ${forMe.length}</h2>${forMe.map(teamTaskCard).join('')||'<p class="muted">Nothing given to you right now.</p>'}</section>
 <div id="orderSteps"></div>
 ${gave.length?`<section class="team-task-group"><h2>Tasks I gave others · ${gave.length}</h2>${gave.map(teamTaskCard).join('')}</section>`:''}
 ${finished.length?`<details class="team-task-group"><summary>Finished in the last 30 days · ${finished.length}</summary>${finished.map(teamTaskCard).join('')}</details>`:''}</section>`;
 $('#teamTaskRefresh').onclick=()=>run(teamTasksWorkspace);
 $('#teamTaskNew').onclick=()=>openTeamTaskEditor(null);
 target.querySelectorAll('[data-team-task-edit]').forEach(button=>button.onclick=()=>openTeamTaskEditor(teamTasks.find(row=>row.id===button.dataset.teamTaskEdit)));
 target.querySelectorAll('[data-team-task-done]').forEach(button=>button.onclick=()=>openTeamTaskClose(teamTasks.find(row=>row.id===button.dataset.teamTaskDone),'done'));
 target.querySelectorAll('[data-team-task-move]').forEach(button=>button.onclick=()=>openTeamTaskReschedule(teamTasks.find(row=>row.id===button.dataset.teamTaskMove)));
 target.querySelectorAll('[data-team-task-cancel]').forEach(button=>button.onclick=()=>openTeamTaskClose(teamTasks.find(row=>row.id===button.dataset.teamTaskCancel),'cancel'));
 const steps=$('#orderSteps');
 if(typeof renderMyHandoffs==='function')renderMyHandoffs(steps);
 if(typeof renderWorkNotices==='function')renderWorkNotices(steps).catch(()=>{});
 if(me?.role==='owner'&&typeof renderUnownedWork==='function')renderUnownedWork(steps).catch(()=>{});
}
function teamTaskDefaultDue(){const d=new Date();if(d.getHours()>=16)d.setDate(d.getDate()+1);d.setHours(17,0,0,0);return d}
function teamTaskLocalInput(date){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function openTeamTaskEditor(row){
 const employees=[...employeeDirectory.values()].filter(e=>e.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 const assignee=row?.assignee_user_id||me.user_id,id=row?.id||crypto.randomUUID(),actor=me?.user_id;
 const fields=`<label><span>What needs doing?</span><input name="title" required minlength="2" maxlength="200" value="${esc(row?.title||'')}" placeholder="For example: send the service report to Aga Khan"></label>
 <label><span>Who does it?</span><select name="assignee" required>${employees.map(e=>`<option value="${esc(e.user_id)}"${e.user_id===assignee?' selected':''}>${esc(employeeName(e.user_id))}${e.user_id===me.user_id?' (me)':''}</option>`).join('')}</select></label>
 <fieldset class="urgency-choice"><legend>How urgent?</legend>${teamTaskUrgency.map(([key,label])=>`<label class="urgency-${key}"><input type="radio" name="urgency" value="${key}" required${row?.urgency===key?' checked':''}> ${label}</label>`).join('')}</fieldset>
 <label><span>Due</span><input type="datetime-local" name="due" required value="${teamTaskLocalInput(row?new Date(row.due_at):teamTaskDefaultDue())}"></label>
 <label><span>Details · optional</span><textarea name="details" maxlength="4000">${esc(row?.details||'')}</textarea></label>`;
 actionForm(row?'Edit task':'New task',fields,async values=>{
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the task.');
  if(!values.urgency)throw Error('Choose how urgent it is.');
  const due=new Date(values.due);if(!Number.isFinite(due.getTime()))throw Error('Choose the due date and time.');
  const result=await client.rpc('save_team_task',{p_id:id,p_expected_version:row?.version||0,p_title:values.title,p_details:values.details||'',p_urgency:values.urgency,p_due_at:due.toISOString(),p_assignee:values.assignee});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  await teamTasksWorkspace();message(row?'Task updated.':`Task sent to ${employeeName(values.assignee)}.`);
 });
}
function openTeamTaskClose(row,action){
 if(!row)return;
 const fields=`<p><strong>${esc(row.title)}</strong></p><label><span>${action==='done'?'Note · optional':'Why is it cancelled?'}</span><textarea name="note" maxlength="1000"${action==='cancel'?' required minlength="3"':''}></textarea></label>`;
 actionForm(action==='done'?'Mark task done':'Cancel task',fields,async values=>{
  const actor=me?.user_id,result=await client.rpc('close_team_task',{p_id:row.id,p_expected_version:row.version,p_action:action,p_note:values.note||''});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the task.');
  if(result.error)throw Error(result.error.message);
  await teamTasksWorkspace();message(action==='done'?'Task marked done.':'Task cancelled.');
 });
}
function openTeamTaskReschedule(row){
 if(!row||!teamTaskCanMove(row))return;
 const left=teamTaskMoveLimit-(row.reschedule_count||0),actor=me?.user_id,due=new Date(Math.max(Date.parse(row.due_at),Date.now())+86400000);
 const fields=`<p><strong>${esc(row.title)}</strong><br>Now due ${esc(teamTaskDue(row))}</p><p class="muted">You can move this task ${left} more time${left===1?'':'s'}. After that, mark it done or ask ${esc(employeeName(row.assigned_by))}.</p>
 <label><span>New due date and time</span><input type="datetime-local" name="due" required value="${teamTaskLocalInput(due)}"></label>
 <label><span>Why are you moving it?</span><textarea name="reason" required minlength="5" maxlength="1000" placeholder="For example: Called, no answer; officials can't be called twice a day; trying again Thursday"></textarea></label>`;
 actionForm('Reschedule task',fields,async values=>{
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the task.');
  const next=new Date(values.due);if(!Number.isFinite(next.getTime()))throw Error('Choose the new due date and time.');
  if(next.getTime()<=Date.now())throw Error('Choose a new time later than now.');
  if((values.reason||'').trim().length<5)throw Error('Write why the task is moved (at least 5 characters).');
  const result=await client.rpc('reschedule_team_task',{p_id:row.id,p_expected_version:row.version,p_new_due:next.toISOString(),p_reason:values.reason.trim()});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  await teamTasksWorkspace();message(`Task moved to ${teamTaskTime(next)}.`);
 });
}
