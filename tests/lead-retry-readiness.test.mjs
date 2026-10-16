import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(values={}){
 const controls=Object.entries({who:'new',callerName:' Asha ',callerPhone:'0712345678',callerOrganization:'Clinic',callerRole:'doctor',source:'phone',subject:'Ultrasound quote',details:'Original details',nextAction:' Call back ',nextActionOn:'',currency:'TZS',estimatedValue:'',ownerUserId:'',...values}).map(([name,value])=>({name,value,disabled:false}));
 const button={disabled:false,textContent:'Save inquiry'},unused={disabled:true};controls.push(button,unused);
 const form={dataset:{id:'',version:'0'},isConnected:true,controls,querySelectorAll:()=>controls,querySelector:()=>button};
 const records=new Map(),calls=[],messages=[];let creates=0,refreshes=0,uuids=0,readFailure=false,loseResponse=false,failBeforeWrite=false,hold;
 const ctx=vm.createContext({me:{user_id:'employee'},view:'leads',crypto:{randomUUID:()=>`inquiry-${++uuids}`},clearTimeout,
  FormData:class{constructor(f){this.entries=new Map(f.controls.filter(c=>c.name&&!c.disabled).map(c=>[c.name,c.value]));}get(k){return this.entries.get(k)??null;}has(k){return this.entries.has(k);}},
  message:message=>messages.push(message),
  client:{rpc:async(name,args)=>{
   calls.push(structuredClone(args));if(hold)await hold;
   if(failBeforeWrite){failBeforeWrite=false;throw Error('Network unavailable');}
   let saved=records.get(args.p_id);
   if(args.p_expected_version===0){
    if(saved){if(saved.version!==1||saved.subject!==args.p_fields.subject)return {error:{message:'Lead already exists; refresh and compare'}};}
    else{creates++;saved={...args.p_fields,id:args.p_id,lead_number:'LD-001',version:1};records.set(saved.id,saved);}
   }else{
    if(saved.version!==args.p_expected_version)return {error:{message:'Lead changed; refresh and compare'}};
    const {owner_user_id,...fields}=args.p_fields;saved={...saved,...fields,version:saved.version+1};records.set(saved.id,saved);
   }
   if(loseResponse){loseResponse=false;throw Error('Response lost');}
   return {data:structuredClone(saved)};
  },from:table=>{assert.equal(table,'sales_leads');let id;const q={select:()=>q,eq:(key,value)=>{assert.equal(key,'id');id=value;return q;},maybeSingle:async()=>readFailure?{error:{message:'Offline'}}:{data:structuredClone(records.get(id)||null)}};return q;}}
 });
 vm.runInContext(readFileSync(new URL('../sales-leads.js',import.meta.url),'utf8'),ctx);
 ctx.leadRefreshOne=async()=>{refreshes++;};
 return {ctx,form,button,controls,records,calls,messages,set:(name,value)=>{controls.find(c=>c.name===name).value=value;},save:()=>ctx.saveLeadForm(form),get creates(){return creates;},get refreshes(){return refreshes;},get uuids(){return uuids;},set readFailure(v){readFailure=v;},set loseResponse(v){loseResponse=v;},set failBeforeWrite(v){failBeforeWrite=v;},set hold(v){hold=v;}};
}

for(const [field,next] of [['subject','Centrifuge quote'],['details','Updated details'],['callerPhone','0755555555']]){
 test(`uncertain create preserves one inquiry when ${field} changes`,async()=>{
  const f=fixture();f.loseResponse=true;f.readFailure=true;
  await assert.rejects(f.save(),/could not be confirmed/);
  assert.equal(f.form.dataset.requestId,'inquiry-1');assert.equal(f.creates,1);
  f.set(field,next);f.readFailure=false;
  await assert.rejects(f.save(),/Press Save again to update/);
  assert.equal(f.form.dataset.id,'inquiry-1');assert.equal(f.form.dataset.version,'1');
  assert.equal(f.messages.length,0);assert.equal(f.refreshes,0);
  assert.equal(f.controls.find(c=>c.name===field).value,next,'latest entries survive reconciliation');
  await f.save();
  assert.equal(f.records.size,1);assert.equal(f.creates,1);assert.equal(f.uuids,1);
  assert.equal(f.records.get('inquiry-1')[field==='callerPhone'?'caller_phone':field],next);
  assert.deepEqual(f.calls.map(c=>c.p_expected_version),[0,0,1]);
  assert.equal(f.messages.length,1);assert.equal(f.refreshes,1);
 });
}

test('a lost create response is successful only after exact persisted-content reconciliation',async()=>{
 const f=fixture({estimatedValue:'12.50'});f.loseResponse=true;
 await f.save();assert.equal(f.creates,1);assert.equal(f.refreshes,1);assert.equal(f.messages.length,1);
 assert.equal(f.records.get('inquiry-1').caller_name,'Asha');assert.equal(f.records.get('inquiry-1').next_action,'Call back');
 assert.equal(f.records.get('inquiry-1').estimated_value_minor,'1250');
 assert.equal(f.ctx.leadSavedMatches({a:null,b:1250},{a:'',b:'1250'}),true);
 assert.equal(f.ctx.leadSavedMatches({details:'note'},{details:' note'}),false);
});

test('an uncommitted create retry retains its form identity even after changing its subject',async()=>{
 const f=fixture();f.failBeforeWrite=true;
 await assert.rejects(f.save(),/Network unavailable/);f.set('subject','Changed inquiry');await f.save();
 assert.equal(f.creates,1);assert.equal(f.uuids,1);assert.deepEqual(f.calls.map(c=>c.p_id),['inquiry-1','inquiry-1']);
});

test('pending saves lock all form fields and deduplicate submissions, then restore each disabled state',async()=>{
 const f=fixture();let release;f.hold=new Promise(resolve=>{release=resolve;});f.failBeforeWrite=true;
 const pending=f.save();assert.equal(f.controls.every(c=>c.disabled),true);assert.equal(f.button.textContent,'Saving…');
 assert.equal(f.calls[0].p_fields.subject,'Ultrasound quote','payload read before fields are disabled');
 await f.save();assert.equal(f.calls.length,1);release();await assert.rejects(pending,/Network unavailable/);
 assert.equal(f.controls.slice(0,-1).every(c=>!c.disabled),true);assert.equal(f.controls.at(-1).disabled,true);
 assert.equal(f.button.textContent,'Save inquiry');assert.equal(f.form.dataset.saving,'false');
});

test('reconciliation cannot consume a later editor version after an edit conflict',async()=>{
 const f=fixture();await f.save();f.messages.length=0;f.set('details','My changes');
 f.records.get('inquiry-1').version=3;f.records.get('inquiry-1').details='Another employee changed this';
 await assert.rejects(f.save(),/Lead changed/);
 assert.equal(f.form.dataset.version,'1');assert.equal(f.controls.find(c=>c.name==='details').value,'My changes');
 assert.equal(f.messages.length,0);assert.equal(f.records.get('inquiry-1').version,3);
});

test('changing the salesperson after an uncertain create cannot silently claim it was saved',async()=>{
 const f=fixture();f.loseResponse=true;f.readFailure=true;await assert.rejects(f.save());
 f.set('ownerUserId','new-owner');f.readFailure=false;
 await assert.rejects(f.save(),/Hand over/);await assert.rejects(f.save(),/Hand over/);
 assert.equal(f.records.get('inquiry-1').owner_user_id,'');assert.equal(f.messages.length,0);
 assert.equal(f.creates,1);
});

for(const invalidate of ['actor','epoch','form'])test(`${invalidate} change discards pending save completion`,async()=>{
 const f=fixture();let release;f.hold=new Promise(resolve=>{release=resolve;});const pending=f.save();
 if(invalidate==='actor')f.ctx.me={user_id:'employee'};
 else if(invalidate==='epoch')f.ctx.clearLeads();
 else f.form.isConnected=false;
 release();await pending;assert.equal(f.refreshes,0);assert.equal(f.messages.length,0);
 assert.equal(f.form.dataset.id,'');assert.equal(f.form.dataset.saving,'false');
});
