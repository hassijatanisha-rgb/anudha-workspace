import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../personal-workspace.js',import.meta.url),'utf8');
test('Late private response cannot render after the login changes',async()=>{
 let release;const target={innerHTML:''};const calls=[];
 const query={};for(const method of ['select','eq','is','order','gte','lt'])query[method]=(...args)=>{calls.push([method,...args]);return query};
 query.range=(...args)=>{calls.push(['range',...args]);return new Promise(resolve=>release=resolve)};
 const context=vm.createContext({$:()=>target,me:{user_id:'one'},view:'personal',client:{from:()=>query}});
 vm.runInContext(source,context);
 const pending=vm.runInContext('personalWorkspace()',context);
 context.me={user_id:'two'};
 release({data:[{title:'Private note'}]});await pending;
 assert.ok(!target.innerHTML.includes('Private note'));
 assert.deepEqual(calls.find(row=>row[0]==='range'),['range',0,99]);
});
test('Company and private event cards carry distinct labels and styles',()=>{
 const context=vm.createContext({me:{user_id:'one',role:'staff'},esc:s=>String(s??'').replaceAll('<','&lt;')});
 vm.runInContext(source,context);
 const company=context.personalCard({id:'x',title:'Meeting',visibility:'company',owner_id:'other'});
 const personal=context.personalCard({id:'y',title:'<private>',visibility:'personal',owner_id:'one'});
 assert.match(company,/company-event/);assert.match(company,/Company event \/ meeting/);
 assert.ok(!company.includes('data-personal-edit'));
 assert.match(personal,/personal-event/);assert.match(personal,/Personal · only you/);
 assert.ok(!personal.includes('<private>'));
});
test('A save finishing after login changes does not refresh or notify the new user',async()=>{
 let submit,resolveSave;let refreshes=0,notifications=0;
 const context=vm.createContext({
  me:{user_id:'one',role:'staff'},view:'personal',esc:s=>String(s??''),
  crypto:{randomUUID:()=> 'entry-one'},
  actionForm:(_title,_fields,callback)=>{submit=callback},
  validatePersonalEntry:row=>row,
  client:{rpc:()=>new Promise(resolve=>resolveSave=resolve)},
  message:()=>notifications++
 });
 vm.runInContext(source,context);
 context.personalWorkspace=async()=>{refreshes++};
 vm.runInContext("personalSection='task'; personalEditor(null,0,'one')",context);
 const saving=submit({title:'Call',priority:'normal'});
 context.me={user_id:'two',role:'staff'};
 resolveSave({error:null});await saving;
 assert.equal(refreshes,0);
 assert.equal(notifications,0);
});
