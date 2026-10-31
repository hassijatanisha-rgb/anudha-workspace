import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cases,openMainPageScenario} from './helpers/main-page-scenarios.mjs';
import {parseCss} from '../scripts/audit-design-tokens.mjs';

const registers=[
 {page:'Products',table:'.product-quality-table',row:'[data-catalog-row]',labels:['Product / code','Manufacturer / model','Status','Actions'],actions:['Open product'],count:25},
 {page:'Prices',table:'.product-price-table',row:'[data-price-product]',labels:['Product','Configured price','Details'],actions:['Open price'],count:25},
 {page:'Books accounts',table:'.books-account-table',row:'[data-books-account-row]',labels:['Code','Name','Balance today','Actions'],actions:['Edit','Ledger'],count:50}
];
const open=page=>openMainPageScenario(cases.find(entry=>entry.name===page),'owner');

for(const spec of registers)test(`${spec.page} phone cards preserve table relationships, every cell and the original actions for each permitted role`,async()=>{
 const entry=cases.find(item=>item.name===spec.page);
 for(const role of entry.roles){
  const f=await openMainPageScenario(entry,role),tables=f.document.querySelectorAll(spec.table),rows=f.document.querySelectorAll(spec.row);
  assert.equal(rows.length,spec.count);assert.ok(tables.length);assert.ok(f.calls.length<=10);
  for(const table of tables){
   assert.equal(table.getAttribute('role'),'table');assert.ok(table.getAttribute('aria-label')||table.querySelector('caption')?.textContent);
   assert.equal(table.querySelector('thead').getAttribute('role'),'rowgroup');assert.equal(table.querySelector('tbody').getAttribute('role'),'rowgroup');
   assert.deepEqual(table.querySelectorAll('th').map(th=>th.textContent),spec.labels);
   for(const th of table.querySelectorAll('th')){assert.equal(th.getAttribute('scope'),'col');assert.equal(th.getAttribute('role'),'columnheader');}
  }
  for(const row of rows){
   assert.equal(row.getAttribute('role'),'row');const cells=row.querySelectorAll('td');assert.equal(cells.length,spec.labels.length);
   assert.deepEqual(cells.map(cell=>cell.dataset.label),spec.labels);
   for(const cell of cells){
    assert.equal(cell.getAttribute('role'),'cell');assert.equal(cell.hidden,false);
    const label=cell.querySelector('.phone-cell-label');assert.equal(label.textContent,cell.dataset.label);assert.equal(label.getAttribute('aria-hidden'),'true');
   }
   assert.deepEqual(row.querySelectorAll('button').map(button=>button.textContent),spec.actions);
  }
 }
});

test('product cards retain corrected identity, stock code, classification and status as escaped text',async()=>{
 const f=await open('Products');f.ctx.cardProduct={...f.evaluate('catalogRows()[0]'),name:'<script>Product & name</script>',sku:'Code <one>',source:{company:'Maker <safe>',specification:'Model <safe>',sale_status:'inactive_serviced',category:'machines'}};
 const host=f.document.createElement('div');host.innerHTML=f.evaluate('productWorkbenchTable([cardProduct])');
 assert.equal(host.querySelectorAll('script').length,0);assert.match(host.textContent,/<script>Product & name<\/script>/);assert.match(host.textContent,/Code <one>/);assert.match(host.textContent,/Maker <safe>/);assert.match(host.textContent,/Model <safe>/);assert.match(host.textContent,/Service only/);
 assert.equal(host.querySelector('[data-workbench-detail]').dataset.workbenchDetail,f.ctx.cardProduct.id);
});

test('price cards keep all currency values including zero and distinguish an unconfigured price',async()=>{
 const f=await open('Prices');f.ctx.cardPrice={id:'price-card',name:'<img>Product',company:'Maker',specification:'Size',sku:'SKU',prices:[{currency:'TZS',unit_price_minor:0},{currency:'USD',unit_price_minor:1234},{currency:'EUR',unit_price_minor:999}]};
 const host=f.document.createElement('div');host.innerHTML=f.evaluate('pricingSummaryRow(cardPrice)');
 assert.equal(host.querySelectorAll('img').length,0);assert.match(host.textContent,/<img>Product · Maker · Size · SKU/);assert.match(host.textContent,/TZS 0\.00/);assert.match(host.textContent,/USD 12\.34/);assert.match(host.textContent,/EUR 9\.99/);
 f.ctx.cardPrice.prices=[];host.innerHTML=f.evaluate('pricingSummaryRow(cardPrice)');assert.match(host.textContent,/Not configured/);assert.doesNotMatch(host.textContent,/TZS 0/);assert.equal(host.querySelector('[data-price-open]').dataset.priceOpen,'price-card');
});

test('account cards retain the exact displayed signed balance and account restrictions',async()=>{
 const f=await open('Books accounts');f.ctx.cardAccount={id:'account-card',code:'Code <safe>',name:'Account <safe>',account_type:'asset',active:false,system_key:'cash'};
 for(const [type,balance] of [['asset',12345],['liability',-12345]]){
  f.ctx.cardAccount.account_type=type;const host=f.document.createElement('div');host.innerHTML=f.evaluate('booksAccountRow(cardAccount,12345)');
  assert.equal(host.querySelectorAll('safe').length,0);assert.match(host.textContent,/Code <safe>/);assert.match(host.textContent,/Account <safe>/);assert.match(host.textContent,/Used by automatic postings/);assert.match(host.textContent,/Not in use/);
  const cell=host.querySelectorAll('[data-label]').find(node=>node.dataset.label==='Balance today');assert.equal(cell.textContent,'Balance today'+f.evaluate(`booksMoney(${balance})`));assert.ok(cell.className.split(' ').includes('numeric-cell'));
  assert.equal(host.querySelector('[data-books-edit-account]').dataset.booksEditAccount,'account-card');assert.equal(host.querySelector('[data-books-account-ledger]').dataset.booksAccountLedger,'account-card');
 }
});

test('only the three named registers become labeled cards at phone widths without hiding data cells',()=>{
 const css=readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8'),selector=':is(.product-quality-table,.product-price-table,.books-account-table)',start=css.indexOf('/* These bounded registers keep their table relationships'),block=css.slice(start,css.indexOf('\n}',start)+2);
 assert.ok(block.startsWith('/* These bounded registers'));const {declarations}=parseCss(block);
 const value=(suffix,property,phone=true)=>declarations.find(row=>row.selector===selector+suffix&&row.property===property&&(row.media.length>0)===phone)?.value;
 assert.equal(value(' .phone-cell-label','display',false),'none');assert.equal(value(' .phone-cell-label','display'),'block');assert.equal(value(' tbody','display'),'grid');assert.equal(value(' tbody tr','grid-template-columns'),'minmax(0,1fr)');
 assert.equal(value(' tbody td[data-label]','white-space'),'normal');assert.equal(value(' tbody td[data-label]','overflow-wrap'),'anywhere');assert.equal(value(' tbody td[data-label]','display'),'block');assert.equal(value(' tbody td.phone-card-actions','display'),'flex');assert.equal(value(' thead','clip-path'),'inset(50%)');assert.notEqual(value(' thead','display'),'none');
 assert.ok(declarations.filter(row=>row.media.length).every(row=>row.media.join(' ')==='@media screen and (max-width:600px)'));
 assert.ok(declarations.every(row=>row.selector.includes(selector)));assert.doesNotMatch(block,/:nth-|content\s*:|\.table-wrap\s*>?\s*table\s*\{/);
 assert.ok(!declarations.some(row=>/\b(?:td|tr|tbody)\b/.test(row.selector)&&['visibility','display'].includes(row.property)&&['none','hidden'].includes(row.value)));
});

test('incomplete profile tile action uses the shared ink foreground on its warning surface',()=>{
 const {declarations}=parseCss(readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8'));
 assert.equal(declarations.filter(row=>row.selector==='.profile-tile.incomplete .tile-open'&&row.property==='color').at(-1)?.value,'var(--ink)');
});
