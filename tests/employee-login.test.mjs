import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(lookup=()=>null){
 const calls=[];
 const ctx=vm.createContext({window:{ERP_CONFIG:{staffLoginDomain:'staff.anudha.com'}},crypto:globalThis.crypto,Uint8Array,
  client:{rpc:async(name,args)=>{calls.push([name,args]);return {data:lookup(args.p_email)}}}});
 vm.runInContext(readFileSync(new URL('../employee-login.js',import.meta.url),'utf8'),ctx);
 return {ctx,calls};
}
test('employee ID signs in with the staff login domain; emails pass through',()=>{
 const {ctx}=load();
 assert.equal(ctx.employeeLoginEmail(' Jagroop '),'jagroop@staff.anudha.com');
 assert.equal(ctx.employeeLoginEmail('nisa.k'),'nisa.k@staff.anudha.com');
 assert.equal(ctx.employeeLoginEmail(' Owner@Example.com '),'owner@example.com');
 for(const bad of ['','a','has space','bad..dots','.lead','x'.repeat(41),'<script>'])assert.throws(()=>ctx.employeeLoginEmail(bad),/employee ID/);
});
test('IDs come from the name: first name, then last initial, full last name, then numbers',()=>{
 const {ctx}=load();
 assert.deepEqual([...ctx.employeeIdCandidates('Jagroop Singh')].slice(0,4),['jagroop','jagroop.s','jagroop.singh','jagroop.singh2']);
 assert.deepEqual([...ctx.employeeIdCandidates('  Anurag  ')].slice(0,2),['anurag','anurag2']);
 assert.equal(ctx.employeeIdCandidates('José Ñúñez')[0],'jose');
 assert.equal(ctx.employeeIdCandidates('   ').length,0);
});
test('suggestion skips IDs that already belong to a staff login',async()=>{
 const taken=new Set(['jagroop@staff.anudha.com','jagroop.s@staff.anudha.com']);
 const {ctx,calls}=load(email=>taken.has(email)?{user_id:'existing',name_version:1}:null);
 assert.equal(await ctx.suggestEmployeeId('Jagroop Sandhu'),'jagroop.sandhu');
 assert.deepEqual(calls.map(c=>c[1].p_email),['jagroop@staff.anudha.com','jagroop.s@staff.anudha.com','jagroop.sandhu@staff.anudha.com']);
});
test('lookup errors stop the suggestion instead of reusing a possibly taken ID',async()=>{
 const ctx=load().ctx;ctx.client={rpc:async()=>({error:{message:'Owner access required'}})};
 await assert.rejects(ctx.suggestEmployeeId('Ayaz Khan'),/Owner access required/);
});
test('temporary passwords are 14 unambiguous characters and differ',()=>{
 const {ctx}=load(),a=ctx.employeeTemporaryPassword(),b=ctx.employeeTemporaryPassword();
 assert.match(a,/^[A-HJ-NP-Za-km-z2-9]{14}$/);assert.notEqual(a,b);
});
test('login form, identity bar and staff page are wired to employee login',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(app,/signInWithPassword\(\{email:employeeLoginEmail\(/);assert.match(app,/Employee ID or work email/);
 assert.match(app,/openChangePassword\(\)/);assert.match(app,/openStaffOnboarding\(\)/);
 assert.ok(html.indexOf('employee-login.js')>html.indexOf('employee-names.js')&&html.indexOf('employee-login.js')<html.indexOf('app.js'));
});
