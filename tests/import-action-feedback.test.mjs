import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.js'),runSource=app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const customer='00000000-0000-4000-8000-000000000001';
function fixture(section){
 const document=dom(),prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 // Only DOM identity is modelled; actual feedback/run and both user callbacks execute unchanged.
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 prototype.removeAttribute=function(key){delete this.attrs[key]};prototype.prepend=function(node){this.insertBefore(node,this.children[0]||null)};
 prototype.getBoundingClientRect=()=>({left:20,bottom:40,width:100,height:30});prototype.getClientRects=function(){return this.isConnected?[{}]:[]};prototype.reportValidity=function(){return this.valid!==false};
 Object.defineProperties(prototype,{type:{get(){return this.attrs.type||''},set(value){this.attrs.type=value}},form:{get(){return this.closest('form')}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},style:{get(){return this._style??={}}},classList:{get(){const node=this;return {contains:name=>node.className.split(' ').includes(name),add:name=>{if(!node.className.split(' ').includes(name))node.className=(node.className+' '+name).trim()},remove:name=>{node.className=node.className.split(' ').filter(value=>value!==name).join(' ')}}}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={style:{},dataset:{},clientWidth:1280,clientHeight:900};

 for(const name of ['kind','source','file','sheet'])Object.defineProperty(prototype,name,{get(){return this.querySelector(`[name="${name}"]`)}});
 document.body.innerHTML='<div id="notice"></div><section id="content"><h1>Books</h1><div id="booksBody"></div></section>';
 const timers=new Map(),calls=[],reads=[],handlers={};let timerId=0,ids=0,access=0;
 const f={document,calls,reads,handlers,root:document.querySelector('#content'),body:document.querySelector('#booksBody'),ids:()=>ids,access:()=>access};
 f.settings=async()=>[{locked_through:null}];f.batches=async()=>[{id:'batch',source:'Reviewed GL',created_at:'2026-10-01T00:00:00Z'}];
 const c=f.c=vm.createContext({workspacePageHeader,document,window:{addEventListener(){}},busy:false,me:{user_id:'actor'},view:'books',$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getComputedStyle:()=>({visibility:'visible'}),setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=>`request-${++ids}`},TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,requireAccountingAccess:async()=>{access++;return c.me.user_id},client:{rpc:(name,args)=>{calls.push({name,args:plain(args)});return handlers[name](args)}}});
 for(const name of ['vendor/xlsx.full.min.js','sales-domain.js','accounting-ledger.js','financial-import.js','opening-receivables.js','action-feedback.js'])vm.runInContext(source(name),c);
 vm.runInContext(app.split('\n').find(line=>line.startsWith('function message('))+'\n'+runSource,c);
 c.booksSelect=async table=>{reads.push(table);return f.settings()};c.booksSelectAll=async table=>{reads.push(table);return table==='acc_financial_imports'?f.batches():table==='acc_accounts'?[{id:'bank',code:'1200',name:'Bank',active:true},{id:'capital',code:'3000',name:'Capital',active:true}]:[{id:customer,name:'Fixture Clinic',deleted_at:null}]};c.booksToday=()=> '2026-10-29';
 vm.runInContext(`booksSection='${section}'`,c);f.state=()=>vm.runInContext(section==='import'?'financialImportState':'openingReceivablesState',c);
 f.start=()=>section==='import'?c.financialImportWorkspace('actor'):c.openingReceivablesWorkspace('actor');
 f.form=()=>f.body.querySelector('form');f.post=()=>document.querySelector(section==='import'?'#financialImportCommit':'#openingPost');f.status=()=>document.querySelector(section==='import'?'#financialImportStatus':'#openingStatus');f.send=()=>f.form().onsubmit({preventDefault(){}});
 f.csv=(reference='REF-1')=>section==='import'?`Entry Reference,Date,Memo,Account Code,Debit,Credit,Line Description,Currency\r\n${reference},2026-10-01,Reviewed opening,1200,125.50,,,TZS\r\n${reference},2026-10-01,Reviewed opening,3000,,125.50,,TZS`:`Invoice Reference,Customer UUID,Invoice Date,Due Date,Residual Amount,Currency\r\n${reference},${customer},2026-08-01,2026-09-01,125.50,TZS`;
 f.file=text=>({name:'reviewed.csv',size:text.length,text:async()=>text});
 f.prepare=async()=>{const form=f.form();form.elements.source.value='Reviewed opening ledger';if(section==='import')form.kind.value='opening';else{form.elements.cutover.value='2026-10-01';form.elements.gl.value='batch';}form.elements.file.files=[f.file(f.csv())];await form.elements.file.onchange();assert.deepEqual(plain(f.state().preview.errors),[]);};
 f.receipt=section==='import'?{imported_count:1,skipped_count:0,entries:[{reference:'REF-1',entry_number:'JE-1'}]}:{imported_count:1,already_imported:false,gl_import_id:'batch',cutover_date:'2026-10-01',reconciled:true,difference_minor:0,invoices:[{id:'invoice-1'}]};
 handlers.import_financial_journals=()=>({data:f.receipt});handlers.import_opening_receivables=()=>({data:f.receipt});handlers.opening_receivables_check=()=>({data:{reconciled:true,difference_minor:0,imported_gl_ar_minor:12550,opening_residual_minor:12550,control_ar_minor:20000,customer_subledger_minor:20000}});
 handlers.financial_import_status=handlers.opening_receivables_status=()=>({data:null});
 return f;
}
function working(button,label){assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.classList.contains('action-is-busy'),true);assert.equal(button.textContent,label);}
function done(button,disabled){assert.equal(button.disabled,disabled);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('action-is-busy'),false);}

test('Load opening batches performs the complete read through actual run despite its disabled origin',async()=>{
 const f=fixture('opening');await f.start();const button=f.document.querySelector('#openingBatches'),form=f.form(),wait=deferred();f.batches=()=>wait.promise;const loading=button.onclick();working(button,'Load opening batches');assert.deepEqual(f.reads,['acc_financial_imports']);await button.onclick();assert.equal(f.reads.length,1);assert.equal(f.ids(),0);
 wait.resolve(Array.from({length:1201},(_,i)=>({id:'batch-'+i,source:'Reviewed '+i,created_at:'2026-10-01'})));await loading;done(button,false);assert.equal(button.hidden,true);assert.equal(form.elements.gl.disabled,false);assert.match(form.elements.gl.innerHTML,/batch-1200/);assert.equal(f.document.activeElement,form.elements.gl);assert.equal(f.post().disabled,true);
});
test('batch loading refuses global busy work and recovers from a failed read without erasing typed fields',async()=>{
 const f=fixture('opening');await f.start();const button=f.document.querySelector('#openingBatches');f.form().elements.source.value='Typed source';f.c.busy=true;await button.onclick();done(button,false);assert.equal(f.reads.length,0);assert.match(f.status().textContent,/Another action/);f.c.busy=false;f.batches=()=>{throw Error('Batches offline')};await button.onclick();done(button,false);assert.match(f.status().textContent,/Batches offline/);assert.equal(f.form().elements.source.value,'Typed source');assert.equal(f.form().elements.gl.disabled,true);
 f.batches=async()=>[{id:'batch',source:'Reviewed GL',created_at:'2026-10-01'}];await button.onclick();assert.equal(button.hidden,true);assert.equal(f.form().elements.gl.disabled,false);assert.equal(f.root.querySelector('.action-feedback-error'),null);
});
test('financial post preserves typed controls and preview totals while shared feedback owns the working state',async()=>{
 const f=fixture('import');await f.start();await f.prepare();const form=f.form(),button=f.post(),header=f.root.querySelector('h1'),wait=deferred();f.handlers.import_financial_journals=()=>wait.promise;const posting=f.send();working(button,'Post reviewed journals');assert.equal(form.source.disabled,true);assert.equal(form.source.value,'Reviewed opening ledger');assert.equal(f.state().preview.entries[0].lines[0].debit_minor,12550);await tick();await f.send();assert.equal(f.calls.length,1);assert.equal(f.ids(),1);assert.equal(f.access(),1);assert.equal(f.form(),form);assert.equal(f.root.querySelector('h1'),header);
 wait.resolve({data:f.receipt});await posting;done(button,true);assert.equal(form.source.disabled,true);assert.match(f.status().textContent,/1 posted, 0 already imported.*REF-1: JE-1/);assert.equal(f.root.querySelector('.action-feedback-success').textContent,'Financial import confirmed.');await f.send();assert.equal(f.calls.length,1);
});
test('opening Check preserves both labels, returns exact reconciliation totals and enables post only after confirmation',async()=>{
 const f=fixture('opening');await f.start();await f.prepare();const check=f.document.querySelector('#openingCheck'),post=f.post(),wait=deferred();f.handlers.opening_receivables_check=()=>wait.promise;const checking=check.onclick();working(check,'Check AR reconciliation');assert.equal(post.textContent,'Import customer residuals');assert.equal(f.form().querySelector('fieldset').disabled,true);await tick();await check.onclick();assert.equal(f.calls.length,1);assert.equal(f.ids(),0);
 wait.resolve({data:{reconciled:true,difference_minor:0,imported_gl_ar_minor:12550,opening_residual_minor:12550,control_ar_minor:20000,customer_subledger_minor:20000}});await checking;done(check,false);assert.equal(post.disabled,false);assert.match(f.status().textContent,/TZS\s*126.*TZS\s*126.*TZS\s*200.*TZS\s*200/);assert.deepEqual(f.calls[0].args,{p_source:'Reviewed opening ledger',p_cutover:'2026-10-01',p_gl_import_id:'batch',p_rows:[{reference:'REF-1',organization_id:customer,invoice_date:'2026-08-01',due_date:'2026-09-01',amount_minor:12550,currency:'TZS'}]});
 f.handlers.opening_receivables_check=()=>({error:{message:'No reconciliation'}});await check.onclick();done(check,false);assert.equal(post.disabled,true);assert.match(f.status().textContent,/No reconciliation/);
});
test('post refusal makes no request ID, and unknown-result retry retains the exact request and durable label',async()=>{
 for(const section of ['import','opening']){
  const f=fixture(section);await f.start();await f.prepare();if(section==='opening')await f.document.querySelector('#openingCheck').onclick();const button=f.post(),name=section==='import'?'import_financial_journals':'import_opening_receivables',initialCalls=f.calls.length;f.c.busy=true;await f.send();assert.equal(f.ids(),0);assert.equal(f.calls.length,initialCalls);done(button,false);assert.match(f.status().textContent,/Another action/);
  f.c.busy=false;f.handlers[name]=()=>{throw Error('Reply lost')};await f.send();done(button,false);assert.equal(f.state().uncertain,true);const first=f.calls.find(call=>call.name===name);assert.equal(f.ids(),1);assert.equal(f.form().elements.source.value,'Reviewed opening ledger');assert.equal(section==='import'?f.form().source.disabled:f.form().querySelector('fieldset').disabled,true);const label=section==='import'?'Retry and reconcile this import':'Retry and confirm opening import';assert.equal(button.textContent,label);
  f.form().elements.source.value='Changed after uncertain reply';const wait=deferred();f.handlers[name]=()=>wait.promise;const retry=f.send();working(button,label);await tick();assert.deepEqual(f.calls.filter(call=>call.name===name)[1],first);assert.equal(f.ids(),1);wait.resolve({data:f.receipt});await retry;done(button,true);assert.equal(f.state().uncertain,false);assert.ok(f.state().result);assert.match(f.status().textContent,/confirmed/);
 }
});
test('opening Check busy refusal keeps the preview and enables no write',async()=>{
 const f=fixture('opening');await f.start();await f.prepare();const check=f.document.querySelector('#openingCheck'),preview=f.state().preview;f.c.busy=true;await check.onclick();done(check,false);assert.equal(f.state().preview,preview);assert.equal(f.calls.length,0);assert.equal(f.ids(),0);assert.equal(f.post().disabled,true);assert.equal(f.form().elements.source.value,'Reviewed opening ledger');
});
test('New import is a guarded settings read with immediate feedback and no repeated write or account preload',async()=>{
 const f=fixture('import');await f.start();await f.prepare();await f.send();const button=f.document.querySelector('#financialImportNew'),form=f.form(),reads=f.reads.length;f.c.busy=true;await button.onclick();assert.equal(f.reads.length,reads);done(button,false);f.c.busy=false;const wait=deferred();f.settings=()=>wait.promise;const loading=button.onclick();working(button,'Start another import');assert.equal(f.form(),form);assert.equal(f.reads.at(-1),'acc_settings');await button.onclick();assert.equal(f.reads.length,reads+1);wait.resolve([{locked_through:null}]);await loading;assert.notEqual(f.form(),form);assert.equal(f.state().preview,null);assert.equal(f.state().accounts,null);assert.equal(f.calls.filter(call=>call.name==='import_financial_journals').length,1);assert.equal(f.ids(),1);
});
test('New import can retry a failed settings read while the confirmed receipt and submitted values remain locked',async()=>{
 const f=fixture('import');await f.start();await f.prepare();await f.send();const button=f.document.querySelector('#financialImportNew'),form=f.form(),receipt=f.state().result,reads=f.reads.length;f.settings=async()=>{throw Error('Settings offline')};await button.onclick();done(button,false);assert.equal(f.form(),form);assert.equal(f.state().result,receipt);assert.equal(form.source.value,'Reviewed opening ledger');assert.equal(form.source.disabled,true);assert.equal(f.post().disabled,true);assert.match(f.status().textContent,/Import confirmed: 1 posted, 0 already imported.*REF-1: JE-1/);assert.match(f.document.querySelector('#financialImportNewStatus').textContent,/Settings offline/);assert.equal(f.calls.length,1);assert.equal(f.ids(),1);
 const wait=deferred();f.settings=()=>wait.promise;const retry=button.onclick();working(button,'Start another import');assert.equal(f.reads.length,reads+2);assert.equal(f.root.querySelector('.action-feedback-error'),null);wait.resolve([{locked_through:null}]);await retry;assert.notEqual(f.form(),form);assert.equal(f.state().result,null);assert.equal(f.calls.length,1);assert.equal(f.ids(),1);
});
test('New import late failures and retry controls cannot outlive their actor, route, epoch or connected form',async()=>{
 for(const change of ['actor','route','clear','detach','supersede']){
  const f=fixture('import');await f.start();await f.prepare();await f.send();const button=f.document.querySelector('#financialImportNew'),wait=deferred();f.settings=()=>wait.promise;const loading=button.onclick();working(button,'Start another import');
  if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='dashboard';else if(change==='clear')f.c.clearFinancialImport();else if(change==='detach')f.body.innerHTML='<p>Replacement view</p>';else{f.settings=async()=>[{locked_through:null}];await f.start();}
  const reads=f.reads.length;wait.reject(Error('Old settings failure'));await loading;assert.equal(button.getAttribute('aria-busy'),null);assert.doesNotMatch(f.root.textContent,/Old settings failure/);await button.onclick();assert.equal(f.reads.length,reads);assert.equal(f.calls.length,1);assert.equal(f.ids(),1);assert.equal(f.c.busy,false);
 }
});
test('late import save and reconciliation failures cannot publish into a replaced same-user session',async()=>{
 for(const section of ['import','opening'])for(const reject of [false,true]){
  const f=fixture(section);await f.start();await f.prepare();if(section==='opening')await f.document.querySelector('#openingCheck').onclick();const wait=deferred(),button=f.post(),name=section==='import'?'import_financial_journals':'import_opening_receivables';f.handlers[name]=()=>wait.promise;const posting=f.send();await tick();f.c.me={...f.c.me};const reads=f.calls.length;if(reject)wait.reject(Error('Old failure'));else wait.resolve({data:f.receipt});await posting;assert.equal(f.calls.length,reads);assert.equal(f.state().result,null);assert.doesNotMatch(f.status().textContent,/Old failure|Import confirmed|Opening import confirmed/);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(f.root.querySelector('.action-feedback-success'),null);assert.equal(f.c.busy,false);
 }
});
test('file replacement remains independently concurrent and only the newest preview is committed',async()=>{
 for(const section of ['import','opening']){
  const f=fixture(section);await f.start();const form=f.form();form.elements.source.value='Reviewed opening ledger';if(section==='import')form.kind.value='opening';else{form.elements.cutover.value='2026-10-01';form.elements.gl.value='batch';}const old=deferred(),latest=deferred();form.elements.file.files=[{name:'old.csv',size:100,text:()=>old.promise}];const first=form.elements.file.onchange();form.elements.file.files=[{name:'latest.csv',size:100,text:()=>latest.promise}];const second=form.elements.file.onchange();assert.equal(f.c.busy,false);latest.resolve(f.csv('LATEST'));await second;assert.equal(f.state().preview.entries[0].reference,'LATEST');old.resolve(f.csv('OLD'));await first;assert.equal(f.state().preview.entries[0].reference,'LATEST');assert.equal(f.ids(),0);assert.equal(f.calls.length,0);
 }
});
