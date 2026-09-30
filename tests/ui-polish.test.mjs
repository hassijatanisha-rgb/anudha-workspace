import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('interface polish stylesheet loads after every other stylesheet so its hierarchy wins',()=>{
 const html=read('index.html'),links=[...html.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m=>m[1]);
 assert.equal(links.at(-1),'ui-polish.css');
 const css=read('ui-polish.css');
 for(const selector of ['[data-lead-action="lost"]','[data-proforma-action="cancel"]','[data-delete-contact]'])assert.ok(css.includes(selector),`${selector} is styled as danger`);
 for(const selector of ['[data-lead-action="qualify"]','[data-proforma-action="send"]','[data-work-done]'])assert.ok(css.includes(selector),`${selector} is styled as primary`);
});
test('navigating to another screen clears the previous screen message',()=>{
 let handler,cleared=0;const nav={innerHTML:'',setAttribute(){}};
 const ctx=vm.createContext({document:{querySelector:s=>s==='#nav'?nav:{before(){}},addEventListener:(name,fn)=>{handler=fn}},busy:false,salesSection:'',salesEditing:'',serviceSection:'',inventorySection:'',message:text=>{if(text==='')cleared++}});
 vm.runInContext(read('workspace-navigation.js'),ctx);
 handler({target:{closest:()=>({dataset:{view:'inventory',workspaceSection:'stock'}})}});
 assert.equal(cleared,1);
});
