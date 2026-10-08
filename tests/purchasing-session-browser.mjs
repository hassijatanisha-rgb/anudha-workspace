// Actual purchasing renderer with fictional deferred reads; external traffic blocked.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const scenario of ['current','navigation','replacement','clear','overlap']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<button id="leave">Clients</button><main id="content"></main>');
  await page.addScriptTag({content:`
   let me={user_id:'first',role:'staff'},view='purchasing',reads=[];
   const $=s=>document.querySelector(s),esc=s=>String(s??'');
   function syncWorkspaceNavigation(){} function run(fn){return fn()}
   function all(table){return new Promise((resolve,reject)=>reads.push({table,resolve,reject}))}
   document.querySelector('#leave').onclick=()=>{view='clients';document.querySelector('#content').textContent='Clients fixture'};
  `});
  await page.addScriptTag({content:readFileSync(new URL('../purchasing.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{window.first=purchasingWorkspace(true)});
  await page.waitForFunction(()=>reads.length===2);
  if(scenario==='navigation')await page.getByRole('button',{name:'Clients',exact:true}).click();
  if(scenario==='replacement')await page.evaluate(()=>{me={user_id:'first',role:'staff'};document.querySelector('#content').textContent='New session'});
  if(scenario==='clear')await page.evaluate(()=>{clearPurchasing();document.querySelector('#content').textContent='Cleared session'});
  if(scenario==='overlap'){
   await page.evaluate(()=>{window.second=purchasingWorkspace(true)});
   await page.evaluate(async()=>{reads.slice(2).forEach(r=>r.resolve([]));await window.second;reads[0].reject(Error('Obsolete failure'));reads[1].resolve([]);await window.first});
  }else await page.evaluate(async scenario=>{if(scenario==='clear'){reads[0].reject(Error('Old error'));reads[1].resolve([])}else reads.forEach(r=>r.resolve([]));await window.first},scenario);
  if(['current','overlap'].includes(scenario)){
   await page.getByRole('heading',{name:'Purchasing',exact:true}).waitFor();
   assert.equal(await page.getByRole('alert').count(),0);
  }else assert.equal(await page.locator('#content').innerText(),{navigation:'Clients fixture',replacement:'New session',clear:'Cleared session'}[scenario]);
  assert.deepEqual(errors,[]);console.log('PASS purchasing browser: '+scenario);await page.close();
 }
}finally{await browser.close()}
