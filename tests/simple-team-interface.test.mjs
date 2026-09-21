import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
const inventory=fs.readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8');

for(const label of ['Fix contacts','Clients','Inventory','Staff','Deleted items','Setup progress','Help']){
 assert.match(html,new RegExp(`>${label}<`),`Main navigation should use the plain label “${label}”.`);
}
assert.match(css,/button,.button\{min-height:44px/,'Buttons need a novice-friendly hit area.');
assert.doesNotMatch(css,/transition:\s*all/,'Animations should only transition intentional properties.');
assert.match(css,/--attention:#fff7d6/,'All revision states should share one attention colour.');
assert.match(inventory,/\['stock','Stock'\].*\['transfers','Move cartons'\].*\['locations','Locations'\].*\['catalog','Products'\]/s);

console.log('PASS: team interface uses plain labels, large controls, and one attention state.');
