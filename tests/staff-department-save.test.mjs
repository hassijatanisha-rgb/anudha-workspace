import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../employee-login.js',import.meta.url),'utf8');
const run=readFileSync(new URL('../app.js',import.meta.url),'utf8').split('\n').find(line=>line.startsWith('async function run(fn)'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
 const rows=[{user_id:'first',role:'head',department:''},{user_id:'second',role:'head',department:'sales'}],calls=[],messages=[],pending=[];
 let filtered=0;const search={oninput:()=>filtered++},directory={querySelector:()=>search};
 const entries=rows.map(()=>({dataset:{},closest:()=>directory})),statuses=rows.map(()=>({textContent:'',classList:{toggle(){}}}));
 const selects=rows.map((row,index)=>({dataset:{staffDepartment:row.user_id},value:row.department,disabled:false,isConnected:true,parentElement:{querySelector:()=>statuses[index]},closest:()=>entries[index]}));
 const ctx=vm.createContext({busy:false,me:{user_id:'owner',role:'owner'},
  document:{querySelectorAll:selector=>selector==='[data-staff-department]'?selects:[]},
  employeeName:id=>id,roleLabels:{head:'Department head'},departmentLabel:key=>({stores:'Stores & delivery',sales:'Sales',service:'Service'})[key]||'No department',message:(text,error=false)=>messages.push({text,error}),friendlyError:error=>error.message,replayQueuedNavigation(){},
  client:{rpc:(name,args)=>{calls.push({name,args});const wait=deferred();pending.push(wait);return wait.promise;}}});
 vm.runInContext(source+'\n'+run,ctx);ctx.bindStaffList(rows);
 const change=(index,value)=>{selects[index].value=value;return selects[index].onchange();};
 return {ctx,rows,selects,statuses,entries,calls,messages,pending,change,filtered:()=>filtered};
}

test('a second department change while saving is visibly restored and can be retried',async()=>{
 const f=fixture(),first=f.change(0,'stores');
 assert.equal(f.selects[0].disabled,true);assert.equal(f.selects[1].disabled,false);assert.equal(f.statuses[0].textContent,'Saving…');
 await f.change(1,'service');
 assert.equal(f.calls.length,1);assert.equal(f.selects[1].value,'sales');assert.equal(f.rows[1].department,'sales');
 assert.match(f.messages.at(-1).text,/still saving.*try/i);assert.equal(f.messages.at(-1).error,true);
 assert.match(f.statuses[1].textContent,/Not saved/);
 f.pending[0].resolve({data:{department:'stores'}});await first;
 assert.equal(f.selects[0].disabled,false);assert.equal(f.rows[0].department,'stores');
 assert.equal(f.statuses[0].textContent,'Saved');assert.match(f.statuses[1].textContent,/Not saved/,'another row finishing does not erase the retry message');
 const retry=f.change(1,'service');f.pending[1].resolve({data:{department:'service'}});await retry;
 assert.equal(f.rows[1].department,'service');assert.equal(f.selects[1].value,'service');assert.equal(f.selects[1].disabled,false);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[
  {name:'set_staff_department',args:{p_user_id:'first',p_department:'stores'}},
  {name:'set_staff_department',args:{p_user_id:'second',p_department:'service'}}]);
});

test('failed department requests restore the saved selection and show the server or connection error',async()=>{
 for(const rejected of [false,true]){
  const f=fixture(),save=f.change(1,'accounts');
  if(rejected)f.pending[0].reject(Error('Connection failed'));else f.pending[0].resolve({error:{message:'Owner access required'}});
  await save;
  assert.equal(f.selects[1].value,'sales');assert.equal(f.rows[1].department,'sales');assert.equal(f.selects[1].disabled,false);
  assert.equal(f.messages.at(-1).text,rejected?'Connection failed':'Owner access required');assert.equal(f.messages.at(-1).error,true);
  assert.equal(f.statuses[1].textContent,f.messages.at(-1).text);
 }
});

test('a successful department save updates searchable text and reapplies the current filter',async()=>{
 const f=fixture(),save=f.change(1,'stores');f.pending[0].resolve({data:{department:'stores'}});await save;
 assert.match(f.entries[1].dataset.staffSearchValue,/stores & delivery/);
 assert.doesNotMatch(f.entries[1].dataset.staffSearchValue,/sales/);assert.equal(f.filtered(),1);
 const failed=f.change(1,'service');f.pending[1].resolve({error:{message:'Not saved'}});await failed;
 assert.match(f.entries[1].dataset.staffSearchValue,/stores & delivery/);assert.equal(f.filtered(),1);
});

test('a later rejected or busy change restores the latest successfully saved department',async()=>{
 const f=fixture(),saved=f.change(0,'stores');f.pending[0].resolve({data:{department:'stores'}});await saved;
 const failed=f.change(0,'service');f.pending[1].resolve({error:{message:'Not saved'}});await failed;
 assert.equal(f.selects[0].value,'stores');assert.equal(f.rows[0].department,'stores');
 f.ctx.busy=true;await f.change(0,'accounts');
 assert.equal(f.calls.length,2);assert.equal(f.selects[0].value,'stores');assert.equal(f.rows[0].department,'stores');
});

test('department responses do not update a replacement session or detached staff control',async()=>{
 for(const replacement of ['same-user-session','detached'])for(const rejected of [false,true]){
  const f=fixture(),save=f.change(0,'stores');
  if(replacement==='same-user-session')f.ctx.me={user_id:'owner',role:'owner'};else f.selects[0].isConnected=false;
  if(rejected)f.pending[0].reject(Error('Late failure'));else f.pending[0].resolve({data:{department:'stores'}});
  await save;
  assert.equal(f.rows[0].department,'');assert.equal(f.messages.length,0);assert.equal(f.ctx.busy,false);
 }
});
