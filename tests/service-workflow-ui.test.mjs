import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('index.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const source=fs.readFileSync('service-domain.js','utf8')+fs.readFileSync('service-workflow.js','utf8');
const css=fs.readFileSync('style.css','utf8');

assert.match(html,/data-view="service">Service &amp; installation/);
assert.match(html,/service-domain\.js/);
assert.match(html,/service-workflow\.js/);
assert.match(app,/view==='service'.*serviceWorkspace/);
assert.match(source,/Installations/);
assert.match(source,/Service schedule/);
assert.match(source,/New/);
assert.match(source,/Assigned/);
assert.match(source,/Scheduled/);
assert.match(source,/On site/);
assert.match(source,/Report required/);
assert.match(source,/Completed/);
assert.match(source,/advance_service_case/);
assert.match(source,/complete_service_report/);
assert.match(source,/create_service_case/);
assert.match(source,/function serviceContactOptions\(organizationId/);
assert.match(source,/asset\.organization_id===contact\.organization_id/);
assert.match(source,/Serial number/);
assert.match(source,/Training attendees/);
assert.match(source,/QC training/);
assert.match(source,/Service charge/);
assert.match(source,/Print official report/);
assert.match(source,/equipment-handover-installation-report\.pdf/);
assert.match(source,/service-work-report\.pdf/);
assert.match(css,/@page\{size:A4 portrait/);
assert.match(css,/service-report-print/);
assert.doesNotMatch(source,/dispatched/i);

console.log('PASS: service workspace exposes the complete plain-language workflow and printable official reports.');
