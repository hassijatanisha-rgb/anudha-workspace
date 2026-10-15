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
test('sign-in keeps working if the screens go live before the access list exists on the server',async()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=app.indexOf('async function loadMyStaffRow'),src=app.slice(start,app.indexOf('\n}\n',start)+3);
 const asked=[],client={from:()=>({select:cols=>{asked.push(cols);return {eq:()=>({single:async()=>cols.includes('access')?{error:{message:'column staff.access does not exist'}}:{data:{user_id:'u',role:'staff',active:true}}})};}})};
 const ctx=vm.createContext({client});vm.runInContext(src,ctx);
 const r=await ctx.loadMyStaffRow('u');
 assert.equal(r.data.active,true);assert.equal(r.data.access.length,9);assert.equal(asked.length,2);
 client.from=()=>({select:()=>({eq:()=>({single:async()=>({error:{message:'JWT expired'}})})})});
 assert.equal((await ctx.loadMyStaffRow('u')).error.message,'JWT expired','other errors are not hidden');
});
test('staff list file: validated, heads first, people with a login skipped',()=>{
 const ctx=load({role:'owner',access:[]});ctx.employeeDirectory=new Map([['u1',{display_name:'Existing Person'}]]);
 const file=rows=>JSON.stringify({format:'anudha-staff-list-v1',rows});
 assert.throws(()=>ctx.staffListRows('{}'),/not a staff list/);
 assert.throws(()=>ctx.staffListRows(file([{full_name:'A B',role:'boss'}])),/role must be/);
 assert.throws(()=>ctx.staffListRows(file([{full_name:'A B',department:'kitchen'}])),/unknown department/);
 assert.throws(()=>ctx.staffListRows(file([{full_name:'A B'},{full_name:'a  b'}])),/twice/);
 const rows=ctx.staffListRows(file([{full_name:'Rep',role:'staff',department:'marketing',access:['leads']},{full_name:'Boss',role:'owner',access:['leads']},{full_name:'Lead',role:'head',department:'marketing',access:['leads'],start:true}]));
 assert.deepEqual([...rows.map(r=>r.access.length)],[1,0,1],'owners get no list');
 assert.deepEqual([...ctx.staffListOrder(rows).map(r=>r.name)],['Boss','Lead','Rep']);
 assert.equal(ctx.staffListExisting('existing person'),true);assert.equal(ctx.staffListExisting('Someone New'),false);
 assert.match(ctx.departmentLabel('marketing'),/Marketing/);
});
test('Clients & items data: the owner gives it per person; heads never tick it; nobody gets it from a template',()=>{
 const owner=load({role:'owner',access:[]});
 assert.ok(vm.runInContext('accessAreas',owner).some(([key,label])=>key==='records'&&label==='Clients & items data'));
 assert.equal(owner.canEditRecords(),true,'the owner always can');assert.equal(owner.recordsLockedNote(),'');
 assert.match(owner.accessCheckboxes([]),/value="records"\s*>/,'the owner can tick it');
 for(const [dept,areas] of Object.entries(vm.runInContext('departmentAccess',owner)))assert.ok(!areas.includes('records'),`${dept||'no department'} template`);
 assert.ok(!owner.startingAccess('management').includes('records'));
 const withIt=load({...head,access:[...head.access,'records']});
 assert.equal(withIt.canEditRecords(),true);
 assert.match(withIt.accessCheckboxes(['records']),/value="records" checked\s+disabled/,'a head who has it still cannot give it');
 assert.match(withIt.accessCheckboxes([]),/only the owner can give or remove it/);
 const form={querySelectorAll:()=>[{value:'leads'},{value:'records'}]};
 assert.deepEqual([...withIt.checkedAreas(form)],['leads'],'records is never sent by a head');
 const staff=load({user_id:'s',role:'staff',access:['leads']});
 assert.equal(staff.canEditRecords(),false);assert.match(staff.recordsLockedNote(),/Only people with Clients (&amp;|&#38;) items data access can change this\. Ask the owner\./);
});
test('migration 071: records guard on every client and item save, owner-only granting, nobody added',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/202610070071_clients_items_records_access.sql',import.meta.url),'utf8');
 assert.match(sql,/^begin;$/m);assert.match(sql,/^commit;$/m);assert.match(sql,/^-- Rollback:/m);
 assert.match(sql,/'reports','records'\]::text\[\]\n\$\$;/,'listed in staff_access_areas');
 assert.match(sql,/add constraint staff_access_check\s+check \(access <@ array\[[^\]]*'records'\]/);
 assert.doesNotMatch(sql,/update public\.staff set access=(?!v_access )/,'nobody gets it automatically');
 assert.match(sql,/Only the owner can give or remove Clients & items data access/);
 assert.match(sql,/if 'records'=any\(v_access\) then raise exception 'Only the owner can give Clients & items data access'/);
 for(const fn of ['save_organization','approve_organization','set_organization_parent','save_contact','restore_contact','archive_record','restore_record','import_records','save_product','set_product_match','set_product_archived','apply_product_list','save_pack_definition','save_product_detail_review','save_product_inventory_classification','save_product_machine_link_review','save_product_source_mapping_review'])
  assert.match(sql,new RegExp(`'public\\.${fn}\\(`),fn);
 for(const fn of ['save_sales_lead','save_sales_proforma','complete_service_report','record_tally_export','submit_customer_request'])
  assert.doesNotMatch(sql,new RegExp(`public\\.${fn}\\(`),`${fn} keeps working without records`);
 assert.match(sql,/perform public\.require_access\(''records''\);/);
 const fn=readFileSync(new URL('../supabase/functions/staff-accounts/index.ts',import.meta.url),'utf8');
 assert.match(fn,/const AREAS = \[[^\]]*'records'\]/);
});
test('migration 071: the chosen people take over the owner-only client and item steps, not bulk import or Pro formas',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/202610070071_clients_items_records_access.sql',import.meta.url),'utf8');
 const widen=sql.slice(sql.indexOf('c_pattern constant text'),sql.indexOf('end $do$;',sql.indexOf('c_pattern constant text')));
 assert.match(widen,/public\\\.\(is_owner\|inventory_owner\)/,'only the owner check line is rewritten');
 assert.match(widen,/if not public\.has_access\(''records''\) then raise exception/);
 for(const fn of ['save_organization','approve_organization','set_organization_parent','archive_record','restore_record','set_product_archived','apply_product_list','save_pack_definition','save_product_detail_review','save_product_machine_link_review','save_product_source_mapping_review'])
  assert.match(widen,new RegExp(`'public\\.${fn}\\(`),fn);
 assert.doesNotMatch(widen,/import_records|set_draft_proforma_archived/,'bulk import and Pro formas stay owner-only');
 assert.match(sql,/case when tg_table_name=''products'' then public\.has_access\(''records''\) else public\.inventory_owner\(\) end/,'Pro forma archiving keeps the owner check');
 assert.match(sql,/guard_client_archive_owner\(\)'::regprocedure/);
 assert.match(sql,/create function public\.add_product\(p_id uuid, p_name text, p_sku text default '', p_source jsonb default '\{\}'::jsonb\)[\s\S]*?\nbegin\n perform public\.require_access\('records'\);/,'one product for records holders');
});
test('screens: client and item buttons follow Clients & items data; import and Pro forma deletion stay owner-only',()=>{
 const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
 const app=read('app.js'),profiles=read('client-profile-pages.js'),forms=read('action-forms.js'),recycle=read('recycle-bin.js'),admin=read('admin-records.js'),inv=read('inventory-operations.js');
 assert.match(app,/canEditRecords\(\)\?'<button id="newOrg">\+ Account<\/button>':''/);
 assert.match(app,/canEditRecords\(\)\?'<button id="newProduct">\+ Add product<\/button>'/,'one product at a time for records holders');
 assert.match(read('action-forms.js'),/client\.rpc\('add_product',\{p_id:id,p_name:values\.name,p_sku:values\.sku,p_source:\{origin:'manual'\}\}\)/);
 assert.doesNotMatch(app+read('action-forms.js'),/rpc\('import_records',\{p_products:\[/,'the Add product button no longer uses bulk import');
 assert.match(app,/item\.dataset\.view==='recycle'&&canEditRecords\(\)/,'Deleted items menu for records holders');
 assert.match(profiles,/canEditRecords\(\)\?'<button class="primary-action" id="newOrg">\+ Add client<\/button>'/);
 assert.doesNotMatch(profiles+recycle+forms.slice(0,forms.indexOf('function openProductForm')),/role!=='owner'|role==='owner'/);
 assert.match(admin,/kind==='product'\?canEditRecords\(\):me\?\.role==='owner'/);
 assert.match(inv,/\$\{canEditRecords\(\)\?`<details class="card"><summary>1\. Set a product carton size/);
 assert.match(inv,/me\.role==='owner'\?inventorySetupProgress\(\)\+inventoryImportPanel\(\)/,'product import panel stays owner-only');
});
