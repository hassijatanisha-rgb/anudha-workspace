'use strict';
// Handoffs: who is responsible for each Pro forma, delivery, service job, lead and pending order, and the
// resulting per-person task list. Writes go through hand_off_work / close_work_assignment only.
let workEpoch=0,workNoticeLoad=0,unownedWorkLoad=0;
let myHandoffPage=0,myHandoffActor=null,myHandoffRequest=0;
const workSuggestedTasks={
 proforma:['Send Pro forma to the customer','Follow up customer acceptance','Approve and record the tax invoice','Revise the Pro forma'],
 delivery:['Assign packing','Pack the order','Check packing and mark ready','Deliver and collect signed delivery note'],
 service:['Assign engineer','Install the machine','Complete the service report','Schedule the next maintenance'],
 lead:['Call the customer back','Prepare a quotation','Visit the customer'],
 pending:['Reconfirm with the customer now stock has arrived','Check supplier arrival date'],
 purchase:['Approve or reject the purchase','Place the order with the supplier (LPO)','Receive the goods and close'],
 tally_invoice:['Pack the order','Check packing and mark ready']
};
const workTypeLabels={proforma:'Pro forma',delivery:'Delivery',service:'Service / installation',lead:'Lead',pending:'Pending order',purchase:'Purchase',tally_invoice:'Invoiced — to pack'};
// Steps the owner gives a default person; the database hands records on to them automatically.
const workSteps=[['invoice','Customer invoice and TRA receipt','After the customer accepts a Pro forma'],['packing','Packing','After invoice approval, and while the delivery is packed'],['delivery','Delivery','When the order goes out for delivery'],['installation','Installation','New installation jobs, until an engineer is assigned'],['service','Service','New service jobs, until an engineer is assigned'],['purchase_approval','Purchase approval','New purchase requests']];
function workCanAssign(type){const area={proforma:'proformas',delivery:'deliveries',tally_invoice:'deliveries',service:'service',lead:'leads',purchase:'purchasing',pending:null};return !!me?.user_id&&me.active!==false&&Object.hasOwn(area,type)&&(!area[type]||me.role==='owner'||(me.access||[]).includes(area[type]));}
function workRecordClosed(type,record){return ({proforma:['rejected','cancelled'],delivery:['delivered','cancelled'],service:['completed','cancelled']}[type]||[]).includes(record?.status);}
function clearWorkAssignments(){workEpoch++;workNoticeLoad++;unownedWorkLoad++;myHandoffRequest++;myHandoffPage=0;myHandoffActor=null;workPendingHandoff=null;clearWorkspaceDisclosureMotion();}
// A card's record by id; lists can hold tens of thousands of leads or orders, so the indexed lookup is used.
function workRow(rows,id){return typeof rowById==='function'?rowById(rows,id):rows.find(row=>row.id===id)}
function workRecordCards(root=document){
 const select=selector=>[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
 const cards=[];
 select('[data-document-card]').forEach(card=>{const id=card.dataset.documentCard,proforma=typeof salesProforma==='function'?salesProforma(id):null,note=workRow(typeof salesDeliveryNotes!=='undefined'?salesDeliveryNotes:[],id);if(proforma||note){const type=proforma?'proforma':'delivery';cards.push({card,type,id,label:proforma?.document_number||note.delivery_number,closed:workRecordClosed(type,proforma||note)});}});
 select('[data-service-card]').forEach(card=>{const record=typeof serviceCase==='function'?serviceCase(card.dataset.serviceCard):null;if(record)cards.push({card,type:'service',id:record.id,label:record.case_number,closed:workRecordClosed('service',record)});});
 select('[data-lead-card]').forEach(card=>{const row=workRow(typeof leadRows!=='undefined'?leadRows:[],card.dataset.leadCard);if(row)cards.push({card,type:'lead',id:row.id,label:row.lead_number});});
 select('[data-pending-card]').forEach(card=>{const row=workRow(typeof pendingRows!=='undefined'?pendingRows:[],card.dataset.pendingCard);if(row)cards.push({card,type:'pending',id:row.id,label:row.request_number});});
 select('[data-purchase-card]').forEach(card=>{const row=workRow(typeof purchaseOrders!=='undefined'?purchaseOrders:[],card.dataset.purchaseCard);if(row)cards.push({card,type:'purchase',id:row.id,label:row.po_number});});
 return cards.filter(({card})=>!card.querySelector('[data-work-handoff]'));
}
function workSince(iso,now=Date.now()){
 const minutes=Math.max(0,Math.floor((now-Date.parse(iso))/60000));
 if(minutes<60)return `${minutes} min`;const hours=Math.floor(minutes/60);if(hours<48)return `${hours} h`;return `${Math.floor(hours/24)} days`;
}
function workOverdue(row,today=new Date().toISOString().slice(0,10)){return row.status==='open'&&!!row.due_on&&row.due_on<today;}
function workToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function workDuration(ms){const minutes=Math.max(0,Math.floor(ms/60000));if(minutes<60)return `${minutes} min`;const hours=Math.floor(minutes/60);if(hours<48)return `${hours} h`;const days=Math.floor(hours/24),rest=hours%24;return rest?`${days} days ${rest} h`:`${days} days`;}
// Colour of a waiting step: a reported delay with a future expected date is on track; otherwise over a day is
// yellow and over two days, a passed due date or a passed expected date is red.
function workAgeLevel(open,delay,now=Date.now(),today=workToday()){
 if(!open)return '';
 if(delay?.expected_on)return delay.expected_on<today?'red':'';
 if(open.due_on)return open.due_on<today?'red':'';
 const hours=(now-Date.parse(open.created_at))/3600000;
 return hours>48?'red':hours>24?'yellow':'';
}
// Every person who held a record, in order, with how long each step took.
function workTimeline(rows,now=Date.now()){
 const steps=[...rows].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id))).map(r=>({id:r.id,person:r.assignee_user_id,task:r.task,status:r.status,from:r.created_at,to:r.closed_at||null,ms:Date.parse(r.closed_at||new Date(now).toISOString())-Date.parse(r.created_at),note:r.close_note||''}));
 const first=steps[0]?Date.parse(steps[0].from):null,openStep=steps.find(s=>s.status==='open'),last=steps.length?Math.max(...steps.map(s=>Date.parse(s.to||new Date(now).toISOString()))):null;
 return {steps,totalMs:first==null?0:(openStep?now:last)-first,finished:!openStep&&steps.length>0};
}
function workLatestDelays(delays){const out=new Map();for(const d of [...delays].sort((a,b)=>String(b.recorded_at).localeCompare(String(a.recorded_at))||String(b.id).localeCompare(String(a.id))))if(!out.has(d.assignment_id))out.set(d.assignment_id,d);return out;}
async function workPageRows(table,columns,filter,order='created_at'){
 const actor=me,epoch=workEpoch,rows=[];
 for(let offset=0;;offset+=1000){
  const result=await filter(client.from(table).select(columns)).order(order).order('id').range(offset,offset+999);
  if(me!==actor||workEpoch!==epoch)return [];
  if(result.error)throw Error(result.error.message);
  rows.push(...(result.data||[]));if((result.data||[]).length<1000)return rows;
 }
}
async function loadWorkDelays(assignmentIds){
 const out=[],actor=me,epoch=workEpoch;
 for(let i=0;i<assignmentIds.length;i+=100){
  out.push(...await workPageRows('work_delays','id,assignment_id,reason,expected_on,recorded_by,recorded_at',query=>query.in('assignment_id',assignmentIds.slice(i,i+100)),'recorded_at'));
  if(me!==actor||workEpoch!==epoch)return [];
 }
 return out;
}
function openWorkDelay(row,{origin=null,refresh=null}={}){
 if(!row)return;const actor=me,epoch=workEpoch;
 actionForm('Report a delay',`<p><strong>${esc(row.record_label)}</strong> · ${esc(row.task)} · with ${esc(employeeName(row.assignee_user_id))} for ${esc(workSince(row.created_at))}</p><label><span>Why is it delayed?</span><textarea name="reason" required minlength="3" maxlength="500" placeholder="For example: waiting for stock from Keko godown"></textarea></label><label><span>New expected date</span><input name="expected" type="date" required min="${workToday()}"></label>`,async values=>{
  if(me!==actor||epoch!==workEpoch)throw Error('Login changed. Reopen the delay form.');
  if(origin&&!origin.isConnected)throw Error('This handoff changed. Reopen the delay form.');
  const result=await client.rpc('record_work_delay',{p_id:crypto.randomUUID(),p_assignment_id:row.id,p_reason:String(values.reason||'').trim(),p_expected_on:values.expected});
  if(me!==actor||epoch!==workEpoch)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  await workSaved(actor,epoch,origin,`${row.record_label}: delay recorded, expected ${values.expected}.`,refresh);
 });
}
function workResponsibleHtml(open,delay=null,timeline=null,type=''){
 if(!open)return `<span>${type==='service'?'Coordination handoff':'Handoff task'}: <strong class="chip chip--${statusTone(timeline?.finished?'neutral':'waiting')}">${timeline?.finished?'closed':'unassigned'}</strong>${timeline?.finished?` · took ${esc(workDuration(timeline.totalMs))} in total`:''}</span>`;
 const level=workAgeLevel(open,delay);
 return `<span class="${level?'work-age-'+level:''}">${type==='service'?'Current coordinator':'Current step owner'}: <strong>${esc(employeeName(open.assignee_user_id))}</strong> · ${esc(open.task)} · waiting <strong>${esc(workDuration(Date.now()-Date.parse(open.created_at)))}</strong>${timeline&&timeline.steps.length>1?` · ${esc(workDuration(timeline.totalMs))} since the start`:''}${delay?` · <strong>Staff task expected ${esc(delay.expected_on)}</strong>: ${esc(delay.reason)}`:''}${open.due_on?` · due <strong${workOverdue(open)?' class="overdue"':''}>${esc(open.due_on)}</strong>`:''} · sent by ${esc(employeeName(open.assigned_by))}</span>`;
}
function workTimelineHtml(timeline){
 if(!timeline||!timeline.steps.length)return '';
 return `<details class="work-timeline"><summary>Step times · ${timeline.steps.length} step${timeline.steps.length===1?'':'s'}</summary><ol>${timeline.steps.map(s=>`<li><strong>${esc(employeeName(s.person))}</strong> · ${esc(s.task)} · ${esc(workDuration(s.ms))}${s.status==='open'?' so far':''} <small>${esc(new Date(s.from).toLocaleString())}${s.to?' → '+esc(new Date(s.to).toLocaleString()):''}${s.status!=='open'?` · <span class="chip chip--${statusTone({done:'completed',handed_on:'in_progress',cancelled:'cancelled'}[s.status])}">${esc(s.status.replace('_',' '))}</span>`:''}</small></li>`).join('')}</ol></details>`;
}
async function loadWorkHistory(type,ids){
 const out=[],actor=me,epoch=workEpoch;
 for(let i=0;i<ids.length;i+=100){
  out.push(...await workPageRows('work_assignments','id,record_id,task,assignee_user_id,status,created_at,closed_at,close_note',query=>query.eq('record_type',type).in('record_id',ids.slice(i,i+100))));
  if(me!==actor||workEpoch!==epoch)return [];
 }
 return out;
}
async function loadOpenWork(type,ids){
 const out=new Map(),actor=me,epoch=workEpoch;
 for(let i=0;i<ids.length;i+=100){
  const rows=await workPageRows('work_assignments','id,record_type,record_id,record_label,task,note,assignee_user_id,assigned_by,due_on,status,version,created_at',query=>query.eq('record_type',type).eq('status','open').in('record_id',ids.slice(i,i+100)));
  if(me!==actor||workEpoch!==epoch)return new Map();
  for(const row of rows)out.set(row.record_id,row);
 }
 return out;
}
// Open step, step history and delays for these records in one request per 100 records (all sent together).
// Before, open work, history and delays were three requests one after another.
async function loadRecordWork(type,ids){
 const actor=me,epoch=workEpoch,chunks=[];for(let i=0;i<ids.length;i+=100)chunks.push(ids.slice(i,i+100));
 const parts=await Promise.all(chunks.map(chunk=>workPageRows('work_assignments','id,record_type,record_id,record_label,task,note,assignee_user_id,assigned_by,due_on,status,version,created_at,closed_at,close_note,work_delays(id,assignment_id,reason,expected_on,recorded_by,recorded_at)',query=>query.eq('record_type',type).in('record_id',chunk))));
 const open=new Map(),history=[],delays=[];
 if(me!==actor||workEpoch!==epoch)return {open,history,delays};
 for(const rows of parts)for(const {work_delays:own,...row} of rows){history.push(row);if(row.status==='open'){open.set(row.record_id,row);delays.push(...(own||[]));}}
 return {open,history,delays};
}
// Adds the responsible person and handoff buttons to whichever record cards are on screen.
async function decorateWorkHandoffs(root=document,saved=''){
 if(root!==document&&!root.isConnected)return;
 const cards=workRecordCards(root);if(!cards.length||!me?.user_id)return;
 const epoch=root===document?++workEpoch:workEpoch,actor=me,byType=new Map();
 for(const item of cards){if(!byType.has(item.type))byType.set(item.type,[]);byType.get(item.type).push(item);}
 for(const item of cards){const box=document.createElement('div');box.className='work-handoff';box.dataset.workHandoff=item.id;item.box=box;box.innerHTML=workSavedHtml(saved)+'<span role="status" aria-label="Loading responsible person"><span class="work-responsible-skeleton" aria-hidden="true"></span></span>';(item.card.querySelector('.actions')||item.card).before(box);}
 const loads=[...byType].map(([type,items])=>loadRecordWork(type,items.map(item=>item.id)).then(work=>({work}),error=>({error})));
 for(const [index,[type,items]] of [...byType].entries()){
  let open,history=new Map(),delays=new Map();
  try{
   const loaded=await loads[index];if(loaded.error)throw loaded.error;
   open=loaded.work.open;for(const row of loaded.work.history){if(!history.has(row.record_id))history.set(row.record_id,[]);history.get(row.record_id).push(row);}
   delays=workLatestDelays(loaded.work.delays);
  }
  catch(error){if(epoch!==workEpoch||me!==actor||(root!==document&&!root.isConnected))return;items.forEach(item=>{const box=item.box;if(box?.isConnected){box.innerHTML=`${workSavedHtml(saved)}<span role="alert">Responsible person could not load: ${esc(error.message)}</span> <button type="button" data-work-retry>Retry handoff</button>`;box.querySelector('[data-work-retry]')?.addEventListener('click',()=>{if(epoch===workEpoch&&me===actor&&box.isConnected)run(()=>saved?workSaved(actor,epoch,box,saved,()=>refreshWorkHandoff(workHandoffCard(box,item),saved)):refreshWorkHandoff(workHandoffCard(box,item)));});}});continue;}
  if(epoch!==workEpoch||me!==actor||(root!==document&&!root.isConnected))return;
  for(const item of items){
   const box=item.box;if(!box?.isConnected)continue;
   const current=open.get(item.id)||null,canAssign=workCanAssign(type)&&!item.closed,canClose=workCanAssign(type)&&current&&(current.assignee_user_id===actor.user_id||me.role==='owner'),canDelay=current&&(current.assignee_user_id===actor.user_id||current.assigned_by===actor.user_id||me.role==='owner');
   const delay=current?delays.get(current.id):null,timeline=workTimeline(history.get(item.id)||[]),level=workAgeLevel(current,delay);
   box.classList.toggle('quality-yellow',level==='yellow');box.classList.toggle('quality-red',level==='red');
   box.innerHTML=`${workSavedHtml(saved)}${workResponsibleHtml(current,delay,timeline,type)}${canAssign?` <button type="button" data-work-assign="${esc(item.id)}">${current?'Reassign handoff task':type==='service'?'Assign coordinator':'Assign step owner'}</button>${current?.assignee_user_id!==actor.user_id?` <button type="button" data-work-self="${esc(item.id)}">Assign this step to me</button>`:''}`:''}${canClose?` <button type="button" data-work-done="${esc(current.id)}">Close handoff task</button>`:''}${canDelay?` <button type="button" data-work-delay="${esc(current.id)}">Report delay</button>`:''}${workTimelineHtml(timeline)}`;
   const context={origin:box,refresh:saved=>refreshWorkHandoff(workHandoffCard(box,item),saved)},currentView=()=>epoch===workEpoch&&me===actor&&box.isConnected;
   box.querySelectorAll('.work-timeline').forEach(details=>bindWorkspaceDisclosure(details,details.querySelector('ol'),{current:currentView}));
   box.querySelector('[data-work-delay]')?.addEventListener('click',()=>{if(currentView())openWorkDelay({...current,record_label:item.label},context);});
   box.querySelector('[data-work-assign]')?.addEventListener('click',()=>{if(currentView())openWorkHandoff({...item,current,...context});});
   box.querySelector('[data-work-self]')?.addEventListener('click',()=>{if(currentView())openWorkHandoff({...item,current,self:true,...context});});
   box.querySelector('[data-work-done]')?.addEventListener('click',()=>{if(currentView())openWorkClose(current,'done',context);});
  }
 }
}
function workHandoffCard(box,item){return box.closest(item.type==='proforma'||item.type==='delivery'?'[data-document-card]':`[data-${item.type}-card]`)||item.card;}
function workSavedHtml(saved){return saved?`<p role="status" data-work-saved>Saved. ${esc(saved)}</p>`:'';}
// Reload just this coordination panel; the business record, editor and other handoffs stay mounted.
async function refreshWorkHandoff(card,saved=''){
 if(!card?.isConnected)return;
 const previous=card.querySelector('[data-work-handoff]'),expanded=workspaceDisclosureOpen(previous?.querySelector('.work-timeline'));
 previous?.remove();const pending=decorateWorkHandoffs(card,saved),box=card.querySelector('[data-work-handoff]');await pending;
 if(box?.isConnected&&card.querySelector('[data-work-handoff]')===box){const timeline=box.querySelector('.work-timeline');if(timeline)timeline.open=expanded;}
}
async function workSaved(actor,epoch,origin,saved,refresh){
 if(me!==actor||epoch!==workEpoch||origin&&!origin.isConnected)return;
 message(saved);if(refresh)await refresh(saved);
 if(me===actor&&epoch===workEpoch&&typeof refreshNotificationBell==='function')await refreshNotificationBell(true).catch(()=>{});
}
async function refreshPersonalHandoffs(target,saved){
 const actor=me,epoch=workEpoch,shown=await renderMyHandoffs(target,myHandoffPage,null,saved);
 if(shown&&me===actor&&epoch===workEpoch&&typeof bellMarkSeen==='function')bellMarkSeen(actor.user_id,['work']);
}
function workEmployeeOptions(selected=''){const rows=[...employeeDirectory.values()];if(me?.user_id&&!rows.some(row=>row.user_id===me.user_id))rows.push(me);return rows.filter(row=>row.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id))).map(row=>`<option value="${esc(row.user_id)}" ${row.user_id===selected?'selected':''}>${esc(employeeName(row.user_id))}</option>`).join('');}
let workPendingHandoff=null;
function openWorkHandoff({type,id,label,current,self=false,origin=null,refresh=null}){
 if(!workCanAssign(type))return message('You do not have access to assign this step. Ask your department head.',true);
 const actor=me,epoch=workEpoch,listId=`workTasks-${type}`,task=self?(current?.task||workSuggestedTasks[type]?.[0]||'Review the current step'):'';
 const fields=`<p><strong>${esc(label)}</strong>${current?` · currently ${esc(employeeName(current.assignee_user_id))}: ${esc(current.task)}`:''}</p><label><span>Hand to</span><select name="assignee" required><option value="">Choose employee</option>${workEmployeeOptions(self||!current?actor.user_id:'')}</select></label><label><span>What should they do?</span><input name="task" required minlength="2" maxlength="300" list="${listId}" value="${esc(task)}" autocomplete="off"><datalist id="${listId}">${(workSuggestedTasks[type]||[]).map(task=>`<option value="${esc(task)}"></option>`).join('')}</datalist></label><label><span>Due date · optional</span><input name="due" type="date" min="${workToday()}"></label><label><span>Note · optional</span><textarea name="note" maxlength="2000"></textarea></label><p class="muted">This assigns responsibility for the current step and records the handoff history. The person you choose will see it on their To-do tasks.${type==='service'?' Assign the engineer and work date separately in the service job.':type==='delivery'?' Assign the packer and record packing progress separately in the delivery.':''} Your name is recorded as the sender.</p>`;
 actionForm(self?'Assign this step to me':current?'Hand to next person':'Assign responsible person',fields,async values=>{
  if(me!==actor||epoch!==workEpoch)throw Error('Login changed. Reopen the assignment form.');
  if(origin&&!origin.isConnected)throw Error('This handoff changed. Reopen the assignment form.');
  const key=`${type}:${id}:${values.assignee}:${values.task}:${current?.id||''}`;
  // Keep one request ID for the same handoff until confirmed, so a retry after a lost response cannot duplicate it.
  if(workPendingHandoff?.key!==key)workPendingHandoff={key,id:crypto.randomUUID()};
  const result=await client.rpc('hand_off_work',{p_id:workPendingHandoff.id,p_record_type:type,p_record_id:id,p_record_label:label,p_task:String(values.task||'').trim(),p_assignee_user_id:values.assignee,p_due_on:values.due||null,p_note:values.note||'',p_expected_open_id:current?.id||null});
  if(me!==actor||epoch!==workEpoch)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  workPendingHandoff=null;await workSaved(actor,epoch,origin,`${label} handed to ${employeeName(values.assignee)}.`,refresh);
 });
}
function openWorkClose(row,action,{origin=null,refresh=null}={}){
 if(!row)return;const actor=me,epoch=workEpoch;
 actionForm(action==='done'?'Close handoff task':'Cancel handoff',`<p><strong>${esc(row.record_label)}</strong> · ${esc(row.task)}</p><p>Assigned to ${esc(employeeName(row.assignee_user_id))}. This closes only the coordination task. It does not post an invoice, complete packing, confirm delivery or finish installation. Record that business event on the order or job.</p><label><span>${action==='done'?'Note · optional':'Why is it cancelled?'}</span><textarea name="note" maxlength="1000" ${action==='cancel'?'required minlength="3"':''}></textarea></label>`,async values=>{
  if(me!==actor||epoch!==workEpoch)throw Error('Login changed. Reopen the handoff form.');
  if(origin&&!origin.isConnected)throw Error('This handoff changed. Reopen the handoff form.');
  const result=await client.rpc('close_work_assignment',{p_id:row.id,p_expected_version:row.version,p_action:action,p_note:values.note||''});
  if(me!==actor||epoch!==workEpoch)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  await workSaved(actor,epoch,origin,action==='done'?`${row.record_label}: your step is marked done.`:`${row.record_label}: handoff cancelled.`,refresh);
 });
}
async function workOpenRecord(row){
 if(!row)return;
 const context=workspaceNavigationContext();if(!await confirmWorkspaceLeave(context.current)||!context.current())return;
 if(row.record_type==='proforma'||row.record_type==='delivery'){salesLoaded=false;view='sales';salesSection=row.record_type==='delivery'?'delivery':'proformas';salesEditing='';if(typeof salesFocusedProforma!=='undefined')salesFocusedProforma=row.record_type==='proforma'?row.record_id:'';if(typeof salesFocusedDelivery!=='undefined')salesFocusedDelivery=row.record_type==='delivery'?row.record_id:'';}
 else if(row.record_type==='contract'){view='contracts';contractFocus=row.record_id;contractPage=0;}
 else if(row.record_type==='service')return focusServiceCase(row.record_id);
 else if(row.record_type==='lead'){if(typeof focusLead==='function')focusLead(row.record_id);else view='leads';}
 else if(row.record_type==='pending'){view='pending';pendingFilter='all';pendingSearch=row.record_label;}
 else if(row.record_type==='purchase'){view='purchasing';if(typeof openPurchaseSection==='function')openPurchaseSection('orders');purchaseFilter='all';purchaseSearch=row.record_label;}
 else if(row.record_type==='tally_invoice'){view='tallyinvoices';tallyInvoiceFilter='all';tallyInvoiceSearch=String(row.record_label).split(' · ')[0];}
 return render();
}
// Work handed to the signed-in employee; this pane pages independently of their manual tasks.
async function renderMyHandoffs(target,page=myHandoffPage,trigger=null,saved=''){
 const epoch=workEpoch,request=++myHandoffRequest,actor=me;if(!actor?.user_id||!target)return false;
 if(myHandoffActor!==actor){myHandoffActor=actor;myHandoffPage=0;page=0;}
 let box=target.querySelector('.my-handoffs');
 if(!box){box=document.createElement('section');box.className='card my-handoffs';box.innerHTML='<h2>Work handed to me</h2><span role="status" aria-label="Loading handoffs"><span class="work-responsible-skeleton" aria-hidden="true"></span></span>';
 const heading=target.querySelector('.heading');if(heading)heading.after(box);else target.prepend(box);}
 const current=()=>epoch===workEpoch&&request===myHandoffRequest&&me===actor&&view==='personal'&&personalSection==='task'&&target.isConnected&&box.isConnected;
 if(saved)box.innerHTML=workSavedHtml(saved)+'<p role="status">Refreshing handoffs…</p>';
 box.setAttribute('aria-busy','true');box.querySelectorAll('[data-work-page]').forEach(button=>button.disabled=true);
 const now=Date.now(),today=workToday(),utcToday=new Date(now).toISOString().slice(0,10);
 try{
  const result=await client.rpc('my_handoff_page',{p_page:page,p_now:new Date(now).toISOString(),p_today:today,p_utc_today:utcToday});
  if(!current())return false;if(result.error)throw Error(result.error.message);
  const data=result.data;
  if(!data||!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages!==Math.max(1,Math.ceil(data.total/20))||data.page!==Math.min(page,data.pages-1)||data.rows.length!==Math.min(20,Math.max(0,data.total-data.page*20))||new Set(data.rows.map(row=>row.id)).size!==data.rows.length||data.rows.some(row=>!row.id||!row.record_id||typeof row.record_type!=='string'||typeof row.record_label!=='string'||typeof row.task!=='string'||row.assignee_user_id!==actor.user_id||row.status!=='open'||!Number.isSafeInteger(row.version)||row.version<1||!row.assigned_by||!Number.isFinite(Date.parse(row.created_at))||!Object.hasOwn(row,'due_on')||!Object.hasOwn(row,'expected_on')||!['','red','yellow'].includes(row.age_level)||typeof row.overdue!=='boolean'))throw Error('The server did not return a complete handoff page.');
  myHandoffPage=data.page;const rows=data.rows;
  box.innerHTML=`${workSavedHtml(saved)}<h2 tabindex="-1">Work handed to me · ${data.total}</h2>${rows.length?`<ol class="handoff-list" data-my-handoff-list>${rows.map(row=>`<li class="${row.age_level?'quality-'+row.age_level:row.overdue?'attention':''}"><strong>${esc(row.record_label)}</strong> · ${esc(row.task)}${row.due_on?` · due <strong${row.overdue?' class="overdue"':''}>${esc(row.due_on)}</strong>`:''}<br><small>From ${esc(employeeName(row.assigned_by))} · waiting <strong>${esc(workDuration(now-Date.parse(row.created_at)))}</strong>${row.expected_on?` · staff task expected ${esc(row.expected_on)}`:''}</small><div class="actions"><button type="button" data-work-open="${esc(row.id)}">Open record &amp; next action</button><button type="button" data-work-finish="${esc(row.id)}">Close handoff task</button><button type="button" data-work-delay-row="${esc(row.id)}">Report delay</button></div></li>`).join('')}</ol>`:'<p class="muted">Nothing is waiting for you.</p>'}<div class="actions" role="group" aria-label="Handoff pages"><button type="button" data-work-page="previous" ${data.page===0?'disabled':''}>Previous</button><span role="status">Page ${data.page+1} of ${data.pages}</span><button type="button" data-work-page="next" ${data.page>=data.pages-1?'disabled':''}>Next</button></div>`;
  box.querySelectorAll('[data-work-open]').forEach(button=>button.onclick=()=>{if(current())run(()=>workOpenRecord(rows.find(row=>row.id===button.dataset.workOpen)));});
  box.querySelectorAll('[data-work-finish]').forEach(button=>button.onclick=()=>{if(current())openWorkClose(rows.find(row=>row.id===button.dataset.workFinish),'done',{origin:button,refresh:saved=>refreshPersonalHandoffs(target,saved)});});
  box.querySelectorAll('[data-work-delay-row]').forEach(button=>button.onclick=()=>{if(current())openWorkDelay(rows.find(row=>row.id===button.dataset.workDelayRow),{origin:button,refresh:saved=>refreshPersonalHandoffs(target,saved)});});
  box.querySelectorAll('[data-work-page]').forEach(button=>button.onclick=()=>{if(current())run(()=>renderMyHandoffs(target,data.page+(button.dataset.workPage==='next'?1:-1),button));});
  if(trigger&&(document.activeElement===trigger||document.activeElement===document.body||!document.activeElement?.isConnected)){
   const same=box.querySelector(`[data-work-page="${trigger.dataset.workPage}"]`),next=same&&!same.disabled?same:box.querySelector('[data-work-page]:not(:disabled)')||box.querySelector('h2');next?.focus({preventScroll:true});
  }
  return true;
 }catch(error){
  if(!current())return false;
  box.innerHTML=`${workSavedHtml(saved)}<h2>Work handed to me</h2><p role="alert">Could not load: ${esc(error.message)}</p><button type="button" data-work-retry>Retry</button>`;
  box.querySelector('[data-work-retry]').onclick=()=>{if(current())run(()=>saved?workSaved(actor,epoch,box,saved,()=>refreshPersonalHandoffs(target,saved)):renderMyHandoffs(target,page));};return false;
 }finally{if(current())box.setAttribute('aria-busy','false');}
}

// Updates for the signed-in employee (for example: your Pro forma was invoiced and sent to packing).
async function renderWorkNotices(target){
 const load=++workNoticeLoad,actor=me,epoch=workEpoch;if(!actor?.user_id||!target)return;
 const current=()=>me===actor&&epoch===workEpoch&&target.isConnected;
 const result=await client.from('work_notices').select('id,record_type,record_id,record_label,message,created_at').eq('user_id',actor.user_id).is('read_at',null).order('created_at',{ascending:false}).limit(50);
 if(!current()||load!==workNoticeLoad||result.error)return;
 const previous=target.querySelector('.work-notices'),expanded=workspaceDisclosureOpen(previous);previous?.remove();
 if(!(result.data||[]).length)return;
 const box=document.createElement('details');box.className='card work-notices';
 let rows=result.data,mounted=false;const limited=rows.length===50,label=()=>`Updates · ${limited?'latest ':''}${rows.length}`;
 box.innerHTML=`<summary>${label()}</summary><div data-work-notice-items></div>`;
 const mount=()=>{
  if(!workspaceDisclosureOpen(box)||mounted||!current()||!box.isConnected)return;mounted=true;
  const panel=box.querySelector('[data-work-notice-items]');
  panel.innerHTML=`<ol class="handoff-list">${rows.map(n=>`<li><strong>${esc(n.record_label)}</strong> · ${esc(n.message)}<br><small>${esc(workSince(n.created_at))} ago</small> <button type="button" data-notice-open="${esc(n.id)}">Open</button> <button type="button" data-notice-dismiss="${esc(n.id)}">Got it</button></li>`).join('')}</ol>`;
  panel.querySelectorAll('[data-notice-open]').forEach(b=>b.onclick=()=>{if(!current()||!box.isConnected)return;const n=rows.find(x=>x.id===b.dataset.noticeOpen);run(()=>{if(current()&&box.isConnected)return workOpenRecord({record_type:n.record_type,record_id:n.record_id,record_label:n.record_label});});});
  panel.querySelectorAll('[data-notice-dismiss]').forEach(b=>b.onclick=()=>{if(!current()||!box.isConnected)return;run(async()=>{if(!current()||!box.isConnected)return;const r=await client.rpc('dismiss_work_notice',{p_id:b.dataset.noticeDismiss});if(!current()||!box.isConnected)return;if(r.error)throw Error(r.error.message);rows=rows.filter(n=>n.id!==b.dataset.noticeDismiss);b.closest('li').remove();box.querySelector('summary').textContent=label();if(!rows.length)box.remove();});});
 };
 box.ontoggle=mount;
 const heading=target.querySelector('.heading');if(heading)heading.after(box);else target.prepend(box);
 box.open=expanded;mount();bindWorkspaceDisclosure(box,box.querySelector('[data-work-notice-items]'),{current});
}
// Open orders and jobs that nobody is responsible for. Everyone sees them, so nothing waits unseen.
async function renderUnownedWork(target,saved='',defer=false){
 const load=++unownedWorkLoad,actor=me,epoch=workEpoch;if(!actor?.user_id||!target)return;
 const current=()=>me===actor&&epoch===workEpoch&&target.isConnected;
 const previous=target.querySelector('.unowned-work'),expanded=workspaceDisclosureOpen(previous);
 // My tasks checks this optional pane only when opened; assignment recovery still reads immediately.
 if(defer&&!expanded&&!saved){
  previous?.remove();const box=document.createElement('details');box.className='card unowned-work';
  box.innerHTML='<summary>Nobody responsible · open to check</summary><div data-unowned-items></div>';let opening=false;
  box.ontoggle=()=>{
   if(!workspaceDisclosureOpen(box)||opening||!current()||load!==unownedWorkLoad||!box.isConnected)return;opening=true;
   box.querySelector('summary').textContent='Nobody responsible';box.querySelector('[data-unowned-items]').innerHTML='<p role="status">Checking unassigned work…</p>';
   return renderUnownedWork(target);
  };
  const heading=target.querySelector('.heading');if(heading)heading.after(box);else target.prepend(box);bindWorkspaceDisclosure(box,box.querySelector('[data-unowned-items]'),{current});return;
 }
 if(saved&&previous){previous.querySelector('summary').textContent='Nobody responsible';previous.querySelector('[data-unowned-items]').innerHTML=`${workSavedHtml(saved)}<p role="status">Refreshing handoffs…</p>`;}
 let result;try{result=await client.rpc('unowned_work');}catch(error){result={error};}
 if(!current()||load!==unownedWorkLoad)return;
 const keepExpanded=previous?workspaceDisclosureOpen(previous):expanded;previous?.remove();
 const box=document.createElement('details');box.className='card unowned-work';
 if(result.error){box.innerHTML=`<summary>Nobody responsible · could not load</summary><div data-unowned-items>${workSavedHtml(saved)}<p role="alert">Could not load: ${esc(result.error.message)}</p><button type="button" data-unowned-retry>Retry handoffs</button></div>`;box.open=!expanded||keepExpanded;box.querySelector('[data-unowned-retry]')?.addEventListener('click',()=>{if(current()&&box.isConnected)run(()=>saved?workSaved(actor,epoch,box,saved,()=>renderUnownedWork(target,saved)):renderUnownedWork(target));});}
 else{
  const rows=result.data||[];if(!rows.length)return;
  box.classList.add('attention');
  box.innerHTML=`<summary>Nobody responsible · ${rows.length===500?'at least ':''}${rows.length}</summary>${workSavedHtml(saved)}<div data-unowned-items></div>`;
  let mounted=false;
  box.ontoggle=()=>{
   if(!workspaceDisclosureOpen(box)||mounted||!current()||!box.isConnected)return;mounted=true;
   const panel=box.querySelector('[data-unowned-items]');
   panel.innerHTML=`<p class="muted">These are waiting with no one assigned. Assign someone, or set the default person for the step in Staff → Who does each step.</p>${rows.length>100?`<p class="muted">Showing the first 100 of ${rows.length} returned records.</p>`:''}<ol class="handoff-list">${rows.slice(0,100).map((r,i)=>`<li><strong>${esc(r.record_label)}</strong> · ${esc(workTypeLabels[r.record_type]||r.record_type)} · ${esc(String(r.status).replace(/_/g,' '))}${r.waiting_since?` · waiting ${esc(workSince(r.waiting_since))}`:''} <button type="button" data-unowned-open="${i}">Open</button> <button type="button" data-unowned-assign="${i}">Assign</button></li>`).join('')}</ol>`;
   panel.querySelectorAll('[data-unowned-open]').forEach(b=>b.onclick=()=>{if(current()&&box.isConnected)run(()=>{if(current()&&box.isConnected)return workOpenRecord(rows[Number(b.dataset.unownedOpen)]);});});
   panel.querySelectorAll('[data-unowned-assign]').forEach(b=>b.onclick=()=>{if(!current()||!box.isConnected)return;const r=rows[Number(b.dataset.unownedAssign)];openWorkHandoff({type:r.record_type,id:r.record_id,label:r.record_label,current:null,origin:b,refresh:async saved=>{const steps=typeof view!=='undefined'&&view==='personal'&&personalSection==='task'?document.querySelector('#orderSteps'):null;await Promise.all([renderUnownedWork(target,saved),steps?refreshPersonalHandoffs(steps,saved):Promise.resolve()]);}});});
  };
  box.open=keepExpanded;
 }
 const heading=target.querySelector('.heading');if(heading)heading.after(box);else target.prepend(box);
 box.ontoggle?.();
 const panel=box.querySelector('[data-unowned-items]');if(panel)bindWorkspaceDisclosure(box,panel,{current});
}
// Owner: choose the default person (and team) for each step.
function renderWorkStepOwners(target){
 if(me?.role!=='owner'||!target)return Promise.resolve();
 const actor=me,section=document.createElement('details');section.className='card work-step-settings';
 section.innerHTML='<summary>Default people for order steps</summary><div data-step-settings></div>';target.append(section);
 let loading=false,loaded=false;
 section.ontoggle=async()=>{
  if(!section.open||loading||loaded||me!==actor||!section.isConnected)return;
  const panel=section.querySelector('[data-step-settings]');loading=true;
  panel.innerHTML='<p role="status">Opening step assignments…</p>';
  try{await loadWorkStepOwners(panel);loaded=me===actor&&section.isConnected;}
  catch(error){if(me===actor&&section.isConnected)panel.innerHTML=`<p role="alert">${esc(error.message||'Step assignments could not load. Close and reopen to retry.')}</p>`;}
  finally{loading=false;}
 };
 return Promise.resolve();
}
async function loadWorkStepOwners(target){
 if(me?.role!=='owner'||!target)return;
 const actor=me,result=await client.from('workflow_step_owners').select('step,version,default_user_id,team').order('version',{ascending:false});
 if(me!==actor||!target.isConnected)return;
 if(result.error)throw result.error;
 const latest=new Map();for(const row of result.data||[])if(!latest.has(row.step))latest.set(row.step,row);
 const box=document.createElement('section');box.className='card work-step-owners';
 const employees=[...employeeDirectory.values()].filter(r=>r.active!==false).sort((a,b)=>employeeName(a.user_id).localeCompare(employeeName(b.user_id)));
 box.innerHTML=`<h2>Who does each step</h2><p class="muted">Optional. If nobody is chosen, whoever moves an order to a step is responsible for it until they hand it on with Hand to. Choose a person here only when one person always does that step. Purchase approvals go to the owner. Sales follow-up always goes to whoever created the Pro forma, lead or pending order.</p>${result.error?`<p role="alert">Could not load: ${esc(result.error.message)}</p>`:''}${employees.length<2?'<p class="notice">Add the employees first (Add employee above), then choose them here.</p>':''}<div class="table-wrap"><table><thead><tr><th>Step</th><th>Default person</th><th>Team</th><th></th></tr></thead><tbody>${workSteps.map(([step,label,when])=>{const row=latest.get(step);return `<tr data-step-row="${step}" data-version="${row?.version||0}"><td><strong>${esc(label)}</strong><small>${esc(when)}</small></td><td><select name="default" aria-label="Default person for ${esc(label)}"><option value="">Not set — shows as Nobody responsible</option>${employees.map(e=>`<option value="${esc(e.user_id)}" ${row?.default_user_id===e.user_id?'selected':''}>${esc(employeeName(e.user_id))}</option>`).join('')}</select></td><td><details><summary>${(row?.team||[]).length?esc((row.team||[]).map(employeeName).join(', ')):'Choose'}</summary>${employees.map(e=>`<label class="check"><input type="checkbox" name="team" value="${esc(e.user_id)}" ${(row?.team||[]).includes(e.user_id)?'checked':''}> ${esc(employeeName(e.user_id))}</label>`).join('')}</details></td><td><button type="button" data-step-save="${step}">Save</button></td></tr>`;}).join('')}</tbody></table></div>`;
 target.replaceChildren(box);
 box.querySelectorAll('[data-step-save]').forEach(button=>button.onclick=()=>run(async()=>{
  if(me!==actor||me?.role!=='owner'||!target.isConnected)throw Error('Reopen step assignments before saving.');
  const row=button.closest('[data-step-row]'),team=[...row.querySelectorAll('[name="team"]:checked')].map(i=>i.value);
  const r=await client.rpc('set_workflow_step_owner',{p_step:row.dataset.stepRow,p_expected_version:Number(row.dataset.version),p_default_user_id:row.querySelector('[name="default"]').value||null,p_team:team});
  if(r.error)throw Error(r.error.message);
  row.dataset.version=String(r.data?.version??Number(row.dataset.version)+1);message(`${workSteps.find(s=>s[0]===row.dataset.stepRow)[1]}: saved.`);
 }));
}
