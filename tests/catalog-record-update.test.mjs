import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPageHeader} from './helpers/page-header.mjs';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Actual render/save callbacks against a DOM identity adapter; native layout/dialog behavior needs browser review.
function dom(){
 const decode=s=>String(s).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&');let document;
 const dataName=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 class Node{
  constructor(tag='',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.events={};this._text='';this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.value=attrs.value||'';this.selectionStart=this.selectionEnd=0;this.scrollLeft=0;this.open='open'in attrs;this.dataset=new Proxy({},{get:(_,key)=>this.attrs[dataName(key)],set:(_,key,value)=>(this.attrs[dataName(key)]=value,true),ownKeys:()=>Object.keys(this.attrs).filter(key=>key.startsWith('data-')).map(key=>key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});}
  get id(){return this.attrs.id;}get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value);}
  set innerHTML(value){this.replaceChildren(...parse(value));}get innerHTML(){return this._text+this.children.map(child=>child.outerHTML).join('');}
  get outerHTML(){return this.tag?`<${this.tag}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('')}>${this.innerHTML}</${this.tag}>`:this._text;}
  get nextElementSibling(){const rows=this.parentElement?.children.filter(node=>node.tag)||[];return rows[rows.indexOf(this)+1]||null;}
  showModal(){this.open=true;this.attrs.open='';}close(){this.open=false;delete this.attrs.open;this.emit('close');}
  get firstElementChild(){return this.children.find(node=>node.tag)||null;}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){
   let no=true;selector=selector.replace(/:not\(([^)]+)\)/g,(_,negative)=>{if(this.matches(negative))no=false;return '';});if(!no)return false;
   if(selector===':disabled')return this.disabled;
   const attrs=[...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];if(attrs.some(([,key,value])=>!(key in this.attrs)||value!==undefined&&this.attrs[key]!==value))return false;
   selector=selector.replace(/\[[^\]]+\]/g,'');const id=selector.match(/#([\w-]+)/)?.[1],klass=selector.match(/\.([\w-]+)/)?.[1],tag=selector.match(/^[a-z][a-z0-9-]*/)?.[0];return (!id||this.id===id)&&(!klass||(this.attrs.class||'').split(' ').includes(klass))&&(!tag||this.tag===tag);
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
const product=(id='one',name='Reagent '+id)=>({id,name,sku:'CODE-'+id,catalog_current:true,catalog_duplicate_count:1,source:{company:'Maker',specification:'20 ml',sale_status:'active',batch_required:true,expiry_required:true,category:'reagents',machine_ids:['machine']},catalog_classification:{version:2,category:'reagents',reason:'Label checked'},review:{product_id:id,version:2,name,company:'Maker',specification:'20 ml',sale_status:'active',batch_required:true,expiry_required:true},links:{product_id:id,version:2,machine_ids:['machine']},original:{id,name:'Raw '+id,sku:'CODE-'+id,revision:4,source:{raw:{Particulars:'Original <row>'}}}});
const page=(rows,total=rows.length)=>({rows,total,page:0,pages:Math.max(1,Math.ceil(total/25)),metrics:{products:total+50,review:total,active:5,manufacturers:3},category_counts:{all:total,review:total,reagents:total},colour_counts:{red:0,yellow:0,ok:total}});
function fixture(){
 const document=dom();document.addEventListener=()=>{};const content=document.createElement('main');content.setAttribute('id','content');document.body.append(content);let contentWrites=0;const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:value=>{contentWrites++;descriptor.set.call(content,value);}});
 const calls=[],scrolls=[],messages=[],forms=[],one=product(),two=product('two'),machine={...product('machine','Analyzer'),source:{category:'machines'}};let uuid=0;
 const c=vm.createContext({workspaceLeaveSequence:0,sessionLoadEpoch:0,location:{hash:''},history:{state:{erpNavigationBranch:'catalog-test',erpNavigationIndex:0},replaceState(state,_,hash){this.state=state;c.location.hash=hash;},pushState(state,_,hash){this.state=state;c.location.hash=hash;}},document,me:{user_id:'owner',role:'owner'},view:'inventory',inventorySection:'catalog',products:[{id:'complete-cache'}],inventoryLoaded:true,inventoryEpoch:4,listsLoaded:true,listsEpoch:3,listsLoading:Promise.resolve(true),inventoryStockPageKey:'cached',inventoryOperationsKey:'cached',inventoryStockActionsReady:true,inventoryLots:[{id:'lot'}],window:{addEventListener(){},scrollX:3,scrollY:123,scrollTo:value=>scrolls.push(value)},crypto:{randomUUID:()=> 'request-'+(++uuid)},
  $:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),canEditRecords:()=>true,recordsLockedNote:()=>'',recordsLockedText:'Locked',inventoryOption:(id,label,selected)=>`<option value="${id}" ${selected?'selected':''}>${label}</option>`,bindInventoryWorkspace(){},bindQuotationDocuments(){},all:()=>assert.fail('No full list load'),loadLists:()=>assert.fail('No shared list load'),render:()=>assert.fail('No workspace render after a catalog save'),run:fn=>c.running=fn(),message:(...args)=>messages.push(args),renderSearchPreservingPosition:(_,fn)=>fn(),field:(name,label,value)=>`<label>${label}<input name="${name}" value="${value}"></label>`,actionSubmit:null,
  actionForm:(title,fields,submit)=>{const dialog=document.createElement('dialog');dialog.innerHTML='<form>'+fields+'</form>';document.body.append(dialog);dialog.showModal();const form=dialog.querySelector('form');form.values={};c.actionSubmit=submit;forms.push({dialog,form,submit});return form;},
  FormData:class{constructor(form){this.form=form;}get(key){return this.form.values?.[key]??this.form.querySelector(`[name="${key}"]`)?.value??'';}getAll(key){return this.form.values?.[key]||[];}}
 });

 Object.assign(c,{showWorkspaceDialog:(dialog,{size})=>{dialog.dataset.dialogSize=size;dialog.showModal();},closeWorkspaceDialog:async dialog=>{dialog.close();return true;},workspaceFormSnapshot:form=>JSON.stringify(form.values||form.fields||[...form.querySelectorAll('[name]')].map(node=>[node.getAttribute('name'),node.value])),bindWorkspaceDialogDismiss:(dialog,{isBusy})=>async()=>{if(isBusy())return false;dialog.close();return true;}});
 c.busy=false;c.feedback=[];c.actionFeedbackRememberDialog=dialog=>{dialog.feedbackRemembered=true;};c.actionFeedbackRefuse=(origin,target)=>{target.textContent='Another action is still running.';};
 c.run=(fn,options)=>c.running=(async()=>{if(!options)return fn();c.feedback.push(options);try{return await fn();}catch(error){options.errorTarget.textContent=error.message;}})();
 vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],c);
 installPageHeader(c);
 for(const file of ['client-rules.js','record-navigation.js','nav-history.js','product-review.js','catalog-inventory.js','product-workbench.js','product-review-ui.js','product-machine-links.js'])vm.runInContext(read(file),c);
 const raw=read('action-forms.js');vm.runInContext(raw.slice(raw.indexOf('function openProductForm('),raw.indexOf('function openIncorrectForm(')),c);
 const get=code=>vm.runInContext(code,c);c.one=one;c.two=two;c.machine=machine;c.next=product('one','Corrected <name>');c.next.review.version=3;c.next.links.version=3;c.next.original.revision=5;c.next.catalog_classification.version=3;c.resultRows=[c.next,two];
 c.client={rpc:async(name,args)=>{calls.push({name,args});return {data:name!=='catalog_page'?{}:args.p_product_id?page([c.saved?c.next:one]):args.p_category==='machines'?page([machine]):page(c.saved?c.resultRows:[one,two])};}};
 c.catalogRender(page([one,two]));c.seed=page([one,two]);get("catalogResult=seed;catalogSearch='retained';catalogCategory='reagents';catalogMachineChoices=[machine]");
 const row=id=>document.querySelector(`[data-catalog-row="${id}"]`),node=id=>document.querySelector('#'+id);
 async function open(kind){
  if(kind==='review')await c.openProductReview('one');
  else if(kind==='links')await c.openProductMachineLinks('one');
  else c.openProductForm(kind==='create'?null:one.original);
  const dialog=document.querySelectorAll('dialog').at(-1),form=dialog.querySelector('form');form.values={name:'Corrected <name>',sku:'NEW',company:'Maker',specification:'20 ml',sale_status:'active',batch_required:'yes',expiry_required:'yes',reason:'Label checked',machineId:['machine']};calls.length=0;
  return {dialog,form,submit:async()=>{c.saved=true;if(kind==='raw'||kind==='create'){await forms.at(-1).submit(form.values);dialog.close();}else await form.onsubmit({preventDefault(){}});}};
 }
 return {c,get,document,content,calls,scrolls,messages,forms,one,two,machine,row,node,open,writes:()=>contentWrites};
}

test('review, links and raw name/code writes use authoritative detail plus one bounded page, retaining shell/equal rows/disclosures/full caches',async()=>{
 for(const kind of ['review','links','raw']){
  const f=fixture(),header=f.document.querySelector('.workspace-page-header'),other=f.row('two'),search=f.node('catalogSearch'),sort=f.node('catalogSort'),colour=f.node('catalogColour'),category=f.document.querySelector('[data-catalog-category="reagents"]'),products=f.c.products,lots=f.c.inventoryLots;
  f.c.catalogShowDetail(f.one);const back=f.node('workbenchBack'),edit=header.querySelector('[data-product-edit]'),detailBefore=f.document.querySelector('[data-catalog-detail]');detailBefore.querySelector('details').open=true;
  const editor=await f.open(kind);await editor.submit();
  assert.ok(header);assert.equal(f.document.querySelector('.workspace-page-header'),header);assert.equal(f.node('workbenchBack'),back);assert.equal(header.querySelector('[data-product-edit]'),edit);assert.equal(header.querySelector('h1').textContent,'Corrected <name>');assert.equal(f.writes(),1);assert.equal(f.row('two'),other);assert.equal(f.node('catalogSearch'),search);assert.equal(f.node('catalogSort'),sort);assert.equal(f.node('catalogColour'),colour);assert.equal(f.document.querySelector('[data-catalog-category="reagents"]'),category);
  assert.notEqual(f.document.querySelector('[data-catalog-detail]'),detailBefore);assert.equal(f.document.querySelector('[data-catalog-detail]').querySelector('details').open,true);assert.match(f.document.querySelector('[data-catalog-detail]').textContent,/Corrected <name>/);assert.equal(f.get('catalogSelectedProduct'),'one');
  assert.deepEqual(f.calls.map(x=>x.name),[kind==='review'?'save_product_detail_review':kind==='links'?'save_product_machine_link_review':'save_product','catalog_page','catalog_page']);assert.equal(f.calls[1].args.p_product_id,'one');assert.equal(f.calls[2].args.p_product_id,null);assert.equal(f.calls[2].args.p_query,'retained');assert.equal(f.calls[2].args.p_category,'reagents');
  if(kind==='raw')assert.equal(f.calls[0].args.p_revision,4);else assert.equal(f.calls[0].args.p_expected_version,2);
  assert.equal(f.c.products,products);assert.equal(f.c.inventoryLots,lots);assert.equal(products.length,1);assert.equal(f.c.inventoryLoaded,false);assert.equal(f.c.listsLoaded,false);assert.equal(f.c.listsLoading,null);assert.equal(f.c.listsEpoch,4);assert.equal(f.c.inventoryEpoch,5);assert.equal(f.c.inventoryStockPageKey,'');assert.ok(f.scrolls.every(v=>v.left===3&&v.top===123));assert.match(f.node('catalogSaveNotice').textContent,/saved/);
 }
});
test('search selection/focus stays on its original node during a save reconciliation',async()=>{
 const f=fixture(),editor=await f.open('review'),search=f.node('catalogSearch');search.focus();search.selectionStart=2;search.selectionEnd=5;search.scrollLeft=10;await editor.submit();assert.equal(f.document.activeElement,search);assert.equal(search.selectionStart,2);assert.equal(search.selectionEnd,5);assert.equal(search.scrollLeft,10);
});
test('server membership/order/counts reconcile without losing selected off-filter detail or equal row nodes',async()=>{
 const f=fixture(),other=f.row('two');f.c.catalogShowDetail(f.one);const editor=await f.open('review');f.c.resultRows=[f.two,product('three')];await editor.submit();assert.equal(f.row('one'),null);assert.equal(f.row('two'),other);assert.deepEqual(f.node('catalogResults').querySelectorAll('[data-catalog-row]').map(row=>row.dataset.catalogRow),['two','three']);assert.equal(f.get('catalogSelectedProduct'),'one');assert.match(f.node('catalogDetail').textContent,/Corrected <name>/);assert.match(f.node('catalogStatus').textContent,/2 matching/);assert.equal(f.document.querySelector('[data-catalog-metric="products"]').textContent,'52');
});
test('failed detail verification disables stale mutations and Retry only rereads, never repeats the confirmed write',async()=>{
 const f=fixture();f.c.catalogShowDetail(f.one);const editor=await f.open('review'),original=f.c.client.rpc;let fails=true;
 f.c.client.rpc=async(name,args)=>{if(name==='catalog_page'&&args.p_product_id&&fails){f.calls.push({name,args});return {error:{message:'Offline <now>'}};}return original(name,args);};await editor.submit();
 assert.match(f.node('catalogSaveNotice').textContent,/Correction saved.*Product details could not refresh.*Offline <now>/);assert.doesNotMatch(f.content.textContent,/Not confirmed saved/);assert.equal(f.row('one').querySelector('[data-workbench-detail]').disabled,true);assert.equal(f.node('catalogDetail').querySelector('[type="submit"]').disabled,true);assert.equal(f.calls.length,2);
 fails=false;await f.node('catalogRetrySaved').onclick();assert.equal(f.calls.filter(x=>x.name==='save_product_detail_review').length,1);assert.equal(f.calls.length,4);assert.equal(f.row('one').querySelector('[data-workbench-detail]').disabled,false);assert.match(f.node('catalogDetail').textContent,/Corrected <name>/);
});
test('failed membership read retains authoritative detail and Retry uses only the page read',async()=>{
 const f=fixture(),other=f.row('two');f.c.catalogShowDetail(f.one);const editor=await f.open('links'),original=f.c.client.rpc;let fails=true;
 f.c.client.rpc=async(name,args)=>{if(name==='catalog_page'&&!args.p_product_id&&fails){f.calls.push({name,args});return {error:{message:'Register offline'}};}return original(name,args);};await editor.submit();const detail=f.node('catalogDetail').querySelector('article');assert.match(detail.textContent,/Corrected <name>/);assert.match(f.node('catalogSaveNotice').textContent,/Machine links saved.*counts and membership need refresh/);assert.equal(f.row('two'),other);fails=false;await f.node('catalogRetrySaved').onclick();assert.equal(f.calls.length,4);assert.equal(f.calls[3].args.p_product_id,null);assert.equal(f.node('catalogDetail').querySelector('article'),detail);assert.equal(f.row('two'),other);
});
test('new product keeps its id across uncertain retry and opens authoritative saved detail outside current membership',async()=>{
 const f=fixture(),editor=await f.open('create');let attempts=0;const original=f.c.client.rpc;f.c.next=product('request-1','New product');f.c.next.original.revision=1;f.c.resultRows=[f.one,f.two];f.c.client.rpc=async(name,args)=>{if(name==='add_product'&&++attempts===1){f.calls.push({name,args});return {error:{message:'Uncertain network'}};}return original(name,args);};await assert.rejects(editor.submit(),error=>error.message==='Uncertain network');await editor.submit();assert.equal(f.calls[0].args.p_id,f.calls[1].args.p_id);assert.equal(f.calls[1].args.p_source.origin,'manual');assert.equal(f.get('catalogSelectedProduct'),'request-1');assert.match(f.node('catalogDetail').textContent,/New product/);assert.equal(f.c.products.length,1);assert.equal(f.writes(),1);
});
test('actor object, navigation and catalog epoch suppress late write success/rejection',async()=>{
 for(const kind of ['review','links','raw'])for(const change of ['actor','route','epoch'])for(const outcome of ['success','reject']){
  const f=fixture(),editor=await f.open(kind),wait=deferred(),row=f.row('one');f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise;};const saving=editor.submit();if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else f.get('catalogRequest++');if(outcome==='success')wait.resolve({data:{}});else wait.reject(Error('Old failure'));await saving;assert.equal(f.calls.length,1);assert.equal(f.row('one'),row);assert.equal(f.node('catalogSaveNotice').textContent,'');assert.equal(f.c.inventoryLoaded,true);
 }
});
test('late detail/page success, malformed response and rejection cannot touch another actor or render',async()=>{
 for(const stage of ['detail','page'])for(const change of ['actor','route','epoch'])for(const outcome of ['success','malformed','reject']){
  const f=fixture(),editor=await f.open('review'),wait=deferred(),original=f.c.client.rpc;f.c.client.rpc=async(name,args)=>{if(name==='catalog_page'&&!!args.p_product_id===(stage==='detail')){f.calls.push({name,args});return wait.promise;}return original(name,args);};const saving=editor.submit();await tick();if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else f.get('catalogRequest++');f.content.innerHTML='<p>New context</p>';if(outcome==='reject')wait.reject(Error('Old read failure'));else wait.resolve({data:outcome==='malformed'?{}:page(stage==='detail'?[f.c.next]:[f.c.next,f.two])});await saving;assert.equal(f.content.textContent,'New context');assert.equal(f.messages.length,0);
 }
});
test('unverified minimum saved version stays locked with read-only Retry',async()=>{
 const f=fixture(),editor=await f.open('review');f.c.next.review.version=2;await editor.submit();assert.match(f.node('catalogSaveNotice').textContent,/latest saved product version could not be verified/);assert.equal(f.calls.length,2);assert.equal(f.row('one').querySelector('[data-workbench-detail]').disabled,true);
});
test('classification integration uses the same scoped reconciliation and expected authoritative version',async()=>{
 const f=fixture();f.c.saved=true;f.c.catalogShowDetail(f.one);await f.c.refreshCatalogSavedProduct('one','Inventory category saved.',f.c.catalogSaveContext(),{classification:3});assert.deepEqual(f.calls.map(x=>x.name),['catalog_page','catalog_page']);assert.equal(f.node('catalogDetail').querySelector('form').dataset.version,'3');assert.equal(f.writes(),1);
});

test('review and link failures keep the same request id and expected version for a retry',async()=>{
 for(const kind of ['review','links']){
  const f=fixture(),editor=await f.open(kind),original=f.c.client.rpc;let fail=true;
  f.c.client.rpc=async(name,args)=>{if(name!=='catalog_page'&&fail){f.calls.push({name,args});return {error:{message:'Version or connection failure'}};}return original(name,args);};await editor.submit();
  assert.match(editor.form.querySelector('[role="alert"]').textContent,/Not confirmed saved/);assert.equal(editor.form.querySelector('[type="submit"]').disabled,false);assert.equal(f.calls.length,1);fail=false;await editor.submit();assert.equal(f.calls[0].args.p_id,f.calls[1].args.p_id);assert.equal(f.calls[1].args.p_expected_version,2);assert.equal(f.calls.length,4);
 }
});

test('standalone correction and machine forms enter shared feedback and refuse a concurrent action',async()=>{
 for(const kind of ['review','links']){
  const f=fixture(),editor=await f.open(kind),button=editor.form.querySelector('[type="submit"]'),error=editor.form.querySelector('[role="alert"]');
  assert.equal(editor.dialog.feedbackRemembered,true);f.c.busy=true;await editor.submit();assert.equal(f.calls.length,0);assert.match(error.textContent,/Another action/);assert.equal(button.disabled,false);
  f.c.busy=false;const wait=deferred();f.c.client.rpc=()=>wait.promise;const saving=editor.submit();assert.equal(button.disabled,true);assert.equal(f.c.feedback.at(-1).origin,button);assert.equal(f.c.feedback.at(-1).errorTarget,error);assert.equal(f.c.feedback.at(-1).busyLabel,'Saving…');
  wait.resolve({error:{message:'Version changed'}});await saving;assert.equal(button.disabled,false);assert.equal(editor.dialog.open,true);assert.match(error.textContent,/Version changed/);assert.equal(editor.form.values.reason,'Label checked');
 }
});
test('disconnected review/link dialogs suppress late writes and late open reads never display another context',async()=>{
 for(const kind of ['review','links']){
  for(const outcome of ['success','reject']){
   const f=fixture(),editor=await f.open(kind),wait=deferred();f.c.client.rpc=()=>wait.promise;const saving=editor.submit();editor.dialog.close();if(outcome==='reject')wait.reject(Error('Old failure'));else wait.resolve({data:{}});await saving;assert.equal(f.c.inventoryLoaded,true);assert.equal(f.node('catalogSaveNotice').textContent,'');
  }
  for(const outcome of ['success','malformed','reject'])for(const change of ['actor','route','epoch']){
   const f=fixture(),wait=deferred();f.c.client.rpc=()=>wait.promise;const opening=kind==='review'?f.c.openProductReview('one'):f.c.openProductMachineLinks('one');if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else f.get('catalogRequest++');if(outcome==='reject')wait.reject(Error('Old load failure'));else wait.resolve({data:outcome==='malformed'?{}:page([f.one])});await opening;assert.equal(f.document.querySelectorAll('dialog').length,0);assert.equal(f.get('catalogDetailRows.size'),0);
  }
 }
});
test('selected detail remains mounted while its old register is replaced with an honest empty result',async()=>{
 const f=fixture(),editor=await f.open('review');f.c.catalogShowDetail(f.one);f.c.resultRows=[];await editor.submit();assert.equal(f.node('catalogResults').querySelectorAll('[data-catalog-row]').length,0);assert.match(f.node('catalogResults').textContent,/No products match/);assert.match(f.node('catalogDetail').textContent,/Corrected <name>/);assert.match(f.node('catalogStatus').textContent,/0 matching products/);assert.equal(f.node('catalogPrev').disabled,true);assert.equal(f.node('catalogNext').disabled,true);
});
test('authoritative row is patched before a slow membership read and repeated Retry failure retains keyboard focus',async()=>{
 const f=fixture(),editor=await f.open('raw'),wait=deferred(),original=f.c.client.rpc;f.c.client.rpc=async(name,args)=>name==='catalog_page'&&!args.p_product_id?wait.promise:original(name,args);const saving=editor.submit();await tick();assert.match(f.row('one').textContent,/Corrected <name>/);wait.resolve({error:{message:'Still offline'}});await saving;
 const retry=f.node('catalogRetrySaved');retry.focus();f.c.client.rpc=async()=>({error:{message:'Still offline'}});await retry.onclick();assert.equal(f.document.activeElement,f.node('catalogRetrySaved'));assert.equal(f.node('catalogRetrySaved').disabled,false);assert.match(f.row('one').textContent,/Corrected <name>/);
});
test('successful creation recovers the existing shell after the initial catalog read failed',async()=>{
 const f=fixture();f.get('catalogResult=null');f.c.catalogRender(null);f.node('catalogResults').innerHTML='<p>Earlier read failed</p>';const before=f.writes(),editor=await f.open('create');f.c.next=product('request-1','Added');f.c.next.original.revision=1;f.c.resultRows=[f.one,f.two];await editor.submit();assert.equal(f.writes(),before);assert.match(f.node('catalogStatus').textContent,/2 matching/);assert.match(f.node('catalogDetail').textContent,/Added/);assert.doesNotMatch(f.node('catalogSaveNotice').textContent,/could not refresh/);
});
test('opening and closing product detail keeps the list nodes and does not reread on Close',async()=>{
 const f=fixture(),row=f.row('two'),search=f.node('catalogSearch');await f.c.catalogOpenRecord('one');assert.equal(f.row('two'),row);assert.equal(f.node('catalogSearch'),search);assert.equal(f.get('catalogSelectedProduct'),'one');assert.equal(f.writes(),1);const count=f.calls.length;f.node('workbenchBack').onclick();assert.equal(f.calls.length,count);assert.equal(f.node('catalogDetail').children.length,0);assert.equal(f.document.activeElement,search);
});

test('a visible saved-read Retry remains usable after opening or closing a detail in the same catalog shell',async()=>{
 const f=fixture(),editor=await f.open('review'),original=f.c.client.rpc;let fail=true;f.c.client.rpc=async(name,args)=>name==='catalog_page'&&args.p_product_id&&fail?{error:{message:'Offline'}}:original(name,args);await editor.submit();fail=false;f.get('catalogRequest++');await f.node('catalogRetrySaved').onclick();assert.match(f.row('one').textContent,/Corrected <name>/);assert.doesNotMatch(f.node('catalogSaveNotice').textContent,/could not refresh/);assert.equal(f.calls.filter(call=>call.name==='save_product_detail_review').length,1);
});

test('product detail shares its record identity and primary edit without replacing list or header nodes',()=>{
 const f=fixture(),header=f.content.querySelector('.workspace-page-header'),list=f.node('catalogResults'),search=f.node('catalogSearch');
 f.c.catalogShowDetail(f.one);assert.equal(f.content.querySelector('.workspace-page-header'),header);assert.equal(f.content.querySelectorAll('h1').length,1);assert.equal(header.querySelector('h1').textContent,f.one.name);
 assert.equal(header.querySelector('[aria-current="page"]').getAttribute('href'),'#/product/'+f.one.id);assert.equal(header.querySelectorAll('[data-product-edit]').length,1);assert.equal(f.node('catalogDetail').querySelector('[data-product-edit]'),null);
 f.node('workbenchBack').onclick();assert.equal(header.querySelector('h1').textContent,'Products');assert.equal(header.querySelector('#newProduct').getAttribute('class'),'button-primary');assert.equal(f.node('catalogResults'),list);assert.equal(f.node('catalogSearch'),search);
});

test('Catalog Back restores its history scroll with unchanged list nodes and no new read',async()=>{
 const f=fixture(),row=f.row('two'),search=f.node('catalogSearch'),header=f.content.querySelector('.workspace-page-header'),product={...f.one,id:'10000000-0000-4000-8000-000000000001'};
 f.c.navRecordPage('#/go/inventory/catalog');f.c.navRememberListPlace();f.c.navRecordPage('#/product/'+product.id);f.c.catalogShowDetail(product);f.c.window.scrollY=0;f.scrolls.length=0;const reads=f.calls.length;
 await f.node('workbenchBack').onclick();assert.equal(f.c.location.hash,'#/go/inventory/catalog');assert.equal(f.row('two'),row);assert.equal(f.node('catalogSearch'),search);assert.equal(f.content.querySelector('.workspace-page-header'),header);assert.equal(f.document.activeElement,search);assert.equal(f.calls.length,reads);assert.equal(f.writes(),1);assert.deepEqual(JSON.parse(JSON.stringify(f.scrolls)),[{left:3,top:123,behavior:'instant'}]);
});
