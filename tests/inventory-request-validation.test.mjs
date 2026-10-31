import {installWorkspaceFormSnapshot} from './helpers/workspace-form-snapshot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(){
 const document=dom();installNativeFormControls(document);const prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};prototype.prepend=function(node){if(this.children[0]!==node)this.insertBefore(node,this.children[0]||null);};prototype.getBoundingClientRect=()=>({left:40,top:40,bottom:84,width:180,height:44});prototype.getClientRects=function(){return this.isConnected?[{}]:[];};
 prototype.reset=function(){for(const input of this.querySelectorAll('input,select,textarea'))input.value=input.tag==='select'?(input.querySelector('option[selected]')||input.querySelector('option'))?.getAttribute('value')||'':input.tag==='textarea'?input.textContent:input.getAttribute('value')||'';};
 Object.defineProperties(prototype,{outerHTML:{configurable:true,get(){return this.tag?`<${this.tag}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('')}>${this.innerHTML}${['input','br','hr','img','meta','link'].includes(this.tag)?'':`</${this.tag}>`}`:this._text;}},hidden:{configurable:true,get(){return this.getAttribute('hidden')!==null;},set(value){if(value)this.setAttribute('hidden','');else this.removeAttribute('hidden');}},disabled:{configurable:true,get(){return !!this._disabled;},set(value){this._disabled=!!value;if(value&&document.activeElement===this)document.activeElement=document.body;}},inert:{configurable:true,get(){return !!this._inert;},set(value){this._inert=!!value;if(value&&this.contains(document.activeElement))document.activeElement=document.body;}},required:{configurable:true,get(){return this.getAttribute('required')!==null;},set(value){if(value)this.setAttribute('required','');else this.removeAttribute('required');}},type:{configurable:true,get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}},form:{configurable:true,get(){return this.closest('form');}},classList:{configurable:true,get(){return {add:name=>this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' '),remove:name=>this.className=this.className.split(' ').filter(value=>value!==name).join(' '),contains:name=>this.className.split(' ').includes(name)};}},style:{configurable:true,get(){return this._style||={setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}};}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};document.body.innerHTML='<div id="notice"></div><main id="content"></main>';
 const actor={user_id:'owner',role:'owner'},calls=[],focus=[],product={id:'product',name:'Fictional product',sku:'SKU'},pack={id:'pack',product_id:'product',units_per_carton:3,version:2,base_unit:'piece'},places=[{id:'from',name:'Source',code:'SRC',active:true,is_dispatch_hub:false},{id:'to',name:'Destination',code:'DST',active:true,is_dispatch_hub:false},{id:'inactive',name:'Inactive',code:'OLD',active:false}],lot={id:'lot',product_id:'product',pack_definition_id:'pack',location_id:'from',sealed_cartons:10,loose_units:0,reserved_units:0,stock_status:'available',batch_number:'Batch',expiry_date:'2020-01-01',version:7};let sequence=0;
 const rows=[{id:'existing',product_name:'Existing product',from_name:'Source',to_name:'Destination',cartons:1,expected_units:3,expected_at:'2026-10-30',base_unit:'piece',status:'requested'}],f={write:null,read:null};
 const ctx=vm.createContext({document,$:selector=>document.querySelector(selector),me:actor,busy:false,view:'inventory',esc,window:{scrollX:12,scrollY:300,scrollTo({left,top}){this.scrollX=left;this.scrollY=top;},addEventListener(){}},clearTimeout(){},setTimeout:()=>1,getComputedStyle:()=>({visibility:'visible'}),crypto:{randomUUID:()=> 'request-'+(++sequence)},CSS:{escape:String},workspaceLoading(){},renderSearchPreservingPosition:(_input,fn)=>fn(),syncWorkspaceNavigation(){},hasArea:()=>true,products:[product],organizations:[],rowById:(rows,id)=>rows.find(row=>row.id===id),reviewedCatalogProduct:row=>row,companyDate:()=> '2026-10-30',productReviewLoadError:'',productDetailReviews:new Map(),FormData:class{constructor(form){this.form=form;}get(name){const input=this.form.querySelector(`[name="${name}"]`);return input&&!input.disabled?input.value:null;}},client:{rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='inventory_operations_page')return f.read?f.read(args):{data:f.page()};assert.equal(name,'request_inventory_transfer');if(f.write)return f.write(args);rows.unshift({id:args.p_id,product_name:product.name,from_name:'Source',to_name:'Destination',cartons:args.p_cartons,expected_units:args.p_cartons*pack.units_per_carton,expected_at:args.p_expected_at,base_unit:pack.base_unit,status:'requested'});return {data:{id:args.p_id}};}}});
 installPageHeader(ctx);installWorkspaceFormSnapshot(ctx);for(const file of ['status-ui.js','client-rules.js','inventory-domain.js','inventory-operations.js'])vm.runInContext(read(file),ctx);const app=read('app.js');vm.runInContext(read('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),ctx);
 const run=ctx.run;ctx.run=(...args)=>ctx.running=run(...args);const get=code=>vm.runInContext(code,ctx);f.page=()=>({section:'transfers',rows:plain(rows),page:0,pages:1,total:rows.length,totals:{all:rows.length,requested:rows.length,in_transit:0,received:0,quarantine:0,cancelled:0}});
 ctx.seed={lots:[lot,{...lot,id:'other-lot',location_id:'to',sealed_cartons:20}],packs:[pack],places};ctx.page=f.page();get("inventoryActor=me;inventorySection='transfers';inventoryOperationsSection='transfers';inventoryOperationsData=page;inventoryLots=seed.lots;inventoryPacks=seed.packs;inventoryLocations=seed.places;inventoryTransferReady=true;inventoryTransferId='new';inventoryLoaded=true;paintInventoryOperations()");
 const originalFocus=prototype.focus;prototype.focus=function(options){focus.push({node:this,summary:this.closest('form')?.querySelector('[data-inventory-request-error]')?.textContent});return originalFocus.call(this,options);};
 const form=document.querySelector('form[data-inventory-action="request"]');Object.assign(f,{ctx,get,document,actor,calls,focus,rows,pack,lot,form,blur:control=>dispatchFocusout(control),summary:()=>form.querySelector('[data-inventory-request-error]')?.textContent,submit:async()=>{ctx.running=null;const result=form.onsubmit({preventDefault(){},submitter:form.querySelector('[type="submit"]')});await(result??ctx.running);},writes:()=>calls.filter(call=>call.name!=='inventory_operations_page')});Object.defineProperty(f,'ids',{get:()=>sequence});
 form.elements.sourceLotId.value='lot';form.elements.toLocationId.value='to';form.elements.cartons.value='2';form.elements.expectedAt.value='2026-11-01';form.elements.reason.value='Checked carton seals';return f;
}

test('the request form receives one top summary and one blur listener',()=>{
 const f=fixture(),form=f.form;assert.equal(form.noValidate,true);assert.equal(form.querySelectorAll('[data-inventory-request-error]').length,1);assert.ok(form.innerHTML.indexOf('data-inventory-request-error')<form.innerHTML.indexOf('class="grid"'));assert.equal(form.events.focusout.length,1);f.ctx.bindInventoryWorkspace();assert.equal(form.events.focusout.length,1);
});

test('blur shows only the departed error and preserves draft, caret, descriptions and focus',()=>{
 const f=fixture(),form=f.form,cartons=form.elements.cartons;cartons.value='1.5';cartons.setSelectionRange(1,2);cartons.setAttribute('aria-describedby','carton-help');form.elements.reason.value='';form.elements.reason.focus();f.blur(cartons);assert.equal(form.querySelectorAll('.field-error').length,1);assert.equal(form.elements.reason.getAttribute('aria-invalid'),null);assert.equal(f.document.activeElement,form.elements.reason);assert.equal(cartons.value,'1.5');assert.equal(cartons.selectionStart,1);assert.equal(cartons.selectionEnd,2);assert.match(cartons.getAttribute('aria-describedby'),/^carton-help /);cartons.value='2';f.blur(cartons);assert.equal(cartons.getAttribute('aria-describedby'),'carton-help');assert.equal(cartons.getAttribute('aria-invalid'),null);assert.equal(f.ids,0);
});

test('all native and domain errors are counted before DOM-first focus without allocating UUIDs',async()=>{
 const f=fixture(),form=f.form;form.elements.sourceLotId.value='';form.elements.toLocationId.value='';form.elements.cartons.value='0';form.elements.expectedAt.value='';form.elements.reason.value=' ';await f.submit();assert.equal(f.summary(),'5 fields need attention');assert.equal(f.focus.at(-1).summary,'5 fields need attention');assert.equal(f.document.activeElement,form.elements.sourceLotId);assert.equal(form.elements.sourceLotId.scrolledIntoView.block,'center');assert.equal(f.ids,0);assert.equal(f.writes().length,0);form.elements.sourceLotId.value='lot';f.blur(form.elements.sourceLotId);assert.equal(f.summary(),'4 fields need attention');
});

test('available-stock, saved-pack, active/different-destination and exact carton planner rules stay field-local',async()=>{
 for(const [change,field,message] of [
  [f=>f.form.elements.sourceLotId.value='missing','sourceLotId',/available source/],
  [f=>f.get("inventoryLots[0].stock_status='quarantine'"),'sourceLotId',/available source/],
  [f=>f.get('inventoryLots[0].sealed_cartons=0'),'sourceLotId',/available source/],
  [f=>f.get('inventoryPacks=[]'),'sourceLotId',/saved product/],
  [f=>f.form.elements.toLocationId.value='inactive','toLocationId',/active destination/],
  [f=>f.form.elements.toLocationId.value='from','toLocationId',/different destination/],
  [f=>f.form.elements.cartons.value='11','cartons',/Only 10 sealed cartons/],
  [f=>f.form.elements.cartons.value='9007199254740992','cartons',/whole number/],
  [f=>{f.get('inventoryPacks[0].units_per_carton=9007199254740991');},'cartons',/too large/]
 ]){const f=fixture();change(f);await f.submit();assert.equal(f.summary(),'1 field needs attention');assert.equal(f.document.activeElement,f.form.elements[field]);assert.match(f.form.elements[field].closest('label').textContent,message);assert.equal(f.ids,0);assert.equal(f.writes().length,0);}
});

test('changing the source revalidates only touched or submitted dependent fields',async()=>{
 const f=fixture(),form=f.form;form.elements.cartons.value='11';form.elements.toLocationId.value='from';f.blur(form.elements.sourceLotId);assert.equal(form.querySelectorAll('.field-error').length,0);await f.submit();assert.equal(f.summary(),'2 fields need attention');form.elements.sourceLotId.value='other-lot';form.elements.reason.focus();f.blur(form.elements.sourceLotId);assert.equal(f.summary(),'');assert.equal(form.querySelectorAll('.field-error').length,0);assert.equal(f.document.activeElement,form.elements.reason);assert.equal(form.elements.cartons.value,'11');
});

test('native flags are retained as plain text and disabled/read-only controls are excluded',async()=>{
 const f=fixture(),form=f.form,reason=form.elements.reason;reason.setCustomValidity('<img src=x> Native rule');await f.submit();assert.equal(f.document.activeElement,reason);assert.equal(form.querySelector('.field-error').textContent,'⚠ <img src=x> Native rule');assert.equal(form.querySelector('.field-error').children.length,0);reason.setCustomValidity('');form.elements.expectedAt._nativeError='Enter a valid date.';await f.submit();assert.equal(f.document.activeElement,form.elements.expectedAt);form.elements.expectedAt._nativeError='';form.elements.cartons.disabled=true;form.elements.cartons.value='bad';reason.readOnly=true;reason.value='';assert.equal(f.ctx.inventoryRequestFormErrors(form).size,0);
});

test('lookup identity reports one error and focuses the visible source control',async()=>{
 const f=fixture(),form=f.form,source=form.elements.sourceLotId,label=source.closest('label'),box=f.document.createElement('div');box.className='lookup';label.append(box);box.append(source);const input=f.document.createElement('input');input.className='lookup-input';box.append(input);box._lookupSource=source;source._lookupBox=box;source.value='';source.hidden=true;input.value='Unselected stock';input.setAttribute('aria-describedby','stock-help');await f.submit();assert.equal(f.document.activeElement,input);assert.equal(source.getAttribute('aria-invalid'),null);assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(form.querySelectorAll('.field-error').length,1);source.value='lot';f.blur(input);assert.equal(input.getAttribute('aria-invalid'),null);assert.equal(input.getAttribute('aria-describedby'),'stock-help');assert.equal(f.writes().length,0);
});

test('busy refusal keeps the request usable without entering its writer',async()=>{
 const f=fixture(),button=f.form.querySelector('[type="submit"]');f.ctx.busy=true;button.focus();await f.submit();assert.equal(button.disabled,false);assert.equal(f.form.inert,false);assert.notEqual(f.form.dataset.saving,'true');assert.equal(f.ids,0);assert.equal(f.writes().length,0);assert.match(f.summary(),/Wait/);
});

test('real run locks the request, prevents duplicates and restores the same draft after rejection',async()=>{
 const f=fixture(),form=f.form,button=form.querySelector('[type="submit"]'),write=deferred();f.write=()=>write.promise;button.focus();const pending=f.submit();assert.equal(f.get('actionFeedbackActive.origin.node'),button);assert.equal(form.inert,true);assert.equal(form.dataset.saving,'true');assert.equal(button.disabled,true);assert.equal(f.ids,1);await f.submit();assert.equal(f.writes().length,1);form.elements.cartons.value='bad';f.blur(form.elements.cartons);assert.equal(form.querySelectorAll('.field-error').length,0);form.elements.cartons.value='2';write.resolve({error:Error('Request denied')});await pending;assert.equal(form.inert,false);assert.equal(button.disabled,false);assert.equal(form.dataset.saving,'false');assert.equal(form.elements.reason.value,'Checked carton seals');assert.match(f.summary(),/Request denied/);const second=deferred();f.write=()=>second.promise;const retry=f.submit();assert.equal(f.ids,2);assert.equal(f.writes().length,2);second.resolve({error:Error('Still denied')});await retry;assert.equal(button.disabled,false);
});

test('valid request preserves its exact RPC, source units, bounded receipt and unrelated DOM',async()=>{
 const f=fixture(),form=f.form,content=f.document.querySelector('#content'),search=content.querySelector('#inventoryOperationsSearch'),row=content.querySelector('[data-inventory-transfer-row="existing"]'),header=content.querySelector('h1');search.value='Unsubmitted search';search.focus();await f.submit();assert.deepEqual(f.writes(),[{name:'request_inventory_transfer',args:{p_id:'request-1',p_source_lot_id:'lot',p_to_location_id:'to',p_cartons:2,p_expected_at:'2026-11-01',p_reason:'Checked carton seals'}}]);assert.equal(f.calls.filter(call=>call.name==='inventory_operations_page').length,1);assert.equal(f.get('inventoryLots[0].sealed_cartons'),10);assert.equal(f.get('inventoryLots[0].version'),7);assert.equal(f.get('inventoryOperationsData.rows[0].expected_units'),6);assert.equal(content.querySelector('#inventoryOperationsSearch'),search);assert.equal(content.querySelector('[data-inventory-transfer-row="existing"]'),row);assert.equal(content.querySelector('h1'),header);assert.equal(search.value,'Unsubmitted search');assert.equal(f.document.activeElement,search);assert.equal(f.ctx.window.scrollY,300);assert.equal(f.ctx.window.scrollX,12);assert.equal(form.isConnected,false);assert.equal(f.get('inventoryTransferReady'),false);assert.equal(f.get('inventoryStockActionsReady'),false);
});

test('post-save read failure retains saved gating and Retry only reads current results',async()=>{
 const f=fixture();f.read=()=>({error:Error('Read unavailable')});await f.submit();assert.equal(f.writes().length,1);assert.equal(f.form.dataset.inventorySaved,'true');assert.equal(f.form.inert,true);assert.equal(f.get('inventoryTransferReady'),false);const notice=f.document.querySelector('#inventoryOperationsSaved');assert.match(notice.textContent,/saved.*Retry reads/s);await f.submit();assert.equal(f.writes().length,1);f.read=null;await notice.querySelector('[data-inventory-retry-saved]').onclick();assert.equal(f.writes().length,1);assert.equal(notice.textContent,'Inventory transaction saved.');assert.equal(f.ids,1);
});

test('stale actor, route, section, epoch, request, action, transfer or replacement cannot validate or submit',async()=>{
 for(const mode of ['actor','route','section','epoch','request','action','transfer','ready','replace']){const f=fixture(),form=f.form;form.elements.cartons.value='bad';if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='route')f.ctx.view='personal';else if(mode==='section')f.get("inventorySection='stock'");else if(mode==='epoch')f.get('inventoryEpoch++');else if(mode==='request')f.get('inventoryOperationsRequest++');else if(mode==='action')f.get('inventoryOperationsActionRequest++');else if(mode==='transfer')f.get("inventoryTransferId='existing'");else if(mode==='ready')f.get('inventoryTransferReady=false');else form.replaceWith(f.document.createElement('form'));f.blur(form.elements.cartons);await f.submit();assert.equal(form.querySelectorAll('.field-error').length,0,mode);assert.equal(f.ids,0,mode);assert.equal(f.writes().length,0,mode);}
});

test('late rejected request never publishes an error into replacement context',async()=>{
 for(const mode of ['actor','route','request','replace']){const f=fixture(),write=deferred();f.write=()=>write.promise;const pending=f.submit();if(mode==='actor')f.ctx.me={...f.actor};else if(mode==='route')f.ctx.view='personal';else if(mode==='request')f.get('inventoryOperationsRequest++');else f.form.replaceWith(f.document.createElement('form'));write.resolve({error:Error('Stale rejection')});await pending;assert.doesNotMatch(f.document.body.textContent,/Stale rejection/);assert.equal(f.writes().length,1);}
});

function dispatchCorrectionChange(control){
 const event=new Event('change',{bubbles:true});Object.defineProperty(event,'target',{value:control});
 for(let node=control;node;node=node.parentElement){Object.defineProperty(event,'currentTarget',{configurable:true,value:node});node.onchange?.call(node,event);for(const {fn}of [...(node.events.change||[])])fn.call(node,event);}
}

test('request correction followed by action blur preserves layout until submit',async()=>{
 const f=fixture(),form=f.form,input=form.elements.reason,button=form.querySelector('[type="submit"]');input.value='';await f.submit();assert.equal(f.summary(),'1 field needs attention');const errorNode=input.closest('label').querySelector('.field-error');input.value='Checked carton seals';const html=form.innerHTML;
 dispatchCorrectionChange(input);button.focus();dispatchFocusout(input,button);assert.equal(form.innerHTML,html);assert.equal(input.closest('label').querySelector('.field-error'),errorNode);assert.equal(f.document.activeElement,button);assert.equal(f.writes().length,0);
 await f.submit();assert.equal(f.writes().length,1);assert.equal(f.writes()[0].args.p_reason,'Checked carton seals');
});
test('request action blur still requires valid fields on submit',async()=>{
 const f=fixture(),form=f.form,input=form.elements.reason;input.value='';dispatchFocusout(input,form.querySelector('[type="submit"]'));assert.equal(f.summary(),'');await f.submit();assert.equal(f.writes().length,0);assert.equal(f.document.activeElement,input);assert.equal(f.summary(),'1 field needs attention');
});
