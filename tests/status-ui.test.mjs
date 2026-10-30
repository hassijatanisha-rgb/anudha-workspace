import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../status-ui.js',import.meta.url),'utf8'),ctx);
test('status tones distinguish problems, waiting, finished work and work in progress',()=>{
 for(const [status,tone] of Object.entries({overdue:'danger',out_of_stock:'danger',refused:'danger',invoice_pending:'warning',low_stock:'warning',in_stock:'success',paid:'success',installed:'success',reserved:'info',packing:'info',not_counted:'neutral',draft:'neutral',archived:'neutral'}))assert.equal(ctx.statusTone(status),tone,status);
});
test('unknown and ambiguous domain states cannot inject a class or acquire a misleading tone',()=>{
 for(const value of ['closed','accepted','new','__proto__','constructor','danger onclick="bad"',null,undefined])assert.equal(ctx.statusTone(value),'neutral');
 for(const value of ['danger','warning','success','info','neutral'])assert.equal(ctx.statusTone(value),value);
});
