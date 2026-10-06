// Fictional history reads only. Actual module; no credentials or external requests.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const scenario of ['current','transport','cleared-result','cleared-error','cleared-transport','detached','overlap']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<button id="history">History</button><section data-pending-history-output="fixture"></section>');
  await page.addScriptTag({content:`
   let me={user_id:'first'},view='pending';
   const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
   function employeeName(){return 'Fixture Employee'}
   const query={select(){return this},eq(){return this},order(){return this},limit(){return new Promise((resolve,reject)=>{window.reply=resolve;window.fail=reject})}};
   const client={from:()=>query};
  `});
  await page.addScriptTag({content:readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{document.querySelector('#history').onclick=()=>{window.request=showPendingHistory('fixture')}});
  await page.getByRole('button',{name:'History',exact:true}).click();
  assert.equal(await page.locator('section').innerText(),'Loading history…');
  if(scenario==='overlap'){
   await page.evaluate(()=>{window.oldReply=reply;window.oldRequest=window.request});
   await page.getByRole('button',{name:'History',exact:true}).click();
   await page.evaluate(async()=>{reply({data:[{action:'newer',created_at:'2026-10-06',expires_on:'2027-04-06'}]});await window.request;oldReply({error:{message:'Old response'}});await window.oldRequest});
   assert.match(await page.locator('section').innerText(),/newer/);assert.deepEqual(errors,[]);
   console.log('PASS pending history browser: '+scenario);await page.close();continue;
  }
  if(scenario.startsWith('cleared'))await page.evaluate(()=>{clearPendingStock();document.querySelector('section').textContent='New session';});
  if(scenario==='detached')await page.evaluate(()=>{document.querySelector('section').remove();document.body.insertAdjacentHTML('beforeend','<section data-pending-history-output="fixture">Replacement output</section>')});
  await page.evaluate(async scenario=>{
   if(scenario.includes('transport'))fail(Error('Fixture connection lost'));
   else if(scenario==='cleared-error')reply({error:{message:'Old server error'}});
   else reply({data:[{action:'created',actor_user_id:'first',created_at:'2026-10-01',expires_on:'2027-04-01',note:'<img src=x onerror=alert(1)>'}]});
   await window.request;
  },scenario);
  const text=await page.locator('section').innerText();
  if(scenario==='current'){assert.match(text,/Fixture Employee/);assert.match(text,/<img/);assert.equal(await page.locator('section img').count(),0)}
  else if(scenario==='transport')assert.equal(text,'History could not load: Fixture connection lost');
  else assert.equal(text,scenario==='detached'?'Replacement output':'New session');
  assert.deepEqual(errors,[]);console.log('PASS pending history browser: '+scenario);await page.close();
 }
}finally{await browser.close()}
