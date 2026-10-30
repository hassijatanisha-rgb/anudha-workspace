import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../discount-approval.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(kind='decision'){
 const document=dom(),content=document.createElement('main');content.setAttribute('id','content');document.body.append(content);const calls=[],messages=[];let callback,fail=false,hook;
 const record={id:'pf',document_number:'PF-1',status:'draft',prepared_by:'seller',revision:2,version:4,organization_id:'client'};
 const policy={id:true,version:3,head_limit_basis_points:1500,updated_by:'owner'},decision={id:'decision',proforma_id:'pf',revision:2,decision:'approved',required_level:'head',decided_by:'owner',decided_at:'2026-10-29T10:00:00Z',reason:'Approved'};
 const c=vm.createContext({window:{scrollX:4,scrollY:500,scrollTo:value=>{assert.equal(value.left,4);assert.equal(value.top,500)}},document,me:{user_id:'owner',role:'owner'},view:kind==='policy'?'settings':'sales',salesEpoch:1,salesWorkspaceRequest:1,CSS:{escape:x=>x},crypto:{randomUUID:()=>decision.id},$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),salesProforma:id=>id===record.id?record:null,salesOrganization:()=>({name:'Client'}),salesLines:()=>[{discount_basis_points:1000}],employeeName:()=> 'Owner',actionForm:(_title,_fields,fn)=>{callback=fn},message:(...args)=>messages.push(args),run:fn=>fn(),salesDeliveryWorkspace:()=>assert.fail('No whole-workspace reload'),
  client:{rpc:async(name,args)=>{calls.push({name,args});if(hook)return hook(name,args);if(name==='set_discount_policy')Object.assign(policy,{version:4,head_limit_basis_points:args.p_head_limit_basis_points});return {data:name==='set_discount_policy'?{...policy}:decision}},from:table=>{calls.push({table});const result=()=>fail?{error:{message:'Offline'}}:{data:table==='discount_policy'?policy:[decision]};return {select(){return this},in(){return this},order(){return this},async limit(){return result()},async maybeSingle(){return result()}};}}
 });vm.runInContext(source,c);c.seedPolicy=policy;vm.runInContext('discountPolicy=seedPolicy',c);
 content.innerHTML=`<header><input id="search"></header>${kind==='policy'?`<div id="settingsDiscountPolicy">${c.discountPolicyHtml()}</div>`:''}<article data-document-card="pf">${c.discountPanelHtml(record,{state:'needed',level:'head',maxBasisPoints:1000,latest:null})}<div class="actions"><button data-proforma-action="send">Send</button></div></article><article id="other">Other record</article>`;
 return {c,content,document,record,calls,messages,setFail:value=>fail=value,setHook:fn=>hook=fn,save:values=>callback(values)};
}
test('confirmed decision refreshes only discount regions using two reads and preserves surrounding nodes',async()=>{
 const f=fixture(),header=f.content.querySelector('header'),other=f.content.querySelector('#other'),card=f.content.querySelector('[data-document-card]'),send=card.querySelector('[data-proforma-action]'),search=f.content.querySelector('#search');search.focus();f.c.openDiscountDecision(f.record,'approved');await f.save({reason:'Approved'});
 assert.equal(f.content.querySelector('header'),header);assert.equal(f.content.querySelector('#other'),other);assert.equal(f.content.querySelector('[data-document-card]'),card);assert.equal(card.querySelector('[data-proforma-action]'),send);assert.equal(f.document.activeElement,search);assert.match(card.querySelector('[data-discount-panel]').textContent,/approved/);assert.equal(send.disabled,false);
 assert.deepEqual(f.calls.map(x=>x.name||x.table),['decide_proforma_discount','discount_policy','sales_proforma_discount_decisions']);assert.equal(f.calls[0].args.p_expected_version,4);assert.equal(f.calls[0].args.p_decision_id,'decision');
});
test('saved decision with failed read blocks stale discount/send actions and retry only reads',async()=>{
 const f=fixture(),card=f.content.querySelector('[data-document-card]'),send=card.querySelector('[data-proforma-action]');f.setFail(true);f.c.openDiscountDecision(f.record,'approved');await f.save({reason:'Approved'});assert.equal(send.disabled,true);assert.match(card.querySelector('[role="alert"]').textContent,/Discount approved.*could not refresh/);
 const retry=card.querySelector('[role="alert"] button');f.setFail(false);await retry.onclick();assert.equal(f.calls.filter(x=>x.name).length,1);assert.equal(send.disabled,false);assert.equal(card.querySelector('[role="alert"]'),null);
});
test('policy save retains the header/register and keeps the original expected version',async()=>{
 const f=fixture('policy'),header=f.content.querySelector('header'),card=f.content.querySelector('[data-document-card]');f.c.openDiscountLimit();await f.save({limit:'15'});assert.equal(f.content.querySelector('header'),header);assert.equal(f.content.querySelector('[data-document-card]'),card);assert.equal(f.calls[0].name,'set_discount_policy');assert.equal(f.calls[0].args.p_expected_version,3);assert.equal(f.calls[0].args.p_head_limit_basis_points,1500);assert.equal(f.calls.length,2);
});
test('uncertain decision retries retain the same id while malformed receipts never fabricate success',async()=>{
 const f=fixture();f.c.openDiscountDecision(f.record,'approved');f.setHook(()=>({error:{message:'Unknown result'}}));await assert.rejects(f.save({reason:'Approved'}));f.setHook(null);await f.save({reason:'Approved'});assert.equal(f.calls[0].args.p_decision_id,f.calls[1].args.p_decision_id);
 const malformed=fixture();malformed.c.openDiscountDecision(malformed.record,'approved');malformed.setHook(()=>({data:{}}));await assert.rejects(malformed.save({reason:'Approved'}),/could not be verified/);assert.equal(malformed.messages.length,0);assert.equal(malformed.calls.length,1);
});
test('old writes and failed responses cannot repaint another actor, route or workspace request',async()=>{
 for(const kind of ['decision','policy'])for(const mode of ['actor','route','request'])for(const failure of [false,true]){
  const f=fixture(kind),wait=deferred();if(kind==='decision')f.c.openDiscountDecision(f.record,'approved');else f.c.openDiscountLimit();f.setHook(()=>wait.promise);const pending=f.save(kind==='decision'?{reason:'Approved'}:{limit:'15'});
  if(mode==='actor')f.c.me={...f.c.me};else if(mode==='route')f.c.view='personal';else if(kind==='decision')f.c.salesWorkspaceRequest++;else vm.runInContext('discountSettingsRequest++',f.c);
  const before=f.content.innerHTML;if(failure)wait.reject(Error('Old failure'));else wait.resolve({data:{}});await pending;assert.equal(f.content.innerHTML,before);assert.equal(f.messages.length,0);assert.equal(f.calls.length,1);
 }
});


test('an older policy reread stays blocked with read-only retry instead of undoing the confirmed limit onscreen',async()=>{
 const f=fixture('policy');f.c.openDiscountLimit();f.setHook(()=>({data:{id:true,version:4,head_limit_basis_points:1200,updated_by:'owner'}}));await f.save({limit:'12'});
 assert.match(f.content.querySelector('[role="alert"]').textContent,/Discount limit saved.*current discount limit could not be verified/);assert.equal(f.content.querySelector('[data-discount-limit]').disabled,true);assert.equal(f.calls.filter(x=>x.name).length,1);
});
