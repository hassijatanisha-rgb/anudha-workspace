import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('interface polish stylesheet loads after every other stylesheet so its hierarchy wins',()=>{
 const html=read('index.src.html'),links=[...html.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m=>m[1]);
 assert.equal(links.at(-1),'ui-polish.css');
 const css=read('ui-polish.css');
 for(const selector of ['[data-lead-action="lost"]','[data-proforma-action="cancel"]','[data-delete-contact]'])assert.ok(css.includes(selector),`${selector} is styled as danger`);
 for(const selector of ['[data-lead-action="qualify"]','[data-proforma-action="send"]','[data-work-open]'])assert.ok(css.includes(selector),`${selector} is styled as primary`);
});
test('navigating to another screen clears the previous screen message',async()=>{
 const f=mainPageFixture();f.ctx.actor=f.actor;f.evaluate("me=actor;view='inventory';inventorySection='catalog'");let rendered=0;f.ctx.render=async()=>{rendered++;};
 f.ctx.message('Message from the previous screen');assert.match(f.document.querySelector('#notice').textContent,/previous screen/);
 const button=f.document.querySelector('[data-view="inventory"][data-workspace-section="stock"]'),handler=f.document.body.events.click.find(event=>String(event.fn).includes('return navigateWorkspace(button)')).fn;
 const event={target:{closest:()=>button},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};await handler(event);
 assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(f.document.querySelector('#notice').textContent,'');assert.equal(rendered,1);assert.equal(f.evaluate('inventorySection'),'stock');
});
