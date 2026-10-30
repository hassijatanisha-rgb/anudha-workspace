import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/website-request/index.ts',import.meta.url),'utf8')
 .replace(/^import .*createClient.*;\n/m,'').replace(/^export /gm,''));
const request=()=>new Request('https://fixture.invalid/website-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit',kind:'quote',name:'Fixture Customer',phone:'0712345678',email:'fixture@example.invalid',message:'Send a quotation',channel:'whatsapp'})});
function edge({duplicate=false,send=async()=>({ok:true,status:200}),record=async()=>({error:null})}={}){
 let handler;const calls=[],timers=[],saved={id:'fixture-id',request_number:'REQ-FIXTURE-1',kind:'support',duplicate};
 const secrets={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'private-service-key',WHATSAPP_TOKEN:'private-whatsapp-key',WHATSAPP_PHONE_ID:'fixture-phone',WHATSAPP_TEMPLATE:'fixture-template',RESEND_API_KEY:'private-email-key',EMAIL_FROM:'Fixture <fixture@example.invalid>'};
 const context=vm.createContext({Request,Response,TextEncoder,crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},
  AbortSignal:{timeout:ms=>{const controller=new AbortController();timers.push({ms,controller});return controller.signal;}},
  fetch:(url,options)=>{calls.push({type:'provider',url,options});return send(url,options);},
  createClient:()=>({rpc:(name,args)=>{
   calls.push({type:'rpc',name,args});
   if(name==='submit_customer_request')return Promise.resolve({data:[saved],error:null});
   assert.equal(name,'record_customer_request_confirmation');
   return {abortSignal:signal=>record(signal,args)};
  }}),Deno:{env:{get:key=>secrets[key]},serve:fn=>{handler=fn;}}});
 vm.runInContext(source,context);return {call:()=>handler(request()),calls,timers};
}
const until=async predicate=>{for(let n=0;n<30&&!predicate();n++)await new Promise(setImmediate);assert.ok(predicate(),'Expected asynchronous operation started');};
const cancelled=signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('private-provider-response')),{once:true});});

test('duplicate response reports saved kind and skips confirmation providers',async()=>{
 const h=edge({duplicate:true}),response=await h.call();assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{request_number:'REQ-FIXTURE-1',kind:'support',confirmation:'already_received'});
 assert.equal(h.calls.length,1);assert.equal(h.timers.length,0);
});
test('confirmation channels start together and share eight seconds; exceptions never hide the saved reference',async()=>{
 const h=edge({send:async(url,{signal})=>cancelled(signal),record:async()=>{throw Error('private-status-write-error');}}),pending=h.call();
 await until(()=>h.calls.filter(c=>c.type==='provider').length===2);
 const providers=h.calls.filter(c=>c.type==='provider');assert.equal(providers[0].options.signal,providers[1].options.signal);
 assert.equal(h.timers[0].ms,8000);h.timers[0].controller.abort();
 const response=await pending;assert.equal(response.status,200);assert.deepEqual(await response.json(),{request_number:'REQ-FIXTURE-1',kind:'support',confirmation:'failed'});
 assert.deepEqual(h.timers.map(t=>t.ms),[8000,5000]);
 const confirmation=h.calls.find(c=>c.name==='record_customer_request_confirmation');assert.doesNotMatch(confirmation.args.p_detail,/private-/);
 assert.match(confirmation.args.p_detail,/WhatsApp.*timed out; Email.*timed out/);
});
test('one sent channel succeeds without reading or recording raw provider failures',async()=>{
 const h=edge({send:async url=>url.includes('facebook')?{ok:false,status:503,text:()=>{throw Error('Must not read provider response');}}:{ok:true,status:200},record:async()=>({error:{message:'private-service-key'}})});
 const response=await h.call();assert.equal(response.status,200);assert.equal((await response.json()).confirmation,'sent');
 const confirmation=h.calls.find(c=>c.name==='record_customer_request_confirmation');assert.equal(confirmation.args.p_detail,'WhatsApp sending failed (503); Email sent');
 const email=h.calls.find(c=>c.url?.includes('resend'));assert.match(JSON.parse(email.options.body).text,/support request/,'Confirmation describes the saved kind');
});
test('hung confirmation-status recording is bounded to five seconds after provider completion',async()=>{
 const h=edge({record:signal=>cancelled(signal)}),pending=h.call();
 await until(()=>h.timers.length===2);assert.equal(h.timers[1].ms,5000);h.timers[1].controller.abort();
 const response=await pending;assert.equal(response.status,200);assert.equal((await response.json()).request_number,'REQ-FIXTURE-1');
});
test('provider exception details and credentials are not persisted in confirmation history',async()=>{
 const h=edge({send:async()=>{throw Error('private-whatsapp-key private-email-key secret response');}});
 assert.equal((await (await h.call()).json()).confirmation,'failed');
 const confirmation=h.calls.find(c=>c.name==='record_customer_request_confirmation');assert.doesNotMatch(confirmation.args.p_detail,/private-|secret response/);
});

function workspace(rpc){
 const dialogs=[],target={isConnected:true},context=vm.createContext({$:()=>target,me:{user_id:'actor'},client:{rpc},employeeDirectory:new Map([['ineligible',{user_id:'ineligible',display_name:'Wrong employee',active:true}]]),
  employeeName:id=>id,esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),actionForm:(title,fields,save)=>dialogs.push({title,fields,save}),view:'requests',message:()=>{}});
 vm.runInContext(readFileSync(new URL('../customer-requests.js',import.meta.url),'utf8'),context);
 // Actions are available only after the complete request has been opened.
 context.fixtureRequest=row;vm.runInContext('requestActor=me;requestSelected=fixtureRequest.id;requestRows=[fixtureRequest];',context);return {context,dialogs};
}
const row={id:'request-id',request_number:'REQ-1',name:'Fixture',kind:'quote',status:'received',version:1};
test('assignment picker uses the eligible RPC instead of the unrestricted employee directory',async()=>{
 const h=workspace(async(name,args)=>{assert.equal(name,'customer_request_assignees');assert.equal(args.p_request_id,row.id);return {data:[{user_id:'eligible',display_name:'Eligible <employee>'}]};});
 await h.context.openRequestAction(row,'assign');assert.equal(h.dialogs.length,1);
 assert.match(h.dialogs[0].fields,/value="eligible"/);assert.match(h.dialogs[0].fields,/Eligible &#60;employee&#62;/);
 assert.doesNotMatch(h.dialogs[0].fields,/Wrong employee|ineligible/);
});
test('assignment picker cannot reopen after a login or request-cache change',async()=>{
 let finish;const h=workspace(()=>new Promise(resolve=>{finish=resolve;})),pending=h.context.openRequestAction(row,'assign');
 h.context.me={user_id:'other-actor'};h.context.clearCustomerRequests();finish({data:[{user_id:'eligible',display_name:'Eligible'}]});await pending;
 assert.equal(h.dialogs.length,0);
});
test('failed eligible lookup opens no assignment form',async()=>{
 const h=workspace(async()=>({error:{message:'No request access'}}));await assert.rejects(h.context.openRequestAction(row,'assign'),/No request access/);assert.equal(h.dialogs.length,0);
});
test('leaving requests during lookup opens no dialog and changing login before save sends no mutation',async()=>{
 let finish;const pendingWorkspace=workspace(()=>new Promise(resolve=>{finish=resolve;})),pending=pendingWorkspace.context.openRequestAction(row,'assign');
 pendingWorkspace.context.view='dashboard';finish({data:[]});await pending;assert.equal(pendingWorkspace.dialogs.length,0);
 let calls=0;const h=workspace(async()=>{calls++;return {data:[{user_id:'eligible',display_name:'Eligible'}]};});
 await h.context.openRequestAction(row,'assign');h.context.me={user_id:'another-actor'};
 await assert.rejects(h.dialogs[0].save({assignee:'eligible'}),/login or request changed/);assert.equal(calls,1);
});
