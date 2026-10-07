import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function load(){const ctx=vm.createContext({Math,Number,String,Map,Set,Error});vm.runInContext(read('tally-export.js'),ctx);return ctx;}
const lines=[{product_id:'p1',quantity:10,uom:'pcs',unit_price_minor:100000,discount_basis_points:500,tax_basis_points:1800},{product_id:'p2',quantity:3,uom:'box',unit_price_minor:33333,discount_basis_points:0,tax_basis_points:0}];
const items=new Map([['p1',{item_name:'Blood Bag 450ml & "Twin"',unit:'PCS'}],['p2',{item_name:'Cannula <22G>',unit:'BOX'}]]);
const settings={company_name:'Anudha Ltd',voucher_type:'Sales Order',sales_ledger:'Sales',vat_ledger:'Output VAT 18%'};
// 10 x 1,000.00 = 10,000.00 less 5% = 9,500.00 + 18% VAT 1,710.00; 3 x 333.33 = 999.99 no VAT. Total 12,209.99.
const proforma={document_number:'PF-2026-000012',currency:'TZS',total_minor:1220999,acceptance_reference:'LPO 7'};
test('line amounts use the same rounding as the Pro forma',()=>{
 const c=load();assert.deepEqual({...c.tallyLineAmounts(lines[0])},{gross:1000000,discount:50000,net:950000,tax:171000});
 assert.equal(c.tallyMinorText(1220999),'12209.99');assert.equal(c.tallyMinorText(-5),'-0.05');assert.equal(c.tallyMinorText(100),'1.00');
});
test('the voucher balances: party debit equals sales plus VAT, and matches the Pro forma total',()=>{
 const c=load(),xml=c.buildTallySalesOrderXml({proforma,lines,ledgerName:'Fixture Hospital',items,settings,date:'2026-10-01'});
 const amounts=[...xml.matchAll(/<LEDGERENTRIES\.LIST>.*?<AMOUNT>(-?[\d.]+)<\/AMOUNT><\/LEDGERENTRIES\.LIST>/g)].map(m=>Math.round(Number(m[1])*100));
 const inventory=[...xml.matchAll(/<ACCOUNTINGALLOCATIONS\.LIST>.*?<AMOUNT>([\d.]+)<\/AMOUNT>/g)].map(m=>Math.round(Number(m[1])*100));
 assert.deepEqual(amounts,[-1220999,171000]);assert.deepEqual(inventory,[950000,99999]);
 assert.equal(amounts.reduce((a,b)=>a+b,0)+inventory.reduce((a,b)=>a+b,0),0,'debits equal credits');
 assert.match(xml,/<VOUCHERNUMBER>PF-2026-000012<\/VOUCHERNUMBER>/);assert.match(xml,/<ORDERNO>PF-2026-000012<\/ORDERNO>/);assert.match(xml,/<DATE>20261001<\/DATE>/);
 assert.match(xml,/<RATE>1000\.00\/PCS<\/RATE><DISCOUNT>5\.00<\/DISCOUNT>/);assert.match(xml,/<ACTUALQTY>3 BOX<\/ACTUALQTY>/);
 assert.match(xml,/Blood Bag 450ml &amp; &quot;Twin&quot;/);assert.match(xml,/Cannula &lt;22G&gt;/);assert.doesNotMatch(xml,/<22G>/);
 assert.match(xml,/<SVCURRENTCOMPANY>Anudha Ltd<\/SVCURRENTCOMPANY>/);
});
test('refuses anything that would make a wrong or rejected voucher',()=>{
 const c=load(),base={proforma,lines,ledgerName:'X',items,settings,date:'2026-10-01'};
 assert.throws(()=>c.buildTallySalesOrderXml({...base,proforma:{...proforma,currency:'USD'}}),/Only Pro formas in TZS/);
 assert.throws(()=>c.buildTallySalesOrderXml({...base,lines:[]}),/no items/);
 assert.throws(()=>c.buildTallySalesOrderXml({...base,items:new Map([['p1',{item_name:'A'}]])}),/Tally stock item name/);
 assert.throws(()=>c.buildTallySalesOrderXml({...base,proforma:{...proforma,total_minor:1}}),/do not match the Pro forma total/);
 const noVat=c.buildTallySalesOrderXml({...base,lines:[lines[1]],items,proforma:{...proforma,total_minor:99999}});assert.doesNotMatch(noVat,/Output VAT/,'no empty VAT line');
});
test('default Tally item name comes from the original Tally export; new products need one typed',()=>{
 const c=load();
 assert.equal(c.tallyDefaultItemName({source:{source_file:'GODOWN.csv',raw:['12 Pin 5 - Lead ECG Cable ']}},null),'12 Pin 5 - Lead ECG Cable');
 assert.equal(c.tallyDefaultItemName({source:{origin:'Anudha product list'}},null),'');
 assert.equal(c.tallyDefaultItemName({source:{source_file:'x',raw:['Old']}},{item_name:'Confirmed name'}),'Confirmed name','a confirmed name wins');
});
test('Send to Tally is offered on accepted Pro formas and wired',()=>{
 const sd=read('sales-delivery.js'),html=read('index.src.html');
 assert.match(sd,/record\.status==='accepted'&&typeof openSendToTally==='function'/);assert.match(sd,/\[data-send-tally\]/);
 assert.ok(html.indexOf('tally-export.js')>0&&html.indexOf('tally-export.js')<html.indexOf('app.js'));
});
