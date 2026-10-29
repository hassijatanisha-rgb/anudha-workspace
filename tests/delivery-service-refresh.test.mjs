import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
function fixture(){
 const content={innerHTML:'2 installation jobs'},reads=[];
 let submit,finish;
 const response=new Promise(resolve=>{finish=resolve;});
 const c=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,me:{user_id:'actor'},view:'sales',esc:String,$:()=>content,
  document:{querySelectorAll:()=>[]},syncWorkspaceNavigation(){},message(){},
  actionForm(title,fields,callback){submit=callback;},
  all:async table=>{reads.push(table);return table==='service_cases'?Array.from({length:4},(_,i)=>({id:'case-'+i,case_type:'installation'})):[];},
  client:{rpc:()=>response,from:()=>({select(){return this;},order:async()=>({data:[]})})}});
 for(const file of ['sales-delivery.js','service-workflow.js'])vm.runInContext(read(file),c);
 const get=code=>vm.runInContext(code,c);
 get("serviceLoaded=true;serviceCases=[{id:'old-1'},{id:'old-2'}];salesDeliveryWorkspace=async()=>{};bindServiceWorkflow=()=>{};installationScreen=()=>serviceCases.length+' installation jobs';");
 c.openDeliveryAction({id:'delivery-2',version:4},'deliver');
 return {c,content,reads,get,submit:()=>submit({recipient:'Customer',proof:'Signed delivery'}),finish};
}
test('a signed second delivery reloads installation jobs on ordinary Service navigation',async()=>{
 const f=fixture(),saving=f.submit();f.finish({data:{status:'delivered'}});await saving;
 f.c.view='service';await f.c.serviceWorkspace();
 assert.equal(f.content.innerHTML,'4 installation jobs');assert.ok(f.reads.includes('service_cases'));
});
test('delivery completion refreshes Service when it was opened while the save was pending',async()=>{
 const f=fixture(),saving=f.submit();f.c.view='service';f.finish({data:{status:'delivered'}});await saving;
 assert.equal(f.content.innerHTML,'4 installation jobs');assert.equal(f.get('serviceLoaded'),true);
});
test('a rejected delivery keeps the cached installation jobs intact',async()=>{
 const f=fixture(),saving=f.submit();f.finish({error:new Error('Signed proof missing')});await assert.rejects(saving,/Signed proof missing/);
 assert.equal(f.get('serviceLoaded'),true);assert.equal(f.get('serviceCases.length'),2);assert.deepEqual(f.reads,[]);
});
test('a delivery response from the previous actor cannot invalidate the current Service cache',async()=>{
 const f=fixture(),saving=f.submit();f.c.me={user_id:'other'};f.finish({data:{status:'delivered'}});await saving;
 assert.equal(f.get('serviceLoaded'),true);assert.equal(f.get('serviceCases.length'),2);assert.deepEqual(f.reads,[]);
});
