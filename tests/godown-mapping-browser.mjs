import {chromium} from '/Users/tanisha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();await page.route('https://inventory-fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<main id="content"></main>'}));await page.goto('https://inventory-fixture.test/');
 await page.addScriptTag({content:`let me={user_id:'owner',role:'owner'},inventorySection='review';let calls=[],fail=true;const client={rpc:async(n,p)=>{calls.push(p);if(fail)return {error:{message:'Network uncertain'}};return {data:{...p,id:p.p_id,version:1}}}};function esc(v){const e=document.createElement('span');e.textContent=String(v);return e.innerHTML.replace(/"/g,'&quot;');}async function all(name){return name==='inventory_locations'?[{id:'loc',name:'City Printer',active:true}]:[];}`});
 await page.addScriptTag({content:readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8')});
 await page.evaluate(()=>openGodownMapping('CITY PRINTER'));
 await page.locator('select[name="location"]').selectOption('loc');await page.locator('textarea').fill('Physical location checked');
 await page.getByRole('button',{name:'Save mapping only'}).click();await page.locator('[role="alert"]').filter({hasText:'Network uncertain'}).waitFor();
 assert.equal(await page.locator('select').inputValue(),'loc');
 assert.equal(await page.locator('[data-mapping-history]').innerText(),'Saved mapping history\n\nNo saved mapping yet.');
 assert.equal(await page.getByText('CITY PRINTER · version 0',{exact:true}).count(),1);
 await page.evaluate(()=>fail=false);await page.getByRole('button',{name:'Save mapping only'}).click();await page.getByText('Mapping saved. Stock quantities unchanged.').waitFor();
 assert.equal(await page.evaluate(()=>calls[0].p_id===calls[1].p_id),true);assert.equal(await page.evaluate(()=>calls[1].p_expected_version),0);
 assert.match(await page.locator('[data-mapping-history]').innerText(),/Version 1 · City Printer · Physical location checked/);
 assert.equal(await page.getByText('No saved mapping yet.',{exact:true}).count(),0);
 assert.equal(await page.getByText('CITY PRINTER · version 1',{exact:true}).count(),1,'confirmed save must update the displayed version');
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});await page.evaluate(()=>{me.role='staff';return openGodownMapping('CITY PRINTER')});assert.equal(await page.locator('dialog').count(),0);
 console.log('PASS: mapping dialog retains edits after error, reuses retry key, saves versioned mapping, closes, rejects staff. Fixture RPC only.');
}finally{await browser.close();}
