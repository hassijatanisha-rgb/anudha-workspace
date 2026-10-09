'use strict';
// Temporary physical stock count. Staff count what is on the shelf per godown against the consolidated product list;
// the owner reviews. Counts never change stock here: accepted counts are exported for the opening-stock import.
// Turn the screen off once stock is complete with ERP_CONFIG.stockCountEnabled=false.
const countGodowns=['Haadi','Main store','City Printer Godown','City Printer Godown 2','City Printer Godown 04','Keko Manga A','New Dakawa','New Dakawa Godown A','RK Chudasama No.7','RK Chudasama No.8','Other location'];
const countUnits=['PCS','BOX','PKT','DOZ','SET','KIT','BOTTLE','ROLL','PAIR','BAG','GALLON','SHEET','CARTON','LITRE','KG','TUBE'];
const countConditions={good:'Good',damaged:'Damaged',expired:'Expired',quarantine:'Set aside / check'};
const countStatuses={recorded:'Waiting for review',accepted:'Accepted',rejected:'Rejected',void:'Voided'};
let countTab='count',countSearch='',countGodown='',countPicked='',countReviewFilter='recorded',countReviewGodown='',countPage=0;
let countLoaded=false,countLoadError='',countEpoch=0,countCatalogue=[],countSessions=[],countEntries=[],countPendingSave=null;
function stockCountEnabled(){return window.ERP_CONFIG?.stockCountEnabled!==false;}
function clearStockCount(){countEpoch++;countLoaded=false;countCatalogue=[];countSessions=[];countEntries=[];countPicked='';countPendingSave=null;countSearch='';}
function openStockCountSection(section){countTab=section==='review'?'review':'count';countPage=0;countPicked='';}
function countOpenSession(){return countSessions.find(s=>s.status==='open')||null;}
function countCurrentSession(){return countOpenSession()||[...countSessions].sort((a,b)=>String(b.opened_at).localeCompare(String(a.opened_at)))[0]||null;}
function countItem(code){return countCatalogue.find(item=>item.code===code);}
function countLabel(entry){const item=entry.code?countItem(entry.code):null;return item?[item.product,item.company,item.specification].filter(Boolean).join(' · '):entry.unlisted||'Unknown product';}
function countRememberedGodown(){try{return localStorage.getItem('anudha-count-godown')||'';}catch{return '';}}
function countRememberGodown(value){try{localStorage.setItem('anudha-count-godown',value);}catch{}}
// Every word typed must appear somewhere; exact code first, then names that start with the search, then shorter names.
function countMatches(items,search,limit=25){
 const q=String(search||'').trim().toLowerCase(),words=q.split(/\s+/).filter(Boolean);if(!words.length)return [];
 const scored=[];
 for(const item of items){
  const hay=`${item.code} ${item.product} ${item.company} ${item.specification} ${item.search_text}`.toLowerCase();
  if(!words.every(word=>hay.includes(word)))continue;
  const product=String(item.product).toLowerCase();
  scored.push([item.code.toLowerCase()===q?0:product.startsWith(q)?1:product.includes(q)?2:3,product.length,item]);
 }
 return scored.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2].code.localeCompare(b[2].code)).slice(0,limit).map(row=>row[2]);
}
function countEntriesFor({session,godown='',status='',mineOnly=false}){
 return countEntries.filter(entry=>entry.session_id===session?.id&&(!godown||entry.godown===godown)&&(!status||entry.status===status)&&(!mineOnly||entry.counted_by===me?.user_id))
  .sort((a,b)=>String(b.counted_at).localeCompare(String(a.counted_at))||a.id.localeCompare(b.id));
}
// Accepted totals per product, godown, unit and condition. Units are never added together.
function countAcceptedTotals(entries){
 const totals=new Map();
 for(const entry of entries.filter(e=>e.status==='accepted')){
  const key=[entry.code||'unlisted:'+entry.unlisted,entry.godown,entry.unit,entry.condition,entry.batch,entry.expiry||''].join('|');
  const row=totals.get(key)||{code:entry.code||'',unlisted:entry.unlisted||'',godown:entry.godown,unit:entry.unit,condition:entry.condition,batch:entry.batch||'',expiry:entry.expiry||'',quantity:0,counts:0};
  row.quantity+=Number(entry.quantity);row.counts++;totals.set(key,row);
 }
 return [...totals.values()].sort((a,b)=>a.godown.localeCompare(b.godown)||(a.code||a.unlisted).localeCompare(b.code||b.unlisted));
}
function countCsv(rows){
 const cell=value=>{const text=String(value??'');return /^[=+\-@\t\r]/.test(text)?`"'${text.replace(/"/g,'""')}"`:/[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
 const header=['Code','Product','Company','Specification','Category','Not on list','Godown','Quantity','Unit','Condition','Batch','Expiry','Number of counts'];
 return [header,...rows.map(row=>{const item=row.code?countItem(row.code):null;return [row.code,item?.product||'',item?.company||'',item?.specification||'',item?.category||'',row.unlisted,row.godown,row.quantity,row.unit,countConditions[row.condition]||row.condition,row.batch,row.expiry,row.counts];})].map(r=>r.map(cell).join(',')).join('\r\n');
}
// Owner-only: load the consolidated product list file (anudha-count-catalogue-v1 JSON) in batches of 500.
function countCatalogueRows(text){
 let data;try{data=JSON.parse(text);}catch{throw Error('This is not the product list file.');}
 if(data?.format!=='anudha-count-catalogue-v1'||!Array.isArray(data.rows)||!data.rows.length)throw Error('This is not the product list file.');
 const categories=['Machine','Furniture','Spare','Consumable','Reagent','Not sure'],seen=new Set();
 return data.rows.map((row,index)=>{
  const out={code:String(row.code||''),product:String(row.product||'').trim(),company:String(row.company||'').trim(),specification:String(row.specification||'').trim(),category:String(row.category||''),search_text:String(row.search_text||'').slice(0,4000),erp_product_ids:Array.isArray(row.erp_product_ids)?row.erp_product_ids.map(String):[],company_note:String(row.company_note||'').trim().slice(0,500),suggested_company:String(row.suggested_company||'').trim().slice(0,200)};
  if(!/^AN-\d{5}$/.test(out.code)||seen.has(out.code))throw Error(`Row ${index+1}: missing or repeated AN code.`);seen.add(out.code);
  if(!out.product)throw Error(`Row ${index+1} (${out.code}): product name is empty.`);
  if(!categories.includes(out.category))throw Error(`Row ${index+1} (${out.code}): unknown category.`);
  return out;
 });
}
async function loadCountCatalogueFile(file){
 if(me?.role!=='owner')throw Error('Only the owner can load the product list.');
 // The same file also updates the ERP products, so the count and the product list stay one list.
 const total=await applyProductListFile(file);
 countCatalogue=[];await stockCountWorkspace(true);message(productListSummary(total));
}
async function loadStockCount(){
 const epoch=++countEpoch,actor=me?.user_id;
 const [catalogue,sessions,entries]=await Promise.all([countCatalogue.length?Promise.resolve(countCatalogue):all('count_catalogue','code,product,company,specification,category,search_text'),all('stock_count_sessions','*'),all('stock_count_entries','*')]);
 if(epoch!==countEpoch||me?.user_id!==actor)return false;
 countCatalogue=catalogue;countSessions=sessions;countEntries=entries;countLoaded=true;countLoadError='';return true;
}
async function stockCountWorkspace(force=false){
 const actor=me?.user_id;syncWorkspaceNavigation();
 if(!stockCountEnabled()){$('#content').innerHTML='<section class="card"><h1>Stock count is switched off</h1><p class="muted">The physical count is finished. Stock is managed in Inventory.</p></section>';return;}
 if(!countGodown)countGodown=countRememberedGodown();
 if(force||!countLoaded){
  $('#content').innerHTML='<p role="status">Loading the product list and counts…</p>';
  try{if(!(await loadStockCount()))return;}catch(error){if(me?.user_id!==actor)return;countLoadError=error.message;countLoaded=false;}
 }
 if(view!=='stockcount'||me?.user_id!==actor)return;
 renderStockCount();
}
function countPickedForm(item){
 const unlisted=item==='unlisted';
 return `<form id="countForm" class="card count-form"><div class="heading"><div><small>${unlisted?'NOT ON THE LIST':esc(item.code)}</small><h2>${unlisted?'Describe the product':esc(item.product)}</h2>${unlisted?'':`<p class="muted">${esc([item.company||'Company not known',item.specification||'Specification not known',item.category].join(' · '))}</p>`}</div><button type="button" id="countCancel">Close</button></div><div class="grid">${unlisted?'<label class="wide"><span>What is it? Name, company, model or size as written on the item</span><input name="unlisted" required minlength="3" maxlength="300"></label>':''}<label><span>Quantity counted</span><input name="quantity" type="number" min="0" max="10000000" step="any" required inputmode="decimal"></label><label><span>Unit</span><select name="unit">${countUnits.map(u=>`<option>${u}</option>`).join('')}</select></label><label><span>Condition</span><select name="condition">${Object.entries(countConditions).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label><span>Batch / lot · if printed</span><input name="batch" maxlength="80"></label><label><span>Expiry · if printed</span><input name="expiry" type="date" min="2000-01-01"></label><label class="wide"><span>Notes · optional</span><input name="notes" maxlength="1000"></label></div><p role="alert" id="countFormError"></p><div class="actions"><button type="submit" id="countSave">Save count</button></div></form>`;
}
function countEntryRow(entry,{review=false}={}){
 const own=entry.counted_by===me?.user_id,owner=me?.role==='owner',buttons=[];
 if(entry.status==='recorded'&&review&&owner)buttons.push(`<button type="button" data-count-action="accept" data-id="${esc(entry.id)}">Accept</button>`,`<button type="button" data-count-action="reject" data-id="${esc(entry.id)}">Reject</button>`);
 if(entry.status==='recorded'&&(own||owner))buttons.push(`<button type="button" data-count-action="void" data-id="${esc(entry.id)}">Void</button>`);
 return `<tr data-count-entry="${esc(entry.id)}"><td>${entry.code?`<small>${esc(entry.code)}</small> `:'<small>Not on list</small> '}${esc(countLabel(entry))}${entry.notes?`<small>${esc(entry.notes)}</small>`:''}</td>${review?`<td>${esc(entry.godown)}</td>`:''}<td><strong>${esc(Number(entry.quantity))}</strong> ${esc(entry.unit)}</td><td>${esc(countConditions[entry.condition]||entry.condition)}${entry.batch?`<small>Batch ${esc(entry.batch)}</small>`:''}${entry.expiry?`<small>Exp ${esc(entry.expiry)}</small>`:''}</td><td>${esc(employeeName(entry.counted_by))}<small>${esc(new Date(entry.counted_at).toLocaleString())}</small></td><td><span class="tag">${esc(countStatuses[entry.status])}</span>${entry.status_note?`<small>${esc(entry.status_note)}</small>`:''}</td><td class="actions">${buttons.join('')}</td></tr>`;
}
function renderStockCount(){
 const owner=me?.role==='owner',session=countCurrentSession(),open=countOpenSession();
 const tabs=`<div class="tabs" role="group" aria-label="Stock count sections">${[['count','Count a godown'],['review',owner?'Review counts':'All counts']].map(([key,label])=>`<button type="button" data-count-tab="${key}" class="${countTab===key?'active':''}" aria-pressed="${countTab===key}">${label}</button>`).join('')}</div>`;
 const loader=owner?`<details class="card count-loader"${countCatalogue.length?'':' open'}><summary>${countCatalogue.length?`Product list: ${countCatalogue.length} products · load a newer file`:'Load the product list'}</summary><p class="muted">Choose the product list file (.json) prepared from the Tally and CRM data. It also updates the ERP product list. Loading again updates products with the same AN code and keeps corrections staff have made; it never touches stock.</p><label><span>Product list file</span><input type="file" id="countCatalogueFile" accept=".json,application/json"></label></details>`:'';
 const sessionBar=`<div class="help-strip">${open?`<strong>Count running: ${esc(open.name)}</strong><span>Started ${esc(new Date(open.opened_at).toLocaleDateString())} by ${esc(employeeName(open.opened_by))}</span>`:`<strong>No count is running.</strong><span>${owner?'Start one to let staff record counts.':'Ask the owner to start the count.'}</span>`}${owner?(open?'<button type="button" id="countClose">Close this count</button>':'<button type="button" id="countOpen">Start a count</button>'):''}</div>`;
 let body='';
 if(!countCatalogue.length&&!countLoadError)body=`<p class="notice">The product list has not been loaded yet.${owner?' Load it above before starting the count.':' The owner loads it once before counting starts.'}</p>`;
 else if(countTab==='count')body=renderCountTab(open);
 else body=renderCountReview(session);
 $('#content').innerHTML=`<section class="stock-count-workspace"><div class="heading"><div><small>INVENTORY · TEMPORARY</small><h1>Stock count</h1><p class="muted">Count what is physically on the shelf, godown by godown. Counts do not change stock; the owner reviews them and accepted counts become the opening stock.</p></div><div class="actions"><button type="button" id="countRefresh">Refresh</button></div></div>${countLoadError?`<p class="notice error" role="alert">Stock count could not load: ${esc(countLoadError)}. Nothing was changed.</p>`:''}${loader}${sessionBar}${tabs}${body}</section>`;
 bindStockCount();
}
function renderCountTab(open){
 if(!open)return '<p class="muted">Counting opens when the owner starts a count.</p>';
 const godownSelect=`<label><span>Godown you are counting</span><select id="countGodown"><option value="">Choose godown</option>${countGodowns.map(g=>`<option ${g===countGodown?'selected':''}>${esc(g)}</option>`).join('')}</select></label>`;
 if(!countGodown)return `<div class="grid">${godownSelect}</div>`;
 const picked=countPicked==='unlisted'?'unlisted':countPicked?countItem(countPicked):null;
 const matches=picked?[]:countMatches(countCatalogue,countSearch);
 const mine=countEntriesFor({session:open,godown:countGodown});
 return `<div class="grid">${godownSelect}</div>${picked?countPickedForm(picked):`<label class="search"><span>Find the product</span><input id="countSearch" type="search" autocomplete="off" placeholder="Name, company, model, size or AN code" value="${esc(countSearch)}"></label>${countSearch.trim()?`<div class="count-results">${matches.map(item=>`<button type="button" class="count-result" data-count-pick="${esc(item.code)}"><strong>${esc(item.product)}</strong><span>${esc([item.company,item.specification].filter(Boolean).join(' · ')||'Company and specification not known')}</span><small>${esc(item.code)} · ${esc(item.category)}</small></button>`).join('')||'<p class="muted">No product matches. Try fewer words, or record it as not on the list.</p>'}</div>`:'<p class="muted">Type part of the name, the company, a model number or the AN code.</p>'}<div class="actions"><button type="button" id="countUnlisted">Product is not on the list</button></div>`}<h2>Counted in ${esc(countGodown)} · ${mine.length}</h2>${mine.length?`<div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Condition</th><th>Counted by</th><th>Status</th><th></th></tr></thead><tbody>${mine.slice(0,100).map(e=>countEntryRow(e)).join('')}</tbody></table></div>${mine.length>100?'<p class="muted">Showing the latest 100. See all counts for the rest.</p>':''}`:'<p class="muted">Nothing counted here yet.</p>'}`;
}
function renderCountReview(session){
 if(!session)return '<p class="muted">No counts yet.</p>';
 const rows=countEntriesFor({session,godown:countReviewGodown,status:countReviewFilter==='all'?'':countReviewFilter});
 const pages=Math.max(1,Math.ceil(rows.length/50));countPage=Math.min(Math.max(countPage,0),pages-1);
 const all=countEntriesFor({session}),byStatus=s=>all.filter(e=>e.status===s).length,accepted=countAcceptedTotals(all);
 const godownProgress=countGodowns.map(g=>[g,all.filter(e=>e.godown===g&&e.status!=='void'&&e.status!=='rejected').length]).filter(([,n])=>n);
 return `<p class="muted">${esc(session.name)} · ${byStatus('recorded')} waiting · ${byStatus('accepted')} accepted · ${byStatus('rejected')} rejected · ${byStatus('void')} voided</p>${godownProgress.length?`<p class="muted">${godownProgress.map(([g,n])=>`${esc(g)}: ${n}`).join(' · ')}</p>`:''}<div class="grid"><label><span>Status</span><select id="countReviewFilter">${[['recorded','Waiting for review'],['accepted','Accepted'],['rejected','Rejected'],['void','Voided'],['all','All']].map(([k,v])=>`<option value="${k}" ${countReviewFilter===k?'selected':''}>${v}</option>`).join('')}</select></label><label><span>Godown</span><select id="countReviewGodown"><option value="">All godowns</option>${countGodowns.map(g=>`<option ${g===countReviewGodown?'selected':''}>${esc(g)}</option>`).join('')}</select></label></div>${me?.role==='owner'?`<div class="actions"><button type="button" id="countExport" ${accepted.length?'':'disabled'}>Download accepted counts (${accepted.length} line${accepted.length===1?"":"s"})</button></div>`:''}<p class="muted">${rows.length} matching</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Product</th><th>Godown</th><th>Qty</th><th>Condition</th><th>Counted by</th><th>Status</th><th></th></tr></thead><tbody>${rows.slice(countPage*50,countPage*50+50).map(e=>countEntryRow(e,{review:true})).join('')}</tbody></table></div>`:'<p class="muted">No counts here.</p>'}<div class="actions"><button type="button" id="countPrev" ${countPage===0?'disabled':''}>Previous</button><span>Page ${countPage+1} of ${pages}</span><button type="button" id="countNext" ${countPage>=pages-1?'disabled':''}>Next</button></div>`;
}
function countFormValues(form){
 const f=new FormData(form),quantity=Number(f.get('quantity'));
 if(f.get('quantity')===''||!Number.isFinite(quantity)||quantity<0||quantity>10000000)throw Error('Enter the quantity counted (0 or more).');
 if(Math.round(quantity*1000)!==quantity*1000)throw Error('Use at most three decimal places.');
 const unlisted=String(f.get('unlisted')||'').trim();
 if(countPicked==='unlisted'&&unlisted.length<3)throw Error('Describe the product so it can be matched later.');
 return {code:countPicked==='unlisted'?'':countPicked,unlisted:countPicked==='unlisted'?unlisted:'',quantity,unit:f.get('unit'),condition:f.get('condition'),batch:String(f.get('batch')||'').trim(),expiry:f.get('expiry')||null,notes:String(f.get('notes')||'').trim()};
}
async function saveCountForm(form){
 const open=countOpenSession();if(!open)throw Error('No count is running.');
 const values=countFormValues(form),key=JSON.stringify([open.id,countGodown,values]);
 // Same id for an unchanged retry, so a lost response cannot record the same count twice.
 if(countPendingSave?.key!==key)countPendingSave={key,id:crypto.randomUUID()};
 const actor=me?.user_id,result=await client.rpc('record_stock_count',{p_id:countPendingSave.id,p_session_id:open.id,p_godown:countGodown,p_code:values.code,p_unlisted:values.unlisted,p_quantity:values.quantity,p_unit:values.unit,p_batch:values.batch,p_expiry:values.expiry,p_condition:values.condition,p_notes:values.notes});
 if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
 if(result.error)throw Error(result.error.message);
 const saved=Array.isArray(result.data)?result.data[0]:result.data;
 if(saved?.id!==countPendingSave.id)throw Error('The server did not confirm the count. Press save again to retry safely.');
 countPendingSave=null;countEntries=[saved,...countEntries.filter(e=>e.id!==saved.id)];countPicked='';countSearch='';renderStockCount();
 message(`Counted ${Number(saved.quantity)} ${saved.unit} of ${countLabel(saved)} in ${saved.godown}.`);$('#countSearch')?.focus();
}
function openCountAction(entry,action){
 if(!entry)return;
 const titles={accept:'Accept count',reject:'Reject count',void:'Void count'};
 actionForm(titles[action],`<p><strong>${esc(countLabel(entry))}</strong> · ${esc(Number(entry.quantity))} ${esc(entry.unit)} · ${esc(entry.godown)}</p><label><span>${action==='accept'?'Note · optional':action==='void'?'Why is this count wrong?':'Why is it rejected? The godown should be recounted.'}</span><textarea name="note" maxlength="1000" ${action==='accept'?'':'required minlength="3"'}></textarea></label>`,async values=>{
  const actor=me?.user_id,result=await client.rpc('review_stock_count',{p_id:entry.id,p_expected_version:entry.version,p_action:action,p_note:values.note||''});
  if(me?.user_id!==actor)throw Error('Login changed. Reopen the count.');
  if(result.error)throw Error(result.error.message);
  const saved=Array.isArray(result.data)?result.data[0]:result.data;if(saved?.id)countEntries=countEntries.map(e=>e.id===saved.id?saved:e);
  renderStockCount();message(`${titles[action]} saved.`);
 });
}
function bindStockCount(){
 $('#countRefresh').onclick=()=>run(()=>stockCountWorkspace(true));
 const catalogueFile=$('#countCatalogueFile');if(catalogueFile)catalogueFile.onchange=()=>{const file=catalogueFile.files[0];if(file)run(()=>loadCountCatalogueFile(file));};
 document.querySelectorAll('[data-count-tab]').forEach(button=>button.onclick=()=>{openStockCountSection(button.dataset.countTab);renderStockCount();});
 $('#countOpen')?.addEventListener('click',()=>actionForm('Start a count','<label><span>Name for this count</span><input name="name" required minlength="3" maxlength="120" value="Full stock count '+new Date().toISOString().slice(0,10)+'"></label><p class="muted">Staff can record counts until you close it.</p>',async values=>{
  const actor=me?.user_id,result=await client.rpc('open_stock_count',{p_id:crypto.randomUUID(),p_name:values.name});
  if(me?.user_id!==actor)throw Error('Login changed.');if(result.error)throw Error(result.error.message);await stockCountWorkspace(true);message('Count started.');}));
 $('#countClose')?.addEventListener('click',()=>{const open=countOpenSession();if(!open)return;actionForm('Close this count',`<p>Closing stops new counts for <strong>${esc(open.name)}</strong>. You can still review what was counted.</p>`,async()=>{
  const actor=me?.user_id,result=await client.rpc('close_stock_count',{p_id:open.id,p_expected_version:open.version});
  if(me?.user_id!==actor)throw Error('Login changed.');if(result.error)throw Error(result.error.message);await stockCountWorkspace(true);message('Count closed.');});});
 const godown=$('#countGodown');if(godown)godown.onchange=()=>{countGodown=godown.value;countRememberGodown(countGodown);countPicked='';renderStockCount();};
 const search=$('#countSearch');if(search)search.oninput=event=>{countSearch=event.target.value;renderSearchPreservingPosition(event.target,renderStockCount,150);};
 document.querySelectorAll('[data-count-pick]').forEach(button=>button.onclick=()=>{countPicked=button.dataset.countPick;countPendingSave=null;renderStockCount();$('#countForm [name="quantity"]')?.focus();});
 $('#countUnlisted')?.addEventListener('click',()=>{countPicked='unlisted';countPendingSave=null;renderStockCount();$('#countForm [name="unlisted"]')?.focus();});
 $('#countCancel')?.addEventListener('click',()=>{countPicked='';countPendingSave=null;renderStockCount();$('#countSearch')?.focus();});
 const form=$('#countForm');
 if(form)form.onsubmit=event=>{event.preventDefault();const button=$('#countSave');if(button.disabled)return;button.disabled=true;$('#countFormError').textContent='';
  run(async()=>{try{await saveCountForm(form)}catch(error){if($('#countFormError'))$('#countFormError').textContent=error.message;throw error;}finally{if(button.isConnected)button.disabled=false;}});};
 const filter=$('#countReviewFilter');if(filter)filter.onchange=()=>{countReviewFilter=filter.value;countPage=0;renderStockCount();};
 const reviewGodown=$('#countReviewGodown');if(reviewGodown)reviewGodown.onchange=()=>{countReviewGodown=reviewGodown.value;countPage=0;renderStockCount();};
 $('#countPrev')?.addEventListener('click',()=>{countPage--;renderStockCount();});$('#countNext')?.addEventListener('click',()=>{countPage++;renderStockCount();});
 document.querySelectorAll('[data-count-action]').forEach(button=>button.onclick=()=>openCountAction(countEntries.find(e=>e.id===button.dataset.id),button.dataset.countAction));
 $('#countExport')?.addEventListener('click',()=>{
  const session=countCurrentSession(),csv=countCsv(countAcceptedTotals(countEntriesFor({session})));
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));link.download=`accepted-stock-count-${new Date().toISOString().slice(0,10)}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
 });
}
