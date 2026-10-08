import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const enabled=process.env.PERSONAL_BROWSER_QA==='1';
const sources=['personal-workspace-domain.js','personal-workspace.js','action-forms.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
let browser;
test.before(async()=>{
 if(!enabled)return;
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close()});
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set PERSONAL_BROWSER_QA=1 with local Playwright and Chrome'},fn);
async function fixture(t,kind='event',role='staff'){
 const page=await browser.newPage({timezoneId:'UTC'});t.after(()=>page.close());
 await page.route('**/*',route=>route.abort());
 await page.setContent('<section id="content"></section><div id="notice"></div>');
 await page.addStyleTag({content:readFileSync(new URL('../personal-workspace.css',import.meta.url),'utf8')});
 await page.evaluate(({role})=>{
  window.me={user_id:'actor',role};window.view='personal';window.$=s=>document.querySelector(s);
  window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  crypto.randomUUID=()=> '00000000-0000-0000-0000-000000000001';
  window.run=fn=>fn();window.message=s=>$('#notice').textContent=s;
  window.rows=[];window.calls=[];window.loads=0;
  window.client={from:()=>{
   let kind,kinds;const query={};
   for(const method of ['select','is','order','gte','lt'])query[method]=()=>query;
   query.eq=(key,value)=>{if(key==='kind')kind=value;return query};
   query.in=(key,value)=>{if(key==='kind')kinds=value;return query};
   query.range=async()=>{loads++;return window.loadError?{error:{message:loadError}}:{data:structuredClone(rows.filter(row=>kinds?kinds.includes(row.kind):row.kind===kind))}};
   return query;
  },rpc:async(name,args)=>{
   calls.push({name,args});if(window.delaySave)await new Promise(resolve=>window.releaseSave=resolve);
   if(window.saveError)return {error:{message:saveError}};
   const saved={id:args.p_id,owner_id:me.user_id,kind:args.p_kind,visibility:args.p_visibility,title:args.p_title,body:args.p_body,starts_at:args.p_starts_at,ends_at:args.p_ends_at,remind_at:args.p_remind_at,priority:args.p_priority,completed:args.p_completed,version:args.p_expected_version+1};
   rows=rows.filter(row=>row.id!==saved.id).concat(saved);return {data:saved};
  }};
 },{role});
 for(const source of sources)await page.addScriptTag({content:source});
 await page.evaluate(async kind=>{personalSection=kind==='task'?'note':kind;personalMonth='2026-09';await personalWorkspace()},kind);
 return page;
}
async function fillEntry(page,kind){
 await page.locator(kind==='note'?'#personalNewNote':'#personalNew').click();
 await page.locator('[name="title"]').fill('Fixture '+kind);
 await page.locator('[name="body"]').fill('Private detail');
 if(kind==='event')await page.locator('[name="starts"]').fill('2026-09-25T10:00');
 if(kind==='event')await page.locator('[name="ends"]').fill('2026-09-25T11:00');
 if(kind==='task'){
  await page.locator('[name="reminder"]').fill('2026-09-25T09:00');
  await page.locator('[name="urgent"]').check();
 }
}
for(const kind of ['event','task','note'])acceptance(`${kind}: create, reload, edit and save use actual form values and original revision`,async t=>{
 const p=await fixture(t,kind);await fillEntry(p,kind);
 assert.equal(await p.locator('#actionFields [name*="contact"]').count(),0);
 await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 const call=await p.evaluate(()=>calls[0]);
 assert.equal(call.name,'save_workspace_entry');
 assert.equal(call.args.p_expected_version,0);assert.equal(call.args.p_kind,kind);
 assert.equal(call.args.p_visibility,'personal');assert.equal(call.args.p_remind_at,kind==='task'?'2026-09-25T09:00:00.000Z':null);
 assert.equal(call.args.p_starts_at,kind==='note'?null:kind==='task'?'2026-09-25T09:00:00.000Z':'2026-09-25T10:00:00.000Z');
 assert.equal(call.args.p_body,'Private detail');assert.equal(call.args.p_priority,kind==='task'?'urgent':'normal');
 assert.ok(await p.evaluate(()=>loads>=2));
 assert.equal(await p.locator('.personal-entry h2').textContent(),'Fixture '+kind);
 await p.locator('[data-personal-edit]').click();
 assert.equal(await p.locator('[name="body"]').inputValue(),'Private detail');
 await p.locator('[name="title"]').fill('Updated '+kind);
 if(kind==='task')await p.locator('[name="completed"]').check();
 await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>calls.length===2&&!document.querySelector('#actionEditor').open);
 assert.equal(await p.evaluate(()=>calls[1].args.p_expected_version),1);
 assert.equal(await p.evaluate(()=>calls[1].args.p_completed),kind==='task');
 assert.equal(await p.locator('.personal-entry h2').textContent(),'Updated '+kind);
});
acceptance('Company events render green and personal entries white; staff cannot edit shared events',async t=>{
 const p=await fixture(t);
 await p.evaluate(async()=>{rows=[{id:'shared',kind:'event',visibility:'company',owner_id:'owner',title:'Meeting',starts_at:'2026-09-25T10:00:00Z'},{id:'own',kind:'event',visibility:'personal',owner_id:'actor',title:'Private',starts_at:'2026-09-25T11:00:00Z'}];await personalWorkspace()});
 assert.equal(await p.locator('.personal-entry.company-event').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(228, 242, 220)');
 assert.equal(await p.locator('.personal-entry.personal-event').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 assert.equal(await p.locator('.company-event [data-personal-edit]').count(),0);
 await p.locator('#personalNew').click();assert.equal(await p.locator('[name="visibility"]').count(),0);
});
acceptance('Owner can create company event with shared visibility',async t=>{
 const p=await fixture(t,'event','owner');await fillEntry(p,'event');
 await p.locator('[name="visibility"]').selectOption('company');
 await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>calls.length===1&&!document.querySelector('#actionEditor').open);
 assert.equal(await p.evaluate(()=>calls[0].args.p_visibility),'company');
 assert.equal(await p.locator('.personal-entry.company-event').count(),1);
});
acceptance('Server save and list errors appear visibly, preserving rejected form input',async t=>{
 const p=await fixture(t,'note');await fillEntry(p,'note');
 await p.evaluate(()=>window.saveError='Entry changed; refresh before saving');
 await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>document.querySelector('#actionError').textContent.includes('Entry changed'));
 assert.equal(await p.locator('[name="body"]').inputValue(),'Private detail');
 assert.equal(await p.locator('#actionEditor').evaluate(el=>el.open),true);
 await p.locator('#actionCancel').click();
 await p.evaluate(async()=>{window.loadError='Fixture database unavailable';await personalWorkspace()});
 assert.match(await p.locator('#content [role="alert"]').textContent(),/Fixture database unavailable/);
});
acceptance('Actor and navigation changes during save cannot refresh or notify replacement page',async t=>{
 for(const changed of ['actor','view']){
  const p=await fixture(t,'note');await fillEntry(p,'note');
  await p.evaluate(()=>window.delaySave=true);await p.locator('#actionEditor [type="submit"]').click();
  await p.waitForFunction(()=>typeof releaseSave==='function');
  const loads=await p.evaluate(()=>window.loads);
  await p.evaluate(changed=>{if(changed==='actor')me={user_id:'other',role:'staff'};else view='sales';$('#content').textContent='Replacement page';releaseSave()},changed);
  await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
  assert.equal(await p.locator('#content').innerText(),'Replacement page');
  assert.equal(await p.locator('#notice').innerText(),'');assert.equal(await p.evaluate(()=>window.loads),loads);
 }
});
test('Notes and reminders persist through SQL; revoked staff cannot save or read', {skip:!enabled||!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();t.after(()=>db.close());
 const actor='10000000-0000-4000-8000-000000000001';
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table staff(user_id uuid primary key,active boolean,role text);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 insert into auth.users values('${actor}');insert into staff values('${actor}',true,'staff');`);
 const foundation=readFileSync(new URL('../supabase/migrations/202609210001_inventory_foundation.sql',import.meta.url),'utf8');
 for(const name of ['inventory_active_staff','inventory_owner']){
  const declaration=foundation.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`));
  assert.ok(declaration);await db.exec(declaration[0]);
 }
 await db.exec(readFileSync(new URL('../supabase/migrations/202609220012_personal_workspace.sql',import.meta.url),'utf8'));
 const p=await fixture(t,'note'),errors=[];p.on('pageerror',e=>errors.push(e.message));
 let tail=Promise.resolve();
 await p.exposeFunction('workspaceSql',request=>{
  const result=tail.then(()=>db.transaction(async tx=>{
   await tx.exec('set local role authenticated');await tx.query("select set_config('test.actor',$1,true)",[actor]);
   if(request.read)return {data:(await tx.query('select * from workspace_entries where deleted_at is null and kind=any($1::text[]) order by id limit 100',[request.kinds])).rows};
   assert.equal(request.name,'save_workspace_entry');const a=request.args;
   return {data:(await tx.query('select * from save_workspace_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[a.p_id,a.p_expected_version,a.p_kind,a.p_visibility,a.p_title,a.p_body,a.p_starts_at,a.p_ends_at,a.p_remind_at,a.p_priority,a.p_completed,a.p_deleted])).rows[0]};
  }));tail=result.catch(()=>{});return result.catch(e=>({error:{message:e.message}}));
 });
 await p.evaluate(async actor=>{
  me={user_id:actor,role:'staff'};
  client={rpc:(name,args)=>workspaceSql({name,args}),from:table=>{
   if(table!=='workspace_entries')throw Error('Unexpected fixture table');
   let kinds=[];const q={};for(const key of ['select','is','order'])q[key]=()=>q;
   q.in=(key,value)=>{kinds=value;return q};q.eq=(key,value)=>{kinds=[value];return q};
   q.range=()=>workspaceSql({read:true,kinds});return q;
  }};await personalWorkspace();
 },actor);
 await fillEntry(p,'note');await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 const saved=(await db.query('select * from workspace_entries')).rows;
 assert.equal(saved.length,1);assert.equal(saved[0].owner_id,actor);assert.equal(saved[0].body,'Private detail');
 await p.evaluate(async()=>{personalRows=[];await personalWorkspace()});
 await p.locator('[data-personal-edit]').click();assert.equal(await p.locator('[name="body"]').inputValue(),'Private detail');
 await p.locator('[name="title"]').fill('SQL updated note');await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 const changed=(await db.query('select * from workspace_entries')).rows[0];
 assert.equal(changed.version,2);assert.equal(changed.title,'SQL updated note');
 assert.equal((await db.query('select * from workspace_entry_audit')).rows.length,2);assert.deepEqual(errors,[]);
 await p.evaluate(()=>{crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000002'});
 await fillEntry(p,'task');await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 let reminder=(await db.query("select * from workspace_entries where kind='task'")).rows[0];
 assert.equal(new Date(reminder.remind_at).toISOString(),'2026-09-25T09:00:00.000Z');
 assert.equal(reminder.priority,'urgent');assert.equal(reminder.completed,false);
 await p.locator('.personal-entry').filter({has:p.locator('h2', {hasText:'Fixture task'})}).locator('[data-personal-edit]').click();
 await p.locator('[name="completed"]').check();
 await p.locator('#actionEditor [type="submit"]').click();await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
 reminder=(await db.query("select * from workspace_entries where kind='task'")).rows[0];
 assert.equal(reminder.completed,true);assert.equal(reminder.version,2);
 await p.locator('.personal-entry').filter({has:p.locator('h2', {hasText:'SQL updated note'})}).locator('[data-personal-edit]').click();
 const before=(await db.query('select * from workspace_entry_audit order by id')).rows;
 await db.query('update staff set active=false where user_id=$1',[actor]);
 await p.locator('[name="body"]').fill('Must not persist');
 await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>document.querySelector('#actionError').textContent.includes('Active staff'));
 assert.equal(await p.locator('[name="body"]').inputValue(),'Must not persist');
 assert.equal((await db.query("select body from workspace_entries where kind='note'")).rows[0].body,'Private detail');
 assert.deepEqual((await db.query('select * from workspace_entry_audit order by id')).rows,before);
 await p.locator('#actionCancel').click();await p.evaluate(()=>personalWorkspace());
 assert.equal(await p.locator('.personal-entry').count(),0);assert.deepEqual(errors,[]);
});
