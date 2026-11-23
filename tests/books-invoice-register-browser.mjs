import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sourceManifest} from '../scripts/audit-design-tokens.mjs';
import {cases,openMainPageScenario} from './helpers/main-page-scenarios.mjs';

test('invoice register keeps actions, financial fields and column headers reachable across screen sizes',async t=>{
 const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const fixture=await openMainPageScenario(cases.find(entry=>entry.name==='Books invoices'),'owner');
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.route('**/*',route=>route.abort());
 await page.setContent('<!doctype html>'+fixture.document.body.outerHTML);
 await page.addStyleTag({content:sourceManifest(read('index.src.html')).styles.map(read).join('\n')});
 const waiting=page.getByRole('table',{name:'Accepted Pro formas waiting for invoice'}),posted=page.getByRole('table',{name:'Customer invoices'});
 await posted.getByRole('row').nth(1).locator('[data-label="Customer"]').evaluate(cell=>cell.textContent='CustomerWithOneUninterruptedLongBillingAccountReference');
 await posted.getByRole('row').nth(1).locator('[data-label="Total"]').evaluate(cell=>cell.textContent='TZS 1,234,567,890.99');
 for(const [width,scale] of [[390,100],[320,100],[320,200],[768,100],[1024,100],[1280,100],[1440,100]]){
  await page.setViewportSize({width,height:844});
  await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);
  for(const [table,columns] of [[waiting,4],[posted,10]]){
   const headers=await table.getByRole('columnheader').allTextContents();
   assert.equal(headers.length,columns);
   const row=table.getByRole('row').nth(1);
   assert.equal(await row.getByRole('cell').count(),columns);
   assert.equal(await row.evaluate(el=>getComputedStyle(el).display),width<=600||table===posted?'grid':'table-row');
   assert.deepEqual(await row.locator('td[data-label]').evaluateAll(cells=>cells.map(cell=>cell.dataset.label)),headers.slice(0,-1));
   const fits=await table.evaluate(el=>el.parentElement.scrollWidth<=el.parentElement.clientWidth+1&&
    [...el.tBodies[0].rows[0].cells].every(cell=>cell.scrollWidth<=cell.clientWidth+1));
   assert.ok(fits,'Financial fields fit at '+width+'px / '+scale+'%');
  }
  for(const [table,name] of [[waiting,'Invoice order'],[posted,'Print'],[posted,'Record TRA receipt'],[posted,'Void']]){
   const action=table.getByRole('row').nth(1).getByRole('button',{name,exact:true});
   await action.focus();
   assert.ok(await action.evaluate(el=>el===document.activeElement));
   assert.ok(await action.evaluate(el=>{
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return r.left>=0&&r.right<=innerWidth+1&&r.height>=(innerWidth<=600?44:32)&&el.scrollWidth<=el.clientWidth+1&&el.contains(hit);
   }),name+' is reachable without horizontal scrolling at '+width+'px / '+scale+'%');
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.emulateMedia({media:'print'});
 const printRows=await page.locator('.books-invoice-register tbody tr:first-child').evaluateAll(rows=>rows.map(row=>getComputedStyle(row).display));
 assert.deepEqual(printRows,['table-row','table-row']);
});
