import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
import {installPageHeader} from './helpers/page-header.mjs';

function fixture(){
 const f=mainPageFixture({rpcs:{planned_delivery_serial_lines:()=>[]},tables:{discount_policy:()=>({id:true,head_limit_basis_points:1000,version:1}),sales_proforma_discount_decisions:()=>[],work_assignments:()=>[],acc_invoices:()=>[],product_serial_settings:()=>[],delivery_line_serials:()=>[]}});installPageHeader(f.ctx);f.ctx.actor=f.actor;f.evaluate("me=actor;view='sales';salesSection='proformas';salesEditing='';salesProformas=[];salesProformaPageData=null");
 const content=f.document.querySelector('#content'),show=html=>{content.innerHTML=html;return content.querySelector('.workspace-page-header');};
 return {...f,content,show};
}
test('Pro forma landing keeps one page title and places the existing New action last in its header',()=>{
 const f=fixture(),header=f.show(f.ctx.proformaListScreen()),actions=header.querySelector('.workspace-page-actions');
 assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(header.querySelector('h1').textContent,'Pro formas');assert.equal(header.querySelector('.workspace-page-back'),null);
 assert.equal(actions.children.at(-1).id,'newProforma');assert.equal(actions.querySelectorAll('.primary-action').length,1);assert.ok(actions.querySelector('#salesRefresh'));assert.ok(f.content.querySelector('#proformaSearch'));assert.equal(f.calls.length,0);
});
test('loaded Pro forma detail escapes its document number and preserves local Back state',async()=>{
 const f=fixture();f.ctx.record={id:'pf',document_number:'PF <img onerror="alert(1)">',status:'draft',revision:1,currency:'TZS',total_minor:0,created_at:'2026-10-29'};
 f.evaluate("salesProformas=[record];salesFocusedProforma='pf';salesProformaSearch='retained client';salesProformaFilter='draft';salesProformaPage=4");
 const header=f.show(f.ctx.proformaScreen());assert.equal(header.querySelector('h1').textContent,f.ctx.record.document_number);assert.equal(header.querySelector('img'),null);assert.equal(header.querySelector('.workspace-page-breadcrumbs [aria-current="page"]').getAttribute('href'),'#/proforma/pf');assert.equal(header.querySelector('.workspace-page-breadcrumbs [aria-current="page"]').textContent,f.ctx.record.document_number);assert.equal(f.content.querySelectorAll('[data-proforma-back]').length,1);assert.ok(header.querySelector('.workspace-page-back').querySelector('[data-proforma-back]'));assert.equal(header.querySelector('#newProforma'),null);
 assert.equal(f.calls.length,0);let renders=0;f.ctx.salesDeliveryWorkspace=async()=>renders++;f.ctx.run=fn=>fn();f.ctx.bindSalesDelivery();await f.settle();const before=f.calls.length;await header.querySelector('[data-proforma-back]').onclick();
 assert.equal(renders,1);assert.equal(f.evaluate('salesFocusedProforma'),'');assert.equal(f.evaluate('salesProformaSearch'),'retained client');assert.equal(f.evaluate('salesProformaFilter'),'draft');assert.equal(f.evaluate('salesProformaPage'),4);assert.equal(f.calls.length,before);
});
test('delivery landing retains tabs and pager without adding a Back or primary action',()=>{
 const f=fixture();f.evaluate("salesSection='delivery';salesDeliveryFilter='awaiting';salesDeliveryPageData={rows:[],total:0,page:0,pages:1,counts:{notes:4,awaiting:0}}");
 const header=f.show(f.ctx.deliveryListScreen());assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(header.querySelector('h1').textContent,'Delivery progress');assert.equal(header.querySelector('.workspace-page-back'),null);assert.equal(header.querySelector('.primary-action'),null);assert.ok(f.content.querySelector('#deliveryNotesTab'));assert.ok(f.content.querySelector('#deliveryNext'));assert.equal(f.calls.length,0);
});
test('delivery detail keeps View whole order and one Back in the header; unavailable detail still returns locally',async()=>{
 for(const available of [true,false]){
  const f=fixture();f.ctx.note={id:'dn',delivery_number:'DN <script>unsafe</script>',proforma_id:'pf" unsafe',status:'draft',created_at:'2026-10-29'};f.evaluate(`salesSection='delivery';salesFocusedDelivery='dn';salesDeliveryNotes=${available?'[note]':'[]'};salesDeliveryPage=3;salesDeliveryFilter='notes'`);
  const header=f.show(f.ctx.deliveryScreen());assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(f.content.querySelectorAll('[data-delivery-back]').length,1);assert.ok(header.querySelector('.workspace-page-back').querySelector('[data-delivery-back]'));assert.equal(header.querySelector('script'),null);
  if(available){assert.equal(header.querySelector('h1').textContent,f.ctx.note.delivery_number);assert.equal(header.querySelector('[data-order-proforma]').dataset.orderProforma,f.ctx.note.proforma_id);}else assert.match(f.content.textContent,/unavailable/);
  assert.equal(f.calls.length,0);let renders=0;f.ctx.salesDeliveryWorkspace=async()=>renders++;f.ctx.run=fn=>fn();f.ctx.bindSalesDelivery();await f.settle();const before=f.calls.length;await header.querySelector('[data-delivery-back]').onclick();assert.equal(renders,1);assert.equal(f.evaluate('salesFocusedDelivery'),'');assert.equal(f.evaluate('salesDeliveryPage'),3);assert.equal(f.evaluate('salesDeliveryFilter'),'notes');assert.equal(f.calls.length,before);
 }
});
test('Service keeps one title and focused Back outside its replaceable controls without duplicate handlers',async()=>{
 const f=fixture();f.evaluate("view='service';serviceSection='installations';serviceFocusId='job';serviceSelectedId='job';servicePage=4;servicePageData={rows:[],total:0,page:0,pages:1,metrics:{awaiting_engineer:0,awaiting_date:0,due_30:0,overdue:0,oldest_engineer_days:null,oldest_date_days:null}}");
 const header=f.show(f.ctx.installationScreen()),back=header.querySelector('#serviceAllJobs');assert.ok(back);assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(f.content.querySelectorAll('#serviceAllJobs').length,1);assert.equal(f.content.querySelector('#servicePageControls').querySelector('#serviceAllJobs'),null);
 let renders=0;f.ctx.serviceWorkspace=async()=>renders++;f.ctx.run=fn=>fn();f.ctx.bindServicePageControls();f.content.querySelector('#servicePageControls').innerHTML=f.ctx.servicePageControls(f.evaluate('servicePageData'));f.ctx.bindServicePageControls();assert.equal(f.content.querySelector('.workspace-page-header'),header);assert.equal(header.querySelector('#serviceAllJobs'),back);
 await back.onclick();assert.equal(renders,1);assert.equal((back.events.click||[]).length,0);assert.equal(f.evaluate('serviceFocusId'),'');assert.equal(f.evaluate('serviceSelectedId'),'');assert.equal(f.evaluate('servicePage'),0);assert.equal(f.evaluate('serviceSection'),'installations');assert.equal(f.calls.length,0);
});
test('Service landing/forms retain their section titles and never gain a focused-job Back control',()=>{
 const f=fixture();for(const [section,title]of [['installations','Machines to install'],['schedule','Service & maintenance schedule'],['forms','Service forms']]){f.evaluate(`serviceSection='${section}';serviceFocusId=''`);const header=f.show(f.ctx.serviceHeader());assert.equal(header.querySelector('h1').textContent,title);assert.equal(header.querySelector('#serviceAllJobs'),null);assert.ok(header.querySelector('#serviceRefresh'));assert.equal(header.querySelector('.primary-action'),null);}assert.equal(f.calls.length,0);
});
test('confirmed Sales card patches retain the page header and its existing Back control',async()=>{
 for(const kind of ['proforma','delivery']){
  const f=fixture();f.ctx.record={id:'saved',document_number:'PF-9',delivery_number:'DN-9',status:'draft',revision:1,currency:'TZS',total_minor:0,created_at:'2026-10-29'};
  f.evaluate(kind==='proforma'?"salesProformas=[record];salesFocusedProforma='saved'":"salesSection='delivery';salesDeliveryNotes=[record];salesFocusedDelivery='saved'");
  const header=f.show(kind==='proforma'?f.ctx.proformaScreen():f.ctx.deliveryScreen()),back=header.querySelector(`[data-${kind}-back]`),card=f.content.querySelector('[data-document-card]');
  const proto=Object.getPrototypeOf(card),insert=proto.insertAdjacentHTML;proto.insertAdjacentHTML=function(position,html){if(position!=='beforebegin')return insert.call(this,position,html);const template=f.document.createElement('template');template.innerHTML=html;for(const node of [...template.content.children])this.parentElement.insertBefore(node,this);};
  f.ctx.salesPatchStatusCard(kind,f.ctx.record,null);await f.settle();assert.equal(f.content.querySelector('.workspace-page-header'),header);assert.equal(header.querySelector(`[data-${kind}-back]`),back);assert.notEqual(f.content.querySelector('[data-document-card]'),card);
 }
});
