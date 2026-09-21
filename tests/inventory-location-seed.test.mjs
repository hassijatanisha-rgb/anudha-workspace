import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/202609210003_known_inventory_locations.sql','utf8');
assert.match(sql,/Main Location/);
assert.match(sql,/Haadi/);
assert.match(sql,/'dispatch_hub',true/);
assert.match(sql,/where not exists/i);
assert.doesNotMatch(sql,/opening_balance|inventory_lots|quantity/i);
console.log('PASS: location seed adds only the two evidenced locations and no invented stock.');
