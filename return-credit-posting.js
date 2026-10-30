'use strict';
let returnCreditPostingEpoch=0,returnCreditPostingRequest=0,returnCreditPostingState=null;
function clearReturnCreditPosting(){returnCreditPostingEpoch++;returnCreditPostingState=null;document.querySelectorAll('dialog.return-credit-posting').forEach(dialog=>dialog.remove());}
function returnCreditPostingConfirmLeave(current=()=>true){
 if(!current())return false;
 if(!returnCreditPostingState?.busy&&!returnCreditPostingState?.uncertain)return true;
 message('Resolve the return credit posting outcome before leaving this page.',true);return false;
}
function returnCreditPostingMoney(value){const minor=Number(value);if(!Number.isSafeInteger(minor)||minor<0)throw Error('The saved credit amount is invalid.');return (minor/100).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});}
function returnCreditPostingSnapshot(saved){
 const body=saved?.body;
 if(!body?.source?.invoiceId||!body.source.returnId)throw Error('Only returned-goods drafts linked to an ERP invoice can post. External invoices and older drafts need Accounts review.');
 if(body.currency!=='TZS'||!Array.isArray(body.lines)||!body.lines.length)throw Error('The saved return allocation is unavailable.');
 let net=0,tax=0;for(const line of body.lines){
  if(!line.proformaLineId||!Number.isSafeInteger(line.quantityReturned)||line.quantityReturned<1||!Number.isSafeInteger(line.netMinor)||line.netMinor<0||!Number.isSafeInteger(line.taxMinor)||line.taxMinor<0)throw Error('The saved return allocation needs Accounts review.');
  net+=line.netMinor;tax+=line.taxMinor;
 }
 if(!Number.isSafeInteger(net+tax)||net+tax<=0||net+tax!==body.totalMinor)throw Error('The saved return allocation does not balance.');
 return {net,tax,total:net+tax,source:body.source};
}
function mountReturnCreditPosting(target,row){
 target.querySelector('[data-post-return-credit]')?.remove();
 if(row?.kind!=='credit_note'||!row.version)return;
 const button=document.createElement('button');button.type='button';button.dataset.postReturnCredit=row.id;button.textContent='Review / post returned-goods credit';
 button.onclick=()=>run(()=>openReturnCreditPosting(row),{origin:button,busyLabel:'Loading return credit…'});target.append(button);
}
async function openReturnCreditPosting(row){
 if(!row?.id||!row.version||row.kind!=='credit_note')throw Error('Open a saved Credit Note draft first.');
 if(returnCreditPostingState?.dialog?.isConnected){returnCreditPostingState.dialog.focus();return;}
 const actor=me,epoch=returnCreditPostingEpoch,request=++returnCreditPostingRequest,trigger=document.activeElement;
 const sourceView=typeof view==='undefined'?null:view,sourceContainer=document.querySelector('#accountingForm')||document.querySelector('#content');
 const sameSource=()=>me===actor&&epoch===returnCreditPostingEpoch&&request===returnCreditPostingRequest&&(sourceView===null||view===sourceView)&&(!sourceContainer||sourceContainer.isConnected);
 let history,posted;
 try{
  await requireAccountingAccess(client,()=>me);
  if(!sameSource())return;
  [history,posted]=await Promise.all([
   client.from('accounting_draft_history').select('body').eq('draft_id',row.id).eq('version',1).maybeSingle(),
   client.from('acc_credit_notes').select('*').eq('draft_id',row.id).maybeSingle()
  ]);
 }catch(error){if(sameSource())throw error;return;}
 if(!sameSource())return;
 if(history.error||posted.error)throw Error((history.error||posted.error).message);
 const dialog=document.createElement('dialog'),titleId='return-credit-posting-title-'+request;dialog.className='return-credit-posting';dialog.setAttribute('aria-labelledby',titleId);
 const state={dialog,busy:false,uncertain:false,attempt:null};returnCreditPostingState=state;
 const current=()=>sameSource()&&dialog.isConnected&&returnCreditPostingState===state;
 let form=null,initial='';
 const requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>!current()||state.busy||state.uncertain,isDirty:()=>!!form?.isConnected&&workspaceFormSnapshot(form)!==initial});
 const close=async()=>{if(!current())return false;const closed=await requestClose();return closed&&sameSource();};
 dialog.addEventListener('close',()=>{dialog.remove();if(sameSource()&&returnCreditPostingState===state)returnCreditPostingState=null;});
 function confirmed(credit){
  if(!credit?.id||credit.draft_id!==row.id||!credit.credit_number)throw Error('Server did not confirm this return credit.');
  state.uncertain=false;
  dialog.innerHTML=`<h2 id="${titleId}">${esc(credit.credit_number)} posted</h2><p>Accounting date: ${esc(credit.credit_date)} · TZS ${returnCreditPostingMoney(credit.total_minor)}</p><p>Sales and VAT were reversed against customer receivables. Any payment above the revised invoice balance is customer credit; no refund was issued.</p><p>This posting is permanent. The saved form remains a draft and cannot change the posted amounts.</p><button type="button" data-credit-close>Close</button>`;
  dialog.querySelector('[data-credit-close]').onclick=close;
  if(state.busy){const closeButton=dialog.querySelector('[data-credit-close]');actionFeedbackActive.successOrigin=actionFeedbackReference(closeButton);closeButton.focus({preventScroll:true});message('Return credit posted.');}
  if(typeof clearBooks==='function')clearBooks();
 }
 try{
  if(posted.data){document.body.append(dialog);confirmed(posted.data);showWorkspaceDialog(dialog,{size:'medium',trigger});return;}
  const snapshot=returnCreditPostingSnapshot(history.data);
  dialog.innerHTML=`<h2 id="${titleId}">Post returned-goods credit</h2><p>${esc(snapshot.source.returnNumber||'Returned goods')} · original invoice ${esc(snapshot.source.taxInvoiceReference||'')}</p><p>The original return allocation is posted. Later edits to the printable form do not change these amounts.</p><dl><dt>Sales reversal (TZS)</dt><dd>${returnCreditPostingMoney(snapshot.net)}</dd><dt>VAT reversal (TZS)</dt><dd>${returnCreditPostingMoney(snapshot.tax)}</dd><dt>Customer credit (TZS)</dt><dd>${returnCreditPostingMoney(snapshot.total)}</dd></dl><p>A paid invoice produces customer credit. This does not pay a refund or change stock.</p><form><fieldset><label>Accounting date <input name="date" type="date" required value="${esc(typeof companyDate==='function'?companyDate():new Date().toISOString().slice(0,10))}"></label></fieldset><p role="status"></p><div class="actions"><button type="button" class="button-quiet" data-credit-close>Cancel</button><button type="submit" class="button-primary">Post credit to books</button></div></form>`;
  document.body.append(dialog);form=dialog.querySelector('form');initial=workspaceFormSnapshot(form);
  const fields=form.querySelector('fieldset'),status=form.querySelector('[role="status"]'),button=form.querySelector('[type="submit"]'),cancel=form.querySelector('[data-credit-close]');cancel.onclick=close;
  showWorkspaceDialog(dialog,{size:'medium',trigger});
  form.onsubmit=async event=>{
   event.preventDefault();if(!current()||state.busy)return;
   if(busy)return run(async()=>{},{origin:event.submitter||button,errorTarget:status});
   if(!state.attempt){if(!form.reportValidity())return;state.attempt={p_id:crypto.randomUUID(),p_draft_id:row.id,p_expected_version:row.version,p_credit_date:form.elements.date.value};}
   state.busy=true;fields.disabled=true;button.disabled=true;cancel.disabled=true;status.textContent='Posting the return credit…';
   await run(async()=>{try{
    const result=await client.rpc('post_return_credit_note',state.attempt);if(!current())return;
    if(result.error)throw result.error;
    confirmed(Array.isArray(result.data)?result.data[0]:result.data);
   }catch(error){
    if(!current())return;
    const known=/^(?:22|23|42|P0)[A-Z0-9]{3}$/.test(String(error.code||''));
    if(known&&!state.uncertain){state.attempt=null;status.textContent=`Not posted: ${error.message}`;message(status.textContent,true);}
    else{
     state.uncertain=true;
     try{
      const check=await client.from('acc_credit_notes').select('*').eq('draft_id',row.id).maybeSingle();
      if(!current())return;
      if(!check.error&&check.data){confirmed(check.data);return;}
     }catch(ignored){/* Keep the same identity until the server confirms the outcome. */}
     if(current()){status.textContent='Posting outcome is not confirmed. Retry the same credit to reconcile it. Do not create another draft.';message(status.textContent,true);}
    }
   }finally{
    state.busy=false;if(current()&&form.isConnected){fields.disabled=state.uncertain;button.disabled=false;cancel.disabled=state.uncertain;button.textContent=state.uncertain?'Retry same credit':'Post credit to books';}
   }
   },{origin:event.submitter||button,errorTarget:status,busyLabel:'Posting credit…'});
  };
 }catch(error){dialog.remove();if(returnCreditPostingState===state)returnCreditPostingState=null;throw error;}
}
