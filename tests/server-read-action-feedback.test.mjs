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
function runtime(){
 const document=dom(),prototype=Object.getPrototypeOf(document.body),matches=prototype.matches,html=Object.getOwnPropertyDescriptor(prototype,'innerHTML');
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 prototype.removeAttribute=function(key){delete this.attrs[key]};prototype.prepend=function(node){this.insertBefore(node,this.children[0]||null)};
 prototype.getBoundingClientRect=()=>({left:20,bottom:40,width:100,height:30});prototype.getClientRects=function(){return this.isConnected?[{}]:[]};prototype.reportValidity=()=>true;
 Object.defineProperties(prototype,{innerHTML:{get(){return html.get.call(this)},set(value){html.set.call(this,value);for(const select of this.querySelectorAll('select'))select.value=(select.querySelector('option[selected]')||select.querySelector('option'))?.value||''}},type:{get(){return this.attrs.type||''},set(value){this.attrs.type=value}},form:{get(){return this.closest('form')}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},style:{get(){return this._style??={}}},classList:{get(){const node=this;return {contains:name=>node.className.split(' ').includes(name),add:name=>{if(!node.className.split(' ').includes(name))node.className=(node.className+' '+name).trim()},remove:name=>{node.className=node.className.split(' ').filter(value=>value!==name).join(' ')}}}}});
 for(const name of ['kind','account','from','to'])Object.defineProperty(prototype,name,{get(){return this.querySelector(`[name="${name}"]`)}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={style:{},dataset:{},clientWidth:1280,clientHeight:900};
 document.body.innerHTML='<div id="notice"></div><section id="content"><h1>Books</h1><div id="booksBody"></div></section>';
 const calls=[],handlers={},session={user_id:'actor'};let ids=0;
 const c=vm.createContext({workspacePageHeader,document,window:{addEventListener(){}},busy:false,me:session,view:'books',$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getComputedStyle:()=>({visibility:'visible'}),setTimeout:()=>1,clearTimeout(){},crypto:{randomUUID:()=>`request-${++ids}`},FormData:class{constructor(form){this.form=form}get(name){return this.form.elements[name]?.value||''}},organizations:[{id:'customer',name:'Fictional clinic'}],client:{rpc:(name,args)=>{calls.push({name,args:plain(args)});return handlers[name](args)}}});

 Object.assign(c,{showWorkspaceDialog:(dialog,{size})=>{dialog.dataset.dialogSize=size;dialog.showModal();},closeWorkspaceDialog:async dialog=>{dialog.close();return true;},workspaceFormSnapshot:form=>JSON.stringify(form.values||form.fields||[...form.querySelectorAll('[name]')].map(node=>[node.getAttribute('name'),node.value])),bindWorkspaceDialogDismiss:(dialog,{isBusy})=>async()=>{if(isBusy())return false;dialog.close();return true;}});
 for(const name of ['client-rules.js','sales-domain.js','accounting-ledger.js','action-feedback.js'])vm.runInContext(source(name),c);
 vm.runInContext(app.split('\n').find(line=>line.startsWith('function message('))+'\n'+runSource,c);c.booksToday=()=> '2026-10-29';
 return {c,document,calls,handlers,session,ids:()=>ids,node:selector=>document.querySelector(selector),get:code=>vm.runInContext(code,c)};
}
function working(node,label){assert.equal(node.disabled,true);assert.equal(node.getAttribute('aria-busy'),'true');assert.equal(node.classList.contains('action-is-busy'),true);if(label)assert.equal(node.textContent,label);}
function finished(node,disabled=false){assert.equal(node.disabled,disabled);assert.equal(node.getAttribute('aria-busy'),null);assert.equal(node.classList.contains('action-is-busy'),false);}
const quantities=(id='order')=>({proforma_id:id,version:7,lines:[{proforma_line_id:'line-'+id,product_id:'product',description:'Machine '+id,uom:'unit',ordered_quantity:4,invoiced_quantity:0,remaining_quantity:4,available_quantity:2}]});
async function invoiceFixture(chosen=''){
 const f=runtime(),{c,get}=f;c.data={today:'2026-10-29',invoices:[],toInvoice:['order','other'].map(id=>({id,document_number:'PF-'+id,organization_id:'customer',currency:'TZS',total_minor:20000})),proformaNumbers:new Map()};
 get(`booksSection='invoices';booksData=data;booksEpoch=10;booksDraft=${chosen?`{proformaId:'${chosen}'}`:'null'}`);
 f.current=()=>c.me===f.session&&c.view==='books'&&get("booksEpoch===10&&booksSection==='invoices'");
 f.handlers.order_invoice_quantities=args=>({data:quantities(args.p_proforma_id)});
 await c.booksInvoices('actor',f.current);f.form=f.node('#booksInvoiceForm');f.select=f.form.elements.proforma;f.reload=f.node('#booksInvoiceReload');f.post=f.node('#booksInvoicePost');f.status=f.node('#booksInvoiceStatus');f.form.elements.accountsref.value='Typed approval';f.form.elements.taxref.value='Typed tax reference';
 f.change=id=>{f.select.value=id;return f.select.onchange()};
 f.replace=what=>{if(what==='actor')c.me={...f.session};else if(what==='route')c.view='personal';else if(what==='epoch')get('booksEpoch++');else if(what==='data')get('booksData={}');else f.form.remove()};return f;
}
async function mappingFixture(){
 const f=runtime(),{c}=f;c.canEditRecords=()=>true;c.recordsLockedText='Read only';c.products=[{id:'product',name:'Reagent',source:{company:'Maker',specification:'200 ml',units:'bottle'}}];c.inventoryLoaded=true;c.productReviewLoadError='';c.reviewedCatalogProduct=row=>row;c.loadLists=async()=>true;c.loadInventoryOperations=async()=>true;
 f.read=async()=>({data:[]});c.client.from=table=>{const call={table};return {select(columns){call.columns=columns;return this},eq(key,value){call.eq=[key,value];return this},order(key,options){call.order=[key,options];return this},limit(limit){call.limit=limit;f.calls.push(call);return f.read()}}};
 for(const name of ['product-identity.js','product-mapping-preview.js','product-mapping-decision.js','product-mapping-ui.js'])vm.runInContext(source(name),c);
 c.openProductMappingPreview();f.dialog=f.document.querySelector('dialog');f.status=f.dialog.querySelector('[data-mapping-status]');f.results=f.dialog.querySelector('[data-mapping-results]');
 f.payload=key=>{const original={name:'Reagent',manufacturer:'Maker',model:'200 ml',units:'bottle',totalStock:2,locations:'Store'};return {schema:'anudha-product-mapping-v1',rows:[{sourceKey:key,original,corrected:{...original}}]}};
 f.choose=async key=>f.dialog.querySelector('input').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(f.payload(key))}]}});
 await f.choose('source-1');f.button=()=>f.results.querySelector('[data-map-decision]');return f;
}
test('mapping decision opener gives actual working feedback, retains its label and performs one scoped read',async()=>{
 const f=await mappingFixture(),button=f.button(),wait=deferred();f.read=()=>wait.promise;const opening=button.onclick();working(button,'Review / save decision');await button.onclick();assert.equal(f.calls.length,1);assert.equal(f.ids(),0);assert.deepEqual(plain(f.calls[0]),{table:'product_source_mapping_reviews',columns:'*',eq:['source_key','source-1'],order:['version',{ascending:false}],limit:1});
 wait.resolve({data:[]});await opening;finished(button);assert.equal(f.document.querySelectorAll('dialog').length,2);assert.equal(f.ids(),1);assert.equal(f.c.busy,false);
});
test('mapping opener refuses busy work without changing its report and allows failed reads to retry',async()=>{
 const f=await mappingFixture(),button=f.button(),row=f.results.querySelector('tr');f.c.busy=true;await button.onclick();finished(button);assert.equal(f.calls.length,0);assert.equal(f.ids(),0);assert.equal(f.results.querySelector('tr'),row);assert.match(f.status.textContent,/Another action/);f.c.busy=false;f.read=async()=>({error:{message:'Mapping offline'}});await button.onclick();finished(button);assert.match(f.status.textContent,/Mapping offline/);assert.equal(f.ids(),0);f.read=async()=>({data:[]});await button.onclick();assert.equal(f.document.querySelectorAll('dialog').length,2);assert.equal(f.document.querySelector('.action-feedback-error'),null);assert.equal(f.calls.length,2);
});
test('mapping opener discards obsolete errors and dialogs after actor, file, page or dialog changes',async()=>{
 for(const change of ['actor','file','page','close'])for(const reject of [false,true]){
  const f=await mappingFixture(),button=f.button(),wait=deferred();f.read=()=>wait.promise;const opening=button.onclick();if(change==='actor')f.c.me={...f.session};else if(change==='file')await f.choose('replacement');else if(change==='page')f.results.innerHTML='<p>Replacement page</p>';else f.dialog.close();const text=f.status.textContent;
  if(reject)wait.reject(Error('Old read'));else wait.resolve({data:[]});await opening;assert.equal(f.status.textContent,text);assert.equal(f.document.querySelectorAll('dialog').length,change==='close'?0:1);assert.equal(f.ids(),0);assert.equal(button.getAttribute('aria-busy'),null);
 }
});
test('invoice selection and Reload use actual run, retain typed details and keep posting disabled until exact quantities arrive',async()=>{
 const f=await invoiceFixture(),wait=deferred(),form=f.form;f.handlers.order_invoice_quantities=()=>wait.promise;const reading=f.change('order');working(f.select);assert.equal(f.reload.disabled,true);assert.equal(f.reload.textContent,'Refresh quantities');assert.equal(f.post.disabled,true);assert.equal(form.elements.accountsref.value,'Typed approval');assert.equal(form.elements.taxref.value,'Typed tax reference');await f.reload.onclick();assert.equal(f.calls.length,1);wait.resolve({data:quantities()});await reading;finished(f.select);assert.equal(f.post.disabled,false);assert.equal(f.reload.disabled,false);assert.equal(f.form,form);assert.equal(f.node('[data-books-invoice-quantity]').value,'2');assert.equal(f.ids(),0);
 const again=deferred();f.handlers.order_invoice_quantities=()=>again.promise;const refresh=f.reload.onclick();working(f.reload,'Refresh quantities');assert.equal(f.select.disabled,true);await f.reload.onclick();assert.equal(f.calls.length,2);again.resolve({data:quantities()});await refresh;finished(f.reload);assert.equal(f.post.disabled,false);assert.deepEqual(f.calls.map(call=>call.args),[{p_proforma_id:'order'},{p_proforma_id:'order'}]);
});
test('invoice read busy refusal retains the verified selection and clearing selection leaves Reload and post disabled',async()=>{
 const f=await invoiceFixture();await f.change('order');const row=f.node('[data-books-invoice-quantity]'),calls=f.calls.length;f.c.busy=true;await f.change('other');assert.equal(f.select.value,'order');assert.equal(f.calls.length,calls);assert.equal(f.node('[data-books-invoice-quantity]'),row);assert.match(f.status.textContent,/Another action/);await f.reload.onclick();assert.equal(f.calls.length,calls);finished(f.reload);f.c.busy=false;await f.change('');finished(f.select);assert.equal(f.reload.disabled,true);assert.equal(f.post.disabled,true);assert.equal(f.calls.length,calls);assert.equal(f.node('[data-books-invoice-quantity]'),null);assert.equal(f.ids(),0);
});
test('invoice read failures restore only read controls and retry verified quantities without posting',async()=>{
 const f=await invoiceFixture();f.handlers.order_invoice_quantities=async()=>({error:{message:'Stock read offline'}});await f.change('order');finished(f.select);assert.equal(f.reload.disabled,false);assert.equal(f.post.disabled,true);assert.match(f.status.textContent,/Stock read offline/);assert.equal(f.form.elements.accountsref.value,'Typed approval');f.handlers.order_invoice_quantities=async()=>({data:{...quantities(),proforma_id:'other'}});await f.reload.onclick();finished(f.reload);assert.equal(f.post.disabled,true);assert.match(f.status.textContent,/could not be verified/);f.handlers.order_invoice_quantities=async()=>({data:quantities()});await f.reload.onclick();assert.equal(f.post.disabled,false);assert.equal(f.status.textContent,'');assert.equal(f.calls.length,3);assert.equal(f.ids(),0);
});
test('initial invoice quantities remain an internal read when the page is opened inside run',async()=>{
 const f=runtime();f.c.data={today:'2026-10-29',invoices:[],toInvoice:[{id:'order',document_number:'PF-order',organization_id:'customer',currency:'TZS'}]};f.get("booksSection='invoices';booksData=data;booksDraft={proformaId:'order'}");f.handlers.order_invoice_quantities=()=>({data:quantities()});await f.c.run(()=>f.c.booksInvoices('actor'));assert.equal(f.calls.length,1);assert.equal(f.node('#booksInvoicePost').disabled,false);assert.equal(f.node('[name="proforma"]').disabled,false);assert.equal(f.node('#booksInvoiceReload').disabled,false);assert.doesNotMatch(f.document.body.textContent,/Another action/);
});
test('late invoice reads cannot update replaced actor, route, epoch, data or detached form',async()=>{
 for(const change of ['actor','route','epoch','data','detach'])for(const reject of [false,true]){
  const f=await invoiceFixture(),wait=deferred();f.handlers.order_invoice_quantities=()=>wait.promise;const reading=f.change('order');f.replace(change);const before=f.node('#booksInvoiceQuantities')?.innerHTML;if(reject)wait.reject(Error('Old stock read'));else wait.resolve({data:quantities()});await reading;assert.equal(f.node('#booksInvoiceQuantities')?.innerHTML,before);assert.doesNotMatch(f.document.body.textContent,/Old stock read/);assert.equal(f.select.getAttribute('aria-busy'),null);assert.equal(f.ids(),0);
 }
});
async function ledgerFixture(){
 const f=runtime();f.c.data={account:null,from:'2026-10-01',to:'2026-10-29',page:0,pages:1,total:0,rows:[],summary:{opening_minor:0,debit_minor:0,credit_minor:0,closing_minor:0}};f.get("booksSection='reports';booksReport={kind:'ledger',from:data.from,to:data.to,accountId:''};booksLedgerPageData=data;booksEpoch=3");f.current=()=>f.c.me===f.session&&f.c.view==='books'&&f.get('booksEpoch===3');f.accounts=async()=>[];f.c.booksSelectAll=async(table,columns,build)=>{const call={table,columns};build({order(key){call.order=key;return this}});f.calls.push(call);return f.accounts()};await f.c.booksLedgerRegister('actor',f.current);f.button=f.node('#booksLedgerChoose');return f;
}
test('Choose account performs its complete read through actual run and preserves dates, report and full choices',async()=>{
 const f=await ledgerFixture(),wait=deferred(),form=f.node('#booksReportForm'),report=f.node('.books-report');form.from.value='2026-09-01';f.accounts=()=>wait.promise;const reading=f.button.onclick();working(f.button,'Choose account');await f.button.onclick();assert.equal(f.calls.length,1);wait.resolve(Array.from({length:1201},(_,i)=>({id:'account-'+i,code:String(i),name:'Account '+i,account_type:'asset',active:true})));await reading;finished(f.button);assert.equal(form.from.value,'2026-09-01');assert.equal(f.node('.books-report'),report);assert.equal(form.account.querySelectorAll('option').length,1202);assert.equal(f.document.activeElement,form.account);assert.deepEqual(f.calls,[{table:'acc_accounts',columns:'id,code,name,account_type,active',order:'code'}]);assert.equal(f.ids(),0);
});
test('Choose account busy refusal and failed reread retain current choice, dates and exact displayed totals',async()=>{
 const f=await ledgerFixture();f.accounts=async()=>[{id:'cash',code:'1000',name:'Cash',account_type:'asset',active:true}];await f.button.onclick();const form=f.node('#booksReportForm'),select=form.account,report=f.node('.books-report').innerHTML;select.value='cash';f.c.busy=true;await f.button.onclick();assert.equal(f.calls.length,1);finished(f.button);assert.match(f.node('#booksLedgerChooseStatus').textContent,/Another action/);f.c.busy=false;f.accounts=async()=>{throw Error('Accounts unavailable')};await f.button.onclick();finished(f.button);assert.equal(form.account,select);assert.equal(select.value,'cash');assert.equal(f.node('.books-report').innerHTML,report);assert.match(f.node('#booksLedgerChooseStatus').textContent,/Accounts unavailable/);
});
test('late account choices and errors cannot populate a replaced session or disconnected page',async()=>{
 for(const change of ['actor','route','epoch','detach'])for(const reject of [false,true]){
  const f=await ledgerFixture(),wait=deferred();f.accounts=()=>wait.promise;const reading=f.button.onclick();if(change==='actor')f.c.me={...f.session};else if(change==='route')f.c.view='personal';else if(change==='epoch')f.get('booksEpoch++');else f.node('#booksReportForm').remove();if(reject)wait.reject(Error('Old accounts'));else wait.resolve([{id:'old',name:'Old accounts',code:'1'}]);await reading;assert.equal(f.node('[name="account"]'),null);assert.doesNotMatch(f.document.body.textContent,/Old accounts/);assert.equal(f.button.getAttribute('aria-busy'),null);
 }
});
