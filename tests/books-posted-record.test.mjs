import {installNativeFormControls} from './helpers/native-form-controls.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const event={preventDefault(){}};
// Identity adapter runs actual Books forms and callbacks. Browser layout/native focus remain unverified.
function dom(){
 const decode=s=>String(s).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&');let document;
 const dataName=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 class Node{
  constructor(tag='',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.events={};this.classList={toggle:(key,on)=>{const names=new Set((this.attrs.class||'').split(' ').filter(Boolean));if(on)names.add(key);else names.delete(key);this.attrs.class=[...names].join(' ');}};this._text='';this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.value=attrs.value||'';this.selectionStart=this.selectionEnd=0;this.scrollLeft=0;this.open='open'in attrs;this.dataset=new Proxy({},{get:(_,key)=>this.attrs[dataName(key)],set:(_,key,value)=>(this.attrs[dataName(key)]=value,true),ownKeys:()=>Object.keys(this.attrs).filter(key=>key.startsWith('data-')).map(key=>key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});}
  get organization(){return this.elements.organization;}get date(){return this.elements.date;}get amount(){return this.elements.amount;}get method(){return this.elements.method;}get deposit(){return this.elements.deposit;}get reference(){return this.elements.reference;}get memo(){return this.elements.memo;}get reason(){return this.elements.reason;}
  get id(){return this.attrs.id;}get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value);}
  set innerHTML(value){this.replaceChildren(...parse(value));}get innerHTML(){return this._text+this.children.map(child=>child.outerHTML).join('');}
  get outerHTML(){return this.tag?`<${this.tag}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('')}>${this.innerHTML}</${this.tag}>`:this._text;}
  get nextElementSibling(){const rows=this.parentElement?.children.filter(node=>node.tag)||[];return rows[rows.indexOf(this)+1]||null;}
  showModal(){this.open=true;this.attrs.open='';}close(){this.open=false;delete this.attrs.open;this.emit('close');}
  get firstElementChild(){return this.children.find(node=>node.tag)||null;}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){
   let no=true;selector=selector.replace(/:not\(([^)]+)\)/g,(_,negative)=>{if(this.matches(negative))no=false;return '';});if(!no)return false;
   if(selector===':disabled')return this.disabled;
   const attrs=[...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];if(attrs.some(([,key,value])=>!(key in this.attrs)||value!==undefined&&this.attrs[key]!==value))return false;
   selector=selector.replace(/\[[^\]]+\]/g,'');const id=selector.match(/#([\w-]+)/)?.[1],klass=selector.match(/\.([\w-]+)/)?.[1],tag=selector.match(/^[a-z]+/)?.[0];return (!id||this.id===id)&&(!klass||(this.attrs.class||'').split(' ').includes(klass))&&(!tag||this.tag===tag);
  }
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelectorAll(selector){const out=[],selectors=selector.split(',').map(value=>value.trim());const visit=node=>{for(const child of node.children){if(child.tag&&selectors.some(value=>{const parts=value.split(/\s+/);return child.matches(parts.at(-1))&&(parts.length===1||child.parentElement?.closest(parts.slice(0,-1).join(' ')));}))out.push(child);visit(child);}};visit(this);return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){node.remove();const at=before?this.children.indexOf(before):this.children.length;assert.notEqual(at,-1);this.children.splice(at,0,node);node.parentElement=this;}
  replaceChildren(...nodes){for(const node of [...this.children])node.remove();this._text='';this.append(...nodes);}
  replaceWith(node){const parent=this.parentElement;assert.ok(parent,'Replacement requires an attached old node');parent.insertBefore(node,this);this.remove();}
  remove(){if(!this.parentElement)return;if(this.isConnected&&this.contains(document.activeElement))document.activeElement=document.body;const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}
  insertAdjacentHTML(position,html){if(position==='afterbegin'){for(const node of parse(html).reverse())this.insertBefore(node,this.children[0]||null);}else{assert.equal(position,'beforeend');this.append(...parse(html));}}
  after(node){this.parentElement.insertBefore(node,this.nextElementSibling);}
  addEventListener(name,fn,options){(this.events[name]??=[]).push({fn,once:!!options?.once});}
  emit(name){for(const event of [...(this.events[name]||[])]){event.fn();if(event.once)this.events[name].splice(this.events[name].indexOf(event),1);}}
  focus(){document.activeElement=this;}setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  get elements(){return new Proxy({},{get:(_,name)=>this.querySelector(`[name="${name}"]`)});}
 }
 function parse(html){const root=new Node(),stack=[root];for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[match[1]]=decode(match[2]??'');const node=new Node(tag,attrs);stack.at(-1).append(node);if(!['input','br','hr','img','meta','link'].includes(tag))stack.push(node);}else{const node=new Node();node._text=decode(token);stack.at(-1).append(node);}}return [...root.children];}
 document={createElement(tag){const node=new Node(tag);if(tag==='template'){node.content=new Node();Object.defineProperty(node,'innerHTML',{set:value=>node.content.innerHTML=value});}return node;}};document.body=new Node('body');document.activeElement=document.body;document.querySelector=selector=>document.body.querySelector(selector);document.querySelectorAll=selector=>document.body.querySelectorAll(selector);return document;
}
const accounts=[{id:'bank',code:'1200',name:'Bank',account_type:'asset',system_key:'bank',active:true},{id:'expense',code:'6000',name:'Expense',account_type:'expense',system_key:null,active:true}];
const original={id:'j0',entry_number:'JE-ORIGINAL',entry_date:'2026-10-20',memo:'Office rent',source_type:'manual',source_id:null,reverses_entry_id:null,currency:'TZS',created_by:'accountant'};
const saved=(kind,args)=>kind==='receipt'?{id:args.p_id,receipt_number:'RC-SAVED',organization_id:args.p_organization_id,receipt_date:args.p_date,amount_minor:args.p_amount_minor,method:args.p_method,reference:args.p_reference.trim(),deposit_account_id:args.p_deposit_account_id,journal_entry_id:'receipt-journal',created_by:'accountant',voided_at:null}:{id:args.p_id,entry_number:'JE-SAVED',entry_date:args.p_date,memo:kind==='reversal'?`Reversal of ${original.entry_number}: ${args.p_reason.trim()}`:args.p_memo.trim(),source_type:kind==='reversal'?'reversal':'manual',source_id:null,reverses_entry_id:kind==='reversal'?'j0':null,currency:'TZS',created_by:'accountant'};
async function fixture(kind='receipt'){
 const document=dom();installNativeFormControls(document);document.body.innerHTML='<main id="content">'+workspacePageHeader({title:'Books',back:'<button type="button" id="booksTransactionBack">Back to register</button>'})+'<header><input id="retainedSearch" value="office"><details open><summary>Retained disclosure</summary><p>Unrelated</p></details></header><section id="booksBody"></section></main>';
 const node=selector=>document.querySelector(selector),content=node('#content'),body=node('#booksBody'),calls=[],messages=[];
 let contentWrites=0,bodyWrites=0;for(const [element,increment] of [[content,()=>contentWrites++],[body,()=>bodyWrites++]]){const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'innerHTML');Object.defineProperty(element,'innerHTML',{get:()=>descriptor.get.call(element),set:value=>{increment();descriptor.set.call(element,value);}});}
 const section=kind==='receipt'?'receipts':'journal',session={user_id:'accountant'},c=vm.createContext({workspacePageHeader,document,busy:false,me:session,view:'books',crypto:{randomUUID:()=> 'stable-id'},esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),$:node,organizations:[{id:'customer',name:'Fictional customer'}],message:(...args)=>messages.push(args),salesOrganizationOptions:()=>'<option value="customer">Fictional customer</option>',run:fn=>c.running=fn(),booksWorkspace:()=>assert.fail('No automatic Books reload')});
 for(const file of ['client-rules.js','sales-domain.js','accounting-ledger.js'])vm.runInContext(read(file),c);
 const get=code=>vm.runInContext(code,c);c.data={accounts:structuredClone(accounts),today:'2026-10-29',settings:{version:1},invoices:[{id:'invoice',invoice_number:'INV-1',organization_id:'customer',due_date:'2026-10-20',outstanding:12000}],receipts:[],allocations:[]};get(`booksData=data;booksSection='${section}';booksTransactionSelected='${kind==='reversal'?'j0':'new'}';booksEpoch=10;booksDraft={retained:true}`);
 c.booksWorkspace=async()=>{calls.push({open:get('booksTransactionSelected')});};
 const current=()=>c.me===session&&c.view==='books'&&get(`booksSection==='${section}'&&booksEpoch===10`);
 if(kind==='reversal'){
  c.booksSelect=async(table,columns,build)=>{let key;build({eq(k){key=k;return this;},limit(){return this;}});return key==='id'?[original]:[];};c.booksSelectAll=async()=>[{entry_id:'j0',line_no:1,account_id:'bank',debit_minor:5000,credit_minor:0,description:'Bank'},{entry_id:'j0',line_no:2,account_id:'expense',debit_minor:0,credit_minor:5000,description:'Expense'}];
  await c.booksJournalDetail('accountant',current);node('#booksJournalReverse').onclick();
 }else await (kind==='receipt'?c.booksReceipts:c.booksJournal)('accountant',current);
 const form=kind==='reversal'?node('#booksJournalDetail form'):node(kind==='receipt'?'#booksReceiptForm':'#booksJournalForm');
 if(kind==='receipt'){for(const [key,value] of Object.entries({organization:'customer',date:'2026-10-29',amount:'100',method:'bank',deposit:'bank',reference:' REF '}))form[key].value=value;form.organization.onchange();node('[data-books-allocate]').value='50';}
 else if(kind==='journal'){form.date.value='2026-10-29';form.memo.value=' Office rent ';for(const input of document.querySelectorAll('[data-jl]'))input.value=[{accountId:'bank',debit:'50',credit:'',description:'Bank line'},{accountId:'expense',debit:'',credit:'50',description:'Expense line'}][Number(input.dataset.i)][input.dataset.jl];}
 else{form.date.value='2026-10-29';form.reason.value=' Correction ';}
 const expectedArgs=kind==='receipt'?{p_id:'stable-id',p_organization_id:'customer',p_date:'2026-10-29',p_amount_minor:10000,p_method:'bank',p_reference:' REF ',p_deposit_account_id:'bank',p_allocations:[{invoice_id:'invoice',amount_minor:5000}]}:kind==='journal'?{p_id:'stable-id',p_date:'2026-10-29',p_memo:' Office rent ',p_lines:[{account_id:'bank',debit_minor:5000,credit_minor:0,description:'Bank line'},{account_id:'expense',debit_minor:0,credit_minor:5000,description:'Expense line'}]}:{p_id:'stable-id',p_entry_id:'j0',p_date:'2026-10-29',p_reason:' Correction '};
 c.saved=saved(kind,expectedArgs);c.readRow=c.saved;c.client={rpc:async(name,args)=>{calls.push({name,args});return {data:c.saved};}};
 c.booksSelect=async(table,columns,build)=>{const read={table,columns};build({eq(key,id){read.eq=[key,id];return this;},limit(limit){read.limit=limit;return this;}});calls.push(read);if(c.readError)throw Error(c.readError);return [c.readRow];};
 const submit=()=>{form.onsubmit(event);return c.running;};
 const replace=what=>{if(what==='actor')c.me={...session};else if(what==='route')c.view='personal';else if(what==='epoch')get('booksEpoch++');else if(what==='data')get('booksData={replacement:true}');else form.remove();};
 return {c,get,node,document,form,body,content,calls,messages,submit,expectedArgs,replace,writes:()=>({contentWrites,bodyWrites})};
}
for(const kind of ['receipt','journal','reversal'])test(`${kind} confirmed write retains editor, fields, table and shell; focuses explicit saved record`,async()=>{
 const f=await fixture(kind),form=f.form,search=f.node('#retainedSearch'),disclosure=f.node('details'),row=f.node('tbody tr'),inputs=[...form.querySelectorAll('input,select')],values=inputs.map(node=>node.value),data=f.get('booksData'),draft=f.get('booksDraft');form.querySelector('[type="submit"]').focus();await f.submit();
 assert.deepEqual(f.writes(),{contentWrites:0,bodyWrites:1});assert.equal(f.form,form);assert.equal(f.node('#retainedSearch'),search);assert.equal(f.node('details'),disclosure);assert.equal(disclosure.open,true);assert.equal(f.node('tbody tr'),row);assert.deepEqual([...form.querySelectorAll('input,select')],inputs);assert.deepEqual(inputs.map(node=>node.value),values);assert.equal(form.inert,true);assert.equal(form.getAttribute('aria-disabled'),'true');assert.equal(f.get('booksData'),data);assert.equal(f.get('booksDraft'),draft);assert.equal(f.get('booksTransactionSelected'),kind==='reversal'?'j0':'new');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{name:{receipt:'record_receipt',journal:'post_manual_journal',reversal:'reverse_journal_entry'}[kind],args:f.expectedArgs}]);const open=f.node('[data-books-posted-open]');assert.equal(f.document.activeElement,open);assert.equal(open.closest('form'),null);assert.match(f.node('[data-books-posted]').textContent,/SAVED.*recorded|SAVED.*posted/);if(kind==='receipt')assert.match(f.node('[data-books-posted]').textContent,/balances.*before this receipt/);if(kind==='reversal'){assert.equal(f.node('#booksJournalReverse').textContent,'Reversed');assert.equal(f.node('#booksJournalReverse').disabled,true);}
 await f.submit();assert.equal(f.calls.length,1);open.onclick();await f.c.running;assert.equal(f.calls[1].open,'stable-id');assert.equal(f.get('booksDraft'),null);
});
test('a pending write locks fields and rejects duplicate submission or Add line before and after confirmation',async()=>{
 for(const kind of ['receipt','journal','reversal']){const f=await fixture(kind),wait=deferred();let writes=0;f.c.client.rpc=async()=>{writes++;return wait.promise;};const posting=f.submit();assert.equal(f.form.inert,true);f.submit();if(kind==='journal')f.node('#booksAddLine').onclick();assert.equal(writes,1);wait.resolve({data:f.c.saved});await posting;await f.submit();assert.equal(writes,1);assert.equal(f.writes().bodyWrites,1);}
});
test('failed writes remain editable and retry with the original stable ID without claiming success',async()=>{
 for(const kind of ['receipt','journal','reversal']){const f=await fixture(kind);f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});throw Error('Posting rejected');};await assert.rejects(f.submit(),/Posting rejected/);assert.equal(f.form.inert,false);assert.equal(f.node('[data-books-posted]'),null);assert.equal(f.messages.length,0);f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:f.c.saved};};await f.submit();assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),f.expectedArgs);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].args)),f.expectedArgs);assert.ok(f.node('[data-books-posted-open]'));}
});
test('incomplete confirmation keeps saved form locked; Retry reads only its ID and never posts twice',async()=>{
 for(const kind of ['receipt','journal','reversal']){const f=await fixture(kind),verified=f.c.saved;f.c.saved={id:'wrong'};await f.submit();const notice=f.node('[data-books-posted]');assert.match(notice.textContent,/recorded, but|posted, but/);assert.match(notice.textContent,/could not be verified/);assert.equal(f.node('[data-books-posted-open]'),null);assert.equal(f.form.inert,true);assert.equal(f.calls.length,1);if(kind==='reversal')assert.equal(f.node('#booksJournalReverse').textContent,'Reverse');await f.submit();assert.equal(f.calls.length,1);
 f.c.readError='Offline <now>';f.node('[data-books-posted-retry]').onclick();await f.c.running;assert.match(notice.textContent,/Offline <now>/);assert.equal(notice.querySelector('now'),null);assert.equal(f.document.activeElement,f.node('[data-books-posted-retry]'));assert.deepEqual(f.calls[1],{table:kind==='receipt'?'acc_receipts':'acc_journal_entries',columns:'*',eq:['id','stable-id'],limit:2});
 f.c.readError='';f.c.readRow=verified;f.node('[data-books-posted-retry]').onclick();await f.c.running;assert.ok(f.node('[data-books-posted-open]'));assert.equal(f.document.activeElement,f.node('[data-books-posted-open]'));assert.equal(f.calls.filter(call=>call.name).length,1);assert.equal(f.writes().bodyWrites,1);if(kind==='reversal')assert.equal(f.node('#booksJournalReverse').textContent,'Reversed');}
});
test('returned records must match all posting header fields and a single row before confirmation',async()=>{
 for(const kind of ['receipt','journal','reversal']){const valid=await fixture(kind),row=valid.c.saved;
  const variants=[null,{},[row,row],{...row,id:'other'},{...row,created_by:'other'},{...row,[kind==='receipt'?'receipt_number':'entry_number']:''},...Object.keys(row).filter(key=>!['id','receipt_number','entry_number','journal_entry_id','voided_at'].includes(key)).map(key=>({...row,[key]:'wrong'}))];if(kind==='receipt')variants.push({...row,journal_entry_id:null});
  for(const invalid of variants){const f=await fixture(kind);f.c.saved=invalid;await f.submit();assert.equal(f.node('[data-books-posted-open]'),null,kind+' '+JSON.stringify(invalid));assert.ok(f.node('[data-books-posted-retry]'));assert.equal(f.form.inert,true);}
  valid.c.saved=[row];await valid.submit();assert.ok(valid.node('[data-books-posted-open]'));
 }
});
test('replacement session, route, epoch, data or detached form ignores late write success and failure',async()=>{
 for(const kind of ['receipt','journal','reversal'])for(const change of ['actor','route','epoch','data','disconnect'])for(const outcome of ['success','reject']){const f=await fixture(kind),wait=deferred();f.c.client.rpc=()=>wait.promise;const posting=f.submit();f.replace(change);const before=f.content.innerHTML,draft=f.get('booksDraft');if(outcome==='reject')wait.reject(Error('Old posting failure'));else wait.resolve({data:f.c.saved});await posting;assert.equal(f.content.innerHTML,before);assert.equal(f.get('booksDraft'),draft);assert.equal(f.node('[data-books-posted]'),null);assert.equal(f.messages.length,0);}
});
test('late read-only Retry results and errors cannot update another session, page or editor',async()=>{
 for(const kind of ['receipt','journal','reversal'])for(const change of ['actor','route','epoch','data','disconnect'])for(const outcome of ['success','reject']){const f=await fixture(kind);f.c.saved={};await f.submit();const wait=deferred();f.c.booksSelect=()=>wait.promise;f.node('[data-books-posted-retry]').onclick();const reading=f.c.running;f.replace(change);const before=f.content.innerHTML;if(outcome==='reject')wait.reject(Error('Old verification failure'));else wait.resolve([f.c.readRow]);await reading;assert.equal(f.content.innerHTML,before);assert.equal(f.messages.length,0);}
});
test('unrelated focus and scroll positions survive success and read-only verification',async()=>{
 for(const kind of ['receipt','journal','reversal']){const f=await fixture(kind),search=f.node('#retainedSearch');search.focus();search.selectionStart=1;search.selectionEnd=4;f.body.scrollLeft=35;await f.submit();assert.equal(f.document.activeElement,search);assert.equal(search.selectionStart,1);assert.equal(search.selectionEnd,4);assert.equal(f.body.scrollLeft,35);}
});
test('stale saved-record buttons cannot change selected record or launch a workspace read',async()=>{
 for(const kind of ['receipt','journal','reversal']){const f=await fixture(kind);await f.submit();const open=f.node('[data-books-posted-open]');f.replace('actor');open.onclick();await f.c.running;assert.equal(f.calls.length,1);assert.equal(f.get('booksTransactionSelected'),kind==='reversal'?'j0':'new');}
});

test('header verification preserves SQL trim semantics for tabs in receipt references and journal descriptions',async()=>{
 for(const kind of ['receipt','journal','reversal']){const f=await fixture(kind);if(kind==='receipt'){f.form.reference.value=' \tREF\t ';f.c.saved.reference='\tREF\t';}else if(kind==='journal'){f.form.memo.value=' \tOffice rent\t ';f.c.saved.memo='\tOffice rent\t';}else{f.form.reason.value=' \tCorrection\t ';f.c.saved.memo='Reversal of JE-ORIGINAL: \tCorrection\t';}await f.submit();assert.ok(f.node('[data-books-posted-open]'));assert.equal(f.node('[data-books-posted-retry]'),null);}
});
