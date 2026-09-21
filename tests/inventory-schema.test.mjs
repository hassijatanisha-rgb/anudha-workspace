import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/202609210001_inventory_foundation.sql','utf8');
for(const name of ['inventory_locations','product_pack_definitions','inventory_lots','inventory_transfers','inventory_movements','inventory_issues']){
 assert.match(sql,new RegExp(`create table public\\.${name}`,'i'),`${name} must be versioned in the live schema`);
 assert.match(sql,new RegExp(`alter table public\\.${name} enable row level security`,'i'),`${name} must use RLS`);
}
for(const rpc of ['save_inventory_location','save_pack_definition','set_inventory_opening_balance','request_inventory_transfer','dispatch_inventory_transfer','receive_inventory_transfer','open_inventory_cartons','issue_consumer_units']){
 assert.match(sql,new RegExp(`create or replace function public\\.${rpc}`,'i'),`${rpc} RPC is required`);
}
assert.match(sql,/actual_units\s*<>\s*v_transfer\.expected_units[\s\S]*quarantine/i);
assert.match(sql,/is_dispatch_hub\s*=\s*true/i);
assert.match(sql,/sealed_cartons\s*=\s*sealed_cartons\s*-\s*p_cartons/i);
assert.match(sql,/loose_units\s*=\s*loose_units\s*\+\s*v_units/i);
assert.match(sql,/pack definitions are immutable/i);
assert.match(sql,/inventory movements are immutable/i);
console.log('PASS: inventory migration defines secure locations, packs, transfers, receiving and Haadi carton opening.');
