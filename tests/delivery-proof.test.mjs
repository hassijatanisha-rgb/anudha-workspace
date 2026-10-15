import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('the deliver form tells staff to upload the signed delivery note first',()=>{
 const source=read('sales-delivery.js'),start=source.indexOf("action==='deliver'?"),deliver=source.slice(start,source.indexOf("action==='cancel'?",start));
 assert.ok(start>0&&deliver.length>0);
 assert.match(deliver,/upload a photo or scan of the signed and stamped delivery note/i);
 assert.match(deliver,/Upload \/ view documents/);
 assert.match(deliver,/name="recipient"/);assert.match(deliver,/name="proof"/);
});

test('the newest advance_sales_delivery requires a delivery file uploaded after dispatch',()=>{
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>/advance_sales_delivery/.test(read('supabase/migrations/'+name))).sort();
 const latest=read('supabase/migrations/'+files.at(-1));
 assert.equal(files.at(-1),'202610150081_delivery_proof_required.sql','081 holds the current definition');
 assert.match(latest,/record_type='delivery' and a\.record_id=v_row\.id and a\.uploaded_at>=coalesce\(v_row\.dispatched_at/);
 assert.doesNotMatch(latest,/carrier\s*=\s*.*limit|count\(\*\).*out_for_delivery/i,'no one-delivery-per-driver limit: multi-drop stays allowed');
});
