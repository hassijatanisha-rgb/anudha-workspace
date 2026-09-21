'use strict';

const catalogCategories=[['review','Needs review'],['all','All products'],['machines','Machines'],['reagents','Reagents'],['consumables','Consumables'],['spares','Spares'],['non_stock','Service / non-stock'],['unclassified','Unclassified']];
let catalogCategory='review',catalogSearch='',catalogMachineId='';
function catalogRows(){return products}
function catalogNameClues(name){
 const value=String(name||''),lower=value.toLowerCase();let suggestedCategory='',categoryReason='';
 const explicit=[['reagents',/\breagents?\b/,'reagent'],['consumables',/\bconsumables?\b/,'consumable'],['spares',/\bspares?\b/,'spare'],['non_stock',/\bservice\b/,'service'],['machines',/\b(?:machine|analy[sz]er|equipment|instrument)\b/,'machine or analyzer']];
 for(const [category,pattern,label] of explicit)if(pattern.test(lower)){suggestedCategory=category;categoryReason=`Item name explicitly says ${label}`;break;}
 const pack=value.match(/\b(?:pack\s+of\s+\d+|p\s*\/\s*\d+|\d+\s*(?:pcs?|pieces?|tests?|strips?)\s*(?:\/\s*)?(?:boxes?|bags?|packs?)?)\b/i);
 return {suggestedCategory,categoryReason,packHint:pack?pack[0].replace(/\s+/g,' ').trim():''};
}
function catalogClassification(p){return typeof inventoryClassification==='function'?inventoryClassification(p.id):null}
function catalogCategoryOf(p){return catalogClassification(p)?.category||p.source?.category||'unclassified'}
function catalogProductIssues(p){
 const source=p.source||{},category=catalogCategoryOf(p),issues=[];
 if(!String(p.name||'').trim())issues.push('Product name is missing');
 if(!String(p.sku||'').trim())issues.push('Stock code is missing');
 if(category==='machines'){if(!String(source.company||'').trim())issues.push('Machine company is missing');if(!String(source.model||'').trim())issues.push('Machine model is missing');}
 else if(['reagents','consumables','spares'].includes(category)&&!(Array.isArray(source.machine_ids)&&source.machine_ids.length))issues.push('No compatible machine is linked');
 if(category==='unclassified')issues.push('Product category is not confirmed');
 return issues;
}
function catalogMatches(p,query){return [p.name,p.sku,p.source?.model,p.source?.company].join(' ').toLowerCase().includes(query.trim().toLowerCase())}
function catalogLabel(category){return catalogCategories.find(([id])=>id===category)?.[1]||'Unclassified'}
function catalogMachineLinks(p,rows){
 const machines=rows.filter(x=>x.source?.category==='machines'&&(p.source?.machine_ids||[]).includes(x.id));
 return machines.length?machines.map(x=>`<button type="button" data-catalog-machine="${esc(x.id)}">${esc(x.name)}</button>`).join(' '):'<span class="muted">No machine relationship supplied</span>';
}
function catalogSource(p){
 const source=p.source||{};let rows=Array.isArray(source.rows)?source.rows:[];let notes=Array.isArray(source.review_notes)?source.review_notes:[];
 if(!rows.length&&source.source_file)rows=[{sheet:source.source_file,row:source.source_row||'',column:'Particulars',value:source.raw?.Particulars||p.name||''}];
 for(const entry of Array.isArray(source.unallocated_source_entries)?source.unallocated_source_entries:[])notes=[...notes,`Unallocated source entry: ${typeof entry==='string'?entry:JSON.stringify(entry)}`];
 return `<details><summary>Original rows & review notes</summary>${notes.length?`<ul>${notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`:'<p class="muted">No review notes supplied.</p>'}${rows.length?`<div class="table-wrap"><table><caption>Original spreadsheet references</caption><thead><tr><th scope="col">Sheet</th><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Original value</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.sheet)}</td><td>${esc(row.row)}</td><td>${esc(row.column)}</td><td>${esc(row.value)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No original row references supplied.</p>'}</details>`;
}
function catalogProduct(p,rows){
 const source=p.source||{},category=catalogCategoryOf(p),machine=category==='machines',issues=catalogProductIssues(p),clues=catalogNameClues(p.name),classification=catalogClassification(p);
 return `<article class="contact ${issues.length?'incomplete':''}"><div class="heading"><h3>${machine&&source.dataset?`<button type="button" data-catalog-machine="${esc(p.id)}">${esc(p.name||'Product name missing')}</button>`:esc(p.name||'Product name missing')}</h3><span class="tag">${esc(catalogLabel(category))}</span></div>${issues.length?`<p class="revision-label">Needs review · ${issues.map(esc).join(', ')}</p>`:''}${!classification&&(clues.suggestedCategory||clues.packHint)?`<p class="source-clue"><strong>Source-list clue:</strong> ${clues.suggestedCategory?`${esc(catalogLabel(clues.suggestedCategory))} suggested because ${esc(clues.categoryReason.toLowerCase())}. `:''}${clues.packHint?`Pack wording: “${esc(clues.packHint)}” — review only; this is not a carton conversion.`:''}</p>`:''}<div class="details"><div><small>Company</small>${esc(source.company||'Not supplied')}</div><div><small>Model</small>${esc(source.model||'Not supplied')}</div><div><small>Stock code</small>${esc(p.sku||'Not supplied')}</div><div><small>Stock quantity</small>Enter through Stock by godown</div></div>${source.description?`<p>${esc(source.description)}</p>`:''}${source.dataset&&!machine?`<div><small>Related machines</small><div class="actions">${catalogMachineLinks(p,rows)}</div></div>`:''}${catalogSource(p)}<details><summary>${classification?'Revise confirmed inventory category':'Confirm inventory category'}</summary><form data-inventory-action="classification" data-product="${p.id}" data-version="${classification?.version||0}"><label><span>Inventory category</span><select name="category" required>${catalogCategories.filter(([id])=>!['review','all'].includes(id)).map(([id,label])=>inventoryOption(id,label,(classification?.category||clues.suggestedCategory||'unclassified')===id)).join('')}</select></label><label><span>Reason / source checked</span><textarea name="reason" minlength="5" required>${esc(classification?.reason||clues.categoryReason||'')}</textarea></label><button type="submit">Save reviewed category</button></form></details><div class="actions"><button type="button" data-product-edit="${esc(p.id)}">Edit product name / stock code</button></div></article>`;
}
function catalogInventory(){
 const rows=catalogRows(),machine=rows.find(p=>p.id===catalogMachineId&&p.source?.category==='machines');
 const heading='<div class="heading"><div><small>INVENTORY · PRODUCTS</small><h1>Sort products</h1><p class="muted">Check each product name, choose its category, and add a stock code when you have one.</p></div><button id="refresh" type="button">Refresh list</button></div><div class="help-strip"><strong>Product names are not stock counts.</strong><span>Add real quantities only in the Stock section after a physical count.</span></div>';
 if(catalogMachineId&&!machine)catalogMachineId='';
 if(machine){
  const linked=rows.filter(p=>p.source?.category!=='machines'&&(p.source?.machine_ids||[]).includes(machine.id));
  $('#content').innerHTML=heading+`<button type="button" data-catalog-back>← Back to catalog</button><section aria-label="Machine details">${catalogProduct(machine,rows)}</section><p class="muted">${linked.length} related product${linked.length===1?'':'s'}. Products shared by several machines reference the same catalog record.</p>`+catalogCategories.filter(([id])=>!['all','machines'].includes(id)).map(([category,label])=>{
   const items=linked.filter(p=>p.source?.category===category);
   return `<details class="card"><summary>${label} · ${items.length}</summary>${items.map(p=>catalogProduct(p,rows)).join('')||`<p class="empty">No ${label.toLowerCase()} linked to this machine.</p>`}</details>`;
  }).join('');
  return;
 }
 const categoryRows=rows.filter(p=>catalogCategory==='all'||catalogCategory==='review'&&catalogProductIssues(p).length||catalogCategoryOf(p)===catalogCategory),matches=categoryRows.filter(p=>catalogMatches(p,catalogSearch));
 $('#content').innerHTML=heading+`<div class="tabs" role="group" aria-label="Product categories">${catalogCategories.map(([category,label])=>`<button type="button" data-catalog-category="${category}" class="${category===catalogCategory?'active':''}" aria-pressed="${category===catalogCategory}">${label} <small>${rows.filter(p=>category==='all'||category==='review'&&catalogProductIssues(p).length||catalogCategoryOf(p)===category).length}</small></button>`).join('')}</div><label><span>Search product name, model, company or stock code</span><input id="catalogSearch" type="search" value="${esc(catalogSearch)}" placeholder="Find a product"></label><p role="status">${matches.length} matching product${matches.length===1?'':'s'} · ${categoryRows.length} in ${esc(catalogLabel(catalogCategory).toLowerCase())}</p>`+matches.slice(0,100).map(p=>catalogProduct(p,rows)).join('')+(matches.length?'':`<div class="empty">${rows.length?'No products match this category and search.':'No product-list records have been imported yet.'}</div>`)+(matches.length>100?'<p class="warning">Showing the first 100 matches. Search to narrow the review list.</p>':'');
 $('#catalogSearch').addEventListener('input',e=>{
  catalogSearch=e.target.value;catalogInventory();$('#catalogSearch').focus();
 });
 if(typeof bindInventoryWorkspace==='function')bindInventoryWorkspace();
}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button||!button.closest('#content'))return;
 if(button.hasAttribute('data-catalog-category')){const category=button.dataset.catalogCategory;if(!catalogCategories.some(([id])=>id===category))return;catalogCategory=category;catalogMachineId='';catalogInventory()}
 else if(button.hasAttribute('data-catalog-machine')){catalogMachineId=button.dataset.catalogMachine;catalogInventory()}
 else if(button.hasAttribute('data-catalog-back')){catalogMachineId='';catalogInventory()}
});
