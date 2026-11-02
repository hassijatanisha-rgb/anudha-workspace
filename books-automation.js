'use strict';

async function booksAutomationWorkspace(actor,current){
 const section=booksSection,title=booksSections.find(([key])=>key===section)[1];
 workspaceLoading(`Loading ${title.toLowerCase()}…`);
 const [accounts,settings]=await Promise.all([booksSelectAll('acc_accounts','*',q=>q.order('code')),booksSelect('acc_settings','*')]);
 if(!current())return;
 booksData={accounts,settings:settings[0]||{version:1,locked_through:null},today:booksToday()};
 $('#content').innerHTML=`<section class="books">${workspacePageHeader({title,back:'<button type="button" id="booksAutomationBack">Accounts overview</button>'})}<p class="muted">${booksData.settings.locked_through?`Books locked through ${esc(booksData.settings.locked_through)}.`:'No lock date set.'}</p><div id="booksBody"></div></section>`;
 $('#booksAutomationBack').onclick=()=>run(async()=>{if(!current()||!booksPostingConfirmLeave(current))return;openBooksSection('overview');syncWorkspaceNavigation();await booksWorkspace();});
 await ({suppliers:supplierBooksWorkspace,credits:customerCreditWorkspace,valuation:inventoryCostWorkspace}[section])(actor,current);
}

function booksAmountField(name,label,{value='',optional=false}={}){
 return `<label><span>${esc(label)}${optional?' · optional':' · required'}</span><input name="${esc(name)}" inputmode="decimal" data-books-amount ${optional?'':'required'} value="${esc(value)}" autocomplete="off" placeholder="0.00"></label>`;
}
function booksDateField(name,label,value=booksToday()){
 return `<label><span>${esc(label)} · required</span><input name="${esc(name)}" type="date" required value="${esc(value)}"></label>`;
}
function booksAccountOptions(accounts,{cash=false,expense=false}={}){
 return '<option value="">Choose account</option>'+accounts.filter(a=>a.active&&(!cash||a.account_type==='asset'&&a.system_key!=='receivables'&&/^1[12]\d\d$/.test(a.code))&&(!expense||['asset','expense'].includes(a.account_type)&&!['receivables','bank','cash','mobile_money'].includes(a.system_key))).map(a=>`<option value="${esc(a.id)}">${esc(booksAccountLabel(a))}</option>`).join('');
}
function booksMethodField(){return `<label><span>Method · required</span><select name="method" required>${booksMethods.map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></label>`;}
function booksReferenceField(label='Reference',required=true){return `<label><span>${esc(label)} · ${required?'required':'optional'}</span><input name="reference" ${required?'required':''} maxlength="120"></label>`;}
function booksMinorField(control,{positive=true}={}){
 const value=moneyMinor(control.value||'0');
 if(positive&&value<=0)throw Error('Enter an amount above zero.');
 return String(value);
}
function booksExactRecord(data,expected,required=[]){
 const row=Array.isArray(data)?(data.length===1?data[0]:null):data;
 if(!row||typeof row!=='object'||Object.entries(expected).some(([key,value])=>key.endsWith('_minor')?!(typeof row[key]==='string'&&/^-?\d+$/.test(row[key])||Number.isSafeInteger(row[key]))||String(row[key])!==String(value):row[key]!==value)||required.some(key=>typeof row[key]!=='string'||!row[key]))throw Error('The saved record could not be verified.');
 return row;
}
function booksExactRows(rows,amountKeys){
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||amountKeys.some(key=>typeof row[key]!=='string'||! /^-?\d+$/.test(row[key]))))throw Error('The accounting amounts were incomplete. Reload before relying on these balances.');
 return rows;
}
function booksExactLines(actual,expected,keys,orderKey){
 if(!Array.isArray(actual)||actual.length!==expected.length)throw Error('The saved line items could not be verified.');
 const ordered=rows=>orderKey?[...rows].sort((a,b)=>String(a[orderKey]).localeCompare(String(b[orderKey]))):rows;
 const saved=ordered(actual),sent=ordered(expected);
 if(saved.some((row,index)=>keys.some(key=>row[key]!==sent[index][key])))throw Error('The saved line items could not be verified.');
 return actual;
}
function booksAutomationBind(form,{rpc,label,read,verify,confirmation,open,current}){
 const summary=form.querySelector('[role="alert"]'),posting=booksPostingControl(form,label,current,{rpc,label,verify,confirmation,open}),nativeCheck=booksFormValidation(form,summary,current);
 const validateMoney=control=>{
  if(!control.matches('[data-books-amount]'))return '';
  let problem='';try{if(control.value.trim())moneyMinor(control.value);}catch(error){problem=error.message;}
  control.setCustomValidity(problem);return problem;
 };
 form.addEventListener('input',event=>{const control=event.target;if(!current()||posting.locked()||!control.matches('input,select,textarea'))return;const problem=validateMoney(control)||nativeFieldError(control);showFieldError(control,problem);summary.textContent=problem?'Check the highlighted field.':'';});
 form.onsubmit=event=>{
  event.preventDefault();if(!current()||posting.locked())return;
  for(const input of form.querySelectorAll('[data-books-amount]'))validateMoney(input);
  if(!nativeCheck())return;
  try{const args=read();summary.textContent='';return posting.submit(args,{});}catch(error){summary.textContent=error.message;}
 };
 return posting;
}
function booksAutomationForm(title,fields,submit){
 return `<section class="card"><div class="heading"><h2>${esc(title)}</h2><button type="button" data-books-form-back>Back</button></div><form data-books-automation-form><p class="error" role="alert"></p>${fields}<div class="actions"><button type="submit" class="button-primary">${esc(submit)}</button></div></form></section>`;
}
function booksAutomationBack(current,open){
 $('#booksBody').querySelector('[data-books-form-back]').onclick=()=>run(()=>{if(current()&&booksPostingConfirmLeave(current))return open();});
}
function booksCorrectionForm({title,rpc,idArgs,verify,open,current}){
 $('#booksBody').innerHTML=booksAutomationForm(title,`<div class="grid">${booksDateField('date','Reversal date')}<label><span>Reason · required</span><textarea name="reason" required minlength="5" maxlength="300"></textarea></label></div><p>The original record stays in the audit trail. This creates a dated reversal.</p>`,'Post reversal');
 booksAutomationBack(current,open);
 const form=$('#booksBody').querySelector('form');
 booksAutomationBind(form,{rpc,label:'reversal',read:()=>({...idArgs,p_date:form.elements.date.value,p_reason:form.elements.reason.value.trim()}),verify,confirmation:()=> 'Reversal confirmed. Open the saved details to see the updated balance.',open,current});
}
