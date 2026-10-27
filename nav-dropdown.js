'use strict';
// Menu groups open and close like drop-downs. The group holding the open page stays open; the others the person
// opened are remembered on this device.
const navOpenKey='erp-nav-open';
function navOpenGroups(){try{return new Set(JSON.parse(localStorage.getItem(navOpenKey)||'[]'))}catch{return new Set()}}
function navSaveGroups(set){try{localStorage.setItem(navOpenKey,JSON.stringify([...set]))}catch{}}
function navMobileSet(open,restoreFocus=false){
 const nav=document.getElementById('nav'),toggle=document.getElementById('workspaceMenuToggle');
 nav.dataset.mobileOpen=String(open);toggle.setAttribute('aria-expanded',String(open));
 if(restoreFocus&&matchMedia('(max-width:800px)').matches)toggle.focus({preventScroll:true});
}
function navMobileSync(){
 const nav=document.getElementById('nav'),toggle=document.getElementById('workspaceMenuToggle');if(!toggle)return;
 toggle.hidden=nav.hidden;if(nav.hidden)navMobileSet(false);
 const current=nav.querySelector('[data-view].active:not([hidden])');
 toggle.textContent=current?`Menu · ${current.textContent.trim()}`:'Menu';
}
function navDropdownSetup(){
 const nav=document.getElementById('nav');if(!nav||nav.dataset.dropdown)return;nav.dataset.dropdown='1';
 const open=navOpenGroups();
 nav.querySelectorAll('.nav-group').forEach(group=>{
  const h=group.querySelector('h2');if(!h)return;const name=group.getAttribute('aria-label')||h.textContent;
  const toggle=document.createElement('button');toggle.type='button';toggle.className='nav-group-toggle';toggle.textContent=h.textContent;toggle.setAttribute('aria-expanded','false');
  h.replaceChildren(toggle);
  const set=on=>{group.classList.toggle('collapsed',!on);toggle.setAttribute('aria-expanded',String(on));};
  set(open.has(name)||name==='Main'||!!group.querySelector('button.active'));
  toggle.onclick=()=>{const on=group.classList.contains('collapsed');set(on);const s=navOpenGroups();on?s.add(name):s.delete(name);navSaveGroups(s);};
 });
 const toggle=document.createElement('button');toggle.id='workspaceMenuToggle';toggle.type='button';toggle.setAttribute('aria-controls','nav');
 nav.before(toggle);navMobileSet(false);navMobileSync();
 toggle.onclick=()=>navMobileSet(toggle.getAttribute('aria-expanded')!=='true');
 nav.addEventListener('click',event=>{
  if(!event.defaultPrevented&&event.target.closest('[data-view]')&&matchMedia('(max-width:800px)').matches)navMobileSet(false,true);
 });
 nav.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&matchMedia('(max-width:800px)').matches){event.preventDefault();navMobileSet(false,true);}
 });
}
function navDropdownSync(){document.querySelectorAll('#nav .nav-group.collapsed').forEach(g=>{if(g.querySelector('[data-view].active'))g.classList.remove('collapsed'),g.querySelector('.nav-group-toggle')?.setAttribute('aria-expanded','true');});navMobileSync();}
// Once the menu exists, watch only the menu: when another page becomes active, its group opens.
const navDropdownWatch=new MutationObserver(()=>{const nav=document.getElementById('nav');if(!nav)return;navDropdownSetup();navDropdownWatch.disconnect();
 new MutationObserver(navDropdownSync).observe(nav,{subtree:true,attributes:true,attributeFilter:['class','hidden']});navDropdownSync();});
navDropdownWatch.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',navDropdownSetup);
