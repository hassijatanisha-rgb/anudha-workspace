'use strict';

// Draft presentation only. Issuing/posting requires the protected accounting workflow.
// Labels transcribed from the seven user-supplied accountingvouchers PDFs.
function companyFormDefinitions(){
 const common=[['number','Document number'],['date','Date','date'],['contact','Specific contact person']];
 const shipping=[['consignee','Consignee (Ship to)'],['buyer','Buyer (Bill to)'],['reference','Reference No. & Date'],['buyer_order','Buyer’s Order No.'],['buyer_order_date','Order date','date'],['dispatch_document','Dispatch Doc No.'],['carrier','Dispatched through'],['destination','Destination'],['payment_terms','Mode / Terms of Payment'],['other_references','Other references'],['delivery_terms','Terms of Delivery'],['buyer_cst','Buyer’s TIN No.']];
 const voucher=[['account','Account'],['through','Through'],['less','Less'],['amount_words','Amount in words']];
 return {
  tax_invoice:{title:'Tax Invoice',source:'invoice format.pdf',fields:[...common,...shipping,['delivery_note','Delivery Note'],['delivery_note_date','Delivery Note Date','date']],columns:['description','quantity','rate','per','amount'],fiscal:true,declaration:true},
  delivery:{title:'Delivery Note',source:'delivery note format.pdf',fields:[...common,...shipping],columns:['description','quantity'],fiscal:true,receipt:true},
  purchase:{title:'Purchase Voucher / Supplier Invoice',source:'purchase voucher.pdf',fields:[...common,['consignee','Consignee (Ship to)'],['supplier','Supplier (Bill from)'],['supplier_reference','Supplier Invoice No. & Date'],['other_references','Other references'],['company_vat','Company’s VAT No.']],columns:['description','quantity','rate','per','amount'],fiscal:true},
  payment:{title:'Payment Voucher',source:'payment voucher.pdf',fields:[...common,...voucher],columns:['particulars','amount'],receipt:true},
  receipt:{title:'Receipt Voucher',source:'rcpt voucher.pdf',fields:[...common,...voucher],columns:['particulars','amount']},
  contra:{title:'Contra Voucher',source:'contra voucher.pdf',fields:common,columns:['particulars','credit','debit']},
  credit_note:{title:'Credit Note',source:'credit note voucher.pdf',fields:[...common,['reference','Reference'],['reference_date','Reference date','date'],['party','Party’s name'],['amount_words','Amount in words']],columns:['particulars','amount']}
 };
}
function companyFormDefinition(kind){const def=companyFormDefinitions()[kind];if(!def)throw Error('Unknown company form.');return def}
function companyFormEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function companyFormLabel(key){return {description:'Description of goods',quantity:'Quantity',rate:'Rate',per:'Per',amount:'Amount',particulars:'Particulars',debit:'Debit',credit:'Credit'}[key]||key}
function companyFormBrand(){
 return '<header class="company-form-brand"><img src="assets/anudha-logo.svg" alt="Anudha Limited"><div><strong>ANUDHA LIMITED</strong><br>P. O. BOX 5982, DAR ES SALAAM, TANZANIA<br>Plot 2169/82 &amp; 2170/82, Morogoro Road, Opp. International Commercial Bank<br>Tel: +255 22 2125746/ 2121188/ 2122745/ 2122747/ 2122746; Fax: +255 22 2126490; Cell: +255 783 523 777<br>Email: sales2@anudha.com,anudha@anudha.com,service@anudha.com<br>TIN: 100-113-473 · VRN: 10-001061-P</div></header>';
}
function companyProformaReferenceTerms(){
 return '<section class="reference-terms"><p>Items subject to availability at the time of order</p><p>Thank you for your enquiry<br>If you need any further information please feel free to contact us<br>Hope to hear from you with a positive response</p><p>Where applicable:<br>* Warranty excludes conditions arising from normal wear and tear<br>* Warranty void for damage caused by improper power<br>* Installation and application charges NOT included unless specified<br>* VAT is added to the prices shown, where applicable.</p><p><strong>Bank Details:</strong> Not configured — obtain approved payment details from Accounting.</p></section>';
}
function companyFormLineEditor(def,line={}){
 return `<tr data-company-form-line>${def.columns.map(key=>`<td><label><span class="sr-only">${companyFormLabel(key)}</span><input data-column="${key}" value="${companyFormEscape(line[key])}" maxlength="${['description','particulars'].includes(key)?2000:100}" ${['amount','debit','credit','rate','quantity'].includes(key)?'inputmode="decimal"':''}></label></td>`).join('')}<td class="no-print"><button type="button" data-remove-company-line>Remove row</button></td></tr>`;
}
function companyFormEditor(kind,record={}){
 const def=companyFormDefinition(kind);
 return `<form class="company-form-editor" data-company-form="${kind}"><h2>${def.title}</h2><p>Draft preparation. This does not post accounting entries, issue a tax invoice or change stock.</p><div class="company-form-fields">${def.fields.map(([key,label,type='text'])=>`<label><span>${label}</span><input name="${key}" type="${type}" value="${companyFormEscape(record[key])}" maxlength="2000"></label>`).join('')}</div><div class="company-form-table"><table><thead><tr>${def.columns.map(key=>`<th>${companyFormLabel(key)}</th>`).join('')}<th>Actions</th></tr></thead><tbody>${(record.lines?.length?record.lines:[{}]).map(line=>companyFormLineEditor(def,line)).join('')}</tbody></table></div><button type="button" data-add-company-line>Add row</button><label>Notes<textarea name="notes" maxlength="4000">${companyFormEscape(record.notes)}</textarea></label><button type="submit">Preview draft</button></form>`;
}
function companyFormDocument(kind,record={}){
 const def=companyFormDefinition(kind),escape=companyFormEscape;
 return `<article class="company-form-document">${companyFormBrand()}<div class="company-form-title"><h1>${def.title}</h1><strong>DRAFT · Not issued</strong></div><p class="company-form-warning">For preparation and review only. Not a posted accounting document or proof of payment.</p><dl class="company-form-fields">${def.fields.map(([key,label])=>`<div><dt>${label}</dt><dd>${escape(record[key])||'—'}</dd></div>`).join('')}</dl><table><thead><tr><th>No.</th>${def.columns.map(key=>`<th>${companyFormLabel(key)}</th>`).join('')}</tr></thead><tbody>${(record.lines||[]).map((line,i)=>`<tr><td>${i+1}</td>${def.columns.map(key=>`<td>${escape(line[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>${record.notes?`<p>${escape(record.notes)}</p>`:''}${def.declaration?'<p>Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</p>':''}${def.fiscal?'<p>Invoice verification details: Not issued. Populated only through the verified issuing workflow.</p>':''}<footer><p>E. &amp; O.E.</p>${def.receipt?'<p>Receiver’s name / signature: ____________________</p>':''}<p>For ANUDHA LIMITED</p><p>Authorised Signatory: ____________________</p></footer></article>`;
}
function companyFormRead(kind,form){
 const def=companyFormDefinition(kind),record={};
 for(const [key] of [...def.fields,['notes']])record[key]=String(form.elements.namedItem(key)?.value||'').trim();
 record.lines=Array.from(form.querySelectorAll('[data-company-form-line]'),row=>Object.fromEntries(def.columns.map(key=>[key,String(row.querySelector(`[data-column="${key}"]`)?.value||'').trim()])));
 return record;
}
// Mount only in an authorized accounting workspace. No database writes or credentials.
function mountCompanyForm(target,kind,record={}){
 const def=companyFormDefinition(kind);
 target.innerHTML='<p role="status">Unsaved draft. Closing this page discards entered values. PDF output does not save or post this document.</p>'+companyFormEditor(kind,record)+'<section data-company-preview></section>';
 const form=target.querySelector('form'),preview=target.querySelector('[data-company-preview]');
 form.querySelector('[data-add-company-line]').onclick=()=>form.querySelector('tbody').insertAdjacentHTML('beforeend',companyFormLineEditor(def));
 form.addEventListener('click',event=>{const remove=event.target.closest('[data-remove-company-line]');if(remove&&form.querySelectorAll('[data-company-form-line]').length>1)remove.closest('tr').remove()});
 form.addEventListener('input',()=>{preview.replaceChildren()});
 form.addEventListener('click',event=>{if(event.target.closest('[data-add-company-line],[data-remove-company-line]'))preview.replaceChildren()});
 form.onsubmit=event=>{
  event.preventDefault();
  preview.innerHTML='<button type="button" data-company-print>Print / Save as PDF (draft)</button>'+companyFormDocument(kind,companyFormRead(kind,form));
  preview.querySelector('[data-company-print]').onclick=()=>{
   const sheet=preview.querySelector('.company-form-document');
   sheet.classList.add('company-print-active');document.body.classList.add('company-printing');
   const cleanup=()=>{sheet.classList.remove('company-print-active');document.body.classList.remove('company-printing')};
   window.addEventListener('afterprint',cleanup,{once:true});
   try{window.print()}catch(error){cleanup();throw error}
  };
  preview.scrollIntoView({block:'start'});
 };
}
