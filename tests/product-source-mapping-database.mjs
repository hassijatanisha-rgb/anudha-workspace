import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE||'/private/tmp/anudha-db-tests.aRoaJU/package/dist/index.js');
const db=new PGlite(),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table staff(user_id uuid,active boolean,role text);
create table products(id uuid primary key,name text,source jsonb,deleted_at timestamptz);
create table organizations(id uuid primary key);
grant usage on schema auth to authenticated,anon;
insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
insert into staff values('${id(1)}',true,'owner'),('${id(2)}',true,'staff'),('${id(3)}',false,'owner');
insert into products values('${id(10)}','Analyzer','{"company":"Maker","model":"A1","pack_unit":"PCS","stock":-4}',null);`);
const main=new URL('../supabase/migrations/',import.meta.url);
for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609230017_product_detail_review.sql'])await db.exec(readFileSync(new URL(file,main),'utf8'));
const migration=new URL('../supabase/migrations/202609290033_product_source_mapping_reviews.sql',import.meta.url);
if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'));
const actor=async(n,role='authenticated')=>{await db.exec(`reset role;set test.actor='${n?id(n):''}';set role ${role}`)};
const original={name:'Analyzer',originalName:'Analyzer',manufacturer:' Maker ',model:'A1',units:'PCS',totalStock:-4,locations:'',source:'fixture',notes:null,matchConfidence:0};
const snapshot={original,corrected:{...original},editedLocally:false,editedAt:null};
let next=100;
const save=(opts={})=>db.query('select * from save_product_source_mapping_review($1,$2,$3,$4,$5,$6,$7)',[opts.id||id(next++),opts.key??'fixture:1',Object.hasOwn(opts,'version')?opts.version:0,Object.hasOwn(opts,'product')?opts.product:id(10),opts.decision??'linked',JSON.stringify(opts.snapshot??snapshot),opts.reason??'Fixture checked']);
await actor(1);
const first=(await save({id:id(50)})).rows[0];assert.equal(first.version,1);assert.deepEqual(first.snapshot,snapshot);
assert.equal((await save({id:id(50)})).rows[0].id,id(50));
await assert.rejects(save({id:id(50),reason:'Changed reason'}),/different|conflict/i);
await assert.rejects(save(),/changed|stale/i);
await assert.rejects(save({version:null}),/version|changed/i);
await assert.rejects(save({version:-1}),/version/i);
const changedBaseline=structuredClone(snapshot);changedBaseline.original.totalStock=17;changedBaseline.corrected.totalStock=17;
await assert.rejects(save({version:1,snapshot:changedBaseline}),/baseline/i);
assert.deepEqual((await db.query('select snapshot from product_source_mapping_reviews where id=$1',[id(50)])).rows[0].snapshot.original,original);
await save({version:1,decision:'unresolved',product:null});
await save({version:2,decision:'unresolved',product:null,reason:'Same source checked again'});
const editedCorrection=structuredClone(snapshot);editedCorrection.corrected.name='Corrected source label';editedCorrection.editedLocally=true;editedCorrection.editedAt=123;
assert.equal((await save({version:3,decision:'unresolved',product:null,snapshot:editedCorrection})).rows[0].snapshot.corrected.name,'Corrected source label');
assert.equal((await save({id:id(50)})).rows[0].version,1);
await assert.rejects(save({key:'missing-product',product:id(999)}),/existing/i);
await assert.rejects(save({key:'invalid-decision',decision:'auto'}),/decision/i);
await assert.rejects(save({key:'invalid-reason',reason:' '}),/reason/i);
await assert.rejects(save({key:'other',decision:'unresolved'}),/product/i);
await assert.rejects(save({key:'other',product:null}),/product/i);
for(const key of ['', ' spaced ', 'x'.repeat(1001)])await assert.rejects(save({key}),/source key/i);
for(const field of ['manufacturer','name','model','units']){
 const s=structuredClone(snapshot);s.corrected[field]='Wrong';if(field==='units')s.original.units='Wrong';
 await assert.rejects(save({key:'mismatch:'+field,snapshot:s}),/identity|match/i);
}
for(const field of ['originalName','source','units','totalStock','locations','matchConfidence']){
 const s=structuredClone(snapshot);s.corrected[field]=null;await assert.rejects(save({key:'immutable:'+field,snapshot:s}),/provenance/i);
}
for(const mutate of [s=>s.extra=1,s=>s.corrected.price=5,s=>s.original.notes={cost:1},s=>s.editedAt='yesterday',s=>delete s.editedLocally]){
 const s=structuredClone(snapshot);mutate(s);await assert.rejects(save({key:'invalid',snapshot:s}),/snapshot|field/i);
}
await db.exec('reset role');
await db.exec(`update products set deleted_at=now() where id='${id(10)}'`);await actor(1);
await assert.rejects(save({key:'archived'}),/archiv|existing/i);
await db.exec('reset role');await db.exec(`update products set deleted_at=null where id='${id(10)}'`);await actor(1);
await db.query('select save_product_detail_review($1,$2,0,$3,$4,$5,$6,false,false,$7)',[id(20),id(10),'Reviewed analyzer','Other maker','B2','active','Details checked']);
await assert.rejects(save({key:'old-identity'}),/identity|match/i);
const overlay=structuredClone(snapshot);Object.assign(overlay.corrected,{name:' reviewed  ANALYZER ',manufacturer:'other maker',model:'b2'});
await save({key:'overlay',snapshot:overlay});
await db.query('select save_product_detail_review($1,$2,1,$3,$4,$5,$6,false,false,$7)',[id(21),id(10),'Reviewed analyzer','','','active','Cleared unverified fields']);
await assert.rejects(save({key:'blank-overlay',snapshot:overlay}),/identity|match/i);
for(const stock of [null,'',0]){const s=structuredClone(snapshot);s.original.totalStock=stock;s.corrected.totalStock=stock;const row=(await save({key:'stock:'+String(stock),decision:'unresolved',product:null,snapshot:s})).rows[0];assert.equal(row.snapshot.original.totalStock,stock)}
await actor(2);assert.ok((await db.query('select * from product_source_mapping_reviews')).rows.length>0);await assert.rejects(save({key:'staff'}),/Owner/);
for(const statement of ['delete from product_source_mapping_reviews','update product_source_mapping_reviews set reason=\'modified\'','insert into product_source_mapping_reviews(id) values(gen_random_uuid())'])await assert.rejects(db.exec(statement),/permission denied/);
await actor(3);assert.equal((await db.query('select * from product_source_mapping_reviews')).rows.length,0);await assert.rejects(save({key:'inactive'}),/Owner/);
await actor(null,'anon');await assert.rejects(save({key:'anon'}),/permission denied/);await assert.rejects(db.query('select * from product_source_mapping_reviews'),/permission denied/);
await db.exec('reset role');await assert.rejects(db.exec('delete from product_source_mapping_reviews'),/immutable/);await assert.rejects(db.exec("update product_source_mapping_reviews set reason='modified'"),/immutable/);
assert.equal((await db.query('select source from products')).rows[0].source.stock,-4);assert.equal((await db.query('select count(*)::int n from inventory_movements')).rows[0].n,0);
await db.close();console.log('PASS: actual migrations 001/002/017/033; authorization, immutable audit, replay, stale versions, snapshot validation, identity overlays, archive guard, null/blank/zero/negative preservation and no stock writes.');
