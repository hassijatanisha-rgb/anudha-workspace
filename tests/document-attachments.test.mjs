import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const recordId='00000000-0000-0000-0000-000000000001',requestId='00000000-0000-0000-0000-000000000002';
const file=(name='proof.pdf',type='application/pdf',bytes=[37,80,68,70,45,49,46,55])=>({name,type,size:bytes.length,slice:()=>({arrayBuffer:async()=>Uint8Array.from(bytes).buffer})});
function fixture(options={}){
 const calls=[],elements=new Map(),listeners={};let finalizeCalls=0;
 const buttons=[];
 const element=selector=>{if(!elements.has(selector))elements.set(selector,{textContent:'',disabled:false,files:[],value:'',innerHTML:'',onclick:null,querySelectorAll:()=>buttons});return elements.get(selector)};
 const dialog={isConnected:true,innerHTML:'',setAttribute(){},querySelector:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,showModal(){},close(){this.isConnected=false;listeners.close?.()},remove(){this.isConnected=false}};
 const storage={upload:async(path,blob,settings)=>{calls.push(['upload',path,blob,settings]);return options.upload?options.upload():{data:{path}}},download:async path=>{calls.push(['download',path]);return options.download?options.download():{data:new Blob(['%PDF-1.7'],{type:'application/pdf'})}}};
 const query={select(){return this},eq(){return this},order(){return this},range(start,end){calls.push(['range',start,end]);const rows=options.rows?options.rows(start):[];buttons.splice(0,buttons.length,...rows.map(row=>({dataset:{attachmentOpen:row.id}})));return options.list?options.list():Promise.resolve(options.listError?{error:{message:'List unavailable'}}:{data:rows})}};
 const ctx=vm.createContext({view:'sales',me:{user_id:'one',active:true},crypto:{randomUUID:()=>requestId},Uint8Array,Blob,setTimeout:(fn,ms)=>{calls.push(['timer',fn,ms]);return 0},clearTimeout(){},URL:{createObjectURL:()=>{calls.push(['url']);return 'blob:private'},revokeObjectURL:url=>calls.push(['revoke',url])},window:{open:()=>({location:{},close(){}})},document:{body:{append(){}},createElement:tag=>tag==='a'?{click(){calls.push(['click',this.href,this.download])},remove(){}}:dialog},esc:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),client:{from:()=>query,storage:{from:bucket=>{assert.equal(bucket,'erp-documents');return storage}},rpc:async(name,args)=>{
  calls.push(['rpc',name,args]);if(name==='finalize_document_attachment'){finalizeCalls++;return options.finalize?options.finalize(finalizeCalls,args):{data:{id:requestId,...args}}}
  return options.access?options.access():{data:true};
 }}});
 const source=new URL('../document-attachments.js',import.meta.url);if(existsSync(source))vm.runInContext(readFileSync(source,'utf8'),ctx);
 return {ctx,calls,dialog,element,buttons};
}
test('file validator accepts matching PDF, JPEG and PNG and rejects mismatches/oversize',async()=>{
 const {ctx}=fixture();
 for(const sample of [file(),file('scan.jpeg','image/jpeg',[255,216,255,224]),file('scan.png','image/png',[137,80,78,71,13,10,26,10])])assert.ok(await ctx.validateDocumentAttachment(sample));
 for(const sample of [file('bad.exe'),file('bad.pdf','image/png'),file('bad.pdf','application/pdf',[60,115,99,114,105,112,116]),{...file(),size:10485761},{...file(),size:0},file('../proof.pdf'),file('bad\\name.pdf'),file('bad\nname.pdf'),file('a'.repeat(256)+'.pdf')])await assert.rejects(ctx.validateDocumentAttachment(sample));
});
test('invalid record type, missing actor and denied access cannot query or upload',async()=>{
 for(const prepare of [f=>f.ctx.me=null,f=>{}]){const f=fixture({access:async()=>({data:false})});prepare(f);await assert.rejects(f.ctx.openDocumentAttachments('proforma',recordId,'PF-1'));assert.ok(!f.calls.some(c=>c[0]==='range'||c[0]==='upload'))}
 const f=fixture();await assert.rejects(f.ctx.openDocumentAttachments('unknown',recordId,'Unknown'));assert.equal(f.calls.length,0);
});
test('metadata failure is displayed without claiming an empty successful list',async()=>{
 const f=fixture({listError:true});await f.ctx.openDocumentAttachments('proforma',recordId,'PF-1');assert.match(f.element('[data-attachment-status]').textContent,/List unavailable/);
 assert.deepEqual(f.calls.filter(c=>c[0]==='range'),[['range',0,24]]);
});
test('failed finalization retries same request without uploading twice',async()=>{
 const f=fixture({finalize:(count,args)=>count===1?{error:{message:'Finalize unavailable'}}:{data:{id:args.p_id}}});
 await f.ctx.openDocumentAttachments('proforma',recordId,'PF-1');f.element('[data-attachment-file]').files=[file()];
 await f.element('form').onsubmit({preventDefault(){}});assert.match(f.element('[data-attachment-status]').textContent,/Finalize unavailable/);
 await f.element('form').onsubmit({preventDefault(){}});
 const uploads=f.calls.filter(c=>c[0]==='upload'),finalizes=f.calls.filter(c=>c[1]==='finalize_document_attachment');assert.equal(uploads.length,1);assert.equal(finalizes.length,2);
 assert.equal(uploads[0][1],`proforma/${recordId}/${requestId}.pdf`);assert.equal(uploads[0][3].upsert,false);assert.equal(finalizes[0][2].p_id,finalizes[1][2].p_id);
 assert.match(f.element('[data-attachment-status]').textContent,/saved|attached/i);
});
test('actor change during upload never finalizes or claims success',async()=>{
 let release,started;const began=new Promise(resolve=>started=resolve);const f=fixture({upload:()=>new Promise(resolve=>{release=resolve;started()})});
 await f.ctx.openDocumentAttachments('delivery',recordId,'DN-1');f.element('[data-attachment-file]').files=[file()];const pending=f.element('form').onsubmit({preventDefault(){}});await began;f.ctx.me={user_id:'two'};release({data:{}});await pending;
 assert.ok(!f.calls.some(c=>c[1]==='finalize_document_attachment'));assert.doesNotMatch(f.element('[data-attachment-status]').textContent,/success|attached|saved/i);
});
test('failed upload remains retryable with the same object path and request',async()=>{
 let count=0;const f=fixture({upload:()=>++count===1?{error:{message:'Offline'}}:{data:{}}});await f.ctx.openDocumentAttachments('service',recordId,'Job');f.element('[data-attachment-file]').files=[file()];await f.element('form').onsubmit({preventDefault(){}});assert.match(f.element('[data-attachment-status]').textContent,/Offline/);await f.element('form').onsubmit({preventDefault(){}});
 const uploads=f.calls.filter(c=>c[0]==='upload');assert.equal(uploads[0][1],uploads.at(-1)[1]);
});
test('metadata pagination uses25 rows and downloaded files have temporary private URLs',async()=>{
 const row={id:requestId,object_path:`proforma/${recordId}/${requestId}.pdf`,original_filename:'proof.pdf',mime_type:'application/pdf',byte_size:8,uploaded_at:'2026-09-25'};
 const f=fixture({rows:start=>start===0?Array.from({length:25},()=>row):[]});await f.ctx.openDocumentAttachments('proforma',recordId,'PF');
 await f.buttons[0].onclick();assert.ok(f.calls.some(c=>c[0]==='download'&&c[1]===row.object_path));assert.ok(f.calls.some(c=>c[0]==='click'&&c[2]==='proof.pdf'));
 const timer=f.calls.find(c=>c[0]==='timer');assert.equal(timer[2],60000);timer[1]();assert.ok(f.calls.some(c=>c[0]==='revoke'));
 await f.element('[data-attachment-next]').onclick();assert.deepEqual(f.calls.filter(c=>c[0]==='range'),[['range',0,24],['range',25,49]]);assert.equal(f.element('[data-attachment-next]').disabled,true);
});
test('permission revocation before upload prevents storage writes',async()=>{
 let allowed=true;const f=fixture({access:async()=>({data:allowed})});await f.ctx.openDocumentAttachments('accounting',recordId,'Draft');allowed=false;f.element('[data-attachment-file]').files=[file()];await f.element('form').onsubmit({preventDefault(){}});assert.ok(!f.calls.some(c=>c[0]==='upload'));assert.match(f.element('[data-attachment-status]').textContent,/access/);
});
test('actor switch during download creates no URL and triggers no file download',async()=>{
 let release,started;const begun=new Promise(resolve=>started=resolve),row={id:requestId,object_path:'private',original_filename:'proof.pdf',mime_type:'application/pdf'};
 const f=fixture({rows:()=>[row],download:()=>new Promise(resolve=>{release=resolve;started()})});await f.ctx.openDocumentAttachments('proforma',recordId,'PF');const pending=f.buttons[0].onclick();await begun;f.ctx.me={user_id:'two'};release({data:new Blob(['%PDF-1.7'])});await pending;assert.ok(!f.calls.some(c=>c[0]==='url'||c[0]==='click'));
});
test('view change during initial access check prevents dialog and queries',async()=>{
 let release;const f=fixture({access:()=>new Promise(resolve=>release=resolve)});const pending=f.ctx.openDocumentAttachments('proforma',recordId,'PF');f.ctx.view='contacts';release({data:true});await assert.rejects(pending,/changed/);assert.ok(!f.calls.some(c=>c[0]==='range'));
});
test('view change during upload closes stale dialog and never finalizes',async()=>{
 let release,started;const begun=new Promise(resolve=>started=resolve);const f=fixture({upload:()=>new Promise(resolve=>{release=resolve;started()})});await f.ctx.openDocumentAttachments('proforma',recordId,'PF');f.element('[data-attachment-file]').files=[file()];const pending=f.element('form').onsubmit({preventDefault(){}});await begun;f.ctx.view='contacts';release({data:{}});await pending;assert.equal(f.dialog.isConnected,false);assert.ok(!f.calls.some(c=>c[1]==='finalize_document_attachment'));
});
test('view or actor changes during list loading remove stale dialog and discard filenames',async()=>{
 for(const change of [f=>f.ctx.view='contacts',f=>f.ctx.me={user_id:'two'}]){
  let release,started;const begun=new Promise(resolve=>started=resolve);const f=fixture({list:()=>new Promise(resolve=>{release=resolve;started()})});const pending=f.ctx.openDocumentAttachments('proforma',recordId,'PF');await begun;change(f);release({data:[{id:requestId,original_filename:'PRIVATE.pdf'}]});await pending;assert.equal(f.dialog.isConnected,false);assert.doesNotMatch(f.element('[data-attachment-list]').innerHTML,/PRIVATE/);
 }
});
test('lost upload response recovery compares bytes and refuses same-size corrupted object',async()=>{
 const f=fixture({upload:async()=>({error:{message:'Lost response'}}),download:async()=>({data:new Blob(['%PDF-X.X'],{type:'application/pdf'})})});await f.ctx.openDocumentAttachments('proforma',recordId,'PF');f.element('[data-attachment-file]').files=[file()];await f.element('form').onsubmit({preventDefault(){}});await f.element('form').onsubmit({preventDefault(){}});assert.match(f.element('[data-attachment-status]').textContent,/contents do not match/);assert.equal(f.calls.filter(c=>c[0]==='upload').length,1);assert.ok(!f.calls.some(c=>c[1]==='finalize_document_attachment'));
});
