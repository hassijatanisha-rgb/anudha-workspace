import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const line=prefix=>{const found=app.split('\n').find(text=>text.startsWith(prefix));assert.ok(found,`Missing actual ${prefix}`);return found;};
const profileSource=readFileSync(new URL('../client-profile-pages.js',import.meta.url),'utf8');
const clientRoute=profileSource.match(/function readProfileRoute\(\)\{[\s\S]*?\n}/)[0]+'\n'+profileSource.split('\n').find(text=>text.startsWith('function clientDirectoryLanding('));
const routing=[clientRoute,line('function workspaceLoadFailure('),line('function workspaceUsesSharedLists('),line('async function load(){'),line('function render(){')].join('\n');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(view,inventorySection='stock'){
 const nodes=new Map(),requests=[],renders=[],events=[];
 const node=()=>{let html='';return {hidden:false,firstElementChild:null,get innerHTML(){return html;},set innerHTML(value){html=value;this.firstElementChild=value?{matches:selector=>selector==='.workspace-skeleton'&&value.startsWith('<section class="workspace-skeleton ')}:null;},querySelector:()=>null,addEventListener(){}};};
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
 const actor={user_id:'employee',role:'owner',active:true,department:'management'};
 const ctx=vm.createContext({workspacePageHeader,view,inventorySection,booksSection:inventorySection,booksDraft:null,reportTab:inventorySection,me:null,sessionLoadEpoch:0,listsLoaded:false,listsLoading:null,selected:'',personalSection:'task',salesSection:'proformas',salesFocusedProforma:'',salesFocusedDelivery:'',salesEditing:'',purchaseSection:'orders',purchaseEditing:'',supplierEditing:'',leadSection:'inquiries',leadEditing:'',location:{hash:'#/client/first-account'},
  bindWorkspaceAccountMenu(){},$,document:{querySelectorAll:()=>[]},esc:String,message(){},employeeName:()=> 'Employee',friendlyError:error=>error.message,
  client:{auth:{getUser:async()=>{requests.push('auth.getUser');return {data:{user:{id:actor.user_id}}};}}},
  loadMyStaffRow:async()=>{requests.push('staff.self');return {data:actor};},
  loadEmployeeNames:async()=>{requests.push('employee_directory');},showAccountingNavigation:()=>{requests.push('accounting_access');},syncWorkspaceNavigation(){},firstAccount:()=> 'first-account',
  login(){throw Error('Unexpected login');},
  loadLists:async()=>{requests.push('shared-client-lists');events.push('lists');ctx.listsLoaded=true;return true;}
 });
 for(const name of ['dashboardWorkspace','staff','inventoryWorkspace','profileView','clientDirectoryWorkspace','salesDeliveryWorkspace','personalWorkspace','packingWorkspace','serviceWorkspace','pendingStockWorkspace','settingsWorkspace','customerRequestsWorkspace','accountingWorkspace','pricesWorkspace','contractsWorkspace','projectApprovals','guide','checklist','renderRecycleBin','stockCountWorkspace','purchasingWorkspace','leadsWorkspace','booksWorkspace','reportsWorkspace','travelWorkspace'])ctx[name]=()=>{renders.push(name);events.push(name);$('#content').innerHTML='<article>Loaded workspace</article>';};
 vm.runInContext(readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('async function workspaceRefreshRun')[0],ctx);
 vm.runInContext(routing,ctx);
 return {ctx,nodes,requests,renders,events,actor,$};
}

for(const [view,section,renderer] of [['dashboard','stock','dashboardWorkspace'],['staff','stock','staff'],['inventory','stock','inventoryWorkspace'],['inventory','catalog','inventoryWorkspace'],['inventory','locations','inventoryWorkspace'],['inventory','transfers','inventoryWorkspace'],['inventory','review','inventoryWorkspace'],['prices','prices','pricesWorkspace'],['contracts','all','contractsWorkspace'],['travel','upcoming','travelWorkspace'],['approvals','all','projectApprovals'],['guide','all','guide'],['checklist','all','checklist'],['recycle','all','renderRecycleBin'],['personal','task','personalWorkspace'],['packing','queue','packingWorkspace'],['pending','waiting','pendingStockWorkspace'],['settings','account','settingsWorkspace'],['accounting','drafts','accountingWorkspace'],['stockcount','count','stockCountWorkspace'],['requests','inquiries','customerRequestsWorkspace'],['requests','complaints','customerRequestsWorkspace'],['service','installations','serviceWorkspace'],['service','schedule','serviceWorkspace'],['service','forms','serviceWorkspace'],...['overview','accounts','reports','import','opening','invoices'].map(section=>['books',section,'booksWorkspace']),...['work','activity','tasks','proformas','leads','purchasing','service','travel','deliveries','movements'].map(section=>['reports',section,'reportsWorkspace'])]){
 test(`${view}:${section}: actual sign-in and router skip shared client lists and start no background list load`,async()=>{
  const f=fixture(view,section);await f.ctx.load();await flush();await flush();
  assert.deepEqual(f.renders,[renderer]);assert.equal(f.requests.includes('shared-client-lists'),false);
  assert.equal(f.ctx.listsLoaded,false);assert.equal(f.ctx.listsLoading,null);
  await f.ctx.render();await flush();assert.equal(f.requests.includes('shared-client-lists'),false,'a repeated render must remain independent of the shared list cache');
 });
}

for(const [view,section,renderer] of [['contacts','stock','profileView'],['sales','stock','salesDeliveryWorkspace'],...['receipts','journal'].map(section=>['books',section,'booksWorkspace'])]){
 test(`${view}:${section}: existing dependent routes load shared lists before rendering`,async()=>{
  const f=fixture(view,section);await f.ctx.load();await flush();
  assert.deepEqual(f.events,['lists',renderer]);assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
  assert.equal(f.ctx.selected,'first-account');await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
 });
}

test('moving from a self-contained screen to an explicit CRM profile loads lists once on demand',async()=>{
 const f=fixture('dashboard');await f.ctx.load();assert.equal(f.requests.includes('shared-client-lists'),false);
 f.ctx.view='contacts';await f.ctx.render();assert.deepEqual(f.events,['dashboardWorkspace','lists','profileView']);
 f.ctx.view='staff';await f.ctx.render();f.ctx.view='contacts';await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
});

test('a dependent route waits for its list request rather than rendering partial CRM data',async()=>{
 const f=fixture('contacts');f.ctx.me=f.actor;let release;
 f.ctx.loadLists=()=>{f.requests.push('shared-client-lists');f.ctx.listsLoading=new Promise(resolve=>{release=()=>{f.ctx.listsLoaded=true;resolve(true);};});return f.ctx.listsLoading;};
 const first=f.ctx.render(),second=f.ctx.render();assert.deepEqual(f.renders,[]);assert.equal(f.requests.length,1);
 release();await Promise.all([first,second]);assert.deepEqual(f.renders,['profileView'],'the first completed render replaces the pending root, so the duplicate callback cannot redraw it');
});

test('owner Staff routing has eight modeled requests before optional sign-in and notification checks',async()=>{
 const f=fixture('staff'),data=[f.actor];
 // Each injected server-backed helper records exactly one request. This is a
 // Staff-only routing count, excluding optional sign-in checks and the shared
 // notification bell. It does not certify the full live request budget.
 f.ctx.client.from=table=>({select:async()=>{f.requests.push(table+'.list');return {data};}});
 f.ctx.refreshEmployeeNamesFor=async()=>{f.requests.push('employee_directory.refresh');};
 f.ctx.decorateStaffTwoStep=async()=>{f.requests.push('staff_two_step_status');};
 f.ctx.decorateStaffAccounting=async()=>{f.requests.push('staff_accounting_access');};
 f.ctx.renderWorkStepOwners=async()=>{};
 f.ctx.staffListHtml=()=>'<p>Employee</p>';f.ctx.bindStaffList=()=>{};f.ctx.field=()=>'';
 for(const name of ['openEmployeeNameEditor','openStaffOnboarding','openStaffListImport'])f.ctx[name]=()=>{};
 f.$('#staffList').closest=()=>f.$('#staffSection');
 vm.runInContext(line('async function staff(){'),f.ctx);
 await f.ctx.load();await flush();
 assert.deepEqual(f.requests,['auth.getUser','staff.self','employee_directory','accounting_access','staff.list','employee_directory.refresh','staff_two_step_status','staff_accounting_access']);
 assert.equal(f.requests.includes('shared-client-lists'),false);
});

function allFixture(length,reportedCount=length){
 const rows=Array.from({length},(_,index)=>({id:String(index).padStart(6,'0')})),calls=[];
 const ctx=vm.createContext({workspacePageHeader,client:{from:table=>{
  const request={table,filters:[]};
  const query={select(columns,options){request.columns=columns;request.options=options;return query;},eq(column,value){request.filters.push([column,value]);return query;},order(column){request.order=column;return query;},async range(from,to){calls.push({...request,from,to});return {data:rows.slice(from,to+1),count:request.options?.count==='exact'?reportedCount:null};}};
  return query;
 }}});
 vm.runInContext(line('async function all('),ctx);return {ctx,rows,calls};
}

for(const length of [0,12,999])test(`actual all(): ${length} rows need exactly one request`,async()=>{
 const f=allFixture(length),result=await f.ctx.all('fixture_records','id');
 assert.equal(result.length,length);assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{table:'fixture_records',filters:[],columns:'id',options:{count:'exact'},order:'id',from:0,to:999});
});

test('actual all(): 2,500 rows are complete in three ordered requests with the filter on every page',async()=>{
 const f=allFixture(2500),result=await f.ctx.all('fixture_records','id',query=>query.eq('status','open'));
 assert.deepEqual([...result.map(row=>row.id)],f.rows.map(row=>row.id));assert.deepEqual(f.calls.map(call=>[call.from,call.to]),[[0,999],[1000,1999],[2000,2999]]);
 for(const call of f.calls){assert.equal(call.order,'id');assert.deepEqual(call.filters,[['status','open']]);}
 assert.equal(f.calls.filter(call=>call.options?.count==='exact').length,1);
});

test('actual all(): an exact 1,000-row boundary uses a second sentinel request',async()=>{
 const f=allFixture(1000),result=await f.ctx.all('fixture_records','id');
 assert.equal(result.length,1000);assert.deepEqual(f.calls.map(call=>call.from),[0,1000]);
});

test('actual all(): a stale underestimated count never truncates rows still present on later pages',async()=>{
 const f=allFixture(4500,1000),result=await f.ctx.all('fixture_records','id');
 assert.deepEqual([...result.map(row=>row.id)],f.rows.map(row=>row.id));assert.equal(new Set(result.map(row=>row.id)).size,4500);
 assert.ok(f.calls.some(call=>call.from===4000));
});


test('ordinary staff Dashboard landing redirects to My tasks without shared client-list downloads',async()=>{
 const f=fixture('dashboard');f.actor.role='staff';await f.ctx.load();await flush();
 assert.equal(f.ctx.view,'personal');assert.equal(f.ctx.personalSection,'task');assert.deepEqual(f.renders,['personalWorkspace']);
 assert.equal(f.requests.includes('shared-client-lists'),false);assert.equal(f.ctx.listsLoaded,false);
});


test('Sales Pro forma landing skips shared lists, while opening a record hydrates them',async()=>{
 const f=fixture('sales');f.ctx.salesProformaLanding=()=>!f.ctx.salesFocusedProforma;
 await f.ctx.load();assert.equal(f.requests.includes('shared-client-lists'),false);
 f.ctx.salesFocusedProforma='order';await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
});

test('Books invoice register defers shared lists until a waiting order is opened',async()=>{
 const f=fixture('books','invoices');await f.ctx.load();
 assert.equal(f.requests.includes('shared-client-lists'),false);
 f.ctx.booksDraft={proformaId:'waiting-order'};await f.ctx.render();
 assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
 assert.deepEqual(f.renders,['booksWorkspace','booksWorkspace']);
});

test('Delivery register skips shared lists until an individual delivery is selected',async()=>{
 const f=fixture('sales');f.ctx.salesDeliveryLanding=()=>!f.ctx.salesFocusedDelivery;
 await f.ctx.load();assert.equal(f.requests.includes('shared-client-lists'),false);
 f.ctx.salesFocusedDelivery='delivery';await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
});

for(const [view,helper,renderer] of [['purchasing','purchasingLanding','purchasingWorkspace'],['leads','leadLanding','leadsWorkspace']])test(`${view} summary landing defers shared lists until explicit detail/editor opening`,async()=>{
 const f=fixture(view);let landing=true;f.ctx[helper]=()=>landing;await f.ctx.load();
 assert.equal(f.requests.includes('shared-client-lists'),false);assert.deepEqual(f.renders,[renderer]);
 landing=false;await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
 landing=true;await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
});

for(const section of ['receipts','journal'])test(`Books ${section}: actual landing helper defers shared lists until a record or New is opened`,async()=>{
 const f=fixture('books',section),source=readFileSync(new URL('../accounting-ledger.js',import.meta.url),'utf8');
 f.ctx.booksTransactionSelected='';vm.runInContext(source.split('\n').find(text=>text.startsWith('function booksTransactionLanding(')),f.ctx);
 await f.ctx.load();assert.equal(f.requests.includes('shared-client-lists'),false);
 f.ctx.booksTransactionSelected='new';await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
 f.ctx.booksTransactionSelected='';f.ctx.listsLoaded=false;await f.ctx.render();assert.equal(f.requests.filter(name=>name==='shared-client-lists').length,1);
});
