import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './helpers/dom-identity.mjs';
import {serializeLandingNode} from './helpers/landing-snapshot.mjs';
import {cases,openMainPageScenario} from './helpers/main-page-scenarios.mjs';

const tags=node=>node.children.filter(child=>child.tag).map(child=>child.tag);

test('SVG self-closing shapes leave later shapes and HTML labels as siblings',()=>{
 const document=dom();document.body.innerHTML='<button><svg viewBox="0 0 24 24"><g><circle cx="10"/><path d="m15 15 5 5" /></g><path d="M0 0"/></svg><span>Search</span></button><p>After</p>';
 const button=document.querySelector('button'),svg=document.querySelector('svg'),group=document.querySelector('g');
 assert.deepEqual(tags(document.body),['button','p']);assert.deepEqual(tags(button),['svg','span']);assert.deepEqual(tags(svg),['g','path']);assert.deepEqual(tags(group),['circle','path']);
 assert.equal(svg.getAttribute('viewBox'),'0 0 24 24');assert.equal(document.querySelector('circle').children.length,0);assert.equal(group.querySelector('path').children.length,0);
 assert.match(serializeLandingNode(button),/<circle cx="10"><\/circle><path d="m15 15 5 5"><\/path><\/g><path d="M0 0"><\/path><\/svg><span>Search<\/span><\/button>$/);
});

test('HTML nonvoid slash syntax remains open and existing HTML void elements stay void',()=>{
 const document=dom();document.body.innerHTML='<div/><span>Inside div</span></div><circle/><span>Inside HTML circle</span></circle><p>After</p>';
 assert.deepEqual(tags(document.body),['div','circle','p']);assert.deepEqual(tags(document.querySelector('div')),['span']);assert.deepEqual(tags(document.querySelector('circle')),['span']);
 for(const tag of ['input','br','hr','img','meta','link']){
  document.body.innerHTML=`<div><${tag}/><span>After void</span></div>`;
  assert.deepEqual(tags(document.querySelector('div')),[tag,'span'],tag);assert.equal(document.querySelector(tag).children.length,0,tag);
 }
});

test('SVG HTML integration points do not make HTML slash syntax self-closing',()=>{
 const document=dom();
 for(const tag of ['foreignObject','desc','title']){
  document.body.innerHTML=`<svg><${tag} id="integration"><div/><span>Inside div</span></div><svg><circle/><path/></svg></${tag}><path/></svg><p>After</p>`;
  const outer=document.querySelector('svg'),integration=document.querySelector('#integration'),inner=integration.querySelector('svg');
  assert.deepEqual(tags(document.body),['svg','p'],tag);assert.deepEqual(tags(outer),[tag,'path'],tag);assert.deepEqual(tags(integration),['div','svg'],tag);assert.deepEqual(tags(integration.querySelector('div')),['span'],tag);assert.deepEqual(tags(inner),['circle','path'],tag);
 }
});

test('actual Search and account icons serialize with their labels and controls outside the SVG',async()=>{
 const fixture=await openMainPageScenario(cases.find(entry=>entry.name==='Stock'),'owner'),document=fixture.document;
 const search=document.querySelector('#workspaceSearch'),menu=document.querySelector('#accountMenu'),summary=menu.querySelector('summary'),searchSvg=search.querySelector('svg'),accountSvg=summary.querySelector('svg');
 assert.deepEqual(tags(search),['svg','span','kbd']);assert.deepEqual(tags(summary),['svg','span']);assert.deepEqual(tags(menu),['summary','div']);
 for(const svg of [searchSvg,accountSvg]){assert.deepEqual(tags(svg),['circle','path']);assert.equal(svg.getAttribute('viewBox'),'0 0 24 24');assert.ok(svg.children.every(node=>!node.children.length));}
 const searchHtml=serializeLandingNode(search),accountHtml=serializeLandingNode(menu);
 assert.match(searchHtml,/<circle[^>]*><\/circle><path[^>]*><\/path><\/svg><span>Search<\/span> <kbd aria-hidden="true">Ctrl \/ ⌘ K<\/kbd><\/button>$/);
 assert.match(accountHtml,/<circle[^>]*><\/circle><path[^>]*><\/path><\/svg><span class="identity-name">Fictional Current Employee<\/span><\/summary><div class="account-menu-actions" hidden="">/);
 assert.match(accountHtml,/<button id="logout" type="button">Sign out<\/button><\/div><\/details>$/);
 const reparsed=dom();reparsed.body.innerHTML=searchHtml+accountHtml;
 assert.deepEqual(tags(reparsed.body),['button','details']);assert.deepEqual(tags(reparsed.querySelector('#workspaceSearch')),['svg','span','kbd']);assert.deepEqual(tags(reparsed.querySelector('#accountMenu')),['summary','div']);
});
