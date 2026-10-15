// Fixes found by driving the staff scenario guide end to end in a browser (October 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const fn=(file,name)=>{const src=read(file),start=src.indexOf(`function ${name}(`);assert.ok(start>=0,`${name} in ${file}`);
 let depth=0,i=src.indexOf('{',start);for(;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&--depth===0)break;}
 return (src.slice(Math.max(0,start-6),start)==='async '?'async ':'')+src.slice(start,i+1);};

test('Record tax invoice still works where the stock-reservation function (migration 010) is not installed',async()=>{
 const ctx=vm.createContext({});vm.runInContext(fn('sales-delivery.js','taxInvoiceReservationMissing'),ctx);
 assert.equal(ctx.taxInvoiceReservationMissing({code:'PGRST202',message:'Could not find the function public.create_tax_invoice_and_reserve_stock(p_expected_version, p_id, p_tax_invoice_reference) in the schema cache'}),true);
 assert.equal(ctx.taxInvoiceReservationMissing({code:'P0001',message:'Not enough available stock at Haadi for product x; Tax Invoice was not created'}),false,'a real refusal is shown, not bypassed');
 assert.equal(ctx.taxInvoiceReservationMissing(null),false);
 const src=fn('sales-delivery.js','openDeliveryAction');
 assert.match(src,/create_tax_invoice_and_reserve_stock[^;]*;if\(taxInvoiceReservationMissing\(result\.error\)\)result=await client\.rpc\('advance_sales_delivery',\{[^}]*p_action:'tax_invoice'[^}]*p_proof_reference:values\.proof\}\)/);
});

test('A page opened by a button (Create Pro forma on a lead) is recorded, so Back returns to the lead list',()=>{
 const pushed=[],replaced=[];const location={hash:''};
 const ctx=vm.createContext({location,history:{state:null,pushState:(s,t,h)=>{pushed.push(h);location.hash=h},replaceState:(s,t,h)=>{replaced.push(h);location.hash=h}},
  document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null},window:{addEventListener(){}},setTimeout});
 vm.runInContext(read('nav-history.js'),ctx);location.hash='#/go/leads/leads';
 const button=(view,section)=>({dataset:{view,workspaceSection:section}});
 ctx.navRecordOpenPage(button('sales','new'));
 assert.deepEqual(pushed,['#/go/sales/new']);
 ctx.navRecordOpenPage(button('sales','new'));
 assert.equal(pushed.length,1,'the same page is not recorded twice');
 location.hash='';ctx.navRecordOpenPage(button('dashboard'));
 assert.deepEqual(replaced,['#/go/dashboard'],'the first page replaces the empty address instead of adding a Back step');
 location.hash='#/clients/x';ctx.navRecordOpenPage(button('contacts'));
 assert.equal(location.hash,'#/clients/x','client pages keep their own address');
 assert.match(read('workspace-navigation.js'),/if\(active\)\{button\.setAttribute\('aria-current','page'\);if\(typeof navRecordOpenPage==='function'\)navRecordOpenPage\(button\);\}/);
});

test('Order from supplier is offered on a pending order only to people with Purchasing access',()=>{
 const run=(access,role='head')=>{const ctx=vm.createContext({me:{user_id:'u1',role,access},esc:String,pendingDaysLeft:()=>30,
  hasArea:a=>role==='owner'||access.includes(a)});
  vm.runInContext(fn('pending-stock.js','pendingActions'),ctx);
  return ctx.pendingActions({id:'r1',status:'waiting',salesperson_user_id:'u1',extension_count:0});};
 assert.doesNotMatch(run(['leads','proformas','deliveries','stock']),/Order from supplier/,'sales head without Purchasing');
 assert.match(run(['leads','proformas','deliveries','stock']),/Mark fulfilled/);
 assert.match(run(['proformas','purchasing']),/Order from supplier/);
 assert.match(run([],'owner'),/Order from supplier/);
});

test('Create Pro forma is offered on a lead only to people with Pro formas access',()=>{
 const run=access=>{const ctx=vm.createContext({esc:String,hasArea:a=>access.includes(a)});vm.runInContext(fn('sales-leads.js','leadActions'),ctx);
  return ctx.leadActions({id:'l1',stage:'lead'});};
 assert.doesNotMatch(run(['leads']),/Create Pro forma/);
 assert.match(run(['leads']),/Mark won/);
 assert.match(run(['leads','proformas']),/Create Pro forma/);
});

test('The database refuses the same junk task results as the screen (migration 076)',()=>{
 const sql=read('supabase/migrations/202610080076_task_result_needs_words.sql'),js=fn('team-tasks.js','teamTaskResultProblem');
 const list=s=>[...s.slice(s.search(/'ok','okay'/)).split(']')[0].matchAll(/'(ok|okay|done|na|nil|none|yes|no|test|finished|complete|completed)'/g)].map(m=>m[1]).sort();
 assert.deepEqual(list(sql),list(js));
 assert.match(sql,/if p_action = 'done' and not public\.team_task_result_ok\(p_note\)/);
 assert.match(sql,/count\(\*\)>=3/);assert.match(js,/real\.length<3/);
});

test('Staff page reloads names when someone was added since sign-in (no "Employee name not set")',async()=>{
 let loads=0;const ctx=vm.createContext({employeeDirectory:new Map([['a',{}]]),loadEmployeeNames:async()=>{loads++}});
 vm.runInContext(fn('employee-names.js','refreshEmployeeNamesFor'),ctx);
 await ctx.refreshEmployeeNamesFor(['a']);assert.equal(loads,0,'all known: no reload');
 await ctx.refreshEmployeeNamesFor(['a','new']);assert.equal(loads,1);
 assert.match(read('app.js'),/select\('user_id,role,active,phone,department,access'\);if\(r\.error\)throw r\.error;await refreshEmployeeNamesFor\(/);
 assert.match(fn('staff-access.js','headStaffPage'),/await refreshEmployeeNamesFor\(r\.data\.map/);
});

test('Reports offers only reports for parts the person can use',()=>{
 const run=(role,access)=>{const ctx=vm.createContext({me:{role,access},hasArea:a=>role==='owner'||access.includes(a)});
  vm.runInContext(read('reports.js').match(/const reportChoiceAreas=.*\n/)[0]+fn('reports.js','reportChoiceAllowed'),ctx);
  return ['work','tasks','activity','proformas','leads','deliveries','purchasing','service','travel','movements'].filter(k=>ctx.reportChoiceAllowed(k));};
 assert.deepEqual(run('head',['leads','proformas','deliveries','stock','travel','reports']),['work','tasks','activity','proformas','leads','deliveries','travel']);
 assert.deepEqual(run('owner',[]).length,10);
 assert.match(read('reports.js'),/reportChoices\.filter\(\(\[key\]\)=>reportChoiceAllowed\(key\)\)/);
});

test('Assign engineer lists only people who can open Service jobs',()=>{
 const ctx=vm.createContext({serviceTeam:[
  {user_id:'a',role:'staff',active:true,access:['service']},{user_id:'b',role:'staff',active:true,access:['deliveries','stock']},
  {user_id:'c',role:'owner',active:true,access:[]},{user_id:'d',role:'head',active:false,access:['service']},{user_id:'e',role:'head',active:true,access:['service','stock']}],
  inventoryOption:(id,label)=>`<option value="${id}">${label}</option>`,serviceTeamLabel:id=>id});
 vm.runInContext(fn('service-workflow.js','serviceTeamOptions'),ctx);
 assert.deepEqual([...ctx.serviceTeamOptions().matchAll(/value="(\w)"/g)].map(m=>m[1]),['a','c','e']);
 assert.match(read('service-workflow.js'),/from\('staff'\)\.select\('user_id,role,active,access'\)/);
});
