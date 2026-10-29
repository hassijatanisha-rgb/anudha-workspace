'use strict';
// My tasks: tasks one person gives another (or themselves), each with an urgency and a due date and time, shown
// together with the order steps handed to this person. Task changes and progress comments use their database RPCs.
// A task may be moved later at most 3 times, with a reason each time: by the owner directly,
// or by the person doing it with their department head's approval (deadline-requests.js, migration 083).
let teamTasks=[],teamTaskMoves=new Map(),teamTaskEvents=new Map(),teamTaskEpoch=0;
function clearTeamTasks(){teamTaskEpoch++;teamTasks=[];teamTaskMoves.clear();teamTaskEvents.clear();teamTaskMore.clear();}
const teamTaskMoveLimit=3;
const teamTaskUrgency=[['do_now','Do now'],['urgent','Urgent'],['normal','Normal']];
const teamTaskRank={do_now:0,urgent:1,normal:2};
function teamTaskOverdue(row,now=Date.now()){return row.status==='open'&&Date.parse(row.due_at)<now}
function teamTaskOrder(rows){return [...rows].sort((a,b)=>Number(a.status!=='open')-Number(b.status!=='open')||(teamTaskRank[a.urgency]??3)-(teamTaskRank[b.urgency]??3)||Date.parse(a.due_at)-Date.parse(b.due_at)||String(a.id).localeCompare(String(b.id)))}
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
 const mine=row.assignee_user_id===me?.user_id,gave=row.assigned_by===me?.user_id,owner=me?.role==='owner',overdue=teamTaskOverdue(row),open=row.status==='open';
 const who=mine&&gave?'Your own task':mine?`From ${employeeName(row.assigned_by)}`:`For ${employeeName(row.assignee_user_id)}`;
 const buttons=[];
 const moved=row.reschedule_count||0;
 if(open&&(mine||gave||owner))buttons.push(`<button type="button" data-team-task-comment="${esc(row.id)}">Add progress</button>`);
 if(open&&(mine||owner))buttons.push(`<button type="button" data-team-task-done="${esc(row.id)}">Complete assigned task</button>`);
 // Migration 083: only the owner moves a deadline directly; everyone else asks their department head.
 if(teamTaskCanMove(row))buttons.push(owner||typeof openDeadlineRequest!=='function'?`<button type="button" data-team-task-move="${esc(row.id)}">Reschedule</button>`:`<button type="button" data-team-task-ask="${esc(row.id)}">Ask for more time</button>`);
 if(open&&(gave||owner))buttons.push(`<button type="button" data-team-task-edit="${esc(row.id)}">Edit</button>`,`<button type="button" class="danger" data-team-task-cancel="${esc(row.id)}">Cancel task</button>`);
 return `<article class="card team-task${overdue?' overdue':''}${open?'':' closed'}" data-team-task="${esc(row.id)}"><div class="heading"><div><span class="urgency-tag urgency-${esc(row.urgency)}">${esc(teamTaskUrgencyLabel(row.urgency))}</span>${moved?` <span class="urgency-tag moved-tag">Rescheduled ${moved} of ${teamTaskMoveLimit}</span>`:''}<h3>${esc(row.title)}</h3></div><small>${esc(row.task_number)}</small></div>${row.details?`<p>${esc(row.details)}</p>`:''}<p class="team-task-meta"><strong${overdue?' class="overdue"':''}>${overdue?'Late · was due ':'Due '}${esc(teamTaskDue(row))}</strong> · ${esc(who)}${open?'':` · ${row.status==='done'?'Done':'Cancelled'} ${esc(new Date(row.closed_at).toLocaleDateString())}`}</p>${!open&&row.close_note?`<p class="team-task-result"><small>Result</small>${esc(row.close_note)}</p>`:''}${open&&mine&&!gave&&moved>=teamTaskMoveLimit?`<p class="muted">Already moved ${teamTaskMoveLimit} times. Mark it done, or ask ${esc(employeeName(row.assigned_by))} to change it.</p>`:''}${teamTaskProgress(row)}${teamTaskAssignments(row)}${teamTaskHistory(teamTaskMoves.get(row.id)||[])}${buttons.length?`<div class="actions">${buttons.join('')}</div>`:''}</article>`;
}
async function loadTeamTasks(){
 const actor=me,epoch=teamTaskEpoch,since=new Date(Date.now()-30*86400000).toISOString();
 const rows=await all('team_tasks','id,task_number,title,details,urgency,due_at,assignee_user_id,assigned_by,status,close_note,closed_at,version,reschedule_count',q=>q.or(`assignee_user_id.eq.${actor.user_id},assigned_by.eq.${actor.user_id}`).or(`status.eq.open,closed_at.gte.${since}`));
 if(me!==actor||epoch!==teamTaskEpoch)return null;
 const ids=rows.map(row=>row.id),moves=new Map(),history=new Map();
 for(let i=0;i<ids.length;i+=100){
  const events=await all('team_task_events','id,task_id,action,old_due_at,new_due_at,note,actor_user_id,created_at,old_assignment,new_assignment',q=>q.in('task_id',ids.slice(i,i+100)).order('created_at').order('id'));
  if(me!==actor||epoch!==teamTaskEpoch)return null;
  for(const e of events.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)))){
   const map=e.action==='reschedule'?moves:history;
   if(!map.has(e.task_id))map.set(e.task_id,[]);
   map.get(e.task_id).push(e);
  }
 }
 return {rows,moves,history};
}
// A long list shows its first 100 cards and a button for the rest, so the page draws at once however many tasks a
// person has (one has 2,872 in the test data). The rest are kept here until the button is pressed.
const teamTaskShown=100;let teamTaskMore=new Map();
function teamTaskCards(rows){
 if(rows.length<=teamTaskShown)return rows.map(teamTaskCard).join('');
 const key=String(teamTaskMore.size+1);teamTaskMore.set(key,rows.slice(teamTaskShown));
 return rows.slice(0,teamTaskShown).map(teamTaskCard).join('')+`<button type="button" class="team-task-more" data-team-task-more="${key}">Show all ${rows.length} · ${rows.length-teamTaskShown} more</button>`;
}
async function teamTasksWorkspace(){
 const epoch=++teamTaskEpoch,actor=me,target=$('#content');
 const current=()=>epoch===teamTaskEpoch&&me===actor&&view==='personal'&&personalSection==='task'&&target.isConnected;
 const markSeen=kinds=>{if(current()&&typeof bellMarkSeen==='function'){bellMarkSeen(actor.user_id,kinds);if(typeof refreshNotificationBell==='function')refreshNotificationBell(true).catch(()=>{});}};
 if(!workspaceRefreshRetaining())target.innerHTML=`<section class="team-tasks"><div class="heading"><div><h1>My tasks</h1><p class="muted">See tasks from your head of department and team beside work handed to you. Add progress as you go; instructions and comments stay in history.</p></div><div class="actions"><button type="button" id="teamTaskRefresh">Refresh</button><button type="button" class="primary-action" id="teamTaskNew">+ New task</button></div></div><div class="team-task-columns"><section class="team-task-column" aria-labelledby="teamTaskHeading"><h2 id="teamTaskHeading">HOD and team tasks</h2><div id="manualTasks"><p role="status">Loading your tasks…</p></div></section><div id="orderSteps" class="team-task-column"></div></div><div id="teamTaskRelated"></div><div id="teamTaskFinished"></div></section>`;
 const manual=$('#manualTasks'),finishedBox=$('#teamTaskFinished'),steps=$('#orderSteps'),related=$('#teamTaskRelated');
 $('#teamTaskRefresh').onclick=()=>run(teamTasksWorkspace);
 $('#teamTaskNew').onclick=()=>openTeamTaskEditor(null);
 // One listener for the cards' buttons, so cards added by "Show all" work too.
 target.querySelector('.team-tasks').onclick=event=>{
  const button=event.target.closest('button');if(!button)return;const d=button.dataset,task=id=>teamTasks.find(row=>row.id===id);
  if(d.teamTaskComment)openTeamTaskComment(task(d.teamTaskComment));
  else if(d.teamTaskEdit)openTeamTaskEditor(task(d.teamTaskEdit));
  else if(d.teamTaskDone)openTeamTaskClose(task(d.teamTaskDone),'done');
  else if(d.teamTaskMove)openTeamTaskReschedule(task(d.teamTaskMove));
  else if(d.teamTaskAsk)openDeadlineRequest(task(d.teamTaskAsk));
  else if(d.teamTaskCancel)openTeamTaskClose(task(d.teamTaskCancel),'cancel');
  else if(d.teamTaskMore){const rows=teamTaskMore.get(d.teamTaskMore);teamTaskMore.delete(d.teamTaskMore);if(rows)button.outerHTML=rows.map(teamTaskCard).join('');}
 };
 // The handoff pane loads independently, including when task history is unavailable.
 const handoffs=typeof renderMyHandoffs==='function'?renderMyHandoffs(steps).then(shown=>{if(shown===true)markSeen(['work']);}).catch(()=>{}):Promise.resolve();
 if(typeof renderDeadlineRequests==='function')renderDeadlineRequests(related).catch(()=>{});
 if(typeof renderWorkNotices==='function')renderWorkNotices(related).catch(()=>{});
 if(me?.role==='owner'&&typeof renderUnownedWork==='function')renderUnownedWork(related).catch(()=>{});
 let loaded;try{loaded=await loadTeamTasks();}catch(error){
  if(current()){manual.innerHTML=`<p role="alert">Tasks could not load: ${esc(error.message)}</p><button type="button" id="teamTaskRetry">Retry</button>`;$('#teamTaskRetry').onclick=()=>run(teamTasksWorkspace);}
  await handoffs;return;
 }
 if(!current()||loaded===null)return;
 teamTasks=teamTaskOrder(loaded.rows);teamTaskMoves=loaded.moves;teamTaskEvents=loaded.history;teamTaskMore=new Map();
 const forMe=teamTasks.filter(row=>row.status==='open'&&row.assignee_user_id===actor.user_id),gave=teamTasks.filter(row=>row.status==='open'&&row.assigned_by===actor.user_id&&row.assignee_user_id!==actor.user_id),results=teamTasks.filter(row=>row.status!=='open'&&row.assigned_by===actor.user_id&&row.assignee_user_id!==actor.user_id&&Date.parse(row.closed_at)>Date.now()-7*86400000).sort((a,b)=>Date.parse(b.closed_at)-Date.parse(a.closed_at)),finished=teamTasks.filter(row=>row.status!=='open'&&(row.assignee_user_id===actor.user_id||row.assigned_by===actor.user_id)&&!results.includes(row));
 manual.innerHTML=`<section class="team-task-group"><h3>To do · ${forMe.length}</h3>${teamTaskCards(forMe)||'<p class="muted">Nothing given to you right now.</p>'}</section>${gave.length?`<section class="team-task-group"><h3>Tasks I gave others · ${gave.length}</h3>${teamTaskCards(gave)}</section>`:''}`;
 finishedBox.innerHTML=`${results.length?`<section class="team-task-group"><h2>Results of tasks I gave · last 7 days · ${results.length}</h2>${teamTaskCards(results)}</section>`:''}${finished.length?`<details class="team-task-group" data-task-finished><summary>Finished in the last 30 days · ${finished.length}</summary>${teamTaskCards(finished)}</details>`:''}`;
 markSeen(['tasks','results']);
 await handoffs;
}
function openTeamTaskComment(row){
 if(!row||row.status!=='open'||!(row.assignee_user_id===me?.user_id||row.assigned_by===me?.user_id||me?.role==='owner'))return;
 const actor=me,epoch=teamTaskEpoch,requestId=crypto.randomUUID();
 actionForm('Add progress',`<p><strong>${esc(row.title)}</strong></p><label><span>Progress comment</span><textarea name="note" required maxlength="1000" rows="4" placeholder="What has happened so far?"></textarea></label><p class="muted">Your comment is saved permanently with your name and date. The task stays open.</p>`,async values=>{
  if(me!==actor||epoch!==teamTaskEpoch)throw Error('Login or task view changed. Reopen the task.');
  const note=String(values.note||'').trim();if(!note||note.length>1000)throw Error('Write a progress comment (1 to 1000 characters).');
  const result=await client.rpc('append_team_task_progress',{p_id:requestId,p_task_id:row.id,p_note:note});
  if(me!==actor||epoch!==teamTaskEpoch)return;
  if(result.error)throw Error(result.error.message);
  await teamTasksWorkspace();if(me===actor)message('Progress added. The task stays open.');
 });
}
function teamTaskDefaultDue(){const d=new Date();if(d.getHours()>=16)d.setDate(d.getDate()+1);d.setHours(17,0,0,0);return d}
function teamTaskLocalInput(date){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function openTeamTaskEditor(row){
 const employees=[...employeeDirectory.values()].filter(e=>e.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 const assignee=row?.assignee_user_id||me.user_id,id=row?.id||crypto.randomUUID(),actor=me?.user_id;
 const fields=`<label><span>What needs doing?</span><input name="title" required minlength="2" maxlength="200" value="${esc(row?.title||'')}" placeholder="For example: send the service report to Aga Khan"></label>
 ${row&&me.role!=='owner'?'<p class="muted">To change the deadline, close this editor and use Ask for more time.</p>':''}
 <label><span>Who does it?</span><select name="assignee" required>${employees.map(e=>`<option value="${esc(e.user_id)}"${e.user_id===assignee?' selected':''}>${esc(employeeName(e.user_id))}${e.user_id===me.user_id?' (me)':''}</option>`).join('')}</select></label>
 <fieldset class="urgency-choice"><legend>How urgent?</legend>${teamTaskUrgency.map(([key,label])=>`<label class="urgency-${key}"><input type="radio" name="urgency" value="${key}" required${row?.urgency===key?' checked':''}> ${label}</label>`).join('')}</fieldset>
 <label><span>Due</span><input type="datetime-local" name="due" required ${row&&me.role!=='owner'?'readonly':''} value="${teamTaskLocalInput(row?new Date(row.due_at):teamTaskDefaultDue())}"></label>
 <label><span>Details · optional</span><textarea name="details" maxlength="4000">${esc(row?.details||'')}</textarea></label>`;
 actionForm(row?'Edit task':'New task',fields,async values=>{
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the task.');
  if(!values.urgency)throw Error('Choose how urgent it is.');
  const due=new Date(row&&me.role!=='owner'?row.due_at:values.due);if(!Number.isFinite(due.getTime()))throw Error('Choose the due date and time.');
  const result=await client.rpc('save_team_task',{p_id:id,p_expected_version:row?.version||0,p_title:values.title,p_details:values.details||'',p_urgency:values.urgency,p_due_at:row&&me.role!=='owner'?row.due_at:due.toISOString(),p_assignee:values.assignee});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  await teamTasksWorkspace();message(row?'Task updated.':`Task sent to ${employeeName(values.assignee)}.`);
 });
}
// A result must say something: at least 3 real words, not "xxx", "ok" or "done".
function teamTaskResultProblem(note){
 const words=String(note||'').toLowerCase().match(/[a-z\u00c0-\u024f0-9]{2,}/g)||[];
 const real=words.filter(w=>!/^(.)\1+$/.test(w)&&!['ok','okay','done','na','nil','none','yes','no','test','finished','complete','completed'].includes(w));
 return real.length<3?'Write what you did and what the result was, in a few words (for example: Called Nisha, wants 2 ultrasound quotes).':'';
}
function openTeamTaskClose(row,action){
 if(!row)return;
 // Done needs a short result so the person who gave the task can see what happened. Follow-up work (a quote, a
 // lead, a complaint) is opened on its own page; the note only records the outcome.
 const fields=action==='done'
  ?`<p><strong>${esc(row.title)}</strong></p><label><span>What did you do? What was the result?</span><textarea name="note" maxlength="1000" required minlength="5" rows="4" placeholder="For example: Called Nisha. Interested in 2 ultrasound machines. Made Pro forma for her."></textarea></label><p class="muted">If the client wants a quote, has a complaint or is a new opportunity, also open it under Pro formas, Complaints or Leads so someone follows it up.</p>`
  :`<p><strong>${esc(row.title)}</strong></p><label><span>Why is it cancelled?</span><textarea name="note" maxlength="1000" required minlength="3"></textarea></label>`;
 actionForm(action==='done'?'Complete assigned task':'Cancel task',fields,async values=>{
  if(action==='done'){const problem=teamTaskResultProblem(values.note);if(problem)throw Error(problem);}
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
