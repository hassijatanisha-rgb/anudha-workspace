'use strict';
const approvalAttempts=new Map();
let approvalLoad=0;
window.addEventListener('beforeunload',event=>{if(approvalAttempts.size){event.preventDefault();event.returnValue='';}});
function approvalReceiptMatches(answer,attempt,actor){
 return answer?.id===attempt.p_id&&answer.question_id===attempt.p_question_id&&answer.question_version===attempt.p_version&&answer.answer===attempt.p_answer&&answer.answered_by===actor;
}
async function projectApprovals(){
 const target=$('#content'),actor=me?.user_id||me?.id,load=++approvalLoad;
 if(me?.role!=='owner'){target.innerHTML='<section class="card"><h1>Awaiting approval</h1><p>Owner access is required to answer project decisions.</p></section>';return;}
 target.innerHTML='<p role="status">Loading project decisions…</p>';
 let questions,answers;
 try{[questions,answers]=await Promise.all([
  client.from('project_approval_questions').select('*').order('created_at').limit(100),
  client.from('project_approval_answers').select('*').order('created_at',{ascending:false}).limit(100)
 ]);}catch(error){questions={error};answers={error};}
 if(view!=='approvals'||(me?.user_id||me?.id)!==actor||load!==approvalLoad)return;
 if(questions.error||answers.error){target.innerHTML='<section class="card"><h1>Awaiting approval</h1><p role="alert">Decisions could not be loaded. Database setup or owner access may be required. No answers have been saved by this page.</p><button id="retryApprovals">Retry</button></section>';$('#retryApprovals').onclick=()=>projectApprovals();return;}
 target.innerHTML=`<section><h1>Awaiting approval</h1><p>Your answers guide development. They do not automatically change business rules, import data or authorize deployment.</p><p>Showing up to 100 questions and the latest 100 answers.</p>${questions.data.map(q=>{const history=answers.data.filter(a=>a.question_id===q.id);return `<article class="card"><h2>${esc(q.title)}</h2><span class="tag">${history.length?'Answered · recorded':'Awaiting your answer'}</span><p>${esc(q.question)}</p><form data-approval="${esc(q.id)}"><label>Your decision<textarea name="answer" required maxlength="4000" rows="4"></textarea></label><button type="submit">Record answer</button><p role="status" class="approvalStatus"></p></form><details><summary>Answer history (${history.length} loaded)</summary>${history.map(a=>`<p>${esc(a.answer)}</p><small>${esc(a.created_at)} · ${esc(a.answered_by)}</small>`).join('')}</details></article>`;}).join('')||'<p>No project questions awaiting review.</p>'}</section>`;
 target.querySelectorAll('[data-approval]').forEach(form=>{
  let saving=false;const q=questions.data.find(q=>q.id===form.dataset.approval),key=actor+':'+q.id;
  if(q.version>1)form.parentElement.querySelector('.tag').textContent='Answered · recorded';
  let attempt=approvalAttempts.get(key)||null;
  if(attempt){form.elements.answer.value=attempt.p_answer;form.elements.answer.readOnly=true;form.querySelector('button').textContent='Retry same answer';}
  form.onsubmit=async event=>{event.preventDefault();if(saving)return;
   const status=form.querySelector('.approvalStatus'),button=form.querySelector('button'),input=form.elements.answer;
   if(!attempt)attempt={p_id:crypto.randomUUID(),p_question_id:q.id,p_version:q.version,p_answer:input.value.trim()};
   if(!attempt.p_answer){attempt=null;status.textContent='Enter your decision.';return;}
   approvalAttempts.set(key,attempt);saving=true;button.disabled=true;input.readOnly=true;status.textContent='Saving…';
   try{const result=await client.rpc('record_project_approval',attempt);if(result.error)throw result.error;const answer=Array.isArray(result.data)?result.data[0]:result.data;if(!approvalReceiptMatches(answer,attempt,actor))throw Error('Unconfirmed receipt');approvalAttempts.delete(key);status.textContent='Answer recorded.';button.textContent='Recorded';const history=form.parentElement.querySelector('details');history.insertAdjacentHTML('beforeend',`<p>${esc(answer.answer)}</p><small>${esc(answer.created_at)} · ${esc(answer.answered_by)}</small>`);history.open=true;history.querySelector('summary').textContent='Answer history · latest answer saved';form.parentElement.querySelector('.tag').textContent='Answered · recorded';form.onsubmit=e=>e.preventDefault();}
   catch(error){button.disabled=false;if(error.code==='P0001'){approvalAttempts.delete(key);attempt=null;status.textContent='Not saved: '+error.message;button.type='button';button.textContent='Reload current decision';button.onclick=()=>projectApprovals();}else{status.textContent='Not confirmed: '+(error.message||'Connection unavailable')+'. Retry uses the same request. Keep this tab open until confirmed.';button.textContent='Retry same answer';}}
   finally{saving=false;}
  };
 });
}
