import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=['recycle-bin.js','admin-records.js'].map(file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')).join('\n');
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds=['organization','contact','product','proforma'],tables=['organizations','contacts','products','sales_proformas'];
function fixture({role='owner',records=true,size=1067,rendered=false}={}){
 const document=dom(),target=rendered?document.createElement('main'):{innerHTML:'',isConnected:true,querySelector:()=>null,querySelectorAll:()=>[],append(){}};if(rendered)document.body.append(target);
 const calls=[],writes=[],messages=[],clears=[],listeners=[],data={};document.addEventListener=(event,fn)=>listeners.push(fn);let pending,hook=null,rpcHook=null;
 for(const [j,table] of tables.entries())data[table]=Array.from({length:size},(_,i)=>({id:`${kinds[j]}-${String(i).padStart(5,'0')}`,name:`<${kinds[j]}> ${i}`,first_name:'Contact <name>',last_name:String(i),document_number:`PF-<${i}>`,version:4,deleted_at:new Date(Date.UTC(2026,9,29)-Math.floor(i/3)*1000).toISOString(),parent_id:table==='organizations'?(i===0?'organization-'+String(size-1).padStart(5,'0'):i===1?'active-parent':i===2?'hidden-parent':null):null,organization_id:table==='contacts'?(i===0?'organization-'+String(size-1).padStart(5,'0'):i===2?'hidden-parent':'active-parent'):null}));
 const current=()=>ctx.me?.active!==false,parents=()=>new Map([...data.organizations,{id:'active-parent',name:'Active <parent>',deleted_at:null}].map(row=>[row.id,row]));
 const ctx=vm.createContext({workspacePageHeader,me:{user_id:'actor',role,active:true},view:'recycle',busy:false,records,esc,$:()=>target,
  canEditRecords:()=>current()&&ctx.records,recordsLockedText:'Records access is required.',document,window:{scrollX:7,scrollY:420,scrollTo:position=>{assert.equal(position.left,7);assert.equal(position.top,420);}},run:fn=>(pending=fn()),message:(...args)=>messages.push(args),
  listsEpoch:7,listsLoaded:true,listsLoading:{pending:true},organizations:[{id:'complete-org-cache'}],contacts:[{id:'complete-contact-cache'}],products:[{id:'complete-product-cache'}],orgIndex:{get(){throw Error('Full directory must stay lazy')}},
  load:async()=>{throw Error('Auth/shared reload must stay lazy')},listCacheClear:async()=>{throw Error('Persistent delta cache must be retained')},clearSalesDelivery:()=>clears.push('sales'),
  client:{from(table){const call={table,orders:[]};return {select(columns,options){call.columns=columns;call.options=options;return this},not(...args){call.filter=args;return this},order(column,options){call.orders.push([column,options]);return this},async range(from,to){call.from=from;call.to=to;calls.push(call);const rows=data[table].filter(row=>row.deleted_at).sort((a,b)=>b.deleted_at.localeCompare(a.deleted_at)||a.id.localeCompare(b.id)),joined=rows.slice(from,to+1).map(row=>{row=clone(row);const parent=parents().get(table==='organizations'?row.parent_id:row.organization_id);if(table==='organizations')row.parent=parent?{id:parent.id,name:parent.name,deleted_at:parent.deleted_at}:null;if(table==='contacts')row.organization=parent?{id:parent.id,name:parent.name,deleted_at:parent.deleted_at}:null;return row});const result={data:joined,count:rows.length};return hook?hook(call,result):result;}}},async rpc(name,args){writes.push({name,args});if(rpcHook)return rpcHook(name,args);const kind=name==='restore_record'?args.p_kind:name==='set_product_archived'?'product':'proforma',row=data[tables[kinds.indexOf(kind)]].find(row=>row.id===args.p_id);if(row){row.deleted_at=null;row.version++;}return {data:clone(row)}}}
 });vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);vm.runInContext(source,ctx);const get=code=>vm.runInContext(code,ctx);
 return {ctx,get,target,document,data,calls,writes,messages,clears,setHook:fn=>hook=fn,setRpcHook:fn=>rpcHook=fn,async click(dataset){const button={dataset,hasAttribute:name=>name==='data-recycle-refresh'&&dataset.refresh===true};for(const fn of listeners)fn({target:{closest:()=>button}});return pending;}};
}
test('owner landing reads four bounded exact-count pages, preserves complete caches and escapes records',async()=>{
 const f=fixture(),complete=[f.ctx.organizations,f.ctx.contacts,f.ctx.products];await f.ctx.renderRecycleBin();assert.equal(f.calls.length,4);assert.equal((f.target.innerHTML.match(/class="recycle-record"/g)||[]).length,100);assert.equal((f.target.innerHTML.match(/\(1,067\)/g)||[]).length,4);assert.match(f.target.innerHTML,/&lt;organization&gt;|&lt;product&gt;/);assert.doesNotMatch(f.target.innerHTML,/<organization>|<product>|<name>/);
 for(const c of f.calls){assert.deepEqual(clone(c.options),{count:'exact'});assert.deepEqual(clone(c.filter),['deleted_at','is',null]);assert.deepEqual(clone(c.orders),[['deleted_at',{ascending:false}],['id',{ascending:true}]]);assert.equal(c.from,0);assert.equal(c.to,24);}
 assert.match(f.calls[0].columns,/parent:organizations!parent_id\(id,name,deleted_at\)/);assert.match(f.calls[1].columns,/organization:organizations!organization_id\(id,name,deleted_at\)/);assert.deepEqual([f.ctx.organizations,f.ctx.contacts,f.ctx.products],complete);assert.equal(f.ctx.listsLoaded,true);
});
test('independent category pagination reads only that category and keeps other pages intact',async()=>{
 const f=fixture();await f.ctx.renderRecycleBin();const contact=f.get('recyclePages.contact');await f.click({recyclePage:'organization',direction:'1'});assert.equal(f.calls.length,5);assert.equal(f.calls.at(-1).from,25);assert.equal(f.calls.at(-1).to,49);assert.equal(f.get('recyclePages.organization.page'),1);assert.equal(f.get('recyclePages.contact'),contact);await f.ctx.changeRecyclePage('organization',-1);assert.equal(f.get('recyclePages.organization.page'),0);await f.ctx.changeRecyclePage('organization',-1);await f.ctx.changeRecyclePage('organization',0);await f.ctx.changeRecyclePage('unrecognized',1);assert.equal(f.calls.length,6);
});
test('all four categories traverse more than 1000 records exactly once in newest-first deterministic order',async()=>{
 const f=fixture();await f.ctx.renderRecycleBin();
 for(const [index,kind] of kinds.entries()){const seen=[];do{const page=clone(f.get(`recyclePages.${kind}`));assert.ok(page.rows.length<=25);assert.equal(page.total,1067);seen.push(...page.rows.map(row=>row.id));if(page.page+1>=page.pages)break;await f.ctx.changeRecyclePage(kind,1);}while(true);const expected=f.data[tables[index]].slice().sort((a,b)=>b.deleted_at.localeCompare(a.deleted_at)||a.id.localeCompare(b.id)).map(row=>row.id);assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,1067);assert.equal(f.get(`recyclePages.${kind}.rows.length`),17);}
 assert.equal(f.calls.length,172);
});
test('joined deleted or RLS-hidden off-page parents block restore while a joined active parent permits it',async()=>{
 const f=fixture();await f.ctx.renderRecycleBin();assert.match(f.target.innerHTML,/Restore the parent profile first/);assert.match(f.target.innerHTML,/parent profile could not be verified/);assert.match(f.target.innerHTML,/Active &lt;parent&gt;/);
 for(const kind of ['organization','contact']){await assert.rejects(f.ctx.restoreDeletedRecord(kind,kind+'-00000'),/parent profile first/);await assert.rejects(f.ctx.restoreDeletedRecord(kind,kind+'-00002'),/could not be verified/);}
 assert.equal(f.writes.length,0);await f.ctx.restoreDeletedRecord('contact','contact-00001');assert.deepEqual(clone(f.writes[0]),{name:'restore_record',args:{p_kind:'contact',p_id:'contact-00001'}});assert.equal(f.get('recyclePages.contact.total'),1066);assert.equal(f.ctx.listsLoaded,false);assert.equal(f.ctx.listsLoading,null);assert.equal(f.ctx.listsEpoch,8);assert.equal(f.calls.length,8);assert.equal(f.clears.length,0);
});
test('records holders get products but no draft reads and readonly users cannot restore',async()=>{
 const f=fixture({role:'staff'});await f.ctx.renderRecycleBin();assert.deepEqual(f.calls.map(c=>c.table).sort(),['contacts','organizations','products']);assert.doesNotMatch(f.target.innerHTML,/Draft pro formas/);await assert.rejects(f.ctx.restoreDeletedBusinessRecord('proforma','proforma-00003',4),/Owner/);f.ctx.records=false;await assert.rejects(f.ctx.restoreDeletedRecord('contact','contact-00001'),/Records access/);await assert.rejects(f.ctx.restoreDeletedBusinessRecord('product','product-00003',0),/Records access/);await f.ctx.renderRecycleBin();assert.equal(f.calls.length,5);assert.doesNotMatch(f.target.innerHTML,/data-restore-record=|data-restore-business=/);assert.equal(f.writes.length,0);
});
test('product and draft restores preserve RPC arguments, validate cached draft version and invalidate lazily',async()=>{
 const f=fixture();await f.ctx.renderRecycleBin();await assert.rejects(f.ctx.restoreDeletedBusinessRecord('proforma','proforma-00003',3),/Refresh/);await assert.rejects(f.ctx.restoreDeletedBusinessRecord('proforma','proforma-99999',4),/Refresh/);await f.click({restoreBusiness:'proforma',id:'proforma-00003',version:'4'});await f.ctx.restoreDeletedBusinessRecord('product','product-00003',0);assert.deepEqual(clone(f.writes),[{name:'set_draft_proforma_archived',args:{p_id:'proforma-00003',p_archived:false,p_expected_version:4}},{name:'set_product_archived',args:{p_id:'product-00003',p_archived:false}}]);assert.deepEqual(f.clears,['sales']);assert.equal(f.ctx.listsEpoch,9);assert.equal(f.calls.length,12);assert.equal(f.get('recyclePages.proforma.total'),1066);assert.equal(f.get('recyclePages.product.total'),1066);assert.equal(f.ctx.products[0].id,'complete-product-cache');
});
test('restoring the last row of a final page clamps with one extra bounded read',async()=>{
 const f=fixture({size:26});await f.ctx.renderRecycleBin();await f.ctx.changeRecyclePage('product',1);await f.ctx.restoreDeletedBusinessRecord('product','product-00025',0);assert.equal(f.get('recyclePages.product.page'),0);assert.equal(f.get('recyclePages.product.total'),25);assert.equal(f.get('recyclePages.product.rows.length'),25);assert.equal(f.calls.length,10);assert.deepEqual(f.calls.filter(c=>c.table==='products').map(c=>c.from),[0,25,25,0]);
});
test('any failed or malformed page closes all cached restore authority',async()=>{
 for(const bad of [{error:{message:'Forbidden'}},{data:[],count:null},{data:[],count:1067}]){const f=fixture();await f.ctx.renderRecycleBin();f.setHook((c,result)=>c.table==='sales_proformas'?bad:result);await assert.rejects(f.ctx.renderRecycleBin());assert.equal(f.get('recycleReady'),false);assert.equal(f.get('Object.keys(recyclePages).length'),0);assert.match(f.target.innerHTML,/could not be loaded/);assert.doesNotMatch(f.target.innerHTML,/data-restore-record=|data-restore-business=/);await assert.rejects(f.ctx.restoreDeletedRecord('contact','contact-00001'),/Refresh/);assert.equal(f.writes.length,0);}
});
test('failed writes preserve rows and complete-cache readiness; confirmed writes with failed refresh report success honestly',async()=>{
 const f=fixture();await f.ctx.renderRecycleBin();f.setRpcHook(()=>({error:{message:'Version changed'}}));await assert.rejects(f.ctx.restoreDeletedBusinessRecord('product','product-00003',0));assert.equal(f.ctx.listsLoaded,true);assert.equal(f.ctx.listsEpoch,7);assert.equal(f.get('recyclePages.product.total'),1067);f.setRpcHook(null);f.setHook(()=>({error:{message:'Offline'}}));await f.ctx.restoreDeletedBusinessRecord('product','product-00003',0);assert.equal(f.ctx.listsLoaded,false);assert.equal(f.get('recycleReady'),false);assert.match(f.messages.at(-1)[0],/Record restored.*could not reload/);
});
test('actor object replacement invalidates old restore buttons even with the same user id',async()=>{
 const f=fixture();await f.ctx.renderRecycleBin();await f.ctx.changeRecyclePage('product',1);f.ctx.me={...f.ctx.me};await assert.rejects(f.ctx.restoreDeletedBusinessRecord('product','product-00025',0),/Refresh/);await assert.rejects(f.ctx.restoreDeletedRecord('contact','contact-00001'),/Refresh/);await f.ctx.renderRecycleBin();assert.equal(f.get('recyclePages.product.page'),0);assert.equal(f.get('recycleActor'),f.ctx.me);assert.equal(f.writes.length,0);
});
test('late read success and failure cannot repaint another route, actor or newer request',async()=>{
 for(const mode of ['actor','route','clear','newer'])for(const failed of [false,true]){const f=fixture();let release;f.setHook((c,result)=>c.table==='organizations'?new Promise(resolve=>release=()=>resolve(failed?{error:{message:'Old request'}}:result)):result);const old=f.ctx.renderRecycleBin();if(mode==='actor')f.ctx.me={...f.ctx.me};if(mode==='route')f.ctx.view='prices';if(mode==='clear')f.ctx.clearRecycleBin();if(mode==='newer'){f.setHook(null);await f.ctx.renderRecycleBin();}else f.target.innerHTML='Current screen';const expected=f.target.innerHTML;release();await old;assert.equal(f.target.innerHTML,expected);if(mode!=='newer')assert.equal(f.get('recycleReady'),false);}
});
test('late restore responses cannot mutate replacement actor caches or repaint navigation',async()=>{
 for(const kind of ['contact','product','proforma'])for(const change of ['actor','route']){const f=fixture();await f.ctx.renderRecycleBin();let release;f.setRpcHook(()=>new Promise(resolve=>release=resolve));const pending=kind==='contact'?f.ctx.restoreDeletedRecord(kind,'contact-00001'):f.ctx.restoreDeletedBusinessRecord(kind,kind+'-00003',4);if(change==='actor')f.ctx.me={...f.ctx.me};else f.ctx.view='prices';f.target.innerHTML='Current screen';release({data:{}});await pending;assert.equal(f.target.innerHTML,'Current screen');assert.equal(f.messages.length,0);assert.equal(f.calls.length,4);assert.equal(f.ctx.listsEpoch,change==='actor'?7:8);assert.equal(f.clears.length,change==='route'&&kind==='proforma'?1:0);}
});

test('a real out-of-range error after restoration recovers through a bounded page without relying on its missing count',async()=>{
 const f=fixture({size:26});await f.ctx.renderRecycleBin();await f.ctx.changeRecyclePage('product',1);f.setHook((call,result)=>call.from>=result.count&&call.from>0?{data:null,count:null,status:416,error:{code:'PGRST103',message:'Requested range not satisfiable'}}:result);await f.ctx.restoreDeletedBusinessRecord('product','product-00025',0);assert.equal(f.get('recyclePages.product.page'),0);assert.equal(f.get('recyclePages.product.total'),25);assert.equal(f.get('recycleReady'),true);assert.equal(f.calls.length,10);
});


test('confirmed restores preserve the shell, unchanged records, focused controls and scroll',async()=>{
 const f=fixture({size:32,rendered:true});await f.ctx.renderRecycleBin();
 for(const s of f.target.querySelectorAll('[data-recycle-section]')){assert.ok(s.querySelector('h2 small'),'count');assert.ok(s.querySelector('.form-actions [role="status"]'),'pager');}
 const heading=f.target.querySelector('.heading'),section=f.target.querySelector('[data-recycle-section="product"]'),otherSection=f.target.querySelector('[data-recycle-section="organization"]');
 const stable=f.target.querySelector('[data-recycle-record="product-00004"]'),focused=stable.querySelector('button');focused.focus();
 await f.ctx.restoreDeletedBusinessRecord('product','product-00003',0);
 assert.equal(f.target.querySelector('.heading'),heading);assert.equal(f.target.querySelector('[data-recycle-section="product"]'),section);assert.equal(f.target.querySelector('[data-recycle-section="organization"]'),otherSection);
 assert.equal(f.target.querySelector('[data-recycle-record="product-00004"]'),stable);assert.equal(f.document.activeElement,focused);
 assert.equal(f.get('recycleReady'),true,f.target.querySelector('[role="alert"]')?.textContent);assert.equal(f.target.querySelector('[data-recycle-record="product-00003"]'),null);assert.ok(f.target.querySelector('[data-recycle-record="product-00025"]'));assert.equal(focused.disabled,false);assert.equal(f.writes.length,1);
 assert.match(section.querySelector('h2 small').textContent,/31/);assert.match(section.querySelector('.form-actions [role="status"]').textContent,/25 shown/);
});
test('failed reread retains rows with disabled mutations and retry only reads',async()=>{
 const f=fixture({size:32,rendered:true});await f.ctx.renderRecycleBin();const stable=f.target.querySelector('[data-recycle-record="product-00004"]');
 f.setHook(()=>({error:{message:'Offline'}}));await f.ctx.restoreDeletedBusinessRecord('product','product-00003',0);
 assert.equal(f.target.querySelector('[data-recycle-record="product-00004"]'),stable);assert.equal(stable.querySelector('button').disabled,true);assert.equal(f.get('recycleReady'),false);
 assert.match(f.target.querySelector('[role="alert"]').textContent,/Record restored.*could not reload/);assert.equal(f.target.querySelector('[data-recycle-section="product"] h2 small').textContent,'Refresh needed');
 const retry=f.target.querySelector('[role="alert"] button');f.setHook(null);await retry.onclick();
 assert.equal(f.writes.length,1);assert.equal(f.get('recycleReady'),true);assert.equal(f.target.querySelector('[data-recycle-record="product-00004"]'),stable);assert.equal(stable.querySelector('button').disabled,false);assert.equal(f.target.querySelector('[role="alert"]'),null);
});
