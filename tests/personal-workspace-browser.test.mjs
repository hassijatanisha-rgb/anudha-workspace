import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const enabled=process.env.PERSONAL_BROWSER_QA==='1';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const sources=['client-rules.js','ui-page-header.js','ui-dialogs.js','action-feedback.js','personal-workspace-domain.js','personal-workspace.js','action-forms.js'].map(read);
sources.push(read('app.js').split('\n').find(line=>line.startsWith('async function run(fn)')));
let browser;
test.before(async()=>{
 if(!enabled)return;
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
});
test.after(async()=>{await browser?.close()});
const acceptance=(name,fn)=>test(name,{skip:!enabled&&'Set PERSONAL_BROWSER_QA=1 with local Playwright and Chrome'},fn);
async function fixture(t,kind='event',role='staff'){
 const page=await browser.newPage({timezoneId:'UTC',viewport:{width:390,height:844}});t.after(()=>page.close());page.setDefaultTimeout(3000);
 await page.route('**/*',route=>route.abort());
 await page.setContent('<main><section id="content"></section><div id="notice"></div></main>');
 await page.addStyleTag({content:['tokens.css','style.css','legacy-brand.css','personal-workspace.css','ui-polish.css'].map(read).join('\n')});
 await page.evaluate(({role})=>{
  window.me={user_id:'actor',role};window.view='personal';window.$=s=>document.querySelector(s);
  window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  crypto.randomUUID=()=> '00000000-0000-0000-0000-000000000001';
  window.busy=false;window.workspaceLoading=()=>{};window.replayQueuedNavigation=()=>{};window.friendlyError=error=>error.message;
  window.message=(text,error)=>{if(!actionFeedbackMessage(text,error))$('#notice').textContent=text;};
  window.rows=[];window.calls=[];window.loads=0;
  window.client={from:()=>{
   let kind;const query={};
   for(const method of ['select','is','order','gte','lt'])query[method]=()=>query;
   query.eq=(key,value)=>{if(key==='kind')kind=[value];return query};query.in=(key,value)=>{if(key==='kind')kind=value;return query};
   query.range=async()=>{loads++;return window.loadError?{error:{message:loadError}}:{data:structuredClone(rows.filter(row=>kind.includes(row.kind)))}};
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
 if(kind==='task')await page.getByText('More actions',{exact:true}).click();
 await page.locator(kind==='note'?'#personalNewNote':'#personalNew').click();
 await page.locator('[name="title"]').fill('Fixture '+kind);
 await page.locator('[name="body"]').fill('Private detail');
 if(kind==='event')await page.locator('[name="starts"]').fill('2026-09-25T10:00');
 if(kind==='event')await page.locator('[name="ends"]').fill('2026-09-25T11:00');
 if(kind==='task'){await page.locator('[name="reminder"]').fill('2026-09-25T09:00');await page.locator('[name="urgent"]').check();}
}
acceptance('Notes keeps the primary action visible and details keyboard-accessible from phone to desktop',async t=>{
 const p=await fixture(t,'note');
 assert.equal(await p.getByRole('heading',{name:'Notes',exact:true}).count(),1);
 assert.equal(await p.getByText('No notes or reminders yet.').isVisible(),true);
 assert.equal(await p.locator('#personalPaging').isVisible(),false);
 assert.equal(await p.locator('#personalNew').isVisible(),false);
 await p.getByRole('button',{name:'New note'}).click();
 assert.equal(await p.locator('[name="title"]').inputValue(),'');
 await p.locator('#actionCancel').click();
 await p.waitForFunction(()=>document.activeElement.id==='personalNewNote');
 await p.evaluate(async()=>{rows=[{id:'long',kind:'note',owner_id:'actor',visibility:'personal',title:'LongTitle'.repeat(23),body:'Private <details>',version:1}];await personalWorkspace();});
 for(const width of [320,390,768,1280]){
  await p.setViewportSize({width,height:844});
  await p.evaluate(()=>document.documentElement.style.fontSize='150%');
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const summary=p.locator('.personal-note-row>summary');await summary.focus();await summary.press('Space');
  assert.equal(await p.getByText('Private <details>',{exact:true}).isVisible(),true);
  assert.equal(await p.getByRole('button',{name:'Edit note'}).isVisible(),true);
  await summary.press('Enter');assert.equal(await p.locator('[data-personal-edit]').isVisible(),false);
 }
});
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
 const title=p.locator(kind==='event'?'.personal-entry h2':'.personal-note-row summary strong');
 assert.equal(await title.textContent(),'Fixture '+kind);
 if(kind!=='event'){assert.equal(await p.locator('[data-personal-edit]').isVisible(),false);await p.locator('.personal-note-row summary').press('Enter');}
 await p.locator('[data-personal-edit]').click();
 assert.equal(await p.locator('[name="body"]').inputValue(),'Private detail');
 await p.locator('[name="title"]').fill('Updated '+kind);
 if(kind==='task')await p.locator('[name="completed"]').check();
 await p.locator('#actionEditor [type="submit"]').click();
 await p.waitForFunction(()=>calls.length===2&&!document.querySelector('#actionEditor').open);
 assert.equal(await p.evaluate(()=>calls[1].args.p_expected_version),1);
 assert.equal(await p.evaluate(()=>calls[1].args.p_completed),kind==='task');
 assert.equal(await title.textContent(),'Updated '+kind);
 if(kind!=='event'){assert.equal(await p.locator('.personal-note-row').evaluate(node=>node.open),true);await p.waitForFunction(()=>document.activeElement.matches('[data-personal-edit]'));}
});
acceptance('Company events render green and personal entries white; staff cannot edit shared events',async t=>{
 const p=await fixture(t);
 await p.evaluate(async()=>{rows=[{id:'shared',kind:'event',visibility:'company',owner_id:'owner',title:'Meeting',starts_at:'2026-09-25T10:00:00Z'},{id:'own',kind:'event',visibility:'personal',owner_id:'actor',title:'Private',starts_at:'2026-09-25T11:00:00Z'}];await personalWorkspace()});
 assert.equal(await p.locator('.personal-entry.company-event').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(227, 244, 234)');
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
 await p.getByRole('button',{name:'Discard changes'}).click();
 await p.waitForFunction(()=>!document.querySelector('#actionEditor').open);
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
  await p.waitForFunction(()=>!window.busy);
  assert.equal(await p.locator('#content').innerText(),'Replacement page');
  assert.equal(await p.locator('#notice').innerText(),'');assert.equal(await p.evaluate(()=>window.loads),loads);
 }
});
