import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],summary={focus:()=>calls.push('focus-account'),setAttribute(){}},panel={hidden:false,style:{},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),animate:()=>({finished:Promise.resolve(),cancel(){}})};summary.getBoundingClientRect=panel.getBoundingClientRect;
 const document=dom(),content=document.createElement('section');content.setAttribute('id','content');document.body.append(content);
 document.addEventListener=()=>{};document.getElementById=()=>null;
 const nodes={'#content':content,'#nav':{},'#staffNav':{},'#identity':{innerHTML:''},'#accountMenu':{open:true,isConnected:true,querySelector:selector=>selector==='summary'?summary:panel},'#changePassword':{},'#howToUse':{}};
 const ctx=vm.createContext({workspacePageHeader,sessionLoadEpoch:0,message(){},view:'dashboard',listsLoading:null,selected:'selected',me:null,
  client:{auth:{getUser:async()=>({data:{user:{id:'actor'}}})}},loadMyStaffRow:async()=>({data:{user_id:'actor',role:'owner',active:true}}),
  loadEmployeeNames:async()=>{},loadLists:()=>Promise.resolve(true),render:async()=>{},employeeName:()=>`Amina <script> & "Admin"`,
  esc:value=>String(value).replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';'),$:selector=>nodes[selector],document,
  getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>key==='--m-fade'?'150ms':key==='--m-menu'?'120ms':key==='--m-fast'?'100ms':'ease-out'}),matchMedia:()=>({matches:false}),run:task=>task(),openChangePassword:()=>calls.push('password'),openHowToUse:()=>calls.push('help')});
 vm.runInContext(readFileSync(new URL('../ui-motion.js',import.meta.url),'utf8'),ctx);
 vm.runInContext('function workspaceSkeleton(kind,label)'+workspace.split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);
 vm.runInContext(source.split('\n').filter(line=>line.startsWith('async function load(){')||line.startsWith('function workspaceUsesSharedLists(){')||line.startsWith('function workspaceLoadFailure(')).join('\n'),ctx);
 return {ctx,nodes,calls};
}
test('signed-in account actions remain available in a closed native disclosure and escape the employee name',async()=>{
 const {ctx,nodes,calls}=fixture();await ctx.load();
 const html=nodes['#identity'].innerHTML;
 assert.match(html,/<button id="howToUse"[^>]*>How to use<\/button><details id="accountMenu" class="account-menu">/);
 assert.match(html,/<summary aria-label="Account options for Amina &#60;script&#62; &#38; &#34;Admin&#34;">/);
 assert.match(html,/<span class="identity-name">Amina &#60;script&#62; &#38; &#34;Admin&#34;<\/span>/);
 assert.match(html,/<div class="account-menu-actions"><button type="button" data-view="settings">My settings<\/button><button id="changePassword" type="button">Change password<\/button><button id="logout" type="button">Sign out<\/button><\/div><\/details>/);
 assert.doesNotMatch(html,/<script>|<details[^>]*\sopen(?:\s|>)/);
 await nodes['#changePassword'].onclick();nodes['#howToUse'].onclick();assert.deepEqual(calls,['password','help']);
});
test('Escape closes the account disclosure and restores summary focus; selecting an action closes it without stealing focus',async()=>{
 const {ctx,nodes,calls}=fixture();await ctx.load();
 const menu=nodes['#accountMenu'];let prevented=0;
 menu.onkeydown({key:'Enter',currentTarget:menu,preventDefault:()=>prevented++});assert.equal(menu.open,true);
 menu.onkeydown({key:'Escape',currentTarget:menu,preventDefault:()=>prevented++});
 await new Promise(setImmediate);assert.equal(menu.open,false);assert.equal(prevented,1);assert.deepEqual(calls,['focus-account']);
 menu.onkeydown({key:'Escape',currentTarget:menu,preventDefault:()=>prevented++});assert.equal(prevented,1);
 await menu.querySelector('summary').onclick({preventDefault(){}});menu.onclick({target:{closest:()=>null},currentTarget:menu});assert.equal(menu.open,true);
 menu.onclick({target:{closest:()=>({id:'changePassword'})},currentTarget:menu});await new Promise(setImmediate);assert.equal(menu.open,false);assert.deepEqual(calls,['focus-account']);
});
