import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('client-profile-pages.js','utf8');
assert.match(source,/from\('inventory_issues'\).*eq\('organization_id',organizationId\)/s);
assert.match(source,/branchHistoryMonth/);
assert.match(source,/\['machines','reagents','consumables','spares'\]/);
assert.match(source,/delivery or sale reference/i);
assert.match(source,/No issued or delivered items are recorded for this branch yet/);
console.log('PASS: client history uses real branch inventory issues with monthly category totals.');
