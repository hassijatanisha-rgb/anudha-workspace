import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(files,all=async()=>[]){
 const content={innerHTML:'Current page'};
 const q={select(){return this},order(){return this},limit(){return this},then(ok){return Promise.resolve({data:[]}).then(ok)}};
 const c=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,me:{user_id:'a'},view:'service',all,client:{from:()=>q},esc:String,$:()=>content,document:{addEventListener(){},querySelectorAll:()=>[]},window:{addEventListener(){}},location:{hash:''},syncWorkspaceNavigation(){}});
 for(const file of ['business-date.js',...files])vm.runInContext(read(file),c);
 return {c,content,get:code=>vm.runInContext(code,c)};
}
test('Tanzania civil dates remain correct across midnight, year and leap-day boundaries',()=>{
 const {c}=fixture([]);
 assert.equal(c.companyDate(0,new Date('2026-10-15T21:30:00Z')),'2026-10-16');
 assert.equal(c.companyDate(15,new Date('2026-10-15T21:30:00Z')),'2026-10-31');
 assert.equal(c.companyDate(1,new Date('2026-12-31T10:00:00Z')),'2027-01-01');
 assert.equal(c.companyDate(1,new Date('2028-02-28T10:00:00Z')),'2028-02-29');
});
test('requests from a prior account cannot overwrite newer rows',async()=>{
 const pending=deferred();let calls=0;const {c,get}=fixture(['customer-requests.js'],()=>++calls===1?pending.promise:Promise.resolve([{id:'b'}]));
 c.view='requests';get('renderCustomerRequests=()=>{}');const first=c.customerRequestsWorkspace(true);c.me={user_id:'b'};await c.customerRequestsWorkspace(true);pending.resolve([{id:'a'}]);await first;
 assert.equal(get('requestRows[0].id'),'b');
});
test('clearing service invalidates both data and late failures, including same actor restored',async()=>{
 const pending=deferred();const {c,content,get}=fixture(['service-workflow.js'],()=>pending.promise);
 const first=c.serviceWorkspace(true);c.clearServiceWorkflow();content.innerHTML='Signed out';pending.reject(Error('Old request'));await first;
 assert.equal(content.innerHTML,'Signed out');assert.equal(get('serviceLoadError'),'');assert.equal(get('serviceLoaded'),false);
});
test('service navigation during a load cannot be replaced by the old route',async()=>{
 const pending=deferred();const {c,content,get}=fixture(['service-workflow.js'],()=>pending.promise);
 const first=c.serviceWorkspace(true);c.view='contacts';content.innerHTML='Clients';pending.resolve([]);await first;
 assert.equal(content.innerHTML,'Clients');assert.equal(get('serviceLoaded'),true);
});
test('inventory resets cached identity and refuses late stock responses',async()=>{
 const pending=deferred();const {c,get}=fixture(['product-review-ui.js','inventory-operations.js'],table=>table==='inventory_lots'?pending.promise:Promise.resolve([]));
 c.view='inventory';const first=c.loadInventoryOperations();await tick();c.clearInventoryOperations();c.me={user_id:'b'};pending.resolve([{id:'old-lot'}]);await first;
 assert.equal(get('inventoryLots.length'),0);assert.equal(get('inventoryLoaded'),false);assert.equal(get('productDetailReviews.size'),0);
});
test('branch history cannot return after session clear',async()=>{
 const pending=deferred();const {c,get}=fixture(['client-profile-pages.js'],()=>pending.promise);
 c.inventoryLoaded=true;const first=c.loadBranchHistory('branch');c.clearBranchHistory();pending.resolve([{id:'old'}]);await first;assert.equal(get('branchHistoryCache.size'),0);
});
test('service rows reject excess input instead of truncating it',()=>{
 const {c}=fixture(['service-workflow.js']);
 assert.equal(c.parseServiceRows(Array(10).fill('Name | Phone | Role').join('\n'),['name','phone','role'],10).length,10);
 assert.throws(()=>c.parseServiceRows(Array(11).fill('Name | Phone | Role').join('\n'),['name','phone','role'],10),/no more than 10/);
 assert.throws(()=>c.parseServiceRows(Array(101).fill('Accessory | Serial').join('\n'),['name','serial'],100),/no more than 100/);
});

function loginGate({mfa=false,password=true,setup=false}={}){
 const events=[],c=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,sessionLoadEpoch:0,message(){},client:{auth:{getUser:async()=>({data:{user:{id:'actor'}}})}},twoStepNeeded:async()=>mfa,requirePasswordChange:()=>{events.push('password');return password;},twoStepSetupRequired:async()=>setup,showTwoStepPrompt:()=>events.push('mfa'),showTwoStepSetupRequired:()=>events.push('setup'),loadMyStaffRow:async()=>{events.push('business');throw Error('Business data reached');}});
 vm.runInContext(read('app.js').split('\n').find(line=>line.startsWith('async function load(){')),c);return {c,events};
}
test('existing MFA challenge precedes temporary-password replacement and all business reads',async()=>{
 const {c,events}=loginGate({mfa:true});await c.load();assert.deepEqual(events,['mfa']);
 const afterCode=loginGate();await afterCode.c.load();assert.deepEqual(afterCode.events,['password']);
 const firstEnrollment=loginGate({password:false,setup:true});await firstEnrollment.c.load();assert.deepEqual(firstEnrollment.events,['password','setup']);
});
test('session cleared during MFA lookup cannot reopen authentication UI',async()=>{
 const wait=deferred(),{c,events}=loginGate();c.twoStepNeeded=()=>wait.promise;
 const loading=c.load();await tick();c.sessionLoadEpoch++;wait.resolve(true);await loading;assert.deepEqual(events,[]);
});
test('a service action opened by another session cannot write or replace the current page',async()=>{
 let submit,calls=0;const wait=deferred(),{c,content}=fixture(['service-workflow.js']);c.actionForm=(title,fields,fn)=>{submit=fn;};c.inventoryProduct=()=>({name:'Machine'});c.client={rpc:()=>{calls++;return wait.promise;}};c.message=()=>{throw Error('Old action notified');};
 c.openServiceAction({id:'case',case_number:'S1',version:1},'start');c.me={user_id:'b'};await assert.rejects(submit({note:'Begin work'}),/workspace changed/);assert.equal(calls,0);
 c.openServiceAction({id:'case',case_number:'S1',version:1},'start');const pending=submit({note:'Begin work'});c.clearServiceWorkflow();content.innerHTML='Signed out';wait.resolve({data:{status:'in_progress'}});await pending;assert.equal(content.innerHTML,'Signed out');
});
test('editing a task without deadline approval retains exact original timestamp',async()=>{
 let submit,args;const {c}=fixture(['team-tasks.js']);c.me={user_id:'giver',role:'staff'};c.employeeDirectory=new Map();c.employeeName=()=>'';c.actionForm=(title,fields,fn)=>{submit=fn;};c.client={rpc:async(name,a)=>{args=a;return {data:{}}}};c.message=()=>{};vm.runInContext('teamTasksWorkspace=async()=>{}',c);
 const due='2026-10-19T13:23:45.123456+00:00';c.openTeamTaskEditor({id:'task',version:2,due_at:due,title:'Pack delivery',urgency:'normal'});await submit({title:'Pack revised order',urgency:'normal',due:'2026-10-19T13:23',assignee:'giver'});assert.equal(args.p_due_at,due);
});
