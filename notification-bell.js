'use strict';
// Bell in the top header: new things for the signed-in person. Three kinds, each read under the person's own read rules:
//  tasks   — open tasks someone else gave me, not seen yet
//  work    — open work (handoffs) someone else handed me, not seen yet
//  results — tasks I gave someone else that were done or cancelled in the last 7 days, not seen yet
// "Seen" is a time per kind, kept per person on this device (localStorage). Opening My tasks marks all three seen;
// pressing an item marks its kind seen. The badge uses count-only reads (head: true); the list loads only when opened.
// Refreshes when the person moves between pages and every 2 minutes.
let bellCounts=null,bellEpoch=0,bellLastRefresh=0,bellOpen=false,bellItems=null,bellError='';
const bellKinds=[['tasks','New tasks for you'],['work','Work handed to you'],['results','Results of tasks you gave']];
const bellResultDays=7,bellListSize=5;
function clearNotificationBell(){bellEpoch++;bellCounts=null;bellLastRefresh=0;bellOpen=false;bellItems=null;bellError='';}
function bellStorage(){try{return globalThis.localStorage||null}catch{return null}}
function bellKey(userId){return `anudha.bell.seen.${userId}`;}
function bellSeen(userId,storage=bellStorage()){
 try{const saved=JSON.parse(storage?.getItem(bellKey(userId))||'{}');return Object.fromEntries(bellKinds.map(([kind])=>[kind,typeof saved?.[kind]==='string'&&Number.isFinite(Date.parse(saved[kind]))?saved[kind]:'']));}
 catch{return {tasks:'',work:'',results:''};}
}
function bellMarkSeen(userId,kinds,now=new Date(),storage=bellStorage()){
 if(!userId)return;
 const seen=bellSeen(userId,storage);for(const kind of kinds)seen[kind]=now.toISOString();
 try{storage?.setItem(bellKey(userId),JSON.stringify(seen));}catch{}
}
// Results look back 7 days, or to when they were last seen if that is later.
function bellSince(kind,seen,now=Date.now()){
 if(kind!=='results')return seen[kind]||'';
 const week=new Date(now-bellResultDays*864e5).toISOString();
 return seen.results&&seen.results>week?seen.results:week;
}
// The read for one kind. count=true asks for the number only.
function bellQuery(kind,userId,since,count){
 const columns=kind==='work'?'id,record_type,record_id,record_label,task,assigned_by,created_at':kind==='tasks'?'id,task_number,title,assigned_by,created_at':'id,task_number,title,assignee_user_id,status,close_note,closed_at';
 let q=client.from(kind==='work'?'work_assignments':'team_tasks').select(count?'id':columns,count?{count:'exact',head:true}:undefined);
 if(kind==='results')q=q.eq('assigned_by',userId).neq('assignee_user_id',userId).neq('closed_by',userId).in('status',['done','cancelled']).gt('closed_at',since);
 else{q=q.eq('assignee_user_id',userId).neq('assigned_by',userId).eq('status','open');if(since)q=q.gt('created_at',since);}
 return count?q:q.order(kind==='results'?'closed_at':'created_at',{ascending:false}).limit(bellListSize);
}
function bellTotal(counts){return counts?bellKinds.reduce((sum,[kind])=>sum+(Number(counts[kind])||0),0):0;}
function bellBadge(total){return total>9?'9+':String(total);}
async function refreshNotificationBell(force=false){
 const actor=me?.user_id;if(!actor||!bellInstall())return;
 if(!force&&Date.now()-bellLastRefresh<10000)return;
 bellLastRefresh=Date.now();
 const epoch=++bellEpoch,seen=bellSeen(actor);
 const results=await Promise.all(bellKinds.map(([kind])=>bellQuery(kind,actor,bellSince(kind,seen),true)));
 if(epoch!==bellEpoch||me?.user_id!==actor)return;
 // A kind that could not be read is left out of the count rather than blocking the others.
 bellCounts=Object.fromEntries(bellKinds.map(([kind],i)=>[kind,results[i].error?null:results[i].count||0]));
 bellRender();
 if(bellOpen)await bellLoadList();
}
async function bellLoadList(){
 const actor=me?.user_id;if(!actor)return;
 const epoch=bellEpoch,seen=bellSeen(actor);
 const results=await Promise.all(bellKinds.map(([kind])=>bellQuery(kind,actor,bellSince(kind,seen),false)));
 if(epoch!==bellEpoch||me?.user_id!==actor)return;
 bellError=results.find(r=>r.error)?.error?.message||'';
 bellItems=Object.fromEntries(bellKinds.map(([kind],i)=>[kind,results[i].data||[]]));
 bellRender();
}
// One line per item, in plain words.
function bellItemText(kind,row){
 if(kind==='tasks')return `${row.title} · from ${employeeName(row.assigned_by)}`;
 if(kind==='work')return `${row.record_label} · ${row.task} · from ${employeeName(row.assigned_by)}`;
 return `${employeeName(row.assignee_user_id)} ${row.status==='done'?'finished':'cancelled'}: ${row.title}${row.close_note?` — ${row.close_note}`:''}`;
}
function bellPanel(){
 if(!bellItems)return `<p role="status">Loading…</p>`;
 const total=bellTotal(bellCounts);
 const groups=bellKinds.map(([kind,label])=>{
  const rows=bellItems[kind]||[],more=(Number(bellCounts?.[kind])||0)-rows.length;
  return rows.length?`<section><h3>${label}</h3><ul>${rows.map((row,i)=>`<li><button type="button" data-bell-item="${kind}:${i}">${esc(bellItemText(kind,row))}</button></li>`).join('')}</ul>${more>0?`<button type="button" class="bell-more" data-bell-more="${kind}">and ${more} more</button>`:''}</section>`:'';
 }).join('');
 return `${bellError?`<p role="alert">Some updates could not load: ${esc(bellError)}</p>`:''}${groups||'<p class="muted">Nothing new for you.</p>'}${total?'<button type="button" class="bell-clear" data-bell-clear>Mark all as seen</button>':''}`;
}
function bellRender(){
 const box=document.getElementById('bell');if(!box)return;
 const total=bellTotal(bellCounts),button=box.querySelector('.bell-button'),badge=box.querySelector('.bell-count'),panel=box.querySelector('.bell-panel');
 badge.textContent=total?bellBadge(total):'';badge.hidden=!total;
 button.setAttribute('aria-label',total?`Updates: ${total} new`:'Updates: nothing new');
 button.setAttribute('aria-expanded',String(bellOpen));
 panel.hidden=!bellOpen;
 if(bellOpen)panel.innerHTML=`<h2>Updates</h2>${bellPanel()}`;
}
function bellGoToTasks(){
 if(typeof message==='function')message('');
 view='personal';personalSection='task';personalPage=0;
 return run(async()=>render());
}
function bellSetOpen(open){bellOpen=open;bellRender();if(open){bellItems=null;bellRender();bellLoadList().catch(error=>{bellError=error.message;bellItems={};bellRender();});}}
function bellChoose(kind,row){
 bellMarkSeen(me?.user_id,[kind]);bellSetOpen(false);
 if(kind==='work'&&row&&typeof workOpenRecord==='function'){workOpenRecord(row);refreshNotificationBell(true).catch(()=>{});return;}
 bellGoToTasks();
}
// Adds the bell to the header once someone is signed in (sign-out empties the header, which removes it).
function bellInstall(){
 const identity=document.getElementById('identity');if(!identity||!me)return null;
 let box=document.getElementById('bell');if(box)return box;
 box=document.createElement('div');box.id='bell';box.className='bell';
 box.innerHTML='<button type="button" class="bell-button" aria-haspopup="true" aria-expanded="false" aria-label="Updates"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/></svg><span class="bell-count" hidden></span></button><div class="bell-panel" hidden></div>';
 identity.prepend(box);
 box.querySelector('.bell-button').onclick=()=>bellSetOpen(!bellOpen);
 box.querySelector('.bell-panel').addEventListener('click',event=>{
  const item=event.target.closest('[data-bell-item]'),more=event.target.closest('[data-bell-more]');
  if(item){const [kind,i]=item.dataset.bellItem.split(':');return bellChoose(kind,bellItems?.[kind]?.[Number(i)]);}
  if(more)return bellChoose(more.dataset.bellMore,null);
  if(event.target.closest('[data-bell-clear]')){bellMarkSeen(me?.user_id,bellKinds.map(([kind])=>kind));bellSetOpen(false);refreshNotificationBell(true).catch(()=>{});}
 });
 return box;
}
document.addEventListener('click',event=>{if(bellOpen&&!event.target.closest('#bell'))bellSetOpen(false);});
document.addEventListener('keydown',event=>{if(bellOpen&&event.key==='Escape'){bellSetOpen(false);document.querySelector('#bell .bell-button')?.focus();}});
setInterval(()=>{if(me&&!document.hidden)refreshNotificationBell(true).catch(()=>{});},120000);
