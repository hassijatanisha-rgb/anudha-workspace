import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../stock-protection.js',import.meta.url),'utf8');
function load(viewName){
 const listeners={},body={classList:{set:new Set(),toggle(name,on){on?this.set.add(name):this.set.delete(name)},contains(name){return this.set.has(name)}},append(el){appended.push(el)}},appended=[];
 const ctx=vm.createContext({view:viewName,me:{user_id:'u'},employeeName:()=>'Asha <Juma>',message:()=>{},setInterval:()=>1,clearInterval:()=>{},encodeURIComponent,Date,
  document:{body,addEventListener:(type,fn)=>{listeners[type]=fn},querySelector:()=>appended[0]||null,createElement:()=>({style:{},setAttribute(){},remove(){appended.length=0}})},
  window:{addEventListener(){}}});
 vm.runInContext(source,ctx);return {ctx,body,appended,listeners};
}
test('stock pages get the watermark and block copying; other pages do not',()=>{
 const stock=load('inventory');stock.ctx.applyStockProtection();
 assert.ok(stock.body.classList.contains('stock-protected'));assert.equal(stock.appended.length,1);
 assert.match(decodeURIComponent(stock.appended[0].style.backgroundImage),/Asha &lt;Juma&gt;/,'the name is escaped inside the watermark');
 let prevented=false;stock.listeners.copy({target:{closest:()=>null},preventDefault:()=>{prevented=true}});assert.ok(prevented);
 let typing=false;stock.listeners.copy({target:{closest:()=>({})},preventDefault:()=>{typing=true}});assert.equal(typing,false,'copying inside a search box still works');
 const sales=load('sales');sales.ctx.applyStockProtection();
 assert.equal(sales.body.classList.contains('stock-protected'),false);assert.equal(sales.appended.length,0);
 let blocked=false;sales.listeners.copy({target:{closest:()=>null},preventDefault:()=>{blocked=true}});assert.equal(blocked,false);
});
test('printing stock pages is blocked by the print stylesheet',()=>{
 const css=readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8');
 assert.match(css,/@media print\{body\.stock-protected main/);
});
