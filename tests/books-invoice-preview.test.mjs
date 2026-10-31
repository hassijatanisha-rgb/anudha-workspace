import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function fixture({phone=false,reduced=false}={}){
 const document=dom(),proto=Object.getPrototypeOf(document.body),animations=[],observers=[],events=new Map(),remembered=[],calls=[];let exit=null,print=()=>{},pending;
 Object.defineProperties(proto,{id:{get(){return this.attrs.id||'';},set(value){this.attrs.id=value;}},className:{get(){return this.attrs.class||'';},set(value){this.attrs.class=value;}},style:{get(){return this._style??={setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}};}},classList:{get(){return {add:token=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),token])].join(' ');},remove:token=>{this.className=this.className.split(' ').filter(value=>value!==token).join(' ');},contains:token=>this.className.split(' ').includes(token)};}}});
 proto.getBoundingClientRect=()=>({left:100,top:50,width:600,height:600,right:700,bottom:650});
 proto.animate=function(frames,options){const wait=frames.at(-1).opacity===0&&exit?exit:deferred();if(wait!==exit)wait.resolve();const animation={node:this,frames,options,finished:wait.promise,cancel:()=>wait.reject(Error('Cancelled'))};animations.push(animation);return animation;};
 proto.getAnimations=function(){return animations.filter(animation=>animation.node===this);};
 proto.fire=function(type,extra={}){const event={target:this,preventDefault(){this.prevented=true;},...extra};for(const {fn}of this.events[type]||[])fn(event);return event;};
 document.body.innerHTML='<header><input id="search" value="Retained search"></header><main><div id="booksBody"><button id="refreshBooks">Refresh</button><section id="invoiceRow"><button data-books-print-invoice="invoice">Print invoice</button></section><input id="otherDraft" value="Retained draft"></div></main>';
 document.body.scrollTop=615;
 const node=selector=>document.querySelector(selector),root=node('#booksBody'),opener=node('[data-books-print-invoice]');opener.focus();
 const invoice={id:'invoice',organization_id:'customer',invoice_number:'INV-<img src=x>',currency:'TZS',invoice_date:'2026-10-29',due_date:'2026-11-29',proforma_id:'pf',subtotal_minor:20000,discount_minor:0,tax_minor:3600,total_minor:23600,paid_minor:1000,credited_minor:0,customer_credit_minor:0,outstanding_minor:22600,paid:1000,outstanding:22600,status_key:'part',status_label:'Part paid',tra_receipt_number:'TRA-<receipt>',lines:[{description:'First <img src=x>',quantity:1,uom:'unit',unit_price_minor:10000,discount_basis_points:0,tax_basis_points:1800},{description:'Second line',quantity:1,uom:'unit',unit_price_minor:10000,discount_basis_points:0,tax_basis_points:1800}]};
 const data={invoices:[invoice],customerNames:new Map([['customer','Customer <private>']]),proformaNumbers:new Map([['pf','PF-1']]),taxIds:new Map()};
 const c=vm.createContext({document,$:node,me:{user_id:'actor'},view:'books',location:{hash:'#/go/books/invoices'},data,invoice,organizations:[{id:'customer',name:'Hidden cached customer'}],esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),message:(...args)=>calls.push({message:args}),run:fn=>(pending=fn()),actionFeedbackRememberDialog:dialog=>remembered.push(dialog),matchMedia:query=>({matches:query.includes('reduced-motion')?reduced:phone}),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>({'--m-base':'200ms','--m-slow':'300ms','--m-fade':'150ms','--ease-in':'ease-out','--ease-out':'ease-in'}[key])}),addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}},print:()=>print(),scrollX:10,scrollY:615,scrollTo(){assert.fail('Preview must not move page scroll');}});c.window=c;
 for(const file of ['sales-domain.js','ui-dialogs.js','accounting-ledger.js'])vm.runInContext(read(file),c);
 const get=code=>vm.runInContext(code,c);get("booksData=data;booksInvoicePageData=data;booksEpoch=4;booksSection='invoices'");
 c.booksSelect=async(table,columns,build)=>{const call={table,columns};build({eq(key,id){call.eq=[key,id];return this;},limit(value){call.limit=value;return this;}});calls.push(call);return [invoice];};
 return {c,get,node,document,root,opener,invoice,data,animations,observers,events,remembered,calls,open:()=>c.booksPrintInvoice(invoice,data,{trigger:opener}),preview:()=>node('dialog.books-invoice-preview'),print:fn=>print=fn,exit:wait=>exit=wait,mutate(fn){fn();observers.filter(observer=>observer.active).forEach(observer=>observer.fn());},fire(name){for(const fn of events.get(name)||[])fn();},get pending(){return pending}};
}

for(const mode of [{},{phone:true},{reduced:true}])test(`invoice side sheet retains register and complete escaped content (${JSON.stringify(mode)})`,()=>{
 const f=fixture(mode),row=f.node('#invoiceRow'),search=f.node('#search'),draft=f.node('#otherDraft'),before=f.root.innerHTML,dialog=f.open();assert.equal(dialog.dataset.dialogPlacement,'side');assert.equal(dialog.dataset.dialogSize,'large');assert.equal(f.root.innerHTML,before);assert.equal(f.node('#invoiceRow'),row);assert.equal(f.node('#search'),search);assert.equal(f.node('#otherDraft'),draft);assert.equal(f.document.body.scrollTop,615);assert.equal(f.root.contains(dialog),false);assert.equal(dialog.querySelectorAll('tbody tr').length,2);assert.equal(dialog.querySelector('img'),null);assert.match(dialog.textContent,/First <img src=x>/);assert.match(dialog.textContent,/TRA-<receipt>/);assert.equal(f.remembered[0],dialog);assert.equal(f.animations[0].options.duration,mode.reduced?150:300);assert.equal(dialog.getAttribute('aria-labelledby'),dialog.querySelector('h2').id);
});

test('Print runs synchronously in user activation and activates only the invoice and its host',()=>{
 const f=fixture(),dialog=f.open(),area=dialog.querySelector('.books-print');let printed=0;f.print(()=>{printed++;assert.equal(f.document.body.classList.contains('books-printing'),true);assert.equal(f.document.body.classList.contains('books-printing-sheet'),true);assert.equal(dialog.classList.contains('books-print-host'),true);assert.equal(f.document.querySelectorAll('.books-print-active').length,1);assert.equal(area.classList.contains('books-print-active'),true);});const result=dialog.querySelector('#booksPrintNow').onclick();assert.equal(result,undefined);assert.equal(printed,1);assert.equal(f.document.body.classList.contains('books-printing'),false);assert.equal(f.document.body.classList.contains('books-printing-sheet'),false);assert.equal(dialog.classList.contains('books-print-host'),false);assert.equal(area.classList.contains('books-print-active'),false);assert.equal(dialog.open,true);
});

test('native print failure cleans classes without losing preview, and Close restores source focus after exit',async()=>{
 const f=fixture(),dialog=f.open();f.print(()=>{throw Error('Native print failed');});assert.throws(()=>dialog.querySelector('#booksPrintNow').onclick(),/Native print failed/);assert.equal(dialog.classList.contains('books-print-host'),false);assert.equal(f.document.body.classList.contains('books-printing'),false);const wait=deferred();f.exit(wait);dialog.querySelector('#booksPrintClose').focus();const closing=dialog.querySelector('#booksPrintClose').onclick();assert.equal(dialog.inert,true);assert.equal(dialog.isConnected,true);let printed=0;f.print(()=>printed++);dialog.querySelector('#booksPrintNow').onclick();assert.equal(printed,0);wait.resolve();await closing;assert.equal(dialog.isConnected,false);assert.equal(f.document.activeElement,f.opener);assert.equal(f.observers.every(observer=>!observer.active),true);
});

test('Escape and backdrop use shared dismissal; replacing a read-only preview preserves the source page',async()=>{
 for(const type of ['cancel','click']){const f=fixture(),dialog=f.open();dialog.fire(type,{clientX:0,clientY:0});await flush();assert.equal(dialog.isConnected,false);assert.equal(f.document.activeElement,f.opener);}
 const f=fixture(),old=f.open(),before=f.root.innerHTML;f.invoice={...f.invoice};const next=f.open();assert.equal(old.isConnected,false);assert.equal(next.open,true);assert.equal(f.document.querySelectorAll('dialog.books-invoice-preview').length,1);assert.equal(f.root.innerHTML,before);assert.equal(f.observers.filter(observer=>observer.active).length,1);
});

test('actor, epoch, section, route, hash, data and replaced-root contexts dispose stale previews without printing',()=>{
 for(const change of [f=>f.c.me={...f.c.me},f=>f.get('booksEpoch++'),f=>f.get("booksSection='overview'"),f=>f.c.view='personal',f=>f.c.location.hash='#/go/travel',f=>f.get('booksData={};booksInvoicePageData={}'),f=>f.root.remove()]){
  const f=fixture(),dialog=f.open();let printed=0;f.print(()=>printed++);f.mutate(()=>change(f));assert.equal(dialog.isConnected,false);dialog.querySelector('#booksPrintNow').onclick();assert.equal(printed,0);assert.equal(f.observers.every(observer=>!observer.active),true);assert.equal(f.events.get('hashchange').size,0);
 }
 const f=fixture(),dialog=f.open();f.c.location.hash='#/go/travel';f.fire('hashchange');assert.equal(dialog.isConnected,false);
 const g=fixture(),cleared=g.open();g.c.clearBooks();assert.equal(cleared.isConnected,false);
});

test('missing invoice lines and opening balances never create a printable sheet; hidden customer cannot use cached name',()=>{
 for(const lines of [undefined,[]]){const f=fixture();f.invoice.lines=lines;assert.throws(()=>f.open(),/complete invoice lines/);assert.equal(f.preview(),null);}
 const f=fixture();f.invoice.opening_import_id='opening';f.open();assert.equal(f.preview(),null);assert.match(f.calls[0].message[0],/not new tax invoices/);
 const g=fixture();g.data.customerNames.clear();const dialog=g.open();assert.match(dialog.textContent,/Customer not loaded/);assert.doesNotMatch(dialog.textContent,/Hidden cached customer/);
});

test('register Print keeps its scoped full-line read and suppresses late actor results',async()=>{
 const f=fixture();f.c.wireBooksInvoiceActions(f.data);await f.opener.onclick();assert.deepEqual(f.calls,[{table:'acc_invoice_balances',columns:'*',eq:['id','invoice'],limit:1}]);assert.equal(f.preview().querySelectorAll('tbody tr').length,2);
 const g=fixture(),wait=deferred();g.c.booksSelect=()=>wait.promise;g.c.wireBooksInvoiceActions(g.data);const pending=g.opener.onclick();g.c.me={...g.c.me};wait.resolve([g.invoice]);await pending;assert.equal(g.preview(),null);
});

test('saved-invoice read keeps recovery context until success; preview survives the source recovery sheet closing',async()=>{
 const f=fixture(),recovery=f.document.createElement('dialog'),button=f.document.createElement('button');recovery.append(button);f.document.body.append(recovery);recovery.showModal();button.focus();let current=true;await f.c.booksOpenSavedInvoice('invoice',f.data,()=>current);const preview=f.preview();assert.equal(preview.open,true);recovery.close();recovery.remove();current=false;f.mutate(()=>{});assert.equal(preview.open,true);await preview.querySelector('#booksPrintClose').onclick();assert.equal(f.document.activeElement,f.node('#refreshBooks'));
 const g=fixture(),wait=deferred();g.c.booksSelect=()=>wait.promise;let allowed=true;const pending=g.c.booksOpenSavedInvoice('invoice',g.data,()=>allowed);allowed=false;wait.resolve([g.invoice]);await pending;assert.equal(g.preview(),null);
});

test('print stylesheet permits exactly the active dialog host and removes sheet clipping at every width',()=>{
 const css=read('books.css');assert.match(css,/body\.books-printing>\*:not\(main\):not\(\.books-print-host\)/);assert.match(css,/body\.books-printing-sheet>main\{display:none!important\}/);const host=css.match(/body\.books-printing dialog\.books-print-host\{([^}]+)\}/)[1];for(const rule of ['display:block!important','position:static!important','height:auto!important','max-height:none!important','overflow:visible!important','transform:none!important','opacity:1!important'])assert.ok(host.includes(rule),rule);assert.match(css,/\.books-print-host \.books-print-active\{position:static\}/);assert.match(css,/\.books-print-host::backdrop\{display:none!important\}/);
});
