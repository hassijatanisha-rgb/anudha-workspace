import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();await page.setContent('<main id="content"></main>');
 await page.addScriptTag({content:`const me={user_id:'fixture',role:'staff'};const $=s=>document.querySelector(s);const products=[];const view='inventory';let inventorySection='review';let fixtureRows=[],fixtureCalls=0;
 function esc(v){const e=document.createElement('span');e.textContent=String(v??'');return e.innerHTML.replace(/"/g,'&quot;');}
 function inventoryHeader(){return '';}function bindInventoryWorkspace(){}function companyDate(){return '2026-10-29';}function workspaceLoading(){document.getElementById('content').textContent='Loading';}function run(fn){return fn();}
 function productStockReview(){return {issues:['Needs review']};}
 const client={rpc:async(name,args)=>{if(name!=='tally_stock_review_page')throw Error('Unexpected write');fixtureCalls++;
 const scope=tallyGodownReview(fixtureRows,new Map(),args.p_godown,args.p_query),readiness=tallyGodownReadiness(fixtureRows,tallyRowReview),pages=Math.max(1,Math.ceil(scope.rows.length/50)),index=Math.min(args.p_page,pages-1),readinessPages=Math.max(1,Math.ceil(readiness.length/20)),ready=Math.min(args.p_readiness_page,readinessPages-1);
 return {data:{total:scope.rows.length,page:index,pages,scope:{total:scope.total,reviewed:scope.reviewed,negative:scope.negative,missingQuantity:scope.missingQuantity},rows:scope.rows.slice(index*50,index*50+50).map(r=>({...r,pieces:null,reviewed:false,checks_passed:false})),readiness:{total:readiness.length,page:ready,pages:readinessPages,rows:readiness.slice(ready*20,ready*20+20)}}};}};`});
 await page.addScriptTag({content:readFileSync(new URL('../search-state.js',import.meta.url),'utf8')});
 await page.addScriptTag({content:readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8')});
 await page.evaluate(async()=>{fixtureRows=Array.from({length:55},(_,i)=>({id:'c'+i,godown:'City Printer',product_name:'Blood bag '+i,quantity:i===0?-2:1,unit:'PCS',balance_date:'2026-09-01'}));fixtureRows.push({id:'other',godown:'City Printer 2',product_name:'Other-only item',quantity:22,unit:'PCS',balance_date:'2026-09-01'});await tallyStockScreen();});
 assert.equal(await page.evaluate(()=>fixtureCalls),1);
 await page.locator('#tallyGodown').fill('City Printer');await page.waitForFunction(()=>tallyPageData?.total===55&&!tallyLoading);
 assert.equal(await page.locator('.cleanup-table tbody tr').count(),50);
 await page.locator('#tallyNext').click();await page.waitForFunction(()=>tallyPageData?.page===1&&!tallyLoading);assert.equal(await page.locator('.cleanup-table tbody tr').count(),5);
 await page.locator('#tallyGodown').fill('City Printer 2');await page.waitForFunction(()=>tallyPageData?.total===1&&!tallyLoading);
 assert.equal(await page.locator('.cleanup-table tbody tr').count(),1);assert.equal(await page.locator('#tallyPrev').isDisabled(),true);
 await page.locator('#tallySearch').fill('Blood');await page.waitForFunction(()=>tallyPageData?.total===0&&!tallyLoading);assert.equal(await page.locator('.cleanup-table tbody tr').count(),0);
 assert.equal(await page.locator('#tallySearch').evaluate(e=>e===document.activeElement),true);
 await page.locator('#tallyGodown').fill('City Printer');await page.waitForFunction(()=>tallyPageData?.total===55&&!tallyLoading);assert.equal(await page.locator('.cleanup-table tbody tr').count(),50);
 assert.ok((await page.locator('#tallyScope').textContent()).includes('55 matching rows'));
 assert.ok((await page.locator('.cleanup-table tbody').textContent()).includes('Negative'));
 await page.locator('#tallySearch').fill('bag 54');await page.waitForFunction(()=>tallyPageData?.total===1&&!tallyLoading);assert.equal(await page.locator('[data-tally-review="c54"]').count(),1);
 assert.equal(await page.locator('#tallyFile').count(),0);assert.equal(await page.locator('#godownReadiness tbody tr').count(),2);
 assert.ok((await page.locator('#godownReadiness').textContent()).includes('not that stock has been imported'));
 await page.evaluate(async()=>{fixtureRows=[{id:'new',godown:'Reloaded godown',product_name:'New source',quantity:1,unit:'PCS',balance_date:'2026-09-01'}];tallyGodown='';tallySearch='';await tallyStockScreen();});
 assert.match(await page.locator('#godownReadiness').innerText(),/Reloaded godown/);
 console.log('PASS: isolated bounded RPC fixture, exact godown selection, pagination reset, scoped search/focus, negative flag, correct review row and staff import hidden. No transport or writes.');
}finally{await browser.close();}
