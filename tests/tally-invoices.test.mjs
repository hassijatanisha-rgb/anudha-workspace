import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function load(){const ctx=vm.createContext({esc:s=>String(s??''),Intl,Number,String,Math});vm.runInContext(read('tally-invoices.js'),ctx);return ctx;}
test('Tally amounts, quantities and dates are read the way Tally writes them',()=>{
 const c=load();
 assert.equal(c.tallyAmountMinor('-13570.00'),1357000);assert.equal(c.tallyAmountMinor('1,000.00'),100000);
 assert.equal(c.tallyAmountMinor('-$100.00 @ TZS 2500/$ = -TZS 250000.00'),25000000,'base currency after =');
 assert.equal(c.tallyAmountMinor(''),null);assert.equal(c.tallyAmountMinor('n/a'),null);
 assert.deepEqual({...c.tallyQuantity(' 10 PCS')},{quantity:10,unit:'PCS'});assert.deepEqual({...c.tallyQuantity('1,200 Nos = 12 Box')},{quantity:1200,unit:'NOS'});
 assert.equal(c.tallyDate('20260930'),'2026-09-30');assert.equal(c.tallyDate('30-09-2026'),null);
});
test('only sales invoices are imported; orders, notes and receipts are skipped',()=>{
 const c=load();
 for(const t of ['Sales','Tax Invoice','Sales Invoice','Sales - Export'])assert.equal(c.tallyIsSalesInvoice(t),true,t);
 for(const t of ['Sales Order','Credit Note','Delivery Note','Receipt','Sales Return','Purchase'])assert.equal(c.tallyIsSalesInvoice(t),false,t);
});
test('register lists newest first and searches invoice, customer, Pro forma and items',()=>{
 const c=load();vm.runInContext(`tallyInvoiceProformas=[{id:'p1',document_number:'PF-2026-000012'}]`,c);
 const rows=[{id:'a',voucher_number:'INV/9',voucher_date:'2026-09-01',match_status:'matched',proforma_id:'p1',party_name:'Fixture Hospital',lines:[{item:'Blood Bag'}]},{id:'b',voucher_number:'INV/10',voucher_date:'2026-09-01',match_status:'unmatched',party_name:'Cash',lines:[]},{id:'c',voucher_number:'INV/1',voucher_date:'2026-09-30',match_status:'ignored',party_name:'Cash',lines:[]}];
 const ids=(f,s='')=>[...c.tallyInvoiceVisible(rows,{filter:f,search:s})].map(r=>r.id);
 assert.deepEqual(ids('all'),['c','b','a'],'date then invoice number, newest first');assert.deepEqual(ids('unmatched'),['b']);
 assert.deepEqual(ids('all','pf-2026-000012'),['a']);assert.deepEqual(ids('all','blood'),['a']);assert.deepEqual(ids('all','cash'),['c','b']);
});
test('menu, router, sign-out, help and script order are wired; nothing writes stock',()=>{
 const app=read('app.js'),html=read('index.html'),src=read('tally-invoices.js');
 assert.match(read('workspace-navigation.js'),/\['Tally invoices','tallyinvoices'\]/);assert.match(app,/view==='tallyinvoices'\)return tallyInvoicesWorkspace\(\)/);
 assert.match(app,/typeof clearTallyInvoices==='function'\)clearTallyInvoices\(\)/);assert.match(readFileSync(new URL('../how-to-use.js',import.meta.url),'utf8'),/Bring Tally invoices into the ERP/);
 assert.ok(html.indexOf('tally-invoices.js')>0&&html.indexOf('tally-invoices.js')<html.indexOf('app.js'));
 assert.doesNotMatch(src,/inventory_lots|advance_sales_delivery|\.insert\(|\.update\(/);
});
