'use strict';
// Handoffs: who is responsible for each Pro forma, delivery, service job, lead and pending order, and the
// resulting per-person task list. Writes go through hand_off_work / close_work_assignment only.
let workEpoch=0;
const workSuggestedTasks={
 proforma:['Send Pro forma to the customer','Follow up customer acceptance','Approve and record the tax invoice','Revise the Pro forma'],
 delivery:['Assign packing','Pack the order','Check packing and mark ready','Deliver and collect signed delivery note'],
 service:['Assign engineer','Install the machine','Complete the service report','Schedule the next maintenance'],
 lead:['Call the customer back','Prepare a quotation','Visit the customer'],
 pending:['Reconfirm with the customer now stock has arrived','Check supplier arrival date']
};
function clearWorkAssignments(){workEpoch++;}
function workRecordCards(){
 const cards=[];
 document.querySelectorAll('[data-document-card]').forEach(card=>{const id=card.dataset.documentCard,proforma=typeof salesProforma==='function'?salesProforma(id):null,note=(typeof salesDeliveryNotes!=='undefined'?salesDeliveryNotes:[]).find(row=>row.id===id);if(proforma||note)cards.push({card,type:proforma?'proforma':'delivery',id,label:proforma?.document_number||note.delivery_number});});
 document.querySelectorAll('[data-service-card]').forEach(card=>{const record=typeof serviceCase==='function'?serviceCase(card.dataset.serviceCard):null;if(record)cards.push({card,type:'service',id:record.id,label:record.case_number});});
 document.querySelectorAll('[data-lead-card]').forEach(card=>{const row=(typeof leadRows!=='undefined'?leadRows:[]).find(r=>r.id===card.dataset.leadCard);if(row)cards.push({card,type:'lead',id:row.id,label:row.lead_number});});
 document.querySelectorAll('[data-pending-card]').forEach(card=>{const row=(typeof pendingRows!=='undefined'?pendingRows:[]).find(r=>r.id===card.dataset.pendingCard);if(row)cards.push({card,type:'pending',id:row.id,label:row.request_number});});
 return cards.filter(({card})=>!card.querySelector('[data-work-handoff]'));
}
function workSince(iso,now=Date.now()){
 const minutes=Math.max(0,Math.floor((now-Date.parse(iso))/60000));
 if(minutes<60)return `${minutes} min`;const hours=Math.floor(minutes/60);if(hours<48)return `${hours} h`;return `${Math.floor(hours/24)} days`;
}
function workOverdue(row,today=new Date().toISOString().slice(0,10)){return row.status==='open'&&!!row.due_on&&row.due_on<today;}
function workResponsibleHtml(open){
 if(!open)return '<span>Responsible: <strong>nobody assigned</strong></span>';
 return `<span>Responsible: <strong>${esc(employeeName(open.assignee_user_id))}</strong> · ${esc(open.task)}${open.due_on?` · due <strong${workOverdue(open)?' class="overdue"':''}>${esc(open.due_on)}</strong>`:''} · sent by ${esc(employeeName(open.assigned_by))} ${esc(workSince(open.created_at))} ago</span>`;
}
async function loadOpenWork(type,ids){
 const out=new Map();
 for(let i=0;i<ids.length;i+=100){
  const result=await client.from('work_assignments').select('id,record_type,record_id,record_label,task,note,assignee_user_id,assigned_by,due_on,status,version,created_at').eq('record_type',type).eq('status','open').in('record_id',ids.slice(i,i+100));
  if(result.error)throw Error(result.error.message);
  for(const row of result.data||[])out.set(row.record_id,row);
 }
 return out;
}
// Adds the responsible person and handoff buttons to whichever record cards are on screen.
async function decorateWorkHandoffs(){
 const cards=workRecordCards();if(!cards.length||!me?.user_id)return;
 const epoch=++workEpoch,actor=me.user_id,byType=new Map();
 for(const item of cards){if(!byType.has(item.type))byType.set(item.type,[]);byType.get(item.type).push(item);}
 for(const item of cards){const box=document.createElement('div');box.className='work-handoff';box.dataset.workHandoff=item.id;box.innerHTML='<span>Responsible: loading…</span>';(item.card.querySelector('.actions')||item.card).before(box);}
 for(const [type,items] of byType){
  let open;
  try{open=await loadOpenWork(type,items.map(item=>item.id));}
  catch(error){if(epoch!==workEpoch||me?.user_id!==actor)return;items.forEach(item=>{const box=item.card.querySelector('[data-work-handoff]');if(box)box.innerHTML=`<span role="alert">Responsible person could not load: ${esc(error.message)}</span>`;});continue;}
  if(epoch!==workEpoch||me?.user_id!==actor)return;
  for(const item of items){
   const box=item.card.querySelector('[data-work-handoff]');if(!box?.isConnected)continue;
   const current=open.get(item.id)||null,canClose=current&&(current.assignee_user_id===actor||me.role==='owner');
   box.innerHTML=`${workResponsibleHtml(current)} <button type="button" data-work-assign>${current?'Hand to next person':'Assign responsible person'}</button>${canClose?' <button type="button" data-work-done>Mark my step done</button>':''}`;
   box.querySelector('[data-work-assign]').onclick=()=>openWorkHandoff({...item,current});
   box.querySelector('[data-work-done]')?.addEventListener('click',()=>openWorkClose(current,'done'));
  }
 }
}
function workEmployeeOptions(selected=''){return [...employeeDirectory.values()].filter(row=>row.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id))).map(row=>`<option value="${esc(row.user_id)}" ${row.user_id===selected?'selected':''}>${esc(employeeName(row.user_id))}</option>`).join('');}
let workPendingHandoff=null;
function openWorkHandoff({type,id,label,current}){
 const listId=`workTasks-${type}`;
 const fields=`<p><strong>${esc(label)}</strong>${current?` · currently ${esc(employeeName(current.assignee_user_id))}: ${esc(current.task)}`:''}</p><label><span>Hand to</span><select name="assignee" required><option value="">Choose employee</option>${workEmployeeOptions()}</select></label><label><span>What should they do?</span><input name="task" required minlength="2" maxlength="300" list="${listId}" autocomplete="off"><datalist id="${listId}">${(workSuggestedTasks[type]||[]).map(task=>`<option value="${esc(task)}"></option>`).join('')}</datalist></label><label><span>Due date · optional</span><input name="due" type="date" min="${new Date().toISOString().slice(0,10)}"></label><label><span>Note · optional</span><textarea name="note" maxlength="2000"></textarea></label><p class="muted">The person you choose will see this on their To-do tasks. Your name is recorded as the sender and cannot be changed.</p>`;
 actionForm(current?'Hand to next person':'Assign responsible person',fields,async values=>{
  const key=`${type}:${id}:${values.assignee}:${values.task}:${current?.id||''}`;
  // Keep one request ID for the same handoff until confirmed, so a retry after a lost response cannot duplicate it.
  if(workPendingHandoff?.key!==key)workPendingHandoff={key,id:crypto.randomUUID()};
  const actor=me?.user_id,result=await client.rpc('hand_off_work',{p_id:workPendingHandoff.id,p_record_type:type,p_record_id:id,p_record_label:label,p_task:String(values.task||'').trim(),p_assignee_user_id:values.assignee,p_due_on:values.due||null,p_note:values.note||'',p_expected_open_id:current?.id||null});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  workPendingHandoff=null;await render();message(`${label} handed to ${employeeName(values.assignee)}.`);
 });
}
function openWorkClose(row,action){
 if(!row)return;
 actionForm(action==='done'?'Mark my step done':'Cancel handoff',`<p><strong>${esc(row.record_label)}</strong> · ${esc(row.task)}</p><label><span>${action==='done'?'Note · optional':'Why is it cancelled?'}</span><textarea name="note" maxlength="1000" ${action==='cancel'?'required minlength="3"':''}></textarea></label>`,async values=>{
  const actor=me?.user_id,result=await client.rpc('close_work_assignment',{p_id:row.id,p_expected_version:row.version,p_action:action,p_note:values.note||''});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  await render();message(action==='done'?`${row.record_label}: your step is marked done.`:`${row.record_label}: handoff cancelled.`);
 });
}
function workOpenRecord(row){
 if(row.record_type==='proforma'||row.record_type==='delivery'){view='sales';salesSection=row.record_type==='delivery'?'delivery':'proformas';salesEditing='';if(row.record_type==='proforma'&&typeof salesFocusedProforma!=='undefined')salesFocusedProforma=row.record_id;}
 else if(row.record_type==='service'){view='service';serviceSection='installations';}
 else if(row.record_type==='lead'){if(typeof focusLead==='function')focusLead(row.record_id);else view='leads';}
 else if(row.record_type==='pending'){view='pending';pendingFilter='all';pendingSearch=row.record_label;}
 render();
}
// Work handed to the signed-in employee, shown at the top of To-do tasks. Overdue first, then by due date.
async function renderMyHandoffs(target){
 const epoch=++workEpoch,actor=me?.user_id;if(!actor||!target)return;
 const box=document.createElement('section');box.className='card my-handoffs';box.innerHTML='<h2>Work handed to me</h2><p role="status">Loading…</p>';
 const heading=target.querySelector('.heading');if(heading)heading.after(box);else target.prepend(box);
 const result=await client.from('work_assignments').select('id,record_type,record_id,record_label,task,note,assignee_user_id,assigned_by,due_on,status,version,created_at').eq('assignee_user_id',actor).eq('status','open').order('due_on',{ascending:true,nullsFirst:false}).order('created_at').limit(200);
 if(epoch!==workEpoch||me?.user_id!==actor||!box.isConnected)return;
 if(result.error){box.innerHTML=`<h2>Work handed to me</h2><p role="alert">Could not load: ${esc(result.error.message)}</p>`;return;}
 const rows=[...(result.data||[])].sort((a,b)=>Number(workOverdue(b))-Number(workOverdue(a))||String(a.due_on||'9999').localeCompare(String(b.due_on||'9999'))||String(a.created_at).localeCompare(String(b.created_at)));
 box.innerHTML=`<h2>Work handed to me · ${rows.length}</h2>${rows.length?`<ol class="handoff-list">${rows.map(row=>`<li class="${workOverdue(row)?'attention':''}"><strong>${esc(row.record_label)}</strong> · ${esc(row.task)}${row.due_on?` · due <strong${workOverdue(row)?' class="overdue"':''}>${esc(row.due_on)}</strong>`:''}<br><small>From ${esc(employeeName(row.assigned_by))}, ${esc(workSince(row.created_at))} ago${row.note?` · ${esc(row.note)}`:''}</small> <button type="button" data-work-open="${esc(row.id)}">Open</button> <button type="button" data-work-finish="${esc(row.id)}">Mark done</button></li>`).join('')}</ol>`:'<p class="muted">Nothing is waiting for you.</p>'}`;
 box.querySelectorAll('[data-work-open]').forEach(button=>button.onclick=()=>workOpenRecord(rows.find(row=>row.id===button.dataset.workOpen)));
 box.querySelectorAll('[data-work-finish]').forEach(button=>button.onclick=()=>openWorkClose(rows.find(row=>row.id===button.dataset.workFinish),'done'));
}
