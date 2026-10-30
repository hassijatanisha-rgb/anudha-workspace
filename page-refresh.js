'use strict';
// A page refreshed while it is on screen (after a save, or Refresh) stays visible, dimmed and marked busy, until the
// new version is drawn, and the redraw keeps the person's place. Only arriving at a page shows its loading line.
// Before, every refresh after a save blanked the page to "Loading…" and jumped back to the top.
// The page is known by its address (view and section); a different page always shows the loading line.
let pageShown=null,pageRefreshing=null,pageScrollWanted=null,pagePlaceWatch=null;
function pageKey(){return `${typeof view==='undefined'?'':view}|${typeof location==='undefined'?'':location.hash}`}
const pageIdValue=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The person's place: what sits a third of the way down the window (a short piece of text) inside the record it
// belongs to (the nearest card or row with a record id), and how far from the top it is. After the redraw the same
// text in the same record is put back at the same height, even when panels are added above it. If that text is
// gone, the record itself is used; without a record, the scroll position.
function pagePlace(content){
 const at=typeof document.elementFromPoint==='function'?document.elementFromPoint(Math.round(window.innerWidth/2),Math.round(window.innerHeight/3)):null;
 let mark=null,record=null;
 for(let el=at;el&&el!==content;el=el.parentElement){
  if(!mark){const text=(el.innerText||'').trim();if(text&&text.length<=200)mark={tag:el.tagName,text,top:el.getBoundingClientRect().top};}
  if(!record)for(const attr of el.attributes)if(attr.name.startsWith('data-')&&pageIdValue.test(attr.value)){record={selector:`${el.tagName.toLowerCase()}[${attr.name}="${attr.value}"]`,top:el.getBoundingClientRect().top};break;}
  if(record)break;
 }
 if(!at||!content.contains(at))return null;
 return record?{...record,mark}:null;
}
function pageRestorePlace(content,want){
 const record=want.place&&content.querySelector(want.place.selector);
 if(!record)return window.scrollTo(want.x,want.y);
 const mark=want.place.mark,same=mark&&[...record.querySelectorAll(mark.tag)].find(el=>(el.innerText||'').trim()===mark.text);
 if(same)window.scrollBy(0,same.getBoundingClientRect().top-mark.top);
 else window.scrollBy(0,record.getBoundingClientRect().top-want.place.top);
}
// While the place is held, the browser's own scroll anchoring is off: both correcting the same late panel moved the
// page twice as far (measured on Delivery). It is back on as soon as the hold ends.
function pageForgetPlace(){pageScrollWanted=null;if(pagePlaceWatch){pagePlaceWatch.disconnect();pagePlaceWatch=null;document.documentElement.style.overflowAnchor='';}}
// Whatever draws #content, remember which page it was; the first redraw after a refresh ends that refresh, and the
// place is held for 3 seconds while late panels arrive, until the person scrolls, clicks or types.
function pageObserve(content){
 new MutationObserver(()=>{
  const key=pageKey(),r=pageRefreshing;
  if(r){
   pageRefreshing=null;content.removeAttribute('aria-busy');
   if(r.key===key){
    pageForgetPlace();pageScrollWanted={key,...r.refresh,until:Date.now()+3000};
    pagePlaceWatch=new MutationObserver(()=>{const want=pageScrollWanted;if(!want||pageKey()!==want.key||Date.now()>want.until)return pageForgetPlace();pageRestorePlace(content,want);});
    pagePlaceWatch.observe(content,{childList:true,subtree:true});document.documentElement.style.overflowAnchor='none';
    setTimeout(()=>{if(pageScrollWanted&&pageScrollWanted.until<=Date.now())pageForgetPlace();},3100);
   }
  }
  const want=pageScrollWanted;
  if(want&&(want.key!==key||Date.now()>want.until))pageForgetPlace();
  else if(want)pageRestorePlace(content,want);
  pageShown={key,node:content.firstElementChild};
 }).observe(content,{childList:true});
 for(const type of ['wheel','touchstart','keydown','mousedown'])addEventListener(type,pageForgetPlace,{passive:true,capture:true});
}
function pageLoading(text){
 const content=$('#content');if(!content)return;
 const key=pageKey(),same=pageShown?.key===key&&!!pageShown.node&&pageShown.node.parentElement===content;
 pageSettle();
 if(!same){content.innerHTML=`<p role="status">${String(text).replace(/[&<>"]/g,c=>`&#${c.charCodeAt(0)};`)}</p>`;return;}
 const old=[...content.children];
 const place=pagePlace(content);
 for(const node of old)node.classList.add('is-refreshing');
 content.setAttribute('aria-busy','true');
 pageRefreshing={key,content,refresh:{old,place,x:window.scrollX,y:window.scrollY}};
}
// A refresh that ends without a redraw (it failed, or the person moved on) must not leave the page dimmed.
function pageSettle(){
 const r=pageRefreshing;if(!r)return;
 pageRefreshing=null;r.content.removeAttribute?.('aria-busy');
 for(const node of r.refresh.old)node.classList.remove('is-refreshing');
}
if(typeof document!=='undefined'&&document.getElementById?.('content'))pageObserve(document.getElementById('content'));
