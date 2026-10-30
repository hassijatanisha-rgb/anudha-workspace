// Disposable PostgreSQL fixture. Source balances and corrections retain their actual column grants and RLS.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite(),read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(9999),today='2026-10-29';let checks=0;
const check=async(fn)=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
 create function auth.uid() returns uuid language sql stable as $$select '${owner}'::uuid$$;
 create function inventory_active_staff() returns boolean language sql stable as $$select current_setting('test.active',true)='yes' and current_setting('test.mfa',true)='yes'$$;
 create function inventory_owner() returns boolean language sql stable as $$select inventory_active_staff() and current_setting('test.owner',true)='yes'$$;
 create function deny_product_classification_mutation() returns trigger language plpgsql as $$begin raise exception 'Append only';end$$;
 create table products(id uuid primary key,name text,source jsonb,deleted_at timestamptz);
 alter table products enable row level security;create policy product_read on products for select to authenticated using(inventory_active_staff());grant select on products to authenticated;
 set test.active='yes';set test.mfa='yes';set test.owner='yes';`);
 await db.exec(read('supabase/migrations/202609230017_product_detail_review.sql'));
 await db.exec(read('supabase/migrations/202609230018_tally_stock_review.sql'));
 await db.exec(read('supabase/migrations/202610290147_tally_stock_review_page.sql'));
 const base={company:'Maker',specification:'Spec',sale_status:'active',batch_required:false,expiry_required:false};
 const variants=[base,{...base,sale_status:'inactive_serviced'},{...base,company:'\u00a0\t'},{...base,specification:'',model:'Legacy'},
  {...base,batch_required:true},{...base,expiry_required:true},{...base,batch_required:null},{...base,expiry_required:'false'},
  {...base,sale_status:'unknown'},{...base,company:[]},{...base,company:[null]},{...base,company:[[['\u00a0']]]},
  {...base,company:[null,null]},{...base,company:{}},{...base,company:false},{...base,company:0},
  {...base,company:[false]},{...base,company:[0]},{...base,specification:[],model:'Must not replace truthy array'},
  {...base,specification:false,model:'Fallback'}, {...base,specification:0,model:[null]}, {...base,company:true},
  {...base,specification:'\t\n'}, {...base,sale_status:['active']},{...base,company:['', '']},{...base,company:[[[]]]},
  {...base,company:[{}]}, {...base,specification:[[[0]]]}, {...base,specification:null,model:'Valid'}, {}];
 const products=variants.map((source,n)=>({id:id(n+1),name:n===1?'\u00a0':'Product '+n,source,deleted_at:n===28?'2026-10-01T00:00:00Z':null}));
 await db.query('insert into products select * from jsonb_to_recordset($1::jsonb) as x(id uuid,name text,source jsonb,deleted_at timestamptz)',[JSON.stringify(products)]);
 const names=['','\u00a0','City Printer','City Printer 2',...Array.from({length:25},(_,n)=>'Godown '+String(n).padStart(2,'0'))];
 const rows=Array.from({length:1157},(_,n)=>({id:'source-'+String(n).padStart(4,'0'),source_file:'Private book.xlsx',source_row:n+1,godown:names[n%names.length],product_name:(n%7===0?'Blood % _ ':'Product ')+n,quantity:[-4,null,0,5,2.5,9007199254740992][n%6],unit:['PCS','BOX','pcs',null][n%4],balance_date:'2026-09-01',raw:{private:'Prices and private source'},imported_by:owner}));
 await db.query('insert into tally_stock_sources(id,source_file,source_row,godown,product_name,quantity,unit,balance_date,raw,imported_by) select * from jsonb_to_recordset($1::jsonb) as x(id text,source_file text,source_row integer,godown text,product_name text,quantity numeric,unit text,balance_date date,raw jsonb,imported_by uuid)',[JSON.stringify(rows)]);
 const corrections=rows.filter((_,n)=>n%11!==0).flatMap((row,n)=>[{id:id(10000+n*2),source_id:row.id,version:1,product_id:id(1+n%variants.length),pieces:4,batch:'Old',expiry:'2030-01-01',reason:'OLD REVIEW',created_by:owner},{id:id(10001+n*2),source_id:row.id,version:2,product_id:n%31===0?null:id(1+n%variants.length),pieces:n%13===0?null:n%5===0?0:n%17===0?9007199254740991:4,batch:n%3===0?'\u00a0':'Batch',expiry:[null,'2026-10-28','2026-10-29','2026-10-30','10000-01-01'][n%5],reason:'Latest private evidence',created_by:owner}]);
 await db.query('insert into tally_stock_corrections(id,source_id,version,product_id,pieces,batch,expiry,reason,created_by) select * from jsonb_to_recordset($1::jsonb) as x(id uuid,source_id text,version integer,product_id uuid,pieces bigint,batch text,expiry date,reason text,created_by uuid)',[JSON.stringify(corrections)]);
 await db.query('insert into product_detail_reviews(id,product_id,version,name,company,specification,sale_status,batch_required,expiry_required,reason,created_by) values($1,$2,1,$3,$4,$5,$6,true,true,$7,$8),($9,$2,2,$3,$4,$5,$6,false,false,$7,$8)',[id(8000),id(30),'Reviewed name','Reviewed maker','Reviewed spec','active','Private review',owner,id(8001)]);
 const ctx=vm.createContext({document:{addEventListener(){}},products:[]});vm.runInContext(read('product-review.js')+read('product-review-ui.js')+read('tally-stock-review.js'),ctx);
 const original=ctx.productStockReview;let clock=today;ctx.productStockReview=(details,stock)=>original(details,stock,clock);
 const page=async({godown='',query='',page=0,readiness=0,date=today}={})=>(await db.query('select tally_stock_review_page($1,$2,$3,$4,$5) result',[godown,query,page,readiness,date])).rows[0].result;
 async function oracle(godown='',query='',date=today){clock=date;
  ctx.products=(await db.query('select to_jsonb(p) row from products p')).rows.map(x=>x.row);
  ctx.loadedRows=(await db.query('select jsonb_build_object(\'id\',id,\'godown\',godown,\'product_name\',product_name,\'quantity\',quantity,\'unit\',unit,\'balance_date\',balance_date) row from tally_stock_sources order by id')).rows.map(x=>x.row);
  ctx.loadedCorrections=(await db.query('select to_jsonb(c) row from tally_stock_corrections c order by version')).rows.map(x=>x.row);
  ctx.loadedReviews=(await db.query('select to_jsonb(r) row from product_detail_reviews r order by version')).rows.map(x=>x.row);
  vm.runInContext('tallyRows=loadedRows;tallyCorrections=new Map(loadedCorrections.map(r=>[r.source_id,r]));productDetailReviews=new Map(loadedReviews.map(r=>[r.product_id,r]));',ctx);
  const scope=ctx.tallyGodownReview(ctx.loadedRows,vm.runInContext('tallyCorrections',ctx),godown,query),ready=ctx.tallyGodownReadiness(ctx.loadedRows,ctx.tallyRowReview);
  return {scope,ready};
 }
 await db.exec('set role authenticated');
 await check(async()=>{const first=await page(),expected=await oracle();assert.equal(first.total,1157);assert.equal(first.rows.length,50);assert.equal(first.readiness.rows.length,20);assert.equal(first.readiness.total,29);assert.deepEqual(first.scope,{total:expected.scope.total,reviewed:expected.scope.reviewed,negative:expected.scope.negative,missingQuantity:expected.scope.missingQuantity});const seen=[];for(let p=0;p<first.pages;p++)seen.push(...(await page({page:p})).rows);assert.deepEqual(seen.map(r=>r.id),expected.scope.rows.map(r=>r.id));assert.equal(new Set(seen.map(r=>r.id)).size,1157);for(const row of seen){const original=ctx.loadedRows.find(r=>r.id===row.id),review=ctx.tallyRowReview(original);assert.equal(row.checks_passed,!!original.godown.trim()&&!!review.product&&review.result.issues.length===0,row.id);assert.equal(row.pieces,review.correction?.pieces??null,row.id);}});
 await check(async()=>{for(const date of ['2026-10-28','2026-10-29','2026-10-30']){const expected=await oracle('','',date),seen=[];const first=await page({date});for(let p=0;p<first.readiness.pages;p++)seen.push(...(await page({date,readiness:p})).readiness.rows);assert.deepEqual(seen.sort((a,b)=>a.name.localeCompare(b.name)),JSON.parse(JSON.stringify(expected.ready)));assert.ok(seen.some(r=>r.checked>0));assert.ok(seen.some(r=>r.blocked>0));}});
 await check(async()=>{for(const [godown,query] of [['City Printer',''],['City Printer 2','blood'],['','\t\u00a0BLOOD % _\ufeff'],['','\t\n'],['Missing',''],['\u00a0',''],['Godown 03','PCS'],['',"' OR true --"]]){const got=await page({godown,query}),want=await oracle(godown,query);assert.equal(got.total,want.scope.rows.length);assert.deepEqual(got.rows.map(r=>r.id),want.scope.rows.slice(0,50).map(r=>r.id));assert.deepEqual(got.scope,{total:want.scope.total,reviewed:want.scope.reviewed,negative:want.scope.negative,missingQuantity:want.scope.missingQuantity});}});
 await check(async()=>{const got=await page({page:1000000,readiness:1000000});assert.equal(got.page,23);assert.equal(got.rows.length,7);assert.equal(got.readiness.page,1);assert.equal(got.readiness.rows.length,9);const empty=await page({query:'nothing matches',page:99});assert.deepEqual([empty.total,empty.page,empty.pages,empty.rows.length],[0,0,1,0]);assert.equal(empty.scope.total,1157);});
 await check(async()=>{const got=await page();assert.ok(JSON.stringify(got).length<25000);assert.ok(got.rows.every(r=>!('raw' in r)&&!('reason' in r)&&!('source_file' in r)&&!('product_id' in r)));await assert.rejects(db.query('select raw from tally_stock_sources limit 1'),/permission denied/);});
 await check(async()=>{for(const args of [{godown:null},{godown:'x'.repeat(2001)},{query:null},{query:'x'.repeat(2001)},{page:null},{page:-1},{page:1000001},{readiness:null},{readiness:-1},{date:null},{date:'infinity'}])await assert.rejects(page(args));});
 await check(async()=>{await db.exec("set test.mfa='no'");await assert.rejects(page(),/Active staff/);await db.exec("set test.mfa='yes';set test.active='no'");await assert.rejects(page(),/Active staff/);await db.exec("set test.active='yes';set test.owner='no'");assert.equal((await page()).total,1157);await db.exec('reset role;set role anon');await assert.rejects(page(),/permission denied/);await db.exec('reset role');const meta=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where proname='tally_stock_review_page'")).rows[0];assert.equal(meta.prosecdef,false);assert.equal(meta.provolatile,'s');assert.deepEqual(meta.proconfig,['search_path=public, pg_temp']);});
 await check(async()=>{await db.exec(`create policy hide_source on tally_stock_sources as restrictive for select to authenticated using(id<>'source-0000');create policy hide_product on products as restrictive for select to authenticated using(id<>'${id(1)}');create policy hide_review on product_detail_reviews as restrictive for select to authenticated using(version<>2);create policy hide_correction on tally_stock_corrections as restrictive for select to authenticated using(version<>2);set role authenticated`);const got=await page(),want=await oracle();assert.equal(got.total,1156);const seen=[];for(let p=0;p<got.readiness.pages;p++)seen.push(...(await page({readiness:p})).readiness.rows);assert.deepEqual(seen.sort((a,b)=>a.name.localeCompare(b.name)),JSON.parse(JSON.stringify(want.ready)));assert.ok(!got.rows.some(r=>r.id==='source-0000'));assert.equal(got.scope.reviewed,want.scope.reviewed);});
 await check(async()=>{await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from tally_stock_sources')).rows[0].n,1157);assert.equal((await db.query('select count(*)::int n from tally_stock_corrections')).rows[0].n,corrections.length);});
 console.log(`PASS: ${checks} Tally page database checks; 1,157 sources, 29 godowns, full JS readiness/scope parity, latest corrections, metadata coercion, expiry boundaries, column privacy, caller RLS/MFA, bounds and read-only state.`);
}finally{await db.close();}
