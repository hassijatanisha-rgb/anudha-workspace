import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('sign-out clears every private dialog, not just the static contact editor',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').split('\n').find(line=>line.startsWith('function clear()'));
 const fixed={id:'editor',closed:false,close(){this.closed=true}},privateDialog={id:'',closed:false,removed:false,close(){this.closed=true},remove(){this.removed=true}};
 const nodes={'#nav':{},'#identity':{},'#editor':fixed,'#fields':{}};
 const ctx=vm.createContext({organizations:[],contacts:[],products:[],duplicates:new Map(),me:{role:'owner'},$:id=>nodes[id],document:{querySelectorAll:()=>[fixed,privateDialog]}});
 vm.runInContext(readFileSync(new URL('../employee-names.js',import.meta.url),'utf8'),ctx);
 vm.runInContext("employeeDirectory.set('old-person',{display_name:'Old session name'})",ctx);
 vm.runInContext(source,ctx);ctx.clear();
 assert.equal(ctx.employeeName('old-person'),'Employee name not set');
 assert.equal(privateDialog.closed,true);assert.equal(privateDialog.removed,true);assert.equal(fixed.closed,true);assert.equal(ctx.me,null);
});
