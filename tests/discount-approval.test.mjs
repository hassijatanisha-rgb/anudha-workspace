import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// The page helpers the panel uses; the decision logic itself needs none of them.
const context=vm.createContext({esc:s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`),me:null,crypto:{randomUUID:()=>'id'}});
vm.runInContext(fs.readFileSync(new URL('../discount-approval.js',import.meta.url),'utf8'),context);
const lines=(...bp)=>bp.map(discount_basis_points=>({discount_basis_points}));
const record={id:'pf',revision:2,prepared_by:'sales'};
const decision=(over={})=>({id:'d1',proforma_id:'pf',revision:2,decision:'approved',required_level:'head',decided_at:'2026-10-13T08:00:00Z',decided_by:'head',reason:'ok',...over});

test('largest line discount decides the level; an unset limit sends every discount to the owner',()=>{
 assert.deepEqual({...context.discountRequirement(lines(0,0),1500)},{maxBasisPoints:0,level:'none'});
 assert.equal(context.discountRequirement(lines(500,1500),1500).level,'head');
 assert.equal(context.discountRequirement(lines(500,1501),1500).level,'owner');
 assert.equal(context.discountRequirement(lines(100),null).level,'owner');
});

test('state follows the latest decision for the current revision only',()=>{
 assert.equal(context.discountState(record,lines(1000),[],1500).state,'needed');
 assert.equal(context.discountState(record,lines(1000),[decision({revision:1})],1500).state,'needed','older revision does not count');
 assert.equal(context.discountState(record,lines(1000),[decision()],1500).state,'approved');
 const later=decision({id:'d2',decision:'rejected',decided_at:'2026-10-13T09:00:00Z'});
 assert.equal(context.discountState(record,lines(1000),[decision(),later],1500).state,'rejected');
 assert.equal(context.discountState(record,lines(0),[later],1500).state,'none');
});

test('a head approval stops covering the discount once the limit drops below it',()=>{
 const status=context.discountState(record,lines(1200),[decision()],1000);
 assert.equal(status.state,'needed');assert.equal(status.limitChanged,true);
 assert.equal(context.discountState(record,lines(1200),[decision({required_level:'owner'})],1000).state,'approved');
});

test('decision buttons only for people the database accepts, never the preparer',()=>{
 assert.equal(context.canDecideDiscount({user_id:'h',role:'head'},record,'head'),true);
 assert.equal(context.canDecideDiscount({user_id:'h',role:'head'},record,'owner'),false);
 assert.equal(context.canDecideDiscount({user_id:'o',role:'owner'},record,'owner'),true);
 assert.equal(context.canDecideDiscount({user_id:'s',role:'staff'},record,'head'),false);
 assert.equal(context.canDecideDiscount({user_id:'sales',role:'owner'},record,'owner'),false,'own Pro forma');
 assert.equal(context.canDecideDiscount(null,record,'head'),false);
});

test('panel text is escaped and names who must approve',()=>{
 context.me={user_id:'h',role:'head'};
 const html=context.discountPanelHtml({...record,id:'pf"x'},{state:'needed',level:'head',maxBasisPoints:1250,latest:null});
 assert.match(html,/12\.5% discount\. It needs approval by a department head or the owner/);
 assert.match(html,/data-discount-decide="approved" data-id="pf&#34;x"/);
 const rejected=context.discountPanelHtml(record,{state:'rejected',level:'owner',maxBasisPoints:2000,latest:decision({decision:'rejected',reason:'<b>no</b>'})});
 assert.match(rejected,/&#60;b&#62;no&#60;\/b&#62;/);assert.doesNotMatch(rejected,/data-discount-decide/,'heads cannot decide owner-level discounts');
});
