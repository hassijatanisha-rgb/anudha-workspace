'use strict';
// Tax invoices are made in Tally and flow in here. Owner or accounts staff upload Tally's XML export (Day Book or
// Sales Register → Export → XML); the in-house connector will later send the same rows automatically. Each invoice is
// linked to its ERP Pro forma by the number typed in Tally's Order No. or Reference. Register only: nothing here
// changes stock, prices or delivery status.
let tallyInvoiceFilter='unmatched',tallyInvoiceSearch='',tallyInvoicePage=0,tallyInvoiceLoaded=false,tallyInvoiceError='',tallyInvoiceEpoch=0;
let tallyInvoices=[],tallyInvoiceProformas=[],tallyInvoiceCanManage=false;
const tallyInvoiceStatuses={matched:'Linked to Pro forma',unmatched:'Needs linking',ignored:'Not from a Pro forma'};
function clearTallyInvoices(){tallyInvoiceEpoch++;tallyInvoiceLoaded=false;tallyInvoices=[];tallyInvoiceProformas=[];tallyInvoiceCanManage=false;}

// Tally writes amounts like "-1180.00", "1,180.00" or "-$100.00 @ TZS 2500/$ = -TZS 250000.00" (base currency after "=").
function tallyAmountMinor(text){
 const value=String(text??'').split('=').pop().replace(/[^0-9.\-]/g,'');
 if(!/\d/.test(value))return null;
 const number=Math.abs(Number(value));return Number.isFinite(number)?Math.round(number*100):null;
}
function tallyQuantity(text){const m=String(text??'').trim().match(/^(-?[\d,]*\.?\d+)\s*([A-Za-z][A-Za-z.]*)?/);return m?{quantity:Math.abs(Number(m[1].replace(/,/g,''))),unit:(m[2]||'').toUpperCase()}:{quantity:null,unit:''};}
function tallyDate(text){const m=String(text??'').trim().match(/^(\d{4})(\d{2})(\d{2})$/);return m?`${m[1]}-${m[2]}-${m[3]}`:null;}
function tallyText(node,tag){return node.getElementsByTagName(tag)[0]?.textContent?.trim()||'';}
function tallyChildren(node,tags){return tags.flatMap(tag=>[...node.getElementsByTagName(tag)]);}
// Sales invoices only: sales orders, delivery notes, credit notes and receipts are skipped and counted.
function tallyIsSalesInvoice(type){return /sales|tax invoice|invoice/i.test(type)&&!/order|credit|debit|delivery|receipt|return/i.test(type);}
function parseTallyInvoicesXml(text){
 const doc=new DOMParser().parseFromString(String(text).replace(/&#4;/g,''),'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw Error('This is not a Tally XML export. In Tally use Export → XML (Data Interchange).');
 const vouchers=[...doc.getElementsByTagName('VOUCHER')];
 if(!vouchers.length)throw Error('No vouchers found. Export the Day Book or Sales Register from Tally as XML.');
 const rows=[],skipped={},seen=new Set();
 for(const v of vouchers){
  const type=tallyText(v,'VOUCHERTYPENAME')||v.getAttribute('VCHTYPE')||'';
  if(!tallyIsSalesInvoice(type)){skipped[type||'Unknown']=(skipped[type||'Unknown']||0)+1;continue;}
  const number=tallyText(v,'VOUCHERNUMBER'),date=tallyDate(tallyText(v,'DATE')),party=tallyText(v,'PARTYLEDGERNAME')||tallyText(v,'PARTYNAME');
  if(!number||!date)throw Error(`A ${type} voucher has no number or date; check the export.`);
  const orderNos=tallyChildren(v,['INVOICEORDERLIST.LIST']).map(o=>tallyText(o,'BASICPURCHASEORDERNO')).filter(Boolean);
  const reference=[...orderNos,tallyText(v,'REFERENCE')].filter(Boolean).join(' · ');
  const lines=tallyChildren(v,['ALLINVENTORYENTRIES.LIST','INVENTORYENTRIES.LIST']).map(e=>{const q=tallyQuantity(tallyText(e,'BILLEDQTY')||tallyText(e,'ACTUALQTY'));return {item:tallyText(e,'STOCKITEMNAME'),quantity:q.quantity,unit:q.unit,rate_minor:tallyAmountMinor(tallyText(e,'RATE').split('/')[0]),amount_minor:tallyAmountMinor(tallyText(e,'AMOUNT'))};}).filter(l=>l.item);
  const ledgers=tallyChildren(v,['LEDGERENTRIES.LIST','ALLLEDGERENTRIES.LIST']).map(e=>({name:tallyText(e,'LEDGERNAME'),amount:tallyAmountMinor(tallyText(e,'AMOUNT'))}));
  const partyEntry=ledgers.find(l=>l.name===party),vat=ledgers.filter(l=>l.name!==party&&/vat|tax/i.test(l.name)).reduce((s,l)=>s+(l.amount||0),0);
  const net=lines.length?lines.reduce((s,l)=>s+(l.amount_minor||0),0):null;
  const key=(tallyText(v,'GUID')||'')+'|'+type+'|'+number+'|'+date;if(seen.has(key))continue;seen.add(key);
  rows.push({tally_guid:tallyText(v,'GUID')||null,voucher_number:number,voucher_date:date,voucher_type:type,party_name:party,order_reference:reference.slice(0,300),currency:'TZS',
   net_minor:net,vat_minor:vat||(partyEntry&&net!=null&&partyEntry.amount>=net?partyEntry.amount-net:null),total_minor:partyEntry?.amount??null,lines:lines.slice(0,500),
   narration:tallyText(v,'NARRATION').slice(0,2000),cancelled:/^yes$/i.test(tallyText(v,'ISCANCELLED'))||/^yes$/i.test(tallyText(v,'ISDELETED'))});
 }
 return {rows,skipped};
}
async function importTallyInvoiceFile(file){
 const {rows,skipped}=parseTallyInvoicesXml(await file.text()),actor=me?.user_id,total={rows:0,new:0,changed:0,unchanged:0,matched:0};
 if(!rows.length)throw Error(`No sales invoices in this file${Object.keys(skipped).length?` (skipped: ${Object.entries(skipped).map(([k,n])=>`${n} ${k}`).join(', ')})`:''}.`);
 for(let i=0;i<rows.length;i+=500){
  message(`Importing Tally invoices… ${i} of ${rows.length}`);
  const result=await client.rpc('import_tally_invoices',{p_rows:rows.slice(i,i+500),p_source:'upload'});
  if(me?.user_id!==actor)throw Error('Login changed. Import stopped; upload the same file again to finish.');
  if(result.error)throw Error(`Stopped at invoice ${i+1}: ${result.error.message}. Upload the same file again; finished invoices are not duplicated.`);
  for(const key of Object.keys(total))total[key]+=Number(result.data?.[key]||0);
 }
 const skippedText=Object.entries(skipped).map(([k,n])=>`${n} ${k}`).join(', ');
 return `Tally invoices: ${total.new} new (${total.matched} linked automatically), ${total.changed} changed in Tally, ${total.unchanged} already here.${skippedText?` Skipped, not sales invoices: ${skippedText}.`:''}`;
}
function tallyInvoiceProforma(id){return tallyInvoiceProformas.find(p=>p.id===id);}
function tallyInvoiceMoney(minor,currency){return minor==null?'—':new Intl.NumberFormat('en-TZ',{style:'currency',currency:currency||'TZS'}).format(Number(minor)/100);}
function tallyInvoiceVisible(rows,{filter,search}){
 const q=String(search||'').trim().toLowerCase();
 return rows.filter(r=>filter==='all'||r.match_status===filter)
  .filter(r=>!q||[r.voucher_number,r.party_name,r.order_reference,r.narration,tallyInvoiceProforma(r.proforma_id)?.document_number,...(r.lines||[]).map(l=>l.item)].join(' ').toLowerCase().includes(q))
  .sort((a,b)=>String(b.voucher_date).localeCompare(String(a.voucher_date))||String(b.voucher_number).localeCompare(String(a.voucher_number),undefined,{numeric:true}));
}
// Shown on Pro forma cards so sales can see the order was invoiced in Tally.
function tallyInvoicesForProforma(proformaId){return tallyInvoices.filter(r=>r.proforma_id===proformaId&&!r.cancelled);}
async function loadTallyInvoices(){
 const epoch=++tallyInvoiceEpoch,actor=me?.user_id;
 const [rows,proformas,access]=await Promise.all([all('tally_sales_invoices','*'),all('sales_proformas','id,document_number,organization_id,status,total_minor,tax_minor,currency,deleted_at'),client.rpc('tally_invoice_staff')]);
 if(epoch!==tallyInvoiceEpoch||me?.user_id!==actor)return false;
 tallyInvoices=rows;tallyInvoiceProformas=proformas.filter(p=>!p.deleted_at);tallyInvoiceCanManage=access.data===true;tallyInvoiceLoaded=true;tallyInvoiceError='';return true;
}
async function tallyInvoicesWorkspace(force=false){
 const actor=me?.user_id;syncWorkspaceNavigation();
 if(force||!tallyInvoiceLoaded){
  $('#content').innerHTML='<p role="status">Loading Tally invoices…</p>';
  try{if(!(await loadTallyInvoices()))return;}catch(error){if(me?.user_id!==actor)return;tallyInvoiceError=error.message;tallyInvoiceLoaded=false;}
 }
 if(view!=='tallyinvoices'||me?.user_id!==actor)return;
 renderTallyInvoices();
}
function tallyInvoiceRow(r){
 const pf=tallyInvoiceProforma(r.proforma_id),org=pf&&typeof salesOrganization==='function'?salesOrganization(pf.organization_id):null,actions=[];
 if(tallyInvoiceCanManage){
  if(r.match_status!=='matched')actions.push(`<button type="button" data-tally-invoice-action="match" data-id="${esc(r.id)}">Link to Pro forma</button>`);
  if(r.match_status==='matched')actions.push(`<button type="button" data-tally-invoice-action="unmatch" data-id="${esc(r.id)}">Remove link</button>`);
  if(r.match_status==='unmatched')actions.push(`<button type="button" data-tally-invoice-action="ignore" data-id="${esc(r.id)}">Not from a Pro forma</button>`);
 }
 return `<tr class="${r.match_status==='unmatched'?'quality-yellow':''}${r.cancelled?' tally-cancelled':''}"><td><strong>${esc(r.voucher_number)}</strong><small>${esc(r.voucher_date)} · ${esc(r.voucher_type)}${r.cancelled?' · Cancelled in Tally':''}</small></td><td>${esc(r.party_name||'—')}</td><td>${esc(r.order_reference||'—')}</td><td>${esc(tallyInvoiceMoney(r.total_minor,r.currency))}${r.vat_minor?`<small>VAT ${esc(tallyInvoiceMoney(r.vat_minor,r.currency))}</small>`:''}</td><td><span class="tag">${esc(tallyInvoiceStatuses[r.match_status])}</span>${pf?`<small>${esc(pf.document_number)}${org?' · '+esc(org.name):''}</small>`:''}<small>${esc(r.match_note)}</small></td><td><details><summary>${(r.lines||[]).length} item${(r.lines||[]).length===1?'':'s'}</summary><ul>${(r.lines||[]).map(l=>`<li>${esc(l.item)} · ${esc(l.quantity??'?')} ${esc(l.unit||'')} · ${esc(tallyInvoiceMoney(l.amount_minor,r.currency))}</li>`).join('')}</ul></details></td><td><div class="actions">${actions.join('')}</div></td></tr>`;
}
function renderTallyInvoices(){
 const rows=tallyInvoiceVisible(tallyInvoices,{filter:tallyInvoiceFilter,search:tallyInvoiceSearch}),pages=Math.max(1,Math.ceil(rows.length/50));tallyInvoicePage=Math.min(Math.max(tallyInvoicePage,0),pages-1);
 const counts={unmatched:0,matched:0,ignored:0};for(const r of tallyInvoices)counts[r.match_status]++;
 $('#content').innerHTML=`<section class="tally-invoices-workspace"><div class="heading"><div><small>ORDERS · FROM TALLY</small><h1>Tally invoices</h1><p class="muted">Invoices made in TallyPrime. Put the Pro forma number (for example PF-2026-000012) in Tally's Order No. so the invoice links to its order.</p></div><div class="actions"><button type="button" id="tallyInvoiceRefresh">Refresh</button>${tallyInvoiceCanManage?'<button type="button" id="tallyTestInvoice">Make TEST invoice</button>':''}${tallyInvoiceCanManage?'<label class="file-button"><span>Upload Tally XML export</span><input type="file" id="tallyInvoiceFile" accept=".xml,text/xml,application/xml"></label>':''}</div></div>${tallyInvoiceError?`<p class="notice error" role="alert">Tally invoices could not load: ${esc(tallyInvoiceError)}. Nothing was changed.</p>`:''}<div class="help-strip"><strong>${counts.unmatched} need linking · ${counts.matched} linked · ${counts.ignored} not ERP orders</strong><span></span></div><div class="tabs" role="group" aria-label="Filter Tally invoices">${[['unmatched','Needs linking'],['matched','Linked'],['ignored','Not from a Pro forma'],['all','All']].map(([k,l])=>`<button type="button" data-tally-invoice-filter="${k}" class="${tallyInvoiceFilter===k?'active':''}" aria-pressed="${tallyInvoiceFilter===k}">${l}</button>`).join('')}</div><label class="search"><span>Search</span><input id="tallyInvoiceSearch" type="search" placeholder="Invoice number, customer, Pro forma or item" value="${esc(tallyInvoiceSearch)}"></label>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer in Tally</th><th>Order No. / Reference</th><th>Total</th><th>ERP order</th><th>Items</th><th></th></tr></thead><tbody>${rows.slice(tallyInvoicePage*50,tallyInvoicePage*50+50).map(tallyInvoiceRow).join('')}</tbody></table></div>`:`<p class="muted">${tallyInvoices.length?'No invoices here.':'No Tally invoices yet. Export the Day Book or Sales Register from Tally as XML and upload it.'}</p>`}${pages>1?`<div class="actions"><button type="button" id="tallyInvoicePrev" ${tallyInvoicePage===0?'disabled':''}>Previous</button><span>Page ${tallyInvoicePage+1} of ${pages}</span><button type="button" id="tallyInvoiceNext" ${tallyInvoicePage>=pages-1?'disabled':''}>Next</button></div>`:''}</section>`;
 bindTallyInvoices();
 const test=$('#tallyTestInvoice');if(test)test.onclick=()=>openTallyTestInvoice();
}
// Until Tally is connected: a clearly marked TEST invoice for a Pro forma, so the order can be followed through
// accounts, stores and delivery. It goes through the same import as a real Tally invoice and links by Pro forma
// number. Voucher type "TEST Sales" and number TEST-… mark it; these are removed before real use.
function openTallyTestInvoice(){
 const ready=tallyInvoiceProformas.filter(p=>!['draft','cancelled','rejected'].includes(p.status)&&!tallyInvoices.some(i=>i.proforma_id===p.id&&!i.cancelled));
 if(!ready.length)return message('No Pro forma is waiting for an invoice. Send a Pro forma to accounting first.',true);
 const name=p=>(typeof organizations!=='undefined'&&organizations.find(o=>o.id===p.organization_id)?.name)||'';
 const fields=`<p class="notice">TEST only. This is not a tax invoice and must never be given to a client.</p><label><span>Pro forma</span><select name="proforma" required><option value="">Choose a Pro forma</option>${ready.map(p=>`<option value="${esc(p.id)}">${esc(p.document_number)} · ${esc(name(p))} · ${esc(tallyInvoiceMoney(p.total_minor,p.currency))}</option>`).join('')}</select></label>`;
 actionForm('Make TEST invoice',fields,async values=>{
  const p=ready.find(r=>r.id===values.proforma);if(!p)throw Error('Choose a Pro forma.');
  const total=Number(p.total_minor)||0,vat=Number(p.tax_minor)||0;
  const row={voucher_number:`TEST-${p.document_number}`,voucher_date:new Date().toISOString().slice(0,10),voucher_type:'TEST Sales',party_name:name(p),order_reference:p.document_number,currency:p.currency||'TZS',net_minor:total-vat,vat_minor:vat,total_minor:total,lines:[],narration:'TEST INVOICE - NOT A REAL TAX INVOICE'};
  const r=await client.rpc('import_tally_invoices',{p_rows:[row],p_source:'upload'});if(r.error)throw Error(r.error.message);
  await tallyInvoicesWorkspace(true);message(`TEST invoice ${row.voucher_number} made and linked to ${p.document_number}.`);
 });
}
function openTallyInvoiceAction(invoice,action){
 if(!invoice)return;
 const titles={match:'Link Tally invoice to a Pro forma',unmatch:'Remove link to Pro forma',ignore:'Mark as not an ERP order'};
 const options=tallyInvoiceProformas.filter(p=>p.status!=='cancelled').sort((a,b)=>String(b.document_number).localeCompare(String(a.document_number))).map(p=>{const org=typeof salesOrganization==='function'?salesOrganization(p.organization_id):null;return `<option value="${esc(p.document_number+' · '+(org?.name||'')+' · '+tallyInvoiceMoney(p.total_minor,p.currency))}"></option>`;}).join('');
 const fields=`<p><strong>${esc(invoice.voucher_number)}</strong> · ${esc(invoice.voucher_date)} · ${esc(invoice.party_name||'')} · ${esc(tallyInvoiceMoney(invoice.total_minor,invoice.currency))}</p>${action==='match'?`<label><span>Pro forma</span><input name="proforma" list="tallyInvoiceProformaChoices" required autocomplete="off" placeholder="PF-2026-…"></label><datalist id="tallyInvoiceProformaChoices">${options}</datalist>`:''}<label><span>${action==='match'?'Note · optional':action==='ignore'?'Why is there no ERP order? (for example cash sale)':'Why remove the link?'}</span><textarea name="note" maxlength="500" ${action==='match'?'':'required minlength="3"'}></textarea></label>`;
 actionForm(titles[action],fields,async values=>{
  let proformaId=null;
  if(action==='match'){const number=String(values.proforma||'').split(' · ')[0].trim().toUpperCase(),pf=tallyInvoiceProformas.find(p=>p.document_number===number);if(!pf)throw Error('Choose a Pro forma from the list.');proformaId=pf.id;}
  const actor=me?.user_id,result=await client.rpc('review_tally_invoice',{p_id:invoice.id,p_expected_version:invoice.version,p_action:action,p_proforma_id:proformaId,p_note:values.note||''});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen Tally invoices.');
  if(result.error)throw Error(result.error.message);
  await tallyInvoicesWorkspace(true);message(`${invoice.voucher_number}: ${titles[action].toLowerCase()} saved.`);
 });
}
function bindTallyInvoices(){
 $('#tallyInvoiceRefresh').onclick=()=>run(()=>tallyInvoicesWorkspace(true));
 const file=$('#tallyInvoiceFile');if(file)file.onchange=()=>{const chosen=file.files[0];if(chosen)run(async()=>{const summary=await importTallyInvoiceFile(chosen);await tallyInvoicesWorkspace(true);message(summary);});};
 document.querySelectorAll('[data-tally-invoice-filter]').forEach(b=>b.onclick=()=>{tallyInvoiceFilter=b.dataset.tallyInvoiceFilter;tallyInvoicePage=0;renderTallyInvoices();});
 $('#tallyInvoiceSearch').oninput=e=>{tallyInvoiceSearch=e.target.value;tallyInvoicePage=0;renderSearchPreservingPosition(e.target,renderTallyInvoices,150);};
 if($('#tallyInvoicePrev'))$('#tallyInvoicePrev').onclick=()=>{tallyInvoicePage--;renderTallyInvoices();};if($('#tallyInvoiceNext'))$('#tallyInvoiceNext').onclick=()=>{tallyInvoicePage++;renderTallyInvoices();};
 document.querySelectorAll('[data-tally-invoice-action]').forEach(b=>b.onclick=()=>openTallyInvoiceAction(tallyInvoices.find(r=>r.id===b.dataset.id),b.dataset.tallyInvoiceAction));
}
