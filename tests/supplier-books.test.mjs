import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};
const day='2026-11-02';
async function fixture(kind='payment',prepare=()=>{}){
 const document=dom();installNativeFormControls(document);
 document.body.innerHTML='<main id="content"><input id="unrelated" value="keep"><div id="booksBody"></div></main>';
 const actor={user_id:'actor'},calls=[],messages=[],accounts=[{id:'bank',code:'1200',name:'Bank',active:true,account_type:'asset',system_key:'bank'},{id:'rent',code:'6100',name:'Rent',active:true,account_type:'expense',system_key:null},{id:'stock',code:'1400',name:'Inventory',active:true,account_type:'asset',system_key:'inventory'}];let sequence=0;
 const b={id:'bill',supplier_id:'supplier',bill_number:'BILL-1',bill_date:day,due_date:day,reference:'Supplier invoice <script>unsafe</script>',purchase_order_id:null,net_minor:'10000',tax_minor:'1800',total_minor:'11800',paid_minor:'0',credited_minor:'0',outstanding_minor:'11800',status_key:'open',voided_on:null,opening_import_id:null,lines:[{account_id:'rent',net_minor:'10000',tax_minor:'1800',description:'Office <img src="x" onerror="unsafe()">',product_id:null,stock_receipt_id:null,stock_quantity:null}]};
 const p={id:'advance',supplier_id:'supplier',payment_number:'PAY-1',payment_date:day,amount_minor:'10000',unapplied_minor:'10000',reference:'Advance',method:'bank',payment_account_id:'bank',requested_allocations:[],voided_on:null};
 const data={as_of:day,suppliers:[{id:'supplier',name:'Vendor <img src=x onerror=unsafe()>',supplier_number:'SUP-1',active:true}],accounts,bills:[b],payments:[p],credits:[],refunds:[],allocations:[],ageing:[],opening_imports:[],opening_gl_imports:[],summary:{balance_minor:'1800',unapplied_credit_minor:'10000',control_payables_minor:'1800',difference_minor:'0',reconciled:true}};
 const c=vm.createContext({document,busy:false,me:actor,view:'books',$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),crypto:{randomUUID:()=>`request-${++sequence}`},message:(...args)=>messages.push(args),organizations:[]});
 for(const file of ['client-rules.js','sales-domain.js','accounting-ledger.js','books-automation.js','supplier-books.js'])vm.runInContext(source(file),c);
 if(kind.startsWith('opening'))for(const file of ['vendor/xlsx.full.min.js','financial-import.js'])vm.runInContext(source(file),c);
 const app=source('app.js');vm.runInContext(app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),c);
 c.booksToday=()=>day;c.data={today:day,accounts,settings:{version:1,locked_through:null}};
 const get=code=>vm.runInContext(code,c);get("booksData=data;booksSection='suppliers';booksEpoch=10");
 const actualRun=c.run;c.run=(...args)=>c.running=actualRun(...args);
 const f={c,data,calls,messages,document,get,actor,kind,node:selector=>document.querySelector(selector)};
 if(kind.startsWith('opening')){data.opening_gl_imports=[{id:'opening-gl',source:'Reviewed opening GL'}];if(kind==='opening-correction')data.opening_imports=[{id:'old-import',source:'Reviewed source',cutover_date:day,gl_import_id:'opening-gl',result:{opening_residual_minor:'8024'}}];}
 prepare(f);
 const allocationLines=args=>[...args.p_allocations].sort((a,b)=>a.bill_id.localeCompare(b.bill_id));
 f.saved=(name,a)=>{
 const common={id:a.p_id,journal_entry_id:'journal',voided_on:null};
 if(name==='post_supplier_bill'){const net=a.p_lines.reduce((n,l)=>n+BigInt(l.net_minor),0n),tax=a.p_lines.reduce((n,l)=>n+BigInt(l.tax_minor),0n);return {...common,bill_number:'BILL-SAVED',supplier_id:a.p_supplier_id,bill_date:a.p_date,due_date:a.p_due_date,reference:a.p_reference,purchase_order_id:a.p_purchase_order_id,lines:a.p_lines,net_minor:String(net),tax_minor:String(tax),total_minor:String(net+tax)};}
 if(name==='post_supplier_payment')return {...common,payment_number:'PAY-SAVED',supplier_id:a.p_supplier_id,payment_date:a.p_date,amount_minor:a.p_amount_minor,method:a.p_method,reference:a.p_reference,payment_account_id:a.p_payment_account_id,requested_allocations:allocationLines(a)};
 if(name==='allocate_supplier_payment')return {id:a.p_id,payment_id:a.p_payment_id,allocation_date:a.p_date,lines:allocationLines(a)};
 if(name==='post_supplier_refund')return {...common,refund_number:'REF-SAVED',payment_id:a.p_payment_id,refund_date:a.p_date,amount_minor:a.p_amount_minor,method:a.p_method,reference:a.p_reference,payment_account_id:a.p_payment_account_id};
 if(name==='post_supplier_credit'){const net=a.p_lines.reduce((n,l)=>n+BigInt(l.net_minor),0n),tax=a.p_lines.reduce((n,l)=>n+BigInt(l.tax_minor),0n);return {...common,credit_number:'SCN-SAVED',bill_id:a.p_bill_id,credit_date:a.p_date,reference:a.p_reference,reason:a.p_reason,lines:a.p_lines.map(l=>({...l,stock_return_id:null})),net_minor:String(net),tax_minor:String(tax),total_minor:String(net+tax)};}
 if(name==='void_supplier_payment')return {...p,voided_on:a.p_date,voided_at:day+'T10:00:00Z',void_reason:a.p_reason,void_entry_id:'reverse'};
 if(name==='opening_payables_check'||name==='import_opening_payables'||name==='correct_opening_payables'){const result={gl_import_id:a.p_gl_import_id||'opening-gl',cutover_date:a.p_cutover||day,reconciled:true,opening_residual_minor:String(a.p_rows.reduce((sum,row)=>sum+BigInt(row.amount_minor),0n)),difference_minor:'0',row_count:a.p_rows.length};if(name!=='opening_payables_check')Object.assign(result,{batch_id:a.p_id,imported_count:a.p_rows.length,bills:a.p_rows.filter(row=>BigInt(row.amount_minor)>0n).map((row,i)=>({bill_id:'opening-bill-'+i,reference:row.reference})),payments:a.p_rows.filter(row=>BigInt(row.amount_minor)<0n).map((row,i)=>({payment_id:'opening-payment-'+i,reference:row.reference}))});return result;}
 throw Error('Unexpected write '+name);
 };
 f.write=async(name,args)=>({data:f.saved(name,args)});
 c.client={rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='get_supplier_books_page')return {data};if(name==='inventory_cost_status')return {data:{receipts:[]}};return f.write(name,args);}};
 const current=()=>c.me===actor&&c.view==='books'&&get('booksEpoch===10');await c.supplierBooksWorkspace('actor',current,{supplier:'supplier',tab:'bills',date:day});
 f.click=async selector=>{c.running=null;const result=f.node(selector).onclick();await(result||c.running);};
 if(kind==='bill'||kind==='payment')await f.click(`[data-supplier-new="${kind}"]`);
 else if(kind==='credit'){await f.click('[data-supplier-bill]');await f.click('[data-supplier-credit]');}
 else if(kind.startsWith('opening')){await f.click('[data-supplier-tab="opening"]');await f.click(kind==='opening-correction'?'[data-supplier-opening-correct]':'[data-supplier-opening]');}
 else if(kind!=='register'){await f.click('[data-supplier-tab="payments"]');await f.click(kind==='advance'?'[data-supplier-allocate]':kind==='refund'?'[data-supplier-refund]':'[data-supplier-void="payment"]');}
 f.form=f.node('[data-books-automation-form]');if(f.form)f.form.reportValidity=()=>true;f.field=name=>f.form.elements[name];f.summary=f.form?.querySelector('[role="alert"]');f.writes=()=>calls.filter(row=>!['get_supplier_books_page','inventory_cost_status','opening_payables_check'].includes(row.name));
 f.submit=()=>{c.running=null;const result=f.form.onsubmit({preventDefault(){}});return result||c.running;};
 f.valid=()=>{
 if(kind==='bill'){f.field('supplier').value='supplier';f.field('reference').value=' BILL-REF ';const line=f.node('[data-bill-line]');line.querySelector('[name="account"]').value='rent';line.querySelector('[name="net"]').value='100.25';line.querySelector('[name="tax"]').value='18.05';}
 else if(kind==='payment'){f.field('supplier').value='supplier';f.field('supplier').onchange();f.field('amount').value='100.25';f.field('account').value='bank';f.field('method').value='bank';f.field('reference').value=' PAYMENT-REF ';f.node('[data-supplier-allocation]').value='25.10';}
 else if(kind==='advance')f.node('[data-supplier-allocation]').value='25.10';
 else if(kind==='refund'){f.field('amount').value='10.01';f.field('account').value='bank';f.field('method').value='bank';f.field('reference').value=' REFUND-REF ';}
 else if(kind==='credit'){f.field('reference').value=' CREDIT-REF ';f.field('reason').value=' Reviewed correction ';const line=f.node('[data-supplier-credit-line]');line.querySelector('[name="net"]').value='10.01';line.querySelector('[name="tax"]').value='1.80';}
 else if(kind==='void')f.field('reason').value=' Reviewed correction ';
 };
 f.openingFile=async(rows=[['OPEN-BILL','supplier',day,day,'100.25','TZS'],['OPEN-ADVANCE','supplier',day,day,'-20.01','TZS']])=>{f.field('source').value='Reviewed source';f.field('cutover').value=day;f.field('gl').value='opening-gl';if(f.field('reason'))f.field('reason').value='Reviewed correction';const csv=[['Reference','Supplier UUID','Bill Date','Due Date','Residual Amount','Currency'],...rows].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\n');f.field('file').files=[{name:'supplier-opening.csv',size:csv.length,text:async()=>csv}];f.field('file').value='supplier-opening.csv';await f.field('file').onchange();};
 return f;
}
for(const kind of ['bill','payment','advance','refund','credit','void'])test(`supplier ${kind}: actual form sends exact money and server arguments once, then locks confirmed record`,async()=>{
 const f=await fixture(kind);f.valid();const wait=deferred();f.write=()=>wait.promise;const pending=f.submit();await f.submit();assert.equal(f.writes().length,1);assert.equal(f.form.inert,true);
 const {name,args}=f.writes()[0];assert.equal(args.p_date,day);
 if(kind==='bill'){assert.equal(name,'post_supplier_bill');assert.equal(args.p_lines[0].net_minor,'10025');assert.equal(args.p_lines[0].tax_minor,'1805');assert.equal(args.p_purchase_order_id,null);assert.equal(args.p_reference,'BILL-REF');}
 if(kind==='payment'){assert.equal(name,'post_supplier_payment');assert.equal(args.p_amount_minor,'10025');assert.deepEqual(args.p_allocations,[{bill_id:'bill',amount_minor:'2510'}]);}
 if(kind==='advance'){assert.equal(name,'allocate_supplier_payment');assert.deepEqual(args.p_allocations,[{bill_id:'bill',amount_minor:'2510'}]);assert.equal(args.p_payment_id,'advance');}
 if(kind==='refund'){assert.equal(name,'post_supplier_refund');assert.equal(args.p_amount_minor,'1001');assert.equal(args.p_payment_id,'advance');}
 if(kind==='credit'){assert.equal(name,'post_supplier_credit');assert.deepEqual(args.p_lines,[{line_no:1,net_minor:'1001',tax_minor:'180'}]);assert.equal(args.p_reason,'Reviewed correction');}
 if(kind==='void'){assert.equal(name,'void_supplier_payment');assert.equal(args.p_payment_id,'advance');assert.equal(args.p_reason,'Reviewed correction');}
 wait.resolve({data:f.saved(name,args)});await pending;assert.equal(f.node('[data-books-posting-retry]'),null);assert.match(f.form.nextElementSibling.textContent,/Open saved details/);await f.submit();assert.equal(f.writes().length,1);
});
for(const kind of ['bill','payment','advance','refund','credit'])test(`supplier ${kind}: lost response retains immutable request and retry identity`,async()=>{
 const f=await fixture(kind);f.valid();f.write=async()=>{throw Error('Network response lost');};await f.submit();assert.equal(f.form.inert,true);assert.ok(f.node('[data-books-posting-retry]'));
 if(f.field('amount'))f.field('amount').value='99.99';if(f.field('reference'))f.field('reference').value='Mutated after send';await f.submit();assert.equal(f.writes().length,1);
 f.write=async(name,args)=>({data:f.saved(name,args)});await f.click('[data-books-posting-retry]');assert.equal(f.writes().length,2);assert.deepEqual(f.writes()[1],f.writes()[0]);assert.equal(f.node('[data-books-posting-retry]'),null);assert.match(f.form.nextElementSibling.textContent,/Open saved details/);
});
test('supplier payment supports entirely unapplied advances and rejects excess applications before sending',async()=>{
 const f=await fixture();f.valid();f.node('[data-supplier-allocation]').value='100.26';await f.submit();assert.equal(f.writes().length,0);assert.match(f.summary.textContent,/exceed/);
 f.node('[data-supplier-allocation]').value='';await f.submit();assert.deepEqual(f.writes()[0].args.p_allocations,[]);assert.equal(f.writes()[0].args.p_amount_minor,'10025');
});
test('supplier refund rejects money above the remaining advance and invalid decimal input',async()=>{
 const f=await fixture('refund');f.valid();f.field('amount').value='100.01';await f.submit();assert.equal(f.writes().length,0);assert.match(f.summary.textContent,/exceeds/);
 f.field('amount').value='1.234';await f.submit();assert.equal(f.writes().length,0);assert.ok(f.field('amount').getAttribute('aria-invalid'));
});
test('supplier bill rejects zero net and empty lines without posting',async()=>{
 const f=await fixture('bill');f.valid();f.node('[name="net"]').value='0';await f.submit();assert.equal(f.writes().length,0);assert.match(f.summary.textContent,/above zero/);
 await f.click('[data-remove-line]');await f.submit();assert.equal(f.writes().length,0);assert.match(f.summary.textContent,/at least one/);
});
test('supplier names, references and line descriptions render as text without executable HTML',async()=>{
 const f=await fixture('register');assert.equal(f.node('#booksBody').querySelector('script'),null);assert.equal(f.node('#booksBody').querySelector('img'),null);assert.match(f.node('#booksBody').textContent,/<img src=x onerror=unsafe\(\)>/);
 await f.click('[data-supplier-bill]');assert.equal(f.node('#booksBody').querySelector('script'),null);assert.equal(f.node('#booksBody').querySelector('img'),null);assert.match(f.node('#booksBody').textContent,/Office <img/);
});
test('supplier forms ignore detached and changed session contexts, including late successful responses',async()=>{
 for(const kind of ['bill','payment','advance','refund','credit']){
 const f=await fixture(kind);f.valid();f.c.me={user_id:'other'};await f.submit();assert.equal(f.writes().length,0);
 const g=await fixture(kind);g.valid();const wait=deferred();g.write=()=>wait.promise;const pending=g.submit();g.form.remove();const {name,args}=g.writes()[0];wait.resolve({data:g.saved(name,args)});await pending;assert.equal(g.node('[data-books-posting-retry]'),null);assert.equal(g.form.nextElementSibling,null);
 }
});
for(const kind of ['payment','advance','credit'])test(`supplier ${kind}: a success response with different financial lines stays uncertain`,async()=>{
 const f=await fixture(kind);f.valid();f.write=async(name,args)=>{const result=f.saved(name,args);if(kind==='payment')result.requested_allocations=[];else result.lines=[];return {data:result};};await f.submit();assert.ok(f.node('[data-books-posting-retry]'),'different saved financial lines must not confirm');assert.equal(f.form.inert,true);assert.equal(f.writes().length,1);
});
test('supplier correction form enforces the server reason range before dispatch',async()=>{
 const f=await fixture('void');f.valid();assert.equal(f.field('reason').getAttribute('minlength'),'5');assert.equal(f.field('reason').getAttribute('maxlength'),'300');f.field('reason').value='four';await f.submit();assert.equal(f.writes().length,0);
});
for(const field of ['net_minor','tax_minor','total_minor'])test(`supplier bill: mismatched ${field} is not confirmed`,async()=>{
 const f=await fixture('bill');f.valid();f.write=async(name,args)=>({data:{...f.saved(name,args),[field]:'1'}});await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
});
test('mixed supplier bill routes stock returns separately and preserves expense credit line numbers',async()=>{
 const f=await fixture('register',f=>f.data.bills[0].lines.unshift({account_id:'stock',description:'Received stock',net_minor:'5000',tax_minor:'0',product_id:'product',stock_receipt_id:'receipt',stock_quantity:'5'}));let routed;
 f.c.supplierStockReturnForm=(...args)=>{routed=args;};await f.click('[data-supplier-bill]');await f.click('[data-supplier-stock-return]');assert.equal(routed[0],'actor');assert.equal(routed[1](),true);assert.equal(routed[2].id,'bill');assert.equal(routed[3],1);assert.equal(typeof routed[4],'function');
 await f.click('[data-supplier-credit]');assert.equal(f.node('#booksBody').querySelectorAll('[data-supplier-credit-line]').length,1);assert.equal(f.node('[data-supplier-credit-line]').dataset.supplierCreditLine,'2');
});
test('supplier applications subtract only credit releases effective on the report date',async()=>{
 const f=await fixture('register',f=>{f.data.allocations=[{id:'allocation',payment_id:'advance',allocation_date:day,lines:[{bill_id:'bill',amount_minor:'10000'}],voided_on:null}];f.data.credits=[{id:'credit',total_minor:'2500',credit_date:day,voided_on:null}];f.data.credit_releases=[{allocation_id:'allocation',credit_id:'credit',release_date:day,amount_minor:'2500'},{allocation_id:'allocation',credit_id:'credit',release_date:'2026-11-03',amount_minor:'1000'}];});
 await f.click('[data-supplier-tab="payments"]');const rows=()=>f.node('#supplierBooksRows').textContent;assert.match(rows(),/TZS\s75\.00/);assert.match(rows(),/TZS\s25\.00 returned to advance/);
 f.data.credits[0].voided_on=day;await f.click('[data-supplier-tab="payments"]');assert.doesNotMatch(rows(),/returned to advance/);assert.match(rows(),/TZS\s100\.00/);
 f.data.credits[0].voided_on='2026-11-03';await f.click('[data-supplier-tab="payments"]');assert.match(rows(),/TZS\s25\.00 returned to advance/);
 f.data.allocations[0].voided_on=day;await f.click('[data-supplier-tab="payments"]');assert.doesNotMatch(rows(),/returned to advance/);assert.match(rows(),/TZS\s0\.00/);
});
function openingParser(){
 const c=vm.createContext({Intl,Date,Math,Number,String,Map,Set,Array,Object,Error,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder});for(const file of ['vendor/xlsx.full.min.js','sales-domain.js','accounting-ledger.js','financial-import.js','supplier-books.js'])vm.runInContext(source(file),c);
 const parse=(rows,change=()=>{},options={})=>{c.rows=rows;const sheet=vm.runInContext('XLSX.utils.aoa_to_sheet([supplierOpeningHeaders,...rows])',c);change(sheet);return plain(c.supplierOpeningPreview(sheet,[{id:'supplier'}],{cutover:day,...options}));};return {c,parse};
}
test('supplier opening parser retains signed cents, dates and supplier identity with exact large totals',()=>{
 const {parse}=openingParser(),result=parse([['BILL','SUPPLIER','2026-10-01','2026-11-03','100.25','tzs'],['ADVANCE','supplier','2026-10-02','2026-10-02','-20.01','TZS'],['LARGE','supplier','2026-10-02','2026-10-02','90071992547409.91','TZS']]);assert.deepEqual(result.errors,[]);assert.equal(result.totalMinor,'9007199254749015');assert.equal(result.entries[0].supplier_id,'supplier');assert.equal(result.entries[1].amount_minor,'-2001');
 const epoch=parse([['EXCEL','supplier',0,0,'1.00','TZS']],()=>{},{date1904:true});assert.deepEqual(epoch.errors,[]);assert.equal(epoch.entries[0].bill_date,'1904-01-01');
});
test('supplier opening parser rejects formulas even with blank caches, duplicate references, invalid dates and unsafe amounts',()=>{
 const {parse}=openingParser(),base=['BILL','supplier','2026-10-01','2026-11-03','100.25','TZS'];
 for(const [index,value,pattern]of [[1,'unknown',/Supplier UUID/],[2,'2026-02-30',/valid YYYY/],[2,'2026-11-03',/on\/before/],[3,'2026-09-30',/on\/after/],[4,'0',/cannot be zero/],[4,'1.001',/decimal/],[4,10000000000000,/Text cells/],[5,'USD',/TZS/]]){const row=[...base];row[index]=value;assert.match(parse([row]).errors.join(' '),pattern);}
 assert.match(parse([base,base.map((v,i)=>i===0?'bill':v)]).errors.join(' '),/unique reference/);
 assert.match(parse([base],sheet=>sheet.E2={f:'1+1',t:'n',v:2}).errors.join(' '),/formulas/);
 assert.match(parse([['','','','','','']],sheet=>sheet.E2={f:'SUM(A1)',t:'s',v:''}).errors.join(' '),/formulas/);
 assert.match(parse([base],sheet=>sheet.A1={f:'"Reference"',t:'s',v:'Reference'}).errors.join(' '),/headers/);
 assert.match(parse([base],()=>{},{cutover:'2026-02-30'}).errors.join(' '),/valid cutover/);
 assert.match(parse([base],sheet=>sheet['!fullref']='A1:F1002').errors.join(' '),/1,000/);
});
for(const kind of ['opening','opening-correction'])test(`supplier ${kind}: actual CSV review sends exact signed schedule and retains retry identity`,async()=>{
 const f=await fixture(kind);await f.openingFile();assert.equal(f.node('#supplierOpeningCheck').disabled,false);await f.click('#supplierOpeningCheck');assert.equal(f.form.querySelector('[type="submit"]').disabled,false);
 f.write=async()=>{throw Error('Response lost after commit');};await f.submit();assert.equal(f.writes().length,1);const request=f.writes()[0];assert.equal(request.name,kind==='opening'?'import_opening_payables':'correct_opening_payables');assert.deepEqual(request.args.p_rows.map(row=>row.amount_minor),['10025','-2001']);
 if(kind==='opening'){assert.equal(request.args.p_source,'Reviewed source');assert.equal(request.args.p_cutover,day);assert.equal(request.args.p_gl_import_id,'opening-gl');}else{assert.equal(request.args.p_import_id,'old-import');assert.equal(request.args.p_reason,'Reviewed correction');assert.equal(request.args.p_gl_import_id,undefined);}
 f.field('source').value='Changed after posting';f.field('cutover').value='2026-10-01';f.write=async(name,args)=>({data:f.saved(name,args)});await f.click('[data-books-posting-retry]');assert.deepEqual(f.writes()[1],request);assert.equal(f.node('[data-books-posting-retry]'),null);assert.match(f.form.nextElementSibling.textContent,/2 opening balances imported/);
});
test('supplier opening check is invalidated by date edits, reparses the loaded file, and rejects stale check responses',async()=>{
 const f=await fixture('opening');await f.openingFile();await f.click('#supplierOpeningCheck');f.field('cutover').value='2026-11-01';f.field('cutover').onchange();assert.equal(f.form.querySelector('[type="submit"]').disabled,true);assert.equal(f.node('#supplierOpeningCheck').disabled,true);assert.match(f.node('#supplierOpeningPreview').textContent,/on\/before/);
 f.field('cutover').value=day;f.field('cutover').onchange();assert.equal(f.node('#supplierOpeningCheck').disabled,false);
 const wait=deferred();let checked;f.write=async(name,args)=>{checked={name,args};return wait.promise;};const pending=f.click('#supplierOpeningCheck');f.field('source').value='Changed while checking';f.field('source').onchange();wait.resolve({data:f.saved(checked.name,checked.args)});await pending;assert.equal(f.form.querySelector('[type="submit"]').disabled,true);assert.equal(f.writes().length,0);
});
test('supplier opening import requires the exact reviewed request even when a control changes without an event',async()=>{
 const f=await fixture('opening');await f.openingFile();await f.click('#supplierOpeningCheck');f.field('source').value='Unreviewed source';await f.submit();assert.equal(f.writes().length,0);assert.match(f.summary.textContent,/Check reconciliation/);
});
for(const change of [row=>row.gl_import_id='other-gl',row=>row.cutover_date='2026-11-01',row=>row.bills[0].reference='Other bill',row=>row.payments=[],row=>row.opening_residual_minor=8024])test('supplier opening import keeps mismatched saved financial details uncertain',async()=>{
 const f=await fixture('opening');await f.openingFile();await f.click('#supplierOpeningCheck');f.write=async(name,args)=>{const row=f.saved(name,args);change(row);return {data:row};};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
});
test('supplier opening replacement requires the original net balance and renders untrusted references as text',async()=>{
 const f=await fixture('opening-correction');await f.openingFile([['<img src=x onerror=unsafe()>','supplier',day,day,'1.00','TZS']]);assert.equal(f.node('#supplierOpeningPreview').querySelector('img'),null);await f.click('#supplierOpeningCheck');assert.equal(f.form.querySelector('[type="submit"]').disabled,true);assert.match(f.messages.at(-1)[0],/same net balance/);assert.equal(f.writes().length,0);
});
