import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(me){
 const ctx=vm.createContext({me,esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>id});
 vm.runInContext(readFileSync(new URL('../staff-access.js',import.meta.url),'utf8'),ctx);return ctx;
}
const head={user_id:'h',role:'head',department:'sales',access:['leads','proformas','travel']};
test('owner has every area; others only what is ticked',()=>{
 assert.equal(load({role:'owner',access:[]}).hasArea('stock_count'),true);
 const ctx=load(head);
 assert.equal(ctx.hasArea('leads'),true);assert.equal(ctx.hasArea('stock'),false);assert.equal(ctx.hasArea(null),true,'shared screens need no area');
});
test('menu entries and screens map to areas; product search and personal pages are for everyone',()=>{
 const ctx=load(head);
 assert.equal(ctx.viewArea('sales','delivery'),'deliveries');assert.equal(ctx.viewArea('sales','new'),'proformas');
 assert.equal(ctx.viewArea('inventory','catalog'),null);assert.equal(ctx.viewArea('inventory','transfers'),'stock');
 assert.equal(ctx.viewArea('personal','task'),null);assert.equal(ctx.viewArea('contacts'),null);assert.equal(ctx.viewArea('travel'),'travel');
});
test('a head manages only staff in their own department, never themself, other heads or owners',()=>{
 const ctx=load(head);
 assert.equal(ctx.canManagePerson({user_id:'a',role:'staff',department:'sales'}),true);
 assert.equal(ctx.canManagePerson({user_id:'b',role:'staff',department:'stores'}),false);
 assert.equal(ctx.canManagePerson({user_id:'c',role:'head',department:'sales'}),false);
 assert.equal(ctx.canManagePerson({user_id:'h',role:'head',department:'sales'}),false);
 assert.equal(ctx.canManagePerson({user_id:'o',role:'owner',department:'management'}),false);
 assert.equal(load({...head,department:''}).canManagePerson({user_id:'a',role:'staff',department:''}),false,'no department set yet');
});
test('a head can tick only areas they have; new accounts start with the department set they can give',()=>{
 const ctx=load(head),html=ctx.accessCheckboxes(['leads']);
 assert.match(html,/value="leads" checked\s*>/);assert.match(html,/value="stock"\s+disabled/);
 assert.deepEqual([...ctx.startingAccess('sales')],['leads','proformas','travel']);
 const form={querySelectorAll:()=>[{value:'leads'},{value:'stock'}]};
 assert.deepEqual([...ctx.checkedAreas(form)],['leads'],'an area the head lacks is never sent even if ticked by hand');
});
test('everyone keeps the shared pages; the summary reads in plain words',()=>{
 const ctx=load(head);
 assert.equal(ctx.accessSummary({role:'owner'}),'Everything');
 assert.equal(ctx.accessSummary({role:'staff',access:[]}),'Nothing yet');
 assert.equal(ctx.accessSummary({role:'staff',access:['travel','leads']}),'Leads, Travel requests');
});
test('database enforces areas on reads and saves, and heads only for their department',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/202610050060_department_heads_and_access.sql',import.meta.url),'utf8');
 for(const [fn,area] of [['save_sales_lead','leads'],['save_sales_proforma','proformas'],['create_sales_delivery_note','deliveries'],['create_service_case','service'],['save_purchase_request','purchasing'],['issue_consumer_units','stock'],['record_stock_count','stock_count'],['save_travel_request','travel']])
  assert.match(sql,new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?\\nbegin\\n perform public\\.require_access\\('${area}'\\);`),fn);
 assert.match(sql,/alter policy suppliers_read on public\.suppliers using \(\(select public\.has_access\('purchasing'\)\)\)/);
 assert.match(sql,/update public\.staff set access=public\.staff_access_areas\(\) where role<>'owner'/,'everyone keeps today’s access');
 assert.match(sql,/not \(v_access <@ v_me\.access\)/,'a head cannot give what they lack');
 assert.match(sql,/revoke all on function public\.require_access\(text\) from authenticated/);
 const fn=readFileSync(new URL('../supabase/functions/staff-accounts/index.ts',import.meta.url),'utf8');
 assert.match(fn,/rpc\('is_department_head'\)/);assert.match(fn,/rpc\('add_department_staff'/);assert.match(fn,/rpc\('can_manage_staff'/);
 assert.match(fn,/const role = !isOwner \? 'staff'/,'a head can only create staff');
});
