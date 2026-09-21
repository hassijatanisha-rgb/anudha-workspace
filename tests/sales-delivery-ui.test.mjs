import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('sales-delivery.js','utf8'),html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8');
assert.match(html,/data-view="sales">Pro forma &amp; delivery/);
assert.match(html,/sales-domain\.js/);
assert.match(html,/sales-delivery\.js/);
assert.match(app,/view==='sales'.*salesDeliveryWorkspace/);
assert.match(source,/Pro forma → customer acceptance → Accounts reference → Haadi stock check → dispatch → signed delivery proof/);
assert.match(source,/save_sales_proforma/);
assert.match(source,/advance_sales_proforma/);
assert.match(source,/create_sales_delivery_note/);
assert.match(source,/advance_sales_delivery/);
assert.match(source,/Print \/ PDF/);
assert.match(source,/No matching loose stock is available at Haadi/);
console.log('PASS: team UI exposes the guarded Pro forma-to-delivery workflow and printable records.');
