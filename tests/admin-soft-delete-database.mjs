// Disposable PostgreSQL fixture; no live data or credentials.
// TDD evidence: initial run failed because set_product_archived did not exist.
// GREEN: this fixture verifies archive/restore authorization and database guards.
// No live deployment or checkpoint commits; concurrent-transaction races are not
// exercised by this single-session fixture (row locks enforce serialization).
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const directory=new URL('../supabase/migrations/',import.meta.url);
const migration=new URL('202609260029_admin_soft_delete.sql',directory);
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text);create table products(id uuid primary key,name text);
 create table organizations(id uuid primary key,deleted_at timestamptz);create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 insert into auth.users values('${id(1)}'),('${id(2)}');insert into staff values('${id(1)}',true,'owner'),('${id(2)}',true,'staff');
 insert into products values('${id(3)}','Fixture product');insert into organizations values('${id(4)}',null);insert into contacts values('${id(5)}','${id(4)}',null,'valid');set test.actor='${id(1)}';`);
 for(const name of ['202609210001_inventory_foundation.sql','202609210004_proforma_delivery_workflow.sql','202609250024_proforma_save_validation.sql'])await db.exec(readFileSync(new URL(name,directory),'utf8'));
 await db.exec(`create function public.is_owner() returns boolean language sql as $$select public.inventory_owner()$$`);
 for(const name of ['archive_record','restore_record'])await db.exec(`create function public.${name}(p_kind text,p_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$begin if not public.inventory_active_staff() then raise exception 'Active staff access required'; end if; if p_kind='organization' and not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;return jsonb_build_object('kind',p_kind,'id',p_id);end$$;grant execute on function public.${name}(text,uuid) to authenticated;`);
 if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'));
 const product=archive=>db.query('select * from set_product_archived($1,$2)',[id(3),archive]);
 const draft=(archive,version=1,n=10)=>db.query('select * from set_draft_proforma_archived($1,$2,$3)',[id(n),version,archive]);
 const save=(n=10,version=0)=>db.query('select save_sales_proforma($1,$2,$3,$4,\'TZS\',current_date+30,\'7 days\',\'On delivery\',\'\',$5)',[id(n),version,id(4),id(5),JSON.stringify([{productId:id(3),quantity:2,unitPriceMinor:100,discountBasisPoints:0,taxBasisPoints:0,uom:'piece',description:'Fixture'}])]);
 await save();
 await db.exec(`set role authenticated;set test.actor='${id(2)}'`);
 await assert.rejects(product(true),/owner|admin/i);await assert.rejects(draft(true),/owner|admin/i);
 for(const name of ['archive_record','restore_record'])await assert.rejects(db.query(`select ${name}('contact',$1)`,[id(5)]),/owner/i);
 await db.exec(`set test.actor='${id(1)}'`);
 for(const name of ['archive_record','restore_record'])assert.deepEqual((await db.query(`select ${name}('contact',$1) result`,[id(5)])).rows[0].result,{kind:'contact',id:id(5)});
 assert.ok((await draft(true)).rows[0].deleted_at);
 await assert.rejects(save(10,2),/archived/i);
 await assert.rejects(db.query("select advance_sales_proforma($1,2,'send','')",[id(10)]),/archived/i);
 await assert.rejects(draft(false,1),/changed|version/i);
 assert.equal((await draft(false,2)).rows[0].deleted_at,null);
 await db.query("select advance_sales_proforma($1,3,'send','')",[id(10)]);
 await assert.rejects(draft(true,4),/draft/i);
 await save(11);
 await db.exec('reset role');
 await db.exec(`insert into sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,accounts_reference,expected_delivery_date,created_by) values('${id(12)}','DN-FIXTURE','${id(11)}','${id(4)}','${id(5)}','Fixture',current_date+7,'${id(1)}');`);
 await assert.rejects(draft(true,1,11),/delivery/i);
 await db.exec(`insert into inventory_locations(id,name,code,location_type,created_by) values('${id(6)}','Fixture','FIX','godown','${id(1)}');insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('${id(7)}','${id(3)}',1,'piece',10,'Fixture pack','${id(1)}');insert into inventory_lots(id,product_id,location_id,pack_definition_id,loose_units) values('${id(8)}','${id(3)}','${id(6)}','${id(7)}',2);`);
 await assert.rejects(product(true),/stock/i);
 await assert.rejects(product(null),/archive or restore/i);
 // Legacy/import anomalies must remain visible even if an old schema lacks checks.
 await db.exec('alter table inventory_lots drop constraint inventory_lots_loose_units_check;update inventory_lots set loose_units=-1');
 await assert.rejects(product(true),/stock/i);
 await db.exec('update inventory_lots set loose_units=0');
 await db.exec(`insert into inventory_locations(id,name,code,location_type,created_by) values('${id(16)}','Other fixture','FIX2','godown','${id(1)}');insert into inventory_transfers(id,source_lot_id,from_location_id,to_location_id,product_id,pack_definition_id,cartons,expected_units,expected_at,reason,created_by) values('${id(17)}','${id(8)}','${id(6)}','${id(16)}','${id(3)}','${id(7)}',1,10,current_date+7,'Fixture transfer','${id(1)}');`);
 await assert.rejects(product(true),/transfer/i);
 await db.exec("update inventory_transfers set status='cancelled'");
 assert.ok((await product(true)).rows[0].deleted_at);
 await assert.rejects(save(20),/archived/i);
 await assert.rejects(db.exec('update inventory_lots set loose_units=5'),/archived/i);
 await assert.rejects(db.query("select advance_sales_proforma($1,4,'accept','Fixture LPO')",[id(10)]),/archived/i);
 await assert.rejects(db.exec('delete from products'),/archive|delet/i);
 await assert.rejects(db.exec('delete from sales_proformas'),/archive|delet/i);
 assert.equal((await db.query('select count(*)::int n from sales_proforma_revisions')).rows[0].n,2);
 assert.equal((await product(false)).rows[0].deleted_at,null);
 await db.exec(`set test.actor='${id(2)}'`);
 await assert.rejects(db.exec('update products set deleted_at=now()'),/owner/i);
 await assert.rejects(db.exec('update sales_proformas set deleted_at=now()'),/owner/i);
 for(const table of ['contacts','organizations']) {
  await assert.rejects(db.exec(`update ${table} set deleted_at=now()`),/owner/i);
  await assert.rejects(db.exec(`delete from ${table}`),/archive/i);
 }
 await db.exec(`set test.actor='${id(1)}'`);
 await db.exec('update contacts set deleted_at=now();update organizations set deleted_at=now()');
 await db.exec(`set test.actor='${id(2)}'`);
 for(const table of ['contacts','organizations'])await assert.rejects(db.exec(`update ${table} set deleted_at=null`),/owner/i);
 await db.exec(`set test.actor='${id(1)}';update contacts set deleted_at=null;update organizations set deleted_at=null`);
 await save(20);
 await db.exec("set test.actor=''");await assert.rejects(product(true),/owner|admin/i);
 console.log('PASS: owner-only archive/restore and legacy contact RPCs, direct CRM-write guards, draft/version/delivery guards, archived product write guards, history preservation, positive/negative stock and open-transfer rejection.');
} finally {await db.close();}
