// Actual quotation, pricing, discount approval, invoice and return RPCs in disposable PostgreSQL.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';

const {db,id,OWNER,SALES,ACCOUNTS,PACKER,DRIVER,OUTSIDER,ORG,CONTACT,MACHINE,REAGENT,as,admin,one,dates,load}=await createOrderFixture({
 extraMigrations:['202610180107_partial_order_invoices.sql','202610180108_invoice_quantity_delivery.sql','202610180110_return_credit_rounding.sql',
  '202610200116_customer_contracts.sql','202610200117_proforma_commercial_terms.sql','202610200119_product_pricing_control.sql']
});
let number=7000;
const next=()=>id(number++);
const terms={currency:'TZS',import_price_basis:'gross',tax_basis_points:1800,gross_price_minor:10000000,import_net_price_minor:8474576};
const line={productId:REAGENT,description:'Synthetic reagent',uom:'pack',quantity:5,unitPriceMinor:8474576,discountBasisPoints:0,taxBasisPoints:1800};
const amounts=row=>[row.subtotal_minor,row.discount_minor,row.tax_minor,row.total_minor];
const source=(product,value)=>admin('update products set source=$2::jsonb where id=$1',[product,JSON.stringify(value)]);
const setPrice=async(product,price,version=0,currency='TZS')=>{
 await as(OWNER);
 await db.query('select set_product_sale_price($1,$2,$3,$4,$5,$6)',[next(),product,currency,version,price,'Synthetic approved price']);
};
const save=(items,currency='TZS',key=next(),version=0)=>one('select * from save_sales_proforma($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
 [key,version,ORG,CONTACT,currency,dates.valid,'Seven days','Payment on delivery','VAT fixture',JSON.stringify(items)]);
const snapshot=async pf=>(await one('select snapshot from sales_proforma_revisions where proforma_id=$1 and revision=$2',[pf.id,pf.revision])).snapshot;
const invoice=(pf,lineId,qty)=>one('select * from invoice_order_quantities($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',
 [next(),pf.id,pf.version,dates.today,dates.valid,JSON.stringify([{proforma_line_id:lineId,quantity:qty}]),'Fixture approval',dates.delivery,'']);
const advance=(note,action)=>one('select * from advance_sales_delivery($1,$2,$3,$4,$5,$6,$7)',[note.id,note.version,action,'Fixture truck','Fixture route','Fixture recipient','Fixture delivery proof']);
try{
 await admin("alter table products add column source jsonb not null default '{}'");
 await setPrice(REAGENT,line.unitPriceMinor);
 await as(SALES);
 const historical=await save([line]),before=await snapshot(historical);
 let legacyOrder=await save([{...line,quantity:3}]);
 for(const action of ['send','accept'])legacyOrder=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[legacyOrder.id,legacyOrder.version,action,'Fixture customer '+action]);
 assert.deepEqual(amounts(historical),[42372880,0,7627118,49999998]);
 await db.exec('reset role');
 await load('202611200167_workbook_vat.sql');
 await db.exec('set role authenticated');
 await source(REAGENT,terms);
 assert.deepEqual(await snapshot(historical),before);
 await as(ACCOUNTS);
 const legacyLine=await one('select id from sales_proforma_lines where proforma_id=$1',[legacyOrder.id]);
 const legacyInvoice=await invoice(legacyOrder,legacyLine.id,3);
 assert.deepEqual(amounts(legacyInvoice),amounts(legacyOrder));
 assert.equal(Object.hasOwn(legacyInvoice.lines[0],'gross_unit_price_minor'),false);
 await as(SALES);
 assert.equal((await one('select gross_unit_price_minor from sales_proforma_lines where proforma_id=$1',[historical.id])).gross_unit_price_minor,null);
 await assert.rejects(save([{...line,taxBasisPoints:0}]),/VAT rate changed/);
 await assert.rejects(save([{...line,grossUnitPriceMinor:9999999}]),/VAT-inclusive product price changed/);
 await assert.rejects(save([{...line,unitPriceMinor:1234}]),/configured TZS product price/);
 await as(OUTSIDER);await assert.rejects(save([line]),/access/);await as(SALES);
 const revised=await save([line],'TZS',historical.id,historical.version);
 assert.deepEqual(amounts(revised),[42372881,0,7627119,50000000]);
 assert.equal((await snapshot(revised)).lines[0].grossUnitPriceMinor,terms.gross_price_minor);
 assert.deepEqual(await snapshot(historical),before);
 const verified=await save([{...line,grossUnitPriceMinor:terms.gross_price_minor}]);
 assert.deepEqual(amounts(verified),amounts(revised));
 await assert.rejects(admin('update sales_proforma_lines set tax_basis_points=0 where proforma_id=$1',[verified.id]),/VAT rate changed/);
 await assert.rejects(admin('update sales_proforma_lines set gross_unit_price_minor=null where proforma_id=$1',[verified.id]),/current VAT-inclusive product price/);
 await setPrice(MACHINE,150);
 await source(MACHINE,{tax_basis_points:0});
 await as(SALES);
 const exempt={...line,productId:MACHINE,unitPriceMinor:150,taxBasisPoints:0,quantity:2};
 await assert.rejects(save([line,{...exempt,taxBasisPoints:1800}]),/VAT rate changed/);
 const mixed=await save([line,exempt]);
 assert.deepEqual(amounts(mixed),[42373181,0,7627119,50000300]);
 assert.equal(Object.hasOwn((await snapshot(mixed)).lines[1],'grossUnitPriceMinor'),false);
 await source(MACHINE,{tax_basis_points:null});
 assert.equal((await save([{...exempt,taxBasisPoints:700}])).total_minor,321);
 await setPrice(REAGENT,200,0,'USD');
 await as(SALES);
 const usdLine={...line,unitPriceMinor:200};
 assert.equal((await save([usdLine],'USD')).total_minor,1180);
 await source(REAGENT,{...terms,currency:'USD',import_net_price_minor:200,gross_price_minor:236});
 assert.equal((await snapshot(await save([usdLine],'USD'))).lines[0].grossUnitPriceMinor,236);
 await source(REAGENT,{...terms,gross_price_minor:1});
 await assert.rejects(save([line]),/needs review/);
 await source(REAGENT,terms);
 await setPrice(REAGENT,1800,1);
 await as(SALES);
 const changed={...line,unitPriceMinor:1800};
 assert.equal((await save([changed])).total_minor,10620);
 await assert.rejects(save([{...changed,grossUnitPriceMinor:terms.gross_price_minor}]),/VAT-inclusive product price changed/);
 const contract=await one("select * from save_customer_contract($1,$2,0,$3,'placement','Fixture placement','Fixture contract',current_date,null,'Fixture terms')",[next(),next(),ORG]);
 const placement=await one("select * from save_sales_proforma($1,0,$2,$3,'EUR',current_date+30,'Seven days','Placement terms','',$4::jsonb,'placement',$5,true,'','')",
  [next(),ORG,CONTACT,JSON.stringify([{...exempt,unitPriceMinor:0}]),contract.id]);
 assert.equal(placement.total_minor,0);
 // This gross cannot be reproduced even at quantity one from its rounded net (3 + round(3 × 18%) = 4).
 await source(REAGENT,{...terms,gross_price_minor:3,import_net_price_minor:3});
 await setPrice(REAGENT,3,2);await as(SALES);
 const small={...line,unitPriceMinor:3,quantity:1};
 assert.deepEqual(amounts(await save([small])),[3,0,0,3]);
 // Discounts are approved against the net discount value stored for this revision.
 await source(REAGENT,terms);await setPrice(REAGENT,line.unitPriceMinor,3);await as(SALES);
 let order=await save([{...line,discountBasisPoints:777}]);
 assert.deepEqual(amounts(order),[42372881,3292373,7034492,46115000]);
 await assert.rejects(db.query("select advance_sales_proforma($1,$2,'send','Fixture customer')",[order.id,order.version]),/has a discount/);
 await as(OWNER);
 const approval=await one("select * from decide_proforma_discount($1,$2,$3,'approved','Approved fixture discount')",[next(),order.id,order.version]);
 assert.equal(approval.discount_minor,order.discount_minor);
 await as(SALES);
 for(const action of ['send','accept'])order=await one('select * from advance_sales_proforma($1,$2,$3,$4)',[order.id,order.version,action,'Fixture customer '+action]);
 await as(ACCOUNTS);
 const savedLine=await one('select * from sales_proforma_lines where proforma_id=$1',[order.id]);
 // Changing today's catalogue must never reprice posted quantities on an accepted order.
 await source(REAGENT,{tax_basis_points:0});
 const first=await invoice(order,savedLine.id,2),second=await invoice(order,savedLine.id,3);
 assert.deepEqual([first.total_minor,second.total_minor],[18446000,27669000]);
 assert.deepEqual(amounts(first).map((amount,i)=>amount+amounts(second)[i]),amounts(order));
 assert.equal(second.lines[0].gross_unit_price_minor,terms.gross_price_minor);
 assert.deepEqual(second.lines[0].allocation_ranges,[[2,5]]);
 let note=await one('select * from sales_delivery_notes where invoice_id=$1',[second.id]);
 note=await advance(note,'send_to_sales');await as(PACKER);note=await one('select * from packing_take_next()');
 assert.equal(note.invoice_id,second.id);
 note=await one('select * from packing_mark_packed($1,$2)',[note.id,note.version]);
 await as(DRIVER);note=await advance(note,'dispatch');
 const proof=next(),path='delivery/'+note.id+'/'+proof+'.pdf';
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,$3::jsonb)",[path,DRIVER,JSON.stringify({size:321,mimetype:'application/pdf'})]);
 await db.query('select finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[proof,'delivery',note.id,path,'Fixture.pdf','application/pdf',321]);
 note=await advance(note,'deliver');await as(ACCOUNTS);
 const delivered=await one('select * from sales_delivery_lines where delivery_note_id=$1',[note.id]);
 const credited=[];
 for(const quantity of [1,2]){
  const ret=await one("select * from record_sales_return($1,$2,'unopened','Fixture return','',$3::jsonb)",[next(),note.id,JSON.stringify([{deliveryLineId:delivered.id,quantity}])]);
  const draft=await one('select * from create_return_credit_note($1,$2,$3)',[ret.id,ret.version,next()]);
  credited.push(draft.body.lines[0]);
 }
 assert.equal(credited.reduce((sum,item)=>sum+item.netMinor,0),second.subtotal_minor-second.discount_minor);
 assert.equal(credited.reduce((sum,item)=>sum+item.taxMinor,0),second.tax_minor);
 for(const role of ['anon','authenticated']){
  for(const signature of ['quote_workbook_gross(jsonb,text,bigint,integer,jsonb)','sales_line_amounts(integer,integer,bigint,integer,integer,bigint)']){
   assert.equal((await one('select has_function_privilege($1,$2,$3) allowed',[role,signature,'execute'])).allowed,false);
  }
 }
 console.log('Workbook VAT database checks passed, including immutable revisions, mixed rates, prices, discounts, split invoicing and partial returns.');
}finally{await db.close();}
