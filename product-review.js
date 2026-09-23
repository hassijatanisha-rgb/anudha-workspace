'use strict';

function productReviewIssues(details){
 const issues=[];
 for(const [key,label] of [['name','Product name'],['company','Company'],['specification','Version / specification']])if(!String(details[key]||'').trim())issues.push(`${label} needs review`);
 if(!['active','inactive_serviced'].includes(details.sale_status))issues.push('Sale / service status needs review');
 if(typeof details.batch_required!=='boolean')issues.push('Batch applicability needs review');
 if(typeof details.expiry_required!=='boolean')issues.push('Expiry applicability needs review');
 return issues;
}
function productStockReview(details,stock,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 const issues=productReviewIssues(details),reported=stock.quantity;
 if(!Number.isSafeInteger(reported))issues.push('Quantity needs review');
 else if(reported<0)issues.push('Negative reported stock — verify physical count');
 if(String(stock.unit||'').toUpperCase()!=='PCS')issues.push('Pieces conversion needs verification');
 if(stock.verified!==true)issues.push('Physical stock not verified');
 if(details.batch_required&&!String(stock.batch||'').trim())issues.push('Batch number is missing');
 if(details.expiry_required){
  const expiry=String(stock.expiry||'');
  const date=new Date(`${expiry}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==expiry)issues.push('Expiry date needs review');
  else if(expiry<=today)issues.push('Expired or expires today — not available for sale');
 }
 return {reported,issues,saleable:issues.length?null:details.sale_status==='active'?reported:0};
}
