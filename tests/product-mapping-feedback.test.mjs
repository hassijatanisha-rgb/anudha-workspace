import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const source=readFileSync(new URL('../product-mapping-decision.js',import.meta.url),'utf8');
test('mapping decision feedback keeps its request identity, fields and refusal local',async()=>{
 const document=dom(),calls=[],feedback=[];let resolve,saved;installNativeFormControls(document);
 const c=vm.createContext({document,busy:false,me:{user_id:'owner'},canEditRecords:()=>true,products:[{id:'product-1',name:'Reagent',sku:'R-001'}],reviewedCatalogProduct:product=>product,esc:String,crypto:{randomUUID:()=> 'decision-id'},FormData:class{constructor(form){this.form=form;}get(name){return this.form.querySelector(`[name="${name}"]`).value;}},message(){},actionFeedbackRememberDialog:dialog=>{dialog.remembered=true;},actionFeedbackRefuse:(_button,error)=>{error.textContent='Another action is still running.';},client:{from:()=>({select(){return this;},eq(){return this;},order(){return this;},limit:async()=>({data:[]})}),rpc:(name,args)=>{calls.push({name,args});return new Promise(r=>resolve=r);}}});

 Object.assign(c,{showWorkspaceDialog:(dialog,{size})=>{dialog.dataset.dialogSize=size;dialog.showModal();},closeWorkspaceDialog:async dialog=>{dialog.close();return true;},workspaceFormSnapshot:form=>JSON.stringify(form.values||form.fields||[...form.querySelectorAll('[name]')].map(node=>[node.getAttribute('name'),node.value])),bindWorkspaceDialogDismiss:(dialog,{isBusy})=>async()=>{if(isBusy())return false;dialog.close();return true;}});
 c.run=async(fn,options)=>{feedback.push(options);try{await fn();}catch(error){options.errorTarget.textContent=error.message;}};
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),c);vm.runInContext(source,c);await c.openProductMappingDecision({sourceKey:'row-1',corrected:{name:'Reagent',manufacturer:'Maker'},match:{status:'exact',productIds:['product-1']}},row=>saved=row);
 const dialog=document.querySelector('dialog'),form=dialog.querySelector('form'),button=form.querySelector('[type="submit"]'),error=form.querySelector('[role="alert"]');form.querySelector('[name="decision"]').value='linked';form.querySelector('[name="reason"]').value='Checked against label';
 assert.equal(dialog.remembered,true);c.busy=true;await form.onsubmit({preventDefault(){}});assert.equal(calls.length,0);assert.equal(button.disabled,false);assert.match(error.textContent,/Another action/);
 c.busy=false;const first=form.onsubmit({preventDefault(){}});assert.equal(button.disabled,true);assert.equal(feedback[0].origin,button);assert.equal(feedback[0].errorTarget,error);resolve({error:{message:'Connection unavailable'}});await first;
 assert.equal(dialog.open,true);assert.equal(button.disabled,false);assert.match(error.textContent,/Connection unavailable/);assert.equal(form.querySelector('[name="reason"]').value,'Checked against label');
 const retry=form.onsubmit({preventDefault(){}});assert.equal(calls[1].args.p_id,calls[0].args.p_id);assert.equal(calls[1].args.p_expected_version,0);resolve({data:{source_key:'row-1',version:1,decision:'linked'}});await retry;assert.equal(saved.source_key,'row-1');assert.equal(dialog.isConnected,false);
});
