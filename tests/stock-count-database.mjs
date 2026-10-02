// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),counter=id(2),other=id(3),inactive=id(4);
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create table public.inventory_lots(id uuid primary key,loose_units integer);
insert into auth.users values('${owner}'),('${counter}'),('${other}'),('${inactive}');
insert into public.staff values('${owner}','owner',true),('${counter}','staff',true),('${other}','staff',true),('${inactive}','staff',false);
insert into public.inventory_lots values(gen_random_uuid(),10);`);
await db.exec(readFileSync(new URL('../supabase/migrations/202609300047_stock_count.sql',import.meta.url),'utf8'));
const retryMigration=new URL('../supabase/migrations/20261001175113_stock_count_retry_content.sql',import.meta.url);
if(existsSync(retryMigration))await db.exec(readFileSync(retryMigration,'utf8'));
const as=actor=>db.exec(`select set_config('test.actor','${actor||''}',false)`);
const load=rows=>db.query('select public.load_count_catalogue($1::jsonb) n',[JSON.stringify(rows)]).then(r=>r.rows[0].n);
const open=(sid,name)=>db.query('select * from public.open_stock_count($1,$2)',[sid,name]).then(r=>r.rows[0]);
const close=(sid,v)=>db.query('select * from public.close_stock_count($1,$2)',[sid,v]).then(r=>r.rows[0]);
const record=(eid,sid,godown,code,unlisted,qty,unit,extra={})=>db.query('select * from public.record_stock_count($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[eid,sid,godown,code,unlisted,qty,unit,extra.batch??'',extra.expiry??null,extra.condition??'good',extra.notes??'']).then(r=>r.rows[0]);
const review=(eid,v,action,note='')=>db.query('select * from public.review_stock_count($1,$2,$3,$4)',[eid,v,action,note]).then(r=>r.rows[0]);
let checks=0;const ok=()=>checks++;
const items=[{code:'AN-00001',product:'Patient Monitor with Printer',company:'',specification:'BT-770',category:'Machine',search_text:'BT-770 12.1 patient monitor'},{code:'AN-00002',product:'Blood Bag',company:'Fixture Co',specification:'450 ml',category:'Consumable',erp_product_ids:[id(50)]}];

// Product list: owner only, validated, refresh in place.
await as(counter);await assert.rejects(load(items),/Only the owner/);ok();
await as(owner);
await assert.rejects(load([]),/between 1 and 1,000/);ok();
await assert.rejects(load([{code:'X-1',product:'Bad',category:'Machine'}]),/check constraint|violates/);ok();
await assert.rejects(load([{code:'AN-00009',product:'Bad',category:'Toys'}]),/check constraint|violates/);ok();
await assert.rejects(load([{code:'AN-00009',product:'Bad',category:'Machine',erp_product_ids:['nope']}]),/invalid ERP id/);ok();
assert.equal(await load(items),2);ok();
assert.equal(await load([{...items[1],company:'Fixture Company'}]),1);
assert.equal((await db.query(`select company,id from public.count_catalogue where code='AN-00002'`)).rows[0].company,'Fixture Company','refresh updates in place');ok();
assert.equal((await db.query(`select id from public.count_catalogue where code='AN-00002'`)).rows[0].id,'AN-00002','id mirrors the code for paging');ok();

// Sessions: owner opens one at a time, retry-safe.
await as(counter);await assert.rejects(open(id(100),'Full count'),/Only the owner/);ok();
await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS'),/closed/);ok();
await as(owner);const s=await open(id(100),'Full count 2026');assert.equal(s.status,'open');ok();
assert.equal((await open(id(100),'Full count 2026')).id,id(100),'retry returns the same count');ok();
await assert.rejects(open(id(100),'Different count'),/different details/);ok();
await assert.rejects(open(id(100),null),/different details/);ok();
assert.equal((await open(id(100),'  Full count 2026  ')).name,'Full count 2026');ok();
await db.exec(`insert into auth.users values('${id(5)}');insert into public.staff values('${id(5)}','owner',true)`);
await as(id(5));await assert.rejects(open(id(100),'Full count 2026'),/different details/);ok();
await as(owner);
await assert.rejects(open(id(101),'Second'),/already running/);ok();

// Counting.
await as('');await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS'),/Active staff/);ok();
await as(inactive);await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS'),/Active staff/);ok();
await as(counter);
await assert.rejects(record(id(200),id(100),'Nowhere','AN-00001','',3,'PCS'),/check constraint|violates/);ok();
await assert.rejects(record(id(200),id(100),'New Dakawa','AN-99999','',3,'PCS'),/Choose a product/);ok();
await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',-1,'PCS'),/check constraint|violates/);ok();
await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',1,'CRATES'),/check constraint|violates/);ok();
await assert.rejects(record(id(200),id(100),'New Dakawa','','ab',1,'PCS'),/check constraint|violates/,'unlisted needs a description');ok();
const e1=await record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS',{batch:' B1 ',expiry:'2028-01-31'});
assert.equal(e1.status,'recorded');assert.equal(e1.batch,'B1');assert.equal(e1.counted_by,counter);ok();
assert.equal((await record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS',{batch:'B1',expiry:'2028-01-31'})).id,id(200),'same-content lost-response retry returns the saved count');ok();
for(const extra of [{batch:'B2',expiry:'2028-01-31'},{batch:'B1',expiry:'2028-02-01'},{batch:'B1',expiry:'2028-01-31',condition:'damaged'},{batch:'B1',expiry:'2028-01-31',notes:'Different shelf'},{}]){
 await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS',extra),/different details/);ok();
}
await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',4,'PCS'),/different details/);ok();
const e2=await record(id(201),id(100),'Keko Manga A','','Unlabelled grey suction pump',1,'PCS',{condition:'damaged'});assert.equal(e2.code,null);assert.equal(e2.unlisted,'Unlabelled grey suction pump');ok();
await assert.rejects(record(id(201),id(100),'Keko Manga A','','Different pump',1,'PCS',{condition:'damaged'}),/different details/);ok();
assert.equal((await record(id(201),id(100),'Keko Manga A','','  Unlabelled grey suction pump  ',1,'PCS',{condition:'damaged',notes:'  '})).id,e2.id);ok();
const e3=await record(id(202),id(100),'Keko Manga A','AN-00002','ignored text',10,'BOX');assert.equal(e3.unlisted,'','listed product ignores the description');ok();
// Reapplying the function-only migration preserves existing data and grants.
if(existsSync(retryMigration)){
 const before=(await db.query('select * from public.stock_count_entries order by id')).rows;
 await db.exec(readFileSync(retryMigration,'utf8'));
 assert.deepEqual((await db.query('select * from public.stock_count_entries order by id')).rows,before);ok();
}
await db.exec('set role authenticated');
assert.equal((await record(id(202),id(100),'Keko Manga A','AN-00002','other ignored text',10,'BOX')).id,e3.id);ok();
await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS',{batch:'B1',expiry:'2028-01-31',condition:'quarantine'}),/different details/);ok();
await as(other);
await assert.rejects(record(id(202),id(100),'Keko Manga A','AN-00002','',10,'BOX'),/different details/);ok();
await as(counter);await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from public.stock_count_entries')).rows[0].n,3);ok();

// Saved counts are immutable; only review moves them on.
await assert.rejects(db.exec(`update public.stock_count_entries set quantity=99 where id='${id(200)}'`),/cannot be edited/);ok();
await assert.rejects(db.exec(`delete from public.stock_count_entries where id='${id(200)}'`),/never deleted/);ok();
await assert.rejects(db.exec(`truncate public.stock_count_entries`),/never deleted/);ok();
await assert.rejects(db.exec(`delete from public.stock_count_sessions`),/never deleted/);ok();

// Review.
await as(other);await assert.rejects(review(id(200),1,'void','wrong shelf'),/Only the person who counted/);ok();
await assert.rejects(review(id(200),1,'accept'),/Only the owner/);ok();
await as(counter);await assert.rejects(review(id(200),1,'void','x'),/why/);ok();
await assert.rejects(review(id(200),1,'accept'),/Only the owner/);ok();
const v=await review(id(201),1,'void','Counted twice');assert.equal(v.status,'void');assert.equal(v.status_by,counter);ok();
await assert.rejects(review(id(201),2,'void','again'),/already been reviewed/);ok();
await as(owner);
await assert.rejects(review(id(200),9,'accept'),/changed/);ok();
await assert.rejects(review(id(200),1,'reject','no'),/why/);ok();
await assert.rejects(review(id(200),1,'approve'),/Unknown/);ok();
const a=await review(id(200),1,'accept');assert.equal(a.status,'accepted');assert.equal(a.version,2);ok();
const r=await review(id(202),1,'reject','Recount the boxes');assert.equal(r.status,'rejected');ok();
await assert.rejects(db.exec(`update public.stock_count_entries set status='recorded',status_by=null,status_at=null where id='${id(200)}'`),/already been reviewed/);ok();

// Closing stops counting; stock itself is never touched.
await as(counter);await assert.rejects(close(id(100),1),/Only the owner/);ok();
await as(owner);await assert.rejects(close(id(100),5),/changed/);ok();
const c=await close(id(100),1);assert.equal(c.status,'closed');assert.equal(c.closed_by,owner);ok();
assert.equal((await open(id(100),'Full count 2026')).status,'closed','retry must not reopen a closed session');ok();
await assert.rejects(close(id(100),2),/already closed/);ok();
await as(counter);await assert.rejects(record(id(203),id(100),'New Dakawa','AN-00001','',1,'PCS'),/closed/);ok();
// A lost-response retry after review and closure returns only the existing accepted row.
const closedSnapshot=(await db.query('select * from public.stock_count_entries order by id')).rows;
await db.exec('set role authenticated');
const replay=await record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS',{batch:' B1 ',expiry:'2028-01-31'});
assert.equal(replay.status,'accepted');assert.equal(replay.version,2);assert.equal(replay.status_by,owner);ok();
await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS',{batch:'B2',expiry:'2028-01-31'}),/different details/);ok();
await as(other);await assert.rejects(record(id(200),id(100),'New Dakawa','AN-00001','',3,'PCS',{batch:'B1',expiry:'2028-01-31'}),/different details/);ok();
await db.exec('reset role');
assert.deepEqual((await db.query('select * from public.stock_count_entries order by id')).rows,closedSnapshot);ok();
assert.equal((await db.query('select status from public.stock_count_sessions where id=$1',[id(100)])).rows[0].status,'closed');ok();
await as(owner);assert.equal((await open(id(101),'Recount')).status,'open','a new count can start after closing');ok();
assert.equal((await db.query('select count(*)::int n,sum(loose_units)::int s from public.inventory_lots')).rows[0].s,10,'stock unchanged');ok();

// Access: API roles read only, anon nothing.
const priv=(await db.query(`select has_table_privilege('authenticated','public.stock_count_entries','INSERT') i,has_table_privilege('authenticated','public.stock_count_entries','SELECT') s,has_table_privilege('anon','public.count_catalogue','SELECT') a,has_function_privilege('anon','public.record_stock_count(uuid,uuid,text,text,text,numeric,text,text,date,text,text)','EXECUTE') f,has_function_privilege('authenticated','public.load_count_catalogue(jsonb)','EXECUTE') g`)).rows[0];
assert.deepEqual(priv,{i:false,s:true,a:false,f:false,g:true});ok();
console.log(`stock count database: ${checks} checks passed`);
