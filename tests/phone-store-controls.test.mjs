import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cases,openMainPageScenario} from './helpers/main-page-scenarios.mjs';
import {parseCss} from '../scripts/audit-design-tokens.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const css=read('ui-polish.css'),marker='/* Standing-use controls;',start=css.indexOf(marker),end=css.indexOf('\n/*',start+marker.length),block=css.slice(start,end<0?undefined:end),rules=parseCss(block).declarations;
const open=page=>openMainPageScenario(cases.find(entry=>entry.name===page),'owner');

test('standing-use sizing is limited to the named phone controls, with no fixed height or shell geometry change',()=>{
 assert.ok(block.startsWith(marker));assert.equal(rules.length,1);assert.deepEqual(rules[0].media,['@media screen and (max-width:600px)']);assert.equal(rules[0].property,'min-height');assert.equal(rules[0].value,'var(--control-phone)');
 assert.equal(parseCss(read('tokens.css')).declarations.find(row=>row.selector===':root'&&row.property==='--control-phone').value,'3.25rem');
 for(const selector of ['.stock-count-workspace input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not(.lookup-source)','.stock-count-workspace select:not(.lookup-source)','.stock-count-workspace button:not(.count-result)','.packing-page [data-packing-refresh]','.packing-page [data-packing-release]','.packing-page [data-packing-screen]','.packing-page [data-packing-open-incoming]','.packing-page details>summary','#deliveryNotesTab','#deliveryAwaitingTab','#deliveryPrev','#deliveryNext','#content:has(#deliveryNotesTab,[data-delivery-back]) #salesRefresh','main [data-delivery-action]'])assert.ok(rules[0].selector.includes(selector),selector);
 assert.doesNotMatch(rules[0].selector,/packing-big|packing-check|body|:nth-/);
});

test('existing larger packing actions, count results and checkbox rows retain their original minimums',()=>{
 const packing=parseCss(read('packing-queue.css')).declarations,polish=parseCss(css).declarations;
 assert.equal(packing.find(row=>row.selector==='.packing-big'&&row.property==='min-height').value,'64px');
 assert.equal(polish.find(row=>row.selector==='main .count-result'&&row.property==='min-height').value,'56px');
 assert.equal(polish.find(row=>row.selector==='.packing-check'&&row.property==='min-height').value,'var(--control-phone)');
 assert.equal(polish.find(row=>row.selector==='.lookup>select.lookup-source'&&row.property==='min-height').value,'0');
});

test('actual count landing and explicit form expose the scoped search, selectors, paging and save controls',async()=>{
 const f=await open('Stock count'),root=f.document.querySelector('.stock-count-workspace');f.evaluate("countGodown='Haadi'");f.ctx.renderStockCountBody();
 for(const selector of ['#countRefresh','#countGodown','#countSearch','#countUnlisted','#countPrev','#countNext'])assert.ok(root.querySelector(selector),selector);
 const form=f.document.createElement('div');form.innerHTML=f.ctx.countPickedForm('unlisted');
 assert.equal(form.querySelector('[name="quantity"]').getAttribute('step'),'any');
 assert.equal(form.querySelector('[name="quantity"]').getAttribute('inputmode'),'decimal');
 for(const selector of ['[name="unit"]','[name="condition"]','#countSave','#countCancel'])assert.ok(form.querySelector(selector),selector);
});

test('actual packing markup keeps the larger primary actions separate from release, incoming and summaries',async()=>{
 const f=await open('Packing'),root=f.document.querySelector('.packing-page');
 for(const selector of ['[data-packing-refresh]','[data-packing-screen]','[data-packing-take]','summary'])assert.ok(root.querySelector(selector),selector);
 f.ctx.phoneOrder={...f.evaluate('packingBoard.waiting[0]'),taken_at:'2026-10-29T08:20:00Z',packer_user_id:'actor'};
 f.evaluate('packingBoard.packing=[phoneOrder];packingBoard.mine=phoneOrder.id;packingBoard.coming={count:1,items:[{...phoneOrder,status:"tax_invoice_created"}]}');
 const markup=f.document.createElement('div');markup.innerHTML=f.ctx.packingQueueHtml();
 for(const selector of ['[data-packing-release]','[data-packing-open-incoming]','[data-packing-packed]','.packing-check'])assert.ok(markup.querySelector(selector),selector);
 assert.ok(markup.querySelector('[data-packing-packed]').className.split(' ').includes('packing-big'));assert.equal(markup.querySelector('[data-packing-packed]').disabled,true);assert.equal(markup.querySelector('.packing-check input').getAttribute('type'),'checkbox');
});

test('delivery-only refresh context and original state-action hooks stay separate from Pro formas',async()=>{
 const f=await open('Delivery');for(const id of ['deliveryNotesTab','deliveryAwaitingTab','deliveryPrev','deliveryNext','salesRefresh'])assert.ok(f.document.querySelector('#'+id),id);
 const host=f.document.createElement('div');host.innerHTML=f.ctx.deliveryActions({id:'fictional-delivery',status:'ready'});
 assert.ok(host.querySelectorAll('[data-delivery-action]').length);for(const button of host.querySelectorAll('[data-delivery-action]'))assert.equal(button.dataset.id,'fictional-delivery');
 assert.ok(host.querySelector('[data-print-document]'),'Print remains a separate existing action');
 assert.ok(rules[0].selector.includes('#content:has(#deliveryNotesTab,[data-delivery-back]) #salesRefresh'));assert.doesNotMatch(rules[0].selector,/proforma/);
});
