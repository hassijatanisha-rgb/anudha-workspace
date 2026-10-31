'use strict';

// SheetJS CE 0.20.3 full browser build. Workbooks stay in memory until the reviewed journals are posted.
const financialImportHeaders=['Entry Reference','Date','Memo','Account Code','Debit','Credit','Line Description','Currency'];
const financialImportLimits={bytes:5*1024*1024,expandedBytes:25*1024*1024,rows:1000,entries:100,sheets:20};
let financialImportState=null,financialImportEpoch=0;
function clearFinancialImport(){financialImportEpoch++;financialImportState=null;}
function financialImportHasDraft(){return !!financialImportState?.preview&&!financialImportState.result;}
function financialImportIsPosting(){return !!financialImportState&&(financialImportState.busy||financialImportState.uncertain);}
async function financialImportConfirmLeave(current=workspaceNavigationContext().current){
 if(!current())return false;
 if(typeof view==='undefined'||view!=='books'||typeof booksSection==='undefined'||booksSection!=='import')return true;
 const actor=me,epoch=financialImportEpoch,state=financialImportState,preview=state?.preview;
 if(financialImportIsPosting()){message('Confirm this import’s result before leaving. Wait for posting to finish, or use Retry and reconcile this import.',true);return false;}
 if(preview&&!state.result){
  if(!await askConfirm({title:'Discard import preview?',body:'No journals have been posted from this preview.',confirmLabel:'Discard preview',tone:'danger'}))return false;
  if(!current()||me!==actor||financialImportEpoch!==epoch||view!=='books'||booksSection!=='import'||financialImportState!==state||state.preview!==preview||state.busy||state.uncertain||state.result)return false;
 }
 if(!current())return false;
 clearFinancialImport();return true;
}
function financialImportDate(value,date1904=false){
 let text=String(value??'').trim();
 if(typeof value==='number'){
  if(!Number.isInteger(value)||value<(date1904?0:1))throw Error('Use a date without a time.');
  const d=XLSX.SSF.parse_date_code(value,{date1904});
  if(!d)throw Error('Invalid Excel date.');
  text=`${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||text.startsWith('0000')||Number.isNaN(Date.parse(`${text}T00:00:00Z`))||new Date(`${text}T00:00:00Z`).toISOString().slice(0,10)!==text)throw Error('Use a valid YYYY-MM-DD date.');
 return text;
}
function financialImportPreview(sheet,accounts,{date1904=false,today=booksToday(),lockedThrough=null}={}){
 const rows=[],entries=[],errors=[],byCode=new Map(accounts.filter(a=>a.active).map(a=>[a.code,a])),groups=new Map();
 const fail=message=>({rows,entries,errors:[message]});
 if(!sheet?.['!ref'])return fail('The selected sheet is empty.');
 const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
 if(range.e.r>financialImportLimits.rows)return fail(`Use at most ${financialImportLimits.rows} data rows plus the header row. Remove unused rows before importing.`);
 if(range.e.c>31)return fail('The sheet contains too many columns. Use the downloaded template.');
 const formula=cell=>cell?.f||cell?.F||cell?.t==='e'||(typeof cell?.v==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(cell.v));
 const headerCells=financialImportHeaders.map((_,c)=>sheet[XLSX.utils.encode_cell({r:0,c})]);
 if(headerCells.some(formula))return fail('Header formulas are not supported. Use the downloaded template.');
 const headers=headerCells.map(cell=>String(cell?.v??'').trim());
 if(headers.some((name,i)=>name.toLowerCase()!==financialImportHeaders[i].toLowerCase()))return fail(`Row 1 must contain these columns in order: ${financialImportHeaders.join(', ')}.`);
 for(let r=1;r<=range.e.r;r++){
  const cells=Array.from({length:range.e.c+1},(_,c)=>sheet[XLSX.utils.encode_cell({r,c})]);
  if(cells.every(cell=>!cell||(!formula(cell)&&String(cell.v??'').trim()==='')))continue;
  const values=financialImportHeaders.map((_,c)=>cells[c]?.v??''),row={number:r+1,values,errors:[]};rows.push(row);
  const bad=message=>row.errors.push(message);
  if(cells.some(formula))bad('Formulas and spreadsheet error cells are not supported. Paste reviewed values only.');
  if(cells.slice(financialImportHeaders.length).some(cell=>String(cell?.v??'').trim()!==''))bad('Unexpected data after the Currency column.');
  const [rawReference,rawDate,rawMemo,rawCode,rawDebit,rawCredit,rawDescription,rawCurrency]=values;
  const reference=String(rawReference).trim(),memo=String(rawMemo).trim(),code=String(rawCode).trim(),description=String(rawDescription).trim(),currency=String(rawCurrency).trim().toUpperCase();
  let date='',debit=0,credit=0;
  if(!reference||reference.length>80)bad('Entry Reference must contain 1–80 characters.');
  if(memo.length<3||memo.length>500)bad('Memo must contain 3–500 characters.');
  if(description.length>300)bad('Line Description must contain at most 300 characters.');
  if(currency!=='TZS')bad('Currency must be TZS. Convert and reconcile foreign balances outside this import first.');
  try{date=financialImportDate(rawDate,date1904);if(date>booksAddDays(today,31))bad('Date cannot be more than 31 days ahead.');if(lockedThrough&&date<=lockedThrough)bad(`The books are locked through ${lockedThrough}.`);}catch(error){bad(error.message);}
  const account=byCode.get(code);if(!account)bad(`Unknown or inactive account code: ${code||'(blank)'}.`);
  try{debit=String(rawDebit).trim()===''?0:moneyMinor(String(rawDebit));credit=String(rawCredit).trim()===''?0:moneyMinor(String(rawCredit));if((debit>0)===(credit>0))bad('Enter a positive Debit or Credit, with the other blank or zero.');}catch(error){bad(error.message);}
  if(!reference)continue;
  let group=groups.get(reference);
  if(!group){group={reference,date,memo,lines:[],rows:[],debit:0,credit:0};groups.set(reference,group);}
  if(group.date!==date||group.memo!==memo)bad('Every line with this Entry Reference must have the same Date and Memo.');
  group.rows.push(row);group.lines.push({account_id:account?.id||'',debit_minor:debit,credit_minor:credit,description});group.debit+=debit;group.credit+=credit;
 }
 if(!rows.length)errors.push('Add journal lines below the header row.');
 if(groups.size>financialImportLimits.entries)errors.push(`Use at most ${financialImportLimits.entries} journal entries per file.`);
 for(const group of groups.values()){
  const problems=[];
  if(group.lines.length<2||group.lines.length>200)problems.push('Each entry needs between 2 and 200 lines.');
  if(!Number.isSafeInteger(group.debit)||!Number.isSafeInteger(group.credit))problems.push('The entry total is too large.');
  else if(group.debit!==group.credit)problems.push(`Debits and credits differ by ${moneyDisplay(Math.abs(group.debit-group.credit))}.`);
  for(const problem of problems)group.rows.forEach(row=>row.errors.push(problem));
  entries.push({reference:group.reference,date:group.date,memo:group.memo,lines:group.lines});
 }
 for(const row of rows)for(const problem of row.errors)errors.push(`Row ${row.number}: ${problem}`);
 return {rows,entries,errors};
}
// Inspect ZIP directory sizes before SheetJS expands an XLSX archive in the browser.
function financialImportXlsxBounds(data){
 const bytes=new DataView(data);let end=-1;
 for(let offset=bytes.byteLength-22;offset>=Math.max(0,bytes.byteLength-65557);offset--){if(bytes.getUint32(offset,true)===0x06054b50&&offset+22+bytes.getUint16(offset+20,true)===bytes.byteLength){end=offset;break;}}
 if(end<0)throw Error('This file is not a valid .xlsx workbook.');
 const count=bytes.getUint16(end+10,true),size=bytes.getUint32(end+12,true),start=bytes.getUint32(end+16,true);
 if(bytes.getUint16(end+4,true)||bytes.getUint16(end+6,true)||count!==bytes.getUint16(end+8,true)||count>2000||start+size!==end)throw Error('This workbook archive is unsupported or too large. Save a smaller .xlsx workbook.');
 let offset=start,expanded=0;
 for(let index=0;index<count;index++){
  if(offset+46>end||bytes.getUint32(offset,true)!==0x02014b50)throw Error('The workbook archive directory is invalid.');
  expanded+=bytes.getUint32(offset+24,true);
  if(expanded>financialImportLimits.expandedBytes)throw Error('The expanded workbook exceeds 25 MB. Save only the journal sheets to a smaller file.');
  offset+=46+bytes.getUint16(offset+28,true)+bytes.getUint16(offset+30,true)+bytes.getUint16(offset+32,true);
 }
 if(offset!==end)throw Error('The workbook archive directory is invalid.');
}
async function financialImportRead(file){
 if(!file||!Number.isFinite(file.size)||file.size<=0||file.size>financialImportLimits.bytes)throw Error('Choose a non-empty workbook or CSV no larger than 5 MB.');
 if(!/\.(xlsx|csv)$/i.test(file.name))throw Error('Choose an .xlsx workbook or an Excel CSV file.');
 if(typeof XLSX==='undefined')throw Error('The Excel reader is unavailable. Reload the page and retry.');
 const csv=/\.csv$/i.test(file.name),data=csv?await file.text():await file.arrayBuffer();
 if(!csv)financialImportXlsxBounds(data);
 const workbook=XLSX.read(data,{type:csv?'string':'array',raw:true,cellDates:false,cellFormula:true,cellText:false,sheetRows:financialImportLimits.rows+2});
 if(!workbook.SheetNames?.length||workbook.SheetNames.length>financialImportLimits.sheets)throw Error('Choose a workbook containing 1–20 sheets.');
 return workbook;
}
function financialImportTemplate(accounts){
 const workbook=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([financialImportHeaders]),'Journal');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
  ['Opening balances and journal transactions · TZS only'],
  ['Use one line per account; repeat Entry Reference, Date and Memo for every line of the same entry.'],
  ['Dates: YYYY-MM-DD or Excel dates without times. Debit/Credit: non-negative amounts with at most two decimal places.'],
  ['Every entry must balance and contain 2–200 lines. Maximum 1,000 rows and 100 entries per import.'],
  ['Use a stable source name and unique entry references. An unchanged entry is skipped; changed references are rejected.'],
  ['Use account codes from Accounts. Paste values only; formulas and foreign currencies are rejected.'],
  ['Journal imports do not create customer invoices, receipts, allocations, stock, or customer subledger opening balances.'],
  ['Reconcile control-account opening balances and customer/supplier details separately before using ageing reports.'],
  ['Fill the Journal sheet with your reviewed figures. This template contains no financial amounts.']
 ]),'Instructions');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Account Code','Account Name','Type'],...accounts.filter(a=>a.active).map(a=>[a.code,a.name,a.account_type])]),'Accounts');
 return workbook;
}
// The same request is retained after a lost response; the database also deduplicates source + reference across files.
async function financialImportPost(backend,request,current){
 if(!current())return null;
 let response,failure;
 try{response=await backend.rpc('import_financial_journals',request);if(response.error)throw Error(response.error.message);if(!response.data)throw Error('The server did not return an import receipt.');return current()?response.data:null;}
 catch(error){failure=error;}
 if(!current())return null;
 let status;
 try{status=await backend.rpc('financial_import_status',{p_id:request.p_id});}catch{}
 if(!current())return null;
 if(status&&!status.error&&status.data)return status.data;
 const rejected=status&&!status.error&&/^(?:P0001|22[A-Z0-9]{3}|23[A-Z0-9]{3}|42501|42883|PGRST202)$/.test(response?.error?.code||'');
 const error=Error(`${failure.message} ${rejected?'No import receipt was recorded. Correct the problem and retry.':'The result could not be confirmed. Retry this same import to reconcile it safely.'}`);
 error.uncertain=!rejected;throw error;
}
async function financialImportWorkspace(actor,current){
 const session=me,epoch=++financialImportEpoch,identity=actor||await requireAccountingAccess(client,()=>me);
 const active=()=>me===session&&me?.user_id===identity&&epoch===financialImportEpoch&&(current?current():view==='books'&&booksSection==='import');
 if(!active())return;
 const settings=await booksSelect('acc_settings','*');
 let accounts=null,accountLoad=null;
 const loadAccounts=()=>{
  if(accounts)return Promise.resolve(accounts);
  if(!accountLoad)accountLoad=booksSelectAll('acc_accounts','*',q=>q.order('code')).then(rows=>{if(!active())return null;accounts=rows;state.accounts=rows;return rows;}).finally(()=>{accountLoad=null;});
  return accountLoad;
 };
 if(!active())return;
 financialImportState={actor:identity,accounts,lockedThrough:settings[0]?.locked_through||null,workbook:null,sheet:'',preview:null,request:null,busy:false,uncertain:false,result:null};
 const state=financialImportState;
 $('#booksBody').innerHTML=`${booksCutoverChecklist()}<section class="card"><h2>Import Excel financials</h2><p>Import opening balances or journal transactions in TZS. Each Entry Reference becomes one balanced journal entry.</p><p class="muted">This imports general-ledger journals. It does not create customer invoices, receipts, allocations or stock. Reconcile receivables/payables control accounts and their customer/supplier details separately before relying on ageing reports.</p>
 <div class="actions"><button type="button" id="financialTemplate">Download Excel template</button><button type="button" id="financialCsvTemplate">Download CSV template</button></div>
 <form id="financialImportForm"><div class="grid"><label><span>Import type</span><select name="kind"><option value="opening">Opening balances</option><option value="journal">Journal transactions</option></select></label><label><span>Source name · keep the same on retries</span><input name="source" required maxlength="80" placeholder="Name of the source ledger"></label><label class="wide"><span>Excel workbook or CSV · maximum 5 MB</span><input name="file" type="file" accept=".xlsx,.csv"></label><label id="financialSheetLabel" hidden><span>Sheet to import</span><select name="sheet"></select></label></div>
 <p class="muted">The file stays in this browser during preview. Posting saves all reviewed entries together. Previously imported source/reference pairs are skipped only when their details match exactly. After a lost connection or sign-out, select the same file and source name to recover its result without posting it twice.</p><div id="financialImportPreview" aria-live="polite"></div><p id="financialImportStatus" role="status"></p><button type="submit" id="financialImportCommit" disabled>Post reviewed journals</button><button type="button" id="financialImportNew" hidden>Start another import</button><p id="financialImportNewStatus" role="status"></p></form></section>`;
 const form=$('#financialImportForm'),status=$('#financialImportStatus'),button=$('#financialImportCommit');
 const redraw=()=>{
  const p=state.preview;
  $('#financialImportPreview').innerHTML=!p?'':`<h3>${p.entries.length} entries · ${p.rows.length} rows</h3>${p.errors.length?`<p class="error">${p.errors.length} problems must be corrected in the file before posting.</p><ul class="error">${p.errors.slice(0,50).map(error=>`<li>${esc(error)}</li>`).join('')}</ul>${p.errors.length>50?'<p>Only the first 50 problems are listed; row details show the remaining problems.</p>':''}`:'<p>Every entry balances and all account codes are active.</p>'}<div class="table-wrap"><table><thead><tr><th>Entry reference</th><th>Date</th><th>Debits</th><th class="numeric-cell">Credits</th></tr></thead><tbody>${p.entries.map(entry=>`<tr><td>${esc(entry.reference)}</td><td>${esc(entry.date)}</td><td class="numeric-cell">${booksMoney(entry.lines.reduce((total,line)=>total+line.debit_minor,0))}</td><td class="numeric-cell">${booksMoney(entry.lines.reduce((total,line)=>total+line.credit_minor,0))}</td></tr>`).join('')}</tbody></table></div><div class="table-wrap"><table><thead><tr><th>Row</th>${financialImportHeaders.map(h=>`<th>${esc(h)}</th>`).join('')}<th>Check</th></tr></thead><tbody>${p.rows.map(row=>`<tr><td>${row.number}</td>${row.values.map(value=>`<td>${esc(String(value))}</td>`).join('')}<td>${row.errors.length?esc(row.errors.join(' ')):'Ready'}</td></tr>`).join('')}</tbody></table></div>`;
  for(const control of [form.kind,form.source,form.file,form.sheet])control.disabled=state.busy||state.uncertain||!!state.result;
  $('#financialImportNew').hidden=!state.result;
  button.disabled=state.busy||!!state.result||!p||!!p.errors.length||!form.source.value.trim();button.textContent=state.uncertain?'Retry and reconcile this import':'Post reviewed journals';
 };
 const preview=()=>{if(!active())return;state.request=null;state.result=null;state.preview=state.workbook?financialImportPreview(state.workbook.Sheets[state.sheet],accounts,{date1904:!!state.workbook.Workbook?.WBProps?.date1904,lockedThrough:state.lockedThrough}):null;status.textContent='';redraw();};
 $('#financialTemplate').onclick=()=>run(async()=>{if(!active())return;const rows=await loadAccounts();if(active()&&rows)XLSX.writeFile(financialImportTemplate(rows),'financial-journals-template.xlsx');});
 $('#financialCsvTemplate').onclick=()=>{if(active())booksDownload('financial-journals-template.csv',booksCsv(financialImportHeaders.map((h,i)=>[String(i),h]),[]));};
 // A failed settings read keeps this confirmed form available for the same read-only retry.
 const newImport=$('#financialImportNew'),newStatus=$('#financialImportNewStatus');let newImportEpoch=epoch;
 const canStartImport=()=>me===session&&me?.user_id===identity&&financialImportEpoch===newImportEpoch&&(current?current():view==='books'&&booksSection==='import')&&newImport.isConnected;
 newImport.onclick=()=>{
  if(!canStartImport()||newImport.disabled)return;if(busy){actionFeedbackRefuse(newImport,newStatus);return;}actionFeedbackShow(actionFeedbackReference(newImport),'');newImport.disabled=true;
  return run(async()=>{const loading=financialImportWorkspace(identity,current);newImportEpoch=financialImportEpoch;try{await loading;}catch(error){if(canStartImport())throw error;}finally{if(canStartImport())newImport.disabled=false;}},{origin:newImport,errorTarget:newStatus,busyLabel:'Starting another import…'});
 };
 let fileEpoch=0;
 form.file.onchange=async()=>{const generation=++fileEpoch;state.workbook=null;state.preview=null;state.request=null;form.sheet.innerHTML='';$('#financialSheetLabel').hidden=true;redraw();status.textContent='Reading file locally…';try{const [workbook,rows]=await Promise.all([financialImportRead(form.file.files[0]),loadAccounts()]);if(!active()||generation!==fileEpoch||!rows)return;state.workbook=workbook;state.sheet=workbook.SheetNames.includes('Journal')?'Journal':workbook.SheetNames[0];form.sheet.innerHTML=workbook.SheetNames.map(name=>`<option value="${esc(name)}"${name===state.sheet?' selected':''}>${esc(name)}</option>`).join('');$('#financialSheetLabel').hidden=workbook.SheetNames.length===1;preview();}catch(error){if(active()&&generation===fileEpoch){status.textContent=error.message;redraw();}}};
 form.sheet.onchange=()=>{state.sheet=form.sheet.value;preview();};form.kind.onchange=preview;form.source.oninput=()=>{state.request=null;redraw();};
 form.onsubmit=async event=>{
  event.preventDefault();if(!active()||button.disabled)return;
  if(busy){actionFeedbackRefuse(button,status);return;}actionFeedbackShow(actionFeedbackReference(button),'');
  if(!state.request)state.request={p_id:crypto.randomUUID(),p_source:form.source.value.trim(),p_kind:form.kind.value,p_entries:state.preview.entries};
  state.busy=true;status.textContent='Checking access and posting reviewed journals…';redraw();
  return run(async()=>{
  try{await requireAccountingAccess(client,()=>me);if(!active())return;const result=await financialImportPost(client,state.request,active);if(!active())return;state.result=result;state.uncertain=false;status.textContent=`Import confirmed: ${result.imported_count} posted, ${result.skipped_count} already imported. ${result.entries.map(entry=>`${entry.reference}: ${entry.entry_number}`).join('; ')}`;message('Financial import confirmed.');}
  catch(error){if(active()){state.uncertain=!!error.uncertain;status.textContent=error.message;}}
  finally{if(active()){state.busy=false;redraw();}}
  },{origin:button,errorTarget:status,busyLabel:'Posting reviewed journals…'});
 };
}
