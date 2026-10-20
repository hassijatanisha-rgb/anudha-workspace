import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../client-profile-pages.js',import.meta.url),'utf8');
function load(){
 const handlers={};const ctx=vm.createContext({window:{addEventListener(){}},document:{addEventListener:(event,fn)=>{(handlers[event] ||= []).push(fn);}},companyDate:()=> '2026-10-20',esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),inventoryProduct:id=>({id,name:`Product ${id}`,category:id}),catalogCategoryOf:product=>product.category,catalogLabel:category=>category});
 vm.runInContext(source+`;Object.assign(globalThis,{branchHistoryWindow,branchHistoryFilteredRows,branchConsumerHistory,clearBranchHistory,branchActivityTypes,setFilter:(month,period)=>{branchHistoryMonth=month;branchHistoryPeriod=period;},getFilter:()=>({month:branchHistoryMonth,period:branchHistoryPeriod}),setRows:(id,rows)=>branchHistoryCache.set(id,rows)});`,ctx);
 let renders=0;ctx.profileView=()=>{renders++;};return {ctx,change:target=>handlers.change.forEach(fn=>fn({target})),renders:()=>renders};
}
const row=(issued_on,quantity=1,product_id='machines')=>({issued_on,quantity,product_id,reference:`Reference ${issued_on}`,reason:''});
test('six and twelve month windows use inclusive calendar dates and clamp end-of-month correctly',()=>{
 const {ctx}=load();
 for(const [months,today,from] of [[6,'2026-10-20','2026-04-20'],[12,'2026-10-20','2025-10-20'],[6,'2026-08-31','2026-02-28'],[6,'2024-08-31','2024-02-29'],[12,'2024-02-29','2023-02-28']])assert.deepEqual({...ctx.branchHistoryWindow(months,today)},{from,to:today});
});
test('recent windows retain boundary issues, exclude future dates and recalculate only from recorded rows',()=>{
 const {ctx}=load(),rows=[row('2025-10-19'),row('2025-10-20'),row('2026-04-19'),row('2026-04-20',2),row('2026-10-20',3,'reagents'),row('2026-10-21',9)];
 ctx.setFilter('','6');assert.deepEqual([...ctx.branchHistoryFilteredRows(rows)].map(r=>r.issued_on),['2026-04-20','2026-10-20']);
 ctx.setRows('branch',rows);const html=ctx.branchConsumerHistory({id:'branch',name:'Clinic <branch>'});assert.match(html,/Last 6 months · 2026-04-20 to 2026-10-20/);assert.match(html,/<small>machines<\/small><strong>2<\/strong>/);assert.match(html,/<small>reagents<\/small><strong>3<\/strong>/);assert.match(html,/Clinic &#60;branch&#62;/);assert.doesNotMatch(html,/Reference 2026-10-21/);
 ctx.setFilter('','12');assert.deepEqual([...ctx.branchHistoryFilteredRows(rows)].map(r=>r.issued_on),['2025-10-20','2026-04-19','2026-04-20','2026-10-20']);
 ctx.setFilter('2026-04','');assert.deepEqual([...ctx.branchHistoryFilteredRows(rows)].map(r=>r.issued_on),['2026-04-19','2026-04-20']);
 ctx.setFilter('','');assert.equal(ctx.branchHistoryFilteredRows(rows),rows);
});
test('month and quick period controls reset one another; All and session clear restore the full history',()=>{
 const {ctx,change,renders}=load();ctx.setFilter('2026-03','');change({id:'branchHistoryPeriod',value:'6'});assert.deepEqual({...ctx.getFilter()},{month:'',period:'6'});
 change({id:'branchHistoryMonth',value:'2026-04'});assert.deepEqual({...ctx.getFilter()},{month:'2026-04',period:''});
 change({id:'branchHistoryPeriod',value:''});assert.deepEqual({...ctx.getFilter()},{month:'',period:''});
 change({id:'branchHistoryPeriod',value:'12'});ctx.clearBranchHistory();assert.deepEqual({...ctx.getFilter()},{month:'',period:''});assert.equal(renders(),4);
});
test('rendered controls retain labels and explain an empty selected window without inventing purchase data',()=>{
 const {ctx}=load();ctx.setRows('branch',[row('2020-01-01')]);ctx.setFilter('','6');const html=ctx.branchConsumerHistory({id:'branch',name:'Clinic'});
 assert.match(html,/<span>Period<\/span><select id="branchHistoryPeriod">/);assert.match(html,/<span>Month<\/span><select id="branchHistoryMonth">/);assert.match(html,/No issued or delivered items match this date window/);assert.match(html,/0 records/);assert.doesNotMatch(html,/billed|entitlement|invoice paid/i);
 ctx.setRows('branch',[]);assert.match(ctx.branchConsumerHistory({id:'branch',name:'Clinic'}),/No issued or delivered items are recorded for this branch yet/);
 assert.equal(ctx.branchActivityTypes.contracts.table,'customer_contracts','root contract integration preserved');
});
