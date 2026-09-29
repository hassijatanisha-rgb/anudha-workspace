import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const script=readFileSync(new URL('../employee-names.js',import.meta.url),'utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/names.js'?'text/javascript':'text/html');res.end(req.url==='/names.js'?script:'<!doctype html><html><body><main id="result"></main><script src="/names.js"></script></body></html>');});
let browser;
try{
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 await page.evaluate(()=>{
  window.me={user_id:'fictional-owner',role:'owner'};window.view='staff';window.calls=[];window.savedName='';
  window.message=s=>document.querySelector('#result').textContent=s;window.staff=async()=>{};
  window.client={rpc:async(name,args)=>{window.calls.push({name,args});if(name==='lookup_staff_display_name')return {data:{user_id:'fictional-staff',name_version:2}};if(name==='set_staff_display_name'){window.savedName=args.p_display_name;return {data:{}};}return {data:{items:[{user_id:'fictional-staff',display_name:window.savedName}],next_after_id:null}};}};
  openEmployeeNameEditor();
 });
 await page.getByRole('textbox',{name:'Existing staff email'}).fill('fixture@example.invalid');await page.getByRole('textbox',{name:'Employee name',exact:true}).fill('Fatima');await page.getByRole('button',{name:'Save name',exact:true}).click();
 await page.getByText('Employee name saved.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>employeeName('fictional-staff')),'Fatima');
 assert.equal(await page.evaluate(()=>window.calls[1].args.p_expected_version),2);
 await page.locator('dialog').waitFor({state:'detached'});
 await page.evaluate(()=>{openEmployeeNameEditor();});await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.locator('dialog').count(),0);
 await page.evaluate(()=>{clearEmployeeNames();window.me={user_id:'another',role:'staff'};openEmployeeNameEditor();});assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.evaluate(()=>employeeName('fictional-staff')),'Employee name not set');assert.deepEqual(errors,[]);
 console.log('PASS: isolated browser owner name form, lookup/versioned save, directory refresh, cancel, staff denial and session clearing; no live data.');
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
