'use strict';
// Asking for a new deadline (migration 083). The person doing a task asks; their department head, or the owner,
// decides. The database checks who may ask and decide; this file shows the requests and offers those actions.
let deadlineRequests=[],deadlineEpoch=0;
function clearDeadlineRequests(){deadlineEpoch++;deadlineRequests=[];}
function deadlineTaskIdentity(request){return `${request.task_number||request.task_id} · ${request.task_title||'Title unavailable; refresh before deciding.'}`;}

// Pending requests split for one person: what they asked for, and what waits for their decision.
function deadlineRequestGroups(rows,userId){
 const pending=(rows||[]).filter(row=>row.status==='pending');
 return {mine:new Map(pending.filter(row=>row.requested_by===userId).map(row=>[row.task_id,row])),toDecide:pending.filter(row=>row.requested_by!==userId)};
}
function deadlineRequestCardNote(request){
 return `<p class="notice deadline-request-note" data-deadline-request-note="${esc(request.task_id)}">New deadline asked: <strong>${esc(teamTaskTime(request.requested_due_at))}</strong> · waiting for your department head. Reason: ${esc(request.reason)}</p>`;
}
function deadlineRequestHtml(request){
 return `<article class="card deadline-request" data-deadline-request="${esc(request.id)}"><h3>${esc(employeeName(request.requested_by))} asks for more time</h3><p><strong>${esc(deadlineTaskIdentity(request))}</strong></p><p>Due ${esc(teamTaskTime(request.old_due_at))} → asked <strong>${esc(teamTaskTime(request.requested_due_at))}</strong></p><p>Reason: ${esc(request.reason)}</p><div class="actions"><button type="button" data-deadline-decide="approved" data-id="${esc(request.id)}" ${request.task_title?'':'disabled'}>Approve new deadline</button><button type="button" class="danger" data-deadline-decide="rejected" data-id="${esc(request.id)}" ${request.task_title?'':'disabled'}>Reject</button></div></article>`;
}

async function loadDeadlineRequests(){
 const actor=me,epoch=deadlineEpoch,rows=[],current=()=>me===actor&&deadlineEpoch===epoch;
 for(let offset=0;;offset+=1000){
  const result=await client.from('team_task_reschedule_requests').select('*').eq('status','pending').order('created_at').order('id').range(offset,offset+999);
  if(!current())return null;
  if(result.error)return null;
  rows.push(...(result.data||[]));if((result.data||[]).length<1000)break;
 }
 for(let offset=0;offset<rows.length;offset+=100){
  const batch=rows.slice(offset,offset+100),result=await client.rpc('deadline_request_task_identities',{p_request_ids:batch.map(row=>row.id)});
  if(!current())return null;
  if(result.error)continue;
  const identities=new Map((result.data||[]).map(row=>[row.request_id,row]));
  for(const row of batch){const identity=identities.get(row.id);if(identity){row.task_number=identity.task_number;row.task_title=identity.task_title;}}
 }
 return rows;
}
// Called by My tasks after it draws: marks tasks already waiting for a decision, and lists requests to decide.
async function renderDeadlineRequests(target){
 const actor=me,epoch=++deadlineEpoch,rows=await loadDeadlineRequests();
 if(rows===null||me!==actor||deadlineEpoch!==epoch||!target?.isConnected)return;
 deadlineRequests=rows;const groups=deadlineRequestGroups(rows,actor.user_id);
 for(const [taskId,request] of groups.mine){
  const card=document.querySelector(`[data-team-task="${CSS.escape(taskId)}"]`);if(!card||card.querySelector('[data-deadline-request-note]'))continue;
  card.querySelector('[data-team-task-ask]')?.remove();
  (card.querySelector('.actions')||card).insertAdjacentHTML('beforebegin',deadlineRequestCardNote(request));
 }
 document.querySelector('[data-deadline-requests]')?.remove();
 if(groups.toDecide.length)
  target.insertAdjacentHTML('beforebegin',`<section class="team-task-group" data-deadline-requests><h2>Deadline requests waiting for you · ${groups.toDecide.length}</h2>${groups.toDecide.map(deadlineRequestHtml).join('')}</section>`);
 document.querySelectorAll('[data-deadline-decide]').forEach(button=>button.onclick=()=>openDeadlineDecision(deadlineRequests.find(row=>row.id===button.dataset.id),button.dataset.deadlineDecide));
}

function openDeadlineRequest(row){
 if(!row)return;
 const requestId=crypto.randomUUID(),actor=me,epoch=deadlineEpoch,left=teamTaskMoveLimit-(row.reschedule_count||0),due=new Date(Math.max(Date.parse(row.due_at),Date.now())+86400000);
 actionForm('Ask for more time',
  `<p><strong>${esc(row.title)}</strong><br>Now due ${esc(teamTaskDue(row))}</p><p class="muted">Your department head decides. This task can be moved ${left} more time${left===1?'':'s'}.</p>
  <label><span>New due date and time</span><input type="datetime-local" name="due" required value="${teamTaskLocalInput(due)}"></label>
  <label><span>Why does it need more time?</span><textarea name="reason" required minlength="5" maxlength="1000" placeholder="For example: Customer travelling until Thursday; LPO not received yet"></textarea></label>`,
  async values=>{
   if(me!==actor||deadlineEpoch!==epoch)throw Error('Login changed. Reopen the task.');
   const next=new Date(values.due);if(!Number.isFinite(next.getTime()))throw Error('Choose the new due date and time.');
   if(next.getTime()<=Date.now())throw Error('Choose a new time later than now.');
   if((values.reason||'').trim().length<5)throw Error('Write why the task needs more time (at least 5 characters).');
   const result=await client.rpc('request_team_task_reschedule',{p_id:requestId,p_task_id:row.id,p_expected_version:row.version,p_new_due:next.toISOString(),p_reason:values.reason.trim()});
   if(me!==actor||deadlineEpoch!==epoch)return;
   if(result.error)throw Error(result.error.message);
   await teamTasksWorkspace();message('Asked for a new deadline. Your department head will decide.');
  });
}
function openDeadlineDecision(request,decision){
 if(!request)return;
 if(!request.task_title){message('Task identity is unavailable. Refresh before deciding.',true);return;}
 const actor=me,epoch=deadlineEpoch;
 actionForm(decision==='approved'?'Approve new deadline':'Reject new deadline',
  `<p><strong>${esc(deadlineTaskIdentity(request))}</strong></p><p>${esc(employeeName(request.requested_by))}: ${esc(teamTaskTime(request.old_due_at))} → ${esc(teamTaskTime(request.requested_due_at))}</p><label><span>Note for ${esc(employeeName(request.requested_by))}</span><textarea name="note" required minlength="2" maxlength="1000"></textarea></label>`,
  async values=>{
   if(me!==actor||deadlineEpoch!==epoch)throw Error('Login changed. Reopen the deadline request.');
   const result=await client.rpc('decide_team_task_reschedule',{p_request_id:request.id,p_decision:decision,p_note:values.note||''});
   if(me!==actor||deadlineEpoch!==epoch)return;
   if(result.error)throw Error(result.error.message);
   await teamTasksWorkspace();message(decision==='approved'?'New deadline approved.':'Request rejected; the deadline stays.');
  });
}
