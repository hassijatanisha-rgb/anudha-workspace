import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(kind){
 const form={dataset:{id:'record',version:'1'},isConnected:true,fields:{name:'Fixture supplier'}},calls=[],messages=[];let sequence=0;
 const context=vm.createContext({me:{user_id:'first'},view:'purchasing',activeForm:form,$:()=>context.activeForm,crypto:{randomUUID:()=>`fixture-${++sequence}`},message:s=>messages.push(s),FormData:class{get(k){return form.fields[k]||''}has(){return false}},client:{rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))}});
 vm.runInContext(readFileSync(new URL('../purchasing.js',import.meta.url),'utf8'),context);
 vm.runInContext("purchaseFormValues=()=>({lines:[],notes:''});purchaseRefreshOne=async()=>{};purchasingWorkspace=async()=>{}",context);
 return {context,form,calls,messages,get:code=>vm.runInContext(code,context),save:()=>kind==='purchase'?context.savePurchaseForm(form):context.saveSupplierForm(form)};
}
for(const [kind,field] of [['purchase','notes'],['supplier','name'],['supplier','phone']]){
 test(`${kind} changed ${field} after uncertain save cannot send a different request`,async()=>{
  const f=fixture(kind);f.form.dataset={id:'',version:'0'};
  const first=f.save();f.calls[0].reject(Error('Response lost'));await assert.rejects(first,/Response lost/);
  const originalId=f.calls[0].args.p_id;
  if(kind==='purchase')f.get("purchaseFormValues=()=>({lines:[],notes:'Changed'})");else f.form.fields[field]='Changed';
  const retry=f.save();
  if(f.calls[1])f.calls[1].resolve({data:{id:f.calls[1].args.p_id,name:'Fixture',po_number:'PO123'}});
  await assert.rejects(retry,/previous save is unconfirmed/i);
  assert.equal(f.calls.length,1);assert.equal(f.messages.length,0);
  assert.equal(f.get(kind==='purchase'?'purchasePendingSave.id':'supplierPendingSave.id'),originalId);
 });
}
for(const kind of ['purchase','supplier']){
 test(`${kind} editor reset guard blocks uncertainty but not a confirmed rejection`,async()=>{
  const f=fixture(kind);f.form.dataset={id:'',version:'0'};
  const first=f.save();assert.equal(f.context.purchasingResetBlocked(kind),true);assert.match(f.form.textContent,/still saving/);
  f.calls[0].reject(Error('Response lost'));await assert.rejects(first,/Response lost/);
  assert.equal(f.get(kind==='purchase'?'purchasePendingSave.inFlight':'supplierPendingSave.inFlight'),false);
  assert.equal(f.context.purchasingResetBlocked(kind),true);
  assert.match(f.form.textContent,/unconfirmed/);
  const retry=f.save();f.calls[1].resolve({error:{code:'P0001',message:'Validation rejected'}});await assert.rejects(retry,/Validation rejected/);
  // A rejected retry does not prove the original lost-response write was rolled back.
  assert.equal(f.context.purchasingResetBlocked(kind),true);
  const clean=fixture(kind);clean.form.dataset={id:'',version:'0'};
  const rejected=clean.save();clean.calls[0].resolve({error:{code:'P0001',message:'Validation rejected'}});await assert.rejects(rejected,/Validation rejected/);
  assert.equal(clean.context.purchasingResetBlocked(kind),false);
 });
 if(kind==='purchase')test('pending-order purchase shortcut cannot erase an uncertain request',async()=>{
  const f=fixture(kind);f.form.dataset={id:'',version:'0'};
  const first=f.save();f.calls[0].reject(Error('Response lost'));await assert.rejects(first,/Response lost/);
  const before=f.get('JSON.stringify(purchasePendingSave)');
  f.context.startPurchaseFromPending({id:'pending',product_id:'product',quantity:3,request_number:'P1'});
  assert.equal(f.get('JSON.stringify(purchasePendingSave)'),before);assert.equal(f.get('purchasePrefill'),null);
 });
 test(`${kind} confirmed form cannot resubmit while awaiting list recovery`,async()=>{
  const f=fixture(kind);f.form.dataset={id:'',version:'0'};
  const first=f.save();f.calls[0].resolve({data:{id:f.calls[0].args.p_id,name:'Fixture',po_number:'PO123'}});await first;
  await assert.rejects(f.save(),/already saved/);assert.equal(f.calls.length,1);
 });
 for(const code of ['', 'P0001','40003','08007'])test(`${kind} returned ${code||'network'} error distinguishes uncertain save from database rejection`,async()=>{
  const f=fixture(kind);f.form.dataset={id:'',version:'0'};
  const first=f.save();f.calls[0].resolve({error:{code,message:'Save failed'}});await assert.rejects(first,/Save failed/);
  if(kind==='purchase')f.get("purchaseFormValues=()=>({lines:[],notes:'Corrected'})");else f.form.fields.phone='Corrected';
  const retry=f.save();
  if(f.calls[1])f.calls[1].resolve({data:{id:f.calls[1].args.p_id,name:'Fixture',po_number:'PO123'}});
  if(code==='P0001'){await retry;assert.equal(f.calls.length,2);assert.equal(f.messages.length,1)}
  else{await assert.rejects(retry,/previous save is unconfirmed/i);assert.equal(f.calls.length,1)}
 });
 test(`${kind} current save confirms once`,async()=>{const f=fixture(kind),p=f.save();f.calls[0].resolve({data:{id:'record',name:'Fixture',po_number:'PO123'}});await p;assert.equal(f.messages.length,1)});
 test(`${kind} replacement form cannot receive old success`,async()=>{const f=fixture(kind),p=f.save();f.context.activeForm={};f.form.isConnected=false;f.calls[0].resolve({data:{id:'record',name:'Fixture',po_number:'PO123'}});await p;assert.equal(f.messages.length,0)});
 test(`${kind} same-ID session replacement cannot receive success`,async()=>{const f=fixture(kind),p=f.save();f.context.me={user_id:'first'};f.calls[0].resolve({data:{id:'record',name:'Fixture',po_number:'PO123'}});await p;assert.equal(f.messages.length,0)});
 test(`${kind} obsolete transport error ignored after clear`,async()=>{const f=fixture(kind),p=f.save();f.context.clearPurchasing();f.calls[0].reject(Error('Old failure'));await assert.doesNotReject(p)});
 test(`${kind} unchanged new form retry retains exact request after lost response`,async()=>{
  const f=fixture(kind);f.form.dataset={id:'',version:'0'};
  const first=f.save();f.calls[0].reject(Error('Response lost'));await assert.rejects(first,/Response lost/);
  const second=f.save();assert.deepEqual(f.calls[1].args,f.calls[0].args);
  f.calls[1].resolve({data:{id:f.calls[1].args.p_id,name:'Fixture',po_number:'PO123'}});await second;
  assert.equal(f.messages.length,1);assert.equal(f.get(kind==='purchase'?'purchasePendingSave':'supplierPendingSave'),null);
 });
 test(`${kind} wrong response ID cannot confirm or clear retry ID`,async()=>{
  const f=fixture(kind);f.form.dataset={id:'',version:'0'};
  const first=f.save(),id=f.calls[0].args.p_id;f.calls[0].resolve({data:{id:'wrong'}});
  await assert.rejects(first,/did not confirm/);assert.equal(f.messages.length,0);
  assert.equal(f.get(kind==='purchase'?'purchasePendingSave.id':'supplierPendingSave.id'),id);
 });
 test(`${kind} old save cannot erase next form retry state`,async()=>{
  const f=fixture(kind),first=f.save();f.context.activeForm={};f.form.isConnected=false;
  f.get(kind==='purchase'?"purchasePendingSave={id:'next'};purchaseEditing='new'":"supplierPendingSave={id:'next'};supplierEditing='new'");
  f.calls[0].resolve({data:{id:'record',name:'Fixture',po_number:'PO123'}});await first;
  assert.equal(f.get(kind==='purchase'?'purchasePendingSave.id':'supplierPendingSave.id'),'next');
  assert.equal(f.get(kind==='purchase'?'purchaseEditing':'supplierEditing'),'new');assert.equal(f.messages.length,0);
 });
}
