import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('header uses the real Anudha logo and loads its scoped theme',()=>{
 const html=read('index.src.html');
 assert.match(html,/<img class="brand-logo" src="assets\/anudha-logo.svg" alt="Anudha Limited"/);
 assert.match(html,/legacy-brand.css\?v=/);
 assert.doesNotMatch(html,/<span class="logo">A<\/span>/);
 for(const view of ['contacts','inventory','sales','service','approvals'])assert.ok(html.includes(`data-view="${view}"`));
});
test('theme consumes shared action colours and preserves keyboard focus and wrapping navigation',()=>{
 const css=read('legacy-brand.css');
 assert.match(read('tokens.css'),/--brand:#176149;--brand-strong:#104936/);
 assert.match(css,/background:var\(--brand-strong\);color:var\(--on-brand\)/);
 assert.doesNotMatch(css,/--brand-lime:|--green-dark:/);
 assert.match(css,/#nav\{flex-wrap:wrap/);
 assert.match(css,/focus-visible/);
 assert.match(css,/@media print/);
});
test('sidebar uses shared surfaces with an active rail, labelled groups and print exclusion',()=>{
 const css=read('workspace-navigation.css');
 assert.match(css,/background:var\(--surface\)/);assert.match(css,/color:var\(--ink\)/);
 assert.match(css,/\.active::before\{[^}]*width:3px;[^}]*background:var\(--brand\)/);assert.match(css,/@media print/);
});
