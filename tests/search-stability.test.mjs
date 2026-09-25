import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
test('Buyer TIN is shown in editor and PDF without losing existing saved values',()=>{
 const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('company-forms.js',root),'utf8'),ctx);
 for(const kind of ['tax_invoice','delivery'])for(const render of ['companyFormEditor','companyFormDocument']){
  const html=ctx[render](kind,{buyer_cst:'100-222-333'});
  assert.match(html,/Buyer’s TIN No\./);assert.doesNotMatch(html,/CST/);assert.match(html,/100-222-333/);
 }
});
for(const type of ['text','search'])test(`${type} search preserves cursor, selection and scroll on redraw`,()=>{
 const helper=new URL('search-state.js',root),ctx=vm.createContext({});
 if(existsSync(helper))vm.runInContext(readFileSync(helper,'utf8'),ctx);
 const parent={scrollTop:240,scrollLeft:9,parentElement:null};
 const input={id:'query',type,value:'abcdef',selectionStart:2,selectionEnd:4,selectionDirection:'backward',scrollLeft:7,parentElement:parent};
 let selected,options;const next={focus:o=>options=o,setSelectionRange:(...args)=>selected=args};
 ctx.document={getElementById:()=>next};ctx.window={scrollX:0,scrollY:500,scrollTo:(x,y)=>{assert.equal(y,500)}};
 assert.equal(typeof ctx.renderSearchPreservingPosition,'function');
 ctx.renderSearchPreservingPosition(input,()=>{parent.scrollTop=0});
 assert.deepEqual(Array.from(selected),[2,4,'backward']);assert.equal(options.preventScroll,true);assert.equal(parent.scrollTop,240);assert.equal(next.scrollLeft,7);
});
test('All seven redraw search handlers use the same cursor-preserving helper',()=>{
 const files=['app.js','client-profile-pages.js','catalog-inventory.js','tally-stock-review.js','inventory-operations.js'];
 const count=files.reduce((n,file)=>n+(readFileSync(new URL(file,root),'utf8').match(/renderSearchPreservingPosition\(/g)||[]).length,0);
 assert.equal(count,7);
});
