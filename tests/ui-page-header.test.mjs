import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({esc:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))});
vm.runInContext(readFileSync(new URL('../ui-page-header.js',import.meta.url),'utf8'),ctx);
test('page header escapes titles and subtitles without inventing controls',()=>{
 const html=ctx.workspacePageHeader({title:'<img src=x onerror=bad()>',subtitle:'A & B <script>bad</script>'});
 assert.ok(html.includes('&lt;img'));assert.ok(html.includes('A &amp; B &lt;script&gt;'));assert.ok(!html.includes('<script>'));
 for(const slot of ['workspace-page-back','workspace-page-actions','workspace-page-breadcrumbs'])assert.ok(!html.includes(slot));
 assert.equal((html.match(/<h1/g)||[]).length,1);
});
test('header retains existing hooks, breadcrumb links and action order',()=>{
 const html=ctx.workspacePageHeader({title:'Invoice 42',titleAttrs:'id="invoiceHeading" tabindex="-1"',back:'<button data-back>Back</button>',breadcrumbs:'<a href="#/go/books/invoices">Invoices</a><span aria-current="page">Invoice 42</span>',actions:'<button id="refresh">Refresh</button><button id="save" class="button-primary">Save</button>'});
 assert.ok(html.indexOf('data-back')<html.indexOf('<h1'));assert.ok(html.indexOf('id="refresh"')<html.indexOf('id="save"'));
 assert.ok(html.includes('aria-label="Breadcrumb"'));assert.ok(html.includes('href="#/go/books/invoices"'));assert.ok(html.includes('<h1 id="invoiceHeading" tabindex="-1">Invoice 42</h1>'));
});
test('header scroll edge has one passive listener and returns to transparent at the top',()=>{
 const classes=new Set(),listeners=[],observers=[],context=vm.createContext({document:{getElementById:()=>null,body:{classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key)}}},window:{scrollY:0,addEventListener:(...args)=>listeners.push(args)},MutationObserver:class{observe(...args){observers.push(args);}}});
 vm.runInContext(readFileSync(new URL('../ui-page-header.js',import.meta.url),'utf8'),context);
 context.installWorkspaceHeaderScroll();context.installWorkspaceHeaderScroll();assert.equal(listeners.length,1);assert.equal(listeners[0][0],'scroll');assert.equal(listeners[0][2].passive,true);assert.equal(classes.size,0);
 assert.equal(observers.length,1);assert.equal(observers[0][0],context.document.body);assert.deepEqual([...observers[0][1].attributeFilter],['hidden','inert']);
 context.window.scrollY=120;listeners[0][1]();assert.equal(classes.has('workspace-page-scrolled'),true);
 context.window.scrollY=0;listeners[0][1]();assert.equal(classes.size,0);
});
