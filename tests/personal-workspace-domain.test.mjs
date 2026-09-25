import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../personal-workspace-domain.js',import.meta.url),'utf8'),context);
test('Open urgent tasks precede normal tasks and completed tasks',()=>{
 const rows=[{id:'normal',priority:'normal',completed:false},{id:'done',priority:'urgent',completed:true},{id:'urgent',priority:'urgent',completed:false}];
 assert.equal(context.personalTaskOrder(rows).map(r=>r.id).join(','),'urgent,normal,done');
 assert.equal(rows[0].id,'normal');
});
test('Reminder list excludes deleted, completed and future entries',()=>{
 const now='2026-09-22T12:00:00Z';
 const base={remind_at:'2026-09-22T11:00:00Z'};
 assert.equal(context.personalDueReminders([{...base,id:1},{...base,id:2,completed:true},{...base,id:3,deleted_at:now},{...base,id:4,remind_at:'2026-09-23T00:00:00Z'}],now).length,1);
});
test('Validate events and refuse company notes',()=>{
 assert.throws(()=>context.validatePersonalEntry({kind:'note',visibility:'company',title:'x'}),/company/i);
 assert.throws(()=>context.validatePersonalEntry({kind:'event',visibility:'personal',title:'x',starts_at:'2026-09-22T12:00Z',ends_at:'2026-09-22T11:00Z'}),/end/i);
 assert.doesNotThrow(()=>context.validatePersonalEntry({kind:'task',visibility:'personal',title:'Call customer'}));
});
test('Calendar month includes leap day and Monday-first leading blanks',()=>{
 const feb=context.personalMonthDays('2024-02');
 assert.equal(feb.filter(Boolean).length,29);
 assert.equal(feb.indexOf('2024-02-01'),3);
 assert.throws(()=>context.personalMonthDays('2026-13'),/month/i);
});
