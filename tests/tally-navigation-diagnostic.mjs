import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
for(const outcome of ['success','error']){
 const content={innerHTML:''};let finish;
 const delayed=new Promise((resolve,reject)=>{finish=outcome==='success'?()=>resolve([]):()=>reject(Error('Old read failed'))});
 const ctx=vm.createContext({me:{user_id:'owner'},view:'inventory',inventorySection:'review',$:()=>content,all:()=>delayed,document:{addEventListener(){}},esc:String,inventoryHeader:()=>'',bindInventoryWorkspace(){}});
 vm.runInContext(readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8'),ctx);
 ctx.tallyGodownReadiness=()=>({});ctx.renderTallyStock=()=>{content.innerHTML='Stale review'};
 const pending=ctx.tallyStockScreen();ctx.view='clients';content.innerHTML='Clients';finish();await pending;
 assert.equal(content.innerHTML,'Clients',`old review ${outcome} must not overwrite Clients`);
}
console.log('PASS: nested review loader preserves navigation.');
