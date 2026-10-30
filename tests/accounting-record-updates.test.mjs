import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../accounting-ledger.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const account=(id,code,type='expense')=>({id,code,name:'Account '+id,account_type:type,active:true,system_key:null,version:2,balance_minor:id==='first'?500:0});
function fixture(){
 const calls=[],messages=[],nodes=new Map(),groups=[],document={activeElement:null};let nextId=0,bodyWrites=0,pending;
 const window={scrollX:9,scrollY:620,scrollTo({left,top}){this.scrollX=left;this.scrollY=top;}};
 function element(dataset={}){return {dataset,children:[],isConnected:true,textContent:'',value:'',inert:false,parent:null,
  addEventListener(){},contains(node){return node===this||this.children.some(child=>child.contains(node));},focus(options){assert.equal(options.preventScroll,true);document.activeElement=this;},scrollIntoView(){},
  append(child){this.insertBefore(child,null);},prepend(child){this.insertBefore(child,this.children[0]);},insertBefore(child,before){if(child.parent)child.remove();const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,child);child.parent=this;child.isConnected=true;},
  remove(){this.isConnected=false;if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}if(this.contains(document.activeElement))document.activeElement=document.body;},
  querySelectorAll(selector){const key=selector.slice(6,-1).replace(/-([a-z])/g,(_,x)=>x.toUpperCase());return this.children.flatMap(child=>[...(Object.hasOwn(child.dataset,key)?[child]:[]),...child.querySelectorAll(selector)]);},
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}};}
 document.body=element();document.activeElement=document.body;
 const root=element(),body=element(),editor=element(),lockStatus=element();root.append(body);nodes.set('#booksBody',body);nodes.set('#booksLockStatus',lockStatus);
 function input(form,key,value=''){const node=element();node.value=value;form[key]=node;form.append(node);return node;}
 function makeForm(id,html){const form=element();nodes.set('#'+id,form);const errors=element();nodes.set('#'+id.replace('Form','Errors'),errors);form.append(errors);for(const key of ['code','name','date','receipt','tin','vrn'])input(form,key,html.match(new RegExp('name="'+key+'"[^>]*value="([^"]*)"'))?.[1]||'');
  if(id==='booksFiscalForm')form.code.value=html.match(/name="code"[^>]*value="([^"]*)"/)?.[1]||'';
  input(form,'type',(html.match(/<option value="([^"]+)" selected>/)||[])[1]||'expense');input(form,'active',html.includes('value="false" selected')?'false':'true');const submit=element();submit.type='submit';form.append(submit);form.submit=submit;return form;
 }
 function makeRow(html){const id=html.match(/data-books-account-row="([^"]+)"/)[1],row=element({booksAccountRow:id});row.html=html;row.append(element({booksEditAccount:id}));row.append(element({booksAccountLedger:id}));return row;}
 Object.defineProperty(editor,'innerHTML',{set(html){for(const child of this.children){child.isConnected=false;if(child.contains(document.activeElement))document.activeElement=document.body;}this.children=[];if(!html){nodes.delete('#booksAccountForm');return;}this.append(makeForm('booksAccountForm',html));const cancel=html.includes('id="booksAccountCancel"')?element():null;if(cancel){this.append(cancel);nodes.set('#booksAccountCancel',cancel);}else nodes.delete('#booksAccountCancel');}});
 Object.defineProperty(body,'innerHTML',{set(html){bodyWrites++;this.children=[];for(const id of ['booksAccountNew','booksAccountRefresh','booksAccountPrevious','booksAccountNext','booksAccountPageStatus','booksAccountTotals','booksAccountPageError','booksAccountEmpty']){const node=element();nodes.set('#'+id,node);this.append(node);}const filters=makeForm('booksAccountFilters','');input(filters,'query','');this.append(filters);this.append(editor);nodes.set('#booksAccountEditor',editor);const lock=makeForm('booksLockForm',html.match(/<form id="booksLockForm"[\s\S]*?<\/form>/)?.[0]||'');this.append(lock);groups.length=0;
  for(const match of html.matchAll(/<tbody data-books-account-type="([^"]+)"[^>]*>([\s\S]*?)<\/tbody>/g)){const group=element({booksAccountType:match[1]});for(const row of match[2].matchAll(/<tr data-books-account-row=[\s\S]*?<\/tr>/g))group.append(makeRow(row[0]));groups.push(group);this.append(group);}}});
 const invoice={id:'invoice',organization_id:'customer',invoice_number:'INV-1',total_minor:10000,paid:2000,outstanding:8000,state:{key:'part',label:'Part paid'},tra_receipt_number:''};
 const fiscalCell=element({booksFiscalCell:'invoice'}),fiscalTrigger=element({booksFiscal:'invoice'});root.append(fiscalCell);root.append(fiscalTrigger);
 document.querySelectorAll=selector=>root.querySelectorAll(selector);document.querySelector=selector=>nodes.get(selector)||null;
 document.createElement=tag=>{if(tag==='template'){const template={content:{}};Object.defineProperty(template,'innerHTML',{set(html){template.content.firstElementChild=makeRow(html);}});return template;}assert.equal(tag,'dialog');const box=element();box.open=false;box.events={};box.addEventListener=(name,fn)=>box.events[name]=fn;box.close=()=>{box.open=false;box.events.close?.();};Object.defineProperty(box,'innerHTML',{set(html){const form=makeForm('booksFiscalForm',html),cancel=element();box.append(form);box.append(cancel);nodes.set('#booksFiscalCancel',cancel);box.querySelector=selector=>selector==='form'?form:selector==='[type="submit"]'?form.submit:selector==='#booksFiscalErrors'?nodes.get(selector):cancel;}});return box;};
 const data={accounts:[account('first','4000'),account('second','6000')],settings:{id:true,version:4,locked_through:null},invoices:[invoice],taxIds:new Map(),today:'2026-10-29',total:2,page:0,pages:1,summary:{account_count:2,debit_minor:500,credit_minor:0}};
 const ctx=vm.createContext({document,busy:false,window,console,me:{user_id:'actor',role:'owner'},view:'books',esc:value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),$:document.querySelector,crypto:{randomUUID:()=>`new-${++nextId}`},moneyDisplay:n=>String(n),organizations:[{id:'customer',name:'Fictional clinic'}],FormData:class{constructor(form){this.form=form;}get(key){return this.form[key]?.value||'';}},message:(text,error)=>messages.push({text,error}),client:{rpc:async(name,args)=>{calls.push({name,args});if(name==='acc_trial_balance')return {data:[{account_id:'first',debit_minor:500,credit_minor:0}]};throw Error('Unexpected RPC '+name);}},run:fn=>{pending=fn();return pending;}});
 Object.assign(ctx,{workspaceFormSnapshot:form=>JSON.stringify(['receipt','code','tin','vrn'].map(key=>form[key].value)),showWorkspaceDialog:box=>{box.open=true;},closeWorkspaceDialog:async box=>{box.close();return true;},bindWorkspaceDialogDismiss:(box,options)=>async()=>{if(options.isBusy()||options.isDirty())return false;return ctx.closeWorkspaceDialog(box);}});
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),ctx);vm.runInContext(source,ctx);ctx.data=data;vm.runInContext("booksData={...data,accounts:[{id:'full-cache'}]};booksAccountPageData=data;booksSection='accounts';booksWorkspace=async()=>{throw Error('Whole workspace refresh');};",ctx);
 return {ctx,data,invoice,calls,messages,nodes,groups,body,editor,fiscalCell,fiscalTrigger,document,window,get writes(){return bodyWrites;},get pending(){return pending;},get:code=>vm.runInContext(code,ctx),render:async()=>{await ctx.booksAccounts('actor',()=>true);nodes.get('#booksAccountNew').onclick();},submit:id=>{nodes.get('#'+id).onsubmit({preventDefault(){}});return pending;},row:id=>document.querySelectorAll('[data-books-account-row]').find(row=>row.dataset.booksAccountRow===id)};
}
function respond(f,name,result){f.ctx.client.rpc=async(rpc,args)=>{f.calls.push({name:rpc,args});if(rpc==='acc_account_page'){const data={...f.data,accounts:f.data.accounts.slice(),total:f.data.accounts.length,summary:{...f.data.summary,account_count:f.data.accounts.length}};return {data};}assert.equal(rpc,name);return result;};}
test('account edit patches only its row, keeps balances and reconciles one bounded chart page',async()=>{
 const f=fixture();await f.render();const untouched=f.row('second'),body=f.body;f.row('first').querySelector('[data-books-edit-account]').onclick();await f.pending;
 const form=f.nodes.get('#booksAccountForm');form.name.value='Corrected';f.document.activeElement=form.submit;
 respond(f,'save_ledger_account',{data:{...account('first','5000'),name:'Server corrected',version:3}});await f.submit('booksAccountForm');
 assert.equal(f.writes,1);assert.equal(f.body,body);assert.equal(f.row('second'),untouched);assert.match(f.row('first').html,/Server corrected/);assert.match(f.row('first').html,/>500<\/td>/);assert.equal(f.data.accounts[0].version,3);
 assert.equal(f.document.activeElement,f.nodes.get('#booksAccountNew'));assert.equal(f.window.scrollY,620);assert.equal(f.window.scrollX,9);assert.deepEqual(f.calls.map(x=>x.name),['save_ledger_account','acc_account_page']);assert.equal(f.get('booksDraft'),null);
});
test('new account uses confirmed identity and appears once in code order',async()=>{
 const f=fixture();await f.render();respond(f,'save_ledger_account',{data:{...account('new-1','5000'),version:1}});await f.submit('booksAccountForm');
 assert.deepEqual(f.groups.find(x=>x.dataset.booksAccountType==='expense').children.map(x=>x.dataset.booksAccountRow),['first','new-1','second']);assert.equal(f.data.accounts.length,3);assert.equal(f.writes,1);
});
test('a confirmed type change moves only that account to the returned group',async()=>{
 const f=fixture();await f.render();const kept=f.row('first');f.row('second').querySelector('[data-books-edit-account]').onclick();await f.pending;respond(f,'save_ledger_account',{data:{...account('second','1000','asset'),version:3}});await f.submit('booksAccountForm');
 assert.equal(f.row('first'),kept);assert.deepEqual(f.groups.find(x=>x.dataset.booksAccountType==='asset').children.map(x=>x.dataset.booksAccountRow),['second']);assert.deepEqual(f.groups.find(x=>x.dataset.booksAccountType==='expense').children.map(x=>x.dataset.booksAccountRow),['first']);
});
test('account failure leaves draft, rows and focus intact',async()=>{
 const f=fixture();await f.render();const row=f.row('first'),form=f.nodes.get('#booksAccountForm');form.name.value='Draft';f.document.activeElement=form.name;respond(f,'save_ledger_account',{error:{message:'Version changed'}});await assert.rejects(f.submit('booksAccountForm'),/Version changed/);
 assert.equal(f.row('first'),row);assert.equal(form.name.value,'Draft');assert.equal(f.document.activeElement,form.name);assert.equal(f.messages.length,0);
});
for(const change of ['actor','session','view','epoch','detached'])test(`late account response ignores ${change} change`,async()=>{
 const f=fixture();await f.render();const original=f.data.accounts.slice(),wait=deferred();f.ctx.client.rpc=()=>wait.promise;const saving=f.submit('booksAccountForm');
 if(change==='actor')f.ctx.me={user_id:'other'};if(change==='session')f.ctx.me={user_id:'actor'};if(change==='view')f.ctx.view='sales';if(change==='epoch')f.get('booksEpoch++');if(change==='detached')f.nodes.get('#booksAccountForm').isConnected=false;
 wait.resolve({data:account('new-1','5000')});await saving;assert.deepEqual(f.data.accounts,original);assert.equal(f.messages.length,0);assert.equal(f.writes,1);
});
test('incomplete confirmed account response blocks resubmission and reports saved state',async()=>{
 const f=fixture();await f.render();respond(f,'save_ledger_account',{data:{id:'new-1'}});await f.submit('booksAccountForm');const form=f.nodes.get('#booksAccountForm');assert.equal(form.inert,true);assert.match(f.messages.at(-1).text,/Account saved.*incomplete/);await f.submit('booksAccountForm');assert.equal(f.calls.filter(x=>x.name==='save_ledger_account').length,1);
});
test('lock saves in place and the next save uses the returned version',async()=>{
 const f=fixture();await f.render();const form=f.nodes.get('#booksLockForm'),row=f.row('first');form.date.value='2026-10-25';f.document.activeElement=form.date;
 respond(f,'set_books_lock',{data:{id:true,version:5,locked_through:'2026-10-25'}});await f.submit('booksLockForm');assert.equal(f.data.settings.version,5);assert.equal(f.nodes.get('#booksLockStatus').textContent,'Books locked through 2026-10-25.');assert.equal(f.document.activeElement,form.date);assert.equal(f.row('first'),row);assert.equal(f.writes,1);
 form.date.value='';respond(f,'set_books_lock',{data:{id:true,version:6,locked_through:null}});await f.submit('booksLockForm');assert.equal(f.calls.at(-1).args.p_expected_version,5);assert.equal(f.nodes.get('#booksLockStatus').textContent,'No lock date set.');assert.equal(f.data.settings.version,6);
});
test('late lock response cannot update a replacement session',async()=>{
 const f=fixture();await f.render();const wait=deferred();f.ctx.client.rpc=()=>wait.promise;const saving=f.submit('booksLockForm');f.ctx.me={user_id:'actor'};wait.resolve({data:{version:5,locked_through:'2026-10-01'}});await saving;assert.equal(f.data.settings.version,4);assert.equal(f.messages.length,0);
});
test('fiscal save patches returned fields and tax hints, retaining all invoice balances and DOM',async()=>{
 const f=fixture();f.ctx.booksFiscalPrompt(f.invoice);const form=f.nodes.get('#booksFiscalForm');f.document.activeElement=form.submit;
 respond(f,'record_invoice_fiscal',{data:{id:'invoice',organization_id:'customer',tra_receipt_number:'TRA-42',tra_verification_code:'CODE',buyer_tin:'123-456',buyer_vrn:'VRN',total_minor:99999}});await f.submit('booksFiscalForm');
 assert.equal(f.invoice.total_minor,10000);assert.equal(f.invoice.paid,2000);assert.equal(f.invoice.outstanding,8000);assert.equal(f.invoice.tra_receipt_number,'TRA-42');assert.equal(f.data.taxIds.get('customer').tin,'123-456');assert.equal(f.fiscalCell.textContent,'TRA-42');assert.equal(f.fiscalTrigger.textContent,'Edit TRA receipt');assert.equal(f.document.activeElement,f.fiscalTrigger);assert.equal(f.window.scrollY,620);assert.equal(f.writes,0);assert.deepEqual(f.calls.map(x=>x.name),['record_invoice_fiscal']);
});
test('fiscal completion respects deliberate focus outside the removed prompt',async()=>{
 const f=fixture();f.ctx.booksFiscalPrompt(f.invoice);f.document.activeElement=f.fiscalTrigger;respond(f,'record_invoice_fiscal',{data:{id:'invoice',organization_id:'customer',tra_receipt_number:'TRA-42'}});await f.submit('booksFiscalForm');assert.equal(f.document.activeElement,f.fiscalTrigger);
});
test('stale fiscal form neither writes nor updates another actor',async()=>{
 const f=fixture();f.ctx.booksFiscalPrompt(f.invoice);f.ctx.me={user_id:'other'};await f.submit('booksFiscalForm');assert.equal(f.calls.length,0);assert.equal(f.invoice.tra_receipt_number,'');
});
test('incomplete fiscal response is reported as saved and cannot submit again',async()=>{
 const f=fixture();f.ctx.booksFiscalPrompt(f.invoice);respond(f,'record_invoice_fiscal',{data:{id:'other'}});await f.submit('booksFiscalForm');assert.match(f.messages.at(-1).text,/TRA receipt saved.*incomplete/);assert.equal(f.nodes.get('#booksFiscalForm').inert,true);await f.submit('booksFiscalForm');assert.equal(f.calls.length,1);assert.equal(f.invoice.tra_receipt_number,'');
});

test('account row replacement restores a focused action and preserves unrelated focus',async()=>{
 for(const focusId of ['first','second']){const f=fixture();await f.render();f.row('first').querySelector('[data-books-edit-account]').onclick();await f.pending;const focused=f.row(focusId).querySelector('[data-books-account-ledger]');f.document.activeElement=focused;respond(f,'save_ledger_account',{data:{...account('first','5000'),version:3}});await f.submit('booksAccountForm');assert.equal(f.document.activeElement,f.row(focusId).querySelector('[data-books-account-ledger]'));if(focusId==='second')assert.equal(f.document.activeElement,focused);}
});
test('lock response keeps an unsaved date typed while the save was pending',async()=>{
 const f=fixture();await f.render();const form=f.nodes.get('#booksLockForm'),wait=deferred();form.date.value='2026-10-10';f.ctx.client.rpc=()=>wait.promise;const saving=f.submit('booksLockForm');form.date.value='2026-10-20';wait.resolve({data:{id:true,version:5,locked_through:'2026-10-10'}});await saving;assert.equal(form.date.value,'2026-10-20');assert.equal(f.data.settings.locked_through,'2026-10-10');assert.equal(f.nodes.get('#booksLockStatus').textContent,'Books locked through 2026-10-10.');
});
test('incomplete lock response blocks retries and reports the committed save',async()=>{
 const f=fixture();await f.render();respond(f,'set_books_lock',{data:{version:5}});await f.submit('booksLockForm');assert.equal(f.nodes.get('#booksLockForm').inert,true);assert.match(f.messages.at(-1).text,/Lock date saved.*incomplete/);await f.submit('booksLockForm');assert.equal(f.calls.filter(x=>x.name==='set_books_lock').length,1);assert.equal(f.data.settings.version,4);
});

test('confirmed account save survives a failed bounded chart read without resetting other rows or the full cache',async()=>{
 const f=fixture();await f.render();const kept=f.row('second');f.row('first').querySelector('[data-books-edit-account]').onclick();await f.pending;
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return name==='save_ledger_account'?{data:{...account('first','4000'),name:'Confirmed account',version:3}}:{error:{message:'Chart offline'}};};await f.submit('booksAccountForm');
 assert.match(f.row('first').html,/Confirmed account/);assert.equal(f.row('second'),kept);assert.equal(f.writes,1);assert.match(f.nodes.get('#booksAccountPageError').textContent,/Account saved, but the chart could not refresh: Chart offline/);assert.equal(f.get('booksData.accounts[0].id'),'full-cache');assert.deepEqual(f.calls.map(call=>call.name),['save_ledger_account','acc_account_page']);
});
test('bounded chart reconciliation removes a saved account outside the filter while retaining matching row identities',async()=>{
 const f=fixture();await f.render();const kept=f.row('second');f.row('first').querySelector('[data-books-edit-account]').onclick();await f.pending;
 f.ctx.client.rpc=async name=>name==='save_ledger_account'?{data:{...account('first','4000'),name:'No longer matches',version:3}}:{data:{...f.data,accounts:[f.data.accounts.find(row=>row.id==='second')],total:1,summary:{account_count:2,debit_minor:500,credit_minor:0}}};await f.submit('booksAccountForm');
 assert.equal(f.row('first'),undefined);assert.equal(f.row('second'),kept);assert.equal(f.data.total,1);assert.equal(f.writes,1);assert.equal(f.get('booksData.accounts[0].id'),'full-cache');
});
test('creating an account from a full50-row chart never mounts a51st summary or substitutes the full cache',async()=>{
 const f=fixture();f.data.accounts=Array.from({length:50},(_,n)=>account('existing-'+n,String(4000+n)));f.data.total=50;f.data.summary.account_count=50;await f.render();let mountedAtRefresh;
 f.ctx.client.rpc=async name=>{if(name==='save_ledger_account')return {data:{...account('new-1','9000'),version:1}};mountedAtRefresh=f.document.querySelectorAll('[data-books-account-row]').length;return {data:{...f.data,total:51,pages:2,summary:{account_count:51,debit_minor:500,credit_minor:0}}};};await f.submit('booksAccountForm');assert.equal(mountedAtRefresh,50);assert.equal(f.document.querySelectorAll('[data-books-account-row]').length,50);assert.equal(f.data.total,51);assert.equal(f.get('booksData.accounts[0].id'),'full-cache');
});
