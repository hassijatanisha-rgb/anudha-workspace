// Disposable fixtures only. BUSINESS_CONTACTS_POSTGRES=1 also exercises two real overlapping sessions
// through a private local fixture socket; no URL, remote host or live database is accepted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const name='202611040161_organization_business_contacts.sql',real=process.env.BUSINESS_CONTACTS_POSTGRES==='1';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),EDITOR=id(2),READER=id(3),INACTIVE=id(4),PENDING=id(5),ORG=id(101),BRANCH=id(102),ARCHIVED=id(103);
let db,root,Client,config,database,checks=0,sequence=1000;const sessions=[];
if(real){
 ({Client}= (await import(new URL('../../accounting-concurrency-deps/node_modules/pg/lib/index.js',import.meta.url).href)).default);
 config={host:'/private/tmp/anudha-business-contacts-pg-20261104',port:55441,user:'tanisha'};
 database=`anudha_business_contacts_test_nov4_${process.pid}`;
 root=new Client({...config,database:'postgres'});await root.connect();
 await root.query(`create database ${database} template template0 encoding 'UTF8'`);
 await root.query(`comment on database ${database} is 'Disposable Codex business-contact fixture 2026-11-04'`);
 const connection=new Client({...config,database});await connection.connect();
 db={query:(...args)=>connection.query(...args),exec:sql=>connection.query(sql),close:()=>connection.end()};
}else{const {PGlite}=await import(process.env.PGLITE_MODULE);db=new PGlite();}
const fresh=()=>id(sequence++),one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const recent={aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]};
const as=async(actor=EDITOR,jwt=recent)=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false),set_config('test.jwt',$2,false)",[actor||'',JSON.stringify(jwt)]);await db.exec('set role authenticated');};
const admin=async(sql,args=[])=>{await db.exec('reset role');try{return await db.query(sql,args);}finally{await db.exec('set role authenticated');}};
const loadFunction=async(file,fn)=>{const found=migration(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${fn}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));assert.ok(found,fn);await db.exec(found[0]);};
const values=extra=>({request:fresh(),organization:ORG,version:0,emails:[],phones:[],website:'',physical:'',postal:'',source:'',checked:null,note:'Published fixture information',...extra});
const query=v=>({text:'select * from save_organization_business_contacts($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11)',values:[v.request,v.organization,v.version,v.emails===undefined?null:JSON.stringify(v.emails),v.phones===undefined?null:JSON.stringify(v.phones),v.website,v.physical,v.postal,v.source,v.checked,v.note]});
const save=async v=>{const q=query(v);return one(q.text,q.values);};
const current=async(organization=ORG)=>(await db.query('select * from organization_business_contacts($1)',[organization])).rows;
const check=async(label,fn)=>{await as();await fn();checks++;console.log('PASS '+label);};
const count=async()=>(await one('select count(*)::int n from organization_business_contact_versions')).n;
try{
 await db.exec(`do $roles$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 end $roles$;create schema auth;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
 create table auth.mfa_factors(user_id uuid,status text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated,anon;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table accounting_memberships(user_id uuid,active boolean);
 create table organizations(id uuid primary key,name text,location text,type text,parent_id uuid,deleted_at timestamptz,source jsonb);
 create table contacts(id uuid primary key,organization_id uuid,first_name text,email text,source jsonb);
 insert into auth.users values('${OWNER}','{}'),('${EDITOR}','{}'),('${READER}','{}'),('${INACTIVE}','{}'),('${PENDING}','{"must_change_password":true}');
 insert into staff values('${OWNER}',true,'owner','management','{}'),('${EDITOR}',true,'staff','sales','{records}'),('${READER}',true,'staff','sales','{}'),('${INACTIVE}',false,'staff','sales','{records}'),('${PENDING}',true,'staff','sales','{records}');
 insert into organizations values('${ORG}','Fixture Hospital','Original city','Hospital',null,null,'{"original":"unchanged"}'),('${BRANCH}','Fixture Branch','Branch city','Clinic','${ORG}',null,'{}'),('${ARCHIVED}','Archived Fixture','Old city','Clinic',null,now(),'{}');
 insert into contacts values('${id(201)}','${ORG}','Existing Person','person@example.invalid','{"original":"unchanged"}');`);
 for(const [file,fn] of [
  ['202610140080_require_two_step.sql','two_step_required'],['202610160099_password_replacement.sql','password_change_satisfied'],
  ['202610160099_password_replacement.sql','mfa_satisfied'],['202610010058_two_step_sign_in.sql','inventory_active_staff'],
  ['202610050060_department_heads_and_access.sql','has_access'],['202610070071_clients_items_records_access.sql','require_access'],
  ['202609210004_proforma_delivery_workflow.sql','deny_sales_history_mutation']])await loadFunction(file,fn);
 await db.exec(`alter table organizations enable row level security;grant select on organizations to authenticated;
 create policy organizations_read on organizations for select to authenticated using(inventory_active_staff());`);
 const originals=await one("select jsonb_build_object('organizations',(select jsonb_agg(o order by id) from organizations o),'contacts',(select jsonb_agg(c order by id) from contacts c)) data");
 await db.exec(migration(name));await db.exec(migration('202611040162_business_contact_source_day.sql'));let first,second;
 await check('partial unknown fields, multiple purpose-labelled channels and first version attribution',async()=>{
  assert.deepEqual(await current(),[]);
  const v=values({emails:[{value:'  info@example.invalid ',purpose:' General '},{value:'admissions@example.invalid'}],phones:[{value:'+255 (22) 123-4567',purpose:'Admissions'},{value:'112',purpose:'Emergency'}],postal:' P.O. Box 42 ',source:' https://example.invalid/contact ',checked:(await one('select current_date::text d')).d});
  first={request:v,row:await save(v)};assert.equal(first.row.version,1);assert.equal(first.row.id,v.request);assert.equal(first.row.created_by,EDITOR);assert.ok(first.row.created_at);
  assert.deepEqual(first.row.emails,[{value:'info@example.invalid',purpose:'General'},{value:'admissions@example.invalid',purpose:''}]);
  assert.equal(first.row.phones[0].value,'+255 (22) 123-4567');assert.equal(first.row.physical_address,'');assert.equal(first.row.postal_address,'P.O. Box 42');assert.equal((await current())[0].id,v.request);
 });
 await check('exact normalized retry, actor attribution and complete payload/version comparison',async()=>{
  assert.deepEqual(await save({...first.request,emails:first.row.emails,postal:'P.O. Box 42',source:first.row.source_url}),first.row);
  for(const change of [{version:1},{organization:BRANCH},{emails:[{value:'different@example.invalid'}]},{phones:[{value:'113'}]},{website:'https://different.invalid'},{physical:'Different place'},{postal:'Different box'},{source:'https://other.invalid'},{checked:null},{note:'Different evidence'}])await assert.rejects(save({...first.request,...change}),/already saved with different details/);
  await as(OWNER);await assert.rejects(save(first.request),/already saved with different details/);assert.equal(await count(),1);
 });
 await check('new snapshot supersedes current without editing prior history; old exact receipt cannot roll back current',async()=>{
  second=await save(values({version:1,physical:'Verified physical address',note:'Address corrected from official contact page'}));assert.equal(second.version,2);assert.deepEqual(second.emails,[]);
  assert.equal((await current())[0].id,second.id);assert.equal((await save(first.request)).id,first.row.id);assert.equal((await current())[0].id,second.id);
  assert.deepEqual((await db.query('select * from organization_business_contact_versions where id=$1',[first.row.id])).rows[0],first.row);
  const result=await save(values({organization:BRANCH,postal:'Branch postal box'}));assert.equal(result.version,1);assert.equal((await current(BRANCH))[0].postal_address,'Branch postal box');assert.equal((await current())[0].physical_address,'Verified physical address');
 });
 await check('stale/null/negative identities and archived/missing customers fail atomically',async()=>{
  const before=await count();for(const change of [{version:0},{version:1}])await assert.rejects(save(values(change)),e=>e.code==='40001');
  for(const change of [{version:null},{version:-1},{version:2147483647},{request:null},{organization:null}])await assert.rejects(save(values(change)),/identity and current version/);
  for(const organization of [ARCHIVED,id(999)])await assert.rejects(save(values({organization})),/existing active customer/);assert.deepEqual(await current(ARCHIVED),[]);assert.equal(await count(),before);
 });
 await check('channel structure, limits, email/phone syntax and unknown keys are validated',async()=>{
  const badEmails=[{},null,['raw@example.invalid'],[{value:12}],[{value:null}],[{value:'valid@example.invalid',purpose:null}],[{value:'valid@example.invalid',extra:'untrusted'}],[{value:'bad'}],[{value:' a @b.invalid'}],[{value:'x'.repeat(255)+'@x.invalid'}],Array.from({length:21},()=>({value:'a@b.invalid'})),[{value:'a@b.invalid',purpose:'x'.repeat(121)}]];
  const before=await count();for(const emails of badEmails)await assert.rejects(save(values({version:2,emails})),/business|channel|purpose/);
  for(const phones of [[{value:''}],[{value:'++ ()'}],[{value:'tel:123'}],[{value:'abc123'}],[{value:'1'.repeat(81)}],{}])await assert.rejects(save(values({version:2,phones})),/business|channel/);
  assert.equal(await count(),before);
 });
 await check('safe links, bounded evidence/addresses and finite nonfuture source dates',async()=>{
  const before=await count();for(const change of [{website:'javascript:alert(1)'},{source:'data:text/html,test'},{website:'https://user:pass@example.invalid'},{source:'https://example.invalid/has space'},{website:'https://'},{source:'https://example.invalid/'+'x'.repeat(2000)},{physical:'x'.repeat(1001)},{postal:'x'.repeat(1001)},{note:''},{note:'tiny'},{note:'x'.repeat(2001)},{checked:'infinity'},{checked:'-infinity'},{checked:(await one("select ((now() at time zone 'Africa/Dar_es_Salaam')::date+1)::text d")).d}])await assert.rejects(save(values({version:2,...change})),/URL|address|evidence|source-check/);
  assert.equal(await count(),before);
 });
 await check('source dates follow Tanzania today independently of the database session timezone',async()=>{
  const before=await count();let differentDay=false;await db.exec('begin');
  try{
   const dates=await one("select (now() at time zone 'Africa/Dar_es_Salaam')::date::text today,((now() at time zone 'Africa/Dar_es_Salaam')::date+1)::text tomorrow");
   for(const zone of ['Etc/GMT+12','Pacific/Kiritimati']){
    await db.query("select set_config('TimeZone',$1,true)",[zone]);differentDay||=(await one('select current_date::text d')).d!==dates.today;
    await db.exec('savepoint source_day');const saved=await save(values({version:2,checked:dates.today}));assert.equal((await one('select source_checked_on::text d from organization_business_contact_versions where id=$1',[saved.id])).d,dates.today);await db.exec('rollback to savepoint source_day');
    await assert.rejects(save(values({version:2,checked:dates.tomorrow})),/source-check/);await db.exec('rollback to savepoint source_day');
   }
   assert.equal(differentDay,true,'The boundary fixture must include a different session civil day');
  }finally{await db.exec('rollback');}
  assert.equal(await count(),before);
 });
 await check('active readers can read but only existing records editors/owners can save',async()=>{
  await as(READER);assert.equal((await current())[0].version,2);await assert.rejects(save(values({version:2})),/Clients & items data/);
  await as(OWNER);assert.equal((await save(values({organization:BRANCH,version:1,note:'Owner checked branch evidence'}))).created_by,OWNER);
  for(const actor of [INACTIVE,PENDING,id(999),null]){await as(actor);await assert.rejects(current(),/Active staff/);await assert.rejects(save(values({version:2})),/Active staff/);assert.equal(await count(),0);}
 });
 await check('MFA, thirty-day trust and first-login gates use current application access functions',async()=>{
  await as(OWNER,{aal:'aal1'});await assert.rejects(current(),/Active staff/);await assert.rejects(save(values({version:2})),/Active staff/);
  await admin('insert into auth.mfa_factors values($1,$2)',[EDITOR,'verified']);
  for(const jwt of [{aal:'aal1'},{aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-31*86400}]}]){await as(EDITOR,jwt);await assert.rejects(current(),/Active staff/);await assert.rejects(save(values({version:2})),/Active staff/);}
  await as();assert.equal((await current()).length,1);
 });
 await check('caller RLS and archived parent hide both current and history reads',async()=>{
  await admin(`create policy hidden_customer on organizations as restrictive for select to authenticated using(id<>'${ORG}')`);
  assert.deepEqual(await current(),[]);assert.equal((await db.query('select * from organization_business_contact_versions where organization_id=$1',[ORG])).rows.length,0);
  await admin('drop policy hidden_customer on organizations');await admin('update organizations set deleted_at=now() where id=$1',[ORG]);
  assert.deepEqual(await current(),[]);assert.equal((await db.query('select * from organization_business_contact_versions where organization_id=$1',[ORG])).rows.length,0);await assert.rejects(save(values({version:2})),/active customer/);
  await admin('update organizations set deleted_at=null where id=$1',[ORG]);
 });
 await check('history is append-only even for privileged direct mutation; no user table writes',async()=>{
  for(const sql of ["update organization_business_contact_versions set evidence_note='Tampered evidence'",'delete from organization_business_contact_versions','truncate organization_business_contact_versions']){
   await assert.rejects(db.exec(sql),/permission denied/);await assert.rejects(admin(sql),/immutable/);
  }
  await assert.rejects(db.query('insert into organization_business_contact_versions select * from organization_business_contact_versions'),/permission denied/);
 });
 await check('anonymous/service-role denial, invoker read, fixed search paths and unchanged CRM rows',async()=>{
  for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(current(),/permission denied/);await assert.rejects(save(values({version:2})),/permission denied/);await assert.rejects(db.query('select * from organization_business_contact_versions'),/permission denied/);}
  await as();const meta=(await db.query("select proname,prosecdef,proconfig from pg_proc where proname in ('organization_business_contacts','save_organization_business_contacts') order by proname")).rows;
  assert.equal(meta[0].prosecdef,false);assert.equal(meta[1].prosecdef,true);assert(meta.every(p=>p.proconfig.includes('search_path=public, pg_temp')));
  assert.equal((await one("select has_table_privilege('authenticated','organizations','update') or has_table_privilege('authenticated','contacts','insert,update,delete') allowed")).allowed,false);
  const after=(await admin("select jsonb_build_object('organizations',(select jsonb_agg(o order by id) from organizations o),'contacts',(select jsonb_agg(c order by id) from contacts c)) data")).rows[0];assert.deepEqual(after,originals);
 });
 if(real){
  const connect=async()=>{const c=new Client({...config,database});await c.connect();sessions.push(c);await c.query("set statement_timeout='10s';set lock_timeout='7s';set role authenticated");await c.query("select set_config('test.actor',$1,false),set_config('test.jwt',$2,false)",[EDITOR,JSON.stringify(recent)]);return c;};
  const a=await connect(),b=await connect(),gate=new Client({...config,database});await gate.connect();sessions.push(gate);
  const race=async(label,left,right,successes)=>{
   await gate.query('begin');await gate.query('select 1 from organizations where id=$1 for update',[left.organization]);
   const invoke=(client,v)=>client.query(query(v)).then(r=>({ok:true,row:r.rows[0]}),e=>({ok:false,code:e.code,message:e.message}));
   const pending=[invoke(a,left),invoke(b,right)];let blocked=0;
   for(let i=0;i<60;i++){blocked=Number((await gate.query("select count(*) n from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'",[[a.processID,b.processID]])).rows[0].n);if(blocked===2)break;await new Promise(resolve=>setTimeout(resolve,20));}
   await gate.query('commit');const results=await Promise.all(pending);assert.equal(blocked,2,'both saves overlapped while waiting for the authoritative customer lock');assert.equal(results.filter(r=>r.ok).length,successes);assert(results.every(r=>!['40P01','55P03','57014'].includes(r.code)));checks++;console.log('PASS '+label);return results;
  };
  const oneRequest=values({version:2,postal:'Race postal address'}),replayed=await race('two-session exact retry appends once and returns the same audited version',oneRequest,oneRequest,2);assert.equal(replayed[0].row.id,replayed[1].row.id);
  const competing=await race('two-session competing revisions permit one winner and reject stale work',values({version:3,physical:'First concurrent address'}),values({version:3,physical:'Second concurrent address'}),1);assert.equal(competing.find(r=>!r.ok).code,'40001');
  const other=id(301);await admin('insert into organizations(id,name,source) values($1,$2,$3)',[other,'Concurrent first-save fixture',{}]);
  const creating=await race('two-session first creation cannot fork version one',values({organization:other,physical:'First new address'}),values({organization:other,physical:'Second new address'}),1);assert.equal(creating.find(r=>!r.ok).code,'40001');
 }
 console.log(`${checks} business-contact database checks passed (${real?'PostgreSQL with 3 actual two-session races':'PGlite; lock contention not exercised'}).`);
}finally{
 for(const session of sessions)await session.end().catch(()=>{});if(db)await db.close();
 if(root){const mark=(await root.query("select shobj_description(oid,'pg_database') marker from pg_database where datname=$1",[database])).rows[0]?.marker;assert.equal(mark,'Disposable Codex business-contact fixture 2026-11-04');await root.query(`drop database ${database}`);await root.end();}
}
