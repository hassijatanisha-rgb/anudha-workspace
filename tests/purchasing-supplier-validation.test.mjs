import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const supplier=(id='s1')=>({id,supplier_number:'SUP-'+id,name:'Supplier '+id,country:'Tanzania',contact_name:'Asha',phone:'123',email:'asha@example.test',tin:'TIN',payment_terms:'30 days',notes:'',active:true,version:1});
const order=(id='o1',status='requested')=>({id,po_number:'PO-'+id,status,supplier_id:'s1',currency:'USD',expected_on:null,lpo_reference:'',notes:'Original order',requested_by:'actor',approved_by:null,close_note:'',version:1,created_at:'2026-10-20T08:00:00Z',updated_at:'2026-10-20T08:00:00Z'});
const line=(id='o1')=>({id:'line-'+id,purchase_order_id:id,line_number:1,product_id:'p1',quantity:2,unit_price_minor:15750,pending_request_id:'pending-1',note:'Keep reference'});
function fixture({section='orders',edit=false,create=false,status='requested'}={}){
 const document=dom();installNativeFormControls(document);const proto=Object.getPrototypeOf(document.body),html=Object.getOwnPropertyDescriptor(proto,'innerHTML');let rootWrites=0,submit,pending,writeHook,readHook,sequence=0;
 Object.defineProperty(proto,'innerHTML',{get(){return esc(this._text)+this.children.map(child=>child.outerHTML).join('')},set(value){if(this.id==='content')rootWrites++;html.set.call(this,value)}});
 Object.defineProperty(proto,'outerHTML',{get(){return this.tag?`<${this.tag}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${esc(value)}"`).join('')}>`+(['input','br','hr','img','meta','link'].includes(this.tag)?'':this.innerHTML+`</${this.tag}>`):esc(this._text)}});
 Object.defineProperty(proto,'inert',{get(){return this._inert||false},set(value){this._inert=value;if(value&&this.contains(document.activeElement))document.activeElement=document.body}});proto.scrollIntoView=function(options){this.scrolledIntoView=options;};
 const matches=proto.matches;proto.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 proto.getBoundingClientRect=()=>({left:40,top:40,bottom:84,width:180,height:44});proto.getClientRects=function(){return this.isConnected?[{}]:[];};
 Object.defineProperties(proto,{type:{get(){return this.attrs.type||'';},set(value){this.attrs.type=value;}},form:{get(){return this.closest('form');}},classList:{get(){return {add:name=>this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' '),remove:name=>this.className=this.className.split(' ').filter(value=>value!==name).join(' '),contains:name=>this.className.split(' ').includes(name)};}},style:{get(){return this._style||=(Object.assign({setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}},{width:''}));}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={clientWidth:1280,clientHeight:900};
 const notice=document.createElement('div');notice.id='notice';document.body.append(notice);
 const root=document.createElement('main');root.setAttribute('id','content');document.body.append(root);const orders=[order('o1',status),order('o2')],lines=[line('o1'),line('o2')],suppliers=[supplier('s1'),supplier('s2')],writes=[],reads=[],decorated=[],messages=[];
 const ctx=vm.createContext({statusTone,busy:false,getComputedStyle:()=>({visibility:'visible'}),me:{user_id:'actor',role:'owner'},view:'purchasing',listsLoaded:true,products:[{id:'p1',name:'Product one'},{id:'p2',name:'Product two'}],pendingRows:[{id:'pending-1',request_number:'PN-1'}],document,$:selector=>document.querySelector(selector),esc,employeeName:()=> 'Asha',companyDate:()=> '2026-10-29',window:{addEventListener(){},scrollX:7,scrollY:612,scrollTo(x,y){this.scrollX=x;this.scrollY=y}},
  crypto:{randomUUID:()=> 'request-'+(++sequence)},CSS:{escape:value=>value},clearTimeout(){},setTimeout:()=>1,run:fn=>(pending=fn()),message:text=>messages.push(text),actionForm:(title,fields,fn)=>{submit=fn},syncWorkspaceNavigation(){},workspaceLoading(){throw Error('Unexpected loading screen')},loadLists:async()=>{throw Error('Unexpected list reload')},all:async()=>{throw Error('Unexpected complete reload')},
  inventoryOption:(id,text,selected)=>`<option value="${esc(id)}" ${selected?'selected':''}>${esc(text)}</option>`,inventoryProductChoice:row=>row.name,inventoryProductFromChoice:name=>ctx.products.find(row=>row.name===name),salesProductChoices:()=>'<option value="Product one">',
  FormData:class{constructor(form){this.form=form}get(name){const node=this.form.elements[name];return node?node.value:null}has(name){return !!this.form.elements[name]}},
  decorateWorkHandoffs:async(target=document)=>{const cards=target===document?document.querySelectorAll('[data-purchase-card]'):[target];for(const card of cards){if(!card.dataset.purchaseCard||card.querySelector('[data-work-handoff]'))continue;decorated.push(card);const box=document.createElement('div');box.dataset.workHandoff=card.dataset.purchaseCard;box.innerHTML='<details class="work-timeline"><summary>Handoff history</summary><p>Saved coordination</p></details>';card.append(box)}},
  client:{rpc:async(name,args)=>{writes.push({name,args:clone(args)});if(writeHook)return writeHook(name,args);if(name==='save_supplier'){let row=suppliers.find(value=>value.id===args.p_id);const saved={...supplier(args.p_id),...row,...args.p_fields,email:args.p_fields.email.toLowerCase(),version:args.p_expected_version+1};if(row)suppliers[suppliers.indexOf(row)]=saved;else suppliers.unshift(saved);return {data:clone(saved)}}let row=orders.find(value=>value.id===args.p_id);if(name==='save_purchase_request'){const saved={...order(args.p_id),...row,version:args.p_expected_version+1,supplier_id:args.p_supplier_id,currency:args.p_currency,expected_on:args.p_expected_on,notes:args.p_notes};if(row)orders[orders.indexOf(row)]=saved;else orders.unshift(saved);for(let i=lines.length-1;i>=0;i--)if(lines[i].purchase_order_id===args.p_id)lines.splice(i,1);lines.push(...args.p_lines.map((value,i)=>({...value,id:'saved-line-'+args.p_id+'-'+i,purchase_order_id:args.p_id,line_number:i+1})));return {data:clone(saved)}}if(name==='advance_purchase_order'){Object.assign(row,{status:{approve:'approved',order:'ordered',close:'closed',cancel:'cancelled'}[args.p_action],version:row.version+1});if(args.p_action==='approve')row.approved_by='actor';if(args.p_action==='order')row.lpo_reference=args.p_lpo_reference;return {data:clone(row)}}throw Error('Unexpected write '+name)},from(table){const query={table,select(columns){query.columns=columns;return query},eq(key,id){query.key=key;query.id=id;return query},async maybeSingle(){reads.push({table,id:query.id,columns:query.columns});const row=table==='suppliers'?suppliers.find(value=>value.id===query.id):orders.find(value=>value.id===query.id),data=row?clone(table==='suppliers'?row:{...row,purchase_order_lines:lines.filter(value=>value.purchase_order_id===row.id)}):null;return readHook?readHook(query,data):{data}}};return query}}
 });installWorkspaceDialogFixture(ctx);installPageHeader(ctx);for(const file of ['row-index.js','client-rules.js','purchasing.js'])vm.runInContext(read(file),ctx);const get=code=>vm.runInContext(code,ctx);
 get(`purchaseSection=${JSON.stringify(section)};purchaseOrders=${JSON.stringify(orders)};purchaseLines=${JSON.stringify(lines)};suppliers=${JSON.stringify(suppliers)};purchaseLoaded=true;purchaseLoadedActor=me;purchasePageKey='old-page';purchaseSearch='fixture';purchaseFilter='ordered';purchasePage=2;`);
 get(section==='orders'?`purchaseFocusedOrder=${edit?'""':'"o1"'};purchaseEditing=${edit?JSON.stringify(create?'new':'o1'):'""'};`:`purchaseFocusedSupplier=${edit?'""':'"s1"'};supplierEditing=${edit?JSON.stringify(create?'new':'s1'):'""'};`);ctx.renderPurchasing();
 const form=root.querySelector('form');if(form){if(section==='orders'){form.elements.supplierId.value='s1';form.elements.currency.value='USD';form.elements.notes.value='Updated <order>';form.querySelector('[name="productChoice"]').value='Product one';form.querySelector('[name="quantity"]').value='4';form.querySelector('[name="note"]').value='Line <note>'; }else {form.elements.name.value='Updated <supplier>';form.elements.email.value='SUPPLIER@example.test';form.elements.notes.value='Supplier note';if(form.elements.active)form.elements.active.value='true';}}
 const other=document.createElement('article');other.dataset.unrelated='true';other.innerHTML='<details open><summary>Other card</summary><textarea name="draft"></textarea></details>';other.querySelector('textarea').value='Unrelated draft';root.querySelector('#purchaseRecord').append(other);decorated.length=0;
  const app=read('app.js');vm.runInContext(read('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),ctx);
 const button=form?.querySelector('[type="submit"]'),error=form?.querySelector(section==='orders'?'#purchaseFormError':'#supplierFormError');
 return {ctx,get,root,document,form,other,button,error,submitEvent:()=>form.onsubmit({preventDefault(){},submitter:button}),blur:control=>dispatchFocusout(control),orders,lines,suppliers,writes,reads,decorated,messages,get rootWrites(){return rootWrites},get submit(){return submit},get pending(){return pending},setWrite(fn){writeHook=fn},setRead(fn){readHook=fn},async save(){return section==='orders'?ctx.savePurchaseForm(form):ctx.saveSupplierForm(form)}};
}

test('supplier form puts summary first and labels optional contact controls with useful native hints',()=>{
 const f=fixture({section:'suppliers',edit:true}),form=f.form;
 assert.equal(form.noValidate,true);assert.ok(form.innerHTML.indexOf('id="supplierFormError"')<form.innerHTML.indexOf('name="name"'));assert.match(form.textContent,/Supplier name is required/);
 assert.equal(form.elements.name.required,true);assert.equal(form.elements.name.getAttribute('minlength'),'2');assert.equal(form.elements.phone.type,'tel');assert.equal(form.elements.phone.getAttribute('inputmode'),'tel');assert.equal(form.elements.email.type,'email');
 for(const name of ['country','contact_name','phone','email','tin','payment_terms','notes'])assert.match(form.elements[name].closest('label').textContent,/optional/);
 assert.equal(form.elements.phone.getAttribute('aria-describedby'),'supplierPhoneHint');assert.equal(form.elements.email.getAttribute('aria-describedby'),'supplierEmailHint');assert.match(form.querySelector('#supplierPhoneHint').textContent,/country code/);
});

test('supplier standard focusout validates trimmed name only and keeps input and help unchanged',()=>{
 const f=fixture({section:'suppliers',edit:true}),name=f.form.elements.name,phone=f.form.elements.phone;
 name.value=' a ';phone.focus();f.blur(name);assert.match(name.closest('label').textContent,/at least 2 characters/);assert.equal(name.value,' a ');assert.equal(f.document.activeElement,phone);assert.equal(f.form.querySelectorAll('.field-error').length,1);assert.equal(phone.getAttribute('aria-invalid'),null);assert.equal(f.writes.length,0);
 name.value='  Fictional supplier  ';f.blur(name);assert.equal(name.getAttribute('aria-invalid'),null);assert.equal(name.value,'  Fictional supplier  ');
 phone.value='X'.repeat(61);f.blur(phone);assert.match(phone.closest('label').textContent,/no more than 60/);assert.match(phone.getAttribute('aria-describedby'),/^supplierPhoneHint field-error-/);phone.value='+255 712 345 678';f.blur(phone);assert.equal(phone.getAttribute('aria-describedby'),'supplierPhoneHint');assert.equal(f.form.querySelectorAll('.field-error').length,0);
});

test('supplier native submit collector counts before focusing the first invalid field and corrects one departed field',async()=>{
 const f=fixture({section:'suppliers',edit:true}),form=f.form,name=form.elements.name,email=form.elements.email,notes=form.elements.notes,proto=Object.getPrototypeOf(name),focus=proto.focus,seen=[];
 proto.focus=function(options){seen.push({node:this,summary:f.error.textContent});focus.call(this,options);};
 name.value='   ';email._nativeError='Enter a valid email address.';notes.value='N'.repeat(4001);await f.submitEvent();
 assert.equal(f.writes.length,0);assert.equal(f.error.textContent,'3 fields need attention');assert.equal(f.document.activeElement,name);assert.equal(seen.at(-1).summary,'3 fields need attention');assert.equal(name.scrolledIntoView.block,'center');assert.equal(name.value,'   ');assert.equal(notes.value.length,4001);
 name.value='Corrected name';f.blur(name);assert.equal(f.error.textContent,'2 fields need attention');assert.equal(email.getAttribute('aria-invalid'),'true');email._nativeError='';email.value='';f.blur(email);assert.equal(f.error.textContent,'1 field needs attention');notes.value='';f.blur(notes);assert.equal(f.error.textContent,'');
});

test('supplier validated edit preserves the existing RPC values, version and complete receipt path',async()=>{
 const f=fixture({section:'suppliers',edit:true}),form=f.form;form.elements.name.value='  Approved supplier  ';form.elements.country.value=' Tanzania ';form.elements.contact_name.value=' Contact ';form.elements.phone.value='+255 712 345 678';form.elements.email.value='  ORDERS@example.test  ';form.elements.tin.value=' TIN ';form.elements.payment_terms.value='30 days';form.elements.notes.value='Retain <notes>';form.elements.active.value='false';await f.submitEvent();
 assert.deepEqual(f.writes,[{name:'save_supplier',args:{p_id:'s1',p_expected_version:1,p_fields:{name:'Approved supplier',country:' Tanzania ',contact_name:' Contact ',phone:'+255 712 345 678',email:'ORDERS@example.test',tin:' TIN ',payment_terms:'30 days',notes:'Retain <notes>',active:false}}}]);assert.equal(f.reads.length,0);assert.equal(f.form.isConnected,false);assert.equal(f.get('suppliers[0].version'),2);assert.equal(f.get('suppliers[0].email'),'orders@example.test');assert.equal(f.other.isConnected,true);
});

for(const section of ['orders','suppliers'])test(`${section} busy refusal sends no write and leaves valid Save enabled for a later retry`,async()=>{
 const f=fixture({section,edit:true}),label=f.button.textContent;f.ctx.busy=true;await f.submitEvent();assert.equal(f.writes.length,0);assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,label);assert.match(f.error.textContent,/Another action is still running/);assert.equal(f.form.inert,false);
 f.ctx.busy=false;await f.submitEvent();assert.equal(f.writes.length,1);assert.equal(f.form.isConnected,false);assert.equal(f.ctx.busy,false);
});

for(const section of ['orders','suppliers'])test(`${section} accepted Save keeps its label and shared spinner; duplicate submit cannot write twice`,async()=>{
 const f=fixture({section,edit:true}),wait=deferred(),label=f.button.textContent;f.setWrite(()=>wait.promise);f.button.focus();const pending=f.submitEvent();
 assert.equal(f.button.disabled,true);assert.equal(f.button.getAttribute('aria-busy'),'true');assert.equal(f.button.classList.contains('action-is-busy'),true);assert.equal(f.button.textContent,label);assert.equal(f.form.inert,true);await f.submitEvent();assert.equal(f.writes.length,1);
 wait.resolve({error:{code:'P0001',message:'Version changed; compare before saving.'}});await pending;assert.equal(f.button.disabled,false);assert.equal(f.button.getAttribute('aria-busy'),null);assert.equal(f.button.classList.contains('action-is-busy'),false);assert.equal(f.button.textContent,label);assert.equal(f.form.inert,false);assert.match(f.error.textContent,/Version changed/);
});

for(const section of ['orders','suppliers'])test(`${section} confirmed write and failed read keeps Save disabled and uses read-only Retry`,async()=>{
 const f=fixture({section,edit:true}),label=f.button.textContent;if(section==='suppliers')f.setWrite((name,args)=>({data:{id:args.p_id,version:2}}));f.setRead(()=>({error:{message:'Scoped read unavailable'}}));await f.submitEvent();
 assert.equal(f.writes.length,1);assert.equal(f.button.disabled,true);assert.equal(f.button.getAttribute('aria-busy'),null);assert.equal(f.button.textContent,label);assert.equal(f.form.dataset.saved,'true');assert.equal(f.form.inert,true);assert.ok(f.root.querySelector('[data-purchase-save-retry]'));assert.match(f.root.querySelector('#purchaseSaved').textContent,/Saved/);await f.submitEvent();assert.equal(f.writes.length,1);
 if(section==='suppliers')Object.assign(f.suppliers[0],{version:2});f.setRead(null);await f.root.querySelector('[data-purchase-save-retry]').onclick();assert.equal(f.writes.length,1);assert.equal(f.reads.length,2);assert.equal(f.form.isConnected,false);
});

for(const section of ['orders','suppliers'])test(`${section} uncertain response preserves entered values and the existing UUID for unchanged retry`,async()=>{
 const f=fixture({section,edit:true,create:true}),notes=f.form.elements.notes;notes.value='Retained uncertain input';f.setWrite(()=>{throw Error('Response unavailable');});await f.submitEvent();
 const first=clone(f.writes[0].args);assert.equal(f.button.disabled,false);assert.equal(f.form.inert,false);assert.equal(notes.value,'Retained uncertain input');assert.match(f.error.textContent,/Response unavailable/);assert.equal(f.get(section==='orders'?'purchasePendingSave.id':'supplierPendingSave.id'),first.p_id);
 f.setWrite(null);await f.submitEvent();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1].args,first);assert.equal(f.form.isConnected,false);
});

for(const section of ['orders','suppliers'])test(`${section} late response cannot unlock or report into a stale same-id actor form`,async()=>{
 for(const outcome of ['receipt','rejection']){const f=fixture({section,edit:true}),wait=deferred();f.setWrite(()=>wait.promise);const pending=f.submitEvent();f.ctx.me={...f.ctx.me};const html=f.error.textContent;if(outcome==='rejection')wait.reject(Error('Old actor error'));else wait.resolve({data:{id:section==='orders'?'o1':'s1',version:2}});await pending;assert.equal(f.button.disabled,true);assert.equal(f.button.getAttribute('aria-busy'),null);assert.equal(f.error.textContent,html);assert.equal(f.reads.length,0);assert.equal(f.root.querySelector('[data-purchase-save-retry]'),null);await f.submitEvent();assert.equal(f.writes.length,1);}
});

test('supplier stale actor, epoch, request, section, route and replaced-form listeners cannot validate or submit',async()=>{
 for(const change of ['actor','epoch','request','section','route','replace']){
  const f=fixture({section:'suppliers',edit:true}),form=f.form;form.elements.name.value=' ';if(change==='actor')f.ctx.me={...f.ctx.me};else if(change==='epoch')f.get('purchaseEpoch++');else if(change==='request')f.get('purchaseWorkspaceRequest++');else if(change==='section')f.get("purchaseSection='orders'");else if(change==='route')f.ctx.view='personal';else f.root.querySelector('#purchaseRecord').innerHTML='<form id="supplierForm"><input name="name" value="New form"><button type="submit">Save replacement</button></form>';
  f.blur(form.elements.name);await f.submitEvent();assert.equal(form.querySelectorAll('.field-error').length,0);assert.equal(f.writes.length,0);assert.equal(f.error.textContent,'');
 }
});

test('supplier owner-only active selector remains unchanged for owner and staff',()=>{
 const f=fixture({section:'suppliers',edit:true});assert.ok(f.form.elements.active);f.ctx.me.role='staff';const html=f.ctx.supplierEditor(f.suppliers[0]);assert.doesNotMatch(html,/name="active"/);assert.match(html,/Supplier name/);
});
