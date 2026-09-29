'use strict';
// Authenticated ERP products only. Never load the local workbench's bundled data.js.
function productWorkbenchTable(rows){
 if(!rows.length)return '<p class="empty">No products match. Clear the search or select another category.</p>';
 return '<div class="table-wrap"><table><caption>Shared product data · corrections are saved to Supabase</caption><thead><tr><th scope="col">Product / code</th><th scope="col">Manufacturer</th><th scope="col">Specification</th><th scope="col">Sale status</th><th scope="col">Category / data quality</th><th scope="col">Actions</th></tr></thead><tbody>'+rows.map(p=>{
  const s=p.source||{},issues=catalogProductIssues(p),status=s.sale_status==='active'?'Active — for sale':s.sale_status==='inactive_serviced'?'Not sold — still serviced':'Needs review';
  return `<tr><td><strong>${esc(p.name)}</strong><small>${esc(p.sku||'Stock code missing')}</small></td><td>${esc(s.company||'Needs review')}</td><td>${esc(s.specification||s.model||'Needs review')}</td><td>${esc(status)}</td><td>${esc(catalogLabel(catalogCategoryOf(p)))}<details><summary>${issues.length?`${issues.length} checks needed`:'Details reviewed'}</summary>${issues.length?'<ul>'+issues.map(i=>`<li>${esc(i)}</li>`).join('')+'</ul>':'Stock must still be verified by godown.'}</details></td><td><div class="actions"><button type="button" data-product-review="${esc(p.id)}">Correct details</button><button type="button" data-product-edit="${esc(p.id)}">Name / code</button><button type="button" data-workbench-detail="${esc(p.id)}">Category &amp; source</button><button type="button" data-workbench-stock="${esc(p.id)}">Stock by godown</button></div></td></tr>`;
 }).join('')+'</tbody></table></div>';
}
function bindProductWorkbench(){
 document.querySelectorAll('[data-workbench-stock]').forEach(button=>button.onclick=()=>{
  const product=products.find(p=>p.id===button.dataset.workbenchStock);if(!product)return;
  inventoryProductId=product.id;inventorySearch='';inventorySection='stock';run(()=>inventoryWorkspace());
 });
 document.querySelectorAll('[data-workbench-detail]').forEach(button=>button.onclick=()=>{
  const rows=catalogRows(),product=rows.find(p=>p.id===button.dataset.workbenchDetail);if(!product)return;
  $('#content').innerHTML='<button type="button" id="workbenchBack">← Back to product workbench</button>'+catalogProduct(product,rows);
  $('#workbenchBack').onclick=catalogInventory;
  bindInventoryWorkspace();
 });
}
