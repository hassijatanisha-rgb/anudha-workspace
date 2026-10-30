// Offline browser check of page-refresh.js: a page refreshed in place stays visible, dimmed and busy, keeps its scroll
// position, and is never left dimmed; arriving at another page shows its loading line. No network, no live data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
 await page.setContent('<main><section id="content"></section></main>');
 await page.addStyleTag({content:readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8')});
 await page.evaluate(()=>{window.$=s=>document.querySelector(s);window.view='sales';location.hash='#/go/sales/proformas';});
 await page.addScriptTag({content:readFileSync(new URL('../page-refresh.js',import.meta.url),'utf8')});
 const tick=()=>page.evaluate(()=>new Promise(r=>setTimeout(r,0)));
 const draw=label=>page.evaluate(label=>{$('#content').innerHTML=`<section class="card"><h1>${label}</h1>${'<p>row</p>'.repeat(200)}</section>`},label);
 const state=()=>page.evaluate(()=>({text:$('#content').innerText.slice(0,40),busy:$('#content').getAttribute('aria-busy'),dimmed:$('#content').querySelectorAll('.is-refreshing').length,opacity:getComputedStyle($('#content').firstElementChild).opacity,clickable:getComputedStyle($('#content').firstElementChild).pointerEvents,y:Math.round(scrollY)}));

 // Arriving at a page shows its loading line, then the page.
 await page.evaluate(()=>pageLoading('Loading Pro forma invoices and deliveries…'));
 assert.match((await state()).text,/^Loading Pro forma/);
 await draw('Pro formas v1');await tick();

 // Refreshing the page on screen keeps it visible, dimmed and not clickable, at the same scroll position.
 await page.evaluate(()=>scrollTo(0,1500));
 await page.evaluate(()=>pageLoading('Loading Pro forma invoices and deliveries…'));
 await page.waitForTimeout(250); // the dimming fades in over 150 ms
 let s=await state();
 assert.match(s.text,/^Pro formas v1/,'old page still visible');assert.equal(s.busy,'true');assert.equal(s.dimmed,1);
 assert.ok(Number(s.opacity)<1,'dimmed');assert.equal(s.clickable,'none','stale buttons cannot be pressed');
 // The redraw is shorter at first; a panel added a moment later makes it full height again.
 await page.evaluate(()=>{$('#content').innerHTML='<section class="card"><h1>Pro formas v2</h1><p>row</p></section>'});await tick();
 await page.evaluate(()=>{$('#content').insertAdjacentHTML('beforeend','<section>'+'<p>row</p>'.repeat(200)+'</section>')});await tick();
 s=await state();
 assert.match(s.text,/^Pro formas v2/);assert.equal(s.busy,null);assert.equal(s.dimmed,0);assert.equal(s.y,1500,'scroll position kept after a late panel');
 // Once the person scrolls, a late panel no longer moves the page.
 await page.evaluate(()=>{dispatchEvent(new WheelEvent('wheel'));scrollTo(0,200)});
 await page.evaluate(()=>{$('#content').insertAdjacentHTML('beforeend','<p>late</p>')});await tick();
 assert.equal((await state()).y,200,'the person\'s own scrolling wins');

 // A refresh that fails without redrawing is cleared by pageSettle (run() calls it when an action ends).
 await page.evaluate(()=>pageLoading('Loading…'));assert.ok((await state()).dimmed>0,'whole page dimmed');
 await page.evaluate(()=>pageSettle());s=await state();
 assert.equal(s.busy,null);assert.equal(s.dimmed,0);assert.equal(s.opacity,'1');

 // Another section of the same view is a different page: loading line, no dimmed leftovers.
 await page.evaluate(()=>{location.hash='#/go/sales/delivery'});
 await page.evaluate(()=>pageLoading('Loading Pro forma invoices and deliveries…'));
 s=await state();assert.match(s.text,/^Loading Pro forma/);assert.equal(s.busy,null);

 // A page drawn by other code (no pageLoading) is still recognised for the next refresh.
 await draw('Deliveries');await tick();
 await page.evaluate(()=>pageLoading('Loading…'));
 assert.match((await state()).text,/^Deliveries/);
 await page.evaluate(()=>pageSettle());

 // Another view at the same address never reuses the old page.
 await page.evaluate(()=>{window.view='service'});
 await page.evaluate(()=>pageLoading('Loading service and installation jobs…'));
 assert.match((await state()).text,/^Loading service/);

 // Cards with record ids, as on Delivery: the page on screen has its late panels; the redraw arrives without them
 // and they are added inside the cards a moment later. The card at the top of the window must stay where it was.
 await page.evaluate(()=>{window.view='sales';location.hash='#/go/sales/delivery'});
 const cards=(n,panels)=>Array.from({length:n},(_,i)=>`<article data-document-card="00000000-0000-4000-8000-${String(i).padStart(12,'0')}"><div style="height:200px">DN-${i}</div>${panels?'<div class="late" style="height:150px">Serial numbers</div>':''}</article>`).join('');
 const addPanels=()=>page.evaluate(()=>{for(const card of document.querySelectorAll('[data-document-card]'))card.insertAdjacentHTML('beforeend','<div class="late" style="height:150px">Serial numbers</div>')});
 await page.evaluate(html=>{$('#content').innerHTML=`<section>${html}</section>`},cards(20,true));await tick();
 await page.evaluate(()=>scrollTo(0,2850));
 const top=()=>page.evaluate(()=>Math.round(document.querySelector('[data-document-card$="000000000008"]').getBoundingClientRect().top));
 const placeBefore=await top();
 await page.evaluate(()=>pageLoading('Loading…'));
 await page.evaluate(html=>{$('#content').innerHTML=`<section>${html}</section>`},cards(20,false));await tick();
 await addPanels();await tick();
 const placeAfter=await top();
 assert.equal(placeAfter,placeBefore,'the same card stays at the same height on screen');

 // A card taller than the window, read from the middle: a panel added inside it, above the line being read, must
 // not move that line (Delivery cards with step history and serial panels).
 const tall=panel=>`<section><article data-document-card="00000000-0000-4000-8000-00000000aaaa"><h3 style="height:400px">DN-9</h3>${panel?'<div class="late" style="height:250px">Responsible: Asha</div>':''}<div style="height:500px">Packing</div><p>Packing in progress</p><div style="height:1500px">Lines</div></article></section>`;
 await page.evaluate(html=>{$('#content').innerHTML=html},tall(true));await tick();
 await page.evaluate(()=>{const p=[...document.querySelectorAll('p')].find(p=>p.textContent==='Packing in progress');scrollTo(0,p.getBoundingClientRect().top+scrollY-Math.round(innerHeight/3)+5)});
 const lineTop=()=>page.evaluate(()=>Math.round([...document.querySelectorAll('p')].find(p=>p.textContent==='Packing in progress').getBoundingClientRect().top));
 const lineBefore=await lineTop();
 await page.evaluate(()=>pageLoading('Loading…'));
 await page.evaluate(html=>{$('#content').innerHTML=html},tall(false));await tick();
 await page.evaluate(()=>document.querySelector('h3').insertAdjacentHTML('afterend','<div class="late" style="height:250px">Responsible: Asha</div>'));await tick();
 assert.equal(await lineTop(),lineBefore,'the line being read stays at the same height');
 assert.equal(await page.evaluate(()=>document.documentElement.style.overflowAnchor),'none','browser anchoring off while the place is held');
 await page.waitForTimeout(3300);
 assert.equal(await page.evaluate(()=>document.documentElement.style.overflowAnchor),'','and back on afterwards');

 assert.deepEqual(errors,[]);
 console.log('PASS: refresh in place keeps the page visible, dimmed, unclickable and at its scroll position; failures never leave it dimmed; other pages show their loading line.');
}finally{await browser.close();}
