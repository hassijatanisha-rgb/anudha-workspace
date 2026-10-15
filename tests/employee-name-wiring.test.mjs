import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('directory loads before workspace and clears on sign-out',()=>{const s=read('app.js');assert.match(s,/await loadEmployeeNames\(\)/);assert.match(s,/function clear\(\)\{clearEmployeeNames\(\)/);assert.doesNotMatch(s,/esc\(x\.user_id\)/);});
test('employee history and assignments resolve names, not UUID fragments',()=>{assert.match(read('sales-delivery.js'),/employeeName\(event.actor_user_id\)/);assert.match(read('service-workflow.js'),/employeeName\(row.actor_user_id\)/);assert.match(read('service-workflow.js'),/employeeName\(id\)/);});
test('name resolver is loaded in the application',()=>{assert.match(read('index.src.html'),/src="employee-names\.js/);});
