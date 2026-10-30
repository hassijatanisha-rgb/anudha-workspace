import {installLeaveContext} from './helpers/leave-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const customer='00000000-0000-4000-8000-000000000001';
function fixture(){
 const ctx=vm.createContext({Intl,Date,Math,Number,String,Map,Set,Array,Object,Error,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,crypto:globalThis.crypto});
 for(const name of ['vendor/xlsx.full.min.js','sales-domain.js','accounting-ledger.js','financial-import.js','opening-receivables.js'])vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),ctx);
 ctx.customers=[{id:customer,name:'Fixture Clinic',location:'Dar',deleted_at:null},{id:'00000000-0000-4000-8000-000000000002',name:'Archived Clinic',deleted_at:'2026-01-01'}];
 const run=code=>vm.runInContext(code,ctx),sheet=rows=>{ctx.rows=rows;return run('XLSX.utils.aoa_to_sheet([openingReceivablesHeaders,...rows])');};
 return {ctx,run,sheet,preview:rows=>ctx.openingReceivablesPreview(sheet(rows),ctx.customers,{cutover:'2026-10-01',today:'2026-10-19'})};
}
const rows=()=>[['HIST-001',customer,'2026-08-01','2026-09-01','123.45','TZS']];
test('preview converts residual TZS exactly and matches customers by UUID',()=>{
 const f=fixture(),p=f.preview(rows());assert.equal(p.errors.length,0);assert.equal(p.totalMinor,12345);assert.equal(p.entries[0].amount_minor,12345);assert.equal(p.rows[0].customer,'Fixture Clinic');
});
test('actual XLSX and CSV readers retain original invoice and due dates',async()=>{
 const f=fixture();f.ctx.source=f.sheet(rows());const data=f.run("(()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,source,'Receivables');return XLSX.write(w,{type:'array',bookType:'xlsx'});})()");
 const workbook=await f.ctx.financialImportRead({name:'residuals.xlsx',size:data.byteLength,arrayBuffer:async()=>data});
 let p=f.ctx.openingReceivablesPreview(workbook.Sheets.Receivables,f.ctx.customers,{cutover:'2026-10-01'});assert.equal(p.errors.length,0);assert.equal(p.entries[0].invoice_date,'2026-08-01');
 const text=`Invoice Reference,Customer UUID,Invoice Date,Due Date,Residual Amount,Currency\r\nHIST-001,${customer},2026-08-01,2026-09-01,123.45,TZS`;
 const csv=await f.ctx.financialImportRead({name:'balances.csv',size:text.length,text:async()=>text});p=f.ctx.openingReceivablesPreview(csv.Sheets[csv.SheetNames[0]],f.ctx.customers,{cutover:'2026-10-01'});assert.equal(p.totalMinor,12345);
});
test('no customer name matching or archived customer matching is allowed',()=>{
 const f=fixture();for(const value of ['Fixture Clinic','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000099']){const r=rows();r[0][1]=value;assert.match(f.preview(r).errors.join(' '),/exactly match an active customer/);}
});
test('invalid precision, nonpositive residuals, foreign currency and dates fail visibly',()=>{
 const f=fixture();for(const [column,value,pattern] of [[4,'1.001',/two decimal/],[4,'0',/above zero/],[4,'-1',/valid amount|Formulas/],[4,'1e4',/valid amount/],[5,'USD',/TZS/],[2,'2026-10-02',/on or before cutover/],[3,'2026-07-01',/on or after Invoice Date/],[2,'2026-02-30',/valid YYYY-MM-DD/]]){const r=rows();r[0][column]=value;assert.match(f.preview(r).errors.join(' '),pattern);}
 assert.match(f.ctx.openingReceivablesPreview(f.sheet(rows()),f.ctx.customers,{cutover:'2099-01-01',today:'2026-10-19'}).errors[0],/today or earlier/);
});
test('formula cells, duplicate references, extra columns and overlarge sheets block import',()=>{
 const f=fixture(),s=f.sheet(rows());s.E2.f='SUM(100,23.45)';assert.match(f.ctx.openingReceivablesPreview(s,f.ctx.customers,{cutover:'2026-10-01'}).errors.join(' '),/Formulas/);
 assert.match(f.preview([...rows(),...rows()]).errors.join(' '),/unique/);assert.match(f.preview([rows()[0].concat('ignored')]).errors.join(' '),/Unexpected data/);
 const huge=f.sheet(rows());huge['!fullref']='A1:F1002';assert.match(f.ctx.openingReceivablesPreview(huge,f.ctx.customers,{cutover:'2026-10-01'}).errors[0],/1,000/);
});
test('template includes exact active customer UUIDs and no invented residual figures',()=>{
 const f=fixture(),w=f.ctx.openingReceivablesTemplate(f.ctx.customers);assert.deepEqual(Array.from(w.SheetNames),['Receivables','Instructions','Customers']);assert.equal(w.Sheets.Receivables['!ref'],'A1:F1');assert.equal(w.Sheets.Customers.A2.v,customer);assert.equal(w.Sheets.Customers.A3,undefined);
});
test('lost responses reconcile the exact batch without resending a different payload',async()=>{
 const f=fixture(),request={p_id:'request',p_gl_import_id:'gl',p_cutover:'2026-10-01'},receipt={gl_import_id:'gl',cutover_date:'2026-10-01',reconciled:true,difference_minor:0,invoices:[]},calls=[];
 const result=await f.ctx.openingReceivablesPost({rpc:async(name,args)=>{calls.push({name,args});if(name==='import_opening_receivables')throw Error('Lost response');return {data:receipt};}},request,()=>true);
 assert.equal(result,receipt);assert.deepEqual(calls.map(c=>c.name),['import_opening_receivables','opening_receivables_status']);assert.equal(calls[1].args.p_id,'request');
});
test('wrong receipts and unconfirmed results remain uncertain; SQL rejection permits correction',async()=>{
 const f=fixture(),request={p_id:'request',p_gl_import_id:'gl',p_cutover:'2026-10-01'};
 await assert.rejects(f.ctx.openingReceivablesPost({rpc:async()=>({data:{gl_import_id:'other',reconciled:true,difference_minor:0,invoices:[]}})},request,()=>true),e=>e.uncertain===true);
 await assert.rejects(f.ctx.openingReceivablesPost({rpc:async name=>name==='opening_receivables_status'?{data:null}:{error:{message:'AR mismatch',code:'P0001'}}},request,()=>true),e=>e.uncertain===false&&/No import was recorded/.test(e.message));
});
test('stale actor completion is discarded and uncertain previews block navigation',async()=>{
 const f=fixture();let current=true;assert.equal(await f.ctx.openingReceivablesPost({rpc:async()=>{current=false;throw Error('Actor changed');}},{p_id:'old'},()=>current),null);
 installLeaveContext(f.ctx);Object.assign(f.ctx,{view:'books',message:()=>{}});f.run("booksSection='opening';openingReceivablesState={uncertain:true}");assert.equal(await f.ctx.openingReceivablesConfirmLeave(),false);f.ctx.clearOpeningReceivables();assert.equal(f.run('openingReceivablesState'),null);
});

function openingWorkspaceFixture(){
 const f=fixture(),calls=[],downloads=[],nodes=new Map();
 const elements=Object.fromEntries(['source','cutover','gl','sheet','file'].map(name=>[name,{value:'',files:[],innerHTML:'',disabled:name==='gl',focus(){}}]));
 elements.cutover.value='2026-10-01';
 const fieldset={},form={elements,querySelector:()=>fieldset};
 for(const id of ['booksBody','openingStatus','openingCheck','openingPost','openingPreview','openingExcel','openingCsv','openingBatches'])nodes.set('#'+id,{innerHTML:'',textContent:'',disabled:['openingCheck','openingPost'].includes(id)});
 nodes.set('#openingForm',form);
 Object.assign(f.ctx,{busy:false,actionFeedbackShow(){},actionFeedbackReference:node=>node,me:{user_id:'owner'},view:'books',client:{},esc:String,$:selector=>nodes.get(selector),run:fn=>fn(),booksSelectAll:async table=>{calls.push(table);return table==='organizations'?f.ctx.customers:[];}});
 f.ctx.XLSX.writeFile=(workbook,name)=>downloads.push({workbook,name});
 f.run("booksSection='opening'");
 return {...f,calls,downloads,nodes,form};
}
test('opening receivables loads customer identities only for an explicit Excel template or file',async()=>{
 const f=openingWorkspaceFixture();await f.ctx.openingReceivablesWorkspace('owner');assert.deepEqual(f.calls,[]);
 let release;f.ctx.booksSelectAll=async table=>{f.calls.push(table);return new Promise(resolve=>{release=resolve});};
 const first=f.nodes.get('#openingExcel').onclick(),second=f.nodes.get('#openingExcel').onclick();
 assert.deepEqual(f.calls,['organizations']);
 const customers=Array.from({length:1201},(_,i)=>({id:String(i),name:'Customer '+i}));release(customers);await Promise.all([first,second]);
 assert.equal(f.downloads.length,2);assert.equal(f.downloads[0].workbook.Sheets.Customers.B1202.v,'Customer 1200');
 await f.nodes.get('#openingExcel').onclick();assert.equal(f.calls.length,1,'reuse the complete identities within this import workspace');
});
test('failed lazy customer reads remain retryable and cannot create an incomplete template or preview',async()=>{
 const f=openingWorkspaceFixture();await f.ctx.openingReceivablesWorkspace('owner');let attempts=0;
 f.ctx.booksSelectAll=async()=>{if(++attempts===1)throw Error('Customers offline');return f.ctx.customers;};
 await assert.rejects(f.nodes.get('#openingExcel').onclick(),/Customers offline/);assert.equal(f.downloads.length,0);
 await f.nodes.get('#openingExcel').onclick();assert.equal(f.downloads.length,1);
 const other=openingWorkspaceFixture();await other.ctx.openingReceivablesWorkspace('owner');
 other.ctx.booksSelectAll=async()=>{throw Error('Customer identities unavailable');};
 other.ctx.financialImportRead=async()=>({SheetNames:['Receivables'],Sheets:{Receivables:other.sheet(rows())}});
 await other.form.elements.file.onchange();assert.equal(other.run('openingReceivablesState.preview'),null);assert.equal(other.nodes.get('#openingPost').disabled,true);assert.match(other.nodes.get('#openingStatus').textContent,/Customer identities unavailable/);
});
test('late customer reads cannot download or populate another actor’s import workspace',async()=>{
 for(const invalidate of [f=>{f.ctx.me={user_id:'owner'}},f=>f.ctx.clearOpeningReceivables(),f=>{f.ctx.view='sales'}]){
  const f=openingWorkspaceFixture();await f.ctx.openingReceivablesWorkspace('owner');let release;f.ctx.booksSelectAll=()=>new Promise(resolve=>{release=resolve});
  const pending=f.nodes.get('#openingExcel').onclick();invalidate(f);release(f.ctx.customers);await pending;assert.equal(f.downloads.length,0);
 }
});
test('opening batch choices load completely on request, with failure and duplicate-press recovery',async()=>{
 const f=openingWorkspaceFixture();await f.ctx.openingReceivablesWorkspace('owner');assert.equal(f.form.elements.gl.disabled,true);assert.deepEqual(f.calls,[]);
 f.ctx.booksSelectAll=async()=>{throw Error('Batches offline')};await f.nodes.get('#openingBatches').onclick();assert.equal(f.form.elements.gl.disabled,true);assert.equal(f.nodes.get('#openingBatches').disabled,false);assert.match(f.nodes.get('#openingStatus').textContent,/Batches offline/);
 let release,reads=0;f.ctx.booksSelectAll=table=>{assert.equal(table,'acc_financial_imports');reads++;return new Promise(resolve=>{release=resolve})};
 const loading=f.nodes.get('#openingBatches').onclick();await f.nodes.get('#openingBatches').onclick();assert.equal(reads,1);
 release(Array.from({length:1201},(_,i)=>({id:'batch-'+i,source:'Approved books '+i,created_at:'2026-10-01T00:00:00Z'})));await loading;
 assert.match(f.form.elements.gl.innerHTML,/value="batch-1200"/);assert.equal(f.form.elements.gl.disabled,false);assert.equal(f.nodes.get('#openingBatches').hidden,true);assert.equal(f.nodes.get('#openingPost').disabled,true);
});
test('a late opening-batch response cannot change a replaced session or import workspace',async()=>{
 for(const invalidate of [f=>{f.ctx.me={user_id:'owner'}},f=>f.ctx.clearOpeningReceivables(),f=>{f.ctx.view='sales'}]){
  const f=openingWorkspaceFixture();await f.ctx.openingReceivablesWorkspace('owner');let release;f.ctx.booksSelectAll=()=>new Promise(resolve=>{release=resolve});
  const loading=f.nodes.get('#openingBatches').onclick();invalidate(f);release([{id:'old',source:'Old books',created_at:'2026-10-01'}]);await loading;assert.equal(f.form.elements.gl.innerHTML,'');assert.equal(f.form.elements.gl.disabled,true);
 }
});
