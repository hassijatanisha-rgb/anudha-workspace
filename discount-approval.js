'use strict';
// Discount approval on draft Pro formas (migration 079). The database decides who may approve and blocks sending;
// this file only shows the state and offers the decision to the people the database will accept.
let discountPolicy=null,discountDecisions=[];

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
 if(me?.role!=='owner'||!discountPolicy)return '';
 const limit=discountPolicy.head_limit_basis_points;
 return `<div class="notice discount-policy no-print" data-discount-policy><p>Department heads may approve discounts up to <strong>${limit==null?'— (not set: every discount needs you)':esc(discountPercent(limit))}</strong>. Larger discounts need the owner.</p><button type="button" data-discount-limit>Change discount limit</button></div>`;
}

async function loadDiscountApprovals(proformaIds){
 const [policy,decisions]=await Promise.all([
  client.from('discount_policy').select('*').maybeSingle(),
  proformaIds.length?client.from('sales_proforma_discount_decisions').select('*').in('proforma_id',proformaIds).order('decided_at',{ascending:false}).limit(1000):Promise.resolve({data:[]})
 ]);
 // Before migration 079 is installed the tables do not exist; show nothing rather than a broken panel.
 if(policy.error||decisions.error)return false;
 discountPolicy=policy.data;discountDecisions=decisions.data||[];return true;
}

async function decorateDiscountApprovals(){
 const drafts=[...document.querySelectorAll('[data-document-card]')].map(card=>salesProforma(card.dataset.documentCard)).filter(record=>record&&record.status==='draft');
 const actor=me?.user_id;
 if(!(await loadDiscountApprovals(drafts.map(record=>record.id)))||me?.user_id!==actor)return;
 const limit=discountPolicy?.head_limit_basis_points??null;
 for(const record of drafts){
  const card=document.querySelector(`[data-document-card="${CSS.escape(record.id)}"]`),actions=card?.querySelector('.actions');
  if(!actions||card.querySelector('[data-discount-panel]'))continue;
  const status=discountState(record,salesLines(record.id),discountDecisions,limit);
  if(status.state==='none')continue;
  actions.insertAdjacentHTML('beforebegin',discountPanelHtml(record,status));
 }
 const anchor=$('#newProforma')?.closest('.card,.heading,section');
 if(anchor&&!document.querySelector('[data-discount-policy]'))anchor.insertAdjacentHTML('afterend',discountPolicyHtml());
 document.querySelectorAll('[data-discount-decide]').forEach(button=>button.onclick=()=>openDiscountDecision(salesProforma(button.dataset.id),button.dataset.discountDecide));
 $('[data-discount-limit]')?.addEventListener('click',openDiscountLimit);
}

function openDiscountDecision(record,decision){
 if(!record)return;
 const decisionId=crypto.randomUUID(); // one id per opened form, so a resubmitted uncertain save is recognised, not duplicated
 actionForm(decision==='approved'?'Approve discount':'Reject discount',
  `<p>${esc(record.document_number)} · revision ${record.revision} · ${esc(salesOrganization(record.organization_id).name)}</p><label><span>Reason</span><textarea name="reason" required minlength="2" maxlength="1000"></textarea></label>`,
  async values=>{
   const result=await client.rpc('decide_proforma_discount',{p_decision_id:decisionId,p_proforma_id:record.id,p_expected_version:record.version,p_decision:decision,p_reason:values.reason||''});
   if(result.error)throw result.error;
   await salesDeliveryWorkspace(true);message(decision==='approved'?'Discount approved.':'Discount rejected.');
  });
}
function openDiscountLimit(){
 if(!discountPolicy)return;
 const current=discountPolicy.head_limit_basis_points,version=discountPolicy.version;
 actionForm('Discount limit for department heads',
  `<p>Heads may approve a discount up to this percentage on any line. Above it, only the owner can approve. Leave empty so every discount needs the owner.</p><label><span>Limit (%)</span><input name="limit" type="number" min="0.01" max="100" step="0.01" value="${current==null?'':esc(current/100)}"></label>`,
  async values=>{
   const text=String(values.limit??'').trim(),basisPoints=text===''?null:Math.round(Number(text)*100);
   if(basisPoints!==null&&(!Number.isSafeInteger(basisPoints)||basisPoints<1||basisPoints>10000))throw Error('Enter a limit between 0.01% and 100%, or leave it empty.');
   const result=await client.rpc('set_discount_policy',{p_expected_version:version,p_head_limit_basis_points:basisPoints});
   if(result.error)throw result.error;
   await salesDeliveryWorkspace(true);message('Discount limit saved.');
  });
}
