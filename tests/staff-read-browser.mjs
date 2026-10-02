// Disposable browser acceptance: actual load/clear/login, stub SDK, no network.
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const prefix=app.slice(0,app.indexOf('async function all('));
const loader=app.slice(app.indexOf('async function load()'),app.indexOf('function missingAccount'));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 for(const mode of ['returned','thrown','inactive','auth-returned','auth-thrown','auth-hung']){
  console.log(`CHECK: ${mode}`);
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());
  page.on('pageerror',error=>console.error(`Browser fixture error (${mode}): ${error.message}`));
  await page.setContent('<nav id="nav">Old menu</nav><div id="identity">Old user</div><div id="notice" role="status"></div><main id="content">Old client data</main><div id="fields">Old fields</div><button id="check">Check access</button>');
  await page.addScriptTag({content:prefix+'\n'+loader});
  await page.addScriptTag({content:`
   function clearEmployeeNames(){};
   window.signouts=0;window.dataLoads=0;
   me={user_id:'fictional-previous'};organizations=[{id:'fictional'}];contacts=[{id:'fictional'}];products=[{id:'fictional'}];
   async function loadEmployeeNames(){window.dataLoads++;throw Error('Unexpected data load')}
   const mode=${JSON.stringify(mode)};
   async function reply(){if(mode==='thrown')throw Error('Network unavailable');if(mode==='inactive')return {data:{active:false},error:null};return {error:{message:'statement timeout'}}}
   client={
    auth:{getUser:async()=>{if(mode==='auth-hung')return new Promise(()=>{});if(mode==='auth-thrown')throw Error('Network unavailable');if(mode==='auth-returned')return {data:{user:null},error:{message:'Failed to fetch'}};return {data:{user:{id:'fictional'}}}},signOut:async()=>{window.signouts++}},
    from:()=>{if(mode.startsWith('auth-'))throw Error('Unexpected staff read');return {select:()=>({eq:()=>({maybeSingle:reply,single:reply})})}}
   };
   document.querySelector('#check').onclick=async()=>{try{await load()}catch(error){message(error.message,true)}document.querySelector('#check').dataset.finished='true'};
  `});
  await page.getByRole('button',{name:'Check access'}).click();
  await page.locator('#check[data-finished="true"]').waitFor({timeout:60000});
  assert.equal(await page.locator('#nav').isVisible(),false);
  assert.equal(await page.locator('#identity').textContent(),'');
  assert.equal(await page.locator('#fields').textContent(),'');
  assert.deepEqual(await page.evaluate(()=>({me,organizations,contacts,products,dataLoads:window.dataLoads})),{me:null,organizations:[],contacts:[],products:[],dataLoads:0});
  if(mode==='inactive'){
   assert.equal(await page.evaluate(()=>window.signouts),1);
   assert.equal(await page.getByRole('heading',{name:'Welcome back'}).count(),1);
   assert.match(await page.locator('#notice').innerText(),/not on the active staff list/);
  }else{
   assert.equal(await page.evaluate(()=>window.signouts),0);
   assert.equal(await page.locator('#content').textContent(),'');
   assert.match(await page.locator('#notice').innerText(),mode.startsWith('auth-')?/Could not verify your session.*reload/:/Could not verify staff access.*reload/);
   if(mode==='auth-hung')assert.match(await page.locator('#notice').innerText(),/timed out/);
  }
  await page.close();
 }
 console.log('PASS: real browser clears stale screen, identity and core data for returned/thrown staff and authentication errors without sign-out; inactive member signs out; no network or live account.');
}finally{await browser.close()}
