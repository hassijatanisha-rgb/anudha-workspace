'use strict';
const openingReceivablesHeaders=['Invoice Reference','Customer UUID','Invoice Date','Due Date','Residual Amount','Currency'];
let openingReceivablesState=null,openingReceivablesEpoch=0;
function clearOpeningReceivables(){openingReceivablesEpoch++;openingReceivablesState=null;}
async function openingReceivablesConfirmLeave(current=workspaceNavigationContext().current){
 if(!current())return false;
 if(typeof view==='undefined'||view!=='books'||typeof booksSection==='undefined'||booksSection!=='opening')return true;
 const actor=me,epoch=openingReceivablesEpoch,state=openingReceivablesState,preview=state?.preview;
 if(state?.busy||state?.uncertain){message('Confirm this opening import before leaving. Retry the same import if the connection was lost.',true);return false;}
 if(preview&&!state.result){
  if(!await askConfirm({title:'Discard opening receivables preview?',body:'The preview will be cleared. No customer residuals have been imported from it.',confirmLabel:'Discard preview',tone:'danger'}))return false;
  if(!current()||me!==actor||openingReceivablesEpoch!==epoch||view!=='books'||booksSection!=='opening'||openingReceivablesState!==state||state.preview!==preview||state.busy||state.uncertain||state.result)return false;
 }
 if(!current())return false;
 clearOpeningReceivables();return true;
}
function openingReceivablesPreview(sheet,customers,{cutover,date1904=false,today=booksToday()}={}){
 const rows=[],entries=[],errors=[],known=new Map(customers.filter(c=>!c.deleted_at).map(c=>[c.id.toLowerCase(),c])),seen=new Set();let totalMinor=0;
 const fail=text=>({rows,entries,errors:[text],totalMinor});
 try{cutover=financialImportDate(cutover);if(cutover>today)return fail('Cutover must be today or earlier.');}catch(error){return fail('Choose a valid cutover date.');}
 if(!sheet?.['!ref'])return fail('The selected sheet is empty.');
 const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
 if(range.e.r>1000||range.e.c>31)return fail('Use at most 1,000 residual rows and the template columns.');
 const formula=c=>c?.f||c?.F||c?.t==='e'||(typeof c?.v==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(c.v));
 const headers=openingReceivablesHeaders.map((_,c)=>sheet[XLSX.utils.encode_cell({r:0,c})]);
 if(headers.some(formula)||headers.some((c,i)=>String(c?.v??'').trim().toLowerCase()!==openingReceivablesHeaders[i].toLowerCase()))return fail('Use the opening receivables template headers in their original order.');
 for(let r=1;r<=range.e.r;r++){
  const cells=Array.from({length:range.e.c+1},(_,c)=>sheet[XLSX.utils.encode_cell({r,c})]);
  if(cells.every(c=>!c||(!formula(c)&&String(c.v??'').trim()==='')))continue;
  const values=openingReceivablesHeaders.map((_,c)=>cells[c]?.v??''),row={number:r+1,values,errors:[]};rows.push(row);
  const bad=text=>row.errors.push(text),[rawRef,rawCustomer,rawDate,rawDue,rawAmount,rawCurrency]=values;
  const reference=String(rawRef).trim(),organization_id=String(rawCustomer).trim().toLowerCase(),currency=String(rawCurrency).trim().toUpperCase();let invoice_date='',due_date='',amount_minor=0;
  if(cells.some(formula))bad('Formulas and spreadsheet errors are not supported; paste reviewed values only.');
  if(cells.slice(6).some(c=>String(c?.v??'').trim()!==''))bad('Unexpected data after Currency.');
  if(!reference||reference.length>80||seen.has(reference))bad('Invoice Reference must be unique and contain 1–80 characters.');seen.add(reference);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(organization_id)||!known.has(organization_id))bad('Customer UUID must exactly match an active customer from the template.');
  row.customer=known.get(organization_id)?.name||'';
  try{invoice_date=financialImportDate(rawDate,date1904);due_date=financialImportDate(rawDue,date1904);if(invoice_date>cutover)bad('Invoice Date must be on or before cutover.');if(due_date<invoice_date)bad('Due Date must be on or after Invoice Date.');}catch(error){bad(error.message);}
  try{amount_minor=moneyMinor(String(rawAmount));if(amount_minor<=0)bad('Residual Amount must be above zero. Customer credits are not supported.');}catch(error){bad(error.message);}
  if(currency!=='TZS')bad('Currency must be TZS.');
  if(!row.errors.length){totalMinor+=amount_minor;if(!Number.isSafeInteger(totalMinor))bad('The total amount is too large.');else entries.push({reference,organization_id,invoice_date,due_date,amount_minor,currency});}
  errors.push(...row.errors.map(error=>`Row ${row.number}: ${error}`));
 }
 if(!rows.length)errors.push('Add at least one outstanding customer invoice to the template.');
 return {rows,entries,errors,totalMinor};
}
function openingReceivablesTemplate(customers){
 const workbook=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([openingReceivablesHeaders]),'Receivables');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
  ['Customer opening receivables · TZS only'],['One row per outstanding invoice; enter its residual amount AFTER all payments/credits through cutover.'],
  ['Use the original invoice and due dates. Cutover is an inclusive closing balance; future receipts must be after it.'],
  ['Copy the exact Customer UUID from Customers. Names are for review only and are never used to match.'],
  ['Import and reconcile the complete opening GL batch first. Select that batch and the same cutover date in the page.'],
  ['All residuals in this file must equal the selected opening batch AR amount; overall AR must also reconcile.'],
  ['Maximum 1,000 rows. Stable source and invoice references prevent duplicate imports. Paste values only.'],
  ['This adds customer balances to receipts and ageing. It creates no journal, sale, tax invoice, delivery or stock movement.'],
  ['Supplier/AP balances, customer credits, foreign currencies, historic payment details and corrections to posted opening imports are not supported.'],
  ['No amounts are supplied in this template. Accounts must review and reconcile the actual source ledger.']
 ]),'Instructions');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Customer UUID','Customer','Branch / location'],...customers.filter(c=>!c.deleted_at).map(c=>[c.id,c.name,c.location||''])]),'Customers');
 return workbook;
}
async function openingReceivablesPost(backend,request,current){
 if(!current())return null;let response,failure;
 const valid=data=>data?.gl_import_id===request.p_gl_import_id&&data?.cutover_date===request.p_cutover&&data?.reconciled===true&&Number(data.difference_minor)===0&&Array.isArray(data.invoices);
 try{response=await backend.rpc('import_opening_receivables',request);if(response.error)throw Error(response.error.message);if(!valid(response.data))throw Error('The server did not confirm this opening import.');return current()?response.data:null;}catch(error){failure=error;}
 if(!current())return null;let status;try{status=await backend.rpc('opening_receivables_status',{p_id:request.p_id});}catch{}
 if(!current())return null;if(status&&!status.error&&valid(status.data))return status.data;
 const rejected=status&&!status.error&&!status.data&&/^(?:P0001|22[A-Z0-9]{3}|23[A-Z0-9]{3}|42501)$/.test(response?.error?.code||'');
 const error=Error(failure.message+(rejected?' No import was recorded. Correct the problem and check reconciliation again.':' Result uncertain. Retry this same import to confirm it without duplicating balances.'));error.uncertain=!rejected;throw error;
}
async function openingReceivablesWorkspace(actor,current){
 const session=me,epoch=++openingReceivablesEpoch,identity=actor||await requireAccountingAccess(client,()=>me);
 const active=()=>me===session&&me?.user_id===identity&&openingReceivablesEpoch===epoch&&(current?current():view==='books'&&booksSection==='opening');
 if(!active())return;
 let customers=null,customerLoad=null;
 const loadCustomers=()=>{
  if(customers)return Promise.resolve(customers);
  if(!customerLoad)customerLoad=booksSelectAll('organizations','id,name,location,deleted_at',q=>q.order('id')).then(rows=>{if(!active())return null;customers=rows;return rows;}).finally(()=>{customerLoad=null;});
  return customerLoad;
 };
 if(!active())return;
 const state=openingReceivablesState={workbook:null,preview:null,check:null,request:null,busy:false,uncertain:false,result:null};
 $('#booksBody').innerHTML=`<section class="card"><h2>Opening customer receivables</h2><p>Add outstanding customer invoices to receipts and ageing using their residual TZS balances at cutover. The opening general ledger must already be imported. This creates no additional journal, sale, tax invoice or stock movement.</p><p class="muted">Supplier/AP balances, customer credits, foreign currencies, historic payment details and corrections to posted opening imports are not supported. Use one complete file of at most 1,000 invoices per opening GL batch.</p><div class="actions"><button type="button" id="openingExcel">Download Excel template</button><button type="button" id="openingCsv">Download CSV template</button></div>
 <form id="openingForm"><fieldset><legend>Source and cutover</legend><div class="grid"><label><span>Source name · keep on retries</span><input name="source" required maxlength="80"></label><label><span>Cutover · closing balance through this date</span><input name="cutover" type="date" required max="${esc(booksToday())}"></label><label class="wide"><span>Imported opening GL batch</span><select name="gl" required disabled><option value="">Load opening batches to choose</option></select><button type="button" id="openingBatches">Load opening batches</button></label><label><span>Excel or CSV · maximum 5 MB</span><input name="file" type="file" accept=".xlsx,.csv"></label><label><span>Sheet</span><select name="sheet"></select></label></div></fieldset><div id="openingPreview" aria-live="polite"></div><p id="openingStatus" role="status"></p><div class="actions"><button type="button" id="openingCheck" disabled>Check AR reconciliation</button><button type="submit" id="openingPost" disabled>Import customer residuals</button></div></form></section>`;
 const form=$('#openingForm'),status=$('#openingStatus'),check=$('#openingCheck'),post=$('#openingPost'),fields=form.querySelector('fieldset');let fileEpoch=0;
 const args=()=>({p_source:form.elements.source.value.trim(),p_cutover:form.elements.cutover.value,p_gl_import_id:form.elements.gl.value,p_rows:state.preview.entries});
 const redraw=()=>{const p=state.preview;fields.disabled=state.busy||state.uncertain||!!state.result;check.disabled=fields.disabled||!p||p.errors.length>0||!form.elements.source.value.trim()||!form.elements.gl.value;post.disabled=state.busy||!!state.result||(!state.check&&!state.uncertain);post.textContent=state.uncertain?'Retry and confirm opening import':'Import customer residuals';
  $('#openingPreview').innerHTML=!p?'':`<h3>${p.entries.length} residuals · ${booksMoney(p.totalMinor)}</h3>${p.errors.length?`<ul class="error">${p.errors.slice(0,50).map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:'<p>File validation passed. Check the two AR reconciliations before importing.</p>'}<div class="table-wrap"><table><thead><tr><th>Row</th><th>Customer</th>${openingReceivablesHeaders.map(h=>`<th>${esc(h)}</th>`).join('')}<th>Check</th></tr></thead><tbody>${p.rows.map(r=>`<tr><td>${r.number}</td><td>${esc(r.customer)}</td>${r.values.map(v=>`<td>${esc(v)}</td>`).join('')}<td>${esc(r.errors.join(' ')||'Ready')}</td></tr>`).join('')}</tbody></table></div>`;};
 const preview=()=>{state.request=null;state.check=null;state.preview=state.workbook?openingReceivablesPreview(state.workbook.Sheets[form.elements.sheet.value],customers,{cutover:form.elements.cutover.value,date1904:!!state.workbook.Workbook?.WBProps?.date1904}):null;status.textContent='';redraw();};
 $('#openingBatches').onclick=()=>{
  const button=$('#openingBatches');if(!active()||button.disabled)return;if(busy){actionFeedbackRefuse(button,status);return;}actionFeedbackShow(actionFeedbackReference(button),'');button.disabled=true;
  return run(async()=>{
  try{
   const imports=await booksSelectAll('acc_financial_imports','id,source,created_at',q=>q.eq('import_kind','opening').order('created_at',{ascending:false}).order('id'));
   if(!active())return;
   form.elements.gl.innerHTML='<option value="">Choose the matching opening batch</option>'+imports.map(row=>`<option value="${esc(row.id)}">${esc(row.source)} · ${esc(String(row.created_at).slice(0,10))}</option>`).join('');
   form.elements.gl.disabled=false;button.hidden=true;status.textContent=imports.length?'':'No opening general ledger batches are available.';form.elements.gl.focus();
  }catch(error){if(active())status.textContent='Opening batches could not load: '+error.message;}
  finally{if(active())button.disabled=false;}
  },{origin:button,errorTarget:status,busyLabel:'Loading opening batches…'});
 };
 $('#openingExcel').onclick=()=>run(async()=>{if(!active())return;const rows=await loadCustomers();if(active()&&rows)XLSX.writeFile(openingReceivablesTemplate(rows),'opening-customer-receivables.xlsx');});
 $('#openingCsv').onclick=()=>{if(active())booksDownload('opening-customer-receivables.csv',booksCsv(openingReceivablesHeaders.map((h,i)=>[String(i),h]),[]));};
 for(const name of ['source','cutover','gl','sheet'])form.elements[name].onchange=preview;form.elements.source.oninput=preview;
 form.elements.file.onchange=async()=>{const generation=++fileEpoch;state.workbook=null;state.preview=null;state.check=null;state.request=null;redraw();status.textContent='Reading locally…';try{const [workbook,rows]=await Promise.all([financialImportRead(form.elements.file.files[0]),loadCustomers()]);if(!active()||generation!==fileEpoch||!rows)return;state.workbook=workbook;form.elements.sheet.innerHTML=workbook.SheetNames.map(name=>`<option>${esc(name)}</option>`).join('');form.elements.sheet.value=workbook.SheetNames.includes('Receivables')?'Receivables':workbook.SheetNames[0];preview();}catch(error){if(active()&&generation===fileEpoch)status.textContent=error.message;}};
 check.onclick=async()=>{if(!active()||check.disabled)return;if(busy){actionFeedbackRefuse(check,status);return;}actionFeedbackShow(actionFeedbackReference(check),'');state.busy=true;redraw();return run(async()=>{try{await requireAccountingAccess(client,()=>me);if(!active())return;const response=await client.rpc('opening_receivables_check',args());if(!active())return;if(response.error)throw Error(response.error.message);if(response.data?.reconciled!==true||Number(response.data.difference_minor)!==0)throw Error('AR reconciliation was not confirmed.');state.check=response.data;status.textContent=`AR reconciled: selected opening GL ${booksMoney(state.check.imported_gl_ar_minor)} = file ${booksMoney(state.check.opening_residual_minor)}. Overall AR control ${booksMoney(state.check.control_ar_minor)} = customer balances after import ${booksMoney(state.check.customer_subledger_minor)}.`;message('AR reconciliation confirmed.');}catch(error){if(active()){state.check=null;status.textContent=error.message;}}finally{if(active()){state.busy=false;redraw();}}},{origin:check,errorTarget:status,busyLabel:'Checking AR reconciliation…'});};
 form.onsubmit=async event=>{event.preventDefault();if(!active()||post.disabled)return;if(busy){actionFeedbackRefuse(post,status);return;}actionFeedbackShow(actionFeedbackReference(post),'');if(!state.request)state.request={p_id:crypto.randomUUID(),...args()};state.busy=true;redraw();return run(async()=>{try{await requireAccountingAccess(client,()=>me);if(!active())return;const result=await openingReceivablesPost(client,state.request,active);if(!active())return;state.result=result;state.uncertain=false;status.textContent=`Opening import confirmed: ${result.imported_count} customer residuals${result.already_imported?' already imported':''}. No new GL journal was posted. Use Receipts to settle these balances after cutover.`;message('Opening import confirmed.');}catch(error){if(active()){state.uncertain=!!error.uncertain;if(!state.uncertain)state.check=null;status.textContent=error.message;}}finally{if(active()){state.busy=false;redraw();}}},{origin:post,errorTarget:status,busyLabel:'Importing customer residuals…'});};
}
