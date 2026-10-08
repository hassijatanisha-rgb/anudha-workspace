import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const enabled=process.env.SERVICE_BROWSER_QA==='1';
let browser;
test.before(async()=>{
 if(!enabled)return;
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close()});
const check=(name,fn)=>test(name,{skip:!enabled&&'Set SERVICE_BROWSER_QA=1 with local Playwright and Chrome'},fn);
async function fixture(t){
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 await context.route('**/*',route=>route.abort());
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.setContent('<main id="content">Client page</main>');
 await page.evaluate(()=>{
  window.me={user_id:'fictional-service-user'};window.view='service';
  window.$=s=>document.querySelector(s);window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  window.syncWorkspaceNavigation=()=>{};window.run=fn=>fn();window.requests=[];
  window.client={from(){const q={select:()=>q,order:()=>q,limit:()=>q,then(resolve,reject){requests.push({resolve,reject})}};return q}};
  window.finish=(offset=0,error=null)=>requests.slice(offset,offset+7).forEach(r=>r.resolve(error?{error}:{data:[]}));
 });
 for(const file of ['service-domain.js','service-workflow.js'])await page.addScriptTag({content:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
 return page;
}
check('actual service error screen refresh recovers through bound button',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{window.pending=serviceWorkspace()});
 await p.waitForFunction(()=>requests.length===7);
 await p.evaluate(async()=>{finish(0,{message:'Fixture network unavailable'});await pending});
 assert.match(await p.locator('[role="alert"]').innerText(),/Unable to load service jobs/);
 assert.doesNotMatch(await p.locator('#content').innerText(),/run migrations|setup required/);
 await p.getByRole('button',{name:'Refresh list'}).click();
 await p.waitForFunction(()=>requests.length===14);
 await p.evaluate(()=>finish(7));
 await p.getByText('No installation jobs yet.').waitFor();
 assert.equal(await p.locator('[role="alert"]').count(),0);
});
check('late service response cannot replace navigated client page in real DOM',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{window.pending=serviceWorkspace()});
 await p.waitForFunction(()=>requests.length===7);
 await p.evaluate(async()=>{view='clients';$('#content').textContent='Client page preserved';finish();await pending});
 assert.equal(await p.locator('#content').innerText(),'Client page preserved');
 assert.equal(await p.evaluate(()=>serviceCases.length),0);
});
check('overlapping refresh and replaced identity discard stale rejection and cached data',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{window.old=serviceWorkspace(true);window.current=serviceWorkspace(true)});
 await p.waitForFunction(()=>requests.length===14);
 await p.evaluate(async()=>{finish(7);await current;requests[0].reject(Error('Old error'));finish();await old});
 assert.equal(await p.locator('[role="alert"]').count(),0);
 await p.getByText('No installation jobs yet.').waitFor();
 await p.evaluate(()=>{me={user_id:'fictional-replacement'};window.next=serviceWorkspace()});
 await p.waitForFunction(()=>requests.length===21);
 assert.match(await p.locator('#content').innerText(),/Loading service/);
 await p.evaluate(async()=>{finish(14);await next});
 assert.equal(await p.evaluate(()=>serviceLoadedActor===me),true);
});
