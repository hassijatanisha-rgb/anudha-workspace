'use strict';
let tallyRows=[],tallyCorrections=new Map(),tallySearch='',tallyPage=0;
async function tallyStockScreen(){
 const actor=me?.user_id;
 $('#content').innerHTML='<p role="status">Loading Tally stock review…</p>';
 try{
  const [rows,corrections]=await Promise.all([all('tally_stock_sources','id,source_file,source_row,godown,product_name,quantity,unit,balance_date,imported_at'),all('tally_stock_corrections','*')]);
  if(me?.user_id!==actor||inventorySection!=='review')return;
  tallyRows=rows;tallyCorrections=new Map();for(const r of corrections)if((tallyCorrections.get(r.source_id)?.version||0)<r.version)tallyCorrections.set(r.source_id,r);
  renderTallyStock();
 }catch(error){if(me?.user_id===actor&&inventorySection==='review'){$('#content').innerHTML=inventoryHeader()+`<p role="alert">Stock review could not load: ${esc(error.message)}. No stock was changed.</p>`;bindInventoryWorkspace();}}
}
function tallyRowReview(row){
 const correction=tallyCorrections.get(row.id),product=products.find(p=>p.id===correction?.product_id);
 const details=product?productReviewDefaults(reviewedCatalogProduct(product)):{name:row.product_name};
 const result=productStockReview(details,{quantity:correction?.pieces??row.quantity,unit:correction?.pieces!=null?'PCS':row.unit,verified:correction?.pieces!=null,batch:correction?.batch,expiry:correction?.expiry});
 if(!product)result.issues.unshift('Choose the matching catalog product');
 return {correction,product,result};
}
function renderTallyStock(){
 const rows=tallyRows.filter(r=>[r.product_name,r.godown,r.unit].join(' ').toLowerCase().includes(tallySearch.toLowerCase()));
 const pages=Math.max(1,Math.ceil(rows.length/50));tallyPage=Math.min(tallyPage,pages-1);
 const negative=tallyRows.filter(r=>r.quantity<0).length,reviewed=tallyRows.filter(r=>tallyCorrections.has(r.id)).length,godowns=new Set(tallyRows.map(r=>r.godown)).size;
 $('#content').innerHTML=inventoryHeader()+`<section class="cleanup-hero"><div><small>INVENTORY · TALLY DATA</small><h1>Tally stock cleanup</h1><p>Match source rows to products and record verified pieces while preserving every original balance. Corrections do not post operational stock.</p></div></section><div class="cleanup-metrics"><div><small>Source rows</small><strong>${tallyRows.length}</strong></div><div><small>Reviewed</small><strong>${reviewed}</strong></div><div><small>Negative balances</small><strong>${negative}</strong></div><div><small>Godowns</small><strong>${godowns}</strong></div></div><section class="card cleanup-table"><div class="cleanup-search">${me.role==='owner'?'<label><span>Load prepared private stock file</span><input id="tallyFile" type="file" accept=".json,application/json"></label>':''}<label><span>Search product or godown</span><input type="search" id="tallySearch" placeholder="Search Tally rows"></label></div><div class="table-wrap"><table><thead><tr><th>Product / godown</th><th>Tally balance</th><th>Review</th><th>Corrected pieces</th><th>Action</th></tr></thead><tbody>${rows.slice(tallyPage*50,tallyPage*50+50).map(r=>{const {correction,result}=tallyRowReview(r);return `<tr><td><strong>${esc(r.product_name)}</strong><small>${esc(r.godown)} · ${esc(r.balance_date)}</small></td><td>${esc(r.quantity??'Unknown')} ${esc(r.unit||'Unit missing')}${r.quantity<0?'<span class="cleanup-pill danger">Negative</span>':''}</td><td>${result.issues.map(esc).join('; ')||'<span class="cleanup-pill success">Reviewed</span>'}</td><td>${esc(correction?.pieces??'Not verified')}</td><td><button data-tally-review="${esc(r.id)}">Review / correct</button></td></tr>`}).join('')}</tbody></table></div><div class="actions cleanup-pagination"><button id="tallyPrev" ${tallyPage===0?'disabled':''}>Previous</button><span>Page ${tallyPage+1} of ${pages}</span><button id="tallyNext" ${tallyPage+1>=pages?'disabled':''}>Next</button></div><p id="tallyStatus" role="status"></p></section>`;
 bindInventoryWorkspace();$('#tallySearch').value=tallySearch;$('#tallySearch').oninput=e=>{tallySearch=e.target.value;tallyPage=0;renderSearchPreservingPosition(e.target,renderTallyStock);};
 $('#tallyPrev').onclick=()=>{tallyPage--;renderTallyStock()};$('#tallyNext').onclick=()=>{tallyPage++;renderTallyStock()};
 document.querySelectorAll('[data-tally-review]').forEach(b=>b.onclick=()=>openTallyCorrection(b.dataset.tallyReview));
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
 const row=tallyRows.find(r=>r.id===id);if(!row)return;const actor=me?.user_id,c=tallyCorrections.get(id),p=products.find(p=>p.id===c?.product_id);
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
