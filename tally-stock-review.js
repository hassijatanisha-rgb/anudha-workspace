'use strict';
let tallyRows=[],tallyCorrections=new Map(),tallySearch='',tallyPage=0,tallyGodown='';
let tallyReadiness=null;
let tallyLocationReviews=null,tallyLocations=null;
function tallyGodownLocationStatus(godown,reviews,locations){
 if(!godown?.trim())return {ready:false,label:'Missing source godown',version:0};
 if(!Array.isArray(reviews)||!Array.isArray(locations))return {ready:false,label:'Location checks unavailable',version:0};
 const latest=reviews.filter(r=>r.source_godown===godown).reduce((best,r)=>!best||r.version>best.version?r:best,null);
 if(!latest)return {ready:false,label:'Location not mapped',version:0};
 if(latest.unconfirmed)return {ready:false,label:'Mapping save unconfirmed — do not import',version:latest.version};
 if(!latest.location_id)return {ready:false,label:'Unresolved — do not import',version:latest.version};
 const location=locations.find(r=>r.id===latest.location_id&&r.active===true);
 return {ready:!!location,label:location?location.name:'Mapped location inactive or missing',version:latest.version};
}
function refreshGodownLocationChecks(){
 document.querySelectorAll('#godownReadiness tbody tr[data-source-godown]').forEach(row=>{
  const cell=row.querySelector('[data-location-ready]');if(!cell)return;
  const check=tallyGodownLocationStatus(row.dataset.sourceGodown,tallyLocationReviews,tallyLocations);
  cell.dataset.locationReady=String(check.ready);cell.textContent=check.label;
 });
}
function tallyGodownReview(source,corrections,godown,search){
 const godowns=[...new Set(source.map(r=>r.godown||''))].sort((a,b)=>a.localeCompare(b));
 const scoped=godown?source.filter(r=>r.godown===godown):source;
 const needle=String(search||'').trim().toLowerCase();
 return {godowns,total:scoped.length,reviewed:scoped.filter(r=>corrections.has(r.id)).length,
  negative:scoped.filter(r=>r.quantity<0).length,
  missingQuantity:scoped.filter(r=>r.quantity===null||r.quantity===undefined||r.quantity==='').length,
  rows:scoped.filter(r=>[r.product_name,r.godown,r.unit].join(' ').toLowerCase().includes(needle))};
}
async function tallyStockScreen(){
 const actor=me?.user_id;
 $('#content').innerHTML='<p role="status">Loading Tally stock review…</p>';
 try{
  const [rows,corrections,mapping]=await Promise.all([all('tally_stock_sources','id,source_file,source_row,godown,product_name,quantity,unit,balance_date,imported_at'),all('tally_stock_corrections','*'),Promise.all([all('godown_mapping_reviews','id,source_godown,version,location_id,reason'),all('inventory_locations','id,name,active')]).catch(()=>[null,null])]);
  if(me?.user_id!==actor||inventorySection!=='review')return;
  [tallyLocationReviews,tallyLocations]=mapping;
  tallyRows=rows;tallyCorrections=new Map();for(const r of corrections)if((tallyCorrections.get(r.source_id)?.version||0)<r.version)tallyCorrections.set(r.source_id,r);
  tallyReadiness=tallyGodownReadiness(tallyRows,tallyRowReview);
  renderTallyStock();
 }catch(error){if(me?.user_id===actor&&inventorySection==='review'){$('#content').innerHTML=inventoryHeader()+`<p role="alert">Stock review could not load: ${esc(error.message)}. No stock was changed.</p>`;bindInventoryWorkspace();}}
}
function tallyRowReview(row){
 const correction=tallyCorrections.get(row.id),product=products.find(p=>p.id===correction?.product_id&&!p.deleted_at);
 const details=product?productReviewDefaults(reviewedCatalogProduct(product)):{name:row.product_name};
 const result=productStockReview(details,{quantity:correction?.pieces??row.quantity,unit:correction?.pieces!=null?'PCS':row.unit,verified:correction?.pieces!=null,batch:correction?.batch,expiry:correction?.expiry});
 if(!product)result.issues.unshift('Choose the matching catalog product');
 return {correction,product,result};
}
function tallyGodownReadiness(rows,review){
 const groups=new Map();
 for(const row of rows){
  const name=row.godown||'';
  if(!groups.has(name))groups.set(name,{name,total:0,checked:0,blocked:0,unmapped:0,negative:0});
  const group=groups.get(name),check=review(row);group.total++;
  if(!check.product)group.unmapped++;
  if(row.quantity<0)group.negative++;
  if(!name.trim()||!check.product||check.result.issues.length)group.blocked++;else group.checked++;
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function renderTallyStock(){
 tallyReadiness??=tallyGodownReadiness(tallyRows,tallyRowReview);
 const scope=tallyGodownReview(tallyRows,tallyCorrections,tallyGodown,tallySearch),rows=scope.rows;
 const pages=Math.max(1,Math.ceil(rows.length/50));tallyPage=Math.min(tallyPage,pages-1);
 const negative=scope.negative,reviewed=scope.reviewed,godowns=scope.godowns.length;
 $('#content').innerHTML=inventoryHeader()+`<section class="cleanup-hero"><div><small>INVENTORY · TALLY DATA</small><h1>Tally stock cleanup</h1><p>Match source rows to products and record verified pieces while preserving every original balance. Corrections do not post operational stock.</p></div></section><div class="cleanup-metrics"><div><small>Source rows</small><strong>${scope.total}</strong></div><div><small>Saved reviews</small><strong>${reviewed}</strong></div><div><small>Negative balances</small><strong>${negative}</strong></div><div><small>Source godown labels</small><strong>${godowns}</strong></div></div><section class="card cleanup-table"><div class="cleanup-search"><label><span>Godown</span><select id="tallyGodown"><option value="">All source godowns</option>${scope.godowns.filter(Boolean).map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label>${me.role==='owner'?'<label><span>Load prepared private stock file</span><input id="tallyFile" type="file" accept=".json,application/json"></label>':''}<label><span>Search product or godown</span><input type="search" id="tallySearch" placeholder="Search Tally rows"></label></div><p id="tallyScope" role="status">${rows.length} matching rows · ${esc(tallyGodown||'All source godowns')} · ${scope.missingQuantity} missing quantities. Saved reviews may still need corrections; source balances are unchanged.</p><div class="table-wrap"><table><thead><tr><th>Product / godown</th><th>Tally balance</th><th>Review</th><th>Corrected pieces</th><th>Action</th></tr></thead><tbody>${rows.slice(tallyPage*50,tallyPage*50+50).map(r=>{const {correction,result}=tallyRowReview(r);return `<tr><td><strong>${esc(r.product_name)}</strong><small>${esc(r.godown)} · ${esc(r.balance_date)}</small></td><td>${esc(r.quantity??'Unknown')} ${esc(r.unit||'Unit missing')}${r.quantity<0?'<span class="cleanup-pill danger">Negative</span>':''}</td><td>${result.issues.map(esc).join('; ')||'<span class="cleanup-pill success">Reviewed</span>'}</td><td>${esc(correction?.pieces??'Not verified')}</td><td><button data-tally-review="${esc(r.id)}">Review / correct</button></td></tr>`}).join('')}</tbody></table></div><div class="actions cleanup-pagination"><button id="tallyPrev" ${tallyPage===0?'disabled':''}>Previous</button><span>Page ${tallyPage+1} of ${pages}</span><button id="tallyNext" ${tallyPage+1>=pages?'disabled':''}>Next</button></div><p id="tallyStatus" role="status"></p></section>`;
 bindInventoryWorkspace();$('#tallyGodown').value=tallyGodown;$('#tallyGodown').onchange=e=>{tallyGodown=e.target.value;tallyPage=0;renderTallyStock();$('#tallyGodown').focus();};$('#tallySearch').value=tallySearch;$('#tallySearch').oninput=e=>{tallySearch=e.target.value;tallyPage=0;renderSearchPreservingPosition(e.target,renderTallyStock);};
 $('#tallyPrev').onclick=()=>{tallyPage--;renderTallyStock()};$('#tallyNext').onclick=()=>{tallyPage++;renderTallyStock()};
 document.querySelectorAll('[data-tally-review]').forEach(b=>b.onclick=()=>openTallyCorrection(b.dataset.tallyReview));
 const readiness=document.createElement('section');readiness.className='card';readiness.id='godownReadiness';
 readiness.innerHTML=`<h2>All godowns · reconciliation checklist</h2><p>Checks passed means product details and physical-count review are complete, not that stock has been imported. Original negative balances remain visible. No quantities are added together across different products or units.</p><div class="table-wrap"><table><thead><tr><th>Godown</th><th>Source rows</th><th>Checks passed</th><th>Needs correction</th><th>Product not linked</th><th>Original negatives</th></tr></thead><tbody>${tallyReadiness.map(g=>`<tr><td>${esc(g.name||'Missing godown — needs correction')}</td><td>${g.total}</td><td>${g.checked}</td><td>${g.blocked}</td><td>${g.unmapped}</td><td>${g.negative}</td></tr>`).join('')}</tbody></table></div>`;
 $('#content').append(readiness);
 const locationHeading=document.createElement('th');locationHeading.textContent='Location check';readiness.querySelector('thead tr').append(locationHeading);
 const sourceGroups=tallyGodownReadiness(tallyRows,tallyRowReview);
 readiness.querySelectorAll('tbody tr').forEach((row,index)=>{row.dataset.sourceGodown=sourceGroups[index].name;const cell=document.createElement('td');cell.dataset.locationReady='false';row.append(cell);});
 refreshGodownLocationChecks();
 const locationNotice=document.createElement('p');locationNotice.textContent='Product checks alone do not authorize import. A saved active location mapping is also required. Operational import is not enabled here.';readiness.append(locationNotice);
 if(me.role==='owner'){
  const heading=document.createElement('th');heading.textContent='Location mapping';readiness.querySelector('thead tr').append(heading);
  readiness.querySelectorAll('tbody tr').forEach(row=>{const name=row.dataset.sourceGodown,cell=document.createElement('td'),button=document.createElement('button');button.type='button';button.textContent='Review location mapping';button.disabled=!name.trim();button.onclick=()=>openGodownMapping(name);cell.append(button);row.append(cell);});
 }
 const file=$('#tallyFile');if(file)file.onchange=()=>run(async()=>{
  const actor=me?.user_id,payload=JSON.parse(await file.files[0].text());
  if(!Array.isArray(payload.records))throw Error('Choose the prepared stock review JSON.');
  const rows=payload.records.filter(r=>r.record_kind==='item_balance');
  if(!confirm(`Stage ${rows.length} Tally source rows for review? This does not create saleable stock.`))return;
  file.disabled=true;
  for(let i=0;i<rows.length;i+=100){if(me?.user_id!==actor)throw Error('Login changed; import stopped.');const r=await client.rpc('import_tally_stock_review',{p_rows:rows.slice(i,i+100)});if(r.error)throw Error(`Import stopped at batch ${i+1}: ${r.error.message}. The same file can be retried without duplicating rows.`);const status=$('#tallyStatus');if(status)status.textContent=`Staged ${Math.min(i+100,rows.length)} of ${rows.length}`;}
  await tallyStockScreen();
 });
}
function openTallyCorrection(id){
 const row=tallyRows.find(r=>r.id===id);if(!row)return;const actor=me?.user_id,c=tallyCorrections.get(id),p=(x=>x&&typeof reviewedCatalogProduct==='function'?reviewedCatalogProduct(x):x)(products.find(p=>p.id===c?.product_id));
 const dialog=document.createElement('dialog');
 dialog.innerHTML=`<form><h2>Review stock row</h2><p>${esc(row.product_name)} · ${esc(row.godown)}</p><p>Original Tally balance: ${esc(row.quantity??'Unknown')} ${esc(row.unit||'Unknown unit')} · ${esc(row.source_file)}, row ${esc(row.source_row)}</p>${c?`<p><strong>Last saved review · version ${esc(c.version)}</strong><br>${esc(c.reason)}</p>`:''}<label>Match catalog product<input name="product" list="tallyProducts" value="${esc(p?inventoryProductChoice(p):'')}"></label><datalist id="tallyProducts">${inventoryProductChoices()}</datalist><label>Verified pieces (leave blank if unknown)<input name="pieces" type="number" min="0" max="9007199254740991" step="1" value="${esc(c?.pieces??'')}"></label><label>Batch, if applicable<input name="batch" value="${esc(c?.batch||'')}"></label><label>Expiry, if applicable<input name="expiry" type="date" value="${esc(c?.expiry||'')}"></label><label>Reason / evidence for correction<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><p>Verify pack-to-piece conversions before entering pieces. No saleable stock is posted by this form.</p><p role="alert"></p><div class="actions"><button type="button" data-close>Close</button>${me.role==='owner'?'<button type="submit">Save review</button>':''}</div></form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.showModal();
 dialog.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const button=dialog.querySelector('[type="submit"]');if(!button||button.disabled||me?.user_id!==actor)return;button.disabled=true;
  try{const f=new FormData(e.target),match=inventoryProductFromChoice(f.get('product')),quantity=f.get('pieces').trim();if(f.get('product')&&!match)throw Error('Select an exact catalog product from the search list.');if(quantity!==''&&(!Number.isSafeInteger(Number(quantity))||Number(quantity)<0))throw Error('Enter whole nonnegative pieces or leave blank.');
   const r=await client.rpc('save_tally_stock_correction',{p_id:crypto.randomUUID(),p_source_id:id,p_expected_version:c?.version||0,p_product_id:match?.id||null,p_pieces:quantity===''?null:Number(quantity),p_batch:f.get('batch'),p_expiry:f.get('expiry')||null,p_reason:f.get('reason').trim()});
   if(me?.user_id!==actor){dialog.close();return;}if(r.error)throw r.error;dialog.close();await tallyStockScreen();
  }catch(error){dialog.querySelector('[role="alert"]').textContent=`Not confirmed saved: ${error.message}. Reopen to check the latest version before retrying.`;}finally{button.disabled=false;}
 };
}
async function openGodownMapping(godown){
 if(me?.role!=='owner'||!godown?.trim())return;
 const actor=me.user_id,current=()=>me?.user_id===actor&&me?.role==='owner'&&inventorySection==='review';
 const dialog=document.createElement('dialog');dialog.innerHTML='<h2>Map source godown</h2><p role="status">Loading mapping…</p><button type="button">Close</button>';
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('button').onclick=()=>dialog.close();dialog.showModal();
 try{
  const [locations,history]=await Promise.all([all('inventory_locations','id,name,active'),all('godown_mapping_reviews','id,source_godown,version,location_id,reason')]);
  if(!current()||!dialog.isConnected){dialog.close();return;}
  const previous=history.filter(r=>r.source_godown===godown).sort((a,b)=>b.version-a.version)[0];
  const active=locations.filter(r=>r.active),validPrior=active.some(r=>r.id===previous?.location_id);
  dialog.innerHTML=`<form><h2>Map source godown</h2><p>${esc(godown)} · version ${previous?.version||0}</p><p>This saves a location mapping only. Stock quantities are unchanged.</p>${previous?.location_id&&!validPrior?'<p role="status">Previous location is inactive or missing. Choose a location or explicitly leave unresolved.</p>':''}<label>ERP location<select name="location"><option value="">Unresolved — do not import</option>${active.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label><label>Reason / evidence<textarea name="reason" required minlength="5" maxlength="1000"></textarea></label><p role="alert"></p><p role="status"></p><button type="button" data-close>Close</button><button type="submit">Save mapping only</button></form>`;
  const audit=document.createElement('section');audit.dataset.mappingHistory='';
  const auditHeading=document.createElement('h3');auditHeading.textContent='Saved mapping history';audit.append(auditHeading);
  const revisions=history.filter(r=>r.source_godown===godown).sort((a,b)=>b.version-a.version);
  for(const r of revisions){const item=document.createElement('p'),location=locations.find(l=>l.id===r.location_id);item.textContent=`Version ${r.version} · ${r.location_id?(location?location.name+(location.active?'':' (inactive)'):'Location unavailable'):'Unresolved — do not import'} · ${r.reason}`;audit.append(item);}
  if(!revisions.length){const empty=document.createElement('p');empty.textContent='No saved mapping yet.';audit.append(empty);}
  dialog.append(audit);
  dialog.querySelector('[name="location"]').value=validPrior?previous.location_id:'';
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();let request=null;
  dialog.querySelector('form').onsubmit=async e=>{
   e.preventDefault();if(!current()){dialog.close();return;}
   const button=dialog.querySelector('[type="submit"]');if(button.disabled)return;
   const f=new FormData(e.target),location=f.get('location')||null,reason=f.get('reason').trim(),alert=dialog.querySelector('[role="alert"]');
   if(reason.length<5){alert.textContent='Enter the evidence for this mapping.';return;}
   if(request&&(request.p_location_id!==location||request.p_reason!==reason)){alert.textContent='Previous save is unconfirmed. Retry unchanged or close and reopen to check the latest saved mapping.';return;}
   request??={p_id:crypto.randomUUID(),p_godown:godown,p_expected_version:previous?.version||0,p_location_id:location,p_reason:reason};button.disabled=true;
   tallyLocations=locations;
   tallyLocationReviews=[...(tallyLocationReviews||[]).filter(item=>item.id!==request.p_id),{id:request.p_id,source_godown:godown,version:request.p_expected_version+1,unconfirmed:true}];
   refreshGodownLocationChecks();
   try{const r=await client.rpc('save_godown_mapping_review',request);if(!current()||!dialog.isConnected){dialog.close();return;}if(r.error)throw r.error;
    const saved=Array.isArray(r.data)?r.data[0]:r.data;if(saved?.id!==request.p_id||saved?.version!==request.p_expected_version+1)throw Error('Saved mapping could not be verified');
    tallyLocations=locations;
    tallyLocationReviews=[...(tallyLocationReviews||[]).filter(item=>item.id!==saved.id),{...saved,source_godown:godown,location_id:request.p_location_id}];
    refreshGodownLocationChecks();
    alert.textContent='';dialog.querySelector('[role="status"]').textContent='Mapping saved. Stock quantities unchanged.';
    dialog.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);
   }catch(error){if(current()&&dialog.isConnected){alert.textContent=`Not confirmed saved: ${error.message}`;button.disabled=false;}}
  };
 }catch(error){if(current()&&dialog.isConnected)dialog.querySelector('[role="status"]').textContent=`Mapping could not load: ${error.message}. No changes saved.`;else dialog.close();}
}
