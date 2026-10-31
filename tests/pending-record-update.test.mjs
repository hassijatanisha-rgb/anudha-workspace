import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const source=readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Minimal DOM adapter for the actual render/bind/save functions. It records identity,
// disconnection and focus; visual layout and native dialog behavior need browser review.
function dom(){
 const decode=s=>String(s).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&');let document;
 const dataName=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 class Node{
  constructor(tag='',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.events={};this._text='';this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.value=attrs.value||'';this.selectionStart=this.selectionEnd=0;this.scrollLeft=0;this.open='open'in attrs;this.dataset=new Proxy({},{get:(_,key)=>this.attrs[dataName(key)],set:(_,key,value)=>(this.attrs[dataName(key)]=value,true),ownKeys:()=>Object.keys(this.attrs).filter(key=>key.startsWith('data-')).map(key=>key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});}
  get id(){return this.attrs.id;}get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value);}
  set innerHTML(value){this.replaceChildren(...parse(value));}get innerHTML(){return this._text+this.children.map(child=>child.outerHTML).join('');}
  get outerHTML(){return this.tag?`<${this.tag}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('')}>${this.innerHTML}</${this.tag}>`:this._text;}
  get firstElementChild(){return this.children.find(node=>node.tag)||null;}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){
   let no=true;selector=selector.replace(/:not\(([^)]+)\)/g,(_,negative)=>{if(this.matches(negative))no=false;return '';});if(!no)return false;
   if(selector===':disabled')return this.disabled;
   const attrs=[...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];if(attrs.some(([,key,value])=>!(key in this.attrs)||value!==undefined&&this.attrs[key]!==value))return false;
   selector=selector.replace(/\[[^\]]+\]/g,'');const id=selector.match(/#([\w-]+)/)?.[1],klass=selector.match(/\.([\w-]+)/)?.[1],tag=selector.match(/^[a-z]+/)?.[0];return (!id||this.id===id)&&(!klass||(this.attrs.class||'').split(' ').includes(klass))&&(!tag||this.tag===tag);
  }
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelectorAll(selector){const out=[],selectors=selector.split(',').map(value=>value.trim());const visit=node=>{for(const child of node.children){if(child.tag&&selectors.some(value=>{const parts=value.split(/\s+/);return child.matches(parts.at(-1))&&(parts.length===1||child.parentElement?.closest(parts.slice(0,-1).join(' ')));}))out.push(child);visit(child);}};visit(this);return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){node.remove();const at=before?this.children.indexOf(before):this.children.length;assert.notEqual(at,-1);this.children.splice(at,0,node);node.parentElement=this;}
  replaceChildren(...nodes){for(const node of [...this.children])node.remove();this._text='';this.append(...nodes);}
  replaceWith(node){const parent=this.parentElement;assert.ok(parent,'Replacement requires an attached old node');parent.insertBefore(node,this);this.remove();}
  remove(){if(!this.parentElement)return;if(this.isConnected&&this.contains(document.activeElement))document.activeElement=document.body;const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}
  insertAdjacentHTML(position,html){assert.equal(position,'beforeend');this.append(...parse(html));}
  addEventListener(name,fn,options){(this.events[name]??=[]).push({fn,once:!!options?.once});}
  emit(name){for(const event of [...(this.events[name]||[])]){event.fn();if(event.once)this.events[name].splice(this.events[name].indexOf(event),1);}}
  focus(){document.activeElement=this;}setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  get elements(){return new Proxy({},{get:(_,name)=>this.querySelector(`[name="${name}"]`)});}
 }
 function parse(html){const root=new Node(),stack=[root];for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[match[1]]=decode(match[2]??'');const node=new Node(tag,attrs);stack.at(-1).append(node);if(!['input','br','hr','img','meta','link'].includes(tag))stack.push(node);}else{const node=new Node();node._text=decode(token);stack.at(-1).append(node);}}return [...root.children];}
 document={createElement(tag){const node=new Node(tag);if(tag==='template'){node.content=new Node();Object.defineProperty(node,'innerHTML',{set:value=>node.content.innerHTML=value});}return node;}};document.body=new Node('body');document.activeElement=document.body;document.querySelector=selector=>document.body.querySelector(selector);document.querySelectorAll=selector=>document.body.querySelectorAll(selector);return document;
}
const full=(id='one')=>({id,request_number:'PS-'+id,product_id:'product',organization_id:'clinic',quantity:20,status:'waiting',expires_on:'2099-01-01',salesperson_user_id:'sales',version:2,extension_count:0,notes:'Customer <instructions>',close_note:'',proforma_id:null,proforma_line_id:null,closed_at:null});
const summary=row=>({id:row.id,request_number:row.request_number,product_id:row.product_id,quantity:row.quantity,status:row.status,expires_on:row.expires_on,closed_at:row.closed_at,proforma_line_id:row.proforma_line_id,page_summary:true,product_name:'Product',client_label:'Clinic',available_units:30});
function fixture(){
 const document=dom();installNativeFormControls(document);Object.defineProperty(Object.getPrototypeOf(document.body),'values',{get(){return this._values;},set(values){this._values=values;for(const [name,value]of Object.entries(values)){const control=this.querySelector(`[name="${name}"]`);if(control)control.value=value;}}});const content=document.createElement('main');content.setAttribute('id','content');document.body.append(content);let writes=0;const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:value=>{writes++;descriptor.set.call(content,value);}});
 const calls=[],messages=[],forms=[],scrolls=[],handoffs=[],original=full(),other=full('two'),cacheOnly=full('outside'),dialog=document.createElement('dialog');document.body.append(dialog);
 const c=vm.createContext({statusTone,busy:false,me:{user_id:'sales',role:'owner'},view:'pending',document,window:{scrollX:7,scrollY:300,scrollTo:value=>scrolls.push(value)},CSS:{escape:String},crypto:{randomUUID:()=> 'stable-id'},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),employeeName:()=> 'Sales person',employeeDirectory:new Map(),products:[{id:'product',name:'Product'}],orgIndex:new Map([['clinic',{name:'Clinic'}]]),salesProformas:[],hasArea:()=>true,
  $:selector=>document.querySelector(selector),message:(text,error)=>messages.push({text,error}),run:fn=>c.running=fn(),all:()=>assert.fail('No full read after save'),loadLists:()=>assert.fail('No shared list reload'),
  actionForm:(title,fields,submit)=>{forms.push({title,fields,submit});dialog.open=true;dialog.setAttribute('open','');dialog.innerHTML='<textarea name="note"></textarea>';dialog.firstElementChild.focus();},
  decorateWorkHandoffs:async root=>{handoffs.push(root);},syncWorkspaceNavigation(){},workspaceLoading:()=>assert.fail('No workspace load after save'),renderSearchPreservingPosition:(_,fn)=>fn(),
  salesOrganizationOptions:()=>'<option value="clinic">Clinic</option>',salesProductChoices:()=>'<option value="Product"></option>',leadEmployeeOptions:()=>'<option value="sales">Sales</option>',inventoryProductFromChoice:()=>({id:'product'}),
  FormData:class{constructor(form){this.form=form;}get(key){return this.form.values?.[key]||'';}}
 });
 installPageHeader(c);vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),c);vm.runInContext(source,c);const get=code=>vm.runInContext(code,c);c.seed=[original,other,cacheOnly];c.snapshot=(rows=[original,other])=>({rows:rows.map(summary),total:rows.length,page:0,pages:1,as_of:c.pendingToday(),availability_error:false,mine_arrived:rows.filter(row=>row.status==='waiting').length,counts:{all:3,waiting:3,arrived:3,mine:3,due:0,closed:0}});
 c.initial=c.snapshot();get("pendingRows=seed;pendingActor=me;pendingLoaded=true;pendingPageData=initial;pendingSelectedId='one';pendingAvailabilityDay=pendingToday();pendingAvailability=new Map([['product',30]]);pendingSearch='retained query';pendingFilter='all'");c.renderPendingStock();handoffs.length=0;
 c.client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='pending_stock_page'?c.nextPage||c.snapshot():c.saved};}};
 const close=()=>{dialog.open=false;delete dialog.attrs.open;document.activeElement=document.body;dialog.emit('close');};
 return {c,get,calls,messages,forms,scrolls,handoffs,original,other,cacheOnly,content,document,dialog,writes:()=>writes,card:id=>document.querySelector(`[data-pending-card="${id}"]`),control:id=>document.querySelector('#'+id),submit:async values=>{await forms.at(-1).submit(values);close();},close};
}
function savedFor(f,action){return {...f.original,version:3,status:{fulfil:'fulfilled',cancel:'cancelled',expire:'expired',extend:'waiting'}[action],extension_count:action==='extend'?1:0,expires_on:action==='extend'?'2099-04-01':f.original.expires_on,close_note:action==='extend'?'':'Confirmed <reference>',closed_at:action==='extend'?null:'2026-10-29T09:00:00Z'};}
function beginAction(f,action){const trigger=f.card('one').querySelector(`[data-pending-action="${action}"]`)||f.card('one').querySelector('[data-pending-action="cancel"]');trigger.focus();f.c.openPendingAction(f.original,action,trigger);return trigger;}

test('each versioned action patches the saved detail before one bounded read and retains unrelated DOM and full caches',async()=>{
 for(const action of ['fulfil','cancel','extend','expire']){
  const f=fixture(),other=f.card('two'),search=f.control('pendingSearch'),filter=f.document.querySelector('[data-pending-filter="all"]'),old=f.card('one'),wait=deferred();f.c.saved=savedFor(f,action);beginAction(f,action);
  f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return name==='pending_stock_page'?wait.promise:{data:[f.c.saved]};};const saving=f.submit({note:'Confirmed reference',months:3});await tick();
  assert.notEqual(f.card('one'),old);assert.match(f.card('one').textContent,action==='extend'?/2099-04-01/:/Confirmed <reference>/);assert.equal(f.get('pendingRows[0].version'),3);assert.equal(f.card('two'),other);assert.equal(f.writes(),1);assert.equal(f.handoffs.length,0);assert.match(f.card('one').textContent,/Handoff information needs refresh/);
  wait.resolve({data:f.c.snapshot([f.other])});await saving;
  assert.deepEqual(f.calls.map(call=>call.name),['advance_pending_stock_request','pending_stock_page']);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{p_id:'one',p_expected_version:2,p_action:action,p_note:'Confirmed reference',p_extend_months:action==='extend'?3:null});assert.equal(f.calls[1].args.p_query,'retained query');assert.equal(f.calls[1].args.p_filter,'all');
  assert.equal(f.card('two'),other);assert.equal(f.control('pendingSearch'),search);assert.equal(f.document.querySelector('[data-pending-filter="all"]'),filter);assert.equal(f.get('pendingRows.length'),3);assert.equal(f.get('pendingRows[2]'),f.cacheOnly);assert.equal(f.writes(),1);assert.match(f.control('pendingCount').textContent,/1 matching/);assert.equal(f.card('one').parentElement.children.at(-1),f.card('one'),'saved detail stays accessible outside the filtered register');
  assert.equal(f.document.activeElement,action==='extend'?f.card('one').querySelector('[data-pending-action="extend"]'):f.card('one').querySelector('[data-pending-history]'));assert.ok(f.scrolls.every(value=>value.left===7&&value.top===300));
 }
});
test('a reconciliation keeps focused search selection and scroll without replacing unchanged summaries',async()=>{
 const f=fixture(),search=f.control('pendingSearch'),other=f.card('two');f.c.saved=savedFor(f,'cancel');beginAction(f,'cancel');search.focus();search.selectionStart=2;search.selectionEnd=7;search.scrollLeft=11;await f.forms.at(-1).submit({note:'Customer cancelled'});
 assert.equal(f.document.activeElement,search);assert.equal(search.selectionStart,2);assert.equal(search.selectionEnd,7);assert.equal(search.scrollLeft,11);assert.equal(f.card('two'),other);assert.equal(f.writes(),1);
});
test('a failed register read keeps the saved detail, exposes truthful Retry and never repeats the write',async()=>{
 const f=fixture(),other=f.card('two');f.c.saved=savedFor(f,'cancel');beginAction(f,'cancel');let reads=0;f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return name==='advance_pending_stock_request'?{data:f.c.saved}:++reads===1?{error:{message:'Offline <now>'}}:{data:f.c.snapshot([f.other])};};await f.submit({note:'Customer cancelled'});
 const savedCard=f.card('one');assert.equal(f.get('pendingRows[0].status'),'cancelled');assert.equal(f.get('pendingPageData.total'),2);assert.match(f.control('pendingRegisterNotice').textContent,/Saved, but the register could not refresh: Offline <now>/);assert.doesNotMatch(f.content.textContent,/Nothing was changed/);assert.equal(f.messages.length,1);assert.match(f.messages[0].text,/saved/);
 const retry=f.control('pendingRetryRegister');retry.focus();await retry.onclick();assert.equal(f.card('one'),savedCard);assert.equal(f.card('two'),other);assert.equal(f.writes(),1);assert.deepEqual(f.calls.map(call=>call.name),['advance_pending_stock_request','pending_stock_page','pending_stock_page']);assert.equal(f.control('pendingRegisterNotice').textContent,'');assert.equal(f.document.activeElement,f.control('pendingPageStatus'));
});
test('successful create preserves a stable retry ID, then inserts one full detail and clears only its form',async()=>{
 const f=fixture();f.get("pendingSelectedId='';pendingCreating=true");f.c.renderPendingStock();const other=f.card('two'),search=f.control('pendingSearch'),before=f.writes(),form=f.control('pendingForm');form.values={organizationId:'clinic',productChoice:'Product',quantity:'5',salesperson:'sales',notes:'Keep <content>'};const button=form.querySelector('[type="submit"]');button.focus();let attempts=0;
 f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});if(name==='pending_stock_page')return {data:f.c.snapshot()};if(++attempts===1)return {error:{message:'Connection uncertain'}};return {data:{...full(args.p_id),version:1,quantity:5,notes:'Keep <content>'}};};
 form.onsubmit({preventDefault(){}});await assert.rejects(f.c.running,/Connection uncertain/);assert.equal(f.get('pendingRequestId'),'stable-id');assert.equal(button.disabled,false);assert.equal(form.values.notes,'Keep <content>');
 form.onsubmit({preventDefault(){}});await f.c.running;assert.equal(f.calls[0].args.p_id,f.calls[1].args.p_id);assert.equal(f.get('pendingRequestId'),null);assert.equal(f.control('pendingForm'),null);assert.match(f.card('stable-id').textContent,/5 pcs/);assert.equal(f.card('two'),other);assert.equal(f.control('pendingSearch'),search);assert.equal(f.writes(),before);assert.equal(f.get('pendingRows.length'),4);assert.deepEqual(f.calls.map(call=>call.name),['create_pending_stock_request','create_pending_stock_request','pending_stock_page']);assert.equal(f.document.activeElement,f.card('stable-id').querySelector('.actions button'));
});
test('failed writes and stale actor, navigation, or render epoch cannot patch or read the register',async()=>{
 for(const change of ['write failure','actor','route','epoch']){const f=fixture(),old=f.card('one'),wait=deferred();beginAction(f,'cancel');f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise;};const saving=f.forms.at(-1).submit({note:'Customer cancelled'});if(change==='actor')f.c.me={...f.c.me};if(change==='route')f.c.view='reports';if(change==='epoch')f.get('pendingRenderEpoch++');wait.resolve(change==='write failure'?{error:{message:'Version changed'}}:{data:savedFor(f,'cancel')});if(change==='write failure')await assert.rejects(saving,/Version changed/);else await saving;assert.equal(f.card('one'),old);assert.equal(f.get('pendingRows[0].version'),2);assert.equal(f.calls.length,1);assert.deepEqual(f.messages,[]);assert.equal(f.writes(),1);}
});
test('late success or failure after a confirmed save cannot replace another actor or render',async()=>{
 for(const outcome of ['success','failure'])for(const change of ['actor','route','epoch']){const f=fixture(),wait=deferred();f.c.saved=savedFor(f,'cancel');beginAction(f,'cancel');f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return name==='pending_stock_page'?wait.promise:{data:f.c.saved};};const saving=f.forms.at(-1).submit({note:'Customer cancelled'});await tick();if(change==='actor')f.c.me={...f.c.me};if(change==='route')f.c.view='reports';if(change==='epoch')f.get('pendingRenderEpoch++');f.content.innerHTML='<p>New context</p>';if(outcome==='failure')wait.reject(Error('Old error'));else wait.resolve({data:f.c.snapshot([f.other])});await saving;assert.equal(f.content.textContent,'New context');assert.equal(f.get('pendingRegisterError'),'');assert.equal(f.get('pendingPageData.total'),2);assert.equal(f.messages.length,1,'only the save confirmation emitted before context changed');}
});
test('incomplete or wrong successful records disable further mutations and stay truthful without fabricating details',async()=>{
 for(const mutate of [()=>null,row=>[row,row],row=>({...row,id:'wrong'}),row=>({...row,version:7}),row=>({...row,version:undefined}),row=>({...row,notes:undefined}),row=>({...row,proforma_line_id:undefined}),row=>({...row,status:'waiting'}),row=>({...row,extension_count:undefined}),row=>({...row,expires_on:'bad-date'})]){const f=fixture();f.c.saved=mutate(savedFor(f,'cancel'));beginAction(f,'cancel');await f.submit({note:'Cancelled'});assert.equal(f.get('pendingRows[0].version'),2);assert.equal(f.calls.length,1);assert.equal(f.card('one').querySelector('[data-pending-action]'),null);assert.equal(f.card('one').querySelector('[data-pending-handoff-refresh]'),null);assert.ok(f.card('one').querySelector('[data-pending-open'));assert.match(f.control('pendingRegisterNotice').textContent,/save completed.*could not be verified/);assert.equal(f.messages[0].error,true);assert.throws(()=>f.c.openPendingAction(f.original,'cancel'),/Reload/);f.c.renderPendingStock();assert.equal(f.card('one').querySelector('[data-pending-action]'),null);assert.match(f.control('pendingRegisterNotice').textContent,/could not be verified/);}
});
test('saved handoff content is labelled stale with no stale mutation controls; only explicit refresh decorates that card',async()=>{
 const f=fixture(),card=f.card('one'),handoff=f.document.createElement('div');handoff.setAttribute('data-work-handoff','one');handoff.innerHTML='<p>Responsible: Sales person</p><button data-work-delay>Report delay</button>';card.insertBefore(handoff,card.querySelector('.actions'));f.c.saved=savedFor(f,'cancel');beginAction(f,'cancel');await f.submit({note:'Cancelled'});
 assert.equal(f.card('one').querySelector('[data-work-handoff]'),handoff);assert.match(handoff.textContent,/Responsible: Sales person/);assert.match(handoff.textContent,/needs refresh/);assert.equal(handoff.querySelector('[data-work-delay]'),null);assert.equal(f.handoffs.length,0);const refresh=handoff.querySelector('[data-pending-handoff-refresh]');await refresh.onclick();assert.deepEqual(f.handoffs,[f.card('one')]);assert.equal(f.get("pendingHandoffRefresh.has('one')"),false);assert.equal(f.card('two').querySelector('[data-pending-handoff-refresh]'),null);
});

test('an unverified create stays disabled with a reachable reload instead of repeating a confirmed write',async()=>{
 const f=fixture();f.get("pendingSelectedId='';pendingCreating=true");f.c.renderPendingStock();const form=f.control('pendingForm');form.values={organizationId:'clinic',productChoice:'Product',quantity:'5',salesperson:'sales'};f.c.saved={id:'stable-id',request_number:'PS-new'};
 form.onsubmit({preventDefault(){}});await f.c.running;assert.equal(form.querySelector('[type="submit"]').disabled,true);assert.equal(f.get('pendingRequestId'),'stable-id');assert.equal(f.calls.length,1);assert.ok(f.control('pendingRegisterNotice').querySelector('[data-pending-open="stable-id"]'));assert.match(f.control('pendingRegisterNotice').textContent,/save completed.*could not be verified/);await assert.rejects(f.c.savePendingForm(form),/Reload/);assert.equal(f.calls.length,1);
});
test('create still mounts its confirmed detail when the earlier register read failed',async()=>{
 const f=fixture();f.get("pendingPageData=null;pendingSelectedId='';pendingCreating=true;pendingLoadError='Earlier offline'");f.c.renderPendingStock();const before=f.writes(),form=f.control('pendingForm');form.values={organizationId:'clinic',productChoice:'Product',quantity:'5',salesperson:'sales'};f.c.saved={...full('stable-id'),version:1,quantity:5};form.onsubmit({preventDefault(){}});await f.c.running;
 assert.ok(f.card('stable-id'));assert.doesNotMatch(f.content.textContent,/Earlier offline/);assert.equal(f.writes(),before);assert.equal(f.control('pendingPaging').hidden,false);assert.deepEqual(f.calls.map(call=>call.name),['create_pending_stock_request','pending_stock_page']);
});
test('late create success and rejection respect form disconnection, replacement actor and render epoch',async()=>{
 for(const outcome of ['success','reject'])for(const change of ['disconnect','actor','epoch']){const f=fixture();f.get("pendingSelectedId='';pendingCreating=true");f.c.renderPendingStock();const form=f.control('pendingForm'),wait=deferred();form.values={organizationId:'clinic',productChoice:'Product',quantity:'5',salesperson:'sales'};f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise;};const saving=f.c.savePendingForm(form);if(change==='disconnect')form.remove();if(change==='actor')f.c.me={...f.c.me};if(change==='epoch')f.get('pendingRenderEpoch++');if(outcome==='reject')wait.reject(Error('Old connection'));else wait.resolve({data:{...full('stable-id'),version:1}});await saving;assert.equal(f.get('pendingRows.length'),3);assert.equal(f.messages.length,0);assert.equal(f.calls.length,1);assert.equal(f.card('stable-id'),null);}
});
test('late action rejection is suppressed after actor or render changes',async()=>{
 for(const change of ['actor','epoch']){const f=fixture(),wait=deferred(),old=f.card('one');beginAction(f,'cancel');f.c.client.rpc=()=>wait.promise;const saving=f.forms.at(-1).submit({note:'Cancelled'});if(change==='actor')f.c.me={...f.c.me};else f.get('pendingRenderEpoch++');wait.reject(Error('Old network error'));await saving;assert.equal(f.card('one'),old);assert.equal(f.messages.length,0);}
});
test('a repeated register retry failure retains the new Retry button focus and unchanged detail',async()=>{
 const f=fixture();f.c.saved=savedFor(f,'cancel');beginAction(f,'cancel');f.c.client.rpc=async name=>name==='pending_stock_page'?{error:{message:'Still offline'}}:{data:f.c.saved};await f.submit({note:'Cancelled'});const card=f.card('one'),retry=f.control('pendingRetryRegister');retry.focus();await retry.onclick();assert.equal(f.card('one'),card);assert.equal(f.document.activeElement,f.control('pendingRetryRegister'));assert.notEqual(f.control('pendingRetryRegister'),retry);assert.equal(f.control('pendingRetryRegister').disabled,false);
});
test('reconciliation changes only changed summaries and respects server membership and ordering',async()=>{
 const f=fixture(),oldOther=f.card('two'),newRow=full('three'),page=f.c.snapshot([newRow,{...f.other,request_number:'PS-renamed'}]);f.c.saved=savedFor(f,'cancel');f.c.nextPage=page;beginAction(f,'cancel');await f.submit({note:'Cancelled'});assert.notEqual(f.card('two'),oldOther);assert.match(f.card('two').textContent,/PS-renamed/);assert.deepEqual(f.control('pendingCards').children.map(card=>card.dataset.pendingCard),['three','two','one']);assert.equal(f.get('pendingRows.length'),3,'new summary rows never enter the complete detail cache');assert.equal(f.writes(),1);
});
