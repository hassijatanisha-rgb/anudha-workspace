import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],summary={focus:()=>calls.push('focus-account')};
 const nodes={'#nav':{},'#staffNav':{},'#identity':{innerHTML:''},'#accountMenu':{open:true,querySelector:selector=>selector==='summary'?summary:null},'#changePassword':{},'#howToUse':{}};
 const ctx=vm.createContext({sessionLoadEpoch:0,message(){},view:'dashboard',listsLoading:null,selected:'selected',me:null,
  client:{auth:{getUser:async()=>({data:{user:{id:'actor'}}})}},loadMyStaffRow:async()=>({data:{user_id:'actor',role:'owner',active:true}}),
  loadEmployeeNames:async()=>{},loadLists:()=>Promise.resolve(true),render:async()=>{},employeeName:()=>`Amina <script> & "Admin"`,
  esc:value=>String(value).replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';'),$:selector=>nodes[selector],document:{querySelectorAll:()=>[]},
  run:task=>task(),openChangePassword:()=>calls.push('password'),openHowToUse:()=>calls.push('help')});
 vm.runInContext(source.split('\n').find(line=>line.startsWith('async function load(){')),ctx);
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
 assert.equal(menu.open,false);assert.equal(prevented,1);assert.deepEqual(calls,['focus-account']);
 menu.onkeydown({key:'Escape',currentTarget:menu,preventDefault:()=>prevented++});assert.equal(prevented,1);
 menu.open=true;menu.onclick({target:{closest:()=>null},currentTarget:menu});assert.equal(menu.open,true);
 menu.onclick({target:{closest:()=>({id:'changePassword'})},currentTarget:menu});assert.equal(menu.open,false);assert.deepEqual(calls,['focus-account']);
});
