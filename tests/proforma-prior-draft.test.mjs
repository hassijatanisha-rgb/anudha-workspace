import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFixture,recordId,plain,tick} from './helpers/proforma-draft-fixture.mjs';
const otherId='00000000-0000-4000-8000-000000000003';
function prior(){const f=draftFixture();f.field('notes').value='Prior unsaved terms';f.flush();return f;}
function replacement(f){const g=draftFixture({storage:f.storage,mount:false});g.ctx.crypto.randomUUID=()=>otherId;g.mount();g.field('notes').value='Current visible terms';return g;}
const discard=f=>f.form().querySelector('[data-proforma-discard-prior]');

test('another editor preserves the ordinary draft on bind, input, pagehide and rejected replacement Save',async()=>{
 const f=prior(),before=[...f.storage.rows.entries()],g=replacement(f),form=g.form();assert.ok(form.querySelector('[data-proforma-review-prior]'));assert.ok(discard(g));assert.equal(form.querySelector('[type="submit"]').disabled,true);assert.equal(g.field('notes').disabled,false);
 g.fire(g.field('notes'),'input');g.flush();for(const fn of g.events.pagehide)fn();await assert.rejects(g.submit(),/Resolve/);assert.deepEqual([...f.storage.rows.entries()],before);assert.equal(g.calls.length,0);assert.equal(g.field('notes').value,'Current visible terms');
});

test('canceling prior-draft discard preserves both the stored draft and the current visible inputs',async()=>{
 const f=prior(),g=replacement(f),before=[...f.storage.rows.entries()];let prompts=0;g.ctx.askConfirm=async()=>{prompts++;return false;};await discard(g).onclick();assert.equal(prompts,1);assert.deepEqual([...f.storage.rows.entries()],before);assert.equal(g.field('notes').value,'Current visible terms');assert.equal(g.form().querySelector('[type="submit"]').disabled,true);assert.equal(g.calls.length,0);
});

test('explicit discard removes only the prior ordinary draft and retains/persists current inputs without a server write',async()=>{
 const f=prior(),g=replacement(f),form=g.form(),notes=g.field('notes');let options;g.ctx.askConfirm=async value=>{options=value;return true;};await discard(g).onclick();assert.match(options.body,/Only the earlier unsaved draft/);assert.equal(g.form(),form);assert.equal(g.field('notes'),notes);assert.equal(notes.value,'Current visible terms');assert.equal(form.querySelector('[type="submit"]').disabled,false);assert.equal(discard(g),null);assert.equal(g.calls.length,0);const draft=JSON.parse([...g.storage.rows.values()][0]);assert.equal(draft.id,otherId);assert.equal(draft.fields.notes,'Current visible terms');assert.equal(draft.pending,null);await g.submit();assert.equal(g.calls.length,1);assert.equal(g.calls[0].args.p_id,otherId);
});

for(const mode of ['actor','session','epoch','request','hash','form','permission','inactive'])test(`prior draft discard cannot run after ${mode} changes during confirmation`,async()=>{
 const f=prior(),g=replacement(f),before=[...f.storage.rows.entries()],form=g.form();let resolve;g.ctx.askConfirm=()=>new Promise(r=>resolve=r);const action=discard(g).onclick();await tick();
 if(mode==='actor')g.ctx.me={...g.actor};if(mode==='session')g.ctx.sessionLoadEpoch++;if(mode==='epoch')g.get('salesEpoch++');if(mode==='request')g.get('salesWorkspaceRequest++');if(mode==='hash')g.ctx.location.hash='#/go/settings';if(mode==='form')g.document.querySelector('#content').innerHTML='<form id="proformaForm">New form</form>';if(mode==='permission')g.actor.access=[];if(mode==='inactive')g.actor.active=false;
 resolve(true);await action;assert.deepEqual([...f.storage.rows.entries()],before);assert.equal(form.querySelector('[name="notes"]').value,'Current visible terms');assert.equal(g.calls.length,0);
});

test('a pending attempt appearing during ordinary discard confirmation is never discarded and replaces the old choices',async()=>{
 const f=prior(),g=replacement(f);let resolve;g.ctx.askConfirm=()=>new Promise(r=>resolve=r);const action=discard(g).onclick();await tick();const h=draftFixture();h.write=()=>{throw Error('Unknown result');};await assert.rejects(h.submit());const [key,value]=[...h.storage.rows.entries()][0];g.storage.rows.set(key,value);resolve(true);await action;assert.equal(g.storage.rows.get(key),value);assert.equal(discard(g),null);assert.ok(g.form().querySelector('[data-proforma-prior-pending]'));assert.equal(g.form().querySelector('[type="submit"]').disabled,true);assert.equal(g.calls.length,0);
});

test('another ordinary snapshot replacing the old one during confirmation is retained for a new explicit choice',async()=>{
 const f=prior(),g=replacement(f);let resolve;g.ctx.askConfirm=()=>new Promise(r=>resolve=r);const action=discard(g).onclick();await tick();const [key,value]=[...g.storage.rows.entries()][0],latest=JSON.parse(value);latest.fields.notes='Newer prior terms';g.storage.rows.set(key,JSON.stringify(latest));resolve(true);await action;assert.deepEqual(JSON.parse(g.storage.rows.get(key)),latest);assert.ok(discard(g));assert.equal(g.calls.length,0);
});

test('failed removal does not remove Review/Discard controls or current input values',async()=>{
 const f=prior(),g=replacement(f),before=[...g.storage.rows.entries()];g.storage.removeItem=()=>{throw Error('Unavailable');};await assert.rejects(discard(g).onclick(),/could not be removed/);assert.deepEqual([...g.storage.rows.entries()],before);assert.ok(discard(g));assert.ok(g.form().querySelector('[data-proforma-review-prior]'));assert.equal(g.field('notes').value,'Current visible terms');assert.equal(g.calls.length,0);
});

test('ordinary typing in its own current form may update its existing draft, and ordinary leave removes only that owned copy',async()=>{
 const f=prior();f.field('notes').value='Updated same draft';f.flush();assert.equal(JSON.parse([...f.storage.rows.values()][0]).fields.notes,'Updated same draft');assert.equal(discard(f),null);assert.equal(await f.ctx.salesConfirmLeave(()=>true),true);assert.equal(f.storage.rows.size,0);
 const other=prior(),g=replacement(other),before=[...other.storage.rows.entries()];assert.equal(await g.ctx.salesConfirmLeave(()=>true),true);assert.deepEqual([...other.storage.rows.entries()],before);
});

for(const route of ['https://outside.invalid/',`#/proforma/${otherId}`])test(`ordinary stored route ${route} gets no navigation control`,()=>{
 const f=prior(),[key,value]=[...f.storage.rows.entries()][0],draft=JSON.parse(value);draft.route=route;f.storage.rows.set(key,JSON.stringify(draft));const g=replacement(f);assert.equal(g.form().querySelector('[data-proforma-review-prior]'),null);assert.ok(discard(g));assert.deepEqual(JSON.parse(g.storage.rows.get(key)),draft);
});

test('a confirmed online Save clears its exact older ordinary copy when persisting the pending envelope hits quota',async()=>{
 const f=prior(),set=f.storage.setItem;f.storage.setItem=function(key,value){if(JSON.parse(value).pending)throw Error('Pending envelope exceeds quota');return set.call(this,key,value);};await f.submit();assert.equal(f.calls.length,1);assert.equal(f.state().pending,null);assert.equal(f.storage.rows.size,0);assert.equal(discard(f),null);assert.equal(f.form().querySelector('[data-proforma-prior-pending]'),null);assert.match(f.form().textContent,/cannot restore edits after reload/);
});
