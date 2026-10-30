'use strict';
// Tax invoices are made in Tally and flow in here. Owner or accounts staff upload Tally's XML export (Day Book or
// Sales Register → Export → XML); the in-house connector will later send the same rows automatically. Each invoice is
// linked to its ERP Pro forma by the number typed in Tally's Order No. or Reference. Register only: nothing here
// changes stock, prices or delivery status.
let tallyInvoiceFilter='unmatched',tallyInvoiceSearch='',tallyInvoicePage=0,tallyInvoiceLoaded=false,tallyInvoiceError='',tallyInvoiceEpoch=0;
let tallyInvoices=[],tallyInvoiceProformas=[],tallyInvoiceCanManage=false,tallyInvoiceActor=null,tallyInvoiceRequest=0,tallyInvoiceRecoveries=new Map();
const tallyInvoiceColumns='id,tally_guid,voucher_number,voucher_date,voucher_type,party_name,order_reference,currency,net_minor,vat_minor,total_minor,lines,narration,cancelled,proforma_id,match_status,match_note,source,content_hash,imported_by,imported_at,version';
const tallyInvoiceStatuses={matched:'Linked to Pro forma',unmatched:'Needs linking',ignored:'Not from a Pro forma'};
function clearTallyInvoices(){tallyInvoiceEpoch++;tallyInvoiceRequest++;tallyInvoiceActor=null;tallyInvoiceLoaded=false;tallyInvoices=[];tallyInvoiceProformas=[];tallyInvoiceCanManage=false;tallyInvoiceRecoveries=new Map();tallyInvoiceError='';tallyInvoiceSearch='';tallyInvoiceFilter='unmatched';tallyInvoicePage=0;}

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
function tallyInvoiceMoney(minor,currency){return minor==null?'—':moneyDisplay(Number(minor),currency||'TZS');}
function tallyInvoiceVisible(rows,{filter,search}){
 const q=String(search||'').trim().toLowerCase();
 return rows.filter(r=>filter==='all'||r.match_status===filter)
  .filter(r=>!q||[r.voucher_number,r.party_name,r.order_reference,r.narration,tallyInvoiceProforma(r.proforma_id)?.document_number,...(r.lines||[]).map(l=>l.item)].join(' ').toLowerCase().includes(q))
  .sort((a,b)=>String(b.voucher_date).localeCompare(String(a.voucher_date))||String(b.voucher_number).localeCompare(String(a.voucher_number),undefined,{numeric:true}));
}
// Shown on Pro forma cards so sales can see the order was invoiced in Tally.
function tallyInvoicesForProforma(proformaId){return tallyInvoices.filter(r=>r.proforma_id===proformaId&&!r.cancelled);}
async function loadTallyInvoices(){
 const epoch=++tallyInvoiceEpoch,actor=me,session=typeof sessionLoadEpoch==='undefined'?null:sessionLoadEpoch;
 const [rows,proformas,access]=await Promise.all([all('tally_sales_invoices','*'),all('sales_proformas','id,document_number,organization_id,status,total_minor,tax_minor,currency,deleted_at'),client.rpc('tally_invoice_staff')]);
 if(epoch!==tallyInvoiceEpoch||me!==actor||typeof sessionLoadEpoch!=='undefined'&&sessionLoadEpoch!==session)return false;
 tallyInvoices=rows;tallyInvoiceProformas=proformas.filter(p=>!p.deleted_at);tallyInvoiceCanManage=access.data===true;tallyInvoiceLoaded=true;tallyInvoiceError='';return true;
}
async function tallyInvoicesWorkspace(force=false){
 if(tallyInvoiceActor&&tallyInvoiceActor!==me)clearTallyInvoices();tallyInvoiceActor=me;
 const actor=me,request=++tallyInvoiceRequest,session=typeof sessionLoadEpoch==='undefined'?null:sessionLoadEpoch;syncWorkspaceNavigation();
 if(force||!tallyInvoiceLoaded){
  workspaceLoading('Loading Tally invoices…');
  try{if(!(await loadTallyInvoices()))return;}catch(error){if(me!==actor||request!==tallyInvoiceRequest||typeof sessionLoadEpoch!=='undefined'&&sessionLoadEpoch!==session)return;tallyInvoiceError=error.message;tallyInvoiceLoaded=false;}
 }
 if(view!=='tallyinvoices'||me!==actor||request!==tallyInvoiceRequest||typeof sessionLoadEpoch!=='undefined'&&sessionLoadEpoch!==session)return;
 renderTallyInvoices();
}
function tallyInvoiceRow(r){
 const pf=tallyInvoiceProforma(r.proforma_id),org=pf&&typeof salesOrganization==='function'?salesOrganization(pf.organization_id):null,actions=[];
 if(tallyInvoiceCanManage){
  if(r.match_status!=='matched')actions.push(`<button type="button" data-tally-invoice-action="match" data-id="${esc(r.id)}">Link to Pro forma</button>`);
  if(r.match_status==='matched')actions.push(`<button type="button" data-tally-invoice-action="unmatch" data-id="${esc(r.id)}">Remove link</button>`);
  if(r.match_status==='unmatched')actions.push(`<button type="button" data-tally-invoice-action="ignore" data-id="${esc(r.id)}">Not from a Pro forma</button>`);
 }
 return `<tr data-tally-invoice-row="${esc(r.id)}" class="${r.match_status==='unmatched'?'quality-yellow':''}${r.cancelled?' tally-cancelled':''}"><td><strong>${esc(r.voucher_number)}</strong><small>${esc(r.voucher_date)} · ${esc(r.voucher_type)}${r.cancelled?' · Cancelled in Tally':''}</small></td><td>${esc(r.party_name||'—')}</td><td>${esc(r.order_reference||'—')}</td><td>${esc(tallyInvoiceMoney(r.total_minor,r.currency))}${r.vat_minor?`<small>VAT ${esc(tallyInvoiceMoney(r.vat_minor,r.currency))}</small>`:''}</td><td><span class="tag chip chip--${statusTone(r.match_status==='matched'?'success':r.match_status==='unmatched'?'waiting':'neutral')}">${esc(tallyInvoiceStatuses[r.match_status])}</span>${pf?`<small>${esc(pf.document_number)}${org?' · '+esc(org.name):''}</small>`:''}<small>${esc(r.match_note)}</small></td><td><details><summary>${(r.lines||[]).length} item${(r.lines||[]).length===1?'':'s'}</summary><ul>${(r.lines||[]).map(l=>`<li>${esc(l.item)} · ${esc(l.quantity??'?')} ${esc(l.unit||'')} · ${esc(tallyInvoiceMoney(l.amount_minor,r.currency))}</li>`).join('')}</ul></details></td><td><div class="actions">${actions.join('')}</div></td></tr>`;
}
function tallyInvoicePageState(){
 const rows=tallyInvoiceVisible(tallyInvoices,{filter:tallyInvoiceFilter,search:tallyInvoiceSearch}),pages=Math.max(1,Math.ceil(rows.length/50));tallyInvoicePage=Math.min(Math.max(tallyInvoicePage,0),pages-1);
 const counts={unmatched:0,matched:0,ignored:0};for(const row of tallyInvoices)counts[row.match_status]++;
 return {rows,pages,counts};
}
function renderTallyInvoices(){
 const {rows,pages,counts}=tallyInvoicePageState();
 $('#content').innerHTML=`<section class="tally-invoices-workspace">${workspacePageHeader({title:'Tally invoices',subtitle:"Invoices made in TallyPrime. Put the Pro forma number (for example PF-2026-000012) in Tally's Order No. so the invoice links to its order.",actions:'<button type="button" id="tallyInvoiceRefresh">Refresh</button>'+(tallyInvoiceCanManage?'<button type="button" id="tallyTestInvoice">Make TEST invoice</button>':'')})}${tallyInvoiceCanManage?'<div class="actions"><label class="file-button"><span>Upload Tally XML export</span><input type="file" id="tallyInvoiceFile" accept=".xml,text/xml,application/xml"></label></div>':''}${tallyInvoiceError?`<p class="notice error" role="alert">Tally invoices could not load: ${esc(tallyInvoiceError)}. Nothing was changed.</p>`:''}<div class="help-strip"><strong id="tallyInvoiceCounts">${counts.unmatched} need linking · ${counts.matched} linked · ${counts.ignored} not ERP orders</strong><span></span></div><div id="tallyInvoiceSaveStatus" role="status"></div><div class="tabs" role="group" aria-label="Filter Tally invoices">${[['unmatched','Needs linking'],['matched','Linked'],['ignored','Not from a Pro forma'],['all','All']].map(([k,l])=>`<button type="button" data-tally-invoice-filter="${k}" class="${tallyInvoiceFilter===k?'active':''}" aria-pressed="${tallyInvoiceFilter===k}">${l}</button>`).join('')}</div><label class="search"><span>Search</span><input id="tallyInvoiceSearch" type="search" placeholder="Invoice number, customer, Pro forma or item" value="${esc(tallyInvoiceSearch)}"></label><div id="tallyInvoiceTable" class="table-wrap" ${rows.length?'':'hidden'}><table><thead><tr><th>Invoice</th><th>Customer in Tally</th><th>Order No. / Reference</th><th>Total</th><th>ERP order</th><th>Items</th><th></th></tr></thead><tbody id="tallyInvoiceRows">${rows.slice(tallyInvoicePage*50,tallyInvoicePage*50+50).map(tallyInvoiceRow).join('')}</tbody></table></div><p id="tallyInvoiceEmpty" class="muted" ${rows.length?'hidden':''}>${tallyInvoices.length?'No invoices here.':'No Tally invoices yet. Export the Day Book or Sales Register from Tally as XML and upload it.'}</p><div id="tallyInvoicePager" class="actions" ${pages>1?'':'hidden'}><button type="button" id="tallyInvoicePrev" ${tallyInvoicePage===0?'disabled':''}>Previous</button><span id="tallyInvoicePageStatus">Page ${tallyInvoicePage+1} of ${pages}</span><button type="button" id="tallyInvoiceNext" ${tallyInvoicePage>=pages-1?'disabled':''}>Next</button></div></section>`;
 bindTallyInvoices();
 document.querySelectorAll('[data-tally-invoice-row]').forEach(node=>{node.tallyInvoiceMarkup=tallyInvoiceRow(tallyInvoices.find(row=>row.id===node.dataset.tallyInvoiceRow));});
 renderTallyInvoiceRecovery();
 const test=$('#tallyTestInvoice');if(test)test.onclick=()=>openTallyTestInvoice();
}
function tallyInvoiceSaveContext(){
 const actor=me,epoch=tallyInvoiceEpoch,request=tallyInvoiceRequest,root=document.querySelector('.tally-invoices-workspace'),session=typeof sessionLoadEpoch==='undefined'?null:sessionLoadEpoch;
 const sessionCurrent=()=>me===actor&&(typeof sessionLoadEpoch==='undefined'||sessionLoadEpoch===session);
 return {sessionCurrent,current:()=>sessionCurrent()&&tallyInvoiceActor===actor&&epoch===tallyInvoiceEpoch&&request===tallyInvoiceRequest&&view==='tallyinvoices'&&root?.isConnected&&root===document.querySelector('.tally-invoices-workspace'),root};
}
function tallyInvoiceMatchesLookup(row,lookup){return !!row&&Object.entries(lookup).every(([key,value])=>row[key]===value);}
function tallyInvoiceConfirmed(row,entry){return tallyInvoiceMatchesLookup(row,entry.lookup)&&typeof row.id==='string'&&Number.isSafeInteger(row.version)&&row.version>=entry.version&&Object.hasOwn(tallyInvoiceStatuses,row.match_status)&&Array.isArray(row.lines)&&tallyInvoiceColumns.split(',').every(key=>Object.hasOwn(row,key));}
function renderTallyInvoiceRecovery(){
 const status=$('#tallyInvoiceSaveStatus');if(!status)return;
 status.innerHTML=[...tallyInvoiceRecoveries.values()].map(entry=>`<p>${esc(entry.label)} ${entry.busy&&entry.context?.current()?'Loading current details…':`${entry.error?'Current details could not load: '+esc(entry.error)+'.':'Current details need verification.'} <button type="button" data-tally-invoice-retry="${esc(entry.key)}">Retry saved invoice</button>`}</p>`).join('');
 const context=tallyInvoiceSaveContext();status.querySelectorAll('[data-tally-invoice-retry]').forEach(button=>button.onclick=()=>run(()=>{if(context.current())return refreshSavedTallyInvoice(tallyInvoiceRecoveries.get(button.dataset.tallyInvoiceRetry),context);}));
 document.querySelectorAll('[data-tally-invoice-action]').forEach(button=>{const row=tallyInvoices.find(row=>row.id===button.dataset.id);button.disabled=[...tallyInvoiceRecoveries.values()].some(entry=>tallyInvoiceMatchesLookup(row,entry.lookup));});
 const test=$('#tallyTestInvoice'),file=$('#tallyInvoiceFile');if(test)test.disabled=[...tallyInvoiceRecoveries.values()].some(entry=>!entry.lookup.id);if(file)file.disabled=tallyInvoiceRecoveries.size>0;
 const counts=$('#tallyInvoiceCounts');if(counts&&tallyInvoiceRecoveries.size)counts.textContent='Saved changes are awaiting verification. Counts will update after current details load.';
}
function reconcileTallyInvoiceRows(root){
 const {rows,pages,counts}=tallyInvoicePageState(),body=root.querySelector('#tallyInvoiceRows'),old=[...body.querySelectorAll('[data-tally-invoice-row]')],pageRows=rows.slice(tallyInvoicePage*50,tallyInvoicePage*50+50),ids=new Set(pageRows.map(row=>row.id));
 for(const node of old)if(!ids.has(node.dataset.tallyInvoiceRow))node.remove();
 let cursor=body.firstElementChild;
 for(const row of pageRows){
  let node=old.find(node=>node.dataset.tallyInvoiceRow===row.id);const html=tallyInvoiceRow(row);
  if(!node||node.tallyInvoiceMarkup!==html){const template=document.createElement('template');template.innerHTML=html;const next=template.content.firstElementChild;next.tallyInvoiceMarkup=html;if(node){next.querySelector('details').open=node.querySelector('details').open;node.replaceWith(next);if(cursor===node)cursor=next;}node=next;}
  if(node!==cursor)body.insertBefore(node,cursor);cursor=node.nextElementSibling;
 }
 root.querySelector('#tallyInvoiceCounts').textContent=`${counts.unmatched} need linking · ${counts.matched} linked · ${counts.ignored} not ERP orders`;
 root.querySelector('#tallyInvoiceTable').hidden=!rows.length;const empty=root.querySelector('#tallyInvoiceEmpty');empty.hidden=!!rows.length;empty.textContent=tallyInvoices.length?'No invoices here.':'No Tally invoices yet. Export the Day Book or Sales Register from Tally as XML and upload it.';
 root.querySelector('#tallyInvoicePager').hidden=pages<=1;root.querySelector('#tallyInvoicePrev').disabled=tallyInvoicePage===0;root.querySelector('#tallyInvoiceNext').disabled=tallyInvoicePage>=pages-1;root.querySelector('#tallyInvoicePageStatus').textContent=`Page ${tallyInvoicePage+1} of ${pages}`;
 bindTallyInvoiceRowActions();renderTallyInvoiceRecovery();
}
async function refreshSavedTallyInvoice(entry,context){
 if(!entry||!entry.sessionCurrent()||entry.busy&&entry.context?.current()||!context.current()||tallyInvoiceRecoveries.get(entry.key)!==entry)return;
 entry.busy=true;entry.context=context;const request=entry.request=(entry.request||0)+1,focused=document.activeElement,x=window.scrollX,y=window.scrollY;renderTallyInvoiceRecovery();
 try{
  if(!tallyInvoiceConfirmed(entry.receipt,entry)){
   let query=client.from('tally_sales_invoices').select(tallyInvoiceColumns);for(const [key,value] of Object.entries(entry.lookup))query=query.eq(key,value);
   const result=await query.maybeSingle();if(!context.current())return;if(result.error)throw Error(result.error.message);if(!tallyInvoiceConfirmed(result.data,entry))throw Error('The saved invoice could not be verified.');entry.receipt=result.data;
  }
  if(!context.current())return;
  const current=tallyInvoices.find(row=>row.id===entry.receipt.id),saved=current?.version>entry.receipt.version?current:entry.receipt;
  tallyInvoices=tallyInvoices.filter(row=>row.id!==saved.id).concat(saved);tallyInvoiceRecoveries.delete(entry.key);
  reconcileTallyInvoiceRows(context.root);const origin=context.root.querySelector(`[data-tally-invoice-row="${CSS.escape(saved.id)}"] button`)||$('#tallyInvoiceSearch');
  if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(origin);
  if(!focused.isConnected)(origin||$('#tallyInvoiceSearch'))?.focus({preventScroll:true});else if(document.activeElement===document.body)focused.focus({preventScroll:true});window.scrollTo(x,y);message(entry.label);return true;
 }catch(error){
  if(!context.current())return;tallyInvoiceRecoveries.set(entry.key,entry);entry.error=error.message;entry.busy=false;renderTallyInvoiceRecovery();
  const retry=[...context.root.querySelectorAll('[data-tally-invoice-retry]')].find(button=>button.dataset.tallyInvoiceRetry===entry.key);
  if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);
  if(!focused.isConnected||focused.closest?.(`[data-tally-invoice-row="${CSS.escape(entry.lookup.id||'')}"]`))retry?.focus({preventScroll:true});
  message(`${entry.label} Current details could not load. Retry saved invoice to continue.`,true);return false;
 }finally{if(entry.request===request)entry.busy=false;}
}
// Until Tally is connected: a clearly marked TEST invoice for a Pro forma, so the order can be followed through
// accounts, stores and delivery. It goes through the same import as a real Tally invoice and links by Pro forma
// number. Voucher type "TEST Sales" and number TEST-… mark it; these are removed before real use.
function openTallyTestInvoice(){
 const context=tallyInvoiceSaveContext();let committed=false;
 if(!context.current()||!tallyInvoiceCanManage||[...tallyInvoiceRecoveries.values()].some(entry=>!entry.lookup.id))return;
 const ready=tallyInvoiceProformas.filter(p=>!['draft','cancelled','rejected'].includes(p.status)&&!tallyInvoices.some(i=>i.proforma_id===p.id&&!i.cancelled));
 if(!ready.length)return message('No Pro forma is waiting for an invoice. Send a Pro forma to accounting first.',true);
 const name=p=>(typeof organizations!=='undefined'&&organizations.find(o=>o.id===p.organization_id)?.name)||'';
 const fields=`<p class="notice">TEST only. This is not a tax invoice and must never be given to a client.</p><label><span>Pro forma</span><select name="proforma" required><option value="">Choose a Pro forma</option>${ready.map(p=>`<option value="${esc(p.id)}">${esc(p.document_number)} · ${esc(name(p))} · ${esc(tallyInvoiceMoney(p.total_minor,p.currency))}</option>`).join('')}</select></label>`;
 actionForm('Make TEST invoice',fields,async values=>{
  if(!context.current()||!tallyInvoiceCanManage)throw Error('Reopen Tally invoices before saving.');
  if(committed)throw Error('Invoice saved. Use Retry saved invoice to load current details.');
  const p=ready.find(r=>r.id===values.proforma);if(!p)throw Error('Choose a Pro forma.');
  const total=Number(p.total_minor)||0,vat=Number(p.tax_minor)||0;
  const row={voucher_number:`TEST-${p.document_number}`,voucher_date:companyDate(),voucher_type:'TEST Sales',party_name:name(p),order_reference:p.document_number,currency:p.currency||'TZS',net_minor:total-vat,vat_minor:vat,total_minor:total,lines:[],narration:'TEST INVOICE - NOT A REAL TAX INVOICE'};
  let r;try{r=await client.rpc('import_tally_invoices',{p_rows:[row],p_source:'upload'});}catch(error){if(!context.current())return;throw error;}
  if(!context.sessionCurrent())return;if(r.error){if(context.current())throw Error(r.error.message);return;}committed=true;
  const lookup={voucher_type:row.voucher_type,voucher_number:row.voucher_number,voucher_date:row.voucher_date},key=JSON.stringify(lookup),entry={key,sessionCurrent:context.sessionCurrent,lookup,version:1,label:`TEST invoice ${row.voucher_number} saved.`,receipt:null};
  tallyInvoiceRecoveries.set(key,entry);if(!context.current()){tallyInvoiceLoaded=false;return;}await refreshSavedTallyInvoice(entry,context);
 });
}
function openTallyInvoiceAction(invoice,action){
 const context=tallyInvoiceSaveContext();let committed=false;
 if(!invoice||!context.current()||!tallyInvoiceCanManage||[...tallyInvoiceRecoveries.values()].some(entry=>tallyInvoiceMatchesLookup(invoice,entry.lookup)))return;
 const titles={match:'Link Tally invoice to a Pro forma',unmatch:'Remove link to Pro forma',ignore:'Mark as not an ERP order'};
 const options=tallyInvoiceProformas.filter(p=>p.status!=='cancelled').sort((a,b)=>String(b.document_number).localeCompare(String(a.document_number))).map(p=>{const org=typeof salesOrganization==='function'?salesOrganization(p.organization_id):null;return `<option value="${esc(p.document_number+' · '+(org?.name||'')+' · '+tallyInvoiceMoney(p.total_minor,p.currency))}"></option>`;}).join('');
 const fields=`<p><strong>${esc(invoice.voucher_number)}</strong> · ${esc(invoice.voucher_date)} · ${esc(invoice.party_name||'')} · ${esc(tallyInvoiceMoney(invoice.total_minor,invoice.currency))}</p>${action==='match'?`<label><span>Pro forma</span><input name="proforma" list="tallyInvoiceProformaChoices" required autocomplete="off" placeholder="PF-2026-…"></label><datalist id="tallyInvoiceProformaChoices">${options}</datalist>`:''}<label><span>${action==='match'?'Note · optional':action==='ignore'?'Why is there no ERP order? (for example cash sale)':'Why remove the link?'}</span><textarea name="note" maxlength="500" ${action==='match'?'':'required minlength="3"'}></textarea></label>`;
 actionForm(titles[action],fields,async values=>{
  if(!context.current()||!tallyInvoiceCanManage)throw Error('Reopen Tally invoices before saving.');
  if(committed)throw Error('Invoice saved. Use Retry saved invoice to load current details.');
  let proformaId=null;
  if(action==='match'){const number=String(values.proforma||'').split(' · ')[0].trim().toUpperCase(),pf=tallyInvoiceProformas.find(p=>p.document_number===number);if(!pf)throw Error('Choose a Pro forma from the list.');proformaId=pf.id;}
  let result;try{result=await client.rpc('review_tally_invoice',{p_id:invoice.id,p_expected_version:invoice.version,p_action:action,p_proforma_id:proformaId,p_note:values.note||''});}catch(error){if(!context.current())return;throw error;}
  if(!context.sessionCurrent())return;if(result.error){if(context.current())throw Error(result.error.message);return;}committed=true;
  const key=invoice.id,entry={key,sessionCurrent:context.sessionCurrent,lookup:{id:invoice.id},version:invoice.version+1,label:`${invoice.voucher_number}: ${titles[action].toLowerCase()} saved.`,receipt:Array.isArray(result.data)?(result.data.length===1?result.data[0]:null):result.data};
  tallyInvoiceRecoveries.set(key,entry);if(!context.current()){tallyInvoiceLoaded=false;return;}await refreshSavedTallyInvoice(entry,context);
 });
}
function bindTallyInvoices(){
 const context=tallyInvoiceSaveContext();
 $('#tallyInvoiceRefresh').onclick=()=>run(()=>{if(context.current())return tallyInvoicesWorkspace(true);});
 const file=$('#tallyInvoiceFile');if(file)file.onchange=()=>{const chosen=file.files[0];if(chosen&&context.current())run(async()=>{const summary=await importTallyInvoiceFile(chosen);await tallyInvoicesWorkspace(true);message(summary);});};
 document.querySelectorAll('[data-tally-invoice-filter]').forEach(b=>b.onclick=()=>{if(!context.current())return;tallyInvoiceFilter=b.dataset.tallyInvoiceFilter;tallyInvoicePage=0;renderTallyInvoices();});
 $('#tallyInvoiceSearch').oninput=e=>{if(!context.current())return;tallyInvoiceSearch=e.target.value;tallyInvoicePage=0;renderSearchPreservingPosition(e.target,renderTallyInvoices,150);};
 if($('#tallyInvoicePrev'))$('#tallyInvoicePrev').onclick=()=>{if(!context.current())return;tallyInvoicePage--;renderTallyInvoices();};if($('#tallyInvoiceNext'))$('#tallyInvoiceNext').onclick=()=>{if(!context.current())return;tallyInvoicePage++;renderTallyInvoices();};
 bindTallyInvoiceRowActions();
}
function bindTallyInvoiceRowActions(){
 document.querySelectorAll('[data-tally-invoice-action]').forEach(b=>b.onclick=()=>openTallyInvoiceAction(tallyInvoices.find(r=>r.id===b.dataset.id),b.dataset.tallyInvoiceAction));
}
