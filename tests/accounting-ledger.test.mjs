import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){
 const ctx=vm.createContext({Intl,Date,Math,Number,String,Map,Set,Array,Object,Error,crypto:globalThis.crypto});
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

test('paid amounts ignore void receipts and status follows the due date',()=>{
 const ctx=load();
 ctx.inv={id:'i1',total_minor:1000,due_date:'2026-10-10',voided_at:null};
 ctx.allocs=[{invoice_id:'i1',receipt_id:'r1',amount_minor:300},{invoice_id:'i1',receipt_id:'r2',amount_minor:700},{invoice_id:'x',receipt_id:'r1',amount_minor:50}];
 ctx.rcpts=[{id:'r1',voided_at:null},{id:'r2',voided_at:'2026-10-12T00:00:00Z'}];
 assert.equal(run(ctx,'booksInvoicePaid(inv,allocs,rcpts)'),300);
 assert.equal(run(ctx,"booksInvoiceStatus(inv,300,'2026-10-11').label"),'Part paid · overdue');
 assert.equal(run(ctx,"booksInvoiceStatus(inv,0,'2026-10-10').key"),'open');
 assert.equal(run(ctx,"booksInvoiceStatus(inv,1000,'2026-12-01').key"),'paid');
 assert.equal(run(ctx,"booksInvoiceStatus({...inv,voided_at:'x'},0,'2026-12-01').key"),'void');
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
