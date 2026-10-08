// Actual renderers/forms/bindings with fictional RPCs; external traffic blocked.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
try{
 for(const kind of ['purchase','supplier'])for(const scenario of ['retry','replacement','uncertain-transport','uncertain-response','editor-reset','in-flight-reset',...(kind==='purchase'?['refresh-error-replacement','refresh-error-same-form']:[])]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent('<main id="content"></main>');
  await page.addScriptTag({content:`
   let me={user_id:'first',role:'owner'},view='purchasing',calls=[],messages=[],failures=[],refreshCalls=[],deferRefresh=false,products=[{id:'product',name:'Fixture product'}],seq=0,settled=0;
   crypto.randomUUID=()=> 'fixture-'+(++seq);
   const $=s=>document.querySelector(s),esc=s=>String(s??'');
   function message(s){messages.push(s)}function syncWorkspaceNavigation(){}
   function run(fn){return Promise.resolve().then(fn).catch(e=>failures.push(e.message)).finally(()=>settled++)}
   function inventoryOption(id,label,selected){return '<option value="'+id+'" '+(selected?'selected':'')+'>'+label+'</option>'}
   function salesProductChoices(){return '<option value="Fixture product"></option>'}
   function inventoryProductFromChoice(value){return products.find(p=>p.name===value)}
   function all(){return Promise.resolve([])}
   const query={select(){return this},eq(){return this},maybeSingle(){return deferRefresh?new Promise((resolve,reject)=>refreshCalls.push({resolve,reject})):Promise.resolve({data:null})}};
   const client={from:()=>query,rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))};
  `});
  await page.addScriptTag({content:readFileSync(new URL('../purchasing.js',import.meta.url),'utf8')});
  await page.evaluate(kind=>{purchaseLoaded=true;suppliers=[{id:'supplier',name:'Fixture supplier',active:true}];purchaseSection=kind==='purchase'?'orders':'suppliers';if(kind==='purchase')purchaseEditing='new';else supplierEditing='new';renderPurchasing()},kind);
  const form=page.locator(kind==='purchase'?'#purchaseForm':'#supplierForm');
  if(kind==='purchase'){await form.locator('[name="supplierId"]').selectOption('supplier');await form.locator('[name="productChoice"]').fill('Fixture product');await form.locator('[name="quantity"]').fill('5')}
  else await form.locator('[name="name"]').fill('Fixture supplier');
  await form.locator('[type="submit"]').click();await page.waitForFunction(()=>calls.length===1);
  assert.equal(await form.locator('[type="submit"]').isDisabled(),true);
  if(scenario==='in-flight-reset'){
   await page.locator(kind==='purchase'?'#closePurchaseEditor':'#closeSupplierEditor').click();
   assert.equal(await form.count(),1,'in-flight save must retain its editor');
   await page.locator(kind==='purchase'?'#newPurchase':'#newSupplier').click();
   assert.equal(await form.locator(kind==='purchase'?'[name="quantity"]':'[name="name"]').inputValue(),kind==='purchase'?'5':'Fixture supplier');
   await form.getByRole('alert').filter({hasText:'still saving'}).waitFor();
   await page.evaluate(()=>calls[0].resolve({error:{code:'P0001',message:'Validation rejected'}}));
   await page.waitForFunction(()=>settled===1);
   await page.locator(kind==='purchase'?'#closePurchaseEditor':'#closeSupplierEditor').click();
   assert.equal(await form.count(),0,'confirmed rejection releases in-flight editor guard');
  }else if(scenario==='editor-reset'){
   await page.evaluate(()=>calls[0].reject(Error('Response lost')));
   await page.waitForFunction(()=>settled===1);
   await page.locator(kind==='purchase'?'#closePurchaseEditor':'#closeSupplierEditor').click();
   assert.equal(await form.count(),1,'uncertain save must retain its editor and retry identity');
   await page.locator(kind==='purchase'?'#newPurchase':'#newSupplier').click();
   assert.equal(await form.locator(kind==='purchase'?'[name="quantity"]':'[name="name"]').inputValue(),kind==='purchase'?'5':'Fixture supplier');
   await form.getByRole('alert').filter({hasText:'unconfirmed'}).waitFor();
   await form.locator('[type="submit"]').click();await page.waitForFunction(()=>calls.length===2);
   assert.equal(await page.evaluate(()=>JSON.stringify(calls[0].args)===JSON.stringify(calls[1].args)),true);
   await page.evaluate(()=>calls[1].resolve({data:{id:calls[1].args.p_id,name:'Fixture supplier',po_number:'PO123'}}));
   await page.waitForFunction(()=>settled===2);
  }else if(scenario==='refresh-error-same-form'){
   await page.evaluate(()=>{deferRefresh=true;calls[0].resolve({data:{id:calls[0].args.p_id,po_number:'PO123',version:1}})});
   await page.waitForFunction(()=>refreshCalls.length===1);
   await page.evaluate(()=>refreshCalls[0].reject(Error('Refresh unavailable')));
   await page.waitForFunction(()=>settled===1);
   await form.locator('[type="submit"]').click();
   assert.equal(await page.evaluate(()=>calls.length),1,'confirmed save must not send another create after refresh failure');
   await form.getByRole('alert').filter({hasText:'already saved'}).waitFor();
  }else if(scenario==='refresh-error-replacement'){
   await page.evaluate(()=>{deferRefresh=true;calls[0].resolve({data:{id:calls[0].args.p_id,po_number:'PO123',version:1}})});
   await page.waitForFunction(()=>refreshCalls.length===1);
   await page.locator('#newPurchase').click();await form.locator('[name="productChoice"]').fill('Keep replacement');
   await page.evaluate(()=>refreshCalls[0].reject(Error('Old refresh failed')));
   await page.waitForFunction(()=>settled===1);
   assert.equal(await form.locator('[name="productChoice"]').inputValue(),'Keep replacement');
   assert.equal(await form.getByRole('alert').textContent(),'');
   assert.deepEqual(await page.evaluate(()=>failures),[]);
  }else if(scenario==='retry'){
   await page.evaluate(()=>calls[0].reject(Error('Response lost')));
   await form.getByRole('alert').filter({hasText:'Response lost'}).waitFor();
   await form.locator('[type="submit"]').click();await page.waitForFunction(()=>calls.length===2);
   assert.equal(await page.evaluate(()=>JSON.stringify(calls[0].args)===JSON.stringify(calls[1].args)),true);
   await page.evaluate(()=>calls[1].resolve({data:{id:calls[1].args.p_id,name:'Fixture supplier',po_number:'PO123'}}));
   await page.waitForFunction(()=>messages.length===1);
   assert.equal(await form.count(),0);
  }else if(scenario.startsWith('uncertain-')){
   await page.evaluate(scenario=>scenario==='uncertain-transport'?calls[0].reject(Error('Response lost')):calls[0].resolve({error:{code:'',message:'Response lost'}}),scenario);
   await page.waitForFunction(()=>settled===1);
   const field=form.locator(kind==='purchase'?'[name="quantity"]':'[name="phone"]'),original=await field.inputValue();
   await field.fill(kind==='purchase'?'7':'12345');await form.locator('[type="submit"]').click();
   await form.getByRole('alert').filter({hasText:'The previous save is unconfirmed'}).waitFor();
   await page.waitForFunction(()=>settled===2);
   assert.equal(await page.evaluate(()=>calls.length),1);assert.equal(await page.evaluate(()=>messages.length),0);
   assert.equal(await form.locator('[type="submit"]').isDisabled(),false);
   await field.fill(original);await form.locator('[type="submit"]').click();await page.waitForFunction(()=>calls.length===2);
   assert.equal(await page.evaluate(()=>JSON.stringify(calls[0].args)===JSON.stringify(calls[1].args)),true);
   await page.evaluate(()=>calls[1].resolve({data:{id:calls[1].args.p_id,name:'Fixture supplier',po_number:'PO123'}}));
   await page.waitForFunction(()=>settled===3);
   assert.equal(await page.evaluate(()=>messages.length),1);assert.equal(await form.count(),0);
  }else{
   // A route refresh can replace the DOM independently of editor reset controls.
   await page.evaluate(()=>renderPurchasing());
   const field=form.locator(kind==='purchase'?'[name="productChoice"]':'[name="name"]');await field.fill('Keep this draft');
   await page.evaluate(()=>calls[0].resolve({data:{id:calls[0].args.p_id,name:'Old supplier',po_number:'OLD'}}));
   await page.waitForFunction(()=>settled===1);
   assert.equal(await field.inputValue(),'Keep this draft');assert.equal(await page.evaluate(()=>messages.length),0);
  }
  assert.deepEqual(errors,[]);console.log('PASS purchasing save '+kind+': '+scenario);await page.close();
 }
}finally{await browser.close()}
