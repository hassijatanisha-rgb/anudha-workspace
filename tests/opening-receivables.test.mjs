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
 Object.assign(f.ctx,{view:'books',message:()=>{}});f.run("booksSection='opening';openingReceivablesState={uncertain:true}");assert.equal(f.ctx.openingReceivablesConfirmLeave(),false);f.ctx.clearOpeningReceivables();assert.equal(f.run('openingReceivablesState'),null);
});
