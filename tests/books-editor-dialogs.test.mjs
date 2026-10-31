import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
import {dom} from './helpers/dom-identity.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const kinds=['fiscal','invoice','receipt'];
function fixture(kind){
 const document=dom();installNativeFormControls(document);const proto=Object.getPrototypeOf(document.body),animations=[],calls=[],messages=[],questions=[],prints=[];let exit=null,pending;
 Object.defineProperties(proto,{
  id:{get(){return this.attrs.id||''},set(value){this.attrs.id=value}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},
  style:{get(){return this._style??={setProperty(key,value){this[key]=value},removeProperty(key){delete this[key]}}}},
  classList:{get(){return {add:token=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),token])].join(' ')},remove:token=>{this.className=this.className.split(' ').filter(value=>value!==token).join(' ')}}}}
 });
 proto.getBoundingClientRect=()=>({left:100,top:100,width:400,height:300,right:500,bottom:400});
 proto.animate=function(frames){const wait=frames.at(-1).opacity===0&&exit?exit:deferred();if(wait!==exit)wait.resolve();const animation={dialog:this,finished:wait.promise,cancel:()=>wait.reject(Error('Interrupted'))};animations.push(animation);return animation;};
 proto.fire=function(type,extra={}){const event={target:this,preventDefault(){this.prevented=true},...extra};for(const {fn}of this.events[type]||[])fn(event);return event;};
 document.body.innerHTML='<main id="content"><header><input id="search" value="unchanged"></header><div id="booksBody"><section><p class="muted">Current invoices, excluding voids: 100</p><table><tr><td class="tag">Current</td><td data-books-fiscal-cell="invoice"></td><td><button data-books-fiscal="invoice">Record TRA</button><button data-books-void-invoice="invoice">Void invoice</button><button data-books-print-invoice="invoice">Print</button></td></tr></table><button id="booksReceiptVoid">Void receipt</button></section></div></main>';
 const node=selector=>document.querySelector(selector),root=node('#booksBody'),search=node('#search'),opener=node(kind==='fiscal'?'[data-books-fiscal]':kind==='invoice'?'[data-books-void-invoice]':'#booksReceiptVoid');opener.focus();
 class Fields{constructor(form){this.entries=form.querySelectorAll('[name]').filter(node=>!node.disabled).map(node=>[node.getAttribute('name'),node.value]);}get(name){return this.entries.find(entry=>entry[0]===name)?.[1]??null;}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 const invoice={id:'invoice',organization_id:'customer',invoice_number:'INV-<img src=x>',total_minor:10000,tra_receipt_number:'',tra_verification_code:'',buyer_tin:'',buyer_vrn:'',paid:2000,outstanding:8000},receipt={id:'receipt',organization_id:'customer',receipt_number:'RC-<img src=x>',journal_entry_id:'receipt-journal'};
 const data={invoices:[invoice],receipts:[receipt],today:'2026-10-29',taxIds:new Map([['customer',{tin:'123456789'}]]),customerNames:new Map([['customer','Buyer <img src=x>']])};
 const c=vm.createContext({document,busy:false,$:node,me:{user_id:'actor'},view:'books',data,FormData:Fields,matchMedia:()=>({matches:false}),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>key==='--m-fade'?'150ms':'200ms'}),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),message:(...args)=>messages.push(args),run:fn=>(pending=fn()),pendingLoaded:true});
 for(const file of ['client-rules.js','ui-dialogs.js','accounting-ledger.js'])vm.runInContext(read(file),c);
 const get=code=>vm.runInContext(code,c);get('booksData=data;booksInvoicePageData=data;booksEpoch=10;booksSection="invoices"');c.booksMoney=value=>String(value);c.askConfirm=async options=>{questions.push(options);return false};
 const saved=()=>kind==='fiscal'?{...invoice,tra_receipt_number:'TRA-42',tra_verification_code:'CODE',buyer_tin:'123456789',buyer_vrn:'VRN'}:{...(kind==='invoice'?invoice:receipt),voided_at:'2026-10-29T10:00:00Z',voided_by:'actor',void_reason:'Cancelled delivery',void_entry_id:'void-journal'};
 c.client={rpc:async(name,args)=>{calls.push({name,args});return {data:saved()}}};
 c.booksSelect=async(table,columns,build)=>{const call={table,columns};build({eq(key,id){call.eq=[key,id];return this},limit(value){call.limit=value;return this}});calls.push(call);return [saved()]};
 c.booksOpenSavedInvoice=async(id,context,current)=>{calls.push({open:id});if(current())prints.push(id)};
 c.booksWorkspace=async()=>{get('booksEpoch++');calls.push({navigation:get('booksTransactionSelected')});};
 if(kind==='fiscal')c.booksFiscalPrompt(invoice,data);else c.booksVoidPrompt(kind,kind==='invoice'?invoice:receipt,data);
 const dialog=node('dialog'),form=dialog.querySelector('form'),cancel=node(kind==='fiscal'?'#booksFiscalCancel':'#booksVoidCancel'),submit=dialog.querySelector('[type="submit"]');
 return {c,get,node,document,root,search,opener,dialog,form,cancel,submit,invoice,receipt,data,calls,messages,questions,prints,animations,saved,exit:wait=>exit=wait,change(){form.elements[kind==='fiscal'?'receipt':'reason'].value=kind==='fiscal'?'TRA-42':'Cancelled delivery';},save(){pending=undefined;form.onsubmit({preventDefault(){}});return pending},stale(change){if(change==='actor')c.me={...c.me};else if(change==='route')c.view='personal';else if(change==='epoch')get('booksEpoch++');else if(change==='data')get('booksData={};booksInvoicePageData={}');else{root.remove();const replacement=document.createElement('div');replacement.id='booksBody';document.body.append(replacement);}},get pending(){return pending}};
}
for(const kind of kinds){
 test(`${kind}: labelled medium dialog keeps Cancel left, explicit submit right and content escaped`,()=>{
  const f=fixture(kind),buttons=f.dialog.querySelector('.actions').querySelectorAll('button');assert.equal(f.dialog.dataset.dialogSize,'medium');assert.equal(f.dialog.getAttribute('aria-labelledby'),f.dialog.querySelector('h2').id);assert.deepEqual(buttons,[f.cancel,f.submit]);assert.equal(f.submit.getAttribute('form'),f.form.id);assert.equal(f.form.contains(f.cancel),false);assert.equal(f.dialog.querySelector('img'),null);assert.match(f.dialog.textContent,/<img src=x>/);assert.match(f.submit.className,kind==='fiscal'?/button-primary/:/button-destructive/);assert.equal(f.root.contains(f.dialog),false);assert.equal(f.node('#search'),f.search);
 });
 test(`${kind}: untouched Cancel waits for exit and restores opener without a discard prompt`,async()=>{
  const f=fixture(kind),exit=deferred();f.exit(exit);const closing=f.cancel.onclick();assert.equal(f.dialog.inert,true);assert.equal(f.dialog.open,true);assert.equal(f.questions.length,0);exit.resolve();assert.equal(await closing,true);assert.equal(f.dialog.isConnected,false);assert.equal(f.document.activeElement,f.opener);assert.equal(f.node('#search'),f.search);assert.equal(f.calls.length,0);
 });
 test(`${kind}: dirty dismissal declines without losing input, then closes only after approval`,async()=>{
  const f=fixture(kind);f.change();assert.equal(await f.cancel.onclick(),false);assert.equal(f.questions[0].confirmLabel,'Discard changes');assert.equal(f.dialog.open,true);const before=f.c.workspaceFormSnapshot(f.form);f.c.askConfirm=async()=>true;assert.equal(await f.cancel.onclick(),true);assert.equal(f.c.workspaceFormSnapshot(f.form),before);assert.equal(f.calls.length,0);
 });
 test(`${kind}: posting blocks Cancel, Escape, backdrop and repeat submission; rejection restores editable controls`,async()=>{
  const f=fixture(kind),wait=deferred();f.change();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise};const saving=f.save();assert.equal(f.form.inert,true);assert.equal(f.submit.disabled,true);assert.equal(await f.cancel.onclick(),false);assert.equal(f.dialog.fire('cancel').prevented,true);f.dialog.fire('click',{clientX:0,clientY:0});assert.equal(f.questions.length,0);await f.save();assert.equal(f.calls.length,1);wait.resolve({error:{message:'Books locked'}});await assert.rejects(saving,/Books locked/);assert.equal(f.form.inert,false);assert.equal(f.submit.disabled,false);assert.equal(f.dialog.open,true);assert.match(f.c.workspaceFormSnapshot(f.form),kind==='fiscal'?/TRA-42/:/Cancelled delivery/);
 });
 test(`${kind}: an existing dirty editor is retained when another Books editor is requested`,()=>{
  const f=fixture(kind);f.change();f.c.booksFiscalPrompt(f.invoice,f.data);f.c.booksVoidPrompt('receipt',f.receipt,f.data);assert.equal(f.node('dialog'),f.dialog);assert.equal(f.document.querySelectorAll('dialog').length,1);assert.equal(f.form.isConnected,true);
 });
 test(`${kind}: stale actor, route, data, epoch or Books root cannot write or publish a delayed result`,async()=>{
  for(const change of ['actor','route','data','epoch','root']){
   const f=fixture(kind);f.change();f.stale(change);await f.save();assert.equal(f.calls.length,0,change);assert.equal(await f.cancel.onclick(),false);assert.equal(f.dialog.isConnected,false,change);
   for(const rejected of [false,true]){const g=fixture(kind),wait=deferred();g.change();g.c.client.rpc=()=>wait.promise;const saving=g.save();g.stale(change);if(rejected)wait.reject(Error('Old error'));else wait.resolve({data:g.saved()});await saving;assert.equal(g.dialog.isConnected,false,change);assert.equal(g.invoice.tra_receipt_number,'',change);assert.equal(g.invoice.booksVoidPending,undefined,change);assert.equal(g.receipt.booksVoidPending,undefined,change);assert.equal(g.messages.length,0,change);}
  }
 });
 test(`${kind}: a delayed discard approval cannot dismiss a superseded context`,async()=>{
  for(const change of ['actor','route','data','epoch','root']){const f=fixture(kind),approval=deferred();f.change();f.c.askConfirm=()=>approval.promise;const closing=f.cancel.onclick();f.stale(change);approval.resolve(true);assert.equal(await closing,false,change);assert.equal(f.dialog.open,true,change);assert.equal(f.calls.length,0,change);}
 });
}
test('fiscal success patches only confirmed fields, awaits exit and cannot repeat the write',async()=>{
 const f=fixture('fiscal'),exit=deferred();f.change();f.exit(exit);f.submit.focus();const saving=f.save();await tick();assert.equal(f.invoice.tra_receipt_number,'TRA-42');assert.equal(f.invoice.total_minor,10000);assert.equal(f.invoice.outstanding,8000);assert.equal(f.node('[data-books-fiscal-cell]').textContent,'TRA-42');assert.equal(f.data.taxIds.get('customer').tin,'123456789');assert.equal(f.messages.length,0);assert.equal(f.dialog.open,true);assert.equal(await f.cancel.onclick(),false);await f.save();assert.equal(f.calls.length,1);assert.deepEqual(plain(f.calls[0]),{name:'record_invoice_fiscal',args:{p_invoice_id:'invoice',p_receipt_number:'TRA-42',p_verification_code:'',p_buyer_tin:'123456789',p_buyer_vrn:''}});exit.resolve();await saving;assert.equal(f.dialog.isConnected,false);assert.equal(f.messages.length,1);assert.equal(f.document.activeElement,f.opener);assert.equal(f.node('#search'),f.search);
});
test('fiscal missing receipt remains locked with an accessible Close and no repeat mutation',async()=>{
 const f=fixture('fiscal');f.change();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{id:'invoice'}}};await f.save();assert.equal(f.form.inert,true);assert.equal(f.submit.disabled,true);assert.equal(f.cancel.textContent,'Close');assert.equal(f.cancel.disabled,false);assert.match(f.messages[0][0],/saved.*incomplete/);await f.save();assert.equal(f.calls.length,1);assert.equal(await f.cancel.onclick(),true);assert.equal(f.questions.length,0);
});
test('fiscal interrupted success exit keeps its committed form locked and allows a clean later Close',async()=>{
 const f=fixture('fiscal'),exit=deferred();f.change();f.exit(exit);const saving=f.save();await tick();f.exit(null);f.c.showWorkspaceDialog(f.dialog,{size:'medium'});await saving;assert.equal(f.dialog.open,true);assert.equal(f.dialog.inert,false);assert.equal(f.form.inert,true);assert.equal(f.submit.disabled,true);assert.equal(f.messages.length,0);await f.save();assert.equal(f.calls.length,1);assert.equal(await f.cancel.onclick(),true);assert.equal(f.questions.length,0);
});
test('fiscal session, route, data, epoch and root changes during exit suppress success feedback',async()=>{
 for(const change of ['actor','route','data','epoch','root']){const f=fixture('fiscal'),exit=deferred();f.change();f.exit(exit);const saving=f.save();await tick();f.stale(change);exit.resolve();await saving;assert.equal(f.messages.length,0,change);assert.equal(f.dialog.isConnected,false,change);}
});
for(const kind of ['invoice','receipt']){
 test(`${kind} void retains the verified receipt in the dialog and Close outside the inert form`,async()=>{
  const f=fixture(kind);f.change();f.submit.focus();await f.save();assert.equal(f.dialog.open,true);assert.equal(f.form.inert,true);assert.equal(f.submit.disabled,true);assert.equal(f.cancel.textContent,'Close');assert.equal(f.dialog.querySelector('[data-books-posted]').parentElement,f.dialog);assert.equal(f.document.activeElement,f.node('[data-books-posted-open]'));assert.equal((kind==='invoice'?f.invoice:f.receipt).void_entry_id,'void-journal');assert.deepEqual(plain(f.calls[0]),{name:'void_'+kind,args:{[kind==='invoice'?'p_invoice_id':'p_receipt_id']:kind,p_date:'2026-10-29',p_reason:'Cancelled delivery'}});await f.save();assert.equal(f.calls.length,1);assert.equal(await f.cancel.onclick(),true);assert.equal(f.questions.length,0);
 });
 test(`${kind} incomplete void keeps exact-ID read-only recovery mounted without repeating the write`,async()=>{
  const f=fixture(kind);f.change();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{}}};await f.save();const retry=f.node('[data-books-posted-retry]');assert.ok(retry);assert.equal(f.dialog.contains(retry),true);assert.equal(f.cancel.textContent,'Close');assert.equal(f.form.inert,true);await f.save();assert.equal(f.calls.length,1);retry.onclick();await f.pending;assert.equal(f.calls[1].table,kind==='invoice'?'acc_invoices':'acc_receipts');assert.deepEqual(f.calls[1].eq,['id',kind]);assert.equal(f.calls[1].limit,2);assert.ok(f.node('[data-books-posted-open]'));assert.equal(f.calls.filter(call=>call.name).length,1);assert.equal(await f.cancel.onclick(),true);
 });
}
test('Open saved invoice retains recovery on a read failure and closes only after a successful preview',async()=>{
 const f=fixture('invoice');f.change();await f.save();f.c.booksOpenSavedInvoice=async()=>{throw Error('Offline')};f.node('[data-books-posted-open]').onclick();await f.pending;assert.equal(f.dialog.open,true);assert.match(f.node('[data-books-posted-open]').textContent,/Retry opening/);const wait=deferred(),exit=deferred();f.exit(exit);f.c.booksOpenSavedInvoice=async()=>{await wait.promise;f.prints.push('invoice')};f.node('[data-books-posted-open]').onclick();const opening=f.pending;assert.equal(f.dialog.open,true);wait.resolve();await tick();assert.equal(f.dialog.inert,true);assert.equal(f.dialog.open,true);exit.resolve();await opening;assert.equal(f.dialog.isConnected,false);assert.deepEqual(f.prints,['invoice']);assert.equal(f.calls.filter(call=>call.name).length,1);
});
test('Open saved receipt closes after its deliberate Books navigation without replaying the void',async()=>{
 const f=fixture('receipt');f.change();await f.save();f.node('[data-books-posted-open]').onclick();await f.pending;assert.equal(f.dialog.isConnected,false);assert.equal(f.get('booksTransactionSelected'),'receipt');assert.equal(f.calls.filter(call=>call.name).length,1);assert.equal(f.calls.at(-1).navigation,'receipt');
});
test('late saved-record reads cannot close a replacement actor or route',async()=>{
 for(const kind of ['invoice','receipt'])for(const change of ['actor','route','epoch']){const f=fixture(kind),wait=deferred();f.change();await f.save();if(kind==='invoice')f.c.booksOpenSavedInvoice=()=>wait.promise;else f.c.booksWorkspace=()=>wait.promise;f.node('[data-books-posted-open]').onclick();const opening=f.pending;f.stale(change);wait.resolve();await opening;assert.equal(f.dialog.open,true,kind+' '+change);assert.equal(f.calls.filter(call=>call.name).length,1);}
});
