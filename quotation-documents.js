'use strict';

function quotationDocumentsButton(record){return `<button type="button" data-quotation-documents="${esc(record.id)}">Quotation documents</button>`;}
function productBrochuresButton(product){return `<button type="button" data-product-brochures="${esc(product.id)}">Product brochures</button>`;}
function bindQuotationDocuments(){
 document.querySelectorAll('[data-quotation-documents]').forEach(button=>button.onclick=()=>run(()=>openQuotationDocuments(salesProforma(button.dataset.quotationDocuments)),{origin:button}));
 document.querySelectorAll('[data-product-brochures]').forEach(button=>button.onclick=()=>run(()=>openDocumentAttachments('product',button.dataset.productBrochures,salesProduct(button.dataset.productBrochures).name),{origin:button}));
}
function quotationDocumentParents(record){
 const parents=[{type:'proforma',id:record.id,label:'Quotation supporting files'}],seen=new Set();
 for(const line of salesDocumentLines(record))if(line.product_id&&!seen.has(line.product_id)){
  seen.add(line.product_id);parents.push({type:'product',id:line.product_id,label:line.product_name||salesProduct(line.product_id).name});
 }
 return parents;
}
// Only these public identifiers and explicitly selected filenames enter the customer cover note.
function quotationCustomerNote(record,filenames){
 return `Please find the supporting documents for quotation ${String(record.document_number||'').replace(/[\r\n]/g,' ')} (revision ${Number(record.revision)||1}).\n\n${filenames.map(name=>'- '+name).join('\n')}\n`;
}
// A bounded, uncompressed ZIP avoids dependencies and keeps original PDF/image bytes intact.
function quotationSupportingZip(files){
 if(!files.length||files.length>21||files.reduce((total,file)=>total+file.bytes.length,0)>52428800)throw Error('Select at most 20 supporting files totaling less than 50 MB.');
 const encoder=new TextEncoder(),parts=[],directory=[];let offset=0;
 const header=(length,signature)=>{const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);view.setUint32(0,signature,true);return {bytes,view};};
 for(const file of files){
  if(!file.name||file.name.length>258||/[\x00-\x1f\x7f/\\]/.test(file.name))throw Error('Invalid package filename.');
  const name=encoder.encode(file.name),bytes=file.bytes;let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  crc=(crc^0xffffffff)>>>0;
  const local=header(30,0x04034b50),central=header(46,0x02014b50);
  local.view.setUint16(4,20,true);local.view.setUint16(6,0x0800,true);local.view.setUint16(12,33,true);
  local.view.setUint32(14,crc,true);local.view.setUint32(18,bytes.length,true);local.view.setUint32(22,bytes.length,true);local.view.setUint16(26,name.length,true);
  central.view.setUint16(4,20,true);central.view.setUint16(6,20,true);central.view.setUint16(8,0x0800,true);central.view.setUint16(14,33,true);
  central.view.setUint32(16,crc,true);central.view.setUint32(20,bytes.length,true);central.view.setUint32(24,bytes.length,true);central.view.setUint16(28,name.length,true);central.view.setUint32(42,offset,true);
  parts.push(local.bytes,name,bytes);directory.push(central.bytes,name);offset+=30+name.length+bytes.length;
 }
 const end=header(22,0x06054b50);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);
 end.view.setUint32(12,directory.reduce((total,bytes)=>total+bytes.length,0),true);end.view.setUint32(16,offset,true);
 return new Blob([...parts,...directory,end.bytes],{type:'application/zip'});
}
async function openQuotationDocuments(record){
 if(!record?.id||!me?.user_id)throw Error('Choose a saved quotation.');
 const actor=me,openingView=view,epoch=salesEpoch,version=record.version,trigger=document.activeElement,selected=new Map();let dialog=null,working=false,page=0,parentIndex=0;
 const scopeCurrent=()=>me===actor&&view===openingView&&salesEpoch===epoch&&salesProforma(record.id)?.version===version;
 const current=()=>{
  const valid=scopeCurrent()&&(!dialog||dialog.isConnected);
  if(!valid){selected.clear();if(dialog?.isConnected){dialog.close();dialog.remove();}}
  return valid;
 };
 const checkCurrent=()=>{if(!current())throw Error('Login, quotation or page changed. Reopen quotation documents.');};
 async function requireAccess(type,id){
  checkCurrent();const result=await client.rpc('document_attachment_parent_access',{p_record_type:type,p_record_id:id});checkCurrent();
  if(result.error)throw Error(`Document access could not be verified: ${result.error.message}`);
  if(result.data!==true)throw Error('You do not have access to these documents.');
 }
 await requireAccess('proforma',record.id);await loadSalesRevision(record);checkCurrent();
 const parents=quotationDocumentParents(record);
 dialog=document.createElement('dialog');dialog.className='document-attachments no-print';dialog.setAttribute('aria-label','Quotation documents');
 actionFeedbackRememberDialog(dialog);
 dialog.innerHTML=`<h2>Quotation documents · ${esc(record.document_number)}</h2><p>1. Save the quotation PDF with <strong>Print / PDF</strong>. Internal remarks are excluded.</p><button type="button" data-quote-print>Print / PDF</button><p>2. Review the supporting files and product brochures below. Select only files intended for this customer; no files are selected automatically.</p><label>Document source<select data-quote-source>${parents.map((parent,index)=>`<option value="${index}">${esc(parent.label)}</option>`).join('')}</select></label><section data-quote-files aria-label="Available supporting files"></section><div class="actions"><button type="button" data-quote-previous>Previous</button><span data-quote-page></span><button type="button" data-quote-next>Next</button><button type="button" data-quote-upload>Upload / view source files</button></div><p data-quote-selection>0 files selected</p><button type="button" data-quote-download disabled>Download selected supporting files (ZIP)</button><p>3. Attach the quotation PDF and the reviewed supporting files to your message. The ZIP contains the selected files and a customer cover note; it does not contain the quotation PDF. Email is sent manually in your email app. This workspace does not automatically email quotations. Record “sent to client” only after sending.</p><p data-quote-status role="status" aria-live="polite"></p><button type="button" data-quote-close>Close</button>`;
 document.body.append(dialog);showWorkspaceDialog(dialog,{size:'large',trigger});
 const source=dialog.querySelector('[data-quote-source]'),list=dialog.querySelector('[data-quote-files]'),status=dialog.querySelector('[data-quote-status]'),previous=dialog.querySelector('[data-quote-previous]'),next=dialog.querySelector('[data-quote-next]'),download=dialog.querySelector('[data-quote-download]');
 const requestClose=bindWorkspaceDialogDismiss(dialog,{isBusy:()=>working,isDirty:()=>false});
 dialog.addEventListener('close',()=>{selected.clear();dialog.remove();});
 dialog.querySelector('[data-quote-close]').onclick=requestClose;
 dialog.querySelector('[data-quote-print]').onclick=async()=>{
  if(working||!current())return;working=true;
  // Keep printing in the initiating click; the selector is excluded by no-print.
  const closing=closeWorkspaceDialog(dialog);try{printSalesDocument(record.id);}finally{await closing;working=false;}
 };
 const upload=dialog.querySelector('[data-quote-upload]');upload.onclick=()=>{if(!working&&current())return run(async()=>{
  const parent=parents[parentIndex],closing=requestClose();working=true;
  try{if(!await closing||!scopeCurrent())return;await openDocumentAttachments(parent.type,parent.id,parent.label);}finally{working=false;}
 },{origin:upload});};
 function selectionChanged(){
  const size=[...selected.values()].reduce((total,row)=>total+Number(row.byte_size),0);
  dialog.querySelector('[data-quote-selection]').textContent=`${selected.size} files selected · ${(size/1048576).toFixed(1)} MB (maximum 20 files / 50 MB)`;download.disabled=working||selected.size===0;
 }
 async function loadPage(){
  const parent=parents[parentIndex];await requireAccess(parent.type,parent.id);
  const result=await client.from('document_attachments').select('id,record_type,record_id,object_path,original_filename,mime_type,byte_size,uploaded_at').eq('record_type',parent.type).eq('record_id',parent.id).order('uploaded_at',{ascending:false}).order('id',{ascending:false}).range(page*25,page*25+25);
  checkCurrent();if(result.error)throw result.error;
  const rows=(result.data||[]).slice(0,25);
  list.innerHTML=rows.map(row=>`<label><input type="checkbox" data-quote-file="${esc(row.id)}" ${selected.has(row.id)?'checked':''}>${esc(row.original_filename)} · ${(Number(row.byte_size)/1048576).toFixed(1)} MB · ${esc(row.uploaded_at)}</label>`).join('')||`<p>${parent.type==='product'?'No product brochures have been uploaded for this product.':'No quotation supporting files have been uploaded.'}</p>`;
  list.querySelectorAll('[data-quote-file]').forEach(input=>input.onchange=()=>{
   if(working||!current())return;
   const row=rows.find(item=>item.id===input.dataset.quoteFile);
   if(input.checked){
    const total=[...selected.values()].reduce((sum,item)=>sum+Number(item.byte_size),Number(row.byte_size));
    if(selected.size>=20||!Number.isSafeInteger(total)||total>=52428800){input.checked=false;status.textContent='Select at most 20 supporting files totaling less than 50 MB.';return;}
    selected.set(row.id,row);
   }else selected.delete(row.id);
   status.textContent='';selectionChanged();
  });
  previous.disabled=page===0;next.disabled=(result.data||[]).length<=25;dialog.querySelector('[data-quote-page]').textContent=`Page ${page+1}`;
 }
 async function reload(index,nextPage){
  if(working||!current())return;working=true;source.disabled=true;download.disabled=true;list.innerHTML='';parentIndex=index;page=nextPage;
  try{await loadPage();if(current())status.textContent='';}
  catch(error){if(current()){list.innerHTML='';previous.disabled=true;next.disabled=true;status.textContent=`Files could not load: ${error.message}`;}return error;}
  finally{working=false;if(current()){source.disabled=false;selectionChanged();}}
 }
 async function reloadFromControl(index,nextPage,button){
  if(working||!current())return;
  if(busy){source.value=String(parentIndex);return run(async()=>{},{origin:button,errorTarget:status});}
  button.disabled=true;
  await run(async()=>{const error=await reload(index,nextPage);if(error&&current())message(status.textContent,true);},{origin:button,errorTarget:status,busyLabel:'Loading documents…'});
 }
 source.onchange=()=>reloadFromControl(Number(source.value),0,source);previous.onclick=()=>{if(page>0)return reloadFromControl(parentIndex,page-1,previous);};next.onclick=()=>{if(!next.disabled)return reloadFromControl(parentIndex,page+1,next);};
 download.onclick=async()=>{
  if(working||!selected.size||!current())return;
  if(busy)return run(async()=>{},{origin:download,errorTarget:status});
  working=true;source.disabled=true;download.disabled=true;
  list.querySelectorAll('[data-quote-file]').forEach(input=>input.disabled=true);
  await run(async()=>{try{
   const rows=[...selected.values()],files=[];let size=0;
   for(const row of rows){
    await requireAccess(row.record_type,row.record_id);status.textContent=`Preparing file ${files.length+1} of ${rows.length}…`;
    const blob=await documentAttachmentBlob(row,checkCurrent);if(blob.size!==Number(row.byte_size))throw Error('File size changed; reopen and review the supporting files.');
    size+=blob.size;if(size>=52428800)throw Error('Selected files exceed the 50 MB package limit.');
    const bytes=new Uint8Array(await blob.arrayBuffer());checkCurrent();
    files.push({name:String(files.length+1).padStart(2,'0')+'-'+row.original_filename,bytes});
   }
   files.unshift({name:'00-Customer cover note.txt',bytes:new TextEncoder().encode(quotationCustomerNote(record,rows.map(row=>row.original_filename)))});
   const zip=quotationSupportingZip(files);checkCurrent();
   const url=URL.createObjectURL(zip),link=document.createElement('a');
   try{link.href=url;link.download=String(record.document_number||'Quotation').replace(/[^a-zA-Z0-9_.-]+/g,'-').slice(0,80)+'-supporting-files.zip';link.rel='noopener';document.body.append(link);link.click();status.textContent='Supporting-file ZIP download requested. Attach the quotation PDF separately and review all files before sending. Nothing has been emailed or marked sent.';message(status.textContent);}
   finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  }catch(error){if(current()){status.textContent=`Package download failed: ${error.message||'Please retry.'}`;message(status.textContent,true);}}
  finally{working=false;if(current()){source.disabled=false;list.querySelectorAll('[data-quote-file]').forEach(input=>input.disabled=false);selectionChanged();}}
  },{origin:download,successOrigin:actionFeedbackReference(download),errorTarget:status,busyLabel:'Preparing download…'});
 };
 await reload(0,0);
}
