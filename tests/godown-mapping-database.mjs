import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite(),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;create table staff(user_id uuid,active boolean,role text);create table products(id uuid primary key);create table organizations(id uuid primary key);insert into auth.users values('${id(1)}'),('${id(2)}');insert into staff values('${id(1)}',true,'owner'),('${id(2)}',true,'staff');grant usage on schema auth to authenticated,anon;`);
 const root=new URL('../supabase/migrations/',import.meta.url);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609230018_tally_stock_review.sql'])await db.exec(readFileSync(new URL(file,root),'utf8'));
 await db.exec(`insert into inventory_locations(id,name,code,created_by) values('${id(10)}','City Printer','CP','${id(1)}');insert into tally_stock_sources(id,source_file,source_row,godown,product_name,quantity,balance_date,raw,imported_by) values('source','fixture',1,'CITY PRINTER','Blood bags',-4,'2026-09-22','{}','${id(1)}');`);
 const migration=new URL('202609290041_godown_mapping_reviews.sql',root);if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'));
 const actor=async n=>db.exec(`reset role;set test.actor='${id(n)}';set role authenticated`);
 const save=(version=0,request=id(20),name='CITY PRINTER',location=id(10),reason='Verified location')=>db.query('select * from save_godown_mapping_review($1,$2,$3,$4,$5)',[request,name,version,location,reason]);
 await actor(1);assert.equal((await save()).rows[0].version,1);assert.equal((await save()).rows[0].version,1);
 await assert.rejects(save(0,id(21)),/changed/i);await assert.rejects(save(0,id(20),'CITY PRINTER',id(10),'Different reason'),/conflict/i);
 await assert.rejects(save(0,id(22),'Unknown'),/source/i);await assert.rejects(save(1,id(23),'CITY PRINTER',id(999)),/active/i);
 assert.equal((await save(1,id(24),'CITY PRINTER',null,'Unresolved location')).rows[0].version,2);
 await actor(2);assert.equal((await db.query('select * from godown_mapping_reviews')).rows.length,2);await assert.rejects(save(2,id(25)),/Owner/);await assert.rejects(db.exec('delete from godown_mapping_reviews'),/permission/);
 await db.exec('reset role');await assert.rejects(db.exec('delete from godown_mapping_reviews'),/immutable/);assert.equal((await db.query('select quantity from tally_stock_sources')).rows[0].quantity,'-4');assert.equal((await db.query('select count(*)::int n from inventory_lots')).rows[0].n,0);
 await db.exec(`update inventory_locations set active=false where id='${id(10)}'`);await actor(1);await assert.rejects(save(2,id(26)),/active/i);
 await db.exec(`reset role;update staff set active=false where user_id='${id(1)}'`);await actor(1);await assert.rejects(save(2,id(27)),/Owner/);assert.equal((await db.query('select * from godown_mapping_reviews')).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(save(2,id(28)),/permission/);await assert.rejects(db.query('select * from godown_mapping_reviews'),/permission/);
 console.log('PASS: godown mapping actual predecessor SQL, owner/staff/inactive/anonymous, immutable history, replay, stale version, unknown source/inactive location, unresolved mapping, unchanged negative source and zero lots.');
}finally{await db.close();}
