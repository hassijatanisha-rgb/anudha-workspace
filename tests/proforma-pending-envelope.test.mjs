import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFixture,recordId,receipt,plain,tick} from './helpers/proforma-draft-fixture.mjs';
const otherId='00000000-0000-4000-8000-000000000003';
async function unresolved(){const f=draftFixture();f.field('notes').value='Original pending attempt';f.write=()=>{throw Error('Lost acknowledgement');};await assert.rejects(f.submit());return f;}
function differentEditor(f,{route='#/go/sales/proformas'}={}){const g=draftFixture({storage:f.storage,mount:false});g.ctx.location.hash=route;g.ctx.crypto.randomUUID=()=>otherId;g.mount();return g;}

test('another new editor cannot overwrite or remove the pending envelope through binding, typing, pagehide, Save or ordinary discard',async()=>{
 const f=await unresolved(),before=[...f.storage.rows.entries()],g=differentEditor(f);
 assert.equal(g.form().querySelector('[type="submit"]').disabled,true);assert.match(g.form().textContent,/Another Pro forma save is unconfirmed/);assert.ok(g.form().querySelector('[data-proforma-prior-pending] button'));
 g.field('notes').value='Another draft';g.fire(g.field('notes'),'input');g.flush();for(const callback of g.events.pagehide)callback();await assert.rejects(g.submit(),/Resolve/);assert.equal(await g.ctx.salesConfirmLeave(()=>true),true);assert.deepEqual([...f.storage.rows.entries()],before);assert.equal(g.calls.length,0);assert.equal(g.form().querySelector('[data-proforma-recovery]'),null);
});

test('an editor for the same document still must restore the pending payload before it can save again',async()=>{
 const f=await unresolved(),g=differentEditor(f,{route:`#/proforma/${recordId}`});g.form().dataset.id=recordId;g.form().dataset.version='1';g.get(`salesEditing='${recordId}'`);await assert.rejects(g.submit(),/Resolve/);assert.equal(g.calls.length,0);assert.deepEqual(JSON.parse([...g.storage.rows.values()][0]).pending,f.calls[0].args);
});

for(const route of ['https://outside.invalid/',`#/proforma/${otherId}`,`#/invoice/${recordId}`,`#/proforma/${recordId}?next=outside`,'javascript:alert(1)'])test(`stored route ${route} cannot supply a recovery navigation target`,async()=>{
 const f=await unresolved(),key=[...f.storage.rows.keys()][0],draft=JSON.parse(f.storage.rows.get(key));draft.route=route;f.storage.rows.set(key,JSON.stringify(draft));const g=differentEditor(f);assert.equal(g.form().querySelector('[type="submit"]').disabled,true);assert.equal(g.form().querySelector('[data-proforma-prior-pending] button'),null);await assert.rejects(g.submit(),/Resolve/);assert.equal(g.calls.length,0);assert.equal(JSON.parse(f.storage.rows.get(key)).route,route);
});

test('binding after an in-memory pending attempt also protects it when storage is blocked',async()=>{
 const f=draftFixture();f.storage.fail=true;f.write=()=>{throw Error('Offline');};await assert.rejects(f.submit());const old=f.state(),payload=plain(old.pending);f.ctx.crypto.randomUUID=()=>otherId;f.mount();assert.equal(f.form().querySelector('[type="submit"]').disabled,true);assert.deepEqual(plain(f.state().foreignPending.pending),payload);await assert.rejects(f.submit(),/Resolve/);assert.equal(f.calls.length,1);
});

test('the exact restored attempt can still check/confirm and clear its own pending key',async()=>{
 const f=await unresolved(),g=draftFixture({storage:f.storage,mount:false});await g.ctx.restoreProformaDraft();assert.equal(g.form().querySelector('[data-proforma-prior-pending]'),null);g.write=(_name,args)=>({data:receipt(args)});await g.ctx.retryProformaSave(g.state());assert.equal(g.state().pending,null);assert.equal(g.storage.rows.size,0);assert.equal(g.field('notes').disabled,false);
});

test('a different pending envelope appearing before Save prevents dispatch; confirmed cleanup cannot remove that other attempt',async()=>{
 const f=await unresolved(),g=draftFixture();for(const [key,value]of f.storage.rows)g.storage.rows.set(key,value);await assert.rejects(g.submit(),/Resolve/);assert.equal(g.calls.length,0);
 const h=draftFixture();let resolve;h.write=(_name,args)=>new Promise(r=>resolve=()=>r({data:receipt(args)}));const saving=h.submit();await tick();const key=[...f.storage.rows.keys()][0],different=JSON.parse(f.storage.rows.get(key));different.id=otherId;different.pending.p_id=otherId;h.storage.rows.set(key,JSON.stringify(different));resolve();await saving;assert.deepEqual(JSON.parse(h.storage.rows.get(key)),different);assert.equal(h.state().pending,null);assert.equal(h.form().querySelector('[type="submit"]').disabled,true);assert.ok(h.form().querySelector('[data-proforma-prior-pending]'));
});

test('a displaced in-memory pending attempt can return to its exact route and recover while storage remains blocked',async()=>{
 const f=draftFixture();f.storage.fail=true;f.write=()=>{throw Error('Offline');};await assert.rejects(f.submit());const pending=plain(f.state().pending);f.ctx.crypto.randomUUID=()=>otherId;f.mount();f.document.querySelector('#content').innerHTML='<p>Pro formas</p>';f.get("salesEditing=''");assert.equal(await f.ctx.restoreProformaDraft(),true);assert.deepEqual(plain(f.state().pending),pending);assert.equal(f.field('notes').disabled,true);assert.match(f.form().textContent,/This browser cannot restore edits after reload/);f.write=(_name,args)=>({data:receipt(args)});await f.ctx.retryProformaSave(f.state());assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].args,pending);assert.equal(f.state().pending,null);
});
