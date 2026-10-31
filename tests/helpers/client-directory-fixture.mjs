import {workspacePageHeader} from './page-header.mjs';
import {statusTone} from './status-ui.mjs';
import {installLeaveContext} from './leave-context.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
export const source=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
export const plain=value=>JSON.parse(JSON.stringify(value));
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
export function directoryRows(count=1073){
 const organizations=[],contacts=[];
 for(let n=1;n<=count;n++){
  const id='o'+String(n).padStart(5,'0'),branch='b'+String(n).padStart(5,'0');
  organizations.push({id,name:'Client '+String(n).padStart(5,'0'),location:'Dar es Salaam',type:'Hospital',parent_id:null,approval_status:n%2?'review':'approved'});
  organizations.push({id:branch,name:'Branch '+n,location:n%2?'Arusha':'Mwanza',type:'Clinic',parent_id:id,approval_status:'review'});
  contacts.push({id:'c'+n,organization_id:branch,title:'Mr.',first_name:n%9?'Asha':'asha',last_name:'Mushi',position:n%11?'Lab':'',phone_country:'TZ',country_code:'+255',phone:'71'+String(n).padStart(7,'0'),email:'',status:n%13?'kept':'review',revision:5,reason:'Private review note',source:{private:'Not part of a directory'}});
  if(n%10===0)contacts.push({...contacts.at(-1),id:'duplicate'+n,first_name:'Different',email:'duplicate@example.test'});
 }
 const change=(list,index,values)=>{if(list[index])Object.assign(list[index],values);};
 change(organizations,0,{name:'École D’À Côté'});change(organizations,2,{name:''});change(organizations,4,{name:'lower case'});
 change(contacts,0,{first_name:'Élodie'});change(contacts,1,{first_name:'李'});change(contacts,2,{phone:'123456789'});change(contacts,3,{phone_country:'XX'});
 change(contacts,4,{phone_country:'US',country_code:'+1',phone:'2025550123'});
 change(contacts,5,{email:'Bad email'});change(contacts,6,{status:'incorrect',phone:'999000777'});
 return {organizations,contacts};
}
export function directoryFixture({rows=directoryRows(2),rpc=null,hash='#/clients'}={}){
 const nodes=new Map(),events={},reads=[],errors=[],opened=[],actor={user_id:'staff',role:'staff',active:true};let contentHtml='';
 const node=id=>({id,isConnected:true,innerHTML:'',textContent:'',hidden:false,dataset:{},addEventListener(){},querySelector:()=>null,focus(){},showModal(){},close(){}});
 const content=node('content');content.firstElementChild=null;Object.defineProperty(content,'innerHTML',{get:()=>contentHtml,set:value=>{contentHtml=value;if(content.firstElementChild)content.firstElementChild.isConnected=false;content.firstElementChild=/^\s*</.test(value)?{isConnected:true,matches:selector=>selector==='.workspace-skeleton'&&value.startsWith('<section class="workspace-skeleton ')}:null;for(const [id,item] of nodes)if(item.content){item.isConnected=false;nodes.delete(id);}for(const [,id] of value.matchAll(/id="([^"]+)"/g))nodes.set('#'+id,{...node(id),content:true});}});nodes.set('#content',content);
 for(const id of ['editForm','editor','closeEditor','notice','fields','nav','identity','staffNav','accountMenu','changePassword','howToUse'])nodes.set('#'+id,node(id));
 const document={querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],addEventListener:(name,fn)=>(events[name]??=[]).push(fn)};
 const ctx=vm.createContext({workspacePageHeader,statusTone,console,Intl,Map,Set,crypto:globalThis.crypto,setTimeout,clearTimeout,document,location:{hash},history:{},window:{addEventListener(){}},
  bindWorkspaceAccountMenu(){},employeeName:()=> 'Employee',canEditRecords:()=>true,recordsLockedNote:()=>'',syncWorkspaceNavigation(){},loadEmployeeNames:async()=>{reads.push('common.staff-directory');},loadMyStaffRow:async()=>{reads.push('common.staff');return {data:actor};},twoStepSetupRequired:async()=>{reads.push('common.two-step');return false;},showAccountingNavigation:()=>{reads.push('common.accounting');},applyAccessNavigation(){},workspaceLoading:label=>{content.innerHTML='<p>'+label+'</p>';},
  openOrganizationForm:()=>opened.push('organization'),openDeleteRecord:(kind,id)=>opened.push([kind,id]),listCacheWrite:()=>{throw Error('Directory must not write the shared cache');},
  renderSearchPreservingPosition:(_,fn)=>fn(),dashboardWorkspace:()=>{content.innerHTML='Dashboard';}
 });
 vm.runInContext(source('phone-rules.js')+'\n'+source('client-rules.js'),ctx);
 const workspace=source('workspace-refresh.js');
 vm.runInContext('function workspaceRefreshScope()'+workspace.split('function workspaceRefreshScope()')[1].split('function workspaceRefreshReference')[0]+'function workspaceSkeletonKind()'+workspace.split('function workspaceSkeletonKind()')[1].split('function workspaceLoading')[0],ctx);
 vm.runInContext(source('app.js').split('\n').filter(line=>!line.startsWith('(async()=>{const cfg=')).join('\n'),ctx);
 installLeaveContext(ctx);
 vm.runInContext(source('client-profile-pages.js'),ctx);
 ctx.fixtureClient={auth:{getUser:async()=>({data:{user:{id:actor.user_id}}})},rpc:async name=>{reads.push(name);return rpc?rpc(name):{data:plain(rows)};},from:()=>{throw Error('Unexpected full table read');}};
 ctx.fixtureActor=actor;ctx.loadMyStaffRow=async()=>{reads.push('common.staff');return {data:actor};};
 const run=code=>vm.runInContext(code,ctx);run('client=fixtureClient;me=fixtureActor;syncWorkspaceNavigation=()=>{};');
 // A real navigation emits one summary read; transport is outside this fixture.
 ctx.bellRead=()=>reads.push('common.notification');run('syncWorkspaceNavigation=()=>bellRead()');
 run('message=(text,error)=>{if(error)fixtureErrors.push(text)}');ctx.fixtureErrors=errors;
 return {ctx,run,nodes,events,reads,errors,content,opened,actor,rows,
  async click(properties){const button={...node(''),...properties};button.closest=selector=>selector==='button'||selector==='[data-profile-tab]'&&button.dataset.profileTab?button:null;for(const handler of events.click||[])await handler({target:button});await tick();return button;}
 };
}
