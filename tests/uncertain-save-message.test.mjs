import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('function friendlyError('),end=source.indexOf("$('#editForm').onsubmit",start);
assert.ok(start>=0&&end>start);
function fixture(){const messages=[];const ctx=vm.createContext({busy:false,message:(text,error)=>messages.push({text,error})});vm.runInContext(source.slice(start,end),ctx);return {ctx,messages};}
test('lost write response does not claim rollback or encourage immediate duplicate submission',async()=>{
 const {ctx,messages}=fixture();let saved=false;
 await ctx.run(async()=>{saved=true;throw Object.assign(Error('response lost'),{name:'TimeoutError'});});
 assert.equal(saved,true);assert.equal(ctx.busy,false);assert.equal(messages[0].error,true);
 assert.doesNotMatch(messages[0].text,/nothing.*saved|not saved/i);
 assert.match(messages[0].text,/could not confirm/i);
 assert.match(messages[0].text,/check.*record.*before.*again/i);
});
test('network error variants preserve uncertainty and ordinary validation stays explicit',()=>{
 const {ctx}=fixture();
 for(const error of [{name:'AbortError'},Error('Failed to fetch'),Error('NetworkError'),Error('Load failed'),Error('Connection problem')]){
  assert.match(ctx.friendlyError(error),/could not confirm/i);
 }
 assert.equal(ctx.friendlyError(Error('Choose a valid machine.')),'Choose a valid machine.');
});
