import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
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
 const ctx=load(),actions=stage=>[...ctx.leadActions(row('x',stage)).matchAll(/data-lead-(?:action="([a-z]+)"|(proforma|edit|history|handover))/g)].map(m=>m[1]||m[2]);
 assert.deepEqual(actions('inquiry'),['edit','qualify','lost','history']);
 assert.deepEqual(actions('lead'),['edit','handover','proforma','won','lost','history']);
 assert.deepEqual(actions('opportunity'),['edit','handover','proforma','won','lost','history']);
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
test('the next step reads in words, with late and today marked',()=>{
 const ctx=load(),step=(extra,today='2026-10-07')=>JSON.parse(JSON.stringify(ctx.leadNextStep(row('n','lead',extra),today)));
 assert.deepEqual(step({next_action:'Call Mr Bob',next_action_on:'2026-10-08'}),{state:'planned',text:'Call Mr Bob',when:'Thu 8 Oct'});
 assert.deepEqual(step({next_action:'Call Mr Bob',next_action_on:'2026-10-07'}),{state:'today',text:'Call Mr Bob',when:'Today'});
 assert.equal(step({next_action:'Send price',next_action_on:'2026-10-01'}).state,'late');
 assert.equal(step({next_action_on:'2026-10-09'}).text,'Follow up');
 assert.equal(step({}).state,'none');
 assert.equal(ctx.leadNextStep(row('w','won',{next_action:'x'})),null,'closed leads have no next step');
 vm.runInContext('salesProformas=[]',ctx);
 const card=ctx.leadCard(row('c','lead',{next_action:'Call Mr Bob',next_action_on:'2099-10-10',caller_name:'Stella',caller_phone:'0712 000 111',caller_role:'procurement'}));
 assert.match(card,/class="lead-next-step lead-next-planned"><small>Next step<\/small><strong>Call Mr Bob · Sat 10 Oct<\/strong>/);
 assert.ok(card.indexOf('lead-next-step')<card.indexOf('class="details"'),'next step sits above the details');
 assert.match(card,/Spoke to<\/small> <strong>Stella<\/strong> · 0712 000 111 <span class="tag lead-role lead-role-procurement">Procurement \/ purchasing<\/span>/);
});
test('spoke to: linked contact first, then the typed caller; missing role is shown',()=>{
 const ctx=load();
 vm.runInContext(`var contacts=[{id:'k',first_name:'Stella',last_name:'M',phone:'0755 111 222',position:'Purchasing officer'}];function salesContactName(id){const c=contacts.find(x=>x.id===id);return c.first_name+' '+c.last_name;}`,ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.leadSpokeTo({contact_id:'k',caller_role:'procurement'}))),{name:'Stella M',phone:'0755 111 222',role:'Procurement / purchasing',position:'Purchasing officer'});
 assert.equal(ctx.leadSpokeTo({caller_name:'Dr Asha',caller_phone:'0712',caller_role:'doctor'}).role,'Doctor / user');
 assert.match(ctx.leadSpokeToHtml({caller_name:'Dr Asha'}),/role not recorded/);
 assert.equal(ctx.leadSpokeToHtml({}),'');
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(Object.keys(leadRoles))',ctx)),['doctor','head_of_department','procurement','management','biomedical','other']);
});
test('the form sends the role, and a caller name for a known client without a named contact',()=>{
 const ctx=load();
 ctx.FormData=class{constructor(form){this.m=new Map(Object.entries(form));}get(k){return this.m.has(k)?this.m.get(k):null;}has(k){return this.m.has(k);}};
 const base={who:'client',organizationId:'org',contactId:'',clientCallerName:'Stella',clientCallerPhone:'0712',subject:'Ultrasound price',source:'phone',callerRole:'procurement'};
 const fields=ctx.leadFormValues(base);
 assert.equal(fields.caller_role,'procurement');assert.equal(fields.caller_name,'Stella');assert.equal(fields.caller_phone,'0712');
 assert.equal(ctx.leadFormValues({...base,contactId:'k'}).caller_name,'','a named contact replaces the typed name');
 assert.throws(()=>ctx.leadFormValues({...base,callerRole:''}),/role of the person/);
});
test('handover: note needs 5 words; history on the card shows who, to whom, when and the note',()=>{
 const ctx=load();
 assert.equal(ctx.leadWords('  call   them back  '),3);assert.equal(ctx.leadWords('Head of radiology wants ultrasound'),5);
 const html=ctx.leadHandoverHtml([
  {from_user_id:'a',assigned_user_id:'b',actor_user_id:'a',note:'Head of radiology at X, wants a general ultrasound',created_at:'2026-10-07T08:00:00Z'},
  {from_user_id:'b',assigned_user_id:'a',actor_user_id:'b',note:'Customer asked for the head to call back',created_at:'2026-10-08T08:00:00Z'}]);
 assert.match(html,/<ol><li><strong>Baraka<\/strong> → <strong>Asha<\/strong>.*Customer asked for the head to call back/,'newest first');
 assert.match(html,/Earlier handovers · 1<\/summary><ol><li><strong>Asha<\/strong> → <strong>Baraka<\/strong>.*general ultrasound/);
 assert.equal(ctx.leadHandoverHtml([]),'');
 const src=readFileSync(new URL('../sales-leads.js',import.meta.url),'utf8');
 assert.match(src,/client\.rpc\('hand_over_sales_lead',\{p_id:row\.id,p_expected_version:row\.version,p_new_owner_user_id:values\.assignee,p_note:note,/);
 assert.match(src,/<select name="assignee" required data-lookup>/,'the new owner is picked from a search box');
 assert.match(src,/leadColumns='[^']*caller_role/);
});
test('migration 068: next number, handover RPC checks access, version and note; handoff reuses work assignments',()=>{
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 const name='202610070068_lead_spoke_to_and_handover.sql',at=files.indexOf(name);
 assert.ok(at>0);assert.match(files[at-1],/^202610060067_/);
 const sql=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 assert.match(sql,/^begin;$/m);assert.match(sql,/^commit;$/m);assert.match(sql,/^-- Rollback:/m);
 const start=sql.indexOf('create function public.hand_over_sales_lead'),rpc=sql.slice(start,sql.indexOf('end $$;',start));
 assert.match(rpc,/security definer set search_path=public,pg_temp/);assert.match(rpc,/perform public\.require_access\('leads'\)/);
 assert.match(rpc,/v_row\.version <> p_expected_version/);assert.match(rpc,/at least 5 words/);assert.match(rpc,/'leads'=any\(access\)/);
 assert.match(rpc,/insert into public\.sales_lead_events\([^)]*from_user_id/);
 assert.match(sql,/revoke all on function public\.hand_over_sales_lead\(uuid,integer,uuid,text,text,date\) from public, anon;/);
 assert.match(sql,/grant execute on function public\.hand_over_sales_lead\(uuid,integer,uuid,text,text,date\) to authenticated;/);
 assert.match(sql,/create or replace function public\.handoff_lead\(\)[\s\S]*insert into public\.work_assignments/,'the existing lead handoff trigger puts it on the work list');
 assert.match(sql,/Use Hand over to give this lead to someone else/);
});
