'use strict';

function moneyMinor(value){
 const text=String(value??'').trim();
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw Error('Enter a valid amount with no more than two decimal places.');
 const [whole,fraction='']=text.split('.'),minor=Number(whole)*100+Number((fraction+'00').slice(0,2));
 if(!Number.isSafeInteger(minor))throw Error('Amount is too large.');
 return minor;
}
function moneyDisplay(minor,currency='TZS'){
 if(!Number.isSafeInteger(Number(minor)))return 'Invalid amount';
 const digits=currency==='TZS'?0:2;
 return new Intl.NumberFormat('en-TZ',{style:'currency',currency,currencyDisplay:currency==='TZS'?'code':'symbol',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(minor)/100);
}
function proformaLineTotal(line){
 const gross=line.quantity*line.unitPriceMinor,discount=Math.round(gross*line.discountBasisPoints/10000),tax=Math.round((gross-discount)*line.taxBasisPoints/10000);
 if(![gross,discount,tax,gross-discount+tax].every(Number.isSafeInteger))throw Error('Line total is too large.');
 return {gross,discount,tax,total:gross-discount+tax};
}
function proformaNextActions(status){return ({draft:['send','cancel'],sent:['accept','revise','reject','cancel'],accepted:[],rejected:[],cancelled:[]})[status]||[]}
function deliveryNextActions(status){return ({
 accounts_approved:['tax_invoice','cancel'],
 tax_invoice_created:['send_to_sales','cancel'],
 sent_to_sales:['start_packing','cancel'],
 packing:['ready','cancel'],
 ready:['dispatch','cancel'],
 out_for_delivery:['deliver'],
 delivered:[],
 cancelled:[]
})[status]||[]}
function remainingDeliveryQuantity(proformaLine,deliveryLines,deliveryNotes){
 const active=new Set(deliveryNotes.filter(note=>note.status!=='cancelled').map(note=>note.id));
 const allocated=deliveryLines.filter(line=>line.proforma_line_id===proformaLine.id&&active.has(line.delivery_note_id)).reduce((sum,line)=>sum+line.quantity,0);
 return Math.max(0,proformaLine.quantity-allocated);
}

function proformaFulfillment(proformaLines,deliveryLines,deliveryNotes){
 const delivered=new Set(deliveryNotes.filter(note=>note.status==='delivered').map(note=>note.id));
 const quantities=new Map();
 for(const line of deliveryLines)if(delivered.has(line.delivery_note_id))quantities.set(line.proforma_line_id,(quantities.get(line.proforma_line_id)||0)+line.quantity);
 const complete=proformaLines.length>0&&proformaLines.every(line=>(quantities.get(line.id)||0)>=line.quantity);
 return complete?'complete':proformaLines.some(line=>(quantities.get(line.id)||0)>0)?'partial':'none';
}
