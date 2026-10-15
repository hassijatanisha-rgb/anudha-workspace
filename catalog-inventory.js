'use strict';

const catalogCategories=[['review','Needs review'],['all','All products'],['machines','Machines'],['furniture','Furniture'],['reagents','Reagents'],['consumables','Consumables'],['spares','Spares'],['non_stock','Service / non-stock'],['unclassified','Not sorted yet']];
let catalogCategory='review',catalogSearch='',catalogMachineId='',catalogSort='name',catalogPage=0,catalogColour='';
function catalogPageRows(rows,page){
 const pages=Math.max(1,Math.ceil(rows.length/50));
 page=Math.min(pages-1,Math.max(0,Number.isInteger(page)?page:0));
 return {page,pages,rows:rows.slice(page*50,page*50+50)};
}
function catalogRows(){return products.filter(p=>!p.deleted_at).map(reviewedCatalogProduct)}
function catalogNameClues(name){
 const value=String(name||''),lower=value.toLowerCase();let suggestedCategory='',categoryReason='';
 const explicit=[['reagents',/\breagents?\b/,'reagent'],['consumables',/\bconsumables?\b/,'consumable'],['spares',/\bspares?\b/,'spare'],['non_stock',/\bservice\b/,'service'],['machines',/\b(?:machine|analy[sz]er|equipment|instrument)\b/,'machine or analyzer']];
 for(const [category,pattern,label] of explicit)if(pattern.test(lower)){suggestedCategory=category;categoryReason=`Item name explicitly says ${label}`;break;}
 const pack=value.match(/\b(?:pack\s+of\s+\d+|p\s*\/\s*\d+|\d+\s*(?:pcs?|pieces?|tests?|strips?)\s*(?:\/\s*)?(?:boxes?|bags?|packs?)?)\b/i);
 return {suggestedCategory,categoryReason,packHint:pack?pack[0].replace(/\s+/g,' ').trim():''};
}
function catalogClassification(p){return typeof inventoryClassification==='function'?inventoryClassification(p.id):null}
function catalogCategoryOf(p){return catalogClassification(p)?.category||p.source?.category||'unclassified'}
function catalogMachineIds(p){
 const ids=p.source?.machine_ids;
 if(ids==null)return [];
 return Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.trim()&&id===id.trim())?ids:null;
}
function catalogProductIssues(p){
 const source=p.source||{},category=catalogCategoryOf(p),issues=productReviewIssues(productReviewDefaults(p));
 if(typeof productMachineLinksError!=='undefined'&&productMachineLinksError)issues.push('Compatible machine links could not be loaded');
 if(catalogMachineIds(p)===null)issues.push('Compatible machine links need review');
 if(!String(p.sku||'').trim())issues.push('Stock code is missing');
 if(['reagents','consumables','spares'].includes(category)&&!(Array.isArray(source.machine_ids)&&source.machine_ids.length))issues.push('No compatible machine is linked');
 if(category==='unclassified')issues.push('Product category is not confirmed');
 return issues;
}
function catalogMatches(p,query){return [p.name,p.sku,p.source?.model,p.source?.specification,p.source?.company].join(' ').toLowerCase().includes(query.trim().toLowerCase())}
function catalogSorted(rows){const issues=catalogSort==='issues'?new Map(rows.map(p=>[p,catalogProductIssues(p).length])):null;return [...rows].sort((a,b)=>{
 const issueDelta=issues?issues.get(b)-issues.get(a):0;
 if(catalogSort==='issues'&&issueDelta)return issueDelta;
 if(catalogSort==='company')return String(a.source?.company||'').localeCompare(String(b.source?.company||''))||String(a.name||'').localeCompare(String(b.name||''));
 return String(a.name||'').localeCompare(String(b.name||''));
})}
function catalogLabel(category){return catalogCategories.find(([id])=>id===category)?.[1]||'Unclassified'}
function catalogMachineLinks(p,rows){
 const editor=canEditRecords()&&['reagents','consumables','spares'].includes(catalogCategoryOf(p))?`<button type="button" data-machine-link-edit="${esc(p.id)}">Edit compatible machines</button>`:'';
 if(typeof productMachineLinksError!=='undefined'&&productMachineLinksError)return '<span role="alert">Machine links unavailable. Refresh data before relying on these relationships.</span>'+editor;
 const machines=rows.filter(x=>catalogCategoryOf(x)==='machines'&&(catalogMachineIds(p)||[]).includes(x.id));
 return (machines.length?machines.map(x=>`<button type="button" data-catalog-machine="${esc(x.id)}">${esc(x.name)}</button>`).join(' '):'<span class="muted">No machine relationship supplied</span>')+editor;
}
function catalogSource(p){
 const source=p.source||{};let rows=Array.isArray(source.rows)?source.rows:[];let notes=Array.isArray(source.review_notes)?source.review_notes:[];
 if(!rows.length&&source.source_file)rows=[{sheet:source.source_file,row:source.source_row||'',column:'Particulars',value:source.raw?.Particulars||p.name||''}];
 for(const entry of Array.isArray(source.unallocated_source_entries)?source.unallocated_source_entries:[])notes=[...notes,`Unallocated source entry: ${typeof entry==='string'?entry:JSON.stringify(entry)}`];
 return `<details><summary>Original rows & review notes</summary>${notes.length?`<ul>${notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`:'<p class="muted">No review notes supplied.</p>'}${rows.length?`<div class="table-wrap"><table><caption>Original spreadsheet references</caption><thead><tr><th scope="col">Sheet</th><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Original value</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.sheet)}</td><td>${esc(row.row)}</td><td>${esc(row.column)}</td><td>${esc(row.value)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No original row references supplied.</p>'}</details>`;
}
function catalogProduct(p,rows){
 const source=p.source||{},category=catalogCategoryOf(p),machine=category==='machines',issues=catalogProductIssues(p),clues=catalogNameClues(p.name),classification=catalogClassification(p);
 return `<article class="contact ${issues.length?'incomplete':''}"><div class="heading"><h3>${machine?`<button type="button" data-catalog-machine="${esc(p.id)}">${esc(p.name||'Product name missing')}</button>`:esc(p.name||'Product name missing')}</h3><span class="tag">${esc(catalogLabel(category))}</span></div>${issues.length?`<p class="revision-label">Needs review · ${issues.map(esc).join(', ')}</p>`:''}${!classification&&(clues.suggestedCategory||clues.packHint)?`<p class="source-clue"><strong>Source-list clue:</strong> ${clues.suggestedCategory?`${esc(catalogLabel(clues.suggestedCategory))} suggested because ${esc(clues.categoryReason.toLowerCase())}. `:''}${clues.packHint?`Pack wording: “${esc(clues.packHint)}” — review only; this is not a carton conversion.`:''}</p>`:''}<div class="details"><div><small>Company</small>${esc(source.company||'Not supplied')}</div><div><small>Model / specification</small>${esc(source.specification||source.model||'Not supplied')}</div><div><small>Stock code</small>${esc(p.sku||'Not supplied')}</div><div><small>Stock quantity</small>Enter through Stock by godown</div></div>${source.description?`<p>${esc(source.description)}</p>`:''}${!machine?`<div><small>Related machines</small><div class="actions">${catalogMachineLinks(p,rows)}</div></div>`:''}${catalogSource(p)}<button type="button" data-product-review="${esc(p.id)}">Review company, specification &amp; sale status</button>${canEditRecords()?`<details><summary>${classification?'Revise confirmed inventory category':'Confirm inventory category'}</summary><form data-inventory-action="classification" data-product="${p.id}" data-version="${classification?.version||0}"><label><span>Inventory category</span><select name="category" required>${catalogCategories.filter(([id])=>!['review','all'].includes(id)).map(([id,label])=>inventoryOption(id,label,(classification?.category||clues.suggestedCategory||'unclassified')===id)).join('')}</select></label><label><span>Reason / source checked</span><textarea name="reason" minlength="5" required>${esc(classification?.reason||clues.categoryReason||'')}</textarea></label><button type="submit">Save reviewed category</button></form></details>`:''}<div class="actions"><button type="button" data-workbench-stock="${esc(p.id)}">Stock by godown</button>${canEditRecords()?`<button type="button" data-product-edit="${esc(p.id)}">Edit product name / stock code</button>`:''}${canEditRecords()?`<button type="button" class="danger" data-archive-business="product" data-id="${esc(p.id)}">Delete product</button>`:''}</div></article>`;
}
function catalogInventory(){
 if(typeof productReviewLoadError!=='undefined'&&productReviewLoadError){
  $('#content').innerHTML=`<section class="card"><h1>Products</h1><p role="alert">Product corrections could not be loaded. Refresh before reviewing the current catalog.</p><p>${esc(productReviewLoadError)}</p><button id="refresh" type="button">Retry loading data</button></section>`;
  return;
 }
 const rows=catalogRows(),machine=rows.find(p=>p.id===catalogMachineId&&catalogCategoryOf(p)==='machines');
 const reviewCount=rows.filter(p=>catalogProductIssues(p).length).length,activeCount=rows.filter(p=>p.source?.sale_status==='active').length,manufacturerCount=new Set(rows.map(p=>String(p.source?.company||'').trim()).filter(Boolean)).size;
 const mappingAction=canEditRecords()?'<button type="button" data-product-mapping-preview>Check stock mapping file</button><label class="file-button"><span>Apply product list file</span><input type="file" id="productListFile" accept=".json,application/json"></label>':'';
 const heading='<section class="cleanup-hero"><div><small>INVENTORY · PRODUCT DATA</small><h1>Products</h1><p>Find a product, or correct its name, company or details.</p>'+recordsLockedNote()+'</div><button id="refresh" type="button">Refresh data</button>'+mappingAction+'</section><div class="cleanup-metrics"><div><small>Products</small><strong>'+rows.length+'</strong></div><div><small>Need review</small><strong>'+reviewCount+'</strong></div><div><small>Active for sale</small><strong>'+activeCount+'</strong></div><div><small>Manufacturers</small><strong>'+manufacturerCount+'</strong></div></div>';
 if(catalogMachineId&&!machine)catalogMachineId='';
 if(machine){
  if(typeof productMachineLinksError!=='undefined'&&productMachineLinksError){$('#content').innerHTML=heading+'<button type="button" data-catalog-back>← Back to catalog</button><p role="alert">Machine links could not be loaded. Refresh data before viewing related products.</p>';return;}
  const linked=rows.filter(p=>catalogCategoryOf(p)!=='machines'&&(catalogMachineIds(p)||[]).includes(machine.id));
  $('#content').innerHTML=heading+`<button type="button" data-catalog-back>← Back to catalog</button><section aria-label="Machine details">${catalogProduct(machine,rows)}</section><p class="muted">${linked.length} related product${linked.length===1?'':'s'}. Products shared by several machines reference the same catalog record.</p>`+catalogCategories.filter(([id])=>!['all','machines'].includes(id)).map(([category,label])=>{
   const items=linked.filter(p=>catalogCategoryOf(p)===category);
   return `<details class="card"><summary>${label} · ${items.length}</summary>${items.map(p=>catalogProduct(p,rows)).join('')||`<p class="empty">No ${label.toLowerCase()} linked to this machine.</p>`}</details>`;
  }).join('');
  bindProductWorkbench();
  if(typeof bindInventoryWorkspace==='function')bindInventoryWorkspace();
  return;
 }
 const duplicates=typeof productDuplicateCounts==='function'?productDuplicateCounts(rows):null,colourOf=p=>typeof productQuality==='function'?productQuality(p,duplicates).level||'ok':'ok';
 const categoryRows=rows.filter(p=>catalogCategory==='all'||catalogCategory==='review'&&catalogProductIssues(p).length||catalogCategoryOf(p)===catalogCategory),matches=catalogSorted(categoryRows.filter(p=>catalogMatches(p,catalogSearch)&&(!catalogColour||colourOf(p)===catalogColour)));
 const colourCounts={red:0,yellow:0,ok:0};for(const p of categoryRows)colourCounts[colourOf(p)]++;
 const paged=catalogPageRows(matches,catalogPage);catalogPage=paged.page;
 $('#content').innerHTML=heading+`<section class="cleanup-controls"><div class="tabs" role="group" aria-label="Product categories">${catalogCategories.map(([category,label])=>`<button type="button" data-catalog-category="${category}" class="${category===catalogCategory?'active':''}" aria-pressed="${category===catalogCategory}">${label} <small>${rows.filter(p=>category==='all'||category==='review'&&catalogProductIssues(p).length||catalogCategoryOf(p)===category).length}</small></button>`).join('')}</div><div class="cleanup-search"><label><span>Search products</span><input id="catalogSearch" type="search" value="${esc(catalogSearch)}" placeholder="Name, manufacturer, model or stock code"></label><label><span>Sort by</span><select id="catalogSort"><option value="name" ${catalogSort==='name'?'selected':''}>Product name</option><option value="company" ${catalogSort==='company'?'selected':''}>Manufacturer</option><option value="issues" ${catalogSort==='issues'?'selected':''}>Most issues first</option></select></label><label><span>Colour</span><select id="catalogColour"><option value="">All colours</option><option value="red" ${catalogColour==='red'?'selected':''}>Red · ${colourCounts.red}</option><option value="yellow" ${catalogColour==='yellow'?'selected':''}>Yellow · ${colourCounts.yellow}</option><option value="ok" ${catalogColour==='ok'?'selected':''}>No colour · ${colourCounts.ok}</option></select></label></div><p role="status"><strong>${matches.length}</strong> matching product${matches.length===1?'':'s'} · ${categoryRows.length} in ${esc(catalogLabel(catalogCategory).toLowerCase())}</p></section>`+productWorkbenchTable(paged.rows)+(matches.length?'':`<div class="empty">${rows.length?'No products match this category and search.':'No product-list records have been imported yet.'}</div>`);
 $("#content").insertAdjacentHTML("beforeend",`<div class="actions"><button id="catalogPrev" ${catalogPage===0?"disabled":""}>Previous</button><span>Page ${catalogPage+1} of ${paged.pages}</span><button id="catalogNext" ${catalogPage+1>=paged.pages?"disabled":""}>Next</button></div>`);
 $("#catalogPrev").onclick=()=>{catalogPage--;catalogInventory()};$("#catalogNext").onclick=()=>{catalogPage++;catalogInventory()};
 $('#catalogSearch').addEventListener('input',e=>{
  catalogSearch=e.target.value;catalogPage=0;renderSearchPreservingPosition(e.target,catalogInventory,150);
 });
 $('#catalogSort').onchange=e=>{catalogSort=e.target.value;catalogPage=0;catalogInventory()};
 $('#catalogColour').onchange=e=>{catalogColour=e.target.value;catalogPage=0;catalogInventory()};
 const listFile=$('#productListFile');if(listFile)listFile.onchange=()=>{const file=listFile.files[0];if(!file)return;run(async()=>{const total=await applyProductListFile(file);inventoryLoaded=false;await load();message(productListSummary(total));});};
 bindProductWorkbench();
 if(typeof bindInventoryWorkspace==='function')bindInventoryWorkspace();
}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button||!button.closest('#content'))return;
 if(button.hasAttribute('data-catalog-category')){const category=button.dataset.catalogCategory;if(!catalogCategories.some(([id])=>id===category))return;catalogCategory=category;catalogMachineId='';catalogInventory()}
 else if(button.hasAttribute('data-catalog-machine')){catalogMachineId=button.dataset.catalogMachine;catalogInventory()}
 else if(button.hasAttribute('data-catalog-back')){catalogMachineId='';catalogInventory()}
});
