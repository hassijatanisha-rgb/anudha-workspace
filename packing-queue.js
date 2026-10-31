'use strict';
// Packing queue (migration 078). Each packer presses Take next on their phone and gets the top order: customers
// waiting in the lobby (red) first, then delivery orders, oldest first. Take next is the Start packing step, given to
// the person who pressed it; Packed is Mark ready for delivery. One order per packer. The owner or the stores head can
// put an order back in the queue. The TV screen (#/go/packing/screen) shows the queue in large type for the stores.
// The page reads one summary (packing_queue_board) every 10 seconds; the clocks tick every second in between.
let packingSection='queue',packingBoard=null,packingError='',packingEpoch=0,packingTimer=null,packingTick=null,packingLoadedAt=0,packingReadRequest=0,packingAction=0,packingPendingAction=0;
const packingRefreshMs=10000;
function clearPackingQueue(){packingEpoch++;packingReadRequest++;packingAction++;packingPendingAction=0;packingBoard=null;packingError='';packingStop();liveStatusCache.clear();}
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
 if(s.status==='delivered'&&s.remaining_quantity>0)text=`Partly delivered · ${s.remaining_quantity} units still to deliver`;
 if(s.status==='sent_to_sales'&&s.customer_waiting)text+=' · customer waiting';
 if(s.status==='sent_to_sales'&&s.blocked_reason)text+=` · ${s.blocked_reason}`;
 if(s.quantity_summary){const q=s.quantity_summary;text=`${Number(q.invoiced).toLocaleString('en-GB')} of ${Number(q.ordered).toLocaleString('en-GB')} units invoiced · ${Number(q.pending).toLocaleString('en-GB')} pending invoice. ${text}`;}
 if(s.call_customer)text+=' · Call the customer';
 return text;
}
function packingItemsHtml(items,withBatch=false){
 return `<ul class="packing-items">${(items||[]).map(item=>`<li><b>${esc(item.quantity)} ${esc(item.uom||'')}</b> ${esc(item.name)}${withBatch&&item.batch?` <small>batch ${esc(item.batch)}</small>`:''}</li>`).join('')}</ul>`;
}

// ---- Data ----
async function loadPackingBoard(){
 const actor=me,epoch=packingEpoch,request=++packingReadRequest;
 const r=await client.rpc('packing_queue_board');
 if(me!==actor||epoch!==packingEpoch||request!==packingReadRequest)return false;
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
  <div class="packing-card-head"><strong class="packing-number">${esc(row.delivery_number)}</strong>${row.customer_waiting?`<span class="packing-badge chip chip--${statusTone('waiting')}">Customer waiting</span>`:`<span class="tag chip chip--${statusTone('packing')}">Packing</span>`}<span class="packing-clock" data-clock="${esc(row.taken_at||'')}" aria-label="Time packing">${esc(packingClock(row.taken_at,now))}</span></div>
  <p class="packing-client">${esc(row.organization)}${row.location?` · ${esc(row.location)}`:''}</p>
  <details${mine?' open':''}><summary>Order details</summary>
  ${mine?'':`<p class="muted">Packed by <strong>${esc(row.packer_name||'someone from Delivery progress')}</strong> · started ${esc(packingTime(row.taken_at,now))}</p>`}
  ${packingItemsHtml(row.items,true)}
  <p class="muted">${esc(packingPromiseText(row,now))}</p></details>
  ${level==='red'?`<p class="packing-alert" role="alert">Over ${esc(packingBoard.overdue_minutes)} minutes. The stores head and the owner have been told.</p>`:level==='amber'?`<p class="packing-warn">Over ${esc(packingBoard.amber_minutes)} minutes. Finish soon or tell the stores head.</p>`:''}
  ${row.call_customer?'<p class="packing-call">Call the customer: more than 2 days past the promise.</p>':''}
  ${mine||packingBoard.can_release?`<label class="packing-check"><input type="checkbox" data-packing-checked="${esc(row.id)}"><span>Every item is packed and checked</span></label>`:''}
  <div class="actions">${packingBoard.can_release?`<button type="button" data-packing-release="${esc(row.id)}" data-version="${esc(row.version)}">Put back in queue</button>`:''}${mine||packingBoard.can_release?`<button type="button" class="primary-action packing-big" data-packing-packed="${esc(row.id)}" data-version="${esc(row.version)}" disabled title="Check every item before marking this order packed.">Packed</button>`:''}</div>
 </article>`;
}
function packingWaitingRow(row,index){
 const now=packingNow();
 return `<li data-packing-waiting-id="${esc(row.id)}" class="packing-waiting${row.customer_waiting?' packing-lobby':''}${row.blocked_reason?' packing-blocked':''}"><span class="packing-place">${index+1}</span><span class="packing-waiting-main"><strong>${esc(row.delivery_number)}</strong>${row.customer_waiting?` <span class="packing-badge chip chip--${statusTone('waiting')}">Customer waiting</span>`:''}<small>${esc(row.organization)} · waiting ${esc(packingSince(row.queued_at,now))}</small>${row.blocked_reason?`<small class="packing-warn-text">${esc(row.blocked_reason)}</small>`:''}${row.call_customer?'<small class="packing-call-text">Call the customer</small>':''}<details><summary>Items</summary>${packingItemsHtml(row.items)}</details></span></li>`;
}
function packingPersonalHtml(){
 const b=packingBoard,mine=b.packing.find(row=>row.id===b.mine);
 return mine?`<h2>Your order</h2>${packingCard(mine,true)}`
  :`<div class="packing-take"><button type="button" class="primary-action packing-big" data-packing-take ${b.waiting.length?'':'disabled'}>Take next</button><p class="muted">${b.waiting.length?`${b.waiting.length} orders waiting.`:'Nothing is waiting to be packed.'}</p></div>`;
}
function packingQueueHtml(){
 if(packingError&&!packingBoard)return `<section class="packing-page">${workspacePageHeader({title:'Packing queue',actions:'<button type="button" data-packing-refresh>Try again</button>'})}<p role="alert">${esc(packingError)}</p></section>`;
 if(!packingBoard)return workspaceSkeleton('packing','Loading the packing queue…');
 const b=packingBoard,others=b.packing.filter(row=>row.id!==b.mine);
 return `<section class="packing-page">
 ${workspacePageHeader({title:'Packing queue',subtitle:'Orders waiting and being packed.',titleAttrs:'data-packing-title tabindex="-1"',actions:'<button type="button" data-packing-refresh>Refresh</button><button type="button" data-packing-screen>TV screen</button>'})}
 <details><summary>How this page works</summary><p>Take next selects customers waiting in the lobby first, then the oldest delivery. Check every item before pressing Packed. You can then take the next order.</p><p>Orders awaiting Accounts release enter the queue after invoicing and stock reservation.</p></details>
 <p class="warning" role="alert" data-packing-error${packingError?'':' hidden'}>${packingError?`Could not refresh: ${esc(packingError)}`:''}</p>
 <div data-packing-personal>${packingPersonalHtml()}</div>
 <h2 data-packing-waiting-count>Waiting · ${b.waiting.length}</h2>
 <ol class="packing-waiting-list">${b.waiting.map(packingWaitingRow).join('')}</ol><p class="empty" data-packing-empty${b.waiting.length?' hidden':''}>Nothing waiting.</p>
 ${b.coming?.count?`<section class="notice"><h2>Awaiting Accounts release · ${esc(b.coming.count)}</h2>${(b.coming.items||[]).map(row=>`<p><strong>${esc(row.delivery_number)}</strong> · ${esc(row.organization)} · ${row.status==='tax_invoice_created'?'Invoice reserved; Accounts must send to packing':'Invoice and stock reservation required'} · ${row.owner_name?'Current step owner: '+esc(row.owner_name):'No step owner assigned'} <button type="button" data-packing-open-incoming="${esc(row.id)}">Open delivery</button></p>`).join('')}</section>`:''}
 <h2 data-packing-active-count>Being packed · ${b.packing.length}</h2>
 <div data-packing-others>${others.map(row=>packingCard(row)).join('')}</div><p class="muted" data-packing-others-empty${others.length?' hidden':''}>Nobody else is packing.</p>
 </section>`;
}

// ---- TV screen ----
function packingScreenHtml(){
 const header=workspacePageHeader({title:'Packing queue',back:'<button type="button" class="packing-tv-exit" data-packing-exit aria-label="Exit TV screen to packing queue">Exit</button>'});
 if(!packingBoard)return `<section class="packing-tv-screen" aria-label="Packing queue screen">${header}${packingError?`<p class="packing-tv-loading" role="alert">${esc(packingError)}</p>`:workspaceSkeleton('packing-screen','Loading the packing queue…')}</section>`;
 const b=packingBoard,now=packingNow();
 return `<section class="packing-tv-screen" aria-label="Packing queue screen">
 ${header}
 <div class="packing-tv-col"><h2>Waiting <span>${b.waiting.length}</span></h2>
  <ol class="packing-tv-waiting">${b.waiting.slice(0,18).map(row=>`<li class="${row.customer_waiting?'packing-tv-lobby':''}${row.blocked_reason?' packing-tv-blocked':''}"><b>${esc(packingShortNumber(row.delivery_number))}</b><span>${esc(row.organization)}<small>${row.customer_waiting?'CUSTOMER WAITING · ':''}${esc(packingSince(row.queued_at,now))}${row.blocked_reason?' · waiting for stock':''}${row.call_customer?' · CALL THE CUSTOMER':''}</small><small class="packing-tv-items">${esc((row.items||[]).map(item=>`${item.quantity} ${item.name}`).join(' · '))}</small></span></li>`).join('')||'<li class="packing-tv-none">Nothing waiting</li>'}</ol>
  ${b.waiting.length>18?`<p class="packing-tv-more">and ${b.waiting.length-18} more</p>`:''}
 </div>
 <div class="packing-tv-col"><h2>Packing now <span>${b.packing.length}</span></h2>
  <ul class="packing-tv-packing">${b.packing.map(row=>{const level=packingLevel(packingMinutes(row.taken_at,now),b.amber_minutes,b.overdue_minutes);return `<li class="packing-tv-${level||'ok'}"><b>${esc(packingShortNumber(row.delivery_number))}</b><span><strong>${esc(row.packer_name||'—')}${row.customer_waiting?` <em class="packing-tv-badge chip chip--${statusTone('waiting')}">CUSTOMER WAITING</em>`:''}</strong>${esc(row.organization)}<small class="packing-tv-items">${esc((row.items||[]).map(item=>`${item.quantity} ${item.name}`).join(' · '))}</small>${row.call_customer?'<small>CALL THE CUSTOMER</small>':''}</span><time data-clock="${esc(row.taken_at||'')}">${esc(packingClock(row.taken_at,now))}</time></li>`;}).join('')||'<li class="packing-tv-none">Nobody packing</li>'}</ul>
 </div>
 <footer class="packing-tv-foot"><span>Customers waiting in the lobby go first. Amber after ${esc(b.amber_minutes)} min, red after ${esc(b.overdue_minutes)} min.</span><span data-packing-updated>${packingError?'Not updating — check the connection':`Updated ${esc(new Date(packingLoadedAt).toLocaleTimeString('en-GB'))}`}</span></footer>
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
 if(packingPendingAction||(document.hidden&&packingSection!=='screen'))return;
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
function packingApplyRecords(data){
 if(!data||!Array.isArray(data.waiting_ids)||!Array.isArray(data.packing_ids)||!Array.isArray(data.rows)||data.waiting_ids.length>100||data.packing_ids.length>100||data.rows.length>200||typeof data.can_release!=='boolean'||!Number.isFinite(Date.parse(data.now)))throw Error('The packing update was incomplete.');
 const changed=new Set(),ids=[...data.waiting_ids,...data.packing_ids],rows=new Map([...packingBoard.waiting,...packingBoard.packing].map(row=>[row.id,row]));
 if(new Set(ids).size!==ids.length||new Set(data.rows.map(row=>row.id)).size!==data.rows.length)throw Error('The packing update contained duplicate orders.');
 for(const row of data.rows){if(!ids.includes(row.id)||!Array.isArray(row.items)||!Number.isSafeInteger(row.version)||row.status!==(data.waiting_ids.includes(row.id)?'sent_to_sales':'packing'))throw Error('The packing update was incomplete.');const old=rows.get(row.id);if(!old||Object.keys(row).some(key=>key!=='status'&&JSON.stringify(row[key])!==JSON.stringify(old[key])))changed.add(row.id);rows.set(row.id,row);}
 if(ids.some(id=>!rows.has(id)))throw Error('An order was missing from the packing update.');
 const next={...packingBoard,now:data.now,offset:Date.parse(data.now)-Date.now(),mine:data.mine,can_release:data.can_release,waiting:data.waiting_ids.map(id=>rows.get(id)),packing:data.packing_ids.map(id=>rows.get(id))};
 packingBoard=next;packingError='';
 return changed;
}
function packingPatchQueue(previous,changed,trigger){
 const target=$('#content'),page=target?.querySelector('.packing-page');if(!page||view!=='packing'||packingSection!=='queue')return;
 const active=document.activeElement,x=window.scrollX,y=window.scrollY;
 const node=html=>{const template=document.createElement('template');template.innerHTML=html;return template.content.firstElementChild;};
 const waiting=page.querySelector('.packing-waiting-list'),others=page.querySelector('[data-packing-others]');
 const focusedWaiting=[...waiting.children].find(child=>child.querySelector('summary')===active)?.dataset.packingWaitingId;
 if(previous.can_release!==packingBoard.can_release)for(const row of packingBoard.packing)changed.add(row.id);
 // Existing rows retain their disclosure and focus; only changed rows receive fresh controls and versions.
 for(const [container,rows,key,html] of [[waiting,packingBoard.waiting,'packingWaitingId',packingWaitingRow],[others,packingBoard.packing.filter(row=>row.id!==packingBoard.mine),'packingId',packingCard]]){
  const existing=new Map([...container.children].map(child=>[child.dataset[key],child])),keep=new Set(rows.map(row=>row.id));
  for(const [id,child] of existing)if(!keep.has(id))child.remove();
  rows.forEach((row,index)=>{
   let child=existing.get(row.id);
   if(!child||changed.has(row.id)){const next=node(key==='packingWaitingId'?html(row,index):html(row));if(child?.querySelector('details')?.open)next.querySelector('details').open=true;if(child)child.replaceWith(next);child=next;}
   if(container.children[index]!==child)container.insertBefore(child,container.children[index]||null);
   if(key==='packingWaitingId')child.querySelector('.packing-place').textContent=String(index+1);
  });
 }
 const personal=page.querySelector('[data-packing-personal]');
 if(previous.mine!==packingBoard.mine||changed.has(packingBoard.mine))personal.innerHTML=packingPersonalHtml();
 else if(!packingBoard.mine){const take=personal.querySelector('[data-packing-take]');packingSetDisabled(take,!packingBoard.waiting.length);personal.querySelector('p').textContent=packingBoard.waiting.length?`${packingBoard.waiting.length} waiting. You get the top order: customers waiting in the lobby first, then the oldest delivery.`:'Nothing is waiting to be packed.';}
 page.querySelector('[data-packing-waiting-count]').textContent=`Waiting · ${packingBoard.waiting.length}`;
 page.querySelector('[data-packing-active-count]').textContent=`Being packed · ${packingBoard.packing.length}`;
 page.querySelector('[data-packing-empty]').hidden=!!packingBoard.waiting.length;
 page.querySelector('[data-packing-others-empty]').hidden=packingBoard.packing.some(row=>row.id!==packingBoard.mine);
 const error=page.querySelector('[data-packing-error]');error.hidden=!packingError;error.textContent=packingError;
 bindPackingQueue();
 const actor=me,epoch=packingEpoch,focus=()=>{
  if(me!==actor||epoch!==packingEpoch||!page.isConnected||view!=='packing'||packingSection!=='queue')return;
  if(document.activeElement!==document.body&&document.activeElement?.isConnected)return;
  const id=focusedWaiting||trigger?.dataset.packingRelease||trigger?.dataset.packingPacked;
  const row=id&&[...waiting.children].find(child=>child.dataset.packingWaitingId===id);
  const next=row?.querySelector('summary')||personal.querySelector('[data-packing-packed],[data-packing-take]:not(:disabled)')||page.querySelector('[data-packing-title]');next?.focus({preventScroll:true});
 };
 if(active!==document.body&&active?.isConnected&&document.activeElement===document.body)active.focus({preventScroll:true});
 else if((active&&!active.isConnected)||(trigger&&!trigger.isConnected&&active===document.body))focus();
 const dialog=document.querySelector('dialog[open]');if(dialog&&trigger&&!trigger.isConnected)dialog.addEventListener('close',focus,{once:true});
 window.scrollTo({left:x,top:y,behavior:'instant'});
}
async function packingAct(work,done,kind,trigger){
 const actor=me,epoch=packingEpoch,section=packingSection,action=++packingAction;
 const current=()=>me===actor&&packingEpoch===epoch&&view==='packing'&&packingSection===section&&packingAction===action;
 packingPendingAction=action;packingReadRequest++;
 try{
  const r=await work();if(!current())return;if(r.error)throw Error(r.error.message);
  const previous=packingBoard;if(!previous)return;
  const text=typeof done==='function'?done(r.data):done;
  packingReadRequest++;
  if(kind==='packed'&&r.data?.id===trigger?.dataset.packingPacked&&r.data.status==='ready'&&previous.packing.length<100){
   packingBoard={...previous,mine:previous.mine===r.data.id?null:previous.mine,packing:previous.packing.filter(row=>row.id!==r.data.id)};packingError='';
   packingPatchQueue(previous,new Set([r.data.id]),trigger);
  }else{
   const ids=kind==='take'?previous.waiting.map(row=>row.id):[trigger?.dataset.packingRelease||r.data?.id];
   if(kind!=='take'&&r.data?.id)ids.unshift(r.data.id);
   try{const result=await client.rpc('packing_queue_records',{p_ids:[...new Set(ids.filter(Boolean))].slice(0,100),p_known_waiting_ids:previous.waiting.map(row=>row.id),p_known_packing_ids:previous.packing.map(row=>row.id)});
   if(!current())return;
   if(result.error)throw Error(result.error.message);const changed=packingApplyRecords(result.data);packingPatchQueue(previous,changed,trigger);}
   catch(error){
    if(!current())return;
    packingError=`Change saved, but the queue details could not refresh: ${error.message} Refresh before continuing.`;
    const warning=$('[data-packing-error]');if(warning){warning.hidden=false;warning.textContent=packingError;}
    document.querySelectorAll('[data-packing-take],[data-packing-packed],[data-packing-release]').forEach(button=>packingSetDisabled(button,true));
    message(packingError,true);return;
   }
  }
  if(r.data?.proforma_id)liveStatusCache.delete(r.data.proforma_id);
  if(text)message(text);
 }finally{if(packingPendingAction===action)packingPendingAction=0;}
}
function packingSetDisabled(button,disabled){
 button.disabled=disabled;
 // The action's final availability must survive restoration of its temporary busy state.
 const state=typeof actionFeedbackActive==='undefined'?null:actionFeedbackActive?.state;
 if(state?.node===button)state.disabled=disabled;
}
function bindPackingQueue(){
 document.querySelectorAll('[data-packing-refresh]').forEach(b=>b.onclick=()=>run(async()=>{await loadPackingBoard();packingDraw();}));
 document.querySelectorAll('[data-packing-take]').forEach(b=>b.onclick=()=>run(()=>packingAct(()=>client.rpc('packing_take_next'),data=>data?.id?`You are packing ${data.delivery_number}.`:'Nothing could be taken: the waiting orders are short of stock.','take',b)));
 document.querySelectorAll('[data-packing-packed]').forEach(button=>{
  const check=button.closest('[data-packing-id]').querySelector('[data-packing-checked]');
  if(check)check.onchange=()=>{packingSetDisabled(button,!check.checked||!!packingError||!!packingPendingAction);button.title=check.checked?'':'Check every item before marking this order packed.';};
  button.onclick=()=>{
   if(!check?.checked||!button.isConnected||packingError||packingPendingAction)return;
   return run(()=>packingAct(()=>client.rpc('packing_mark_packed',{p_id:button.dataset.packingPacked,p_expected_version:Number(button.dataset.version)}),data=>`${data?.delivery_number||'Order'} packed · ready for delivery.`,'packed',button));
  };
 });
 document.querySelectorAll('[data-packing-release]').forEach(b=>b.onclick=()=>{
  const row=packingBoard?.packing.find(r=>r.id===b.dataset.packingRelease);
  actionForm('Put back in the packing queue',`<p><strong>${esc(row?.delivery_number||'')}</strong>${row?.packer_name?` · with ${esc(row.packer_name)}`:''}</p><p class="muted">It goes back to its place in the queue. Tax invoice stock stays reserved. Stock selected when packing started is released, and its serial numbers must be entered again.</p><label><span>Why?</span><textarea name="reason" required minlength="3" maxlength="500"></textarea></label>`,async values=>{
   await packingAct(()=>client.rpc('packing_release',{p_id:b.dataset.packingRelease,p_expected_version:Number(b.dataset.version),p_reason:values.reason}),'Put back in the packing queue.','release',b);
  });
 });
 document.querySelectorAll('[data-packing-open-incoming]').forEach(button=>button.onclick=()=>run(()=>workOpenRecord({record_type:'delivery',record_id:button.dataset.packingOpenIncoming})));
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
