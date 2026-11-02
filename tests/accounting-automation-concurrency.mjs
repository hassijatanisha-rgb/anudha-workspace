// Two real PostgreSQL sessions, isolated private Unix socket and a fixed disposable database.
// Never accepts a connection URL, TCP host, production database or arbitrary database name.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const pgUrl=new URL('../../accounting-concurrency-deps/node_modules/pg/lib/index.js',import.meta.url),{default:pg}=await import(pgUrl.href);
const {Client}=pg,config={host:'/private/tmp/anudha-accounting-pg-20261102',port:55439,user:'tanisha'},database='anudha_accounting_test_nov2';
const artifacts=new URL('../../../outputs/accounting-automation-20261102/',import.meta.url);mkdirSync(artifacts,{recursive:true});
const log=[],writeLog=()=>writeFileSync(new URL('concurrency-results.json',artifacts),JSON.stringify(log,null,2)+'\n');
const root=new Client({...config,database:'postgres'});await root.connect();
const marker='Disposable Codex accounting concurrency fixture 2026-11-02';
const existing=(await root.query('select shobj_description(oid,\'pg_database\') marker from pg_database where datname=$1',[database])).rows[0];
if(existing){assert.equal(existing.marker,marker,'refuse to replace a database without the fixture ownership marker');await root.query('drop database anudha_accounting_test_nov2 with (force)');}
await root.query('create database anudha_accounting_test_nov2');await root.query("comment on database anudha_accounting_test_nov2 is 'Disposable Codex accounting concurrency fixture 2026-11-02'");
const temporary=mkdtempSync(join(tmpdir(),'anudha-accounting-pg-adapter-')),adapter=join(temporary,'adapter.mjs');
writeFileSync(adapter,`import pg from ${JSON.stringify(pgUrl.href)};
export class PGlite {
 constructor(){this.client=new pg.Client(${JSON.stringify({...config,database})});this.ready=this.client.connect();}
 async query(sql,args=[]){await this.ready;return this.client.query(sql,args);}
 async exec(sql){return this.query(sql.replace('create role anon;create role authenticated;',()=>\`do $roles$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end $roles$;\`));}
 async close(){if(!this.closed){this.closed=true;await this.ready;await this.client.end();}}
}
`);
process.env.PGLITE_MODULE=pathToFileURL(adapter).href;
let f;const clients=[];
try{
 f=await createOrderFixture({extraMigrations:['202610070073_receive_transfer_available_lot.sql','202610160096_financial_import.sql','202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql','202610190111_post_return_credits.sql','202610190112_opening_receivables.sql','202610200120_machine_serial_requirement.sql','202610200121_receiving_machine_serials.sql','202610290134_books_invoice_register.sql','202610290146_books_transaction_page.sql','202611020156_accounting_posting_integrity.sql','202611020157_accounting_report_snapshot.sql']});
 const functionManifest=async()=>(await f.db.query("select p.proname,p.oid::regprocedure::text signature,md5(p.prosrc) source_md5,p.prosecdef security_definer,p.proconfig config,has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE') public_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid::regprocedure::text")).rows;
 const tableManifest=async()=>(await f.db.query("select c.relname table_name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,has_table_privilege('anon',c.oid,'SELECT') anon_select,has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE') anon_write,has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select,has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') authenticated_write,coalesce((select jsonb_agg(jsonb_build_object('policy',pol.policyname,'roles',pol.roles,'command',pol.cmd,'using',pol.qual,'check',pol.with_check) order by pol.policyname) from pg_policies pol where pol.schemaname='public' and pol.tablename=c.relname),'[]'::jsonb) policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname")).rows;
 const beforeFunctions=new Map((await functionManifest()).map(row=>[row.signature,JSON.stringify(row)])),beforeTables=new Map((await tableManifest()).map(row=>[row.table_name,JSON.stringify(row)]));
 const migrations=['202611020158_supplier_accounting.sql','202611020159_inventory_cost_accounting.sql','202611020160_customer_credit_settlement.sql'],migrationSources=migrations.map(name=>({name,sql:readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')}));
 await f.db.exec('reset role');for(const migration of migrationSources)await f.db.exec(migration.sql);await f.db.exec('set role authenticated');
 const expectedManifest={scope:'New or changed public functions and tables versus the same disposable fixture through migration157',migrations:migrationSources.map(({name,sql})=>({name,sha256:createHash('sha256').update(sql).digest('hex')})),functions:(await functionManifest()).filter(row=>beforeFunctions.get(row.signature)!==JSON.stringify(row)),tables:(await tableManifest()).filter(row=>beforeTables.get(row.table_name)!==JSON.stringify(row))};
 const {db,id,as,admin,one,OWNER,SALES,ACCOUNTS,ORG,CONTACT,REAGENT,REAGENT_LOT,MACHINE_LOT,dates}=f;
 let sequence=60000;const fresh=()=>id(sequence++),day=dates.today,cutover=(await one('select (current_date-1)::text d')).d;
 const BANK='a0000000-0000-4000-8000-000000001200',RENT='a0000000-0000-4000-8000-000000006100',AR='a0000000-0000-4000-8000-000000001300',INV='a0000000-0000-4000-8000-000000001400',EQ='a0000000-0000-4000-8000-000000003000';
 const connect=async actor=>{const c=new Client({...config,database});await c.connect();clients.push(c);await c.query("set statement_timeout='12s';set lock_timeout='8s';set deadlock_timeout='200ms';set role authenticated");await c.query("select set_config('test.actor',$1,false)",[actor]);return c;};
 const a=await connect(ACCOUNTS),b=await connect(ACCOUNTS),gate=new Client({...config,database});await gate.connect();clients.push(gate);
 const args=(name,values)=>({text:`select to_jsonb(${name}(${values.map((_,i)=>'$'+(i+1)).join(',')})) r`,values});
 const race=async(name,key,first,second,successes)=>{
  await gate.query('begin');await gate.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
  const call=(c,q)=>c.query(q).then(value=>({ok:true,row:value.rows[0]?.r}),error=>({ok:false,code:error.code,message:error.message}));
  const p=call(a,first),q=call(b,second);let blocked=0;
  for(let n=0;n<40;n++){blocked=Number((await gate.query("select count(*) n from pg_stat_activity where pid=any($1::int[]) and wait_event='advisory'",[[a.processID,b.processID]])).rows[0].n);if(blocked===2)break;await new Promise(done=>setTimeout(done,25));}
  await gate.query('commit');const results=await Promise.all([p,q]);
  assert.equal(blocked,2,name+' reached overlapping advisory-lock waits');assert.equal(results.filter(r=>r.ok).length,successes,name+': '+JSON.stringify(results));assert.ok(results.every(r=>!['40P01','55P03','57014'].includes(r.code)),name+' must finish without deadlock or timeout');
  log.push({name,overlapping_sessions:2,successes:results.filter(r=>r.ok).length,results});writeLog();console.log('PASS: '+name);return results;
 };
 await as(OWNER);const supplier=fresh();await db.query('select save_supplier($1,0,$2::jsonb)',[supplier,JSON.stringify({name:'Concurrency fictional supplier'})]);
 const billArgs=request=>args('post_supplier_bill',[request,supplier,day,dates.delivery,'RACE-'+request,JSON.stringify([{account_id:RENT,net_minor:'10000',tax_minor:'0'}]),null]);
 const billId=fresh(),same=await race('same supplier bill retry posts one journal','acc-inventory-cost',billArgs(billId),billArgs(billId),2);assert.equal(same[0].row.id,same[1].row.id);
 assert.equal((await one('select count(*)::int n from acc_supplier_bills where id=$1',[billId])).n,1);
 const paymentArgs=(request,bill,amount='10000')=>args('post_supplier_payment',[request,supplier,day,amount,'bank','Race payment',BANK,JSON.stringify([{bill_id:bill,amount_minor:amount}])]);
 await race('simultaneous supplier payments cannot overpay a bill','acc-inventory-cost',paymentArgs(fresh(),billId),paymentArgs(fresh(),billId),1);
 const bill2=fresh();await db.query(billArgs(bill2).text,billArgs(bill2).values);
 const payment=fresh();await db.query('select post_supplier_payment($1,$2,$3,10000,\'bank\',\'Advance\',$4,\'[]\')',[payment,supplier,day,BANK]);
 await race('supplier advance allocation and refund cannot spend the same money','acc-inventory-cost',args('allocate_supplier_payment',[fresh(),payment,day,JSON.stringify([{bill_id:bill2,amount_minor:'10000'}])]),args('post_supplier_refund',[fresh(),payment,day,'10000','bank','Race advance refund',BANK]),1);
 const ap=(await one('select get_supplier_books_page($1) r',[day])).r;assert.equal(ap.summary.reconciled,true);
 // Opening customer target plus a genuine unallocated receipt supplies the customer-credit race.
 const batch=fresh();await db.query('select import_financial_journals($1,$2,\'opening\',$3::jsonb)',[batch,'Concurrency AR opening',JSON.stringify([{reference:'AR-'+batch,date:cutover,memo:'Concurrency AR opening',lines:[{account_id:AR,debit_minor:10000,credit_minor:0,description:'AR'},{account_id:EQ,debit_minor:0,credit_minor:10000,description:'Equity'}]}])]);
 const opened=(await one('select import_opening_receivables($1,$2,$3,$4,$5::jsonb) r',[fresh(),'Concurrency AR schedule',cutover,batch,JSON.stringify([{kind:'invoice',reference:'RACE-OPEN',organization_id:ORG,invoice_date:cutover,due_date:cutover,amount_minor:10000,currency:'TZS'}])])).r;
 const target=opened.invoices[0].invoice_id,receipt=fresh();await db.query("select record_receipt($1,$2,$3,10000,'bank','Race customer advance',$4,'[]')",[receipt,ORG,day,BANK]);
 await race('customer credit application and refund share one available balance','acc-receipt-org:'+ORG,args('apply_customer_credit',[fresh(),receipt,null,null,target,day,'10000']),args('refund_customer_credit',[fresh(),receipt,null,null,day,'10000',BANK,'bank','Race customer refund']),1);
 // Establish verified opening stock with five physical cartons for the later transfer race.
 await admin('update inventory_lots set sealed_cartons=5,loose_units=15 where id=$1',[REAGENT_LOT]);
 const stockBatch=fresh();await db.query('select import_financial_journals($1,$2,\'opening\',$3::jsonb)',[stockBatch,'Concurrency inventory opening',JSON.stringify([{reference:'STOCK-'+stockBatch,date:cutover,memo:'Verified opening inventory for races',lines:[{account_id:INV,debit_minor:120000,credit_minor:0,description:'Stock'},{account_id:EQ,debit_minor:0,credit_minor:120000,description:'Equity'}]}])]);
 const activation=args('activate_inventory_costing',[fresh(),'weighted_average',cutover,stockBatch,JSON.stringify([{lot_id:MACHINE_LOT,expected_version:1,quantity:10,total_cost_minor:'100000',evidence_reference:'Verified race machine count',acquired_on:cutover},{lot_id:REAGENT_LOT,expected_version:1,quantity:20,total_cost_minor:'20000',evidence_reference:'Verified race reagent count',acquired_on:cutover}]),'Reviewed actual quantities and purchase evidence']);
 await a.query("select set_config('test.actor',$1,false)",[OWNER]);await b.query("select set_config('test.actor',$1,false)",[OWNER]);
 const inventoryLines=JSON.stringify([{account_id:INV,debit_minor:1,credit_minor:0,description:'Race inventory control'},{account_id:EQ,debit_minor:0,credit_minor:1,description:'Race equity'}]);
 const manualActivation=await race('manual inventory journal and activation serialize their control checks','acc-inventory-cost',args('post_manual_journal',[fresh(),cutover,'Reviewed manual inventory race',inventoryLines]),activation,1);
 if(manualActivation[0].ok){await db.query('select reverse_journal_entry($1,$2,$3,$4)',[fresh(),manualActivation[0].row.id,cutover,'Reverse fictional concurrency journal before activation']);await db.query(activation.text,activation.values);}
 await race('financial journal import and activation retry follow the same lock order','acc-inventory-cost',args('import_financial_journals',[fresh(),'Reviewed imported inventory race','journal',JSON.stringify([{reference:'RACE-INV-IMPORT',date:day,memo:'Reviewed imported inventory race',lines:JSON.parse(inventoryLines)}])]),activation,1);
 assert.equal((await one('select inventory_cost_status() r')).r.difference_minor,'0');
 await a.query("select set_config('test.actor',$1,false)",[ACCOUNTS]);await b.query("select set_config('test.actor',$1,false)",[ACCOUNTS]);
 const quote=async()=>{await as(SALES);let pf=await one('select * from save_sales_proforma($1,0,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[fresh(),ORG,CONTACT,'TZS',dates.valid,'Seven days','Payment before delivery','Concurrency costing quote',JSON.stringify([{productId:REAGENT,description:'Reagent',quantity:15,uom:'kit',unitPriceMinor:10003,discountBasisPoints:0,taxBasisPoints:1800}])]);for(const action of ['send','accept'])pf=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[pf.id,pf.version,action,'Fixture '+action]);pf.line=await one('select * from sales_proforma_lines where proforma_id=$1',[pf.id]);await as(ACCOUNTS);return pf;};
 const qa=await quote(),qb=await quote();
 const invoiceArgs=pf=>args('invoice_order_quantities',[fresh(),pf.id,pf.version,day,dates.valid,JSON.stringify([{proforma_line_id:pf.line.id,quantity:15}]),'Reviewed race approval',dates.delivery,'']);
 const invoices=await race('concurrent invoices cannot reserve or expense more inventory than exists','acc-inventory-cost',invoiceArgs(qa),invoiceArgs(qb),1),invoice=invoices.find(r=>r.ok).row;
 assert.equal((await one('select count(*)::int n from acc_stock_invoice_costs where invoice_id=$1',[invoice.id])).n,1);
 // One receipt can be costed by only one supplier bill, even with competing UUID requests.
 await as(OWNER);let po=await one('select * from save_purchase_request($1,0,$2,$3,$4,$5,$6::jsonb)',[fresh(),supplier,'TZS',dates.delivery,'Race purchase',JSON.stringify([{product_id:REAGENT,quantity:10}])]);for(const action of ['approve','order'])po=await one('select * from advance_purchase_order($1,$2,$3,$4,$5,$6)',[po.id,po.version,action,'Race '+action,action==='order'?'RACE-LPO':'',dates.delivery]);
 const poLine=await one('select * from purchase_order_lines where purchase_order_id=$1',[po.id]),lot=await one('select * from inventory_lots where id=$1',[REAGENT_LOT]);
 const stockReceipt=await one('select * from receive_supplier_stock($1,$2,$3,$4,10,$5,$6,$7,$8,$9::jsonb,$10::text[])',[fresh(),poLine.id,REAGENT_LOT,lot.version,day,'Race stock delivery','pass','Reviewed arrival','{}',[]]);
 const costBill=request=>args('post_supplier_bill',[request,supplier,day,dates.delivery,'STOCK-BILL-'+request,JSON.stringify([{account_id:INV,net_minor:'30000',tax_minor:'0',product_id:REAGENT,stock_receipt_id:stockReceipt.id,stock_quantity:'10'}]),po.id]);
 await race('concurrent supplier bills cannot value the same receipt twice','acc-inventory-cost',costBill(fresh()),costBill(fresh()),1);
 assert.equal((await one('select count(*)::int n from acc_stock_receipt_costs where receipt_id=$1',[stockReceipt.id])).n,1);
 // A transfer dispatch and invoice cost reversal must follow the same stock lock order.
 const delivery=await one("select * from sales_delivery_notes where invoice_id=$1 and status<>'cancelled'",[invoice.id]);await db.query('select advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[delivery.id,delivery.version,'cancel','','','','Cancel duplicate fixture order']);
 const destination=fresh();await admin("insert into inventory_locations(id,name,code,location_type,created_by) values($1,'Race destination','RACE-DST','godown',$2)",[destination,OWNER]);
 const transfer=await one('select * from request_inventory_transfer($1,$2,$3,1,$4,$5)',[fresh(),REAGENT_LOT,destination,dates.delivery,'Reviewed one carton transfer']),sourceLot=await one('select * from inventory_lots where id=$1',[REAGENT_LOT]);
 await b.query("select set_config('test.actor',$1,false)",[OWNER]);
 await race('invoice void and transfer dispatch finish without stock lock inversion','acc-inventory-cost',args('void_invoice',[invoice.id,day,'Duplicate invoice correction']),args('dispatch_inventory_transfer',[transfer.id,transfer.version,sourceLot.version,'Reviewed transfer dispatch']),2);
 const valuation=(await one('select inventory_cost_status() r')).r;assert.equal(valuation.difference_minor,'0');assert.equal((await one('select get_supplier_books_page($1) r',[day])).r.summary.reconciled,true);
 const ar=await one('select (select coalesce(sum(balance_minor),0)::text from acc_receivables_ageing($1)) sub,(select coalesce(sum(l.debit_minor-l.credit_minor),0)::text from acc_journal_lines l join acc_journal_entries e on e.id=l.entry_id where l.account_id=$2 and e.entry_date<=$1) gl',[day,AR]);assert.equal(ar.sub,ar.gl);
 log.push({final_reconciliation:{payables:true,receivables:true,inventory:true},database,server:(await root.query('show server_version')).rows[0].server_version,network:'Unix socket only; no TCP',cleanup:'fixture database dropped in finally'});writeLog();expectedManifest.server=(await root.query('show server_version')).rows[0].server_version;writeFileSync(new URL('expected-database-manifest.json',artifacts),JSON.stringify(expectedManifest,null,2)+'\n');console.log('PASS: 9 actual PostgreSQL two-session accounting races; AP, AR and inventory reconcile.');
}catch(error){log.push({failure:error.message,code:error.code,where:error.where});writeLog();throw error;}
finally{await Promise.allSettled(clients.map(c=>c.end()));if(f)await f.db.close();await root.query('drop database anudha_accounting_test_nov2 with (force)');await root.end();rmSync(temporary,{recursive:true,force:true});}
