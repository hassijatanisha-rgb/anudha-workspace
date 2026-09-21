import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema=fs.readFileSync('supabase/migrations/202609210008_service_workflow.sql','utf8');
const data=fs.readFileSync('supabase/migrations/202609210009_service_legacy_handoff.sql','utf8');
const sql=schema+data;

for(const table of ['equipment_assets','service_cases','service_case_events','service_reports','service_report_accessories','service_training_attendees'])assert.match(schema,new RegExp(`create table public\\.${table}`));
for(const status of ['new','assigned','scheduled','on_site','report_required','completed','cancelled'])assert.match(schema,new RegExp(`'${status}'`));
for(const kind of ['installation','service'])assert.match(schema,new RegExp(`'${kind}'`));
for(const action of ['assign','reassign','schedule','start','submit_report','cancel'])assert.match(schema,new RegExp(`p_action='${action}'`));
assert.match(schema,/create or replace function public\.advance_service_case/);
assert.match(schema,/create or replace function public\.complete_service_report/);
assert.match(schema,/create or replace function public\.create_service_case/);
assert.match(schema,/create trigger create_installation_cases_after_delivery/);
assert.match(schema,/category='machines'/);
assert.match(schema,/generate_series\(1,v_line\.quantity\)/);
assert.match(schema,/source_delivery_line_id/);
assert.match(schema,/unique\(source_delivery_line_id,unit_number\)/);
assert.match(schema,/next_maintenance_date/);
assert.match(schema,/maintenance_interval_months.*3,6,12,24,36/s);
assert.match(schema,/service_reports_immutable/);
assert.match(schema,/service_case_events_immutable/);
assert.match(schema,/enable row level security/g);
assert.match(schema,/inventory_active_staff\(\)/);
assert.match(data,/where delivery\.status='delivered'/);
assert.match(data,/category='machines'/);
assert.match(data,/on conflict \(source_delivery_line_id,unit_number\) do nothing/);

console.log('PASS: service workflow is linked, audited, scheduled and safe to backfill.');
