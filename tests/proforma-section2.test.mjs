import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function context(){
 const c=vm.createContext({Intl,Date,console,crypto:{randomUUID:()=> 'new-id'},esc:s=>String(s??''),orgIndex:new Map(),contacts:[],products:[],me:{user_id:'actor'},companyFormBrand:()=>'<header>ANUDHA LIMITED</header>'});
 vm.runInContext(readFileSync('company-forms.js','utf8')+'\n'+readFileSync('sales-domain.js','utf8')+'\n'+readFileSync('sales-delivery.js','utf8'),c);return c;
}
test('Pro forma actions distinguish recording external sending from accounting submission',()=>{
 const c=context();
 assert.match(vm.runInContext("proformaActions({id:'p',status:'draft'})",c),/Record sent to client/);
 assert.match(vm.runInContext("proformaActions({id:'p',status:'sent'})",c),/Submit to accounting/);
});
test('Saved pro forma document uses company branding, preparation identity and E & OE',()=>{
 const c=context();
 const html=vm.runInContext("proformaCard({id:'p',status:'draft',revision:1,prepared_by:'actor',currency:'TZS',subtotal_minor:0,discount_minor:0,tax_minor:0,total_minor:0})",c);
 assert.match(html,/ANUDHA LIMITED/);assert.match(html,/Prepared by/);assert.match(html,/E\. &amp; O\.E\./);
 assert.match(html,/Items subject to availability at the time of order/);
 assert.match(html,/Warranty void for damage caused by improper power/);
 assert.match(html,/VAT is added to the prices shown/);
 assert.doesNotMatch(html,/DEMO-ACCOUNT|20610008415|Dr\. Amina|Asha Mrema/);
});
