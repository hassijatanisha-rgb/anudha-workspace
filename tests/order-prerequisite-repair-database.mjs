// Missing deployed prerequisites are restored without replacing installed or newer implementations.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const migration='202610170001_restore_order_reservation_prerequisites.sql';
const extraMigrations=['202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql'];
const names=['guard_tax_invoice_stock_reservation','release_cancelled_tax_invoice_stock','create_tax_invoice_and_reserve_stock','start_reserved_sales_delivery_packing','packing_release'];
const definitions=async f=>(await f.admin(`select p.proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname`,[names])).rows;
let normal,repaired;
try{
 normal=await createOrderFixture({extraMigrations});
 const original=await definitions(normal);
 await normal.db.exec('reset role');await normal.load(migration);await normal.db.exec('set role authenticated');
 assert.deepEqual(await definitions(normal),original,'Existing latest implementations are unchanged');
 repaired=await createOrderFixture({missingOrderPrerequisites:true,extraMigrations});
 assert.deepEqual(await definitions(repaired),original,'Missing migration010 and packing_release restored, then100108 applied identically');
 const grants=(await repaired.admin("select has_function_privilege('authenticated','public.packing_release(uuid,integer,text)','EXECUTE') allowed,has_function_privilege('anon','public.packing_release(uuid,integer,text)','EXECUTE') anonymous")).rows[0];
 assert.equal(grants.allowed,true);assert.equal(grants.anonymous,false);
 await normal.db.exec('reset role;drop trigger sales_tax_invoice_requires_stock on public.sales_delivery_notes');
 await assert.rejects(normal.load(migration),/partially installed/);await normal.db.exec('rollback');
 assert.deepEqual(await definitions(normal),original,'Partial presence rejects without overwriting functions');
 console.log('PASS: prerequisite repair missing-all restoration, installed/newer no-op, original grants, partial-presence rejection; real migrations100108 apply after restoration.');
}finally{await normal?.db.close();await repaired?.db.close();}
