import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),plain=x=>JSON.parse(JSON.stringify(x));
const day='2026-11-02',cutover='2026-11-01',lotId='00000000-0000-4000-8000-000000000100';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function parser(){const c=vm.createContext({Intl,Date,Math,Number,String,Map,Set,Array,Object,Error,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,crypto:globalThis.crypto});for(const file of ['vendor/xlsx.full.min.js','sales-domain.js','accounting-ledger.js','financial-import.js','inventory-cost-accounting.js'])vm.runInContext(source(file),c);return c;}
function sheet(c,rows){c.rows=rows;return vm.runInContext('XLSX.utils.aoa_to_sheet([inventoryOpeningHeaders,...rows])',c);}
const lot={id:lotId,version:2,product_id:'product',product_name:'Reagent <img src=x onerror=unsafe()>',location_id:'location',location_name:'Godown',pack_definition_id:'pack',batch_number:'BATCH-1',stock_status:'available',quantity:4,reserved_units:0,requires_serial:false};
const openingRow=(amount='100.25',date='')=>[lotId,2,'Reagent','Godown / BATCH-1',4,amount,'Verified acquisition register',date];
const preview=(c,s,lots=[lot],policy='weighted_average')=>plain(c.inventoryOpeningPreview(s,lots,{cutover,policy}));

async function fixture(mode='receive'){
 const document=dom();installNativeFormControls(document);const proto=Object.getPrototypeOf(document.body),html=Object.getOwnPropertyDescriptor(proto,'innerHTML');
 Object.defineProperty(proto,'required',{configurable:true,get(){return this.getAttribute('required')!==null;},set(v){if(v)this.setAttribute('required','');else this.removeAttribute('required');}});
 Object.defineProperty(proto,'innerHTML',{configurable:true,get:html.get,set(value){html.set.call(this,value);if(this.tag==='select'){const option=this.querySelector('option[selected]')||this.querySelector('option');this.value=option?.getAttribute('value')??option?.textContent??'';}}});
 document.body.innerHTML='<main id="content"><div id="booksBody"></div></main>';
 const actor={user_id:'actor'},calls=[],messages=[];let sequence=0;
 const data={enabled:mode!=='activation',policy:'weighted_average',cutover_date:cutover,inventory_value_minor:'10025',gl_inventory_minor:'10025',difference_minor:'0',
  products:[{product_id:'product',product_name:lot.product_name,physical_quantity:4,financial_quantity:4,invoiced_undispatched_quantity:0,invoiced_undispatched_value_minor:'0',inventory_value_minor:'10025',quarantine_quantity:0}],
  lots:[{...lot}],receipts:[],purchase_order_lines:[{id:'po-line',purchase_order_id:'po',po_number:'PO-1',supplier_id:'supplier',supplier_name:'Vendor',product_id:'product',product_name:'Reagent',quantity:10,received_quantity:0,requires_serial:false}],
  locations:[{id:'location',name:'Godown'}],pack_definitions:[{id:'pack',product_id:'product',version:1,units_per_carton:1}],opening_gl_batches:[{id:'gl-batch',source:'Verified Tally GL'}],
  cost_layers:[{id:'cost-layer',product_id:'product',product_name:'Reagent',event_date:cutover,source_type:'opening',quantity:4,value_minor:'10025',remaining_scope:'product',remaining_quantity:4,remaining_value_minor:'10025'}],customer_return_lines:[]};
 const c=vm.createContext({document,busy:false,me:actor,view:'books',$:s=>document.querySelector(s),esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),crypto:{randomUUID:()=>`request-${++sequence}`},message:(...args)=>messages.push(args),Intl,Date,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder});
 for(const file of ['vendor/xlsx.full.min.js','client-rules.js','sales-domain.js','accounting-ledger.js','books-automation.js','financial-import.js','inventory-cost-accounting.js'])vm.runInContext(source(file),c);
 const app=source('app.js');vm.runInContext(app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),c);
 c.booksToday=()=>day;c.initial={today:day,accounts:[],settings:{version:1,locked_through:null}};
 const get=code=>vm.runInContext(code,c);get("booksData=initial;booksSection='valuation';booksEpoch=10");
 const actualRun=c.run;c.run=(...args)=>c.running=actualRun(...args);
 const f={c,data,document,calls,messages,get,node:s=>document.querySelector(s)};
 f.saved=(name,a)=>{
  if(name==='receive_supplier_stock')return {id:a.p_id,purchase_order_line_id:a.p_purchase_order_line_id,lot_id:a.p_lot_id,quantity:a.p_quantity,received_on:a.p_received_on,reference:a.p_reference,inspection:a.p_inspection,note:a.p_note,movement_id:'movement',request_content:{purchase_order_line_id:a.p_purchase_order_line_id,lot_id:a.p_lot_id,expected_version:a.p_expected_version,quantity:a.p_quantity,received_on:a.p_received_on,reference:a.p_reference,inspection:a.p_inspection,note:a.p_note,lot_details:a.p_lot_details,serials:a.p_serials}};
  if(name==='post_inventory_count_gain')return {id:'cost-event',source_type:'count_gain',source_id:a.p_id,source_line_id:a.p_lot_id,event_date:a.p_date,quantity:a.p_quantity,value_minor:a.p_total_cost_minor};
  if(name==='correct_inventory_value')return {id:a.p_id,layer_event_id:a.p_layer_event_id,amount_minor:a.p_amount_minor,correction_date:a.p_date,evidence:a.p_evidence,event_id:'cost-event'};
  if(name==='activate_inventory_costing')return {id:a.p_id,policy:a.p_policy,cutover_date:a.p_cutover,gl_import_id:a.p_gl_import_id,rows:a.p_rows,reference:a.p_reference,total_minor:String(a.p_rows.reduce((s,r)=>s+BigInt(r.total_cost_minor),0n))};
  if(name==='return_supplier_stock')return {return:{id:a.p_id,bill_id:a.p_bill_id,line_no:a.p_line_no,lot_id:a.p_lot_id,quantity:a.p_quantity,return_date:a.p_date,reference:a.p_reference,reason:a.p_reason,tax_minor:a.p_tax_minor,net_minor:'2000',customer_return_line_id:a.p_customer_return_line_id,cost_event_id:'cost-event',request_content:Object.fromEntries(Object.entries(a).filter(([key])=>key!=='p_id').map(([key,value])=>[key.slice(2),value]))},credit:{id:a.p_id,bill_id:a.p_bill_id,credit_date:a.p_date,reference:a.p_reference,tax_minor:a.p_tax_minor,net_minor:'2000',total_minor:String(2000n+BigInt(a.p_tax_minor)),credit_number:'CREDIT-1',journal_entry_id:'journal'}};
  throw Error('Unexpected mutation '+name);
 };
 f.write=async(name,args)=>({data:f.saved(name,args)});
 c.client={rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='inventory_cost_status')return {data};return f.write(name,args);}};
 const current=()=>c.me===actor&&c.view==='books'&&get('booksEpoch===10');
 f.click=async selector=>{const node=f.node(selector);assert.ok(node,selector);c.running=null;const event={currentTarget:node,preventDefault(){}};const response=node.onclick?node.onclick(event):node.events.click?.[0]?.fn(event);await(response||c.running);};
 if(mode==='supplier_return')await c.supplierStockReturnForm('actor',current,{id:'bill',bill_number:'BILL-1',lines:[{product_id:'product',description:'Reagent'}]},1,async()=>{});
 else{
  await c.inventoryCostWorkspace('actor',current,{tab:mode==='activation'?'opening':['gain','value'].includes(mode)?'adjustments':'valuation'});
  if(mode!=='register')await f.click({receive:'[data-cost-receive]',gain:'[data-cost-gain]',value:'[data-cost-value]',activation:'[data-cost-activate]'}[mode]);
 }
 f.form=f.node('[data-books-automation-form]');f.field=name=>f.form.elements[name];f.summary=f.form?.querySelector('[role="alert"]');f.writes=()=>calls.filter(r=>r.name!=='inventory_cost_status');
 f.submit=()=>{c.running=null;const response=f.form.onsubmit({preventDefault(){}});return response||c.running;};
 f.valid=async()=>{
  if(mode==='receive'){f.field('order').value='po-line';f.field('order').onchange();f.field('lot').value=lotId;f.field('lot').onchange();f.field('quantity').value='2';f.field('reference').value=' RECEIVED-1 ';f.field('note').value=' Verified goods ';}
  if(mode==='gain'){f.field('lot').value=lotId;f.field('quantity').value='2';f.field('amount').value='100.25';f.field('evidence').value=' Verified found goods ';}
  if(mode==='value'){f.field('layer').value='cost-layer';f.field('direction').value='decrease';f.field('amount').value='10.25';f.field('evidence').value=' Verified revised acquisition ';}
  if(mode==='activation'){f.field('policy').value='weighted_average';f.field('gl').value='gl-batch';f.field('reference').value=' Owner approval reference ';f.field('file').value='stock.xlsx';f.field('file').files=[{name:'stock.xlsx'}];c.financialImportRead=async(_file,options)=>{f.readOptions=plain(options);return {SheetNames:['Stock'],Sheets:{Stock:sheet(c,[openingRow()])}};};await f.field('file').onchange();}
  if(mode==='supplier_return'){f.field('lot').value=lotId;f.field('quantity').value='1';f.field('tax').value='1.80';f.field('reference').value=' RETURN-1 ';f.field('reason').value=' Wrong goods supplied ';}
 };
 return f;
}
for(const mode of ['receive','gain','value','activation','supplier_return'])test(`inventory ${mode}: actual form sends exact arguments once and verifies the saved result`,async()=>{
 const f=await fixture(mode);await f.valid();const wait=deferred();f.write=()=>wait.promise;const pending=f.submit();await f.submit();assert.equal(f.writes().length,1,f.summary.textContent);assert.equal(f.form.inert,true);
 const {name,args}=f.writes()[0];if(mode==='receive'){assert.equal(args.p_expected_version,2);assert.equal(args.p_quantity,2);assert.equal(args.p_reference,'RECEIVED-1');assert.deepEqual(args.p_lot_details,{});}
 if(mode==='gain')assert.equal(args.p_total_cost_minor,'10025');if(mode==='value')assert.equal(args.p_amount_minor,'-1025');if(mode==='activation'){assert.equal(args.p_cutover,cutover);assert.equal(String(args.p_rows[0].total_cost_minor),'10025');assert.equal(args.p_rows[0].quantity,4);assert.equal(f.readOptions.maxRows,10000);}if(mode==='supplier_return'){assert.equal(args.p_tax_minor,'180');assert.equal(args.p_customer_return_line_id,null);}
 wait.resolve({data:f.saved(name,args)});await pending;assert.equal(f.node('[data-books-posting-retry]'),null);assert.match(f.form.nextElementSibling.textContent,/Open saved details/);await f.submit();assert.equal(f.writes().length,1);
});
for(const mode of ['receive','gain','value','activation','supplier_return'])test(`inventory ${mode}: lost response freezes the original request for exact retry`,async()=>{
 const f=await fixture(mode);await f.valid();f.write=async()=>{throw Error('Lost response');};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
 if(f.field('quantity'))f.field('quantity').value='99';if(f.field('amount'))f.field('amount').value='999.99';if(f.field('reference'))f.field('reference').value='Changed after sending';await f.submit();assert.equal(f.writes().length,1);
 f.write=async(name,args)=>({data:f.saved(name,args)});await f.click('[data-books-posting-retry]');assert.deepEqual(f.writes()[1],f.writes()[0]);assert.equal(f.node('[data-books-posting-retry]'),null);
});
for(const mode of ['receive','gain','value','activation','supplier_return'])test(`inventory ${mode}: mismatched saved data cannot confirm success`,async()=>{
 const f=await fixture(mode);await f.valid();f.write=async(name,args)=>{const saved=f.saved(name,args);if(mode==='receive'||mode==='gain')saved.quantity=99;else if(mode==='value')saved.amount_minor='1';else if(mode==='activation')saved.rows=[];else saved.credit.net_minor='1';return {data:saved};};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
});
test('supplier stock return cannot confirm an inconsistent saved credit total',async()=>{
 const f=await fixture('supplier_return');await f.valid();f.write=async(name,args)=>{const saved=f.saved(name,args);saved.credit.total_minor='999999';return {data:saved};};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);
});
test('supplier stock return verifies the immutable request version and actual serials',async()=>{
 for(const field of ['expected_version','serials']){const f=await fixture('supplier_return');await f.valid();f.write=async(name,args)=>{const saved=f.saved(name,args);saved.return.request_content[field]=field==='serials'?['OTHER-SERIAL']:99;return {data:saved};};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));assert.equal(f.form.inert,true);}
});
test('opening schedule retains exact large text costs and rejects unsafe numeric spreadsheet values',()=>{
 const c=parser(),good=preview(c,sheet(c,[openingRow('90071992547409.91')]));assert.deepEqual(good.errors,[]);assert.equal(good.totalMinor,'9007199254740991');
 for(const bad of [90071992547409.91,'1.234','1e3','-1.00'])assert.ok(preview(c,sheet(c,[openingRow(bad)])).errors.length);
});
test('opening schedule requires every positive lot including quarantine, exact version/count and evidence',()=>{
 const c=parser(),quarantine={...lot,id:'00000000-0000-4000-8000-000000000101',stock_status:'quarantine'};
 assert.match(preview(c,sheet(c,[openingRow()]),[lot,quarantine]).errors.join(' '),/missing/);
 assert.match(preview(c,sheet(c,[openingRow(),openingRow()])).errors.join(' '),/duplicated/);
 for(const [index,value] of [[1,1],[4,3],[6,'x']]){const row=openingRow();row[index]=value;assert.ok(preview(c,sheet(c,[row])).errors.length);}
});
test('opening FIFO dates are explicit and valid; weighted average permits absent acquisition date',()=>{
 const c=parser();assert.match(preview(c,sheet(c,[openingRow()]),[lot],'fifo').errors.join(' '),/FIFO/);
 for(const date of ['2026-11-02','2026-02-30',60])assert.ok(preview(c,sheet(c,[openingRow('100',date)]),[lot],'fifo').errors.length);
 assert.deepEqual(preview(c,sheet(c,[openingRow('100',cutover)]),[lot],'fifo').errors,[]);
 assert.deepEqual(preview(c,sheet(c,[openingRow()])).errors,[]);
});
test('opening formulas in data, cached empty rows and headers cannot pass as verified values',()=>{
 const c=parser(),data=sheet(c,[openingRow()]);data.F2.f='SUM(100,0.25)';assert.ok(preview(c,data).errors.length);
 const blank=sheet(c,[openingRow()]);blank.A3={t:'s',v:'',f:'IF(TRUE,"","")'};blank['!ref']='A1:H3';assert.ok(preview(c,blank).errors.length,'cached blank formula row must be rejected');
 const header=sheet(c,[openingRow()]);header.A1.f='"Lot UUID"';assert.ok(preview(c,header).errors.length,'cached header formula must be rejected');
});
test('actual XLSX reader preserves every lot beyond the financial-journal default row limit',async()=>{
 const c=parser(),lots=Array.from({length:1200},(_,i)=>({...lot,id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
 c.input=sheet(c,lots.map(l=>[l.id,l.version,l.product_name,'Godown / BATCH-1',l.quantity,'100.25','Verified purchase',cutover]));
 const bytes=vm.runInContext("(()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,input,'Stock');return XLSX.write(w,{type:'array',bookType:'xlsx'});})()",c);
 const workbook=await c.financialImportRead({name:'stock.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes},{maxRows:10000});
 const result=preview(c,workbook.Sheets.Stock,lots,'fifo');assert.deepEqual(result.errors,[]);assert.equal(result.entries.length,1200);assert.equal(result.totalMinor,'12030000');
});
test('receipt request identity is verified beyond its returned top-level fields',async()=>{
 for(const mutation of [saved=>saved.request_content.expected_version++,saved=>saved.request_content.lot_details.extra='unexpected']){
  const f=await fixture('receive');await f.valid();f.write=async(name,args)=>{const saved=plain(f.saved(name,args));mutation(saved);return {data:saved};};await f.submit();assert.ok(f.node('[data-books-posting-retry]'));
 }
});
test('receipt form bounds the purchase quantity and validates actual machine serial identities',async()=>{
 const f=await fixture('receive');await f.valid();f.field('quantity').value='11';await f.submit();assert.equal(f.writes().length,0);assert.match(f.summary.textContent,/exceeds/);
 f.field('quantity').value='2';f.data.purchase_order_lines[0].requires_serial=true;f.field('order').onchange();f.field('lot').value=lotId;f.field('lot').onchange();f.field('serials').value='ONE\none';await f.submit();assert.equal(f.writes().length,0);assert.match(f.summary.textContent,/unique/);
 f.field('serials').value='MACHINE-B\nMACHINE-A';await f.submit();assert.equal(f.writes().length,1);assert.deepEqual(f.writes()[0].args.p_serials,['MACHINE-B','MACHINE-A']);
});
test('inventory text is escaped and changed sessions or detached forms cannot confirm',async()=>{
 const f=await fixture('register');assert.equal(f.node('img'),null);assert.match(f.node('#booksBody').textContent,/<img src=x/);
 const g=await fixture('gain');await g.valid();g.c.me={user_id:'other'};await g.submit();assert.equal(g.writes().length,0);
 const h=await fixture('value');await h.valid();const wait=deferred();h.write=()=>wait.promise;const pending=h.submit();h.form.remove();const {name,args}=h.writes()[0];wait.resolve({data:h.saved(name,args)});await pending;assert.equal(h.form.nextElementSibling,null);
});
