'use strict';

let salesSection='proformas',salesLoaded=false,salesLoadError='',salesProformas=[],salesProformaLines=[],salesProformaEvents=[],salesDeliveryNotes=[],salesDeliveryLines=[],salesDeliveryEvents=[],salesEditing='',salesFocusedProforma='',salesFocusedDelivery='',salesPrefill=null;
function clearSalesPrefill(){salesPrefill=null;}
let salesProformaFilter='all',salesProformaSearch='',salesShown=120;
let salesProformaPage=0,salesProformaPageData=null,salesProformaPageKey='';
function salesProformaLanding(){return salesSection==='proformas'&&!salesFocusedProforma&&!salesEditing;}
let salesDeliveryPage=0,salesDeliveryFilter='notes',salesDeliveryPageData=null,salesDeliveryPageKey='';
function salesDeliveryLanding(){return salesSection==='delivery'&&!salesFocusedDelivery&&!salesEditing;}
const salesDeliveryRefreshErrors=new Map();
let salesEpoch=0,salesLoadRequest=0,salesWorkspaceRequest=0,salesRevisionSnapshots=new Map(),salesPlacementContracts=[],salesDeliveryHistoryLoaded=new Set(),salesSerialsLoading=null;
function clearSalesDelivery(){
 proformaDraftRestoreRequest++;proformaDraftRestore=null;if(proformaDraftActive?.timer)clearTimeout(proformaDraftActive.timer);proformaDraftActive=null;
 salesProformaPage=0;salesProformaPageData=null;salesProformaPageKey='';
 salesDeliveryPage=0;salesDeliveryFilter='notes';salesDeliveryPageData=null;salesDeliveryPageKey='';
 salesEpoch++;salesLoadRequest++;salesWorkspaceRequest++;proformaExistingAsk++;
 salesSerialsLoading=null;salesDeliveryRefreshErrors.clear();
 salesLoaded=false;salesLoadError='';salesProformas=[];salesProformaLines=[];salesProformaEvents=[];salesDeliveryNotes=[];salesDeliveryLines=[];salesDeliveryEvents=[];
 salesEditing='';salesFocusedProforma='';salesFocusedDelivery='';salesPrefill=null;salesSection='proformas';salesProformaFilter='all';salesProformaSearch='';salesShown=120;salesRevisionSnapshots.clear();salesPlacementContracts=[];salesDeliveryHistoryLoaded.clear();
}
function salesEditorState(form){return JSON.stringify([...form.querySelectorAll('input,select,textarea')].filter(input=>input.name).map(input=>[input.name,input.value,input.checked]));}
function salesEditorChanged(form){return !!form&&form.dataset.initialState!==undefined&&salesEditorState(form)!==form.dataset.initialState;}
const proformaDraftPrefix='anudha:proforma-draft:1:',proformaDraftLimit=2*1024*1024;
const proformaDraftHeaders={organizationId:128,contactId:128,currency:3,validUntil:10,deliveryPeriod:300,paymentTerms:1000,notes:4000,commercialKind:9,contractId:128,installationRequired:3,installationChargeNotes:2000,internalNotes:4000};
const proformaDraftLineFields={productChoice:8192,description:4000,quantity:40,uom:40,unitPrice:40,discountMode:7,discount:40,discountAmount:40,tax:40};
const proformaDraftContexts=new WeakMap();
let proformaDraftActive=null,proformaDraftRestoreRequest=0,proformaDraftRestore=null;
function proformaDraftFieldsValid(values,fields){return values&&typeof values==='object'&&!Array.isArray(values)&&Object.keys(values).length===Object.keys(fields).length&&Object.entries(fields).every(([key,max])=>typeof values[key]==='string'&&values[key].length<=max);}
function proformaDraftValid(draft,actor){
 const identity=value=>typeof value==='string'&&value.length>0&&value.length<=128;
 if(!draft||draft.schema!==1||draft.actor!==actor||!identity(draft.id)||typeof draft.isNew!=='boolean'||typeof draft.route!=='string'||draft.route.length>200||!Number.isSafeInteger(draft.version)||draft.version<0||!Number.isSafeInteger(draft.revision)||draft.revision<0||draft.isNew!==(draft.version===0)||draft.isNew!==(draft.revision===0)||!proformaDraftFieldsValid(draft.fields,proformaDraftHeaders)||!Array.isArray(draft.lines)||draft.lines.length<1||draft.lines.length>100)return false;
 if(!draft.lines.every(line=>proformaDraftFieldsValid(line.values,proformaDraftLineFields)&&typeof line.productId==='string'&&line.productId.length<=128))return false;
 if(!draft.pending)return draft.pending===null;
 const p=draft.pending,keys=['p_id','p_expected_version','p_organization_id','p_contact_id','p_currency','p_valid_until','p_delivery_period','p_payment_terms','p_notes','p_lines','p_commercial_kind','p_contract_id','p_installation_required','p_installation_charge_notes','p_internal_notes'];
 if(typeof p!=='object'||Object.keys(p).length!==keys.length||!keys.every(key=>Object.hasOwn(p,key))||p.p_id!==draft.id||p.p_expected_version!==draft.version||!identity(p.p_organization_id)||!identity(p.p_contact_id)||!['TZS','USD','EUR'].includes(p.p_currency)||!/^\d{4}-\d{2}-\d{2}$/.test(p.p_valid_until)||!['sale','placement'].includes(p.p_commercial_kind)||!(p.p_contract_id===null||identity(p.p_contract_id))||typeof p.p_installation_required!=='boolean')return false;
 if(![['p_delivery_period',300],['p_payment_terms',1000],['p_notes',4000],['p_installation_charge_notes',2000],['p_internal_notes',4000]].every(([key,max])=>typeof p[key]==='string'&&p[key].length<=max)||!Array.isArray(p.p_lines)||p.p_lines.length!==draft.lines.length)return false;
 if(!p.p_lines.every(line=>line&&Object.keys(line).length===7&&identity(line.productId)&&typeof line.description==='string'&&line.description.length<=4000&&typeof line.uom==='string'&&line.uom.length<=40&&Number.isSafeInteger(line.quantity)&&line.quantity>=1&&line.quantity<=1000000&&Number.isSafeInteger(line.unitPriceMinor)&&line.unitPriceMinor>=0&&line.unitPriceMinor<=9000000000000000&&['discountBasisPoints','taxBasisPoints'].every(key=>Number.isInteger(line[key])&&line[key]>=0&&line[key]<=10000)))return false;
 const fields={organizationId:'p_organization_id',contactId:'p_contact_id',currency:'p_currency',validUntil:'p_valid_until',deliveryPeriod:'p_delivery_period',paymentTerms:'p_payment_terms',notes:'p_notes',commercialKind:'p_commercial_kind',installationChargeNotes:'p_installation_charge_notes',internalNotes:'p_internal_notes'};
 if(!Object.entries(fields).every(([key,arg])=>draft.fields[key]===p[arg])||(draft.fields.contractId||null)!==p.p_contract_id||(draft.fields.installationRequired==='yes')!==p.p_installation_required)return false;
 try{return draft.lines.every((line,index)=>{const value=line.values,saved=p.p_lines[index],quantity=Number(value.quantity),price=moneyMinor(value.unitPrice),discount=pricingDiscount(quantity,price,value.discountMode,value.discountMode==='amount'?value.discountAmount:value.discount);return saved.productId===line.productId&&saved.description===value.description.trim()&&saved.uom===value.uom.trim()&&saved.quantity===quantity&&saved.unitPriceMinor===price&&saved.discountBasisPoints===discount.discountBasisPoints&&saved.taxBasisPoints===Math.round(Number(value.tax)*100);});}catch{return false;}
}
function proformaFreezePending(pending){pending.p_lines.forEach(Object.freeze);Object.freeze(pending.p_lines);return Object.freeze(pending);}
function proformaDraftKey(actor){return proformaDraftPrefix+actor;}
function proformaDraftRead(actor){
 try{const raw=sessionStorage.getItem(proformaDraftKey(actor));if(!raw)return null;if(new TextEncoder().encode(raw).length>proformaDraftLimit)return null;const draft=JSON.parse(raw);return proformaDraftValid(draft,actor)?draft:null;}catch{return null;}
}
function proformaDraftStore(state,draft){
 if(proformaDraftGuard(state))return false;
 state.draft=draft;
 try{const raw=JSON.stringify(draft);if(!proformaDraftValid(draft,state.actor.user_id)||new TextEncoder().encode(raw).length>proformaDraftLimit)throw Error('Draft exceeds local storage limits');sessionStorage.setItem(proformaDraftKey(state.actor.user_id),raw);state.storageError='';}
 catch{state.storageError='This browser cannot restore edits after reload.';}
 proformaDraftStatus(state);return true;
}
function proformaDraftRemove(actor,pending=null,draft=null){try{const stored=proformaDraftRead(actor);if(stored?.pending?JSON.stringify(stored.pending)!==JSON.stringify(pending):stored&&JSON.stringify(stored)!==JSON.stringify(draft))return false;sessionStorage.removeItem(proformaDraftKey(actor));return true;}catch{return false;}}
function proformaDraftRoute(draft){
 const record=workspaceRecordRoute('#/proforma/'+draft.id);if(!record||record.kind!=='proforma')return null;
 if(draft.route==='#/go/sales/proformas')return {kind:'menu',id:record.id};
 const route=workspaceRecordRoute(draft.route);return route?.kind==='proforma'&&route.id===record.id?route:null;
}
function proformaDraftPendingGuard(state){
 if(!state.current())return true;
 const stored=proformaDraftRead(state.actor.user_id),draft=stored?.pending?stored:state.foreignPending;
 if(!draft?.pending||state.pending&&JSON.stringify(state.pending)===JSON.stringify(draft.pending))return false;
 state.form.querySelector('[data-proforma-prior-draft]')?.remove();state.foreignPending=draft;if(state.timer){clearTimeout(state.timer);state.timer=null;}
 state.form.querySelector('[type="submit"]').disabled=true;
 let panel=state.form.querySelector('[data-proforma-prior-pending]');
 if(!panel){panel=document.createElement('section');panel.dataset.proformaPriorPending='';panel.className='notice';const text=document.createElement('p');text.textContent='Another Pro forma save is unconfirmed. Review that pending save first. Changes in this editor cannot replace it and will not be restored after reload.';panel.append(text);state.form.querySelector('[data-proforma-save-feedback]').append(panel);}
 const pendingKey=JSON.stringify([draft.id,draft.route,draft.pending]);if(panel.pendingKey===pendingKey)return true;panel.pendingKey=pendingKey;const previous=panel.querySelector('button');if(previous)previous.remove();
 const route=proformaDraftRoute(draft);if(route){const button=document.createElement('button');button.type='button';button.textContent='Review pending Pro forma save';button.onclick=()=>proformaReviewStoredDraft(state,draft,button);panel.append(button);}
 return true;
}
function proformaReviewStoredDraft(state,draft,button){
 if(!state.current()||busy)return;
 const latest=proformaDraftRead(state.actor.user_id)||state.foreignPending,route=latest&&proformaDraftRoute(latest);
 if(!route||JSON.stringify(latest)!==JSON.stringify(draft))return;
 const context=workspaceNavigationContext(),target=workspaceRecordButton('proforma');if(!workspaceRecordAllowed(target))return;
 return route.kind==='menu'?navigateWorkspace(target,{context}):run(()=>openWorkspaceRecord('proforma',route.id,{context}),{origin:button});
}
function proformaDraftGuard(state){
 if(proformaDraftPendingGuard(state))return true;
 const draft=proformaDraftRead(state.actor.user_id);
 if(!draft||draft.pending||state.draft&&draft.id===state.draft.id&&draft.route===state.hash&&draft.version===state.draft.version&&draft.revision===state.draft.revision)return false;
 if(state.timer){clearTimeout(state.timer);state.timer=null;}state.form.querySelector('[type="submit"]').disabled=true;
 let panel=state.form.querySelector('[data-proforma-prior-draft]');
 if(!panel){panel=document.createElement('section');panel.dataset.proformaPriorDraft='';panel.className='notice';state.form.querySelector('[data-proforma-save-feedback]').append(panel);}
 const key=JSON.stringify(draft);if(panel.draftKey===key)return true;panel.draftKey=key;panel.replaceChildren();
 const text=document.createElement('p');text.textContent='An unsaved Pro forma draft is already stored in this browser. Review it or discard it before saving this editor. Your current entries stay here until you choose.';panel.append(text);
 if(proformaDraftRoute(draft)){const review=document.createElement('button');review.type='button';review.textContent='Review prior draft';review.dataset.proformaReviewPrior='';review.onclick=()=>proformaReviewStoredDraft(state,draft,review);panel.append(review);}
 const error=document.createElement('p');error.dataset.proformaPriorError='';error.className='error';
 const discard=document.createElement('button');discard.type='button';discard.textContent='Discard prior draft';discard.dataset.proformaDiscardPrior='';discard.onclick=()=>{
  if(!state.current()||busy)return;
  return run(async()=>{
   if(!state.current())return;if(JSON.stringify(proformaDraftRead(state.actor.user_id))!==key){proformaDraftGuard(state);return;}
   if(!await askConfirm({title:'Discard the prior Pro forma draft?',body:'Only the earlier unsaved draft will be removed. The entries in this editor will stay.',confirmLabel:'Discard prior draft',tone:'danger'}))return;
   const latest=proformaDraftRead(state.actor.user_id);if(!state.current())return;if(latest?.pending||JSON.stringify(latest)!==key){proformaDraftGuard(state);return;}
   if(!proformaDraftRemove(state.actor.user_id,null,draft))throw Error('The prior draft could not be removed. Your current entries are unchanged.');
   panel.remove();state.form.querySelector('[type="submit"]').disabled=state.saveDisabled;proformaDraftFlush(state);
  },{origin:discard,errorTarget:error});
 };panel.append(discard,error);return true;
}
function clearProformaDraftStorage(){
 proformaDraftRestoreRequest++;proformaDraftRestore=null;
 if(proformaDraftActive?.timer)clearTimeout(proformaDraftActive.timer);
 proformaDraftActive=null;
 try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith(proformaDraftPrefix))sessionStorage.removeItem(key);}}catch{}
}
function proformaDraftStatus(state){
 if(!state.current())return;
 const status=state.form.querySelector('[data-proforma-draft-status]');
 status.textContent=state.pending?'Save confirmation pending.':state.conflict||salesEditorChanged(state.form)?'Unsaved changes.':'';
 const warning=state.form.querySelector('[data-proforma-storage-warning]');warning.textContent=state.storageError;warning.hidden=!state.storageError;
}
function proformaDraftCapture(state){
 const form=state.form,read=(root,fields)=>Object.fromEntries(Object.keys(fields).map(name=>[name,root.querySelector(`[name="${name}"]`).value]));
 return {schema:1,actor:state.actor.user_id,id:form.dataset.id||(form.dataset.requestId ||= crypto.randomUUID()),isNew:!form.dataset.id,version:Number(form.dataset.version),revision:state.revision,route:state.hash,fields:read(form,proformaDraftHeaders),lines:[...form.querySelectorAll('[data-proforma-line]')].map(row=>({productId:inventoryProductFromChoice(row.querySelector('[name="productChoice"]').value)?.id||'',values:read(row,proformaDraftLineFields)})),pending:null};
}
function proformaDraftFlush(state=proformaDraftActive){
 if(!state?.current()||state.pending||state.conflict||proformaDraftGuard(state))return;
 if(state.timer){clearTimeout(state.timer);state.timer=null;}
 if(salesEditorChanged(state.form))proformaDraftStore(state,proformaDraftCapture(state));else{proformaDraftRemove(state.actor.user_id,null,state.draft);state.draft=null;proformaDraftStatus(state);}
}
function proformaBindDraft(form){
 if(!form||proformaDraftContexts.has(form))return;
 const actor=me,epoch=salesEpoch,session=sessionLoadEpoch,request=salesWorkspaceRequest,hash=location.hash,root=$('#content'),foreignPending=proformaDraftActive?.actor===actor&&proformaDraftActive.pending?proformaDraftActive.draft:proformaDraftActive?.actor===actor?proformaDraftActive.foreignPending:null;
 const state={form,actor,hash,foreignPending,saveDisabled:form.querySelector('[type="submit"]').disabled,revision:salesProforma(form.dataset.id)?.revision||0,pending:null,storageError:'',timer:null,working:false,conflict:'',current:()=>proformaDraftActive===state&&me===actor&&actor.active!==false&&hasArea('proformas')&&sessionLoadEpoch===session&&salesEpoch===epoch&&salesWorkspaceRequest===request&&view==='sales'&&salesSection==='proformas'&&location.hash===hash&&$('#content')===root&&form.isConnected&&$('#proformaForm')===form};
 proformaDraftContexts.set(form,state);proformaDraftActive=state;
 const changed=()=>{if(!state.current()||state.pending||state.conflict)return;proformaDraftStatus(state);if(state.timer)clearTimeout(state.timer);state.timer=setTimeout(()=>proformaDraftFlush(state),250);};
 form.addEventListener('input',changed);form.addEventListener('change',changed);form.addEventListener('click',event=>{if(event.target.closest('#addSalesLine,[data-remove-sales-line]'))changed();});
 if(proformaDraftRestore){const restore=proformaDraftRestore;proformaDraftRestore=null;if(restore.current()&&restore.draft.actor===actor.user_id&&salesEditing===(restore.draft.isNew?'new':restore.draft.id))proformaApplyDraft(state,restore);}
 proformaDraftGuard(state);
}
function proformaDraftMatchesRecord(id){return !!((proformaDraftRestore?.draft.id===id&&proformaDraftRestore.current())||(proformaDraftActive?.restoredId===id&&proformaDraftActive.current()));}
function proformaApplyDraft(state,{draft,conflict='',storageError=''}){
 const form=state.form,set=(root,name,value)=>{const control=root.querySelector(`[name="${name}"]`);control.value=value;};
 const branch=organizations.find(row=>row.id===draft.fields.organizationId),contact=contacts.find(row=>row.id===draft.fields.contactId&&row.organization_id===branch?.id&&row.status!=='incorrect');
 form.querySelector('[name="organizationId"]').innerHTML='<option value="">Choose client / branch</option>'+salesOrganizationOptions(branch?.id||'');
 form.querySelector('[name="contactId"]').innerHTML='<option value="">Choose named contact</option>'+salesContactOptions(branch?.id||'',contact?.id||'');
 for(const [name,value]of Object.entries(draft.fields))set(form,name,value);
 set(form,'organizationId',branch?.id||'');set(form,'contactId',contact?.id||'');proformaUpdateContractChoices();set(form,'contractId',salesPlacementContracts.some(row=>row.id===draft.fields.contractId&&row.organization_id===branch?.id)?draft.fields.contractId:'');
 form.querySelector('#proformaLines').innerHTML=draft.lines.map(()=>salesLineRow()).join('');
 [...form.querySelectorAll('[data-proforma-line]')].forEach((row,index)=>{const line=draft.lines[index];for(const [name,value]of Object.entries(line.values))set(row,name,value);if(line.productId){const product=inventorySelectableProducts().find(product=>product.id===line.productId);set(row,'productChoice',product?inventoryProductChoice(product):'');if(!product){const note=document.createElement('p');note.textContent='Previously selected product is unavailable: '+line.values.productChoice;row.append(note);}}pricingRefreshRow(row,form,{replacePrice:false});});
 const placement=draft.fields.commercialKind==='placement';form.querySelector('[data-placement-contract]').hidden=!placement;form.querySelector('[data-placement-help]').hidden=!placement;form.querySelector('[name="contractId"]').required=placement;
 form.dataset.id=draft.isNew?'':draft.id;form.dataset.requestId=draft.id;form.dataset.version=String(draft.version);form.dataset.initialState='';state.revision=draft.revision;state.draft=draft;state.restoredId=draft.id;state.conflict=conflict;state.storageError=storageError;
 if(draft.pending){state.pending=proformaFreezePending(draft.pending);state.unlock=salesLockForm(form);proformaDraftRecovery(state,'Save confirmation is pending. Check the saved status before making further changes.');}
 else if(conflict){state.unlock=salesLockForm(form);proformaDraftRecovery(state,conflict);}
 proformaDraftStatus(state);
}
async function restoreProformaDraft({current=()=>true}={}){
 if(!current()||!me?.user_id||me.active===false||!hasArea('proformas')||view!=='sales'||salesSection!=='proformas'||$('#proformaForm'))return false;
 const stored=proformaDraftRead(me.user_id),memory=proformaDraftActive?.actor===me?(proformaDraftActive.pending?proformaDraftActive.draft:proformaDraftActive.foreignPending):null,draft=stored||(memory?.pending?memory:null);if(!draft||draft.route!==location.hash)return false;
 const actor=me,session=sessionLoadEpoch,epoch=salesEpoch,hash=location.hash,root=$('#content'),navigationRequest=workspaceLeaveSequence,request=++proformaDraftRestoreRequest;
 const active=()=>me===actor&&actor.active!==false&&sessionLoadEpoch===session&&salesEpoch===epoch&&location.hash===hash&&$('#content')===root&&view==='sales'&&salesSection==='proformas'&&request===proformaDraftRestoreRequest&&navigationRequest===workspaceLeaveSequence&&hasArea('proformas');
 let conflict='';
 if(!draft.isNew){
  try{const result=await client.from('sales_proformas').select('id,version,revision,status,deleted_at').eq('id',draft.id).limit(2);if(!current()||!active())return false;if(result.error)throw result.error;const rows=result.data;if(!Array.isArray(rows)||rows.length!==1||rows[0].id!==draft.id||rows[0].version!==draft.version||rows[0].revision!==draft.revision||rows[0].status!=='draft'||rows[0].deleted_at)conflict='The server record changed or is unavailable. The restored draft cannot overwrite it. Close this editor to review the current record.';}
  catch{if(!current()||!active())return false;conflict='The current server revision could not be checked. The restored draft is locked; close and reopen after reconnecting.';}
 }
 if(!current()||!active())return false;
 const restore={draft,conflict,current:active,storageError:stored?'':'This browser cannot restore edits after reload.'};proformaDraftRestore=restore;salesEditing=draft.isNew?'new':draft.id;salesPrefill=null;
 try{await salesDeliveryWorkspace(false,{current:active});}finally{if(proformaDraftRestore===restore)proformaDraftRestore=null;}
 if(!active())return false;
 return !!$('#proformaForm');
}
function proformaPendingHeader(state,row){
 const p=state.pending;if(!p||!row||row.id!==p.p_id||row.version!==p.p_expected_version+1||row.revision!==state.revision+1||row.status!=='draft'||row.deleted_at)return false;
 if(typeof row.document_number!=='string'||!row.document_number||row.document_number.length>120||(p.p_expected_version===0&&row.prepared_by!==state.actor.user_id))return false;
 let subtotal=0n,discount=0n,tax=0n;for(const line of p.p_lines){const gross=BigInt(line.quantity)*BigInt(line.unitPriceMinor),reduction=(gross*BigInt(line.discountBasisPoints)+5000n)/10000n;subtotal+=gross;discount+=reduction;tax+=((gross-reduction)*BigInt(line.taxBasisPoints)+5000n)/10000n;}
 if(!Object.entries({subtotal_minor:subtotal,discount_minor:discount,tax_minor:tax,total_minor:subtotal-discount+tax}).every(([key,value])=>Number.isSafeInteger(Number(row[key]))&&BigInt(row[key])===value))return false;
 const pairs={organization_id:p.p_organization_id,contact_id:p.p_contact_id,currency:p.p_currency,valid_until:p.p_valid_until,delivery_period:p.p_delivery_period.trim(),payment_terms:p.p_payment_terms.trim(),notes:p.p_notes.trim(),commercial_kind:p.p_commercial_kind,contract_id:p.p_commercial_kind==='placement'?p.p_contract_id:null,installation_required:p.p_installation_required,installation_charge_notes:p.p_installation_charge_notes.trim(),internal_notes:p.p_internal_notes.trim()};
 return Object.entries(pairs).every(([key,value])=>row[key]===value);
}
function proformaPendingRevision(state,row){
 const p=state.pending,s=row?.snapshot;if(row?.revision!==state.revision+1||row.created_by!==state.actor.user_id||!s||s.revision!==row.revision)return false;
 const fields={organizationId:p.p_organization_id,contactId:p.p_contact_id,currency:p.p_currency,validUntil:p.p_valid_until,deliveryPeriod:p.p_delivery_period.trim(),paymentTerms:p.p_payment_terms.trim(),notes:p.p_notes.trim(),commercialKind:p.p_commercial_kind,contractId:p.p_commercial_kind==='placement'?p.p_contract_id:null,installationRequired:p.p_installation_required,installationChargeNotes:p.p_installation_charge_notes.trim()};
 return Object.entries(fields).every(([key,value])=>s[key]===value)&&Array.isArray(s.lines)&&s.lines.length===p.p_lines.length&&s.lines.every((line,index)=>Object.entries(p.p_lines[index]).every(([key,value])=>line[key]===(['description','uom'].includes(key)?value.trim():value)));
}
function proformaDraftRecovery(state,text){
 if(!state.current())return;
 let panel=state.form.querySelector('[data-proforma-recovery]');if(!panel){panel=document.createElement('section');panel.dataset.proformaRecovery='';panel.className='notice';panel.innerHTML='<p data-proforma-recovery-message></p><div class="actions"><button type="button" data-proforma-check>Check saved status</button><button type="button" data-proforma-retry>Retry same save</button></div><p data-proforma-recovery-error class="error"></p>';state.form.querySelector('[data-proforma-save-feedback]').append(panel);}
 panel.querySelector('[data-proforma-recovery-message]').textContent=text;
 for(const [selector,action]of [['[data-proforma-check]',()=>checkProformaSave(state)],['[data-proforma-retry]',()=>retryProformaSave(state)]]){const button=panel.querySelector(selector);button.hidden=!state.pending;button.disabled=state.working;button.onclick=()=>{if(!state.current()||state.working||!state.pending)return;return run(action,{origin:button,errorTarget:panel.querySelector('[data-proforma-recovery-error]')});};}
 proformaDraftStatus(state);
}
function proformaDraftConfirmed(state,saved){
 const form=state.form;if(!state.current())return;const pending=state.pending,previousDraft=state.pendingPreviousDraft;
 const visible=proformaDraftCapture(state),changed=JSON.stringify([visible.fields,visible.lines])!==JSON.stringify([state.draft.fields,state.draft.lines]);
 state.unlock?.();state.unlock=null;if(JSON.stringify(state.foreignPending?.pending)===JSON.stringify(pending))state.foreignPending=null;state.pending=null;state.conflict='';state.draft=null;state.revision=saved.revision;form.querySelector('[type="submit"]').disabled=state.saveDisabled;
 form.dataset.id=saved.id;form.dataset.requestId=saved.id;form.dataset.version=String(saved.version);form.dataset.initialState=changed?'':salesEditorState(form);salesEditing=saved.id;salesPrefill=null;
 proformaDraftRemove(state.actor.user_id,pending,previousDraft);state.pendingPreviousDraft=null;form.querySelector('[data-proforma-recovery]')?.remove();salesProformas=[saved,...salesProformas.filter(row=>row.id!==saved.id)];salesLoaded=false;salesProformaPageKey='';
 if(changed)proformaDraftFlush(state);proformaDraftStatus(state);salesEditorSaved(form,'proforma',saved.id,'Pro forma saved.');proformaDraftGuard(state);
}
async function checkProformaSave(state){
 if(!state.current()||state.working||!state.pending)return;
 state.working=true;proformaDraftRecovery(state,'Checking the saved revision…');
 try{
  const result=await client.from('sales_proformas').select('id,document_number,version,revision,status,deleted_at,organization_id,contact_id,currency,valid_until,delivery_period,payment_terms,notes,commercial_kind,contract_id,installation_required,installation_charge_notes,internal_notes,subtotal_minor,discount_minor,tax_minor,total_minor,prepared_by,created_at,updated_at').eq('id',state.pending.p_id).limit(2);
  if(!state.current())return;if(result.error)throw result.error;
  const rows=result.data;if(!Array.isArray(rows)||rows.length!==1||!proformaPendingHeader(state,rows[0])){proformaDraftRecovery(state,'The saved outcome is still unconfirmed. Nothing was resent. Retry only this same save, or check again.');return;}
  const revision=await client.from('sales_proforma_revisions').select('revision,created_by,snapshot').eq('proforma_id',state.pending.p_id).eq('revision',state.revision+1).limit(2);
  if(!state.current())return;if(revision.error)throw revision.error;
  if(!Array.isArray(revision.data)||revision.data.length!==1||!proformaPendingRevision(state,revision.data[0])){proformaDraftRecovery(state,'The stored revision does not confirm this exact save. Nothing was resent.');return;}
  proformaDraftConfirmed(state,rows[0]);
 }catch(error){if(state.current())proformaDraftRecovery(state,'Save confirmation could not be checked. Nothing was resent. '+(error.message||'Try again.'));}
 finally{state.working=false;if(state.current()&&state.pending)proformaDraftRecovery(state,state.form.querySelector('[data-proforma-recovery-message]').textContent);}
}
async function retryProformaSave(state){
 if(!state.current()||state.working||!state.pending)return;
 state.working=true;state.form.dataset.saving='true';proformaDraftRecovery(state,'Retrying the same document and revision…');
 try{const result=await client.rpc('save_sales_proforma',JSON.parse(JSON.stringify(state.pending)));if(!state.current())return;if(result.error)throw result.error;const saved=Array.isArray(result.data)?result.data.length===1?result.data[0]:null:result.data;if(!proformaPendingHeader(state,saved))throw Error('The response did not confirm this exact revision.');proformaDraftConfirmed(state,saved);}
 catch(error){if(state.current())proformaDraftRecovery(state,'Save confirmation remains pending. Check saved status before making changes. '+(error.message||'Connection unavailable.'));}
 finally{state.working=false;state.form.dataset.saving='false';if(state.current()&&state.pending)proformaDraftRecovery(state,state.form.querySelector('[data-proforma-recovery-message]').textContent);}
}
async function salesConfirmLeave(current=workspaceNavigationContext().current){
 const actor=me,epoch=salesEpoch,sourceView=view,form=document.querySelector('#proformaForm,#deliveryForm');
 if(!current())return false;
 if(form?.id==='proformaForm'&&proformaDraftContexts.get(form)?.pending){message('Check the pending Pro forma save before leaving this form.',true);return false;}
 if(form?.dataset.saving==='true'){message('Wait for this save to finish before leaving the form.',true);return false;}
 if(!salesEditorChanged(form))return true;
 const state=salesEditorState(form);
 if(!await askConfirm({title:'Discard unsaved changes?',body:'Your changes to this form will be lost.',confirmLabel:'Discard changes',tone:'danger'}))return false;
 if(!current()||me!==actor||salesEpoch!==epoch||view!==sourceView||!form.isConnected||document.querySelector('#proformaForm,#deliveryForm')!==form||form.dataset.saving==='true'||salesEditorState(form)!==state)return false;
 if(form.id==='proformaForm'){const draft=proformaDraftContexts.get(form);if(draft?.timer)clearTimeout(draft.timer);proformaDraftRemove(actor.user_id,null,draft?.draft);}form.dataset.initialState=state;return true;
}
if(typeof window!=='undefined')window.addEventListener('beforeunload',event=>{
 const form=document.querySelector('#proformaForm,#deliveryForm');
 if(form?.dataset.saving==='true'||proformaDraftContexts.get(form)?.pending||salesEditorChanged(form)){event.preventDefault();event.returnValue='';}
});
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>proformaDraftFlush());
function salesNavigate(action){return run(async()=>{const context=workspaceNavigationContext();if(await confirmWorkspaceLeave(context.current)&&context.current())return action();});}
function salesLockForm(form){
 const controls=[...form.querySelectorAll('input,select,textarea,button')],disabled=controls.map(control=>control.disabled);
 controls.forEach(control=>{control.disabled=true;});
 return ()=>controls.forEach((control,index)=>{control.disabled=disabled[index];});
}
const salesTabs=[['proformas','Pro forma invoices'],['delivery','Delivery notes'],['documents','Official forms & PDFs']];
const salesWorkflowSteps=[
 ['submitted','Pro forma submitted'],['accounts_approved','Accounts approved'],['tax_invoice_created','Invoice linked · stock reserved'],['sent_to_sales','Sent to downstairs sales'],['packing','Packing in progress'],['ready','Ready for delivery'],['out_for_delivery','Out for delivery'],['delivered','Delivery note signed']
];
function salesOrganization(id){return orgIndex.get(id)||{name:'Client unavailable',location:''}}
function salesContact(id){return rowById(contacts,id)||{first_name:'Contact',last_name:'unavailable'} }
function salesContactName(id){const c=salesContact(id);return [c.title==='N/A'?'':c.title,c.first_name,c.last_name].filter(Boolean).join(' ')}
function salesProduct(id){return rowById(products,id)||{name:'Product unavailable',sku:''}}
function salesProforma(id){return rowById(salesProformas,id)}
function salesLines(id){return [...rowsWhere(salesProformaLines,'proforma_id',id)].sort((a,b)=>a.sort_order-b.sort_order)}
function deliveryLines(id){return [...rowsWhere(salesDeliveryLines,'delivery_note_id',id)]}
function salesDate(offset=0){return companyDate(offset)}
function salesDeliveryTone(status){return statusTone(({accounts_approved:'invoice_pending',tax_invoice_created:'reserved',sent_to_sales:'in_progress',ready:'in_progress',out_for_delivery:'in_transit'})[status]||status);}
function salesStatus(value){return ({draft:'Draft',sent:'Sent to client',accepted:'Pro forma submitted',accounts_approved:'Accounts approved',tax_invoice_created:'Invoice linked · stock reserved',sent_to_sales:'Sent to downstairs sales',packing:'Packing in progress',ready:'Ready for delivery',out_for_delivery:'Out for delivery',delivered:'Delivery note signed',rejected:'Rejected',cancelled:'Cancelled'})[value]||String(value||'').replaceAll('_',' ')}
function latestDelivery(proformaId){return rowsWhere(salesDeliveryNotes,'proforma_id',proformaId).find(note=>note.status!=='cancelled')}
function openDelivery(proformaId){return rowsWhere(salesDeliveryNotes,'proforma_id',proformaId).find(note=>!['cancelled','delivered'].includes(note.status))}
function salesFulfillment(record){const notes=rowsWhere(salesDeliveryNotes,'proforma_id',record.id);return proformaFulfillment(salesLines(record.id),notes.flatMap(note=>deliveryLines(note.id)),notes)}
function hasRemainingDelivery(record){const notes=rowsWhere(salesDeliveryNotes,'proforma_id',record.id),lines=notes.flatMap(note=>deliveryLines(note.id));return salesLines(record.id).some(line=>remainingDeliveryQuantity(line,lines,notes)>0)}
function canCreateDelivery(record){return record.status==='accepted'&&hasRemainingDelivery(record)}
function workflowIndex(record,note){if(record?.status!=='accepted')return -1;if(!note)return 0;return salesWorkflowSteps.findIndex(([status])=>status===note.status)}
function workflowProgress(record,note){const current=workflowIndex(record,note);return `<ol class="workflow-progress" aria-label="Order progress">${salesWorkflowSteps.map(([status,label],index)=>`<li class="${index<current?'complete':index===current?'current':''}" ${index===current?'aria-current="step"':''}><span>${index<current?'✓':index+1}</span><small>${esc(label)}</small></li>`).join('')}</ol><details class="workflow-history" data-order-timing data-proforma="${esc(record?.id||'')}" data-delivery="${esc(note?.id||'')}"><summary>Step durations, waiting time and staff</summary><button type="button" data-load-order-timing>Load / refresh timing</button><div data-order-timing-output role="status">Load complete history to calculate durations.</div></details>`}
async function loadOrderTiming(panel){
 const actor=me,epoch=salesEpoch,target=panel.querySelector('[data-order-timing-output]'),button=panel.querySelector('button');
 const current=()=>me===actor&&salesEpoch===epoch&&view==='sales'&&panel.isConnected;
 button.disabled=true;target.textContent='Loading complete event history…';
 try{
  const id=panel.dataset.proforma,noteId=panel.dataset.delivery;
  const [events,delivery,recordResult]=await Promise.all([
   fetchOrderEvents(client,'sales_proforma_events','proforma_id',id),
   noteId?fetchOrderEvents(client,'sales_delivery_events','delivery_note_id',noteId):Promise.resolve([]),
   client.from(noteId?'sales_delivery_notes':'sales_proformas').select('status,version').eq('id',noteId||id).single()
  ]);
  if(!current())return;
  if(recordResult.error||!recordResult.data)throw Error('Current order status could not be verified.');
  // Accounts approval starts a separate delivery stream from an accepted proforma.
  const combined=events.map(event=>({...event,id:'proforma:'+event.id}));
  delivery.forEach((event,index)=>combined.push({...event,id:'delivery:'+event.id,from_status:index===0&&event.from_status==null?'accepted':event.from_status}));
  const now=Date.now(),timing=orderTiming(combined,recordResult.data.status,now);
  const date=value=>value?new Date(value).toLocaleString('en-TZ'):'—',who=value=>value===actor?.user_id?'You':value||'Unknown';
  target.innerHTML=`<p>Total elapsed: <strong>${esc(orderDuration(timing.totalMs))}</strong> · Current waiting: <strong>${esc(orderDuration(timing.waitingMs))}</strong></p><p>As of ${esc(date(now))}. Refresh for current waiting time. ${noteId?'This delivery path only. ':''}${timing.reliable?'':'History has missing or inconsistent transitions; unknown durations are not estimated.'}</p><div class="table-wrap"><table><thead><tr><th>Step / visit</th><th>Started</th><th>Started by</th><th>Ended</th><th>Ended by</th><th>Duration</th></tr></thead><tbody>${timing.visits.map(visit=>`<tr><td>${esc(salesStatus(visit.status))}</td><td>${esc(date(visit.startedAt))}</td><td>${esc(who(visit.startedBy))}</td><td>${esc(date(visit.endedAt))}</td><td>${esc(who(visit.endedBy))}</td><td>${esc(orderDuration(visit.durationMs))}</td></tr>`).join('')}</tbody></table></div>`;
 }catch(error){if(current())target.textContent='Timing unavailable: '+error.message;}
 finally{if(current())button.disabled=false;}
}
function deliveryHistory(note){const events=salesDeliveryEvents.filter(event=>event.delivery_note_id===note.id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));if(!events.length)return '';return `<details class="workflow-history"><summary>Who changed this order and when</summary>${events.map(event=>`<div><strong>${esc(salesStatus(event.to_status))}</strong><small>${esc(employeeName(event.actor_user_id))} · ${esc(new Date(event.created_at).toLocaleString('en-TZ'))}${event.reference?' · '+esc(event.reference):''}</small></div>`).join('')}</details>`}
// Page parents and related rows independently so the server row limit cannot hide history.
async function salesRegisterRows(table){
 const actor=me,epoch=salesEpoch,data=[];
 for(let offset=0;;offset+=1000){
  const result=await client.from(table).select('*').order('created_at',{ascending:false}).order('id').range(offset,offset+999);
  if(me!==actor||salesEpoch!==epoch)return {data:[]};
  if(result.error)return {error:result.error};
  data.push(...(result.data||[]));
  if((result.data||[]).length<1000)return {data};
 }
}
async function salesRowsFor(table,column,ids,order){
 const actor=me,epoch=salesEpoch,out=[];
 for(let i=0;i<ids.length;i+=100){
  const chunk=ids.slice(i,i+100);
  for(let offset=0;;offset+=1000){
   let query=client.from(table).select('*').in(column,chunk);
   if(order)query=query.order(order);
   const result=await query.order('id').range(offset,offset+999);
   if(me!==actor||salesEpoch!==epoch)return {data:[]};
   if(result.error)return {error:result.error};
   out.push(...(result.data||[]));
   if((result.data||[]).length<1000)break;
  }
 }
 return {data:out};
}
async function loadSalesDelivery(){
 const actor=me,epoch=salesEpoch,request=++salesLoadRequest,current=()=>me===actor&&salesEpoch===epoch&&request===salesLoadRequest;
 salesLoadError='';
 const requests=await Promise.all([
  salesRegisterRows('sales_proformas'),Promise.resolve({data:[]}),Promise.resolve({data:[]}),
  salesRegisterRows('sales_delivery_notes'),Promise.resolve({data:[]}),Promise.resolve({data:[]})
 ]);
 if(!current())return;
 const failed=requests.find(result=>result.error);
 if(failed){salesLoaded=false;salesLoadError=failed.error.message||'Sales workflow schema has not been installed.';return;}
 if(salesFocusedProforma&&!requests[0].data?.some(row=>row.id===salesFocusedProforma)){
  const record=await client.from('sales_proformas').select('*').eq('id',salesFocusedProforma).single();
  if(!current())return;
  if(record.error||!record.data){salesLoaded=false;salesLoadError=record.error?.message||'Saved Pro forma unavailable.';return;}
  requests[0].data=[record.data,...(requests[0].data||[])];
 }
 const proformaIds=(requests[0].data||[]).map(row=>row.id),deliveryIds=(requests[3].data||[]).map(row=>row.id);
 const related=await Promise.all([
  salesRowsFor('sales_proforma_lines','proforma_id',proformaIds,'sort_order'),
  Promise.resolve({data:[]}),
  salesRowsFor('sales_delivery_lines','delivery_note_id',deliveryIds),
  Promise.resolve({data:[]})
 ]);
 if(!current())return;
 const linesFailed=related.find(result=>result.error);
 if(linesFailed){salesLoaded=false;salesLoadError=linesFailed.error.message||'Items could not load.';return;}
 [requests[1],requests[2],requests[4],requests[5]]=related;
 [salesProformas,salesProformaLines,salesProformaEvents,salesDeliveryNotes,salesDeliveryLines,salesDeliveryEvents]=requests.map(result=>result.data||[]);salesDeliveryHistoryLoaded.clear();salesDeliveryRefreshErrors.clear();salesProformaPageKey='';salesDeliveryPageKey='';salesLoaded=true;
}
async function loadSalesDeliveryHistory(ids){
 const actor=me,epoch=salesEpoch,request=salesLoadRequest,missing=[...new Set(ids)].filter(id=>!salesDeliveryHistoryLoaded.has(id));
 if(!missing.length)return;
 const result=await salesRowsFor('sales_delivery_events','delivery_note_id',missing,'created_at');
 if(me!==actor||salesEpoch!==epoch||salesLoadRequest!==request)return;
 if(result.error)throw Error(result.error.message||'Delivery history could not load.');
 salesDeliveryEvents=[...salesDeliveryEvents.filter(event=>!missing.includes(event.delivery_note_id)),...(result.data||[])];
 missing.forEach(id=>salesDeliveryHistoryLoaded.add(id));
}
async function loadSalesRevision(record){
 const key=record.id+':'+record.revision;
 if(salesRevisionSnapshots.has(key))return;
 const actor=me,epoch=salesEpoch,result=await client.from('sales_proforma_revisions').select('snapshot').eq('proforma_id',record.id).eq('revision',record.revision).single();
 if(me!==actor||salesEpoch!==epoch)return;
 if(result.error||!result.data?.snapshot)throw Error('The saved revision could not load. Refresh before printing this Pro forma.');
 salesRevisionSnapshots.set(key,result.data.snapshot);
}
function salesDocumentSnapshot(record){return salesRevisionSnapshots.get(record.id+':'+record.revision);}
function salesDocumentLines(record){
 const snapshot=salesDocumentSnapshot(record);
 if(!snapshot)return record.status==='draft'?salesLines(record.id):[];
 return (snapshot.lines||[]).map(line=>({product_id:line.productId,product_name:line.productName||'Historical product name not recorded',description:line.description,quantity:line.quantity,uom:line.uom,unit_price_minor:line.unitPriceMinor,discount_basis_points:line.discountBasisPoints,tax_basis_points:line.taxBasisPoints}));
}
function salesHeader({title,subtitle='',back='',actions=''}={}){const proforma=salesSection==='proformas'&&salesFocusedProforma&&!salesEditing;return workspacePageHeader({breadcrumbs:proforma?`<a href="#/go/sales/proformas">Pro formas</a><a href="#/proforma/${esc(salesFocusedProforma)}" aria-current="page">${esc(title||'Pro forma')}</a>`:'',title:title||(salesSection==='delivery'?'Delivery progress':salesEditing==='new'?'Create Pro forma':'Pro formas'),subtitle,back:back||(salesSection==='proformas'&&salesFocusedProforma&&!salesEditing?'<button type="button" data-proforma-back>← All Pro formas</button>':''),actions:`<button id="salesRefresh" type="button">Refresh list</button>${actions}`})}
function salesUnavailable(){return `${salesHeader()}<section class="card"><h2>Pro formas could not be loaded</h2><p class="warning">Press Refresh list. If it keeps happening, tell the owner. Nothing was changed.</p><p class="muted">${esc(salesLoadError)}</p></section>`}
// With the search box loaded (smart-lookup.js) a client <select> marked data-lookup-rows="organizations" holds only the
// chosen branch; the box offers all of them. Without it, every branch is listed as before.
function salesOrganizationOptions(selected=''){return (typeof lookupRowSources==='undefined'?organizations.slice().sort((a,b)=>a.name.localeCompare(b.name)):organizations.filter(row=>row.id===selected).slice(0,1)).map(row=>inventoryOption(row.id,`${row.name}${row.location?' · '+row.location:''}`,row.id===selected)).join('')}
function salesContactOptions(organizationId,selected=''){return contacts.filter(row=>row.organization_id===organizationId&&row.status!=='incorrect').sort((a,b)=>(a.first_name+' '+a.last_name).localeCompare(b.first_name+' '+b.last_name)).map(row=>inventoryOption(row.id,salesContactName(row.id),row.id===selected)).join('')}
// Labels must come from the reviewed product, the same one inventoryProductFromChoice matches against.
function salesProductChoices(){if(typeof lookupRowSources!=='undefined'&&typeof inventoryProductValues==='function')return '';return (typeof inventorySelectableProducts==='function'?inventorySelectableProducts():products.filter(p=>!p.deleted_at).map(p=>typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(p):p).sort((a,b)=>a.name.localeCompare(b.name))).map(product=>`<option value="${esc(inventoryProductChoice(product))}"></option>`).join('')}
function salesLineRow(line={}){const product=salesProduct(line.product_id),choice=line.product_id?inventoryProductChoice(product.id&&typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(product):product):'';return `<div class="document-line" data-proforma-line><label><span>Product</span><input name="productChoice" list="salesProductChoices" value="${esc(choice)}" placeholder="Start typing a product" required autocomplete="off"></label><label><span>Customer-facing description · required, editable</span><input name="description" value="${esc(line.description||'')}" required maxlength="4000"></label><label><span>Quantity</span><input name="quantity" type="number" min="1" step="1" value="${line.quantity||1}" required></label><label><span>Unit</span><input name="uom" value="${esc(line.uom||'unit')}" required maxlength="40"></label>${pricingLineFields(line)}<label><span>Tax %</span><input name="tax" type="number" min="0" max="100" step="0.01" value="${line.tax_basis_points===undefined?0:line.tax_basis_points/100}" required></label><button type="button" class="danger" data-remove-sales-line>Remove item</button></div>`}
function salesPrefillLineDescription(row){
 const product=inventoryProductFromChoice(row.querySelector('[name="productChoice"]').value),description=row.querySelector('[name="description"]');
 if(!product||!description)return;
 if(!description.value.trim()||description.value===description.dataset.autoDescription){description.value=product.name;description.dataset.autoDescription=product.name;}
}
// Before a second quote is made for the same client, show the open ones and who made them, so the team can
// check with that person instead of sending the client two different Pro formas.
let proformaExistingAsk=0;
async function proformaShowExisting(){
 const form=$('#proformaForm');if(!form)return;
 const org=form.querySelector('[name="organizationId"]')?.value,editing=form.dataset.id,ask=++proformaExistingAsk;
 let box=form.querySelector('#proformaExisting');
 if(!box){box=document.createElement('div');box.id='proformaExisting';form.querySelector('.grid')?.after(box);}
 box.className='';box.innerHTML='';if(!org)return;
 // Asked for this client only: the list on screen holds just the newest Pro formas of the whole company.
 const r=await client.from('sales_proformas').select('id,document_number,status,total_minor,currency,prepared_by,created_at').eq('organization_id',org).is('deleted_at',null).in('status',['draft','sent']).order('created_at',{ascending:false}).limit(20);
 if(ask!==proformaExistingAsk||!box.isConnected||r.error)return;
 const open=(r.data||[]).filter(row=>row.id!==editing);
 const label={draft:'Draft',sent:'Sent to customer'};
 box.className=open.length?'notice attention':'';
 box.innerHTML=open.length?`<strong>This client already has ${open.length===20?'20 or more':open.length} Pro forma${open.length>1?'s':''} not yet accepted.</strong> Check with the person who made it before sending another:<ul>${open.slice(0,5).map(row=>`<li>${esc(row.document_number)} · ${esc(label[row.status]||row.status)} · ${esc(moneyDisplay(Number(row.total_minor),row.currency))} · made by ${esc(typeof employeeName==='function'?employeeName(row.prepared_by):'')} · ${esc(new Date(row.created_at).toLocaleDateString())}</li>`).join('')}</ul>${open.length>5?`<p class="muted">and ${open.length-5} more under Pro formas.</p>`:''}`:'';
}
function proformaEditor(){
 const record=salesEditing==='new'?null:salesProforma(salesEditing),lines=record?salesLines(record.id):[{}],prefill=record?null:salesPrefill,organizationId=record?.organization_id||prefill?.organizationId||'',contactId=record?.contact_id||prefill?.contactId||'';
 return `<section class="card document-editor"><div class="heading"><div><small>${record?'REVISION '+record.revision:'NEW DOCUMENT'}</small><h2>${record?'Edit '+esc(record.document_number):'New Pro forma invoice'}</h2></div><button type="button" id="closeSalesEditor">Close</button></div><form id="proformaForm" data-id="${record?.id||''}" data-version="${record?.version||0}"><p data-proforma-errors class="error" role="alert"></p><section class="proforma-section" aria-labelledby="proformaClientHeading"><h3 id="proformaClientHeading">Client and terms</h3><div class="grid"><label><span>Client branch</span><select name="organizationId" required data-lookup-rows="organizations"><option value="">Choose client / branch</option>${salesOrganizationOptions(organizationId)}</select></label><label><span>Named contact</span><select name="contactId" required><option value="">Choose the branch first</option>${salesContactOptions(organizationId,contactId)}</select></label><label><span>Currency</span><select name="currency"><option ${record?.currency==='TZS'?'selected':''}>TZS</option><option ${record?.currency==='USD'?'selected':''}>USD</option><option ${record?.currency==='EUR'?'selected':''}>EUR</option></select></label><label><span>Valid until</span><input name="validUntil" type="date" min="${salesDate()}" value="${record?.valid_until||salesDate(15)}" required></label><label><span>Delivery period</span><input name="deliveryPeriod" value="${esc(record?.delivery_period||'As agreed after acceptance')}" required maxlength="300"></label><label><span>Payment terms</span><input name="paymentTerms" value="${esc(record?.payment_terms||'Payment before delivery')}" required maxlength="1000"></label><label class="wide"><span>Customer-facing notes · printed on quotation</span><textarea name="notes" maxlength="4000">${esc(record?.notes||'')}</textarea></label></div></section><section class="proforma-section" aria-labelledby="proformaCommercialHeading"><h3 id="proformaCommercialHeading">Commercial terms</h3>${proformaCommercialFields(record,organizationId)}</section><section class="proforma-section" aria-labelledby="proformaItemsHeading"><h3 id="proformaItemsHeading">Items</h3><datalist id="salesProductChoices" data-lookup-values="products">${salesProductChoices()}</datalist><div id="proformaLines">${lines.map(salesLineRow).join('')}</div><div class="actions"><button type="button" id="addSalesLine">+ Add item</button></div></section><div data-proforma-save-feedback class="no-print"><p data-proforma-storage-warning class="notice" hidden></p></div><footer data-proforma-footer class="proforma-save-bar no-print"><p data-proforma-draft-status></p><button type="submit">${record?'Save new revision':'Save Pro forma invoice'}</button></footer></form></section>`;
}
function proformaTable(record){const lines=salesDocumentLines(record);return `<div class="table-wrap"><table><thead><tr><th>Item</th><th class="numeric-cell">Qty</th><th class="numeric-cell">Unit price</th><th class="numeric-cell">Disc.</th><th class="numeric-cell">Tax</th><th class="numeric-cell">Total</th></tr></thead><tbody>${lines.map(line=>{const totals=proformaLineTotal({quantity:line.quantity,unitPriceMinor:Number(line.unit_price_minor),discountBasisPoints:line.discount_basis_points,taxBasisPoints:line.tax_basis_points});return `<tr><td><strong>${esc(line.product_name||salesProduct(line.product_id).name)}</strong><small>${esc(line.description)} · ${esc(line.uom)}</small></td><td class="numeric-cell">${line.quantity}</td><td class="numeric-cell">${esc(moneyDisplay(Number(line.unit_price_minor),record.currency))}</td><td class="numeric-cell">${line.discount_basis_points/100}%</td><td class="numeric-cell">${line.tax_basis_points/100}%</td><td class="numeric-cell">${esc(moneyDisplay(totals.total,record.currency))}</td></tr>`}).join('')}</tbody></table></div>`}
function proformaActions(record){const actions=proformaNextActions(record.status),buttons=[];if(record.status==='draft')buttons.push(`<button data-edit-proforma="${record.id}">Edit draft</button>`);if(record.status==='draft'&&!record.deleted_at&&me?.role==='owner')buttons.push(`<button type="button" class="danger" data-archive-business="proforma" data-id="${record.id}">Delete draft</button>`);for(const action of actions){const labels={send:'Record sent to client',accept:'Submit to accounting',revise:'Return for revision',reject:'Record rejected',cancel:'Cancel'};buttons.push(`<button data-proforma-action="${action}" data-id="${record.id}" class="${['reject','cancel'].includes(action)?'danger':''}">${labels[action]}</button>`)}buttons.push(`<button data-print-document="${record.id}">Print / PDF</button>`);if(typeof quotationDocumentsButton==='function')buttons.push(quotationDocumentsButton(record));return buttons.join('')}
function proformaCard(record){const snapshot=salesDocumentSnapshot(record),organization=snapshot?{name:snapshot.organizationName||'Historical client name not recorded',location:snapshot.organizationLocation||''}:record.status==='draft'?salesOrganization(record.organization_id):{name:'Saved revision unavailable',location:''},contactName=snapshot?(snapshot.contactName||'Historical contact name not recorded'):record.status==='draft'?salesContactName(record.contact_id):'Saved revision unavailable',note=latestDelivery(record.id);if(snapshot)record={...record,currency:snapshot.currency,valid_until:snapshot.validUntil,delivery_period:snapshot.deliveryPeriod,payment_terms:snapshot.paymentTerms,notes:snapshot.notes,commercial_kind:snapshot.commercialKind||'sale',contract_id:snapshot.contractId||null,installation_required:snapshot.installationRequired??true,installation_charge_notes:snapshot.installationChargeNotes||'',subtotal_minor:snapshot.subtotalMinor,discount_minor:snapshot.discountMinor,tax_minor:snapshot.taxMinor,total_minor:snapshot.totalMinor};return `<article class="card document-card" data-document-card="${record.id}">${companyFormBrand()}<h2>PRO FORMA INVOICE</h2><div class="heading"><div><h2>${esc(record.document_number)}</h2><p>${esc(organization.name)} · ${esc(organization.location||'Location not supplied')}<br>Contact: ${esc(contactName)}</p></div><div>${proformaTagHtml(record)}<small>Revision ${record.revision}</small></div></div><div class="no-print">${workflowProgress(record,note)}${typeof orderLiveHtml==='function'?orderLiveHtml(record):''}</div>${proformaCommercialSummary(record)}${proformaTable(record)}<div class="document-totals"><span>Subtotal <strong>${esc(moneyDisplay(Number(record.subtotal_minor),record.currency))}</strong></span><span>Discount <strong>${esc(moneyDisplay(Number(record.discount_minor),record.currency))}</strong></span><span>Tax <strong>${esc(moneyDisplay(Number(record.tax_minor),record.currency))}</strong></span><span>Total <strong>${esc(moneyDisplay(Number(record.total_minor),record.currency))}</strong></span></div><div class="details"><div><small>Valid until</small>${esc(record.valid_until)}</div><div><small>Delivery period</small>${esc(record.delivery_period)}</div><div><small>Payment terms</small>${esc(record.payment_terms)}</div><div><small>Customer acceptance / LPO</small>${esc(record.acceptance_reference||'Not accepted yet')}</div><div><small>Prepared by</small>${esc(record.prepared_by?(typeof employeeName==='function'?employeeName(record.prepared_by):record.prepared_by):'Not recorded')}</div></div>${record.notes?`<p>${esc(record.notes)}</p>`:''}${companyProformaReferenceTerms()}<p>E. &amp; O.E. · Pro forma only — not a tax invoice or proof of payment.</p><div class="no-print">${note?deliveryHistory(note):''}</div><div class="actions no-print">${proformaActions(record)}</div></article>`}
// One tag per Pro forma, from where it is now: its own status, then the delivery started from it.
const proformaTagKinds=[['draft','Draft'],['revised','Revised'],['sent','Sent to customer'],['waiting','Waiting approval'],['delivery','Approved · in delivery'],['partial','Partially delivered'],['done','Delivered'],['closed','Cancelled / rejected']];
function proformaTag(record){
 if(record.register_summary)return record.register_tag;
 if(record.status==='cancelled'||record.status==='rejected')return 'closed';
 if(record.status==='draft')return record.revision>1?'revised':'draft';
 if(record.status==='sent')return 'sent';
 const note=latestDelivery(record.id);
 if(!note||note.status==='draft')return 'waiting';
 const fulfilled=salesFulfillment(record);
 return fulfilled==='complete'?'done':fulfilled==='partial'?'partial':'delivery';
}
function proformaTagHtml(record){const kind=proformaTag(record),label=proformaTagKinds.find(([key])=>key===kind)[1],tone=kind==='closed'?record.status==='rejected'?'rejected':'cancelled':({draft:'draft',revised:'draft',sent:'waiting',waiting:'awaiting_approval',delivery:'in_progress',partial:'partially_delivered',done:'delivered'})[kind];return `<span class="proforma-tag proforma-tag-${kind} chip chip--${statusTone(tone)}">${esc(label)}</span>`}
function proformaTile(record){
 const organization=record.register_summary?record.organization:salesOrganization(record.organization_id),when=record.updated_at||record.created_at;
 return `<li><button type="button" class="proforma-tile" data-open-proforma="${record.id}">${proformaTagHtml(record)}<strong>${esc(record.document_number)}</strong><span>${esc(organization.name)}${organization.location?' · '+esc(organization.location):''}</span><small>${esc(record.register_summary?record.contact_name:salesContactName(record.contact_id))}</small>${proformaItemsSummary(record)?`<small class="proforma-tile-items">${esc(proformaItemsSummary(record))}</small>`:''}${typeof orderLiveHtml==='function'?orderLiveHtml(record,'span'):''}<span class="proforma-tile-foot"><b>${esc(moneyDisplay(Number(record.total_minor),record.currency))}</b><small>${when?esc(new Date(when).toLocaleDateString()):''}${record.prepared_by&&typeof employeeName==='function'?' · '+esc(employeeName(record.prepared_by)):''}</small></span></button></li>`;
}
function proformaListScreen(){
 const page=salesProformaLanding()?salesProformaPageData:null,live=page?page.rows:salesProformas.filter(record=>!record.deleted_at),q=salesProformaSearch.trim().toLowerCase();
 const counts=page?page.counts:Object.fromEntries(proformaTagKinds.map(([key])=>[key,0]));if(!page)for(const record of live)counts[proformaTag(record)]++;
 const mineToday=page?page.counts.mine:live.filter(record=>proformaMineToday(record,me?.user_id)).length;
 const matches=page?page.rows:live.filter(record=>(salesProformaFilter==='all'||(salesProformaFilter==='placement'?record.commercial_kind==='placement':salesProformaFilter==='mine'?proformaMineToday(record,me?.user_id):proformaTag(record)===salesProformaFilter))&&(!q||`${record.document_number} ${salesOrganization(record.organization_id).name} ${salesOrganization(record.organization_id).location||''} ${salesContactName(record.contact_id)} ${record.acceptance_reference||''}`.toLowerCase().includes(q)));
 const shown=page?page.rows:matches.slice(0,salesShown);
 return `${salesHeader({subtitle:'Newest first. Press one to open it.',actions:'<button type="button" class="primary-action" id="newProforma">+ New Pro forma</button>'})}
 <label class="proforma-search"><span>Search</span><input id="proformaSearch" type="search" maxlength="2000" value="${esc(salesProformaSearch)}" placeholder="PF number, client, contact or LPO" autocomplete="off"></label>
 <div class="tabs proforma-filters" role="group" aria-label="Show Pro formas"><button type="button" data-proforma-filter="all" class="${salesProformaFilter==='all'?'active':''}" aria-pressed="${salesProformaFilter==='all'}">All · ${page?page.counts.all:live.length}</button><button type="button" data-proforma-filter="mine" class="proforma-filter-mine${salesProformaFilter==='mine'?' active':''}" aria-pressed="${salesProformaFilter==='mine'}">My orders today · ${mineToday}</button><button type="button" data-proforma-filter="placement" class="${salesProformaFilter==='placement'?'active':''}" aria-pressed="${salesProformaFilter==='placement'}">Placement · ${page?page.counts.placement:live.filter(row=>row.commercial_kind==='placement').length}</button>${proformaTagKinds.map(([key,label])=>`<button type="button" data-proforma-filter="${key}" class="proforma-filter-${key}${salesProformaFilter===key?' active':''}" aria-pressed="${salesProformaFilter===key}">${esc(label)} · ${counts[key]||0}</button>`).join('')}</div>
 ${page&&typeof discountPolicyHtml==='function'?discountPolicyHtml():''}
 ${shown.length?`<ul class="proforma-tiles">${shown.map(proformaTile).join('')}</ul>${!page&&matches.length>shown.length?`<p class="muted">Showing ${shown.length} of ${matches.length}.</p><button type="button" id="moreProformas">Show more Pro formas</button>`:''}`:(page?page.counts.all:live.length)?'<p class="empty">No Pro forma matches. Clear the search or choose All.</p>':'<div class="empty"><strong>No Pro formas yet.</strong><br>Press + New Pro forma to make the first one.</div>'}${page?`<div class="actions"><button type="button" id="proformaPrev" ${page.page===0?'disabled':''}>Previous</button><span role="status">${page.total} matching Pro formas · Page ${page.page+1} of ${page.pages} · 50 per page</span><button type="button" id="proformaNext" ${page.page+1>=page.pages?'disabled':''}>Next</button></div>`:''}`;
}
function proformaScreen(){
 if(salesEditing)return `${salesHeader()}${proformaEditor()}`;
 const open=salesFocusedProforma&&salesProformas.find(record=>record.id===salesFocusedProforma&&!record.deleted_at);
 if(open)return `${salesHeader({title:open.document_number,back:'<button type="button" data-proforma-back>← All Pro formas</button>'})}${typeof orderWorkflowHtml==='function'?orderWorkflowHtml(open):''}${proformaCard(open)}`;
 if(salesFocusedProforma)return `${salesHeader()}<p role="alert">This Pro forma is unavailable or you do not have access. Refresh to try again.</p>`;
 return proformaListScreen();
}
function haadiLots(productId){const hubIds=new Set(inventoryLocations.filter(row=>row.active&&row.is_dispatch_hub).map(row=>row.id));return inventoryLots.filter(row=>row.product_id===productId&&row.stock_status==='available'&&hubIds.has(row.location_id)&&row.loose_units-row.reserved_units>0)}
function deliveryEditor(record){
 return `<section class="card document-editor"><div class="heading"><div><small>FROM ${esc(record.document_number)}</small><h2>Delivery for an existing invoice</h2></div><button type="button" id="closeDeliveryEditor">Close</button></div><form id="deliveryForm" data-id="${record.id}" data-version="${record.version}"><p data-delivery-errors class="error" role="alert"></p><p class="muted">All fields are required.</p><div class="grid"><label><span>Accounts approval reference</span><input name="accountsReference" required maxlength="120" placeholder="Approval email, voucher or reference"></label><label><span>Expected delivery date</span><input name="expectedDeliveryDate" type="date" min="${salesDate()}" value="${salesDate()}" required></label></div>${deliveryCollectionChoice()}<p class="muted">For a new invoice, use Books → Customer invoices → Review quantities. This form is for an existing invoice with units still awaiting delivery. Link that invoice next to reserve its exact units.</p><p class="muted">Your account must have delivery access. The employee who records this approval is saved in the permanent history.</p><button type="submit">Record Accounts approval</button></form></section>`;
}
function packingFields(note){const reserved=deliveryLines(note.id);if(reserved.length)return `<p class="notice">Stock was reserved when the Tax Invoice was created. Confirm the team has started packing these reserved items.</p><ul>${reserved.map(line=>`<li>${esc(salesProduct(line.product_id).name)} · ${line.quantity} reserved</li>`).join('')}</ul>`;const record=salesProforma(note.proforma_id),rows=salesLines(record.id).map(line=>({line,remaining:remainingDeliveryQuantity(line,salesDeliveryLines,salesDeliveryNotes)})).filter(row=>row.remaining>0);return `<p>Select only the quantities being packed in this legacy delivery. Saving reserves those exact Haadi units so another order cannot use them.</p>${rows.map(({line,remaining})=>{const lots=haadiLots(line.product_id),key=line.id;return `<div class="delivery-pick"><label class="delivery-check"><input type="checkbox" name="include_${key}" ${lots.length?'':'disabled'}><span>${esc(salesProduct(line.product_id).name)} · ${remaining} ${esc(line.uom)} remaining</span></label><label><span>Haadi lot</span><select name="lot_${key}" ${lots.length?'':'disabled'}><option value="">Choose lot</option>${lots.map(lot=>inventoryOption(lot.id,`${lot.batch_number||'No batch'} · ${lot.loose_units-lot.reserved_units} available`)).join('')}</select></label><label><span>Quantity</span><input name="qty_${key}" type="number" min="1" max="${remaining}" value="${remaining}" ${lots.length?'':'disabled'}></label>${lots.length?'':'<p class="warning">No loose Haadi stock is available for this item.</p>'}</div>`}).join('')}`}
function deliveryCanFinishPacking(note){return note.packer_user_id===me?.user_id||me?.role==='owner'||(me?.role==='head'&&me?.department==='stores')}
function deliveryActions(note){const labels={tax_invoice:'Link ERP invoice & reserve stock',send_to_sales:'Send to downstairs sales',start_packing:'Start packing',ready:'Packing complete · ready for delivery',dispatch:'Mark out for delivery',deliver:'Record signed delivery note',cancel:'Cancel'};return `${deliveryNextActions(note.status).map(action=>`<button ${action==='ready'&&!deliveryCanFinishPacking(note)?'disabled title="Only the assigned packer or stores manager can finish packing"':''} data-delivery-action="${action}" data-id="${note.id}" class="${action==='cancel'?'danger':''}">${labels[action]}</button>`).join('')}<button data-print-document="${note.id}">Print / PDF</button>`}
function deliveryCard(note){if(salesDeliveryRefreshErrors.has(note.id))return `<article class="card document-card" data-document-card="${esc(note.id)}"><div class="heading"><h2>${esc(note.delivery_number)}</h2><span class="tag chip chip--${salesDeliveryTone(note.status)}">${esc(salesStatus(note.status))}</span></div><p role="alert">${esc(salesDeliveryRefreshErrors.get(note.id))}</p><div class="actions"><button type="button" data-delivery-retry="${esc(note.id)}">Refresh delivery details</button></div></article>`;const proforma=salesProforma(note.proforma_id),organization=salesOrganization(note.organization_id),lines=deliveryLines(note.id);return `<article class="card document-card" data-document-card="${note.id}"><div class="document-brand delivery-print-brand"><img src="assets/anudha-logo.svg" alt="Anudha Limited"><span>DELIVERY NOTE</span></div><div class="heading"><div><h2>${esc(note.delivery_number)}</h2><p>${esc(organization.name)} · ${esc(organization.location||'Location not supplied')}<br>Contact: ${esc(salesContactName(note.contact_id))}</p></div><span class="tag chip chip--${salesDeliveryTone(note.status)}">${esc(salesStatus(note.status))}</span></div><div class="actions no-print">${deliveryActions(note)}</div>${deliveryCollectionHtml(note)}${workflowProgress(proforma,note)}${!note.tax_invoice_reference&&['ready','out_for_delivery','delivered'].includes(note.status)?'<p class="warning">Legacy order: the tax invoice reference was not verified during migration.</p>':''}<div class="details"><div><small>Accepted Pro forma</small>${esc(proforma?.document_number||'Unavailable')}</div><div><small>Accounts approval</small>${esc(note.accounts_reference)}</div><div><small>Tax invoice</small>${esc(note.tax_invoice_reference||'Not created yet')}</div><div><small>Expected delivery</small>${esc(note.expected_delivery_date)}</div><div><small>Driver / out-for-delivery reference</small>${esc([note.carrier,note.tracking_reference].filter(Boolean).join(' · ')||'Not out for delivery')}</div></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th>Haadi lot</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${esc(salesProduct(line.product_id).name)}</td><td>${line.quantity}</td><td>${esc(inventoryLots.find(lot=>lot.id===line.lot_id)?.batch_number||'No batch')}</td></tr>`).join('')}</tbody></table></div>${note.status==='delivered'?`<p><strong>Received by:</strong> ${esc(note.recipient_name)} · <strong>Signed delivery note:</strong> ${esc(note.proof_reference)}</p><p class="notice">This delivery is complete.${proforma&&salesFulfillment(proforma)!=='complete'?' Remaining order quantities still require delivery.':''} ${proforma?.installation_required===false?'Installation was not requested. Equipment remains available for later service intake.':'Delivered machines are registered for installation; existing open jobs are reused.'}</p>`:''}${deliveryHistory(note)}</article>`}
function deliverySummaryResponsible(note){
 const owner=note.responsible;if(!owner)return '<small>Current step owner: Unassigned</small>';
 const delay=note.responsible_delay,level=typeof workAgeLevel==='function'?workAgeLevel(owner,delay):'',name=owner.assignee_name||employeeName(owner.assignee_user_id),sender=owner.sender_name||employeeName(owner.assigned_by);
 return `<small class="${level?'work-age-'+level:''}">Current step owner: <strong>${esc(name)}</strong> · ${esc(owner.task)}${typeof workDuration==='function'?' · waiting '+esc(workDuration(Date.now()-Date.parse(owner.created_at))):''}${owner.due_on?' · due '+esc(owner.due_on):''} · sent by ${esc(sender)}${delay?' · Staff task expected '+esc(delay.expected_on)+': '+esc(delay.reason):''}</small>`;
}
function deliverySummaryTile(note){
 const open=!['delivered','cancelled'].includes(note.status);
 return `<li><button type="button" class="proforma-tile" data-open-delivery="${esc(note.id)}"><span class="proforma-tag chip chip--${salesDeliveryTone(note.status)}">${esc(salesStatus(note.status))}</span><strong>${esc(note.delivery_number)}</strong><span>${esc(note.organization.name)}${note.organization.location?' · '+esc(note.organization.location):''}</span><small>${esc(note.contact_name)}</small><small>${esc(note.proforma_number)} · Expected ${esc(note.expected_delivery_date)}</small><small>Tax invoice: ${esc(note.tax_invoice_reference||'Not linked yet')}</small>${note.customer_waiting?'<span class="packing-badge">Customer waiting — cash, collecting now</span>':''}${note.status==='packing'&&note.packer_user_id?`<small>Being packed by <strong>${esc(note.packer_name||employeeName(note.packer_user_id))}</strong></small>`:''}${note.status==='sent_to_sales'&&note.packing_blocked_reason?`<small class="packing-warn-text">${esc(note.packing_blocked_reason)}</small>`:''}${open&&!note.customer_waiting&&note.promised_by&&typeof packingPromiseText==='function'?`<small>${esc(packingPromiseText(note))}</small>`:''}${open&&typeof packingCallCustomer==='function'&&packingCallCustomer(note)?'<strong class="packing-call-text">Call the customer: more than 2 days past the promise</strong>':''}${deliverySummaryResponsible(note)}<span class="proforma-tile-foot"><b>Open delivery & next actions</b><small>${esc(new Date(note.created_at).toLocaleDateString())}</small></span></button></li>`;
}
function deliveryListScreen(){
 const page=salesDeliveryPageData,awaiting=salesDeliveryFilter==='awaiting';
 return `${salesHeader({subtitle:awaiting?'Review the whole order or use an existing invoice with units still awaiting delivery.':'Open a delivery for its next action, items, documents and complete history.'})}<h2>${awaiting?'Orders with quantities still awaiting delivery':'Delivery register'}</h2><div class="tabs" role="group" aria-label="Show delivery records"><button type="button" id="deliveryNotesTab" class="${awaiting?'':'active'}" aria-pressed="${!awaiting}">Delivery notes · ${page.counts.notes}</button><button type="button" id="deliveryAwaitingTab" class="${awaiting?'active':''}" aria-pressed="${awaiting}">Orders awaiting delivery · ${page.counts.awaiting}</button></div>${page.rows.length?`<ul class="proforma-tiles">${awaiting?page.rows.map(record=>`<li><article class="card"><h3>${esc(record.document_number)}</h3><p>${esc(record.organization.name)}${record.organization.location?' · '+esc(record.organization.location):''}<br>${esc(record.contact_name)}</p><div class="actions"><button type="button" data-order-proforma="${esc(record.id)}">Review whole order</button><button type="button" data-create-delivery="${esc(record.id)}">Use existing invoice</button></div></article></li>`).join(''):page.rows.map(deliverySummaryTile).join('')}</ul>`:`<p class="empty">${awaiting?'No orders have unallocated quantities awaiting delivery.':'No delivery notes yet. Accept the Pro forma, then choose invoice quantities in Books. Posting creates its delivery note.'}</p>`}<div class="actions"><button type="button" id="deliveryPrev" ${page.page===0?'disabled':''}>Previous</button><span role="status">${page.total} ${awaiting?'orders':'delivery notes'} · Page ${page.page+1} of ${page.pages} · 50 per page</span><button type="button" id="deliveryNext" ${page.page+1>=page.pages?'disabled':''}>Next</button></div>`;
}
function deliveryScreen(){
 if(salesDeliveryLanding())return deliveryListScreen();
 const focused=!salesEditing&&salesFocusedDelivery&&salesDeliveryNotes.find(note=>note.id===salesFocusedDelivery);
 if(!salesEditing&&salesFocusedDelivery&&!focused)return `${salesHeader({back:'<button type="button" data-delivery-back>← All delivery notes</button>'})}<p role="alert">This delivery is unavailable or you do not have access. Refresh to try again.</p>`;
 if(focused)return `${salesHeader({title:focused.delivery_number,back:'<button type="button" data-delivery-back>← All delivery notes</button>',actions:`<button type="button" data-order-proforma="${esc(focused.proforma_id)}">View whole order</button>`})}${deliveryCard(focused)}`;
 return `${salesHeader()}${salesEditing&&salesEditing!=='new'?deliveryEditor(salesProforma(salesEditing)):''}`;
}
function officialDocumentsScreen(){return `${salesHeader()}<div class="heading"><div><h2>Official forms and printable records</h2><p class="muted">Use the approved Anudha forms. Completed Pro formas and delivery notes are printed from their own record cards.</p></div></div><div class="official-document-grid"><article class="card"><small>WORKFLOW 1 · SALES</small><h3>Pro forma invoice</h3><p>Open a Pro forma record and choose <strong>Print / PDF</strong>. Its current revision, client, items, prices, tax and terms are printed together.</p><button type="button" data-sales-section="proformas">Open Pro formas</button></article><article class="card"><small>WORKFLOW 1 · DELIVERY</small><h3>Delivery note</h3><p>Open a delivery record and choose <strong>Print / PDF</strong>. The signed reference and recipient remain attached to the closed order.</p><button type="button" data-sales-section="delivery">Open delivery notes</button></article><article class="card"><small>WORKFLOW 2 · INSTALLATION</small><h3>Equipment handover and installation report</h3><p>The official Anudha equipment handover and installation form.</p><a class="button" href="official-documents/equipment-handover-installation-report.pdf" target="_blank" rel="noopener">Open / print PDF</a></article><article class="card"><small>WORKFLOW 2 · SERVICE</small><h3>Service work report</h3><p>The official Anudha service report for field work, parts, customer sign-off and completion.</p><a class="button" href="official-documents/service-work-report.pdf" target="_blank" rel="noopener">Open / print PDF</a></article></div><p class="warning">These blank official forms contain no client data and are included as approved print references. The next service build will turn their fields into connected records and generate completed PDFs from the website.</p>`}
async function requestSalesProformaPage(){
 const result=await client.rpc('sales_proforma_page',{p_query:salesProformaSearch,p_filter:salesProformaFilter,p_page:salesProformaPage});
 if(result.error)throw Error(result.error.message||'Pro formas could not load.');
 const data=result.data;
 if(!data||!Array.isArray(data.rows)||data.rows.length>50||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages<1||data.page>=data.pages||!data.counts||['all','mine','placement'].some(key=>!Number.isSafeInteger(data.counts[key])||data.counts[key]<0)||data.pages!==Math.max(1,Math.ceil(data.total/50))||data.rows.length!==Math.min(50,Math.max(0,data.total-data.page*50))||!Array.isArray(data.live_status)||!Object.hasOwn(data,'discount_policy')||data.rows.some(row=>!row.register_summary||!row.organization||!proformaTagKinds.some(([tag])=>tag===row.register_tag)))throw Error('The server did not return a complete Pro forma page.');
 return data;
}
async function requestSalesDeliveryPage(){
 const result=await client.rpc('sales_delivery_page',{p_filter:salesDeliveryFilter,p_page:salesDeliveryPage});
 if(result.error)throw Error(result.error.message||'Delivery records could not load.');
 const data=result.data;
 if(!data||data.filter!==salesDeliveryFilter||!Array.isArray(data.rows)||data.rows.length>50||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages<1||data.page>=data.pages||!data.counts||['notes','awaiting'].some(key=>!Number.isSafeInteger(data.counts[key])||data.counts[key]<0)||data.total!==data.counts[data.filter]||data.pages!==Math.max(1,Math.ceil(data.total/50))||data.rows.length!==Math.min(50,Math.max(0,data.total-data.page*50))||new Set(data.rows.map(row=>row.id)).size!==data.rows.length||data.rows.some(row=>!row.register_summary||!row.id||typeof row.organization?.name!=='string'||typeof row.contact_name!=='string'||!row.created_at||row.kind!==(data.filter==='notes'?'delivery':'awaiting')||(row.kind==='delivery'?typeof row.delivery_number!=='string'||typeof row.status!=='string'||!row.expected_delivery_date||!Object.hasOwn(row,'responsible'):typeof row.document_number!=='string')))throw Error('The server did not return a complete delivery page.');
 return data;
}
async function salesDeliveryWorkspace(force=false,navigation=workspaceNavigationContext()){
 if(!await salesConfirmLeave(navigation.current)||!navigation.current())return;
 const actor=me,epoch=salesEpoch,loadEpoch=sessionLoadEpoch,request=++salesWorkspaceRequest;
 syncWorkspaceNavigation();
 const hash=location.hash,navigationRequest=workspaceLeaveSequence,current=()=>me===actor&&loadEpoch===sessionLoadEpoch&&salesEpoch===epoch&&request===salesWorkspaceRequest&&view==='sales'&&location.hash===hash&&navigationRequest===workspaceLeaveSequence;
 if(!salesProformaLanding()||!$('#proformaSearch'))workspaceLoading('Loading Pro forma invoices and deliveries…');
 if(salesSection==='documents'){$('#content').innerHTML=officialDocumentsScreen();bindSalesDelivery();return;}
 if(salesDeliveryLanding()){
  const key=JSON.stringify([salesDeliveryFilter,salesDeliveryPage]);
  try{
   const fresh=force||!salesDeliveryPageData||key!==salesDeliveryPageKey,data=fresh?await requestSalesDeliveryPage():salesDeliveryPageData;
   if(!current()||!salesDeliveryLanding())return;
   if(fresh)salesLoaded=false;
   salesDeliveryPageData=data;salesDeliveryPage=data.page;salesDeliveryPageKey=JSON.stringify([salesDeliveryFilter,data.page]);
   $('#content').innerHTML=deliveryListScreen();bindSalesDelivery();
  }catch(error){if(current()&&salesDeliveryLanding()){salesDeliveryPageData=null;salesDeliveryPageKey='';salesLoadError=error.message;$('#content').innerHTML=salesUnavailable();bindSalesDelivery();}}
  return;
 }
 if(salesProformaLanding()){
  const key=JSON.stringify([salesProformaSearch,salesProformaFilter,salesProformaPage,companyDate()]);
  try{
   const fresh=force||!salesProformaPageData||key!==salesProformaPageKey,data=fresh?await requestSalesProformaPage():salesProformaPageData;
   if(!current()||!salesProformaLanding())return;
   if(fresh)salesLoaded=false;
   salesProformaPageData=data;salesProformaPage=data.page;salesProformaPageKey=JSON.stringify([salesProformaSearch,salesProformaFilter,data.page,companyDate()]);
   if(typeof discountPolicy!=='undefined')discountPolicy=data.discount_policy;
   if(fresh&&typeof liveStatusCache!=='undefined'){const live=new Map(data.live_status.map(row=>[row.proforma_id,row]));for(const row of data.rows)liveStatusCache.set(row.id,{at:Date.now(),row:live.get(row.id)||null});}
   const draw=()=>{$('#content').innerHTML=proformaListScreen();bindSalesDelivery();},input=$('#proformaSearch');
   if(input&&document.activeElement===input)renderSearchPreservingPosition(input,draw);else draw();
  }catch(error){if(current()&&salesProformaLanding()){salesProformaPageData=null;salesProformaPageKey='';salesLoadError=error.message;$('#content').innerHTML=salesUnavailable();bindSalesDelivery();}}
  return;
 }
 if(!listsLoaded){
  try{await loadLists();if(current()&&!listsLoaded)throw Error('Customer and product records could not load. Refresh before opening this action.');}
  catch(error){if(current()){salesLoadError=error.message;$('#content').innerHTML=salesUnavailable();bindSalesDelivery();}return;}
 }
 if(!current())return;
 if(force||!salesLoaded)await loadSalesDelivery();
 if(!current())return;
 if(!salesLoaded){$('#content').innerHTML=salesUnavailable();bindSalesDelivery();return;}
 const focused=salesFocusedProforma&&salesProforma(salesFocusedProforma);
 // Stock and corrected picker data are needed only after opening an order or editor.
 if((focused||salesEditing||salesSection==='delivery')&&!inventoryLoaded){
  try{await loadInventoryOperations();if(!current())return;if(!inventoryLoaded)throw Error(inventoryLoadError||'Inventory could not load. Refresh before opening this action.');}
  catch(error){if(current()){$('#content').innerHTML=`${salesHeader()}<p role="alert">${esc(error.message)}</p>`;bindSalesDelivery();}return;}
 }
 if(salesSection==='delivery'||(focused&&!salesEditing)){
  const ids=salesSection==='delivery'?[salesFocusedDelivery].filter(Boolean):[latestDelivery(focused.id)?.id].filter(Boolean);
  try{await loadSalesDeliveryHistory(ids);}catch(error){if(current()){$('#content').innerHTML=`${salesHeader()}<p role="alert">${esc(error.message)}</p>`;bindSalesDelivery();}return;}
  if(!current())return;
 }
 if(focused&&!salesEditing){
  try{await loadSalesRevision(focused);}catch(error){if(current()){$('#content').innerHTML=`${salesHeader()}<p class="warning">${esc(error.message)}</p>`;bindSalesDelivery();}return;}
  if(!current())return;
 }
 if(salesEditing&&salesSection==='proformas'){
  try{await Promise.all([pricingLoad(),loadProformaContracts()]);}catch(error){if(current()){$('#content').innerHTML=`${salesHeader()}<p role="alert">${esc(error.message)}</p>`;bindSalesDelivery();}return;}
  if(!current())return;
 }
 $('#content').innerHTML=salesSection==='delivery'?deliveryScreen():salesSection==='documents'?officialDocumentsScreen():proformaScreen();bindSalesDelivery();
}
function readProformaLines(form){return [...form.querySelectorAll('[data-proforma-line]')].map(row=>{const product=inventoryProductFromChoice(row.querySelector('[name="productChoice"]').value);if(!product)throw Error('Choose every product from the search suggestions.');const quantity=Number(row.querySelector('[name="quantity"]').value),discount=Number(row.querySelector('[name="discount"]').value),tax=Number(row.querySelector('[name="tax"]').value);if(!Number.isSafeInteger(quantity)||quantity<1)throw Error('Every quantity must be a positive whole number.');if(!Number.isFinite(discount)||discount<0||discount>100||!Number.isFinite(tax)||tax<0||tax>100)throw Error('Discount and tax must be between 0% and 100%.');return {productId:product.id,description:row.querySelector('[name="description"]').value.trim(),quantity,uom:row.querySelector('[name="uom"]').value.trim(),...pricingReadLine(row,{quantity,unitPriceMinor:moneyMinor(row.querySelector('[name="unitPrice"]').value)}),taxBasisPoints:Math.round(tax*100)}})}
const proformaValidationContexts=new WeakMap();
function proformaFieldErrors(form){
 for(const row of form.querySelectorAll('[data-proforma-line]'))pricingRefreshRow(row,form,{replacePrice:false});
 return nativeFormErrors(form);
}
function proformaValidationSummary(form,count=form.querySelectorAll('.field-error').length){
 actionFeedbackShow(actionFeedbackReference(form.querySelector('[type="submit"]')),fieldErrorSummary(count),'error',form.querySelector('[data-proforma-errors]'));
}
function proformaBindValidation(form){
 if(!form||proformaValidationContexts.has(form))return;
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,touched=new WeakSet(),current=()=>me===actor&&salesEpoch===epoch&&salesWorkspaceRequest===request&&view==='sales'&&form.isConnected&&$('#proformaForm')===form;
 proformaValidationContexts.set(form,{current,touched});form.noValidate=true;
 form.addEventListener('focusout',event=>{
  const control=fieldValidationSource(event.target);if(!current()||form.dataset.saving==='true'||!form.contains(control)||!control.matches('input,select,textarea'))return;
  touched.add(control);const row=control.closest('[data-proforma-line]');if(row)pricingRefreshRow(row,form,{replacePrice:false});
  showFieldError(control,nativeFieldError(control));if(form.dataset.validationSubmitted==='true')proformaValidationSummary(form);
 });
 form.addEventListener('change',()=>{
  if(!current()||form.dataset.saving==='true')return;
  const errors=proformaFieldErrors(form);
  for(const control of form.querySelectorAll('input,select,textarea'))if(touched.has(control))showFieldError(control,errors.get(control)||'');
  if(form.dataset.validationSubmitted==='true')proformaValidationSummary(form);
 });
}
async function saveProformaForm(form){
 if(form.dataset.saving==='true')return;
 const actor=me,epoch=salesEpoch,validation=proformaValidationContexts.get(form),state=proformaDraftContexts.get(form);if(!actor?.user_id||!validation?.current()||!state?.current())throw Error('Reopen the Pro forma form before saving.');
 if(state.pending||state.conflict||proformaDraftGuard(state))throw Error('Resolve the restored or pending save before making changes.');
 const errors=proformaFieldErrors(form);form.dataset.validationSubmitted=errors.size?'true':'false';
 for(const control of form.querySelectorAll('input,select,textarea'))validation.touched.add(fieldValidationSource(control));
 proformaValidationSummary(form,errors.size);showFieldErrors(form,errors);if(errors.size)return;
 const f=new FormData(form),lines=readProformaLines(form),id=form.dataset.id||(form.dataset.requestId ||= crypto.randomUUID()),version=Number(form.dataset.version);
 const args={p_id:id,p_expected_version:version,p_organization_id:f.get('organizationId'),p_contact_id:f.get('contactId'),p_currency:f.get('currency'),p_valid_until:f.get('validUntil'),p_delivery_period:f.get('deliveryPeriod'),p_payment_terms:f.get('paymentTerms'),p_notes:f.get('notes'),p_lines:lines,p_commercial_kind:f.get('commercialKind'),p_contract_id:f.get('contractId')||null,p_installation_required:f.get('installationRequired')==='yes',p_installation_charge_notes:f.get('installationChargeNotes'),p_internal_notes:f.get('internalNotes')};
 const draft=proformaDraftCapture(state);draft.pending=proformaFreezePending(args);state.pendingPreviousDraft=proformaDraftRead(actor.user_id);state.pending=draft.pending;if(!proformaDraftStore(state,draft)){state.pending=null;throw Error('Resolve the earlier pending Pro forma save first.');}
 if(state.timer){clearTimeout(state.timer);state.timer=null;}
 state.working=true;form.dataset.saving='true';state.unlock=salesLockForm(form);
 try{
  const result=await client.rpc('save_sales_proforma',JSON.parse(JSON.stringify(args)));
  if(me!==actor||salesEpoch!==epoch)return;
  if(!result.error){salesLoaded=false;salesProformaPageKey='';}
  if(!state.current()||!validation.current())return;
  if(result.error){
   // A first-attempt SQL exception rolls back its transaction. Transport errors and
   // errors from a retried uncertain attempt cannot establish the earlier outcome.
   if(/^[0-9A-Z]{5}$/.test(result.error.code||'')){proformaDraftRemove(state.actor.user_id,state.pending,state.pendingPreviousDraft);state.pendingPreviousDraft=null;state.pending=null;state.unlock();state.unlock=null;proformaDraftStore(state,{...draft,pending:null});}
   throw result.error;
  }
  const saved=Array.isArray(result.data)?result.data.length===1?result.data[0]:null:result.data;
  if(!proformaPendingHeader(state,saved))throw Error('The response did not confirm this exact saved revision.');
  proformaDraftConfirmed(state,saved);
 }catch(error){if(state.current()&&state.pending)proformaDraftRecovery(state,'Save confirmation is pending. Your values are locked. Check saved status or retry this same save. '+(error.message||'Connection unavailable.'));throw error;}
 finally{state.working=false;form.dataset.saving='false';if(state.current()&&state.pending)proformaDraftRecovery(state,form.querySelector('[data-proforma-recovery-message]')?.textContent||'Save confirmation is pending.');}
}
function salesEditorSaved(form,kind,id,text,error=false){
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,current=()=>me===actor&&salesEpoch===epoch&&request===salesWorkspaceRequest&&view==='sales'&&form.isConnected;
 let feedback=form.querySelector('[data-sales-saved]');
 if(!feedback){feedback=document.createElement('div');feedback.className='actions';feedback.dataset.salesSaved='';(kind==='proforma'?form.querySelector('[data-proforma-footer]'):form).append(feedback);}
 feedback.replaceChildren();
 const status=document.createElement('span');status.setAttribute('role',error?'alert':'status');status.textContent=text;
 const open=document.createElement('button');open.type='button';open.textContent=kind==='proforma'?'Open saved Pro forma':'Open delivery';
 open.onclick=()=>run(async()=>{const context=workspaceNavigationContext(),active=()=>current()&&context.current();if(!active()||!await confirmWorkspaceLeave(active)||!active())return;salesEditing='';salesFocusedProforma=kind==='proforma'?id:'';salesFocusedDelivery=kind==='delivery'?id:'';salesSection=kind==='proforma'?'proformas':'delivery';return salesDeliveryWorkspace();},{origin:open,busyLabel:'Opening…'});
 feedback.append(status,open);
 if(form.contains(document.activeElement))open.focus({preventScroll:true});
}
const deliveryValidationContexts=new WeakMap();
function deliveryFieldErrors(form){
 const errors=nativeFormErrors(form),radios=[...form.querySelectorAll('[name="collection"]')];
 const native=radios.map(control=>errors.get(control)).find(Boolean);radios.forEach(control=>errors.delete(control));
 if(!radios.some(control=>control.checked))errors.set(radios[0],'Choose customer collection or delivery.');else if(native)errors.set(radios[0],native);
 return errors;
}
function deliveryCollectionErrorHost(form){
 const group=form.querySelector('.collection-choice'),error=group.querySelector('.field-error');
 if(error)group.querySelector('[data-delivery-collection-errors]').append(error);
}
function deliveryValidationSummary(form,count=form.querySelectorAll('.field-error').length){
 actionFeedbackShow(actionFeedbackReference(form.querySelector('[type="submit"]')),fieldErrorSummary(count),'error',form.querySelector('[data-delivery-errors]'));
}
function deliveryBindValidation(form){
 if(!form||deliveryValidationContexts.has(form))return;
 const actor=me,epoch=salesEpoch,session=sessionLoadEpoch,request=salesWorkspaceRequest,hash=location.hash,root=$('#content'),touched=new WeakSet();
 const current=()=>me===actor&&actor.active!==false&&sessionLoadEpoch===session&&salesEpoch===epoch&&salesWorkspaceRequest===request&&view==='sales'&&salesSection==='delivery'&&location.hash===hash&&$('#content')===root&&form.isConnected&&$('#deliveryForm')===form&&hasArea('deliveries');
 deliveryValidationContexts.set(form,{current,touched});form.noValidate=true;
 form.addEventListener('focusout',event=>{
  const departed=event.target;if(!current()||form.dataset.saving==='true'||form.dataset.savedDelivery||!form.contains(departed)||!departed.matches('input,select,textarea'))return;
  const control=departed.name==='collection'?form.querySelector('[name="collection"]'):departed;touched.add(control);showFieldError(control,deliveryFieldErrors(form).get(control)||'');deliveryCollectionErrorHost(form);
  if(form.dataset.validationSubmitted==='true')deliveryValidationSummary(form);
 });
 form.addEventListener('change',()=>{
  if(!current()||form.dataset.saving==='true'||form.dataset.savedDelivery)return;
  const errors=deliveryFieldErrors(form);for(const control of form.querySelectorAll('input,select,textarea'))if(touched.has(control))showFieldError(control,errors.get(control)||'');deliveryCollectionErrorHost(form);
  if(form.dataset.validationSubmitted==='true')deliveryValidationSummary(form);
 });
}
async function createDeliveryForm(form){
 if(form.dataset.saving==='true'||form.dataset.savedDelivery)return;
 const actor=me,epoch=salesEpoch,validation=deliveryValidationContexts.get(form),current=()=>!!validation?.current();
 if(!actor?.user_id||!current())throw Error('Reopen Accounts approval before saving.');
 const errors=deliveryFieldErrors(form);form.dataset.validationSubmitted=errors.size?'true':'false';for(const control of form.querySelectorAll('input,select,textarea'))validation.touched.add(control);
 deliveryValidationSummary(form,errors.size);showFieldErrors(form,errors);deliveryCollectionErrorHost(form);if(errors.size)return;
 const f=new FormData(form);if(!f.get('collection'))throw Error('Choose whether the customer is waiting in the lobby or it is a delivery.');
 const id=form.dataset.requestId ||= crypto.randomUUID(),button=form.querySelector('[type="submit"]'),label=button.textContent;
 form.dataset.saving='true';const unlock=salesLockForm(form);let approved=false;
 try{
  const result=await client.rpc('create_sales_delivery_note',{p_id:id,p_proforma_id:form.dataset.id,p_expected_proforma_version:Number(form.dataset.version),p_accounts_reference:f.get('accountsReference'),p_expected_delivery_date:f.get('expectedDeliveryDate'),p_lines:[]});
  if(me!==actor||salesEpoch!==epoch)return;
  if(!result.error){salesLoaded=false;salesProformaPageKey='';salesDeliveryPageKey='';}
  if(!current())return;if(result.error)throw result.error;
  const note=Array.isArray(result.data)?result.data[0]:result.data;
  if(note?.id!==id||!Number.isInteger(note.version))throw Error('The server did not confirm this approval. Refresh the register before retrying.');
  // The approval stands even when the separate lobby mark fails.
  let lobbyProblem='';if(f.get('collection')==='lobby'){
   try{
    const marked=await client.rpc('set_delivery_customer_waiting',{p_id:note.id,p_expected_version:note.version,p_customer_waiting:true});
    if(!current())return;if(marked.error)throw marked.error;
   }catch(error){if(!current())return;lobbyProblem=' The "customer waiting" mark could not be confirmed. Check it on the delivery note.';}
  }
  form.dataset.initialState=salesEditorState(form);form.dataset.savedDelivery=note.id;approved=true;
  salesEditorSaved(form,'delivery',note.id,'Delivery created. Open it to link the existing ERP invoice and reserve stock.'+lobbyProblem,!!lobbyProblem);
 }catch(error){if(current())throw error;}
 finally{form.dataset.saving='false';if(current()){if(!approved)unlock();button.textContent=approved?'Approval saved':label;}}
}
// Hand-off choice at Accounts approval: a cash customer waiting in the lobby goes to the top of the packing queue.
function deliveryCollectionChoice(){return `<fieldset class="collection-choice" aria-describedby="deliveryCollectionError"><legend>How does the customer get it?</legend><label class="collection-option collection-lobby"><input type="radio" name="collection" value="lobby" required><span><strong>Customer waiting — cash, collecting now</strong><small>Goes to the top of the packing queue, shown in red.</small></span></label><label class="collection-option"><input type="radio" name="collection" value="delivery" required><span><strong>Delivery</strong><small>Packed in turn, oldest first.</small></span></label><div id="deliveryCollectionError" data-delivery-collection-errors></div></fieldset>`}
// On a delivery note: lobby or delivery (changeable until packing starts), who is packing it, and the promise.
function deliveryCollectionHtml(note){
 const open=!['delivered','cancelled'].includes(note.status),parts=[];
 parts.push(note.customer_waiting?'<span class="packing-badge">Customer waiting — cash, collecting now</span>':'<span class="tag">Delivery</span>');
 if(note.status==='packing'&&note.packer_user_id)parts.push(`<span>Being packed by <strong>${esc(employeeName(note.packer_user_id))}</strong>${typeof packingTime==='function'&&note.packing_taken_at?' since '+esc(packingTime(note.packing_taken_at)):''}</span>`);
 if(note.status==='sent_to_sales'&&note.packing_blocked_reason)parts.push(`<span class="packing-warn-text">${esc(note.packing_blocked_reason)}</span>`);
 if(open&&typeof packingPromiseText==='function'&&!note.customer_waiting&&note.promised_by)parts.push(`<span class="muted">${esc(packingPromiseText(note))}</span>`);
 if(open&&typeof packingCallCustomer==='function'&&packingCallCustomer(note))parts.push('<strong class="packing-call-text">Call the customer: more than 2 days past the promise</strong>');
 const canChange=['accounts_approved','tax_invoice_created','sent_to_sales'].includes(note.status)&&'customer_waiting' in note;
 return `<div class="delivery-collection no-print">${parts.join('')}${canChange?`<button type="button" data-delivery-collection="${esc(note.id)}">${note.customer_waiting?'Change to delivery':'Customer is waiting in the lobby'}</button>`:''}</div>`;
}
// "My orders today": Pro formas I prepared that were made, submitted or moved today.
function proformaMineToday(record,userId,now=new Date()){
 if(!userId||record.prepared_by!==userId)return false;
 const today=companyDate(0,now);
 return [record.created_at,record.accepted_at,record.updated_at].some(value=>value&&companyDate(0,new Date(value))===today);
}
function proformaItemsSummary(record){if(record.register_summary)return record.items_summary;const lines=salesLines(record.id);if(!lines.length)return '';const shown=lines.slice(0,3).map(line=>`${line.quantity} × ${salesProduct(line.product_id).name}`);return shown.join(' · ')+(lines.length>3?` · +${lines.length-3} more`:'');}
function salesPatchStatusCard(kind,record,trigger,warning=''){
 const card=document.querySelector(`[data-document-card="${CSS.escape(record.id)}"]`);if(!card)return;
 const actor=me,epoch=salesEpoch,active=document.activeElement,x=window.scrollX,y=window.scrollY;
 const template=document.createElement('template');template.innerHTML=kind==='proforma'?proformaCard(record):deliveryCard(record);const next=template.content.firstElementChild;
 const expanded=new Set([...card.querySelectorAll('details[open]')].map(detail=>detail.querySelector('summary')?.textContent));
 next.querySelectorAll('details').forEach(detail=>{if(expanded.has(detail.querySelector('summary')?.textContent))detail.open=true;});
 // This card uses the current scoped serial snapshot, including newly allocated lines.
 if(kind==='delivery'&&!salesDeliveryRefreshErrors.has(record.id)&&typeof deliverySerialPanelHtml==='function'){
  next.querySelector('.actions').insertAdjacentHTML('beforebegin',deliverySerialPanelHtml(record,deliveryLines(record.id),deliverySerials.filter(row=>row.delivery_note_id===record.id)));
  next.querySelector('[data-serial-record]')?.addEventListener('click',()=>openRecordSerials(salesDeliveryNotes.find(row=>row.id===record.id)));
 }
 if(warning){const alert=document.createElement('p');alert.setAttribute('role','alert');alert.textContent=warning;next.append(alert);}
 card.replaceWith(next);bindSalesRecordCard(next);
 if(kind==='proforma'){
  const panel=document.querySelector(`[data-order-workflow="${CSS.escape(record.id)}"]`);
  if(panel&&typeof orderWorkflowHtml==='function'){template.innerHTML=orderWorkflowHtml(record);panel.replaceWith(template.content.firstElementChild);bindOrderWorkflow();}
  if(typeof decorateDiscountApprovals==='function')decorateDiscountApprovals().catch(()=>{});
 }
 if(typeof bindQuotationDocuments==='function')bindQuotationDocuments();
 if(typeof decorateOrderLiveStatus==='function')decorateOrderLiveStatus().catch(()=>{});
 if(typeof decorateWorkHandoffs==='function')decorateWorkHandoffs(next).catch(()=>{});
 const focus=()=>{
  if(me!==actor||salesEpoch!==epoch||view!=='sales'||!next.isConnected)return;
  if(document.activeElement!==document.body&&document.activeElement?.isConnected)return;
  const data=Object.entries((active!==document.body&&card.contains(active)?active:trigger)?.dataset||{});
  const matching=data.length&&[...next.querySelectorAll('button,summary')].find(node=>data.every(([key,value])=>node.dataset[key]===value));
  (matching||next.querySelector('.actions button:not(:disabled)'))?.focus({preventScroll:true});
 };
 if(card.contains(active)||card.contains(trigger)){
  const dialog=document.querySelector('dialog[open]');if(dialog)dialog.addEventListener('close',focus,{once:true});else focus();
 }
 window.scrollTo({left:x,top:y,behavior:'instant'});
}
function salesConfirmedRow(kind,previous,data,status){
 const row=Array.isArray(data)&&data.length===1?data[0]:data;
 if(!row||row.id!==previous.id||row.status!==status||!Number.isSafeInteger(row.version)||row.version!==previous.version+1||Object.keys(previous).some(key=>!Object.hasOwn(row,key))||(kind==='proforma'&&row.revision!==previous.revision)||(kind==='delivery'&&status===previous.status&&row.customer_waiting!==!previous.customer_waiting))throw Error('The save response did not confirm the updated record. Refresh before retrying.');
 return row;
}
async function salesUpdateConfirmedCard(kind,previous,data,status,current,trigger){
 const row=salesConfirmedRow(kind,previous,data,status);
 let history,warning='';
 if(kind==='delivery'){
  try{history=await salesRowsFor('sales_delivery_events','delivery_note_id',[row.id],'created_at');if(history.error)throw Error(history.error.message);}
  catch(error){warning=`Change saved, but delivery history could not refresh: ${error.message}. Refresh to retry.`;}
  // The initial serial decorator captured the previous note; finish it before replacing that card.
  await salesSerialsLoading;
 }
 if(!current())return null;
 salesLoadRequest++;salesProformaPageKey='';salesDeliveryPageKey='';
 if(kind==='proforma')salesProformas=salesProformas.map(item=>item.id===row.id?row:item);
 else{
  salesDeliveryNotes=salesDeliveryNotes.map(item=>item.id===row.id?row:item);
  salesDeliveryEvents=[...salesDeliveryEvents.filter(event=>event.delivery_note_id!==row.id),...(history?.data||[])];
  if(warning)salesDeliveryHistoryLoaded.delete(row.id);else salesDeliveryHistoryLoaded.add(row.id);
 }
 if(typeof liveStatusCache!=='undefined')liveStatusCache.delete(kind==='proforma'?row.id:row.proforma_id);
 salesPatchStatusCard(kind,row,trigger,warning);return warning;
}
async function refreshDeliveryAfterStockChange(row,current,trigger){
 if(!current())return null;
 let lines,events,serials,planned,lots,warning='';
 const oldLineIds=new Set(deliveryLines(row.id).map(line=>line.id)),oldLotIds=deliveryLines(row.id).map(line=>line.lot_id).filter(Boolean);
 try{
  await salesSerialsLoading;if(!current())return null;
  const results=await Promise.all([
   salesRowsFor('sales_delivery_lines','delivery_note_id',[row.id]),
   salesRowsFor('sales_delivery_events','delivery_note_id',[row.id],'created_at'),
   salesRowsFor('delivery_line_serials','delivery_note_id',[row.id],'serial_number'),
   client.rpc('planned_delivery_serial_lines',{p_delivery_note_ids:[row.id]}),
   loadSerialSettings()
  ]);
  if(!current())return null;
  const failed=results.slice(0,4).find(result=>result.error);if(failed)throw Error(failed.error.message);
  if(!results[4]||results.slice(0,4).some(result=>!Array.isArray(result.data)))throw Error('The delivery requirements could not be verified.');
  [lines,events,serials,planned]=results.slice(0,4).map(result=>result.data);
  if(lines.some(line=>line.delivery_note_id!==row.id)||events.some(event=>event.delivery_note_id!==row.id)||serials.some(serial=>serial.delivery_note_id!==row.id)||planned.some(line=>!lines.some(item=>item.id===line.delivery_line_id)))throw Error('The refreshed delivery details did not match this order.');
  const lotIds=[...new Set([...oldLotIds,...lines.map(line=>line.lot_id).filter(Boolean)])],stock=await salesRowsFor('inventory_lots','id',lotIds);
  if(!current())return null;if(stock.error)throw Error(stock.error.message);
  lots=stock.data;if(!Array.isArray(lots)||new Set(lots.map(lot=>lot.id)).size!==lotIds.length||lots.some(lot=>!lotIds.includes(lot.id)))throw Error('The allocated stock could not be verified.');
 }catch(error){if(!current())return null;warning='Change saved. Delivery details could not refresh: '+error.message+' Refresh delivery details before continuing.';}
 if(!current())return null;
 salesLoadRequest++;salesProformaPageKey='';salesDeliveryPageKey='';inventoryLoaded=false;
 salesDeliveryNotes=salesDeliveryNotes.map(note=>note.id===row.id?row:note);
 if(warning){salesDeliveryRefreshErrors.set(row.id,warning);salesDeliveryHistoryLoaded.delete(row.id);}
 else{
  salesDeliveryRefreshErrors.delete(row.id);
  salesDeliveryLines=[...salesDeliveryLines.filter(line=>line.delivery_note_id!==row.id),...lines];
  salesDeliveryEvents=[...salesDeliveryEvents.filter(event=>event.delivery_note_id!==row.id),...events];salesDeliveryHistoryLoaded.add(row.id);
  deliverySerials=[...deliverySerials.filter(serial=>serial.delivery_note_id!==row.id),...serials];
  for(const line of lines)oldLineIds.add(line.id);
  plannedSerialLines=new Set([...plannedSerialLines].filter(id=>!oldLineIds.has(id)).concat(planned.map(line=>line.delivery_line_id)));
  const lotIds=new Set(lots.map(lot=>lot.id));inventoryLots=[...inventoryLots.filter(lot=>!lotIds.has(lot.id)),...lots];
 }
 if(typeof liveStatusCache!=='undefined')liveStatusCache.delete(row.proforma_id);
 salesPatchStatusCard('delivery',row,trigger);return warning;
}
function openProformaAction(record,action,trigger=document.activeElement){
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,current=()=>me===actor&&salesEpoch===epoch&&salesWorkspaceRequest===request&&view==='sales'&&!salesEditing;
 const asksReference=action!=='send',label={send:'Record sent to client',accept:'Record customer acceptance',revise:'Return Pro forma for revision',reject:'Record customer rejection',cancel:'Cancel Pro forma'}[action];
 actionForm(label,asksReference?`<p>${esc(record.document_number)} · ${esc(salesOrganization(record.organization_id).name)}</p><label><span>${action==='accept'?'Customer LPO, payment proof, email or acceptance reference':'Reason / reference'}</span><textarea name="reference" required maxlength="1000"></textarea></label>`:`<p>Confirm that ${esc(record.document_number)} has already been sent to the named customer contact. This action records the status; it does not send an email. The sent revision is locked until it is returned to Draft.</p>`,async values=>{
  if(!current())throw Error('Reopen this Pro forma before saving.');
  const result=await client.rpc('advance_sales_proforma',{p_id:record.id,p_expected_version:record.version,p_action:action,p_reference:values.reference||''});
  if(!current())return;if(result.error)throw result.error;
  const warning=await salesUpdateConfirmedCard('proforma',record,result.data,{send:'sent',accept:'accepted',revise:'draft',reject:'rejected',cancel:'cancelled'}[action],current,trigger);
  if(warning!==null&&current())message(warning||label+' saved.',!!warning);
 });
}
async function saveDeliveryCollection(note,waiting,trigger){
 const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,current=()=>me===actor&&salesEpoch===epoch&&salesWorkspaceRequest===request&&view==='sales'&&!salesEditing;
 if(!current())throw Error('Reopen this delivery before saving.');
 const result=await client.rpc('set_delivery_customer_waiting',{p_id:note.id,p_expected_version:note.version,p_customer_waiting:waiting});
 if(!current())return;if(result.error)throw result.error;
 const warning=await salesUpdateConfirmedCard('delivery',note,result.data,note.status,current,trigger);
 if(warning!==null&&current())message(warning||(waiting?'Marked: customer waiting in the lobby.':'Marked: delivery.'),!!warning);
}
function openDeliveryAction(note,action,trigger=document.activeElement){const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,current=()=>me===actor&&salesEpoch===epoch&&salesWorkspaceRequest===request&&view==='sales'&&!salesEditing;const content=action==='tax_invoice'?'<p class="notice">Link an existing ERP invoice for this accepted Pro forma and reserve only that invoice’s undelivered quantities from available Haadi stock. If the invoice is missing, voided, ambiguous, or stock is short, nothing is reserved.</p><label><span>ERP invoice number · optional when only one is eligible</span><input name="invoiceReference" maxlength="80"></label>':action==='dispatch'?'<label><span>Driver / vehicle</span><input name="carrier" required maxlength="200"></label><label><span>Out-for-delivery / tracking reference</span><input name="tracking" required maxlength="200"></label>':action==='deliver'?'<p class="notice">First upload a photo or scan of the signed and stamped delivery note: close this, press <strong>Upload / view documents</strong> on this delivery, then come back. Delivery cannot be recorded without it.</p><label><span>Customer recipient name</span><input name="recipient" required maxlength="200"></label><label><span>Signed delivery note / proof reference</span><input name="proof" required maxlength="500"></label>':action==='cancel'?'<label><span>Cancellation reason</span><textarea name="proof" required maxlength="500"></textarea></label>':action==='send_to_sales'?'<p>Confirm the tax-invoiced order has been handed to the downstairs sales team for packing.</p>':action==='start_packing'?packingFields(note):'<p>Confirm every listed item and quantity is packed and the selected Haadi stock is still available.</p>';actionForm({tax_invoice:'Link ERP invoice & reserve stock',send_to_sales:'Send to downstairs sales',start_packing:'Start packing',ready:'Mark ready for delivery',dispatch:'Mark out for delivery',deliver:'Record signed delivery note',cancel:'Cancel delivery'}[action],content,async values=>{if(!current())throw Error('Reopen this delivery before saving.');let result;if(action==='tax_invoice'){result=await client.rpc('create_tax_invoice_and_reserve_stock',{p_id:note.id,p_expected_version:note.version,p_tax_invoice_reference:values.invoiceReference||''});}else if(action==='start_packing'&&deliveryLines(note.id).length)result=await client.rpc('start_reserved_sales_delivery_packing',{p_id:note.id,p_expected_version:note.version});else if(action==='start_packing'){const record=salesProforma(note.proforma_id),lines=salesLines(record.id).filter(line=>values[`include_${line.id}`]==='on').map(line=>({proformaLineId:line.id,lotId:values[`lot_${line.id}`]||'',quantity:Number(values[`qty_${line.id}`])}));if(!lines.length)throw Error('Choose at least one item to pack.');if(lines.some(line=>!line.lotId||!Number.isSafeInteger(line.quantity)||line.quantity<1))throw Error('Choose a Haadi lot and whole quantity for every selected item.');result=await client.rpc('start_sales_delivery_packing',{p_id:note.id,p_expected_version:note.version,p_lines:lines})}else if(action==='ready')result=await client.rpc('packing_mark_packed',{p_id:note.id,p_expected_version:note.version});else result=await client.rpc('advance_sales_delivery',{p_id:note.id,p_expected_version:note.version,p_action:action,p_carrier:values.carrier||'',p_tracking_reference:values.tracking||'',p_recipient_name:values.recipient||'',p_proof_reference:values.proof||''});if(me!==actor||salesEpoch!==epoch)return;if(result.error)throw result.error;if(action==='deliver'){clearServiceWorkflow();if(view==='service')await serviceWorkspace();}if(['send_to_sales','ready','deliver'].includes(action)){if(!current())return;const status={send_to_sales:'sent_to_sales',ready:'ready',dispatch:'out_for_delivery',deliver:'delivered'}[action],warning=await salesUpdateConfirmedCard('delivery',note,result.data,status,current,trigger);if(warning!==null&&current())message(warning||'Order status saved: '+salesStatus(status)+'.',!!warning);return;}if(!current())return;const row=salesConfirmedRow('delivery',note,result.data,{tax_invoice:'tax_invoice_created',start_packing:'packing',dispatch:'out_for_delivery',cancel:'cancelled'}[action]);const warning=await refreshDeliveryAfterStockChange(row,current,trigger);if(warning!==null&&current())message(warning||'Order status saved: '+salesStatus(row.status)+'.',!!warning)})}
function printSalesDocument(id){const card=document.querySelector(`[data-document-card="${CSS.escape(id)}"]`);if(!card)return;card.classList.add('print-document');try{window.print()}finally{card.classList.remove('print-document')}}
function bindSalesRecordCard(card){
 card.querySelectorAll('[data-delivery-retry]').forEach(button=>button.onclick=()=>run(async()=>{const actor=me,epoch=salesEpoch,request=salesWorkspaceRequest,current=()=>me===actor&&salesEpoch===epoch&&request===salesWorkspaceRequest&&view==='sales'&&card.isConnected;const row=salesDeliveryNotes.find(note=>note.id===button.dataset.deliveryRetry);if(!row||!current())return;const warning=await refreshDeliveryAfterStockChange(row,current,button);if(warning!==null&&me===actor&&view==='sales')message(warning||'Delivery details refreshed.',!!warning);}));
 card.querySelectorAll('[data-load-order-timing]').forEach(button=>button.onclick=()=>run(()=>loadOrderTiming(button.closest('[data-order-timing]')),{origin:button,busyLabel:'Loading history…'}));
 if(typeof openDocumentAttachments==='function'){
  const id=card.dataset.documentCard,proforma=salesProforma(id),note=salesDeliveryNotes.find(row=>row.id===id),actions=card.querySelector('.actions');
  if(actions&&(proforma||note)&&!actions.querySelector('[data-document-files]')){
   const button=document.createElement('button');button.type='button';button.dataset.documentFiles=id;button.textContent='Upload / view documents';
   button.onclick=()=>run(()=>openDocumentAttachments(proforma?'proforma':'delivery',id,proforma?.document_number||note.delivery_number));actions.append(button);
  }
 }
 card.querySelectorAll('[data-edit-proforma]').forEach(button=>button.onclick=()=>run(()=>{salesEditing=button.dataset.editProforma;return salesDeliveryWorkspace()},{origin:button,busyLabel:'Opening…'}));
 card.querySelectorAll('[data-proforma-action]').forEach(button=>button.onclick=()=>openProformaAction(salesProforma(button.dataset.id),button.dataset.proformaAction,button));
 card.querySelectorAll('[data-delivery-collection]').forEach(button=>button.onclick=()=>run(async()=>{
  const note=salesDeliveryNotes.find(row=>row.id===button.dataset.deliveryCollection);if(!note)return;
  const context=workspaceNavigationContext(),epoch=salesEpoch,request=salesWorkspaceRequest,version=note.version,waiting=!note.customer_waiting;
  const current=()=>context.current()&&epoch===salesEpoch&&request===salesWorkspaceRequest&&view==='sales'&&!salesEditing&&card.isConnected&&button.isConnected&&salesDeliveryNotes.find(row=>row.id===note.id)===note&&note.version===version&&note.customer_waiting===!waiting;
  if(!current()||!await askConfirm({title:waiting?'Customer collecting now?':'Use the delivery queue?',body:waiting?`Mark ${note.delivery_number}: customer waiting in the lobby (cash, collecting now)? It goes to the top of the packing queue.`:`Change ${note.delivery_number} to delivery? It is packed in turn.`,confirmLabel:waiting?'Mark customer waiting':'Use delivery queue'})||!current())return;
  return saveDeliveryCollection(note,waiting,button);
 },{origin:button}));
 card.querySelectorAll('[data-delivery-action]').forEach(button=>button.onclick=()=>openDeliveryAction(salesDeliveryNotes.find(row=>row.id===button.dataset.id),button.dataset.deliveryAction,button));
 card.querySelectorAll('[data-print-document]').forEach(button=>button.onclick=()=>printSalesDocument(button.dataset.printDocument));
 card.querySelectorAll('[data-send-tally]').forEach(button=>button.onclick=()=>run(()=>openSendToTally(button.dataset.sendTally)));
}
function bindSalesDelivery(){
 document.querySelectorAll('[data-document-card]').forEach(bindSalesRecordCard);
 if(typeof bindQuotationDocuments==='function')bindQuotationDocuments();
 if(typeof bindOrderWorkflow==='function')bindOrderWorkflow();
 document.querySelectorAll('[data-delivery-back]').forEach(button=>button.onclick=()=>run(()=>{salesFocusedDelivery='';return salesDeliveryWorkspace()}));
 document.querySelectorAll('[data-open-delivery]').forEach(button=>button.onclick=()=>run(async()=>{salesFocusedDelivery=button.dataset.openDelivery;await salesDeliveryWorkspace();window.scrollTo?.(0,0)}));
 $('#deliveryPrev')?.addEventListener('click',()=>run(()=>{salesDeliveryPage--;return salesDeliveryWorkspace()}));
 $('#deliveryNext')?.addEventListener('click',()=>run(()=>{salesDeliveryPage++;return salesDeliveryWorkspace()}));
 $('#deliveryNotesTab')?.addEventListener('click',()=>run(()=>{salesDeliveryFilter='notes';salesDeliveryPage=0;return salesDeliveryWorkspace()}));
 $('#deliveryAwaitingTab')?.addEventListener('click',()=>run(()=>{salesDeliveryFilter='awaiting';salesDeliveryPage=0;return salesDeliveryWorkspace()}));
 const editor=document.querySelector('#proformaForm,#deliveryForm');if(editor)editor.dataset.initialState=salesEditorState(editor);
 $('#proformaPrev')?.addEventListener('click',()=>run(()=>{salesProformaPage--;return salesDeliveryWorkspace()}));
 $('#proformaNext')?.addEventListener('click',()=>run(()=>{salesProformaPage++;return salesDeliveryWorkspace()}));
 if(salesProformaLanding()&&typeof openDiscountLimit==='function')$('[data-discount-limit]')?.addEventListener('click',openDiscountLimit);
 $('#moreProformas')?.addEventListener('click',()=>run(()=>{salesShown+=120;return salesDeliveryWorkspace()}));
 document.querySelectorAll('[data-sales-section]').forEach(button=>button.onclick=()=>salesNavigate(()=>{salesSection=button.dataset.salesSection;salesEditing='';salesFocusedProforma='';salesFocusedDelivery='';return salesDeliveryWorkspace()}));
 document.querySelectorAll('[data-open-proforma]').forEach(button=>button.onclick=()=>run(()=>openWorkspaceRecord('proforma',button.dataset.openProforma),{origin:button}));
 document.querySelectorAll('[data-proforma-back]').forEach(button=>button.onclick=()=>run(()=>{salesFocusedProforma='';navRecordPage('#/go/sales/proformas');return navRenderListPlace(()=>salesDeliveryWorkspace())}));
 document.querySelectorAll('[data-proforma-filter]').forEach(button=>button.onclick=()=>run(()=>{salesShown=120;salesProformaPage=0;salesProformaFilter=button.dataset.proformaFilter;return salesDeliveryWorkspace()}));
 const proformaSearch=$('#proformaSearch');if(proformaSearch)proformaSearch.oninput=event=>{salesShown=120;salesProformaPage=0;salesProformaSearch=event.target.value;salesWorkspaceRequest++;renderSearchPreservingPosition(event.target,()=>salesDeliveryWorkspace(),250)};
 $('#salesRefresh')?.addEventListener('click',()=>run(()=>salesDeliveryWorkspace(true)));
 $('#newProforma')?.addEventListener('click',()=>salesNavigate(()=>{salesPrefill=null;salesEditing='new';return salesDeliveryWorkspace()}));
 $('#closeSalesEditor')?.addEventListener('click',()=>salesNavigate(()=>{salesPrefill=null;salesEditing='';return salesDeliveryWorkspace()}));
 $('#closeDeliveryEditor')?.addEventListener('click',()=>salesNavigate(()=>{salesEditing='';return salesDeliveryWorkspace()}));
 $('#addSalesLine')?.addEventListener('click',()=>{const box=$('#proformaLines');box.insertAdjacentHTML('beforeend',salesLineRow());pricingRefreshRow(box.lastElementChild,$('#proformaForm'));});
 $('#proformaForm')?.addEventListener('change',event=>{if(event.target.name==='organizationId'){const select=$('#proformaForm [name="contactId"]');select.innerHTML='<option value="">Choose named contact</option>'+salesContactOptions(event.target.value);proformaShowExisting();proformaUpdateContractChoices()}});proformaShowExisting();
 $('#proformaLines')?.addEventListener('change',event=>{if(event.target.name==='productChoice')salesPrefillLineDescription(event.target.closest('[data-proforma-line]'));});
 pricingBindForm($('#proformaForm'));proformaBindCommercial();proformaBindValidation($('#proformaForm'));proformaBindDraft($('#proformaForm'));
 $('#proformaForm')?.addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget,button=event.submitter||form.querySelector('[type="submit"]'),state=proformaDraftContexts.get(form),options={origin:button,errorTarget:form.querySelector('[data-proforma-errors]')};
  if(busy)return run(()=>{},options);if(button.disabled||form.dataset.saving==='true')return;
  button.disabled=true;
  return run(async()=>{try{await saveProformaForm(form);}finally{if(state?.current())button.disabled=state.saveDisabled||!!state.pending||!!state.conflict||proformaDraftGuard(state);}},options);
 });
 deliveryBindValidation($('#deliveryForm'));
 $('#deliveryForm')?.addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget,button=event.submitter||form.querySelector('[type="submit"]'),validation=deliveryValidationContexts.get(form),options={origin:button,errorTarget:form.querySelector('[data-delivery-errors]')};
  if(busy)return run(()=>{},options);if(button.disabled||form.dataset.saving==='true'||form.dataset.savedDelivery)return;
  const hadFocus=form.contains(document.activeElement);button.disabled=true;
  return run(async()=>{
   try{
    await createDeliveryForm(form);
    if(validation?.current()&&form.dataset.savedDelivery&&hadFocus&&document.activeElement===document.body)form.querySelector('[data-sales-saved] button')?.focus({preventScroll:true});
   }finally{if(validation?.current()&&!form.dataset.savedDelivery)button.disabled=false;}
  },options);
 });
 $('#proformaLines')?.addEventListener('click',event=>{const button=event.target.closest('[data-remove-sales-line]');if(!button)return;if(document.querySelectorAll('[data-proforma-line]').length>1){button.closest('[data-proforma-line]').remove();const form=$('#proformaForm');if(form.dataset.validationSubmitted==='true')proformaValidationSummary(form);}else message('A Pro forma needs at least one item.',true)});
 document.querySelectorAll('[data-create-delivery]').forEach(button=>button.onclick=()=>salesNavigate(()=>{salesSection='delivery';salesFocusedDelivery='';salesEditing=button.dataset.createDelivery;return salesDeliveryWorkspace()}));
 if(salesDeliveryLanding())return;
 if(typeof decorateOrderLiveStatus==='function')decorateOrderLiveStatus().catch(()=>{});
 if(!salesProformaLanding()&&typeof decorateDiscountApprovals==='function')decorateDiscountApprovals().catch(()=>{});
 if(typeof decorateCustomerReturns==='function')decorateCustomerReturns().catch(()=>{});
 if(typeof decorateDeliverySerials==='function')salesSerialsLoading=decorateDeliverySerials().catch(()=>{});
 if(typeof decorateWorkHandoffs==='function')decorateWorkHandoffs().catch(()=>{});
}
