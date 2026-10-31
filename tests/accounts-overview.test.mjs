import {workspacePageHeader} from './helpers/page-header.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const traInvoice=n=>({id:'tra-'+n,organization_id:'customer',customer_name:'Current <customer>',invoice_number:'INV-TRA-'+n,invoice_date:'2026-10-29',total_minor:610,tra_receipt_number:'',tra_verification_code:'',buyer_tin:'',buyer_vrn:'',voided_at:null,opening_import_id:null});
function snapshot(){return {today:'2026-10-29',settings:{version:3,locked_through:'2026-09-30'},summary:{money_minor:12345,receivables_minor:600,vat_minor:20,profit_minor:-10},overdue_count:8537,waiting_count:2100,unrecorded_tra_count:1002,unrecorded_tra:Array.from({length:20},(_,n)=>traInvoice(n)),
 invoices:[{id:'invoice',organization_id:'customer',customer_name:'Current <customer>',invoice_number:'INV-1',proforma_id:'pf',proforma_number:'PF-1',paid_minor:10,outstanding_minor:600,status_key:'overdue',status_label:'Overdue',total_minor:610,lines:[],opening_import_id:'opening'}],
 to_invoice:[{id:'pf',organization_id:'customer',customer_name:'Current <customer>',document_number:'PF-1',currency:'USD',total_minor:12345}],tax_ids:[{organization_id:'customer',tin:'123'}]};}
function fixture(){
 const calls=[],nodes=new Map(),actor={user_id:'accountant'},ctx=vm.createContext({location:{hash:'#/go/books/invoices'},workspacePageHeader,statusTone,me:actor,view:'books',organizations:[{id:'customer',name:'Stale cached name'}],orgIndex:new Map(),products:[{id:'shared'}],listsLoaded:false,listsLoading:null,
  $:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',querySelector:()=>null});return nodes.get(id)},document:{querySelectorAll:()=>[]},workspaceLoading(){},syncWorkspaceNavigation(){},esc:v=>String(v??'').replaceAll('<','&lt;'),
  financialImportWorkspace(){},openingReceivablesWorkspace(){},loadLists:async()=>{throw Error('Overview must not hydrate client/product lists')},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='accounting_access'?true:snapshot()}},from(){throw Error('Unexpected table preload')}}
 });
 for(const name of ['sales-domain.js','accounting-access.js','record-navigation.js','accounting-ledger.js'])vm.runInContext(read(name),ctx);
 return {ctx,calls,nodes,set:code=>vm.runInContext(code,ctx),get:code=>vm.runInContext(code,ctx)};
}
test('Books overview uses two reads and full totals without shared list mutation or eager editor loads',async()=>{
 const f=fixture(),products=f.ctx.products;await f.ctx.booksWorkspace();
 assert.deepEqual(f.calls.map(r=>r.name),['accounting_access','acc_overview']);assert.equal(f.ctx.products,products);assert.equal(f.ctx.listsLoaded,false);
 const html=f.nodes.get('#booksBody').innerHTML;assert.match(html,/8537/);assert.match(html,/2100/);assert.match(html,/Showing the latest 20/);assert.match(html,/Current &lt;customer>/);assert.doesNotMatch(html,/Stale cached name|rehearsal|launch|training/i);assert.equal((html.match(/data-books-tra-row=/g)||[]).length,20);assert.match(html,/Showing 20 of 1002/);assert.match(html,/Unrecorded TRA receipts/);
 assert.equal(f.get("booksData.taxIds.get('customer').tin"),'123');assert.equal(f.get('booksData.invoices[0].outstanding'),600);
});
test('Books overview preserves accounting denial and rejects failed or incomplete financial data',async()=>{
 const f=fixture();f.ctx.client.rpc=async()=>({data:false});await assert.rejects(f.ctx.booksWorkspace(),/restricted/);assert.equal(f.get('booksData'),null);
 for(const data of [{...snapshot(),summary:{}},{...snapshot(),settings:{}},{...snapshot(),invoices:Array(21).fill(snapshot().invoices[0])}]){
  const x=fixture();x.ctx.client.rpc=async name=>({data:name==='accounting_access'?true:data});await assert.rejects(x.ctx.booksWorkspace(),/incomplete/);assert.equal(x.get('booksData'),null);
 }
});
test('late overview responses cannot replace another section or a new same-user session',async()=>{
 for(const change of [f=>f.set("booksSection='invoices'"),f=>{f.ctx.me={user_id:'accountant'}}]){
  const f=fixture();let finish;f.ctx.client.rpc=async name=>name==='accounting_access'?{data:true}:new Promise(resolve=>finish=resolve);
  const pending=f.ctx.booksWorkspace();await new Promise(setImmediate);change(f);finish({data:snapshot()});await pending;assert.equal(f.get('booksData'),null);
 }
});
test('non-overview sections load only their own prerequisite datasets',async()=>{
 const f=fixture(),tables=[];
 f.ctx.booksSelect=async table=>{tables.push(table);return []};f.ctx.booksSelectAll=f.ctx.booksSelect;
 const expected={invoices:['acc_settings','acc_invoice_balances','acc_waiting_proformas','acc_customer_tax_ids'],receipts:['acc_accounts','acc_settings','acc_invoice_balances','acc_receipts','acc_receipt_allocations'],accounts:['acc_settings'],journal:['acc_accounts','acc_settings'],reports:['acc_settings'],import:['acc_settings'],opening:['acc_settings']};
 for(const [section,needed] of Object.entries(expected)){tables.length=0;await f.ctx.loadBooksData(section);assert.deepEqual(tables,needed,section);}
 f.set("booksReport.kind='ledger'");tables.length=0;await f.ctx.loadBooksData('reports');assert.deepEqual(tables,['acc_settings'],'ledger choices load only on explicit request; the page RPC supplies its selected account');
});
test('internal navigation from overview to invoice editor loads existing shared lists before its prerequisites',async()=>{
 const f=fixture(),events=[];f.set("booksSection='invoices';booksDraft={proformaId:'selected-order'}");f.ctx.loadLists=async()=>{events.push('lists');f.ctx.listsLoaded=true;return true};
 f.ctx.loadBooksData=async section=>{events.push(section);return {settings:{}}};f.ctx.booksInvoices=async()=>events.push('render');
 await f.ctx.booksWorkspace();assert.deepEqual(events,['lists','invoices','render']);
});

test('missing TRA queue rejects malformed bounds, identifiers, money and ineligible invoices before publication',async()=>{
 const row=traInvoice(0);
 for(const change of [
  {unrecorded_tra_count:undefined},{unrecorded_tra_count:-1},{unrecorded_tra_count:1.5},{unrecorded_tra:undefined},
  {unrecorded_tra_count:1,unrecorded_tra:[]},{unrecorded_tra_count:21,unrecorded_tra:Array(21).fill(row)},
  {unrecorded_tra_count:2,unrecorded_tra:[row,row]},
  ...[{id:''},{id:1},{organization_id:''},{organization_id:1},{invoice_date:'bad'},{total_minor:Number.MAX_SAFE_INTEGER+1},{total_minor:-1},{voided_at:'2026-10-29'},{opening_import_id:'opening'},{tra_receipt_number:'TRA-1'},{buyer_tin:undefined}].map(change=>({unrecorded_tra_count:1,unrecorded_tra:[{...row,...change}]}))
 ]){const f=fixture();f.ctx.client.rpc=async name=>({data:name==='accounting_access'?true:{...snapshot(),...change}});await assert.rejects(f.ctx.booksWorkspace(),/incomplete/);assert.equal(f.get('booksData'),null);}
});

test('an empty TRA queue stays explicit without inventing an invoice action or reading another dataset',async()=>{
 const f=fixture(),data={...snapshot(),unrecorded_tra_count:0,unrecorded_tra:[]};f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:name==='accounting_access'?true:data}};await f.ctx.booksWorkspace();assert.match(f.nodes.get('#booksBody').innerHTML,/No unrecorded TRA receipts/);assert.doesNotMatch(f.nodes.get('#booksBody').innerHTML,/data-books-tra-row=/);assert.equal(f.get('booksData.unrecordedTraCount'),0);assert.deepEqual(f.calls.map(row=>row.name),['accounting_access','acc_overview']);
});

async function ui({overlap=false,count=1}={}){
 const f=fixture(),document=dom(),proto=Object.getPrototypeOf(document.body);
 installNativeFormControls(document);vm.runInContext(read('client-rules.js'),f.ctx);
 proto.prepend=function(node){this.insertBefore(node,this.firstElementChild)};proto.scrollIntoView=function(){};
 Object.defineProperty(proto,'className',{get(){return this.attrs.class||''},set(value){this.attrs.class=value}});
 document.body.innerHTML='<main id="content"></main>';
 const data=snapshot(),row=traInvoice(0);data.unrecorded_tra=[row];data.unrecorded_tra_count=count;
 if(overlap)data.invoices=[{...row,paid_minor:10,outstanding_minor:600,status_key:'overdue',status_label:'Overdue',lines:[],due_date:'2026-10-20'}];
 const messages=[],scrolls=[];let write=null;
 Object.assign(f.ctx,{document,busy:false,$:selector=>document.querySelector(selector),window:{scrollX:2,scrollY:120,scrollTo:args=>scrolls.push(args)},run:fn=>(f.pending=fn()),message:(...args)=>messages.push(args),FormData:class{constructor(form){this.form=form}get(key){return this.form.elements[key].value}}});
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});if(name==='accounting_access')return {data:true};if(name==='acc_overview')return {data};assert.equal(name,'record_invoice_fiscal');return write?write(args):{data:{...row,tra_receipt_number:args.p_receipt_number,tra_verification_code:args.p_verification_code,buyer_tin:args.p_buyer_tin,buyer_vrn:args.p_buyer_vrn}};};
 installWorkspaceDialogFixture(f.ctx);
 await f.ctx.booksWorkspace();
 return {...f,document,data,row,messages,scrolls,node:selector=>document.querySelector(selector),write:fn=>write=fn,open(){document.querySelector('[data-books-tra-row] button').onclick();const form=document.querySelector('#booksFiscalForm');form.elements.receipt.value='TRA-123';form.elements.code.value='CODE';form.elements.tin.value='123456789';form.elements.vrn.value='VRN-1';return form;},submit(form){form.onsubmit({preventDefault(){}});return f.pending;}};
}

test('actual overview Record TRA action uses the existing form and confirmed receipt removes only its queue row',async()=>{
 const f=await ui({overlap:true}),header=f.node('.workspace-page-header'),metrics=f.node('.books-metrics'),waiting=f.node('[data-books-invoice-pf]'),overdue=f.node('[data-books-fiscal-cell]'),form=f.open();form.elements.receipt.focus();
 assert.equal(f.calls.length,2);assert.equal(form.elements.tin.value,'123456789');await f.submit(form);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),{name:'record_invoice_fiscal',args:{p_invoice_id:'tra-0',p_receipt_number:'TRA-123',p_verification_code:'CODE',p_buyer_tin:'123456789',p_buyer_vrn:'VRN-1'}});
 assert.ok(header);assert.equal(f.calls.length,3);assert.equal(f.node('.workspace-page-header'),header);assert.equal(f.node('.books-metrics'),metrics);assert.equal(f.node('[data-books-invoice-pf]'),waiting);assert.equal(f.node('[data-books-fiscal-cell]'),overdue);assert.equal(overdue.textContent,'TRA-123');assert.equal(f.node('[data-books-tra-row]'),null);assert.equal(f.node('#booksTraCount').textContent,'0');assert.match(f.node('#booksTraRows').textContent,/No unrecorded/);assert.equal(f.get('booksData.unrecordedTraCount'),0);assert.equal(f.get('booksData.overdueCount'),8537);assert.equal(f.node('[data-books-fiscal]').textContent,'Edit TRA receipt');assert.equal(f.document.activeElement,f.node('[data-books-fiscal]'));
 f.node('[data-books-fiscal]').onclick();await f.submit(f.node('#booksFiscalForm'));assert.equal(f.get('booksData.unrecordedTraCount'),0,'editing an existing receipt cannot decrement the queue twice');
});

test('recorded TRA leaves an honest partial-preview count and keeps focus when its only preview row leaves',async()=>{
 const f=await ui(),form=f.open();form.elements.receipt.focus();await f.submit(form);assert.equal(f.document.activeElement,f.node('#booksTraCount'));assert.equal(f.node('#booksTraCountStatus').textContent,'');
 const many=await ui({count:1});many.set('booksData.unrecordedTraCount=21');const next=many.open();await many.submit(next);assert.equal(many.get('booksData.unrecordedTraCount'),20);assert.match(many.node('#booksTraRows').textContent,/No more invoices in this preview/);assert.match(many.node('#booksTraCountStatus').textContent,/Showing 0 of 20/);assert.equal(many.calls.length,3);
});

test('failed or incomplete fiscal receipts cannot remove queue rows or claim a lower count',async()=>{
 for(const incomplete of [false,true]){const f=await ui(),row=f.node('[data-books-tra-row]'),form=f.open();f.write(()=>incomplete?{data:{id:'wrong'}}:{error:{message:'Receipt not accepted'}});if(incomplete){await f.submit(form);assert.equal(form.inert,true);await f.submit(form);assert.equal(f.calls.length,3);}else await assert.rejects(f.submit(form),/Receipt not accepted/);assert.equal(f.node('[data-books-tra-row]'),row);assert.equal(f.get('booksData.unrecordedTraCount'),1);assert.equal(form.elements.receipt.value,'TRA-123');}
});

test('late fiscal receipts and detached actions cannot modify a new actor, route or overview snapshot',async()=>{
 for(const change of [f=>{f.ctx.me={...f.ctx.me}},f=>{f.ctx.view='dashboard'},f=>f.set('booksEpoch++'),f=>f.set('booksData={...booksData}')]){
  const f=await ui(),row=f.node('[data-books-tra-row]'),form=f.open();let finish;f.write(()=>new Promise(resolve=>finish=resolve));const pending=f.submit(form);change(f);finish({data:{...f.row,tra_receipt_number:'TRA-123'}});await pending;assert.equal(f.node('[data-books-tra-row]'),row);assert.equal(f.node('#booksTraCount').textContent,'1');assert.equal(f.messages.length,0);
 }
 const f=await ui(),button=f.node('[data-books-tra-row] button');button.remove();button.onclick();assert.equal(f.node('#booksFiscalForm'),null);assert.equal(f.calls.length,2);
});
