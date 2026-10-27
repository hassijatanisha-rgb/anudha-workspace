// Disposable PGlite only. Actual profile, manager, name-audit and MFA/password SQL; synthetic Auth claims.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test,{after} from 'node:test';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),HEAD=id(2),PERSON=id(3),OTHER=id(4),INACTIVE=id(5),OUTSIDER=id(6),PENDING=id(7);
const migration=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const load=file=>db.exec(migration(file));
const loadFunction=async(file,name)=>{
 const definition=migration(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));
 assert.ok(definition,`${file}:${name}`);await db.exec(definition[0]);
};
const recent={aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]};
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,encrypted_password text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
 create table auth.mfa_factors(user_id uuid,status text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated,anon;
 create table staff(user_id uuid primary key references auth.users(id),active boolean not null,role text not null check(role in ('owner','head','staff')),access text[] not null default '{}');
 create table accounting_memberships(user_id uuid primary key,active boolean,approved_by uuid,approval_reference text);
 alter table staff enable row level security;grant select on staff to authenticated;`);
for(const fn of ['mfa_satisfied','inventory_active_staff','inventory_owner','is_owner'])await loadFunction('202610010058_two_step_sign_in.sql',fn);
for(const file of ['202609290040_staff_display_names.sql','202609300049_staff_accounts.sql','202610010054_staff_departments.sql','202610060064_owner_accounting_access.sql','202610140080_require_two_step.sql','202610160099_password_replacement.sql'])await load(file);
for(const fn of ['is_department_head','can_manage_staff','set_staff_display_name','audit_staff_display_name_change','set_staff_phone','record_staff_account_event'])await loadFunction('202610050060_department_heads_and_access.sql',fn);
await db.exec(`create policy staff_read on staff for select to authenticated using(user_id=auth.uid() or public.is_owner() or public.is_department_head());`);
for(let n=1;n<=7;n++)await db.query('insert into auth.users values($1,$2,$3,$4,$5)',[id(n),`fixture${n}@staff.fixture.invalid`,'fixture-hash',n===7?{must_change_password:true}:{},{employee_id:`fixture${n}`}]);
await db.exec(`insert into staff(user_id,active,role,department,access) values
 ('${OWNER}',true,'owner','management','{}'),('${HEAD}',true,'head','sales','{leads}'),
 ('${PERSON}',true,'staff','sales','{leads}'),('${OTHER}',true,'staff','stores','{stock}'),
 ('${INACTIVE}',false,'staff','sales','{leads}'),('${PENDING}',true,'staff','sales','{leads}');`);
await load('202610270125_staff_self_profile.sql');
const as=async(actor,sql,args=[],{role='authenticated',jwt=recent}={})=>{
 await db.query("select set_config('test.actor',$1,false),set_config('test.jwt',$2,false)",[actor||'',JSON.stringify(jwt)]);
 await db.exec(`set role ${role}`);try{return await db.query(sql,args)}finally{await db.exec('reset role')}
};
const get=async(actor=PERSON,options)=>(await as(actor,'select public.get_my_staff_profile() result',[],options)).rows[0].result;
const expected=profile=>Object.fromEntries(['display_name','name_version','phone','contact_email'].map(key=>[key,profile[key]]));
const values=profile=>Object.fromEntries(['display_name','phone','contact_email'].map(key=>[key,profile[key]]));
const save=async(actor,before,next,options)=>(await as(actor,'select public.save_my_staff_profile($1::jsonb,$2::jsonb) result',[JSON.stringify(before),JSON.stringify(next)],options)).rows[0].result;
const snapshot=async()=>(await db.query(`select jsonb_build_object('staff',(select jsonb_agg(s order by user_id) from staff s),'names',(select jsonb_agg(n order by id) from staff_display_name_events n),'events',(select jsonb_agg(e order by id) from staff_account_events e)) result`)).rows[0].result;
const authBefore=(await db.query('select * from auth.users order by id')).rows;
after(()=>db.close());

test('profile RPCs expose only the caller and the seven agreed fields',async()=>{
 const profile=await get();assert.deepEqual(Object.keys(profile).sort(),['contact_email','department','display_name','name_version','phone','role','user_id']);
 assert.equal(profile.user_id,PERSON);assert.equal(profile.display_name,null);assert.equal(profile.contact_email,'');
 assert.equal((await get(OTHER)).user_id,OTHER);
 const privileges=(await db.query(`select has_function_privilege('anon','get_my_staff_profile()','execute') anon_get,has_function_privilege('anon','save_my_staff_profile(jsonb,jsonb)','execute') anon_save,has_function_privilege('service_role','get_my_staff_profile()','execute') service_get,has_table_privilege('authenticated','staff','update') direct_update`)).rows[0];
 assert.deepEqual(privileges,{anon_get:false,anon_save:false,service_get:false,direct_update:false});
});

test('self save normalizes contact fields, increments name history and preserves assigned access',async()=>{
 const before=await get(),saved=await save(PERSON,expected(before),{display_name:'  Fictional Employee  ',phone:'+255 (700) 000-003',contact_email:'  TEAM@EXAMPLE.COM  '});
 assert.equal(saved.display_name,'Fictional Employee');assert.equal(saved.name_version,1);assert.equal(saved.phone,'+255700000003');assert.equal(saved.contact_email,'team@example.com');
 assert.equal(saved.role,'staff');assert.equal(saved.department,'sales');
 assert.deepEqual((await db.query('select access from staff where user_id=$1',[PERSON])).rows[0].access,['leads']);
 const audit=(await db.query('select old_display_name,new_display_name,old_name_version,new_name_version,actor_user_id from staff_display_name_events where user_id=$1',[PERSON])).rows;
 assert.deepEqual(audit,[{old_display_name:null,new_display_name:'Fictional Employee',old_name_version:0,new_name_version:1,actor_user_id:PERSON}]);
 assert.deepEqual((await db.query('select action,actor_user_id from staff_account_events where user_id=$1 order by action',[PERSON])).rows,[{action:'contact_email_changed',actor_user_id:PERSON},{action:'phone_changed',actor_user_id:PERSON}]);
});

test('normalized no-op saves are safe and shared contact emails are allowed',async()=>{
 const mine=await get(),before=await snapshot();assert.deepEqual(await save(PERSON,expected(mine),{...values(mine),phone:'+255 700 000 003',contact_email:'TEAM@example.com'}),mine);assert.deepEqual(await snapshot(),before);
 const other=await get(OTHER),saved=await save(OTHER,expected(other),{display_name:'Other Fixture',phone:'',contact_email:mine.contact_email});assert.equal(saved.contact_email,mine.contact_email);
 const cleared=await save(OTHER,expected(saved),{...values(saved),contact_email:''});assert.equal(cleared.contact_email,'');assert.equal(cleared.name_version,1);
});

test('anonymous, inactive, absent and unfinished-password identities fail closed',async()=>{
 const mine=await get();
 for(const actor of [null,INACTIVE,OUTSIDER,PENDING]){
  await assert.rejects(get(actor),/Active staff and verified/);
  await assert.rejects(save(actor,expected(mine),values(mine)),/Active staff and verified/);
 }
 for(const role of ['anon','service_role']){
  await assert.rejects(get(PERSON,{role}),/permission denied/);
  await assert.rejects(save(PERSON,expected(mine),values(mine),{role}),/permission denied/);
 }
});

test('MFA setup, current verified factor and thirty-day trust gates remain enforced',async()=>{
 const mine=await get();
 await assert.rejects(get(OWNER,{jwt:{aal:'aal1'}}),/Active staff and verified/);
 await db.query('insert into auth.mfa_factors values($1,$2)',[PERSON,'verified']);
 for(const jwt of [{aal:'aal1'},{aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-31*86400}]}]){
  await assert.rejects(get(PERSON,{jwt}),/Active staff and verified/);
  await assert.rejects(save(PERSON,expected(mine),values(mine),{jwt}),/Active staff and verified/);
 }
 assert.equal((await get()).user_id,PERSON);await db.query('delete from auth.mfa_factors where user_id=$1',[PERSON]);
});

test('a different identity cannot submit another employee target or privileged fields',async()=>{
 const mine=await get(),before=await snapshot();
 for(const [key,value] of Object.entries({user_id:OTHER,role:'owner',department:'accounts',active:true,access:['stock'],name_version:99,email:'login@example.com',password:'unused-fixture-value'}))
  await assert.rejects(save(PERSON,expected(mine),{...values(mine),[key]:value}),/Only display name/);
 await assert.rejects(save(OTHER,expected(mine),values(mine)),/profile changed/);
 await assert.rejects(as(PERSON,'update staff set phone=$1 where user_id=$2',['+255700000004',OTHER]),/permission denied/);
 assert.deepEqual(await snapshot(),before);
});

test('invalid shapes, missing expected fields and invalid contact values leave no changes',async()=>{
 const mine=await get(),before=await snapshot();
 for(const invalid of [null,[],{},'profile'])await assert.rejects(save(PERSON,expected(mine),invalid),/required|Only display name/);
 for(const invalid of [null,[],{}, {...expected(mine),user_id:PERSON},{...expected(mine),name_version:'1'},{...expected(mine),name_version:-1}])await assert.rejects(save(PERSON,invalid,values(mine)),/required|format/);
 for(const display_name of ['',null,42,' '.repeat(4),'界'.repeat(121)])await assert.rejects(save(PERSON,expected(mine),{...values(mine),display_name}),/Display name|format/);
 for(const phone of [null,123,'0700000003','+255ABC00003','+1234567','+1234567890123456',' '.repeat(25)])await assert.rejects(save(PERSON,expected(mine),{...values(mine),phone}),/phone|format/);
 for(const contact_email of [null,42,'missing-at.example.com','two@@example.com','has space@example.com','name@-invalid.example','name@example..com','x'.repeat(243)+'@example.com'])await assert.rejects(save(PERSON,expected(mine),{...values(mine),contact_email}),/contact email|format/);
 assert.deepEqual(await snapshot(),before);
});

test('a stale name, version, phone or contact email is rejected without overwriting newer data',async()=>{
 const mine=await get();
 for(const patch of [{display_name:'stale'},{name_version:0},{phone:'+255700000099'},{contact_email:'stale@example.com'}])await assert.rejects(save(PERSON,{...expected(mine),...patch},values(mine)),/profile changed/);
 const phoneOld=await get();await as(OWNER,'select set_staff_phone($1,$2)',[PERSON,'+255700000033']);
 await assert.rejects(save(PERSON,expected(phoneOld),{...values(phoneOld),display_name:'Must not overwrite'}),/profile changed/);
 const nameOld=await get();await as(HEAD,'select set_staff_display_name($1,$2,$3)',[PERSON,nameOld.name_version,'Manager-approved Name']);
 await assert.rejects(save(PERSON,expected(nameOld),{...values(nameOld),phone:''}),/profile changed/);
 const current=await get();assert.equal(current.phone,'+255700000033');assert.equal(current.display_name,'Manager-approved Name');
});

test('owner and head management remain available only within their existing boundaries',async()=>{
 const current=await get();await as(OWNER,'select set_staff_display_name($1,$2,$3)',[PERSON,current.name_version,'Owner-approved Name']);
 await as(HEAD,'select set_staff_phone($1,$2)',[PERSON,'+255700000044']);
 const other=await get(OTHER);await assert.rejects(as(HEAD,'select set_staff_display_name($1,$2,$3)',[OTHER,other.name_version,'Wrong department']),/department head access/);
 await assert.rejects(as(HEAD,'select set_staff_phone($1,$2)',[OTHER,'+255700000055']),/department head access/);
 await assert.rejects(as(PERSON,'select set_staff_display_name($1,$2,$3)',[OTHER,other.name_version,'Another person']),/department head access/);
 const ownHead=await get(HEAD),saved=await save(HEAD,expected(ownHead),{display_name:'Head Fixture',phone:'',contact_email:''});assert.equal(saved.role,'head');assert.equal(saved.department,'sales');
});

test('audit failure rolls the entire profile back and history remains immutable',async()=>{
 const mine=await get(),before=await snapshot();
 await db.exec("create function fixture_profile_audit_fail() returns trigger language plpgsql as $$begin raise exception 'Injected audit failure';end$$;create trigger fixture_profile_audit_fail before insert on staff_account_events for each row execute function fixture_profile_audit_fail()");
 await assert.rejects(save(PERSON,expected(mine),{display_name:'Must roll back',phone:'+255700000066',contact_email:'rollback@example.com'}),/Injected audit failure/);assert.deepEqual(await snapshot(),before);
 await db.exec('drop trigger fixture_profile_audit_fail on staff_account_events');
 for(const table of ['staff_display_name_events','staff_account_events'])for(const sql of [`delete from ${table}`,`truncate ${table}`])await assert.rejects(db.exec(sql),/immutable/);
});

test('saving contact details preserves current assigned department, role and Auth identity',async()=>{
 const mine=await get();await as(OWNER,'select set_staff_department($1,$2)',[PERSON,'service']);
 const saved=await save(PERSON,expected(mine),{...values(mine),contact_email:'personal@example.com'});
 assert.equal(saved.role,'staff');assert.equal(saved.department,'service');
 assert.deepEqual((await db.query('select * from auth.users order by id')).rows,authBefore);
 assert.equal((await db.query('select count(*)::int n from auth.mfa_factors')).rows[0].n,0);
});
