import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const flush=()=>new Promise(setImmediate);
function fixture(){
 const f=mainPageFixture();f.ctx.actor=f.actor;f.evaluate("me=actor;view='sales';salesSection='delivery';salesEditing='';salesLoaded=true;serviceLoaded=true;serviceSection='forms';inventorySection='stock'");f.ctx.render=async()=>{};
 const handler=f.document.body.events.click.find(event=>String(event.fn).includes('return navigateWorkspace(button)')).fn;
 const button=(view,section)=>f.document.querySelectorAll('[data-view]').find(node=>node.dataset.view===view&&(!section||node.dataset.workspaceSection===section));
 const press=(view,section)=>{const target=button(view,section);target.hidden=false;const event={target:{closest:()=>target},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};return {event,promise:handler(event)};};
 return {...f,button,press};
}
test('Sidebar has six categories and preserves its permission and section targets',async()=>{
 const f=fixture(),nav=f.document.querySelector('#nav');assert.equal(nav.querySelectorAll('.nav-group').length,6);
 assert.equal(f.button('books','invoices').getAttribute('data-accounting-only'),'');assert.equal(f.button('books','invoices').hidden,true);assert.equal(f.button('staff').hidden,true);
 for(const view of ['contacts','pending','leads'])assert.ok(f.button(view));
 await f.press('sales','proformas').promise;assert.equal(f.evaluate('salesSection'),'proformas');assert.equal(f.evaluate('salesEditing'),'');
 await f.press('service','schedule').promise;assert.equal(f.evaluate('serviceSection'),'schedule');
});
test('A menu press while a screen is loading is kept and done when loading ends, not dropped',async()=>{
 const f=fixture();let finish;const loading=f.ctx.run(()=>new Promise(resolve=>{finish=resolve;}));
 const press=f.press('inventory','catalog');assert.equal(press.event.prevented,true);assert.equal(press.event.stopped,true);await press.promise;
 assert.equal(f.evaluate('inventorySection'),'stock');assert.equal(f.evaluate('navWhileBusy.button')===f.button('inventory','catalog'),true);
 finish();await loading;await flush();assert.equal(f.evaluate('inventorySection'),'catalog');assert.equal(f.evaluate('navWhileBusy'),null);
});
test('explicit Sales and Service entry refreshes cached rows only after unsaved changes are accepted',async()=>{
 const f=fixture();f.document.querySelector('#content').innerHTML='<form id="proformaForm"><input name="notes" value="Original"></form>';
 const form=f.document.querySelector('#proformaForm'),input=form.querySelector('input');input.name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Edited';
 f.evaluate("salesSection='proformas';salesEditing='draft';salesFocusedProforma='original';serviceSection='installations'");f.ctx.askConfirm=async()=>false;
 await f.press('sales','delivery').promise;assert.equal(f.evaluate('salesLoaded'),true);assert.equal(f.evaluate('salesEditing'),'draft');assert.equal(f.evaluate('salesFocusedProforma'),'original');
 await f.press('service','schedule').promise;assert.equal(f.evaluate('serviceLoaded'),true);assert.equal(f.evaluate('serviceSection'),'installations');
 f.ctx.askConfirm=async()=>true;await f.press('sales','delivery').promise;assert.equal(f.evaluate('salesLoaded'),false);assert.equal(f.evaluate('salesSection'),'delivery');assert.equal(f.evaluate('salesEditing'),'');
 await f.press('service','schedule').promise;assert.equal(f.evaluate('serviceLoaded'),false);assert.equal(f.evaluate('serviceSection'),'schedule');
});
