'use strict';

async function validateDocumentAttachment(file){
 if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>10485760)throw Error('Choose a nonempty PDF, JPEG or PNG of at most 10 MB.');
 if(typeof file.name!=='string'||file.name.length>255||/[\x00-\x1f\x7f/\\]/.test(file.name))throw Error('Use a filename of at most 255 characters without slashes or control characters.');
 const extension=String(file.name||'').split('.').pop().toLowerCase();
 const mimeType={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'}[extension];
 if(!mimeType||file.type!==mimeType)throw Error('The filename extension and file type must agree: PDF, JPEG or PNG.');
 const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
 const prefix=mimeType==='application/pdf'?[37,80,68,70,45]:mimeType==='image/jpeg'?[255,216,255]:[137,80,78,71,13,10,26,10];
 if(!prefix.every((byte,index)=>bytes[index]===byte))throw Error('The file contents do not match its PDF, JPEG or PNG type.');
 return {extension,mimeType,byteSize:file.size};
}

async function openDocumentAttachments(recordType,recordId,recordLabel){
 if(!['proforma','delivery','service','accounting'].includes(recordType)||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b$/i.test(recordId))throw Error('Choose a saved document record.');
 const actor=me?.user_id,openingView=view;
 if(!actor)throw Error('Sign in to open document attachments.');
 let dialog=null,page=0,busy=false,pending=null;
 const current=()=>{
  const valid=me?.user_id===actor&&view===openingView&&(!dialog||dialog.isConnected);
  if(!valid&&dialog?.isConnected){dialog.close();dialog.remove();}
  return valid;
 };
 const checkCurrent=()=>{if(!current())throw Error('Login or page changed. Close and reopen attachments.');};
 async function requireAccess(){
  checkCurrent();
  const result=await client.rpc('document_attachment_parent_access',{p_record_type:recordType,p_record_id:recordId});
  checkCurrent();
  if(result.error)throw Error(`Attachment access could not be verified: ${result.error.message}`);
  if(result.data!==true)throw Error('You do not have access to attachments for this saved record.');
 }
 await requireAccess();
 dialog=document.createElement('dialog');dialog.className='document-attachments';dialog.setAttribute('aria-label',`Attachments for ${recordLabel}`);
 dialog.innerHTML=`<form><h2>Document attachments</h2><p>${esc(recordLabel)}</p><p>Attach a PDF, JPEG or PNG up to 10 MB to this saved record. Attachments do not issue an invoice, approve an order or change stock.</p><label>File<input type="file" data-attachment-file accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required></label><button type="submit">Upload attachment</button></form><p data-attachment-status role="status" aria-live="polite"></p><section data-attachment-list aria-label="Saved attachments"></section><div class="actions"><button type="button" data-attachment-previous>Previous</button><span data-attachment-page>Page 1</span><button type="button" data-attachment-next>Next</button></div><p>Download a saved attachment, then open it in your PDF or image viewer to print. Files remain private to authorized staff. Keep this dialog open to retry an unconfirmed upload.</p><button type="button" data-attachment-close>Close</button>`;
 document.body.append(dialog);
 const form=dialog.querySelector('form'),input=dialog.querySelector('[data-attachment-file]'),submit=dialog.querySelector('[type="submit"]'),status=dialog.querySelector('[data-attachment-status]'),list=dialog.querySelector('[data-attachment-list]'),previous=dialog.querySelector('[data-attachment-previous]'),next=dialog.querySelector('[data-attachment-next]');
 dialog.querySelector('[data-attachment-close]').onclick=()=>{if(!busy)dialog.close()};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 dialog.addEventListener('close',()=>{pending=null;dialog.remove()});
 dialog.showModal();
 async function download(row){
  if(busy||!current())return;
  busy=true;
  try{
   await requireAccess();
   status.textContent='Downloading private attachment…';
   const result=await client.storage.from('erp-documents').download(row.object_path);
   checkCurrent();if(result.error)throw result.error;
   if(!result.data)throw Error('The server returned no file.');
   const safeFile=new Blob([result.data],{type:row.mime_type});
   await validateDocumentAttachment({name:row.original_filename,type:row.mime_type,size:safeFile.size,slice:(start,end)=>safeFile.slice(start,end)});checkCurrent();
   const url=URL.createObjectURL(safeFile),link=document.createElement('a');
   try{link.href=url;link.download=row.original_filename;link.rel='noopener';document.body.append(link);link.click();status.textContent='Download requested. Open the downloaded file in your PDF or image viewer to print.';}
   finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  }catch(error){if(current())status.textContent=`Download failed: ${error.message||'Please retry.'}`;}
  finally{busy=false;}
 }
 async function loadList(){
  checkCurrent();
  const response=await client.from('document_attachments').select('id,record_type,record_id,object_path,original_filename,mime_type,byte_size,uploaded_by,uploaded_at').eq('record_type',recordType).eq('record_id',recordId).order('uploaded_at',{ascending:false}).order('id',{ascending:false}).range(page*25,page*25+24);
  checkCurrent();if(response.error)throw response.error;
  const rows=response.data||[];
  list.innerHTML=rows.map(row=>`<article><strong>${esc(row.original_filename)}</strong><p>${esc(row.mime_type)} · ${esc(row.byte_size)} bytes · ${esc(row.uploaded_at)}</p><button type="button" data-attachment-open="${esc(row.id)}">Download / open to print</button></article>`).join('')||'<p>No saved attachments on this page.</p>';
  list.querySelectorAll?.('[data-attachment-open]').forEach(button=>button.onclick=()=>download(rows.find(row=>row.id===button.dataset.attachmentOpen)));
  previous.disabled=page===0;next.disabled=rows.length<25;dialog.querySelector('[data-attachment-page]').textContent=`Page ${page+1}`;
 }
 async function changePage(direction){
  if(busy||!current()||(direction<0&&page===0)||(direction>0&&next.disabled))return;
  busy=true;const before=page;
  try{await requireAccess();page+=direction;await loadList();status.textContent='';}
  catch(error){page=before;if(current())status.textContent=`Attachments could not load: ${error.message}`;}
  finally{busy=false;}
 }
 previous.onclick=()=>changePage(-1);next.onclick=()=>changePage(1);
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!current())return;
  busy=true;submit.disabled=true;input.disabled=true;
  try{
   await requireAccess();
   if(!pending){
    const file=input.files?.[0],details=await validateDocumentAttachment(file);checkCurrent();
    const requestId=crypto.randomUUID();pending={file,...details,requestId,path:`${recordType}/${recordId}/${requestId}.${details.extension}`,uploaded:false,attempted:false};
   }
   if(pending.attempted&&!pending.uploaded){
    // Resolve a lost upload response before trying to write the same private object again.
    const prior=await client.storage.from('erp-documents').download(pending.path);checkCurrent();
    if(!prior.error&&prior.data?.size===pending.byteSize){
     const [original,stored]=await Promise.all([pending.file.slice(0,pending.byteSize).arrayBuffer(),prior.data.arrayBuffer()]);checkCurrent();
     const originalBytes=new Uint8Array(original),storedBytes=new Uint8Array(stored);
     if(originalBytes.length!==storedBytes.length||!originalBytes.every((byte,index)=>byte===storedBytes[index]))throw Error('The earlier upload contents do not match this file. Close and reopen to choose a new upload; the existing object will not be overwritten.');
     pending.uploaded=true;
    }
    else if(prior.error&&!['404','not_found'].includes(String(prior.error.statusCode||prior.error.status||prior.error.code)))throw Error('The earlier upload could not be checked. Keep this dialog open and retry.');
    else if(!prior.error)throw Error('The earlier upload size could not be confirmed. Keep this dialog open and retry.');
   }
   if(!pending.uploaded){
    status.textContent='Uploading private file…';pending.attempted=true;
    const uploaded=await client.storage.from('erp-documents').upload(pending.path,pending.file,{contentType:pending.mimeType,upsert:false});
    checkCurrent();if(uploaded.error)throw uploaded.error;pending.uploaded=true;
   }
   const finalized=await client.rpc('finalize_document_attachment',{p_id:pending.requestId,p_record_type:recordType,p_record_id:recordId,p_object_path:pending.path,p_original_filename:pending.file.name,p_mime_type:pending.mimeType,p_byte_size:pending.byteSize});
   checkCurrent();if(finalized.error)throw finalized.error;
   const saved=Array.isArray(finalized.data)?finalized.data[0]:finalized.data;
   if(saved?.id!==pending.requestId)throw Error('The server did not confirm the attachment. Retry to check the same request.');
   pending=null;input.value='';page=0;
   try{await loadList();if(current())status.textContent='Attachment saved to this record.';}
   catch(error){if(current())status.textContent=`Attachment saved. The list could not refresh: ${error.message}`;}
  }catch(error){if(current())status.textContent=`Attachment not confirmed: ${error.message||'Please retry.'}${pending?' The same file and request are retained for Retry.':''}`;}
  finally{busy=false;submit.disabled=false;input.disabled=!!pending;submit.textContent=pending?'Retry attachment':'Upload attachment';}
 };
 busy=true;
 try{await loadList();}catch(error){if(current())status.textContent=`Attachments could not load: ${error.message}`;}
 finally{busy=false;}
}
