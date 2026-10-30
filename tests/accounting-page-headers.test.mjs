import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function fixture(files,view){
 const document=dom(),prototype=Object.getPrototypeOf(document.body);Object.defineProperty(prototype,'id',{get(){return this.attrs.id;},set(value){this.attrs.id=value;}});prototype.before=function(node){this.parentElement.insertBefore(node,this);};document.addEventListener=()=>{};
 document.body.innerHTML='<main id="content"></main>';const root=document.querySelector('#content'),actor={user_id:'owner',role:'owner'};
 const ctx=vm.createContext({location:{hash:'#/go/books/invoices'},workspacePageHeader,statusTone,document,window:{addEventListener(){}},me:actor,view,$:selector=>document.querySelector(selector),esc,client:{},listsLoaded:true,organizations:[],contacts:[],crypto:{randomUUID:()=> 'new-id'},workspaceLoading(){},run:fn=>fn(),requireAccountingAccess:async()=>actor.user_id,syncWorkspaceNavigation(){},renderSearchPreservingPosition:(input,render)=>render()});
 for(const file of ['record-navigation.js',...files])vm.runInContext(read(file),ctx);
 return {ctx,root,document,actor,set:code=>vm.runInContext(code,ctx),node:selector=>document.querySelector(selector)};
}
function header(f,title,back=false){
 assert.equal(f.root.querySelectorAll('h1').length,1);assert.equal(f.node('h1').textContent,title);
 const node=f.node('.workspace-page-header');assert.ok(node);assert.equal(!!node.querySelector('.workspace-page-back'),back);assert.equal(node.querySelector('.workspace-page-breadcrumbs'),null);return node;
}
function books(section='overview',selected=''){
 const f=fixture(['accounting-ledger.js'],'books'),data={settings:{version:1,locked_through:'2026-10-20 <checked>'},page:0,today:'2026-10-29'};
 f.ctx.loadBooksData=f.ctx.loadBooksAccountPage=f.ctx.loadBooksInvoicePage=async()=>data;f.ctx.booksRpc=async()=>data;f.ctx.booksTransactionPageResult=value=>value;
 for(const name of ['booksOverview','booksInvoiceRegister','booksInvoices','booksTransactionRegister','booksAccounts','booksReports','financialImportWorkspace','openingReceivablesWorkspace'])f.ctx[name]=()=>{f.node('#booksBody').innerHTML='<p>Existing workspace body</p>';};
 for(const name of ['booksReceipts','booksJournal'])f.ctx[name]=(actor,current)=>{f.node('#booksBody').innerHTML='<p>Selected transaction</p>';f.ctx.booksTransactionBack(actor,current);};
 f.set(`booksSection=${JSON.stringify(section)};booksTransactionActor=me;booksTransactionSelected=${JSON.stringify(selected)};booksTransactionPages.receipts=2;booksTransactionPages.journal=3`);return f;
}
for(const [section,title] of [['overview','Accounts overview'],['invoices','Customer invoices'],['receipts','Customer receipts'],['journal','Journal entries'],['accounts','Chart of accounts'],['reports','Financial reports'],['import','Import Excel'],['opening','Opening receivables']])test(`Books ${section} keeps one shared title, no landing Back, and the exact lock target below the header`,async()=>{
 const f=books(section);await f.ctx.booksWorkspace();const h=header(f,title),lock=f.node('#booksLockStatus');assert.ok(lock);assert.equal(h.contains(lock),false);assert.equal(lock.textContent,'Books locked through 2026-10-20 <checked>.');assert.equal(f.node('checked'),null);assert.ok(f.node('#booksBody'));assert.equal(h.querySelector('details'),null);assert.match(f.root.textContent,/Other accounting tasks/);
});
for(const section of ['receipts','journal'])test(`Books ${section} binds Back idempotently in the retained header and preserves page/focus return`,async()=>{
 const f=books(section,'selected');await f.ctx.booksWorkspace();const h=header(f,section==='receipts'?'Customer receipts':'Journal entries',true),back=f.node('#booksTransactionBack'),body=f.node('#booksBody');
 assert.equal(back.parentElement,h.querySelector('.workspace-page-back'));assert.equal(body.contains(back),false);assert.equal(typeof back.onclick,'function');
 f.ctx.booksTransactionBack('owner',()=>true);f.ctx.booksTransactionBack('owner',()=>true);assert.equal(f.root.querySelectorAll('#booksTransactionBack').length,1);assert.equal(f.node('#booksTransactionBack'),back);
 let reads=0;f.ctx.booksWorkspace=async()=>{reads++;f.set('booksEpoch++');f.root.innerHTML=workspacePageHeader({title:'Register'})+'<button data-books-transaction-open="selected">Selected record</button>';};
 await back.onclick();assert.equal(reads,1);assert.equal(f.set('booksTransactionSelected'),'');assert.equal(f.set('booksDraft'),null);assert.equal(f.set('booksTransactionPages.'+section),section==='receipts'?2:3);assert.equal(f.document.activeElement,f.node('[data-books-transaction-open]'));
});
test('Books Back cannot act after its actor or guarded page changes',async()=>{
 for(const change of ['actor','epoch','view']){const f=books('receipts','selected');await f.ctx.booksWorkspace();const back=f.node('#booksTransactionBack');f.ctx.booksWorkspace=()=>assert.fail('Stale Back must not load');if(change==='actor')f.ctx.me={...f.actor};else if(change==='epoch')f.set('booksEpoch++');else f.ctx.view='sales';await back.onclick();assert.equal(f.set('booksTransactionSelected'),'selected');}
});
test('accounting landing keeps creation choices below the shared header',async()=>{
 const f=fixture(['company-forms.js','accounting-workspace.js'],'accounting');f.ctx.client.from=()=>({select(){return this;},order(){return this;},range:async()=>({data:[]})});f.ctx.mountProformaAccountingQueue=async()=>{};
 await f.ctx.accountingWorkspace();const h=header(f,'Accounting');assert.equal(h.querySelector('[data-accounting-new]'),null);assert.equal(f.root.querySelectorAll('[data-accounting-new]').length,7);assert.ok(f.node('#accountingNext'));assert.ok(f.node('#proformaAccountingQueue'));
});
test('accounting editor uses its real form title and keeps the guarded Back, form and Save targets',async()=>{
 const f=fixture(['company-forms.js','accounting-workspace.js'],'accounting');await f.ctx.accountingEditor({id:'draft',kind:'purchase',version:0,body:{}},'owner');const h=header(f,'Purchase Voucher / Supplier Invoice',true),back=f.node('#accountingBack'),form=f.node('#accountingForm');assert.equal(back.parentElement,h.querySelector('.workspace-page-back'));assert.ok(form.querySelector('form'));assert.ok(f.node('#accountingSave'));assert.equal(h.contains(f.node('#accountingSave')),false);
 let allowed=false,current=true,reads=0;f.ctx.workspaceNavigationContext=()=>({current:()=>current});f.ctx.confirmWorkspaceLeave=async()=>allowed;f.ctx.accountingWorkspace=async()=>reads++;
 await back.onclick();assert.equal(reads,0);allowed=true;current=false;await back.onclick();assert.equal(reads,0);current=true;await back.onclick();assert.equal(reads,1);
});
test('price landing and read failure both use the shared title and existing refresh/retry hook',async()=>{
 const f=fixture(['product-pricing.js'],'prices');f.ctx.data={rows:[],total:0,page:0,pages:1,totals:{products:1,configured:0,missing:1},can_edit:true};f.set('productPricePageData=data');f.root.innerHTML=f.ctx.pricingPageHtml();const h=header(f,'Product prices');assert.equal(h.querySelector('button').getAttribute('data-pricing-reload'),'');assert.equal(h.querySelector('[data-price-import-open]'),null);assert.ok(f.node('[data-price-import-open]'));assert.ok(f.node('[data-price-search]'));
 f.ctx.client.rpc=async()=>({error:{message:'Failed <img src=x>'}});await f.ctx.pricesWorkspace();const failed=header(f,'Product prices');assert.equal(failed.querySelector('[data-pricing-reload]').textContent,'Retry loading prices');assert.match(f.node('[role="alert"]').textContent,/Failed <img src=x>/);assert.equal(f.node('img'),null);assert.equal(typeof f.node('[data-pricing-reload]').onclick,'function');
});
function approvals(){const f=fixture(['project-approvals.js'],'approvals');f.ctx.client.from=table=>({select(){return this;},order(){return this;},eq(){return this;},range(){return this;},then(ok,no){return Promise.resolve(table.endsWith('questions')?{data:f.set('approvalFocus')?[]:[{id:'q',title:'Choice <img src=x>',version:1}],count:1}:{data:[],count:0}).then(ok,no);}});return f;}
test('question list and unavailable detail preserve one title, escaped rows and the local Back guard',async()=>{
 const f=approvals();await f.ctx.projectApprovals();header(f,'Questions for the owner');assert.match(f.root.textContent,/1 company decisions/);assert.equal(f.node('img'),null);assert.ok(f.node('[data-approval-open]'));
 f.set("approvalFocus='q';approvalPage=2");await f.ctx.projectApprovals();const h=header(f,'Questions for the owner',true),back=f.node('#approvalBack');assert.equal(back.parentElement,h.querySelector('.workspace-page-back'));assert.match(f.root.textContent,/no longer available/);
 let reads=0;f.ctx.projectApprovals=async()=>reads++;f.ctx.me={...f.actor};await back.onclick();assert.equal(reads,0);f.ctx.me=f.actor;await back.onclick();assert.equal(reads,1);assert.equal(f.set('approvalFocus'),'');assert.equal(f.set('approvalPage'),2);
});
test('denied and failed owner-question states use the header without exposing answers or losing Retry',async()=>{
 const denied=approvals();denied.ctx.me={user_id:'staff',role:'staff'};denied.ctx.client.from=()=>assert.fail('Denied role must not query');await denied.ctx.projectApprovals();header(denied,'Questions for the owner');assert.match(denied.root.textContent,/Owner access is required/);
 const failed=approvals();failed.ctx.client.from=()=>{throw Error('Unavailable');};await failed.ctx.projectApprovals();const h=header(failed,'Questions for the owner');assert.ok(h.querySelector('#retryApprovals'));assert.equal(typeof failed.node('#retryApprovals').onclick,'function');assert.ok(failed.node('[role="alert"]'));
});
test('How to use retains its search, role filters and walkthrough hooks beneath one shared heading',()=>{
 const f=fixture(['how-to-use.js'],'guide');f.ctx.guide();const h=header(f,'How to use');assert.equal(h.querySelector('input'),null);assert.equal(typeof f.node('#howToSearch').oninput,'function');assert.ok(f.node('[data-howto-role]'));assert.ok(f.node('[data-howto-walk]'));
});
for(const canManage of [false,true])test(`legacy Tally heading keeps existing management access (${canManage}) and puts upload below the header`,()=>{
 const f=fixture(['tally-invoices.js'],'tallyinvoices');f.set(`tallyInvoiceCanManage=${canManage};tallyInvoiceActor=me`);f.ctx.renderTallyInvoices();const h=header(f,'Tally invoices');assert.deepEqual(h.querySelectorAll('button').map(node=>node.id),canManage?['tallyInvoiceRefresh','tallyTestInvoice']:['tallyInvoiceRefresh']);assert.equal(!!f.node('#tallyInvoiceFile'),canManage);assert.equal(h.querySelector('#tallyInvoiceFile'),null);assert.equal(typeof f.node('#tallyInvoiceRefresh').onclick,'function');assert.ok(f.node('#tallyInvoiceSearch'));assert.ok(f.node('#tallyInvoiceSaveStatus'));
});
