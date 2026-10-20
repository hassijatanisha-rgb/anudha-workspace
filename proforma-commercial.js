'use strict';
async function loadProformaContracts(){
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,rows=[];
 for(let offset=0;;offset+=1000){
  const result=await client.from('customer_contracts').select('id,contract_number,organization_id,kind,title,status,starts_on,ends_on,approved_attachment_id').eq('kind','placement').neq('status','cancelled').order('id').range(offset,offset+999);
  if(me!==actor||epoch!==salesEpoch||request!==salesWorkspaceRequest)return;if(result.error)throw result.error;
  rows.push(...(result.data||[]));if((result.data||[]).length<1000)break;
 }
 salesPlacementContracts=rows;
}
function proformaContractOptions(organizationId,selected=''){
 return salesPlacementContracts.filter(row=>row.organization_id===organizationId).map(row=>`<option value="${esc(row.id)}" ${row.id===selected?'selected':''}>${esc(row.contract_number)} · ${esc(row.title)} · ${esc(row.status)}${row.status==='approved'&&!contractActive(row)?' · outside effective dates':''}</option>`).join('');
}
function proformaCommercialFields(record,organizationId){
 const kind=record?.commercial_kind||'sale';
 return `<div class="grid"><label>Commercial category<select name="commercialKind"><option value="sale" ${kind==='sale'?'selected':''}>Sale</option><option value="placement" ${kind==='placement'?'selected':''}>Placement</option></select></label><label data-placement-contract ${kind==='placement'?'':'hidden'}>Placement contract<select name="contractId" ${kind==='placement'?'required':''}><option value="">Choose this branch’s contract</option>${proformaContractOptions(organizationId,record?.contract_id)}</select></label><label>Installation required?<select name="installationRequired"><option value="yes" ${record?.installation_required!==false?'selected':''}>Yes · create installation jobs after delivery</option><option value="no" ${record?.installation_required===false?'selected':''}>No · service team can open a later job</option></select></label><label class="wide">Installation charges / service instructions<textarea name="installationChargeNotes" maxlength="2000" placeholder="Describe agreed charges or service arrangements. Bill charges as quotation line items.">${esc(record?.installation_charge_notes||'')}</textarea><small>Visible to service. This note does not add an amount to the quotation.</small></label><label class="wide">Internal remarks · never printed<textarea name="internalNotes" maxlength="4000">${esc(record?.internal_notes||'')}</textarea></label></div><p data-placement-help class="notice" ${kind==='placement'?'':'hidden'}>Placement is for zero-charge machines only. Put consumables on a separate quotation. Save and approve the customer’s contract under Contracts before recording this quotation as sent. Placement billing and stock release are awaiting the agreed accounting route.</p>`;
}
function proformaUpdateContractChoices(){
 const form=$('#proformaForm');if(!form)return;
 const select=form.querySelector('[name="contractId"]'),prior=select.value;
 select.innerHTML='<option value="">Choose this branch’s contract</option>'+proformaContractOptions(form.querySelector('[name="organizationId"]').value,prior);
}
function proformaBindCommercial(){
 const form=$('#proformaForm');if(form){
  const kind=form.querySelector('[name="commercialKind"]');
  kind.addEventListener('change',()=>{const placement=kind.value==='placement';form.querySelector('[data-placement-contract]').hidden=!placement;form.querySelector('[data-placement-help]').hidden=!placement;form.querySelector('[name="contractId"]').required=placement;});
  form.dataset.initialState=salesEditorState(form);
 }
 document.querySelectorAll('[data-proforma-contract]').forEach(button=>button.onclick=()=>run(()=>workOpenRecord({record_type:'contract',record_id:button.dataset.proformaContract})));
}
function proformaCommercialSummary(record){
 return `<p><strong>${record.commercial_kind==='placement'?'Placement':'Sale'}</strong> · Installation ${record.installation_required===false?'not requested':'required'}${record.installation_charge_notes?`<br>Installation / service terms: ${esc(record.installation_charge_notes)}`:''}</p>${record.commercial_kind==='placement'?`<div class="no-print"><button type="button" data-proforma-contract="${esc(record.contract_id)}">View placement contract</button><p class="notice">Placement billing and stock release await the agreed accounting route. The approved contract is required before sending.</p></div>`:''}${record.internal_notes?`<aside class="no-print"><strong>Internal remarks</strong><p>${esc(record.internal_notes)}</p></aside>`:''}`;
}
