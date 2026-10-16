// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 089: change times on clients, contacts and products, without breaking the archive guards.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const ORG=id(1),CONTACT=id(2),PRODUCT=id(3),USER=id(9);
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select '${USER}'::uuid$$;
 create function has_access(text) returns boolean language sql stable as $$select true$$;
 create function inventory_owner() returns boolean language sql stable as $$select true$$;
 create table organizations(id uuid primary key,name text,parent_id uuid,approval_status text default 'review',deleted_at timestamptz,deletion_batch uuid);
 create table contacts(id uuid primary key,organization_id uuid,first_name text,revision integer default 1,deleted_at timestamptz,deletion_batch uuid);
 create table products(id uuid primary key,name text,revision integer default 1,deleted_at timestamptz,deleted_by uuid);
 create table inventory_lots(product_id uuid,sealed_cartons int,loose_units int,reserved_units int);
 create table inventory_transfers(product_id uuid,status text);
 create table sales_delivery_notes(proforma_id uuid);
 -- Live definitions (read from production 16 Oct 2026).
 create function guard_archived_profile() returns trigger language plpgsql as $f$ begin if tg_op='UPDATE' and old.deleted_at is not null then if tg_table_name='organizations' then if (new.deleted_at is not distinct from old.deleted_at and new.approval_status is not distinct from old.approval_status) or (to_jsonb(new)-array['deleted_at','deletion_batch','approval_status']) is distinct from (to_jsonb(old)-array['deleted_at','deletion_batch','approval_status']) then raise exception 'Restore this organization before editing' using errcode='23514'; end if; else if (to_jsonb(new)-array['deleted_at','deletion_batch','revision']) is distinct from (to_jsonb(old)-array['deleted_at','deletion_batch','revision']) then raise exception 'Restore this contact before editing' using errcode='23514'; end if; if new.deleted_at is not distinct from old.deleted_at and new.revision is distinct from old.revision then raise exception 'Restore this contact before editing' using errcode='23514'; end if; end if; end if; if new.deleted_at is null then if tg_table_name='organizations' then if new.parent_id is not null and exists(select 1 from public.organizations where id=new.parent_id and deleted_at is not null) then raise exception 'Restore the parent organization first' using errcode='23514'; end if; else if exists(select 1 from public.organizations where id=new.organization_id and deleted_at is not null) then raise exception 'Restore the organization first' using errcode='23514'; end if; end if; end if; return new; end $f$;
 create function guard_record_soft_delete() returns trigger language plpgsql as $f$ begin if tg_op='DELETE' then raise exception 'Use archive instead of permanently deleting records'; end if; if tg_op='INSERT' then if new.deleted_at is not null or new.deleted_by is not null then raise exception 'Create the record before archiving it'; end if; return new; end if; if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then if not (case when tg_table_name='products' then public.has_access('records') else public.inventory_owner() end) then raise exception 'access'; end if; if (new.deleted_at is null)<>(new.deleted_by is null) or (new.deleted_at is not null and new.deleted_by is distinct from auth.uid()) then raise exception 'Invalid archive attribution'; end if; if (to_jsonb(new)-array['deleted_at','deleted_by','version','updated_at']) is distinct from (to_jsonb(old)-array['deleted_at','deleted_by','version','updated_at']) then raise exception 'Archive or restore separately from editing'; end if; elsif old.deleted_at is not null then raise exception 'Restore the archived record before editing or advancing it'; end if; return new; end $f$;
 create trigger organizations_archive_guard before insert or update on organizations for each row execute function guard_archived_profile();
 create trigger contacts_archive_guard before insert or update on contacts for each row execute function guard_archived_profile();
 create trigger products_soft_delete_guard before insert or update or delete on products for each row execute function guard_record_soft_delete();
 insert into organizations(id,name) values('${ORG}','Fixture Hospital');
 insert into contacts(id,organization_id,first_name) values('${CONTACT}','${ORG}','Asha');
 insert into products(id,name) values('${PRODUCT}','Fixture analyser');`);
 const migration=readFileSync(new URL('../supabase/migrations/202610160089_list_change_times.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration); // re-runnable
 const at=async(t,k)=>(await db.query(`select updated_at from ${t} where id=$1`,[k])).rows[0].updated_at.getTime();
 const later=async(fn)=>{await new Promise(r=>setTimeout(r,15));await fn();};
 for(const [t,k] of [['organizations',ORG],['contacts',CONTACT],['products',PRODUCT]]){
  await ok(async()=>{const before=await at(t,k);await later(()=>db.query(`update ${t} set ${t==='contacts'?'first_name':'name'}=${t==='contacts'?'first_name':'name'}||'.' where id=$1`,[k]));assert.ok(await at(t,k)>before,`${t} edit moves the change time`);});
 }
 // Archive and restore still pass the whole-row guards, and each moves the change time.
 const batch=id(50);
 await ok(async()=>{const before=await at('contacts',CONTACT);await later(()=>db.query('update contacts set deleted_at=now(),deletion_batch=$2,revision=revision+1 where id=$1',[CONTACT,batch]));assert.ok(await at('contacts',CONTACT)>before);});
 await ok(async()=>{await later(()=>db.query('update organizations set deleted_at=now(),deletion_batch=$2 where id=$1',[ORG,batch]));});
 await ok(()=>assert.rejects(db.query(`update organizations set name='Edited while archived' where id=$1`,[ORG]),/Restore this organization before editing/));
 await ok(()=>assert.rejects(db.query(`update contacts set first_name='Edited while archived' where id=$1`,[CONTACT]),/Restore this contact before editing/));
 await ok(async()=>{const before=await at('organizations',ORG);await later(()=>db.query('update organizations set deleted_at=null,deletion_batch=null where id=$1',[ORG]));assert.ok(await at('organizations',ORG)>before,'restore moves the change time');});
 await ok(async()=>{await db.query('update contacts set deleted_at=null,deletion_batch=null,revision=revision+1 where id=$1',[CONTACT]);});
 await ok(async()=>{await db.query('update products set deleted_at=now(),deleted_by=$2 where id=$1',[PRODUCT,USER]);await db.query('update products set deleted_at=null,deleted_by=null where id=$1',[PRODUCT]);});
 await ok(async()=>{const r=(await db.query(`select count(*)::int n from contacts where updated_at>=now()-interval '1 minute'`)).rows[0];assert.equal(r.n,1,'changed rows are found by change time');});
 console.log(`PASS: ${checks} list change-time checks; edits, archive and restore move the change time; archived clients and contacts still cannot be edited; product archive and restore unaffected.`);
}finally{await db.close();}
