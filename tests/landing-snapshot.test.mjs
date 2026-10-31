import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {dom} from './helpers/dom-identity.mjs';
import {landingHead,landingSnapshot,serializeLandingNode,installLandingValueReflection,axeScript,shellScripts,shellBootstrapScript,shellBootstrapSource,snapshotCsp} from './helpers/landing-snapshot.mjs';
import {cases,rpcs,openMainPageScenario} from './helpers/main-page-scenarios.mjs';
import {exportAxeLandings} from '../scripts/export-axe-landings.mjs';

const index='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anudha &amp; Fictional</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="ui-polish.css?v=1"></head><body></body></html>';
const scripts=['/source/ui-motion.js','/source/nav-dropdown.js','/source/ui-page-header.js','/axe-landings/shell-bootstrap.js','/axe-core-4.14.0.min.js'];
const sha256=value=>createHash('sha256').update(value).digest('hex');
function fixture(html=''){
 const document=dom();document.documentElement=document.createElement('html');installLandingValueReflection(document);document.body.innerHTML=html;return document;
}

test('snapshot reflects current boolean state rather than stale markup attributes',()=>{
 const document=fixture('<button id="shown" hidden disabled>Visible</button><button id="hidden">Hidden</button><details><summary>Items</summary><p>Details</p></details><input type="checkbox" checked>');
 const shown=document.querySelector('#shown'),hidden=document.querySelector('#hidden'),details=document.querySelector('details'),check=document.querySelector('input');shown.hidden=false;shown.disabled=false;hidden.hidden=true;hidden.disabled=true;hidden.inert=true;details.open=true;check.checked=false;
 const html=landingSnapshot(document,index);
 assert.match(html,/<button id="shown">Visible<\/button>/);assert.match(html,/<button id="hidden" hidden="" disabled="" inert="">Hidden<\/button>/);assert.match(html,/<details open="">/);assert.doesNotMatch(serializeLandingNode(check),/\schecked=/);
});

test('native initial values and later empty values survive text, textarea and select serialization',()=>{
 const document=fixture('<input value="Original"><textarea>Initial note</textarea><select><option value="">Choose</option><option value="bank" selected>Bank</option></select>'),input=document.querySelector('input'),textarea=document.querySelector('textarea'),select=document.querySelector('select');
 assert.equal(textarea.value,'Initial note');assert.equal(select.value,'bank');assert.match(serializeLandingNode(textarea),/>Initial note<\/textarea>/);assert.match(serializeLandingNode(select),/<option value="bank" selected="">/);
 input.value='Fictional "value" <safe>';textarea.value='';select.value='';
 assert.match(serializeLandingNode(input),/value="Fictional &quot;value&quot; &lt;safe&gt;"/);assert.match(serializeLandingNode(textarea),/><\/textarea>/);assert.match(serializeLandingNode(select),/<option value="" selected="">/);assert.doesNotMatch(serializeLandingNode(select),/<option value="bank" selected/);
});

test('multiple selections and readonly/required states remain intact',()=>{
 const document=fixture('<select multiple><option value="a" selected>A</option><option value="b" selected>B</option></select><input readonly required>'),select=document.querySelector('select'),input=document.querySelector('input');
 assert.equal((serializeLandingNode(select).match(/ selected=""/g)||[]).length,2);select.querySelectorAll('option')[0].selected=false;assert.equal((serializeLandingNode(select).match(/ selected=""/g)||[]).length,1);input.readOnly=false;input.required=false;assert.doesNotMatch(serializeLandingNode(input),/readonly|required/);
});

test('document metadata, authored style order and the exact shell-before-axe script whitelist are preserved safely',()=>{
 const document=fixture('<header><img src="assets/anudha-logo.svg" alt="Fictional logo"></header><main><h1>Fictional landing</h1><form><button>Save</button></form></main>');document.documentElement.setAttribute('data-theme','dark');document.documentElement.setAttribute('data-text-size','large');
 const html=landingSnapshot(document,index),head=landingHead(index);
 assert.deepEqual(head.styles.map(link=>link.href),['/source/tokens.css','/source/ui-polish.css?v=1']);assert.match(html,/<html lang="en" data-theme="dark" data-text-size="large">/);assert.match(html,/<title>Anudha &amp; Fictional<\/title>/);assert.match(html,/name="viewport" content="width=device-width,initial-scale=1"/);assert.match(html,/src="\/assets\/anudha-logo.svg"/);
 assert.deepEqual([...shellScripts,shellBootstrapScript,axeScript],scripts);assert.deepEqual([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match=>match[1]),scripts);assert.equal((html.match(/<script\b/g)||[]).length,scripts.length);assert.match(snapshotCsp,/connect-src 'none'/);assert.match(snapshotCsp,/form-action 'none'/);assert.doesNotMatch(html,/supabase\.co|app\.js|config\.js/);
});

test('hostile text stays text while executable markup, remote passive assets and secret values fail export',()=>{
 const document=fixture('<p></p><textarea></textarea>');document.querySelector('p').textContent='<script>unsafe</script>';document.querySelector('textarea').value='</textarea><script>unsafe</script>';
 const html=landingSnapshot(document,index);assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.equal((html.match(/<script\b/g)||[]).length,scripts.length);
 for(const markup of ['<script src="app.js"></script>','<script src="/source/ui-motion.js"></script>','<iframe src="page.html"></iframe>','<button onclick="save()">Save</button>','<a href="javascript:save()">Save</a>','<img src="https://example.invalid/private.svg">','<img src="../private.svg">','<img srcset="secret.svg 2x">','<input type="password" value="fictional-secret">','<input type="file" value="private.csv">'])assert.throws(()=>landingSnapshot(fixture(markup),index),undefined,markup);
});

test('representative role exports preserve every original navigation visibility decision',async()=>{
 const entry=cases.find(row=>row.name==='Stock');
 for(const role of entry.roles){
  const f=await openMainPageScenario(entry,role,fixture=>installLandingValueReflection(fixture.document)),html=landingSnapshot(f.document,index);
  for(const button of f.document.querySelectorAll('#nav [data-view]')){
   const serialized=serializeLandingNode(button);assert.ok(html.includes(serialized));assert.equal(/\shidden=""/.test(serialized),button.hidden,role+': '+button.textContent);
  }
  assert.equal(f.document.querySelector('#nav').hidden,false);assert.match(html,/<nav[^>]*id="nav"[^>]*aria-label=/);
 }
});

test('the authored shell scripts initialize exported permissions at phone, rail and wide widths without app globals',async()=>{
 const entry=cases.find(row=>row.name==='Stock'),sources=await Promise.all(shellScripts.map(url=>readFile(new URL('../'+url.slice('/source/'.length),import.meta.url),'utf8')));
 for(const role of entry.roles)for(const width of [360,768,1280]){
  const f=await openMainPageScenario(entry,role,fixture=>installLandingValueReflection(fixture.document)),document=f.document,body=serializeLandingNode(document.body);
  // Reparse the exported markup to discard original app handlers before loading
  // only the declared real shell scripts in a fresh, disconnected JS context.
  document.body.innerHTML=body.match(/^<body[^>]*>([\s\S]*)<\/body>$/)[1];document.body.events={};document.readyState='loading';
  const original=document.querySelectorAll('#nav [data-view]').map(button=>({button,hidden:button.hidden,disabled:button.disabled})),storage=new Map();
  Object.getPrototypeOf(document.body).animate=()=>({finished:Promise.resolve(),cancel(){}});
  const ctx=vm.createContext({document,window:{addEventListener(){}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}},matchMedia:query=>({matches:query.includes('max-width')?width<=Number(query.match(/max-width:([\d.]+)/)[1]):false}),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>({'--m-base':'200ms','--m-menu':'120ms','--m-fast':'100ms','--m-fade':'150ms','--ease-out':'ease-out'}[key])})});
  for(let n=0;n<sources.length;n++)vm.runInContext(sources[n],ctx,{filename:shellScripts[n]});
  vm.runInContext(shellBootstrapSource,ctx,{filename:shellBootstrapScript});document.body.emit('DOMContentLoaded');await Promise.resolve();
  const nav=document.querySelector('#nav'),bar=document.querySelector('#workspaceShortcuts'),panel=document.querySelector('#workspaceMenuPanel');
  assert.equal(nav.dataset.dropdown,'1');assert.equal(nav.dataset.shellMode,width===360?'phone':width===768?'rail':'wide');assert.ok(bar);assert.equal(bar.querySelectorAll('button').length,6);assert.equal(bar.querySelectorAll('[data-view]').length,0);assert.equal(panel.hidden,width===360);
  assert.equal(document.documentElement.dataset.landingShellReady,'true');assert.equal(typeof ctx.installWorkspaceHeaderScroll,'function');assert.equal(document.documentElement.hasAttribute('data-workspace-primary'),false,'Stock has no promoted primary action');
  for(const row of original){assert.ok(row.button.isConnected);assert.equal(row.button.hidden,row.hidden);assert.equal(row.button.disabled,row.disabled);}
  const permittedNames=original.filter(row=>!row.hidden).map(row=>row.button.textContent);
  for(const shortcut of bar.querySelectorAll('button').slice(0,5)){const name=shortcut.getAttribute('aria-label');assert.ok(name.includes(shortcut.textContent));assert.ok(permittedNames.some(label=>name.includes(label)));}
  assert.ok(document.querySelector('#howToUse .nav-label'));assert.equal(document.querySelector('#howToUse').getAttribute('aria-label'),'How to use');
  for(const global of ['client','me','run','navigateWorkspace','load','render','fetch','supabase'])assert.equal(vm.runInContext(`typeof ${global}`,ctx),'undefined',global+' is not installed in the export');
 }
});

test('export bootstrap measures only eligible original landing controls without installing application globals',async()=>{
 const sources=await Promise.all(shellScripts.map(url=>readFile(new URL('../'+url.slice('/source/'.length),import.meta.url),'utf8')));
 for(const [page,selector,role] of [['Products','#newProduct','owner'],['Products','#newProduct','staff'],['Pro formas','#newProforma','owner'],['Leads','#newLead','owner'],['Pending stock','#newPending','owner'],['Purchasing','#newPurchase','owner'],['Suppliers','#newSupplier','owner'],['Travel','#travelNew','owner'],['Contracts','[data-contract-new]','owner'],['Delivery',null,'owner']]){
  const f=await openMainPageScenario(cases.find(row=>row.name===page),role,item=>installLandingValueReflection(item.document)),document=f.document,body=serializeLandingNode(document.body),styles=new Map(),observed=[];
  document.body.innerHTML=body.match(/^<body[^>]*>([\s\S]*)<\/body>$/)[1];document.body.events={};document.readyState='loading';document.documentElement._style={setProperty:(key,value)=>styles.set(key,value),removeProperty:key=>styles.delete(key)};
  const original=selector&&document.querySelector(selector);if(original)original.getBoundingClientRect=()=>({height:92.5});
  Object.getPrototypeOf(document.body).animate=()=>({finished:Promise.resolve(),cancel(){}});
  const ctx=vm.createContext({document,window:{scrollY:0,addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{constructor(callback){this.callback=callback;}observe(node){observed.push(node);}disconnect(){}},matchMedia:query=>({matches:query.includes('max-width')?360<=Number(query.match(/max-width:([\d.]+)/)[1]):false}),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>({'--m-base':'200ms','--m-menu':'120ms','--m-fast':'100ms','--m-fade':'150ms','--ease-out':'ease-out'}[key])})});
  for(let n=0;n<sources.length;n++)vm.runInContext(sources[n],ctx,{filename:shellScripts[n]});vm.runInContext(shellBootstrapSource,ctx,{filename:shellBootstrapScript});document.body.emit('DOMContentLoaded');await Promise.resolve();
  assert.equal(document.documentElement.dataset.landingShellReady,'true');assert.equal(document.querySelector('#nav').dataset.shellMode,'phone');
  if(original){assert.equal(ctx.workspacePrimaryCandidate(),original);assert.equal(document.querySelectorAll(selector).length,1);assert.ok(observed.includes(original));assert.equal(styles.get('--workspace-primary-height'),'93px');assert.equal(original.onclick,undefined,'Snapshot has no action handler');}
  else{assert.equal(ctx.workspacePrimaryCandidate(),null);assert.equal(styles.has('--workspace-primary-height'),false);}
  for(const global of ['client','me','run','navigateWorkspace','load','render','fetch','supabase','esc'])assert.equal(vm.runInContext(`typeof ${global}`,ctx),'undefined',global+' is not installed');
 }
});

test('generator exports all 125 ready role/cases with hashed shell scripts, exact bootstrap and axe',async()=>{
 const output=await mkdtemp(join(tmpdir(),'erp-axe-landings-'));
 try{
  const manifest=await exportAxeLandings({output});assert.equal(manifest.completed,true);assert.equal(manifest.navigationTargets,43);assert.equal(manifest.renderedVariants,45);assert.equal(manifest.expectedCases,125);assert.equal(manifest.cases.length,125);assert.equal(new Set(manifest.cases.map(row=>row.id)).size,125);
  assert.deepEqual(Object.fromEntries(['owner','head','staff'].map(role=>[role,manifest.cases.filter(row=>row.role===role).length])),{owner:44,head:41,staff:40});assert.ok(manifest.styles.every(style=>/^[a-f0-9]{64}$/.test(style.sha256)));assert.match(manifest.limitations.join(' '),/Keyboard behavior.*geometry.*larger-text/);assert.match(manifest.limitations.join(' '),/Route buttons and workflow controls are unsupported/);
  assert.equal(manifest.mode,'fictional-landings-with-authored-shell');assert.deepEqual(manifest.runtimeScripts.map(script=>script.url),shellScripts);assert.match(manifest.shellReadiness,/data-shell-mode.*data-landing-shell-ready.*primary-action.*Packing TV/);
  for(const script of manifest.runtimeScripts)assert.equal(script.sha256,sha256(await readFile(new URL('../'+script.path,import.meta.url))));
  assert.equal(await readFile(join(output,'shell-bootstrap.js'),'utf8'),shellBootstrapSource);assert.deepEqual(manifest.shellBootstrap,{url:shellBootstrapScript,sha256:sha256(shellBootstrapSource)});
  const context=vm.createContext({window:{}});vm.runInContext(await readFile(join(output,'manifest.js'),'utf8'),context);assert.equal(context.window.axeLandingCases.length,125);
  for(const item of context.window.axeLandingCases){assert.deepEqual(Object.keys(item),['id','role','page','url']);assert.match(item.url,/^\/axe-landings\/[a-z0-9-]+\.html$/);const html=await readFile(join(output,item.id+'.html'),'utf8');assert.deepEqual([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match=>match[1]),scripts);assert.equal((html.match(/<script\b/g)||[]).length,scripts.length);const record=manifest.cases.find(row=>row.id===item.id);assert.match(record.navigationSha256,/^[a-f0-9]{64}$/);assert.equal(record.markupSha256,sha256(html.match(/<body[^>]*>[\s\S]*?(?=<script)/)[0]+'</body>'));}
 }finally{await rm(output,{recursive:true,force:true});}
});

test('failed fictional reads remain explicit failed manifest records rather than cheap passing exports',async()=>{
 const output=await mkdtemp(join(tmpdir(),'erp-axe-failure-')),original=rpcs.inventory_stock_page;rpcs.inventory_stock_page=()=>{throw Error('Fictional unavailable stock');};
 try{
  const manifest=await exportAxeLandings({output});assert.equal(manifest.completed,false);assert.equal(manifest.cases.length,125);assert.deepEqual(manifest.cases.filter(row=>row.status==='failed').map(row=>row.id),['stock--owner','stock--head','stock--staff']);assert.ok(manifest.cases.filter(row=>row.status==='failed').every(row=>row.error));
  const context=vm.createContext({window:{}});vm.runInContext(await readFile(join(output,'manifest.js'),'utf8'),context);assert.equal(context.window.axeLandingCases.length,122);assert.ok(context.window.axeLandingCases.every(row=>!row.id.startsWith('stock--')));
 }finally{rpcs.inventory_stock_page=original;await rm(output,{recursive:true,force:true});}
});
