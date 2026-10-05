// Isolated Chrome + simulated accounts/query responses. Never signs into live Supabase.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();
 await page.setContent('<button id="leave">Open Clients</button><button id="switch">Switch fixture account</button><main id="content"></main>');
 await page.addScriptTag({content:`
 let me={user_id:'first'},view='service',queries=[];const $=s=>document.querySelector(s);function syncWorkspaceNavigation(){}
 const client={from(){const chain={select(){return chain},order(){return chain},limit(){return chain},then(resolve,reject){return new Promise(yes=>queries.push(yes)).then(resolve,reject)}};return chain;}};
 document.querySelector('#leave').onclick=()=>{view='clients';$('#content').textContent='Clients fixture';};
 document.querySelector('#switch').onclick=()=>{clearServiceWorkflow();me={user_id:'second'};view='clients';$('#content').textContent='Second account fixture';};
 `});
 await page.addScriptTag({content:readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8')});
 await page.addScriptTag({content:`installationScreen=()=> '<h1>Service fixture</h1>';serviceUnavailable=()=> '<p role="alert">Service unavailable fixture</p>';bindServiceWorkflow=()=>{};`});
 await page.evaluate(()=>{window.loading=serviceWorkspace(true);});
 await page.waitForFunction(()=>queries.length===7);
 await page.getByRole('button',{name:'Open Clients',exact:true}).click();
 await page.evaluate(async()=>{queries.splice(0).forEach(resolve=>resolve({data:[{id:'old-record'}],error:null}));await window.loading;});
 assert.equal(await page.locator('#content').innerText(),'Clients fixture');
 await page.evaluate(()=>{view='service';window.loading=serviceWorkspace(true);});
 await page.waitForFunction(()=>queries.length===7);
 await page.getByRole('button',{name:'Switch fixture account',exact:true}).click();
 await page.evaluate(async()=>{queries.splice(0).forEach(resolve=>resolve({data:[{id:'first-account-record'}],error:null}));await window.loading;});
 assert.equal(await page.locator('#content').innerText(),'Second account fixture');
 assert.equal(await page.evaluate(()=>serviceCases.length),0);
 assert.equal(await page.evaluate(()=>serviceLoaded),false);
 // Fresh account still loads normally; protection must not leave the page unusable.
 await page.evaluate(()=>{view='service';window.loading=serviceWorkspace();});
 await page.waitForFunction(()=>queries.length===7);
 await page.evaluate(async()=>{queries.splice(0).forEach(resolve=>resolve({data:[],error:null}));await window.loading;});
 await page.getByRole('heading',{name:'Service fixture',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>serviceLoadedActor),'second');
 console.log('PASS: real Chrome preserves navigation/account screen against old service loads, clears cache, and loads the new simulated account. No live auth/database used.');
}finally{await browser.close();}
