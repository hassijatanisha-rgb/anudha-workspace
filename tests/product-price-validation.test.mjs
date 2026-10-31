import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
async function fixture({canEdit=true}={}){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 prototype.getBoundingClientRect=()=>({left:40,top:40,bottom:84,width:180,height:44});prototype.getClientRects=function(){return this.isConnected?[{}]:[];};
 Object.defineProperties(prototype,{disabled:{configurable:true,get(){return !!this._disabled;},set(value){this._disabled=!!value;if(value&&document.activeElement===this)document.activeElement=document.body;}},type:{configurable:true,get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}},form:{configurable:true,get(){return this.closest('form');}},classList:{configurable:true,get(){return {add:name=>this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' '),remove:name=>this.className=this.className.split(' ').filter(value=>value!==name).join(' '),contains:name=>this.className.split(' ').includes(name)};}},style:{configurable:true,get(){return this._style||=(Object.assign({setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}},{width:''}));}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};
 document.body.innerHTML='<div id="notice"></div><main id="content"></main>';const target=document.querySelector('#content'),actor={user_id:'owner',role:'owner'},calls=[],questions=[],focus=[];let sequence=0;
 const price=(currency,minor,version)=>({product_id:'product',currency,unit_price_minor:minor,version,updated_by:actor.user_id,updated_at:'2026-10-30T10:00:00.123456Z'}),row={id:'product',name:'Fictional <product>',sku:'P-001',company:'Example maker',specification:'200ml',prices:[price('TZS',125000,4),price('USD',500,2)]};
 const data=()=>({rows:[plain(row)],total:1,page:0,pages:1,totals:{products:1,configured:1,missing:0},can_edit:canEdit});
 const f={write:null,read:null};
 const ctx=vm.createContext({document,$:selector=>document.querySelector(selector),me:actor,busy:false,view:'prices',sessionLoadEpoch:1,statusTone,esc,window:{scrollX:0,scrollY:500,scrollTo(){},addEventListener(){}},clearTimeout(){},setTimeout:()=>1,getComputedStyle:()=>({visibility:'visible'}),crypto:{randomUUID:()=> 'request-'+(++sequence)},employeeName:()=> 'Fictional owner',CSS:{escape:value=>value},workspaceLoading(){},renderSearchPreservingPosition:(_input,fn)=>fn(),askConfirm:async options=>{questions.push(options);return true},client:{rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='product_price_page')return f.read?f.read(args):{data:data()};if(name!=='set_product_sale_price')throw Error('Unsupported fixture RPC '+name);if(f.write)return f.write(args);const saved=price(args.p_currency,args.p_unit_price_minor,args.p_expected_version+1);row.prices=row.prices.filter(value=>value.currency!==saved.currency).concat(saved);return {data:plain(saved)};}}});
 installPageHeader(ctx);for(const file of ['client-rules.js','product-pricing.js'])vm.runInContext(read(file),ctx);
 const app=read('app.js');vm.runInContext(read('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),ctx);
 const get=code=>vm.runInContext(code,ctx);await ctx.pricesWorkspace();await ctx.openProductPrice('product');
 const originalFocus=prototype.focus;prototype.focus=function(options){focus.push({node:this,summary:target.querySelector('[data-price-error]')?.textContent});return originalFocus.call(this,options);};
 Object.assign(f,{ctx,get,target,document,actor,calls,questions,focus,row,price,data,blur:control=>dispatchFocusout(control),field:(name,form=f.form)=>form.querySelector(`[name="${name}"]`),summary:()=>target.querySelector('[data-price-error]')?.textContent,submit:(form=f.form)=>form.onsubmit({preventDefault(){},submitter:form.querySelector('[type="submit"]')}),change:control=>{for(const {fn}of f.form.events.change||[])fn({target:control});},writes:()=>calls.filter(call=>call.name==='set_product_sale_price')});
 Object.defineProperties(f,{form:{get:()=>target.querySelector('[data-price-editor]')},ids:{get:()=>sequence}});
 if(f.form)f.field('reason').value='Approved price change';return f;
}

test('price form keeps current values and puts one error summary before its editable fields',async()=>{
 const f=await fixture();assert.equal(f.form.noValidate,true);assert.equal(f.field('price').value,'1,250.00');assert.equal(f.field('price').getAttribute('inputmode'),'decimal');assert.equal(f.field('price').required,true);assert.equal(f.field('reason').getAttribute('minlength'),'2');assert.equal(f.field('reason').getAttribute('maxlength'),'1000');assert.equal(f.form.querySelectorAll('[data-price-error]').length,1);assert.ok(f.form.innerHTML.indexOf('data-price-error')<f.form.innerHTML.indexOf('name="currency"'));
 const readonly=await fixture({canEdit:false});assert.equal(readonly.form,null);assert.equal(readonly.writes().length,0);
});

test('native focusout shows only the departed amount error without changing partial input, caret or focus',async()=>{
 const f=await fixture(),amount=f.field('price');amount.value='1,25';amount.setSelectionRange(2,2);amount.setAttribute('aria-describedby','price-help');f.field('reason').value='';f.field('reason').focus();f.blur(amount);
 assert.equal(amount.value,'1,25');assert.equal(amount.selectionStart,2);assert.equal(f.document.activeElement,f.field('reason'));assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(f.field('reason').getAttribute('aria-invalid'),null);assert.match(amount.getAttribute('aria-describedby'),/^price-help /);assert.equal(f.writes().length,0);
 amount.value='1,250.00';f.blur(amount);assert.equal(amount.getAttribute('aria-invalid'),null);assert.equal(amount.getAttribute('aria-describedby'),'price-help');assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('submit combines native and exact price errors, sets the count before first focus, and allocates no UUID',async()=>{
 const f=await fixture();f.field('price').value='90,000,000,000,000.01';f.field('reason').value=' ';await f.submit();assert.equal(f.summary(),'2 fields need attention');assert.equal(f.focus.at(-1).summary,'2 fields need attention');assert.equal(f.document.activeElement,f.field('price'));assert.equal(f.field('price').scrolledIntoView.block,'center');assert.equal(f.field('price').value,'90,000,000,000,000.01');assert.equal(f.ids,0);assert.equal(f.writes().length,0);
 f.field('price').value='0';f.blur(f.field('price'));assert.equal(f.summary(),'1 field needs attention');f.field('reason').value='Approved';f.blur(f.field('reason'));assert.equal(f.summary(),'');
});

test('native custom, length and constraint errors remain text and preserve disabled/readonly exclusions',async()=>{
 const f=await fixture(),reason=f.field('reason');reason._nativeError='<img src=x> Native error';await f.submit();assert.equal(f.summary(),'1 field needs attention');assert.equal(f.form.querySelector('img'),null);assert.match(reason.closest('label').textContent,/<img src=x>/);assert.equal(f.document.activeElement,reason);reason._nativeError='';reason.value='a'.repeat(1001);f.blur(reason);assert.match(reason.closest('label').textContent,/1000/);reason.value='Approved';reason.setCustomValidity('Review this reason');assert.equal(f.ctx.pricingEditorFieldError(reason,'TZS'),'Review this reason');reason.setCustomValidity('');f.blur(reason);assert.equal(reason.getAttribute('aria-invalid'),null);
 f.field('price').value='invalid';for(const state of ['disabled','readOnly']){f.field('price')[state]=true;assert.equal(f.ctx.pricingEditorFormErrors(f.form,'TZS').size,0);f.field('price')[state]=false;}
});

test('currency changes recheck touched amount errors using the selected configured price without blaming untouched fields',async()=>{
 const f=await fixture();f.field('price').value='1.';f.blur(f.field('price'));assert.equal(f.field('price').getAttribute('aria-invalid'),'true');f.field('reason').value='';f.field('currency').value='USD';f.change(f.field('currency'));assert.equal(f.field('price').value,'5.00');assert.equal(f.field('price').getAttribute('aria-invalid'),null);assert.equal(f.field('reason').getAttribute('aria-invalid'),null);assert.equal(f.writes().length,0);
 f.field('currency').value='EUR';await f.submit();assert.equal(f.document.activeElement,f.field('currency'));assert.match(f.field('currency').closest('label').textContent,/Choose the currency/);assert.equal(f.ids,0);
});

test('exact amount parser remains authoritative for grouped amounts and every supported boundary',async()=>{
 const f=await fixture(),amount=f.field('price');
 for(const [display,minor]of [['0',0],['0.01',1],['1,250.00',125000],['89,999,999,999,999.99',8999999999999999],['90,000,000,000,000.00',9000000000000000]]){amount.value=display;assert.equal(f.ctx.pricingEditorFieldError(amount,'TZS'),'');assert.equal(f.ctx.pricingInputMinor(f.ctx.pricingEditorAmount(display)),minor);}
 for(const display of ['','1.','1,25','12,,500','1.234,56','-1,250','1e3','1,250.001','90,000,000,000,000.01']){amount.value=display;assert.notEqual(f.ctx.pricingEditorFieldError(amount,'TZS'),'');assert.equal(amount.value,display);}
 assert.throws(()=>f.ctx.pricingInputMinor('1,250.00'));assert.equal(f.writes().length,0);
});

test('valid grouped save preserves exact RPC args, current version and one-record reread',async()=>{
 const f=await fixture();f.field('price').value='89,999,999,999,999.99';f.field('reason').value='  Approved <reason>  ';await f.submit();assert.deepEqual(f.writes(),[{name:'set_product_sale_price',args:{p_request_id:'request-1',p_product_id:'product',p_currency:'TZS',p_expected_version:4,p_unit_price_minor:8999999999999999,p_reason:'Approved <reason>'}}]);assert.deepEqual(f.calls.map(call=>call.name),['product_price_page','product_price_page','set_product_sale_price','product_price_page']);assert.equal(f.field('price').value,'89,999,999,999,999.99');assert.equal(f.get('productPriceDetail.row.prices.find(row=>row.currency==="TZS").version'),5);
});

test('real run keeps Save usable after a busy refusal and gives the original control stable feedback',async()=>{
 const f=await fixture(),button=f.form.querySelector('[type="submit"]'),label=button.textContent;f.ctx.busy=true;await f.submit();assert.equal(button.disabled,false);assert.equal(f.writes().length,0);assert.match(f.summary(),/Another action is still running/);f.ctx.busy=false;const held=deferred();f.write=()=>held.promise;button.focus();const saving=f.submit();assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.textContent,label);assert.equal(f.get('actionFeedbackActive.origin.node')===button,true);f.field('currency').value='USD';f.change(f.field('currency'));assert.equal(f.field('currency').value,'TZS');await f.submit();assert.equal(f.writes().length,1);held.resolve({error:{message:'Version changed; check the saved price.'}});await saving;assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.textContent,label);assert.match(f.summary(),/Version changed/);
});

test('unconfirmed save preserves the exact request and refuses altered values or currency without replaying a write',async()=>{
 const f=await fixture();f.field('price').value='1,500.00';f.write=()=>{throw Error('Response unavailable')};await f.submit();const original=plain(f.writes()[0].args);assert.match(f.summary(),/Response unavailable/);assert.equal(f.form.querySelector('[type="submit"]').disabled,false);f.field('price').value='1,600.00';await f.submit();assert.equal(f.writes().length,1);assert.match(f.summary(),/previous save was not confirmed/);assert.equal(f.form.querySelector('[type="submit"]').disabled,false);f.field('currency').value='USD';f.change(f.field('currency'));assert.equal(f.field('currency').value,'TZS');assert.equal(f.field('price').value,'1,600.00');
 f.field('price').value='1500.00';f.write=null;await f.submit();assert.equal(f.writes().length,2);assert.deepEqual(f.writes()[1].args,original);assert.equal(f.ids,1);
});

test('confirmed price with failed follow-up closes mutation controls and Retry reads without another write',async()=>{
 const f=await fixture();f.read=()=>({error:{message:'Read unavailable'}});const old=f.form;await f.submit();assert.equal(f.writes().length,1);assert.equal(f.form,null);assert.equal(old.isConnected,false);assert.match(f.target.querySelector('[data-price-detail]').textContent,/Price saved with history.*Read unavailable/);f.read=null;await f.target.querySelector('[data-price-retry-saved]').onclick();assert.equal(f.writes().length,1);assert.ok(f.form);assert.equal(f.get('productPriceDetail.row.prices.find(row=>row.currency==="TZS").version'),5);
});

test('stale actor, route, page/detail request and replacement form suppress old validation and submission',async()=>{
 for(const mode of ['actor','view','page','detail','form']){const f=await fixture(),old=f.form;f.field('price').value='bad';if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='view')f.ctx.view='personal';else if(mode==='page')f.get('productPriceViewEpoch++');else if(mode==='detail')f.get('productPriceDetailEpoch++');else f.target.querySelector('[data-price-detail]').innerHTML='<form data-price-editor><p>Replacement</p></form>';f.blur(old.querySelector('[name="price"]'));await f.submit(old);assert.equal(old.querySelectorAll('.field-error').length,0,mode);assert.equal(f.writes().length,0,mode);}
});

test('late rejected writes cannot put old errors into a current page or unlock stale mutation controls',async()=>{
 for(const mode of ['actor','view','detail','form']){const f=await fixture(),old=f.form,button=old.querySelector('[type="submit"]'),held=deferred();f.write=()=>held.promise;const saving=f.submit();if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='view')f.ctx.view='personal';else if(mode==='detail')f.get('productPriceDetailEpoch++');else f.target.querySelector('[data-price-detail]').innerHTML='<form data-price-editor><p>Replacement</p></form>';held.reject(Error('Old write error'));await saving;assert.doesNotMatch(f.document.body.textContent,/Old write error/,mode);assert.equal(button.disabled,true,mode);assert.equal(button.getAttribute('aria-busy'),null,mode);assert.equal(f.ctx.busy,false,mode);}
});


test('confirmed save restores the price field when native disabling moved originating button focus to body',async()=>{
 const f=await fixture(),button=f.form.querySelector('[type="submit"]');button.focus();const saving=f.submit();assert.equal(f.document.activeElement,f.document.body);assert.equal(f.get('actionFeedbackActive.origin.node'),button);await saving;assert.equal(f.document.activeElement,f.field('price'));assert.equal(f.field('price').value,'1,250.00');assert.equal(f.writes().length,1);
});

test('saved price reload never steals focus moved outside its panel while the read is pending',async()=>{
 const f=await fixture(),button=f.form.querySelector('[type="submit"]'),held=deferred(),reading=deferred();f.read=()=>{reading.resolve();return held.promise;};button.focus();const saving=f.submit();await reading.promise;assert.equal(f.form,null);const elsewhere=f.document.createElement('input');f.document.body.append(elsewhere);elsewhere.focus();held.resolve({data:f.data()});await saving;assert.equal(f.document.activeElement,elsewhere);assert.ok(f.form);assert.equal(f.writes().length,1);
});

test('saved price reload does not claim focus belonging to another control before the save',async()=>{
 const f=await fixture(),elsewhere=f.document.createElement('input');f.document.body.append(elsewhere);elsewhere.focus();await f.submit();assert.equal(f.document.activeElement,elsewhere);assert.equal(f.writes().length,1);
});

test('saving without an originating focused control leaves body focus alone',async()=>{
 const f=await fixture();f.document.body.focus();await f.submit();assert.equal(f.document.activeElement,f.document.body);assert.equal(f.writes().length,1);
});

test('a failed save returns focus to its originating button and preserves focus moved to another control',async()=>{
 for(const move of [false,true]){const f=await fixture(),button=f.form.querySelector('[type="submit"]'),held=deferred();f.write=()=>held.promise;button.focus();const saving=f.submit();assert.equal(f.document.activeElement,f.document.body);const elsewhere=f.field('reason');if(move)elsewhere.focus();held.resolve({error:{message:'Response unavailable'}});await saving;assert.equal(f.document.activeElement,move?elsewhere:button);assert.equal(button.disabled,false);assert.equal(f.writes().length,1);}
});

test('a confirmed save preserves focus moved to another control while the write is pending',async()=>{
 const f=await fixture(),button=f.form.querySelector('[type="submit"]'),held=deferred();f.write=args=>held.promise.then(()=>({data:f.price(args.p_currency,args.p_unit_price_minor,args.p_expected_version+1)}));button.focus();const saving=f.submit(),elsewhere=f.document.createElement('input');f.document.body.append(elsewhere);elsewhere.focus();f.row.prices[0]=f.price('TZS',125000,5);held.resolve();await saving;assert.equal(f.document.activeElement,elsewhere);assert.equal(f.writes().length,1);assert.ok(f.form);
});


test('price: action blur retains corrected error layout until the first submit',async()=>{
 const f=await fixture();const form=f.form,control=f.field('reason'),button=form.querySelector('[type="submit"]');control.value=' ';await f.submit();const error=form.querySelector('.field-error');assert.ok(error);assert.equal(f.summary(),'1 field needs attention');control.value='Approved price change';
 dispatchFocusout(control,button);assert.equal(form.querySelector('.field-error'),error);assert.equal(f.summary(),'1 field needs attention');assert.equal(f.writes().length,0);
 await f.submit();assert.equal(f.writes().length,1);assert.equal(f.writes()[0].args.p_reason,'Approved price change');assert.equal(f.writes()[0].args.p_unit_price_minor,125000);
});

test('price: deferred action blur still rejects invalid submit and ordinary field blur clears correction',async()=>{
 const f=await fixture();const form=f.form,control=f.field('reason'),button=form.querySelector('[type="submit"]');control.value=' ';dispatchFocusout(control,button);assert.equal(form.querySelectorAll('.field-error').length,0);await f.submit();assert.equal(f.writes().length,0);assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,control);
 const error=form.querySelector('.field-error'),external=f.document.createElement('button');f.document.body.append(external);control.value='Approved price change';dispatchFocusout(control,external);assert.equal(form.querySelector('.field-error'),error);assert.equal(f.summary(),'1 field needs attention');const next=f.field('price');next.focus();dispatchFocusout(control,next);assert.equal(form.querySelectorAll('.field-error').length,0);assert.equal(f.summary(),'');assert.equal(f.document.activeElement,next);assert.equal(f.writes().length,0);
});
