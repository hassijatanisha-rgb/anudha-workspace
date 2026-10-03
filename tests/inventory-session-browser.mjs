import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE,timeout:45000});
try{for(const mode of ['navigation','account']){
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent('<main id="content"></main>');
 await page.addScriptTag({content:`let me={user_id:'first'},view='inventory',productDetailReviews=new Map(),productReviewLoadError='';const $=s=>document.querySelector(s);function syncWorkspaceNavigation(){};const query={select(){return this},order(){return this},limit(){return this},then(ok){return Promise.resolve({data:[]}).then(ok)}};const client={from:()=>query};let release;async function all(table){return table==='inventory_locations'?new Promise(resolve=>{release=resolve}):[];}`});
 for(const file of ['product-machine-links.js','inventory-operations.js'])await page.addScriptTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 await page.evaluate(()=>{window.loading=inventoryWorkspace()});await page.waitForFunction(()=>typeof release==='function');
 await page.evaluate(mode=>{if(mode==='account'){clearInventoryOperations();me={user_id:'second'}}else view='clients';document.querySelector('#content').textContent='New workspace';release([{id:'old',name:'Old fixture'}]);},mode);
 await page.evaluate(()=>window.loading);
 assert.equal(await page.locator('#content').innerText(),'New workspace');
 if(mode==='account')assert.equal(await page.evaluate(()=>inventoryLocations.length),0);
 await page.close();
}console.log('PASS: isolated Chrome inventory navigation/account stale response checks. No live database.');}finally{await browser.close()}
