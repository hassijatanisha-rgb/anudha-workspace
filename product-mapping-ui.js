'use strict';
function openProductMappingPreview(){
 if(!canEditRecords())throw Error(recordsLockedText);
 const actor=me.user_id,dialog=document.createElement('dialog');dialog.className='product-review-editor';
 let report=null,page=0,generation=0;
 dialog.innerHTML='<h2>Preview corrected stock mapping</h2><p>Export ERP mapping JSON from the existing product workbench, then choose it here. Previewing does not save anything. You can explicitly review and save individual identity decisions. Stock is not imported or changed.</p><label>Corrected mapping JSON<input type="file" accept=".json,application/json"></label><p role="status" data-mapping-status></p><div data-mapping-results></div><button type="button" data-mapping-close>Close preview</button>';
 const status=dialog.querySelector('[data-mapping-status]'),results=dialog.querySelector('[data-mapping-results]');
 const sameActor=()=>me?.user_id===actor&&canEditRecords();
 function render(){
  if(!sameActor()){report=null;results.innerHTML='';status.textContent='Login changed. Close and reopen this preview.';return;}
  const pages=Math.max(1,Math.ceil(report.rows.length/50));page=Math.max(0,Math.min(page,pages-1));
  results.innerHTML=`<p>${report.rows.length} source records · ${report.counts.exact} exact identity proposals · ${report.counts.ambiguous+report.counts.needs_review} requiring review · ${report.counts.unmatched} unmatched. No automatic merges.</p><div class="table-wrap"><table><thead><tr><th>Source record</th><th>Corrected identity</th><th>Source stock</th><th>Mapping proposal</th></tr></thead><tbody>${report.rows.slice(page*50,page*50+50).map((row,index)=>`<tr><td>${esc(row.sourceKey)}<small>Original: ${esc(row.original.name||'Not supplied')}</small><small>${esc(row.original.source||'Source not supplied')}</small></td><td>${esc(row.corrected.name)}<small>${esc(row.corrected.manufacturer||'Manufacturer needs review')} · ${esc(row.corrected.model||'Specification needs review')}</small></td><td>${esc(row.corrected.totalStock??'Unknown')} ${esc(row.corrected.units||'Unit missing')}<small>${esc(row.corrected.locations||'Godown missing')}</small>${row.issues.map(issue=>`<small>${esc(issue)}</small>`).join('')}</td><td>${esc(row.match.status)}<small>${row.match.productIds.map(esc).join(', ')}</small><button type="button" data-map-decision="${page*50+index}">${row.savedMapping?`Saved: ${esc(row.savedMapping.decision)} · v${row.savedMapping.version} — review`:'Review / save decision'}</button><details><summary>Review reasons</summary>${row.match.reasons.map(reason=>`<p>${esc(reason)}</p>`).join('')||'<p>Identity matches; source quantities still require approval.</p>'}</details></td></tr>`).join('')}</tbody></table></div><div class="actions"><button type="button" data-map-prev ${page===0?'disabled':''}>Previous</button><span>Page ${page+1} of ${pages}</span><button type="button" data-map-next ${page+1>=pages?'disabled':''}>Next</button><button type="button" data-map-export>Download review report</button></div>`;
  results.querySelector('[data-map-prev]').onclick=()=>{page--;render()};results.querySelector('[data-map-next]').onclick=()=>{page++;render()};
  results.querySelectorAll('[data-map-decision]').forEach(button=>button.onclick=async()=>{
   if(!sameActor()){render();return;}
   const row=report.rows[Number(button.dataset.mapDecision)];button.disabled=true;
   try{await openProductMappingDecision(row,saved=>{
    if(!sameActor()||!dialog.isConnected||!report?.rows.includes(row))return;
    row.savedMapping={version:saved.version,decision:saved.decision,product_id:saved.product_id};render();status.textContent='Mapping decision saved. No stock was imported.';
   },()=>sameActor()&&dialog.isConnected&&Boolean(report?.rows.includes(row)));}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  results.querySelector('[data-map-export]').onclick=()=>{
   if(!sameActor()){render();return;}
   const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');
   link.href=url;link.download='Anudha_product_mapping_review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
 }
 dialog.querySelector('input').onchange=async event=>{
  const current=++generation;report=null;results.innerHTML='';status.textContent='';
  if(!sameActor()){status.textContent='Login changed. Close and reopen this preview.';return;}
  const file=event.target.files[0];if(!file)return;
  try{
   if(file.size>20*1024*1024)throw Error('Choose a file smaller than 20 MB.');
   if(typeof productReviewLoadError!=='undefined'&&productReviewLoadError)throw Error('Refresh product corrections before comparing records.');
   const text=await file.text();if(current!==generation||!dialog.isConnected)return;
   if(!sameActor())throw Error('Login changed. Close and reopen this preview.');
   report=buildProductMappingPreview(JSON.parse(text),catalogRows());page=0;render();status.textContent='Comparison complete. Nothing has been imported.';
  }catch(error){if(current!==generation)return;report=null;results.innerHTML='';status.textContent=error.message;}
 };
 dialog.querySelector('[data-mapping-close]').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{generation++;report=null;dialog.remove()});document.body.append(dialog);dialog.showModal();
}
document.addEventListener('click',event=>{if(event.target.closest('[data-product-mapping-preview]'))run(openProductMappingPreview)});
