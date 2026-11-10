import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
const root=new URL('../',import.meta.url);
const source=readFileSync(new URL('how-to-use.js',root),'utf8');
const otherScreens=readdirSync(root).filter(name=>name.endsWith('.js')&&name!=='how-to-use.js').map(name=>readFileSync(new URL(name,root),'utf8')).join('\n');
const nav=readFileSync(new URL('workspace-navigation.js',root),'utf8');
function load(role='staff'){
 const ctx=vm.createContext({document:{addEventListener(){},querySelector:()=>null},me:{role},view:'contacts',esc:value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))});
 vm.runInContext(readFileSync(new URL('accounting-shell.js',root),'utf8'),ctx);
 vm.runInContext(source+';globalThis.topics=howToTopics;globalThis.accountingScreens=new Set(accountingMenu.flatMap(([,items])=>items.map(([key])=>key===\'forms\'?\'accounting\':\'books:\'+key)));',ctx);return ctx;
}
test('every button or menu item a guide names exists on a screen',()=>{
 const named=[...source.replace(/^\/\/.*$/gm,'').matchAll(/\*\*(.+?)\*\*/g)].map(match=>match[1]);
 assert.ok(named.length>=60);
 for(const label of new Set(named))assert.ok(otherScreens.includes(label)||otherScreens.includes(label.replaceAll('&','&amp;')),`How to use names "${label}" but no screen shows it`);
});
test('every guide points at a real menu page or accounting module and has steps',()=>{
 const {topics,accountingScreens}=load();
 assert.ok(topics.length>=20);
 for(const topic of topics){
  assert.ok(topic.steps.length>=1,topic.id);
  for(const screen of topic.screens){const [target,section]=screen.split(':');assert.ok(accountingScreens.has(screen)||target==='contacts'||target==='review'||nav.includes(section?`'${target}','${section}'`:`'${target}'`),`${topic.id} → ${screen}`);}
 }
 assert.equal(new Set(topics.map(topic=>topic.id)).size,topics.length);
});
test('financial walkthroughs forward their exact module and original leave context',async()=>{
 const ctx=load(),calls=[],context={current:()=>true};ctx.workspaceNavigationContext=()=>context;ctx.openAccountingSection=async(section,options)=>calls.push({section,...options});
 for(const screen of ['books:invoices','books:receipts','books:journal','books:accounts','books:reports','books','accounting'])await ctx.howToGo(screen);
 assert.deepEqual(calls.map(call=>call.section),['invoices','receipts','journal','accounts','reports','overview','forms']);assert.ok(calls.every(call=>call.context===context));
});
test('financial walkthrough navigation retains permission and unsaved-change guards',async()=>{
 for(const mode of ['allowed','denied','dirty']){
  const f=mainPageFixture({accounting:mode!=='denied'}),renders=[];f.ctx.actor=f.actor;f.evaluate("me=actor;view='sales';salesSection='proformas';salesEditing=''");f.document.querySelector('#nav').hidden=false;f.document.querySelector('#nav [data-view="books"]').hidden=false;f.ctx.render=async()=>renders.push(f.evaluate('booksSection'));
  if(mode==='dirty'){f.document.querySelector('#content').innerHTML='<form id="proformaForm"><input name="notes" value="Original"></form>';const form=f.document.querySelector('form'),input=form.querySelector('input');input.name='notes';form.dataset.initialState=f.ctx.salesEditorState(form);input.value='Unsaved';f.evaluate("salesEditing='draft'");f.ctx.askConfirm=async()=>false;}
  await f.ctx.howToGo('books:receipts');assert.deepEqual(renders,mode==='allowed'?['receipts']:[]);assert.equal(f.ctx.location.hash,mode==='allowed'?'#/go/books/receipts':'');assert.equal(f.calls.length,mode==='dirty'?0:1);
 }
});
test('guides use plain language and no technical or back-end words',()=>{
 assert.doesNotMatch(source.replace(/^\/\/.*$/gm,''),/Supabase|database|RPC|JSON|backend|immutable|snapshot|uuid|ChatGPT|Other staff cannot read|colleagues see it/i);
 for(const menu of ['Create Pro forma','Delivery progress','Machines to install','Deleted items','Mark my step done'])assert.match(source,new RegExp(menu));
});
test('search and role filters narrow the guides; owner guides are hidden from staff',()=>{
 const ctx=load();
 // Tax invoices are made in the ERP (16 Oct 2026): no guide sends staff to TallyPrime to make one.
 assert.ok(ctx.topics.every(topic=>!/tax invoice in TallyPrime|Send to Tally|Tally invoices/i.test(topic.title+topic.steps.join(' '))));
 assert.ok(ctx.topics.some(topic=>/Record TRA receipt/.test(topic.steps.join(' '))));
 assert.ok(ctx.topics.filter(topic=>ctx.howToMatches(topic,'','service')).every(topic=>topic.role==='service'));
 assert.equal(ctx.topics.filter(ctx.howToVisible).some(topic=>topic.id==='staff'),false);
 assert.equal(load('owner').topics.filter(load('owner').howToVisible).length>ctx.topics.filter(ctx.howToVisible).length,true);
 assert.ok(ctx.howToForScreen(ctx.topics.find(topic=>topic.id==='delivery'),'sales:delivery'));
 assert.ok(ctx.howToForScreen(ctx.topics.find(topic=>topic.id==='pending'),'pending'));
 assert.match(ctx.howToStep('Press **Save** <now>'),/Press <strong>Save<\/strong> &lt;now&gt;/);
});
