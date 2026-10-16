// Disposable PGlite only: migration 094 on the real save RPC and revision tables.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const SALES=id(1),OWNER=id(2),STORES=id(3),INACTIVE=id(4),ORG=id(10),CONTACT=id(11),OTHER_ORG=id(12),OTHER_CONTACT=id(13),A=id(20),B=id(21),PF=id(30);
const mig=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const loadFunction=async(file,name)=>{const match=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));assert.ok(match,name);await db.exec(match[0]);};
const as=(actor,aal='aal2')=>db.query("select set_config('test.actor',$1,false),set_config('test.aal',$2,false)",[actor??'',aal]);
const line=(productId,quantity=1)=>({productId,quantity,description:'Quoted description',uom:'unit',unitPriceMinor:12000,discountBasisPoints:0,taxBasisPoints:1800,productName:'Untrusted supplied name'});
const save=(version,lines=[line(B,2),line(A),line(B)],pf=PF,organization=ORG,contact=CONTACT)=>db.query('select * from save_sales_proforma($1,$2,$3,$4,$5,current_date+30,$6,$7,$8,$9)',[pf,version,organization,contact,'TZS','Seven days','On delivery','Fixture notes',JSON.stringify(lines)]).then(r=>r.rows[0]);
const snapshot=revision=>db.query('select snapshot from sales_proforma_revisions where proforma_id=$1 and revision=$2',[PF,revision]).then(r=>r.rows[0].snapshot);
let checks=0;const check=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table accounting_memberships(user_id uuid,active boolean);
 create table products(id uuid primary key,name text);
 create table organizations(id uuid primary key,name text,location text,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,title text,first_name text,last_name text,deleted_at timestamptz,status text);
 insert into auth.users values('${SALES}'),('${OWNER}'),('${STORES}'),('${INACTIVE}');
 insert into staff values('${SALES}',true,'staff','sales','{proformas}'),('${OWNER}',true,'owner','management','{}'),('${STORES}',true,'staff','stores','{deliveries}'),('${INACTIVE}',false,'staff','sales','{proformas}');
 insert into products values('${A}','Analyzer original'),('${B}','Reagent original');
 insert into organizations values('${ORG}','Clinic original','Dar es Salaam',null),('${OTHER_ORG}','Unrelated clinic','Arusha',null);
 insert into contacts values('${CONTACT}','${ORG}','Dr','Original','Contact',null,'kept'),('${OTHER_CONTACT}','${OTHER_ORG}','N/A','Other','Person',null,'kept');`);
 for(const file of ['202609210001_inventory_foundation.sql','202609210004_proforma_delivery_workflow.sql','202610140080_require_two_step.sql'])await db.exec(mig(file));
 for(const name of ['inventory_active_staff','inventory_owner'])await loadFunction('202610010058_two_step_sign_in.sql',name);
 for(const name of ['has_access','require_access','save_sales_proforma','advance_sales_proforma'])await loadFunction('202610050060_department_heads_and_access.sql',name);
 // Use the installed area's policies without bootstrapping unrelated purchasing/service tables.
 for(const statement of mig('202610050060_department_heads_and_access.sql').matchAll(/alter policy sales_proforma\w*_read[^;]+;/g))await db.exec(statement[0]);
 await db.exec(mig('202610070072_delivery_staff_read_order_items.sql'));
 await as(SALES);await db.exec('set role authenticated');await save(0);const historical=await snapshot(1);
 await check(async()=>assert.equal(Object.hasOwn(historical,'organizationName'),false,'legacy snapshot starts without captured identities'));
 await db.exec('reset role');const metadata=()=>db.query("select oid,proacl::text,prosecdef,proconfig from pg_proc where oid='save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb)'::regprocedure").then(r=>r.rows);
 const before=await metadata();await db.exec(mig('202610160094_proforma_integrity.sql'));
 await check(async()=>assert.deepEqual(await metadata(),before,'adding the trigger preserves save RPC security and identity'));
 await db.exec('set role authenticated');await save(1);const captured=await snapshot(2);
 await check(async()=>{assert.equal(captured.organizationName,'Clinic original');assert.equal(captured.organizationLocation,'Dar es Salaam');assert.equal(captured.contactName,'Dr Original Contact');});
 await check(async()=>{assert.deepEqual(captured.lines.map(l=>l.productName),['Reagent original','Analyzer original','Reagent original']);assert.deepEqual(captured.lines.map(l=>l.quantity),[2,1,1]);assert.equal(captured.lines[0].description,'Quoted description');assert.equal(captured.totalMinor,historical.totalMinor);});
 await check(async()=>assert.deepEqual(await snapshot(1),historical,'migration does not retrofit immutable history'));
 await db.exec('reset role');await db.exec(`update organizations set name='Clinic renamed',location='Dodoma' where id='${ORG}';update contacts set title='N/A',first_name='Renamed',last_name='Contact' where id='${CONTACT}';update products set name='Analyzer renamed' where id='${A}';`);
 await db.exec('set role authenticated');await save(2,[line(A,4)]);const revised=await snapshot(3);
 await check(async()=>{assert.equal(revised.organizationName,'Clinic renamed');assert.equal(revised.organizationLocation,'Dodoma');assert.equal(revised.contactName,'Renamed Contact');assert.equal(revised.lines[0].productName,'Analyzer renamed');assert.deepEqual(await snapshot(2),captured);});
 await save(0,[line(B)],id(31),OTHER_ORG,OTHER_CONTACT);
 await check(async()=>{const separate=(await db.query('select snapshot from sales_proforma_revisions where proforma_id=$1',[id(31)])).rows[0].snapshot;assert.equal(separate.organizationName,'Unrelated clinic');assert.equal(separate.contactName,'Other Person');assert.deepEqual(await snapshot(3),revised);});
 await check(()=>assert.rejects(save(3,[line(A)],PF,ORG,OTHER_CONTACT),/valid contacts/));
 await check(()=>assert.rejects(save(3,[line(id(999))]),/products are unavailable/));
 await check(()=>assert.rejects(save(1),/changed/));
 await check(async()=>{await assert.rejects(db.query('update sales_proforma_revisions set snapshot=$1 where proforma_id=$2',['{}',PF]),/permission denied/);await assert.rejects(db.query('delete from sales_proforma_revisions where proforma_id=$1',[PF]),/permission denied/);await assert.rejects(db.query('insert into sales_proforma_revisions(id,proforma_id,revision,snapshot,created_by) values($1,$2,4,$3,$4)',[id(40),PF,JSON.stringify(revised),SALES]),/permission denied/);});
 await check(async()=>{for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'capture_sales_proforma_identity()','execute') allowed",[role])).rows[0].allowed,false);assert.equal((await db.query("select prosecdef from pg_proc where oid='capture_sales_proforma_identity()'::regprocedure")).rows[0].prosecdef,false);});
 await as(STORES);await check(async()=>{assert.equal((await db.query('select count(*)::int n from sales_proformas')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from sales_proforma_revisions')).rows[0].n,0,'delivery read access does not expose revision history');await assert.rejects(save(0,undefined,id(32)),/do not have access/);});
 for(const [actor,aal] of [[INACTIVE,'aal2'],[OWNER,'aal1'],[null,'aal2']]){await as(actor,aal);await check(async()=>{assert.equal((await db.query('select count(*)::int n from sales_proforma_revisions')).rows[0].n,0);await assert.rejects(save(0,undefined,id(32)),/do not have access/);});}
 await as(OWNER);await check(async()=>assert.equal((await db.query('select count(*)::int n from sales_proforma_revisions')).rows[0].n,4));
 await db.exec('reset role');
 await check(()=>assert.rejects(db.query('update sales_proforma_revisions set snapshot=$1 where proforma_id=$2',['{}',PF]),/immutable/));
 // A malformed server insertion must fail atomically, rather than silently drop a missing product or mix clients.
 const insert=s=>db.query('insert into sales_proforma_revisions(id,proforma_id,revision,snapshot,created_by) values($1,$2,4,$3,$4)',[id(40),PF,JSON.stringify(s),SALES]);
 await check(()=>assert.rejects(insert({...revised,contactId:OTHER_CONTACT}),/client and contact could not be captured/));
 await check(()=>assert.rejects(insert({...revised,lines:[...revised.lines,{productId:id(999)}]}),/products could not be captured/));
 await check(async()=>{assert.equal((await db.query('select count(*)::int n from sales_proforma_revisions')).rows[0].n,4);assert.deepEqual(await snapshot(3),revised);});
 console.log(`PASS: ${checks} proforma identity checks; authenticated saves, ordered products, independent immutable revisions, untouched legacy history, client/product failure atomicity, unchanged RPC metadata, area/MFA/ACL boundaries.`);
}finally{await db.close();}
