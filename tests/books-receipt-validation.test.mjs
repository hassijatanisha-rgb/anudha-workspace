import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.js'),runSource=app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const saved=args=>({id:args.p_id,receipt_number:'RC-FICTIONAL',organization_id:args.p_organization_id,receipt_date:args.p_date,amount_minor:args.p_amount_minor,method:args.p_method,reference:args.p_reference.replace(/^ +| +$/g,''),deposit_account_id:args.p_deposit_account_id,journal_entry_id:'journal',created_by:'actor',voided_at:null});
async function fixture(){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 for(const name of ['organization','date','amount','method','deposit','reference'])Object.defineProperty(prototype,name,{get(){return this.elements[name]}});
 Object.defineProperty(prototype,'readOnly',{get(){return 'readonly'in this.attrs}});
 document.body.innerHTML='<main id="content"><button id="booksTransactionBack">Back to register</button><input id="unrelated" value="keep"><div id="booksBody"></div></main>';
 const calls=[],messages=[],session={user_id:'actor'};let ids=0;
 const c=vm.createContext({document,busy:false,me:session,view:'books',$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),crypto:{randomUUID:()=>`request-${++ids}`},message:(...args)=>messages.push(args),organizations:[{id:'customer',name:'Fictional clinic'},{id:'other',name:'Other fictional clinic'}],salesOrganizationOptions:()=>'<option value="customer">Fictional clinic</option><option value="other">Other fictional clinic</option>'});
 for(const name of ['client-rules.js','sales-domain.js','accounting-ledger.js'])vm.runInContext(source(name),c);
 vm.runInContext(runSource,c);const actualRun=c.run;c.run=(...args)=>c.running=actualRun(...args);
 c.data={today:'2026-10-29',accounts:[{id:'bank',code:'1200',name:'Bank',account_type:'asset',system_key:'bank',active:true}],invoices:[{id:'first',invoice_number:'INV-FIRST',organization_id:'customer',due_date:'2026-10-20',outstanding:10000},{id:'second',invoice_number:'INV-SECOND',organization_id:'customer',due_date:'2026-10-22',outstanding:20000}],receipts:[],allocations:[]};
 const get=code=>vm.runInContext(code,c),node=selector=>document.querySelector(selector);get("booksSection='receipts';booksTransactionSelected='new';booksData=data;booksEpoch=10;booksDraft={retained:true}");
 const f={c,document,session,calls,messages,get,node,ids:()=>ids,write:async args=>({data:saved(args)})};
 c.client={rpc:async(name,args)=>{calls.push({name,args:plain(args)});assert.equal(name,'record_receipt');return f.write(args)}};
 const current=()=>c.me===session&&c.view==='books'&&get("booksEpoch===10&&booksSection==='receipts'");await c.booksReceipts('actor',current);
 f.form=node('#booksReceiptForm');f.summary=node('#booksReceiptErrors');f.input=name=>f.form.elements[name];f.allocations=()=>[...f.form.querySelectorAll('[data-books-allocate]')];f.blur=dispatchFocusout;
 f.change=id=>{f.input('organization').value=id;f.input('organization').onchange()};f.change('customer');f.input('amount').value='100.25';f.input('reference').value=' REF ';
 f.submit=()=>{c.running=null;f.form.onsubmit({preventDefault(){}});return c.running};
 f.replace=kind=>{if(kind==='actor')c.me={...session};else if(kind==='route')c.view='personal';else if(kind==='epoch')get('booksEpoch++');else if(kind==='data')get('booksData={}');else f.form.remove()};
 return f;
}
const error=control=>control.closest('label').querySelector('.field-error')?.textContent||'';
test('receipt required fields and optional allocations have labels, error hosts and a top summary',async()=>{
 const f=await fixture();assert.equal(f.form.firstElementChild,f.summary);assert.equal(f.summary.getAttribute('role'),'alert');assert.equal(f.form.noValidate,true);
 for(const name of ['organization','date','amount','deposit'])assert.match(f.input(name).closest('label').textContent,/required/);
 assert.match(f.input('reference').closest('label').textContent,/optional/);for(const input of f.allocations()){assert.match(input.closest('label').textContent,/Apply \(TZS\) · optional/);assert.match(input.getAttribute('aria-label'),/INV-/);assert.ok(input.getAttribute('aria-label').includes(input.closest('label').querySelector('span').textContent))}
});
test('native focusout validates only the departed control, retains help, and does not move focus',async()=>{
 const f=await fixture(),amount=f.input('amount');amount.value=' ';amount.setAttribute('aria-describedby','amount-help');f.input('reference').value='x'.repeat(121);f.input('date').focus();f.blur(amount);
 assert.equal(f.document.activeElement,f.input('date'));assert.match(error(amount),/Complete this field/);assert.equal(error(f.input('reference')),'');assert.equal(f.summary.textContent,'1 field needs attention');assert.match(amount.getAttribute('aria-describedby'),/^amount-help field-error-/);
 amount.value='100.25';f.blur(amount);assert.equal(error(amount),'');assert.equal(amount.getAttribute('aria-describedby'),'amount-help');assert.equal(amount.getAttribute('aria-invalid'),null);assert.equal(f.summary.textContent,'');assert.equal(f.calls.length,0);
});
test('submit publishes all field counts before DOM-first focus and blocks dispatch',async()=>{
 const f=await fixture();f.input('date').value='';f.input('amount').value='-1';f.input('deposit').value='';f.input('reference').value='x'.repeat(121);f.allocations()[0].value='1.234';
 const focus=f.input('date').focus;f.input('date').focus=function(...args){assert.equal(f.summary.textContent,'5 fields need attention');return focus.apply(this,args)};
 await f.submit();assert.equal(f.document.activeElement,f.input('date'));assert.deepEqual(plain(f.input('date').scrolledIntoView),{block:'center',behavior:'instant'});assert.equal(f.summary.textContent,'5 fields need attention');assert.equal(f.calls.length,0);assert.deepEqual(f.messages,[]);assert.equal(f.ids(),1);
});
test('native required, supplied browser errors, custom errors and reference length retain priority',async()=>{
 const f=await fixture();f.change('');await f.submit();assert.equal(f.document.activeElement,f.input('organization'));assert.match(error(f.input('organization')),/Complete this field/);f.change('customer');f.blur(f.input('organization'));assert.equal(error(f.input('organization')),'');
 f.input('date')._nativeError='Enter a valid date';f.blur(f.input('date'));assert.match(error(f.input('date')),/Enter a valid date/);
 f.input('amount').value='-1';f.input('amount').setCustomValidity('Amount needs review');f.blur(f.input('amount'));assert.match(error(f.input('amount')),/Amount needs review/);
 f.input('reference').value='x'.repeat(121);f.blur(f.input('reference'));assert.match(error(f.input('reference')),/120/);assert.equal(f.calls.length,0);
});
test('amount blur uses the existing exact minor-unit parser and nonzero posting rule',async()=>{
 const f=await fixture();for(const value of ['0','0.00','-1','1.234','1e2','1,000','90071992547409.92']){f.input('amount').value=value;f.blur(f.input('amount'));assert.ok(error(f.input('amount')),value);await f.submit();assert.equal(f.calls.length,0)}
 f.input('amount').value='0.01';f.blur(f.input('amount'));assert.equal(error(f.input('amount')),'');assert.equal(f.summary.textContent,'');await f.submit();assert.equal(f.calls[0].args.p_amount_minor,1);
});
test('allocation parsing stays field-local and excess total targets the first crossing allocation',async()=>{
 const f=await fixture(),[first,second]=f.allocations();first.value='40';second.value='1.234';f.blur(second);assert.match(error(second),/no more than two decimal places/);assert.equal(error(first),'');assert.equal(f.summary.textContent,'1 field needs attention');await f.submit();assert.equal(f.calls.length,0);
 second.value='60.26';f.blur(second);assert.match(error(second),/add up to more than/);assert.equal(error(first),'');assert.match(f.node('#booksReceiptCheck').textContent,/add up to more than/);await f.submit();assert.equal(f.document.activeElement,second);assert.equal(f.calls.length,0);
 second.value='60.25';f.blur(second);assert.equal(error(second),'');assert.equal(f.summary.textContent,'');assert.match(f.node('#booksReceiptCheck').textContent,/left as customer credit/);
});
test('zero and blank allocations remain valid while malformed separate controls count separately',async()=>{
 const f=await fixture(),[first,second]=f.allocations();first.value='-1';second.value='bad';await f.submit();assert.equal(f.summary.textContent,'2 fields need attention');assert.equal(f.document.activeElement,first);assert.equal(f.calls.length,0);
 first.value='0';second.value='';await f.submit();assert.equal(f.summary.textContent,'');assert.deepEqual(f.calls[0].args.p_allocations,[{invoice_id:'first',amount_minor:0}]);
});
test('replacing customer allocation rows drops detached errors and retains the receipt header values',async()=>{
 const f=await fixture(),old=f.allocations()[0];old.value='bad';f.blur(old);assert.equal(f.summary.textContent,'1 field needs attention');f.change('other');assert.equal(old.isConnected,false);assert.equal(f.summary.textContent,'');assert.equal(f.allocations().length,0);assert.equal(f.input('amount').value,'100.25');assert.equal(f.input('reference').value,' REF ');assert.match(f.node('#booksAllocation').textContent,/customer credit/);
 await f.submit();assert.deepEqual(f.calls[0].args.p_allocations,[]);assert.equal(f.calls[0].args.p_organization_id,'other');
});
test('oldest-first preserves exact arithmetic and clears errors on corrected allocation controls',async()=>{
 const f=await fixture();f.input('amount').value='150.25';f.allocations()[0].value='bad';f.blur(f.allocations()[0]);f.node('#booksOldestFirst').onclick();assert.deepEqual(f.allocations().map(input=>input.value),['100.00','50.25']);assert.equal(f.summary.textContent,'');assert.equal(error(f.allocations()[0]),'');
 await f.submit();assert.deepEqual(f.calls[0].args.p_allocations,[{invoice_id:'first',amount_minor:10000},{invoice_id:'second',amount_minor:5025}]);assert.equal(f.calls[0].args.p_amount_minor,15025);
});
test('actual run preserves the exact receipt request, duplicate lock, form identity and saved confirmation',async()=>{
 const f=await fixture(),wait=deferred(),form=f.form,draft=f.get('booksDraft'),data=f.get('booksData');f.allocations()[0].value='50.10';f.write=()=>wait.promise;const posting=f.submit();assert.equal(form.inert,true);await f.submit();f.input('reference').value='';f.blur(f.input('reference'));assert.equal(f.summary.textContent,'');assert.equal(f.calls.length,1);
 const args={p_id:'request-1',p_organization_id:'customer',p_date:'2026-10-29',p_amount_minor:10025,p_method:'bank',p_reference:' REF ',p_deposit_account_id:'bank',p_allocations:[{invoice_id:'first',amount_minor:5010}]};assert.deepEqual(f.calls[0].args,args);wait.resolve({data:saved(args)});await posting;
 assert.equal(f.node('#booksReceiptForm'),form);assert.equal(form.inert,true);assert.equal(form.getAttribute('aria-disabled'),'true');assert.ok(f.node('[data-books-posted-open]'));assert.equal(f.get('booksDraft'),draft);assert.equal(f.get('booksData'),data);assert.equal(f.get('booksTransactionSelected'),'new');await f.submit();assert.equal(f.calls.length,1);
});
test('rejected posting keeps editing and uses the original request identity on a valid retry',async()=>{
 const f=await fixture();f.write=async()=>({error:{message:'Receipt rejected'}});await f.submit();assert.equal(f.form.inert,false);assert.equal(f.node('[data-books-posted]'),null);assert.match(f.messages[0][0],/Receipt rejected/);f.input('amount').value='';await f.submit();assert.equal(f.calls.length,1);f.input('amount').value='100.25';f.write=async args=>({data:saved(args)});await f.submit();assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.ids(),1);assert.ok(f.node('[data-books-posted-open]'));
});
test('incomplete success remains committed with read-only saved-detail verification',async()=>{
 const f=await fixture();f.write=async()=>({data:{id:'wrong'}});await f.submit();assert.equal(f.form.inert,true);assert.ok(f.node('[data-books-posted-retry]'));assert.equal(f.node('[data-books-posted-open]'),null);f.input('amount').value='';f.blur(f.input('amount'));await f.submit();assert.equal(f.summary.textContent,'');assert.equal(f.calls.length,1);
});
test('stale actor, route, epoch, data and disconnected form suppress blur, submission and late feedback',async()=>{
 for(const change of ['actor','route','epoch','data','detach']){
  const f=await fixture();f.replace(change);f.input('amount').value='';f.blur(f.input('amount'));await f.submit();assert.equal(f.summary.textContent,'');assert.equal(f.calls.length,0);
  for(const reject of [false,true]){const g=await fixture(),wait=deferred();g.write=()=>wait.promise;const posting=g.submit();g.replace(change);g.input('amount').value='';g.blur(g.input('amount'));if(reject)wait.reject(Error('Old failure'));else wait.resolve({data:saved(g.calls[0].args)});await posting;assert.equal(g.summary.textContent,'');assert.equal(g.node('[data-books-posted]'),null);assert.deepEqual(g.messages,[]);assert.equal(g.form.inert,true);}
 }
});

function dispatchCorrectionChange(control){
 const event=new Event('change',{bubbles:true});Object.defineProperty(event,'target',{value:control});
 for(let node=control;node;node=node.parentElement){Object.defineProperty(event,'currentTarget',{configurable:true,value:node});node.onchange?.call(node,event);for(const {fn}of [...(node.events.change||[])])fn.call(node,event);}
}

test('receipt correction followed by action blur preserves layout until submit',async()=>{
 const f=await fixture(),input=f.input('amount'),button=f.form.querySelector('[type="submit"]');input.value='';f.blur(input);assert.equal(f.summary.textContent,'1 field needs attention');const errorNode=input.closest('label').querySelector('.field-error');input.value='100.25';const html=f.form.innerHTML;
 dispatchCorrectionChange(input);button.focus();f.blur(input,button);assert.equal(f.form.innerHTML,html);assert.equal(input.closest('label').querySelector('.field-error'),errorNode);assert.equal(f.document.activeElement,button);assert.equal(f.calls.length,0);
 await f.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_amount_minor,10025);assert.equal(error(input),'');
});
test('receipt action blur still requires valid fields on submit',async()=>{
 const f=await fixture(),input=f.input('amount');input.value='';f.blur(input,f.form.querySelector('[type="submit"]'));assert.equal(f.summary.textContent,'');await f.submit();assert.equal(f.calls.length,0);assert.equal(f.document.activeElement,input);assert.ok(error(input));
});
