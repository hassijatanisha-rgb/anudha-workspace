'use strict';

const catalogCategories=[['review','Needs review'],['all','All products'],['machines','Machines'],['furniture','Furniture'],['reagents','Reagents'],['consumables','Consumables'],['spares','Spares'],['non_stock','Service / non-stock'],['unclassified','Not sorted yet']];
let catalogCategory='review',catalogSearch='',catalogMachineId='',catalogSort='name',catalogPage=0,catalogColour='';
let catalogRequest=0,catalogSession=0,catalogResult=null,catalogDetailRows=new Map(),catalogMachineProduct=null,catalogSelectedProduct='',catalogMachineChoices=[];
function catalogListLocation(){if(workspaceRecordRoute(location.hash)?.kind==='product')navRecordPage('#/go/inventory/catalog');}
function catalogIsActive(){return (typeof view==='undefined'||view==='inventory')&&(typeof inventorySection==='undefined'||inventorySection==='catalog')}
function clearCatalogInventory(){catalogSession++;catalogRequest++;catalogResult=null;catalogDetailRows.clear();catalogMachineProduct=null;catalogSelectedProduct='';catalogMachineChoices=[];catalogPage=0;catalogMachineId='';catalogSearch='';catalogCategory='review';catalogColour='';catalogSort='name';}
function catalogRows(){
 if(catalogIsActive()&&catalogResult){const rows=new Map(catalogResult.rows.map(p=>[p.id,p]));for(const [id,p] of catalogDetailRows)rows.set(id,p);return [...rows.values()];}
 return products.filter(p=>!p.deleted_at).map(reviewedCatalogProduct);
}
async function requestCatalogPage(options={}){
 const response=await client.rpc('catalog_page',{p_query:'',p_category:'all',p_colour:'',p_sort:'name',p_page:0,p_machine_id:null,p_product_id:null,...options});
 if(response.error)throw Error(`Products could not be loaded: ${response.error.message}`);
 const data=response.data;
 if(!data||!Array.isArray(data.rows)||data.rows.length>25||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||!Number.isSafeInteger(data.pages)||data.pages<1||data.page>=data.pages||!data.metrics||!data.category_counts||!data.colour_counts)throw Error('The server did not return a complete product page.');
 return data;
}
async function loadCatalogProduct(id){
 const actor=me,session=catalogSession,request=catalogRequest;
 const data=await requestCatalogPage({p_product_id:id});
 if(me!==actor||session!==catalogSession)throw Error('Login changed; reopen the product.');
 if(request!==catalogRequest||!catalogIsActive())return null;
 const product=data.rows.find(p=>p.id===id);
 if(!product?.original)throw Error('This product is unavailable. Refresh the catalog.');
 catalogDetailRows.set(id,product);
 return product.original;
}
async function loadCatalogMachines(){
 const actor=me,session=catalogSession,request=catalogRequest,rows=[];let page=0,pages=1;
 do{
  const data=await requestCatalogPage({p_category:'machines',p_page:page});
  if(me!==actor||session!==catalogSession)throw Error('Login changed; reopen machine links.');
  if(request!==catalogRequest||!catalogIsActive())return [];
  rows.push(...data.rows);pages=data.pages;page++;
 }while(page<pages);
 catalogMachineChoices=rows;return rows;
}
function catalogNameClues(name){
 const value=String(name||''),lower=value.toLowerCase();let suggestedCategory='',categoryReason='';
 const explicit=[['reagents',/\breagents?\b/,'reagent'],['consumables',/\bconsumables?\b/,'consumable'],['spares',/\bspares?\b/,'spare'],['non_stock',/\bservice\b/,'service'],['machines',/\b(?:machine|analy[sz]er|equipment|instrument)\b/,'machine or analyzer']];
 for(const [category,pattern,label] of explicit)if(pattern.test(lower)){suggestedCategory=category;categoryReason=`Item name explicitly says ${label}`;break;}
 const pack=value.match(/\b(?:pack\s+of\s+\d+|p\s*\/\s*\d+|\d+\s*(?:pcs?|pieces?|tests?|strips?)\s*(?:\/\s*)?(?:boxes?|bags?|packs?)?)\b/i);
 return {suggestedCategory,categoryReason,packHint:pack?pack[0].replace(/\s+/g,' ').trim():''};
}
function catalogClassification(p){return p.catalog_current?p.catalog_classification:typeof inventoryClassification==='function'?inventoryClassification(p.id):null}
function catalogCategoryOf(p){return catalogClassification(p)?.category||p.source?.category||'unclassified'}
function catalogMachineIds(p){
 const ids=p.source?.machine_ids;
 if(ids==null)return [];
 return Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.trim()&&id===id.trim())?ids:null;
}
function catalogProductIssues(p){
 const source=p.source||{},category=catalogCategoryOf(p),issues=productReviewIssues(productReviewDefaults(p));
 if(!p.catalog_current&&typeof productMachineLinksError!=='undefined'&&productMachineLinksError)issues.push('Compatible machine links could not be loaded');
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
 if(!p.catalog_current&&typeof productMachineLinksError!=='undefined'&&productMachineLinksError)return '<span role="alert">Machine links unavailable. Refresh data before relying on these relationships.</span>'+editor;
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
 return `<article data-catalog-detail="${esc(p.id)}" class="contact ${issues.length?'incomplete':''}"><div class="heading"><h3>${machine?`<button type="button" data-catalog-machine="${esc(p.id)}">${esc(p.name||'Product name missing')}</button>`:esc(p.name||'Product name missing')}</h3><span class="tag">${esc(catalogLabel(category))}</span></div>${issues.length?`<p class="revision-label">Needs review · ${issues.map(esc).join(', ')}</p>`:''}${!classification&&(clues.suggestedCategory||clues.packHint)?`<p class="source-clue"><strong>Source-list clue:</strong> ${clues.suggestedCategory?`${esc(catalogLabel(clues.suggestedCategory))} suggested because ${esc(clues.categoryReason.toLowerCase())}. `:''}${clues.packHint?`Pack wording: “${esc(clues.packHint)}” — review only; this is not a carton conversion.`:''}</p>`:''}<div class="details"><div><small>Company</small>${esc(source.company||'Not supplied')}</div><div><small>Model / specification</small>${esc(source.specification||source.model||'Not supplied')}</div><div><small>Stock code</small>${esc(p.sku||'Not supplied')}</div><div><small>Stock quantity</small>Enter through Stock by godown</div></div>${source.description?`<p>${esc(source.description)}</p>`:''}${!machine?`<div><small>Related machines</small><div class="actions">${catalogMachineLinks(p,rows)}</div></div>`:''}${catalogSource(p)}<button type="button" data-product-review="${esc(p.id)}">Review company, specification &amp; sale status</button>${canEditRecords()?`<details><summary>${classification?'Revise confirmed inventory category':'Confirm inventory category'}</summary><form data-inventory-action="classification" data-product="${p.id}" data-version="${classification?.version||0}"><label><span>Inventory category</span><select name="category" required>${catalogCategories.filter(([id])=>!['review','all'].includes(id)).map(([id,label])=>inventoryOption(id,label,(classification?.category||clues.suggestedCategory||'unclassified')===id)).join('')}</select></label><label><span>Reason / source checked</span><textarea name="reason" minlength="5" required>${esc(classification?.reason||clues.categoryReason||'')}</textarea></label><button type="submit">Save reviewed category</button></form></details>`:''}<div class="actions"><button type="button" data-workbench-stock="${esc(p.id)}">Stock by godown</button>${typeof productBrochuresButton==='function'?productBrochuresButton(p):''}${canEditRecords()?`<button type="button" data-product-edit="${esc(p.id)}">Edit product name / stock code</button>`:''}${canEditRecords()?`<button type="button" class="danger" data-archive-business="product" data-id="${esc(p.id)}">Delete product</button>`:''}</div></article>`;
}
function catalogHeader(product=null){
 if(product)return workspacePageHeader({title:product.name||'Product name missing',subtitle:[product.source?.company,product.source?.specification||product.source?.model].filter(Boolean).join(' · '),back:'<button type="button" id="workbenchBack">← Back to products</button>',breadcrumbs:`<a href="#/go/inventory/catalog">Products</a><a href="#/product/${esc(product.id)}" aria-current="page">${esc(product.name||'Product name missing')}</a>`,actions:'<button id="refresh" type="button">Refresh data</button>'});
 return workspacePageHeader({title:'Products',subtitle:'Find a product, or correct its name, company or details.',back:catalogMachineId?'<button type="button" data-catalog-back>← Back to catalog</button>':'',actions:'<button id="refresh" type="button">Refresh data</button>'+(canEditRecords()?'<button id="newProduct" type="button" class="button-primary">Add product</button>':'')});
}
function catalogUpdateHeader(product=null){
 const header=$('#content .workspace-page-header'),template=document.createElement('template');
 template.innerHTML=catalogHeader(product);const next=template.content.firstElementChild;
 if(product&&header.dataset.catalogProduct===product.id){
  header.querySelector('h1').textContent=next.querySelector('h1').textContent;
  const before=header.querySelector('.workspace-page-heading p'),after=next.querySelector('.workspace-page-heading p');
  if(before&&after)before.textContent=after.textContent;else if(before)before.remove();else if(after)header.querySelector('.workspace-page-heading').append(after);
  header.querySelector('[aria-current="page"]').textContent=product.name||'Product name missing';
 }else header.innerHTML=next.innerHTML;
 header.dataset.catalogProduct=product?.id||'';
 return header;
}
function catalogRender(data){
 const metrics=data?.metrics,counts=data?.category_counts||{},colours=data?.colour_counts||{};
 const mappingAction=canEditRecords()?'<details><summary>Import and mapping tools</summary><button type="button" data-product-mapping-preview>Check stock mapping file</button><label class="file-button"><span>Apply product list file</span><input type="file" id="productListFile" accept=".json,application/json"></label></details>':'';
 $('#content').innerHTML=catalogHeader()+recordsLockedNote()+mappingAction+(metrics?'<div class="cleanup-metrics"><div><small>Products</small><strong data-catalog-metric="products">'+metrics.products+'</strong></div><div><small>Need review</small><strong data-catalog-metric="review">'+metrics.review+'</strong></div><div><small>Active for sale</small><strong data-catalog-metric="active">'+metrics.active+'</strong></div><div><small>Manufacturers</small><strong data-catalog-metric="manufacturers">'+metrics.manufacturers+'</strong></div></div>':workspaceSkeleton('metrics',''))+
 (catalogMachineId?`<section class="card"><h2>Products compatible with ${esc(catalogMachineProduct?.name||'this machine')}</h2><button type="button" data-workbench-detail="${esc(catalogMachineId)}">Machine details</button></section>`:'')+
 `<section class="cleanup-controls"><div class="tabs" role="group" aria-label="Product categories">${catalogCategories.map(([category,label])=>`<button type="button" data-catalog-category="${category}" class="${category===catalogCategory?'active':''}" aria-pressed="${category===catalogCategory}">${label}${data?` <small data-catalog-count="${category}">${counts[category]||0}</small>`:''}</button>`).join('')}</div><div class="cleanup-search"><label><span>Search products</span><input id="catalogSearch" type="search" maxlength="2000" value="${esc(catalogSearch)}" placeholder="Name, manufacturer, model or stock code"></label><label><span>Sort by</span><select id="catalogSort"><option value="name" ${catalogSort==='name'?'selected':''}>Product name</option><option value="company" ${catalogSort==='company'?'selected':''}>Manufacturer</option><option value="issues" ${catalogSort==='issues'?'selected':''}>Most issues first</option></select></label><label><span>Colour</span><select id="catalogColour"><option value="">All colours</option>${[['red','Red'],['yellow','Yellow'],['ok','No colour']].map(([value,label])=>`<option value="${value}" data-catalog-colour="${value}" ${catalogColour===value?'selected':''}>${label}${data?' · '+(colours[value]||0):''}</option>`).join('')}</select></label></div><p id="catalogStatus" role="status">${data?`<strong>${data.total}</strong> matching product${data.total===1?'':'s'} · ${counts[catalogCategory]||0} in ${esc(catalogLabel(catalogCategory).toLowerCase())}`:'Loading products…'}</p></section><div id="catalogSaveNotice" role="status"></div><div id="catalogDetail"></div><div id="catalogResults" aria-busy="${!data}">${data?productWorkbenchTable(data.rows):workspaceSkeleton('catalog-table','')}</div>`+
 `<div id="catalogPaging" class="actions"><button id="catalogPrev" ${!data||data.page===0?'disabled':''}>Previous</button><span id="catalogPageStatus" tabindex="-1">Page ${data?data.page+1:1} of ${data?.pages||1} · 25 products per page</span><button id="catalogNext" ${!data||data.page+1>=data.pages?'disabled':''}>Next</button></div>`;
 const previous=$('#catalogPrev'),next=$('#catalogNext');
 if(previous)previous.onclick=()=>run(()=>{catalogPage--;catalogListLocation();return catalogInventory()});
 if(next)next.onclick=()=>run(()=>{catalogPage++;catalogListLocation();return catalogInventory()});
 $('#catalogSearch').addEventListener('input',e=>{
  catalogSearch=e.target.value;catalogPage=0;catalogRequest++;catalogListLocation();
  renderSearchPreservingPosition(e.target,catalogInventory,250);
 });
 $('#catalogSort').onchange=e=>{catalogSort=e.target.value;catalogPage=0;catalogListLocation();catalogInventory()};
 $('#catalogColour').onchange=e=>{catalogColour=e.target.value;catalogPage=0;catalogListLocation();catalogInventory()};
 const listFile=$('#productListFile');if(listFile)listFile.onchange=()=>{const file=listFile.files[0];if(!file)return;run(async()=>{const total=await applyProductListFile(file);inventoryLoaded=false;await load();message(productListSummary(total));});};
 document.querySelectorAll('[data-catalog-row]').forEach(row=>row.catalogRowHtml=row.outerHTML);
 catalogSelectedProduct='';
 bindProductWorkbench();
 if(typeof bindInventoryWorkspace==='function')bindInventoryWorkspace();
}
function catalogSaveContext(){
 const actor=me,session=catalogSession,request=catalogRequest,root=$('#catalogResults');
 return {actor,current:()=>!!actor&&me===actor&&session===catalogSession&&request===catalogRequest&&catalogIsActive()&&root?.isConnected&&$('#catalogResults')===root};
}
function catalogInvalidateProductCaches(){
 if(typeof inventoryLoaded!=='undefined')inventoryLoaded=false;
 if(typeof inventoryEpoch!=='undefined')inventoryEpoch++;
 if(typeof machineLinksEpoch!=='undefined')machineLinksEpoch++;
 if(typeof inventoryStockPageKey!=='undefined')inventoryStockPageKey='';
 if(typeof inventoryOperationsKey!=='undefined')inventoryOperationsKey='';
 if(typeof inventoryStockActionsReady!=='undefined')inventoryStockActionsReady=false;
 if(typeof listsLoaded!=='undefined')listsLoaded=false;
 if(typeof listsEpoch!=='undefined')listsEpoch++;
 if(typeof listsLoading!=='undefined')listsLoading=null;
}
function catalogPreserveDisclosures(old,replacement){
 const states=[...old.querySelectorAll('details')].map(node=>node.open);
 replacement.querySelectorAll('details').forEach((node,index)=>{node.open=!!states[index]});
}
function catalogShowDetail(product){
 const target=$('#catalogDetail');if(!target)return;
 const old=target.querySelector('[data-catalog-detail]'),template=document.createElement('template');
 template.innerHTML=catalogProduct(product,[product,...catalogMachineChoices]);const card=template.content.firstElementChild;
 if(old){catalogPreserveDisclosures(old,card);old.replaceWith(card)}
 else{target.replaceChildren();target.append(card)}
 const header=catalogUpdateHeader(product),edit=card.querySelector('[data-product-edit]');
 if(edit){if(header.querySelector('[data-product-edit]'))edit.remove();else{edit.setAttribute('class','button-primary');header.querySelector('.workspace-page-actions').append(edit);}}
 catalogSelectedProduct=product.id;
 $('#workbenchBack').onclick=()=>{catalogRequest++;catalogSelectedProduct='';target.replaceChildren();catalogUpdateHeader();navRecordPage('#/go/inventory/catalog');return navRenderListPlace(()=>$('#catalogSearch')?.focus({preventScroll:true}),{reuse:true})};
 bindProductWorkbench();if(typeof bindInventoryWorkspace==='function')bindInventoryWorkspace();
}
async function catalogOpenRecord(id){
 const actor=me,session=catalogSession,loadEpoch=sessionLoadEpoch,navigationRequest=workspaceLeaveSequence,request=++catalogRequest,hash=location.hash,current=()=>navigationRequest===workspaceLeaveSequence&&me===actor&&loadEpoch===sessionLoadEpoch&&session===catalogSession&&request===catalogRequest&&catalogIsActive()&&location.hash===hash;
 try{
  await loadCatalogProduct(id);if(!current())return;
  const product=catalogDetailRows.get(id);if((catalogMachineIds(product)||[]).length)await loadCatalogMachines();
  if(current())catalogShowDetail(product);
 }catch(error){if(current())throw error;}
}
function catalogReconcilePage(data){
 const target=$('#catalogResults'),template=document.createElement('template');template.innerHTML=productWorkbenchTable(data.rows);
 const oldBody=target.querySelector('tbody'),newBody=template.content.querySelector('tbody');
 if(oldBody&&newBody){
  const oldRows=new Map([...oldBody.querySelectorAll('[data-catalog-row]')].map(row=>[row.dataset.catalogRow,row]));
  let cursor=oldBody.firstElementChild;
  for(const row of [...newBody.querySelectorAll('[data-catalog-row]')]){
   row.catalogRowHtml=row.outerHTML;const old=oldRows.get(row.dataset.catalogRow),retained=old?.catalogRowHtml===row.catalogRowHtml;
   const next=retained?old:row;if(old&&!retained)catalogPreserveDisclosures(old,row);
   if(next===cursor)cursor=cursor.nextElementSibling;else oldBody.insertBefore(next,cursor);
   if(old&&!retained){if(cursor===old)cursor=old.nextElementSibling;old.remove()}
   oldRows.delete(row.dataset.catalogRow);
  }
  for(const row of oldRows.values())row.remove();
 }else target.replaceChildren(...template.content.children);
 target.querySelectorAll('[data-catalog-row]').forEach(row=>{if(!row.catalogRowHtml)row.catalogRowHtml=row.outerHTML});
 target.setAttribute('aria-busy','false');
 document.querySelectorAll('[data-catalog-metric]').forEach(node=>node.textContent=data.metrics[node.dataset.catalogMetric]);
 document.querySelectorAll('[data-catalog-count]').forEach(node=>node.textContent=data.category_counts[node.dataset.catalogCount]||0);
 document.querySelectorAll('[data-catalog-colour]').forEach(node=>node.textContent=({red:'Red',yellow:'Yellow',ok:'No colour'}[node.dataset.catalogColour])+' · '+(data.colour_counts[node.dataset.catalogColour]||0));
 $('#catalogStatus').textContent=`${data.total} matching product${data.total===1?'':'s'} · ${data.category_counts[catalogCategory]||0} in ${catalogLabel(catalogCategory).toLowerCase()}`;
 $('#catalogPrev').disabled=data.page===0;$('#catalogNext').disabled=data.page+1>=data.pages;
 $('#catalogPageStatus').textContent=`Page ${data.page+1} of ${data.pages} · 25 products per page`;
 catalogResult=data;catalogPage=data.page;
 bindProductWorkbench();if(typeof bindInventoryWorkspace==='function')bindInventoryWorkspace();
}
function catalogProductRefreshPending(id,pending){
 for(const node of document.querySelectorAll('[data-workbench-detail],[data-product-review],[data-product-edit],[data-machine-link-edit],[data-archive-business="product"]'))if([node.dataset.workbenchDetail,node.dataset.productReview,node.dataset.productEdit,node.dataset.machineLinkEdit,node.dataset.id].includes(id))node.disabled=pending;
 for(const form of document.querySelectorAll('[data-inventory-action="classification"]'))if(form.dataset.product===id)form.querySelectorAll('button,input,select,textarea').forEach(node=>node.disabled=pending);
}
async function refreshCatalogSavedProduct(id,text='Product saved.',context=catalogSaveContext(),expected={}){
 if(!context.current())return;
 catalogInvalidateProductCaches();catalogRequest++;const session=catalogSession,notice=$('#catalogSaveNotice');let scope=catalogSaveContext(),verified=false;
 let active=document.activeElement;const scroll=typeof window!=='undefined'?{left:window.scrollX,top:window.scrollY}:null;
 const focus=()=>{
  if(!scope.current())return;
  if(active?.isConnected&&!active.closest('dialog')&&!active.disabled)active.focus({preventScroll:true});
  else if(active?.id==='catalogRetrySaved'&&$('#catalogRetrySaved'))$('#catalogRetrySaved').focus({preventScroll:true});
  else if(!document.activeElement?.closest('dialog[open]')){
   const detail=$('#catalogDetail')?.querySelector('[data-catalog-detail]'),row=[...document.querySelectorAll('[data-catalog-row]')].find(node=>node.dataset.catalogRow===id);
   (detail?.querySelector('[data-product-review]')||row?.querySelector('[data-workbench-detail]')||$('#catalogPageStatus'))?.focus({preventScroll:true});
  }
  if(scroll)window.scrollTo(scroll);
 };
 const refresh=async()=>{
  if(!scope.current())return;
  active=document.activeElement;
  notice.textContent=verified?`${text} Refreshing product results…`:`${text} Refreshing product details…`;catalogProductRefreshPending(id,!verified);
  try{
   if(!verified){
    const detail=await requestCatalogPage({p_product_id:id});if(!scope.current())return;
    const product=detail.rows[0];
    if(detail.rows.length!==1||product?.id!==id||product.catalog_current!==true||product.original?.id!==id||typeof product.name!=='string'||!product.source||typeof product.source!=='object'||Array.isArray(product.source)||typeof product.original.name!=='string'||typeof product.original.sku!=='string'||!product.original.source||typeof product.original.source!=='object'||!Number.isSafeInteger(product.original.revision)||product.original.revision<1)throw Error('The saved product could not be verified.');
    for(const [kind,version] of Object.entries(expected)){const actual=kind==='original'?product.original.revision:kind==='classification'?product.catalog_classification?.version:product[kind]?.version;if(!Number.isSafeInteger(actual)||actual<version)throw Error('The latest saved product version could not be verified.');}
    catalogDetailRows.set(id,product);
    if(typeof productDetailReviews!=='undefined'&&product.review)productDetailReviews.set(id,product.review);
    if(typeof productMachineLinks!=='undefined'&&product.links)productMachineLinks.set(id,product.links);
    const machine=catalogMachineChoices.findIndex(row=>row.id===id);if(machine>=0)catalogMachineChoices[machine]=product;
    if(catalogMachineProduct?.id===id)catalogMachineProduct=product;
    if(catalogSelectedProduct===id)catalogShowDetail(product);
    const old=[...document.querySelectorAll('[data-catalog-row]')].find(row=>row.dataset.catalogRow===id);
    if(old){
     const template=document.createElement('template');template.innerHTML=productWorkbenchTable([product]);const row=template.content.querySelector('[data-catalog-row]');row.catalogRowHtml=row.outerHTML;
     if(old.catalogRowHtml!==row.catalogRowHtml){catalogPreserveDisclosures(old,row);old.replaceWith(row);bindProductWorkbench();}
    }
    verified=true;catalogProductRefreshPending(id,false);notice.textContent=`${text} Refreshing product results…`;
   }
   const data=await requestCatalogPage({p_query:catalogSearch,p_category:catalogCategory,p_colour:catalogColour,p_sort:catalogSort,p_page:catalogPage,p_machine_id:catalogMachineId||null});if(!scope.current())return;
   catalogReconcilePage(data);notice.textContent=text;focus();
  }catch(error){
   if(!scope.current())return;
   notice.innerHTML=`<p role="alert">${esc(text)} ${verified?'Product results':'Product details'} could not refresh: ${esc(error.message)}. ${verified?'The saved details are current; counts and membership need refresh.':'Refresh the saved product before making another change.'}</p><button type="button" id="catalogRetrySaved">Retry refresh</button>`;
   $('#catalogRetrySaved').onclick=()=>run(()=>{if(me!==context.actor||session!==catalogSession||!notice.isConnected||!catalogIsActive())return;catalogRequest++;scope=catalogSaveContext();return refresh();});focus();
  }
 };
 await refresh();
}
async function catalogInventory(){
 const actor=me,session=catalogSession,loadEpoch=sessionLoadEpoch,navigationRequest=workspaceLeaveSequence,request=++catalogRequest,hash=location.hash,current=()=>navigationRequest===workspaceLeaveSequence&&me===actor&&loadEpoch===sessionLoadEpoch&&session===catalogSession&&request===catalogRequest&&catalogIsActive()&&location.hash===hash;
 if(!actor||!catalogIsActive())return;
 if(!$('#catalogResults'))catalogRender(null);
 $('#catalogResults').setAttribute('aria-busy','true');$('#catalogStatus').textContent='Loading products…';
 for(const id of ['#catalogPrev','#catalogNext']){const button=$(id);if(button)button.disabled=true;}
 try{
  const data=await requestCatalogPage({p_query:catalogSearch,p_category:catalogCategory,p_colour:catalogColour,p_sort:catalogSort,p_page:catalogPage,p_machine_id:catalogMachineId||null});
  if(!current())return;
  catalogResult=data;catalogPage=data.page;catalogDetailRows.clear();
  if(typeof inventoryStockPageKey!=='undefined')inventoryStockPageKey='';
  const input=$('#catalogSearch');
  if(document.activeElement===input)renderSearchPreservingPosition(input,()=>catalogRender(data));else catalogRender(data);
  const route=workspaceRecordRoute(location.hash);
  if(route?.kind==='product'){
   const hash=location.hash;await catalogOpenRecord(route.id).catch(error=>workspaceRecordFailure('product',route.id,error,()=>me===actor&&session===catalogSession&&catalogIsActive()&&location.hash===hash));
  }
 }catch(error){
  if(!current())return;
  catalogResult=null;catalogDetailRows.clear();
  const route=workspaceRecordRoute(location.hash);
  if(route?.kind==='product'){workspaceRecordFailure('product',route.id,error,current);return;}
  $('#catalogResults').innerHTML=`<section class="card"><p role="alert">${esc(error.message)}</p><button type="button" id="catalogRetry">Retry loading products</button></section>`;
  $('#catalogResults').setAttribute('aria-busy','false');$('#catalogStatus').textContent='Product results are unavailable.';
  $('#catalogRetry').onclick=()=>run(catalogInventory);
 }
}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button||!button.closest('#content'))return;
 if(button.hasAttribute('data-catalog-category'))return run(()=>{const category=button.dataset.catalogCategory;if(!catalogCategories.some(([id])=>id===category))return;catalogCategory=category;catalogPage=0;catalogListLocation();return catalogInventory()});
 else if(button.hasAttribute('data-catalog-machine'))run(async()=>{const actor=me,id=button.dataset.catalogMachine,request=++catalogRequest;await loadCatalogProduct(id);if(me!==actor||request!==catalogRequest||!catalogIsActive())return;catalogMachineProduct=catalogDetailRows.get(id);catalogMachineId=id;catalogCategory='all';catalogSearch='';catalogColour='';catalogPage=0;catalogListLocation();await catalogInventory()});
 else if(button.hasAttribute('data-catalog-back'))return run(()=>{catalogMachineId='';catalogMachineProduct=null;catalogPage=0;catalogListLocation();return catalogInventory()});
});
