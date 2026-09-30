import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const guide=readFileSync(new URL('app.js',root),'utf8').split('\n').find(line=>line.startsWith('function guide(){'));
const appSources=readdirSync(root).filter(name=>name.endsWith('.js')).map(name=>readFileSync(new URL(name,root),'utf8')).join('\n');
test('help page only names buttons and menu items that exist',()=>{
 assert.ok(guide,'guide() must exist in app.js');
 const named=[...guide.matchAll(/<strong>([^<]+)<\/strong>/g)].map(match=>match[1].replaceAll('&amp;','&').replace(/[:.]$/,''));
 assert.ok(named.length>=10);
 const otherScreens=appSources.split(guide).join('');
 for(const label of named)assert.ok(otherScreens.includes(label)||otherScreens.includes(label.replaceAll('&','&amp;')),`Help names "${label}" but no screen shows it`);
});
test('help page does not describe live workflows as future work or name removed menus',()=>{
 assert.doesNotMatch(guide,/remain later work|ChatGPT|Staff &amp; import|Staff & import/);
 // Reviewer withheld 93be2d7 over readiness/privacy wording not verified live; keep such guarantees out of Help.
 assert.doesNotMatch(guide,/Other staff cannot read|shared company database|colleagues see it/);
 for(const menu of ['Create Pro forma','Delivery progress','Machines to install','Deleted items'])assert.match(guide.replaceAll('&amp;','&'),new RegExp(menu));
});
