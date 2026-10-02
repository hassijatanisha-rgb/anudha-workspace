// Acceptance diagnostic: currently expected RED. Disposable PGlite only.
// This does NOT create real fiscal invoices or connect to Supabase.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text);
 create table products(id uuid primary key,name text);
 create table organizations(id uuid primary key,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 insert into auth.users values('${id(1)}','fixture@example.invalid');
 insert into staff values('${id(1)}',true,'owner');
 insert into products values('${id(3)}','Fictional reagent');
 insert into organizations values('${id(4)}',null);
 insert into contacts values('${id(5)}','${id(4)}',null,'valid');
 set test.actor='${id(1)}';`);
 for(const name of ['202609210001_inventory_foundation.sql','202609210004_proforma_delivery_workflow.sql','202609210005_sales_office_workflow.sql','202609210010_accounting_tax_invoice_reservation.sql'])
  await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`insert into inventory_locations(id,name,code,location_type,is_dispatch_hub,created_by) values('${id(6)}','Fixture dispatch hub','FIX','dispatch_hub',true,'${id(1)}');
 insert into product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('${id(7)}','${id(3)}',1,'piece',10,'Fixture only','${id(1)}');
 insert into inventory_lots(id,product_id,location_id,pack_definition_id,loose_units) values('${id(8)}','${id(3)}','${id(6)}','${id(7)}',100);`);
 const lines=[{productId:id(3),quantity:10,unitPriceMinor:10000,discountBasisPoints:0,taxBasisPoints:0,uom:'piece',description:'Fixture reagent'}];
 await db.query('select save_sales_proforma($1,0,$2,$3,$4,current_date+30,$5,$6,$7,$8)',[id(9),id(4),id(5),'TZS','7 days','On delivery','Fixture only',JSON.stringify(lines)]);
 await db.query('select advance_sales_proforma($1,1,$2,$3)',[id(9),'send','']);
 await db.query('select advance_sales_proforma($1,2,$2,$3)',[id(9),'accept','FIXTURE-ACCEPTED']);
 await db.query('select create_sales_delivery_note($1,$2,3,$3,current_date+1,$4)',[id(10),id(9),'FIXTURE-ACCOUNTS','[]']);
 const snapshot=async stage=>({stage,...(await db.query('select loose_units,reserved_units from inventory_lots where id=$1',[id(8)])).rows[0]});
 const before=await snapshot('before invoice');
 await db.query('select create_tax_invoice_and_reserve_stock($1,1,$2)',[id(10),'FIXTURE-NOT-FISCAL']);
 const invoiced=await snapshot('after invoice reference');
 const advance=(v,action,carrier='',tracking='')=>db.query('select advance_sales_delivery($1,$2,$3,$4,$5)',[id(10),v,action,carrier,tracking]);
 await advance(2,'send_to_sales');
 await db.query('select start_reserved_sales_delivery_packing($1,3)',[id(10)]);
 await advance(4,'ready');
 const ready=await snapshot('ready');
 await advance(5,'dispatch','Fixture driver','FIXTURE-DISPATCH');
 const dispatched=await snapshot('dispatched');
 const afterFirst=(await db.query('select * from inventory_lots')).rows;
 await assert.rejects(advance(5,'dispatch','Fixture driver','FIXTURE-DISPATCH'),/changed/);
 assert.deepEqual((await db.query('select * from inventory_lots')).rows,afterFirst,'stale dispatch retry must not deduct again');
 assert.equal((await db.query('select count(*)::int n from inventory_issues')).rows[0].n,1);
 console.log(JSON.stringify({observed:[before,invoiced,ready,dispatched],staleDispatchRetry:'rejected without another deduction'},null,2));
 assert.equal(invoiced.loose_units,90,'Acceptance: physical stock must decrease once at invoice issuance, not dispatch');
 assert.equal(dispatched.loose_units,invoiced.loose_units,'Acceptance: dispatch must not deduct physical stock');
}finally{await db.close();}
