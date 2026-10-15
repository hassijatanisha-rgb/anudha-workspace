// Real Chromium parses the Tally XML fixture; the rows are imported through the real migration in disposable PGlite.
// Run with PLAYWRIGHT_MODULE (and optionally CHROME_EXECUTABLE) and PGLITE_MODULE.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const {PGlite}=await import(process.env.PGLITE_MODULE);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
let parsed;
try{
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent('<main id="content"></main>');
 await page.addScriptTag({content:readFileSync(new URL('../tally-invoices.js',import.meta.url),'utf8')});
 parsed=await page.evaluate(xml=>parseTallyInvoicesXml(xml),readFileSync(new URL('./fixtures/tally-daybook-sample.xml',import.meta.url),'utf8'));
 await assert.rejects(page.evaluate(()=>parseTallyInvoicesXml('<not xml')),/not a Tally XML export/);
 await assert.rejects(page.evaluate(()=>parseTallyInvoicesXml('<ENVELOPE></ENVELOPE>')),/No vouchers found/);
}finally{await browser.close();}
assert.deepEqual(parsed.skipped,{'Sales Order':1,'Credit Note':1});
assert.equal(parsed.rows.length,2);
const [a,b]=parsed.rows;
assert.deepEqual({n:a.voucher_number,d:a.voucher_date,p:a.party_name,ref:a.order_reference,net:a.net_minor,vat:a.vat_minor,total:a.total_minor,c:a.cancelled},
 {n:'INV/101',d:'2026-09-30',p:'Fixture Hospital',ref:'pf 2026 12 · LPO 55',net:1150000,vat:207000,total:1357000,c:false});
assert.deepEqual(a.lines.map(l=>[l.item,l.quantity,l.unit,l.rate_minor,l.amount_minor]),[['Blood Bag 450ml',10,'PCS',100000,1000000],['Cannula 22G',3,'BOX',50000,150000]]);
assert.deepEqual({n:b.voucher_number,type:b.voucher_type,c:b.cancelled,total:b.total_minor,unit:b.lines[0].unit},{n:'INV/102',type:'Tax Invoice',c:true,total:25000,unit:'PAIR'},'older layout, forex amount, cancelled');

const db=new PGlite(),owner='00000000-0000-4000-8000-000000000001',pf='00000000-0000-4000-8000-000000000040';
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select '${owner}'::uuid$$;
create function public.inventory_active_staff() returns boolean language sql as $$select true$$;create function public.inventory_owner() returns boolean language sql as $$select true$$;
create function public.accounting_access() returns boolean language sql as $$select false$$;
create table public.sales_proformas(id uuid primary key,document_number text unique,deleted_at timestamptz);
insert into auth.users values('${owner}');insert into public.sales_proformas values('${pf}','PF-2026-000012',null);`);
await db.exec(readFileSync(new URL('../supabase/migrations/202610010050_tally_sales_invoices.sql',import.meta.url),'utf8'));
const r=(await db.query('select public.import_tally_invoices($1::jsonb,$2) r',[JSON.stringify(parsed.rows),'upload'])).rows[0].r;
assert.deepEqual(r,{rows:2,new:2,changed:0,unchanged:0,matched:1});
const rows=(await db.query('select voucher_number,proforma_id,match_status,cancelled,total_minor from tally_sales_invoices order by voucher_number')).rows;
assert.equal(rows[0].proforma_id,pf,'INV/101 linked through "pf 2026 12" in Order No.');assert.equal(rows[1].match_status,'unmatched');assert.equal(rows[1].cancelled,true);
assert.deepEqual((await db.query('select public.import_tally_invoices($1::jsonb,$2) r',[JSON.stringify(parsed.rows),'upload'])).rows[0].r.unchanged,2,'uploading the same export twice changes nothing');
console.log('PASS: Chromium parses Tally XML (new and old layouts, forex, cancelled, skipped types) → real migration imports and links by Pro forma number; re-upload is a no-op.');
