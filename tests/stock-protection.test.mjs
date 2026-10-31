import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../stock-protection.js',import.meta.url),'utf8');
function load(viewName){
 const listeners={},windowListeners={},appended=[],timers=new Map(),messages=[];let timestamp='31 Oct 2026, 13:00';
 const body={classList:{set:new Set(),toggle(name,on){on?this.set.add(name):this.set.delete(name)},contains(name){return this.set.has(name)}},append(el){el.parentElement=this;appended.push(el)}};
 class Clock extends Date{toLocaleString(){return timestamp}}
 const ctx=vm.createContext({view:viewName,me:{user_id:'u'},employeeName:()=>'Asha <Juma>',message:(...args)=>messages.push(args),setInterval:(fn,delay)=>{assert.equal(delay,60000);timers.set(1,fn);return 1},clearInterval:id=>timers.delete(id),Date:Clock,
  document:{body,addEventListener:(type,fn)=>{listeners[type]=fn},querySelector:()=>appended[0]||null,createElement:()=>({style:{},attributes:{},setAttribute(name,value){this.attributes[name]=value},set innerHTML(value){throw Error('Viewer text must not be parsed as HTML')},remove(){appended.length=0}})},
  window:{addEventListener:(type,fn)=>{windowListeners[type]=fn}}});
 vm.runInContext(source,ctx);return {ctx,body,appended,listeners,windowListeners,timers,messages,setTimestamp:value=>{timestamp=value}};
}
for(const viewName of ['inventory','stockcount'])test(`${viewName} keeps literal viewer/time text outside content and clears it on departure`,()=>{
 const stock=load(viewName);stock.ctx.applyStockProtection();
 assert.ok(stock.body.classList.contains('stock-protected'));assert.equal(stock.appended.length,1);
 const mark=stock.appended[0];assert.equal(mark.parentElement,stock.body);assert.equal(mark.attributes['aria-hidden'],'true');
 assert.equal(mark.textContent,'Asha <Juma> · 31 Oct 2026, 13:00 · Anudha internal');assert.equal(mark.style.backgroundImage,undefined);
 stock.ctx.applyStockProtection();assert.equal(stock.appended.length,1);assert.equal(stock.timers.size,1);
 stock.setTimestamp('31 Oct 2026, 13:01');stock.timers.get(1)();assert.match(mark.textContent,/13:01/);
 stock.ctx.view='sales';stock.setTimestamp('31 Oct 2026, 13:02');stock.timers.get(1)();assert.match(mark.textContent,/13:01/);
 stock.ctx.applyStockProtection();assert.equal(stock.appended.length,0);assert.equal(stock.timers.size,0);assert.equal(stock.body.classList.contains('stock-protected'),false);
});
test('stock copy/cut/context/drag restrictions preserve editable controls and other pages',()=>{
 for(const viewName of ['inventory','stockcount','sales']){
  const stock=load(viewName);stock.ctx.applyStockProtection();
  for(const type of ['copy','cut','contextmenu','dragstart']){
   let prevented=false;stock.listeners[type]({target:{closest:()=>null},preventDefault:()=>{prevented=true}});assert.equal(prevented,viewName!=='sales',`${viewName} ${type}`);
   for(const control of ['input','textarea','select']){
    let blocked=false;stock.listeners[type]({target:{closest:selector=>{assert.equal(selector,'input,textarea,select');return {tagName:control}}},preventDefault:()=>{blocked=true}});assert.equal(blocked,false,`${type} stays available in ${control}`);
   }
  }
  stock.messages.length=0;stock.windowListeners.beforeprint();assert.equal(stock.messages.length,viewName==='sales'?0:1);
 }
});
test('the trace occupies a wrapping flow margin at three percent opacity',()=>{
 const css=readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8'),rule=css.match(/#stockWatermark\{([^}]+)\}/)[1];
 assert.match(rule,/(?:^|;)margin:var\(--space-4\) var\(--space-5\)/);assert.match(rule,/(?:^|;)opacity:\.03(?:;|$)/);
 assert.match(rule,/overflow-wrap:anywhere/);assert.match(rule,/pointer-events:none/);assert.match(rule,/color:var\(--ink\)/);
 assert.doesNotMatch(rule,/(?:^|;)(?:position|inset|z-index|background(?:-[\w-]+)?|transform|white-space):/);
});
test('printing stock pages and selecting stock data remain blocked',()=>{
 const css=readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8');
 assert.match(css,/@media print\{body\.stock-protected main,body\.stock-protected #nav,body\.stock-protected>header\{display:none!important\}/);
 assert.match(css,/#stockWatermark\{display:none\}/);assert.match(css,/body\.stock-protected #content\{-webkit-user-select:none;user-select:none\}/);
 assert.match(css,/body\.stock-protected #content input,body\.stock-protected #content textarea\{-webkit-user-select:text;user-select:text\}/);
});
