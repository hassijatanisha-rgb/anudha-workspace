import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function fixture(){
 const document=dom(),proto=Object.getPrototypeOf(document.body),calls=[],observers=[],events=new Map(),backCalls=[],timers=new Map();let sequence=0,handler=null,printed=0;
 Object.defineProperties(proto,{id:{get(){return this.attrs.id||'';},set(value){this.attrs.id=value;}},className:{get(){return this.attrs.class||'';},set(value){this.attrs.class=value;}},style:{get(){return this._style??={setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}};}},classList:{get(){return {add:token=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),token])].join(' ');},remove:token=>{this.className=this.className.split(' ').filter(value=>value!==token).join(' ');},contains:token=>this.className.split(' ').includes(token)};}}});
 const matches=proto.matches;proto.matches=function(selector){return selector.includes(',')?selector.split(',').some(value=>this.matches(value.trim())):matches.call(this,selector);};
 proto.removeAttribute=function(key){delete this.attrs[key];};proto.getClientRects=function(){return this.isConnected?[{}]:[];};proto.getBoundingClientRect=()=>({left:10,top:10,bottom:100,right:570,width:560,height:600});proto.animate=()=>({finished:Promise.resolve(),cancel(){}});proto.getAnimations=()=>[];
 document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};document.addEventListener=()=>{};
 document.body.innerHTML='<nav id="nav"><button data-view="books" data-workspace-section="invoices">Invoices</button></nav><main><div id="notice"></div><div id="content"><input id="oldDraft" value="Old page"></div></main>';document.body.scrollTop=420;
 const node=selector=>document.querySelector(selector),actor={user_id:id(9)},invoice={id:id(1),organization_id:id(2),invoice_number:'INV-<private>',currency:'TZS',invoice_date:'2026-10-20',due_date:'2026-11-20',proforma_id:id(3),proforma_number:'PF-1',subtotal_minor:10000,discount_minor:0,tax_minor:1800,total_minor:11800,paid_minor:1000,credited_minor:0,customer_credit_minor:0,outstanding_minor:10800,status_key:'part',status_label:'Part settled',opening_import_id:null,tra_receipt_number:'TRA-<receipt>',buyer_tin:'',buyer_vrn:'',lines:[{description:'Item <img src=x>',quantity:2,uom:'units',unit_price_minor:5000,discount_basis_points:0,tax_basis_points:1800,subtotal_minor:10000,discount_minor:0,tax_minor:1800,total_minor:11800}]};
 const resolve=async call=>{
  calls.push(call);if(handler){const result=await handler(call);if(result!==undefined)return result;}
  if(call.rpc==='accounting_access')return {data:true};
  assert.equal(call.limit,2);assert.equal(call.filters.length,1);
  if(call.table==='acc_invoice_balances'){assert.equal(call.columns,'*');assert.deepEqual(call.filters,[['id',id(1)]]);return {data:[invoice]};}
  if(call.table==='organizations'){assert.equal(call.columns,'id,name');assert.deepEqual(call.filters,[['id',id(2)]]);return {data:[{id:id(2),name:'Current <customer>'}]};}
  if(call.table==='acc_customer_tax_ids'){assert.equal(call.columns,'organization_id,tin,vrn');assert.deepEqual(call.filters,[['organization_id',id(2)]]);return {data:[{organization_id:id(2),tin:'123-456-789',vrn:'VRN-1'}]};}
  assert.fail('Unexpected transport '+JSON.stringify(call));
 };
 const c=vm.createContext({document,$:node,me:actor,sessionLoadEpoch:5,view:'books',location:{hash:'#/invoice/'+id(1)},busy:false,navWhileBusy:null,friendlyError:error=>error.message,replayQueuedNavigation(){},
  organizations:[{id:id(2),name:'Hidden cached customer'}],orgIndex:new Map([[id(2),{name:'Hidden cached customer'}]]),listsLoaded:false,loadLists:()=>assert.fail('No full shared lists'),
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>({'--m-base':'200ms','--m-slow':'300ms','--m-fade':'150ms','--ease-in':'ease-out','--ease-out':'ease-in'}[key])}),matchMedia:()=>({matches:false}),
  setTimeout(fn,delay){const key=++sequence;timers.set(key,{fn,delay});return key;},clearTimeout:key=>timers.delete(key),addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);},
  MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}},print:()=>printed++,scrollX:0,scrollY:420,scrollTo:()=>assert.fail('Record must not force page scrolling'),navigateWorkspace:button=>backCalls.push(button),
  client:{rpc:(name,args)=>resolve({rpc:name,args}),from(table){const call={table,filters:[]},q={select(columns){call.columns=columns;return q;},eq(key,value){call.filters.push([key,value]);return q;},limit(value){call.limit=value;return q;},then(yes,no){return resolve(call).then(yes,no);}};return q;}}
 });c.window=c;
 for(const file of ['sales-domain.js','status-ui.js','ui-page-header.js','ui-dialogs.js','action-feedback.js','accounting-access.js','record-navigation.js','accounting-ledger.js','invoice-record.js'])vm.runInContext(read(file),c);
 const refresh=read('workspace-refresh.js');vm.runInContext(refresh.slice(refresh.indexOf('function workspaceSkeleton(kind,label)'),refresh.indexOf('function workspaceLoading(label)')),c);
 vm.runInContext(read('app.js').split('\n').find(line=>line.startsWith('async function run(')),c);c.message=(text,error)=>c.actionFeedbackMessage(text,error);
 const get=code=>vm.runInContext(code,c);get("booksSection='invoices';booksData={marker:'full editor'};booksInvoicePageData={marker:'register'}");
 return {c,get,node,document,actor,invoice,calls,events,observers,backCalls,read:()=>c.booksInvoiceRecordWorkspace(id(1)),handler:fn=>handler=fn,mutate(fn){fn();observers.filter(observer=>observer.active).forEach(observer=>observer.fn());},get printed(){return printed;}};
}

test('canonical Books dispatch reads exactly one invoice and scoped customer context without touching full caches',async()=>{
 const f=fixture(),full=f.get('booksData'),page=f.get('booksInvoicePageData');assert.equal(await f.c.booksWorkspace(),true);assert.deepEqual(f.calls.map(call=>call.rpc||call.table),['accounting_access','acc_invoice_balances','organizations','acc_customer_tax_ids']);assert.equal(f.get('booksData'),full);assert.equal(f.get('booksInvoicePageData'),page);assert.equal(f.c.listsLoaded,false);assert.equal(f.node('h1').textContent,'Invoice INV-<private>');assert.equal(f.node('.workspace-page-breadcrumbs [aria-current="page"]').textContent,'Invoice INV-<private>');assert.equal(f.node('[data-books-invoice-back]').getAttribute('href'),'#/go/books/invoices');assert.match(f.node('#booksBody').textContent,/Current <customer>/);assert.match(f.node('#booksBody').textContent,/Item <img src=x>/);assert.equal(f.node('img'),null);assert.equal(f.document.querySelectorAll('tbody tr').length,1);assert.equal(f.node('#booksInvoiceRecordPreview').closest('.workspace-page-header'),f.node('.workspace-page-header'));assert.equal(f.node('.workspace-page-breadcrumbs [aria-current="page"]').getAttribute('href'),'#/invoice/'+id(1));assert.equal(f.node('form'),null);assert.equal(f.document.querySelectorAll('[data-books-fiscal],[data-books-void-invoice],#booksInvoicePost').length,0);assert.equal(f.node('dialog'),null);assert.equal(f.printed,0);
});

test('normal invoice preview is explicit, uses its isolated complete snapshot and restores the source button',async()=>{
 const f=fixture();await f.read();const root=f.node('#booksBody'),button=f.node('#booksInvoiceRecordPreview'),title=f.node('h1');button.focus();button.onclick();const dialog=f.node('dialog.books-invoice-preview');assert.ok(dialog?.open);assert.equal(f.calls.length,4);assert.equal(f.node('#booksBody'),root);assert.equal(f.node('h1'),title);assert.equal(f.document.body.scrollTop,420);assert.match(dialog.textContent,/Current <customer>/);assert.match(dialog.textContent,/123-456-789/);assert.match(dialog.textContent,/Item <img src=x>/);assert.doesNotMatch(dialog.textContent,/Hidden cached/);dialog.querySelector('#booksPrintNow').onclick();assert.equal(f.printed,1);await dialog.querySelector('#booksPrintClose').onclick();assert.equal(dialog.isConnected,false);assert.equal(f.document.activeElement,button);
});

test('opening balances show reference and cutover, no lines, preview or invoice writer',async()=>{
 const f=fixture();Object.assign(f.invoice,{opening_import_id:id(7),opening_reference:'OLD-<invoice>',opening_cutover_date:'2026-10-01',lines:[]});await f.read();assert.match(f.node('h1').textContent,/Opening balance/);assert.match(f.node('#booksBody').textContent,/reference only/);assert.match(f.node('#booksBody').textContent,/not a new tax invoice/);assert.match(f.node('#booksBody').textContent,/OLD-<invoice> · Cutover: 2026-10-01/);assert.equal(f.node('#booksInvoiceRecordPreview'),null);assert.equal(f.node('table'),null);assert.equal(f.node('form'),null);assert.equal(f.printed,0);
});

test('legacy complete line snapshots remain readable and void records retain their status in the preview',async()=>{
 const f=fixture();for(const key of ['subtotal_minor','discount_minor','tax_minor','total_minor'])delete f.invoice.lines[0][key];Object.assign(f.invoice,{status_key:'void',status_label:'Void',voided_at:'2026-10-29T10:00:00Z',outstanding_minor:0});assert.equal(await f.read(),true);assert.match(f.node('.chip').textContent,/Void/);f.node('#booksInvoiceRecordPreview').onclick();assert.match(f.node('dialog').textContent,/VOID/);assert.equal(f.document.querySelectorAll('[data-books-void-invoice],[data-books-fiscal]').length,0);assert.equal(f.calls.length,4);
});

test('caller-hidden customer and tax rows never fall back to previously loaded names or identities',async()=>{
 const f=fixture();f.handler(call=>['organizations','acc_customer_tax_ids'].includes(call.table)?{data:[]}:undefined);await f.read();assert.match(f.node('#booksBody').textContent,/Customer not available/);assert.doesNotMatch(f.node('#booksBody').textContent,/Hidden cached/);f.node('#booksInvoiceRecordPreview').onclick();assert.match(f.node('dialog').textContent,/Customer not available/);assert.match(f.node('dialog').textContent,/TIN: —/);
});

test('accounting denial and gate transport failure stop all data reads; Retry is read-only through actual run',async()=>{
 for(const denied of [{data:false},{error:{message:'Denied'}}]){const f=fixture();f.handler(call=>call.rpc?denied:undefined);assert.equal(await f.read(),false);assert.equal(f.calls.length,1);assert.ok(f.node('[role="alert"]'));assert.equal(f.get('booksInvoiceRecordData'),null);f.handler(()=>undefined);const retry=f.node('#booksInvoiceRecordRetry');await retry.onclick();assert.equal(f.get('booksInvoiceRecordData.invoices[0].id'),id(1));assert.equal(f.calls.length,5);assert.equal(f.c.busy,false);assert.equal(f.node('[role="alert"]'),null);}
 const f=fixture();f.handler(()=>{throw Error('offline');});await f.read();assert.match(f.node('[role="alert"]').textContent,/access could not be verified/);assert.equal(f.calls.length,1);
});

test('missing, mismatched, duplicate and malformed financial records fail closed before customer reads',async()=>{
 const changes=[()=>[],f=>[{...f.invoice,id:id(8)}],f=>[f.invoice,f.invoice],f=>[{...f.invoice,organization_id:'bad'}],f=>[{...f.invoice,total_minor:'11800'}],f=>[{...f.invoice,paid_minor:NaN}],f=>[{...f.invoice,outstanding_minor:-1}],f=>[{...f.invoice,currency:'USD'}],f=>[{...f.invoice,lines:[]}],f=>[{...f.invoice,lines:[{...f.invoice.lines[0],unit_price_minor:'5000'}]}],f=>[{...f.invoice,lines:[{...f.invoice.lines[0],quantity:Infinity}]}],f=>[{...f.invoice,lines:[{...f.invoice.lines[0],subtotal_minor:null}]}],f=>[{...f.invoice,opening_import_id:id(7),opening_reference:'Old',opening_cutover_date:'2026-10-01'}],f=>[{...f.invoice,status_key:'unexpected'}]];
 for(const change of changes){const f=fixture();f.handler(call=>call.table==='acc_invoice_balances'?{data:change(f)}:undefined);await f.read();assert.equal(f.calls.length,2);assert.ok(f.node('[role="alert"]'));assert.equal(f.node('#booksInvoiceRecordPreview'),null);assert.equal(f.get('booksInvoiceRecordData'),null);}
});

test('failed or wrong-customer auxiliary reads withhold the entire record and permit a fresh scoped Retry',async()=>{
 for(const table of ['organizations','acc_customer_tax_ids']){for(const result of [{error:{message:'Connection <failed>'}},{data:[{id:id(99),organization_id:id(99),name:'Wrong',tin:'123',vrn:'V'}]}]){const f=fixture();f.handler(call=>call.table===table?result:undefined);await f.read();assert.ok(f.node('[role="alert"]'));assert.equal(f.node('#booksInvoiceRecordPreview'),null);assert.equal(f.get('booksInvoiceRecordData'),null);assert.equal(f.node('failed'),null);f.handler(()=>undefined);await f.node('#booksInvoiceRecordRetry').onclick();assert.equal(f.get('booksInvoiceRecordData.invoices[0].id'),id(1));assert.ok(f.calls.every(call=>call.rpc==='accounting_access'||call.limit===2));}}
});

test('every async boundary suppresses late actor/session/route/request/root success and failure',async()=>{
 const drifts=[f=>f.c.me={...f.actor},f=>f.c.sessionLoadEpoch++,f=>f.c.view='sales',f=>f.c.location.hash='#/invoice/'+id(8),f=>f.get('booksEpoch++'),f=>f.get("booksSection='overview'"),f=>{f.node('#content').innerHTML='<p>Replacement body</p>';},f=>{f.node('#content').remove();}];
 for(const stage of ['accounting_access','acc_invoice_balances','organizations'])for(const drift of drifts)for(const failure of [false,true]){
  const f=fixture(),wait=deferred();f.handler(call=>(call.rpc||call.table)===stage?wait.promise:undefined);const loading=f.read();await flush();drift(f);const html=f.document.body.innerHTML;if(failure)wait.reject(Error('Late private error'));else wait.resolve({data:stage==='accounting_access'?true:stage==='organizations'?[{id:id(2),name:'Late private name'}]:[f.invoice]});await loading;assert.equal(f.document.body.innerHTML,html);assert.equal(f.get('booksInvoiceRecordData'),null);assert.doesNotMatch(f.document.body.textContent,/Late private/);
 }
});

test('newer record read owns snapshot and markup even when older request settles last',async()=>{
 const f=fixture(),wait=deferred();let reads=0;f.handler(call=>call.table==='acc_invoice_balances'&&++reads===1?wait.promise:undefined);const old=f.read();await flush();await f.read();const data=f.get('booksInvoiceRecordData'),body=f.node('#booksBody');wait.resolve({data:[{...f.invoice,invoice_number:'Old request'}]});await old;assert.equal(f.get('booksInvoiceRecordData'),data);assert.equal(f.node('#booksBody'),body);assert.doesNotMatch(f.node('h1').textContent,/Old request/);
});

test('clearBooks and context changes immediately invalidate preview, stale Preview, Back and Retry callbacks',async()=>{
 for(const drift of [f=>f.c.me={...f.actor},f=>f.c.sessionLoadEpoch++,f=>f.get('booksEpoch++'),f=>f.c.location.hash='#/go/books/invoices',f=>f.c.clearBooks(),f=>{f.node('#booksBody').remove();},f=>{f.node('#content').remove();}]){
  const f=fixture();await f.read();const button=f.node('#booksInvoiceRecordPreview'),back=f.node('[data-books-invoice-back]');button.onclick();const dialog=f.node('dialog');f.mutate(()=>drift(f));assert.equal(dialog.isConnected,false);button.onclick();assert.equal(f.node('dialog'),null);back.onclick({preventDefault(){}});assert.equal(f.backCalls.length,0);if(!f.c.me||f.c.location.hash.includes('/go/'))continue;
 }
 const f=fixture();f.handler(call=>call.rpc?{data:false}:undefined);await f.read();const retry=f.node('#booksInvoiceRecordRetry');f.c.me={...f.actor};await retry.onclick();assert.equal(f.calls.length,1);
 const g=fixture();await g.read();let prevented=false;g.node('[data-books-invoice-back]').onclick({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(g.backCalls[0],g.node('#nav button'));g.c.clearBooks();assert.equal(g.get('booksInvoiceRecordData'),null);
});

test('invalid route or missing actor never touches data or the existing page',async()=>{
 for(const change of [f=>f.c.me=null,f=>f.c.view='sales',f=>f.c.location.hash='#/invoice/bad',f=>f.c.location.hash='#/invoice/'+id(8),f=>f.get("booksSection='overview'")]){const f=fixture(),html=f.node('#content').innerHTML;change(f);assert.equal(await f.read(),false);assert.equal(f.calls.length,0);assert.equal(f.node('#content').innerHTML,html);}
});
