import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const lines=[{id:'L1',product_id:'P1',quantity:5},{id:'L2',product_id:'P2',quantity:2}];
const context=vm.createContext({esc:s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`),deliveryLines:()=>lines,salesProduct:id=>({name:id==='P1'?'Reagent <kit>':'Analyzer'})});
vm.runInContext(fs.readFileSync(new URL('../customer-returns.js',import.meta.url),'utf8'),context);

test('what can still be returned is delivered minus earlier returns, never negative',()=>{
 const left=context.returnableQuantities(lines,[{delivery_line_id:'L1',quantity:2},{delivery_line_id:'L1',quantity:1},{delivery_line_id:'L2',quantity:5}]);
 assert.equal(left.get('L1'),2);assert.equal(left.get('L2'),0);
 assert.equal(context.returnableQuantities(lines,[]).get('L2'),2);
});

test('days since delivery count Dar es Salaam calendar days',()=>{
 const now=Date.parse('2026-10-15T08:00:00Z');
 assert.equal(context.returnDaysSinceDelivery('2026-10-15T05:00:00Z',now),0);
 assert.equal(context.returnDaysSinceDelivery('2026-10-07T20:30:00Z',now),8,'23:30 local on the 7th');
 assert.equal(context.returnDaysSinceDelivery('2026-10-07T21:30:00Z',now),7,'00:30 local on the 8th is still 7 days');
 assert.equal(context.returnDaysSinceDelivery('2026-10-07T20:59:00Z',now),8);
});

test('only the stores head or the owner inspects',()=>{
 assert.equal(context.canInspectReturns({role:'owner'}),true);
 assert.equal(context.canInspectReturns({role:'head',department:'stores'}),true);
 assert.equal(context.canInspectReturns({role:'head',department:'sales'}),false);
 assert.equal(context.canInspectReturns({role:'staff',department:'stores'}),false);
 assert.equal(context.canInspectReturns(null),false);
});

test('panel shows quarantine state, inspect and credit actions to the right people, escaped',()=>{
 const note={id:'N1'},ret={id:'R1',return_number:'RT-2026-000001',category:'cold_chain',late_override_reason:'Called <day 6>',credit_note_draft_id:null};
 const waiting=[{id:'RL1',return_id:'R1',product_id:'P1',quantity:2,resolution:null}];
 const stores=context.returnsPanelHtml(note,[ret],waiting,{role:'head',department:'stores'},false);
 assert.match(stores,/Reagent &#60;kit&#62; × 2 · <strong>In quarantine, waiting for inspection<\/strong>/);
 assert.match(stores,/data-return-inspect="RL1"/);assert.doesNotMatch(stores,/data-return-credit/);
 assert.match(stores,/late, accepted: Called &#60;day 6&#62;/);
 assert.match(stores,/data-return-record="N1"/,'3 of 5 and 2 of 2 still returnable');
 const accounts=context.returnsPanelHtml(note,[ret],waiting,{role:'staff',department:'accounts'},true);
 assert.doesNotMatch(accounts,/data-return-inspect/);assert.match(accounts,/data-return-credit="R1"/);
 const done=context.returnsPanelHtml(note,[{...ret,credit_note_draft_id:'D1'}],[{...waiting[0],resolution:'restock',resolution_note:'Seal ok'}],{role:'owner'},true);
 assert.match(done,/Back into stock — Seal ok/);assert.match(done,/Credit Note draft created/);assert.doesNotMatch(done,/data-return-credit|data-return-inspect/);
 const all=context.returnsPanelHtml(note,[ret],[{id:'a',return_id:'R1',delivery_line_id:'L1',product_id:'P1',quantity:5,resolution:null},{id:'b',return_id:'R1',delivery_line_id:'L2',product_id:'P2',quantity:2,resolution:null}],{role:'staff'},false);
 assert.doesNotMatch(all,/data-return-record/,'nothing left to return');
});
