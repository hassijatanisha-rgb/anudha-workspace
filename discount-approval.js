'use strict';
// Discount approval on draft Pro formas (migration 079). The database decides who may approve and blocks sending;
// this file only shows the state and offers the decision to the people the database will accept.
let discountPolicy=null,discountDecisions=[],discountReadRequest=0,discountSettingsRequest=0;

// Which approval a set of lines needs. limitBasisPoints null means no head limit is set: every discount needs the owner.
function discountRequirement(lines,limitBasisPoints){
 const maxBasisPoints=Math.max(0,...(lines||[]).map(line=>Number(line.discount_basis_points)||0));
 if(maxBasisPoints===0)return {maxBasisPoints,level:'none'};
 return {maxBasisPoints,level:Number.isInteger(limitBasisPoints)&&maxBasisPoints<=limitBasisPoints?'head':'owner'};
}
// Where a draft stands: none, needed, approved, rejected, or approved at a lower level than the limit now requires.
function discountState(record,lines,decisions,limitBasisPoints){
 const need=discountRequirement(lines,limitBasisPoints);
 if(need.level==='none')return {...need,state:'none',latest:null};
 const latest=(decisions||[]).filter(row=>row.proforma_id===record.id&&row.revision===record.revision)
  .sort((a,b)=>String(b.decided_at).localeCompare(String(a.decided_at))||String(b.id).localeCompare(String(a.id)))[0]||null;
 if(!latest)return {...need,state:'needed',latest};
 if(latest.decision==='rejected')return {...need,state:'rejected',latest};
 if(need.level==='owner'&&latest.required_level!=='owner')return {...need,state:'needed',latest,limitChanged:true};
 return {...need,state:'approved',latest};
}
// Mirrors the database rule, so the buttons appear only for people it will accept.
function canDecideDiscount(user,record,level){
 if(!user||record.prepared_by===user.user_id)return false;
 return level==='owner'?user.role==='owner':['owner','head'].includes(user.role);
}
function discountPercent(basisPoints){return `${Number(basisPoints)/100}%`}

function discountPanelHtml(record,status){
 const who=status.level==='owner'?'the owner (MD)':'a department head or the owner';
 const decided=status.latest?`${esc(status.latest.decision==='approved'?'Approved':'Rejected')} by ${esc(typeof employeeName==='function'?employeeName(status.latest.decided_by):status.latest.decided_by)} · ${esc(String(status.latest.decided_at).slice(0,16).replace('T',' '))} · ${esc(status.latest.reason)}`:'';
 const text={
  needed:status.limitChanged?`The discount limit changed. This ${discountPercent(status.maxBasisPoints)} discount now needs ${who} before sending.`:`This Pro forma has a ${discountPercent(status.maxBasisPoints)} discount. It needs approval by ${who} before it can be sent.`,
  rejected:`The ${discountPercent(status.maxBasisPoints)} discount on revision ${record.revision} was rejected. Change the discount, or ask again.`,
  approved:`Discount ${discountPercent(status.maxBasisPoints)} approved for revision ${record.revision}.`
 }[status.state];
 const buttons=status.state!=='approved'&&canDecideDiscount(me,record,status.level)?`<button type="button" data-discount-decide="approved" data-id="${esc(record.id)}">Approve discount</button><button type="button" class="danger" data-discount-decide="rejected" data-id="${esc(record.id)}">Reject discount</button>`:'';
 return `<div class="notice discount-approval no-print" data-discount-panel="${esc(record.id)}" role="status"><p>${esc(text)}</p>${decided?`<p><small>${decided}</small></p>`:''}${buttons?`<div class="actions">${buttons}</div>`:''}</div>`;
}
function discountPolicyHtml(){
 if(me?.role!=='owner'||view!=='settings'||!discountPolicy)return '';
 const limit=discountPolicy.head_limit_basis_points;
 return `<div class="discount-policy no-print" data-discount-policy><p>Department heads may approve discounts up to <strong data-discount-limit-value>${limit==null?'— (not set: every discount needs you)':esc(discountPercent(limit))}</strong>; larger discounts need the owner.</p><button type="button" data-discount-limit>Change discount limit</button><p data-discount-policy-status role="status"></p></div>`;
}
async function loadSettingsDiscountPolicy(section,saved=null){
 const actor=me;if(actor?.role!=='owner'||view!=='settings'||!section?.isConnected)return;
 const request=++discountSettingsRequest,current=()=>me===actor&&me?.role==='owner'&&view==='settings'&&request===discountSettingsRequest&&section.isConnected;
 discountReadRequest++;
 if(!saved)section.innerHTML=workspaceSkeleton('profile','Loading discount policy…');
 const apply=()=>{
  if(!section.querySelector('[data-discount-policy]'))section.innerHTML=discountPolicyHtml();
  const value=section.querySelector('[data-discount-limit-value]'),button=section.querySelector('[data-discount-limit]');
  value.textContent=discountPolicy.head_limit_basis_points==null?'— (not set: every discount needs you)':discountPercent(discountPolicy.head_limit_basis_points);
  button.onclick=()=>openDiscountLimit();return button;
 };
 if(saved){discountPolicy=saved;apply().disabled=true;const status=section.querySelector('[data-discount-policy-status]');status.setAttribute('role','status');status.textContent='Discount limit saved. Checking current details…';}
 try{
  const result=await client.from('discount_policy').select('id,head_limit_basis_points,version,updated_by,updated_at').maybeSingle();if(!current())return;
  if(result.error)throw result.error;
  const row=result.data,limit=row?.head_limit_basis_points;
  if(row?.id!==true||!Number.isSafeInteger(row.version)||row.version<1||limit!==null&&(!Number.isSafeInteger(limit)||limit<1||limit>10000)||saved&&(row.version<saved.version||row.version===saved.version&&limit!==saved.head_limit_basis_points))throw Error('The current discount limit could not be verified.');
  discountPolicy=row;const button=apply();button.disabled=false;
  const status=section.querySelector('[data-discount-policy-status]');status.setAttribute('role','status');status.textContent=saved?'Discount limit saved.':'';
  if(saved){if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(button);message('Discount limit saved.');}
 }catch(error){
  if(!current())return;
  if(!saved)section.innerHTML='<p data-discount-policy-status role="alert"></p>';
  const status=section.querySelector('[data-discount-policy-status]');status.setAttribute('role','alert');status.textContent=(saved?'Discount limit saved. Current details could not refresh: ':'Discount policy could not load: ')+(error.message||'Check your connection.');
  const retry=document.createElement('button');retry.type='button';retry.textContent='Retry discount details';retry.onclick=()=>{if(current())return run(()=>loadSettingsDiscountPolicy(section,saved),{origin:retry,errorTarget:status,busyLabel:'Reloading discount policy…'})};status.append(retry);
  if(saved){if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);message('Discount limit saved. Use Retry discount details to continue.');}
 }
}

async function loadDiscountApprovals(proformaIds){
 const actor=me,request=++discountReadRequest;
 const [policy,decisions]=await Promise.all([
  client.from('discount_policy').select('*').maybeSingle(),
  proformaIds.length?client.from('sales_proforma_discount_decisions').select('*').in('proforma_id',proformaIds).order('decided_at',{ascending:false}).limit(1000):Promise.resolve({data:[]})
 ]);
 // Before migration 079 is installed the tables do not exist; show nothing rather than a broken panel.
 if(me!==actor||request!==discountReadRequest||policy.error||decisions.error)return false;
 discountPolicy=policy.data;discountDecisions=decisions.data||[];return true;
}

async function decorateDiscountApprovals(){
 const drafts=[...document.querySelectorAll('[data-document-card]')].map(card=>salesProforma(card.dataset.documentCard)).filter(record=>record&&record.status==='draft');
 const actor=me,root=$('#content'),request=salesWorkspaceRequest;
 if(!(await loadDiscountApprovals(drafts.map(record=>record.id)))||me!==actor||root!==$('#content')||request!==salesWorkspaceRequest||view!=='sales')return;
 const limit=discountPolicy?.head_limit_basis_points??null;
 for(const record of drafts){
  const card=document.querySelector(`[data-document-card="${CSS.escape(record.id)}"]`),actions=card?.querySelector('.actions');
  if(!actions||card.querySelector('[data-discount-panel]'))continue;
  const status=discountState(record,salesLines(record.id),discountDecisions,limit);
  if(status.state==='none')continue;
  actions.insertAdjacentHTML('beforebegin',discountPanelHtml(record,status));
 }
 document.querySelectorAll('[data-discount-decide]').forEach(button=>button.onclick=()=>openDiscountDecision(salesProforma(button.dataset.id),button.dataset.discountDecide));
}

function openDiscountDecision(record,decision){
 if(!record)return;
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,root=$('#content'),current=()=>me===actor&&epoch===salesEpoch&&request===salesWorkspaceRequest&&view==='sales'&&root===$('#content')&&root.isConnected;
 const decisionId=crypto.randomUUID(); // one id per opened form, so a resubmitted uncertain save is recognised, not duplicated
 actionForm(decision==='approved'?'Approve discount':'Reject discount',
  `<p>${esc(record.document_number)} · revision ${record.revision} · ${esc(salesOrganization(record.organization_id).name)}</p><label><span>Reason</span><textarea name="reason" required minlength="2" maxlength="1000"></textarea></label>`,
  async values=>{
   if(!current())throw Error('Reopen the Pro forma before deciding its discount.');
   let result;try{result=await client.rpc('decide_proforma_discount',{p_decision_id:decisionId,p_proforma_id:record.id,p_expected_version:record.version,p_decision:decision,p_reason:values.reason||''});}catch(error){if(!current())return;throw error;}
   if(!current())return;
   if(result.error)throw result.error;
   const saved=result.data;
   if(saved?.id!==decisionId||saved.proforma_id!==record.id||saved.revision!==record.revision||saved.decision!==decision||saved.decided_by!==actor.user_id)throw Error('The discount decision could not be verified. Retry the same decision or refresh before changing it.');
   discountReadRequest++;discountDecisions=[...discountDecisions.filter(row=>row.id!==saved.id),saved];
   await refreshSavedDiscount(record,decision==='approved'?'Discount approved.':'Discount rejected.',current,{decision:saved});
  });
}
function openDiscountLimit(){
 const section=$('#settingsDiscountPolicy'),button=section?.querySelector('[data-discount-limit]');if(me?.role!=='owner'||view!=='settings'||!discountPolicy||!section?.isConnected||!button||button.disabled)return;
 const current=discountPolicy.head_limit_basis_points,version=discountPolicy.version,actor=me,request=discountSettingsRequest,active=()=>me===actor&&me?.role==='owner'&&request===discountSettingsRequest&&view==='settings'&&section===$('#settingsDiscountPolicy')&&section.isConnected;
 actionForm('Discount limit for department heads',
  `<p>Enter the highest discount heads can approve on any line, or leave blank to require the owner for every discount.</p><label><span>Limit (%)</span><input name="limit" type="number" min="0.01" max="100" step="0.01" value="${current==null?'':esc(current/100)}"></label>`,
  async values=>{
   if(!active())throw Error('Reopen the discount limit before saving.');
   const text=String(values.limit??'').trim(),basisPoints=text===''?null:Math.round(Number(text)*100);
   if(basisPoints!==null&&(!Number.isSafeInteger(basisPoints)||basisPoints<1||basisPoints>10000))throw Error('Enter a limit between 0.01% and 100%, or leave it empty.');
   let result;try{result=await client.rpc('set_discount_policy',{p_expected_version:version,p_head_limit_basis_points:basisPoints});}catch(error){if(!active())return;throw error;}
   if(!active())return;
   if(result.error)throw result.error;
   const saved=result.data;if(saved?.version!==version+1||saved.head_limit_basis_points!==basisPoints||saved.updated_by!==actor.user_id)throw Error('The discount limit could not be verified. Refresh before changing it again.');
   discountReadRequest++;discountPolicy=saved;
   await loadSettingsDiscountPolicy(section,saved);
  });
}
async function refreshSavedDiscount(record,text,current,expected){
 if(!current())return;
 const cards=[...document.querySelectorAll('[data-document-card]')].filter(card=>!record||card.dataset.documentCard===record.id);
 const ids=cards.map(card=>salesProforma(card.dataset.documentCard)).filter(row=>row?.status==='draft').map(row=>row.id);
 const policy=document.querySelector('[data-discount-policy]'),anchor=record?cards[0]?.querySelector('[data-discount-panel]'):policy;
 if(!anchor){message(text);return;}
 const left=window.scrollX,top=window.scrollY;
 const sendControls=new Map(cards.flatMap(card=>[...card.querySelectorAll('[data-proforma-action="send"]')].map(button=>[button,button.disabled])));
 const status=document.createElement('p');status.setAttribute('role','status');anchor.append(status);
 const gate=pending=>{for(const card of cards)card.querySelectorAll('[data-discount-decide]').forEach(button=>button.disabled=pending);for(const [button,disabled] of sendControls)button.disabled=pending||disabled;const button=policy?.querySelector('[data-discount-limit]');if(button)button.disabled=pending;};
 async function reload(){
  if(!current()||!anchor.isConnected)return;
  gate(true);status.textContent=text+' Updating discount details…';
  try{
   if(!(await loadDiscountApprovals(ids)))throw Error('Current discount details are unavailable.');
   if(!current())return;
   if(!Number.isSafeInteger(discountPolicy?.version)||discountPolicy.version<1||expected.policy&&(discountPolicy.version<expected.policy.version||discountPolicy.version===expected.policy.version&&discountPolicy.head_limit_basis_points!==expected.policy.head_limit_basis_points))throw Error('The current discount limit could not be verified.');
   if(expected.decision&&!discountDecisions.some(row=>row.id===expected.decision.id&&row.proforma_id===record.id&&row.revision===record.revision&&row.decision===expected.decision.decision))throw Error('The saved discount decision could not be verified.');
   for(const card of cards){
    const row=salesProforma(card.dataset.documentCard),old=card.querySelector('[data-discount-panel]');if(!row||!old)continue;
    const template=document.createElement('template'),state=discountState(row,salesLines(row.id),discountDecisions,discountPolicy?.head_limit_basis_points??null);
    if(state.state==='none'){old.remove();continue;}
    template.innerHTML=discountPanelHtml(row,state);old.replaceWith(template.content.firstElementChild);
    card.querySelectorAll('[data-discount-decide]').forEach(button=>button.onclick=()=>openDiscountDecision(row,button.dataset.discountDecide));
   }
   if(policy){const template=document.createElement('template');template.innerHTML=discountPolicyHtml();policy.replaceWith(template.content.firstElementChild);document.querySelector('[data-discount-limit]')?.addEventListener('click',openDiscountLimit);}
   gate(false);status.remove();
   const next=record?cards[0]?.querySelector('[data-discount-decide],[data-proforma-action="send"]'):document.querySelector('[data-discount-limit]');
   if(next&&typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(next);
   window.scrollTo({left,top,behavior:'instant'});message(text);
  }catch(error){
   if(!current()||!anchor.isConnected)return;
   status.setAttribute('role','alert');status.textContent=`${text} Current details could not refresh: ${error.message}.`;
   const retry=document.createElement('button');retry.type='button';retry.textContent='Retry discount details';retry.onclick=()=>run(reload);status.append(retry);
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);
   window.scrollTo({left,top,behavior:'instant'});message(text+' Use Retry discount details to continue.');
  }
 }
 await reload();
}
