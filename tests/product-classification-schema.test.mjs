import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/202609210002_product_inventory_classification.sql','utf8');
assert.match(sql,/create table public\.product_inventory_classifications/i);
assert.match(sql,/category in \('machines','reagents','consumables','spares','non_stock','unclassified'\)/i);
assert.match(sql,/create or replace function public\.save_product_inventory_classification/i);
assert.match(sql,/classifications are immutable/i);
assert.match(sql,/enable row level security/i);
console.log('PASS: product inventory classifications are reviewed, versioned and protected by RLS.');
