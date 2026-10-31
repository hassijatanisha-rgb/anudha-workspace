import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const kinds=['review','links','mapping','tally'];
function fixture(kind,{match={status:'exact',productIds:['product']}}={}){
 const document=dom(),prototype=Object.getPrototypeOf(document.body),html=Object.getOwnPropertyDescriptor(prototype,'innerHTML'),animations=[],calls=[],effects=[],questions=[],feedback=[],requests=[];
 installNativeFormControls(document);
 const matches=prototype.matches;prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 Object.defineProperties(prototype,{
  id:{get(){return this.attrs.id||''},set(value){this.attrs.id=value}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},
  style:{get(){return this._style??={setProperty(key,value){this[key]=value},removeProperty(key){delete this[key]}}}},
  classList:{get(){return {add:token=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),token])].join(' ')},remove:token=>{this.className=this.className.split(' ').filter(value=>value!==token).join(' ')}}}},
  innerHTML:{get(){return html.get.call(this)},set(value){html.set.call(this,value);for(const select of this.querySelectorAll('select'))select.value=(select.querySelector('option[selected]')||select.querySelector('option'))?.value||'';for(const input of this.querySelectorAll('textarea'))input.value=input.textContent;for(const input of this.querySelectorAll('input[type="checkbox"]'))input.checked=input.getAttribute('checked')!==null;}}
 });
 prototype.getBoundingClientRect=()=>({left:100,top:100,width:400,height:300,right:500,bottom:400});
 prototype.animate=function(){const wait=deferred(),animation={dialog:this,finished:wait.promise,finish:()=>wait.resolve(),cancel:()=>wait.resolve()};animations.push(animation);return animation;};
 prototype.fire=function(type,extra={}){const event={target:this,preventDefault(){this.prevented=true},...extra};for(const {fn}of this.events[type]||[])fn(event);return event;};
 document.addEventListener=()=>{};document.body.innerHTML='<main id="content"><button data-tally-review="source">Open</button></main>';const root=document.querySelector('#content'),trigger=root.querySelector('button');trigger.focus();
 class Fields{
  constructor(form){this.entries=form.querySelectorAll('[name]').filter(node=>!node.disabled&&(node.getAttribute('type')!=='checkbox'||node.checked)).map(node=>[node.getAttribute('name'),node.value]);}
  get(name){return this.entries.find(entry=>entry[0]===name)?.[1]??null;}getAll(name){return this.entries.filter(entry=>entry[0]===name).map(entry=>entry[1]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}
 }
 const product={id:'product',name:'Product',source:{category:'reagents',machine_ids:['machine']}},machine={id:'machine',name:'Analyzer',source:{category:'machines'}},review={product_id:'product',version:2,name:'Product',company:'Maker',specification:'200 ml',sale_status:'active',batch_required:true,expiry_required:false};
 const c=vm.createContext({document,$:selector=>document.querySelector(selector),me:{user_id:'owner',role:'owner'},view:'inventory',inventorySection:kind==='tally'?'review':'catalog',generation:1,allowed:true,busy:false,FormData:Fields,crypto:{randomUUID:()=>{requests.push('request-id');return 'request-id'}},esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),matchMedia:()=>({matches:false}),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>key==='--m-fade'?'150ms':'200ms'}),canEditRecords:()=>c.allowed,recordsLockedText:'Read only',products:[product],
  catalogIsActive:()=>true,catalogSaveContext:()=>{const actor=c.me,generation=c.generation;return {current:()=>c.me===actor&&c.generation===generation&&c.view==='inventory'&&c.inventorySection==='catalog'}},loadCatalogProduct:async()=>product,catalogRows:()=>[product,machine],catalogCategoryOf:p=>p.source.category,catalogDetailRows:new Map([['product',{review,links:{product_id:'product',version:2,machine_ids:['machine']}}]]),loadCatalogMachines:async()=>[machine],refreshCatalogSavedProduct:async(...args)=>effects.push(['refresh',...args]),catalogInvalidateProductCaches:()=>effects.push(['invalidate']),render:()=>effects.push(['render']),message:(...args)=>effects.push(['message',...args]),loadLists:async()=>true,all:async()=>[],companyDate:()=> '2026-10-29',productStockReview:()=>({issues:[]}),inventoryProductChoice:p=>p.name,inventoryProductChoices:()=>'',inventoryProductFromChoice:name=>name==='Product'?product:null,
  actionFeedbackRememberDialog(){},actionFeedbackRefuse:(_button,error)=>{error.textContent='Busy'},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:kind==='mapping'?{source_key:'source-key',version:3,decision:'linked'}:{product_id:'product',version:3,machine_ids:['machine']}}},from:table=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:table==='product_source_mapping_reviews'?[{version:2}]:[{source_id:'source',product_id:'product',version:2,pieces:10}]}),maybeSingle:async()=>({data:{id:'source',product_name:'Product',godown:'Store',quantity:10,unit:'PCS',source_file:'Source',source_row:1}})})}});
 c.run=async(fn,options)=>{feedback.push(options);try{return await fn()}catch(error){options.errorTarget.textContent=error.message}};
 c.actionFeedbackReference=node=>({node});c.actionFeedbackShow=(_reference,text,_kind,target)=>{target.textContent=text;};
 for(const name of ['client-rules.js','ui-dialogs.js','product-review-ui.js','product-machine-links.js','product-mapping-decision.js','tally-stock-review.js'])vm.runInContext(read(name),c);
 c.askConfirm=async options=>{questions.push(options);return true};
 const get=code=>vm.runInContext(code,c);get("tallyActor=me;tallyPageData={rows:[{id:'source'}]};");c.tallyStockScreen=async()=>{get('tallyRequest++');effects.push(['refresh']);return true};
 const current=()=>c.generation===1&&c.view==='inventory';
 async function open(){
  if(kind==='review')await c.openProductReview('product');else if(kind==='links')await c.openProductMachineLinks('product');else if(kind==='mapping')await c.openProductMappingDecision({sourceKey:'source-key',original:{name:'Raw'},corrected:{name:'Product'},match},saved=>effects.push(['saved',saved]),current);else await c.openTallyCorrection('source');
  const dialog=document.querySelector('dialog'),form=dialog.querySelector('form'),button=form.querySelector('[type="submit"]'),cancel=dialog.querySelector(kind==='mapping'?'[data-cancel]':'[data-close]');
  return {dialog,form,button,cancel,change(){form.elements.reason.value='  Checked source  ';},submit:()=>form.onsubmit({preventDefault(){},target:form})};
 }
 return {c,document,root,trigger,calls,effects,questions,animations,feedback,requests,get,open,finish:async()=>{animations.at(-1).finish();await tick();},stale(mode){if(mode==='actor')c.me={...c.me};else if(mode==='route')c.view='personal';else if(mode==='request'){c.generation++;get('tallyRequest++');}else{c.allowed=false;c.me.role='staff';}}};
}

test('Tally validation: departed fields update the top count without moving focus or replacing help',async()=>{
 const f=fixture('tally'),e=await f.open(),reason=e.form.elements.reason,product=e.form.elements.product,summary=e.form.querySelector('[role="alert"]');reason.setAttribute('aria-describedby','reason-help');product.focus();dispatchFocusout(reason);assert.equal(summary.textContent,'1 field needs attention');assert.equal(e.form.querySelectorAll('.field-error').length,1);assert.equal(f.document.activeElement,product);assert.match(reason.getAttribute('aria-describedby'),/^reason-help field-error-/);assert.ok(e.form.children.indexOf(summary)<e.form.children.indexOf(product.closest('label')));
 product.value='Unknown';dispatchFocusout(product);assert.equal(summary.textContent,'2 fields need attention');assert.match(product.closest('label').querySelector('.field-error').textContent,/Select an exact catalog product/);reason.value='Checked source';dispatchFocusout(reason);assert.equal(summary.textContent,'1 field needs attention');assert.equal(reason.getAttribute('aria-describedby'),'reason-help');assert.equal(reason.getAttribute('aria-invalid'),null);product.value='Product';dispatchFocusout(product);assert.equal(summary.textContent,'');assert.equal(f.requests.length,0);assert.equal(f.calls.length,0);
});
test('Tally validation: submit collects native and existing domain errors in DOM order before reserving an ID',async()=>{
 const f=fixture('tally'),e=await f.open(),product=e.form.elements.product,pieces=e.form.elements.pieces,reason=e.form.elements.reason;product.value='Unknown';pieces.value='1.5';reason.value='abc';reason.focus();await e.submit();assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);assert.equal(e.form.noValidate,true);assert.equal(e.form.querySelector('[role="alert"]').textContent,'3 fields need attention');assert.equal(f.document.activeElement,product);assert.equal(product.scrolledIntoView.block,'center');assert.equal(e.form.querySelectorAll('.field-error').length,3);assert.equal(e.button.disabled,false);
 product.value='Product';pieces.value='10';reason.value='Checked source';pieces._nativeError='Use the displayed step.';await e.submit();assert.equal(f.calls.length,0);assert.equal(e.form.querySelector('[role="alert"]').textContent,'1 field needs attention');assert.equal(f.document.activeElement,pieces);assert.match(pieces.closest('label').textContent,/Use the displayed step/);
});
test('Tally validation: existing pieces and exact product rules stay unchanged',async()=>{
 for(const value of ['-1','1.5','9007199254740992','NaN']){const f=fixture('tally'),e=await f.open();e.change();e.form.elements.pieces.value=value;await e.submit();assert.equal(f.calls.length,0,value);assert.match(e.form.elements.pieces.closest('label').textContent,/Enter whole nonnegative pieces or leave blank/,value);assert.equal(f.document.activeElement,e.form.elements.pieces,value);}
 for(const value of ['', '0','9007199254740991']){const f=fixture('tally'),e=await f.open();e.change();e.form.elements.product.value='';e.form.elements.pieces.value=value;e.form.elements.batch.value=' B ';const saving=e.submit();await tick();assert.deepEqual(plain(f.calls[0]),{name:'save_tally_stock_correction',args:{p_id:'request-id',p_source_id:'source',p_expected_version:2,p_product_id:null,p_pieces:value===''?null:Number(value),p_batch:' B ',p_expiry:null,p_reason:'Checked source'}});await f.finish();await saving;}
 const f=fixture('tally'),e=await f.open();e.change();e.form.elements.product.value=' ';await e.submit();assert.equal(f.calls.length,0);assert.match(e.form.elements.product.closest('label').textContent,/Select an exact catalog product/);
});
test('Tally validation: native reason constraints and custom validity render text safely',async()=>{
 for(const value of ['', 'abc','x'.repeat(1001)]){const f=fixture('tally'),e=await f.open();e.form.elements.reason.value=value;const saving=e.submit();await tick();assert.equal(f.calls.length,0,value.slice(0,10));await saving;assert.equal(f.requests.length,0);assert.equal(f.document.activeElement,e.form.elements.reason);assert.equal(e.form.querySelector('[role="alert"]').textContent,'1 field needs attention');}
 const f=fixture('tally'),e=await f.open();e.change();e.form.elements.expiry.setCustomValidity('<img src=x> Check date');await e.submit();assert.equal(f.calls.length,0);assert.equal(e.form.querySelector('.field-error').querySelector('img'),null);assert.match(e.form.querySelector('.field-error').textContent,/<img src=x> Check date/);
});
test('Tally validation: corrected text retains action geometry until the first submit validates and writes once',async()=>{
 for(const action of ['submit','cancel','external']){const f=fixture('tally'),e=await f.open(),reason=e.form.elements.reason;dispatchFocusout(reason);const node=reason.closest('label').querySelector('.field-error'),summary=e.form.querySelector('[role="alert"]');reason.value='Checked source';for(const {fn}of e.form.events.change||[])fn({target:reason});dispatchFocusout(reason,action==='submit'?e.button:action==='cancel'?e.cancel:f.trigger);assert.equal(reason.closest('label').querySelector('.field-error'),node,action);assert.equal(summary.textContent,'1 field needs attention',action);const saving=e.submit();await tick();assert.equal(summary.textContent,'');assert.equal(e.form.querySelectorAll('.field-error').length,0);assert.equal(f.calls.length,1);await e.submit();assert.equal(f.calls.length,1);await f.finish();await saving;}
});
test('Tally validation: stale, busy, saving and committed dialogs do not change feedback or post again',async()=>{
 for(const mode of ['actor','request','route','permission','busy']){const f=fixture('tally'),e=await f.open();if(mode==='busy')f.c.busy=true;else f.stale(mode);dispatchFocusout(e.form.elements.reason);assert.equal(e.form.querySelectorAll('.field-error').length,0,mode);await e.submit();assert.equal(f.calls.length,0,mode);assert.equal(f.requests.length,0,mode);}
 const f=fixture('tally'),e=await f.open(),wait=deferred();e.change();f.c.client.rpc=()=>wait.promise;const saving=e.submit();e.form.elements.reason.value='';dispatchFocusout(e.form.elements.reason);assert.equal(e.form.querySelectorAll('.field-error').length,0);wait.resolve({data:{}});await tick();dispatchFocusout(e.form.elements.reason);assert.equal(e.form.querySelectorAll('.field-error').length,0);await f.finish();await saving;
});
for(const kind of kinds){
 test(`${kind}: shared size and clean Cancel await exit, then remove and restore focus`,async()=>{
  const f=fixture(kind),e=await f.open();assert.equal(e.dialog.dataset.dialogSize,['links','tally'].includes(kind)?'large':'medium');assert.match(e.dialog.className,/workspace-dialog/);
  const closing=e.cancel.onclick();assert.equal(e.dialog.open,true);assert.equal(f.questions.length,0);assert.equal(f.animations.length,2);await f.finish();assert.equal(await closing,true);assert.equal(e.dialog.isConnected,false);assert.equal(f.document.activeElement,f.trigger);assert.equal(f.calls.length,0);
 });
 test(`${kind}: dirty Cancel preserves input on decline and closes only after accepted discard`,async()=>{
  const f=fixture(kind),e=await f.open();e.change();f.c.askConfirm=async options=>{f.questions.push(options);return false};assert.equal(await e.cancel.onclick(),false);assert.equal(e.dialog.open,true);assert.equal(e.form.elements.reason.value,'  Checked source  ');assert.equal(f.questions[0].confirmLabel,'Discard changes');
  f.c.askConfirm=async()=>true;const closing=e.cancel.onclick();await tick();assert.equal(e.dialog.open,true);await f.finish();assert.equal(await closing,true);assert.equal(f.calls.length,0);
 });
 test(`${kind}: save locks Cancel, Escape and backdrop without losing typed evidence`,async()=>{
  const f=fixture(kind),e=await f.open(),wait=deferred();e.change();f.c.client.rpc=()=>wait.promise;const saving=e.submit();assert.equal(e.button.disabled,true);assert.equal(await e.cancel.onclick(),false);assert.equal(e.dialog.fire('cancel').prevented,true);e.dialog.fire('click',{clientX:0,clientY:0});assert.equal(f.questions.length,0);assert.equal(f.animations.length,1);
  wait.resolve({error:{message:'Version changed'}});await saving;assert.equal(e.dialog.open,true);assert.equal(e.button.disabled,false);assert.equal(e.form.elements.reason.value,'  Checked source  ');assert.match(e.form.querySelector('[role="alert"]').textContent,/Not confirmed saved.*Version changed/);
 });
 test(`${kind}: confirmed save waits for close before effects and cannot submit twice`,async()=>{
  const f=fixture(kind),e=await f.open();e.change();const saving=e.submit();await tick();assert.equal(e.dialog.open,true);assert.equal(f.effects.length,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_expected_version,2);assert.equal(f.calls[0].args.p_reason,'Checked source');assert.equal(f.calls[0].args.p_id,'request-id');assert.equal(await e.cancel.onclick(),false);await e.submit();assert.equal(f.calls.length,1);
  await f.finish();await saving;assert.equal(e.dialog.isConnected,false);assert.equal(e.button.disabled,true);assert.equal(f.effects.filter(effect=>['refresh','saved'].includes(effect[0])).length,1);assert.equal(f.questions.length,0);
 });
 test(`${kind}: interrupted success close keeps the confirmed write locked and allows dismissal without discard`,async()=>{
  const f=fixture(kind),e=await f.open();e.change();const saving=e.submit();await tick();f.c.showWorkspaceDialog(e.dialog,{size:'medium'});await saving;assert.equal(e.dialog.open,true);assert.equal(e.button.disabled,true);assert.equal(f.effects.length,0);await e.submit();assert.equal(f.calls.length,1);
  const closing=e.cancel.onclick();await f.finish();assert.equal(await closing,true);assert.equal(f.questions.length,0);
 });
 test(`${kind}: actor, request, route and permission changes during exit suppress follow-up effects`,async()=>{
  for(const mode of ['actor','request','route','permission']){const f=fixture(kind),e=await f.open();e.change();const saving=e.submit();await tick();f.stale(mode);await f.finish();await saving;assert.equal(f.effects.length,0,mode);assert.equal(f.calls.length,1,mode);}
 });
 test(`${kind}: replaced same-user session after write uses immediate security cleanup`,async()=>{
  const f=fixture(kind),e=await f.open(),wait=deferred();e.change();f.c.client.rpc=()=>wait.promise;const saving=e.submit();f.stale('actor');wait.resolve({data:{source_key:'source-key',version:3,decision:'linked'}});await saving;assert.equal(e.dialog.isConnected,false);assert.equal(f.animations.length,1);assert.equal(f.effects.length,0);
 });
 test(`${kind}: pending discard approval cannot close a replaced actor's dialog`,async()=>{
  const f=fixture(kind),e=await f.open(),wait=deferred();e.change();f.c.askConfirm=()=>wait.promise;const closing=e.cancel.onclick();f.stale('actor');wait.resolve(true);assert.equal(await closing,false);assert.equal(e.dialog.open,true);assert.equal(f.calls.length,0);
 });
}
test('machine search is presentation only; selected machine changes require discard confirmation',async()=>{
 for(const changed of [false,true]){const f=fixture('links'),e=await f.open(),search=e.dialog.querySelector('input[type="search"]');search.value='Other analyzer';search.oninput({target:search});if(changed)e.form.querySelector('[name="machineId"]').checked=false;const closing=e.cancel.onclick();await tick();assert.equal(f.questions.length,Number(changed));await f.finish();await closing;}
});

test('product correction validates on blur and blocks invalid submit before RPC with a top summary',async()=>{
 const f=fixture('review'),e=await f.open(),name=e.form.elements.name,reason=e.form.elements.reason;name.value='  ';reason.value=' abc ';reason.focus();dispatchFocusout(name);assert.equal(f.document.activeElement,reason);assert.equal(e.form.querySelectorAll('.field-error').length,1);assert.equal(name.value,'  ');
 await e.submit();assert.equal(f.calls.length,0);assert.equal(e.form.noValidate,true);assert.equal(e.form.querySelector('[role="alert"]').textContent,'2 fields need attention');assert.equal(f.document.activeElement,name);assert.equal(name.scrolledIntoView.block,'center');assert.equal(e.form.querySelectorAll('.field-error').length,2);assert.equal(e.dialog.open,true);assert.equal(e.button.disabled,false);
 const summary=e.form.querySelector('[role="alert"]');assert.equal(summary.parentElement,e.form.querySelector('.product-review-fields'));assert.ok(summary.parentElement.children.indexOf(summary)<summary.parentElement.children.indexOf(e.form.querySelector('section')));name.value='Product';dispatchFocusout(name);assert.equal(summary.textContent,'1 field needs attention');
 reason.value='Checked product source';dispatchFocusout(reason);assert.equal(summary.textContent,'');assert.equal(e.form.querySelectorAll('.field-error').length,0);assert.equal(reason.getAttribute('aria-invalid'),null);assert.equal(f.calls.length,0);assert.equal(e.form.events.focusout.length,1);
});

test('product correction sections, optional labels and successful request contract remain exact',async()=>{
 const f=fixture('review'),e=await f.open();assert.deepEqual(e.form.querySelectorAll('h3').map(node=>node.textContent),['Identity','Applicability','Correction reason']);assert.match(e.form.elements.company.closest('label').textContent,/\(optional\)/);assert.match(e.form.elements.specification.closest('label').textContent,/\(optional\)/);e.change();
 const saving=e.submit();await tick();assert.deepEqual(plain(f.calls[0]),{name:'save_product_detail_review',args:{p_id:'request-id',p_product_id:'product',p_expected_version:2,p_name:'Product',p_company:'Maker',p_specification:'200 ml',p_sale_status:'active',p_batch_required:true,p_expiry_required:false,p_reason:'Checked source'}});await f.finish();await saving;
});

test('product correction custom validity and changed actor block writes without losing form data',async()=>{
 const f=fixture('review'),e=await f.open();e.change();e.form.elements.name.setCustomValidity('<img src=x> Check source');await e.submit();assert.equal(f.calls.length,0);assert.equal(e.form.querySelector('.field-error').querySelector('img'),null);assert.match(e.form.querySelector('.field-error').textContent,/<img src=x>/);
 e.form.elements.name.setCustomValidity('');f.stale('actor');dispatchFocusout(e.form.elements.name);await e.submit();assert.equal(f.calls.length,0);assert.equal(e.form.elements.reason.value,'  Checked source  ');assert.match(e.form.querySelector('[role="alert"]').textContent,/Login changed/);
});
test('mapping incomplete receipt leaves its editor open with original request id and no success effects',async()=>{
 const f=fixture('mapping'),e=await f.open();e.change();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{source_key:'other',version:3,decision:'linked'}}};await e.submit();assert.equal(e.dialog.open,true);assert.equal(e.button.disabled,false);assert.equal(f.animations.length,1);assert.equal(f.effects.length,0);assert.match(e.form.querySelector('[role="alert"]').textContent,/Server did not confirm/);
 assert.deepEqual(plain(f.calls[0].args),{p_id:'request-id',p_source_key:'source-key',p_expected_version:2,p_product_id:'product',p_decision:'linked',p_snapshot:{original:{name:'Raw'},corrected:{name:'Product'}},p_reason:'Checked source'});
});
test('mapping replaced same-user session cannot finish the opening read',async()=>{
 const f=fixture('mapping'),wait=deferred();f.c.client.from=()=>({select(){return this},eq(){return this},order(){return this},limit:()=>wait.promise});const opening=f.open();f.stale('actor');wait.resolve({data:[]});await assert.rejects(opening,/Login changed/);assert.equal(f.document.querySelector('dialog'),null);
});
test('Tally success notice is suppressed when the retained refresh is superseded or its root changes',async()=>{
 for(const mode of ['actor','route','request','root']){
  const f=fixture('tally'),e=await f.open(),wait=deferred();e.change();f.c.tallyStockScreen=()=>{f.get('tallyRequest++');f.effects.push(['refresh']);return wait.promise};const saving=e.submit();await tick();await f.finish();
  if(mode==='root')f.root.remove();else f.stale(mode);wait.resolve(false);await saving;assert.deepEqual(f.effects,[['refresh']],mode);
 }
});


test('product correction footer stays outside the scrolling fields with its original controls and no extra live region',async()=>{
 const f=fixture('review'),e=await f.open(),fields=e.form.querySelector('.product-review-fields'),footer=e.form.querySelector('.product-review-footer'),status=footer.querySelector('[data-product-review-dirty]');
 assert.equal(fields.parentElement,e.form);assert.equal(footer.parentElement,e.form);assert.equal(fields.nextElementSibling,footer);assert.equal(fields.contains(e.form.elements.reason),true);assert.equal(fields.contains(e.form.querySelector('[role="alert"]')),true);assert.equal(footer.contains(e.cancel),true);assert.equal(footer.contains(e.button),true);assert.match(e.button.className,/button-primary/);assert.equal(e.button.textContent,'Save correction');assert.equal(status.textContent,'No changes');assert.equal(status.getAttribute('aria-live'),null);assert.equal(status.getAttribute('role'),null);
});
test('product correction dirty status uses the same snapshot for typing, select changes and reverting',async()=>{
 const f=fixture('review'),e=await f.open(),status=e.form.querySelector('[data-product-review-dirty]'),name=e.form.elements.name,select=e.form.elements.sale_status,reason=e.form.elements.reason;
 name.focus();name.value='Edited product';name.setSelectionRange(3,3);e.form.oninput({target:name});assert.equal(status.textContent,'Unsaved changes');assert.equal(f.document.activeElement,name);assert.equal(name.selectionStart,3);
 name.value='Product';e.form.oninput({target:name});assert.equal(status.textContent,'No changes');select.value='inactive_serviced';e.form.onchange({target:select});assert.equal(status.textContent,'Unsaved changes');select.value='active';e.form.onchange({target:select});assert.equal(status.textContent,'No changes');
 reason.value='Checked source';e.form.oninput({target:reason});f.c.askConfirm=async()=>false;assert.equal(await e.cancel.onclick(),false);assert.equal(status.textContent,'Unsaved changes');assert.equal(reason.value,'Checked source');assert.equal(f.calls.length,0);
});
test('product correction status and input survive failed writes; confirmed receipt clears only the dirty state',async()=>{
 const f=fixture('review'),e=await f.open(),status=e.form.querySelector('[data-product-review-dirty]');e.change();e.form.oninput({target:e.form.elements.reason});f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {error:{message:'Version changed'}}};await e.submit();assert.equal(status.textContent,'Unsaved changes');assert.equal(e.form.elements.reason.value,'  Checked source  ');assert.equal(e.button.disabled,false);assert.match(e.form.querySelector('[role="alert"]').textContent,/Version changed/);
 f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{product_id:'product',version:3}}};const saving=e.submit();await tick();assert.equal(status.textContent,'Correction saved');assert.equal(e.button.disabled,true);assert.equal(f.calls[0].args.p_id,f.calls[1].args.p_id);assert.equal(f.calls[1].args.p_expected_version,2);await f.finish();await saving;
});
test('product correction status cannot update after actor, route or request changes or after removal',async()=>{
 for(const mode of ['actor','route','request','removed']){const f=fixture('review'),e=await f.open(),status=e.form.querySelector('[data-product-review-dirty]');if(mode==='removed')e.dialog.remove();else f.stale(mode);e.change();e.form.oninput({target:e.form.elements.reason});e.form.onchange({target:e.form.elements.reason});assert.equal(status.textContent,'No changes',mode);assert.equal(f.calls.length,0,mode);}
});

for(const kind of ['links','mapping']){
 test(`${kind}: first invalid blur counts only departed fields and correction clears it without moving focus`,async()=>{
  const f=fixture(kind),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');reason.value=' abc ';reason.setAttribute('aria-describedby','source-help');e.cancel.focus();dispatchFocusout(reason);
  assert.equal(summary.textContent,'1 field needs attention');assert.equal(f.document.activeElement,e.cancel);assert.equal(reason.value,' abc ');assert.equal(reason.getAttribute('aria-invalid'),'true');assert.match(reason.getAttribute('aria-describedby'),/^source-help field-error-/);assert.match(reason.closest('label').querySelector('.field-error').textContent,/at least 5/);
  reason.value='Checked source';dispatchFocusout(reason);assert.equal(summary.textContent,'');assert.equal(reason.getAttribute('aria-describedby'),'source-help');assert.equal(reason.getAttribute('aria-invalid'),null);assert.equal(e.form.querySelectorAll('.field-error').length,0);assert.equal(f.calls.length,0);assert.equal(e.form.events.focusout.length,1);assert.equal(e.form.noValidate,true);
  assert.equal(summary.parentElement,e.form);assert.ok(e.form.children.indexOf(summary)<e.form.children.indexOf(e.form.querySelector('label')));
 });
 test(`${kind}: submit validates trimmed required and length constraints before any asynchronous action`,async()=>{
  for(const value of ['','   ',' abc ','x'.repeat(1001)]){
   const f=fixture(kind),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');reason.value=value;const focus=reason.focus;reason.focus=function(options){assert.equal(summary.textContent,'1 field needs attention');return focus.call(this,options)};
   await e.submit();assert.equal(f.calls.length,0);assert.equal(f.feedback.length,0);assert.equal(f.requests.length,1);assert.equal(f.document.activeElement,reason);assert.equal(reason.scrolledIntoView.block,'center');assert.equal(reason.value,value);assert.equal(e.dialog.open,true);assert.equal(e.button.disabled,false);
  }
 });
 test(`${kind}: custom validation stays text-only and first invalid focus follows visible DOM order`,async()=>{
  const f=fixture(kind),e=await f.open(),first=e.form.querySelector('input,select'),reason=e.form.elements.reason;first.setCustomValidity('<img src=x> Check selection');await e.submit();
  assert.equal(e.form.querySelector('[role="alert"]').textContent,'2 fields need attention');assert.equal(f.document.activeElement,first);assert.equal(e.form.querySelector('.field-error').querySelector('img'),null);assert.match(e.form.querySelector('.field-error').textContent,/<img src=x>/);assert.equal(f.calls.length,0);
  first.disabled=true;await e.submit();assert.equal(e.form.querySelector('[role="alert"]').textContent,'1 field needs attention');assert.equal(f.document.activeElement,reason);assert.equal(first.getAttribute('aria-invalid'),null);
 });
 test(`${kind}: blur cannot overwrite feedback while saving, committed, stale or disconnected`,async()=>{
  for(const mode of ['saving','committed','actor','route','request','permission','removed','closed']){
   const f=fixture(kind),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]'),wait=deferred();let saving;
   if(mode==='saving'){e.change();f.c.client.rpc=()=>wait.promise;saving=e.submit();}
   else if(mode==='committed'){e.change();saving=e.submit();await tick();}
   else if(mode==='removed')e.dialog.remove();else if(mode==='closed')e.dialog.close();else f.stale(mode);
   summary.textContent='Retained feedback';reason.value='';dispatchFocusout(reason);assert.equal(summary.textContent,'Retained feedback',mode);assert.equal(e.form.querySelectorAll('.field-error').length,0,mode);
   if(mode==='saving'){wait.resolve({error:{message:'Version changed'}});await saving;}
   if(mode==='committed'){await f.finish();await saving;}
  }
 });
 test(`${kind}: busy refusal retains data and valid failed retry keeps explicit action origin and request identity`,async()=>{
  const f=fixture(kind),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');e.change();f.c.busy=true;await e.submit();assert.equal(summary.textContent,'Busy');assert.equal(f.calls.length,0);assert.equal(f.feedback.length,0);assert.equal(e.button.disabled,false);
  f.c.busy=false;f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {error:{message:'Version changed'}}};await e.submit();assert.match(summary.textContent,/Not confirmed saved.*Version changed/);assert.equal(reason.value,'  Checked source  ');await e.submit();
  assert.equal(f.calls.length,2);assert.deepEqual(plain(f.calls[0]),plain(f.calls[1]));assert.equal(f.requests.length,1);assert.equal(f.feedback.length,2);for(const options of f.feedback){assert.equal(options.origin,e.button);assert.equal(options.errorTarget,summary);assert.equal(options.busyLabel,'Saving…');}assert.equal(e.button.disabled,false);
 });
}
test('mapping eligibility uses the existing conditional link rule for blur and submission',async()=>{
 const f=fixture('mapping',{match:{status:'ambiguous',productIds:['product','other']}}),e=await f.open(),decision=e.form.elements.decision,reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');decision.innerHTML+='<option value="linked">Injected stale choice</option>';decision.value='linked';reason.focus();dispatchFocusout(decision);
 assert.equal(summary.textContent,'1 field needs attention');assert.match(decision.closest('label').querySelector('.field-error').textContent,/Resolve product identity before confirming a link/);assert.equal(f.document.activeElement,reason);assert.equal(reason.getAttribute('aria-invalid'),null);
 await e.submit();assert.equal(summary.textContent,'2 fields need attention');assert.equal(f.document.activeElement,decision);assert.equal(f.calls.length,0);assert.equal(f.feedback.length,0);decision.value='unresolved';dispatchFocusout(decision);assert.equal(summary.textContent,'1 field needs attention');e.change();dispatchFocusout(reason);assert.equal(summary.textContent,'');
 f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{source_key:'source-key',version:3,decision:'unresolved'}}};const saving=e.submit();await tick();assert.deepEqual(plain(f.calls[0]),{name:'save_product_source_mapping_review',args:{p_id:'request-id',p_source_key:'source-key',p_expected_version:2,p_product_id:null,p_decision:'unresolved',p_snapshot:{original:{name:'Raw'},corrected:{name:'Product'}},p_reason:'Checked source'}});await f.finish();await saving;assert.equal(f.effects.filter(effect=>effect[0]==='saved').length,1);
});
test('machine selections stay exact through filtering, missing choices and explicit clearing',async()=>{
 for(const mode of ['filtered','missing','empty']){
  const f=fixture('links');if(mode==='missing')f.c.catalogDetailRows.get('product').links.machine_ids=['missing','machine'];const e=await f.open(),search=e.form.querySelector('input[type="search"]');e.change();search.value='No matches';search.oninput({target:search});if(mode==='empty')for(const node of e.form.querySelectorAll('[name="machineId"]'))node.checked=false;
  const saving=e.submit();await tick();assert.deepEqual(plain(f.calls[0]),{name:'save_product_machine_link_review',args:{p_id:'request-id',p_product_id:'product',p_expected_version:2,p_machine_ids:mode==='empty'?[]:mode==='missing'?['machine','missing']:['machine'],p_reason:'Checked source'}});await f.finish();await saving;
 }
});

for(const kind of ['links','mapping']){
 test(`${kind}: corrected reason keeps action geometry until the first Save click submits`,async()=>{
  const f=fixture(kind),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');reason.value='bad';dispatchFocusout(reason);const error=reason.closest('label').querySelector('.field-error');e.change();
  dispatchFocusout(reason,e.button);assert.equal(reason.closest('label').querySelector('.field-error'),error);assert.equal(summary.textContent,'1 field needs attention');assert.equal(f.calls.length,0);
  const saving=e.submit();await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_reason,'Checked source');assert.equal(e.form.querySelectorAll('.field-error').length,0);assert.equal(summary.textContent,'');assert.equal(e.button.disabled,true);await f.finish();await saving;
 });
 test(`${kind}: Cancel focus keeps errors stable and rejected discard keeps the correction`,async()=>{
  const f=fixture(kind),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');reason.value='bad';dispatchFocusout(reason);const error=reason.closest('label').querySelector('.field-error');e.change();f.c.askConfirm=async()=>false;
  dispatchFocusout(reason,e.cancel);assert.equal(reason.closest('label').querySelector('.field-error'),error);assert.equal(summary.textContent,'1 field needs attention');assert.equal(await e.cancel.onclick(),false);assert.equal(reason.value,'  Checked source  ');assert.equal(e.dialog.open,true);assert.equal(f.calls.length,0);
  dispatchFocusout(reason,f.trigger);assert.equal(reason.closest('label').querySelector('.field-error'),error);assert.equal(summary.textContent,'1 field needs attention');dispatchFocusout(reason,e.form.querySelector('input,select'));assert.equal(e.form.querySelectorAll('.field-error').length,0);assert.equal(summary.textContent,'');
 });
 test(`${kind}: deferred action blur still validates invalid submission`,async()=>{
  const f=fixture(kind),e=await f.open(),reason=e.form.elements.reason;reason.value='bad';dispatchFocusout(reason,e.button);assert.equal(e.form.querySelectorAll('.field-error').length,0);await e.submit();assert.equal(f.calls.length,0);assert.equal(e.form.querySelector('[role="alert"]').textContent,'1 field needs attention');assert.equal(f.document.activeElement,reason);assert.equal(e.button.disabled,false);
 });
}


test('product correction: action blur retains corrected error layout until the first submit',async()=>{
 const f=fixture('review'),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');await e.submit();const error=e.form.querySelector('.field-error');assert.ok(error);assert.equal(summary.textContent,'1 field needs attention');e.change();
 dispatchFocusout(reason,e.button);assert.equal(e.form.querySelector('.field-error'),error);assert.equal(summary.textContent,'1 field needs attention');assert.equal(f.calls.length,0);
 const saving=e.submit();await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'save_product_detail_review');assert.equal(f.calls[0].args.p_reason,'Checked source');assert.equal(f.calls[0].args.p_expected_version,2);assert.equal(e.form.querySelectorAll('.field-error').length,0);await f.finish();await saving;
});

test('product correction: deferred action blur still rejects invalid submit and ordinary field blur clears correction',async()=>{
 const f=fixture('review'),e=await f.open(),reason=e.form.elements.reason,summary=e.form.querySelector('[role="alert"]');reason.value='bad';dispatchFocusout(reason,e.button);assert.equal(e.form.querySelectorAll('.field-error').length,0);await e.submit();assert.equal(f.calls.length,0);assert.equal(summary.textContent,'1 field needs attention');assert.equal(f.document.activeElement,reason);
 const error=e.form.querySelector('.field-error');e.change();dispatchFocusout(reason,e.cancel);assert.equal(e.form.querySelector('.field-error'),error);assert.equal(summary.textContent,'1 field needs attention');dispatchFocusout(reason,f.trigger);assert.equal(e.form.querySelector('.field-error'),error);assert.equal(summary.textContent,'1 field needs attention');const next=e.form.elements.name;next.focus();dispatchFocusout(reason,next);assert.equal(e.form.querySelectorAll('.field-error').length,0);assert.equal(summary.textContent,'');assert.equal(f.document.activeElement,next);assert.equal(f.calls.length,0);
});


test('machine dialog labels show names and stock codes without internal IDs, including missing selections',async()=>{
 const machineId='11111111-1111-4111-8111-111111111111',missingId='22222222-2222-4222-8222-222222222222',f=fixture('links');f.c.loadCatalogMachines=async()=>[{id:machineId,name:'Analyzer A',sku:'AN-042',source:{category:'machines',company:'Maker',model:'Model 3'}}];f.c.catalogDetailRows.get('product').links.machine_ids=[machineId,missingId];
 const e=await f.open(),choices=e.form.querySelectorAll('[name="machineId"]');assert.deepEqual(choices.map(node=>node.value),[machineId,missingId]);assert.ok(choices.every(node=>node.checked));assert.match(choices[0].closest('label').textContent,/Analyzer A.*Maker.*Model 3.*AN-042/);assert.match(choices[1].closest('label').textContent,/Unavailable machine/);assert.doesNotMatch(e.dialog.textContent,/11111111|22222222|ID:/);assert.equal(e.dialog.querySelector('a'),null);
 const search=e.form.querySelector('input[type="search"]');search.value='AN-042';search.oninput({target:search});assert.equal(choices[0].closest('label').hidden,false);assert.equal(choices[1].closest('label').hidden,true);e.change();const saving=e.submit();await tick();assert.deepEqual(plain(f.calls[0].args.p_machine_ids),[machineId,missingId]);assert.equal(f.calls[0].args.p_expected_version,2);await f.finish();await saving;
});

test('mapping dialog resolves reviewed names and stock codes while retaining hidden identity, version and source key',async()=>{
 const id='33333333-3333-4333-8333-333333333333',f=fixture('mapping',{match:{status:'exact',productIds:[id]}});f.c.products.push({id,name:'Imported name',sku:'RG-042',source:{}});f.get(`productDetailReviews.set('${id}',{name:'Reviewed <reagent>',company:'Maker'})`);f.c.client.from=()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[{decision:'linked',product_id:id,version:12}]})});
 const e=await f.open(),option=e.form.elements.decision.querySelector('option[value="linked"]');assert.equal(option.textContent,'Confirm link: Reviewed <reagent> · RG-042');assert.match(e.dialog.textContent,/Source product: Raw/);assert.match(e.dialog.textContent,/Previous decision: Linked to Reviewed <reagent> · RG-042/);assert.doesNotMatch(e.dialog.textContent,/source-key|33333333|version 12|Imported name/);assert.equal(e.dialog.querySelector('reagent'),null);
 e.change();const saving=e.submit();await tick();assert.deepEqual(plain(f.calls[0].args),{p_id:'request-id',p_source_key:'source-key',p_expected_version:12,p_product_id:id,p_decision:'linked',p_snapshot:{original:{name:'Raw'},corrected:{name:'Product'}},p_reason:'Checked source'});await f.finish();await saving;assert.equal(f.effects.filter(effect=>effect[0]==='saved').length,1);
});

test('mapping unavailable, deleted and duplicate identities never borrow the corrected source name',async()=>{
 for(const mode of ['missing','deleted','duplicate']){
  const id='44444444-4444-4444-8444-444444444444',f=fixture('mapping',{match:{status:'exact',productIds:[id]}});if(mode==='deleted')f.c.products.push({id,name:'Deleted product',sku:'OLD-1',deleted_at:'2026-10-31',source:{}});if(mode==='duplicate')f.c.products.push({id,name:'First candidate',source:{}},{id,name:'Second candidate',source:{}});f.c.client.from=()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[{decision:'linked',product_id:id,version:9}]})});
  const e=await f.open(),option=e.form.elements.decision.querySelector('option[value="linked"]');assert.equal(option.textContent,'Confirm link: Product unavailable — review catalog',mode);assert.match(e.dialog.textContent,/Previous decision: Linked to Product unavailable — review catalog/);assert.doesNotMatch(e.dialog.textContent,/44444444|version 9|Deleted product|OLD-1|First candidate|Second candidate/);assert.equal(f.calls.length,0);
 }
});

test('mapping ambiguous proposals retain unresolved-only eligibility and human previous-decision text',async()=>{
 const f=fixture('mapping',{match:{status:'ambiguous',productIds:['55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666']}});f.c.client.from=()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[{decision:'unresolved',product_id:null,version:7}]})});const e=await f.open();assert.equal(e.form.elements.decision.querySelector('option[value="linked"]'),null);assert.match(e.dialog.textContent,/Previous decision: Unresolved — needs further review/);assert.doesNotMatch(e.dialog.textContent,/55555555|66666666|source-key|version 7/);
 e.change();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{source_key:'source-key',version:8,decision:'unresolved'}}};const saving=e.submit();await tick();assert.equal(f.calls[0].args.p_product_id,null);assert.equal(f.calls[0].args.p_decision,'unresolved');assert.equal(f.calls[0].args.p_expected_version,7);await f.finish();await saving;
});
