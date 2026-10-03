import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Fake backend: every query honours eq/in filters and range paging with the server's 1,000-row cap.
function fixture({included=false,recordError=false,lineError=false,lines=null}={}){
 const calls=[],record={id:'older-saved',document_number:'PF-OLD',revision:4};
 const recent=included?[record]:Array.from({length:200},(_,i)=>({id:`recent-${i}`}));
 const allLines=lines||[{id:'older-line',proforma_id:'older-saved',sort_order:0},{id:'recent-line',proforma_id:'recent-0',sort_order:0}];
 const ctx=vm.createContext({inventoryLoaded:true,me:{user_id:'one'},view:'sales',client:{from(table){
  let eq=null,inn=null,range=[0,999];
  const query={select(){return this},order(){return this},limit(){return this},
   eq(key,value){eq=[key,value];calls.push([table,'eq',key,value]);return this},
   in(key,values){inn=[key,values];calls.push([table,'in',key,values.length]);return this},
   range(a,b){range=[a,b];return this},
   single(){return Promise.resolve(recordError?{error:{message:'Saved record unavailable'}}:{data:record})},
   then(resolve,reject){
    let result={data:[]};
    if(table==='sales_proformas')result={data:recent};
    if(table==='sales_proforma_lines'){if(lineError)result={error:{message:'Saved lines unavailable'}};else{const rows=allLines.filter(l=>!inn||inn[1].includes(l.proforma_id));result={data:rows.slice(range[0],Math.min(range[1]+1,range[0]+1000))};}}
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
 assert.ok(f.calls.some(([table,kind,key,value])=>table==='sales_proformas'&&kind==='eq'&&value==='older-saved'));
 assert.ok(f.calls.every(([table,kind])=>table!=='sales_proforma_lines'||kind==='in'),'lines are only ever loaded for listed Pro formas');
});
test('focused record query failure is surfaced rather than hiding missing record',async()=>{
 const f=fixture({recordError:true});await f.ctx.loadSalesDelivery();const state=f.state();
 assert.equal(state.salesLoaded,false);assert.match(state.salesLoadError,/Saved record unavailable/);
});
test('line query failure prevents incomplete saved record display',async()=>{
 const f=fixture({lineError:true});await f.ctx.loadSalesDelivery();const state=f.state();
 assert.equal(state.salesLoaded,false);assert.match(state.salesLoadError,/Saved lines unavailable/);
});
test('focused record already in latest page is not duplicated',async()=>{
 const f=fixture({included:true});await f.ctx.loadSalesDelivery();
 assert.equal(f.state().salesProformas.filter(row=>row.id==='older-saved').length,1);
});
test('no item is dropped when there are more than 1,000 lines',async()=>{
 const lines=Array.from({length:2600},(_,i)=>({id:`l${i}`,proforma_id:i%2?'older-saved':`recent-${i%200}`,sort_order:i}));
 const f=fixture({lines});await f.ctx.loadSalesDelivery();
 assert.equal(f.state().salesProformaLines.length,2600);
});
