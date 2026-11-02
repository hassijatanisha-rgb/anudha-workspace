import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const day='2026-11-02',deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};
async function fixture(mode='apply'){
 const document=dom();installNativeFormControls(document);document.body.innerHTML='<main id="content"><div id="booksBody"></div></main>';
 const actor={user_id:'actor'},calls=[],customer={id:'customer',name:'Clinic <img src=x onerror=unsafe()>'},accounts=[{id:'bank',code:'1200',name:'Bank',active:true,account_type:'asset',system_key:'bank'}];let n=0;
 const a={id:'application',organization_id:'customer',source_receipt_id:'receipt',source_invoice_id:null,source_opening_credit_id:null,invoice_id:'invoice',application_date:day,amount_minor:'1000',reverses_application_id:null,reason:''};
 const r={id:'refund',organization_id:'customer',source_receipt_id:'receipt',source_invoice_id:null,source_opening_credit_id:null,refund_date:day,amount_minor:'2000',refund_number:'RF-1',payout_account_id:'bank',method:'bank',reference:'Paid back',journal_entry_id:'journal',voided_at:null};
 const data={as_of:day,sources:[{source_type:'receipt',source_id:'receipt',reference:'RCT-1 <script>unsafe()</script>',date:day,available_minor:'10000'}],invoices:[{id:'invoice',invoice_number:'INV-1',invoice_date:day,outstanding_minor:'8000'}],applications:[a],refunds:[r],return_credits:[{id:'returned-credit',invoice_id:'invoice',invoice_number:'INV-1',credit_number:'CN-1',credit_date:day,net_minor:'1000',tax_minor:'180',total_minor:'1180',voided_at:mode==='return-repost'?day+'T09:00:00Z':null,replaces_credit_id:null}]};
 const c=vm.createContext({document,busy:false,me:actor,view:'books',$:s=>document.querySelector(s),esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),crypto:{randomUUID:()=>`request-${++n}`},message(){}});
 for(const file of ['client-rules.js','sales-domain.js','accounting-ledger.js','books-automation.js','customer-credit-settlement.js'])vm.runInContext(source(file),c);
 const app=source('app.js');vm.runInContext(app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),c);
 c.booksToday=()=>day;c.initial={today:day,accounts,settings:{version:1,locked_through:null}};const get=code=>vm.runInContext(code,c);get("booksData=initial;booksSection='credits';booksEpoch=10");
 const actualRun=c.run;c.run=(...args)=>c.running=actualRun(...args);
 const f={c,data,document,get,calls,node:selector=>document.querySelector(selector)};
 f.saved=(name,args)=>{
  const base={id:args.p_id,organization_id:'customer',source_receipt_id:args.p_source_receipt_id,source_invoice_id:args.p_source_invoice_id,source_opening_credit_id:args.p_source_opening_credit_id,amount_minor:args.p_amount_minor};
  if(name==='apply_customer_credit')return {...base,invoice_id:args.p_invoice_id,application_date:args.p_date,reverses_application_id:null};
  if(name==='refund_customer_credit')return {...base,refund_date:args.p_date,payout_account_id:args.p_payout_account_id,method:args.p_method,reference:args.p_reference,refund_number:'RF-SAVED',journal_entry_id:'journal'};
  if(name==='reverse_customer_credit_application')return {...a,id:args.p_id,reverses_application_id:args.p_application_id,application_date:args.p_date,reason:args.p_reason};
  if(name==='void_customer_refund')return {...r,voided_at:day+'T10:00:00Z',void_reason:args.p_reason,void_date:args.p_date,void_entry_id:'reversal'};
  if(name==='void_return_credit_note')return {...data.return_credits[0],voided_at:day+'T10:00:00Z',void_entry_id:'return-reversal',void_reason:args.p_reason,void_date:args.p_date};
  if(name==='repost_return_credit_note')return {...data.return_credits[0],id:args.p_id,replaces_credit_id:args.p_credit_id,credit_date:args.p_date,credit_number:'CN-2',journal_entry_id:'replacement',voided_at:null};
  throw Error('Unexpected write '+name);
 };
 f.write=async(name,args)=>({data:f.saved(name,args)});
 c.client={rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='acc_customer_credit_sources')return {data};return f.write(name,args);}};
 const current=()=>c.me===actor&&c.view==='books'&&get('booksEpoch===10');await c.customerCreditWorkspace('actor',current,customer);
 f.click=async selector=>{c.running=null;const response=f.node(selector).onclick();await(response||c.running);};
 if(mode!=='register')await f.click({apply:'[data-credit-apply]',refund:'[data-credit-refund]',reverse:'[data-credit-reverse]',void:'[data-refund-void]','return-void':'[data-return-credit-void]','return-repost':'[data-return-credit-repost]'}[mode]);
 f.form=f.node('[data-books-automation-form]');f.field=name=>f.form.elements[name];f.summary=f.form?.querySelector('[role="alert"]');f.writes=()=>calls.filter(r=>r.name!=='acc_customer_credit_sources');
 f.submit=()=>{c.running=null;const response=f.form.onsubmit({preventDefault(){}});return response||c.running;};
 f.valid=()=>{if(mode==='apply'){f.field('amount').value='25.10';f.field('invoice').value='invoice';}else if(mode==='refund'){f.field('amount').value='25.10';f.field('account').value='bank';f.field('method').value='bank';f.field('reference').value='  Bank refund  ';}else if(mode!=='return-repost')f.field('reason').value='  Correct settlement  ';};
 return f;
}
for(const mode of ['apply','refund','reverse','void'])test(`customer credit ${mode}: actual form posts once with exact request and keeps confirmed details locked`,async()=>{
 const f=await fixture(mode);f.valid();const wait=deferred();f.write=()=>wait.promise;const pending=f.submit();await f.submit();assert.equal(f.writes().length,1);assert.equal(f.form.inert,true);
 const {name,args}=f.writes()[0];assert.equal(args.p_date,day);
 if(mode==='apply'||mode==='refund'){assert.equal(args.p_amount_minor,'2510');assert.equal(args.p_source_receipt_id,'receipt');assert.equal(args.p_source_invoice_id,null);assert.equal(args.p_source_opening_credit_id,null);}
 if(mode==='apply')assert.equal(args.p_invoice_id,'invoice');if(mode==='refund'){assert.equal(args.p_reference,'Bank refund');assert.equal(args.p_payout_account_id,'bank');}
 if(mode==='reverse'){assert.equal(args.p_application_id,'application');assert.equal(args.p_reason,'Correct settlement');}if(mode==='void')assert.equal(args.p_refund_id,'refund');
 wait.resolve({data:f.saved(name,args)});await pending;assert.equal(f.node('[data-books-posting-retry]'),null);assert.match(f.form.nextElementSibling.textContent,/Open saved details/);await f.submit();assert.equal(f.writes().length,1);
});
for(const mode of ['apply','refund','reverse','void'])test(`customer credit ${mode}: lost response retries its original immutable request`,async()=>{
 const f=await fixture(mode);f.valid();f.write=async()=>{throw Error('Lost response');};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
 if(f.field('amount'))f.field('amount').value='99.99';if(f.field('reason'))f.field('reason').value='Different reason';await f.submit();assert.equal(f.writes().length,1);
 f.write=async(name,args)=>({data:f.saved(name,args)});await f.click('[data-books-posting-retry]');assert.deepEqual(f.writes()[1],f.writes()[0]);assert.equal(f.node('[data-books-posting-retry]'),null);
});
test('credit target/source bounds and invalid decimal amounts fail before posting',async()=>{
 const f=await fixture('apply');f.valid();for(const value of ['100.01','80.01','1.234']){f.field('amount').value=value;await f.submit();assert.equal(f.writes().length,0);}assert.equal(f.field('amount').getAttribute('aria-invalid'),'true');
 const r=await fixture('refund');r.valid();r.field('amount').value='100.01';await r.submit();assert.equal(r.writes().length,0);assert.match(r.summary.textContent,/exceeds/);
});
test('source text is escaped and large balances retain their exact displayed cents',async()=>{
 const f=await fixture('register');assert.equal(f.node('script'),null);assert.equal(f.node('img'),null);assert.match(f.node('#booksBody').textContent,/<script>unsafe/);
 f.data.sources[0].available_minor='9007199254740993';await f.click('[data-credit-refresh]');assert.match(f.node('#booksBody').textContent,/90,071,992,547,409\.93/);
});
test('a different saved amount stays uncertain and stale sessions cannot post',async()=>{
 const f=await fixture('apply');f.valid();f.write=async(name,args)=>({data:{...f.saved(name,args),amount_minor:'2511'}});await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
 const g=await fixture('refund');g.valid();g.c.me={user_id:'other'};await g.submit();assert.equal(g.writes().length,0);
});

for(const mode of ['return-void','return-repost'])test(`returned-goods ${mode}: correction posts exact original amounts and retains its retry identity`,async()=>{
 const f=await fixture(mode);f.valid();f.write=async()=>{throw Error('Lost correction response');};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));const first=f.writes()[0];assert.equal(first.args.p_credit_id,'returned-credit');assert.equal(first.args.p_date,day);
 if(mode==='return-void')assert.equal(first.args.p_reason,'Correct settlement');else{assert.equal(first.name,'repost_return_credit_note');assert.equal(Object.hasOwn(first.args,'p_amount_minor'),false);}
 f.write=async(name,args)=>({data:f.saved(name,args)});await f.click('[data-books-posting-retry]');assert.deepEqual(f.writes()[1],first);assert.equal(f.node('[data-books-posting-retry]'),null);assert.match(f.form.nextElementSibling.textContent,/Open saved details/);
});
test('a replacement return-credit response with changed original amounts remains unconfirmed',async()=>{
 const f=await fixture('return-repost');f.valid();f.write=async(name,args)=>({data:{...f.saved(name,args),net_minor:'999'}});await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
});
test('application reversal confirms the original source, customer, target and exact amount',async()=>{
 for(const changed of [{source_receipt_id:'other'},{source_invoice_id:'other'},{organization_id:'other'},{invoice_id:'other'},{amount_minor:'1001'}]){
  const f=await fixture('reverse');f.valid();f.write=async(name,args)=>({data:{...f.saved(name,args),...changed}});await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
  f.write=async(name,args)=>({data:f.saved(name,args)});await f.click('[data-books-posting-retry]');assert.deepEqual(f.writes()[1],f.writes()[0]);assert.equal(f.node('[data-books-posting-retry]'),null);
 }
});
test('refund and returned-credit voids require the exact accounting date and original amounts',async()=>{
 for(const [mode,changed] of [['void',{void_date:'2026-11-03'}],['void',{amount_minor:'2001'}],['return-void',{void_date:'2026-11-03'}],['return-void',{net_minor:'1001',tax_minor:'179'}]]){
  const f=await fixture(mode);f.valid();f.write=async(name,args)=>({data:{...f.saved(name,args),...changed}});await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
  f.write=async(name,args)=>({data:f.saved(name,args)});await f.click('[data-books-posting-retry]');assert.deepEqual(f.writes()[1],f.writes()[0]);assert.equal(f.node('[data-books-posting-retry]'),null);
 }
});
