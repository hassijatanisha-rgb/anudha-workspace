import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFixture,receipt,revisionReceipt,storageFixture,actorId,recordId,plain,tick} from './helpers/proforma-draft-fixture.mjs';

const pending=async options=>{const f=draftFixture(options);f.field('notes').value='Retain <customer terms>';f.field('internalNotes').value='Private planning';f.write=async()=>{throw Error('Connection lost');};await assert.rejects(f.submit(),/Connection lost/);return f;};
const reload=async f=>{const next=draftFixture({storage:f.storage,mount:false});assert.equal(await next.ctx.restoreProformaDraft(),true);return next;};

test('ordinary draft reload restores typed values and selected IDs without writing or accepting old prices',async()=>{
 const f=draftFixture();f.field('notes').value='<script>retained literally</script>';f.field('quantity').value='7';f.field('discountMode').value='amount';f.field('discountAmount').value='7.00';f.fire(f.field('discountAmount'),'input');f.flush();
 const stored=[...f.storage.rows.values()][0];assert.ok(stored);assert.doesNotMatch(stored,/access_token|customer directory/);
 const g=await reload(f);assert.equal(g.calls.length,0);assert.equal(g.field('notes').value,'<script>retained literally</script>');assert.equal(g.field('quantity').value,'7');assert.equal(g.field('discountMode').value,'amount');assert.equal(g.field('discountAmount').value,'7.00');assert.equal(g.field('organizationId').value,'branch');assert.equal(g.field('contactId').value,'contact');assert.equal(g.document.querySelector('script'),null);assert.match(g.form().textContent,/Unsaved changes/);assert.equal(g.ctx.salesEditorChanged(g.form()),true);
 assert.deepEqual(g.reads.map(row=>row.table).sort(),['customer_contracts','product_sale_prices']);
});

test('a renamed product restores by canonical ID; unavailable products never remap to another ID',async()=>{
 const f=draftFixture();f.field('notes').value='Draft';f.flush();const g=draftFixture({storage:f.storage,mount:false});g.ctx.products[0].name='Reviewed product name';await g.ctx.restoreProformaDraft();assert.equal(g.field('productChoice').value,'Reviewed product name · product');
 const h=draftFixture({storage:f.storage,mount:false});h.ctx.products=[{id:'other',name:'Fictional reagent'}];await h.ctx.restoreProformaDraft();assert.equal(h.field('productChoice').value,'');assert.match(h.form().textContent,/Previously selected product is unavailable/);await h.submit();assert.equal(h.calls.length,0);
});

test('current configured prices still block a restored stale quote without changing its entered price',async()=>{
 const f=draftFixture();f.field('notes').value='Draft';f.flush();const g=draftFixture({storage:f.storage,mount:false}),read=g.read;g.read=query=>query.table==='product_sale_prices'?{data:[{product_id:'product',currency:'TZS',unit_price_minor:20000}]}:read(query);await g.ctx.restoreProformaDraft();assert.equal(g.field('unitPrice').value,'100.00');await g.submit();assert.equal(g.calls.length,0);assert.match(g.field('productChoice').validationMessage,/configured/);
});

test('unknown save retains a frozen exact payload, locks controls, warns on unload, and blocks duplicate submit',async()=>{
 const f=await pending();const state=f.state();assert.equal(f.calls.length,1);assert.equal(f.field('notes').disabled,true);assert.equal(f.form().querySelector('[type="submit"]').disabled,true);assert.equal(state.pending.p_id,recordId);assert.equal(Object.isFrozen(state.pending),true);assert.equal(Object.isFrozen(state.pending.p_lines[0]),true);assert.match(f.form().textContent,/Save confirmation is pending/);await assert.rejects(f.submit(),/Resolve/);assert.equal(f.calls.length,1);
 let warned=false;for(const listener of f.events.beforeunload)listener({preventDefault(){warned=true;}});assert.equal(warned,true);assert.equal(await f.ctx.salesConfirmLeave(()=>true),false);
});

test('pending reload never resends; explicit retry uses the original ID/version/payload despite changed controls/prices',async()=>{
 const f=await pending(),args=f.calls[0].args,g=await reload(f);assert.equal(g.calls.length,0);assert.equal(g.field('notes').disabled,true);g.field('notes').value='Programmatic mutation must not become the retry';g.get("productSalePrices.set('product:TZS',{unit_price_minor:999999})");await g.ctx.retryProformaSave(g.state());assert.equal(g.calls.length,1);assert.deepEqual(g.calls[0].args,args);assert.equal(g.form().dataset.id,recordId);assert.equal(g.form().dataset.version,'1');assert.equal(g.state().pending,null);assert.equal(g.field('notes').disabled,false);assert.equal(g.storage.rows.size,1);assert.equal(g.ctx.salesEditorChanged(g.form()),true);assert.equal(JSON.parse([...g.storage.rows.values()][0]).pending,null);
});

test('successful receipt preserves the original Save label and exact totals, then clears only its draft key',async()=>{
 const f=draftFixture();f.storage.rows.set('sb-auth-token','not our data');const label=f.form().querySelector('[type="submit"]').textContent;let resolve;f.write=(_name,args)=>new Promise(r=>resolve=()=>r({data:receipt(args)}));const saving=f.submit();assert.equal(f.form().querySelector('[type="submit"]').textContent,label);assert.equal(f.field('notes').disabled,true);resolve();await saving;assert.equal(f.state().pending,null);assert.equal(f.ctx.salesEditorChanged(f.form()),false);assert.equal(f.storage.rows.get('sb-auth-token'),'not our data');assert.equal(f.storage.rows.size,1);
});

test('blocked storage keeps online Save and in-memory exact retry available with a truthful reload warning',async()=>{
 const storage=storageFixture();storage.fail=true;const f=await pending({storage});assert.equal(f.calls.length,1);assert.match(f.form().textContent,/This browser cannot restore edits after reload/);f.write=(_name,args)=>({data:receipt(args)});await f.ctx.retryProformaSave(f.state());assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].args,f.calls[0].args);assert.equal(f.state().pending,null);assert.match(f.form().textContent,/cannot restore edits after reload/);
});

test('first-attempt SQL rejection restores editing; an SQL rejection after uncertain retry does not prove failure',async()=>{
 const f=draftFixture();f.write=async()=>({error:{code:'P0001',message:'Only a draft can be revised'}});await assert.rejects(f.submit(),error=>error.code==='P0001');assert.equal(f.state().pending,null);assert.equal(f.field('notes').disabled,false);
 const g=await pending();g.write=async()=>({error:{code:'23505',message:'duplicate key'}});await g.ctx.retryProformaSave(g.state());assert.equal(g.calls.length,2);assert.ok(g.state().pending);assert.equal(g.field('notes').disabled,true);assert.match(g.form().textContent,/confirmation remains pending/);
});

test('Check saved status verifies the exact immutable revision using two projected, scoped reads and no writes',async()=>{
 const f=await pending(),args=f.calls[0].args;f.server=[receipt(args)];f.revisions=[revisionReceipt(args)];f.reads.length=0;await f.ctx.checkProformaSave(f.state());assert.equal(f.calls.length,1);assert.equal(f.reads.length,2);assert.deepEqual(f.reads.map(q=>q.table),['sales_proformas','sales_proforma_revisions']);for(const query of f.reads){assert.ok(query.steps.some(([method,n])=>method==='limit'&&n===2));assert.ok(query.steps.some(([method,column,value])=>method==='eq'&&['id','proforma_id'].includes(column)&&value===recordId));assert.ok(query.steps.some(([method,projection])=>method==='select'&&projection!=='*'));}assert.ok(f.reads[1].steps.some(step=>JSON.stringify(step)===JSON.stringify(['eq','revision',1])));assert.equal(f.state().pending,null);assert.equal(f.storage.rows.size,0);assert.match(f.form().textContent,/Pro forma saved/);
});

for(const kind of ['absent','unchanged','later','non-draft','archived','wrong-header','internal-notes','wrong-total'])test(`status check ${kind} stays unresolved after one read`,async()=>{
 const f=await pending(),row=receipt(f.calls[0].args);if(kind==='unchanged')row.version=0;if(kind==='later')row.version=2;if(kind==='non-draft')row.status='sent';if(kind==='archived')row.deleted_at='2026-10-30';if(kind==='wrong-header')row.organization_id='other';if(kind==='internal-notes')row.internal_notes='Changed planning';if(kind==='wrong-total')row.total_minor++;
 f.server=kind==='absent'?[]:[row];await f.ctx.checkProformaSave(f.state());assert.equal(f.reads.length,1);assert.equal(f.calls.length,1);assert.ok(f.state().pending);assert.equal(f.field('notes').disabled,true);assert.match(f.form().textContent,/still unconfirmed/);assert.doesNotMatch(f.form().textContent,/not saved/i);
});

for(const kind of ['actor','revision','line','header','missing','failure'])test(`immutable proof ${kind} cannot confirm a pending write`,async()=>{
 const f=await pending(),args=f.calls[0].args,row=revisionReceipt(args);f.server=[receipt(args)];if(kind==='actor')row.created_by='other';if(kind==='revision')row.revision=2;if(kind==='line')row.snapshot.lines[0].quantity++;if(kind==='header')row.snapshot.notes='Different note';f.revisions=kind==='missing'?[]:[row];if(kind==='failure'){const read=f.read;f.read=query=>query.table==='sales_proforma_revisions'?{error:{message:'Read denied'}}:read(query);}
 await f.ctx.checkProformaSave(f.state());assert.equal(f.reads.length,2);assert.equal(f.calls.length,1);assert.ok(f.state().pending);assert.equal(f.field('notes').disabled,true);assert.doesNotMatch(f.form().textContent,/Pro forma saved\./);
});

test('double click does not overlap check/retry and failed checking offers a read-only retry',async()=>{
 const f=await pending();let resolve;f.read=()=>new Promise(r=>resolve=r);const checking=f.ctx.checkProformaSave(f.state());await tick();await f.ctx.checkProformaSave(f.state());await f.ctx.retryProformaSave(f.state());assert.equal(f.reads.length,1);assert.equal(f.calls.length,1);resolve({error:{message:'Offline'}});await checking;assert.match(f.form().textContent,/Nothing was resent/);assert.equal(f.form().querySelector('[data-proforma-check]').disabled,false);assert.equal(f.form().querySelector('[data-proforma-retry]').disabled,false);
});

for(const mode of ['actor','permission','inactive','session','epoch','request','hash','view','root','form'])test(`late save and check cannot publish after ${mode} replacement`,async()=>{
 const change=f=>{if(mode==='actor')f.ctx.me={...f.actor};if(mode==='permission')f.actor.access=[];if(mode==='inactive')f.actor.active=false;if(mode==='session')f.ctx.sessionLoadEpoch++;if(mode==='epoch')f.get('salesEpoch++');if(mode==='request')f.get('salesWorkspaceRequest++');if(mode==='hash')f.ctx.location.hash='#/go/staff';if(mode==='view')f.ctx.view='staff';if(mode==='root')f.document.body.innerHTML='<main id="content">New root</main>';if(mode==='form')f.document.querySelector('#content').innerHTML='<form id="proformaForm">New form</form>';};
 const f=draftFixture();let write;f.write=(_name,args)=>new Promise(resolve=>write=()=>resolve({data:receipt(args)}));const saving=f.submit();const old=f.form();change(f);write();await saving;assert.equal(old.dataset.id,'');assert.ok(f.state().pending);assert.equal(old.querySelector('[data-sales-saved]'),null);
 const g=await pending(),args=g.calls[0].args;let read;g.read=()=>new Promise(resolve=>read=resolve);const checking=g.ctx.checkProformaSave(g.state());await tick();change(g);read({data:[receipt(args)]});await checking;assert.equal(g.reads.length,1);assert.ok(g.state().pending);
});

test('malformed, foreign, inconsistent or oversized storage never restores or sends a request',async()=>{
 const f=await pending(),key=[...f.storage.rows.keys()][0],draft=JSON.parse(f.storage.rows.get(key));
 for(const mutate of [()=>'{',d=>JSON.stringify({...d,actor:'other'}),d=>JSON.stringify({...d,schema:9}),d=>JSON.stringify({...d,lines:Array(101).fill(d.lines[0])}),d=>{d.pending.p_notes='Different payload';return JSON.stringify(d);},()=>JSON.stringify({data:'x'.repeat(2*1024*1024)})]){const storage=storageFixture();storage.rows.set(key,mutate(plain(draft)));const g=draftFixture({storage,mount:false});assert.equal(await g.ctx.restoreProformaDraft(),false);assert.equal(g.reads.length,0);assert.equal(g.calls.length,0);assert.equal(g.form(),null);}
});

test('logout clears only draft namespace and invalidates pending timer; cache reset alone preserves reload copy',()=>{
 const f=draftFixture();f.field('notes').value='Draft';f.fire(f.field('notes'),'input');f.flush();f.storage.rows.set('sb-auth-token','retain');f.ctx.clearSalesDelivery();assert.equal(f.storage.rows.size,2);f.ctx.clearProformaDraftStorage();assert.equal(f.storage.rows.size,1);assert.equal(f.storage.rows.get('sb-auth-token'),'retain');for(const fn of f.timers.values())fn();assert.equal(f.storage.rows.size,1);
});

test('existing draft checks its stored base version before restore and locks conflicts without adopting a newer version',async()=>{
 const f=draftFixture();await f.submit();f.field('notes').value='Unsaved next revision';f.flush();const draft=JSON.parse([...f.storage.rows.values()][0]);assert.equal(draft.version,1);assert.equal(draft.revision,1);
 const g=draftFixture({storage:f.storage,mount:false}),row={...receipt(f.calls[0].args),version:5,revision:3};g.server=[row];g.ctx.seed=row;g.get('salesProformas=[seed]');await g.ctx.restoreProformaDraft();assert.equal(g.reads[0].table,'sales_proformas');assert.equal(g.form().dataset.version,'1');assert.equal(g.field('notes').value,'Unsaved next revision');assert.equal(g.field('notes').disabled,true);await assert.rejects(g.submit(),/Resolve/);assert.equal(g.calls.length,0);assert.match(g.form().textContent,/cannot overwrite/);
});

test('wrong actor, area, route or stale restore read never mounts stored company data',async()=>{
 const f=draftFixture();await f.submit();f.field('notes').value='Private draft';f.flush();
 for(const mode of ['actor','area','hash','session-during-read']){const g=draftFixture({storage:f.storage,mount:false});if(mode==='actor')g.ctx.me={...g.actor,user_id:'other'};if(mode==='area')g.ctx.me.access=[];if(mode==='hash')g.ctx.location.hash='#/proforma/other';if(mode==='session-during-read'){g.read=async()=>{g.ctx.sessionLoadEpoch++;return {data:[receipt(f.calls[0].args)]};};}assert.equal(await g.ctx.restoreProformaDraft(),false);assert.equal(g.form(),null);assert.equal(g.calls.length,0);assert.doesNotMatch(g.document.body.textContent,/Private draft/);}
});

for(const mode of ['attempt','inactive'])test(`abandoned restoration cannot apply its values to a future editor after ${mode} changes during prerequisites`,async()=>{
 const f=draftFixture();f.field('notes').value='Do not publish a canceled draft';f.flush();const g=draftFixture({storage:f.storage,mount:false}),read=g.read;let resolve;g.read=query=>query.table==='product_sale_prices'?new Promise(r=>resolve=r):read(query);
 const restoring=g.ctx.restoreProformaDraft();await tick();assert.equal(typeof resolve,'function');if(mode==='attempt')g.ctx.workspaceLeaveSequence++;else g.actor.active=false;resolve({data:[{product_id:'product',currency:'TZS',unit_price_minor:10000}]});assert.equal(await restoring,false);assert.equal(g.get('proformaDraftRestore'),null);assert.doesNotMatch(g.document.body.textContent,/Do not publish a canceled draft/);
 g.actor.active=true;g.read=read;await g.ctx.salesDeliveryWorkspace();assert.equal(g.field('notes').value,'');assert.ok(g.storage.rows.size);assert.equal(g.calls.length,0);
});
