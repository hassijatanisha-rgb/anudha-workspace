// Disposable PostgreSQL fixture; no network or ERP connection.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let checks=0;const check=async fn=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select current_setting('test.actor')::uuid$$;
 create function inventory_active_staff() returns boolean language sql stable as $$select current_setting('test.active')='yes' and current_setting('test.mfa')='yes'$$;
 create function has_access(area text) returns boolean language sql stable as $$select inventory_active_staff() and (current_setting('test.access')='owner' or area=current_setting('test.access'))$$;
 create table customer_requests(id uuid primary key,request_number text,kind text,status text,name text,phone text,email text,organization text,product text,message text,assigned_user_id uuid,created_at timestamptz,updated_at timestamptz);
 alter table customer_requests enable row level security;grant select on customer_requests to authenticated;grant usage on schema auth to authenticated;
 set test.active='yes';set test.mfa='yes';set test.access='owner';set test.actor='${id(9991)}';`);
 const original=read('supabase/migrations/202610060062_customer_requests.sql');
 await db.exec(original.match(/create policy customer_requests_read[\s\S]*?;/)[0]);
 await db.exec(read('supabase/migrations/202610290141_customer_request_page.sql'));
 await db.exec('begin');const now=(await db.query('select now() as value')).rows[0].value,at=days=>new Date(Date.parse(now)+days*86400000).toISOString();
 const rows=Array.from({length:1108},(_,n)=>({id:id(n+1),request_number:'REQ-'+String(n+1).padStart(5,'0'),kind:n<1060?'inquiry':['complaint','quote','support'][n%3],status:['received','in_progress','resolved','closed'][n%4],name:n%5?'Example client '+n:'Special <client>',phone:'0712345678',email:'example@invalid.test',organization:'Clinic '+n%13,product:'Machine '+n%8,message:'Private message '+n+' '+('Long narrative '.repeat(100)),assigned_user_id:n%3?id(9991):id(9992),created_at:at(-n%80),updated_at:at(-n%200)}));
 rows[2].updated_at=at(-183);rows[3].updated_at=at(-183.00001);
 await db.query(`insert into customer_requests select * from jsonb_to_recordset($1::jsonb) as x(id uuid,request_number text,kind text,status text,name text,phone text,email text,organization text,product text,message text,assigned_user_id uuid,created_at timestamptz,updated_at timestamptz)`,[JSON.stringify(rows)]);
 await db.query("update customer_requests set updated_at=now()-interval '183 days' where id=$1",[id(3)]);
 await db.exec('set role authenticated');
 const context=vm.createContext({});vm.runInContext(read('customer-requests.js'),context);
 const scope=rows.filter(row=>['received','in_progress'].includes(row.status)||Date.parse(row.updated_at)>Date.parse(at(-183))||row.id===id(3));
 const denied=async(fn,pattern)=>{await db.exec('savepoint denial');await assert.rejects(fn(),pattern);await db.exec('rollback to denial');};
 const page=async(section='inquiries',filter='all',query='',number=0)=>(await db.query('select customer_request_page($1,$2,$3,$4) result',[section,filter,query,number])).rows[0].result;
 await check(async()=>{const first=await page();assert.equal(first.rows.length,25);assert.ok(first.total>1000);assert.ok(!JSON.stringify(first).includes('Private message'));assert.ok(!JSON.stringify(first).includes('0712345678'));assert.deepEqual(Object.keys(first.rows[0]).sort(),['id','request_number','kind','status','name','organization','created_at'].sort());});
 await check(async()=>{for(const section of ['inquiries','complaints'])for(const filter of ['all','open','new','mine','done'])for(const query of ['','Special','\tSpecial\n','\u00a0Special\u00a0','Machine 7','Private message 37','%','needle missing']){
  const expected=Array.from(context.requestVisible(scope.sort((a,b)=>a.id.localeCompare(b.id)),{section,filter,search:query,actor:id(9991)}),row=>row.id),result=await page(section,filter,query);
  assert.equal(result.total,expected.length,`${section}/${filter}/${query}`);assert.deepEqual(result.rows.map(row=>row.id),expected.slice(0,25));
 }});
 await check(async()=>{const first=await page(),found=[];for(let n=0;n<first.pages;n++)found.push(...(await page('inquiries','all','',n)).rows.map(row=>row.id));assert.equal(found.length,first.total);assert.equal(new Set(found).size,first.total);assert.equal((await page('inquiries','all','',1000000)).page,first.pages-1);});
 await check(async()=>{const result=await page();for(const filter of ['all','open','new','mine','done'])assert.equal(result.counts[filter],context.requestVisible(scope,{section:'inquiries',filter,search:'',actor:id(9991)}).length);});
 await check(async()=>{await db.exec("set test.access='service'");assert.equal((await page()).total,0);assert.ok((await page('complaints')).total>0);await db.exec("set test.access='leads'");assert.ok((await page()).total>1000);await db.exec("set test.access='travel'");await denied(page,/access is required/);await db.exec("set test.access='owner'");});
 await check(async()=>{for(const flag of ['active','mfa']){await db.exec(`set test.${flag}='no'`);await denied(page,/access is required/);await db.exec(`set test.${flag}='yes'`);}});
 await check(async()=>{const before=(await page()).total;await db.exec(`reset role;create policy hide_one on customer_requests as restrictive for select to authenticated using(id<>'${id(1)}');set role authenticated`);const after=await page();assert.equal(after.total,before-1);assert.ok(!after.rows.some(row=>row.id===id(1)));});
 await check(async()=>{for(const args of [[null,'all','',0],['wrong','all','',0],['inquiries','bad','',0],['inquiries','all',null,0],['inquiries','all','a'.repeat(2001),0],['inquiries','all','',-1],['inquiries','all','',null]]){
  await db.exec('savepoint invalid');await assert.rejects(page(...args),/Choose|Search/);await db.exec('rollback to invalid');
 }});
 await check(async()=>{assert.equal((await page('inquiries','all','REQ-00003')).total,1);assert.equal((await page('inquiries','all','REQ-00004')).total,0);});
 await db.exec('rollback');
 await check(async()=>{await db.exec('reset role;set role anon');await assert.rejects(page(),/permission denied/);await db.exec('reset role');const metadata=(await db.query("select prosecdef,provolatile from pg_proc where proname='customer_request_page'")).rows[0];assert.deepEqual(metadata,{prosecdef:false,provolatile:'s'});});
 console.log(`PASS: ${checks} customer-request database checks; 1108 records, complete traversal, filter/search/count parity, 183-day boundary, original RLS, inactive/MFA and anonymous denial.`);
}finally{await db.close();}
