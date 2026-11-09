// Disposable PostgreSQL only: actual notice definitions and current password/MFA gates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),STAFF=id(2),OTHER=id(3),HEAD=id(4),ABSENT=id(5);
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const definition=(sql,name)=>{
 const match=sql.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
 assert.ok(match,`Missing ${name} definition`);return match[0];
};
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS:',name);};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,encrypted_password text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
 create table auth.mfa_factors(user_id uuid,status text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb$$;
 create table public.staff(user_id uuid primary key,active boolean,role text,department text);
 create table public.accounting_memberships(user_id uuid primary key,active boolean);
 insert into auth.users(id,raw_app_meta_data) values('${OWNER}','{}'),('${STAFF}','{}'),('${OTHER}','{}'),('${HEAD}','{}'),('${ABSENT}','{}');
 insert into public.staff values('${OWNER}',true,'owner','management'),('${STAFF}',true,'staff','stores'),('${OTHER}',true,'staff','sales'),('${HEAD}',true,'head','stores');
 grant usage on schema public,auth to authenticated,anon;`);
 const gates=migration('202610010058_two_step_sign_in.sql');
 await db.exec(definition(gates,'mfa_satisfied'));
 await db.exec(definition(gates,'inventory_active_staff'));
 await db.exec(definition(gates,'inventory_owner'));
 await db.exec(migration('202610140080_require_two_step.sql'));
 await db.exec(migration('202610160099_password_replacement.sql'));
 const automatic=migration('202610010051_automatic_handoffs.sql');
 await db.exec(automatic.slice(automatic.indexOf('create table public.work_notices'),automatic.indexOf('-- Internal: hand a record')));
 await db.exec('revoke all on function public.dismiss_work_notice(uuid) from public,anon;grant execute on function public.dismiss_work_notice(uuid) to authenticated;');
 const seed=async(n,user)=>db.query("insert into public.work_notices(id,user_id,record_type,record_id,record_label,message) values($1,$2,'proforma',$3,'FIX-ORDER','Synthetic update')",[id(n),user,id(90)]);
 for(const [n,user] of [[101,OWNER],[102,STAFF],[103,OTHER],[104,HEAD],[105,ABSENT],[106,STAFF],[107,STAFF]])await seed(n,user);
 const as=async(actor,jwt={aal:'aal1'})=>{
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false),set_config('test.jwt',$2,false)",[actor||'',JSON.stringify(jwt)]);
  await db.exec('set role authenticated');
 };
 const admin=async(sql,args=[])=>{await db.exec('reset role');try{return await db.query(sql,args);}finally{await db.exec('set role authenticated');}};
 const rows=async()=>(await db.query('select id from public.work_notices order by id')).rows.map(row=>row.id);
 const dismiss=n=>db.query('select id from public.dismiss_work_notice($1)',[id(n)]);
 const verified={aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]};
 await check('Legacy recipient reads bypass active/password/MFA gates and inactive acknowledgement succeeds',async()=>{
  await as(STAFF);await admin('update public.staff set active=false where user_id=$1',[STAFF]);
  assert.deepEqual(await rows(),[id(102),id(106),id(107)]);
  assert.equal((await dismiss(106)).rows[0].id,id(106));
  await admin('update public.staff set active=true where user_id=$1',[STAFF]);
  await admin('update auth.users set raw_app_meta_data=$1 where id=$2',[{must_change_password:true},STAFF]);
  assert.deepEqual(await rows(),[id(102),id(106),id(107)]);
  await admin('update public.staff set active=false where user_id=$1',[STAFF]);
  await admin('update auth.users set raw_app_meta_data=$1 where id=$2',[{},STAFF]);
  await as(OWNER);assert.deepEqual(await rows(),[id(101)],'owner without required MFA still reads own notice');
 });
 await db.exec('reset role');
 const fix=migration('202611090165_work_notice_authorization.sql');await db.exec(fix);await db.exec(fix);
 const denied=async(actor,n,jwt)=>{
  await as(actor,jwt);assert.deepEqual(await rows(),[]);
  await assert.rejects(dismiss(n),error=>error.code==='42501'&&/Active staff and verified sign-in/.test(error.message));
 };
 await check('Inactive, missing-staff and missing-auth identities cannot read or acknowledge notices',async()=>{
  await denied(STAFF,102);await denied(ABSENT,105);await denied(null,102);
 });
 await check('Temporary credentials stay blocked even with recent verified MFA',async()=>{
  await admin('update public.staff set active=true where user_id=$1',[STAFF]);
  await admin('update auth.users set raw_app_meta_data=$1 where id=$2',[{must_change_password:true},STAFF]);
  await denied(STAFF,102,verified);
  await admin('update auth.users set raw_app_meta_data=$1 where id=$2',[{},STAFF]);
 });
 await check('Required MFA setup, unverified sessions and expired trust cannot read or acknowledge notices',async()=>{
  await denied(OWNER,101);
  await admin("insert into auth.mfa_factors values($1,'verified')",[OWNER]);
  await denied(OWNER,101);
  await denied(OWNER,101,{aal:'aal2'});
  await denied(OWNER,101,{aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-31*86400}]});
 });
 await check('Optional enrolled MFA still requires a verified current session',async()=>{
  await admin("insert into auth.mfa_factors values($1,'verified')",[STAFF]);
  await denied(STAFF,102);await as(STAFF,verified);
  assert.deepEqual(await rows(),[id(102),id(106),id(107)]);
 });
 await check('Active staff without optional MFA can read and acknowledge only their own notices',async()=>{
  await as(OTHER);assert.deepEqual(await rows(),[id(103)]);
  await assert.rejects(dismiss(102),/Notice not found or already read/);
  assert.equal((await dismiss(103)).rows[0].id,id(103));
  await assert.rejects(dismiss(103),/Notice not found or already read/);
  await assert.rejects(db.query('update public.work_notices set read_at=now() where id=$1',[id(103)]),/permission denied/);
 });
 await check('Heads do not gain cross-employee notice access',async()=>{
  await as(HEAD);assert.deepEqual(await rows(),[id(104)]);
  await assert.rejects(dismiss(107),/Notice not found or already read/);
  assert.equal((await dismiss(104)).rows[0].id,id(104));
 });
 await check('Verified owners retain read oversight but acknowledge only their own notices',async()=>{
  await as(OWNER,verified);assert.equal((await rows()).length,7);
  await assert.rejects(dismiss(107),/Notice not found or already read/);
  assert.equal((await dismiss(101)).rows[0].id,id(101));
 });
 await check('Anonymous execution stays denied and authenticated ACL remains narrow',async()=>{
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select * from public.work_notices'),/permission denied/);
  await assert.rejects(dismiss(107),/permission denied/);
  await db.exec('reset role');
  const row=(await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where proname='dismiss_work_notice'")).rows[0];
  assert.deepEqual(row,{prosecdef:true,anon:false,authenticated:true});
  assert.equal((await db.query('select read_at is null unread from public.work_notices where id=$1',[id(107)])).rows[0].unread,true);
 });
 console.log(`PASS: ${checks} work notice authorization checks; actual current password/MFA gates, recipient boundaries and legacy regression reproduction.`);
}finally{await db.close();}
