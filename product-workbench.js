'use strict';
// Authenticated ERP products only. Never load the local workbench's bundled data.js.
function productWorkbenchTable(rows){
 if(!rows.length)return '<p class="empty">No products match. Clear the search or select another category.</p>';
 const duplicates=typeof productDuplicateCounts==='function'?productDuplicateCounts(catalogRows()):null;
 if(duplicates)for(const p of rows)if(p.catalog_current)duplicates.set(productDuplicateKey(p),p.catalog_duplicate_count);
 return '<div class="table-wrap"><table class="product-quality-table" role="table"><caption>Product details and availability</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Product / code</th><th scope="col" role="columnheader">Manufacturer / model</th><th scope="col" role="columnheader">Status</th><th scope="col" role="columnheader">Actions</th></tr></thead><tbody role="rowgroup">'+rows.map(p=>{
  const source=p.source||{},quality=typeof productQuality==='function'?productQuality(p,duplicates):{level:'',issues:[]};
  const status=source.sale_status==='active'?'For sale':source.sale_status==='inactive_serviced'?'Service only':'Needs review';
  return `<tr data-catalog-row="${esc(p.id)}" role="row" class="${quality.level?'quality-'+quality.level:''}"><td role="cell" data-label="Product / code"><span class="phone-cell-label" aria-hidden="true">Product / code</span><strong>${esc(p.name)}</strong><small>${esc(p.sku||'Stock code missing')} · ${esc(catalogLabel(catalogCategoryOf(p)))}</small></td><td role="cell" data-label="Manufacturer / model"><span class="phone-cell-label" aria-hidden="true">Manufacturer / model</span>${esc(source.company||'Company needs review')}<small>${esc(source.specification||source.model||'Specification needs review')}</small></td><td role="cell" data-label="Status"><span class="phone-cell-label" aria-hidden="true">Status</span>${esc(status)}${typeof qualityBadge==='function'?qualityBadge(quality.level,quality.issues):''}</td><td role="cell" data-label="Actions" class="phone-card-actions"><span class="phone-cell-label" aria-hidden="true">Actions</span><div class="actions"><button type="button" class="button-quiet" data-workbench-detail="${esc(p.id)}">Open product</button></div></td></tr>`;
 }).join('')+'</tbody></table></div>';
}

function bindProductWorkbench(){
 if(typeof bindQuotationDocuments==='function')bindQuotationDocuments();
 if(typeof catalogIsActive==='function'&&catalogIsActive())document.querySelectorAll('[data-product-brochures]').forEach(button=>button.onclick=()=>run(()=>openDocumentAttachments('product',button.dataset.productBrochures,catalogRows().find(p=>p.id===button.dataset.productBrochures)?.name||'Product')));
 document.querySelectorAll('[data-workbench-stock]').forEach(button=>button.onclick=()=>{
  inventoryProductId=button.dataset.workbenchStock;inventorySearch='';inventorySection='stock';run(()=>inventoryWorkspace());
 });
 document.querySelectorAll('[data-workbench-detail]').forEach(button=>button.onclick=()=>run(()=>openWorkspaceRecord('product',button.dataset.workbenchDetail),{origin:button}));
}
