import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
import {installPageHeader} from './helpers/page-header.mjs';

function fixture(options={}){
 const f=mainPageFixture({tables:{work_assignments:()=>[],...options.tables}});installPageHeader(f.ctx);f.ctx.actor=f.actor;f.evaluate('me=actor');f.ctx.run=fn=>fn();
 const root=f.document.querySelector('#content'),one=selector=>root.querySelector(selector);
 return {...f,root,one,click:async selector=>{const node=one(selector);assert.ok(node,selector);if(node.onclick)await node.onclick({target:node});for(const event of node.events.click||[])await event.fn({target:node});}};
}
function check(f,title,{primary='',back=''}={}){
 const header=f.one('.workspace-page-header');assert.ok(header);assert.equal(f.root.querySelectorAll('h1').length,1);assert.equal(header.querySelector('h1').textContent,title);assert.equal(header.querySelector('script'),null);
 assert.equal(header.querySelectorAll('.primary-action').length,primary?1:0);
 if(primary)assert.equal(header.querySelector('.workspace-page-actions').children.at(-1),header.querySelector(primary));
 if(back){assert.equal(f.root.querySelectorAll(back).length,1);assert.ok(header.querySelector('.workspace-page-back').querySelector(back));}else assert.equal(header.querySelector('.workspace-page-back'),null);
 return header;
}
for(const [name,state,render,title,primary,targets]of [
 ['Leads',"view='leads';leadPageData=null",'renderLeadLanding','Leads','#newLead',['#leadSearch','#leadRefresh']],
 ['Purchasing',"view='purchasing';purchaseSection='orders'",'renderPurchasing','Purchasing','#newPurchase',['#purchaseSearch','#purchaseSaved']],
 ['Suppliers',"view='purchasing';purchaseSection='suppliers'",'renderPurchasing','Suppliers','#newSupplier',['#purchaseSearch','#purchaseSaved']],
 ['Inquiries',"view='requests';requestSection='inquiries'",'renderCustomerRequests','Inquiries','',['#requestSearch','#requestRefresh']],
 ['Complaints',"view='requests';requestSection='complaints'",'renderCustomerRequests','Complaints','',['#requestSearch','#requestRefresh']],
 ['Pending',"view='pending';pendingActor=me",'renderPendingStock','Pending stock orders','#newPending',['#pendingCards','#pendingEditor','#pendingRegisterNotice']],
 ['Travel',"view='travel';travelActor=me;travelPageData={rows:[],total:0,page:0,pages:1,counts:{}}",'renderTravel','Travel requests','#travelNew',['#travelDetail','#travelRegister']],
 ['Stock count',"view='stockcount';countActor=me;countPageReady=true;countPageData={catalogue_total:0,open_session:null,session:null,sessions:{rows:[],page:0,pages:1,total:0},entries:{rows:[],page:0,pages:1,total:0},stats:{godowns:[]}}",'renderStockCount','Stock count','',['#countSaved','#countBody','#countRefresh']]
])test(`${name} landing keeps one shared header, current action IDs and retained regions`,()=>{
 const f=fixture();f.evaluate(state);f.ctx[render]();check(f,title,{primary});for(const target of targets)assert.ok(f.one(target),target);assert.equal(f.calls.length,0);
 if(name==='Pending')assert.match(f.root.textContent,/Manual requests close after six months unless extended.*Accepted order balances remain pending until invoiced/);
 if(name==='Stock count')assert.match(f.root.textContent,/Counts do not change stock/);
 if(name==='Travel')assert.match(f.root.textContent,/The owner approves each trip/);
});
test('Lead detail uses the escaped record number and its original Back retains the register scope',async()=>{
 const f=fixture();f.ctx.record={id:'lead',lead_number:'LD <script>unsafe</script>',subject:'Follow up',stage:'new',source:'phone',created_at:'2026-10-29'};f.evaluate("view='leads';leadRows=[record];leadSelectedId='lead';leadSearch='saved search';leadFilter='mine';leadPage=3");f.ctx.renderLeads();check(f,f.ctx.record.lead_number,{primary:'#newLead',back:'#leadBack'});
 let loads=0;f.ctx.leadsWorkspace=async()=>loads++;await f.click('#leadBack');assert.equal(loads,1);assert.equal(f.evaluate('leadSelectedId'),'');assert.equal(f.evaluate('leadEditing'),'');assert.deepEqual(Array.from(f.evaluate('[leadSearch,leadFilter,leadPage]')),['saved search','mine',3]);
});
for(const section of ['orders','suppliers'])test(`${section} detail uses escaped identity and Back keeps search, filter and page`,async()=>{
 const f=fixture();f.ctx.record={id:'record',po_number:'PO <script>unsafe</script>',supplier_number:'SUP-1',name:'Supplier <script>unsafe</script>',status:'requested',currency:'TZS',created_at:'2026-10-29',active:true};f.evaluate(`view='purchasing';purchaseSection='${section}';${section==='orders'?"purchaseOrders=[record];purchaseFocusedOrder='record'":"suppliers=[record];purchaseFocusedSupplier='record'"};purchaseSearch='retained';purchaseFilter='ordered';purchasePage=2`);f.ctx.renderPurchasing();check(f,section==='orders'?f.ctx.record.po_number:f.ctx.record.name,{back:'#purchaseBack'});assert.ok(f.one('#purchaseRecord'));
 let loads=0;f.ctx.purchasingWorkspace=async()=>loads++;await f.click('#purchaseBack');assert.equal(loads,1);assert.equal(f.evaluate('purchaseFocusedOrder'),'');assert.equal(f.evaluate('purchaseFocusedSupplier'),'');assert.deepEqual(Array.from(f.evaluate('[purchaseSearch,purchaseFilter,purchasePage]')),['retained','ordered',2]);await f.settle();
});
test('request detail uses its escaped number and Back preserves the selected register scope',async()=>{
 const f=fixture();f.ctx.record={id:'request',request_number:'REQ <script>unsafe</script>',name:'Customer',phone:'0712000000',kind:'inquiry',status:'received',created_at:'2026-10-29',message:'Please call'};f.evaluate("view='requests';requestRows=[record];requestSelected='request';requestSearch='retained';requestFilter='mine';requestPage=5");f.ctx.renderCustomerRequests();check(f,f.ctx.record.request_number,{back:'#requestBack'});
 let loads=0;f.ctx.customerRequestsWorkspace=async()=>loads++;await f.click('#requestBack');assert.equal(loads,1);assert.equal(f.evaluate('requestSelected'),'');assert.deepEqual(Array.from(f.evaluate('[requestSearch,requestFilter,requestPage]')),['retained','mine',5]);
});
test('Contracts preserve bounded loading, one primary, escaped detail identity and local Back filters',async()=>{
 const record={id:'contract',contract_number:'CT <script>unsafe</script>',title:'Terms',kind:'service',status:'draft',organization_id:'clinic',customer:{name:'Clinic'},starts_on:'2026-10-29',ends_on:null};
 const f=fixture({tables:{customer_contracts:()=>[record]}});f.evaluate("view='contracts';listsLoaded=true;contractKind='service';contractCustomer='clinic';contractPage=3");await f.ctx.contractsWorkspace();check(f,'Contracts',{primary:'[data-contract-new]'});assert.equal(f.calls.length,1);
 f.evaluate("contractFocus='contract'");await f.ctx.contractsWorkspace();check(f,record.contract_number,{primary:'[data-contract-new]',back:'[data-contract-back]'});assert.equal(f.calls.length,2);
 let loads=0;f.ctx.contractsWorkspace=async()=>loads++;await f.click('[data-contract-back]');assert.equal(loads,1);assert.equal(f.evaluate('contractFocus'),'');assert.deepEqual(Array.from(f.evaluate('[contractKind,contractCustomer,contractPage]')),['service','clinic',3]);
});
test('Contracts failure and stock-count error/disabled screens retain one shared header and their recovery actions',async()=>{
 const f=fixture({tables:{customer_contracts:()=>{throw Error('Read <script>denied</script>');}}});f.evaluate("view='contracts'");await f.ctx.contractsWorkspace();check(f,'Contracts');assert.ok(f.one('.workspace-page-header').querySelector('[data-contract-retry]'));assert.equal(f.one('script'),null);
 f.evaluate("view='stockcount';countLoadError='Read denied'");f.ctx.renderStockCount();check(f,'Stock count');assert.ok(f.one('.workspace-page-header').querySelector('#countRefresh'));
 f.ctx.window.ERP_CONFIG={stockCountEnabled:false};await f.ctx.stockCountWorkspace();check(f,'Stock count is switched off');assert.equal(f.one('#countRefresh'),null);
});
test('Travel header action keeps its original actor guard after the shared-header conversion',async()=>{
 const f=fixture();f.evaluate("view='travel';travelActor=me");f.ctx.renderTravel();const header=check(f,'Travel requests',{primary:'#travelNew'});let calls=0;f.ctx.openTravelNew=async()=>calls++;f.evaluate('me={...me}');await f.click('#travelNew');assert.equal(calls,0);assert.equal(f.one('.workspace-page-header'),header);
});
