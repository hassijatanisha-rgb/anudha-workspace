import {workspacePageHeader} from './helpers/page-header.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const enabled=process.env.RETURN_CREDIT_BROWSER_QA==='1';
const source=readFileSync(new URL('../return-credit-posting.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const feedback=readFileSync(new URL('../action-feedback.js',import.meta.url),'utf8')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;'));
let browser;
before(async()=>{if(!enabled)return;const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/tanisha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});});
after(async()=>{await browser?.close();});
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set RETURN_CREDIT_BROWSER_QA=1 with local Playwright and Chrome'},fn);
async function fixture(){
 const page=await browser.newPage();page.setDefaultTimeout(4000);await page.route('**/*',route=>route.abort());await page.setContent('<div id="notice"></div><main id="content"><section id="accountingForm"></section></main>');
 await page.evaluate(()=>{
  let sequence=0;crypto.randomUUID=()=>`fixture-${++sequence}`;window.view='accounting';window.busy=false;window.$=selector=>document.querySelector(selector);window.me={user_id:'accounts'};window.rpcCalls=[];window.readCalls=[];window.mode='success';window.posted=null;window.messages=[];
  window.row={id:'draft',kind:'credit_note',version:1,organization_id:'org'};
  window.saved={body:{currency:'TZS',totalMinor:11804,source:{invoiceId:'invoice',returnId:'return',returnNumber:'<img src=x onerror=alert(1)>',taxInvoiceReference:'INV-1'},lines:[{proformaLineId:'line',quantityReturned:1,netMinor:10003,taxMinor:1801}]}};
  window.credit={id:'credit',draft_id:'draft',credit_number:'CN-1',credit_date:'2026-10-19',total_minor:11804};
  window.esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  window.companyDate=()=> '2026-10-19';window.clearBooks=()=>{};window.message=(text)=>messages.push(text);window.requireAccountingAccess=async()=> 'accounts';
  window.client={from(table){const q={select(){return q;},eq(){return q;},async maybeSingle(){readCalls.push(table);return {data:table==='accounting_draft_history'?saved:posted};}};return q;},async rpc(name,args){rpcCalls.push({name,args:structuredClone(args)});if(mode==='lost')throw Error('Offline');if(mode==='recover'){posted=credit;throw Error('Lost response');}if(mode==='deferred')return new Promise(resolve=>window.resolvePost=resolve);if(mode==='denied')return {error:{code:'P0001',message:'Books locked'}};posted=credit;return {data:credit};}};
 });
 await page.addStyleTag({content:':root{--m-base:200ms;--m-slow:300ms;--m-fade:150ms;--ease-in:ease-out;--ease-out:ease-out}'});await page.addScriptTag({content:readFileSync(new URL('../ui-dialogs.js',import.meta.url),'utf8')});await page.addScriptTag({content:feedback});await page.addScriptTag({content:source});return page;
}
acceptance('review shows exact immutable amounts, escapes source text and does not post',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>openReturnCreditPosting(row));await assert.equal(await page.locator('dialog').count(),1);
  assert.match(await page.locator('dialog').innerText(),/100\.03[\s\S]*18\.01[\s\S]*118\.04/);
  assert.equal(await page.locator('dialog img').count(),0);assert.equal(await page.evaluate(()=>rpcCalls.length),0);
  await page.getByRole('button',{name:'Post credit to books'}).click();await page.getByText('CN-1 posted',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>rpcCalls.length),1);assert.match(await page.locator('dialog').innerText(),/no refund was issued/);
 }finally{await page.close();}
});
acceptance('unknown outcome blocks leaving and retries the exact request identity and date',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>{mode='lost';return openReturnCreditPosting(row);});await page.getByRole('button',{name:'Post credit to books'}).click();
  await page.getByRole('button',{name:'Retry same credit'}).waitFor();assert.equal(await page.evaluate(()=>returnCreditPostingConfirmLeave()),false);
  assert.equal(await page.locator('input[name=date]').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
  await page.evaluate(()=>mode='success');await page.getByRole('button',{name:'Retry same credit'}).click();await page.getByText('CN-1 posted',{exact:true}).waitFor();
  const calls=await page.evaluate(()=>rpcCalls);assert.deepEqual(calls[0].args,calls[1].args);assert.equal(await page.evaluate(()=>returnCreditPostingConfirmLeave()),true);
 }finally{await page.close();}
});
acceptance('lost response reconciles by saved draft without creating a second posting',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>{mode='recover';return openReturnCreditPosting(row);});await page.getByRole('button',{name:'Post credit to books'}).click();await page.getByText('CN-1 posted',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>rpcCalls.length),1);assert.equal(await page.evaluate(()=>readCalls.filter(x=>x==='acc_credit_notes').length),2);
 }finally{await page.close();}
});
acceptance('existing posted draft opens its immutable receipt without a post action',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>{posted=credit;return openReturnCreditPosting(row);});assert.equal(await page.locator('dialog form').count(),0);assert.match(await page.locator('dialog').innerText(),/CN-1 posted/);assert.equal(await page.evaluate(()=>rpcCalls.length),0);
 }finally{await page.close();}
});
acceptance('cleared session discards pending state and late results cannot recreate UI',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>{mode='deferred';return openReturnCreditPosting(row);});await page.getByRole('button',{name:'Post credit to books'}).click();
  await page.waitForFunction(()=>typeof resolvePost==='function');await page.evaluate(()=>{clearReturnCreditPosting();me={user_id:'other'};resolvePost({data:credit});});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.evaluate(()=>returnCreditPostingConfirmLeave()),true);
 }finally{await page.close();}
});
acceptance('confirmed validation rejection permits correction; unlinked or corrupt allocation rejects',async()=>{
 const page=await fixture();try{
  await page.evaluate(()=>{mode='denied';return openReturnCreditPosting(row);});await page.getByRole('button',{name:'Post credit to books'}).click();await page.getByText('Not posted: Books locked',{exact:true}).waitFor();assert.equal(await page.locator('input[name=date]').isDisabled(),false);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});
  const errors=await page.evaluate(async()=>{const out=[];for(const mutate of [()=>saved.body.source.invoiceId=null,()=>{saved.body.source.invoiceId='invoice';saved.body.lines[0].netMinor=0.5;}]){mutate();try{await openReturnCreditPosting(row);}catch(error){out.push(error.message);}}return out;});
  assert.match(errors[0],/linked to an ERP invoice/);assert.match(errors[1],/Accounts review/);assert.equal(await page.locator('dialog').count(),0);
 }finally{await page.close();}
});
acceptance('late review cannot reopen after navigation and duplicate fast opens produce one dialog',async()=>{
 const page=await fixture();try{
  const count=await page.evaluate(async()=>{
   let release;requireAccountingAccess=()=>new Promise(resolve=>release=resolve);
   const old=openReturnCreditPosting(row);view='dashboard';document.querySelector('#accountingForm').remove();view='accounting';
   document.querySelector('#content').innerHTML='<section id="accountingForm"></section>';release('accounts');await old;
   const afterNavigation=document.querySelectorAll('dialog').length;
   const releases=[];requireAccountingAccess=()=>new Promise(resolve=>releases.push(resolve));
   const first=openReturnCreditPosting(row),second=openReturnCreditPosting(row);releases.forEach(resolve=>resolve('accounts'));await Promise.all([first,second]);
   return [afterNavigation,document.querySelectorAll('dialog').length];
  });assert.deepEqual(count,[0,1]);
 }finally{await page.close();}
});

test('saved allocation validates integer minor units and exact total before any posting',()=>{
 const c=vm.createContext({workspacePageHeader,Number,String,Error});vm.runInContext(source,c);
 const saved={body:{currency:'TZS',totalMinor:11804,source:{invoiceId:'inv',returnId:'ret'},lines:[{proformaLineId:'line',quantityReturned:1,netMinor:10003,taxMinor:1801}]}};
 assert.equal(c.returnCreditPostingSnapshot(saved).total,11804);assert.equal(c.returnCreditPostingMoney(11804),'118.04');
 for(const change of [()=>saved.body.lines[0].netMinor=0.1,()=>saved.body.lines[0].netMinor=-1,()=>saved.body.lines[0].netMinor=Number.MAX_SAFE_INTEGER+1]){change();assert.throws(()=>c.returnCreditPostingSnapshot(saved),/Accounts review/);}
 saved.body.lines[0].netMinor=10003;saved.body.totalMinor=11803;assert.throws(()=>c.returnCreditPostingSnapshot(saved),/does not balance/);
 saved.body.source.invoiceId=null;assert.throws(()=>c.returnCreditPostingSnapshot(saved),/linked to an ERP invoice/);
});
