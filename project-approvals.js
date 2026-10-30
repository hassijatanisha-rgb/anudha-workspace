'use strict';
const approvalAttempts=new Map();
let approvalLoad=0,approvalPage=0,approvalFocus='',approvalHistoryPage=0,approvalActor=null;
function clearProjectApprovals(){approvalLoad++;approvalPage=0;approvalFocus='';approvalHistoryPage=0;approvalActor=null;}
window.addEventListener('beforeunload',event=>{if(approvalAttempts.size){event.preventDefault();event.returnValue='';}});
function approvalReceiptMatches(answer,attempt,actor){
 return answer?.id===attempt.p_id&&answer.question_id===attempt.p_question_id&&answer.question_version===attempt.p_version&&answer.answer===attempt.p_answer&&answer.answered_by===actor;
}
async function projectApprovals(){
 const target=$('#content'),session=me,actor=me?.user_id||me?.id;if(approvalActor&&approvalActor!==session)clearProjectApprovals();approvalActor=session;const load=++approvalLoad,current=()=>me===session&&view==='approvals'&&load===approvalLoad;
 if(me?.role!=='owner'){target.innerHTML=workspacePageHeader({title:'Questions for the owner'})+'<section class="card"><p>Owner access is required to answer project decisions.</p></section>';return;}
 workspaceLoading('Loading project decisions…');
 let questions,answers;
 try{[questions,answers]=await Promise.all([
  approvalFocus?client.from('project_approval_questions').select('*').eq('id',approvalFocus):client.from('project_approval_questions').select('id,title,version',{count:'exact'}).order('created_at').order('id').range(approvalPage*20,approvalPage*20+19),
  approvalFocus?client.from('project_approval_answers').select('*',{count:'exact'}).eq('question_id',approvalFocus).order('created_at',{ascending:false}).order('id',{ascending:false}).range(approvalHistoryPage*25,approvalHistoryPage*25+24):{data:[],count:0}
 ]);}catch(error){questions={error};answers={error};}
 if(!current())return;
 if(questions.error||answers.error){target.innerHTML=workspacePageHeader({title:'Questions for the owner',actions:'<button id="retryApprovals">Retry</button>'})+'<section class="card"><p role="alert">Decisions could not be loaded. Database setup or owner access may be required. No answers have been saved by this page.</p></section>';const retry=$('#retryApprovals');retry.onclick=()=>{if(current())return run(projectApprovals,{origin:retry,errorTarget:target.querySelector('[role="alert"]'),busyLabel:'Reloading decisions…'})};return;}
 if(!approvalFocus){
  if(!Number.isSafeInteger(questions.count)||questions.count<0||!Array.isArray(questions.data))throw Error('Question count could not load. Reopen this page.');
  const pages=Math.max(1,Math.ceil(questions.count/20));
  target.innerHTML=`<section>${workspacePageHeader({title:'Questions for the owner',subtitle:questions.count+' company decisions'})}${questions.data.map(q=>`<article class="card"><h2>${esc(q.title)}</h2><p><span class="tag chip chip--${statusTone(q.version>1?'success':'waiting')}">${q.version>1?'Answer recorded':'Awaiting an answer'}</span></p><button type="button" data-approval-open="${esc(q.id)}">Open question</button></article>`).join('')||'<p>No questions on this page.</p>'}<div class="actions"><button type="button" id="approvalPrevious" ${approvalPage===0?'disabled':''}>Previous</button><span>Page ${approvalPage+1} of ${pages}</span><button type="button" id="approvalNext" ${approvalPage+1>=pages?'disabled':''}>Next</button></div></section>`;
  target.querySelectorAll('[data-approval-open]').forEach(button=>button.onclick=()=>run(()=>{if(!current())return;approvalFocus=button.dataset.approvalOpen;approvalHistoryPage=0;return projectApprovals();}));
  for(const [id,step] of [['approvalPrevious',-1],['approvalNext',1]])$('#'+id).onclick=()=>run(()=>{if(!current())return;approvalPage+=step;return projectApprovals();});
  return;
 }
 target.innerHTML=`<section>${workspacePageHeader({title:'Questions for the owner',back:'<button type="button" id="approvalBack">← All questions</button>'})}${questions.data.map(q=>{const history=answers.data.filter(a=>a.question_id===q.id);return `<article class="card"><h2>${esc(q.title)}</h2><span class="tag chip chip--${statusTone(history.length?'success':'waiting')}">${history.length?'Answered · recorded':'Awaiting your answer'}</span><p>${esc(q.question)}</p><form data-approval="${esc(q.id)}"><label>Your decision<textarea name="answer" required maxlength="4000" rows="4"></textarea></label><button type="submit">Record answer</button><p role="status" class="approvalStatus"></p></form><details><summary>Answer history (${answers.count??history.length})</summary>${history.map(a=>`<p>${esc(a.answer)}</p><small>${esc(a.created_at)} · ${esc(a.answered_by)}</small>`).join('')}</details></article>`;}).join('')||'<p>This question is no longer available.</p>'}<div class="actions"><button type="button" id="approvalHistoryPrevious" ${approvalHistoryPage===0?'disabled':''}>Previous answers</button><span>Answers ${answers.data.length?approvalHistoryPage*25+1:0}–${approvalHistoryPage*25+answers.data.length} of ${answers.count??answers.data.length}</span><button type="button" id="approvalHistoryNext" ${(approvalHistoryPage+1)*25>=(answers.count??answers.data.length)?'disabled':''}>Next answers</button></div></section>`;
 $('#approvalBack').onclick=()=>run(()=>{if(!current())return;approvalFocus='';return projectApprovals();});
 for(const [id,step] of [['approvalHistoryPrevious',-1],['approvalHistoryNext',1]])$('#'+id).onclick=()=>run(()=>{if(!current())return;approvalHistoryPage+=step;return projectApprovals();});
 target.querySelectorAll('[data-approval]').forEach(form=>{
  let saving=false;const q=questions.data.find(q=>q.id===form.dataset.approval),key=actor+':'+q.id;
  if(q.version>1)Object.assign(form.parentElement.querySelector('.tag'),{className:'tag chip chip--'+statusTone('success'),textContent:'Answered · recorded'});
  let attempt=approvalAttempts.get(key)||null;
  if(attempt){form.elements.answer.value=attempt.p_answer;form.elements.answer.readOnly=true;form.querySelector('button').textContent='Retry same answer';}
  form.onsubmit=async event=>{event.preventDefault();if(saving)return;
   const status=form.querySelector('.approvalStatus'),button=form.querySelector('button'),input=form.elements.answer;
   if(!current()||me?.role!=='owner'){status.textContent='Your page or session changed. Reopen Questions for the owner before answering.';button.disabled=true;return;}
   if(busy){actionFeedbackRefuse(button,status);return;}
   if(!attempt)attempt={p_id:crypto.randomUUID(),p_question_id:q.id,p_version:q.version,p_answer:input.value.trim()};
   if(!attempt.p_answer){attempt=null;status.textContent='Enter your decision.';return;}
   actionFeedbackShow(actionFeedbackReference(button),'');
   approvalAttempts.set(key,attempt);saving=true;button.disabled=true;input.readOnly=true;status.textContent='Saving…';
   return run(async()=>{
   try{const result=await client.rpc('record_project_approval',attempt);if(!current())return;if(result.error)throw result.error;const answer=Array.isArray(result.data)?result.data[0]:result.data;if(!approvalReceiptMatches(answer,attempt,actor))throw Error('Unconfirmed receipt');approvalAttempts.delete(key);status.textContent='Answer recorded.';button.textContent='Recorded';const history=form.parentElement.querySelector('details');history.insertAdjacentHTML('beforeend',`<p>${esc(answer.answer)}</p><small>${esc(answer.created_at)} · ${esc(answer.answered_by)}</small>`);history.open=true;history.querySelector('summary').textContent='Answer history · latest answer saved';Object.assign(form.parentElement.querySelector('.tag'),{className:'tag chip chip--'+statusTone('success'),textContent:'Answered · recorded'});form.onsubmit=e=>e.preventDefault();message('Answer recorded.');}
   catch(error){if(!current())return;button.disabled=false;if(error.code==='P0001'){approvalAttempts.delete(key);attempt=null;status.textContent='Not saved: '+error.message;button.type='button';button.textContent='Reload current decision';button.onclick=()=>{if(current())return run(projectApprovals,{origin:button,errorTarget:status,busyLabel:'Reloading decision…'})};}else{status.textContent='Not confirmed: '+(error.message||'Connection unavailable')+'. Retry uses the same request. Keep this tab open until confirmed.';button.textContent='Retry same answer';}}
   finally{saving=false;}
   },{origin:button,errorTarget:status,busyLabel:'Saving answer…'});
  };
 });
}
