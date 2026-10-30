// Disposable PGlite fixture; PGLITE_MODULE points to the already installed module.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=id(1),b=id(2),inactive=id(3),denied=id(4),unknown=id(5),org=id(10),hiddenOrg=id(11),deletedOrg=id(12),pf=id(20);
const now='2026-10-29T21:30:00.000Z',today='2026-10-30',cutoff=Date.parse(now)-183*864e5;
const names={[a]:'Asha Sales',[b]:'Baraka Accounts'},roles=['doctor','head_of_department','procurement','management','biomedical','other'];
let actor=a,checks=0;
const list=async sql=>(await db.query(sql)).rows;
const page=async({query='',filter='all',page=0,names:directory=names,time=now}={})=>(await db.query('select public.sales_lead_page($1,$2,$3,$4::jsonb,$5) data',[query,filter,page,JSON.stringify(directory),time])).rows[0].data;
const ctx=vm.createContext({orgIndex:new Map(),me:{user_id:actor},employeeName:owner=>!owner?'Unassigned':ctx.names[owner]?.trim()||(owner===actor?'You':'Employee name not set')});
vm.runInContext(read('sales-leads.js'),ctx);
const visible=async()=>{
 const rows=(await list("select coalesce(jsonb_agg(to_jsonb(l)),'[]') data from sales_leads l"))[0].data;
 ctx.orgIndex=new Map((await list("select * from organizations where deleted_at is null")).map(row=>[row.id,row]));return rows;
};
async function parity({query='',filter='all',page:requested=0,names:directory=names,time=now}={},walk=false){
 const rows=await visible(),term=ctx.leadSearchTerm(query).toLowerCase(),since=Date.parse(time)-183*864e5;
 const scope=rows.filter(row=>!['won','lost'].includes(row.stage)||Date.parse(row.updated_at)>=since||(term.length>=3&&['lead_number','subject','caller_name','caller_phone','caller_organization'].some(key=>String(row[key]||'').toLowerCase().includes(term))));
 ctx.names=directory;const expected=ctx.leadVisibleRows(scope,{filter,search:query,actor,today});
 const counts=JSON.parse(JSON.stringify(ctx.leadCounts(scope,actor))),pages=Math.max(1,Math.ceil(expected.length/25));
 const result=await page({query,filter,page:requested,names:directory,time}),index=Math.min(requested,pages-1);
 assert.deepEqual(result.counts,counts,`counts for ${filter}/${query}`);assert.equal(result.total,expected.length,`total for ${filter}/${query}`);assert.equal(result.pages,pages);assert.equal(result.page,index);assert.equal(result.as_of,today);
 assert.deepEqual(result.rows.map(row=>row.id),expected.slice(index*25,index*25+25).map(row=>row.id),`page ordering for ${filter}/${query}`);
 for(const row of result.rows){const full=rows.find(item=>item.id===row.id);assert.equal(row.client_label,ctx.leadClientLabel(full));assert.equal(row.owner_user_id,full.owner_user_id);assert.deepEqual(Object.keys(row).sort(),['id','page_summary','lead_number','subject','stage','client_label','owner_user_id','next_action_on'].sort());assert.equal(row.page_summary,true);}
 if(walk){const ids=[];for(let p=0;p<pages;p++){const result=await page({query,filter,page:p,names:directory,time});assert.ok(result.rows.length<=25);ids.push(...result.rows.map(row=>row.id));}assert.equal(new Set(ids).size,ids.length);assert.deepEqual(ids,expected.map(row=>row.id));}
 checks++;return result;
}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,role text,active boolean,access text[]);
 create function mfa_satisfied() returns boolean language sql stable as $$select current_setting('test.mfa',true)='yes'$$;
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from staff where user_id=auth.uid() and active) and mfa_satisfied()$$;
 create table organizations(id uuid primary key,name text not null,location text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz);
 create table sales_proformas(id uuid primary key,organization_id uuid,deleted_at timestamptz);
 insert into auth.users values('${a}'),('${b}'),('${inactive}'),('${denied}'),('${unknown}');
 insert into staff values('${a}','owner',true,'{}'),('${b}','staff',true,'{leads}'),('${inactive}','staff',false,'{leads}'),('${denied}','staff',true,'{}');
 insert into organizations values('${org}','Current Clinic','Dar',null),('${hiddenOrg}','Hidden Clinic','Arusha',null),('${deletedOrg}','Deleted Clinic','Mwanza',now());
 insert into sales_proformas values('${pf}','${org}',null);
 set test.actor='${a}';set test.mfa='yes';`);
 // Actual lead table constraints and base policies; current area policy/function from migration 060.
 await db.exec(read('supabase/migrations/202609300042_sales_leads.sql'));
 const access=read('supabase/migrations/202610050060_department_heads_and_access.sql');
 await db.exec(access.slice(access.indexOf('create function public.has_access('),access.indexOf('create function public.require_access(')));
 await db.exec(`alter policy sales_leads_read on sales_leads using((select public.has_access('leads')));
 alter table sales_leads add column caller_role text not null default '' check(caller_role in('','doctor','head_of_department','procurement','management','biomedical','other'));
 alter table organizations enable row level security;create policy visible on organizations for select to authenticated using((select inventory_active_staff()));grant select on organizations to authenticated;`);
 const rows=Array.from({length:1507},(_,n)=>{
  const stage=['inquiry','lead','opportunity','won','lost'][n%5];
  return {id:id(1000+n),lead_number:'LD-'+String(n).padStart(6,'0'),stage,source:'phone',organization_id:[org,hiddenOrg,deletedOrg,null][n%4],caller_name:n%11?'Caller '+n:'',caller_phone:'0712345678',caller_organization:n%13?'Fallback Clinic':'',caller_role:roles[n%6],subject:'Analyzer quote '+n,details:'Private details needle '+n,estimated_value_minor:10000,currency:'TZS',owner_user_id:[a,b,null,unknown][n%4],next_action:'Call with a price',next_action_on:[null,'2026-10-01','2026-10-29','2026-10-30','2026-11-01'][n%5],lost_reason:stage==='lost'?'Price too high':'',proforma_id:stage==='won'?pf:null,version:1,created_by:a,created_at:new Date(Date.parse(now)-(n%10)*864e5).toISOString(),updated_at:new Date(Date.parse(now)-(n%4===0?200:30)*864e5).toISOString()};
 });
 // Every caller-only row must satisfy the actual lead identity constraint.
 for(const row of rows)if(!row.organization_id&&!row.caller_name)row.caller_name='Caller';
 for(let n=0;n<75;n++)rows.push({...rows[3],id:id(4000+n),lead_number:'LD-archive-'+n,subject:'ArchiveNeedle '+n,updated_at:'2020-01-01T00:00:00.000Z'});
 rows.push({...rows[3],id:id(4100),lead_number:'LD-boundary',subject:'Boundary recent',updated_at:new Date(cutoff).toISOString()});
 rows.push({...rows[3],id:id(4101),lead_number:'LD-before',subject:'Before recent',updated_at:new Date(cutoff-1).toISOString()});
 rows.push({...rows[3],id:id(4102),lead_number:'LD-literal',subject:'Literal % _ comma, plus+ dash- ção',updated_at:now});
 rows.push({...rows[3],id:id(4103),lead_number:'LD-unicode',subject:'Équipe déjà 東京',updated_at:'2020-01-01T00:00:00.000Z'});
 const columns=Object.keys(rows[0]);await db.query(`insert into sales_leads(${columns.join(',')}) select ${columns.join(',')} from jsonb_populate_recordset(null::sales_leads,$1::jsonb)`,[JSON.stringify(rows)]);
 await db.exec(read('supabase/migrations/202610290139_sales_lead_page.sql'));await db.exec('set role authenticated');
 const all=await parity({},true);assert.ok(all.total>1000);assert.ok(all.rows.length===25);
 for(const filter of ['open','new','mine','won','lost'])await parity({filter},true);
 await parity({page:1000000});await parity({query:'no match anywhere',page:15});
 for(const query of ['  analyzer quote  ','\tAsha Sales\t','\u00a0Baraka Accounts\u00a0','Asha Sales','Baraka Accounts','Unassigned','Employee name not set','Current Clinic · Dar','Doctor / user','Procurement / purchasing','Private details needle 125','Call with a price','%','_','comma,','plus+','dash-','ção','Équipe','東京','LD-boundary','LD-before'])await parity({query});
 const archived=await parity({query:'ArchiveNeedle'},true);assert.equal(archived.total,75,'archive matches are complete beyond the former 50-row search limit');assert.equal(archived.counts.all,all.counts.all+75,'archive scope is deterministic for this search');
 assert.equal((await page({query:'before recent'})).total,1,'an old row is reachable by explicit archive search');
 await parity({query:'You',names:{}});await parity({query:'Employee name not set',names:{}});await parity({query:'Asha Sales Call with a price'});
 const changedName=await parity({query:'Custom search only',names:{[a]:'Custom search only'}});assert.ok(changedName.total>0);assert.ok(!JSON.stringify(changedName).includes('Custom search only'),'supplied names never become output names');
 // A second active non-owner sees the same permitted data; Mine and fallback You follow auth.uid().
 actor=b;await db.exec(`set test.actor='${b}'`);await parity({filter:'mine'},true);await parity({query:'You',names:{}});
 // Extra restrictive RLS proves the invoker respects both lead and organization visibility, including counts/search.
 await db.exec(`reset role;create policy hide_lead on sales_leads as restrictive for select to authenticated using(id<>'${id(1000)}' and id<>'${id(4000)}');
 create policy hide_org on organizations as restrictive for select to authenticated using(id<>'${hiddenOrg}');set role authenticated`);
 await parity({},true);await parity({query:'ArchiveNeedle'},true);assert.equal((await parity({query:'Hidden Clinic'})).total,0);await parity({query:'Fallback Clinic'});await parity({query:'Custom search only',names:{[a]:'Custom search only',[denied]:'Forged access'}});
 // Supplied labels cannot grant access; inactive, absent, denied and insufficient-MFA sessions fail closed.
 for(const user of [inactive,denied,unknown]){await db.exec(`set test.actor='${user}'`);await assert.rejects(page({query:'Custom',names:{[user]:'Custom'}}),/Lead access is required/);checks++;}
 await db.exec(`set test.actor='${b}';set test.mfa='no'`);await assert.rejects(page(),/Lead access is required/);await db.exec("set test.mfa='yes'");checks++;
 const invalid=[{query:null},{query:'a'.repeat(2001)},{filter:null},{filter:'owner'},{page:null},{page:-1},{page:1000001},{time:null},{time:'infinity'},{time:'-infinity'},
  {names:null},{names:[]},{names:'bad'},{names:{bad:'Name'}},{names:{[a]:null}},{names:{[a]:123}},{names:{[a]:''}},{names:{[a]:'a'.repeat(121)}},
  {names:Object.fromEntries(Array.from({length:10001},(_,n)=>[id(n+10000),'A']))},{names:{[a]:'a'.repeat(2000001)}}];
 for(const args of invalid){await assert.rejects(page(args),/2000 characters|valid lead filter|valid lead page|valid lead time|search directory is invalid/);checks++;}
 await db.exec('reset role;set role anon');await assert.rejects(page(),/permission denied/);checks++;
 await db.exec('reset role');const metadata=(await list("select prosecdef,provolatile,proconfig from pg_proc where proname='sales_lead_page'"))[0];assert.equal(metadata.prosecdef,false);assert.equal(metadata.provolatile,'s');assert.ok(metadata.proconfig.includes('search_path=public, pg_temp'));checks++;
 const grants=(await list("select has_table_privilege('authenticated','sales_leads','update') writes,has_function_privilege('anon','sales_lead_page(text,text,integer,jsonb,timestamptz)','execute') anonymous"))[0];assert.deepEqual(grants,{writes:false,anonymous:false});assert.equal((await list('select count(*)::integer n from sales_leads'))[0].n,rows.length);checks++;
 await db.exec('create policy hide_all on sales_leads as restrictive for select to authenticated using(false);set role authenticated');await parity({});assert.equal((await page()).total,0);
 console.log(`PASS: ${checks} Leads page checks across ${rows.length} constrained records: original helper parity, complete paging/archive scope, literal/name/client search, local dates, bounded summaries, independent actor/area/MFA/RLS restrictions, malformed input and no writes.`);
}finally{await db.close();}
