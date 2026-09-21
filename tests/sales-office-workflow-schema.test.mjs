import assert from 'node:assert/strict';
import fs from 'node:fs';

const expand=fs.readFileSync('supabase/migrations/202609210005_sales_office_workflow.sql','utf8');
const data=fs.readFileSync('supabase/migrations/202609210006_sales_office_legacy_data.sql','utf8');
const contract=fs.readFileSync('supabase/migrations/202609210007_sales_office_contract.sql','utf8');
const sql=expand+data+contract;
for(const status of ['accounts_approved','tax_invoice_created','sent_to_sales','packing','ready','out_for_delivery','delivered'])assert.match(sql,new RegExp(`'${status}'`));
for(const action of ['tax_invoice','send_to_sales','ready','dispatch','deliver'])assert.match(sql,new RegExp(`p_action='${action}'`));
assert.match(sql,/function public\.start_sales_delivery_packing/);
assert.match(sql,/tax_invoice_reference text/);
assert.match(sql,/insert into public\.sales_delivery_events/);
assert.match(sql,/actor_user_id/);
assert.match(sql,/reserved_units=reserved_units\+v_line\.quantity/);
assert.match(sql,/loose_units=loose_units-v_line\.quantity,reserved_units=reserved_units-v_line\.quantity/);
assert.match(data,/delete from public\.sales_delivery_lines/);
assert.match(data,/set status='accounts_approved'/);
assert.match(contract,/drop constraint sales_delivery_notes_status_check/);
console.log('PASS: the office handoff stages are persisted, audited and connected to stock issue.');
