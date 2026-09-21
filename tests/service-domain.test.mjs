import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source=fs.readFileSync('service-domain.js','utf8');
const context={};
vm.createContext(context);
vm.runInContext(source,context);

assert.equal(context.serviceMaintenanceDate('2028-01-31',3),'2028-04-30');
assert.equal(context.serviceMaintenanceDate('2028-02-29',12),'2029-02-28');
assert.equal(context.serviceMaintenanceDate('2026-10-14',3),'2027-01-14');
assert.throws(()=>context.serviceMaintenanceDate('not-a-date',3),/valid work date/);
assert.throws(()=>context.serviceMaintenanceDate('2026-10-14',5),/supported maintenance interval/);

assert.deepEqual([...context.serviceNextActions('new')],['assign']);
assert.deepEqual([...context.serviceNextActions('assigned')],['schedule','reassign']);
assert.deepEqual([...context.serviceNextActions('scheduled')],['start','reassign']);
assert.deepEqual([...context.serviceNextActions('on_site')],['submit_report']);
assert.deepEqual([...context.serviceNextActions('completed')],[]);
assert.equal(context.serviceStatusLabel('report_required'),'Report required');
assert.equal(context.serviceStatusLabel('on_site'),'On site');

console.log('PASS: service dates and guarded next steps are deterministic.');
