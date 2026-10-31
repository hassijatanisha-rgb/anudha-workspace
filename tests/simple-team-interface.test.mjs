import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.src.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
const inventory=fs.readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8');

for(const label of ['Clients','Inventory','System','Staff','Deleted items','Setup progress','Help']){
 assert.match(html,new RegExp(`>${label}<`),`Main navigation should use the plain label “${label}”.`);
}
assert.match(css,/button,.button\{min-height:44px/,'Buttons need a novice-friendly hit area.');
assert.doesNotMatch(css,/transition:\s*all/,'Animations should only transition intentional properties.');
assert.match(fs.readFileSync(new URL('../tokens.css',import.meta.url),'utf8'),/--warning-bg:#fff4d6/,'Waiting states should share the brief’s attention token.');
assert.match(css,/\.incomplete[^{]*\{background:var\(--warning-bg\)/,'Revision states should consume the shared attention token.');
assert.match(inventory,/\['stock','Stock'\].*\['transfers','Move cartons'\].*\['locations','Locations'\].*\['catalog','Products'\]/s);

console.log('PASS: team interface uses plain labels, large controls, and one attention state.');
