// Isolated PostgreSQL fixture; PGLITE_MODULE points to the existing local PGlite runtime.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const bulkRaw={secret:'full-source-only-on-open',history:Array.from({length:200},(_,n)=>({row:n,description:'Imported source details '.repeat(20)}))};
const originalSource={company:'Maker',model:'Legacy model',specification:'Spec',category:'furniture',sale_status:'active',batch_required:false,expiry_required:false,suggested_company:'Suggested maker',company_note:'Verified label',raw:bulkRaw,import_metadata:{file:'original.xlsx',sheet:'Products'}};
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await db.exec(`create role anon;create role authenticated;
 create function public.inventory_active_staff() returns boolean language sql stable as $$select current_setting('test.active',true)='yes' and current_setting('test.mfa',true)='yes'$$;
 create table products(id uuid primary key,name text,sku text,source jsonb,revision integer default 0,deleted_at timestamptz);
 create table product_detail_reviews(id uuid primary key,product_id uuid,version integer,name text,company text,specification text,sale_status text,batch_required boolean,expiry_required boolean,unique(product_id,version));
 create table product_inventory_classifications(id uuid primary key,product_id uuid,version integer,category text,reason text,unique(product_id,version));
 create table product_machine_link_reviews(id uuid primary key,product_id uuid,version integer,machine_ids uuid[],unique(product_id,version));
 do $$declare t text;begin foreach t in array array['products','product_detail_reviews','product_inventory_classifications','product_machine_link_reviews'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy read_rows on %I for select to authenticated using ((select public.inventory_active_staff()))',t);
 execute format('grant select on %I to authenticated',t);
 end loop;end $$;
 set test.active='yes';set test.mfa='yes';`);
 const migration=readFileSync(new URL('../supabase/migrations/202610290126_catalog_page.sql',import.meta.url),'utf8');
 await db.exec(migration);
 // Compare the scoped inlining against the prior SQL result, including counts outside the selected page.
 await db.exec(migration.replaceAll('catalog_page','catalog_page_materialized').replace('machine_scope as not materialized','machine_scope as materialized').replace('category_scope as not materialized','category_scope as materialized'));
 for(let n=1;n<=63;n++)await db.query('insert into products(id,name,sku,source) values($1,$2,$3,$4)',[id(n),`Product ${String(n).padStart(3,'0')}`,`SKU-${n}`,JSON.stringify(originalSource)]);
 await db.query('insert into products(id,name,sku,source,deleted_at) values($1,$2,$3,$4,now())',[id(64),'Archived','old','{}']);
 await db.query('insert into product_detail_reviews values($1,$2,1,$3,$4,$5,$6,false,false)',[id(100),id(63),'Old reviewed name','Prior company','Prior specification','unknown']);
 await db.query('insert into product_detail_reviews values($1,$2,2,$3,$4,$5,$6,false,false)',[id(101),id(63),'Corrected analyzer','Correct manufacturer','Z-900','active']);
 await db.query('insert into product_inventory_classifications values($1,$2,1,$3,$4)',[id(102),id(63),'machines','Checked label']);
 await db.query('update products set source=source || $2::jsonb where id=$1',[id(62),JSON.stringify({category:'reagents',machine_ids:[id(2)]})]);
 await db.query('insert into product_machine_link_reviews values($1,$2,1,$3)',[id(103),id(62),[id(63)]]);
 await db.exec('set role authenticated;set jit=on');
 const page=async({query='',category='all',colour='',sort='name',page=0,machine=null,product=null}={})=>(await db.query('select catalog_page($1,$2,$3,$4,$5,$6,$7) as result',[query,category,colour,sort,page,machine,product])).rows[0].result;
 const first=await page();assert.equal(first.total,63);assert.equal(first.rows.length,25);assert.equal(first.pages,3);assert.equal(first.metrics.products,63);
 assert.equal((await db.query("select current_setting('jit') as jit")).rows[0].jit,'on','RPC restores the caller JIT setting');
 const seen=[];for(let p=0;p<first.pages;p++)seen.push(...(await page({page:p})).rows.map(r=>r.id));assert.equal(new Set(seen).size,63);
 assert.ok(first.rows.every(row=>!row.original&&!row.source.raw&&!row.source.import_metadata),'list omits full source');
 assert.ok(JSON.stringify(originalSource).length*63>5_000_000,'fixture includes over 5 MB of raw catalog data');
 assert.ok(JSON.stringify(first).length<25_000,'25-row response remains bounded with bulk raw source');
 assert.deepEqual(first.rows.find(row=>row.id===id(1)).source,{...Object.fromEntries(['company','model','specification','sale_status','batch_required','expiry_required','suggested_company','company_note'].map(key=>[key,originalSource[key]])),machine_ids:null,category:'furniture'});
 assert.equal((await page({page:999})).page,2);const empty=await page({query:'not-present',page:999});assert.equal(empty.total,0);assert.equal(empty.page,0);assert.equal(empty.pages,1);
 for(const query of ['Corrected analyzer','Correct manufacturer','Z-900','SKU-63']){const result=await page({query});assert.equal(result.total,1);assert.equal(result.rows[0].id,id(63));}
 assert.equal((await page({query:'Old reviewed name'})).total,0);assert.equal((await page({query:'Prior company'})).total,0);
 const machines=await page({category:'machines'});assert.equal(machines.total,1);assert.equal(machines.rows[0].name,'Corrected analyzer');
 const linked=await page({machine:id(63)});assert.equal(linked.total,1);assert.equal(linked.rows[0].id,id(62));assert.equal((await page({machine:id(2)})).total,0);
 const detail=await page({product:id(63)});assert.deepEqual(detail.rows[0].source.raw,bulkRaw);assert.deepEqual(detail.rows[0].source.import_metadata,originalSource.import_metadata);assert.deepEqual(detail.rows[0].original.source,originalSource);assert.equal(detail.rows[0].original.name,'Product 063');assert.equal(detail.rows[0].review.version,2);assert.equal(detail.rows[0].catalog_classification.reason,'Checked label');
 await assert.rejects(page({page:-1}),/valid product page/);await assert.rejects(page({category:'unsafe'}),/valid category/);await assert.rejects(page({query:'x'.repeat(2001)}),/2000 characters/);
 await db.exec('reset role');
 await db.query('update products set name=$2,source=$3 where id in ($1,$4)',[id(1),'Same identity',JSON.stringify({company:'Maker',specification:'Spec',category:'furniture',sale_status:'active',batch_required:false,expiry_required:false}),id(61)]);
 await db.query('update products set source=source || $2::jsonb where id=$1',[id(2),JSON.stringify({category:'reagents',machine_ids:42})]);
 await db.exec('set role authenticated');
 const duplicates=await page({colour:'yellow',query:'Same identity'});assert.equal(duplicates.total,2);assert.ok(duplicates.rows.every(r=>r.catalog_duplicate_count===2));
 const review=await page({category:'review'});assert.equal(review.total,1);assert.equal(review.rows[0].id,id(2));
 const cases=[
  ...['all','review','machines','furniture','reagents','consumables','spares','non_stock','unclassified'].map(category=>({category})),
  ...['red','yellow','ok'].flatMap(colour=>['all','review'].map(category=>({colour,category}))),
  {query:'Same identity',colour:'yellow'}, {query:'Correct manufacturer',category:'machines'}, {query:'not-present',page:999},
  {sort:'company',page:1}, {sort:'issues',page:2}, {machine:id(63)}, {machine:id(63),category:'reagents',query:'SKU-62'},
  {machine:id(2)}, {product:id(63)}
 ];
 for(const {query='',category='all',colour='',sort='name',page:index=0,machine=null,product=null} of cases){
  const result=(await db.query('select catalog_page($1,$2,$3,$4,$5,$6,$7) candidate,catalog_page_materialized($1,$2,$3,$4,$5,$6,$7) prior',[query,category,colour,sort,index,machine,product])).rows[0];
  assert.deepEqual(result.candidate,result.prior,JSON.stringify({query,category,colour,sort,index,machine,product}));
 }
 await db.exec("set test.mfa='no'");await assert.rejects(page(),/Active staff/);
 await db.exec("set test.mfa='yes';set test.active='no'");await assert.rejects(page(),/Active staff/);
 await db.exec("reset role;set test.active='yes';set role anon");await assert.rejects(page(),/permission denied/);
 await db.exec('reset role');
 const metadata=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where proname='catalog_page'")).rows[0];
 assert.equal(metadata.prosecdef,false);assert.equal(metadata.provolatile,'s');assert.deepEqual(metadata.proconfig,['search_path=public, pg_temp','jit=off']);
 // Extra product RLS constraints also apply inside the RPC.
 await db.exec(`create policy scoped_product on products as restrictive for select to authenticated using (id<>'${id(63)}');set role authenticated`);
 assert.equal((await page({query:'Corrected analyzer'})).total,0);
 console.log('PASS: catalog RPC migration executes; exact 25-row pagination, corrected search/category/group filters, global duplicates, bounded bulk-source lists and complete detail source, validation, active/MFA/anonymous gates and caller RLS.');
}finally{await db.close();}
