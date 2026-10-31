'use strict';
let inventoryActor=null,inventoryStockPageData=null,inventoryStockPageKey='',inventoryStockPageRequest=0,inventoryStockActionRequest=0,inventoryStockPageError='',inventoryStockSetup=false,inventoryStockSerialTools=false,inventoryStockActionsReady=false;
let inventoryProductId='',inventoryEpoch=0,inventoryStockPage=0,inventoryStockLocation='',inventoryStockStatus='',inventoryStockLotId='',inventoryStockScope='';
let inventoryOperationsData=null,inventoryOperationsKey='',inventoryOperationsRequest=0,inventoryOperationsActionRequest=0,inventoryOperationsSection='',inventoryOperationsPage=0,inventoryOperationsSearch='',inventoryOperationsStatus='',inventoryOperationsError='',inventoryTransferId='',inventoryTransferReady=false;
function clearInventoryOperationsPage(){inventoryOperationsRequest++;inventoryOperationsActionRequest++;inventoryOperationsData=null;inventoryOperationsKey='';inventoryOperationsSection='';inventoryOperationsPage=0;inventoryOperationsSearch='';inventoryOperationsStatus='';inventoryOperationsError='';inventoryTransferId='';inventoryTransferReady=false;}
function clearInventoryOperations(){clearInventoryOperationsPage();inventoryActor=null;inventoryStockPageRequest++;inventoryStockActionRequest++;inventoryStockPageData=null;inventoryStockPageKey='';inventoryStockPageError='';inventoryStockSetup=false;inventoryStockSerialTools=false;inventoryStockActionsReady=false;if(typeof serialToolsSearch!=='undefined'){serialToolsSearch='';serialToolsPage=0;}inventoryEpoch++;inventoryLoaded=false;inventoryLoadError='';inventoryProductId='';inventorySearch='';inventoryStockPage=0;inventoryStockLocation='';inventoryStockStatus='';inventoryStockLotId='';inventoryStockScope='';inventoryLocations=[];inventoryPacks=[];inventoryLots=[];inventoryTransfers=[];inventoryIssues=[];inventoryMovements=[];inventoryClassifications=[];inventoryLatestPacks.clear();inventoryLatestClassifications.clear();inventoryImportPreview=null;inventoryImportFileName='';if(typeof productDetailReviews!=='undefined')productDetailReviews.clear();if(typeof productReviewLoadError!=='undefined')productReviewLoadError='';if(typeof clearProductMachineLinks==='function')clearProductMachineLinks();if(typeof clearCatalogInventory==='function')clearCatalogInventory();}
function syncInventoryActor(){if(inventoryActor&&inventoryActor!==me)clearInventoryOperations();inventoryActor=me;}

let inventorySection='stock',inventoryLoaded=false,inventoryLoadError='',inventorySearch='',inventoryLocations=[],inventoryPacks=[],inventoryLots=[],inventoryTransfers=[],inventoryIssues=[],inventoryMovements=[],inventoryClassifications=[],inventoryImportPreview=null,inventoryImportFileName='';
const inventoryTabs=[['stock','Stock'],['review','Tally stock review'],['transfers','Move cartons'],['locations','Locations'],['catalog','Products']];
function inventoryProduct(id){const product=rowById(products,id);return product?reviewedCatalogProduct(product):{name:'Unknown product',sku:''}}
function inventorySelectableProducts(){return products.filter(p=>!p.deleted_at).map(reviewedCatalogProduct).sort((a,b)=>a.name.localeCompare(b.name))}
function inventoryLocation(id){return inventoryLocations.find(row=>row.id===id)||{name:'Unknown godown',code:''}}
function inventoryPack(id){return inventoryPacks.find(row=>row.id===id)||{base_unit:'unit',units_per_carton:0,version:0}}
// Latest version per product, rebuilt when inventory loads, so lookups stay instant with thousands of products.
let inventoryLatestPacks=new Map(),inventoryLatestClassifications=new Map();
function inventoryLatestBy(rows){const latest=new Map();for(const row of rows)if((latest.get(row.product_id)?.version||0)<row.version)latest.set(row.product_id,row);return latest}
function inventoryLatestPack(productId){return inventoryLatestPacks.get(productId)}
function inventoryClassification(productId){return inventoryLatestClassifications.get(productId)}
function inventoryOption(value,label,selected=false){return `<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`}
function inventoryDate(){return companyDate()}
function inventoryNumber(value){return value.toLocaleString('en-GB')}
function inventoryProductIdentity(product){const source=product.source||{};return `${product.name} · ${source.company||'Manufacturer needs review'} · ${source.specification||source.model||'Specification needs review'}${product.sku?' · '+product.sku:''}`}
function inventoryProductChoice(product){return `${inventoryProductIdentity(product)} · ${product.id}`}
// Product suggestions: with the search box loaded (smart-lookup.js) a <datalist data-lookup-values="products"> stays
// empty and the box offers inventoryProductValues(); without it every product is an <option> as before.
function inventoryProductValues(){return inventorySelectableProducts().map(inventoryProductChoice)}
function inventoryProductChoices(){return (typeof lookupRowSources==='undefined'?inventorySelectableProducts():[]).map(product=>`<option value="${esc(inventoryProductChoice(product))}"></option>`).join('')}
function inventoryProductFromChoice(choice){return inventorySelectableProducts().find(product=>inventoryProductChoice(product)===choice)}
async function loadInventoryOperations(){
 syncInventoryActor();
 inventoryStockPageKey='';inventoryOperationsKey='';
 const epoch=++inventoryEpoch,actor=me,current=()=>epoch===inventoryEpoch&&me===actor;
 inventoryLoadError='';
 productReviewLoadError='Product corrections are loading. Please wait.';
 // Start independent reads together, then apply their results in the existing guarded order.
 const links=typeof loadProductMachineLinks==='function'?loadProductMachineLinks():null;
 const reviews=all('product_detail_reviews','*').then(rows=>({rows}),error=>({error}));
 const tables=Promise.all([
  // Paged loads: these tables can pass the server's 1,000-rows-per-request limit.
  all('inventory_locations','*').then(data=>({data:data.sort((a,b)=>String(a.name).localeCompare(String(b.name)))}),error=>({error})),
  all('product_pack_definitions','*').then(data=>({data:data.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))}),error=>({error})),
  all('inventory_lots','*').then(data=>({data:data.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))}),error=>({error})),
  all('inventory_transfers','*').then(data=>({data:data.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(a.id).localeCompare(String(b.id)))}),error=>({error})),
  client.from('inventory_issues').select('*').order('issued_on',{ascending:false}).limit(200),
  client.from('inventory_movements').select('*').order('created_at',{ascending:false}).limit(200),
  all('product_inventory_classifications','*').then(data=>({data}),error=>({error}))
 ]);
 // A stale or failed earlier read can return before the remaining requests finish.
 tables.catch(()=>{});
 if(links)await links;
 if(!current())return false;
 const reviewed=await reviews;if(!current())return false;
 try{if(reviewed.error)throw reviewed.error;const latest=new Map();for(const row of reviewed.rows){if((latest.get(row.product_id)?.version||0)<row.version)latest.set(row.product_id,row);}productDetailReviews=latest;productReviewLoadError='';}catch(error){productReviewLoadError=error.message||'Connection unavailable';}
 const requests=await tables;
 if(!current())return false;
 const failed=requests.find(result=>result.error);
 if(failed){inventoryLoaded=false;inventoryLoadError=failed.error.message||'Inventory schema has not been installed.';return;}
 [inventoryLocations,inventoryPacks,inventoryLots,inventoryTransfers,inventoryIssues,inventoryMovements,inventoryClassifications]=requests.map(result=>result.data||[]);inventoryLatestPacks=inventoryLatestBy(inventoryPacks);inventoryLatestClassifications=inventoryLatestBy(inventoryClassifications);inventoryLoaded=true;return true;
}
function inventoryHeader(){return workspacePageHeader({title:({stock:'Stock & availability',transfers:'Move stock',locations:'Godowns & locations',review:'Tally stock review',catalog:'Products'})[inventorySection]||'Stock',subtitle:inventorySection==='stock'?'Stock by godown, batch and availability.':inventorySection==='review'?'Match source rows to products and record verified pieces.':'',actions:'<button id="inventoryRefresh" type="button">Refresh list</button>'})}
function inventoryUnavailable(){return `${inventoryHeader()}<section class="card"><h2>Inventory could not load</h2><p role="alert">${esc(inventoryLoadError)}</p><p>Check your connection and access, then refresh. Stock actions remain unavailable until the data loads.</p></section>`}
function inventoryLocationOptions(selected='',exclude=''){return inventoryLocations.filter(x=>x.active&&x.id!==exclude).map(x=>inventoryOption(x.id,`${x.name} · ${x.code}${x.is_dispatch_hub?' · dispatch hub':''}`,x.id===selected)).join('')}
function inventoryProductOptions(selected=''){return inventorySelectableProducts().map(x=>inventoryOption(x.id,inventoryProductChoice(x),x.id===selected)).join('')}
function inventoryPackChoices(){return inventoryPacks.map(x=>({value:x.id,label:`${inventoryProductIdentity(inventoryProduct(x.product_id))} · ${inventoryNumber(x.units_per_carton)} ${x.base_unit}/carton · v${x.version}`}))}
function inventoryPackOptions(selected=''){return (typeof lookupRowSources==='undefined'?inventoryPackChoices():[]).map(x=>inventoryOption(x.value,x.label,x.value===selected)).join('')}
// Every client, or none when the search box offers them (see salesOrganizationOptions).
function inventoryClientOptions(){return (typeof lookupRowSources==='undefined'?organizations.slice().sort((a,b)=>a.name.localeCompare(b.name)):[]).map(x=>inventoryOption(x.id,`${x.name}${x.location?' · '+x.location:''}`)).join('')}
function inventoryLotLabel(lot){const p=inventoryProduct(lot.product_id),place=inventoryLocation(lot.location_id),pack=inventoryPack(lot.pack_definition_id);return `${inventoryProductIdentity(p)} · ${place.name} · ${inventoryNumber(lot.sealed_cartons)} cartons + ${inventoryNumber(lot.loose_units)} ${pack.base_unit}`}
function inventorySetupProgress(){const classified=new Set(inventoryClassifications.map(x=>x.product_id)).size,packed=new Set(inventoryPacks.map(x=>x.product_id)).size;return `<section class="card setup-progress"><div class="heading"><div><small>GET STARTED</small><h2>Setup progress</h2></div><span class="tag">Use verified physical counts only</span></div><div class="setup-steps"><div class="${inventoryLocations.length?'done':''}"><strong>1</strong><span><b>Add locations</b><small>${inventoryNumber(inventoryLocations.length)} saved</small></span></div><div class="${classified?'done':''}"><strong>2</strong><span><b>Sort products</b><small>${inventoryNumber(classified)} of ${inventoryNumber(products.length)} reviewed</small></span></div><div class="${packed?'done':''}"><strong>3</strong><span><b>Set carton sizes</b><small>${inventoryNumber(packed)} products ready</small></span></div><div class="${inventoryLots.length?'done':''}"><strong>4</strong><span><b>Enter physical stock</b><small>${inventoryNumber(inventoryLots.length)} stock lots entered</small></span></div></div></section>`}
function inventoryImportPanel(){
 const plan=inventoryImportPreview;
 return `<details class="card"><summary>Add product names from a file (owner)</summary><p>Adds product names only. It never changes stock.</p><p class="warning"><strong>No Book2 quantities will be imported.</strong> Opening stock must come from a signed physical count.</p><label><span>Prepared Book2 product list</span><input id="inventoryProductImport" type="file" accept="application/json,.json"></label><div id="inventoryImportStatus" role="status">${plan?`<strong>${esc(inventoryImportFileName)}</strong><br>${inventoryNumber(plan.sourceRows)} source rows → ${inventoryNumber(plan.uniqueNames)} unique names.<br>${inventoryNumber(plan.existingMatches.length)} existing exact-name matches will not be duplicated.<br>${inventoryNumber(plan.newProducts.length)} new product names are ready to import.<br>${inventoryNumber(plan.duplicateGroups.length)} repeated-name groups keep their original row references for review.`:'No file checked yet.'}</div><p class="muted">Existing exact-name matches will not be duplicated.</p>${plan&&plan.newProducts.length?'<button id="inventoryImportCommit" type="button">Import new product names only</button>':''}</details>`;
}
function inventoryMovementCard(movement){const lot=inventoryLots.find(x=>x.id===movement.lot_id),product=inventoryProduct(lot?.product_id),place=inventoryLocation(lot?.location_id);return `<article class="activity-row"><div><strong>${esc(product.name)}</strong><small>${esc(place.name)} · ${esc(movement.movement_type.replaceAll('_',' '))}</small></div><div class="activity-change"><strong>${movement.base_unit_change>0?'+':''}${inventoryNumber(movement.base_unit_change)}</strong><small>${esc(new Date(movement.created_at).toLocaleString())}</small></div></article>`}
function inventoryIssueCard(issue){const product=inventoryProduct(issue.product_id),organization=orgIndex.get(issue.organization_id);return `<article class="activity-row"><div><strong>${esc(product.name)}</strong><small>${esc(organization?.name||'Client unavailable')} · ${esc(issue.reference)}</small></div><div class="activity-change"><strong>${inventoryNumber(issue.quantity)}</strong><small>${esc(issue.issued_on)}</small></div></article>`}
function inventoryCorrectionsUnavailable(){return `${inventoryHeader()}<section class="card"><h2>Product corrections could not be loaded</h2><p role="alert">Refresh before viewing stock or changing inventory so product identities are current.</p><p>${esc(productReviewLoadError)}</p></section>`}
function inventoryStockPageRows(rows,page=0){const pages=Math.max(1,Math.ceil(rows.length/50)),current=Math.max(0,Math.min(page,pages-1));return {rows:rows.slice(current*50,current*50+50),page:current,pages}}
function inventoryFilteredStock(lots){
 const q=inventorySearch.trim().toLowerCase(),today=inventoryDate();
 return lots.filter(lot=>{
  if(inventoryStockLocation&&lot.location_id!==inventoryStockLocation)return false;
  if(['available','quarantine'].includes(inventoryStockStatus)&&lot.stock_status!==inventoryStockStatus)return false;
  if(inventoryStockStatus==='expired'&&(!lot.expiry_date||lot.expiry_date>=today))return false;
  if(inventoryStockStatus==='empty'&&(lot.sealed_cartons||lot.loose_units))return false;
  if(!q)return true;
  const product=inventoryProduct(lot.product_id),place=inventoryLocation(lot.location_id),source=product.source||{};
  return `${product.name} ${product.sku||''} ${source.company||''} ${source.specification||source.model||''} ${place.name} ${place.code} ${lot.batch_number||''}`.toLowerCase().includes(q);
 });
}
function inventoryAvailabilityChip(stock){
 const semantic={'Eligible for invoice reservation':'in_stock','Fully reserved':'reserved','Out of stock':'out_of_stock','Expired':'danger','Quarantined':'warning','Location inactive or unavailable':'warning','Transfer to dispatch hub':'warning','Open cartons before invoicing':'warning'}[stock.reason]||'not_counted';
 return `<span class="tag chip chip--${statusTone(semantic)}">${esc(stock.reason)}</span>`;
}
function inventoryStockRow(lot){
 const product=inventoryStockProduct(lot.product_id),place=inventoryStockPlace(lot.location_id),pack=inventoryStockPack(lot.pack_definition_id),stock=inventoryLotAvailability(lot,place,inventoryDate()),source=product.source||{};
 return `<tr data-stock-lot="${esc(lot.id)}"><td><strong>${esc(product.name)}</strong><small>${esc(source.company||'Manufacturer needs review')} · ${esc(source.specification||source.model||'Specification needs review')}${product.sku?' · '+esc(product.sku):''}</small></td><td>${esc(place.name)}<small>${esc(lot.batch_number||'No batch')} · ${esc(lot.expiry_date||'No expiry')}</small></td><td>${inventoryNumber(stock.cartons)} cartons<small>${inventoryNumber(stock.loose)} ${esc(pack.base_unit)} loose</small></td><td>${inventoryNumber(stock.reserved)}</td><td>${inventoryNumber(stock.freeLoose)}</td><td>${inventoryAvailabilityChip(stock)}</td><td><button type="button" data-inventory-lot="${esc(lot.id)}" aria-label="View lot for ${esc(product.name)} at ${esc(place.name)}" aria-expanded="${lot.id===inventoryStockLotId}" aria-controls="inventoryStockDetail">View lot</button></td></tr>`;
}
function inventoryStockProduct(id){return inventoryStockPageData?(inventoryStockPageData.products.find(row=>row.id===id)||{name:'Unknown product',sku:''}):inventoryProduct(id)}
function inventoryStockPlace(id){return inventoryStockPageData?(inventoryStockPageData.locations.find(row=>row.id===id)||{name:'Unknown godown',code:''}):inventoryLocation(id)}
function inventoryStockPack(id){return inventoryStockPageData?(inventoryStockPageData.packs.find(row=>row.id===id)||{base_unit:'unit',units_per_carton:0,version:0}):inventoryPack(id)}
function syncInventoryStockScope(){if(inventoryStockScope!==inventoryProductId){inventoryStockScope=inventoryProductId;inventoryStockPage=0;inventoryStockLocation='';inventoryStockStatus='';inventoryStockLotId='';}}
function inventoryValidateStockPage(data){
 if(!data||!Array.isArray(data.rows)||data.rows.length>50||!Array.isArray(data.products)||!Array.isArray(data.locations)||!Array.isArray(data.packs)||!data.totals||!['cartons','loose','reserved','freeLoose','invoiceableLoose'].every(key=>Number.isSafeInteger(data.totals[key])&&data.totals[key]>=0)||![data.total,data.scope_count,data.page,data.pages].every(Number.isSafeInteger)||data.total<0||data.scope_count<data.total||data.page<0||data.pages<1||data.page>=data.pages)throw Error('The stock page was incomplete. Refresh before continuing.');
 return data;
}
function paintInventoryStock(){ $('#content').innerHTML=inventoryStock();bindInventoryWorkspace(); }
async function inventoryStockWorkspace(force=false){
 syncInventoryActor();
 syncInventoryStockScope();
 const actor=me,epoch=inventoryEpoch,session=sessionLoadEpoch,hash=location.hash,target=$('#content'),request=++inventoryStockPageRequest,intent=takeWorkspaceStockTransition();
 const key=JSON.stringify([inventoryProductId,inventorySearch,inventoryStockLocation,inventoryStockStatus,inventoryStockPage,inventoryDate()]);
 const current=()=>me===actor&&inventoryEpoch===epoch&&sessionLoadEpoch===session&&location.hash===hash&&target.isConnected&&$('#content')===target&&inventoryStockPageRequest===request&&view==='inventory'&&inventorySection==='stock';
 if(force||key!==inventoryStockPageKey||!inventoryStockPageData){
  if(!inventoryStockPageData)workspaceLoading('Loading stock page and full-scope totals…');else {const status=$('#inventoryStockPageStatus');if(status)status.textContent='Loading stock page…';}inventoryStockPageError='';
  try{
   const result=await client.rpc('inventory_stock_page',{p_query:inventorySearch,p_location_id:inventoryStockLocation||null,p_status:inventoryStockStatus,p_page:inventoryStockPage,p_product_id:inventoryProductId||null});
   if(!current())return;if(result.error)throw result.error;
   const data=inventoryValidateStockPage(result.data);
   inventoryStockPageData=data;inventoryStockPage=data.page;inventoryStockPageKey=JSON.stringify([inventoryProductId,inventorySearch,inventoryStockLocation,inventoryStockStatus,inventoryStockPage,inventoryDate()]);
  }catch(error){if(!current())return;inventoryStockPageError=error.message||'Stock could not load.';}
 }
 await paintWorkspaceStockTransition(intent,()=>{const input=$('#inventorySearch');if(input&&document.activeElement===input)renderSearchPreservingPosition(input,paintInventoryStock);else paintInventoryStock();},current);
}
async function refreshSavedInventoryStock(form,current,unlock,wasFocused){
 const target=$('#content'),action=++inventoryStockActionRequest,active=()=>current()&&inventoryStockActionRequest===action&&target.isConnected&&$('#content')===target&&notice.isConnected;
 const notice=target.querySelector('#inventoryStockSaved'),beforeRows=new Map(inventoryStockPageData.rows.map(row=>[row.id,inventoryStockRow(row)]));
 const selected=inventoryLots.find(row=>row.id===inventoryStockLotId),beforeDetail=selected?inventoryLotCard(selected):'';
 const retainedFocus=document.activeElement,locks=[...target.querySelectorAll('form[data-inventory-action]')].map(node=>({node,inert:node.inert}));
 const disclosures=[...(target.querySelector('#inventoryStockDetail')?.querySelectorAll('details')||[])].map(node=>({action:node.querySelector('form')?.dataset.inventoryAction,open:node.open}));
 for(const {node} of locks)node.inert=true;
 async function reload(){
  if(!active())return;
  const beforeFocus=document.activeElement,focused=wasFocused||notice.contains(beforeFocus),left=window.scrollX,top=window.scrollY;
  inventoryStockActionsReady=false;inventoryStockPageError='Stock transaction saved. Current results require Retry.';
  notice.textContent='Inventory transaction saved. Loading current stock and action prerequisites…';
  const metrics=target.querySelector('.inventory-metrics');metrics.setAttribute('aria-busy','true');metrics.querySelectorAll('strong').forEach(node=>node.textContent='…');
  target.querySelector('#inventoryStockPageStatus').textContent='Saved. Loading current stock…';target.querySelector('#inventoryStockTotal').textContent='Current counts pending';
  for(const selector of ['#inventoryStockPrevious','#inventoryStockNext','#inventoryStockOpenTools','#inventoryStockSerialTools','[data-inventory-lot]','[data-inventory-reserved]'])target.querySelectorAll(selector).forEach(button=>button.disabled=true);
  window.scrollTo({left,top,behavior:'instant'});
  try{
   const loaded=await loadInventoryOperations();if(!active())return;
   if(loaded===false||!inventoryLoaded)throw Error(inventoryLoadError||'Stock actions could not load.');
   if(productReviewLoadError)throw Error('Product corrections could not load. '+productReviewLoadError);
   const epoch=inventoryEpoch;
   if(typeof loadSerialSettings==='function'&&!(await loadSerialSettings()))throw Error('Serial requirements could not load.');
   if(!active())return;if(epoch!==inventoryEpoch)throw Error('Inventory changed while loading. Retry current stock.');
   const result=await client.rpc('inventory_stock_page',{p_query:inventorySearch,p_location_id:inventoryStockLocation||null,p_status:inventoryStockStatus,p_page:inventoryStockPage,p_product_id:inventoryProductId||null});if(!active())return;if(result.error)throw result.error;
   if(epoch!==inventoryEpoch)throw Error('Inventory changed while loading. Retry current stock.');
   const data=inventoryValidateStockPage(result.data);inventoryStockPageData=data;inventoryStockPage=data.page;inventoryStockPageKey=JSON.stringify([inventoryProductId,inventorySearch,inventoryStockLocation,inventoryStockStatus,inventoryStockPage,inventoryDate()]);inventoryStockPageError='';inventoryStockActionsReady=true;
   const left=window.scrollX,top=window.scrollY,focusBefore=document.activeElement===document.body?beforeFocus:document.activeElement,focusedId=focusBefore?.closest('[data-stock-lot]')?.dataset.stockLot;
   const template=document.createElement('template');template.innerHTML=inventoryStock();
   metrics.innerHTML=template.content.querySelector('.inventory-metrics').innerHTML;metrics.removeAttribute('aria-busy');
   for(const id of ['inventoryStockPageStatus','inventoryStockTotal'])target.querySelector('#'+id).textContent=template.content.querySelector('#'+id).textContent;
   for(const id of ['inventoryStockPrevious','inventoryStockNext'])target.querySelector('#'+id).disabled=template.content.querySelector('#'+id).disabled;
   const register=target.querySelector('#inventoryStockRows'),body=register.querySelector('tbody');
   if(!body||!data.rows.length)register.innerHTML=template.content.querySelector('#inventoryStockRows').innerHTML;
   else{
    const old=[...body.querySelectorAll('[data-stock-lot]')],keep=[];
    for(const row of data.rows){const node=old.find(node=>node.dataset.stockLot===row.id),html=inventoryStockRow(row);if(node&&beforeRows.get(row.id)===html)keep.push(node);else{const next=document.createElement('template');next.innerHTML=html;keep.push(next.content.firstElementChild);}}
    for(const node of old)if(!keep.includes(node))node.remove();keep.forEach((node,index)=>{if(body.children[index]!==node)body.insertBefore(node,body.children[index]||null);});
   }
   const location=target.querySelector('#inventoryStockLocation'),locationValue=location.value,locationOptions=template.content.querySelector('#inventoryStockLocation').innerHTML;if(location.innerHTML!==locationOptions){location.innerHTML=locationOptions;location.value=locationValue;}
   const currentLot=inventoryLots.find(row=>row.id===inventoryStockLotId),detail=target.querySelector('#inventoryStockDetailHost');
   if(beforeDetail!==(currentLot?inventoryLotCard(currentLot):'')){detail.innerHTML=template.content.querySelector('#inventoryStockDetailHost').innerHTML;for(const saved of disclosures){const node=[...detail.querySelectorAll('details')].find(node=>node.querySelector('form')?.dataset.inventoryAction===saved.action);if(node)node.open=saved.open;}}
   for(const selector of ['.setup-progress','#inventoryStockHistory']){const old=target.querySelector(selector),next=template.content.querySelector(selector);if(old&&next)old.innerHTML=next.innerHTML;}
   const opening=target.querySelector('[data-stock-form="opening"]'),nextOpening=template.content.querySelector('[data-stock-form="opening"]');
   if(opening&&!opening.querySelector('form')&&nextOpening?.querySelector('form'))opening.innerHTML=nextOpening.innerHTML;
   const receive=target.querySelector('form[data-inventory-action="opening"]');if(receive){for(const [name,options] of [['packId',inventoryPackOptions],['locationId',inventoryLocationOptions]]){const select=receive.elements[name],value=select.value,chosen=name==='packId'&&typeof lookupRowSources!=='undefined'?inventoryPackChoices().find(row=>row.value===value):null;const html=`<option value="">${name==='packId'?'Choose saved carton size':'Choose location'}</option>`+(chosen?inventoryOption(chosen.value,chosen.label,true):options(value));if(select.innerHTML!==html){select.innerHTML=html;select.value=value;}}}
   for(const {node,inert} of locks)if(node.isConnected)node.inert=inert;
   if(form.isConnected){form.reset();form.querySelectorAll('select').forEach(select=>{select.value=select.value;});delete form.dataset.inventorySaved;unlock();}
   bindInventoryWorkspace();
   for(const selector of ['#inventoryStockOpenTools','#inventoryStockSerialTools','[data-inventory-lot]','[data-inventory-reserved]'])target.querySelectorAll(selector).forEach(button=>button.disabled=false);
   notice.textContent='Inventory transaction saved.';
   const focus=form.isConnected?form.querySelector('input,select,textarea'):target.querySelector('#inventoryStockDetail')||target.querySelector('#inventoryStockPageStatus');
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
   if(focused&&(document.activeElement===document.body||form.contains(document.activeElement)))focus.focus({preventScroll:true});
   else if(document.activeElement===document.body&&retainedFocus.isConnected&&retainedFocus!==document.body)retainedFocus.focus({preventScroll:true});
   else if(focusedId&&(!focusBefore.isConnected||document.activeElement!==focusBefore))([...target.querySelectorAll('[data-inventory-lot]')].find(button=>button.dataset.inventoryLot===focusedId)||target.querySelector('#inventoryStockPageStatus')).focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message('Inventory transaction saved.');
  }catch(error){
   if(!active())return;const left=window.scrollX,top=window.scrollY;
   inventoryStockActionsReady=false;inventoryStockPageKey='';inventoryStockPageError='Stock transaction saved. Current results could not load.';
   notice.innerHTML=`<p role="alert">Inventory transaction saved. Current stock could not load: ${esc(error.message)} Retry reads current stock without repeating the transaction.</p><button type="button" data-stock-retry-saved>Retry saved transaction</button>`;
   target.querySelector('#inventoryStockPageStatus').textContent='Saved. Current stock unavailable until retry.';
   const retry=notice.querySelector('[data-stock-retry-saved]');retry.onclick=()=>run(reload);
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);
   if(focused&&document.activeElement===document.body)retry.focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message('Inventory transaction saved. Use Retry saved transaction to load current stock.');
  }
 }
 await reload();
}
async function openInventoryStockTools(lotId=''){
 const actor=me,request=inventoryStockPageRequest,action=++inventoryStockActionRequest,current=()=>me===actor&&inventoryStockPageRequest===request&&inventoryStockActionRequest===action&&view==='inventory'&&inventorySection==='stock';
 inventoryStockActionsReady=false;paintInventoryStock();message('Loading verified stock actions and serial requirements…');
 if(typeof loadLists==='function')await loadLists();if(!current())return;
 await loadInventoryOperations();if(!current())return;
 if(!inventoryLoaded)throw Error(inventoryLoadError||'Stock actions could not load.');
 if(productReviewLoadError)throw Error('Refresh product corrections before changing inventory. '+productReviewLoadError);
 if(typeof loadSerialSettings==='function'&&!(await loadSerialSettings()))throw Error('Serial requirements could not load. Refresh before changing stock.');
 if(!current())return;
 inventoryStockActionsReady=true;
 if(lotId){if(!inventoryLots.some(lot=>lot.id===lotId))throw Error('This lot changed. Refresh stock before continuing.');inventoryStockLotId=lotId;}
 else inventoryStockSetup=true;
 paintInventoryStock();message('');$(lotId?'#inventoryStockDetail':'#inventoryStockTools')?.focus();
}
function inventoryStock(){
 const paged=inventoryStockPageData;
 if(inventoryStockPageError)return `${inventoryHeader()}<section class="card"><h2>Stock could not be loaded</h2><p role="alert">${esc(inventoryStockPageError)}</p><p>Refresh before viewing counts or changing stock.</p></section>`;
 if(!paged&&typeof productReviewLoadError!=='undefined'&&productReviewLoadError)return inventoryCorrectionsUnavailable();
 const scopedLots=paged?paged.rows:inventoryLots.filter(x=>!inventoryProductId||x.product_id===inventoryProductId),showTools=!paged||(inventoryStockSetup&&inventoryStockActionsReady);
 syncInventoryStockScope();
 const scopedLotIds=new Set((paged?inventoryLots.filter(x=>!inventoryProductId||x.product_id===inventoryProductId):scopedLots).map(x=>x.id));
 const scopedMovements=inventoryMovements.filter(x=>!inventoryProductId||scopedLotIds.has(x.lot_id));
 const scopedIssues=inventoryIssues.filter(x=>!inventoryProductId||x.product_id===inventoryProductId);
 const totals=paged?paged.totals:inventoryStockTotals(scopedLots,inventoryLocations,inventoryDate());
 const shown=paged?scopedLots:inventoryFilteredStock(scopedLots),page=paged?{rows:scopedLots,page:paged.page,pages:paged.pages}:inventoryStockPageRows(shown,inventoryStockPage);inventoryStockPage=page.page;
 const total=paged?paged.total:shown.length,scopeCount=paged?paged.scope_count:scopedLots.length,places=paged?paged.locations:inventoryLocations;
 const selected=(!paged||inventoryStockActionsReady)&&page.rows.some(lot=>lot.id===inventoryStockLotId)?inventoryLots.find(lot=>lot.id===inventoryStockLotId):null;if(!selected)inventoryStockLotId='';
 return `${inventoryHeader()}<div id="inventoryStockSaved" role="status" tabindex="-1"></div>${inventoryProductId?`<section class="card"><strong>Selected product: ${esc(inventoryStockProduct(inventoryProductId).name)}</strong><p>Stock code: ${esc(inventoryStockProduct(inventoryProductId).sku||inventoryProductId)} · This view uses the exact product ID, not a name match.</p><button type="button" id="clearStockProduct">Show all products</button></section>`:''}<div class="inventory-metrics"><div><small>Sealed cartons on hand</small><strong>${inventoryNumber(totals.cartons)}</strong></div><div><small>Loose units on hand</small><strong>${inventoryNumber(totals.loose)}</strong></div><div><small>Reserved loose units</small><strong>${inventoryNumber(totals.reserved)}</strong></div><div><small>Free loose units</small><strong>${inventoryNumber(totals.freeLoose)}</strong></div><div><small>Invoice-eligible loose units</small><strong>${inventoryNumber(totals.invoiceableLoose)}</strong></div></div><details><summary>How this page works</summary><p>Totals cover all lots${inventoryProductId?' for the selected product':''}; list filters and pages do not change them. On-hand and free quantities include stock held outside dispatch or in quarantine. Only unexpired, free loose units at an active dispatch hub are eligible for a new invoice reservation. Cartons must be opened first; the saved transaction rechecks stock.</p><p>Search by product, stock code, location, or batch. Open a lot for counts and stock actions.</p></details>
 ${showTools?`<section id="inventoryStockTools" tabindex="-1" aria-label="Stock tools and history">${paged?'<button type="button" id="inventoryStockHideTools">Close stock tools</button>':''}
 ${me.role==='owner'?inventorySetupProgress()+inventoryImportPanel():''}${canEditRecords()?`<details class="card" data-stock-form="pack"><summary>1. Set a product carton size</summary><form data-inventory-action="pack"><div class="grid"><label class="wide"><span>Find product</span><input name="productChoice" list="inventoryProductChoices" placeholder="Start typing a product name" autocomplete="off" required><datalist id="inventoryProductChoices" data-lookup-values="products">${inventoryProductChoices()}</datalist></label><label><span>Individual unit name</span><input name="baseUnit" placeholder="piece, bottle, test" required maxlength="40"></label><label><span>Units in one sealed carton</span><input name="unitsPerCarton" type="number" min="1" step="1" required></label><label class="wide"><span>Where was this carton size verified?</span><textarea name="reason" minlength="5" placeholder="Example: supplier carton label checked by…" required></textarea></label></div><button type="submit">Save carton size</button></form></details>`:''}${me.role==='owner'?`
 <details class="card" data-stock-form="opening"><summary>2. Receive stock / enter a verified physical count</summary>${inventoryPacks.length?`<form data-inventory-action="opening"><p data-inventory-count-error role="alert"></p><div class="grid"><label><span>Product / carton size</span><select name="packId" required data-lookup-rows="inventoryPacks"><option value="">Choose saved carton size</option>${inventoryPackOptions()}</select></label><label><span>Location</span><select name="locationId" required><option value="">Choose location</option>${inventoryLocationOptions()}</select></label><label><span>Batch number</span><input name="batchNumber" maxlength="120"></label><label><span>Expiry date</span><input name="expiryDate" type="date"></label><label><span>Sealed cartons counted</span><input name="sealedCartons" type="number" min="0" step="1" value="0" required></label><label><span>Loose individual units counted</span><input name="looseUnits" type="number" min="0" step="1" value="0" required></label><label class="wide"><span>Who counted it, and from what source?</span><textarea name="reason" minlength="5" required></textarea></label></div><button type="submit">Record physical count</button></form>`:'<p class="warning">Save at least one product carton size before entering stock.</p>'}</details>`:''}
</section>`:'<p><button type="button" id="inventoryStockOpenTools">Receive stock, carton sizes &amp; activity</button></p>'}
 <section class="card"><div class="heading"><div><h2>Stock by location</h2></div><span id="inventoryStockTotal">${inventoryNumber(total)} of ${inventoryNumber(scopeCount)} lots</span></div><div class="grid inventory-stock-filters"><label><span>Search stock</span><input id="inventorySearch" type="search" maxlength="2000" value="${esc(inventorySearch)}" placeholder="Product, stock code, location, or batch"></label><label><span>Godown / location</span><select id="inventoryStockLocation"><option value="">All godowns and locations</option>${places.map(place=>inventoryOption(place.id,`${place.name} · ${place.code}${place.active?'':' · inactive'}`,place.id===inventoryStockLocation)).join('')}</select></label><label><span>Stock status</span><select id="inventoryStockStatus">${[['','All statuses'],['available','Non-quarantined'],['quarantine','Quarantined'],['expired','Expired'],['empty','Out of stock']].map(([value,label])=>inventoryOption(value,label,value===inventoryStockStatus)).join('')}</select></label></div>
 <div class="heading inventory-pagination"><p id="inventoryStockPageStatus" role="status" tabindex="-1">${total?`${inventoryNumber(page.page*50+1)}–${inventoryNumber(page.page*50+page.rows.length)} of ${inventoryNumber(total)} lots`:'No stock matches these filters.'} · Page ${page.page+1} of ${page.pages}</p><div><button type="button" id="inventoryStockPrevious" ${page.page===0?'disabled':''}>Previous</button><button type="button" id="inventoryStockNext" ${page.page+1>=page.pages?'disabled':''}>Next</button></div></div>
 <div id="inventoryStockRows">${page.rows.length?`<div class="table-wrap"><table class="inventory-stock-table"><thead><tr><th scope="col">Product</th><th scope="col">Godown / batch</th><th scope="col">On hand</th><th scope="col">Reserved loose</th><th scope="col">Free loose</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead><tbody>${page.rows.map(inventoryStockRow).join('')}</tbody></table></div>`:'<p class="empty">Try another search, godown or status.</p>'}</div></section>
 <div id="inventoryStockDetailHost">${selected?`<section class="card inventory-stock-detail" id="inventoryStockDetail" tabindex="-1" aria-label="Selected stock lot"><div class="heading"><h2>Lot details &amp; actions</h2><button type="button" id="inventoryStockClose">Close details</button></div>${inventoryLotCard(selected)}</section>`:''}</div>
 ${showTools?` <div class="inventory-history" id="inventoryStockHistory"><section class="card"><div class="heading"><h2>Recent stock activity</h2><span>${inventoryNumber(scopedMovements.length)} records</span></div>${scopedMovements.slice(0,20).map(inventoryMovementCard).join('')||'<p class="empty">No stock movements yet.</p>'}</section><section class="card"><div class="heading"><h2>Items issued to clients</h2><span>${inventoryNumber(scopedIssues.length)} records</span></div>${scopedIssues.slice(0,20).map(inventoryIssueCard).join('')||'<p class="empty">No individual items have been issued yet.</p>'}</section></div><button type="button" id="inventoryStockSerialTools">Serial number settings</button>`:''}`;
}
function inventoryLotCard(lot){
 const product=inventoryProduct(lot.product_id),place=inventoryLocation(lot.location_id),pack=inventoryPack(lot.pack_definition_id),stock=inventoryLotAvailability(lot,place,inventoryDate());
 const total=pack.units_per_carton>0?inventoryNumber(stockPosition({sealedCartons:stock.cartons,looseUnits:stock.loose,unitsPerCarton:pack.units_per_carton,reservedUnits:stock.reserved}).totalBaseUnits):'Carton size needs review';
 return `<article class="contact ${lot.stock_status==='quarantine'?'incomplete':''}"><div class="heading"><div><h3>${esc(inventoryProductIdentity(product))}</h3><p>${esc(place.name)} · ${esc(place.code)}</p></div>${inventoryAvailabilityChip(stock)}</div><div class="details"><div><small>Sealed cartons on hand</small>${inventoryNumber(stock.cartons)}</div><div><small>Loose ${esc(pack.base_unit)} on hand</small>${inventoryNumber(stock.loose)}</div><div><small>Total individual units on hand</small>${total}</div><div><small>Reserved loose ${esc(pack.base_unit)}</small>${inventoryNumber(stock.reserved)}</div><div><small>Free loose ${esc(pack.base_unit)}</small>${inventoryNumber(stock.freeLoose)}</div><div><small>Invoice-eligible loose ${esc(pack.base_unit)}</small>${inventoryNumber(stock.invoiceableLoose)}</div><div><small>Batch / expiry</small>${esc(lot.batch_number||'Not supplied')} · ${esc(lot.expiry_date||'Not supplied')}</div></div>${stock.reserved?`<div>${hasArea('deliveries')?`<button type="button" data-inventory-reserved="${esc(lot.id)}">View reserved deliveries</button>`:'<p class="muted">Delivery details require Deliveries access.</p>'}</div>`:''}${me.role==='owner'&&lot.stock_status==='available'?`<details><summary>Correct this physical count</summary><form data-inventory-action="correct" data-lot="${lot.id}" data-version="${lot.version}"><p data-inventory-count-error role="alert"></p><div class="grid"><label><span>Sealed cartons now counted</span><input name="sealedCartons" type="number" min="0" step="1" value="${lot.sealed_cartons}" required></label><label><span>Loose ${esc(pack.base_unit)} now counted</span><input name="looseUnits" type="number" min="0" step="1" value="${lot.loose_units}" required></label><label class="wide"><span>Reason for count correction</span><textarea name="reason" minlength="5" required></textarea></label></div><button type="submit">Save corrected count</button></form></details>`:''}${stock.canOpenCartons?`<details><summary>Open cartons into individual units</summary><form data-inventory-action="open" data-lot="${lot.id}" data-version="${lot.version}"><p data-inventory-action-error role="alert"></p><label><span>Sealed cartons to open · ${inventoryNumber(pack.units_per_carton)} ${esc(pack.base_unit)} each</span><input name="cartons" type="number" min="1" max="${lot.sealed_cartons}" step="1" required></label><label><span>Reason / packing note</span><textarea name="reason" minlength="5" required></textarea></label><button type="submit">Open cartons at ${esc(place.name)}</button></form></details>`:''}${stock.invoiceableLoose>0?`<details><summary>Issue individual units to a client</summary><form data-inventory-action="issue" data-lot="${lot.id}" data-version="${lot.version}"><p data-inventory-action-error role="alert"></p><div class="grid"><label><span>Client / branch</span><select name="organizationId" required data-lookup-rows="organizations"><option value="">Choose client</option>${inventoryClientOptions()}</select></label><label><span>Quantity · ${esc(pack.base_unit)}</span><input name="quantity" type="number" min="1" max="${stock.freeLoose}" step="1" required></label><label><span>Issue date</span><input name="issuedOn" type="date" value="${inventoryDate()}" required></label><label><span>Delivery / sale reference</span><input name="reference" required maxlength="120"></label><label class="wide"><span>Reason</span><textarea name="reason" minlength="3" required></textarea></label></div><button type="submit">Issue individual units</button></form></details>`:''}</article>`;
}
function inventoryTransferRequestForm(){
 if(typeof productReviewLoadError!=='undefined'&&productReviewLoadError)return inventoryCorrectionsUnavailable();
 const sources=inventoryLots.filter(x=>x.stock_status==='available'&&x.sealed_cartons>0);
 return `<section class="card"><h2>Request sealed-carton transfer</h2><p>Stock leaves the first godown when dispatched. Receive it at an active dispatch hub and open cartons before reserving loose units for invoices.</p><form data-inventory-action="request"><p data-inventory-request-error role="alert"></p><div class="grid"><label><span>Move from</span><select name="sourceLotId" required><option value="">Choose sealed stock</option>${sources.map(x=>inventoryOption(x.id,inventoryLotLabel(x))).join('')}</select></label><label><span>Move to</span><select name="toLocationId" required><option value="">Choose destination</option>${inventoryLocationOptions()}</select></label><label><span>Sealed cartons</span><input name="cartons" type="number" min="1" step="1" required></label><label><span>Expected receipt date</span><input name="expectedAt" type="date" required></label><label class="wide"><span>Transfer reason</span><textarea name="reason" minlength="5" required></textarea></label></div><button type="submit">Request transfer</button></form></section>`;
}
function inventoryTransferChip(status){
 const semantic=status==='requested'?'waiting':status==='received'?'completed':status==='quarantine'?'failed':status;
 return `<span class="tag chip chip--${statusTone(semantic)}">${esc(status.replaceAll('_',' '))}</span>`;
}
function inventoryTransferCard(t){
 const product=inventoryProduct(t.product_id),from=inventoryLocation(t.from_location_id),to=inventoryLocation(t.to_location_id),pack=inventoryPack(t.pack_definition_id),lot=inventoryLots.find(x=>x.id===t.source_lot_id);
 return `<article class="contact ${t.status==='quarantine'?'incomplete':''}"><div class="heading"><h3>${esc(inventoryProductIdentity(product))}</h3>${inventoryTransferChip(t.status)}</div><p>${esc(from.name)} → ${esc(to.name)} · ${inventoryNumber(t.cartons)} cartons · ${inventoryNumber(t.expected_units)} ${esc(pack.base_unit)}</p><p class="muted">Expected ${esc(t.expected_at)} · ${esc(t.reason)}</p>${t.status==='requested'?`<form data-inventory-action="dispatch" data-transfer="${t.id}" data-version="${t.version}" data-lot-version="${lot?.version||0}"><p data-inventory-action-error role="alert"></p><label><span>Dispatch note</span><input name="reason" minlength="3" required></label><button type="submit">Dispatch sealed cartons</button></form>`:''}${t.status==='in_transit'?`<form data-inventory-action="receive" data-transfer="${t.id}" data-version="${t.version}"><p data-inventory-action-error role="alert"></p><div class="grid"><label><span>Counted individual units</span><input name="actualUnits" type="number" min="0" step="1" required></label><label><span>Inspection</span><select name="inspection" required><option value="pass">Count, identity, expiry and condition pass</option><option value="damaged">Damaged / expired / identity mismatch</option></select></label><label class="wide"><span>Receipt note</span><textarea name="note" minlength="3" required></textarea></label></div><button type="submit">Receive or quarantine</button></form>`:''}${t.status==='quarantine'?'<p class="warning">Count or inspection differed. This stock is isolated and unavailable for issue.</p>':''}</article>`;
}
function inventoryLocationsScreen(rows=inventoryLocations){return `${me.role==='owner'?`<section class="card"><h2>Add godown or Haadi dispatch hub</h2><form data-inventory-action="location"><div class="grid"><label><span>Name</span><input name="name" required maxlength="120" placeholder="Haadi"></label><label><span>Short code</span><input name="code" required maxlength="30" placeholder="HAA"></label><label><span>Type</span><select name="locationType"><option value="godown">Godown · sealed-carton storage</option><option value="dispatch_hub">Dispatch hub · may open cartons</option></select></label></div><button type="submit">Save location</button></form></section>`:''}<section class="card"><h2>Storage locations</h2><div id="inventoryLocationRows">${rows.map(x=>`<article class="contact" data-inventory-location-row="${esc(x.id)}"><div class="heading"><div><h3>${esc(x.name)}</h3><p>${esc(x.code)} · ${x.is_dispatch_hub?'Dispatch hub; cartons can be opened here':'Godown; sealed-carton storage'}</p></div><span class="tag chip chip--${statusTone(x.active?'success':'inactive')}">${x.active?'Active':'Inactive'}</span></div></article>`).join('')||'<p class="empty">No godowns have been entered yet.</p>'}</div></section>`}
function inventoryOperationsScreen(){
 const data=inventoryOperationsData,transfers=inventorySection==='transfers';
 if(inventoryOperationsError||!data)return `${inventoryHeader()}<section class="card"><h2>Inventory could not load</h2><p role="alert">${esc(inventoryOperationsError||'Refresh this page before continuing.')}</p></section>`;
 const filters=transfers?[['','All statuses'],['requested','Requested'],['in_transit','In transit'],['received','Received'],['quarantine','Quarantined'],['cancelled','Cancelled']]:[['','All locations'],['active','Active'],['inactive','Inactive'],['godown','Godowns'],['dispatch_hub','Dispatch hubs']];
 const metrics=transfers?[['all','Transfers'],['requested','Requested'],['in_transit','In transit'],['quarantine','Quarantined']]:[['all','Locations'],['active','Active'],['dispatch_hub','Dispatch hubs']],size=transfers?25:50;
 const selected=inventoryTransferReady&&inventoryTransferId!=='new'?inventoryTransfers.find(row=>row.id===inventoryTransferId):null;
 return `${inventoryHeader()}<div class="inventory-metrics">${metrics.map(([key,label])=>`<div><small>${label}</small><strong>${inventoryNumber(data.totals[key])}</strong></div>`).join('')}</div><p class="muted">Totals include all ${transfers?'transfers':'locations'} visible to you, before list filters.</p>
 <section class="card"><div class="grid"><label><span>Search ${transfers?'transfers':'locations'}</span><input id="inventoryOperationsSearch" type="search" maxlength="2000" value="${esc(inventoryOperationsSearch)}" placeholder="${transfers?'Product, godown or expected date':'Name or short code'}"></label><label><span>${transfers?'Transfer status':'Location status / type'}</span><select id="inventoryOperationsStatus">${filters.map(([value,label])=>inventoryOption(value,label,value===inventoryOperationsStatus)).join('')}</select></label></div>
 <div class="heading inventory-pagination"><p id="inventoryOperationsPageStatus" role="status" tabindex="-1">${data.total?`${inventoryNumber(data.page*size+1)}–${inventoryNumber(data.page*size+data.rows.length)} of ${inventoryNumber(data.total)}`:'No matching records'} · Page ${data.page+1} of ${data.pages}</p><div><button type="button" id="inventoryOperationsPrevious" ${data.page===0?'disabled':''}>Previous</button><button type="button" id="inventoryOperationsNext" ${data.page+1>=data.pages?'disabled':''}>Next</button></div></div></section>
 <div id="inventoryOperationsSaved" role="status" tabindex="-1"></div>${transfers?`<p><button type="button" id="inventoryTransferNew">Request transfer</button></p><section class="card"><h2>Transfer register</h2><div id="inventoryTransferRows">${data.rows.map(row=>`<article class="contact" data-inventory-transfer-row="${esc(row.id)}"><div class="heading"><h3>${esc(inventoryProductIdentity({name:row.product_name||'Unknown product',sku:row.sku,source:{company:row.company,specification:row.specification}}))}</h3>${inventoryTransferChip(row.status)}</div><p>${esc(row.from_name||'Unknown godown')} → ${esc(row.to_name||'Unknown godown')} · ${inventoryNumber(row.cartons)} cartons · ${inventoryNumber(row.expected_units)} ${esc(row.base_unit||'unit')}</p><p>Expected ${esc(row.expected_at)}</p><button type="button" data-inventory-transfer="${esc(row.id)}">Open transfer</button></article>`).join('')||'<p class="empty">No carton transfers match these filters.</p>'}</div></section>
 ${inventoryTransferReady?`<section id="inventoryTransferDetail" class="card" tabindex="-1" aria-label="Transfer details and actions"><button type="button" id="inventoryTransferClose">Close details</button>${inventoryTransferId==='new'?inventoryTransferRequestForm():selected?inventoryTransferCard(selected):'<p role="alert">This transfer changed. Refresh before continuing.</p>'}</section>`:''}`:inventoryLocationsScreen(data.rows)}`;
}
function inventoryValidateOperationsPage(data,section){
 const keys=section==='transfers'?['all','requested','in_transit','received','quarantine','cancelled']:['all','active','dispatch_hub'],size=section==='transfers'?25:50;
 if(!data||data.section!==section||!Array.isArray(data.rows)||!data.totals||!keys.every(key=>Number.isSafeInteger(data.totals[key])&&data.totals[key]>=0&&data.totals[key]<=data.totals.all)||![data.total,data.page,data.pages].every(Number.isSafeInteger)||data.total<0||data.total>data.totals.all||data.page<0||data.pages!==Math.max(1,Math.ceil(data.total/size))||data.page>=data.pages||data.rows.length!==Math.min(size,data.total-data.page*size)||!data.rows.every(row=>typeof row.id==='string'&&(section==='transfers'?keys.slice(1).includes(row.status)&&typeof row.expected_at==='string'&&Number.isSafeInteger(row.cartons)&&row.cartons>0&&Number.isSafeInteger(row.expected_units)&&row.expected_units>0:typeof row.name==='string'&&typeof row.code==='string'&&typeof row.active==='boolean'&&typeof row.is_dispatch_hub==='boolean')))throw Error('The inventory page was incomplete. Refresh before continuing.');
 return data;
}
function paintInventoryOperations(){ $('#content').innerHTML=inventoryOperationsScreen();bindInventoryWorkspace(); }
async function inventoryOperationsWorkspace(force=false){
 if(!me||view!=='inventory'||!['locations','transfers'].includes(inventorySection))return;
 syncInventoryActor();
 if(inventoryOperationsSection!==inventorySection){clearInventoryOperationsPage();inventoryOperationsSection=inventorySection;}
 const actor=me,section=inventorySection,request=++inventoryOperationsRequest,key=JSON.stringify([section,inventoryOperationsSearch,inventoryOperationsStatus,inventoryOperationsPage]);
 const current=()=>me===actor&&inventoryActor===actor&&inventoryOperationsRequest===request&&view==='inventory'&&inventorySection===section;
 if(force||key!==inventoryOperationsKey||!inventoryOperationsData){
  inventoryOperationsActionRequest++;inventoryTransferReady=false;inventoryTransferId='';inventoryOperationsError='';workspaceLoading(`Loading ${section==='transfers'?'transfers':'locations'}…`);
  try{
   const result=await client.rpc('inventory_operations_page',{p_section:section,p_query:inventoryOperationsSearch,p_status:inventoryOperationsStatus,p_page:inventoryOperationsPage});
   if(!current())return;if(result.error)throw result.error;
   const data=inventoryValidateOperationsPage(result.data,section);
   inventoryOperationsData=data;inventoryOperationsPage=data.page;inventoryOperationsKey=JSON.stringify([section,inventoryOperationsSearch,inventoryOperationsStatus,data.page]);
  }catch(error){if(!current())return;inventoryOperationsError=error.message||'Inventory could not load.';inventoryOperationsKey='';}
 }
 if(current()){const input=$('#inventoryOperationsSearch');if(input&&document.activeElement===input)renderSearchPreservingPosition(input,paintInventoryOperations);else paintInventoryOperations();}
}
async function refreshSavedInventoryOperation(form,section,saved,current,unlock,wasFocused){
 const target=$('#content'),action=++inventoryOperationsActionRequest;
 const active=()=>current()&&inventoryOperationsActionRequest===action&&target.isConnected&&$('#content')===target;
 inventoryTransferReady=false;inventoryTransferId='';
 const notice=target.querySelector('#inventoryOperationsSaved'),detail=target.querySelector('#inventoryTransferDetail');
 if(detail){const left=window.scrollX,top=window.scrollY;detail.innerHTML='<p>Inventory transaction saved. Open the transfer again for current stock actions.</p>';window.scrollTo({left,top,behavior:'instant'});}
 async function reload(){
  if(!active())return;
  const beforeFocus=document.activeElement,focusPending=wasFocused||notice.contains(beforeFocus);
  inventoryOperationsError='Inventory transaction saved. Retry current results before another action.';
  const left=window.scrollX,top=window.scrollY,metrics=target.querySelector('.inventory-metrics');
  notice.textContent='Inventory transaction saved. Loading current results…';metrics.setAttribute('aria-busy','true');metrics.querySelectorAll('strong').forEach(node=>node.textContent='…');
  target.querySelector('#inventoryOperationsPageStatus').textContent='Saved. Loading current results…';
  for(const selector of ['#inventoryOperationsPrevious','#inventoryOperationsNext','#inventoryTransferNew','[data-inventory-transfer]'])target.querySelectorAll(selector).forEach(button=>button.disabled=true);
  window.scrollTo({left,top,behavior:'instant'});
  try{
   const result=await client.rpc('inventory_operations_page',{p_section:section,p_query:inventoryOperationsSearch,p_status:inventoryOperationsStatus,p_page:inventoryOperationsPage});if(!active())return;if(result.error)throw result.error;
   const data=inventoryValidateOperationsPage(result.data,section),previous=inventoryOperationsData;
   inventoryOperationsData=data;inventoryOperationsPage=data.page;inventoryOperationsKey=JSON.stringify([section,inventoryOperationsSearch,inventoryOperationsStatus,data.page]);inventoryOperationsError='';
   const left=window.scrollX,top=window.scrollY,focused=document.activeElement===document.body?beforeFocus:document.activeElement,focusedId=focused?.closest('[data-inventory-transfer-row]')?.dataset.inventoryTransferRow;
   const template=document.createElement('template');template.innerHTML=inventoryOperationsScreen();
   metrics.innerHTML=template.content.querySelector('.inventory-metrics').innerHTML;metrics.removeAttribute('aria-busy');
   target.querySelector('#inventoryOperationsPageStatus').textContent=template.content.querySelector('#inventoryOperationsPageStatus').textContent;
   for(const id of ['inventoryOperationsPrevious','inventoryOperationsNext'])target.querySelector('#'+id).disabled=template.content.querySelector('#'+id).disabled;
   const selector=section==='transfers'?'#inventoryTransferRows':'#inventoryLocationRows',rows=target.querySelector(selector),incoming=template.content.querySelector(selector),old=[...rows.children],keep=[];
   for(const row of data.rows){
    const key=section==='transfers'?'inventoryTransferRow':'inventoryLocationRow',node=old.find(node=>node.dataset[key]===row.id),before=previous.rows.find(item=>item.id===row.id);
    keep.push(node&&JSON.stringify(before)===JSON.stringify(row)?node:[...incoming.children].find(node=>node.dataset[key]===row.id));
   }
   if(!keep.length)rows.innerHTML=incoming.innerHTML;
   else{for(const node of old)if(!keep.includes(node))node.remove();keep.forEach((node,index)=>{if(rows.children[index]!==node)rows.insertBefore(node,rows.children[index]||null);});}
   target.querySelectorAll('[data-inventory-transfer]').forEach(button=>{button.disabled=false;button.onclick=()=>inventoryNavigate(()=>openInventoryTransfer(button.dataset.inventoryTransfer));});
   const newTransfer=target.querySelector('#inventoryTransferNew');if(newTransfer)newTransfer.disabled=false;
   notice.textContent='Inventory transaction saved.';
   if(detail&&saved?.id&&data.rows.some(row=>row.id===saved.id)){const button=document.createElement('button');button.type='button';button.textContent='Open current transfer';button.onclick=()=>inventoryNavigate(()=>openInventoryTransfer(saved.id));detail.append(button);}
   if(section==='locations'&&form.isConnected){form.reset();delete form.dataset.inventorySaved;unlock();bindInventorySetupForm(form);}
   const focus=section==='locations'?form.querySelector('[name="name"]'):detail?.querySelector('button')||notice;
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
   if(focusPending&&(document.activeElement===document.body||form.contains(document.activeElement)))focus.focus({preventScroll:true});
   else if(focusedId&&(!focused.isConnected||document.activeElement!==focused))([...target.querySelectorAll('[data-inventory-transfer]')].find(button=>button.dataset.inventoryTransfer===focusedId)||target.querySelector('#inventoryOperationsPageStatus')).focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message('Inventory transaction saved.');
  }catch(error){
   if(!active())return;const left=window.scrollX,top=window.scrollY;
   inventoryOperationsKey='';inventoryOperationsError='Inventory transaction saved. Current results could not load.';
   notice.innerHTML=`<p role="alert">Inventory transaction saved. Current results could not load: ${esc(error.message)} Retry reads the saved results without repeating the transaction.</p><button type="button" data-inventory-retry-saved>Retry saved transaction</button>`;
   target.querySelector('#inventoryOperationsPageStatus').textContent='Saved. Current results unavailable until retry.';
   const retry=notice.querySelector('[data-inventory-retry-saved]');retry.onclick=()=>run(reload);
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);
   if(focusPending&&document.activeElement===document.body)retry.focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message('Inventory transaction saved. Use Retry saved transaction to load current results.');
  }
 }
 await reload();
}
async function openInventoryTransfer(id){
 if(inventoryActor!==me||view!=='inventory'||inventorySection!=='transfers'||inventoryOperationsError||!inventoryOperationsData||(id!=='new'&&!inventoryOperationsData.rows.some(row=>row.id===id)))return;
 const actor=me,request=inventoryOperationsRequest,action=++inventoryOperationsActionRequest,current=()=>me===actor&&inventoryActor===actor&&inventoryOperationsRequest===request&&inventoryOperationsActionRequest===action&&view==='inventory'&&inventorySection==='transfers';
 inventoryTransferReady=false;inventoryTransferId='';paintInventoryOperations();message('Loading transfer stock, product corrections and serial requirements…');
 try{
  if(typeof loadLists==='function')await loadLists();if(!current())return;
  await loadInventoryOperations();if(!current())return;
  if(!inventoryLoaded)throw Error(inventoryLoadError||'Transfer actions could not load.');
  if(productReviewLoadError)throw Error('Refresh product corrections before changing inventory. '+productReviewLoadError);
  if(typeof loadSerialSettings==='function'&&!(await loadSerialSettings()))throw Error('Serial requirements could not load. Refresh before changing stock.');
  if(!current())return;
  if(id!=='new'&&!inventoryTransfers.some(row=>row.id===id))throw Error('This transfer changed. Refresh before continuing.');
  inventoryTransferId=id;inventoryTransferReady=true;paintInventoryOperations();message('');$('#inventoryTransferDetail')?.focus();
 }catch(error){if(!current())return;throw error;}
}
async function inventoryWorkspace(force=false){
 syncInventoryActor();
 syncWorkspaceNavigation();
 const actor=me,section=inventorySection;if(!actor||view!=='inventory')return;
 if(!['locations','transfers'].includes(section))inventoryOperationsKey='';
 if(section==='catalog'){await catalogInventory(force);return;}
 if(section==='locations'||section==='transfers'){await inventoryOperationsWorkspace(force);return;}
 if(section==='review'){await tallyStockScreen();return;}
 if(section==='stock'){if(force&&(inventoryStockSetup||inventoryStockLotId)){inventoryStockActionRequest++;inventoryStockActionsReady=false;await loadInventoryOperations();if(me!==actor||view!=='inventory'||inventorySection!==section)return;inventoryStockActionsReady=inventoryLoaded&&!productReviewLoadError;if(inventoryStockActionsReady&&typeof loadSerialSettings==='function')inventoryStockActionsReady=await loadSerialSettings();if(me!==actor||view!=='inventory'||inventorySection!==section)return;if(!inventoryStockActionsReady)message('Stock actions could not reload. Reopen stock tools after refreshing.',true);}await inventoryStockWorkspace(force);return;}
 workspaceLoading('Loading godowns, stock and transfers…');
 const loading=!inventoryLoaded||force?loadInventoryOperations():null,epoch=inventoryEpoch;
 if(loading)await loading;
 if(me!==actor||epoch!==inventoryEpoch||view!=='inventory'||inventorySection!==section)return;
 if(!inventoryLoaded){$('#content').innerHTML=inventoryUnavailable();bindInventoryWorkspace();return;}
 $('#content').innerHTML=inventoryStock();bindInventoryWorkspace();
}
function renderInventoryStock(){return inventoryStockPageData?inventoryStockWorkspace():paintInventoryStock();}
function inventorySetupFormErrors(form){
 const errors=nativeFormErrors(form),product=form.elements.productChoice;
 if(form.dataset.inventoryAction==='pack'&&product.willValidate&&!errors.has(product)&&!inventoryProductFromChoice(product.value))errors.set(product,'Choose a product from the search suggestions.');
 return errors;
}
const inventorySetupBlurHandlers=new WeakMap();
function bindInventorySetupForm(form){
 const actor=me,epoch=inventoryEpoch,section=inventorySection,kind=form.dataset.inventoryAction,operationsRequest=inventoryOperationsRequest,operationsAction=inventoryOperationsActionRequest,stockRequest=inventoryStockPageRequest,stockAction=inventoryStockActionRequest,target=$('#content'),catalogContext=kind==='classification'&&typeof catalogIsActive==='function'&&catalogIsActive()?catalogSaveContext():null;
 const current=()=>me===actor&&view==='inventory'&&inventorySection===section&&inventoryEpoch===epoch&&target?.isConnected&&$('#content')===target&&form.isConnected&&target.contains(form)&&(kind==='location'?inventoryOperationsRequest===operationsRequest&&inventoryOperationsActionRequest===operationsAction:kind==='pack'?inventoryStockPageRequest===stockRequest&&inventoryStockActionRequest===stockAction:!catalogContext||catalogContext.current());
 let notice=form.querySelector('[data-inventory-setup-error]');if(!notice){notice=document.createElement('p');notice.dataset.inventorySetupError='';notice.setAttribute('role','alert');form.insertBefore(notice,form.children[0]||null);}
 const button=form.querySelector('[type="submit"]'),locked=()=>form.inert||form.dataset.saving==='true'||form.dataset.inventorySaved==='true'||button.disabled,summary=(count=form.querySelectorAll('.field-error').length)=>{notice.textContent=fieldErrorSummary(count);};
 const blur=event=>{if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);if(!current()||locked()||!form.contains(control)||!control.matches('input,select,textarea'))return;showFieldError(control,inventorySetupFormErrors(form).get(control)||'');summary();};
 const previous=inventorySetupBlurHandlers.get(form);if(previous)form.removeEventListener('focusout',previous);inventorySetupBlurHandlers.set(form,blur);form.addEventListener('focusout',blur);form.noValidate=true;
 form.onsubmit=event=>{event.preventDefault();if(!current()||locked())return;if(busy){actionFeedbackRefuse(button,notice);return;}
  const errors=inventorySetupFormErrors(form);summary(errors.size);showFieldErrors(form,errors);if(errors.size)return;
  return run(()=>submitInventoryForm(form),{origin:button,errorTarget:notice});
 };
}
function inventoryCountFormErrors(form){
 const errors=nativeFormErrors(form),sealed=form.elements.sealedCartons,loose=form.elements.looseUnits,serials=form.elements.receivingSerials,packControl=form.elements.packId,lot=form.dataset.inventoryAction==='correct'?inventoryLots.find(row=>row.id===form.dataset.lot):null,pack=inventoryPacks.find(row=>row.id===(lot?.pack_definition_id||packControl?.value));
 if(packControl?.willValidate&&!pack&&!errors.has(packControl))errors.set(packControl,'Choose a saved product / carton size.');
 for(const [control,label] of [[sealed,'Sealed cartons'],[loose,'Loose units']]){if(control.willValidate&&!errors.has(control))try{inventoryInteger(Number(control.value),label);}catch(error){errors.set(control,error.message);}}
 if(pack&&serialRequired(pack.product_id)&&[sealed,loose].every(control=>!errors.has(control)&&Number.isSafeInteger(Number(control.value))&&Number(control.value)>=0)){
  const added=receivingSerialCount(pack,lot,sealed.value,loose.value);
  if(added<0){const control=Number(sealed.value)<Number(lot.sealed_cartons)?sealed:loose;if(control.willValidate)errors.set(control,'Reducing serial-tracked stock needs a reviewed serial adjustment. Do not change a physical count to bypass unit identities.');}
  else if(added>0&&serials?.willValidate&&!errors.has(serials)){const problem=serialListProblem(parseSerialList(serials.value),added);if(problem)errors.set(serials,problem);}
 }
 return errors;
}
const inventoryCountBlurHandlers=new WeakMap();
function bindInventoryCountForm(form){
 const actor=me,epoch=inventoryEpoch,request=inventoryStockPageRequest,action=inventoryStockActionRequest,target=$('#content'),current=()=>me===actor&&view==='inventory'&&inventorySection==='stock'&&inventoryEpoch===epoch&&inventoryStockPageRequest===request&&inventoryStockActionRequest===action&&target?.isConnected&&$('#content')===target&&form.isConnected&&target.contains(form);
 const notice=form.querySelector('[data-inventory-count-error]'),button=form.querySelector('[type="submit"]'),touched=new Set(),summary=(count=form.querySelectorAll('.field-error').length)=>{notice.textContent=fieldErrorSummary(count);};
 const blur=event=>{if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);if(!current()||form.inert||form.dataset.saving==='true'||!form.contains(control)||!control.matches('input,select,textarea'))return;touched.add(control);const errors=inventoryCountFormErrors(form);showFieldError(control,errors.get(control)||'');
  if(['packId','sealedCartons','looseUnits'].includes(control.name))for(const name of ['sealedCartons','looseUnits','receivingSerials']){const related=form.elements[name];if(related&&(touched.has(related)||form.dataset.validationSubmitted==='true'))showFieldError(related,errors.get(related)||'');}
  if(form.dataset.validationSubmitted==='true')summary();
 };
 const previous=inventoryCountBlurHandlers.get(form);if(previous)form.removeEventListener('focusout',previous);inventoryCountBlurHandlers.set(form,blur);form.addEventListener('focusout',blur);form.noValidate=true;
 form.onsubmit=event=>{event.preventDefault();if(!current()||form.inert||form.dataset.saving==='true'||button.disabled)return;if(busy){actionFeedbackRefuse(button,notice);return;}
  const errors=inventoryCountFormErrors(form);form.dataset.validationSubmitted='true';summary(errors.size);showFieldErrors(form,errors);if(errors.size)return;
  return run(()=>submitInventoryForm(form),{origin:button,errorTarget:notice});
 };
}
function inventoryRequestFormErrors(form){
 const errors=nativeFormErrors(form),source=form.elements.sourceLotId,destination=form.elements.toLocationId,cartons=form.elements.cartons,lot=inventoryLots.find(row=>row.id===source.value),pack=inventoryPacks.find(row=>row.id===lot?.pack_definition_id);
 const add=(control,message)=>{if(control.willValidate&&!errors.has(control))errors.set(control,message);};
 if(!lot||lot.stock_status!=='available'||lot.sealed_cartons<1)add(source,'Choose available source stock.');
 else if(!pack)add(source,'Choose stock with a saved product / carton size.');
 if(!inventoryLocations.some(row=>row.id===destination.value&&row.active))add(destination,'Choose an active destination.');
 else if(lot&&destination.value===lot.location_id)add(destination,'Choose a different destination from the source godown.');
 if(cartons.willValidate&&!errors.has(cartons))try{
  positiveInventoryInteger(Number(cartons.value),'Transfer cartons');
  if(lot&&pack&&!errors.has(source))planCartonTransfer({cartons:Number(cartons.value),unitsPerCarton:pack.units_per_carton,availableCartons:lot.sealed_cartons});
 }catch(error){errors.set(cartons,error.message);}
 return errors;
}
const inventoryRequestBlurHandlers=new WeakMap();
function bindInventoryRequestForm(form){
 const actor=me,epoch=inventoryEpoch,request=inventoryOperationsRequest,action=inventoryOperationsActionRequest,target=$('#content'),current=()=>me===actor&&inventoryActor===actor&&view==='inventory'&&inventorySection==='transfers'&&inventoryEpoch===epoch&&inventoryOperationsRequest===request&&inventoryOperationsActionRequest===action&&inventoryTransferReady&&inventoryTransferId==='new'&&target?.isConnected&&$('#content')===target&&form.isConnected&&target.contains(form);
 const notice=form.querySelector('[data-inventory-request-error]'),button=form.querySelector('[type="submit"]'),touched=new Set(),summary=(count=form.querySelectorAll('.field-error').length)=>{notice.textContent=fieldErrorSummary(count);};
 const blur=event=>{if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);if(!current()||form.inert||form.dataset.saving==='true'||form.dataset.inventorySaved==='true'||!form.contains(control)||!control.matches('input,select,textarea'))return;touched.add(control);const errors=inventoryRequestFormErrors(form);showFieldError(control,errors.get(control)||'');
  if(control===form.elements.sourceLotId)for(const related of [form.elements.toLocationId,form.elements.cartons])if(touched.has(related)||form.dataset.validationSubmitted==='true')showFieldError(related,errors.get(related)||'');
  if(form.dataset.validationSubmitted==='true')summary();
 };
 const previous=inventoryRequestBlurHandlers.get(form);if(previous)form.removeEventListener('focusout',previous);inventoryRequestBlurHandlers.set(form,blur);form.addEventListener('focusout',blur);form.noValidate=true;
 form.onsubmit=event=>{event.preventDefault();if(!current()||form.inert||form.dataset.saving==='true'||form.dataset.inventorySaved==='true'||button.disabled)return;if(busy){actionFeedbackRefuse(button,notice);return;}
  const errors=inventoryRequestFormErrors(form);form.dataset.validationSubmitted='true';summary(errors.size);showFieldErrors(form,errors);if(errors.size)return;
  return run(()=>submitInventoryForm(form),{origin:button,errorTarget:notice});
 };
}
function inventoryActionFormErrors(form){
 const errors=nativeFormErrors(form),action=form.dataset.inventoryAction,quantity=form.elements.actualUnits||form.elements.cartons||form.elements.quantity;
 if(quantity?.willValidate&&!errors.has(quantity))try{
  const value=Number(quantity.value);
  if(action==='receive')inventoryInteger(value,'Counted units');
  else{
   positiveInventoryInteger(value,action==='issue'?'Issue quantity':'Cartons to open');
   const lot=inventoryLots.find(row=>row.id===form.dataset.lot),place=lot&&inventoryLocation(lot.location_id),stock=lot&&inventoryLotAvailability(lot,place,inventoryDate());
   if(action==='issue'){if(!stock||value>stock.invoiceableLoose)throw Error('Not enough eligible loose units at the dispatch hub. Refresh stock before continuing.');}
   else{if(!stock?.canOpenCartons)throw Error('This lot cannot be opened for dispatch. Refresh stock before continuing.');const pack=inventoryPack(lot.pack_definition_id);planBreakPack({location:{isDispatchHub:place.is_dispatch_hub},cartons:value,unitsPerCarton:pack.units_per_carton,availableCartons:stock.cartons,looseUnits:stock.loose});}
  }
 }catch(error){errors.set(quantity,error.message);}
 if(action==='dispatch'||action==='receive'){
  const transfer=inventoryTransfers.find(row=>row.id===form.dataset.transfer),serials=form.elements.transferSerials;
  if(transfer&&serialRequired(transfer.product_id)&&serials?.willValidate&&!errors.has(serials)&&(action==='dispatch'||quantity.willValidate&&!errors.has(quantity))){const problem=serialListProblem(parseSerialList(serials.value),action==='receive'?Number(quantity.value):transfer.expected_units);if(problem)errors.set(serials,problem);}
 }
 return errors;
}
const inventoryActionBlurHandlers=new WeakMap();
function bindInventoryActionForm(form){
 const actor=me,epoch=inventoryEpoch,section=inventorySection,transfer=['dispatch','receive'].includes(form.dataset.inventoryAction),request=transfer?inventoryOperationsRequest:inventoryStockPageRequest,action=transfer?inventoryOperationsActionRequest:inventoryStockActionRequest,target=$('#content');
 const current=()=>me===actor&&inventoryActor===actor&&view==='inventory'&&inventorySection===section&&inventoryEpoch===epoch&&target?.isConnected&&$('#content')===target&&form.isConnected&&target.contains(form)&&(transfer?section==='transfers'&&inventoryOperationsRequest===request&&inventoryOperationsActionRequest===action&&inventoryTransferReady&&inventoryTransferId===form.dataset.transfer:section==='stock'&&inventoryStockPageRequest===request&&inventoryStockActionRequest===action);
 const notice=form.querySelector('[data-inventory-action-error]'),button=form.querySelector('[type="submit"]'),touched=new Set(),summary=(count=form.querySelectorAll('.field-error').length)=>{notice.textContent=fieldErrorSummary(count);};
 const blur=event=>{if(fieldBlurToAction(event))return;const control=fieldValidationSource(event.target);if(!current()||form.inert||form.dataset.saving==='true'||form.dataset.inventorySaved==='true'||!form.contains(control)||!control.matches('input,select,textarea'))return;touched.add(control);const errors=inventoryActionFormErrors(form);showFieldError(control,errors.get(control)||'');
  const serials=form.elements.transferSerials;if(control===form.elements.actualUnits&&serials&&(touched.has(serials)||form.dataset.validationSubmitted==='true'))showFieldError(serials,errors.get(serials)||'');
  summary();
 };
 const previous=inventoryActionBlurHandlers.get(form);if(previous)form.removeEventListener('focusout',previous);inventoryActionBlurHandlers.set(form,blur);form.addEventListener('focusout',blur);form.noValidate=true;
 form.onsubmit=event=>{event.preventDefault();if(!current()||form.inert||form.dataset.saving==='true'||form.dataset.inventorySaved==='true'||button.disabled)return;if(busy){actionFeedbackRefuse(button,notice);return;}
  const errors=inventoryActionFormErrors(form);form.dataset.validationSubmitted='true';summary(errors.size);showFieldErrors(form,errors);if(errors.size)return;
  const ownedFocus=form.contains(document.activeElement);
  return run(async()=>{
   const feedback=actionFeedbackActive;await submitInventoryForm(form);
   const savedCurrent=!!feedback.successOrigin&&me===actor&&inventoryActor===actor&&view==='inventory'&&inventorySection===section&&target.isConnected&&$('#content')===target&&(transfer?inventoryOperationsRequest===request&&inventoryOperationsActionRequest===action+1:inventoryStockPageRequest===request&&inventoryStockActionRequest===action+1);
   if(!savedCurrent)feedback.wasFocused=false;
   if(ownedFocus&&savedCurrent&&feedback===actionFeedbackActive&&actionFeedbackCurrent(feedback)&&(document.activeElement===document.body||form.contains(document.activeElement))){const focus=actionFeedbackResolve(feedback.successOrigin);if(focus&&target.contains(focus))focus.focus({preventScroll:true});}
  },{origin:button,errorTarget:notice});
 };
}
const inventoryFormSnapshots=new WeakMap();
let inventoryLeavePending=false;
function inventoryLeaveContext(){
 const actor=me,epoch=inventoryEpoch,section=inventorySection,target=$('#content'),stockRequest=inventoryStockPageRequest,stockAction=inventoryStockActionRequest,operationsRequest=inventoryOperationsRequest,operationsAction=inventoryOperationsActionRequest,lot=inventoryStockLotId,transfer=inventoryTransferId;
 const forms=[...document.querySelectorAll('form[data-inventory-action]')],states=forms.map(form=>[form,form.dataset.version,form.dataset.lotVersion]);
 return ()=>me===actor&&inventoryActor===actor&&view==='inventory'&&inventorySection===section&&inventoryEpoch===epoch&&$('#content')===target&&target?.isConnected&&inventoryStockPageRequest===stockRequest&&inventoryStockActionRequest===stockAction&&inventoryOperationsRequest===operationsRequest&&inventoryOperationsActionRequest===operationsAction&&inventoryStockLotId===lot&&inventoryTransferId===transfer&&document.querySelectorAll('form[data-inventory-action]').length===forms.length&&states.every(([form,version,lotVersion])=>form.isConnected&&form.dataset.version===version&&form.dataset.lotVersion===lotVersion);
}
async function inventoryConfirmLeave(current=()=>true){
 if(!current())return false;
 if(view!=='inventory'||!['stock','locations','transfers'].includes(inventorySection))return true;
 const forms=[...document.querySelectorAll('form[data-inventory-action]')];
 if(forms.some(form=>form.dataset.saving==='true'&&form.dataset.inventorySaved!=='true')){message('Wait for this inventory save to finish before leaving the form.',true);return false;}
 const changed=forms.some(form=>form.dataset.inventorySaved!=='true'&&inventoryFormSnapshots.has(form)&&workspaceFormSnapshot(form)!==inventoryFormSnapshots.get(form));
 if(!changed)return current();
 if(inventoryLeavePending)return false;
 const active=inventoryLeaveContext(),states=forms.map(form=>workspaceFormSnapshot(form));inventoryLeavePending=true;
 try{return await askConfirm({title:'Discard unsaved changes?',body:'Your changes to the inventory forms will be lost.',confirmLabel:'Discard changes',tone:'danger'})&&current()&&active()&&forms.every((form,index)=>(form.dataset.saving!=='true'||form.dataset.inventorySaved==='true')&&workspaceFormSnapshot(form)===states[index]);}
 finally{inventoryLeavePending=false;}
}
function inventoryNavigate(action,control=null,previousValue){
 const current=inventoryLeaveContext(),value=control?.value;let started=false;
 const restore=()=>{if(previousValue!==undefined&&current()&&control?.isConnected&&control.value===value)control.value=previousValue;};
 const pending=run(async()=>{
  started=true;if(!await inventoryConfirmLeave(current)||!current()){restore();return;}
  const locks=[...document.querySelectorAll('form[data-inventory-action]')].map(form=>({form,inert:form.inert}));
  locks.forEach(({form})=>form.inert=true);
  try{return await action(current);}finally{for(const {form,inert} of locks)if(form.isConnected)form.inert=inert;}
 });
 if(!started)restore();return pending;
}
function bindInventoryWorkspace(){
 if(typeof lookupRowSources!=='undefined')lookupRowSources.inventoryPacks=inventoryPackChoices;
 document.querySelectorAll('[data-inventory-section]').forEach(button=>button.onclick=()=>inventoryNavigate(()=>{inventorySection=button.dataset.inventorySection;return inventoryWorkspace()}));
 const refresh=$('#inventoryRefresh');if(refresh)refresh.onclick=()=>inventoryNavigate(()=>inventoryWorkspace(true));
 const operationsSearch=$('#inventoryOperationsSearch');if(operationsSearch)operationsSearch.oninput=event=>{const input=event.target,value=input.value,previous=inventoryOperationsSearch;return renderSearchPreservingPosition(input,()=>inventoryNavigate(()=>{inventoryOperationsSearch=value;inventoryOperationsRequest++;inventoryOperationsPage=0;inventoryTransferReady=false;inventoryTransferId='';return inventoryOperationsWorkspace();},input,previous),150)};
 const operationsStatus=$('#inventoryOperationsStatus');if(operationsStatus)operationsStatus.onchange=()=>{const value=operationsStatus.value;return inventoryNavigate(async()=>{inventoryOperationsStatus=value;inventoryOperationsPage=0;await inventoryOperationsWorkspace();$('#inventoryOperationsStatus')?.focus();},operationsStatus,inventoryOperationsStatus);};
 for(const [id,step] of [['inventoryOperationsPrevious',-1],['inventoryOperationsNext',1]]){const button=$('#'+id);if(button)button.onclick=()=>inventoryNavigate(async()=>{inventoryOperationsPage+=step;await inventoryOperationsWorkspace();const next=$('#'+id);(next?.disabled?$('#inventoryOperationsPageStatus'):next)?.focus()});}
 const newTransfer=$('#inventoryTransferNew');if(newTransfer)newTransfer.onclick=()=>inventoryNavigate(()=>openInventoryTransfer('new'));
 document.querySelectorAll('[data-inventory-transfer]').forEach(button=>button.onclick=()=>inventoryNavigate(()=>openInventoryTransfer(button.dataset.inventoryTransfer)));
 const closeTransfer=$('#inventoryTransferClose');if(closeTransfer)closeTransfer.onclick=()=>inventoryNavigate(()=>{const id=inventoryTransferId;inventoryOperationsActionRequest++;inventoryTransferReady=false;inventoryTransferId='';paintInventoryOperations();(id==='new'?$('#inventoryTransferNew'):[...document.querySelectorAll('[data-inventory-transfer]')].find(button=>button.dataset.inventoryTransfer===id))?.focus()});
 const clearScope=$('#clearStockProduct');if(clearScope)clearScope.onclick=()=>inventoryNavigate(()=>{inventoryProductId='';inventorySearch='';inventoryStockPage=0;inventoryStockLocation='';inventoryStockStatus='';inventoryStockLotId='';return renderInventoryStock()});
 const stockSearch=$('#inventorySearch');if(stockSearch)stockSearch.oninput=event=>{const input=event.target,value=input.value,previous=inventorySearch;return renderSearchPreservingPosition(input,()=>inventoryNavigate(()=>{inventorySearch=value;inventoryStockPageRequest++;inventoryStockPage=0;inventoryStockLotId='';return renderInventoryStock();},input,previous),150)};
 for(const [id,setFilter] of [['inventoryStockLocation',value=>inventoryStockLocation=value],['inventoryStockStatus',value=>inventoryStockStatus=value]]){const select=$('#'+id);if(select)select.onchange=()=>{const value=select.value,previous=id==='inventoryStockLocation'?inventoryStockLocation:inventoryStockStatus;return inventoryNavigate(async()=>{setFilter(value);inventoryStockPage=0;inventoryStockLotId='';await renderInventoryStock();$('#'+id)?.focus();},select,previous);};}
 for(const [id,step] of [['inventoryStockPrevious',-1],['inventoryStockNext',1]]){const button=$('#'+id);if(button)button.onclick=()=>inventoryNavigate(async()=>{inventoryStockPage+=step;inventoryStockLotId='';await renderInventoryStock();const next=$('#'+id);(next?.disabled?$('#inventoryStockPageStatus'):next)?.focus()});}
 document.querySelectorAll('[data-inventory-lot]').forEach(button=>button.onclick=()=>inventoryNavigate(()=>inventoryStockPageData?openInventoryStockTools(button.dataset.inventoryLot):(inventoryStockLotId=button.dataset.inventoryLot,renderInventoryStock(),$('#inventoryStockDetail')?.focus())));
 const closeLot=$('#inventoryStockClose');if(closeLot)closeLot.onclick=()=>inventoryNavigate(()=>{const id=inventoryStockLotId;inventoryStockLotId='';paintInventoryStock();[...document.querySelectorAll('[data-inventory-lot]')].find(button=>button.dataset.inventoryLot===id)?.focus()});
 const openTools=$('#inventoryStockOpenTools');if(openTools)openTools.onclick=()=>inventoryNavigate(()=>openInventoryStockTools());
 const hideTools=$('#inventoryStockHideTools');if(hideTools)hideTools.onclick=()=>inventoryNavigate(()=>{inventoryStockSetup=false;inventoryStockSerialTools=false;paintInventoryStock();$('#inventoryStockOpenTools')?.focus()});
 const serialTools=$('#inventoryStockSerialTools');if(serialTools)serialTools.onclick=()=>run(async()=>{inventoryStockSerialTools=true;if(typeof decorateSerialTools==='function')await decorateSerialTools();});
 const importInput=$('#inventoryProductImport');if(importInput)importInput.onchange=()=>{const file=importInput.files[0],current=inventoryLeaveContext();if(!file)return;return run(async()=>{const payload=JSON.parse(await file.text());if(!current()||importInput.files[0]!==file)return;const plan=inventoryImportPlan(payload,products);if(!await inventoryConfirmLeave(current)||!current()){if(current()&&importInput.files[0]===file)importInput.value='';return;}inventoryImportPreview=plan;inventoryImportFileName=file.name;paintInventoryStock();});};
 const importCommit=$('#inventoryImportCommit');if(importCommit)importCommit.onclick=()=>{
  const plan=inventoryImportPreview,actor=me,epoch=inventoryEpoch,section=inventorySection,target=$('#content'),selected=importInput?.files[0];
  const current=()=>me===actor&&epoch===inventoryEpoch&&view==='inventory'&&inventorySection===section&&inventoryImportPreview===plan&&target?.isConnected&&$('#content')===target&&importCommit.isConnected&&$('#inventoryImportCommit')===importCommit&&importInput?.isConnected&&$('#inventoryProductImport')===importInput&&importInput.files[0]===selected;
  if(!plan?.newProducts.length||!current())return;
  return inventoryNavigate(async()=>{
  if(!current())return;
  if(!await askConfirm({title:`Import ${plan.newProducts.length} product names?`,body:'Existing exact-name matches will be skipped. No stock quantities will be created.',confirmLabel:'Import product names',tone:'normal'})||!current())return;
  for(let i=0;i<plan.newProducts.length;i+=250){
   if(!current())return;
   const result=await client.rpc('import_records',{p_products:plan.newProducts.slice(i,i+250)});if(!current())return;
   if(result.error)throw Error(`Import stopped at product ${i}. Completed batches are safe to retry. ${result.error.message}`);
  }
  inventoryImportPreview=null;inventoryImportFileName='';await load();if(me===actor&&view==='inventory'&&inventorySection===section)message('Book2 product names imported. Enter stock only from verified physical counts.');
  });};
 document.querySelectorAll('[data-inventory-reserved]').forEach(button=>button.onclick=()=>run(()=>showInventoryReservations(button)));
 document.querySelectorAll('form[data-inventory-action]').forEach(form=>form.onsubmit=event=>{event.preventDefault();run(()=>submitInventoryForm(form))});
 document.querySelectorAll('form[data-inventory-action="classification"],form[data-inventory-action="pack"],form[data-inventory-action="location"]').forEach(bindInventorySetupForm);
 document.querySelectorAll('form[data-inventory-action="opening"],form[data-inventory-action="correct"]').forEach(bindInventoryCountForm);
 document.querySelectorAll('form[data-inventory-action="request"]').forEach(bindInventoryRequestForm);
 if(inventorySection==='locations'||inventorySection==='transfers'){if(inventoryTransferReady&&typeof bindReceivingSerialForms==='function')bindReceivingSerialForms();}
 else if(inventoryStockPageData){if(typeof bindReceivingSerialForms==='function'&&(inventoryStockSetup||inventoryStockLotId))bindReceivingSerialForms();if(inventoryStockSerialTools&&typeof decorateSerialTools==='function')decorateSerialTools().catch(()=>{});}
 else if(typeof decorateSerialTools==='function')decorateSerialTools().catch(()=>{});
 document.querySelectorAll('form[data-inventory-action="dispatch"],form[data-inventory-action="receive"],form[data-inventory-action="open"],form[data-inventory-action="issue"]').forEach(bindInventoryActionForm);
 // A saved-row refresh can rebind the page while other forms still contain edits.
 document.querySelectorAll('form[data-inventory-action]').forEach(form=>{if(!inventoryFormSnapshots.has(form))inventoryFormSnapshots.set(form,workspaceFormSnapshot(form));});
}
async function showInventoryReservations(button){
 if(!hasArea('deliveries'))throw Error('Delivery details require Deliveries access.');
 const lot=inventoryLots.find(row=>row.id===button.dataset.inventoryReserved);
 if(!lot)throw Error('Refresh stock before viewing reservations.');
 const actor=me,epoch=inventoryEpoch,target=button.parentElement,current=()=>me===actor&&inventoryEpoch===epoch&&button.isConnected&&hasArea('deliveries');
 button.disabled=true;
 try{
  const lines=await all('sales_delivery_lines','id,delivery_note_id,lot_id,quantity,inventory_issue_id',query=>query.eq('lot_id',lot.id).is('inventory_issue_id',null));
  if(!current())return;
  const ids=[...new Set(lines.map(line=>line.delivery_note_id))],notes=[];
  for(let i=0;i<ids.length;i+=100){
   notes.push(...await all('sales_delivery_notes','id,delivery_number,status',query=>query.in('id',ids.slice(i,i+100))));
   if(!current())return;
  }
  const active=notes.filter(note=>['tax_invoice_created','sent_to_sales','packing','ready'].includes(note.status));
  let matched=0;
  const rows=active.map(note=>{
   const quantity=lines.filter(line=>line.delivery_note_id===note.id).reduce((sum,line)=>{positiveInventoryInteger(line.quantity,'Reserved quantity');return inventoryInteger(sum+line.quantity,'Reserved total')},0);
   matched=inventoryInteger(matched+quantity,'Reserved total');
   return `<li><button type="button" data-inventory-delivery="${esc(note.id)}">${esc(note.delivery_number)}</button> · ${inventoryNumber(quantity)} reserved · ${esc(note.status.replaceAll('_',' '))}</li>`;
  });
  target.innerHTML=rows.length?`<ul>${rows.join('')}</ul>`:'<p>No active delivery reservations are visible with your access.</p>';
  if(matched!==lot.reserved_units)target.insertAdjacentHTML('beforeend','<p class="warning">Visible delivery reservations do not match this stock snapshot. Refresh stock before relying on these details.</p>');
  target.querySelectorAll('[data-inventory-delivery]').forEach(link=>link.onclick=()=>inventoryNavigate(()=>{
   if(!hasArea('deliveries'))throw Error('Delivery details require Deliveries access.');
   salesFocusedDelivery=link.dataset.inventoryDelivery;salesFocusedProforma='';salesSection='delivery';salesEditing='';view='sales';return salesDeliveryWorkspace(true);
  }));
 }finally{if(button.isConnected)button.disabled=false;}
}
async function submitInventoryForm(form){
 const f=new FormData(form),action=form.dataset.inventoryAction,actor=me,section=inventorySection,operationsRequest=inventoryOperationsRequest,operationsAction=inventoryOperationsActionRequest,operationsSave=view==='inventory'&&['locations','transfers'].includes(section),stockSave=view==='inventory'&&section==='stock'&&!!inventoryStockPageData,stockRequest=inventoryStockPageRequest,stockAction=inventoryStockActionRequest,retained=operationsSave||stockSave;let result;
 if(retained&&form.dataset.inventorySaved==='true')throw Error('Inventory transaction saved. Use Retry saved transaction to load current results.');
 if(retained&&form.dataset.saving==='true')return;
 if(inventoryStockPageData&&view==='inventory'&&inventorySection==='stock'&&(!inventoryStockActionsReady||inventoryStockPageError))throw Error('Reopen stock tools before changing inventory.');
 if(operationsSave&&(inventoryActor!==actor||inventoryOperationsError))throw Error('Refresh this inventory page before changing inventory.');
 if(operationsSave&&['request','dispatch','receive'].includes(action)&&(!inventoryTransferReady||(action==='request'?inventoryTransferId!=='new':inventoryTransferId!==form.dataset.transfer)))throw Error('Reopen this transfer before changing inventory.');
 const catalogDetail=action==='classification'&&typeof catalogIsActive==='function'&&catalogIsActive()?catalogDetailRows.get(form.dataset.product):null;
 const currentCatalogClassification=catalogDetail?.catalog_current===true&&catalogDetail.original?.id===form.dataset.product;
 const catalogContext=action==='classification'&&typeof catalogIsActive==='function'&&catalogIsActive()?catalogSaveContext():null;
 if(catalogContext&&!catalogContext.current())return;
 if(action!=='location'&&!currentCatalogClassification&&typeof productReviewLoadError!=='undefined'&&productReviewLoadError)throw Error('Refresh product corrections before changing inventory. '+productReviewLoadError);
 const target=retained?$('#content'):null,wasFocused=retained&&form.contains(document.activeElement),inert=retained&&form.inert,button=retained?form.querySelector('[type="submit"]'):null;
 // run may already own this button's temporary disabled state; a later read-only retry must restore its original state.
 const feedbackState=typeof actionFeedbackActive!=='undefined'?actionFeedbackActive?.state:null,disabled=feedbackState?.node===button?feedbackState.disabled:button?.disabled;
 const unlock=()=>{form.dataset.saving='false';form.inert=inert;if(button)button.disabled=disabled;};
 if(retained){if(!form.isConnected)throw Error('Reopen this inventory form before saving.');form.dataset.saving='true';form.inert=true;if(button)button.disabled=true;}
 try{
 if(action==='location')result=await client.rpc('save_inventory_location',{p_id:crypto.randomUUID(),p_expected_version:0,p_name:f.get('name'),p_code:f.get('code'),p_location_type:f.get('locationType'),p_active:true});
 else if(action==='pack'){const product=inventoryProductFromChoice(f.get('productChoice'));if(!product)throw Error('Choose a product from the search suggestions.');const current=inventoryLatestPack(product.id);result=await client.rpc('save_pack_definition',{p_id:crypto.randomUUID(),p_product_id:product.id,p_expected_version:current?.version||0,p_base_unit:f.get('baseUnit'),p_units_per_carton:Number(f.get('unitsPerCarton')),p_reason:f.get('reason')});}
 else if(action==='opening'){const pack=inventoryPacks.find(x=>x.id===f.get('packId'));result=await saveInventoryCountWithSerials({p_lot_id:crypto.randomUUID(),p_expected_version:0,p_product_id:pack.product_id,p_location_id:f.get('locationId'),p_pack_definition_id:pack.id,p_batch_number:f.get('batchNumber'),p_expiry_date:f.get('expiryDate')||null,p_sealed_cartons:Number(f.get('sealedCartons')),p_loose_units:Number(f.get('looseUnits')),p_reason:f.get('reason')},f.get('receivingSerials'));}
 else if(action==='correct'){const lot=inventoryLots.find(x=>x.id===form.dataset.lot);if(!lot)throw Error('This stock lot changed. Refresh and try again.');result=await saveInventoryCountWithSerials({p_lot_id:lot.id,p_expected_version:Number(form.dataset.version),p_product_id:lot.product_id,p_location_id:lot.location_id,p_pack_definition_id:lot.pack_definition_id,p_batch_number:lot.batch_number,p_expiry_date:lot.expiry_date||null,p_sealed_cartons:Number(f.get('sealedCartons')),p_loose_units:Number(f.get('looseUnits')),p_reason:f.get('reason')},f.get('receivingSerials'));}
 else if(action==='request')result=await client.rpc('request_inventory_transfer',{p_id:crypto.randomUUID(),p_source_lot_id:f.get('sourceLotId'),p_to_location_id:f.get('toLocationId'),p_cartons:Number(f.get('cartons')),p_expected_at:f.get('expectedAt'),p_reason:f.get('reason')});
 else if(action==='dispatch')result=await saveInventoryTransferWithSerials(action,{p_id:form.dataset.transfer,p_expected_version:Number(form.dataset.version),p_expected_lot_version:Number(form.dataset.lotVersion),p_reason:f.get('reason')},f.get('transferSerials'),f.get('legacyTransfer')==='on');
 else if(action==='receive')result=await saveInventoryTransferWithSerials(action,{p_id:form.dataset.transfer,p_expected_version:Number(form.dataset.version),p_actual_units:Number(f.get('actualUnits')),p_inspection:f.get('inspection'),p_note:f.get('note')},f.get('transferSerials'),f.get('legacyTransfer')==='on');
 else if(action==='open'){const lot=inventoryLots.find(row=>row.id===form.dataset.lot);if(!lot||!inventoryLotAvailability(lot,inventoryLocation(lot.location_id),inventoryDate()).canOpenCartons)throw Error('This lot cannot be opened for dispatch. Refresh stock before continuing.');result=await client.rpc('open_inventory_cartons',{p_lot_id:form.dataset.lot,p_expected_version:Number(form.dataset.version),p_cartons:Number(f.get('cartons')),p_reason:f.get('reason')});}
 else if(action==='issue'){const lot=inventoryLots.find(row=>row.id===form.dataset.lot),quantity=positiveInventoryInteger(Number(f.get('quantity')),'Issue quantity');if(!lot||quantity>inventoryLotAvailability(lot,inventoryLocation(lot.location_id),inventoryDate()).invoiceableLoose)throw Error('Not enough eligible loose units at the dispatch hub. Refresh stock before continuing.');result=await client.rpc('issue_consumer_units',{p_id:crypto.randomUUID(),p_lot_id:form.dataset.lot,p_expected_version:Number(form.dataset.version),p_organization_id:f.get('organizationId'),p_quantity:quantity,p_issued_on:f.get('issuedOn'),p_reference:f.get('reference'),p_reason:f.get('reason')});}
 else if(action==='classification')result=await client.rpc('save_product_inventory_classification',{p_id:crypto.randomUUID(),p_product_id:form.dataset.product,p_expected_version:Number(form.dataset.version),p_category:f.get('category'),p_reason:f.get('reason')});
 else throw Error('Unsupported inventory action.');
 if(catalogContext&&!catalogContext.current())return;
 if(me!==actor)return;
 if(result.error)throw result.error;
 if(catalogContext){await refreshCatalogSavedProduct(form.dataset.product,'Inventory category saved.',catalogContext,{classification:Number(form.dataset.version)+1});return;}
 inventoryOperationsKey='';
 if(operationsSave){
  inventoryEpoch++;inventoryLoaded=false;inventoryStockPageKey='';inventoryStockActionsReady=false;form.dataset.inventorySaved='true';
  const current=()=>me===actor&&inventoryActor===actor&&view==='inventory'&&inventorySection===section&&inventoryOperationsRequest===operationsRequest&&target.isConnected&&$('#content')===target;
  if(!current()||inventoryOperationsActionRequest!==operationsAction)return;
  await refreshSavedInventoryOperation(form,section,result.data,current,unlock,wasFocused);return;
 }
 if(stockSave){
  inventoryEpoch++;inventoryLoaded=false;inventoryStockPageKey='';inventoryStockActionsReady=false;form.dataset.inventorySaved='true';
  const current=()=>me===actor&&inventoryActor===actor&&view==='inventory'&&inventorySection==='stock'&&inventoryStockPageRequest===stockRequest&&target.isConnected&&$('#content')===target;
  if(!current()||inventoryStockActionRequest!==stockAction)return;
  await refreshSavedInventoryStock(form,current,unlock,wasFocused);return;
 }
 await inventoryWorkspace(true);if(me===actor)message('Inventory transaction saved.');
 }catch(error){if(me!==actor||catalogContext&&!catalogContext.current())return;if(retained&&(!form.isConnected||$('#content')!==target||view!=='inventory'||inventorySection!==section||(operationsSave?inventoryOperationsRequest!==operationsRequest||inventoryOperationsActionRequest!==operationsAction:inventoryStockPageRequest!==stockRequest||inventoryStockActionRequest!==stockAction)))return;throw error;}finally{if(retained&&form.dataset.inventorySaved!=='true'&&me===actor&&form.isConnected)unlock();}
}
