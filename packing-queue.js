'use strict';
// Packing queue (migration 078). Each packer presses Take next on their phone and gets the top order: customers
// waiting in the lobby (red) first, then delivery orders, oldest first. Take next is the Start packing step, given to
// the person who pressed it; Packed is Mark ready for delivery. One order per packer. The owner or the stores head can
// put an order back in the queue. The TV screen (#/go/packing/screen) shows the queue in large type for the stores.
// The page reads one summary (packing_queue_board) every 10 seconds; the clocks tick every second in between.
let packingSection='queue',packingBoard=null,packingError='',packingEpoch=0,packingTimer=null,packingTick=null,packingLoadedAt=0;
const packingRefreshMs=10000;
function clearPackingQueue(){packingEpoch++;packingBoard=null;packingError='';packingStop();liveStatusCache.clear();}
function packingStop(){clearInterval(packingTimer);clearInterval(packingTick);packingTimer=null;packingTick=null;}

// ---- Plain helpers (tests/packing-queue.test.mjs) ----
function packingMinutes(from,now=Date.now()){const t=Date.parse(from);return Number.isFinite(t)?Math.max(0,Math.floor((now-t)/60000)):0;}
// "7:05" (minutes:seconds), "1:07:05" past an hour.
function packingClock(from,now=Date.now()){
 const t=Date.parse(from);if(!Number.isFinite(t))return '';
 const s=Math.max(0,Math.floor((now-t)/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),pad=n=>String(n).padStart(2,'0');
 return h?`${h}:${pad(m)}:${pad(s%60)}`:`${m}:${pad(s%60)}`;
}
// '' under amber, then 'amber', then 'red' at the alert time (both come from the database setting).
function packingLevel(minutes,amber=20,overdue=30){return minutes>=overdue?'red':minutes>=amber?'amber':'';}
function packingShortNumber(number){const m=String(number||'').match(/(\d+)$/);return m?String(Number(m[1])):String(number||'');}
function packingSince(iso,now=Date.now()){
 const minutes=packingMinutes(iso,now);
 if(minutes<60)return `${minutes} min`;
 const hours=Math.floor(minutes/60);if(hours<48)return minutes%60?`${hours} h ${minutes%60} min`:`${hours} h`;
 return `${Math.floor(hours/24)} days`;
}
function packingTime(iso,now=Date.now()){
 const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';
 const pad=n=>String(n).padStart(2,'0'),time=`${pad(d.getHours())}:${pad(d.getMinutes())}`,today=new Date(now);
 return d.toDateString()===today.toDateString()?time:`${d.getDate()} ${d.toLocaleString('en-GB',{month:'short'})} ${time}`;
}
// The delivery promise, shown and never blocking: consumables within 24 working hours, machines by availability.
function packingPromiseText(row,now=Date.now()){
 if(!row)return '';
 if(row.customer_waiting)return 'Customer waiting in the lobby — cash, collecting now';
 if(row.promise_kind==='machines')return `Machine: by availability, agreed with the customer${row.promised_by?` (${packingTime(row.promised_by,now)})`:''}`;
 return row.promised_by?`Promised by ${packingTime(row.promised_by,now)} (24 working hours)`:'';
}
function packingCallCustomer(row,now=Date.now()){
 if(!row||row.customer_waiting||!row.promised_by||['delivered','cancelled'].includes(row.status))return false;
 return now>Date.parse(row.promised_by)+2*864e5;
}
// One live line for the person who placed the order (order_live_status). proformaStatus is the Pro forma's own.
function orderLiveText(s,now=Date.now(),proformaStatus=''){
 if(!s)return proformaStatus==='accepted'?'Submitted to accounting · waiting for approval':'';
 let text=({
  accounts_approved:'Approved by accounts · tax invoice next',
  tax_invoice_created:'Tax invoice made · going to packing next',
  sent_to_sales:`Sent to packing ${packingSince(s.queued_at,now)} ago · waiting in the queue (position ${s.queue_position??'?'})`,
  packing:`Being packed${s.packer_name?` by ${s.packer_name}`:''} · ${packingSince(s.taken_at,now)}`,
  ready:`Packed · ready for delivery${s.ready_at?' '+packingTime(s.ready_at,now):''}`,
  out_for_delivery:'Out for delivery',
  delivered:`Delivered${s.delivered_at?' '+packingTime(s.delivered_at,now):''}`,
  cancelled:'Delivery cancelled'
 })[s.status]||String(s.status||'').replaceAll('_',' ');
 if(s.status==='sent_to_sales'&&s.customer_waiting)text+=' · customer waiting';
 if(s.status==='sent_to_sales'&&s.blocked_reason)text+=` · ${s.blocked_reason}`;
 if(s.call_customer)text+=' · Call the customer';
 return text;
}
function packingItemsHtml(items,withBatch=false){
 return `<ul class="packing-items">${(items||[]).map(item=>`<li><b>${esc(item.quantity)} ${esc(item.uom||'')}</b> ${esc(item.name)}${withBatch&&item.batch?` <small>batch ${esc(item.batch)}</small>`:''}</li>`).join('')}</ul>`;
}

// ---- Data ----
async function loadPackingBoard(){
 const actor=me?.user_id,epoch=packingEpoch;
 const r=await client.rpc('packing_queue_board');
 if(me?.user_id!==actor||epoch!==packingEpoch)return false;
 if(r.error){packingError=r.error.message||'The packing queue could not load.';return true;}
 packingBoard=r.data;packingError='';packingLoadedAt=Date.now();
 // The board's time is the server's; the clocks run on this device, corrected by the difference.
 packingBoard.offset=Date.parse(r.data.now)-Date.now();
 return true;
}
function packingNow(){return Date.now()+(packingBoard?.offset||0);}

// ---- Phone page ----
function packingCard(row,mine=false){
 const now=packingNow(),minutes=packingMinutes(row.taken_at,now),level=packingLevel(minutes,packingBoard.amber_minutes,packingBoard.overdue_minutes);
 return `<article class="packing-card packing-${level||'ok'}${row.customer_waiting?' packing-lobby':''}" data-packing-id="${esc(row.id)}">
  <div class="packing-card-head"><strong class="packing-number">${esc(row.delivery_number)}</strong>${row.customer_waiting?'<span class="packing-badge">Customer waiting</span>':''}<span class="packing-clock" data-clock="${esc(row.taken_at||'')}" aria-label="Time packing">${esc(packingClock(row.taken_at,now))}</span></div>
  <p class="packing-client">${esc(row.organization)}${row.location?` · ${esc(row.location)}`:''}</p>
  ${mine?'':`<p class="muted">Packed by <strong>${esc(row.packer_name||'someone from Delivery progress')}</strong> · started ${esc(packingTime(row.taken_at,now))}</p>`}
  ${packingItemsHtml(row.items,true)}
  ${level==='red'?`<p class="packing-alert" role="alert">Over ${esc(packingBoard.overdue_minutes)} minutes. The stores head and the owner have been told.</p>`:level==='amber'?`<p class="packing-warn">Over ${esc(packingBoard.amber_minutes)} minutes. Finish soon or tell the stores head.</p>`:''}
  ${row.call_customer?'<p class="packing-call">Call the customer: more than 2 days past the promise.</p>':''}
  <p class="muted">${esc(packingPromiseText(row,now))}</p>
  <div class="actions">${mine?`<button type="button" class="primary-action packing-big" data-packing-packed="${esc(row.id)}" data-version="${esc(row.version)}">Packed</button>`:''}${packingBoard.can_release?`<button type="button" data-packing-release="${esc(row.id)}" data-version="${esc(row.version)}">Put back in queue</button>`:''}</div>
 </article>`;
}
function packingWaitingRow(row,index){
 const now=packingNow();
 return `<li class="packing-waiting${row.customer_waiting?' packing-lobby':''}${row.blocked_reason?' packing-blocked':''}"><span class="packing-place">${index+1}</span><span class="packing-waiting-main"><strong>${esc(row.delivery_number)}</strong>${row.customer_waiting?' <span class="packing-badge">Customer waiting</span>':''}<small>${esc(row.organization)} · waiting ${esc(packingSince(row.queued_at,now))}</small>${row.blocked_reason?`<small class="packing-warn-text">${esc(row.blocked_reason)}</small>`:''}${row.call_customer?'<small class="packing-call-text">Call the customer</small>':''}<details><summary>Items</summary>${packingItemsHtml(row.items)}</details></span></li>`;
}
function packingQueueHtml(){
 if(packingError&&!packingBoard)return `<section class="card"><h1>Packing queue</h1><p role="alert">${esc(packingError)}</p><button type="button" data-packing-refresh>Try again</button></section>`;
 if(!packingBoard)return '<p role="status">Loading the packing queue…</p>';
 const b=packingBoard,mine=b.packing.find(row=>row.id===b.mine),others=b.packing.filter(row=>row.id!==b.mine);
 return `<section class="packing-page">
 <div class="heading"><div><small>ORDERS · STORES</small><h1>Packing queue</h1></div><div class="actions"><button type="button" data-packing-refresh>Refresh</button><button type="button" data-packing-screen>TV screen</button></div></div>
 ${packingError?`<p class="warning" role="alert">Could not refresh: ${esc(packingError)}</p>`:''}
 ${mine?`<h2>Your order</h2>${packingCard(mine,true)}<p class="muted">When every item is packed and checked, press <strong>Packed</strong>. Then you can take the next order.</p>`
  :`<div class="packing-take"><button type="button" class="primary-action packing-big" data-packing-take ${b.waiting.length?'':'disabled'}>Take next</button><p class="muted">${b.waiting.length?`${b.waiting.length} waiting. You get the top order: customers waiting in the lobby first, then the oldest delivery.`:'Nothing is waiting to be packed.'}</p></div>`}
 <h2>Waiting · ${b.waiting.length}</h2>
 ${b.waiting.length?`<ol class="packing-waiting-list">${b.waiting.map(packingWaitingRow).join('')}</ol>`:'<p class="empty">Nothing waiting.</p>'}
 ${b.coming?.count?`<p class="muted">Coming from accounts: ${esc(b.coming.count)}${b.coming.customer_waiting?` (${esc(b.coming.customer_waiting)} with the customer waiting)`:''}.</p>`:''}
 <h2>Being packed · ${b.packing.length}</h2>
 ${others.length?others.map(row=>packingCard(row)).join(''):'<p class="muted">Nobody else is packing.</p>'}
 </section>`;
}

// ---- TV screen ----
function packingScreenHtml(){
 if(!packingBoard)return `<section class="packing-tv-screen"><p class="packing-tv-loading">${esc(packingError||'Loading the packing queue…')}</p><button type="button" class="packing-tv-exit" data-packing-exit>Exit</button></section>`;
 const b=packingBoard,now=packingNow();
 return `<section class="packing-tv-screen" aria-label="Packing queue screen">
 <div class="packing-tv-col"><h1>Waiting <span>${b.waiting.length}</span></h1>
  <ol class="packing-tv-waiting">${b.waiting.slice(0,18).map(row=>`<li class="${row.customer_waiting?'packing-tv-lobby':''}${row.blocked_reason?' packing-tv-blocked':''}"><b>${esc(packingShortNumber(row.delivery_number))}</b><span>${esc(row.organization)}<small>${row.customer_waiting?'CUSTOMER WAITING · ':''}${esc(packingSince(row.queued_at,now))}${row.blocked_reason?' · waiting for stock':''}${row.call_customer?' · CALL THE CUSTOMER':''}</small><small class="packing-tv-items">${esc((row.items||[]).map(item=>`${item.quantity} ${item.name}`).join(' · '))}</small></span></li>`).join('')||'<li class="packing-tv-none">Nothing waiting</li>'}</ol>
  ${b.waiting.length>18?`<p class="packing-tv-more">and ${b.waiting.length-18} more</p>`:''}
 </div>
 <div class="packing-tv-col"><h1>Packing now <span>${b.packing.length}</span></h1>
  <ul class="packing-tv-packing">${b.packing.map(row=>{const level=packingLevel(packingMinutes(row.taken_at,now),b.amber_minutes,b.overdue_minutes);return `<li class="packing-tv-${level||'ok'}${row.customer_waiting?' packing-tv-lobby':''}"><b>${esc(packingShortNumber(row.delivery_number))}</b><span><strong>${esc(row.packer_name||'—')}</strong>${esc(row.organization)}<small class="packing-tv-items">${esc((row.items||[]).map(item=>`${item.quantity} ${item.name}`).join(' · '))}</small>${row.call_customer?'<small>CALL THE CUSTOMER</small>':''}</span><time data-clock="${esc(row.taken_at||'')}">${esc(packingClock(row.taken_at,now))}</time></li>`;}).join('')||'<li class="packing-tv-none">Nobody packing</li>'}</ul>
 </div>
 <footer class="packing-tv-foot"><span>Red = customer waiting in the lobby, goes first. Amber after ${esc(b.amber_minutes)} min, red after ${esc(b.overdue_minutes)} min.</span><span data-packing-updated>${packingError?'Not updating — check the connection':`Updated ${esc(packingTime(new Date(packingLoadedAt).toISOString()))}`}</span><button type="button" class="packing-tv-exit" data-packing-exit>Exit</button></footer>
 </section>`;
}

function syncPackingScreenMode(){document.body.classList.toggle('packing-tv',typeof view!=='undefined'&&view==='packing'&&packingSection==='screen');}
function packingDraw(){
 if(view!=='packing')return packingStop();
 // Typing in the release form must not be wiped by a redraw.
 if(document.querySelector('dialog[open]'))return;
 $('#content').innerHTML=packingSection==='screen'?packingScreenHtml():packingQueueHtml();
 bindPackingQueue();
}
// The clocks on screen, every second, without reloading.
function packingTickClocks(){
 if(view!=='packing')return packingStop();
 const now=packingNow();
 document.querySelectorAll('[data-clock]').forEach(el=>{if(el.dataset.clock)el.textContent=packingClock(el.dataset.clock,now);});
 document.querySelectorAll('[data-packing-id]').forEach(card=>{
  const row=packingBoard?.packing.find(r=>r.id===card.dataset.packingId);if(!row)return;
  const level=packingLevel(packingMinutes(row.taken_at,now),packingBoard.amber_minutes,packingBoard.overdue_minutes)||'ok';
  card.classList.remove('packing-ok','packing-amber','packing-red');card.classList.add('packing-'+level);
 });
 document.querySelectorAll('.packing-tv-packing li time').forEach(el=>{
  const li=el.closest('li'),level=packingLevel(packingMinutes(el.dataset.clock,now),packingBoard?.amber_minutes,packingBoard?.overdue_minutes)||'ok';
  li.classList.remove('packing-tv-ok','packing-tv-amber','packing-tv-red');li.classList.add('packing-tv-'+level);
 });
}
async function packingRefresh(){
 if(view!=='packing'){packingStop();return;}
 if(document.hidden&&packingSection!=='screen')return;
 if(await loadPackingBoard())packingDraw();
}
async function packingWorkspace(){
 syncPackingScreenMode();
 packingStop();
 packingDraw();
 await loadPackingBoard();
 packingDraw();
 packingTimer=setInterval(()=>{packingRefresh().catch(()=>{});},packingRefreshMs);
 packingTick=setInterval(packingTickClocks,1000);
}
function openPackingSection(section){packingSection=section==='screen'?'screen':'queue';}
async function packingAct(work,done){
 const actor=me?.user_id;
 const r=await work();
 if(me?.user_id!==actor)return;
 if(r.error)throw Error(r.error.message);
 await loadPackingBoard();packingDraw();
 if(done)message(typeof done==='function'?done(r.data):done);
}
function bindPackingQueue(){
 document.querySelectorAll('[data-packing-refresh]').forEach(b=>b.onclick=()=>run(async()=>{await loadPackingBoard();packingDraw();}));
 document.querySelectorAll('[data-packing-take]').forEach(b=>b.onclick=()=>run(()=>packingAct(()=>client.rpc('packing_take_next'),data=>data?.id?`You are packing ${data.delivery_number}.`:'Nothing could be taken: the waiting orders are short of stock.')));
 document.querySelectorAll('[data-packing-packed]').forEach(b=>b.onclick=()=>{
  if(!confirm('Is every item packed and checked?'))return;
  run(()=>packingAct(()=>client.rpc('packing_mark_packed',{p_id:b.dataset.packingPacked,p_expected_version:Number(b.dataset.version)}),data=>`${data?.delivery_number||'Order'} packed · ready for delivery. Press Take next for the next one.`));
 });
 document.querySelectorAll('[data-packing-release]').forEach(b=>b.onclick=()=>{
  const row=packingBoard?.packing.find(r=>r.id===b.dataset.packingRelease);
  actionForm('Put back in the packing queue',`<p><strong>${esc(row?.delivery_number||'')}</strong>${row?.packer_name?` · with ${esc(row.packer_name)}`:''}</p><p class="muted">It goes back to its place in the queue. Stock picked for it is freed again.</p><label><span>Why?</span><textarea name="reason" required minlength="3" maxlength="500"></textarea></label>`,async values=>{
   await packingAct(()=>client.rpc('packing_release',{p_id:b.dataset.packingRelease,p_expected_version:Number(b.dataset.version),p_reason:values.reason}),'Put back in the packing queue.');
  });
 });
 document.querySelectorAll('[data-packing-screen]').forEach(b=>b.onclick=()=>{document.querySelector('#nav [data-view="packing"][data-workspace-section="screen"]')?.click();});
 document.querySelectorAll('[data-packing-exit]').forEach(b=>b.onclick=()=>{document.querySelector('#nav [data-view="packing"][data-workspace-section="queue"]')?.click();});
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('packing-tv')&&!document.querySelector('dialog[open]'))document.querySelector('#nav [data-view="packing"][data-workspace-section="queue"]')?.click();});

// ---- Live order line on Pro formas and leads ----
// Elements marked data-live-status="<proforma id>" (data-live-proforma-status = the Pro forma's own status) get one
// line from order_live_status. Answers are kept 20 seconds, so typing in a search box does not ask again each time.
const liveStatusCache=new Map();let liveStatusAsk=0;
async function decorateOrderLiveStatus(){
 const boxes=[...document.querySelectorAll('[data-live-status]')];if(!boxes.length||typeof client==='undefined'||!client)return;
 const actor=me?.user_id,now=Date.now(),ask=++liveStatusAsk;
 const stale=[...new Set(boxes.map(box=>box.dataset.liveStatus))].filter(id=>!(now-(liveStatusCache.get(id)?.at||0)<20000)).slice(0,300);
 if(stale.length){
  const r=await client.rpc('order_live_status',{p_proforma_ids:stale});
  if(me?.user_id!==actor)return;
  if(!r.error){const got=new Map((r.data||[]).map(row=>[row.proforma_id,row]));for(const id of stale)liveStatusCache.set(id,{at:now,row:got.get(id)||null});}
 }
 if(ask!==liveStatusAsk)return;
 for(const box of document.querySelectorAll('[data-live-status]')){
  const entry=liveStatusCache.get(box.dataset.liveStatus);if(!entry)continue;
  const text=orderLiveText(entry.row,Date.now(),box.dataset.liveProformaStatus||'');
  box.textContent=text;box.hidden=!text;
  box.classList.toggle('order-live-call',!!entry.row?.call_customer);
  box.classList.toggle('order-live-lobby',!!entry.row?.customer_waiting);
 }
}
function orderLiveHtml(record,tag='p'){
 if(!record||record.status!=='accepted')return '';
 return `<${tag} class="order-live" data-live-status="${esc(record.id)}" data-live-proforma-status="accepted" aria-live="polite" hidden></${tag}>`;
}
setInterval(()=>{if(typeof me!=='undefined'&&me&&!document.hidden&&document.querySelector('[data-live-status]')){liveStatusCache.clear();decorateOrderLiveStatus().catch(()=>{});}},30000);
