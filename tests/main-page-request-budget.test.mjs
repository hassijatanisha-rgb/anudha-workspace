import test from 'node:test';
import assert from 'node:assert/strict';
import {mainPageFixture,excludedScripts} from './helpers/main-page-budget-fixture.mjs';
import {stock,rpcs,tables,cases,areas,sectionKeys,routeKey,assertUsable,openMainPageScenario} from './helpers/main-page-scenarios.mjs';

for(const entry of cases)for(const role of entry.roles)test(`combined cold ${entry.name}, ${role}: real bootstrap + page + decorators fit 10 DB requests`,async t=>{
 const f=await openMainPageScenario(entry,role);
 t.diagnostic(`${f.calls.length} DB; ${f.authCalls.length} excluded Auth provider calls: ${f.calls.map(call=>call.name).join(', ')}`);
});

test('every authored main navigation destination has combined coverage for each permitted representative role',async()=>{
 for(const role of ['owner','head','staff']){
  const f=mainPageFixture({role,department:role==='head'?'sales':'management',access:areas,accounting:true,rpcs,tables});
  await f.open({view:'guide'});assertUsable(f,cases.find(entry=>entry.name==='Help'));
  const authored=f.evaluate('workspaceGroups.flatMap(group=>group.items).filter(([,target])=>target).map(([,target,section])=>[target,section])');
  for(const [view,section] of authored){
   const key=routeKey(view,section),entries=cases.filter(entry=>routeKey(entry.state.view,entry.state[sectionKeys[entry.state.view]])===key);
   assert.ok(entries.length,'Missing main navigation fixture: '+key);
   const menu=[...f.document.querySelectorAll('#nav [data-view]')].find(button=>routeKey(button.dataset.view,button.dataset.workspaceSection)===key);
   assert.ok(menu,'Authored navigation destination is mounted: '+key);
   if(!menu.hidden)assert.ok(entries.some(entry=>entry.roles.includes(role)),`Missing ${role} cold-page coverage: ${key}`);
  }
 }
});

test('combined cold My tasks, owner, 101-person directory: complete directory pagination must fit 10 DB requests',async t=>{
 const f=mainPageFixture({directorySize:101,rpcs,tables});
 await f.open({view:'personal',personalSection:'task'});
 assert.equal(f.evaluate('employeeDirectory.size'),101,'Every directory page is really consumed');
 const pages=f.calls.filter(call=>call.name==='list_staff_display_names');assert.equal(pages.length,2);assert.equal(pages[0].args.p_after_id,null);assert.equal(pages[1].args.p_after_id,'employee-99');
 t.diagnostic(`${f.calls.length} DB: ${f.calls.map(call=>call.name).join(', ')}`);
 assertUsable(f,cases.find(entry=>entry.name==='My tasks'));
});

for(const kind of ['rpc','from'])test(`unexpected ${kind} requests are rejected even when production catches the transport error`,async()=>{
 const f=mainPageFixture({rpcs:{...rpcs,inventory_stock_page:async()=>{if(kind==='rpc')await f.ctx.client.rpc('unmodeled_query');else await f.ctx.client.from('unmodeled_table').select('id');return stock;}}});
 // The application client is lexical, so exercise the real transport via that
 // binding without replacing a renderer or loader.
 f.ctx.client=f.evaluate('client');
 await assert.rejects(f.open({view:'inventory',inventorySection:'stock'}),/Unknown transport requests/);
});

test('a cheap failed page cannot pass the usable-content budget check',async()=>{
 const f=mainPageFixture({rpcs:{...rpcs,inventory_stock_page:()=>{throw Error('Fictional denied read');}},tables:{product_serial_settings:query=>{assert.equal(query.columns,'product_id,serial_required');return [];}}});
 await f.open({view:'inventory',inventorySection:'stock'});
 assert.ok(f.calls.length<=10);assert.match(f.document.querySelector('#content').textContent,/Stock could not be loaded/);
 assert.throws(()=>assertUsable(f,cases[0]));
});

test('the combined harness loads the authored entrypoint and every data-bearing script',()=>{
 const f=mainPageFixture();
 assert.deepEqual(excludedScripts,['vendor/supabase.js','vendor/phone.js','vendor/xlsx.full.min.js','config.js','smart-lookup.js']);
 for(const file of ['app.js','staff-access.js','employee-names.js','two-step.js','notification-bell.js','workspace-navigation.js','workspace-refresh.js','accounting-ledger.js'])assert.ok(f.scripts.includes(file),file);
 assert.ok(f.intervals.some(timer=>timer.delay===120000),'Production bell polling is installed; repeated timer polls are outside a single page open');
});
