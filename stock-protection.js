'use strict';
// Stock pages: no printing or copying, with a faint viewer/time trace in the page margin.
// Browsers cannot block screenshots; a cropped image may omit the margin trace.
// Quotes go to customers as Pro formas, never as stock lists.
const stockProtectedViews=new Set(['inventory','stockcount']);
let stockWatermarkTimer=0;
function stockProtectionActive(){return typeof view!=='undefined'&&stockProtectedViews.has(view)&&!!me}
function applyStockProtection(){
 const active=stockProtectionActive();
 document.body.classList.toggle('stock-protected',active);
 let mark=document.querySelector('#stockWatermark');
 if(!active){mark?.remove();clearInterval(stockWatermarkTimer);stockWatermarkTimer=0;return;}
 if(!mark){mark=document.createElement('div');mark.id='stockWatermark';mark.setAttribute('aria-hidden','true');document.body.append(mark);}
 const paint=()=>{const name=typeof employeeName==='function'?employeeName(me.user_id):'';mark.textContent=`${name} · ${new Date().toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} · Anudha internal`;};
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
