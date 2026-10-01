'use strict';
// Stock pages: no printing, no copying, and a faint watermark with the viewer's name and the time, so a photo or
// screenshot of stock shows who took it. A browser cannot block screenshots; the watermark makes them traceable.
// Quotes go to customers as Pro formas, never as stock lists.
const stockProtectedViews=new Set(['inventory','stockcount']);
let stockWatermarkTimer=0;
function stockProtectionActive(){return typeof view!=='undefined'&&stockProtectedViews.has(view)&&!!me}
function stockWatermarkImage(text){
 const safe=String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="260"><text x="40" y="160" transform="rotate(-20 280 130)" font-family="sans-serif" font-size="16" fill="rgba(20,45,38,0.09)">${safe}</text></svg>`;
 return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}
function applyStockProtection(){
 const active=stockProtectionActive();
 document.body.classList.toggle('stock-protected',active);
 let mark=document.querySelector('#stockWatermark');
 if(!active){mark?.remove();clearInterval(stockWatermarkTimer);stockWatermarkTimer=0;return;}
 if(!mark){mark=document.createElement('div');mark.id='stockWatermark';mark.setAttribute('aria-hidden','true');document.body.append(mark);}
 const paint=()=>{const name=typeof employeeName==='function'?employeeName(me.user_id):'';mark.style.backgroundImage=stockWatermarkImage(`${name} · ${new Date().toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} · Anudha internal`);};
 paint();
 if(!stockWatermarkTimer)stockWatermarkTimer=setInterval(()=>{if(stockProtectionActive())paint();},60000);
}
for(const type of ['copy','cut','contextmenu','dragstart'])document.addEventListener(type,event=>{
 if(!document.body.classList.contains('stock-protected'))return;
 if(event.target.closest?.('input,textarea,select'))return;
 event.preventDefault();
 if(type!=='contextmenu'&&typeof message==='function')message('Stock lists cannot be copied. Send customers a Pro forma instead.',true);
});
window.addEventListener('beforeprint',()=>{if(document.body.classList.contains('stock-protected')&&typeof message==='function')message('Stock pages cannot be printed. Send customers a Pro forma instead.',true);});
