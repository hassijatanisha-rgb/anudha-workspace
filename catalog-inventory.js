'use strict';

const catalogDataset='allocation-2026-09-17';
const catalogCategories=[['all','All products'],['machines','Machines'],['reagents','Reagents'],['consumables','Consumables'],['spares','Spares']];
let catalogCategory='machines',catalogSearch='',catalogMachineId='';
function catalogRows(){return products.filter(p=>p.source?.dataset===catalogDataset)}
function catalogMatches(p,query){return [p.name,p.sku,p.source?.model,p.source?.company].join(' ').toLowerCase().includes(query.trim().toLowerCase())}
function catalogLabel(category){return catalogCategories.find(([id])=>id===category)?.[1]||'Unclassified'}
function catalogMachineLinks(p,rows){
 const machines=rows.filter(x=>x.source?.category==='machines'&&(p.source?.machine_ids||[]).includes(x.id));
 return machines.length?machines.map(x=>`<button type="button" data-catalog-machine="${esc(x.id)}">${esc(x.name)}</button>`).join(' '):'<span class="muted">No machine relationship supplied</span>';
}
function catalogSource(p){
 const source=p.source||{},rows=Array.isArray(source.rows)?source.rows:[];let notes=Array.isArray(source.review_notes)?source.review_notes:[];
 for(const entry of Array.isArray(source.unallocated_source_entries)?source.unallocated_source_entries:[])notes=[...notes,`Unallocated source entry: ${typeof entry==='string'?entry:JSON.stringify(entry)}`];
 return `<details><summary>Original rows & review notes</summary>${notes.length?`<ul>${notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`:'<p class="muted">No review notes supplied.</p>'}${rows.length?`<div class="table-wrap"><table><caption>Original spreadsheet references</caption><thead><tr><th scope="col">Sheet</th><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Original value</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.sheet)}</td><td>${esc(row.row)}</td><td>${esc(row.column)}</td><td>${esc(row.value)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No original row references supplied.</p>'}</details>`;
}
function catalogProduct(p,rows){
 const source=p.source||{},machine=source.category==='machines';
 return `<article class="contact"><div class="heading"><h3>${machine?`<button type="button" data-catalog-machine="${esc(p.id)}">${esc(p.name)}</button>`:esc(p.name)}</h3><span class="tag">${esc(catalogLabel(source.category))}</span></div><div class="details"><div><small>Company</small>${esc(source.company||'Not supplied')}</div><div><small>Model</small>${esc(source.model||'Not supplied')}</div><div><small>SKU</small>${esc(p.sku||'Not supplied')}</div><div><small>Stock</small>Stock quantity not supplied</div></div>${source.description?`<p>${esc(source.description)}</p>`:''}${machine?'':`<div><small>Related machines</small><div class="actions">${catalogMachineLinks(p,rows)}</div></div>`}${catalogSource(p)}<div class="actions"><button type="button" data-product-edit="${esc(p.id)}">Edit product</button></div></article>`;
}
function catalogInventory(){
 const rows=catalogRows(),machine=rows.find(p=>p.id===catalogMachineId&&p.source?.category==='machines');
 const heading='<div class="heading"><div><small>INVENTORY · FORMAT REVIEW</small><h1>Product catalog</h1><p class="muted">Review the allocation spreadsheet by machine and product category.</p></div><button id="refresh" type="button">Refresh</button></div><p class="warning">Stock quantity not supplied. This catalog shows product descriptions and machine relationships for format review.</p>';
 if(catalogMachineId&&!machine)catalogMachineId='';
 if(machine){
  const linked=rows.filter(p=>p.source?.category!=='machines'&&(p.source?.machine_ids||[]).includes(machine.id));
  $('#content').innerHTML=heading+`<button type="button" data-catalog-back>← Back to catalog</button><section aria-label="Machine details">${catalogProduct(machine,rows)}</section><p class="muted">${linked.length} related product${linked.length===1?'':'s'}. Products shared by several machines reference the same catalog record.</p>`+catalogCategories.filter(([id])=>!['all','machines'].includes(id)).map(([category,label])=>{
   const items=linked.filter(p=>p.source?.category===category);
   return `<details class="card"><summary>${label} · ${items.length}</summary>${items.map(p=>catalogProduct(p,rows)).join('')||`<p class="empty">No ${label.toLowerCase()} linked to this machine.</p>`}</details>`;
  }).join('');
  return;
 }
 const categoryRows=rows.filter(p=>catalogCategory==='all'||p.source?.category===catalogCategory),matches=categoryRows.filter(p=>catalogMatches(p,catalogSearch));
 $('#content').innerHTML=heading+`<div class="tabs" role="group" aria-label="Product categories">${catalogCategories.map(([category,label])=>`<button type="button" data-catalog-category="${category}" class="${category===catalogCategory?'active':''}" aria-pressed="${category===catalogCategory}">${label} <small>${rows.filter(p=>category==='all'||p.source?.category===category).length}</small></button>`).join('')}</div><label><span>Search product name, model, company or SKU</span><input id="catalogSearch" type="search" value="${esc(catalogSearch)}" placeholder="Find a product"></label><p role="status">${matches.length} matching product${matches.length===1?'':'s'} · ${categoryRows.length} in ${esc(catalogLabel(catalogCategory).toLowerCase())}</p>`+matches.map(p=>catalogProduct(p,rows)).join('')+(matches.length?'':`<div class="empty">${rows.length?'No products match this category and search.':'No allocation spreadsheet products have been imported yet.'}</div>`);
 $('#catalogSearch').addEventListener('input',e=>{
  catalogSearch=e.target.value;catalogInventory();$('#catalogSearch').focus();
 });
}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button||!button.closest('#content'))return;
 if(button.hasAttribute('data-catalog-category')){const category=button.dataset.catalogCategory;if(!catalogCategories.some(([id])=>id===category))return;catalogCategory=category;catalogMachineId='';catalogInventory()}
 else if(button.hasAttribute('data-catalog-machine')){catalogMachineId=button.dataset.catalogMachine;catalogInventory()}
 else if(button.hasAttribute('data-catalog-back')){catalogMachineId='';catalogInventory()}
});
