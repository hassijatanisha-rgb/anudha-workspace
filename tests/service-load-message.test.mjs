import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../service-workflow.js',import.meta.url),'utf8');
function render(error){
 const context=vm.createContext({esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 vm.runInContext(source,context);
 context.fixtureError=error;
 return vm.runInContext('serviceLoadError=fixtureError;serviceUnavailable()',context);
}
for(const error of ['Failed to fetch','Permission denied','relation service_cases does not exist'])test(`service load failure does not prescribe unverified schema changes: ${error}`,()=>{
 const html=render(error);
 assert.match(html,/Unable to load service jobs/);
 assert.match(html,/Refresh list/);
 assert.doesNotMatch(html,/setup required|not been installed|must run migrations/i);
 assert.match(html,/contact an administrator/i);
});
test('service failure detail remains escaped',()=>{
 const html=render('<img src=x onerror=alert(1)>');
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/&lt;img/);
});
