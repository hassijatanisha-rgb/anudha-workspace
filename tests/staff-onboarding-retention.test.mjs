import {workspacePageHeader} from './helpers/page-header.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),record={user_id:'new-staff',role:'staff',active:true,phone:'',department:'sales',access:['records']};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const document=dom(),root=document.createElement('main');document.body.append(root);root.innerHTML='<header>Staff</header><div data-staff-directory><input id="search"><article>Existing person</article></div>';const directory=root.querySelector('[data-staff-directory]');directory.staffEpoch=1;directory.staffRows=[];let refreshed=0;directory.staffRefresh=()=>refreshed++;const calls=[];
 const c=vm.createContext({workspacePageHeader,document,busy:false,run:fn=>fn(),me:{user_id:'owner',role:'owner'},view:'staff',esc:s=>String(s??''),navigator:{clipboard:{writeText:async()=>{}}},config:{},window:{ERP_CONFIG:{staffLoginDomain:'staff.example.invalid'}},client:{functions:{invoke:async(name,args)=>{calls.push({name,args});return {data:{user_id:'new-staff',employee_id:'test.person',full_name:'Test Person',temporary_password:'FICTIONAL-TEST-ONLY',warnings:[]}};}},rpc:async(name,args)=>{calls.push({name,args});return {data:{user_id:'new-staff',display_name:'Test Person',name_version:1}};},from:table=>({select(columns){calls.push({table,columns});return this;},eq(key,id){calls.at(-1).eq=[key,id];return this;},single:async()=>({data:record})})},staff:()=>assert.fail('No full Staff reload')});
 const dialogs=installWorkspaceDialogFixture(c);
 for(const file of ['employee-names.js','staff-access.js','employee-login.js'])vm.runInContext(read(file),c);c.accessCheckboxes=()=>'';c.checkedAreas=()=>['records'];c.loadEmployeeNames=()=>assert.fail('No full directory name read');c.openStaffOnboarding();const dialog=document.querySelector('dialog'),form=dialog.querySelector('form');for(const [key,value]of Object.entries({fullName:'Test Person',phone:'',role:'staff',department:'sales'}))form.elements[key].value=value;
 return {c,dialogs,document,root,directory,dialog,form,calls,refreshed:()=>refreshed,save:()=>form.onsubmit({preventDefault(){},target:form})};
}
test('creation retains the credentials and Staff directory, adding only the scoped verified employee',async()=>{
 const f=fixture(),header=f.root.querySelector('header'),search=f.root.querySelector('#search');await f.save();assert.equal(f.root.querySelector('header'),header);assert.equal(f.root.querySelector('#search'),search);assert.equal(f.refreshed(),1,f.dialog.textContent);assert.equal(f.directory.staffRows[0].user_id,'new-staff');assert.equal(f.form.hidden,true);assert.equal(f.dialog.querySelector('[data-step="done"]').hidden,false);assert.match(f.dialog.textContent,/FICTIONAL-TEST-ONLY/);assert.match(f.dialog.textContent,/Employee list updated/);assert.deepEqual(f.calls.map(x=>x.name||x.table),['staff-accounts','staff','lookup_staff_display_name']);assert.deepEqual(f.calls[1].eq,['user_id','new-staff']);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args.body)),{action:'create',full_name:'Test Person',phone:'',role:'staff',department:'sales',access:['records']});await f.save();assert.equal(f.calls.filter(x=>x.name==='staff-accounts').length,1);
});
test('a failed directory read preserves the confirmed login notice and retries reads only',async()=>{
 const f=fixture();let failed=true;f.c.client.from=table=>({select(){f.calls.push({table});return this;},eq(){return this;},single:async()=>failed?{error:{message:'Offline'}}:{data:record}});await f.save();assert.match(f.dialog.textContent,/Login created.*could not refresh/);assert.doesNotMatch(f.dialog.textContent,/Not created/);assert.equal(f.refreshed(),0);assert.match(f.dialog.textContent,/FICTIONAL-TEST-ONLY/);failed=false;await f.dialog.querySelector('[data-created-staff-retry]').onclick();assert.equal(f.refreshed(),1,f.dialog.textContent);assert.equal(f.calls.filter(x=>x.name==='staff-accounts').length,1);
});
test('invalid employee or name receipts cannot enter the retained directory',async()=>{
 for(const variant of ['staff','name']){const f=fixture();if(variant==='staff')f.c.client.from=()=>({select(){return this;},eq(){return this;},single:async()=>({data:{...record,user_id:'wrong'}})});else f.c.client.rpc=async()=>({data:{user_id:'wrong',display_name:'Test Person',name_version:1}});await f.save();assert.equal(f.refreshed(),0);assert.equal(f.directory.staffRows.length,0);assert.match(f.dialog.textContent,/Login created.*could not refresh/);}
});
test('replacement actor suppresses credentials and reads from a late creation response',async()=>{
 const f=fixture(),wait=deferred();f.c.client.functions.invoke=()=>wait.promise;const pending=f.save();f.c.me={...f.c.me};wait.resolve({data:{user_id:'new-staff',employee_id:'test.person',full_name:'Test Person',temporary_password:'FICTIONAL-TEST-ONLY'}});await pending;assert.doesNotMatch(f.dialog.textContent,/FICTIONAL-TEST-ONLY/);assert.equal(f.calls.length,0);assert.equal(f.refreshed(),0);
});
test('changed session, route and directory suppress late directory refreshes',async()=>{
 for(const change of ['actor','route','epoch','detach'])for(const fail of [false,true]){const f=fixture(),wait=deferred();f.c.client.from=()=>({select(){return this;},eq(){return this;},single:()=>wait.promise});const pending=f.save();await new Promise(setImmediate);if(change==='actor')f.c.me={...f.c.me};else if(change==='route')f.c.view='personal';else if(change==='epoch')f.directory.staffEpoch++;else f.directory.remove();if(fail)wait.reject(Error('Old read'));else wait.resolve({data:record});await pending;assert.equal(f.refreshed(),0);assert.equal(f.directory.staffRows.length,0);}
});
