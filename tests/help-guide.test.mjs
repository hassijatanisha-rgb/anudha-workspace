import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const source=readFileSync(new URL('how-to-use.js',root),'utf8');
const otherScreens=readdirSync(root).filter(name=>name.endsWith('.js')&&name!=='how-to-use.js').map(name=>readFileSync(new URL(name,root),'utf8')).join('\n');
const nav=readFileSync(new URL('workspace-navigation.js',root),'utf8');
function load(role='staff'){
 const ctx=vm.createContext({document:{addEventListener(){},querySelector:()=>null},me:{role},view:'contacts',esc:value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))});
 vm.runInContext(source+';globalThis.topics=howToTopics;',ctx);return ctx;
}
test('every button or menu item a guide names exists on a screen',()=>{
 const named=[...source.replace(/^\/\/.*$/gm,'').matchAll(/\*\*(.+?)\*\*/g)].map(match=>match[1]);
 assert.ok(named.length>=60);
 for(const label of new Set(named))assert.ok(otherScreens.includes(label)||otherScreens.includes(label.replaceAll('&','&amp;')),`How to use names "${label}" but no screen shows it`);
});
test('every guide points at a real menu page and has steps',()=>{
 const {topics}=load();
 assert.ok(topics.length>=20);
 for(const topic of topics){
  assert.ok(topic.steps.length>=1,topic.id);
  for(const screen of topic.screens){const [target,section]=screen.split(':');assert.ok(target==='contacts'||target==='review'||nav.includes(section?`'${target}','${section}'`:`'${target}'`),`${topic.id} → ${screen}`);}
 }
 assert.equal(new Set(topics.map(topic=>topic.id)).size,topics.length);
});
test('guides use plain language and no technical or back-end words',()=>{
 assert.doesNotMatch(source.replace(/^\/\/.*$/gm,''),/Supabase|database|RPC|JSON|backend|immutable|snapshot|uuid|ChatGPT|Other staff cannot read|colleagues see it/i);
 for(const menu of ['Create Pro forma','Delivery progress','Machines to install','Deleted items','Send to Tally','Mark my step done'])assert.match(source,new RegExp(menu));
});
test('search and role filters narrow the guides; owner guides are hidden from staff',()=>{
 const ctx=load();
 const tally=ctx.topics.filter(topic=>ctx.howToMatches(topic,'tally',''));
 assert.ok(tally.some(topic=>topic.id==='tally-send')&&tally.every(topic=>/tally/i.test(topic.title+topic.steps.join(' '))));
 assert.ok(ctx.topics.filter(topic=>ctx.howToMatches(topic,'','service')).every(topic=>topic.role==='service'));
 assert.equal(ctx.topics.filter(ctx.howToVisible).some(topic=>topic.id==='staff'),false);
 assert.equal(load('owner').topics.filter(load('owner').howToVisible).length>ctx.topics.filter(ctx.howToVisible).length,true);
 assert.ok(ctx.howToForScreen(ctx.topics.find(topic=>topic.id==='delivery'),'sales:delivery'));
 assert.ok(ctx.howToForScreen(ctx.topics.find(topic=>topic.id==='pending'),'pending'));
 assert.match(ctx.howToStep('Press **Save** <now>'),/Press <strong>Save<\/strong> &lt;now&gt;/);
});
