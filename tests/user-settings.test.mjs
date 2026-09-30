import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(storage){
 const html={style:{},dataset:{}};
 const ctx=vm.createContext({document:{documentElement:html},localStorage:storage});
 vm.runInContext(readFileSync(new URL('../user-settings.js',import.meta.url),'utf8'),ctx);return {ctx,html};
}
const memory=(initial={})=>{const data={...initial};return {getItem:k=>k in data?data[k]:null,setItem:(k,v)=>{data[k]=String(v)},data};};
test('saved text size is applied on load; unknown or blocked storage falls back to normal',()=>{
 assert.equal(load(memory({'anudha.textSize':'xlarge'})).html.style.zoom,'1.3');
 assert.equal(load(memory({'anudha.textSize':'huge'})).html.style.zoom,'1');
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
 const {ctx,html}=load(blocked);assert.equal(html.style.zoom,'1');
 ctx.saveTextSize('large');assert.equal(html.style.zoom,'1.15','still applies for this visit when storage is blocked');
});
test('saving a size stores and applies it; invalid sizes are refused',()=>{
 const storage=memory(),{ctx,html}=load(storage);
 ctx.saveTextSize('large');assert.equal(storage.data['anudha.textSize'],'large');assert.equal(html.style.zoom,'1.15');assert.equal(html.dataset.textSize,'large');
 assert.throws(()=>ctx.saveTextSize('giant'),/Choose a text size/);assert.equal(html.style.zoom,'1.15');
});
test('no outside connection claims to be connected until a real provider exists',()=>{
 const {ctx}=load(memory());
 assert.deepEqual([...vm.runInContext('externalConnections',ctx)].map(c=>c.status),['Not connected','Not connected','Not connected','Not connected']);
});
test('settings page is in the menu, routed, and loaded before app.js',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),html=read('index.html');
 assert.match(read('workspace-navigation.js'),/\['My settings','settings'\]/);assert.match(read('app.js'),/view==='settings'\)return settingsWorkspace\(\)/);
 assert.ok(html.indexOf('user-settings.js')>html.indexOf('reports.js')&&html.indexOf('user-settings.js')<html.indexOf('app.js'));
});
test('Tally is an external link only, to the configured tallycloud address',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
 const ctx=vm.createContext({globalThis:{},URL});vm.runInContext(read('user-settings.js').replace(/\napplyTextSize\(\);\s*$/,''),ctx);
 const url=cfg=>{vm.runInContext(`globalThis.ERP_CONFIG=${JSON.stringify(cfg)}`,ctx);return ctx.tallyUrl();};
 assert.equal(url({tallyUrl:'https://anudha.tallycloud.in/software/html5.html'}),'https://anudha.tallycloud.in/software/html5.html');
 assert.equal(url({tallyUrl:'http://anudha.tallycloud.in/'}),'','https only');
 assert.equal(url({tallyUrl:'https://tallycloud.in.evil.example/'}),'');assert.equal(url({tallyUrl:'javascript:alert(1)'}),'');assert.equal(url({}),'');
 assert.match(read('config.js'),/tallyUrl:'https:\/\/anudha\.tallycloud\.in\/software\/html5\.html'/);
 assert.match(read('workspace-navigation.js'),/target="_blank" rel="noopener noreferrer"/);
});
