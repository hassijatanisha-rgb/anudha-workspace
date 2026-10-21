import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('Sidebar has six categories and distinguishes unavailable features from links',()=>{
 const source=readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8');
 let handler;const nav={innerHTML:'',setAttribute(){}};
 const context=vm.createContext({document:{querySelector:s=>s==='#nav'?nav:{before(){}},addEventListener:(name,fn)=>{handler=fn}},busy:false,salesSection:'delivery',salesEditing:'',salesLoaded:true,serviceLoaded:true,serviceSection:'forms',inventorySection:'stock'});
 vm.runInContext(source,context);
 assert.equal((nav.innerHTML.match(/class="nav-group /g)||[]).length,6);
 assert.match(nav.innerHTML,/data-view="books" data-workspace-section="invoices" data-accounting-only hidden>Customer invoices/);
 assert.match(nav.innerHTML,/data-view="contacts"/);
 assert.match(nav.innerHTML,/id="staffNav" hidden/);
 assert.match(nav.innerHTML,/data-view="pending">Pending stock orders/);assert.match(nav.innerHTML,/data-view="leads" data-workspace-section="leads">Leads/);
 handler({target:{closest:()=>({dataset:{view:'sales',workspaceSection:'new'}})}});
 assert.equal(context.salesSection,'proformas');assert.equal(context.salesEditing,'new');
 handler({target:{closest:()=>({dataset:{view:'service',workspaceSection:'schedule'}})}});
 assert.equal(context.serviceSection,'schedule');
 context.busy=true;
 handler({target:{closest:()=>({dataset:{view:'inventory',workspaceSection:'catalog'}})}});
 assert.equal(context.inventorySection,'stock');
});

test('A menu press while a screen is loading is kept and done when loading ends, not dropped',async()=>{
 const nav=readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const runLine=app.split('\n').find(l=>l.startsWith('async function run('));
 const replayLine=app.split('\n').find(l=>l.startsWith('function replayQueuedNavigation('));
 let handler;const navEl={innerHTML:'',setAttribute(){}};
 const context=vm.createContext({document:{querySelector:s=>s==='#nav'?navEl:{before(){}},addEventListener:(name,fn)=>{handler=fn}},busy:false,salesSection:'',salesEditing:'',salesLoaded:true,serviceLoaded:true,serviceSection:'',inventorySection:'stock',message(){},friendlyError:e=>e.message});
 vm.runInContext(nav+'\n'+runLine+'\n'+replayLine,context);
 let clicks=0;const button={dataset:{view:'inventory',workspaceSection:'catalog'},isConnected:true,hidden:false,click(){clicks++;handler({target:{closest:()=>button}})}};
 let finish;const loading=vm.runInContext('run',context)(()=>new Promise(resolve=>{finish=resolve}));
 assert.equal(context.busy,true);
 handler({target:{closest:()=>button}});
 assert.equal(context.inventorySection,'stock','nothing changes while loading');
 finish();await loading;
 assert.equal(clicks,1,'the pressed menu item is pressed again once loading ends');
 assert.equal(context.inventorySection,'catalog');
 assert.equal(vm.runInContext('navWhileBusy',context),null);
});

test('explicit Sales and Service entry refreshes cached rows only after unsaved changes are accepted',()=>{
 const source=readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8');
 let handler,leave=false;const nav={innerHTML:'',setAttribute(){}};
 const context=vm.createContext({document:{querySelector:s=>s==='#nav'?nav:{before(){}},addEventListener:(_name,fn)=>{handler=fn}},busy:false,salesConfirmLeave:()=>leave,salesLoaded:true,serviceLoaded:true,salesSection:'proformas',salesEditing:'draft',salesFocusedProforma:'original',salesFocusedDelivery:'',serviceSection:'installations'});
 vm.runInContext(source,context);
 let stopped=false;
 const click=view=>handler({target:{closest:()=>({dataset:{view,workspaceSection:view==='sales'?'delivery':'schedule'}})},preventDefault(){},stopImmediatePropagation(){stopped=true;}});
 click('sales');
 assert.equal(stopped,true);assert.equal(context.salesLoaded,true);assert.equal(context.salesEditing,'draft');assert.equal(context.salesFocusedProforma,'original');
 click('service');assert.equal(context.serviceLoaded,true);assert.equal(context.serviceSection,'installations');
 leave=true;click('sales');
 assert.equal(context.salesLoaded,false);assert.equal(context.salesSection,'delivery');assert.equal(context.salesEditing,'');
 click('service');assert.equal(context.serviceLoaded,false);assert.equal(context.serviceSection,'schedule');
});
