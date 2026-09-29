import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
const source=process.env.SOURCE_ROOT||fileURLToPath(new URL('..',import.meta.url));
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,encrypted_password text);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text);create table products(id uuid primary key,name text);create table organizations(id uuid primary key);create table contacts(id uuid primary key);
 insert into auth.users values('${id(1)}','owner@fixture.invalid','SECRET'),('${id(2)}','employee@fixture.invalid','SECRET'),('${id(3)}','inactive@fixture.invalid','SECRET'),('${id(4)}','formerowner@fixture.invalid','SECRET');
 insert into staff values('${id(1)}',true,'owner'),('${id(2)}',true,'staff'),('${id(3)}',false,'staff'),('${id(4)}',false,'owner');set test.actor='${id(1)}';`);
 await db.exec(readFileSync(`${source}/supabase/migrations/202609210001_inventory_foundation.sql`,'utf8'));
 const migration=new URL('../supabase/migrations/202609290040_staff_display_names.sql',import.meta.url);if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'));
 const authBefore=(await db.query('select * from auth.users order by id')).rows;
 assert.equal((await db.query("select to_regprocedure('public.set_staff_display_name(uuid,integer,text)') is not null installed")).rows[0].installed,true,'Owner-only versioned staff naming RPC must exist');
 const as=async(actor,role,sql,args=[])=>{await db.exec(`set test.actor='${id(actor)}';set role ${role}`);try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const set=(actor=1,target=2,version=0,name='Employee Fixture',role='authenticated')=>as(actor,role,'select set_staff_display_name($1,$2,$3) result',[id(target),version,name]);
 const list=async(actor=2,limit=100,after=null,role='authenticated')=>(await as(actor,role,'select list_staff_display_names($1,$2) result',[limit,after])).rows[0].result;
 const lookup=async(actor=1,email='employee@fixture.invalid',role='authenticated')=>(await as(actor,role,'select lookup_staff_display_name($1) result',[email])).rows[0].result;
 const snapshot=async()=>(await db.query("select jsonb_build_object('staff',(select jsonb_agg(s order by user_id) from staff s),'audit',(select jsonb_agg(a order by id) from staff_display_name_events a)) result")).rows[0].result;
 const initial=await list();assert.equal(initial.items.length,4);assert.ok(initial.items.every(x=>x.display_name===null&&x.name_version===0));assert.equal(initial.items[2].active,false);assert.equal(initial.next_after_id,null);
 for(const row of initial.items)assert.deepEqual(Object.keys(row).sort(),['active','display_name','name_version','user_id']);
 const first=await list(2,2);assert.equal(first.next_after_id,id(2));assert.equal((await list(2,2,first.next_after_id)).items.length,2);
 for(const limit of [0,101,-1,null])await assert.rejects(list(2,limit),/between 1 and 100/);
 for(const actor of [2,3,4]){await assert.rejects(set(actor),/Active owner/);await assert.rejects(lookup(actor),/Active owner/);}
 await assert.rejects(list(3),/Active staff/);await assert.rejects(list(4),/Active staff/);
 for(const role of ['anon','service_role']){await assert.rejects(set(1,2,0,'Name',role),/permission denied/);await assert.rejects(list(1,100,null,role),/permission denied/);await assert.rejects(lookup(1,'employee@fixture.invalid',role),/permission denied/);}
 assert.equal((await lookup(1,'  EMPLOYEE@fixture.invalid  ')).user_id,id(2));assert.equal((await lookup(1,'inactive@fixture.invalid')).active,false);assert.equal(await lookup(1,'unknown@fixture.invalid'),null);
 for(const email of ['',null,' '.repeat(5),'x'.repeat(321)])await assert.rejects(lookup(1,email),/email/);
 const before=await snapshot();for(const name of ['',null,' \t\n ','x'.repeat(121)])await assert.rejects(set(1,2,0,name),/Display name/);assert.deepEqual(await snapshot(),before);
 for(const v of [-1,null])await assert.rejects(set(1,2,v),/version/);await assert.rejects(set(1,999),/Staff account/);
 const saved=(await set(1,2,0,'  Employee Fixture  ')).rows[0].result;assert.equal(saved.display_name,'Employee Fixture');assert.equal(saved.name_version,1);assert.equal(saved.active,true);
 const post=await snapshot();await assert.rejects(set(1,2,0,'Different'),/changed/);assert.deepEqual(await snapshot(),post);
 await set(1,2,1,'Renamed Employee');await set(1,3,0,'Former Employee');
 assert.deepEqual((await db.query('select user_id,active,role from staff order by user_id')).rows,[{user_id:id(1),active:true,role:'owner'},{user_id:id(2),active:true,role:'staff'},{user_id:id(3),active:false,role:'staff'},{user_id:id(4),active:false,role:'owner'}]);
 const audit=(await db.query('select * from staff_display_name_events order by recorded_at,id')).rows;assert.equal(audit.length,3);assert.equal(audit[0].old_display_name,null);assert.equal(audit[0].new_display_name,'Employee Fixture');assert.equal(audit[1].old_name_version,1);assert.equal(audit[1].new_name_version,2);assert.ok(audit.every(e=>e.actor_user_id===id(1)));
 for(const sql of ['update staff_display_name_events set new_display_name=new_display_name','delete from staff_display_name_events','truncate staff_display_name_events'])await assert.rejects(db.exec(sql),/immutable/);
 for(const table of ['staff_display_name_events','auth.users'])await assert.rejects(as(1,'authenticated',`select * from ${table}`),/permission denied/);
 // Simulate pre-existing broad staff UPDATE privileges: naming remains owner-only and audited.
 await db.exec('grant select,update on staff to authenticated');
 await assert.rejects(as(2,'authenticated','update staff set display_name=$1,name_version=name_version+1 where user_id=$2',['Bypass',id(2)]),/Active owner/);
 await assert.rejects(as(1,'authenticated','update staff set display_name=$1 where user_id=$2',['No version',id(2)]),/increment/);
 const totalBefore=(await db.query('select count(*)::int n from staff_display_name_events')).rows[0].n;
 await db.exec("create function fixture_audit_fail() returns trigger language plpgsql as $$begin raise exception 'Injected audit failure';end$$;create trigger fixture_audit_fail before insert on staff_display_name_events for each row execute function fixture_audit_fail()");
 await assert.rejects(set(1,2,2,'Must rollback'),/Injected audit failure/);assert.equal((await lookup()).display_name,'Renamed Employee');assert.equal((await db.query('select count(*)::int n from staff_display_name_events')).rows[0].n,totalBefore);
 assert.doesNotMatch(JSON.stringify(await list()),/email|SECRET|encrypted_password|role/);
 assert.deepEqual((await db.query('select * from auth.users order by id')).rows,authBefore);
 await db.exec('drop trigger fixture_audit_fail on staff_display_name_events');
 assert.equal((await set(1,2,2,'界'.repeat(120))).rows[0].result.display_name,'界'.repeat(120));
 await db.exec(`insert into auth.users values('${id(8)}','EMPLOYEE@fixture.invalid','OTHERSECRET');insert into staff(user_id,active,role) values('${id(8)}',true,'staff')`);
 await assert.rejects(lookup(),/Multiple staff accounts/);
 assert.equal((await list(2,100,id(99))).items.length,0);
 await db.exec(`grant insert on staff to authenticated;insert into auth.users values('${id(9)}','new@fixture.invalid','SECRET')`);
 await assert.rejects(as(2,'authenticated','insert into staff(user_id,active,role,display_name,name_version) values($1,true,\'staff\',\'Bypass\',1)',[id(9)]),/Start unnamed/);
 console.log('PASS: real 001 dependency; owner-only naming and email lookup; active staff names-only pagination; inactive historical identities; trimmed validation; stale versions; unchanged roles/active/auth; immutable audit; direct-update denial; audit failure rollback; no guessed names.');
}finally{await db.close()}
