import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture({included=false,recordError=false,lineError=false}={}){
 const calls=[],record={id:'older-saved',document_number:'PF-OLD',revision:4},line={id:'older-line',proforma_id:'older-saved',sort_order:0};
 const ctx=vm.createContext({inventoryLoaded:true,me:{user_id:'one'},view:'sales',client:{from(table){
  let filter=null;
  const query={select(){return this},order(){return this},limit(){return this},eq(key,value){filter=[key,value];calls.push([table,key,value]);return this},single(){return Promise.resolve(recordError?{error:{message:'Saved record unavailable'}}:{data:record})},then(resolve,reject){
   const result=table==='sales_proformas'?{data:included?[record]:Array.from({length:200},(_,i)=>({id:`recent-${i}`}))}:table==='sales_proforma_lines'&&filter?(lineError?{error:{message:'Saved lines unavailable'}}:{data:[line]}):{data:[]};
   return Promise.resolve(result).then(resolve,reject);
  }};
  return query;
 }}});
 vm.runInContext(readFileSync(new URL('../sales-delivery.js',import.meta.url),'utf8'),ctx);
 vm.runInContext("salesFocusedProforma='older-saved'",ctx);
 return {ctx,calls,state:()=>vm.runInContext('({salesLoaded,salesLoadError,salesProformas,salesProformaLines})',ctx)};
}
test('focused saved proforma outside latest 200 loads persisted record and its lines',async()=>{
 const f=fixture();await f.ctx.loadSalesDelivery();const state=f.state();
 assert.equal(state.salesLoaded,true);assert.ok(state.salesProformas.some(row=>row.id==='older-saved'));
 assert.ok(state.salesProformaLines.some(row=>row.id==='older-line'));
 assert.ok(f.calls.some(([table,key,value])=>table==='sales_proformas'&&key==='id'&&value==='older-saved'));
 assert.ok(f.calls.some(([table,key,value])=>table==='sales_proforma_lines'&&key==='proforma_id'&&value==='older-saved'));
});
test('focused record query failure is surfaced rather than hiding missing record',async()=>{
 const f=fixture({recordError:true});await f.ctx.loadSalesDelivery();const state=f.state();
 assert.equal(state.salesLoaded,false);assert.match(state.salesLoadError,/Saved record unavailable/);
});
test('focused line query failure prevents incomplete saved record display',async()=>{
 const f=fixture({lineError:true});await f.ctx.loadSalesDelivery();const state=f.state();
 assert.equal(state.salesLoaded,false);assert.match(state.salesLoadError,/Saved lines unavailable/);
});
test('focused record already in latest page is not duplicated',async()=>{
 const f=fixture({included:true});await f.ctx.loadSalesDelivery();
 assert.equal(f.state().salesProformas.filter(row=>row.id==='older-saved').length,1);
});
