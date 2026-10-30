import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(){
 const calls=[],messages=[],pending=[];let sequence=0,renders=0,close;
 const controls={'#countRefresh':{},'#countCancel':{addEventListener(event,fn){close=fn;}}};
 const ctx=vm.createContext({me:{user_id:'actor'},view:'stockcount',crypto:{randomUUID:()=>`count-${++sequence}`},
  FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}},
  $:selector=>controls[selector]||null,document:{querySelectorAll:()=>[]},message:text=>messages.push(text),
  client:{rpc:(name,args)=>{assert.equal(name,'record_stock_count');calls.push(args);return new Promise((resolve,reject)=>pending.push({resolve,reject,args}));}}});
 vm.runInContext(readFileSync(new URL('../stock-count.js',import.meta.url),'utf8'),ctx);
 vm.runInContext("countSessions=[{id:'session',status:'open'}];countGodown='Haadi';countPicked='AN-00001';countCatalogue=[{code:'AN-00001',product:'Product one'},{code:'AN-00002',product:'Product two'}]",ctx);
 ctx.renderStockCount=()=>{renders++;};ctx.bindStockCount();
 const form=(quantity='1.001')=>({dataset:{},isConnected:true,values:{quantity,unit:'KG',condition:'good',batch:'',notes:''}});
 const finish=(index=0)=>{const {args,resolve}=pending[index];resolve({data:{id:args.p_id,session_id:args.p_session_id,code:args.p_code,quantity:args.p_quantity,unit:args.p_unit,godown:args.p_godown}});};
 return {ctx,calls,messages,pending,form,finish,close:form=>{form.isConnected=false;controls['#countCancel'].onclick();},run:code=>vm.runInContext(code,ctx),get renders(){return renders;}};
}

test('stock quantities accept exact thousandths, zero and the inclusive maximum',()=>{
 const f=fixture();for(const text of ['0','0.001','1.001','1.005','1.230','9999999.999','10000000','10000000.000']){
  const values=f.ctx.countFormValues(f.form(text));assert.equal(values.quantity,Number(text),text);assert.equal(values.unit,'KG');
 }
});
test('stock quantities reject excess precision, negative values, invalid notation and amounts above the limit',()=>{
 const f=fixture();for(const text of ['0.0001','1.0000','-1','-0.001','10000000.001','10000001','99999999999999999','',' ','Infinity','NaN','1e3'])assert.throws(()=>f.ctx.countFormValues(f.form(text)),undefined,text);
});
test('count save passes accepted fractional quantity unchanged to the RPC',async()=>{
 const f=fixture(),saving=f.ctx.saveCountForm(f.form());assert.equal(f.calls[0].p_quantity,1.001);f.finish();await saving;
 assert.equal(f.run('countEntries[0].quantity'),1.001);assert.equal(f.run('countPicked'),'');assert.equal(f.run('countPendingSave'),null);
});
test('closing a pending count still records its confirmation in the cache',async()=>{
 const f=fixture(),form=f.form(),saving=f.ctx.saveCountForm(form);f.close(form);
 assert.equal(f.run('countPendingSave'),null);f.finish();await saving;
 assert.equal(f.run('countEntries.length'),1);assert.equal(f.run('countEntries[0].id'),f.calls[0].p_id);assert.equal(f.messages.length,1);
});
test('an earlier pending count cannot clear a newer draft or its retry identity',async()=>{
 const f=fixture(),older=f.form(),oldSave=f.ctx.saveCountForm(older);f.close(older);
 f.run("countPicked='AN-00002';countSearch='Product two'");const newer=f.form('2'),newSave=f.ctx.saveCountForm(newer),newId=f.calls[1].p_id;
 const before=f.renders;f.finish(0);await oldSave;
 assert.equal(f.run('countEntries[0].id'),f.calls[0].p_id);assert.equal(f.run('countPicked'),'AN-00002');assert.equal(f.run('countSearch'),'Product two');
 assert.equal(f.run('countPendingSave.id'),newId);assert.equal(f.renders,before);assert.equal(f.messages.length,0);
 f.finish(1);await newSave;assert.equal(f.run('countEntries.length'),2);assert.equal(f.run('countPicked'),'');assert.equal(f.messages.length,1);
});
test('unchanged count retries keep the same ID after an uncertain response',async()=>{
 const f=fixture(),form=f.form(),first=f.ctx.saveCountForm(form);f.pending[0].reject(Error('Response lost'));await assert.rejects(first,/Response lost/);
 const retry=f.ctx.saveCountForm(form);assert.equal(f.calls[1].p_id,f.calls[0].p_id);f.finish(1);await retry;assert.equal(f.run('countEntries.length'),1);
});
test('unexpected saved identity preserves the current draft and retry ID',async()=>{
 const f=fixture(),form=f.form(),saving=f.ctx.saveCountForm(form);f.pending[0].resolve({data:{id:'different'}});await assert.rejects(saving,/did not confirm/);
 assert.equal(f.run('countEntries.length'),0);assert.equal(f.run('countPicked'),'AN-00001');assert.equal(f.run('countPendingSave.id'),f.calls[0].p_id);
});
for(const change of ['actor','clear'])test(`${change} invalidates a pending count response`,async()=>{
 const f=fixture(),saving=f.ctx.saveCountForm(f.form());if(change==='actor')f.ctx.me={user_id:'actor'};else f.ctx.clearStockCount();
 f.finish();await saving;assert.equal(f.run('countEntries.length'),0);assert.equal(f.renders,0);assert.equal(f.messages.length,0);
});
test('leaving the count page allows cache confirmation without repainting the new page',async()=>{
 const f=fixture(),form=f.form(),saving=f.ctx.saveCountForm(form);f.ctx.view='personal';form.isConnected=false;f.finish();await saving;
 assert.equal(f.run('countEntries.length'),1);assert.equal(f.renders,0);assert.equal(f.messages.length,0);
});
