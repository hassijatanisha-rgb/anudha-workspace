import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.js'),runSource=app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const line=(id='one',product='product')=>({proforma_line_id:id,product_id:product,description:'Fictional machine '+id,uom:'unit',ordered_quantity:4,invoiced_quantity:0,remaining_quantity:4,available_quantity:2});
const posted=args=>({id:args.p_id,invoice_number:'INV-FICTIONAL',organization_id:'customer',proforma_id:args.p_proforma_id,invoice_date:args.p_invoice_date,due_date:args.p_due_date,currency:'TZS',journal_entry_id:'journal',created_by:'actor',subtotal_minor:20000,discount_minor:0,tax_minor:0,total_minor:20000,lines:[{description:'Fictional machine',quantity:2,unit_price_minor:10000}],request_content:Object.fromEntries(Object.entries(args).filter(([key])=>key!=='p_id').map(([key,value])=>[key.slice(2),value]))});
async function fixture({chosen='order',lines=[line()]}={}){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 prototype.prepend=function(node){if(this.children[0]!==node)this.insertBefore(node,this.children[0]||null)};
 prototype.getBoundingClientRect=()=>({left:20,bottom:40,width:240,height:44});prototype.getClientRects=function(){return this.isConnected?[{}]:[]};prototype.reportValidity=()=>true;
 Object.defineProperties(prototype,{type:{configurable:true,get(){return this.attrs.type||''},set(value){this.attrs.type=value}},readOnly:{get(){return 'readonly'in this.attrs}},form:{get(){return this.closest('form')}},style:{get(){return this._style??={}}},classList:{get(){const node=this;return {contains:name=>node.className.split(' ').includes(name),add:name=>{if(!node.className.split(' ').includes(name))node.className=(node.className+' '+name).trim()},remove:name=>{node.className=node.className.split(' ').filter(value=>value!==name).join(' ')}}}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={style:{},dataset:{},clientWidth:1280,clientHeight:900};
 document.body.innerHTML='<div id="notice"></div><main id="content"><h1>Books</h1><input id="unrelated" value="keep"><div id="booksBody"></div></main>';
 const calls=[],session={user_id:'actor'};let ids=0;
 const c=vm.createContext({workspacePageHeader,document,window:{addEventListener(){}},busy:false,me:session,view:'books',$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getComputedStyle:()=>({visibility:'visible'}),setTimeout:()=>1,clearTimeout(){},crypto:{randomUUID:()=>`request-${++ids}`},FormData:class{constructor(form){this.form=form}get(name){return this.form.elements[name]?.value||''}},organizations:[{id:'customer',name:'Fictional clinic'}],pendingLoaded:true,salesLoaded:true,inventoryLoaded:true,serviceLoaded:true});
 for(const name of ['client-rules.js','sales-domain.js','accounting-ledger.js','action-feedback.js'])vm.runInContext(source(name),c);
 vm.runInContext(app.split('\n').find(line=>line.startsWith('function message('))+'\n'+runSource,c);const actualRun=c.run;c.run=(...args)=>c.running=actualRun(...args);
 c.booksToday=()=> '2026-10-29';c.data={today:'2026-10-29',invoices:[],toInvoice:['order','other'].map(id=>({id,document_number:'PF-'+id,organization_id:'customer',currency:'TZS',total_minor:20000})),proformaNumbers:new Map()};
 const get=code=>vm.runInContext(code,c),node=selector=>document.querySelector(selector);get(`booksSection='invoices';booksData=data;booksEpoch=10;booksDraft=${chosen?`{proformaId:'${chosen}'}`:'null'}`);
 const f={c,document,session,calls,get,node,ids:()=>ids,lines,read:async args=>({data:{proforma_id:args.p_proforma_id,version:7,lines:f.lines}}),write:async args=>({data:posted(args)})};
 c.client={rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='order_invoice_quantities')return f.read(args);if(name==='invoice_order_quantities')return f.write(args);throw Error('Unexpected RPC '+name)}};
 const current=()=>c.me===session&&c.view==='books'&&get("booksEpoch===10&&booksSection==='invoices'");await c.booksInvoices('actor',current);
 f.form=node('#booksInvoiceForm');f.fields=node('#booksInvoiceFields');f.post=node('#booksInvoicePost');f.summary=node('#booksInvoiceErrors');f.status=node('#booksInvoiceStatus');f.input=name=>f.form.elements[name];f.quantities=()=>[...f.form.querySelectorAll('[data-books-invoice-quantity]')];f.input('accountsref').value=' APPROVED ';f.input('taxref').value=' Tax ref ';
 f.submit=()=>{c.running=null;f.form.onsubmit({preventDefault(){}});return c.running};f.blur=dispatchFocusout;f.change=async id=>{f.input('proforma').value=id;await f.input('proforma').onchange()};
 f.replace=kind=>{if(kind==='actor')c.me={...session};else if(kind==='route')c.view='personal';else if(kind==='epoch')get('booksEpoch++');else if(kind==='data')get('booksData={}');else if(kind==='duplicate'){const other=document.createElement('form');other.id='booksInvoiceForm';node('#booksBody').insertBefore(other,f.form.closest('section'));}else f.form.remove()};
 f.writes=()=>calls.filter(call=>call.name==='invoice_order_quantities');return f;
}
const error=control=>control.closest('label').querySelector('.field-error')?.textContent||'';
test('invoice has required labels, quantity error hosts and a separate top summary',async()=>{
 const f=await fixture();assert.equal(f.form.firstElementChild,f.summary);assert.equal(f.form.noValidate,true);assert.equal(f.summary.getAttribute('role'),'alert');
 for(const name of ['proforma','date','due','accountsref','deliverydate'])assert.match(f.input(name).closest('label').textContent,/required/);
 assert.equal(f.input('accountsref').getAttribute('minlength'),'2');assert.match(f.input('taxref').closest('label').textContent,/optional/);assert.match(f.quantities()[0].closest('label').textContent,/Invoice now · required/);assert.ok(f.quantities()[0].getAttribute('aria-label').includes(f.quantities()[0].closest('label').querySelector('span').textContent));assert.equal(f.post.disabled,false);
});
test('native focusout validates only the departed control and preserves help and focus',async()=>{
 const f=await fixture();f.input('accountsref').value=' ';f.input('taxref').value='x'.repeat(81);const control=f.input('accountsref');control.setAttribute('aria-describedby','approval-help');f.input('due').focus();f.blur(control);
 assert.equal(f.document.activeElement,f.input('due'));assert.match(error(control),/Complete this field/);assert.equal(error(f.input('taxref')),'');assert.equal(f.summary.textContent,'1 field needs attention');assert.match(control.getAttribute('aria-describedby'),/^approval-help field-error-/);
 control.value='Approved';f.blur(control);assert.equal(error(control),'');assert.equal(control.getAttribute('aria-describedby'),'approval-help');assert.equal(f.summary.textContent,'');assert.equal(f.writes().length,0);
});
test('submit shows all native/domain field counts before DOM-first focus without allocating a request',async()=>{
 const f=await fixture();f.input('date').value='';f.input('accountsref').value=' ';f.input('deliverydate').value='2026-10-28';f.input('taxref').value='x'.repeat(81);const focus=f.input('date').focus;f.input('date').focus=function(...args){assert.equal(f.summary.textContent,'4 fields need attention');return focus.apply(this,args)};await f.submit();
 assert.equal(f.summary.textContent,'4 fields need attention');assert.equal(f.document.activeElement,f.input('date'));assert.deepEqual(plain(f.input('date').scrolledIntoView),{block:'center',behavior:'instant'});assert.equal(f.ids(),0);assert.equal(f.writes().length,0);assert.equal(f.status.textContent,'');
});
test('native custom/length errors and server date/reference rules stay field-local',async()=>{
 const f=await fixture();f.input('accountsref').value=' A ';f.blur(f.input('accountsref'));assert.match(error(f.input('accountsref')),/at least 2/);
 f.input('accountsref').setCustomValidity('Approval not recognized');f.blur(f.input('accountsref'));assert.match(error(f.input('accountsref')),/Approval not recognized/);f.input('accountsref').setCustomValidity('');f.input('accountsref').value='x'.repeat(121);f.blur(f.input('accountsref'));assert.match(error(f.input('accountsref')),/120/);
 f.input('due').value='2026-10-28';f.blur(f.input('due'));assert.match(error(f.input('due')),/on or after/);f.input('deliverydate').value='2026-10-28';f.blur(f.input('deliverydate'));assert.match(error(f.input('deliverydate')),/today or later/);f.input('deliverydate').setCustomValidity('Delivery day needs review');f.blur(f.input('deliverydate'));assert.match(error(f.input('deliverydate')),/Delivery day needs review/);assert.equal(f.writes().length,0);
});
test('empty selection and changed selection require a verified matching snapshot',async()=>{
 const f=await fixture({chosen:''});await f.submit();assert.equal(f.document.activeElement,f.input('proforma'));assert.match(error(f.input('proforma')),/Complete this field/);assert.equal(f.calls.length,0);
 await f.change('order');assert.equal(error(f.input('proforma')),'');f.input('proforma').value='other';await f.submit();assert.match(error(f.input('proforma')),/Refresh quantities/);assert.equal(f.writes().length,0);
});
test('quantity blur uses the unchanged parser for integer, range and uninvoiced limits',async()=>{
 const f=await fixture({lines:[{...line(),available_quantity:1000001,remaining_quantity:1000001}]});const control=f.quantities()[0];
 for(const value of ['', '-1','1.5','1e2','1000001','9007199254740992']){control.value=value;f.blur(control);assert.ok(error(control),value);assert.equal(f.writes().length,0)}
 control.value='1000000';f.blur(control);assert.equal(error(control),'');f.lines[0].remaining_quantity=2;control.value='3';f.blur(control);assert.match(error(control),/uninvoiced balance/);
});
test('duplicate-product availability uses exact shared allocation and identifies the later excess line',async()=>{
 const f=await fixture({lines:[line('one'),line('two')]});assert.deepEqual(f.quantities().map(input=>input.value),['2','0']);f.quantities()[1].value='1';f.blur(f.quantities()[1]);assert.match(error(f.quantities()[1]),/Line 2: selected quantities exceed available Haadi stock/);assert.equal(error(f.quantities()[0]),'');await f.submit();assert.equal(f.document.activeElement,f.quantities()[1]);assert.equal(f.writes().length,0);
 f.quantities()[0].value='1';f.blur(f.quantities()[1]);assert.equal(error(f.quantities()[1]),'');
});
test('zero selection has an editable error target and readonly zero-stock rows remain excluded',async()=>{
 const f=await fixture({lines:[{...line('zero','empty'),available_quantity:0},line('available')]});assert.equal(f.quantities()[0].readOnly,true);f.quantities()[1].value='0';await f.submit();assert.equal(f.document.activeElement,f.quantities()[1]);assert.match(error(f.quantities()[1]),/Choose at least one/);assert.equal(f.writes().length,0);
});
test('separate invalid quantity controls count once each and are cleared with replaced quantity nodes',async()=>{
 const f=await fixture({lines:[line('one','first'),line('two','second')]});f.quantities()[0].value='-1';f.quantities()[1].value='1.5';await f.submit();assert.equal(f.summary.textContent,'2 fields need attention');const old=f.quantities();await f.node('#booksInvoiceReload').onclick();assert.equal(f.summary.textContent,'');assert.ok(old.every(input=>!input.isConnected));assert.equal(f.quantities()[0].value,'2');assert.equal(f.writes().length,0);
});
test('busy refusal happens before validation/pre-disable and cannot create or dispatch an invoice',async()=>{
 const f=await fixture();f.c.busy=true;f.input('accountsref').value='';await f.submit();assert.equal(f.post.disabled,false);assert.equal(f.summary.textContent,'');assert.match(f.status.textContent,/Another action/);assert.equal(f.ids(),0);assert.equal(f.writes().length,0);
});
test('actual run keeps stable pending label and caller-owned confirmed lock without duplicate posting',async()=>{
 const f=await fixture(),wait=deferred();f.write=()=>wait.promise;const label=f.post.textContent,saving=f.submit();assert.equal(f.post.disabled,true);assert.equal(f.post.getAttribute('aria-busy'),'true');assert.equal(f.post.textContent,label);assert.equal(f.fields.disabled,true);await f.submit();assert.equal(f.writes().length,1);wait.resolve({data:posted(f.writes()[0].args)});await saving;
 assert.equal(f.post.disabled,true);assert.equal(f.fields.disabled,true);assert.equal(f.post.textContent,'Invoice posted');assert.equal(f.post.getAttribute('aria-busy'),null);assert.ok(f.node('[data-books-posted-open]'));await f.submit();assert.equal(f.writes().length,1);
 assert.deepEqual(f.writes()[0].args,{p_id:'request-1',p_proforma_id:'order',p_expected_version:7,p_invoice_date:'2026-10-29',p_due_date:'2026-11-28',p_lines:[{proforma_line_id:'one',quantity:2}],p_accounts_reference:'APPROVED',p_expected_delivery_date:'2026-10-29',p_tax_reference:'Tax ref'});
});
test('unknown completion skips validation on exact same retry and retains immutable request identity',async()=>{
 for(const result of ['transport','unknown']){const f=await fixture();f.write=async()=>{if(result==='transport')throw Error('Connection lost');return {error:{code:'08007',message:'Result unknown'}}};await f.submit();assert.equal(f.fields.disabled,true);assert.equal(f.post.disabled,false);assert.equal(f.post.textContent,'Retry same invoice');const original=f.writes()[0];f.input('accountsref').value='';f.input('date').value='';f.quantities()[0].value='-999';f.blur(f.input('accountsref'));assert.equal(f.summary.textContent,'');f.write=async args=>({data:posted(args)});await f.submit();assert.deepEqual(f.writes()[1],original);assert.equal(f.ids(),1);assert.equal(f.post.disabled,true);assert.ok(f.node('[data-books-posted-open]'));}
});
test('definite rejection restores editing, preserves unchanged retry identity and validates changed inputs',async()=>{
 const f=await fixture();f.write=async()=>({error:{code:'P0001',message:'Stock changed'}});await f.submit();assert.equal(f.fields.disabled,false);assert.equal(f.post.disabled,false);assert.equal(f.post.getAttribute('aria-busy'),null);assert.match(f.status.textContent,/Stock changed/);await f.submit();assert.deepEqual(f.writes()[1],f.writes()[0]);f.input('accountsref').value=' ';await f.submit();assert.equal(f.writes().length,2);f.input('accountsref').value='Changed';f.write=async args=>({data:posted(args)});await f.submit();assert.equal(f.ids(),2);assert.equal(f.writes()[2].args.p_accounts_reference,'Changed');
});
test('malformed success stays committed and exposes only read-only verification',async()=>{
 const f=await fixture();f.write=async()=>({data:{id:'wrong'}});await f.submit();assert.equal(f.post.disabled,true);assert.equal(f.fields.disabled,true);assert.ok(f.node('[data-books-posted-retry]'));await f.submit();assert.equal(f.writes().length,1);assert.equal(f.ids(),1);
});
test('stale actor/view/epoch/data/current form suppress blur, submit, and late write feedback',async()=>{
 for(const change of ['actor','route','epoch','data','duplicate','detach']){
  const f=await fixture();f.replace(change);f.input('accountsref').value='';f.blur(f.input('accountsref'));await f.submit();assert.equal(f.summary.textContent,'');assert.equal(f.writes().length,0);
  for(const reject of [false,true]){const g=await fixture(),wait=deferred();g.write=()=>wait.promise;const saving=g.submit();g.replace(change);const before=g.status.textContent;if(reject)wait.reject(Error('Old error'));else wait.resolve({data:posted(g.writes()[0].args)});await saving;assert.equal(g.status.textContent,before);assert.equal(g.post.disabled,true);assert.equal(g.post.getAttribute('aria-busy'),null);assert.equal(g.node('[data-books-posted]'),null);assert.equal(g.c.pendingLoaded,true);}
 }
});
test('obsolete quantity responses and errors cannot replace newer form or its validation state',async()=>{
 for(const change of ['actor','route','epoch','data','duplicate','detach'])for(const reject of [false,true]){const f=await fixture({chosen:''}),wait=deferred();f.read=()=>wait.promise;const reading=f.change('order');f.replace(change);const before=f.status.textContent;if(reject)wait.reject(Error('Obsolete quantities'));else wait.resolve({data:{proforma_id:'order',version:7,lines:[line()]}});await reading;assert.equal(f.status.textContent,before);assert.equal(f.quantities().length,0);assert.equal(f.writes().length,0);}
});
