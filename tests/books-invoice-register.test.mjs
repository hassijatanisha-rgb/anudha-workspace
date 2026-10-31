import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const invoice=n=>({id:'i'+n,invoice_number:'INV-'+n,organization_id:'customer-'+n,customer_name:'Fictional <customer '+n+'>',proforma_id:'p'+n,proforma_number:'PF-'+n,invoice_date:'2026-10-20',due_date:'2026-11-20',total_minor:10000,paid_minor:2000,outstanding_minor:7000,credited_minor:1000,customer_credit_minor:0,status_key:'part',status_label:'Part settled',tra_receipt_number:'',buyer_tin:'TIN-'+n});
const snapshot=(page=0,waiting=0)=>({today:'2026-10-29',settings:{version:2,locked_through:null},invoice_count:105,waiting_count:43,invoice_page:page,waiting_page:waiting,summary:{total_minor:1000000,paid_minor:100000,credited_minor:10000,outstanding_minor:890000,customer_credit_minor:0},invoices:Array.from({length:Math.min(50,105-page*50)},(_,n)=>invoice(page*50+n)),to_invoice:Array.from({length:Math.min(20,43-waiting*20)},(_,n)=>({id:'waiting-'+(waiting*20+n),document_number:'PF-W-'+(waiting*20+n),organization_id:'waiting-customer',customer_name:'Fictional waiting customer',currency:'USD',total_minor:12345})),tax_ids:[{organization_id:'customer-0',tin:'Current TIN'}]});
function fixture(){
 const calls=[],nodes=new Map(),selections=new Map(),messages=[];let pending;
 const node=()=>({innerHTML:'',textContent:'',isConnected:true,disabled:false,dataset:{},querySelector:()=>null,focus(){this.focused=true;}});
 const ctx=vm.createContext({location:{hash:'#/go/books/invoices'},workspacePageHeader,statusTone,me:{user_id:'accountant'},view:'books',listsLoaded:false,listsLoading:null,organizations:[{id:'old'}],products:[{id:'shared-product'}],document:{querySelectorAll:s=>selections.get(s)||[]},$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},workspaceLoading(){},syncWorkspaceNavigation(){},financialImportWorkspace(){},openingReceivablesWorkspace(){},message:(text,error)=>messages.push({text,error}),esc:v=>String(v??'').replaceAll('<','&lt;'),loadLists:async()=>{throw Error('No shared lists on register landing');},run:fn=>{pending=fn();return pending;},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='accounting_access'?true:snapshot(args.p_invoice_page,args.p_waiting_page)};},from(){throw Error('No table preload on register landing');}}});
 for(const file of ['sales-domain.js','accounting-access.js','record-navigation.js','accounting-ledger.js'])vm.runInContext(read(file),ctx);
 const get=code=>vm.runInContext(code,ctx);get("booksSection='invoices';booksData={invoices:[{id:'full-editor-record'}],accounts:[{id:'full-editor-account'}]}");
 return {ctx,calls,nodes,selections,messages,node,get,get pending(){return pending;}};
}
test('invoice register cold landing uses two RPCs, bounded markup and no shared/full editor mutation',async()=>{
 const f=fixture(),full=f.get('booksData'),products=f.ctx.products;await f.ctx.booksWorkspace();assert.deepEqual(f.calls.map(x=>x.name),['accounting_access','acc_invoice_register']);assert.equal(f.ctx.listsLoaded,false);assert.equal(f.ctx.products,products);assert.equal(f.get('booksData'),full);
 assert.equal(f.get('booksInvoicePageData.invoices.length'),50);assert.equal(f.get('booksInvoicePageData.toInvoice.length'),20);const html=f.nodes.get('#booksBody').innerHTML;assert.equal((html.match(/data-books-fiscal-cell=/g)||[]).length,50);assert.equal((html.match(/data-books-open-order=/g)||[]).length,20);assert.match(html,/105/);assert.match(html,/43/);assert.match(html,/Fictional &lt;customer/);assert.doesNotMatch(html,/booksInvoiceForm/);assert.equal(f.get("booksInvoicePageData.taxIds.get('customer-0').tin"),'Current TIN');
});
test('independent invoice/waiting pagers replace only the bounded page cache and retain full editor data',async()=>{
 const f=fixture(),full=f.get('booksData');await f.ctx.booksWorkspace();f.nodes.get('#booksInvoiceNext').onclick();await f.pending;assert.equal(f.get('booksInvoicePageData.invoices[0].id'),'i50');assert.equal(f.get('booksInvoicePageData.toInvoice[0].id'),'waiting-0');assert.equal(f.get('booksData'),full);
 f.nodes.get('#booksWaitingNext').onclick();await f.pending;assert.equal(f.get('booksInvoicePageData.invoices[0].id'),'i50');assert.equal(f.get('booksInvoicePageData.toInvoice[0].id'),'waiting-20');assert.equal(f.get('booksData'),full);assert.equal(f.ctx.listsLoaded,false);
});
test('opening one order hydrates existing full prerequisites before the unchanged invoice editor',async()=>{
 const f=fixture(),button=f.node();button.dataset.booksOpenOrder='waiting-0';f.selections.set('[data-books-open-order]',[button]);await f.ctx.booksWorkspace();const events=[];
 f.ctx.loadLists=async()=>{events.push('shared lists');f.ctx.listsLoaded=true;};f.ctx.loadBooksData=async section=>{events.push('full '+section);return {settings:{},invoices:[],toInvoice:[]};};f.ctx.booksInvoices=async()=>events.push('invoice editor');button.onclick();await f.pending;
 assert.deepEqual(events,['shared lists','full invoices','invoice editor']);assert.equal(f.get('booksDraft.proformaId'),'waiting-0');
});
test('print lazily reads one current complete balance record, without a full list',async()=>{
 const f=fixture(),button=f.node();button.dataset.booksPrintInvoice='i0';f.selections.set('[data-books-print-invoice]',[button]);await f.ctx.booksWorkspace();const reads=[];
 f.ctx.client.from=table=>{const q={select(){return q;},eq(key,value){reads.push([table,key,value]);return q;},limit(n){reads.push(['limit',n]);return q;},then(resolve){resolve({data:[{...invoice(0),paid_minor:3000,outstanding_minor:6000,lines:[{description:'Current invoice line'}]}]});}};return q;};let printed;f.ctx.booksPrintInvoice=(row,data)=>printed={row,data};button.onclick();await f.pending;
 assert.deepEqual(reads,[['acc_invoice_balances','id','i0'],['limit',1]]);assert.equal(printed.row.paid,3000);assert.equal(printed.row.outstanding,6000);assert.equal(printed.row.lines.length,1);assert.equal(printed.data,f.get('booksInvoicePageData'));assert.equal(f.ctx.listsLoaded,false);
});
test('incomplete print data cannot produce an empty tax invoice',async()=>{
 const f=fixture(),button=f.node();button.dataset.booksPrintInvoice='i0';f.selections.set('[data-books-print-invoice]',[button]);await f.ctx.booksWorkspace();f.ctx.booksSelect=async()=>[invoice(0)];f.ctx.booksPrintInvoice=()=>{throw Error('Must not print');};button.onclick();await assert.rejects(f.pending,/loaded completely/);
});
test('explicit CSV pages all rows with current customer labels without changing current cache',async()=>{
 const f=fixture();await f.ctx.booksWorkspace();const page=f.get('booksInvoicePageData');let csv;f.ctx.booksDownload=(name,text)=>csv={name,text};f.nodes.get('#booksRegisterCsv').onclick();await f.pending;assert.equal(csv.text.split('\n').length,106);assert.match(csv.text,/Fictional <customer 104>/);assert.equal(f.get('booksInvoicePageData'),page);assert.deepEqual(f.calls.filter(x=>x.name==='acc_invoice_register').map(x=>x.args.p_invoice_page),[0,0,1,2]);assert.equal(f.ctx.listsLoaded,false);
});
test('malformed, oversized and denied register responses fail without changing either cache',async()=>{
 for(const data of [{...snapshot(),invoices:Array(51).fill(invoice(0))},{...snapshot(),to_invoice:Array(21).fill(snapshot().to_invoice[0])},{...snapshot(),summary:{}},{...snapshot(),invoice_page:-1}]){const f=fixture(),full=f.get('booksData');f.ctx.client.rpc=async name=>({data:name==='accounting_access'?true:data});await assert.rejects(f.ctx.booksWorkspace(),/incomplete/);assert.equal(f.get('booksInvoicePageData'),null);assert.equal(f.get('booksData'),full);}
 const f=fixture();f.ctx.client.rpc=async()=>({data:false});await assert.rejects(f.ctx.booksWorkspace(),/restricted/);assert.equal(f.get('booksInvoicePageData'),null);
});
for(const change of ['actor','session','section','epoch'])test(`late register result ignores ${change} replacement`,async()=>{
 const f=fixture(),full=f.get('booksData');let finish;f.ctx.client.rpc=async name=>name==='accounting_access'?{data:true}:new Promise(resolve=>finish=resolve);const loading=f.ctx.booksWorkspace();await new Promise(setImmediate);
 if(change==='actor')f.ctx.me={user_id:'other'};if(change==='session')f.ctx.me={user_id:'accountant'};if(change==='section')f.get("booksSection='receipts'");if(change==='epoch')f.get('booksEpoch++');finish({data:snapshot()});await loading;assert.equal(f.get('booksInvoicePageData'),null);assert.equal(f.get('booksData'),full);
});
test('register fiscal/void actions receive their own data instead of the full editor snapshot',async()=>{
 const f=fixture(),fiscal=f.node(),voidButton=f.node();fiscal.dataset.booksFiscal='i0';voidButton.dataset.booksVoidInvoice='i0';f.selections.set('[data-books-fiscal]',[fiscal]);f.selections.set('[data-books-void-invoice]',[voidButton]);await f.ctx.booksWorkspace();const seen=[];f.ctx.booksFiscalPrompt=(invoice,data)=>seen.push([invoice.id,data]);f.ctx.booksVoidPrompt=(kind,invoice,data)=>seen.push([invoice.id,data]);fiscal.onclick();voidButton.onclick();assert.equal(seen.length,2);assert.ok(seen.every(([id,data])=>id==='i0'&&data===f.get('booksInvoicePageData')));
});

test('export detects a changed count rather than downloading a partial register',async()=>{
 const f=fixture();await f.ctx.booksWorkspace();let downloaded=false;f.ctx.booksDownload=()=>downloaded=true;f.ctx.client.rpc=async(name,args)=>{const data=snapshot(args.p_invoice_page);if(args.p_invoice_page===1)data.invoice_count=106;return {data};};f.nodes.get('#booksRegisterCsv').onclick();await assert.rejects(f.pending,/Invoices changed/);assert.equal(downloaded,false);
});
test('missing page rows cannot be presented as a complete register',()=>{
 const f=fixture();f.ctx.invalid={...snapshot(),invoices:snapshot().invoices.slice(1)};assert.throws(()=>f.get('booksInvoicePageResult(invalid)'),/incomplete/);
});
test('late print result cannot open a document in a replacement session',async()=>{
 const f=fixture(),button=f.node();button.dataset.booksPrintInvoice='i0';f.selections.set('[data-books-print-invoice]',[button]);await f.ctx.booksWorkspace();let finish,printed=false;f.ctx.booksSelect=()=>new Promise(resolve=>finish=resolve);f.ctx.booksPrintInvoice=()=>printed=true;button.onclick();f.ctx.me={user_id:'accountant'};finish([{...invoice(0),lines:[]}]);await f.pending;assert.equal(printed,false);
});
