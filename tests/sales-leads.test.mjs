import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){
 const ctx=vm.createContext({orgIndex:new Map([['org',{name:'Fixture Hospital',location:'Dar'}]]),esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>({a:'Asha',b:'Baraka'}[id]||'Employee name not set'),Intl,Number,String});
 vm.runInContext(readFileSync(new URL('../sales-leads.js',import.meta.url),'utf8'),ctx);return ctx;
}
const row=(id,stage,extra={})=>({id,stage,lead_number:'LD-'+id,subject:'Need '+id,created_at:'2026-09-0'+(id.length%9+1),...extra});
test('one leads list: filters combine with search; new inquiries are open until passed on',()=>{
 const ctx=load(),rows=[row('1','inquiry'),row('2','lead',{owner_user_id:'a'}),row('3','opportunity',{owner_user_id:'b'}),row('4','won'),row('5','lost',{lost_reason:'price'})];
 const ids=options=>ctx.leadVisibleRows(rows,{today:'2026-09-30',search:'',actor:'a',...options}).map(r=>r.id).sort();
 assert.deepEqual(ids({filter:'open'}),['1','2','3']);
 assert.deepEqual(ids({filter:'new'}),['1']);
 assert.deepEqual(ids({filter:'mine'}),['2']);
 assert.deepEqual(ids({filter:'won'}),['4']);
 assert.deepEqual(ids({filter:'all'}),['1','2','3','4','5']);
 assert.deepEqual(ids({filter:'all',search:'baraka'}),['3']);
 assert.deepEqual(ids({filter:'all',search:'LD-4'}),['4']);
});
test('overdue follow-ups come first; closed leads are never overdue',()=>{
 const ctx=load(),rows=[row('a','lead',{next_action_on:'2026-10-05'}),row('b','lead',{next_action_on:'2026-09-01'}),row('c','lead'),row('d','won',{next_action_on:'2026-01-01'})];
 assert.equal(ctx.leadOverdue(rows[1],'2026-09-30'),true);assert.equal(ctx.leadOverdue(rows[3],'2026-09-30'),false);
 assert.deepEqual(ctx.leadVisibleRows(rows,{filter:'all',search:'',today:'2026-09-30'}).map(r=>r.id),['b','a','c','d']);
});
test('client label prefers the client record, then caller details',()=>{
 const ctx=load();
 assert.equal(ctx.leadClientLabel({organization_id:'org'}),'Fixture Hospital · Dar');
 assert.equal(ctx.leadClientLabel({caller_organization:'New Clinic',caller_name:'Asha'}),'New Clinic · Asha');
 assert.equal(ctx.leadClientLabel({}),'Unknown caller');
});
test('actions follow the stage rules',()=>{
 const ctx=load(),actions=stage=>[...ctx.leadActions(row('x',stage)).matchAll(/data-lead-(?:action="([a-z]+)"|(proforma|edit|history))/g)].map(m=>m[1]||m[2]);
 assert.deepEqual(actions('inquiry'),['edit','qualify','lost','history']);
 assert.deepEqual(actions('lead'),['edit','assign','proforma','won','lost','history']);
 assert.deepEqual(actions('opportunity'),['edit','assign','proforma','won','lost','history']);
 assert.deepEqual(actions('won'),['history']);
 assert.deepEqual(actions('lost'),['reopen','history']);
});
test('menu, router, sign-out and Pro forma prefill are wired',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
 assert.match(read('workspace-navigation.js'),/\['Leads','leads','leads'\]/);assert.doesNotMatch(read('workspace-navigation.js'),/Inquiries|Lead \/ Opportunity/);
 assert.match(read('app.js'),/view==='leads'\)return leadsWorkspace\(\)/);assert.match(read('app.js'),/function clear\(\)\{clearEmployeeNames\(\);if\(typeof clearLeads==='function'\)clearLeads\(\);/);
 assert.match(read('sales-delivery.js'),/prefill=record\?null:salesPrefill/);assert.match(read('sales-delivery.js'),/salesPrefill=null;\nfunction clearSalesPrefill/);assert.match(read('sales-delivery.js'),/\$\('#newProforma'\)\?\.addEventListener\('click',\(\)=>\{salesPrefill=null;/);
 const html=read('index.html');assert.ok(html.indexOf('sales-leads.js')>html.indexOf('sales-delivery.js')&&html.indexOf('sales-leads.js')<html.indexOf('app.js'));
});
test('loads every open lead but only six months of won and lost ones; search reaches older leads',async()=>{
 const ctx=load(),calls=[];
 Object.assign(ctx,{Date,Set,me:{user_id:'a'},salesLoaded:true,view:'leads',renderSearchPreservingPosition:()=>{},$:()=>null});
 ctx.all=async(table,columns,filter)=>{const q={or(v){calls.push(v);return q;}};filter(q);return [row('1','lead')];};
 assert.equal(await ctx.loadLeads(),true);
 assert.match(calls[0],/^stage\.not\.in\.\(won,lost\),updated_at\.gte\.\d{4}-/);
 let asked='';
 ctx.client={from:()=>{const q={select:()=>q,or:v=>{asked=v;return q;},order:()=>q,limit:async()=>({data:[row('1','lead'),row('old','lost',{lost_reason:'price'})]})};return q;}};
 vm.runInContext(`leadSearch='Mus%hi,';renderLeads=()=>{};`,ctx);
 await ctx.leadSearchOlder('Mus%hi,');
 assert.match(asked,/^lead_number\.ilike\.\*Mus hi\*,subject\.ilike/,'search text is cleaned before it reaches the filter');
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(leadRows.map(r=>r.id))',ctx)),['1','old'],'older match added once');
});
test('after a save or step only that lead is read again',async()=>{
 const ctx=load();let asked=0;
 Object.assign(ctx,{me:{user_id:'a'}});
 ctx.client={from:()=>{asked++;const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:row('2','won',{proforma_id:'p'})})};return q;}};
 vm.runInContext(`leadLoaded=true;view='leads';leadRows=[row1,row2];renderLeads=()=>{};`.replace('row1',JSON.stringify(row('1','lead'))).replace('row2',JSON.stringify(row('2','lead'))),ctx);
 await ctx.leadRefreshOne('2');
 assert.equal(asked,1);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(leadRows.map(r=>r.id+":"+r.stage).sort())',ctx)),['1:lead','2:won']);
});
