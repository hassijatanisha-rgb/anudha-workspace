'use strict';
// Temporary physical stock count. Staff count what is on the shelf per godown against the consolidated product list;
// the owner reviews. Counts never change stock here: accepted counts are exported for the opening-stock import.
// Turn the screen off once stock is complete with ERP_CONFIG.stockCountEnabled=false.
const countGodowns=['Haadi','Main store','City Printer Godown','City Printer Godown 2','City Printer Godown 04','Keko Manga A','New Dakawa','New Dakawa Godown A','RK Chudasama No.7','RK Chudasama No.8','Other location'];
const countUnits=['PCS','BOX','PKT','DOZ','SET','KIT','BOTTLE','ROLL','PAIR','BAG','GALLON','SHEET','CARTON','LITRE','KG','TUBE'];
const countConditions={good:'Good',damaged:'Damaged',expired:'Expired',quarantine:'Set aside / check'};
const countStatuses={recorded:'Waiting for review',accepted:'Accepted',rejected:'Rejected',void:'Voided'};
let countTab='count',countSearch='',countGodown='',countPicked='',countReviewFilter='recorded',countReviewGodown='',countReviewSessionId='',countPage=0;
let countLoadError='',countEpoch=0,countCatalogue=[],countSessions=[],countEntries=[],countPendingSave=null;
let countActor=null,countPageData=null,countPageReady=false,countPageRequest=0,countPageKey='',countSessionPage=0,countSearchRows=[],countSearchRequest=0;
function stockCountEnabled(){return window.ERP_CONFIG?.stockCountEnabled!==false;}
function clearStockCount(){countEpoch++;countPageRequest++;countSearchRequest++;countActor=null;countPageData=null;countPageReady=false;countPageKey='';countLoadError='';countCatalogue=[];countSessions=[];countEntries=[];countPicked='';countPendingSave=null;countSearch='';countSearchRows=[];countReviewSessionId='';countPage=0;countSessionPage=0;}
function openStockCountSection(section){countTab=section==='review'?'review':'count';countPage=0;countPicked='';countSearchRequest++;countSearchRows=[];}
function countOpenSession(){return countPageData?countPageData.open_session:countSessions.find(s=>s.status==='open')||null;}
function countCurrentSession(){return countOpenSession()||[...countSessions].sort((a,b)=>String(b.opened_at).localeCompare(String(a.opened_at)))[0]||null;}
function countReviewSession(){return countPageData?countPageData.session:countSessions.find(session=>session.id===countReviewSessionId)||countCurrentSession();}
function countItem(code){return countCatalogue.find(item=>item.code===code);}
function countLabel(entry){const item=Object.hasOwn(entry,'catalogue')?entry.catalogue:(entry.code?countItem(entry.code):null);return item?[item.product,item.company,item.specification].filter(Boolean).join(' · '):entry.unlisted||'Unknown product';}
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
 const actor=me,epoch=countEpoch,total=await applyProductListFile(file);if(me!==actor||countEpoch!==epoch)return;
 countCatalogue=[];countSearchRows=[];countSearchRequest++;await stockCountWorkspace(true);if(me===actor&&view==='stockcount')message(productListSummary(total));
}
function countPageArgs(){return {p_tab:countTab,p_session_id:countTab==='review'?countReviewSessionId||null:null,p_godown:countTab==='review'?countReviewGodown:countGodown,p_status:countReviewFilter,p_page:countPage,p_session_page:countSessionPage};}
function countValidPage(data){
 const validList=(list,size)=>list&&Array.isArray(list.rows)&&list.rows.length<=size&&['total','page','pages'].every(key=>Number.isSafeInteger(list[key])&&list[key]>=0)&&list.pages===Math.max(1,Math.ceil(list.total/size))&&list.page<list.pages&&list.rows.length===Math.min(size,Math.max(0,list.total-list.page*size));
 const validSession=row=>row&&row.id&&typeof row.name==='string'&&['open','closed'].includes(row.status)&&Number.isSafeInteger(row.version)&&row.version>0&&row.opened_at&&row.opened_by;
 return data&&Number.isSafeInteger(data.catalogue_total)&&data.catalogue_total>=0&&validList(data.entries,50)&&validList(data.sessions,25)&&data.sessions.rows.every(validSession)&&(!data.session||validSession(data.session))&&(!data.open_session||(validSession(data.open_session)&&data.open_session.status==='open'))&&data.stats&&['all','recorded','accepted','rejected','void','accepted_lines'].every(key=>Number.isSafeInteger(data.stats[key])&&data.stats[key]>=0)&&data.stats.all===data.stats.recorded+data.stats.accepted+data.stats.rejected+data.stats.void&&data.stats.accepted_lines<=data.stats.accepted&&data.entries.total<=data.stats.all&&Array.isArray(data.stats.godowns)&&data.stats.godowns.length<=countGodowns.length&&data.stats.godowns.every(row=>countGodowns.includes(row.godown)&&Number.isSafeInteger(row.total)&&row.total>=0&&row.total<=data.stats.all)&&data.entries.rows.every(row=>row.id&&row.session_id===data.session?.id&&Number.isSafeInteger(row.version)&&row.version>0&&Object.hasOwn(countStatuses,row.status));
}
async function stockCountWorkspace(force=false,bodyOnly=false){
 const actor=me;syncWorkspaceNavigation();
 if(!stockCountEnabled()){$('#content').innerHTML=`${workspacePageHeader({title:'Stock count is switched off',subtitle:'The physical count is finished. Stock is managed in Inventory.'})}`;return;}
 if(countActor!==actor){clearStockCount();countActor=actor;}
 if(!countGodown)countGodown=countRememberedGodown();
 const args=countPageArgs(),picked=countPicked,search=countSearch,request=++countPageRequest,epoch=countEpoch;let key=JSON.stringify(args);
 const current=()=>me===actor&&countEpoch===epoch&&countPageRequest===request&&view==='stockcount'&&JSON.stringify(countPageArgs())===key;
 if(force||countPageKey!==key||!countPageReady){
  if(force&&!countPicked){countSearchRequest++;countSearchRows=[];}
  countPageReady=false;if(!bodyOnly)workspaceLoading('Loading stock counts…');
  try{
   const result=await client.rpc('stock_count_page',args);if(!current())return;
   if(result.error)throw result.error;if(!countValidPage(result.data)||(args.p_tab==='review'&&args.p_session_id&&result.data.session?.id!==args.p_session_id)||(args.p_tab==='count'&&result.data.session?.id!==result.data.open_session?.id))throw Error('The count page was incomplete. Refresh before counting or reviewing.');
   if(countPageData?.open_session?.id!==result.data.open_session?.id||countPageData?.open_session?.version!==result.data.open_session?.version)bodyOnly=false;
   countPageData=result.data;countPage=result.data.entries.page;countSessionPage=result.data.sessions.page;key=JSON.stringify(countPageArgs());countPageKey=key;countPageReady=true;countLoadError='';
  }catch(error){if(!current())return;countPageData=null;countPageKey='';countPageReady=false;countLoadError=error.message||'Counts could not load.';}
 }
 if(!current()||(countPicked&&countPicked!==picked)||countSearch!==search)return;
 if(bodyOnly&&$('#countBody')&&!countLoadError)renderStockCountBody();else renderStockCount();
 if((force||!countSearchRows.length)&&countPageReady&&countTab==='count'&&!countPicked&&countSearch.trim())await loadCountSearch();
}
function countPickedItem(){return countSearchRows.find(item=>item.code===countPicked)||countItem(countPicked);}
function countSearchHtml(){return countSearchRows.map(item=>`<button type="button" class="count-result" data-count-pick="${esc(item.code)}"><strong>${esc(item.product)}</strong><span>${esc([item.company,item.specification].filter(Boolean).join(' · ')||'Company and specification not known')}</span><small>${esc(item.code)} · ${esc(item.category)}</small></button>`).join('')||'<p class="muted">No product matches. Try fewer words, or record it as not on the list.</p>';}
function bindCountPicks(){document.querySelectorAll('[data-count-pick]').forEach(button=>button.onclick=()=>{if(!countPageReady||countActor!==me||!countSearchRows.some(item=>item.code===button.dataset.countPick))return;countPicked=button.dataset.countPick;countPendingSave=null;countSearchRequest++;renderStockCountBody();$('#countForm [name="quantity"]')?.focus();});}
async function loadCountSearch(){
 const actor=me,epoch=countEpoch,request=++countSearchRequest,query=countSearch,target=$('#countResults'),current=()=>me===actor&&countEpoch===epoch&&request===countSearchRequest&&view==='stockcount'&&countTab==='count'&&!countPicked&&countSearch===query&&target?.isConnected;
 if(!target)return;if(!query.trim()){target.innerHTML='<p class="muted">Type part of the name, company, model or AN code.</p>';return;}
 target.innerHTML='<p role="status">Searching products…</p>';
 try{const result=await client.rpc('stock_count_catalogue_page',{p_query:query});if(!current())return;if(result.error)throw result.error;if(!Array.isArray(result.data)||result.data.length>25||result.data.some(item=>!/^AN-\d{5}$/.test(item.code)||typeof item.product!=='string'))throw Error('Product matches could not be verified. Search again.');countSearchRows=result.data;target.innerHTML=countSearchHtml();bindCountPicks();}
 catch(error){if(current()){countSearchRows=[];target.innerHTML=`<p role="alert">${esc(error.message||'Products could not load. Search again.')}</p>`;}}
}
function countPickedForm(item){
 const unlisted=item==='unlisted';
 return `<form id="countForm" class="card count-form"><div class="heading"><div><small>${unlisted?'NOT ON THE LIST':esc(item.code)}</small><h2>${unlisted?'Describe the product':esc(item.product)}</h2>${unlisted?'':`<p class="muted">${esc([item.company||'Company not known',item.specification||'Specification not known',item.category].join(' · '))}</p>`}</div><button type="button" id="countCancel">Close</button></div><p role="alert" id="countFormError"></p><div class="grid">${unlisted?'<label class="wide"><span>What is it? Name, company, model or size as written on the item</span><input name="unlisted" required minlength="3" maxlength="300"></label>':''}<label><span>Quantity counted</span><input name="quantity" type="number" min="0" max="10000000" step="any" required inputmode="decimal"></label><label><span>Unit</span><select name="unit">${countUnits.map(u=>`<option>${u}</option>`).join('')}</select></label><label><span>Condition</span><select name="condition">${Object.entries(countConditions).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label><span>Batch / lot · if printed</span><input name="batch" maxlength="80"></label><label><span>Expiry · if printed</span><input name="expiry" type="date" min="2000-01-01"></label><label class="wide"><span>Notes · optional</span><input name="notes" maxlength="1000"></label></div><div class="actions"><button type="submit" id="countSave">Save count</button></div></form>`;
}
function countEntryRow(entry,{review=false}={}){
 const own=entry.counted_by===me?.user_id,owner=me?.role==='owner',buttons=[];
 if(entry.status==='recorded'&&review&&owner)buttons.push(`<button type="button" data-count-action="accept" data-id="${esc(entry.id)}">Accept</button>`,`<button type="button" data-count-action="reject" data-id="${esc(entry.id)}">Reject</button>`);
 if(entry.status==='recorded'&&(own||owner))buttons.push(`<button type="button" data-count-action="void" data-id="${esc(entry.id)}">Void</button>`);
 return `<tr data-count-entry="${esc(entry.id)}"><td>${entry.code?`<small>${esc(entry.code)}</small> `:'<small>Not on list</small> '}${esc(countLabel(entry))}${entry.notes?`<small>${esc(entry.notes)}</small>`:''}</td>${review?`<td>${esc(entry.godown)}</td>`:''}<td><strong>${esc(Number(entry.quantity))}</strong> ${esc(entry.unit)}</td><td>${esc(countConditions[entry.condition]||entry.condition)}${entry.batch?`<small>Batch ${esc(entry.batch)}</small>`:''}${entry.expiry?`<small>Exp ${esc(entry.expiry)}</small>`:''}</td><td>${esc(employeeName(entry.counted_by))}<small>${esc(new Date(entry.counted_at).toLocaleString())}</small></td><td><span class="tag chip chip--${statusTone(entry.status==='accepted'?'success':entry.status==='rejected'?'rejected':entry.status==='recorded'?'waiting':'neutral')}">${esc(countStatuses[entry.status])}</span>${entry.status_note?`<small>${esc(entry.status_note)}</small>`:''}</td><td class="actions">${buttons.join('')}</td></tr>`;
}
function countBody(){
 const content=!countPageData?.catalogue_total?`<p class="notice">The product list has not been loaded yet.${me?.role==='owner'?' Load it above before starting the count.':' The owner loads it once before counting starts.'}</p>`:countTab==='count'?renderCountTab(countOpenSession()):renderCountReview(countReviewSession());
 return `<div id="${countTab==='count'?'countCountScope':'countReviewScope'}">${content}</div>`;
}
function renderStockCountBody(){const body=$('#countBody');if(!body)return renderStockCount();body.innerHTML=countBody();bindStockCount(true);}
function countSessionBar(){const open=countOpenSession(),owner=me?.role==='owner';
 return `<div class="help-strip" id="countSessionBar">${open?`<strong>Count running: ${esc(open.name)}</strong><span>Started ${esc(new Date(open.opened_at).toLocaleDateString())} by ${esc(employeeName(open.opened_by))}</span>`:`<strong>No count is running.</strong><span>${owner?'Start one to let staff record counts.':'Ask the owner to start the count.'}</span>`}${owner?(open?'<button type="button" id="countClose">Close this count</button>':'<button type="button" id="countOpen">Start a count</button>'):''}</div>`;
}
function renderStockCount(){
 if(countLoadError||!countPageReady){$('#content').innerHTML=`${workspacePageHeader({title:'Stock count',actions:'<button type="button" id="countRefresh">Retry</button>'})}<section class="card"><p role="alert">Stock count could not load: ${esc(countLoadError||'Refresh before counting or reviewing.')}</p></section>`;$('#countRefresh').onclick=()=>run(()=>stockCountWorkspace(true));return;}
 const owner=me?.role==='owner',catalogueTotal=countPageData.catalogue_total;
 const tabs=`<div class="tabs" role="group" aria-label="Stock count sections">${[['count','Count a godown'],['review',owner?'Review counts':'All counts']].map(([key,label])=>`<button type="button" data-count-tab="${key}" class="${countTab===key?'active':''}" aria-pressed="${countTab===key}">${label}</button>`).join('')}</div>`;
 const loader=owner?`<details class="card count-loader"${catalogueTotal?'':' open'}><summary>${catalogueTotal?`Product list: ${catalogueTotal.toLocaleString()} products · load a newer file`:'Load the product list'}</summary><p class="muted">Choose the product list file (.json) prepared from the Tally and CRM data. It also updates the ERP product list. Loading again updates products with the same AN code and keeps corrections staff have made; it never touches stock.</p><label><span>Product list file</span><input type="file" id="countCatalogueFile" accept=".json,application/json"></label></details>`:'';
 const sessionBar=countSessionBar();
 $('#content').innerHTML=`<section class="stock-count-workspace">${workspacePageHeader({title:'Stock count',subtitle:'Count what is physically on the shelf, godown by godown.',actions:'<button type="button" id="countRefresh">Refresh</button>'})}<p class="muted">Counts do not change stock; the owner reviews them and accepted counts become the opening stock.</p>${loader}${sessionBar}${tabs}<div id="countSaved" role="status" tabindex="-1"></div><div id="countBody">${countBody()}</div></section>`;
 bindStockCount();
}
function countEntriesTable(rows,review=false){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Product</th>${review?'<th>Godown</th>':''}<th>Qty</th><th>Condition</th><th>Counted by</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(e=>countEntryRow(e,{review})).join('')}</tbody></table></div>`:'<p class="muted">No counts here.</p>';}
function countPager(){const page=countPageData.entries;return `<div class="actions" id="countEntryPager"><button type="button" id="countPrev" ${page.page===0?'disabled':''}>Previous</button><span id="countPageStatus" tabindex="-1">Page ${page.page+1} of ${page.pages} · ${page.rows.length} shown</span><button type="button" id="countNext" ${page.page+1>=page.pages?'disabled':''}>Next</button></div>`;}
function renderCountTab(open){
 if(!open)return '<p class="muted">Counting opens when the owner starts a count.</p>';
 const godownSelect=`<label><span>Godown you are counting</span><select id="countGodown"><option value="">Choose godown</option>${countGodowns.map(g=>`<option ${g===countGodown?'selected':''}>${esc(g)}</option>`).join('')}</select></label>`;
 if(!countGodown)return `<div class="grid">${godownSelect}</div>`;
 const picked=countPicked==='unlisted'?'unlisted':countPicked?countPickedItem():null,mine=countPageData.entries;
 return `<div class="grid">${godownSelect}</div><div id="countEntryControls">${picked?countPickedForm(picked):`<label class="search"><span>Find the product</span><input id="countSearch" type="search" autocomplete="off" maxlength="2000" placeholder="Name, company, model, size or AN code" value="${esc(countSearch)}"></label><div id="countResults" class="count-results">${countSearch.trim()?countSearchHtml():'<p class="muted">Type part of the name, the company, a model number or the AN code.</p>'}</div><div class="actions"><button type="button" id="countUnlisted">Product is not on the list</button></div>`}</div><h2 id="countEntriesSummary">Counted in ${esc(countGodown)} · ${mine.total.toLocaleString()}</h2><div id="countEntryRows">${countEntriesTable(mine.rows)}</div>${countPager()}`;
}
function renderCountReview(session){
 if(!session)return '<p class="muted">No counts yet.</p>';
 const rows=countPageData.entries,stats=countPageData.stats,sessions=countPageData.sessions,choices=sessions.rows.some(row=>row.id===session.id)?sessions.rows:[session,...sessions.rows];
 const godownProgress=countGodowns.map(g=>[g,stats.godowns.find(row=>row.godown===g)?.total||0]).filter(([,n])=>n);
 return `<label><span>Count session to review / export</span><select id="countReviewSession">${choices.map(row=>`<option value="${esc(row.id)}" ${row.id===session.id?'selected':''}>${esc(row.name)} · ${row.status==='open'?'Running':'Closed'}</option>`).join('')}</select></label><div class="actions" id="countSessionPager"><button id="countSessionPrev" ${sessions.page===0?'disabled':''}>Newer sessions</button><span id="countSessionPageStatus">${sessions.total.toLocaleString()} sessions · page ${sessions.page+1} of ${sessions.pages}</span><button id="countSessionNext" ${sessions.page+1>=sessions.pages?'disabled':''}>Older sessions</button></div><p class="muted" id="countReviewStats">${esc(session.name)} · ${stats.recorded} waiting · ${stats.accepted} accepted · ${stats.rejected} rejected · ${stats.void} voided</p><p class="muted" id="countGodownProgress">${godownProgress.map(([g,n])=>`${esc(g)}: ${n}`).join(' · ')}</p><div class="grid"><label><span>Status</span><select id="countReviewFilter">${[['recorded','Waiting for review'],['accepted','Accepted'],['rejected','Rejected'],['void','Voided'],['all','All']].map(([k,v])=>`<option value="${k}" ${countReviewFilter===k?'selected':''}>${v}</option>`).join('')}</select></label><label><span>Godown</span><select id="countReviewGodown"><option value="">All godowns</option>${countGodowns.map(g=>`<option ${g===countReviewGodown?'selected':''}>${esc(g)}</option>`).join('')}</select></label></div>${me?.role==='owner'?`<div class="actions"><button type="button" id="countExport" ${stats.accepted_lines?'':'disabled'}>Download accepted counts (${stats.accepted_lines} line${stats.accepted_lines===1?"":"s"})</button></div>`:''}<p class="muted" id="countEntriesSummary">${rows.total.toLocaleString()} matching</p><div id="countEntryRows">${countEntriesTable(rows.rows,true)}</div>${countPager()}`;
}
async function refreshSavedStockCount(text,trigger,submittedForm=null,sessionChanged=false){
 const actor=me,epoch=countEpoch,request=++countPageRequest,args=countPageArgs(),body=$('#countBody'),notice=$('#countSaved'),previous=countPageData;
 let key=JSON.stringify(args);
 const current=()=>me===actor&&countEpoch===epoch&&countPageRequest===request&&view==='stockcount'&&JSON.stringify(countPageArgs())===key&&body.isConnected&&$('#countBody')===body&&notice.isConnected;
 const rowsBefore=new Map(previous.entries.rows.map(row=>[row.id,countEntryRow(row,{review:countTab==='review'})]));
 async function reload(){
  if(!current())return;
  countPageReady=false;countPageKey='';
  const left=window.scrollX,top=window.scrollY,focused=document.activeElement;
  notice.textContent=text+' Loading current counts…';
  if(sessionChanged)$('#countSessionBar').querySelector('strong').textContent='Current session pending';
  for(const id of ['countEntriesSummary','countReviewStats','countGodownProgress']){const node=$('#'+id);if(node)node.textContent='Current counts pending';}
  for(const selector of ['[data-count-action]','#countSave','#countOpen','#countClose','#countExport','#countPrev','#countNext','#countSessionPrev','#countSessionNext'])document.querySelectorAll(selector).forEach(button=>button.disabled=true);
  window.scrollTo({left,top,behavior:'instant'});
  try{
   const result=await client.rpc('stock_count_page',args);if(!current())return;if(result.error)throw result.error;
   const data=result.data;
   if(!countValidPage(data)||(args.p_tab==='review'&&args.p_session_id&&data.session?.id!==args.p_session_id)||(args.p_tab==='count'&&data.session?.id!==data.open_session?.id))throw Error('The count page was incomplete. Retry before counting or reviewing.');
   countPageData=data;countPage=data.entries.page;countSessionPage=data.sessions.page;key=JSON.stringify(countPageArgs());countPageKey=key;countPageReady=true;countLoadError='';
   const left=window.scrollX,top=window.scrollY,active=document.activeElement,focusId=active?.closest('[data-count-entry]')?.dataset.countEntry;
   if(countTab==='count'&&previous.open_session?.id!==data.open_session?.id){countPicked='';countPendingSave=null;countSearch='';countSearchRows=[];countSearchRequest++;}
   const template=document.createElement('template');template.innerHTML=countSessionBar()+countBody();
   const bar=$('#countSessionBar'),nextBar=template.content.querySelector('#countSessionBar');if(sessionChanged||JSON.stringify(previous.open_session)!==JSON.stringify(data.open_session))bar.innerHTML=nextBar.innerHTML;
   const scope=body.firstElementChild,nextScope=template.content.querySelector(countTab==='count'?'#countCountScope':'#countReviewScope');
   const sameSession=countTab==='count'?previous.open_session?.id===data.open_session?.id:previous.session?.id===data.session?.id;
   if(!sameSession||!body.querySelector('#countEntryRows')||!nextScope.querySelector('#countEntryRows'))scope.innerHTML=nextScope.innerHTML;
   else{
    const register=body.querySelector('#countEntryRows'),tbody=register.querySelector('tbody'),nextRows=nextScope.querySelector('#countEntryRows');
    if(!tbody||!data.entries.rows.length)register.innerHTML=nextRows.innerHTML;
    else{
     const old=[...tbody.querySelectorAll('[data-count-entry]')],incoming=[...nextRows.querySelectorAll('[data-count-entry]')],keep=data.entries.rows.map(row=>old.find(node=>node.dataset.countEntry===row.id&&rowsBefore.get(row.id)===countEntryRow(row,{review:countTab==='review'}))||incoming.find(node=>node.dataset.countEntry===row.id));
     for(const node of old)if(!keep.includes(node))node.remove();keep.forEach((node,index)=>{if(tbody.children[index]!==node)tbody.insertBefore(node,tbody.children[index]||null);});
    }
    for(const id of ['countEntriesSummary','countPageStatus','countReviewStats','countGodownProgress','countSessionPageStatus']){const node=$('#'+id),next=nextScope.querySelector('#'+id);if(node&&next)node.textContent=next.textContent;}
    const sessions=$('#countReviewSession'),nextSessions=nextScope.querySelector('#countReviewSession');if(sessions&&nextSessions&&sessions.innerHTML!==nextSessions.innerHTML){const value=sessions.value;sessions.innerHTML=nextSessions.innerHTML;sessions.value=value;}
    if(submittedForm?.isConnected&&!countPicked)$('#countEntryControls').innerHTML=nextScope.querySelector('#countEntryControls').innerHTML;
   }
   bindStockCount();
   for(const selector of ['[data-count-action]','#countSave','#countOpen','#countClose','#countExport','#countPrev','#countNext','#countSessionPrev','#countSessionNext'])document.querySelectorAll(selector).forEach(button=>{const next=button.dataset.countAction?[...nextScope.querySelectorAll('[data-count-action]')].find(node=>node.dataset.id===button.dataset.id&&node.dataset.countAction===button.dataset.countAction):template.content.querySelector('#'+button.id);if(next){button.disabled=next.disabled;if(button.id==='countExport')button.textContent=next.textContent;}});
   notice.textContent=text;
   const focus=submittedForm&&!submittedForm.isConnected?$('#countSearch'):focusId?[...body.querySelectorAll('[data-count-entry]')].find(node=>node.dataset.countEntry===focusId)?.querySelector('button'):trigger?.id?$('#'+trigger.id):null;
   const fallback=focus||$('#countPageStatus')||$('#countOpen')||$('#countClose')||notice;
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(fallback);
   if(document.activeElement===document.body&&(submittedForm||body.contains(focused)||notice.contains(focused)||!trigger?.isConnected))fallback.focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message(text);
  }catch(error){
   if(!current())return;countPageReady=false;countPageKey='';countLoadError=error.message||'Counts could not load.';
   const left=window.scrollX,top=window.scrollY;
   notice.innerHTML=`<p role="alert">${esc(text)} Current counts could not refresh: ${esc(countLoadError)} Retry reads the saved counts without repeating the action.</p><button type="button" data-count-retry-saved>Retry saved count</button>`;
   const retry=notice.querySelector('[data-count-retry-saved]');retry.onclick=()=>run(reload);
   if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(retry);
   if(document.activeElement===document.body&&(submittedForm||notice.contains(focused)))retry.focus({preventScroll:true});
   window.scrollTo({left,top,behavior:'instant'});message(text+' Use Retry saved count before continuing.');
  }
 }
 await reload();
}
function countQuantity(value){
 const text=String(value??'').trim();
 if(!/^\d+(?:\.\d+)?$/.test(text))throw Error('Enter the quantity counted (0 or more).');
 const [whole,fraction='']=text.split('.');if(fraction.length>3)throw Error('Use at most three decimal places.');
 const thousandths=Number(whole)*1000+Number((fraction+'000').slice(0,3));
 if(!Number.isSafeInteger(thousandths)||thousandths>10000000000)throw Error('Enter a quantity from 0 to 10,000,000.');
 return thousandths/1000;
}
function countFieldError(control){
 control=fieldValidationSource(control);if(!control.willValidate)return '';
 const native=nativeFieldError(control);if(native)return native;
 if(control.name==='quantity'){try{countQuantity(control.value);}catch(error){return error.message;}}
 if(control.name==='unlisted'&&String(control.value||'').trim().length<3)return 'Describe the product so it can be matched later.';
 return '';
}
function countFormErrors(form){
 const errors=nativeFormErrors(form);
 for(const control of form.querySelectorAll('input,select,textarea')){if(fieldValidationSource(control)!==control)continue;const problem=countFieldError(control);if(problem)errors.set(control,problem);}
 return errors;
}
function countFormValues(form){
 const f=new FormData(form),quantity=countQuantity(f.get('quantity'));
 const unlisted=String(f.get('unlisted')||'').trim();
 if(countPicked==='unlisted'&&unlisted.length<3)throw Error('Describe the product so it can be matched later.');
 return {code:countPicked==='unlisted'?'':countPicked,unlisted:countPicked==='unlisted'?unlisted:'',quantity,unit:f.get('unit'),condition:f.get('condition'),batch:String(f.get('batch')||'').trim(),expiry:f.get('expiry')||null,notes:String(f.get('notes')||'').trim()};
}
async function saveCountForm(form){
 if(form.dataset.countSaved==='true')throw Error('Count saved. Use Retry saved count to load current results.');
 if(form.dataset.saving==='true')return;
 if(countPageData&&(!countPageReady||countActor!==me))throw Error('Refresh before recording a count.');
 const open=countOpenSession();if(!open)throw Error('No count is running.');
 const values=countFormValues(form),key=JSON.stringify([open.id,countGodown,values]);
 // Same id for an unchanged retry, so a lost response cannot record the same count twice.
 if(countPendingSave?.key!==key)countPendingSave={key,id:crypto.randomUUID()};
 const item=countPickedItem(),request=countPendingSave,actor=me,epoch=countEpoch,pageRequest=countPageRequest,args=JSON.stringify(countPageArgs()),inert=form.inert;
 form.dataset.saving='true';form.inert=true;
 try{
  const result=await client.rpc('record_stock_count',{p_id:request.id,p_session_id:open.id,p_godown:countGodown,p_code:values.code,p_unlisted:values.unlisted,p_quantity:values.quantity,p_unit:values.unit,p_batch:values.batch,p_expiry:values.expiry,p_condition:values.condition,p_notes:values.notes});
  if(me!==actor||countEpoch!==epoch)return;
  if(result.error)throw Error(result.error.message);
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved?.id!==request.id)throw Error('The server did not confirm the count. Press save again to retry safely.');
  if(item&&saved.code===item.code)saved.catalogue=item;
  countEntries=[saved,...countEntries.filter(e=>e.id!==saved.id)];countPageKey='';
  const ownsDraft=countPendingSave===request&&form.isConnected;
  if(countPendingSave===request)countPendingSave=null;
  if(ownsDraft){countPicked='';countSearch='';form.dataset.countSaved='true';}
  if(view!=='stockcount'||countPageRequest!==pageRequest||JSON.stringify(countPageArgs())!==args||countPicked)return;
  const text=`Counted ${Number(saved.quantity)} ${saved.unit} of ${countLabel(saved)} in ${saved.godown}.`;
  if(countPageData)await refreshSavedStockCount(text,form,ownsDraft?form:null);
  else{renderStockCount();message(text);if(ownsDraft)$('#countSearch')?.focus();}
 }catch(error){if(me!==actor||countEpoch!==epoch||view!=='stockcount'||countPageRequest!==pageRequest||JSON.stringify(countPageArgs())!==args)return;throw error;}
 finally{if(form.dataset.countSaved!=='true'){form.dataset.saving='false';form.inert=inert;}}
}

function openCountAction(entry,action){
 if(!entry||!['accept','reject','void'].includes(action))return;
 const actor=me,epoch=countEpoch,request=countPageRequest,args=JSON.stringify(countPageArgs()),trigger=document.activeElement,titles={accept:'Accept count',reject:'Reject count',void:'Void count'};
 actionForm(titles[action],`<p><strong>${esc(countLabel(entry))}</strong> · ${esc(Number(entry.quantity))} ${esc(entry.unit)} · ${esc(entry.godown)}</p><label><span>${action==='accept'?'Note · optional':action==='void'?'Why is this count wrong?':'Why is it rejected? The godown should be recounted.'}</span><textarea name="note" maxlength="1000" ${action==='accept'?'':'required minlength="3"'}></textarea></label>`,async values=>{
  if(me!==actor||countEpoch!==epoch||countPageRequest!==request||JSON.stringify(countPageArgs())!==args||view!=='stockcount'||!countPageReady)throw Error('Workspace changed. Reopen the count.');
  let result;try{result=await client.rpc('review_stock_count',{p_id:entry.id,p_expected_version:entry.version,p_action:action,p_note:values.note||''});}catch(error){if(me!==actor||countEpoch!==epoch||countPageRequest!==request||view!=='stockcount'||JSON.stringify(countPageArgs())!==args)return;throw error;}
  if(me!==actor||countEpoch!==epoch)return;if(result.error){if(view==='stockcount'&&countPageRequest===request&&JSON.stringify(countPageArgs())===args)throw Error(result.error.message);return;}
  const saved=Array.isArray(result.data)?result.data[0]:result.data;
  if(saved?.id!==entry.id||saved.version!==entry.version+1||saved.status!==({accept:'accepted',reject:'rejected',void:'void'})[action]){if(view==='stockcount'&&countPageRequest===request&&JSON.stringify(countPageArgs())===args)throw Error('The server did not confirm the review. Refresh before trying again.');return;}
  countEntries=countEntries.map(e=>e.id===saved.id?saved:e);countPageKey='';
  if(view!=='stockcount'||countPageRequest!==request||JSON.stringify(countPageArgs())!==args)return;
  await refreshSavedStockCount(`${titles[action]} saved.`,trigger);
 });
}
function bindCountActions(){document.querySelectorAll('[data-count-action]').forEach(button=>button.onclick=()=>openCountAction(countPageData?.entries.rows.find(e=>e.id===button.dataset.id),button.dataset.countAction));}
async function exportStockCount(){
 if(me?.role!=='owner'||!countPageReady||countActor!==me)throw Error('Refresh before exporting accepted counts.');
 const actor=me,epoch=countEpoch,session=countReviewSession();if(!session)throw Error('Choose a count session.');
 const current=()=>me===actor&&countEpoch===epoch&&view==='stockcount'&&countTab==='review'&&countReviewSession()?.id===session.id;
 let entries,catalogue;
 try{[entries,catalogue]=await Promise.all([all('stock_count_entries','*',query=>query.eq('session_id',session.id).eq('status','accepted')),all('count_catalogue','code,product,company,specification,category,search_text')]);}catch(error){if(!current())return;throw error;}
 if(!current())return;if(entries.some(row=>row.session_id!==session.id||row.status!=='accepted'))throw Error('Accepted counts could not be verified. Refresh before exporting.');
 countCatalogue=catalogue;
 const csv=countCsv(countAcceptedTotals(entries)),link=document.createElement('a');link.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));link.download=`accepted-stock-count-${session.id}-${companyDate()}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function bindStockCount(bodyOnly=false){
 if(!bodyOnly){
  $('#countRefresh').onclick=()=>run(()=>stockCountWorkspace(true));
  const catalogueFile=$('#countCatalogueFile');if(catalogueFile)catalogueFile.onchange=()=>{const file=catalogueFile.files[0];if(file)run(()=>loadCountCatalogueFile(file));};
  document.querySelectorAll('[data-count-tab]').forEach(button=>button.onclick=()=>run(()=>{openStockCountSection(button.dataset.countTab);return stockCountWorkspace();}));
  const start=$('#countOpen');if(start)start.onclick=()=>{
   const actor=me,epoch=countEpoch,request=countPageRequest,args=JSON.stringify(countPageArgs()),id=crypto.randomUUID(),trigger=start;actionForm('Start a count','<label><span>Name for this count</span><input name="name" required minlength="3" maxlength="120" value="Full stock count '+companyDate()+'"></label><p class="muted">Staff can record counts until you close it.</p>',async values=>{
    if(me!==actor||countEpoch!==epoch||countPageRequest!==request||JSON.stringify(countPageArgs())!==args||view!=='stockcount'||!countPageReady)throw Error('Workspace changed. Reopen this action.');
    let result;try{result=await client.rpc('open_stock_count',{p_id:id,p_name:values.name});}catch(error){if(me!==actor||countEpoch!==epoch||countPageRequest!==request||view!=='stockcount'||JSON.stringify(countPageArgs())!==args)return;throw error;}
    if(me!==actor||countEpoch!==epoch)return;countPageKey='';if(countPageRequest!==request||view!=='stockcount'||JSON.stringify(countPageArgs())!==args)return;if(result.error)throw Error(result.error.message);
    const saved=Array.isArray(result.data)?result.data[0]:result.data;if(saved?.id!==id||!Number.isSafeInteger(saved.version)||saved.version<1||!['open','closed'].includes(saved.status))throw Error('The server did not confirm the session. Refresh before starting another count.');
    await refreshSavedStockCount('Count started.',trigger,null,true);
   });
  };
  const close=$('#countClose');if(close)close.onclick=()=>{
   const open=countOpenSession(),actor=me,epoch=countEpoch,request=countPageRequest,args=JSON.stringify(countPageArgs()),trigger=close;if(!open)return;actionForm('Close this count',`<p>Closing stops new counts for <strong>${esc(open.name)}</strong>. You can still review what was counted.</p>`,async()=>{
    if(me!==actor||countEpoch!==epoch||countPageRequest!==request||JSON.stringify(countPageArgs())!==args||view!=='stockcount'||!countPageReady)throw Error('Workspace changed. Reopen this action.');
    let result;try{result=await client.rpc('close_stock_count',{p_id:open.id,p_expected_version:open.version});}catch(error){if(me!==actor||countEpoch!==epoch||countPageRequest!==request||view!=='stockcount'||JSON.stringify(countPageArgs())!==args)return;throw error;}
    if(me!==actor||countEpoch!==epoch)return;countPageKey='';if(countPageRequest!==request||view!=='stockcount'||JSON.stringify(countPageArgs())!==args)return;if(result.error)throw Error(result.error.message);
    const saved=Array.isArray(result.data)?result.data[0]:result.data;if(saved?.id!==open.id||saved.version!==open.version+1||saved.status!=='closed')throw Error('The server did not confirm the closed session. Refresh before trying again.');
    await refreshSavedStockCount('Count closed.',trigger,null,true);
   });
  };
 }
 const godown=$('#countGodown');if(godown)godown.onchange=()=>run(()=>{countGodown=godown.value;countRememberGodown(countGodown);countPicked='';countPage=0;return stockCountWorkspace();});
 const search=$('#countSearch');if(search)search.oninput=event=>{countSearch=event.target.value;countSearchRequest++;countSearchRows=[];const target=$('#countResults');if(target)target.innerHTML='<p role="status">Searching products…</p>';renderSearchPreservingPosition(event.target,loadCountSearch,150);};
 bindCountPicks();
 const unlisted=$('#countUnlisted');if(unlisted)unlisted.onclick=()=>{countPicked='unlisted';countPendingSave=null;countSearchRequest++;renderStockCountBody();$('#countForm [name="unlisted"]')?.focus();};
 const cancel=$('#countCancel');if(cancel)cancel.onclick=()=>{countPicked='';countPendingSave=null;if(countPageData)run(()=>stockCountWorkspace(false,true));else renderStockCount();$('#countSearch')?.focus();};
 const form=$('#countForm');
 if(form){
  const actor=me,sessionEpoch=sessionLoadEpoch,epoch=countEpoch,request=countPageRequest,picked=countPicked,godown=countGodown,sessionId=countOpenSession()?.id;
  const current=()=>me===actor&&sessionLoadEpoch===sessionEpoch&&countEpoch===epoch&&countPageRequest===request&&countPicked===picked&&countGodown===godown&&countOpenSession()?.id===sessionId&&view==='stockcount'&&countTab==='count'&&form.isConnected&&$('#countForm')===form;
  const summary=(count=form.querySelectorAll('.field-error').length)=>{form.querySelector('#countFormError').textContent=fieldErrorSummary(count);};form.noValidate=true;
  if(form.countFocusout)form.removeEventListener('focusout',form.countFocusout);
  form.countFocusout=event=>{const control=fieldValidationSource(event.target);if(!current()||form.dataset.saving==='true'||form.dataset.countSaved==='true'||!form.contains(control)||!control.matches('input,select,textarea')||fieldBlurToAction(event))return;showFieldError(control,countFieldError(control));if(form.dataset.validationSubmitted==='true')summary();};
  form.addEventListener('focusout',form.countFocusout);
  form.onsubmit=event=>{event.preventDefault();if(!current())return;const button=form.querySelector('#countSave'),notice=form.querySelector('#countFormError');if(button.disabled)return;
   if(busy){actionFeedbackRefuse(button,notice);return;}
   const errors=countFormErrors(form);form.dataset.validationSubmitted='true';summary(errors.size);showFieldErrors(form,errors);if(errors.size)return;button.disabled=true;
   return run(async()=>{try{await saveCountForm(form)}catch(error){if(current())throw error;}finally{if(current()&&button.isConnected)button.disabled=form.dataset.countSaved==='true'||!!countPageData&&!countPageReady;}},{origin:button,errorTarget:notice});};
 }
 const reviewSession=$('#countReviewSession');if(reviewSession)reviewSession.onchange=()=>run(()=>{countReviewSessionId=reviewSession.value;countPage=0;return stockCountWorkspace(false,true);});
 const filter=$('#countReviewFilter');if(filter)filter.onchange=()=>run(()=>{countReviewFilter=filter.value;countPage=0;return stockCountWorkspace(false,true);});
 const reviewGodown=$('#countReviewGodown');if(reviewGodown)reviewGodown.onchange=()=>run(()=>{countReviewGodown=reviewGodown.value;countPage=0;return stockCountWorkspace(false,true);});
 for(const [id,step] of [['countPrev',-1],['countNext',1]]){const button=$('#'+id);if(button)button.onclick=()=>run(()=>{countPage+=step;return stockCountWorkspace(false,true);});}
 for(const [id,step] of [['countSessionPrev',-1],['countSessionNext',1]]){const button=$('#'+id);if(button)button.onclick=()=>run(()=>{countSessionPage+=step;return stockCountWorkspace(false,true);});}
 bindCountActions();
 const exportButton=$('#countExport');if(exportButton)exportButton.onclick=()=>run(exportStockCount);
}
