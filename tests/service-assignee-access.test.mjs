import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({
 employeeName:id=>id,
 inventoryOption:(id,label,selected)=>`<option value="${id}"${selected?' selected':''}>${label}</option>`
});
vm.runInContext(fs.readFileSync('service-workflow.js','utf8'),context);
vm.runInContext(`serviceTeam=[
 {user_id:'engineer',role:'staff',active:true,access:['service']},
 {user_id:'owner',role:'owner',active:true,access:[]},
 {user_id:'sales',role:'staff',active:true,access:['proformas']},
 {user_id:'inactive',role:'head',active:false,access:['service']},
 {user_id:'missing',role:'staff',active:true},
 {user_id:'null',role:'staff',active:true,access:null},
 {user_id:'malformed',role:'staff',active:true,access:'service'}
]`,context);
const options=context.serviceTeamOptions('engineer');
assert.deepEqual([...options.matchAll(/value="([^"]+)"/g)].map(match=>match[1]),['engineer','owner']);
assert.match(options,/value="engineer" selected/);

let fields,submit,rpcArgs,focused=false;
const selfButton={},assignee={value:''},note={focus(){focused=true;}};
Object.assign(context,{
 me:{user_id:'engineer',active:true,role:'staff',access:['service']},view:'service',esc:String,
 inventoryProduct:()=>({name:'Fixture machine'}),message(){},
 actionForm:(title,html,handler)=>{fields=html;submit=handler;return {querySelector:()=>selfButton,elements:{namedItem:name=>name==='assignee'?assignee:note}};},
 client:{rpc:async(name,args)=>{rpcArgs={name,...args};return {data:{id:'case',version:4,status:'assigned',updated_at:'2026-10-29T08:00:00Z'}};}}
});
vm.runInContext(fs.readFileSync('service-domain.js','utf8'),context);
vm.runInContext('updateServiceCase=async()=>({historyError:""})',context);
context.openServiceAction({id:'case',version:3,status:'new',case_number:'INS-FIXTURE'},'assign');
assert.match(fields,/type="button" data-service-assign-me>Assign engineer to me/);
selfButton.onclick();
assert.equal(assignee.value,'engineer');assert.equal(focused,true);
await submit({assignee:assignee.value,note:'I will install this machine'});
assert.equal(rpcArgs.name,'advance_service_case');assert.equal(rpcArgs.p_action,'assign');
assert.equal(rpcArgs.p_assigned_user_id,'engineer');assert.equal(rpcArgs.p_expected_version,3);
context.me={user_id:'sales',active:true,role:'staff',access:['proformas']};
assignee.value='';selfButton.onclick();assert.equal(assignee.value,'','A stale self-assignment button cannot act for another session');
context.openServiceAction({id:'case',version:3,status:'new',case_number:'INS-FIXTURE'},'assign');
assert.doesNotMatch(fields,/data-service-assign-me/);
console.log('PASS: service assignments require explicit Service access; self-assignment selects the signed-in engineer and uses the versioned service RPC.');
