import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('inventory-operations.js','utf8');

assert.match(source,/inventoryProductChoice/,'Product selection should use a searchable human-readable choice.');
assert.match(source,/list="inventoryProductChoices"/,'The carton form should provide searchable product suggestions.');
assert.match(source,/data-inventory-action="correct"/,'Owners should be able to record a corrected physical count.');
assert.match(source,/inventory_movements/,'The workspace should load its immutable stock movement ledger.');
assert.match(source,/Recent stock activity/,'Staff should be able to read the inventory audit trail.');
assert.match(source,/Items issued to clients/,'Staff should be able to see recent consumer-item issues.');
assert.match(source,/Setup progress/,'The empty inventory should explain what data must be entered next.');

console.log('PASS: inventory entry supports search, count correction, setup guidance, and audit history.');
