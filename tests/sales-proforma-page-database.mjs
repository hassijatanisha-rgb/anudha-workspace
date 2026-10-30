// Disposable PostgreSQL fixture; the page migration and existing live-order function execute as written.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const OWNER=id(9001),HEAD=id(9002),STAFF=id(9003),BLOCKED=id(9004),INACTIVE=id(9005);
let checks=0;const check=async fn=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,role text,active boolean,access text[],display_name text);
 insert into staff values('${OWNER}','owner',true,'{}','Owner'),('${HEAD}','head',true,'{proformas,deliveries}','Head'),('${STAFF}','staff',true,'{proformas,deliveries}','Staff'),('${BLOCKED}','staff',true,'{travel}','Other'),('${INACTIVE}','staff',false,'{proformas,deliveries}','Inactive');
 create function inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active) and current_setting('test.mfa',true)='yes'$$;
 create function has_access(area text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select inventory_active_staff() and exists(select 1 from staff where user_id=auth.uid() and (role='owner' or area=any(access)))$$;
 create table organizations(id uuid primary key,name text,location text,deleted_at timestamptz);
 create table contacts(id uuid primary key,title text,first_name text,last_name text,deleted_at timestamptz);
 create table products(id uuid primary key,name text,source jsonb);
 create table sales_proformas(id uuid primary key,document_number text,organization_id uuid,contact_id uuid,status text,revision integer default 1,currency text default 'TZS',total_minor bigint default 100,prepared_by uuid,created_at timestamptz,updated_at timestamptz,accepted_at timestamptz,acceptance_reference text,commercial_kind text default 'sale',deleted_at timestamptz);
 create table sales_proforma_lines(id uuid primary key,proforma_id uuid,product_id uuid,sort_order integer,quantity integer);
 create table sales_delivery_notes(id uuid primary key,proforma_id uuid,delivery_number text,status text,created_at timestamptz,customer_waiting boolean default false,packing_queued_at timestamptz,packing_blocked_reason text,packer_user_id uuid,packing_taken_at timestamptz,dispatched_at timestamptz,delivered_at timestamptz,promise_kind text,promised_by timestamptz);
 create table sales_delivery_lines(id uuid primary key,delivery_note_id uuid,proforma_line_id uuid,quantity integer);
 create table sales_delivery_events(id uuid primary key,delivery_note_id uuid,created_at timestamptz,to_status text);
 create table discount_policy(id boolean primary key,version integer,head_limit_basis_points integer);
 insert into discount_policy values(true,4,1250);
 grant usage on schema auth to authenticated;
 do $$declare t text;begin foreach t in array array['organizations','contacts','products','sales_proformas','sales_proforma_lines','sales_delivery_notes','sales_delivery_lines','sales_delivery_events','discount_policy'] loop
 execute format('alter table %I enable row level security',t);execute format('grant select on %I to authenticated',t);
 execute format('create policy read_rows on %I for select to authenticated using ((select inventory_active_staff()))',t);
 end loop;end $$;
 set test.mfa='yes';`);
 const packing=read('supabase/migrations/202610090078_packing_queue.sql');
 for(const name of ['packing_staff_name','order_live_status']){const start=packing.indexOf(`create function public.${name}(`),end=packing.indexOf('$$;',start);assert.ok(start>=0&&end>start);await db.exec(packing.slice(start,end+3));}
 await db.exec(read('supabase/migrations/202610290132_sales_proforma_page.sql'));
 const now=Date.now(),old=new Date(now-3*864e5).toISOString(),today=new Date(now).toISOString();
 await db.query('insert into organizations values($1,$2,$3,null),($4,$5,$6,null)',[id(8001),'Fixture clinic','Arusha',id(8002),'Special %_ clinic','Mwanza']);
 await db.query('insert into contacts values($1,$2,$3,$4,null),($5,$6,$7,$8,null)',[id(8101),'Dr','Named','Contact',id(8102),'N/A','Special','Buyer']);
 await db.query('insert into products values($1,$2,$3)',[id(8201),'Fixture reagent',JSON.stringify({raw:'detail data '.repeat(10000)})]);
 const proformas=Array.from({length:1064},(_,n)=>({id:id(n+1),document_number:'PF-'+String(n+1).padStart(4,'0'),organization_id:id(n===1062?8002:8001),contact_id:id(n===1062?8102:8101),status:'draft',revision:n===1?2:1,prepared_by:n===1?STAFF:OWNER,created_at:old,updated_at:old,accepted_at:null,acceptance_reference:n===1062?'LPO-UNIQUE':null,commercial_kind:n===1062?'placement':'sale',deleted_at:n===1063?today:null}));
 proformas[0].created_at=today;proformas[1].updated_at=today;
 for(const n of [4,5,6,7,8,11,12,13,14,15])proformas[n-1].status='accepted';proformas[3].accepted_at=today;
 proformas[2].status='sent';proformas[8].status='cancelled';proformas[9].status='rejected';
 await db.query(`insert into sales_proformas(id,document_number,organization_id,contact_id,status,revision,prepared_by,created_at,updated_at,accepted_at,acceptance_reference,commercial_kind,deleted_at)
 select id,document_number,organization_id,contact_id,status,revision,prepared_by,created_at,updated_at,accepted_at,acceptance_reference,commercial_kind,deleted_at from jsonb_to_recordset($1::jsonb) as x(id uuid,document_number text,organization_id uuid,contact_id uuid,status text,revision int,prepared_by uuid,created_at timestamptz,updated_at timestamptz,accepted_at timestamptz,acceptance_reference text,commercial_kind text,deleted_at timestamptz)`,[JSON.stringify(proformas)]);
 const lines=[];for(let n=1;n<=1063;n++)if(n!==12)for(let item=0;item<(n===7?5:n===13?2:1);item++)lines.push({id:id(10000+n*10+item),proforma_id:id(n),product_id:id(8201),sort_order:item,quantity:10});
 await db.query('insert into sales_proforma_lines select * from jsonb_to_recordset($1::jsonb) as x(id uuid,proforma_id uuid,product_id uuid,sort_order int,quantity int)',[JSON.stringify(lines)]);
 for(const [n,status,qty] of [[5,'accounts_approved',0],[6,'delivered',4],[7,'delivered',10],[8,'delivered',4],[11,'cancelled',10],[12,'delivered',0],[13,'delivered',10],[14,'delivered',12],[15,'draft',0]]){
  await db.query('insert into sales_delivery_notes(id,proforma_id,delivery_number,status,created_at) values($1,$2,$3,$4,$5)',[id(30000+n),id(n),'DN-'+n,status,old]);
  for(const line of lines.filter(line=>line.proforma_id===id(n)&&(n!==13||line.sort_order===0)))if(qty)await db.query('insert into sales_delivery_lines values($1,$2,$3,$4)',[id(50000+Number(line.id.slice(-6))),id(30000+n),line.id,qty]);
 }
 await db.query("insert into sales_delivery_notes(id,proforma_id,delivery_number,status,created_at) values($1,$2,'Reserved','ready',$3)",[id(31008),id(8),today]);
 await db.query('insert into sales_delivery_lines values($1,$2,$3,6)',[id(61008),id(31008),id(10080)]);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');};
 const page=async(query='',filter='all',page=0)=>(await db.query('select sales_proforma_page($1,$2,$3) result',[query,filter,page])).rows[0].result;
 await as(OWNER);
 const legacy=vm.createContext({me:{user_id:OWNER},orgIndex:new Map(),contacts:[],products:[]});
 for(const file of ['row-index.js','business-date.js','sales-domain.js','sales-delivery.js'])vm.runInContext(read(file),legacy);
 legacy.parents=(await db.query('select * from sales_proformas where deleted_at is null order by created_at desc,id')).rows;
 legacy.lines=(await db.query('select * from sales_proforma_lines order by sort_order,id')).rows;legacy.notes=(await db.query('select * from sales_delivery_notes order by created_at desc,id')).rows;legacy.delivered=(await db.query('select * from sales_delivery_lines')).rows;
 vm.runInContext('salesProformas=parents;salesProformaLines=lines;salesDeliveryNotes=notes;salesDeliveryLines=delivered',legacy);
 const expectedTags=new Map(legacy.parents.map(row=>[row.id,legacy.proformaTag(row)])),counts={all:1063,mine:2,placement:1};for(const tag of expectedTags.values())counts[tag]=(counts[tag]||0)+1;
 const first=await page();
 await check(async()=>{assert.equal(first.rows.length,50);assert.equal(first.total,1063);assert.equal(first.pages,22);assert.deepEqual(first.counts,counts);assert.deepEqual(first.discount_policy,{id:true,version:4,head_limit_basis_points:1250});assert.ok(JSON.stringify(first).length<45000);});
 await check(async()=>{
  const rows=[];for(let n=0;n<first.pages;n++)rows.push(...(await page('','all',n)).rows);
  assert.equal(new Set(rows.map(row=>row.id)).size,1063);assert.deepEqual(rows.map(row=>row.id),legacy.parents.map(row=>row.id));
  for(const row of rows)assert.equal(row.register_tag,expectedTags.get(row.id),row.document_number);
  assert.equal(rows.find(row=>row.id===id(7)).items_summary,'10 × Fixture reagent · 10 × Fixture reagent · 10 × Fixture reagent · +2 more');
  assert.ok(rows.every(row=>row.register_summary&&!Object.hasOwn(row,'notes')&&!Object.hasOwn(row,'source')));
 });
 await check(async()=>{for(const tag of ['draft','revised','sent','waiting','delivery','partial','done','closed'])assert.equal((await page('',tag)).total,counts[tag]||0);assert.equal((await page('','mine')).total,2);assert.equal((await page('','placement')).total,1);});
 await check(async()=>{for(const term of ['PF-1063','Special %_ clinic','Mwanza','Special Buyer','LPO-UNIQUE']){const result=await page(term);assert.equal(result.total,1,term);assert.equal(result.rows[0].id,id(1063));}assert.equal((await page('%')).total,1,'wildcards are literal');assert.equal((await page('no-match')).total,0);assert.equal((await page('','all',999)).page,21);});
 await check(async()=>{const live=first.live_status;assert.ok(Array.isArray(live));assert.ok(live.every(row=>first.rows.some(p=>p.id===row.proforma_id&&p.status==='accepted')));assert.equal(live.find(row=>row.proforma_id===id(8)).status,'ready');});
 await check(async()=>{for(const actor of [HEAD,STAFF]){await as(actor);assert.equal((await page()).total,1063);}assert.equal((await page('','mine')).total,1);});
 await check(async()=>{await as(BLOCKED);await assert.rejects(page(),/Pro forma access/);await as(INACTIVE);await assert.rejects(page(),/Pro forma access/);await as(OWNER);await db.exec("set test.mfa='no'");await assert.rejects(page(),/Pro forma access/);await db.exec("set test.mfa='yes'");});
 await check(async()=>{await assert.rejects(page('','unknown'),/valid Pro forma filter/);await assert.rejects(page('','all',-1),/valid Pro forma page/);await assert.rejects(page('x'.repeat(2001)),/2000 characters/);});
 await check(async()=>{await db.exec(`reset role;create policy scoped_proforma on sales_proformas as restrictive for select to authenticated using(id<>'${id(1063)}');set role authenticated`);const result=await page('Special');assert.equal(result.total,0);assert.equal(result.counts.all,1062);});
 await check(async()=>{await db.exec('reset role;set role anon');await assert.rejects(page(),/permission denied/);await db.exec('reset role');const fn=(await db.query("select prosecdef,provolatile from pg_proc where proname='sales_proforma_page'")).rows[0];assert.deepEqual(fn,{prosecdef:false,provolatile:'s'});});
 console.log(`PASS: ${checks} Pro forma page checks; 1063-row pagination, actual legacy-tag parity, full-register filters/search/counts, bounded previews, page live status, roles/MFA/RLS and anonymous denial.`);
}finally{await db.close();}
