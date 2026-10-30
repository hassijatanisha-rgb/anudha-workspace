import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {installLookupDom} from './helpers/lookup-dom.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture({editing=false}={}){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 Object.defineProperty(prototype,'inert',{configurable:true,get(){return !!this._inert;},set(value){this._inert=value;}});
 document.body.innerHTML='<main id="content"></main>';const calls=[],reads=[],focus=[],actor={user_id:'actor',role:'owner'};let sequence=0;
 class Fields{constructor(form){this.form=form;}get(name){return this.form.querySelector(`[name="${name}"]`)?.value??null;}has(name){return !!this.form.querySelector(`[name="${name}"]`);}}
 const ctx=vm.createContext({busy:false,document,$:selector=>document.querySelector(selector),FormData:Fields,me:actor,view:'purchasing',statusTone,esc,clearTimeout,setTimeout,companyDate:()=> '2026-10-30',employeeName:()=> 'Fictional employee',products:[{id:'p1',name:'Reagent'},{id:'p2',name:'Tube'}],pendingRows:[{id:'pending',request_number:'PN-1'}],
  window:{scrollX:0,scrollY:300,scrollTo(){}},crypto:{randomUUID:()=> 'request-'+(++sequence)},CSS:{escape:value=>value},message(){},syncWorkspaceNavigation(){},inventoryProductChoice:product=>product.name,inventoryProductFromChoice:value=>ctx.products.find(product=>product.name===value),inventoryOption:(id,label,selected)=>`<option value="${esc(id)}"${selected?' selected':''}>${esc(label)}</option>`,salesProductChoices:()=>ctx.products.map(product=>`<option value="${esc(product.name)}">`).join(''),
  run:fn=>fn(),client:{rpc:async(name,args)=>{calls.push({name,args:plain(args)});return f.write?f.write(name,args):{data:{id:args.p_id}};},from(table){const query={table,select(columns){this.columns=columns;return this;},eq(key,id){this.key=key;this.id=id;return this;},async maybeSingle(){reads.push({table,id:this.id});return {data:f.savedRow(this.id)};}};return query;}}});
 installWorkspaceDialogFixture(ctx);installPageHeader(ctx);for(const source of ['row-index.js','client-rules.js','purchasing.js'])vm.runInContext(read(source),ctx);
 const get=code=>vm.runInContext(code,ctx);
 get(`purchaseLoaded=true;purchaseLoadedActor=me;purchaseEditing=${editing?'"order"':'"new"'};suppliers=[{id:'supplier',name:'Fictional supplier',active:true}];purchaseOrders=[{id:'order',po_number:'PO-1',status:'requested',supplier_id:'supplier',currency:'USD',version:4,requested_by:'actor'}];purchaseLines=[{id:'line',purchase_order_id:'order',line_number:1,product_id:'p1',quantity:2,unit_price_minor:15750,pending_request_id:'pending',note:'Original note'}];`);
 ctx.renderPurchasing();const form=document.querySelector('#purchaseForm'),field=(name,row=form)=>row.querySelector(`[name="${name}"]`),rows=()=>form.querySelectorAll('[data-purchase-line]');
 field('supplierId').value='supplier';field('productChoice').value='Reagent';field('quantity').value='2';
 const originalFocus=prototype.focus;prototype.focus=function(options){focus.push({node:this,summary:form.querySelector('#purchaseFormError').textContent});originalFocus.call(this,options);};
 const f={ctx,get,document,form,actor,calls,reads,focus,field,rows,write:null,summary:()=>form.querySelector('#purchaseFormError').textContent,submit:()=>form.onsubmit({preventDefault(){}}),blur:control=>dispatchFocusout(control),input:control=>form.oninput({target:control}),add(){document.querySelector('#addPurchaseLine').onclick();return rows().at(-1);},remove(row){document.querySelector('#purchaseLines').onclick({target:row.querySelector('[data-remove-purchase-line]')});},savedRow(id){const args=calls.at(-1).args;return {id,po_number:'PO-SAVED',status:'requested',supplier_id:args.p_supplier_id,currency:args.p_currency,expected_on:args.p_expected_on,lpo_reference:'',notes:args.p_notes,requested_by:'actor',approved_by:null,close_note:'',version:args.p_expected_version+1,created_at:'2026-10-30T10:00:00Z',updated_at:'2026-10-30T10:00:00Z',purchase_order_lines:args.p_lines.map((line,i)=>({...line,id:'line-'+i,purchase_order_id:id,line_number:i+1}))};}};
 return f;
}

test('purchase fields have persistent labels/error hosts and the summary precedes the first editable field',()=>{
 const f=fixture();assert.equal(f.form.noValidate,true);assert.match(f.form.textContent,/Supplier, item and quantity are required/);
 for(const name of ['productChoice','quantity','note'])assert.ok(f.field(name).closest('label'));
 assert.equal(f.field('note').closest('label').textContent,'Note (optional)');assert.equal(f.field('expectedOn').closest('label').textContent,'Needed by (optional)');
 assert.ok(f.form.innerHTML.indexOf('id="purchaseFormError"')<f.form.innerHTML.indexOf('name="supplierId"'));
});

test('partial product blur preserves input, help and focus, without blaming untouched fields',()=>{
 const f=fixture(),product=f.field('productChoice');product.value='Rea';product.setAttribute('aria-describedby','item-help');f.field('quantity').value='';f.field('notes').focus();f.blur(product);
 assert.equal(product.value,'Rea');assert.equal(f.document.activeElement,f.field('notes'));assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.match(product.closest('label').textContent,/Choose a product from the list/);assert.match(product.getAttribute('aria-describedby'),/^item-help /);assert.equal(f.field('quantity').getAttribute('aria-invalid'),null);assert.equal(f.calls.length,0);
 product.value='Reagent';f.blur(product);assert.equal(product.getAttribute('aria-describedby'),'item-help');assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('submit uses element-keyed errors for repeated lines and reports count before DOM-order focus',async()=>{
 const f=fixture(),second=f.add();f.field('supplierId').value='';f.field('productChoice').value='Rea';f.field('productChoice',second).value='Tub';f.field('quantity',second).value='1.5';await f.submit();
 assert.equal(f.calls.length,0);assert.equal(f.summary(),'4 fields need attention');assert.equal(f.document.activeElement,f.field('supplierId'));assert.equal(f.focus.at(-1).summary,'4 fields need attention');assert.equal(f.field('supplierId').scrolledIntoView.block,'center');
 const firstError=f.field('productChoice').getAttribute('aria-describedby'),secondError=f.field('productChoice',second).getAttribute('aria-describedby');assert.notEqual(firstError,secondError);assert.equal(f.field('productChoice',second).value,'Tub');assert.equal(f.field('quantity',second).value,'1.5');
 f.field('productChoice',second).value='Tube';f.blur(f.field('productChoice',second));assert.equal(f.summary(),'3 fields need attention');assert.equal(f.field('productChoice').getAttribute('aria-describedby'),firstError);
 f.remove(second);assert.equal(f.summary(),'2 fields need attention');assert.equal(f.rows().length,1);assert.equal(f.field('productChoice').getAttribute('aria-describedby'),firstError);
});

test('quantity rules retain exact whole-number bounds and correction clears only that field',async()=>{
 const f=fixture(),quantity=f.field('quantity');
 for(const value of ['0','-1','1.5','1000001','9007199254740992','words']){quantity.value=value;f.blur(quantity);assert.match(quantity.closest('label').textContent,/whole quantity/);assert.equal(quantity.value,value);}
 quantity.value='1000000';f.blur(quantity);assert.equal(quantity.getAttribute('aria-invalid'),null);assert.equal(f.ctx.purchaseFormErrors(f.form).size,0);
 quantity.value='';await f.submit();assert.equal(f.summary(),'1 field needs attention');quantity.value='3';f.blur(quantity);assert.equal(f.summary(),'');assert.equal(f.calls.length,0);
});

test('native date, step, custom and optional-length errors remain safe and reveal their disclosure before focus',async()=>{
 const f=fixture(),date=f.field('expectedOn');date._nativeError='<img src=x> Choose a valid date.';await f.submit();assert.equal(f.calls.length,0);assert.equal(date.closest('details').open,true);assert.equal(f.document.activeElement,date);assert.equal(f.form.querySelector('img'),null);assert.match(date.closest('label').textContent,/<img src=x>/);
 date._nativeError='';f.field('quantity')._nativeError='Use a valid step.';assert.equal(f.ctx.purchaseFieldError(f.field('quantity')),'Use a valid step.');f.field('quantity')._nativeError='';
 f.field('note').value='x'.repeat(501);await f.submit();assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,f.field('note'));assert.equal(f.field('note').value.length,501);
 f.field('note').disabled=true;assert.equal(f.ctx.purchaseFormErrors(f.form).size,0);f.field('note').disabled=false;f.field('note').readOnly=true;assert.equal(f.ctx.purchaseFormErrors(f.form).size,0);
});

test('the actual supplier lookup uses the visible proxy exactly once and product lookup keeps the canonical value',async()=>{
 const f=fixture();Object.assign(f.ctx,{setWorkspacePopover:(node,open)=>{node.hidden=!open;},inventorySelectableProducts:()=>f.ctx.products,inventoryClassification:()=>({category:'reagents'}),inventoryProductIdentity:product=>product.name,catalogLabel:()=> 'Reagent'});installLookupDom(f.ctx);
 const supplier=f.field('supplierId');supplier.insertAdjacentHTML('beforeend',Array.from({length:12},(_,i)=>`<option value="supplier-${i}">Fictional supplier ${i}</option>`).join(''));supplier.value='';f.ctx.lookupAttach(supplier);const proxy=supplier._lookupBox.querySelector('input.lookup-input');f.blur(proxy);assert.equal(proxy.getAttribute('aria-invalid'),'true');assert.equal(supplier.getAttribute('aria-invalid'),null);await f.submit();assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,proxy);
 f.ctx.lookupPick(supplier._lookupBox,{value:'supplier',label:'Fictional supplier'});f.blur(proxy);assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(supplier.value,'supplier');
 const product=f.field('productChoice');f.ctx.lookupAttach(product);const productProxy=product._lookupBox.querySelector('input.lookup-input');productProxy.focus();productProxy.value='Rea';productProxy.dispatchEvent(new f.ctx.Event('input',{bubbles:true}));f.blur(productProxy);await f.submit();assert.equal(f.summary(),'1 field needs attention');assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.document.activeElement,productProxy);assert.equal(productProxy.value,'Rea');assert.equal(product.value,'');f.ctx.lookupPick(product._lookupBox,{value:'Reagent',label:'Reagent'});f.blur(productProxy);assert.equal(f.ctx.purchaseFormErrors(f.form).size,0);
});

test('valid edit keeps exact write args, stored prices, pending link and version',async()=>{
 const f=fixture({editing:true});f.field('quantity').value='4';f.field('note').value='  Line <note>  ';f.field('notes').value='Owner <notes>';f.field('expectedOn').value='2026-11-02';await f.submit();
 assert.deepEqual(f.calls,[{name:'save_purchase_request',args:{p_id:'order',p_expected_version:4,p_supplier_id:'supplier',p_currency:'USD',p_expected_on:'2026-11-02',p_notes:'Owner <notes>',p_lines:[{product_id:'p1',quantity:4,unit_price_minor:15750,pending_request_id:'pending',note:'Line <note>'}]}}]);assert.deepEqual(f.reads,[{table:'purchase_orders',id:'order'}]);assert.equal(f.get('purchaseOrders.find(row=>row.id==="order").version'),5);
});

test('invalid submit does not allocate an ID; unchanged uncertain retries retain the existing request ID',async()=>{
 const f=fixture();f.field('productChoice').value='Partial';await f.submit();assert.equal(f.calls.length,0);assert.equal(f.get('purchasePendingSave'),null);f.field('productChoice').value='Reagent';f.write=()=>{throw Error('Response unavailable');};await assert.rejects(f.submit(),/Response unavailable/);assert.equal(f.calls[0].args.p_id,'request-1');assert.equal(f.form.inert,false);assert.equal(f.field('productChoice').value,'Reagent');f.write=null;await f.submit();assert.equal(f.calls[1].args.p_id,'request-1');
});

test('product editing keeps the existing pending-link clearing behavior and does not change saved price',()=>{
 const f=fixture({editing:true}),row=f.rows()[0];f.field('productChoice').value='Tub';f.input(f.field('productChoice'));f.blur(f.field('productChoice'));assert.equal(row.dataset.pending,'');assert.equal(row.dataset.price,'15750');assert.equal(row.querySelector('[data-purchase-pending]').textContent,'For stock');assert.equal(f.field('productChoice').value,'Tub');
});

test('stale actor, epoch, request, section, route and replaced form suppress old blur, add and submit handlers',async()=>{
 for(const mode of ['actor','epoch','request','section','route','form']){
  const f=fixture(),old=f.form,add=f.document.querySelector('#addPurchaseLine').onclick;f.field('productChoice').value='Partial';if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='epoch')f.get('purchaseEpoch++');else if(mode==='request')f.get('purchaseWorkspaceRequest++');else if(mode==='section')f.get("purchaseSection='suppliers'");else if(mode==='route')f.ctx.view='personal';else f.document.querySelector('#content').innerHTML='<form id="purchaseForm"><input name="productChoice" value="Replacement"></form>';
  f.blur(f.field('productChoice'));add();await f.submit();assert.equal(old.querySelectorAll('.field-error').length,0);assert.equal(f.rows().length,1);assert.equal(f.calls.length,0);
 }
});
