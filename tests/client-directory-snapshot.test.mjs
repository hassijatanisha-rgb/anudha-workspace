import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryFixture,directoryRows,plain} from './helpers/client-directory-fixture.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('actual sign-in/router reads one CRM snapshot plus five modeled common reads; editor caches remain untouched',async()=>{
 const f=directoryFixture({rows:directoryRows()});
 f.run("organizations=[{id:'cached-org'}];contacts=[{id:'cached-contact'}];products=[{id:'cached-product'}]");
 await f.ctx.load();
 assert.equal(f.reads.length,6);assert.equal(f.reads.filter(name=>name==='client_directory_snapshot').length,1);
 assert.equal(f.run('listsLoaded'),false);assert.equal(f.run('listsLoading'),null);assert.equal(f.run('selected'),'');
 assert.equal(f.run('organizations[0].id'),'cached-org');assert.equal(f.run('contacts[0].id'),'cached-contact');assert.equal(f.run('products[0].id'),'cached-product');
 assert.equal((f.content.innerHTML.match(/class="profile-tile /g)||[]).length,30);
 assert.match(f.content.innerHTML,/1073 clients/);
 f.run('page=1');await f.ctx.render();assert.equal(f.reads.filter(name=>name==='client_directory_snapshot').length,1);
 f.run("view='review';page=0");await f.ctx.render();assert.match(f.content.innerHTML,/Fix contacts/);assert.equal((f.content.innerHTML.match(/<article /g)||[]).length,30);
 assert.equal(f.reads.filter(name=>name==='client_directory_snapshot').length,1);
});

test('more than 1000 families retain shared-list sort, all-page search, revision and duplicate parity',async()=>{
 const rows=directoryRows(),f=directoryFixture({rows});await f.ctx.render();
 const snapshot=f.run('clientDirectoryData'),snapshotState=plain([...snapshot.accountReviewCounts]),snapDuplicates=plain([...snapshot.duplicates]);
 f.ctx.legacyRows=plain(rows);f.run('organizations=legacyRows.organizations;contacts=legacyRows.contacts;organizations.sort((a,b)=>a.name.localeCompare(b.name));scan()');
 assert.deepEqual(plain(f.run('[...accountReviewCounts]')),snapshotState);assert.deepEqual(plain(f.run('[...duplicates]')),snapDuplicates);
 f.ctx.snapshot=snapshot;
 const current=f.run('({organizations,contacts,orgIndex,childrenByParent,contactIssues,accountIssues,accountReviewCounts,duplicates})');f.ctx.shared=current;
 for(const query of ['', 'Arusha', 'client 0107', 'École', '+255 (710) 000-007', '999000777', '%', "' OR true --", '李']){
  f.ctx.query=query;f.run('search=query;page=0;profileDirectory(snapshot)');const first=f.content.innerHTML,pages=Math.max(1,Math.ceil(rows.organizations.length/2/30));
  f.run('profileDirectory(shared)');assert.equal(f.content.innerHTML,first,query);
  if(!query)for(let page=0;page<pages;page++){f.run('page='+page+';profileDirectory(snapshot)');const expected=f.content.innerHTML;f.run('profileDirectory(shared)');assert.equal(f.content.innerHTML,expected,'page '+page);}
  f.run('page=0;reviewQueue(snapshot)');const review=f.content.innerHTML;f.run('reviewQueue(shared)');assert.equal(f.content.innerHTML,review,'review '+query);
 }
 assert.equal(snapshot.contactIssues.get('c1').some(text=>text.includes('capital')),false,'Unicode uppercase remains valid');
 assert.ok(snapshot.contactIssues.get('c2').some(text=>text.includes('capital')),'uncased Unicode retains the current rule');
 assert.ok(snapshot.contactIssues.get('c3').some(text=>text.includes('numbering plan')));
 assert.ok(snapshot.contactIssues.get('c4').includes('Choose a country.'));
 assert.equal(snapshot.contactIssues.get('c5').some(text=>/digits|numbering plan|Calling/.test(text)),false,'US length and metadata remain valid');
 assert.ok(snapshot.accountIssues.get('o00002').includes('Account name'));
 assert.ok(snapshot.accountIssues.get('o00003').includes('Account name: use Title Case'));
 assert.ok(snapshot.duplicates.has('c10'));assert.equal(snapshot.duplicates.has('c7'),false,'incorrect records do not create duplicates');
});

test('directory and review escape row values and reason text, including empty and missing-parent records',async()=>{
 const rows=directoryRows(2);rows.organizations[0].name='<img src=x onerror=alert(1)>';rows.contacts[0].first_name='<svg>';rows.contacts.push({...rows.contacts[0],id:'orphan',organization_id:'hidden-parent'});
 const f=directoryFixture({rows});await f.ctx.render();assert.doesNotMatch(f.content.innerHTML,/<img/);assert.match(f.content.innerHTML,/&lt;img/);
 f.run("view='review'");await f.ctx.render();assert.doesNotMatch(f.content.innerHTML,/<svg>/);assert.match(f.content.innerHTML,/Account missing/);
});

test('same-user actor replacement, clear and refresh reject late snapshots and failures',async()=>{
 for(const reset of ["me={...me}",'clearClientDirectory()'])for(const reject of [false,true]){
  const wait=deferred(),f=directoryFixture({rpc:()=>wait.promise});const old=f.ctx.render();f.run(reset);f.content.innerHTML='New session';
  if(reject)wait.reject(Error('Old failure'));else wait.resolve({data:directoryRows(1)});await old;
  assert.equal(f.content.innerHTML,'New session');assert.equal(f.run('clientDirectoryData'),null);
 }
 const wait=deferred();let calls=0;const f=directoryFixture({rpc:()=>++calls===1?wait.promise:Promise.resolve({data:directoryRows(3)})});const old=f.ctx.render();await f.ctx.clientDirectoryWorkspace(true);wait.resolve({data:directoryRows(1)});await old;assert.match(f.content.innerHTML,/3 clients/);assert.equal(f.run('clientDirectoryData.organizations.length'),6);
});

test('route changes cannot draw a late directory; concurrent opens share one request',async()=>{
 const wait=deferred(),f=directoryFixture({rpc:()=>wait.promise});const old=f.ctx.render(),other=f.ctx.render();assert.equal(f.reads.filter(name=>name==='client_directory_snapshot').length,1);
 f.run("view='dashboard'");f.content.innerHTML='Dashboard';wait.resolve({data:directoryRows(1)});await Promise.all([old,other]);assert.equal(f.content.innerHTML,'Dashboard');
});

test('failed and malformed snapshots stay closed and Retry uses the one-read path',async()=>{
 for(const result of [{error:{message:'Denied <request>'}},{data:{organizations:[]}}]){
  let calls=0;const f=directoryFixture({rpc:()=>Promise.resolve(++calls===1?result:{data:directoryRows(1)})});await f.ctx.render();assert.match(f.content.innerHTML,/Client directory unavailable/);assert.doesNotMatch(f.content.innerHTML,/data-edit=|<request>/);assert.equal(f.run('clientDirectoryData'),null);
  await f.click({id:'refresh'});assert.match(f.content.innerHTML,/1 clients/);assert.equal(calls,2);assert.equal(f.run('listsLoaded'),false);
 }
});

test('explicit client and branch routes hydrate complete editor lists; root directory never auto-selects',async()=>{
 for(const kind of ['client','branch']){
  const f=directoryFixture({hash:'#/'+kind+'/o00001'});f.ctx.hydration=[];
  f.run("loadLists=async()=>{hydration.push('full');organizations=fixtureRows.organizations;contacts=fixtureRows.contacts;products=[{id:'full-product'}];scan();listsLoaded=true;return true};profileParent=o=>{document.querySelector('#content').innerHTML='Parent '+o.id};profileBranch=o=>{document.querySelector('#content').innerHTML='Branch '+o.id}");f.ctx.fixtureRows=directoryRows(2);
  await f.ctx.render();assert.equal(f.ctx.hydration.length,1);assert.equal(f.run('products[0].id'),'full-product');assert.equal(f.reads.includes('client_directory_snapshot'),false);
 }
});

test('actual Add/Edit/Delete clicks hydrate full rows with revisions before opening; failed hydration refuses actions',async()=>{
 for(const button of [{id:'newOrg'},{dataset:{edit:'c1'}},{dataset:{deleteContact:'c1'}}]){
  const f=directoryFixture();await f.ctx.render();f.ctx.fixtureRows=directoryRows(2);f.ctx.actions=[];
  f.run("loadLists=async()=>{organizations=fixtureRows.organizations;contacts=fixtureRows.contacts;products=[{id:'full-product'}];scan();listsLoaded=true;return true};edit=c=>actions.push(c.revision)");
  await f.click(button);assert.equal(f.run('listsLoaded'),true);assert.equal(f.run('products[0].id'),'full-product');
  if(button.dataset?.edit)assert.deepEqual(plain(f.ctx.actions),[5]);else assert.equal(f.opened.length,1);
  const input=f.nodes.get('#orgSearch');input.oninput({target:{value:'Unmatched after cancelling editor'}});assert.match(f.content.innerHTML,/No clients found/);
  const failed=directoryFixture();await failed.ctx.render();failed.run("loadLists=async()=>{throw Error('Full details unavailable')}");await failed.click(button);assert.equal(failed.opened.length,0);assert.deepEqual(failed.errors,['Full details unavailable']);
 }
});

test('late editor hydration cannot open for a replaced actor, navigated route or disconnected origin',async()=>{
 for(const change of ["me={...me}","view='dashboard'",null]){
  const wait=deferred(),f=directoryFixture();await f.ctx.render();f.ctx.wait=wait.promise;f.run('loadLists=()=>wait');let called=0;const origin={isConnected:true};const action=f.ctx.withClientDirectoryLists(()=>called++,origin);
  if(change)f.run(change);else origin.isConnected=false;f.run('listsLoaded=true');wait.resolve(true);await action;assert.equal(called,0);
 }
});

test('shared list invalidation or successful legacy scan invalidates the separate directory without touching disk cache',async()=>{
 const f=directoryFixture();await f.ctx.render();f.run('listsEpoch++');await f.ctx.render();assert.equal(f.reads.filter(name=>name==='client_directory_snapshot').length,2);
 f.run('scan()');assert.equal(f.run('clientDirectoryData'),null);await f.ctx.render();assert.equal(f.reads.filter(name=>name==='client_directory_snapshot').length,3);
});

test('contact review cold route also uses six modeled reads; stale search cannot redraw or change a new session',async()=>{
 const f=directoryFixture({rows:directoryRows(100)});f.run("view='review'");await f.ctx.load();assert.equal(f.reads.length,6);assert.equal((f.content.innerHTML.match(/<article /g)||[]).length,30);
 const input=f.nodes.get('#reviewSearch');f.run("me={...me};search='new session'");f.content.innerHTML='New session';input.oninput({target:{value:'Old search'}});assert.equal(f.content.innerHTML,'New session');assert.equal(f.run('search'),'new session');
});

test('opening an already hydrated profile invalidates directory approval labels before returning',async()=>{
 const f=directoryFixture();await f.ctx.render();f.ctx.full=directoryRows(2);f.run("organizations=full.organizations;contacts=full.contacts;listsLoaded=true;indexCompleteness();location.hash='#/client/o00001';profileParent=()=>{};profileView()");assert.equal(f.run('clientDirectoryData'),null);
 f.ctx.location.hash='#/clients';await f.ctx.render();assert.equal(f.reads.filter(name=>name==='client_directory_snapshot').length,2);
});
