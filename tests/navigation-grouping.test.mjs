import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('System groups supporting pages and retains owner-only staff hook',()=>{
 const system=html.match(/<details id="systemNav">([\s\S]*?)<\/details>/)?.[1];
 assert.ok(system);
 assert.match(system,/<summary>System<\/summary>/);
 for(const view of ['staff','recycle','checklist','guide']) assert.ok(system.includes(`data-view="${view}"`));
 assert.match(system,/id="staffNav" hidden/);
});
test('Contact correction is inside Clients rather than the top menu',()=>{
 const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
 assert.ok(!nav.includes('data-view="review"'));
 const clients=readFileSync(new URL('../client-profile-pages.js',import.meta.url),'utf8');
 assert.match(clients,/<button data-view="review">Fix contacts<\/button>/);
});
