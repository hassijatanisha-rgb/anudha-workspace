// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 081: Delivered needs a delivery file uploaded after dispatch. Tables are cut down to the columns the
// deliver step reads and writes; the function itself is the real migration.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const DRIVER_DESK=id(1);
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,access text[]);
 insert into staff values('${DRIVER_DESK}',true,'staff','{deliveries}');
 create function public.inventory_active_staff() returns boolean language sql stable as $$select exists(select 1 from staff where user_id=auth.uid() and active)$$;
 create function public.require_access(p_area text) returns void language plpgsql stable as $$begin if not exists(select 1 from staff where user_id=auth.uid() and active and p_area=any(access)) then raise exception 'You do not have access to %.',p_area; end if; end $$;
 create table inventory_lots(id uuid primary key,product_id uuid,location_id uuid,stock_status text,reserved_units int,loose_units int,version int,updated_at timestamptz);
 create table sales_delivery_notes(id uuid primary key,delivery_number text,organization_id uuid,proforma_id uuid,status text,version int,updated_at timestamptz,
  tax_invoice_reference text,carrier text,tracking_reference text,dispatched_by uuid,dispatched_at timestamptz,recipient_name text,proof_reference text,delivered_by uuid,delivered_at timestamptz);
 create table sales_delivery_events(id uuid primary key,delivery_note_id uuid,from_status text,to_status text,reference text,actor_user_id uuid);
 create table document_attachments(id uuid primary key default gen_random_uuid(),record_type text,record_id uuid,uploaded_at timestamptz);
 set test.actor='${DRIVER_DESK}';`);
 const migration=readFileSync(new URL('../supabase/migrations/202610150081_delivery_proof_required.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration);
 const note=async(n,dispatched="now()-interval '1 hour'",carrier='Truck T 123')=>{await db.query(`insert into sales_delivery_notes(id,delivery_number,status,version,carrier,dispatched_at) values($1,$2,'out_for_delivery',1,$3,${dispatched})`,[id(n),'DN-'+n,carrier]);return id(n);};
 const attach=(record,when,type='delivery')=>db.query(`insert into document_attachments(record_type,record_id,uploaded_at) values($1,$2,${when})`,[type,record]);
 const deliver=async(record,proof='Signed DN-scan')=>{const v=(await db.query('select version from sales_delivery_notes where id=$1',[record])).rows[0].version;return db.query("select advance_sales_delivery($1,$2,'deliver','','','Mr Recipient',$3)",[record,v,proof]);};
 const status=async record=>(await db.query('select status from sales_delivery_notes where id=$1',[record])).rows[0].status;

 const A=await note(10);
 await ok(()=>assert.rejects(deliver(A),/Upload a photo or scan of the signed delivery note first/));
 await attach(id(99),'now()');await ok(()=>assert.rejects(deliver(A),/signed delivery note first/),'a file on another delivery does not count');
 await attach(A,"now()-interval '1 hour'",'proforma');await ok(()=>assert.rejects(deliver(A),/signed delivery note first/),'a Pro forma file does not count');
 await attach(A,"now()-interval '2 hours'");await ok(()=>assert.rejects(deliver(A),/signed delivery note first/),'a delivery file from before dispatch does not count');
 await ok(async()=>assert.equal(await status(A),'out_for_delivery'));
 await ok(async()=>assert.equal((await db.query('select count(*)::int n from sales_delivery_events')).rows[0].n,0,'failed attempts leave no history'));
 // The typed recipient and reference are still required as before.
 await attach(A,'now()');
 await ok(()=>assert.rejects(db.query("select advance_sales_delivery($1,1,'deliver','','','','x')",[A]),/valid recipient/));
 await deliver(A);await ok(async()=>assert.equal(await status(A),'delivered'));
 await ok(async()=>{const e=(await db.query('select from_status,to_status,reference from sales_delivery_events where delivery_note_id=$1',[A])).rows[0];assert.deepEqual([e.from_status,e.to_status,e.reference],['out_for_delivery','delivered','Signed DN-scan']);});

 // Multi-drop: one driver with several deliveries out at once; each completes with its own proof.
 const B=await note(11),C=await note(12);
 await attach(B,'now()');await deliver(B);
 await ok(async()=>assert.deepEqual([await status(B),await status(C)],['delivered','out_for_delivery']));
 await ok(()=>assert.rejects(deliver(C),/signed delivery note first/),'proof on B does not complete C');
 await attach(C,'now()');await deliver(C);await ok(async()=>assert.equal(await status(C),'delivered'));

 // Deliveries dispatched before dispatch times were recorded still need a file, of any upload time.
 const D=await note(13,'null');await ok(()=>assert.rejects(deliver(D),/signed delivery note first/));
 await attach(D,"now()-interval '30 days'");await deliver(D);await ok(async()=>assert.equal(await status(D),'delivered'));

 // Other steps are unchanged: cancelling a ready delivery needs only its reason.
 await db.query("insert into sales_delivery_notes(id,delivery_number,status,version) values($1,'DN-14','accounts_approved',1)",[id(14)]);
 await db.query("select advance_sales_delivery($1,1,'cancel','','','','Customer withdrew order')",[id(14)]);
 await ok(async()=>assert.equal(await status(id(14)),'cancelled'));
 console.log(`PASS: ${checks} delivery proof checks; Delivered needs a delivery file uploaded after dispatch (other records, Pro forma files and older files refused), typed proof still required, failed attempts leave no history, multi-drop deliveries each need their own proof, legacy dispatches handled, other steps unchanged.`);
}finally{await db.close();}
