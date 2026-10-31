'use strict';
// Asking for a new deadline (migration 083). The person doing a task asks; their department head, or the owner,
// decides. The database checks who may ask and decide; this file shows the requests and offers those actions.
let deadlineRequests=[],deadlineEpoch=0,deadlinePage=0,deadlinePageData=null,deadlineScopeActor=null,deadlineTaskIds=new Set(),deadlineSaveErrors=new Map(),deadlineSaveSequence=0;
function clearDeadlineRequests(){deadlineSaveSequence++;deadlineSaveErrors.clear();deadlineEpoch++;deadlineRequests=[];deadlinePage=0;deadlinePageData=null;deadlineScopeActor=null;deadlineTaskIds.clear();}
function deadlineTaskIdentity(request){return `${request.task_number||request.task_id} · ${request.task_title||'Title unavailable; refresh before deciding.'}`;}

// Pending requests split for one person: what they asked for, and what waits for their decision.
function deadlineRequestGroups(rows,userId){
 const pending=(rows||[]).filter(row=>row.status==='pending');
 return {mine:new Map(pending.filter(row=>row.requested_by===userId).map(row=>[row.task_id,row])),toDecide:pending.filter(row=>row.requested_by!==userId)};
}
function deadlineRequestCardNote(request){
 return `<p class="notice deadline-request-note" data-deadline-request-note="${esc(request.task_id)}" data-deadline-request-id="${esc(request.id)}">New deadline asked: <strong>${esc(teamTaskTime(request.requested_due_at))}</strong> · waiting for your department head. Reason: ${esc(request.reason)}</p>`;
}
function deadlineRequestHtml(request){
 const recovery=deadlineSaveErrors.get(request.id);
 return `<article class="card deadline-request" data-deadline-request="${esc(request.id)}"><h3>${esc(employeeName(request.requested_by))} asks for more time</h3><p><strong>${esc(deadlineTaskIdentity(request))}</strong></p><p>Due ${esc(teamTaskTime(request.old_due_at))} → asked <strong>${esc(teamTaskTime(request.requested_due_at))}</strong></p><p>Reason: ${esc(request.reason)}</p><div class="actions"><button type="button" data-deadline-decide="approved" data-id="${esc(request.id)}" ${request.task_title&&!recovery?'':'disabled'}>Approve new deadline</button><button type="button" class="danger" data-deadline-decide="rejected" data-id="${esc(request.id)}" ${request.task_title&&!recovery?'':'disabled'}>Reject</button></div>${recovery?`<p role="alert">${esc(recovery.text)}</p><button type="button" data-deadline-saved-retry="${esc(request.id)}">Retry saved request</button>`:''}</article>`;
}

async function loadDeadlineRequests(target=null){
 const actor=me,epoch=deadlineEpoch,ids=typeof teamTaskPageIds==='function'?teamTaskPageIds():[];
 const result=await client.rpc('deadline_request_page',{p_page:deadlinePage,p_task_ids:ids});
 if(me!==actor||deadlineEpoch!==epoch||target&&(!target.isConnected||view!=='personal'||personalSection!=='task'))return null;
 if(result.error)throw Error(result.error.message);
 const data=result.data;
 if(!data||!Array.isArray(data.rows)||data.rows.length>100||!Array.isArray(data.identities)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages<1||data.page>=data.pages)throw Error('The deadline-request page could not be confirmed.');
 const identities=new Map(data.identities.map(row=>[row.request_id,row]));
 deadlinePageData=data;deadlinePage=data.page;deadlineScopeActor=actor;deadlineTaskIds=new Set(ids);
 return data.rows.map(row=>{const identity=identities.get(row.id);return identity?{...row,task_number:identity.task_number,task_title:identity.task_title}:row;});
}
function decorateTaskDeadlineNotes(root=document){
 if(teamTaskActor!==me)return;
 const known=deadlineScopeActor===me,groups=deadlineRequestGroups(known?deadlineRequests:[],me?.user_id);
 const cards=root.matches?.('[data-team-task]')?[root]:[...root.querySelectorAll('[data-team-task]')];
 for(const card of cards){
  const id=card.dataset.teamTask,request=groups.mine.get(id),note=card.querySelector('[data-deadline-request-note]');
  if(request){
   card.querySelector('[data-team-task-ask]')?.remove();
   if(note){if(note.dataset.deadlineRequestId!==request.id)note.outerHTML=deadlineRequestCardNote(request);}
   else (card.querySelector('.actions')||card).insertAdjacentHTML('beforebegin',deadlineRequestCardNote(request));
  }else if(known&&note&&deadlineTaskIds.has(id)){
   note.remove();
   // Approval can change the version, due date and move limit. Reopen through the
   // existing scoped task read before exposing any stale versioned controls.
   if(!card.querySelector('[data-team-task-open]')){
    const text='Deadline request changed. Review this task before making another change.';
    teamTaskRecordErrors.set(id,{kind:'deadline',text});
    const warning=document.createElement('p');warning.className='notice error';warning.setAttribute('role','alert');warning.textContent=text;card.append(warning);
   }
  }
  if(teamTaskRecordErrors.get(id)?.kind==='deadline'){
   const active=document.activeElement;let restoreFocus=false;
   card.querySelectorAll('button').forEach(button=>{if(!button.hasAttribute('data-team-task-open')&&!button.hasAttribute('data-team-task-collapse')){if(button===active)restoreFocus=true;button.disabled=true;}});
   if(!card.querySelector('[data-team-task-open]'))(card.querySelector('.actions')||card).insertAdjacentHTML('beforeend',`<button type="button" data-team-task-open="${esc(id)}">Review updated task</button>`);
   if(restoreFocus)card.querySelector('[data-team-task-open]').focus({preventScroll:true});
  }
 }
}
// Keep the approvals count visible; mount its current page only when opened.
async function renderDeadlineRequests(target){
 const actor=me,epoch=++deadlineEpoch,current=()=>me===actor&&deadlineEpoch===epoch&&view==='personal'&&personalSection==='task'&&target?.isConnected;
 const previous=document.querySelector('[data-deadline-requests]'),expanded=previous?.open||false;
 let rows;
 try{rows=await loadDeadlineRequests(target);}catch(error){
  if(!current())return;deadlinePageData=null;deadlineRequests=[];deadlineScopeActor=null;deadlineTaskIds.clear();previous?.remove();
  target.insertAdjacentHTML('beforebegin',`<section class="team-task-group" data-deadline-requests><h2>Deadline requests</h2><p role="alert">${esc(error.message)}</p><button type="button" data-deadline-retry>Retry deadline requests</button></section>`);
  document.querySelector('[data-deadline-retry]').onclick=()=>run(()=>renderDeadlineRequests(target));return;
 }
 if(rows===null||!current())return;
 deadlineRequests=rows;decorateTaskDeadlineNotes();previous?.remove();
 if(!deadlinePageData.total)return;
 target.insertAdjacentHTML('beforebegin',`<details class="team-task-group" data-deadline-requests ${expanded?'open':''}><summary>Deadline requests waiting for you · ${deadlinePageData.total}</summary><div data-deadline-page></div></details>`);
 const box=document.querySelector('[data-deadline-requests]');
 const show=()=>{
  if(!current()||!box.isConnected||!box.open)return;
  const data=deadlinePageData,groups=deadlineRequestGroups(deadlineRequests,actor.user_id),panel=box.querySelector('[data-deadline-page]');
  panel.innerHTML=groups.toDecide.map(deadlineRequestHtml).join('')+`<div class="actions"><button type="button" data-deadline-page-step="previous" ${data.page===0?'disabled':''}>Previous</button><span>Page ${data.page+1} of ${data.pages}</span><button type="button" data-deadline-page-step="next" ${data.page+1>=data.pages?'disabled':''}>Next</button></div>`;
  panel.querySelectorAll('[data-deadline-request]').forEach(card=>{const row=deadlineRequests.find(request=>request.id===card.dataset.deadlineRequest);if(row)card.deadlineMarkup=deadlineRequestHtml(row);});
  panel.querySelectorAll('[data-deadline-decide]').forEach(button=>button.onclick=()=>openDeadlineDecision(deadlineRequests.find(row=>row.id===button.dataset.id),button.dataset.deadlineDecide));
  panel.querySelectorAll('[data-deadline-saved-retry]').forEach(button=>button.onclick=()=>run(()=>deadlineSaveErrors.get(button.dataset.deadlineSavedRetry)?.retry()));
  panel.querySelectorAll('[data-deadline-page-step]').forEach(button=>button.onclick=()=>{deadlinePage+=button.dataset.deadlinePageStep==='next'?1:-1;run(()=>renderDeadlineRequests(target));});
 };
 box.ontoggle=show;show();
}

function deadlineSavedRequest(data,expected,read=false){
 const row=Array.isArray(data)?(data.length===1?data[0]:null):data;
 if(!row||row.id!==expected.id||typeof row.task_id!=='string'||!row.task_id||typeof row.requested_by!=='string'||!row.requested_by||!Number.isSafeInteger(row.task_version)||row.task_version<1||!Number.isFinite(Date.parse(row.old_due_at))||!Number.isFinite(Date.parse(row.requested_due_at))||Date.parse(row.requested_due_at)<=Date.parse(row.old_due_at)||!Number.isFinite(Date.parse(row.created_at))||typeof row.reason!=='string'||row.reason.trim().length<5||!Array.isArray(row.approval_task_ids)||new Set(row.approval_task_ids).size!==row.approval_task_ids.length||row.approval_task_ids.some(id=>typeof id!=='string'||!id)||!['pending','approved','rejected'].includes(row.status)||(row.status==='pending'?row.decided_by!==null||row.decided_at!==null||row.decision_note!==null:typeof row.decided_by!=='string'||!row.decided_by||!Number.isFinite(Date.parse(row.decided_at))||typeof row.decision_note!=='string'||row.decision_note.trim().length<2))throw Error('The saved deadline request could not be verified.');
 if(Object.entries(expected).some(([key,value])=>read&&key==='status'&&value==='pending'?false:key.endsWith('_at')?Date.parse(row[key])!==Date.parse(value):row[key]!==value))throw Error('The saved deadline request does not match the submitted change.');
 return row;
}
function reconcileSavedDeadlineRequests(target,rows){
 const data=deadlinePageData,decisions=deadlineRequestGroups(rows,me.user_id).toDecide;
 if(!data||data.pages!==Math.max(1,Math.ceil(data.total/20))||decisions.length!==Math.min(20,data.total-data.page*20)||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!row.id||!row.task_id||!row.requested_by||row.status!=='pending'||typeof row.reason!=='string'||!Number.isFinite(Date.parse(row.old_due_at))||!Number.isFinite(Date.parse(row.requested_due_at))))throw Error('The deadline-request register could not be confirmed.');
 const before=new Map(deadlineRequests.map(row=>[row.id,row]));deadlineRequests=rows;let box=document.querySelector('[data-deadline-requests]');
 if(!data.total){box?.remove();return;}
 if(!box?.querySelector('summary')){box?.remove();const template=document.createElement('template');template.innerHTML='<details class="team-task-group" data-deadline-requests><summary></summary><div data-deadline-page></div></details>';box=template.content.firstElementChild;target.parentElement.insertBefore(box,target);}
 box.querySelector('summary').textContent=`Deadline requests waiting for you · ${data.total}`;
 const actor=me,epoch=deadlineEpoch,show=()=>{
  if(me!==actor||deadlineEpoch!==epoch||!box.isConnected||!box.open)return;
  const panel=box.querySelector('[data-deadline-page]'),cards=new Map([...panel.querySelectorAll('[data-deadline-request]')].map(card=>[card.dataset.deadlineRequest,card])),keep=new Set();
  let pager=panel.querySelector('[data-deadline-page-step]')?.closest('.actions');if(!pager){const template=document.createElement('template');template.innerHTML='<div class="actions"><button type="button" data-deadline-page-step="previous">Previous</button><span></span><button type="button" data-deadline-page-step="next">Next</button></div>';pager=template.content.firstElementChild;panel.append(pager);}
  decisions.forEach((row,index)=>{const html=deadlineRequestHtml(row);let card=cards.get(row.id);if(!card||(card.deadlineMarkup||(before.has(row.id)?deadlineRequestHtml(before.get(row.id)):''))!==html){const template=document.createElement('template');template.innerHTML=html;const next=template.content.firstElementChild;card?.replaceWith(next);card=next;card.deadlineMarkup=html;card.querySelectorAll('[data-deadline-decide]').forEach(button=>button.onclick=()=>openDeadlineDecision(deadlineRequests.find(item=>item.id===button.dataset.id),button.dataset.deadlineDecide));card.querySelectorAll('[data-deadline-saved-retry]').forEach(button=>button.onclick=()=>run(()=>deadlineSaveErrors.get(button.dataset.deadlineSavedRetry)?.retry()));}keep.add(card);if(panel.children[index]!==card)panel.insertBefore(card,panel.children[index]||pager);});
  for(const card of cards.values())if(!keep.has(card)&&card.isConnected)card.remove();
  pager.querySelector('span').textContent=`Page ${data.page+1} of ${data.pages}`;pager.querySelector('[data-deadline-page-step="previous"]').disabled=data.page===0;pager.querySelector('[data-deadline-page-step="next"]').disabled=data.page+1>=data.pages;
  pager.querySelectorAll('[data-deadline-page-step]').forEach(button=>button.onclick=()=>{deadlinePage+=button.dataset.deadlinePageStep==='next'?1:-1;run(()=>renderDeadlineRequests(target));});
 };
 box.ontoggle=show;show();
}
async function refreshSavedDeadlineRequest(data,expected,text,actor,taskEpoch,target){
 let sequence=++deadlineSaveSequence,selectedId=teamTaskSelectedId,affected=new Set([expected.task_id]);const requiredVersions=new Map();
 const sessionCurrent=()=>me===actor&&teamTaskEpoch===taskEpoch&&view==='personal'&&personalSection==='task'&&target?.isConnected;
 const current=()=>sessionCurrent()&&sequence===deadlineSaveSequence;
 if(!current())return;
 let notice=document.querySelector('[data-deadline-save-notice]');if(!notice){notice=document.createElement('section');notice.className='notice';notice.dataset.deadlineSaveNotice='';notice.setAttribute('role','status');target.parentElement.insertBefore(notice,target);}
 const focused=document.activeElement,restoreFocus=focused===document.body||!!focused?.closest('dialog')||!!focused?.closest('[data-deadline-request]')||notice.contains(focused),left=window.scrollX,top=window.scrollY;
 const after=()=>{if(!current())return;window.scrollTo({left,top,behavior:'instant'});const focus=()=>{if(!current()||!restoreFocus)return;(notice.querySelector('button')||document.querySelector(`[data-team-task="${CSS.escape(selectedId)}"] [data-team-task-collapse]`)||document.querySelector('[data-deadline-requests] button:not(:disabled)')||document.querySelector('[data-deadline-requests] summary')||$('#teamTaskNew'))?.focus({preventScroll:true});};if(typeof actionDialog!=='undefined'&&actionDialog.open)actionDialog.addEventListener('close',focus,{once:true});else focus();};
 const paintTask=()=>reconcileSavedTeamTaskGroups(Object.fromEntries(teamTaskMore));
 const warnTask=warning=>{if(selectedId&&teamTasks.some(row=>row.id===selectedId)){teamTaskRecordErrors.set(selectedId,{kind:'deadline-save',text:warning,retry});paintTask();}};
 const failure=error=>{
  if(!current())return;const warning=`${text} ${error.message} Retry the saved request before making another change.`;deadlineSaveErrors.set(expected.id,{text:warning,retry});const summary=document.querySelector('[data-deadline-requests] summary');if(summary)summary.textContent=summary.textContent.replace(/ · (updating|refresh needed)$/,'')+' · refresh needed';notice.innerHTML=`<p>${esc(warning)}</p><button type="button" data-deadline-save-retry>Retry saved request</button>`;notice.querySelector('button').onclick=()=>run(retry);
  const card=document.querySelector(`[data-deadline-request="${CSS.escape(expected.id)}"]`);if(card){card.querySelectorAll('button').forEach(button=>button.disabled=true);let note=card.querySelector('[data-deadline-save-error]');if(!note){note=document.createElement('p');note.dataset.deadlineSaveError='';note.setAttribute('role','alert');card.append(note);}note.textContent=warning;}const box=document.querySelector('[data-deadline-requests]');if(box)box.ontoggle=()=>{if(current()&&box.open)run(retry);};warnTask(warning);after();
 };
 const apply=row=>{
  if(expected.status==='pending'&&row.status!=='pending')text=row.status==='approved'?'The saved deadline request is now approved.':'The saved deadline request is now rejected.';
  affected=new Set([row.task_id,...row.approval_task_ids]);selectedId=affected.has(teamTaskSelectedId)?teamTaskSelectedId:'';
  const selected=teamTasks.find(task=>task.id===selectedId);if(selected){const minimum=row.status==='approved'&&selectedId===row.task_id?row.task_version+1:selected.version+(row.status!=='pending'&&row.approval_task_ids.includes(selectedId)&&selected.status==='open'?1:0);if(!requiredVersions.has(selectedId)||row.status==='approved'&&selectedId===row.task_id)requiredVersions.set(selectedId,Math.max(requiredVersions.get(selectedId)||0,minimum));}
  teamTasks=teamTasks.filter(task=>!affected.has(task.id)||task.id===selectedId);
  for(const id of affected)teamTaskHistoryLoaded.delete(id);
  deadlineSaveErrors.delete(expected.id);deadlineRequests=deadlineRequests.filter(request=>request.id!==row.id);if(row.status==='pending')deadlineRequests.push(row);deadlineScopeActor=actor;
  const card=document.querySelector(`[data-deadline-request="${CSS.escape(row.id)}"]`);if(card){const template=document.createElement('template');template.innerHTML=`<article class="card deadline-request" data-deadline-request="${esc(row.id)}"><p role="status">${esc(text)}</p>${row.decision_note?`<p>${esc(row.decision_note)}</p>`:''}</article>`;card.replaceWith(template.content.firstElementChild);}
  const task=document.querySelector(`[data-team-task="${CSS.escape(row.task_id)}"]`);if(task&&row.status==='pending')decorateTaskDeadlineNotes(task);
  const summary=document.querySelector('[data-deadline-requests] summary');if(summary)summary.textContent=summary.textContent.replace(/ · (updating|refresh needed)$/,'')+' · updating';notice.textContent=text+' Refreshing tasks and deadline requests…';if(selectedId)warnTask(text+' Refreshing the current task…');
 };
 const reconcile=async()=>{
  const selected=selectedId&&teamTasks.find(task=>task.id===selectedId),selection=teamTaskDetailRequest,deadlineRead=++deadlineEpoch;
  const pagePromise=loadTeamTasks(),pageRead=teamTaskPageRequest,groups=await pagePromise;if(!current())return;
  if(!groups||deadlineRead!==deadlineEpoch)throw Error('Tasks or deadline requests could not refresh.');
  // Request notes for the newly reconciled page, including generated approval tasks.
  reconcileSavedTeamTaskGroups(groups);
  const readSelected=async()=>{if(!selected)return null;const id=selected.id,result=await client.from('team_tasks').select('*').eq('id',id).maybeSingle();if(!current())return null;if(result.error)throw Error(result.error.message);const saved=teamTaskSavedRow(result.data,{id,version:requiredVersions.get(id)},true),history=await loadTeamTaskHistory([id],actor,taskEpoch);if(!history)throw Error('Current task history could not refresh.');return {row:saved,history};};
  const previousDeadline={data:deadlinePageData,page:deadlinePage,actor:deadlineScopeActor,ids:deadlineTaskIds},results=await Promise.allSettled([loadDeadlineRequests(target),readSelected()]);if(!current())return;
  const rows=deadlineRead===deadlineEpoch&&results[0].status==='fulfilled'?results[0].value:null,detail=results[1].status==='fulfilled'?results[1].value:null;
  if(detail&&selection===teamTaskDetailRequest&&selectedId===teamTaskSelectedId){teamTasks=teamTasks.filter(task=>task.id!==selectedId);teamTasks.push(detail.row);teamTaskEvents.set(selectedId,detail.history.history.get(selectedId)||[]);teamTaskMoves.set(selectedId,detail.history.moves.get(selectedId)||[]);teamTaskHistoryLoaded.add(selectedId);teamTaskRecordErrors.delete(selectedId);}
  if(rows){try{reconcileSavedDeadlineRequests(target,rows);}catch(error){deadlinePageData=previousDeadline.data;deadlinePage=previousDeadline.page;deadlineScopeActor=previousDeadline.actor;deadlineTaskIds=previousDeadline.ids;throw error;}}
  if(!rows||pageRead!==teamTaskPageRequest||selected&&!detail)throw Error('Tasks or deadline requests could not refresh.');
  paintTask();decorateTaskDeadlineNotes();
  deadlineSaveErrors.delete(expected.id);notice.textContent=text;after();
 };
 async function retry(){if(!sessionCurrent())return;sequence=++deadlineSaveSequence;const button=notice.querySelector('button');if(button)button.disabled=true;try{const result=await client.from('team_task_reschedule_requests').select('*').eq('id',expected.id).maybeSingle();if(!current())return;if(result.error)throw Error(result.error.message);const row=deadlineSavedRequest(result.data,expected,true);apply(row);await reconcile();}catch(error){failure(error);}}
 try{const row=deadlineSavedRequest(data,expected);apply(row);await reconcile();}catch(error){failure(error);}
}

function openDeadlineRequest(row){
 if(!row)return;
 const requestId=crypto.randomUUID(),actor=me,epoch=deadlineEpoch,taskEpoch=teamTaskEpoch,target=$('#teamTaskRelated'),current=()=>me===actor&&deadlineEpoch===epoch&&teamTaskEpoch===taskEpoch&&view==='personal'&&personalSection==='task'&&target?.isConnected;let committed=false,posting=false;
 const left=teamTaskMoveLimit-(row.reschedule_count||0),due=new Date(Math.max(Date.parse(row.due_at),Date.now())+86400000);
 actionForm('Ask for more time',
  `<p><strong>${esc(row.title)}</strong><br>Now due ${esc(teamTaskDue(row))}</p><p class="muted">Your department head decides. This task can be moved ${left} more time${left===1?'':'s'}.</p>
  <label><span>New due date and time</span><input type="datetime-local" name="due" required value="${teamTaskLocalInput(due)}"></label>
  <label><span>Why does it need more time?</span><textarea name="reason" required minlength="5" maxlength="1000" placeholder="For example: Customer travelling until Thursday; LPO not received yet"></textarea></label>`,
  async values=>{
   if(committed||posting)return;
   if(!current())throw Error('Login changed. Reopen the task.');
   const next=new Date(values.due);if(!Number.isFinite(next.getTime()))throw Error('Choose the new due date and time.');
   if(next.getTime()<=Date.now())throw Error('Choose a new time later than now.');
   if((values.reason||'').trim().length<5)throw Error('Write why the task needs more time (at least 5 characters).');
   let result;posting=true;try{result=await client.rpc('request_team_task_reschedule',{p_id:requestId,p_task_id:row.id,p_expected_version:row.version,p_new_due:next.toISOString(),p_reason:values.reason.trim()});}catch(error){if(current())throw error;return;}finally{posting=false;}
   if(!current())return;if(result.error)throw Error(result.error.message);committed=true;
   await refreshSavedDeadlineRequest(result.data,{id:requestId,task_id:row.id,task_version:row.version,requested_by:actor.user_id,old_due_at:row.due_at,requested_due_at:next.toISOString(),reason:values.reason.trim(),status:'pending'},'Asked for a new deadline. Your department head will decide.',actor,taskEpoch,target);
  });
}
function openDeadlineDecision(request,decision){
 if(!request)return;
 if(!request.task_title){message('Task identity is unavailable. Refresh before deciding.',true);return;}
 if(deadlineSaveErrors.has(request.id))return;
 const actor=me,epoch=deadlineEpoch,taskEpoch=teamTaskEpoch,target=$('#teamTaskRelated'),current=()=>me===actor&&deadlineEpoch===epoch&&teamTaskEpoch===taskEpoch&&view==='personal'&&personalSection==='task'&&target?.isConnected;let committed=false,posting=false;
 actionForm(decision==='approved'?'Approve new deadline':'Reject new deadline',
  `<p><strong>${esc(deadlineTaskIdentity(request))}</strong></p><p>${esc(employeeName(request.requested_by))}: ${esc(teamTaskTime(request.old_due_at))} → ${esc(teamTaskTime(request.requested_due_at))}</p><label><span>Note for ${esc(employeeName(request.requested_by))}</span><textarea name="note" required minlength="2" maxlength="1000"></textarea></label>`,
  async values=>{
   if(committed||posting)return;
   if(!current())throw Error('Login changed. Reopen the deadline request.');
   let result;posting=true;try{result=await client.rpc('decide_team_task_reschedule',{p_request_id:request.id,p_decision:decision,p_note:values.note||''});}catch(error){if(current())throw error;return;}finally{posting=false;}
   if(!current())return;if(result.error)throw Error(result.error.message);committed=true;
   await refreshSavedDeadlineRequest(result.data,{id:request.id,task_id:request.task_id,requested_by:request.requested_by,status:decision,decided_by:actor.user_id,decision_note:(values.note||'').replace(/^ +| +$/g,'')},decision==='approved'?'New deadline approved.':'Request rejected; the deadline stays.',actor,taskEpoch,target);
  });
}
