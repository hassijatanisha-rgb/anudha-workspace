import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
const file=new URL('../company-forms.js',import.meta.url);
const ctx=vm.createContext({});
if(existsSync(file))vm.runInContext(readFileSync(file,'utf8'),ctx);
test('Seven source forms retain their distinct fields',()=>{
 const forms=ctx.companyFormDefinitions();
 assert.equal(Object.keys(forms).length,7);
 assert.ok(forms.contra.columns.includes('debit'));
 assert.ok(forms.tax_invoice.fields.some(f=>f[0]==='destination'));
 assert.ok(forms.purchase.fields.some(f=>f[0]==='supplier_reference'));
});
test('Editor uses blank values rather than source sample numbers and dates',()=>{
 const html=ctx.companyFormEditor('payment');
 assert.match(html,/Account/);assert.match(html,/Through/);
 assert.ok(!html.includes('4123'));assert.ok(!html.includes('2026-09-22'));
 assert.ok(!html.includes('NOT AN AMOUNT'));
});
test('Draft output is branded, escapes data and never claims fiscal verification',()=>{
 const html=ctx.companyFormDocument('tax_invoice',{buyer:'<script>x</script>',lines:[{description:'<img onerror=x>',quantity:'2',rate:'10',amount:'20'}]});
 assert.match(html,/anudha-logo.svg/);assert.match(html,/DRAFT/);
 assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
 assert.match(html,/Not issued/);assert.match(html,/100-113-473/);
});
test('All seven documents and editors render without losing signatures',()=>{
 for(const key of Object.keys(ctx.companyFormDefinitions())){
  assert.match(ctx.companyFormEditor(key),/name="date"/);
  assert.match(ctx.companyFormDocument(key,{}),/Authorised Signatory/);
 }
 assert.throws(()=>ctx.companyFormEditor('other'),/Unknown/);
});
test('Reading a filled form keeps line items and ignores unrelated controls',()=>{
 const form={
  elements:{namedItem:key=>({value:{date:'2026-09-23',account:'Bank',contact:'Person'}[key]||''})},
  querySelectorAll:()=>[{querySelector:selector=>({value:selector.includes('particulars')?'Rent':'100.00'})}]
 };
 const data=ctx.companyFormRead('payment',form);
 assert.equal(data.account,'Bank');assert.equal(data.lines[0].amount,'100.00');
 assert.equal(data.lines[0].particulars,'Rent');assert.equal(data.password,undefined);
});
