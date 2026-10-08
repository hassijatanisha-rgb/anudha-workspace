// Actual dialog and purchasing callback, fictional RPCs, blocked external traffic.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const actionSource=process.env.ACTION_FORMS_GIT_REF?execFileSync('git',['show',`${process.env.ACTION_FORMS_GIT_REF}:action-forms.js`],{encoding:'utf8'}):readFileSync(new URL('../action-forms.js',import.meta.url),'utf8');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const scenario of ['current','current-error','stale-before','stale-after','reopen-after-clear']){
  const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent('<main id="content"></main>');
  await page.addScriptTag({content:`let me={user_id:'first',role:'owner'},view='purchasing',calls=[],messages=[];const $=s=>document.querySelector(s),esc=s=>String(s??'');function message(s){messages.push(s)}const client={rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))};`});
  await page.addScriptTag({content:actionSource});
  await page.addScriptTag({content:readFileSync(new URL('../purchasing.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{purchaseRefreshOne=async()=>{};openPurchaseAction({id:'po',version:3,po_number:'PO123'},'approve')});
  if(scenario==='reopen-after-clear'){
   await page.evaluate(()=>{clearPurchasing();actionDialog.close();actionDialog.remove();me={user_id:'second',role:'owner'};openPurchaseAction({id:'po2',version:1,po_number:'PO124'},'approve')});
   assert.equal(await page.locator('#actionEditor').count(),1);
  }else{
   if(scenario==='stale-before')await page.evaluate(()=>{me={user_id:'second',role:'owner'}});
   await page.getByRole('button',{name:'Save',exact:true}).click();
   if(scenario==='stale-before')assert.equal(await page.evaluate(()=>calls.length),0);
   else{
    await page.waitForFunction(()=>calls.length===1);
    if(scenario==='stale-after')await page.evaluate(()=>{me={user_id:'first',role:'owner'};clearPurchasing()});
    await page.evaluate(scenario=>{calls[0].resolve(scenario==='current-error'?{error:{message:'Not permitted'}}:{data:{id:'po'}})},scenario);
    if(scenario==='current-error'){
     await page.getByRole('alert').filter({hasText:'Not permitted'}).waitFor();
     assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isEnabled(),true);
    }else await page.waitForFunction(()=>!actionDialog.open);
    assert.equal(await page.evaluate(()=>messages.length),scenario==='current'?1:0);
   }
  }
  console.log('PASS purchasing action browser: '+scenario);await page.close();
 }
}finally{await browser.close()}
