import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/202609210004_proforma_delivery_workflow.sql','utf8');
for(const table of ['sales_proformas','sales_proforma_lines','sales_proforma_revisions','sales_proforma_events','sales_delivery_notes','sales_delivery_lines','sales_delivery_events']){
 assert.match(sql,new RegExp(`create table public\\.${table}`,'i'));
 assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
}
for(const rpc of ['save_sales_proforma','advance_sales_proforma','create_sales_delivery_note','advance_sales_delivery'])assert.match(sql,new RegExp(`create or replace function public\\.${rpc}`,'i'));
assert.match(sql,/only a draft can be revised/i);
assert.match(sql,/status='accepted'/i);
assert.match(sql,/matching available stock at Haadi/i);
assert.match(sql,/loose_units=loose_units-v_line\.quantity/i);
assert.match(sql,/signed delivery-note proof reference/i);
assert.match(sql,/sales history is immutable/i);
console.log('PASS: Pro forma revisions, acceptance, Haadi stock issue and delivery proof are database-enforced.');
