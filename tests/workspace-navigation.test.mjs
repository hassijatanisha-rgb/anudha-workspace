import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('Sidebar has five categories and distinguishes unavailable features from links',()=>{
 const source=readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8');
 let handler;const nav={innerHTML:'',setAttribute(){}};
 const context=vm.createContext({document:{querySelector:s=>s==='#nav'?nav:{before(){}},addEventListener:(name,fn)=>{handler=fn}},busy:false,salesSection:'delivery',salesEditing:'',serviceSection:'forms',inventorySection:'stock'});
 vm.runInContext(source,context);
 assert.equal((nav.innerHTML.match(/class="nav-group /g)||[]).length,5);
 assert.match(nav.innerHTML,/data-view="contacts"/);
 assert.match(nav.innerHTML,/id="staffNav" hidden/);
 assert.match(nav.innerHTML,/<div class="nav-unavailable">Pending stock orders/);
 handler({target:{closest:()=>({dataset:{view:'sales',workspaceSection:'new'}})}});
 assert.equal(context.salesSection,'proformas');assert.equal(context.salesEditing,'new');
 handler({target:{closest:()=>({dataset:{view:'service',workspaceSection:'schedule'}})}});
 assert.equal(context.serviceSection,'schedule');
 context.busy=true;
 handler({target:{closest:()=>({dataset:{view:'inventory',workspaceSection:'catalog'}})}});
 assert.equal(context.inventorySection,'stock');
});
