import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {statusTone} from './helpers/status-ui.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// DOM identity adapter executes actual Staff render and save handlers; native focus/layout remain browser checks.
function dom(){
 const decode=s=>String(s).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&');let document;
 const dataName=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 class Node{
  constructor(tag='',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.events={};this.classList={toggle:(key,on)=>{const names=new Set((this.attrs.class||'').split(' ').filter(Boolean));if(on)names.add(key);else names.delete(key);this.attrs.class=[...names].join(' ');}};this._text='';this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.value=attrs.value||'';this.selectionStart=this.selectionEnd=0;this.scrollLeft=0;this.open='open'in attrs;this.dataset=new Proxy({},{get:(_,key)=>this.attrs[dataName(key)],set:(_,key,value)=>(this.attrs[dataName(key)]=value,true),ownKeys:()=>Object.keys(this.attrs).filter(key=>key.startsWith('data-')).map(key=>key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});}
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
const person=(id='one',patch={})=>({user_id:id,role:'staff',active:true,phone:'+255700000001',department:'sales',access:['proformas','records'],...patch});
function fixture(){
 const document=dom(),content=document.createElement('main');content.attrs.id='content';document.body.append(content);let contentWrites=0;const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:value=>{contentWrites++;descriptor.set.call(content,value);}});
 const calls=[],forms=[],messages=[],decorations=[],scrolls=[],rows=[person(),person('two'),person('three'),person('four'),person('five'),person('six'),person('seven'),person('other',{department:'service'})];
 const c=vm.createContext({workspacePageHeader,statusTone,document,view:'staff',busy:false,me:{user_id:'owner',role:'owner',department:'sales'},window:{scrollX:4,scrollY:250,scrollTo:value=>scrolls.push(value)},employeeName:id=>'Employee '+id,esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),message:(...args)=>messages.push(args),askConfirm:async()=>true,staff:()=>assert.fail('No whole Staff reload'),loadEmployeeNames:()=>assert.fail('No directory reload'),run:fn=>c.running=fn(),
  actionEditorForm:{},actionForm:(title,fields,submit)=>{const dialog=document.createElement('dialog');dialog.innerHTML='<form>'+fields+'</form>';document.body.append(dialog);dialog.showModal();forms.push({dialog,submit});},
  decorateStaffTwoStep:async()=>decorations.push('two-step'),decorateStaffAccounting:async()=>decorations.push('accounting')
 });
 for(const file of ['staff-access.js','employee-login.js'])vm.runInContext(read(file),c);
 c.decorateStaffAccounting=async()=>decorations.push('accounting');c.checkedAreas=()=>['proformas'];
 content.innerHTML=c.staffListHtml(rows);c.bindStaffList(rows);const directory=document.querySelector('[data-staff-directory]'),results=directory.querySelector('[data-staff-results]');
 // The adapter does not implement the browser's initial select value inference.
 directory.querySelector('[data-staff-filter]').value='active';directory.staffState.filter='active';
 const byId=id=>directory.querySelectorAll('[data-staff-row]').find(row=>row.dataset.staffRow===id),node=selector=>directory.querySelector(selector);
 c.saved=person('one',{phone:'+255711111111'});c.readRow=c.saved;
 c.client={rpc:async(name,args)=>{calls.push({name,args});return {data:c.saved};},from:table=>({select(columns){calls.push({table,columns});return this;},eq(key,id){calls.at(-1).eq=[key,id];return this;},single:async()=>({data:c.readRow})})};
 function open(kind){
  const row=byId('one');row.querySelector('details').open=true;
  if(kind==='phone'){row.querySelector('[data-staff-phone]').onclick();return async()=>{await forms.at(-1).submit({phone:'+255711111111'});forms.at(-1).dialog.close();};}
  if(kind==='access'){row.querySelector('[data-staff-access]').onclick();return async()=>{await forms.at(-1).submit();forms.at(-1).dialog.close();};}
  if(kind==='active')return ()=>row.querySelector('[data-staff-active]').onclick();
  const control=row.querySelector(kind==='role'?'[data-staff-role]':'[data-staff-department]');control.value=kind==='role'?'head':'service';control.focus();return ()=>control.onchange();
 }
 return {c,document,content,directory,results,calls,forms,messages,decorations,scrolls,rows,byId,node,open,writes:()=>contentWrites};
}
const savedFor=kind=>person('one',kind==='phone'?{phone:'+255711111111'}:kind==='role'?{role:'head'}:kind==='active'?{active:false}:kind==='department'?{department:'service'}:{access:['proformas']});
test('phone, access, active, role and department saves patch confirmed rows then read only that staff ID',async()=>{
 for(const kind of ['phone','access','active','role','department']){
  const f=fixture(),other=f.byId('four'),search=f.node('[data-staff-search]'),filter=f.node('[data-staff-filter]'),group=f.node('[data-staff-group="sales"]'),summary=group.querySelector('summary'),pager=f.node('[data-staff-page="next"]');other.querySelector('details').open=true;
  f.c.saved=f.c.readRow=savedFor(kind);await f.open(kind)();
  assert.equal(f.writes(),1);assert.equal(f.byId('four'),other);assert.equal(other.querySelector('details').open,true);assert.equal(f.node('[data-staff-search]'),search);assert.equal(f.node('[data-staff-filter]'),filter);assert.equal(f.node('[data-staff-group="sales"]'),group);assert.equal(group.querySelector('summary'),summary);assert.equal(f.node('[data-staff-page="next"]'),pager);
  assert.deepEqual(f.calls.map(call=>call.name||call.table),[{phone:'set_staff_phone',access:'set_staff_access',active:'set_staff_active',role:'manage_staff',department:'set_staff_department'}[kind],'staff']);assert.deepEqual(f.calls[1].eq,['user_id','one']);assert.equal(f.calls[1].columns,'user_id,role,active,phone,department,access');assert.deepEqual(JSON.parse(JSON.stringify(f.rows.find(row=>row.user_id==='one'))),f.c.saved);
  assert.match(f.node('[data-staff-save-notice]').textContent,/saved|switched|now/);assert.ok(f.scrolls.every(value=>value.left===4&&value.top===250));
  if(kind==='active'||kind==='department'){assert.equal(f.byId('one'),undefined);assert.match(group.querySelector('summary').textContent,/6/);assert.equal(f.node('[data-staff-page="next"]').disabled,true);assert.ok(f.byId('seven'));assert.deepEqual(f.decorations,['two-step','accounting']);}
  else{assert.ok(f.byId('one'));assert.equal(f.byId('one').querySelector('details').open,true);assert.deepEqual(f.decorations,[]);}
 }
});
test('confirmed saved receipt is visible before a pending read; failure shows read-only Retry and preserves focus',async()=>{
 const f=fixture(),old=f.byId('one'),other=f.byId('four'),save=f.open('phone'),wait=deferred();f.c.client.from=table=>({select(columns){f.calls.push({table,columns});return this;},eq(){return this;},single:()=>wait.promise});const saving=save();await tick();assert.equal(f.byId('one'),old);assert.match(old.textContent,/255711111111/);wait.resolve({error:{message:'Offline <now>'}});await saving;
 assert.match(f.node('[data-staff-save-notice]').textContent,/Phone saved.*could not refresh.*Offline <now>/);assert.equal(f.byId('four'),other);assert.doesNotMatch(f.content.textContent,/Nothing.*saved|Not saved/);
 f.c.client.from=table=>({select(){f.calls.push({table});return this;},eq(){return this;},single:async()=>({data:f.c.saved})});await f.node('[data-staff-retry]').onclick();assert.equal(f.calls.length,3);assert.equal(f.calls.filter(call=>call.name).length,1);assert.doesNotMatch(f.node('[data-staff-save-notice]').textContent,/could not refresh/);assert.equal(f.byId('four'),other);
});
test('row status nodes and authorized status actions retain their bound identity after a record patch',async()=>{
 const f=fixture(),row=f.byId('one'),twoStep=row.querySelector('[data-staff-two-step-status]'),accounting=row.querySelector('[data-staff-accounting-status]'),button=f.document.createElement('button');button.attrs['data-accounting']='one';let clicked=0;button.onclick=()=>{assert.equal(row.isConnected,true);clicked++;};row.querySelector('.actions').append(button);twoStep.textContent='Two-step: on';accounting.textContent='Accounting: on';await f.open('phone')();assert.equal(f.byId('one'),row);assert.equal(row.querySelector('[data-staff-two-step-status]'),twoStep);assert.equal(row.querySelector('[data-staff-accounting-status]'),accounting);assert.equal(row.querySelector('[data-accounting]'),button);button.onclick();assert.equal(clicked,1);assert.deepEqual(f.decorations,[]);
});
test('search focus and current page survive confirmed saves and server membership corrections',async()=>{
 const f=fixture(),search=f.node('[data-staff-search]'),save=f.open('phone');search.focus();search.selectionStart=1;search.selectionEnd=4;await save();assert.equal(f.document.activeElement,search);assert.equal(search.selectionStart,1);assert.equal(search.selectionEnd,4);
 f.node('[data-staff-page="next"]').onclick();assert.equal(f.directory.staffState.page,1);const wait=deferred(),context=f.c.staffSaveContext('seven');f.c.client.from=()=>({select(){return this;},eq(){return this;},single:()=>wait.promise});const refreshing=f.c.refreshSavedStaff('seven',person('seven'), 'Phone saved.',context);f.node('[data-staff-page="previous"]').onclick();wait.resolve({data:person('seven',{department:'service'})});await refreshing;assert.equal(f.directory.staffState.page,0);assert.equal(f.rows.find(row=>row.user_id==='seven').department,'service');assert.ok(f.byId('four'));
});
test('malformed confirmed receipts and unreadable records disable stale controls until a verified read succeeds',async()=>{
 for(const invalid of [null,{},[person(),person()],person('wrong'),person('one',{active:'yes'}),person('one',{access:['unknown']}),person('one',{phone:null})]){
  const f=fixture(),save=f.open('role');f.c.saved=invalid;f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({error:{message:'Unavailable'}})});await save();assert.equal(f.directory.staffUnverified.has('one'),true);assert.equal(f.byId('one').querySelector('[data-staff-role]').disabled,true);assert.match(f.node('[data-staff-save-notice]').textContent,/now Department head.*Refresh before making another change/);
  f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({data:savedFor('role')})});await f.node('[data-staff-retry]').onclick();assert.equal(f.directory.staffUnverified.has('one'),false);assert.equal(f.byId('one').querySelector('[data-staff-role]').disabled,false);
 }
});
test('write failure restores department and role controls without a staff read',async()=>{
 for(const kind of ['role','department']){const f=fixture(),save=f.open(kind);f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return {error:{message:'Permission denied'}};};await assert.rejects(save(),/Permission denied/);assert.equal(f.calls.length,1);assert.equal(f.byId('one').querySelector(kind==='role'?'[data-staff-role]':'[data-staff-department]').value,kind==='role'?'staff':'sales');assert.equal(f.byId('one').querySelector('[data-staff-department]').disabled,false);assert.equal(f.node('[data-staff-save-notice]').textContent,'');}
});
test('replacement actor, route, directory and rebind epoch suppress late write success and rejection',async()=>{
 for(const kind of ['phone','access','role','active','department'])for(const change of ['actor','route','disconnect','epoch'])for(const outcome of ['success','reject']){
  const f=fixture(),save=f.open(kind),wait=deferred();f.c.client.rpc=async(name,args)=>{f.calls.push({name,args});return wait.promise;};const saving=save();await tick();assert.equal(f.calls.length,1);if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else if(change==='disconnect')f.directory.remove();else f.directory.staffEpoch++;if(outcome==='reject')wait.reject(Error('Old write error'));else wait.resolve({data:savedFor(kind)});await saving;assert.equal(f.calls.length,1);assert.deepEqual(f.rows[0],person());assert.equal(f.messages.length,0);
 }
});
test('late scoped-read success, malformed result and rejection do not leak into another context',async()=>{
 for(const change of ['actor','route','disconnect','epoch'])for(const outcome of ['success','malformed','reject']){
  const f=fixture(),save=f.open('phone'),wait=deferred();f.c.client.from=()=>({select(){return this;},eq(){return this;},single:()=>wait.promise});const saving=save();await tick();if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else if(change==='disconnect')f.directory.remove();else f.directory.staffEpoch++;const before=f.content.innerHTML;if(outcome==='reject')wait.reject(Error('Old read'));else wait.resolve({data:outcome==='malformed'?{}:person('one',{phone:'unexpected'})});await saving;assert.equal(f.content.innerHTML,before);assert.equal(f.rows[0].phone,'+255711111111');assert.equal(f.messages.length,0);
 }
});

test('a verified unchanged reread unlocks controls after an invalid receipt and keeps Retry focus through another failure',async()=>{
 const f=fixture(),save=f.open('phone');f.c.saved=null;f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({error:{message:'Still offline'}})});await save();const retry=f.node('[data-staff-retry]');retry.focus();await retry.onclick();assert.equal(f.document.activeElement,f.node('[data-staff-retry]'));assert.equal(f.byId('one').querySelector('[data-staff-phone]').disabled,true);
 f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({data:person()})});await f.node('[data-staff-retry]').onclick();assert.equal(f.byId('one').querySelector('[data-staff-phone]').disabled,false);assert.equal(f.directory.staffUnverified.size,0);
});
test('wrong successful receipts are not shown as the requested change before the authoritative reread',async()=>{
 for(const kind of ['phone','access','role','active','department']){
  const f=fixture(),save=f.open(kind),wait=deferred();f.c.saved=person();f.c.client.from=()=>({select(){return this;},eq(){return this;},single:()=>wait.promise});const saving=save();await tick();assert.equal(f.directory.staffUnverified.has('one'),true);assert.equal(f.rows[0].role,'staff');assert.equal(f.rows[0].department,'sales');wait.resolve({data:savedFor(kind)});await saving;assert.equal(f.directory.staffUnverified.has('one'),false);assert.deepEqual(JSON.parse(JSON.stringify(f.rows[0])),savedFor(kind));
 }
});
test('a newer confirmed change supersedes an older pending read or Retry for the same employee',async()=>{
 const f=fixture(),wait=deferred();f.c.client.from=()=>({select(){return this;},eq(){return this;},single:()=>wait.promise});const first=f.c.refreshSavedStaff('one',person('one',{phone:'+255711111111'}),'First phone saved.',f.c.staffSaveContext('one'));
 const newer=person('one',{phone:'+255722222222'});f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({data:newer})});await f.c.refreshSavedStaff('one',newer,'Second phone saved.',f.c.staffSaveContext('one'));wait.resolve({data:person('one',{phone:'+255711111111'})});await first;assert.equal(f.rows[0].phone,'+255722222222');assert.match(f.node('[data-staff-save-notice]').textContent,/Second phone saved/);assert.doesNotMatch(f.node('[data-staff-save-notice]').textContent,/First phone saved/);
});
test('failed verification remains visible and read-only across search and status filter changes',async()=>{
 const f=fixture(),save=f.open('role');f.c.saved={};f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({error:{message:'Unavailable'}})});await save();const search=f.node('[data-staff-search]');search.value='Employee one';search.oninput();assert.equal(f.byId('one').querySelector('[data-staff-role]').disabled,true);assert.ok(f.node('[data-staff-retry]'));search.value='';search.oninput();assert.equal(f.byId('one').querySelector('[data-staff-active]').disabled,true);assert.match(f.node('[data-staff-save-notice]').textContent,/Refresh before making another change/);
});
test('a department move inserts and removes only its affected groups while preserving another department disclosure',async()=>{
 const f=fixture(),other=f.node('[data-staff-group="service"]'),summary=other.querySelector('summary');f.c.saved=f.c.readRow=person('one',{department:'marketing'});const select=f.byId('one').querySelector('[data-staff-department]');select.value='marketing';await select.onchange();assert.equal(f.node('[data-staff-group="service"]'),other);assert.equal(other.querySelector('summary'),summary);assert.ok(f.node('[data-staff-group="marketing"]'));assert.match(f.node('[data-staff-group="marketing"]').textContent,/Marketing · 1/);assert.equal(f.byId('one'),undefined);
});
