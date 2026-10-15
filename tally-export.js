'use strict';
// Send an accepted Pro forma to TallyPrime as a Sales Order import file (TallyPrime: Import → Transactions).
// Accounts then make the tax invoice from that Sales Order; Tally fills Order No. with the Pro forma number, which links
// the invoice back to the ERP when it is imported under Tally invoices. The same file can later be posted to Tally by the
// in-house connector. The ERP remembers confirmed Tally names so nobody types them twice.
let tallyExportPending=null;
function tallyXmlEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function tallyMinorText(minor){const sign=minor<0?'-':'',abs=Math.abs(Math.round(minor));return `${sign}${Math.floor(abs/100)}.${String(abs%100).padStart(2,'0')}`;}
function tallyDateText(iso){return String(iso).slice(0,10).replace(/-/g,'');}
// Same arithmetic as save_sales_proforma: gross, rounded discount, then VAT on the discounted amount, per line.
function tallyLineAmounts(line){
 const gross=Number(line.quantity)*Number(line.unit_price_minor),discount=Math.round(gross*Number(line.discount_basis_points||0)/10000),net=gross-discount;
 return {gross,discount,net,tax:Math.round(net*Number(line.tax_basis_points||0)/10000)};
}
// The original Tally stock item name, when the product came from a Tally export.
function tallyDefaultItemName(product,saved){
 if(saved?.item_name)return saved.item_name;
 const raw=product?.source?.raw;
 if(product?.source?.source_file&&Array.isArray(raw)&&raw[0])return String(raw[0]).trim();
 return '';
}
function buildTallySalesOrderXml({proforma,lines,ledgerName,items,settings,date}){
 if(proforma.currency!=='TZS')throw Error('Only Pro formas in TZS can be sent to Tally for now.');
 if(!lines.length)throw Error('This Pro forma has no items.');
 const voucherType=settings.voucher_type||'Sales Order',number=proforma.document_number,day=tallyDateText(date);
 let net=0,tax=0;
 const inventory=lines.map(line=>{
  const item=items.get(line.product_id);if(!item?.item_name)throw Error('Every item needs its Tally stock item name.');
  const unit=(item.unit||line.uom||'').trim(),amounts=tallyLineAmounts(line),qty=`${line.quantity}${unit?' '+unit:''}`;net+=amounts.net;tax+=amounts.tax;
  return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${tallyXmlEscape(item.item_name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>${tallyMinorText(line.unit_price_minor)}${unit?'/'+tallyXmlEscape(unit):''}</RATE>${line.discount_basis_points?`<DISCOUNT>${(line.discount_basis_points/100).toFixed(2)}</DISCOUNT>`:''}<AMOUNT>${tallyMinorText(amounts.net)}</AMOUNT><ACTUALQTY>${tallyXmlEscape(qty)}</ACTUALQTY><BILLEDQTY>${tallyXmlEscape(qty)}</BILLEDQTY><BATCHALLOCATIONS.LIST><ORDERNO>${tallyXmlEscape(number)}</ORDERNO><ORDERDUEDATE>${day}</ORDERDUEDATE><AMOUNT>${tallyMinorText(amounts.net)}</AMOUNT><ACTUALQTY>${tallyXmlEscape(qty)}</ACTUALQTY><BILLEDQTY>${tallyXmlEscape(qty)}</BILLEDQTY></BATCHALLOCATIONS.LIST><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${tallyXmlEscape(settings.sales_ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${tallyMinorText(amounts.net)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
 }).join('');
 if(net+tax!==Number(proforma.total_minor))throw Error('Item totals do not match the Pro forma total. Refresh and try again.');
 const company=settings.company_name?`<STATICVARIABLES><SVCURRENTCOMPANY>${tallyXmlEscape(settings.company_name)}</SVCURRENTCOMPANY></STATICVARIABLES>`:'';
 const narration=`ERP ${number}${proforma.acceptance_reference?' · Customer reference '+proforma.acceptance_reference:''}`;
 return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${tallyXmlEscape(voucherType)}" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>${day}</DATE><VOUCHERTYPENAME>${tallyXmlEscape(voucherType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${tallyXmlEscape(number)}</VOUCHERNUMBER><REFERENCE>${tallyXmlEscape(number)}</REFERENCE><PARTYLEDGERNAME>${tallyXmlEscape(ledgerName)}</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>${tallyXmlEscape(narration)}</NARRATION>${inventory}<LEDGERENTRIES.LIST><LEDGERNAME>${tallyXmlEscape(ledgerName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${tallyMinorText(-(net+tax))}</AMOUNT></LEDGERENTRIES.LIST>${tax?`<LEDGERENTRIES.LIST><LEDGERNAME>${tallyXmlEscape(settings.vat_ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${tallyMinorText(tax)}</AMOUNT></LEDGERENTRIES.LIST>`:''}</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}
async function tallySha256(text){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}
function tallyDownload(name,text){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type:'application/xml'}));link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
async function openSendToTally(proformaId){
 const proforma=typeof salesProforma==='function'?salesProforma(proformaId):null;if(!proforma)return;
 if(proforma.status!=='accepted')throw Error('Only an accepted Pro forma can be sent to Tally.');
 const actor=me?.user_id,lines=salesLines(proforma.id),productIds=[...new Set(lines.map(l=>l.product_id))];
 const [access,settingsRows,ledger,itemRows,exports]=await Promise.all([
  client.rpc('tally_invoice_staff'),client.from('tally_export_settings').select('*').order('version',{ascending:false}).limit(1),
  client.from('tally_ledger_names').select('ledger_name').eq('organization_id',proforma.organization_id).maybeSingle(),
  client.from('tally_item_names').select('product_id,item_name,unit').in('product_id',productIds),
  client.from('tally_exports').select('exported_by,exported_at').eq('proforma_id',proforma.id).order('exported_at',{ascending:false}).limit(1)]);
 if(me?.user_id!==actor)return;
 for(const r of [settingsRows,ledger,itemRows,exports])if(r.error)throw Error(r.error.message);
 if(access.data!==true)throw Error('Only the owner or accounts staff can send Pro formas to Tally.');
 const settings=settingsRows.data?.[0]||null,saved=new Map((itemRows.data||[]).map(r=>[r.product_id,r])),org=salesOrganization(proforma.organization_id),last=exports.data?.[0];
 const lineRows=lines.map((line,i)=>{const product=products.find(p=>p.id===line.product_id),name=tallyDefaultItemName(product,saved.get(line.product_id)),erpName=typeof reviewedCatalogProduct==='function'&&product?reviewedCatalogProduct(product).name:product?.name;
  return `<tr data-tally-line="${esc(line.product_id)}"><td>${esc(erpName||'Product')}<small>${esc(line.quantity)} ${esc(line.uom)} · ${esc(moneyDisplay(tallyLineAmounts(line).net,proforma.currency))}</small>${name?'':'<small class="overdue">Not from Tally — enter the exact Tally stock item name, or create the item in Tally first</small>'}</td><td><input name="item-${i}" value="${esc(name)}" required maxlength="300" aria-label="Tally stock item name"></td><td><input name="unit-${i}" value="${esc(saved.get(line.product_id)?.unit||String(line.uom||'').toUpperCase())}" maxlength="30" aria-label="Tally unit"></td></tr>`;}).join('');
 const fields=`<p><strong>${esc(proforma.document_number)}</strong> · ${esc(org.name)} · ${esc(moneyDisplay(Number(proforma.total_minor),proforma.currency))}</p>${last?`<p class="notice">Already sent to Tally by ${esc(employeeName(last.exported_by))} on ${esc(new Date(last.exported_at).toLocaleString())}. Sending again creates a second Sales Order in Tally unless the first is deleted there.</p>`:''}<p class="muted">Names must match TallyPrime exactly, or Tally rejects the import. They are remembered for next time.</p><label><span>Customer ledger name in Tally</span><input name="ledger" required maxlength="200" value="${esc(ledger.data?.ledger_name||org.name||'')}"></label><div class="table-wrap"><table><thead><tr><th>Item in the ERP</th><th>Stock item name in Tally</th><th>Unit in Tally</th></tr></thead><tbody>${lineRows}</tbody></table></div><details ${settings?'':'open'}><summary>Tally company and ledgers${settings?` · ${esc(settings.voucher_type)} · ${esc(settings.sales_ledger)} · ${esc(settings.vat_ledger)}`:' · set once'}</summary><label><span>Company name in Tally · optional</span><input name="company" maxlength="200" value="${esc(settings?.company_name||'')}"></label><label><span>Voucher type</span><input name="voucherType" required maxlength="100" value="${esc(settings?.voucher_type||'Sales Order')}"></label><label><span>Sales ledger</span><input name="salesLedger" required maxlength="200" value="${esc(settings?.sales_ledger||'')}"></label><label><span>VAT ledger</span><input name="vatLedger" required maxlength="200" value="${esc(settings?.vat_ledger||'')}"></label></details><p class="muted">In TallyPrime: Import → Transactions → choose the downloaded file. Then make the tax invoice from this Sales Order; its Order No. will be ${esc(proforma.document_number)}.</p>`;
 actionForm('Send Pro forma to Tally',fields,async values=>{
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the Pro forma.');
  let current=settings;
  const wanted={company_name:String(values.company||'').trim(),voucher_type:String(values.voucherType||'').trim(),sales_ledger:String(values.salesLedger||'').trim(),vat_ledger:String(values.vatLedger||'').trim()};
  if(!wanted.voucher_type||!wanted.sales_ledger||!wanted.vat_ledger)throw Error('Enter the voucher type, sales ledger and VAT ledger used in Tally.');
  if(!current||['company_name','voucher_type','sales_ledger','vat_ledger'].some(k=>current[k]!==wanted[k])){
   const r=await client.rpc('save_tally_export_settings',{p_expected_version:current?.version||0,p_company_name:wanted.company_name,p_voucher_type:wanted.voucher_type,p_sales_ledger:wanted.sales_ledger,p_vat_ledger:wanted.vat_ledger});
   if(r.error)throw Error(r.error.message);current=Array.isArray(r.data)?r.data[0]:r.data;
  }
  const items=new Map(lines.map((line,i)=>[line.product_id,{product_id:line.product_id,item_name:String(values[`item-${i}`]||'').trim(),unit:String(values[`unit-${i}`]||'').trim()}]));
  const ledgerName=String(values.ledger||'').trim();if(!ledgerName)throw Error('Enter the customer ledger name in Tally.');
  const xml=buildTallySalesOrderXml({proforma,lines,ledgerName,items,settings:current,date:new Date().toISOString().slice(0,10)}),hash=await tallySha256(xml);
  if(tallyExportPending?.hash!==hash||tallyExportPending.proforma!==proforma.id)tallyExportPending={hash,proforma:proforma.id,id:crypto.randomUUID()};
  const r=await client.rpc('record_tally_export',{p_id:tallyExportPending.id,p_proforma_id:proforma.id,p_expected_version:proforma.version,p_voucher_type:current.voucher_type,p_content_sha256:hash,p_ledger_name:ledgerName,p_items:[...items.values()]});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing was downloaded.');
  if(r.error)throw Error(r.error.message);
  tallyExportPending=null;tallyDownload(`${proforma.document_number}-tally.xml`,xml);
  message(`${proforma.document_number} file for Tally downloaded. Import it in TallyPrime: Import → Transactions.`);
 });
}
