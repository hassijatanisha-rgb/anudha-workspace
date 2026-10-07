import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from '../scripts/build-bundle.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('served page and bundles are built from the current sources',()=>{
 for(const [name,text] of Object.entries(build()))assert.ok(read(name)===text,`${name} is out of date. Run: node scripts/build-bundle.mjs`);
});

test('index.html loads one stylesheet and one script, named by content',()=>{
 const html=read('index.html');
 assert.deepEqual([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1].replace(/=\w+$/,'=')),['app.bundle.css?v=']);
 assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1].replace(/=\w+$/,'=')),['app.bundle.js?v=']);
 // Everything outside the asset tags is the source page unchanged.
 const strip=s=>s.replace(/<link rel="(stylesheet|preconnect)"[^>]*>|<script[^>]*><\/script>/g,'');
 assert.equal(strip(html),strip(read('index.src.html')));
});

test('bundles hold every source file once, in page order',()=>{
 const page=read('index.src.html'),js=read('app.bundle.js'),css=read('app.bundle.css');
 const scripts=[...page.matchAll(/<script src="([^"?]+)/g)].map(m=>m[1]),styles=[...page.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m=>m[1]);
 assert.ok(scripts.length>50&&scripts.includes('vendor/supabase.js')&&scripts.at(-1)==='action-forms.js');
 assert.ok(js.startsWith("'use strict';"),'every page script runs in strict mode');
 let at=0;for(const f of scripts){const i=js.indexOf(`\n;// ${f}\n`,at);assert.ok(i>=at,`${f} missing or out of order`);at=i;}
 at=0;for(const f of styles){const i=css.indexOf(`/* ${f} */`,at);assert.ok(i>=at,`${f} missing or out of order`);at=i;}
});
