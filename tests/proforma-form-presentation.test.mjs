import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {draftFixture,receipt,tick} from './helpers/proforma-draft-fixture.mjs';
import {parseCss} from '../scripts/audit-design-tokens.mjs';

const footer=f=>f.form().querySelector('[data-proforma-footer]');
const status=f=>f.form().querySelector('[data-proforma-draft-status]');
const feedback=f=>f.form().querySelector('[data-proforma-save-feedback]');

test('the actual editor has three named sections, one Save and a separate Add item control',()=>{
 const f=draftFixture(),form=f.form(),sections=form.querySelectorAll('.proforma-section');
 assert.deepEqual(sections.map(section=>section.querySelector('h3').textContent),['Client and terms','Commercial terms','Items']);
 for(const section of sections)assert.equal(section.getAttribute('aria-labelledby'),section.querySelector('h3').id);
 assert.equal(f.field('organizationId').closest('.proforma-section'),sections[0]);assert.equal(f.field('notes').closest('.proforma-section'),sections[0]);
 assert.equal(f.field('commercialKind').closest('.proforma-section'),sections[1]);assert.equal(f.field('internalNotes').closest('.proforma-section'),sections[1]);assert.equal(f.field('quantity').closest('.proforma-section'),sections[2]);
 assert.equal(form.querySelector('#addSalesLine').closest('.proforma-section'),sections[2]);assert.equal(form.querySelectorAll('[type="submit"]').length,1);assert.equal(form.querySelector('[type="submit"]').parentElement,footer(f));assert.equal(status(f).parentElement,footer(f));
 assert.equal(form.children[0],form.querySelector('[data-proforma-errors]'));assert.ok(footer(f).matches('.no-print'));assert.ok(feedback(f).matches('.no-print'));assert.equal(f.calls.length,0);
});

test('dirty status changes in place without replacing controls or claiming a database Save',()=>{
 const f=draftFixture(),form=f.form(),bar=footer(f),message=status(f),notes=f.field('notes'),save=bar.querySelector('[type="submit"]');assert.equal(message.textContent,'');
 notes.value='Unsaved customer terms';notes.focus();f.fire(notes,'input');f.flush();
 assert.equal(status(f),message);assert.equal(message.textContent,'Unsaved changes.');assert.equal(f.form(),form);assert.equal(footer(f),bar);assert.equal(bar.querySelector('[type="submit"]'),save);assert.equal(f.document.activeElement,notes);assert.equal(f.calls.length,0);assert.equal(f.storage.rows.size,1);assert.equal(form.querySelector('[data-sales-saved]'),null);
});

test('submit validation keeps the same footer and focuses the first invalid field after the top summary',async()=>{
 const f=draftFixture(),bar=footer(f),save=bar.querySelector('[type="submit"]');f.field('paymentTerms').value='';f.field('description').value='';await f.submit();
 assert.equal(f.form().querySelector('[data-proforma-errors]').textContent,'2 fields need attention');assert.equal(f.document.activeElement,f.field('paymentTerms'));assert.equal(footer(f),bar);assert.equal(bar.querySelector('[type="submit"]'),save);assert.equal(f.calls.length,0);
});

test('confirmed Save keeps the original footer and puts its focused Open action beside the receipt',async()=>{
 const f=draftFixture(),form=f.form(),bar=footer(f),save=bar.querySelector('[type="submit"]'),notes=f.field('notes');notes.value='Customer terms';f.fire(notes,'input');save.focus();await f.submit();
 assert.equal(f.calls.length,1);assert.equal(f.form(),form);assert.equal(footer(f),bar);assert.equal(bar.querySelector('[type="submit"]'),save);assert.equal(f.field('notes'),notes);assert.equal(notes.value,'Customer terms');assert.equal(status(f).textContent,'');
 const saved=form.querySelector('[data-sales-saved]');assert.equal(saved.parentElement,bar);assert.equal(saved.querySelector('span').textContent,'Pro forma saved.');assert.equal(f.document.activeElement,saved.querySelector('button'));assert.equal(saved.querySelector('button').textContent,'Open saved Pro forma');assert.equal(form.querySelectorAll('[type="submit"]').length,1);
});

test('unconfirmed Save keeps long recovery notices outside the sticky bar and retries the exact payload',async()=>{
 const f=draftFixture(),form=f.form(),bar=footer(f),save=bar.querySelector('[type="submit"]');f.write=()=>{throw Error('Connection unavailable');};await assert.rejects(f.submit());
 const recovery=form.querySelector('[data-proforma-recovery]');assert.equal(recovery.parentElement,feedback(f));assert.equal(status(f).textContent,'Save confirmation pending.');assert.equal(bar.querySelector('[data-proforma-retry]'),null);assert.equal(f.field('notes').disabled,true);assert.equal(save.disabled,true);
 f.write=(_name,args)=>({data:receipt(args)});await recovery.querySelector('[data-proforma-retry]').onclick();assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].args,f.calls[0].args);assert.equal(f.form(),form);assert.equal(footer(f),bar);assert.equal(bar.querySelector('[type="submit"]'),save);assert.equal(form.querySelector('[data-proforma-recovery]'),null);assert.equal(f.field('notes').disabled,false);
});

test('storage failure stays visible outside the short status without blocking an online Save',async()=>{
 const f=draftFixture();f.storage.fail=true;f.field('notes').value='Keep these values';f.fire(f.field('notes'),'input');f.flush();
 const warning=f.form().querySelector('[data-proforma-storage-warning]');assert.equal(warning.parentElement,feedback(f));assert.equal(warning.hidden,false);assert.equal(warning.textContent,'This browser cannot restore edits after reload.');assert.equal(status(f).textContent,'Unsaved changes.');await f.submit();assert.equal(f.calls.length,1);assert.equal(warning.hidden,false);assert.equal(f.field('notes').value,'Keep these values');
});

test('prior-draft choices remain in normal flow and a cancelled discard retains both input sets',async()=>{
 const prior=draftFixture();prior.field('notes').value='Previous draft';prior.flush();const before=[...prior.storage.rows.entries()],f=draftFixture({storage:prior.storage});f.field('notes').value='Current draft';f.ctx.askConfirm=async()=>false;
 const panel=f.form().querySelector('[data-proforma-prior-draft]');assert.equal(panel.parentElement,feedback(f));assert.equal(footer(f).querySelector('[data-proforma-review-prior]'),null);await panel.querySelector('[data-proforma-discard-prior]').onclick();assert.deepEqual([...f.storage.rows.entries()],before);assert.equal(f.field('notes').value,'Current draft');assert.equal(footer(f).querySelector('[type="submit"]').disabled,true);assert.equal(f.calls.length,0);
});

test('a replaced actor cannot update the footer from a late Save receipt',async()=>{
 const f=draftFixture(),bar=footer(f);let resolve;f.write=(_name,args)=>new Promise(done=>resolve=()=>done({data:receipt(args)}));const saving=f.submit();await tick();f.ctx.me={...f.actor};resolve();await saving;
 assert.equal(footer(f),bar);assert.equal(bar.querySelector('[data-sales-saved]'),null);assert.equal(f.form().dataset.version,'0');assert.equal(f.state().pending!==null,true);
});

test('delivery receipt placement is unchanged and does not require a Pro forma footer',()=>{
 const f=draftFixture(),form=f.document.createElement('form');f.document.querySelector('#content').append(form);f.ctx.salesEditorSaved(form,'delivery','delivery-id','Delivery saved.');
 const saved=form.querySelector('[data-sales-saved]');assert.equal(saved.parentElement,form);assert.equal(saved.querySelector('button').textContent,'Open delivery');
});

test('scoped footer CSS uses token roles, wraps enlarged text and accounts for the phone shortcuts',()=>{
 const css=readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8'),start=css.indexOf('/* Pro forma sections keep one live Save control'),end=css.indexOf('/* Quantity review remains readable',start),section=css.slice(start,end),rules=parseCss(section).declarations;assert.ok(start>0);assert.ok(end>start);
 const values=(selector,phone=false)=>new Map(rules.filter(rule=>rule.selector===selector&&!!rule.media.length===phone).map(rule=>[rule.property,rule.value])),bar=values('#proformaForm>.proforma-save-bar');
 assert.equal(bar.get('position'),'sticky');assert.equal(bar.get('bottom'),'0');assert.equal(bar.get('background'),'var(--surface)');assert.equal(bar.get('border-top'),'1px solid var(--line)');assert.equal(bar.get('flex-wrap'),'wrap');assert.equal(bar.has('height'),false);assert.equal(bar.has('overflow'),false);
 assert.equal(values('body:has(#nav:not([hidden])) #proformaForm>.proforma-save-bar',true).get('bottom'),'var(--workspace-shortcut-height,var(--shortcut-height))');assert.equal(values('#proformaForm>.proforma-save-bar',true).get('grid-template-columns'),'minmax(0,1fr)');assert.equal(values('#proformaForm>.proforma-save-bar>[type="submit"]',true).get('width'),'100%');
 assert.ok(rules.every(rule=>rule.selector.includes('#proformaForm')));assert.doesNotMatch(section,/#[0-9a-f]{3,8}\b|(?:transition|animation):|position:fixed/);assert.match(readFileSync(new URL('../company-forms.css',import.meta.url),'utf8'),/\.no-print\{display:none!important\}/);
});
