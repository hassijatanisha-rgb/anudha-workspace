import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){
 const ctx=vm.createContext({statusTone,Intl,Date,Math,Number,String,Map,Set,Array,Object,Error,crypto:globalThis.crypto});
 vm.runInContext(readFileSync(new URL('../sales-domain.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(readFileSync(new URL('../accounting-ledger.js',import.meta.url),'utf8'),ctx);
 return ctx;
}
const run=(ctx,expr)=>vm.runInContext(expr,ctx);

test('journal check requires two balanced lines with one side each',()=>{
 const ctx=load();ctx.lines=[{accountId:'a',debit:'1500.50'},{accountId:'b',credit:'1500.50'},{}];
 const ok=run(ctx,'booksJournalCheck(lines)');assert.equal(ok.problem,'');assert.equal(ok.debit,150050);assert.equal(ok.credit,150050);
 ctx.lines=[{accountId:'a',debit:'100'},{accountId:'b',credit:'90'}];
 assert.match(run(ctx,'booksJournalCheck(lines)').problem,/differ by/);
 ctx.lines=[{accountId:'a',debit:'100'}];
 assert.match(run(ctx,'booksJournalCheck(lines)').problem,/at least two lines/);
 ctx.lines=[{accountId:'a',debit:'100',credit:'100'},{accountId:'b',credit:'0'}];
 assert.match(run(ctx,'booksJournalCheck(lines)').problem,/Line 1: enter either/);
 ctx.lines=[{debit:'100'},{accountId:'b',credit:'100'}];
 assert.match(run(ctx,'booksJournalCheck(lines)').problem,/Line 1: choose an account/);
 ctx.lines=[{accountId:'a',debit:'1.234'},{accountId:'b',credit:'1.23'}];
 assert.match(run(ctx,'booksJournalCheck(lines)').problem,/two decimal places/);
});

test('receipts are spread over the oldest due invoices first and never beyond what is owed',()=>{
 const ctx=load();
 ctx.open=[{id:'late',due_date:'2026-11-01',invoice_number:'INV-3',outstanding:500},{id:'old',due_date:'2026-09-01',invoice_number:'INV-1',outstanding:300},{id:'mid',due_date:'2026-10-01',invoice_number:'INV-2',outstanding:400}];
 assert.deepEqual([...run(ctx,'booksAllocateOldest(600,open)')],[['old',300],['mid',300]]);
 assert.deepEqual([...run(ctx,'booksAllocateOldest(5000,open)')],[['old',300],['mid',400],['late',500]]);
 assert.equal(run(ctx,'booksAllocateOldest(0,open)').size,0);
});

test('Books pages every choice and uses database balances, independent of receipt slices',async()=>{
 const ctx=load(),requests=[];
 const datasets={
  acc_accounts:[{id:'bank',code:'1200'}],acc_settings:[{version:1}],acc_customer_tax_ids:[],
  acc_invoice_balances:Array.from({length:1005},(_,n)=>({id:`i${n}`,proforma_id:`p${n}`,proforma_number:`PF-${n}`,paid_minor:730,outstanding_minor:270,status_key:'part',status_label:'Part paid'})),
  acc_receipts:Array.from({length:1006},(_,n)=>({id:`r${n}`})),
  acc_receipt_allocations:Array.from({length:1007},(_,n)=>({invoice_id:`i${n}`,receipt_id:`r${n}`,amount_minor:1})),
  acc_waiting_proformas:Array.from({length:501},(_,n)=>({id:`waiting${n}`,currency:'USD',total_minor:500}))
 };
 ctx.client={from(table){let start=0,end=Infinity;return {
  select(){return this;},order(){return this;},range(a,b){start=a;end=Math.min(b,a+210);return this;},
  then(resolve){requests.push([table,start]);resolve({data:datasets[table].slice(start,end+1)});}
 };}};
 const data=await run(ctx,"loadBooksData('receipts')"),invoiceData=await run(ctx,"loadBooksData('invoices')");
 assert.equal(data.invoices.length,1005);assert.equal(data.receipts.length,1006);assert.equal(data.allocations.length,1007);assert.equal(invoiceData.toInvoice.length,501);
 assert.equal(data.invoices[0].paid,730);assert.equal(data.invoices[0].outstanding,270);assert.equal(data.invoices[0].state.label,'Part paid');
 assert.equal(data.proformaNumbers.get('p1004'),'PF-1004');assert.equal(invoiceData.toInvoice.at(-1).id,'waiting500');
 assert.ok(requests.some(([table,start])=>table==='acc_invoice_balances'&&start===1005),'fetches through the terminal empty page');
});

test('paging fails visibly rather than returning a partial ledger',async()=>{
 const ctx=load();ctx.client={from(){return {select(){return this;},range(start){this.start=start;return this;},then(resolve){resolve(this.start?{error:{message:'Connection lost'}}:{data:[{id:'first'}]});}};}};
 await assert.rejects(run(ctx,"booksSelectAll('acc_receipts','*')"),/receipts could not load: Connection lost/);
});

test('CSV quotes commas, quotes and line breaks',()=>{
 const ctx=load();
 const csv=run(ctx,`booksCsv([['a','Name'],['b','Note']],[{a:'Aga Khan, Dar',b:'He said "ok"'},{a:'Plain',b:'two\\nlines'}])`);
 assert.equal(csv,'Name,Note\n"Aga Khan, Dar","He said ""ok"""\nPlain,"two\nlines"');
});

test('Tanzania date and section selection',()=>{
 const ctx=load();
 assert.equal(run(ctx,"booksToday(new Date('2026-10-15T22:30:00Z'))"),'2026-10-16');
 assert.equal(run(ctx,"booksAddDays('2026-12-15',30)"),'2027-01-14');
 run(ctx,"openBooksSection('reports')");assert.equal(run(ctx,'booksSection'),'reports');
 run(ctx,"openBooksSection('nonsense')");assert.equal(run(ctx,'booksSection'),'overview');
});

test('tax invoice lines show the amount after discount and its VAT',()=>{
 const ctx=load();
 const a=vm.runInContext('booksInvoiceLineAmounts({quantity:2,unit_price_minor:50000,discount_basis_points:1000,tax_basis_points:1800})',ctx);
 assert.equal(a.net,90000);assert.equal(a.vat,16200);
 const b=vm.runInContext('booksInvoiceLineAmounts({quantity:1,unit_price_minor:333,discount_basis_points:0,tax_basis_points:0})',ctx);
 assert.equal(b.net,333);assert.equal(b.vat,0);
});

test('CSV neutralizes spreadsheet formulas, controls and whitespace prefixes',()=>{
 const ctx=load();ctx.values=['=HYPERLINK("bad")',' +SUM(1,2)','-1+2','@SUM(A1)','\tformula','\rformula','\nformula',' \t=1','normal',-25];
 const csv=run(ctx,"booksCsv([['value','Value']],values.map(value=>({value})))");
 assert.equal(csv,'Value\n"\'=HYPERLINK(""bad"")"\n"\' +SUM(1,2)"\n\'-1+2\n\'@SUM(A1)\n\'\tformula\n"\'\rformula"\n"\'\nformula"\n\' \t=1\nnormal\n-25');
});

test('waiting Pro forma money retains its source currency without conversion',()=>{
 const ctx=load();
 assert.equal(run(ctx,"booksMoney(12345,'USD')"),new Intl.NumberFormat('en-TZ',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(123.45));
 assert.match(run(ctx,"booksMoney(12345)"),/TZS/);
});

test('only the selected Books print root is active and print exceptions clean up',()=>{
 const ctx=load(),classes=()=>{const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)};};
 const previous={classList:classes()},chosen={classList:classes(),closest:()=>null},body={classList:classes()};previous.classList.add('books-print-active');
 ctx.area=chosen;ctx.document={body,querySelectorAll(){return [previous,chosen].filter(area=>area.classList.contains('books-print-active'));}};
 ctx.window={print(){assert.equal(previous.classList.contains('books-print-active'),false);assert.equal(chosen.classList.contains('books-print-active'),true);assert.equal(body.classList.contains('books-printing'),true);throw Error('Print failed');}};
 assert.throws(()=>run(ctx,'booksPrint(area)'),/Print failed/);
 assert.equal(chosen.classList.contains('books-print-active'),false);assert.equal(body.classList.contains('books-printing'),false);
 run(ctx,"booksData={secret:'balance'};booksDraft={receipt:{}};booksSection='receipts';booksReport.kind='ageing';booksEpoch=4;clearBooks()");
 assert.equal(run(ctx,'booksData'),null);assert.equal(run(ctx,'booksDraft'),null);assert.equal(run(ctx,'booksEpoch'),5);assert.equal(run(ctx,'booksSection'),'overview');assert.equal(run(ctx,'booksReport.kind'),'trial');
});


test('split invoice printing uses stored rounding components and keeps the legacy fallback',()=>{
 const ctx=load();
 const stored=run(ctx,'booksInvoiceLineAmounts({quantity:1,unit_price_minor:1,discount_basis_points:5000,tax_basis_points:5000,subtotal_minor:1,discount_minor:0,tax_minor:0,total_minor:1})');
 assert.equal(stored.net,1);assert.equal(stored.vat,0);
 const legacy=run(ctx,'booksInvoiceLineAmounts({quantity:1,unit_price_minor:1,discount_basis_points:5000,tax_basis_points:5000})');
 assert.equal(legacy.net,0);assert.equal(legacy.vat,0);
 const strings=run(ctx,"booksInvoiceLineAmounts({subtotal_minor:'999',discount_minor:'99',tax_minor:'162'})");
 assert.equal(strings.net,900);assert.equal(strings.vat,162);
});

test('invoice quantity selection omits zeroes and enforces remaining, shared availability and whole-unit bounds',()=>{
 const ctx=load();ctx.lines=[{proforma_line_id:'machine',product_id:'p',remaining_quantity:4,available_quantity:2},{proforma_line_id:'spare',product_id:'s',remaining_quantity:3,available_quantity:3}];
 ctx.values=['2','0'];
 assert.equal(JSON.stringify(run(ctx,'booksInvoiceQuantitySelection(lines,values)')),JSON.stringify([{proforma_line_id:'machine',quantity:2}]));
 for(const value of ['-1','1.5','1e0','','1000001','9007199254740992']){
  ctx.values=[value,'0'];assert.throws(()=>run(ctx,'booksInvoiceQuantitySelection(lines,values)'),/whole quantity/);
 }
 ctx.values=['5','0'];assert.throws(()=>run(ctx,'booksInvoiceQuantitySelection(lines,values)'),/uninvoiced balance/);
 ctx.values=['3','0'];assert.throws(()=>run(ctx,'booksInvoiceQuantitySelection(lines,values)'),/available Haadi stock/);
 ctx.values=['0','0'];assert.throws(()=>run(ctx,'booksInvoiceQuantitySelection(lines,values)'),/at least one/);
 ctx.lines=[{proforma_line_id:'a',product_id:'p',remaining_quantity:4,available_quantity:2},{proforma_line_id:'b',product_id:'p',remaining_quantity:4,available_quantity:2}];
 ctx.values=['2','1'];assert.throws(()=>run(ctx,'booksInvoiceQuantitySelection(lines,values)'),/available Haadi stock/);
 ctx.values=['1','1'];assert.equal(run(ctx,'booksInvoiceQuantitySelection(lines,values)').length,2);
});


test('invoice chips retain server labels and distinguish overdue, unpaid and missing TRA receipt',()=>{
 const ctx=load();ctx.esc=value=>String(value??'').replaceAll('<','&lt;').replaceAll('"','&quot;');
 ctx.organizations=[{id:'customer',name:'Customer'}];const data={proformaNumbers:new Map()};
 for(const [key,tone,label] of [['void','neutral','Void'],['paid','success','Credited'],['overdue','danger','Part settled · overdue'],['part','warning','Part settled'],['open','warning','Unpaid']]){
  const html=ctx.booksInvoiceTable([{id:'invoice',invoice_number:'INV-1',organization_id:'customer',invoice_date:'2026-10-29',due_date:'2026-11-29',total_minor:10000,paid:0,outstanding:10000,state:{key,label}}],data);
  assert.match(html,new RegExp('chip chip--'+tone+'">'+label+'<'));
  assert.match(html,/books-missing chip chip--warning">Not recorded</);
 }
 assert.equal(ctx.booksInvoiceTone('unknown'),'neutral');
});
