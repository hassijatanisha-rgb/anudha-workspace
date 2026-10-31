import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(storage){
 const html={style:{},dataset:{}};
 const ctx=vm.createContext({workspacePageHeader,document:{documentElement:html},localStorage:storage});
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
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),html=read('index.src.html');
 assert.match(read('workspace-navigation.js'),/\['My settings','settings'\]/);assert.match(read('app.js'),/view==='settings'\)return settingsWorkspace\(\)/);
 assert.ok(html.indexOf('user-settings.js')>html.indexOf('reports.js')&&html.indexOf('user-settings.js')<html.indexOf('app.js'));
});
test('appearance restores only recognized preferences, defaults to System, and needs no network',()=>{
 for(const choice of ['system','light','dark'])assert.equal(load(memory({'anudha.theme':choice})).html.dataset.theme,choice);
 for(const choice of ['','sepia','__proto__','<img src=x>'])assert.equal(load(memory({'anudha.theme':choice})).html.dataset.theme,'system');
 const storage=memory(),{ctx,html}=load(storage);assert.equal(ctx.saveWorkspaceTheme('dark'),true);assert.equal(html.dataset.theme,'dark');assert.equal(storage.data['anudha.theme'],'dark');
 assert.throws(()=>ctx.saveWorkspaceTheme('sepia'),/Choose Light, Dark or System/);assert.equal(html.dataset.theme,'dark');assert.equal(storage.data['anudha.theme'],'dark');
 assert.equal(ctx.saveWorkspaceTheme('system'),true);assert.equal(html.dataset.theme,'system');
});
test('blocked appearance storage retains the explicit choice for this visit and reports it was not saved',()=>{
 const {ctx,html}=load({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});assert.equal(html.dataset.theme,'system');
 assert.equal(ctx.saveWorkspaceTheme('light'),false);assert.equal(html.dataset.theme,'light');ctx.applyWorkspaceTheme();assert.equal(html.dataset.theme,'light');
});
