import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {installLookupDom} from './helpers/lookup-dom.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 prototype.before=function(node){this.parentElement.insertBefore(node,this);};
 delete document.body.hidden;
 Object.defineProperties(prototype,{hidden:{configurable:true,get(){return this.getAttribute('hidden')!==null;},set(value){if(value)this.setAttribute('hidden','');else this.removeAttribute('hidden');}},type:{get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}},required:{get(){return this.getAttribute('required')!==null;},set(value){if(value)this.setAttribute('required','');else this.removeAttribute('required');}},lastElementChild:{get(){return this.children.filter(node=>node.tag).at(-1)||null;}}});
 document.body.innerHTML='<main id="content"></main>';const actor={user_id:'sales',role:'staff'},calls=[],messages=[],runs=[],focus=[];
 class Fields{constructor(form){this.rows=form.querySelectorAll('[name]').filter(node=>!node.disabled).map(node=>[node.name,node.value]);}get(name){return this.rows.find(row=>row[0]===name)?.[1]??null;}[Symbol.iterator](){return this.rows[Symbol.iterator]();}}
 const storage=new Map();const ctx=vm.createContext({hasArea:()=>true,sessionLoadEpoch:1,location:{hash:'#/go/sales/proformas'},setTimeout,clearTimeout,TextEncoder,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},document,$:selector=>document.querySelector(selector),window:{addEventListener(){}},FormData:Fields,me:actor,view:'sales',busy:false,crypto:{randomUUID:()=> 'request-id'},companyDate:offset=>offset?'2026-11-14':'2026-10-30',
  esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),organizations:[{id:'branch',name:'Clinic'}],contacts:[{id:'contact',organization_id:'branch',status:'kept',first_name:'Jane',last_name:'Doe'}],products:[{id:'product',name:'Reagent'}],orgIndex:new Map(),
  inventoryOption:(id,label,selected)=>`<option value="${id}" ${selected?'selected':''}>${label}</option>`,inventoryProductChoice:p=>p.name,inventoryProductFromChoice:value=>value==='Reagent'?{id:'product',name:'Reagent'}:null,message:(...args)=>messages.push(args),
  actionFeedbackReference:node=>({node}),actionFeedbackShow:(_ref,text,_kind,target)=>{target.textContent=text;},
  client:{rpc:async(name,args)=>{calls.push({name,args});const totals=args.p_lines.map(ctx.proformaLineTotal);return {data:{id:args.p_id,version:args.p_expected_version+1,revision:1,status:'draft',document_number:'PF-FIXTURE',prepared_by:actor.user_id,organization_id:args.p_organization_id,contact_id:args.p_contact_id,currency:args.p_currency,valid_until:args.p_valid_until,delivery_period:args.p_delivery_period.trim(),payment_terms:args.p_payment_terms.trim(),notes:args.p_notes.trim(),commercial_kind:args.p_commercial_kind,contract_id:args.p_contract_id,installation_required:args.p_installation_required,installation_charge_notes:args.p_installation_charge_notes.trim(),internal_notes:args.p_internal_notes.trim(),subtotal_minor:totals.reduce((sum,l)=>sum+l.gross,0),discount_minor:totals.reduce((sum,l)=>sum+l.discount,0),tax_minor:totals.reduce((sum,l)=>sum+l.tax,0),total_minor:totals.reduce((sum,l)=>sum+l.total,0)}};}}});
 for(const file of ['row-index.js','client-rules.js','sales-domain.js','product-pricing.js','proforma-commercial.js','sales-delivery.js'])vm.runInContext(read(file),ctx);
 ctx.run=(fn,options)=>{const promise=fn();runs.push({promise,options});return promise;};ctx.proformaShowExisting=()=>{};
 vm.runInContext("salesEditing='new';productPricingActor=me;productSalePrices.set('product:TZS',{unit_price_minor:10000});",ctx);
 const content=document.querySelector('#content');content.innerHTML=ctx.proformaEditor();const form=document.querySelector('#proformaForm'),field=(name,row=form)=>row.querySelector(`[name="${name}"]`),row=()=>form.querySelector('[data-proforma-line]');
 for(const [name,value]of Object.entries({organizationId:'branch',contactId:'contact',productChoice:'Reagent',description:'Reagent description',unitPrice:'100.00'}))field(name).value=value;
 const originalFocus=prototype.focus;prototype.focus=function(options){focus.push({node:this,summary:form.querySelector('[data-proforma-errors]').textContent,options});originalFocus.call(this,options);};
 ctx.bindSalesDelivery();
 const fire=(node,type)=>{for(let current=node;current;current=current.parentElement){for(const {fn}of current.events[type]||[])fn({target:node,currentTarget:current,preventDefault(){},submitter:form.querySelector('[type="submit"]')});}};
 const lookups=()=>{Object.assign(ctx,{inventorySelectableProducts:()=>ctx.products,inventoryClassification:()=>({category:'reagents'}),inventoryProductIdentity:product=>product.name,catalogLabel:()=> 'Reagent',setWorkspacePopover:(node,open)=>{node.hidden=!open;}});installLookupDom(ctx);ctx.lookupAttach(field('organizationId'));ctx.lookupAttach(field('productChoice'));};
 return {ctx,actor,document,content,form,calls,messages,runs,focus,field,row,fire,lookups,summary:()=>form.querySelector('[data-proforma-errors]').textContent,submit:()=>ctx.saveProformaForm(form),get:code=>vm.runInContext(code,ctx)};
}

test('submit collects header and repeated-row errors before the writer, reports count before DOM-order focus',async()=>{
 const f=fixture(),first=f.row();f.field('deliveryPeriod').value='   ';f.field('description',first).value=' ';
 f.form.querySelector('#proformaLines').insertAdjacentHTML('beforeend',f.ctx.salesLineRow({product_id:'product',description:'Second',quantity:1,unit_price_minor:10000}));const second=f.form.querySelectorAll('[data-proforma-line]')[1];f.field('quantity',second).value='0';
 await f.submit();assert.equal(f.form.noValidate,true);assert.equal(f.calls.length,0);assert.equal(f.summary(),'3 fields need attention');assert.equal(f.document.activeElement,f.field('deliveryPeriod'));assert.equal(f.focus.at(-1).summary,'3 fields need attention');assert.equal(f.field('deliveryPeriod').scrolledIntoView.block,'center');assert.equal(f.field('deliveryPeriod').value,'   ');assert.equal(f.field('description',first).value,' ');assert.equal(f.field('quantity',second).value,'0');assert.equal(f.field('discount',second).getAttribute('aria-invalid'),null);
});

test('blur validates only the departed control, preserves its help and never moves focus or typed values',()=>{
 const f=fixture();f.field('description').setAttribute('aria-describedby','description-help');f.field('description').value='  ';f.field('paymentTerms').value='';f.field('notes').focus();f.fire(f.field('description'),'focusout');
 assert.equal(f.document.activeElement,f.field('notes'));assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.match(f.field('description').getAttribute('aria-describedby'),/^description-help /);assert.equal(f.field('paymentTerms').getAttribute('aria-invalid'),null);assert.equal(f.field('description').value,'  ');
 f.field('description').value='Retained text';f.fire(f.field('description'),'focusout');assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.field('description').getAttribute('aria-describedby'),'description-help');
});

test('corrected text keeps its error and summary stable through change and Save blur until the first submit',async()=>{
 const f=fixture(),control=f.field('description'),save=f.form.querySelector('[type="submit"]');control.value='';await f.submit();const error=control.closest('label').querySelector('.field-error');assert.ok(error);assert.equal(f.summary(),'1 field needs attention');
 control.value='Corrected description';f.fire(control,'change');assert.equal(control.closest('label').querySelector('.field-error'),error);save.focus();dispatchFocusout(control,save);assert.equal(control.closest('label').querySelector('.field-error'),error);assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,save);assert.equal(f.calls.length,0);
 f.fire(f.form,'submit');await f.runs.at(-1).promise;assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_lines[0].description,'Corrected description');assert.equal(f.calls[0].args.p_id,'request-id');assert.equal(f.summary(),'');assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.form.dataset.version,'1');
});

test('an action blur does not add errors before submit, which still validates and focuses the first field',async()=>{
 const f=fixture(),control=f.field('description'),save=f.form.querySelector('[type="submit"]');control.value='';save.focus();f.fire(control,'change');dispatchFocusout(control,save);assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.summary(),'');assert.equal(f.document.activeElement,save);
 f.fire(f.form,'submit');await f.runs.at(-1).promise;assert.equal(f.calls.length,0);assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,control);
});

test('external action blur retains corrected feedback while an ordinary field blur clears it',async()=>{
 const f=fixture(),control=f.field('description'),action=f.document.createElement('a');action.setAttribute('href','#other');f.document.body.append(action);control.value='';await f.submit();const error=control.closest('label').querySelector('.field-error');control.value='Corrected description';f.fire(control,'change');dispatchFocusout(control,action);assert.equal(control.closest('label').querySelector('.field-error'),error);assert.equal(f.summary(),'1 field needs attention');
 f.field('notes').focus();dispatchFocusout(control,f.field('notes'));assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.summary(),'');assert.equal(f.document.activeElement,f.field('notes'));assert.equal(f.calls.length,0);
});

test('date, range, step and custom native errors remain authoritative; readonly price errors focus the product',async()=>{
 const f=fixture();f.field('validUntil')._nativeError='Choose a date on or after today.';f.field('tax')._nativeError='Use a multiple of 0.01.';await f.submit();assert.equal(f.summary(),'2 fields need attention');assert.equal(f.calls.length,0);assert.equal(f.document.activeElement,f.field('validUntil'));
 f.field('validUntil')._nativeError='';f.field('tax')._nativeError='';f.field('unitPrice').value='80.00';await f.submit();assert.equal(f.calls.length,0);assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,f.field('productChoice'));assert.match(f.field('productChoice').validationMessage,/Saved unit price differs/);assert.equal(f.field('unitPrice').value,'80.00');assert.equal(f.field('unitPrice').readOnly,true);
});

test('conditional placement and discount fields clear obsolete errors without displaying untouched errors',async()=>{
 const f=fixture();f.field('commercialKind').value='placement';f.fire(f.field('commercialKind'),'change');assert.equal(f.field('contractId').required,true);await f.submit();assert.equal(f.calls.length,0);assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,f.field('contractId'));
 f.field('commercialKind').value='sale';f.fire(f.field('commercialKind'),'change');assert.equal(f.field('contractId').required,false);assert.equal(f.field('contractId').closest('label').hidden,true);assert.equal(f.summary(),'');
 f.field('discountMode').value='amount';f.fire(f.field('discountMode'),'change');f.field('discountAmount').value='101.00';f.fire(f.field('discountAmount'),'input');f.fire(f.field('discountAmount'),'focusout');assert.match(f.field('discountAmount').validationMessage,/cannot exceed/);
 f.field('discountMode').value='percent';f.fire(f.field('discountMode'),'change');assert.equal(f.field('discountAmount').disabled,true);assert.equal(f.field('discountAmount').getAttribute('aria-invalid'),null);assert.equal(f.field('discountAmount').validationMessage,'');assert.equal(f.summary(),'');
});

test('new and removed rows keep independent error identity and recompute the visible error count',async()=>{
 const f=fixture();f.fire(f.form.querySelector('#addSalesLine'),'click');const second=f.form.querySelectorAll('[data-proforma-line]')[1];f.field('description').value='';f.field('description',second).value='';await f.submit();
 assert.equal(f.summary(),'3 fields need attention');const before=f.field('description').getAttribute('aria-describedby');assert.notEqual(before,f.field('description',second).getAttribute('aria-describedby'));
 f.fire(second.querySelector('[data-remove-sales-line]'),'click');assert.equal(f.summary(),'1 field needs attention');assert.equal(f.field('description').getAttribute('aria-describedby'),before);assert.equal(f.form.querySelectorAll('[data-proforma-line]').length,1);
});

test('valid save retains the exact existing RPC values, configured-price math and confirmed version',async()=>{
 const f=fixture();f.field('notes').value='<customer notes>';f.field('quantity').value='2';f.field('discount').value='10';f.field('tax').value='18';f.field('description').value='  Reagent description  ';await f.submit();
 assert.deepEqual(plain(f.calls),[{name:'save_sales_proforma',args:{p_id:'request-id',p_expected_version:0,p_organization_id:'branch',p_contact_id:'contact',p_currency:'TZS',p_valid_until:'2026-11-14',p_delivery_period:'As agreed after acceptance',p_payment_terms:'Payment before delivery',p_notes:'<customer notes>',p_lines:[{productId:'product',description:'Reagent description',quantity:2,uom:'unit',unitPriceMinor:10000,discountBasisPoints:1000,taxBasisPoints:1800}],p_commercial_kind:'sale',p_contract_id:null,p_installation_required:true,p_installation_charge_notes:'',p_internal_notes:''}}]);
 assert.equal(f.form.dataset.version,'1');assert.equal(f.form.dataset.id,'request-id');assert.equal(f.ctx.salesEditorChanged(f.form),false);assert.equal(f.field('notes').value,'<customer notes>');assert.equal(f.field('unitPrice').value,'100.00');assert.equal(f.field('unitPrice').readOnly,true);assert.equal(f.field('discountAmount').disabled,true);
});

test('actor, epoch, request, route and detached-form replacements suppress stale validation and saves',async()=>{
 for(const mode of ['actor','epoch','request','route','form']){const f=fixture();f.field('description').value='';if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='epoch')f.get('salesEpoch++');else if(mode==='request')f.get('salesWorkspaceRequest++');else if(mode==='route')f.ctx.view='personal';else f.content.innerHTML='<form id="proformaForm"><input name="description" value="New editor"></form>';
  f.fire(f.field('description'),'focusout');assert.equal(f.form.querySelectorAll('.field-error').length,0);await assert.rejects(f.submit(),/Reopen the Pro forma/);assert.equal(f.calls.length,0);
 }
});

test('late confirmed save after another workspace request does not publish to the retained old form',async()=>{
 const f=fixture();let resolve;f.ctx.client.rpc=(name,args)=>{f.calls.push({name,args});return new Promise(r=>resolve=r);};const saving=f.submit();f.get('salesWorkspaceRequest++');resolve({data:{id:'request-id',version:1}});await saving;assert.equal(f.form.dataset.id,'');assert.equal(f.form.dataset.version,'0');assert.equal(f.form.querySelector('[data-sales-saved]'),null);assert.equal(f.get('salesProformas.length'),0);
});

test('shared error output escapes content and submit binding uses the pressed Save control and top summary',async()=>{
 const f=fixture();f.field('validUntil')._nativeError='<img src=x onerror=bad>';f.fire(f.form,'submit');await f.runs.at(-1).promise;assert.equal(f.form.querySelector('img'),null);assert.match(f.field('validUntil').closest('label').textContent,/<img/);assert.equal(f.runs.at(-1).options.origin,f.form.querySelector('[type="submit"]'));assert.equal(f.runs.at(-1).options.errorTarget,f.form.querySelector('[data-proforma-errors]'));
});

test('correcting a quantity clears its prior custom error without blaming or changing discount entry',async()=>{
 const f=fixture();f.field('quantity').value='0';f.field('discount').value='10.00';await f.submit();assert.equal(f.summary(),'1 field needs attention');assert.match(f.field('quantity').validationMessage,/positive whole/);assert.equal(f.field('discount').validationMessage,'');
 f.field('quantity').value='1';f.fire(f.field('quantity'),'focusout');assert.equal(f.field('quantity').validationMessage,'');assert.equal(f.field('quantity').getAttribute('aria-invalid'),null);assert.equal(f.summary(),'');assert.equal(f.field('discount').value,'10.00');assert.equal(f.calls.length,0);
});

test('current configured-price and exact amount-discount failures block save without replacing entered values',async()=>{
 const f=fixture();f.get("productSalePrices.set('product:TZS',{unit_price_minor:1000000})");await f.submit();assert.match(f.field('productChoice').validationMessage,/Saved unit price differs/);assert.equal(f.field('unitPrice').value,'100.00');assert.equal(f.calls.length,0);
 f.fire(f.field('productChoice'),'change');f.field('discountMode').value='amount';f.fire(f.field('discountMode'),'change');f.field('discountAmount').value='0.01';await f.submit();assert.match(f.field('discountAmount').validationMessage,/cannot be represented/);assert.equal(f.field('discountAmount').value,'0.01');assert.equal(f.document.activeElement,f.field('discountAmount'));assert.equal(f.calls.length,0);
});

test('write failure leaves values editable and later blur cannot clear the server error summary',async()=>{
 const f=fixture();f.ctx.client.rpc=async()=>({error:{message:'Version changed',code:'P0001'}});await assert.rejects(f.submit(),error=>error.message==='Version changed');f.form.querySelector('[data-proforma-errors]').textContent='Version changed';f.fire(f.field('description'),'focusout');assert.equal(f.summary(),'Version changed');assert.equal(f.field('description').disabled,false);assert.equal(f.field('description').value,'Reagent description');assert.equal(f.form.dataset.version,'0');
});

test('actual lookup submit counts missing client and product once each and focuses the visible first field',async()=>{
 const f=fixture();f.lookups();f.field('organizationId').value='';f.field('productChoice').value='';await f.submit();assert.equal(f.calls.length,0);assert.equal(f.summary(),'2 fields need attention');assert.equal(f.form.querySelectorAll('.field-error').length,2);assert.ok(f.document.activeElement===f.field('organizationId')._lookupBox.querySelector('input.lookup-input'));assert.equal(f.field('productChoice').hidden,true);
});

test('actual lookup blur tracks the canonical product and correction clears its sole error without changing prices',async()=>{
 const f=fixture();f.lookups();const product=f.field('productChoice'),proxy=product._lookupBox.querySelector('input.lookup-input');f.field('unitPrice').value='80.00';f.field('notes').focus();f.fire(proxy,'focusout');assert.equal(f.document.activeElement,f.field('notes'));assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.match(proxy.closest('label').textContent,/Saved unit price differs/);assert.equal(f.field('unitPrice').value,'80.00');
 await f.submit();assert.equal(f.summary(),'1 field needs attention');assert.ok(f.document.activeElement===proxy);f.field('unitPrice').value='100.00';f.fire(f.field('currency'),'change');assert.equal(f.summary(),'');assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(product.value,'Reagent');assert.equal(f.calls.length,0);
});

test('valid actual lookup submission keeps canonical IDs, configured price and one original writer call',async()=>{
 const f=fixture();f.lookups();await f.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_organization_id,'branch');assert.equal(f.calls[0].args.p_lines[0].productId,'product');assert.equal(f.calls[0].args.p_lines[0].unitPriceMinor,10000);assert.equal(f.calls[0].args.p_expected_version,0);assert.equal(f.calls[0].args.p_id,'request-id');assert.equal(f.form.dataset.version,'1');
});

test('new repeated product lookups remain independent, and stale proxy blur cannot mark another session',async()=>{
 const f=fixture();f.lookups();f.fire(f.form.querySelector('#addSalesLine'),'click');const second=f.form.querySelectorAll('[data-proforma-line]')[1],source=f.field('productChoice',second);f.ctx.lookupAttach(source);f.field('productChoice').value='';f.field('description',second).value='New row';await f.submit();assert.equal(f.summary(),'2 fields need attention');const proxies=[f.field('productChoice'),source].map(control=>control._lookupBox.querySelector('input.lookup-input'));assert.notEqual(proxies[0].getAttribute('aria-describedby'),proxies[1].getAttribute('aria-describedby'));assert.ok(f.document.activeElement===proxies[0]);
 f.ctx.showFieldErrors(f.form,{});f.ctx.me={...f.actor};f.fire(proxies[1],'focusout');assert.equal(f.form.querySelectorAll('.field-error').length,0);assert.equal(f.calls.length,0);
});
