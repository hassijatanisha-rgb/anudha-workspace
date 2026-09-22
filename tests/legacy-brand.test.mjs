import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('header uses the real Anudha logo and loads its scoped theme',()=>{
 const html=read('index.html');
 assert.match(html,/<img class="brand-logo" src="assets\/anudha-logo.svg" alt="Anudha Limited"/);
 assert.match(html,/legacy-brand.css\?v=/);
 assert.doesNotMatch(html,/<span class="logo">A<\/span>/);
 for(const view of ['contacts','inventory','sales','service','approvals'])assert.ok(html.includes(`data-view="${view}"`));
});
test('theme preserves accessible dark actions, keyboard focus and wrapping navigation',()=>{
 const css=read('legacy-brand.css');
 assert.match(css,/--brand-lime:#72ad3d/);
 assert.match(css,/--green-dark:#315c32/);
 assert.match(css,/#nav\{flex-wrap:wrap/);
 assert.match(css,/focus-visible/);
 assert.match(css,/@media print/);
});
