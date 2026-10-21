import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crc32} from 'node:zlib';
import vm from 'node:vm';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const quote={id:'00000000-0000-4000-8000-000000000001',version:1,revision:2,document_number:'PF-2',internal_notes:'SECRET INTERNAL REMARK',notes:'Customer terms'};
const product='00000000-0000-4000-8000-000000000002';
const row=(extra={})=>({id:'00000000-0000-4000-8000-000000000003',record_type:'product',record_id:product,original_filename:'Broschüre.pdf',object_path:'product/private',mime_type:'application/pdf',byte_size:8,uploaded_at:'2026-10-20',...extra});
function fixture(options={}){
 const calls=[],nodes=new Map(),listeners={},checks=[];let zip;
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{disabled:false,value:'0',textContent:'',innerHTML:'',querySelectorAll:()=>checks});return nodes.get(selector);};
 const dialog={isConnected:true,innerHTML:'',setAttribute(){},showModal(){},querySelector:node,addEventListener:(type,fn)=>listeners[type]=fn,close(){listeners.close?.();},remove(){this.isConnected=false;}};
 const ctx=vm.createContext({Blob,Uint8Array,DataView,TextEncoder,me:{user_id:'actor'},view:'sales',salesEpoch:0,
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';'),run:fn=>fn(),salesProforma:()=>quote,salesProduct:()=>({name:'Live changed product'}),
  salesDocumentLines:()=>[{product_id:product,product_name:'Saved <Analyzer>'},{product_id:product,product_name:'Saved <Analyzer>'}],loadSalesRevision:async()=>calls.push(['snapshot']),printSalesDocument:id=>calls.push(['print',id]),
  URL:{createObjectURL:blob=>{zip=blob;calls.push(['url']);return 'blob:zip';},revokeObjectURL:url=>calls.push(['revoke',url])},setTimeout:(fn,ms)=>calls.push(['timer',fn,ms]),
  document:{querySelectorAll:()=>[],body:{append(){}},createElement:tag=>tag==='a'?{click(){calls.push(['click',this.download]);},remove(){}}:dialog},
  client:{rpc:async(name,args)=>{calls.push(['rpc',name,args]);return options.access?options.access(args):{data:true};},from:()=>{
   const filters={};return {select(){return this;},eq(key,value){filters[key]=value;return this;},order(){return this;},range(start,end){calls.push(['list',filters,start,end]);const rows=options.rows?options.rows(filters,start):[];checks.splice(0,checks.length,...rows.slice(0,25).map(row=>({dataset:{quoteFile:row.id},checked:false})));return options.list?options.list():Promise.resolve({data:rows});}};
  },storage:{from:()=>({download:async path=>{calls.push(['download',path]);return options.download?options.download():{data:new Blob(['%PDF-1.7'])};}})}}});
 vm.runInContext(read('document-attachments.js')+'\n'+read('quotation-documents.js'),ctx);
 return {ctx,calls,node,dialog,checks,get zip(){return zip;}};
}
function zipEntries(buffer){
 const entries=[];let offset=0;
 while(buffer.readUInt32LE(offset)===0x04034b50){
  assert.equal(buffer.readUInt16LE(offset+6),0x0800);assert.equal(buffer.readUInt16LE(offset+8),0);
  const size=buffer.readUInt32LE(offset+18),length=buffer.readUInt16LE(offset+26),start=offset+30+length;
  const name=buffer.subarray(offset+30,start).toString(),bytes=buffer.subarray(start,start+size);
  assert.equal(buffer.readUInt32LE(offset+14),crc32(bytes));entries.push({name,bytes});offset=start+size;
 }
 const directoryStart=offset;
 for(const entry of entries){assert.equal(buffer.readUInt32LE(offset),0x02014b50);const length=buffer.readUInt16LE(offset+28);assert.equal(buffer.subarray(offset+46,offset+46+length).toString(),entry.name);assert.equal(buffer.readUInt32LE(offset+20),entry.bytes.length);offset+=46+length;}
 assert.equal(buffer.readUInt32LE(offset),0x06054b50);assert.equal(buffer.readUInt16LE(offset+10),entries.length);assert.equal(buffer.readUInt32LE(offset+12),offset-directoryStart);assert.equal(buffer.readUInt32LE(offset+16),directoryStart);
 return entries;
}
test('quotation sources deduplicate saved products and exclude live product names and internal remarks',async()=>{
 const f=fixture();await f.ctx.openQuotationDocuments(quote);
 assert.match(f.dialog.innerHTML,/Saved &#60;Analyzer&#62;/);assert.doesNotMatch(f.dialog.innerHTML,/SECRET|Live changed/);assert.match(f.dialog.innerHTML,/does not automatically email/);
 assert.equal(f.ctx.quotationDocumentParents(quote).length,2);assert.match(f.node('[data-quote-files]').innerHTML,/No quotation supporting files/);assert.equal(f.node('[data-quote-download]').disabled,true);
 f.node('[data-quote-source]').value='1';await f.node('[data-quote-source]').onchange();assert.match(f.node('[data-quote-files]').innerHTML,/No product brochures/);
});
test('explicitly selected supporting files produce a private ZIP with valid CRCs and no private notes',async()=>{
 const f=fixture({rows:()=>[row(),row({id:'not-selected',original_filename:'Other-private.pdf'})]});await f.ctx.openQuotationDocuments(quote);
 assert.doesNotMatch(f.node('[data-quote-files]').innerHTML,/checked/);assert.equal(f.node('[data-quote-download]').disabled,true);
 f.checks[0].checked=true;f.checks[0].onchange();await f.node('[data-quote-download]').onclick();
 assert.equal(f.calls.filter(call=>call[0]==='download').length,1);assert.ok(f.calls.some(call=>call[0]==='rpc'&&call[2].p_record_type==='product'));
 const entries=zipEntries(Buffer.from(await f.zip.arrayBuffer()));assert.deepEqual(entries.map(entry=>entry.name),['00-Customer cover note.txt','01-Broschüre.pdf']);assert.equal(entries[1].bytes.toString(),'%PDF-1.7');
 assert.match(entries[0].bytes.toString(),/PF-2 \(revision 2\)/);assert.doesNotMatch(entries[0].bytes.toString(),/SECRET|Customer terms|Other-private|object_path/);
 assert.ok(f.calls.some(call=>call[0]==='click'&&call[1]==='PF-2-supporting-files.zip'));assert.ok(!f.calls.some(call=>call[1]==='advance_sales_proforma'));
 const timer=f.calls.find(call=>call[0]==='timer');assert.equal(timer[2],60000);timer[1]();assert.ok(f.calls.some(call=>call[0]==='revoke'));
});
test('supporting selections survive bounded paging and never include unselected pages',async()=>{
 const f=fixture({rows:(_,start)=>start===0?Array.from({length:26},(_,i)=>row({id:String(i)})):[]});await f.ctx.openQuotationDocuments(quote);
 assert.equal(f.checks.length,25);f.checks[0].checked=true;f.checks[0].onchange();await f.node('[data-quote-next]').onclick();assert.match(f.node('[data-quote-selection]').textContent,/1 files selected/);
 assert.deepEqual(f.calls.filter(call=>call[0]==='list').map(call=>call.slice(2)),[[0,25],[25,50]]);assert.equal(f.node('[data-quote-next]').disabled,true);
});
test('twenty-file bound rejects another selection before any download',async()=>{
 const f=fixture({rows:()=>Array.from({length:21},(_,i)=>row({id:String(i)}))});await f.ctx.openQuotationDocuments(quote);
 for(const checkbox of f.checks){checkbox.checked=true;checkbox.onchange();}
 assert.equal(f.checks[20].checked,false);assert.match(f.node('[data-quote-status]').textContent,/at most 20/);assert.equal(f.calls.filter(call=>call[0]==='download').length,0);
});
test('permission revocation prevents private downloads and size/content failures create no ZIP',async()=>{
 let allowed=true;const f=fixture({rows:()=>[row()],access:()=>({data:allowed})});await f.ctx.openQuotationDocuments(quote);f.checks[0].checked=true;f.checks[0].onchange();allowed=false;
 await f.node('[data-quote-download]').onclick();assert.match(f.node('[data-quote-status]').textContent,/do not have access/);assert.ok(!f.calls.some(call=>call[0]==='download'||call[0]==='url'));
 for(const payload of ['%PDF-1.7changed','<script>']){const f=fixture({rows:()=>[row()],download:()=>({data:new Blob([payload])})});await f.ctx.openQuotationDocuments(quote);f.checks[0].checked=true;f.checks[0].onchange();await f.node('[data-quote-download]').onclick();assert.match(f.node('[data-quote-status]').textContent,/failed/);assert.equal(f.zip,undefined);}
});
test('session changes during private download discard contents without creating a package URL',async()=>{
 let release,started;const begun=new Promise(resolve=>started=resolve),f=fixture({rows:()=>[row()],download:()=>new Promise(resolve=>{release=resolve;started();})});
 await f.ctx.openQuotationDocuments(quote);f.checks[0].checked=true;f.checks[0].onchange();const pending=f.node('[data-quote-download]').onclick();await begun;f.ctx.me={user_id:'actor'};release({data:new Blob(['%PDF-1.7'])});await pending;
 assert.equal(f.dialog.isConnected,false);assert.equal(f.zip,undefined);assert.ok(!f.calls.some(call=>call[0]==='click'));
});
test('list failures stay explicit and changed-page responses never display private filenames',async()=>{
 const failed=fixture({list:()=>({error:Error('Files unavailable')})});await failed.ctx.openQuotationDocuments(quote);assert.match(failed.node('[data-quote-status]').textContent,/Files unavailable/);
 let release,started;const begun=new Promise(resolve=>started=resolve),f=fixture({list:()=>new Promise(resolve=>{release=resolve;started();})});const pending=f.ctx.openQuotationDocuments(quote);await begun;f.ctx.view='contacts';release({data:[row()]});await pending;
 assert.equal(f.dialog.isConnected,false);assert.equal(f.node('[data-quote-files]').innerHTML,'');
});
test('print closes the document selector before invoking existing customer-safe print',async()=>{
 const f=fixture();await f.ctx.openQuotationDocuments(quote);f.node('[data-quote-print]').onclick();assert.equal(f.dialog.isConnected,false);assert.ok(f.calls.some(call=>call[0]==='print'&&call[1]===quote.id));
});
test('ZIP rejects unsafe names and preserves duplicate source filenames under unique prefixes',async()=>{
 const f=fixture();for(const name of ['../private.pdf','bad\\name.pdf','control\n.pdf'])assert.throws(()=>f.ctx.quotationSupportingZip([{name,bytes:new Uint8Array([1])}]),/filename/);
 const zip=f.ctx.quotationSupportingZip([{name:'01-file.pdf',bytes:new Uint8Array([1])},{name:'02-file.pdf',bytes:new Uint8Array([2])}]);assert.equal(zipEntries(Buffer.from(await zip.arrayBuffer())).length,2);
});
