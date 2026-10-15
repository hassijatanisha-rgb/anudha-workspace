'use strict';
// One colour rule for products and contacts: nothing wrong = no colour, one thing wrong = yellow, two or more = red.
// Colours are worked out from the current data, so fixing a record clears its colour on the next refresh.
function qualityLevel(count){return count<=0?'':count===1?'yellow':'red';}
function qualityBadge(level,issues){
 if(!level)return '';
 return `<span class="quality-badge quality-${level}" title="${esc(issues.join('; '))}">${level==='yellow'?'Yellow':'Red'} · ${issues.length} to fix</span>`;
}
function productDuplicateKey(p){const s=p.source||{};return [p.name,s.company,s.specification||s.model].map(v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ')).join('|');}
function productDuplicateCounts(rows){const counts=new Map();for(const p of rows){const key=productDuplicateKey(p);counts.set(key,(counts.get(key)||0)+1);}return counts;}
// Core product facts only; sale status and batch rules are reviewed separately and are not counted as mistakes here.
function productQualityIssues(p,duplicates){
 const s=p.source||{},category=typeof catalogCategoryOf==='function'?catalogCategoryOf(p):(s.category||'unclassified'),issues=[];
 if(!String(p.name||'').trim())issues.push('Product name missing');
 if(!String(s.company||'').trim())issues.push(s.suggested_company?`Company missing (suggested: ${s.suggested_company})`:'Company missing');
 if(!String(s.specification||s.model||'').trim())issues.push('Specification missing');
 if(category==='unclassified')issues.push('Category not confirmed');
 if(!String(p.sku||'').trim())issues.push('Stock code missing');
 if(duplicates&&(duplicates.get(productDuplicateKey(p))||0)>1)issues.push('Possible duplicate: same name, company and specification');
 return issues;
}
function productQuality(p,duplicates){const issues=productQualityIssues(p,duplicates);return {level:qualityLevel(issues.length),issues};}
function contactQuality(issues,duplicateHits){const all=[...issues,...(duplicateHits?.length?['Possible duplicate']:[])];return {level:qualityLevel(all.length),issues:all};}

// Owner: apply the consolidated product list file to the ERP products (and the stock count list) in batches of 500.
let productListApplying=false;
async function applyProductListFile(file){
 if(!canEditRecords())throw Error(recordsLockedText);
 if(productListApplying)throw Error('The product list is already being applied. Wait for it to finish.');
 const rows=countCatalogueRows(await file.text()),actor=me?.user_id,total={rows:0,created:0,reviewed:0,classified:0,kept_manual:0};
 productListApplying=true;
 try{
  for(let i=0;i<rows.length;i+=500){
   message(`Applying product list… ${i.toLocaleString()} of ${rows.length.toLocaleString()} products. Keep this page open.`);
   const result=await client.rpc('apply_product_list',{p_rows:rows.slice(i,i+500)});
   if(me?.user_id!==actor)throw Error('Login changed. Applying stopped; load the file again to finish.');
   if(result.error)throw Error(`Stopped at product ${(i+1).toLocaleString()}: ${result.error.message}. Load the same file again to finish; finished products are not duplicated.`);
   for(const key of Object.keys(total))total[key]+=Number(result.data?.[key]||0);
  }
 }finally{productListApplying=false;}
 return total;
}
function productListSummary(total){return `Product list applied: ${total.rows.toLocaleString()} products · ${total.created.toLocaleString()} new · ${total.reviewed.toLocaleString()} updated${total.kept_manual?` · ${total.kept_manual.toLocaleString()} kept because staff had already corrected them`:''}.`;}
