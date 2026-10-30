import {installLeaveContext} from './helpers/leave-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){
 const ctx=vm.createContext({Intl,Date,Math,Number,String,Map,Set,Array,Object,Error,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,crypto:globalThis.crypto});
 for(const name of ['vendor/xlsx.full.min.js','sales-domain.js','accounting-ledger.js','financial-import.js'])vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),ctx,{filename:name});
 ctx.accounts=[{id:'bank',code:'1200',name:'Bank',active:true,account_type:'asset'},{id:'capital',code:'3000',name:'Capital',active:true,account_type:'equity'},{id:'old',code:'6100',active:false}];
 return ctx;
}
const run=(ctx,expr)=>vm.runInContext(expr,ctx);
function sheet(ctx,rows){ctx.inputRows=rows;return run(ctx,'XLSX.utils.aoa_to_sheet([financialImportHeaders,...inputRows])');}
const rows=()=>[['OPEN-1','2026-10-10','Opening balances','1200','125.50','','','TZS'],['OPEN-1','2026-10-10','Opening balances','3000','','125.50','','TZS']];
function preview(ctx,source){ctx.sheet=source;return run(ctx,"financialImportPreview(sheet,accounts,{today:'2026-10-16'})");}

test('the actual vendored XLSX build roundtrips a workbook and preserves minor amounts',async()=>{
 const ctx=load();assert.equal(ctx.XLSX.version,'0.20.3');ctx.sheet=sheet(ctx,rows());
 const data=run(ctx,"(()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,sheet,'Reviewed Journal');return XLSX.write(w,{type:'array',bookType:'xlsx'});})()");
 ctx.file={name:'balances.xlsx',size:data.byteLength,arrayBuffer:async()=>data};
 const workbook=await run(ctx,'financialImportRead(file)');
 assert.deepEqual(Array.from(workbook.SheetNames),['Reviewed Journal']);
 const result=preview(ctx,workbook.Sheets['Reviewed Journal']);assert.equal(result.errors.length,0);assert.equal(result.entries.length,1);
 assert.equal(result.entries[0].lines[0].debit_minor,12550);assert.equal(result.entries[0].lines[1].credit_minor,12550);assert.equal(result.entries[0].lines[0].account_id,'bank');
});

test('Excel CSV handles BOM, quotes and line descriptions without changing amounts',async()=>{
 const ctx=load(),text='\uFEFFEntry Reference,Date,Memo,Account Code,Debit,Credit,Line Description,Currency\r\nR1,2026-10-10,"Opening, reviewed",1200,12.30,,"Bank\nstatement",TZS\r\nR1,2026-10-10,"Opening, reviewed",3000,,12.30,,TZS';
 ctx.file={name:'balances.csv',size:text.length,text:async()=>text};const workbook=await run(ctx,'financialImportRead(file)');
 const result=preview(ctx,workbook.Sheets[workbook.SheetNames[0]]);assert.equal(result.errors.length,0);assert.equal(result.entries[0].lines[0].debit_minor,1230);assert.equal(result.entries[0].lines[0].description,'Bank\nstatement');
});

test('formulas are rejected even with cached numeric values, blank results or header values',()=>{
 const ctx=load(),source=sheet(ctx,rows());source.E2={t:'n',v:125.5,f:'SUM(100,25.5)'};
 assert.match(preview(ctx,source).errors.join(' '),/Formulas/);
 source.E2={t:'n',v:125.5};source.A4={t:'s',f:'IF(TRUE,"","")'};source['!ref']='A1:H4';
 assert.match(preview(ctx,source).errors.join(' '),/Row 4: Formulas/);
 source.A1.f='"Entry Reference"';assert.match(preview(ctx,source).errors[0],/Header formulas/);
 const values=rows();values[0][6]='  =HYPERLINK("bad")';assert.match(preview(ctx,sheet(ctx,values)).errors.join(' '),/Formulas/);
});

test('invalid money, accounts, metadata, currency and balance are row errors',()=>{
 const ctx=load();
 for(const [column,value,expected] of [[3,'6100',/inactive account/],[4,'1.234',/two decimal/],[4,'1e3',/valid amount/],[4,'900719925474099.99',/too large/],[7,'USD',/Currency must be TZS/],[1,'2026-02-30',/valid YYYY-MM-DD/],[1,'2026-12-20',/31 days/]]){
  const data=rows();data[0][column]=value;assert.match(preview(ctx,sheet(ctx,data)).errors.join(' '),expected);
 }
 const metadata=rows();metadata[1][2]='Different memo';assert.match(preview(ctx,sheet(ctx,metadata)).errors.join(' '),/same Date and Memo/);
 const both=rows();both[0][5]='1';assert.match(preview(ctx,sheet(ctx,both)).errors.join(' '),/positive Debit or Credit/);
 const unequal=rows();unequal[1][5]='124.50';assert.match(preview(ctx,sheet(ctx,unequal)).errors.join(' '),/differ by/);
 ctx.sheet=sheet(ctx,rows());assert.match(run(ctx,"financialImportPreview(sheet,accounts,{today:'2026-10-16',lockedThrough:'2026-10-10'})").errors.join(' '),/locked through/);
});

test('Excel date systems reject times and the fictional 1900 leap day',()=>{
 const ctx=load();
 assert.equal(run(ctx,'financialImportDate(1)'), '1900-01-01');assert.equal(run(ctx,'financialImportDate(0,true)'),'1904-01-01');
 assert.throws(()=>run(ctx,'financialImportDate(60)'),/valid YYYY-MM-DD/);assert.throws(()=>run(ctx,'financialImportDate(46200.5)'),/without a time/);
});

test('file, worksheet, entry and row bounds fail visibly',async()=>{
 const ctx=load();ctx.file={name:'huge.xlsx',size:5*1024*1024+1,arrayBuffer:()=>{throw Error('Must not read oversized file');}};
 await assert.rejects(run(ctx,'financialImportRead(file)'),/no larger than 5 MB/);
 ctx.file={name:'old.xls',size:1};await assert.rejects(run(ctx,'financialImportRead(file)'),/xlsx workbook or an Excel CSV/);
 const tooMany=sheet(ctx,rows());tooMany['!fullref']='A1:H1002';assert.match(preview(ctx,tooMany).errors[0],/1000 data rows/);
 const truncated=Array.from({length:1002},()=>rows()[0]);ctx.sheet=sheet(ctx,truncated);const data=run(ctx,"(()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,sheet,'Too many');return XLSX.write(w,{type:'array',bookType:'xlsx'});})()");
 ctx.file={name:'too-many.xlsx',size:data.byteLength,arrayBuffer:async()=>data};const workbook=await run(ctx,'financialImportRead(file)');assert.match(preview(ctx,workbook.Sheets['Too many']).errors[0],/1000 data rows/);
 const entries=Array.from({length:101},(_,i)=>rows().map(row=>[String(i),...row.slice(1)])).flat();assert.match(preview(ctx,sheet(ctx,entries)).errors.join(' '),/100 journal entries/);
 const manyLines=Array.from({length:201},()=>rows()[0]);assert.match(preview(ctx,sheet(ctx,manyLines)).errors.join(' '),/between 2 and 200/);
});

test('template has instructions and real account codes but no financial rows',()=>{
 const ctx=load(),template=run(ctx,'financialImportTemplate(accounts)');
 assert.deepEqual(Array.from(template.SheetNames),['Journal','Instructions','Accounts']);assert.equal(template.Sheets.Journal['!ref'],'A1:H1');assert.equal(template.Sheets.Accounts.A2.v,'1200');assert.equal(template.Sheets.Accounts.A3.v,'3000');assert.equal(template.Sheets.Accounts.A4,undefined);
});

test('lost commit responses reconcile against the same batch id',async()=>{
 const ctx=load(),calls=[],request={p_id:'stable',p_source:'Ledger',p_kind:'opening',p_entries:[]},receipt={batch_id:'stable',imported_count:1,skipped_count:0,entries:[]};
 ctx.request=request;ctx.current=()=>true;ctx.backend={async rpc(name,args){calls.push([name,args]);if(name==='import_financial_journals')throw Error('Connection dropped');return {data:receipt};}};
 assert.equal(await run(ctx,'financialImportPost(backend,request,current)'),receipt);assert.deepEqual(calls.map(([name])=>name),['import_financial_journals','financial_import_status']);assert.equal(calls[1][1].p_id,'stable');
});

test('unresolved retries retain their identity and stale actors cannot write or reconcile',async()=>{
 const ctx=load(),request={p_id:'stable'},calls=[];ctx.request=request;ctx.current=()=>true;
 ctx.backend={async rpc(name,args){calls.push([name,args]);throw Error('Offline');}};
 await assert.rejects(run(ctx,'financialImportPost(backend,request,current)'),error=>error.uncertain===true);
 await assert.rejects(run(ctx,'financialImportPost(backend,request,current)'),error=>error.uncertain===true);
 assert.ok(calls.filter(([name])=>name==='import_financial_journals').every(([,args])=>args===request));
 calls.length=0;ctx.current=()=>false;assert.equal(await run(ctx,'financialImportPost(backend,request,current)'),null);assert.equal(calls.length,0);
 let active=true;ctx.current=()=>active;ctx.backend={async rpc(name){calls.push(name);active=false;throw Error('Login changed');}};
 assert.equal(await run(ctx,'financialImportPost(backend,request,current)'),null);assert.deepEqual(calls,['import_financial_journals']);
});

test('a fetch error returned as data remains uncertain; a confirmed SQL rejection permits correction',async()=>{
 const ctx=load();ctx.request={p_id:'stable'};ctx.current=()=>true;
 ctx.backend={async rpc(name){return name==='financial_import_status'?{data:null}:{error:{message:'Failed to fetch',code:''}};}};
 await assert.rejects(run(ctx,'financialImportPost(backend,request,current)'),error=>error.uncertain===true);
 ctx.backend={async rpc(name){return name==='financial_import_status'?{data:null}:{error:{message:'Books locked',code:'P0001'}};}};
 await assert.rejects(run(ctx,'financialImportPost(backend,request,current)'),error=>error.uncertain===false&&/Correct the problem/.test(error.message));
});

test('session clearing discards workbooks, results and pending identity',()=>{
 const ctx=load();run(ctx,"financialImportState={workbook:{private:'data'},preview:{},request:{p_id:'stable'},busy:true};financialImportEpoch=7");
 assert.equal(run(ctx,'financialImportHasDraft()'),true);assert.equal(run(ctx,'financialImportIsPosting()'),true);
 run(ctx,'clearFinancialImport()');assert.equal(run(ctx,'financialImportState'),null);assert.equal(run(ctx,'financialImportEpoch'),8);assert.equal(run(ctx,'financialImportHasDraft()'),false);assert.equal(run(ctx,'financialImportIsPosting()'),false);
});

test('an inflated XLSX archive is rejected before the workbook parser expands it',async()=>{
 const ctx=load();ctx.sheet=sheet(ctx,rows());
 const data=run(ctx,"(()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,sheet,'Journal');return XLSX.write(w,{type:'array',bookType:'xlsx'});})()");
 const view=new DataView(data);let changed=false;
 for(let offset=0;offset<data.byteLength-46;offset++){if(view.getUint32(offset,true)===0x02014b50){view.setUint32(offset+24,30*1024*1024,true);changed=true;break;}}
 assert.equal(changed,true);ctx.file={name:'inflated.xlsx',size:data.byteLength,arrayBuffer:async()=>data};
 await assert.rejects(run(ctx,'financialImportRead(file)'),/expanded workbook exceeds 25 MB/);
});

test('initial settings finishing after sign-out cannot populate import data',async()=>{
 const ctx=load();let finish;ctx.me={user_id:'actor'};ctx.current=()=>true;
 ctx.booksSelectAll=async()=>{throw Error('Accounts must remain lazy')};ctx.booksSelect=()=>new Promise(resolve=>{finish=resolve;});
 const pending=run(ctx,"financialImportWorkspace('actor',current)");ctx.me=null;finish([]);await pending;
 assert.equal(run(ctx,'financialImportState'),null);
});

test('navigation blocks unresolved posting and asks before discarding a preview',async()=>{
 const ctx=load(),messages=[];installLeaveContext(ctx);ctx.view='books';ctx.message=(...args)=>messages.push(args);ctx.askConfirm=async()=>false;
 run(ctx,"booksSection='import';financialImportState={preview:{},busy:true}");
 assert.equal(await run(ctx,'financialImportConfirmLeave()'),false);assert.match(messages[0][0],/Confirm this import/);
 run(ctx,'financialImportState.busy=false');assert.equal(await run(ctx,'financialImportConfirmLeave()'),false);assert.notEqual(run(ctx,'financialImportState'),null);
 ctx.askConfirm=async()=>true;assert.equal(await run(ctx,'financialImportConfirmLeave()'),true);assert.equal(run(ctx,'financialImportState'),null);
 ctx.view='sales';run(ctx,'financialImportState={preview:{},uncertain:true}');assert.equal(await run(ctx,'financialImportConfirmLeave()'),true);
});

function importWorkspaceFixture(){
 const ctx=load(),calls=[],downloads=[],nodes=new Map();
 const form=Object.fromEntries(['kind','source','file','sheet'].map(name=>[name,{value:'',files:[],innerHTML:'',disabled:false}]));form.source.value='Reviewed opening ledger';
 for(const id of ['booksBody','financialSheetLabel','financialImportStatus','financialImportCommit','financialImportPreview','financialTemplate','financialCsvTemplate','financialImportNew'])nodes.set('#'+id,{innerHTML:'',textContent:'',disabled:false,hidden:false});nodes.set('#financialImportForm',form);
 Object.assign(ctx,{me:{user_id:'owner'},view:'books',client:{},esc:String,$:selector=>nodes.get(selector),run:fn=>fn(),booksSelect:async table=>{calls.push(table);return [{locked_through:null}]},booksSelectAll:async table=>{calls.push(table);return ctx.accounts}});
 ctx.XLSX.writeFile=(workbook,name)=>downloads.push({workbook,name});run(ctx,"booksSection='import'");
 return {ctx,calls,downloads,nodes,form};
}
test('financial import opens without account data; template requests share one complete lazy load',async()=>{
 const f=importWorkspaceFixture();await f.ctx.financialImportWorkspace('owner');assert.deepEqual(f.calls,['acc_settings']);assert.equal(run(f.ctx,'financialImportState.accounts'),null);
 let release;f.ctx.booksSelectAll=async table=>{f.calls.push(table);return new Promise(resolve=>{release=resolve})};
 const first=f.nodes.get('#financialTemplate').onclick(),second=f.nodes.get('#financialTemplate').onclick();assert.deepEqual(f.calls,['acc_settings','acc_accounts']);
 const accounts=Array.from({length:1201},(_,n)=>({id:'account-'+n,code:String(n),name:'Account '+n,account_type:'asset',active:true}));release(accounts);await Promise.all([first,second]);assert.equal(f.downloads.length,2);assert.equal(f.downloads[0].workbook.Sheets.Accounts.B1202.v,'Account 1200');assert.equal(run(f.ctx,'financialImportState.accounts.length'),1201);
});
test('financial file preview waits for complete accounts and retains exact balanced minor amounts',async()=>{
 const f=importWorkspaceFixture();await f.ctx.financialImportWorkspace('owner');let release;
 f.ctx.booksSelectAll=()=>new Promise(resolve=>{release=resolve});f.ctx.financialImportRead=async()=>({SheetNames:['Journal'],Sheets:{Journal:sheet(f.ctx,rows())}});
 const reading=f.form.file.onchange();await new Promise(setImmediate);assert.equal(run(f.ctx,'financialImportState.preview'),null);assert.equal(f.nodes.get('#financialImportCommit').disabled,true);
 release(f.ctx.accounts);await reading;assert.equal(run(f.ctx,'financialImportState.preview.errors.length'),0);assert.equal(run(f.ctx,'financialImportState.preview.entries[0].lines[0].debit_minor'),12550);assert.equal(f.nodes.get('#financialImportCommit').disabled,false);
});
test('failed financial account reads cannot enable import and an explicit retry can recover',async()=>{
 const f=importWorkspaceFixture();await f.ctx.financialImportWorkspace('owner');let attempts=0;f.ctx.booksSelectAll=async()=>{if(++attempts===1)throw Error('Ledger accounts offline');return f.ctx.accounts};f.ctx.financialImportRead=async()=>({SheetNames:['Journal'],Sheets:{Journal:sheet(f.ctx,rows())}});
 await f.form.file.onchange();assert.match(f.nodes.get('#financialImportStatus').textContent,/Ledger accounts offline/);assert.equal(run(f.ctx,'financialImportState.preview'),null);assert.equal(f.nodes.get('#financialImportCommit').disabled,true);
 await f.form.file.onchange();assert.equal(run(f.ctx,'financialImportState.preview.errors.length'),0);assert.equal(attempts,2);
});
test('late financial account reads cannot fill a same-ID replacement session or download its template',async()=>{
 const f=importWorkspaceFixture();await f.ctx.financialImportWorkspace('owner');let release;f.ctx.booksSelectAll=()=>new Promise(resolve=>{release=resolve});const download=f.nodes.get('#financialTemplate').onclick();f.ctx.me={user_id:'owner'};release(f.ctx.accounts);await download;assert.equal(f.downloads.length,0);assert.equal(run(f.ctx,'financialImportState.accounts'),null);
});
