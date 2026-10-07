// Fixes found by driving the staff scenario guide end to end in a browser (October 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const fn=(file,name)=>{const src=read(file),start=src.indexOf(`function ${name}(`);assert.ok(start>=0,`${name} in ${file}`);
 let depth=0,i=src.indexOf('{',start);for(;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&--depth===0)break;}
 return (src.slice(Math.max(0,start-6),start)==='async '?'async ':'')+src.slice(start,i+1);};

test('Record tax invoice still works where the stock-reservation function (migration 010) is not installed',async()=>{
 const ctx=vm.createContext({});vm.runInContext(fn('sales-delivery.js','taxInvoiceReservationMissing'),ctx);
 assert.equal(ctx.taxInvoiceReservationMissing({code:'PGRST202',message:'Could not find the function public.create_tax_invoice_and_reserve_stock(p_expected_version, p_id, p_tax_invoice_reference) in the schema cache'}),true);
 assert.equal(ctx.taxInvoiceReservationMissing({code:'P0001',message:'Not enough available stock at Haadi for product x; Tax Invoice was not created'}),false,'a real refusal is shown, not bypassed');
 assert.equal(ctx.taxInvoiceReservationMissing(null),false);
 const src=fn('sales-delivery.js','openDeliveryAction');
 assert.match(src,/create_tax_invoice_and_reserve_stock[^;]*;if\(taxInvoiceReservationMissing\(result\.error\)\)result=await client\.rpc\('advance_sales_delivery',\{[^}]*p_action:'tax_invoice'[^}]*p_proof_reference:values\.proof\}\)/);
});
