// Actual supplier form -> disposable SQL. Fixed bridge actor, no real login/network.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const db=new PGlite();let browser;
const actor='00000000-0000-4000-8000-000000000001';
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table staff(user_id uuid primary key,role text,active boolean);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function inventory_active_staff() returns boolean language sql security definer as $$select exists(select 1 from staff where user_id=auth.uid() and active)$$;
 create function inventory_owner() returns boolean language sql security definer as $$select exists(select 1 from staff where user_id=auth.uid() and active and role='owner')$$;
 create table products(id uuid primary key,deleted_at timestamptz);
 create table pending_stock_requests(id uuid primary key,product_id uuid);
 insert into auth.users values('${actor}');insert into staff values('${actor}','staff',true);`);
 await db.exec(readFileSync(new URL('../supabase/migrations/202609300046_suppliers_purchasing.sql',import.meta.url),'utf8'));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 const context=await browser.newContext();await context.route('**/*',r=>r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let tail=Promise.resolve(),loseFirstResponse=true;
 const submittedIds=[];
 await page.exposeFunction('supplierBridge',request=>{
  const result=tail.then(()=>db.transaction(async tx=>{
   await tx.exec('set local role authenticated');await tx.query("select set_config('test.actor',$1,true)",[actor]);
   if(request.kind==='read')return {data:(await tx.query('select * from suppliers order by supplier_number')).rows};
   assert.equal(request.name,'save_supplier');const a=request.args;submittedIds.push(a.p_id);
   return {data:(await tx.query('select * from save_supplier($1,$2,$3::jsonb)',[a.p_id,a.p_expected_version,JSON.stringify(a.p_fields)])).rows[0]};
  }));tail=result.catch(()=>{});return result.then(value=>{
   if(request.kind==='rpc'&&loseFirstResponse){loseFirstResponse=false;return {error:{message:'Simulated response lost after commit'}}}
   return value;
  }).catch(e=>({error:{message:e.message,code:e.code}}));
 });
 await page.setContent('<main id="content"></main>');
 await page.addScriptTag({content:`
 let me={user_id:'${actor}',role:'staff'},view='purchasing',products=[],messages=[],failures=[],settled=0;
 let generatedIds=0;
 crypto.randomUUID=()=> '00000000-0000-4000-8000-'+String(100+generatedIds++).padStart(12,'0');
 const $=s=>document.querySelector(s),esc=s=>String(s??'');
 function message(s){messages.push(s)}function syncWorkspaceNavigation(){}
 function run(fn){return Promise.resolve().then(fn).catch(e=>failures.push(e.message)).finally(()=>settled++)}
 const client={rpc:(name,args)=>supplierBridge({kind:'rpc',name,args})};
 `});
 await page.addScriptTag({content:readFileSync(new URL('../purchasing.js',import.meta.url),'utf8')});
 // Focus this fixture on real editor/save/bind logic, not the general workspace loader.
 await page.evaluate(()=>{
  purchasingWorkspace=async()=>{const r=await supplierBridge({kind:'read'});if(r.error)throw Error(r.error.message);suppliers=r.data;renderPurchasing()};
  purchaseSection='suppliers';supplierEditing='new';renderPurchasing();
 });
 await page.locator('[name="name"]').fill('Fictional browser supplier');
 await page.locator('[name="email"]').fill('orders@example.invalid');
 await page.locator('button[type="submit"]').click();await page.waitForFunction(()=>settled===1);
 assert.equal((await db.query('select * from suppliers')).rows.length,1);
 assert.match(await page.locator('#supplierFormError').textContent(),/response lost after commit/);
 // A changed payload must not create a new supplier after an uncertain commit.
 await page.locator('[name="name"]').fill('Changed uncertain supplier');
 await page.locator('button[type="submit"]').click();await page.waitForFunction(()=>settled===2);
 assert.match(await page.locator('#supplierFormError').textContent(),/previous save is unconfirmed/);
 assert.equal(submittedIds.length,1);
 await page.locator('[name="name"]').fill('Fictional browser supplier');
 await page.evaluate(()=>{failures=[];settled=0});
 await page.locator('button[type="submit"]').click();await page.waitForFunction(()=>settled===1);
 assert.equal(submittedIds.length,2);assert.equal(submittedIds[0],submittedIds[1]);
 assert.equal(await page.evaluate(()=>generatedIds),1,'uncertain retry must reuse its ID, not generate another');
 assert.deepEqual(await page.evaluate(()=>failures),[]);
 const rows=(await db.query('select * from suppliers')).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].created_by,actor);assert.equal(rows[0].name,'Fictional browser supplier');
 await page.locator('[data-supplier-edit]').click();
 assert.equal(await page.locator('[name="email"]').inputValue(),'orders@example.invalid');
 await page.locator('[name="phone"]').fill('SIM-ONLY');
 await page.locator('button[type="submit"]').click();await page.waitForFunction(()=>settled===2);
 assert.deepEqual(await page.evaluate(()=>failures),[]);
 const updated=(await db.query('select * from suppliers')).rows[0];assert.equal(updated.version,2);assert.equal(updated.phone,'SIM-ONLY');
 // Another active employee edits while the first employee's real form stays open.
 await page.locator('[data-supplier-edit]').click();
 const otherActor='00000000-0000-4000-8000-000000000002';
 await db.query('insert into auth.users values($1)',[otherActor]);
 await db.query("insert into staff values($1,'staff',true)",[otherActor]);
 await db.transaction(async tx=>{
  await tx.exec('set local role authenticated');
  await tx.query("select set_config('test.actor',$1,true)",[otherActor]);
  const shared=(await tx.query('select * from suppliers where id=$1',[updated.id])).rows[0];
  assert.equal(shared.phone,'SIM-ONLY');
  await tx.query('select * from save_supplier($1,$2,$3::jsonb)',[shared.id,shared.version,JSON.stringify({...shared,phone:'SECOND-EMPLOYEE'})]);
 });
 await page.locator('[name="phone"]').fill('STALE-OVERWRITE');
 await page.locator('button[type="submit"]').click();await page.waitForFunction(()=>settled===3);
 assert.match(await page.locator('#supplierFormError').textContent(),/Supplier changed; refresh and compare/);
 assert.equal(await page.locator('button[type="submit"]').isEnabled(),true);
 assert.equal(await page.locator('[name="phone"]').inputValue(),'STALE-OVERWRITE');
 const afterStale=(await db.query('select * from suppliers')).rows;
 assert.equal(afterStale.length,1);assert.equal(afterStale[0].version,3);assert.equal(afterStale[0].phone,'SECOND-EMPLOYEE');
 assert.deepEqual(await page.evaluate(()=>failures),['Supplier changed; refresh and compare']);
 await page.evaluate(async()=>{supplierEditing=null;await purchasingWorkspace()});
 await page.locator('[data-supplier-edit]').click();
 assert.equal(await page.locator('[name="phone"]').inputValue(),'SECOND-EMPLOYEE');
 assert.deepEqual(errors,[]);
 console.log('PASS supplier create/reopen/edit, second-actor read/write, stale form rejection and refresh. No outbound traffic. Loader stubbed; not real auth, full purchasing, concurrency or production acceptance.');
}finally{if(browser)await browser.close();await db.close()}
