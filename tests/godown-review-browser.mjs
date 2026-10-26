import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();await page.setContent('<main id="content"></main>');
 await page.addScriptTag({content:`const me={user_id:'fixture',role:'staff'};const $=s=>document.querySelector(s);const products=[];
 function esc(v){const e=document.createElement('span');e.textContent=String(v);return e.innerHTML.replace(/"/g,'&quot;');}
 function inventoryHeader(){return '';}function bindInventoryWorkspace(){}
 function productStockReview(){return {issues:['Needs review']};}
 function renderSearchPreservingPosition(input,render){const id=input.id,start=input.selectionStart;render();document.getElementById(id).focus();document.getElementById(id).setSelectionRange(start,start);}`});
 await page.addScriptTag({content:readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8')});
 await page.evaluate(()=>{window.checklistRuns=0;const calculate=tallyGodownReadiness;tallyGodownReadiness=(...args)=>{window.checklistRuns++;return calculate(...args);};});
 await page.evaluate(()=>{tallyRows=Array.from({length:55},(_,i)=>({id:'c'+i,godown:'City Printer',product_name:'Blood bag '+i,quantity:i===0?-2:1,unit:'PCS'}));tallyRows.push({id:'other',godown:'City Printer 2',product_name:'Other-only item',quantity:22,unit:'PCS'});renderTallyStock();});
 await page.locator('#tallyGodown').selectOption({label:'City Printer'});
 assert.equal(await page.locator('.cleanup-table tbody tr').count(),50);
 await page.locator('#tallyNext').click();assert.equal(await page.locator('.cleanup-table tbody tr').count(),5);
 await page.locator('#tallyGodown').selectOption({label:'City Printer 2'});
 assert.equal(await page.locator('.cleanup-table tbody tr').count(),1);assert.equal(await page.locator('#tallyPrev').isDisabled(),true);
 await page.locator('#tallySearch').fill('Blood');assert.equal(await page.locator('.cleanup-table tbody tr').count(),0);
 assert.equal(await page.locator('#tallySearch').evaluate(e=>e===document.activeElement),true);
 await page.locator('#tallyGodown').selectOption('City Printer');assert.equal(await page.locator('.cleanup-table tbody tr').count(),50);
 assert.ok((await page.locator('#tallyScope').textContent()).includes('55 matching rows'));
 assert.ok((await page.locator('.cleanup-table tbody').textContent()).includes('Negative'));
 await page.locator('#tallySearch').fill('bag 54');await page.locator('[data-tally-review="c54"]').count().then(n=>assert.equal(n,1));
 assert.equal(await page.locator('#tallyFile').count(),0);
 assert.equal(await page.locator('#godownReadiness tbody tr').count(),2);
 assert.ok((await page.locator('#godownReadiness').textContent()).includes('not that stock has been imported'));
 assert.equal(await page.locator('[data-location-ready="false"]').count(),2);
 await page.evaluate(()=>{tallyLocationReviews=[{source_godown:'City Printer',version:1,location_id:'loc'}];tallyLocations=[{id:'loc',name:'Verified Warehouse',active:true}];renderTallyStock();});
 assert.equal(await page.locator('[data-location-ready="true"]').count(),1);
 assert.equal(await page.locator('[data-location-ready="true"]').textContent(),'Verified Warehouse');
 await page.evaluate(()=>{tallyLocationReviews.push({source_godown:'City Printer',version:2,location_id:null});renderTallyStock();});
 assert.equal(await page.locator('[data-location-ready="true"]').count(),0);
 assert.ok((await page.locator('#godownReadiness').textContent()).includes('Unresolved — do not import'));
 assert.equal(await page.evaluate(()=>window.checklistRuns),1,'search, filters and pagination must reuse the unchanged checklist');
 await page.addScriptTag({content:`let inventorySection='review';async function all(table){return table==='tally_stock_sources'?[{id:'new',godown:'Reloaded godown',product_name:'New source',quantity:1,unit:'PCS'}]:[];}`});
 await page.evaluate(()=>tallyStockScreen());
 assert.equal(await page.evaluate(()=>window.checklistRuns),2,'reloading data after a correction must recalculate');
 assert.match(await page.locator('#godownReadiness').innerText(),/Reloaded godown/);
 await page.evaluate(()=>{tallyRows.push({id:'blank',godown:'',product_name:'Unplaced item',quantity:1,unit:'PCS'});tallyReadiness=null;renderTallyStock();});
 const blank=page.locator('#godownReadiness tbody tr').filter({hasText:'Missing godown — needs correction'});
 assert.equal(await blank.locator('[data-location-ready]').textContent(),'Missing source godown');
 await page.evaluate(()=>{tallyRows.push({id:'spaces',godown:'   ',product_name:'Whitespace location',quantity:1,unit:'PCS'});tallyReadiness=null;renderTallyStock();});
 const whitespace=page.locator('#godownReadiness tbody tr[data-source-godown="   "]');
 assert.equal(await whitespace.locator('td').first().textContent(),'Missing godown — needs correction');
 assert.equal(await whitespace.locator('[data-location-ready]').textContent(),'Missing source godown');
 console.log('PASS: isolated browser exact godown selection, pagination reset, scoped search/focus, negative flag, correct review row, staff import hidden. No RPC writes.');
}finally{await browser.close();}
