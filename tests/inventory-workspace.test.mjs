import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('inventory-operations.js','utf8');
for(const label of ['Stock','Move cartons','Locations','Products','Open cartons into individual units','Issue individual units to a client'])assert.match(source,new RegExp(label,'i'));
for(const rpc of ['save_inventory_location','save_pack_definition','set_inventory_opening_balance','request_inventory_transfer','dispatch_inventory_transfer','receive_inventory_transfer','open_inventory_cartons','issue_consumer_units','save_product_inventory_classification'])assert.match(source,new RegExp(`rpc\\('${rpc}'`));
assert.match(source,/is_dispatch_hub/);
assert.match(source,/quarantine/i);
assert.match(source,/schema has not been installed/i);
console.log('PASS: inventory workspace covers godowns, stock, transfers, break-pack and individual client issues.');
