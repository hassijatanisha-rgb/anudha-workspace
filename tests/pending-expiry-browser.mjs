// Disposable renderer fixture only: no live Supabase access or writes.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();await page.setContent('<main></main>');
 await page.addScriptTag({content:`const me={user_id:'staff',role:'staff'},products=[{id:'p1',name:'Fixture bags'}],orgIndex=new Map([['org',{name:'Fixture hospital'}]]),salesProformas=[];const employeeName=()=> 'Fixture employee';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');`});
 await page.addScriptTag({content:readFileSync(new URL('../pending-stock.js',import.meta.url),'utf8')});
 await page.evaluate(()=>{
  const lot={product_id:'p1',location_id:'main',pack_definition_id:'box',sealed_cartons:1,loose_units:0,reserved_units:0,stock_status:'available'};
  pendingAvailability=pendingAvailableByProduct(['2026-09-30','2026-10-01','2026-10-02'].map(expiry_date=>({...lot,expiry_date})),[{id:'box',units_per_carton:10}],[{id:'main',active:true}],'2026-10-01');
  const row={id:'r',request_number:'PS-FIXTURE',product_id:'p1',quantity:20,status:'waiting',organization_id:'org',salesperson_user_id:'staff',expires_on:'2099-01-01',extension_count:0};
  const state=pendingStockState(row,pendingAvailability.get('p1'),'2026-10-01');
  document.querySelector('main').innerHTML=pendingCard({row,state});
 });
 await page.getByText('Partly available: 10 of 20 — reconfirm with the customer',{exact:true}).waitFor();
 assert.equal(await page.getByText(/Stock arrived:/).count(),0);
 assert.equal(await page.getByText('Fixture bags · 20 pcs',{exact:true}).count(),1);
 await page.evaluate(()=>{
  document.querySelector('main').id='content';window.$=s=>document.querySelector(s);bindPendingStock=()=>{};
  pendingToday=()=> '2026-10-02';pendingAvailabilityDay='2026-10-01';pendingAvailability=new Map([['p1',50]]);
  pendingRows=[{id:'r',request_number:'PS-FIXTURE',product_id:'p1',quantity:20,status:'waiting',organization_id:'org',salesperson_user_id:'staff',expires_on:'2099-01-01',extension_count:0}];
  renderPendingStock();
 });
 await page.getByRole('alert').filter({hasText:'previous day. Press Refresh'}).waitFor();
 await page.getByText('Stock check unavailable',{exact:true}).waitFor();
 assert.equal(await page.getByText(/Stock has arrived for|Stock arrived: 50/).count(),0);
 console.log('PASS: rendered pending card reports only unexpired pieces and marks prior-day availability unavailable on render. Fixture only.');
}finally{await browser.close();}
