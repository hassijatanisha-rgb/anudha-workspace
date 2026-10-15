'use strict';
// Asking for a new deadline (migration 083). The person doing a task asks; their department head, or the owner,
// decides. The database checks who may ask and decide; this file shows the requests and offers those actions.
let deadlineRequests=[];

// Pending requests split for one person: what they asked for, and what waits for their decision.
function deadlineRequestGroups(rows,userId){
 const pending=(rows||[]).filter(row=>row.status==='pending');
 return {mine:new Map(pending.filter(row=>row.requested_by===userId).map(row=>[row.task_id,row])),toDecide:pending.filter(row=>row.requested_by!==userId)};
}
function deadlineRequestCardNote(request){
 return `<p class="notice deadline-request-note" data-deadline-request-note="${esc(request.task_id)}">New deadline asked: <strong>${esc(teamTaskTime(request.requested_due_at))}</strong> · waiting for your department head. Reason: ${esc(request.reason)}</p>`;
}
function deadlineRequestHtml(request){
 return `<article class="card deadline-request" data-deadline-request="${esc(request.id)}"><h3>${esc(employeeName(request.requested_by))} asks for more time</h3><p>Due ${esc(teamTaskTime(request.old_due_at))} → asked <strong>${esc(teamTaskTime(request.requested_due_at))}</strong></p><p>Reason: ${esc(request.reason)}</p><div class="actions"><button type="button" data-deadline-decide="approved" data-id="${esc(request.id)}">Approve new deadline</button><button type="button" class="danger" data-deadline-decide="rejected" data-id="${esc(request.id)}">Reject</button></div></article>`;
}

async function loadDeadlineRequests(){
 const actor=me?.user_id;
 const result=await client.from('team_task_reschedule_requests').select('*').eq('status','pending').order('created_at').limit(200);
 if(me?.user_id!==actor)return null;
 if(result.error)return null; // before migration 083 the table does not exist: keep the old screen
 return result.data||[];
}
// Called by My tasks after it draws: marks tasks already waiting for a decision, and lists requests to decide.
async function renderDeadlineRequests(target){
 const actor=me?.user_id,rows=await loadDeadlineRequests();
 if(rows===null||me?.user_id!==actor||!target?.isConnected)return;
 deadlineRequests=rows;const groups=deadlineRequestGroups(rows,actor);
 for(const [taskId,request] of groups.mine){
  const card=document.querySelector(`[data-team-task="${CSS.escape(taskId)}"]`);if(!card||card.querySelector('[data-deadline-request-note]'))continue;
  card.querySelector('[data-team-task-ask]')?.remove();
  (card.querySelector('.actions')||card).insertAdjacentHTML('beforebegin',deadlineRequestCardNote(request));
 }
 if(groups.toDecide.length&&!document.querySelector('[data-deadline-requests]'))
  target.insertAdjacentHTML('beforebegin',`<section class="team-task-group" data-deadline-requests><h2>Deadline requests waiting for you · ${groups.toDecide.length}</h2>${groups.toDecide.map(deadlineRequestHtml).join('')}</section>`);
 document.querySelectorAll('[data-deadline-decide]').forEach(button=>button.onclick=()=>openDeadlineDecision(deadlineRequests.find(row=>row.id===button.dataset.id),button.dataset.deadlineDecide));
}

function openDeadlineRequest(row){
 if(!row)return;
 const requestId=crypto.randomUUID(),actor=me?.user_id,left=teamTaskMoveLimit-(row.reschedule_count||0),due=new Date(Math.max(Date.parse(row.due_at),Date.now())+86400000);
 actionForm('Ask for more time',
  `<p><strong>${esc(row.title)}</strong><br>Now due ${esc(teamTaskDue(row))}</p><p class="muted">Your department head decides. This task can be moved ${left} more time${left===1?'':'s'}.</p>
  <label><span>New due date and time</span><input type="datetime-local" name="due" required value="${teamTaskLocalInput(due)}"></label>
  <label><span>Why does it need more time?</span><textarea name="reason" required minlength="5" maxlength="1000" placeholder="For example: Customer travelling until Thursday; LPO not received yet"></textarea></label>`,
  async values=>{
   if(me?.user_id!==actor)throw Error('Login changed. Reopen the task.');
   const next=new Date(values.due);if(!Number.isFinite(next.getTime()))throw Error('Choose the new due date and time.');
   if(next.getTime()<=Date.now())throw Error('Choose a new time later than now.');
   if((values.reason||'').trim().length<5)throw Error('Write why the task needs more time (at least 5 characters).');
   const result=await client.rpc('request_team_task_reschedule',{p_id:requestId,p_task_id:row.id,p_expected_version:row.version,p_new_due:next.toISOString(),p_reason:values.reason.trim()});
   if(result.error)throw Error(result.error.message);
   await teamTasksWorkspace();message('Asked for a new deadline. Your department head will decide.');
  });
}
function openDeadlineDecision(request,decision){
 if(!request)return;
 actionForm(decision==='approved'?'Approve new deadline':'Reject new deadline',
  `<p>${esc(employeeName(request.requested_by))}: ${esc(teamTaskTime(request.old_due_at))} → ${esc(teamTaskTime(request.requested_due_at))}</p><label><span>Note for ${esc(employeeName(request.requested_by))}</span><textarea name="note" required minlength="2" maxlength="1000"></textarea></label>`,
  async values=>{
   const result=await client.rpc('decide_team_task_reschedule',{p_request_id:request.id,p_decision:decision,p_note:values.note||''});
   if(result.error)throw Error(result.error.message);
   await teamTasksWorkspace();message(decision==='approved'?'New deadline approved.':'Request rejected; the deadline stays.');
  });
}
