'use strict';
// Disclosure preferences belong to the original, permission-filtered menu at every width.
const navOpenKey='erp-nav-open',navShortcuts=new Map(),navGroupMotions=new WeakMap();
let navMobileVersion=0;
function navOpenGroups(){try{const groups=new Set(JSON.parse(localStorage.getItem(navOpenKey)||'[]'));for(const [old,name]of [['Main','Workspace'],['Orders','Sales'],['Inventory','Stores'],['System','Admin']])if(groups.delete(old))groups.add(name);return groups}catch{return new Set()}}
function navSaveGroups(set){try{localStorage.setItem(navOpenKey,JSON.stringify([...set]))}catch{}}
function navGroupSet(group,open,{immediate=false}={}){
 const panel=group.querySelector('.nav-group-items'),toggle=group.querySelector('.nav-group-toggle'),previous=navGroupMotions.get(group);
 if(previous?.open===open&&(!immediate||!previous.animation))return previous.finished;
 const rendered=panel.hidden?null:getComputedStyle(panel),offset='translateY(calc(-1 * var(--space-2)))',start={opacity:rendered?.opacity||0,transform:rendered?.transform||offset};
 previous?.animation?.cancel();
 const state={open,animation:null,finished:null};navGroupMotions.set(group,state);
 group.classList.toggle('collapsed',!open);toggle.setAttribute('aria-expanded',String(open));
 if(!open&&!group.hidden&&panel.contains(document.activeElement))toggle.focus({preventScroll:true});
 panel.inert=!open;
 if(immediate){panel.hidden=!open;state.finished=Promise.resolve(true);return state.finished;}
 panel.hidden=false;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,style=getComputedStyle(panel),frames=reduced?[{opacity:start.opacity},{opacity:open?1:0}]:[start,{opacity:open?1:0,transform:open?'none':offset}];
 const animation=panel.animate(frames,{duration:parseFloat(style.getPropertyValue(reduced?'--m-fade':'--m-base')),easing:style.getPropertyValue('--ease-out')});state.animation=animation;
 state.finished=animation.finished.then(()=>{if(navGroupMotions.get(group)!==state||!group.isConnected||group.querySelector('.nav-group-items')!==panel)return false;panel.hidden=!open;state.animation=null;return true;},()=>false);
 return state.finished;
}
function navIcon(view){
 const paths={dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',personal:'M9 5h11v16H4V5h2 M9 3h6v4H9z M8 13l2 2 5-5',contacts:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-3a4 4 0 0 0-3-4',inventory:'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',sales:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',service:'M14 6a5 5 0 0 0-6 6L3 17l4 4 5-5a5 5 0 0 0 6-6l-3 3-4-4z',books:'M3 4h7a3 3 0 0 1 2 1 3 3 0 0 1 2-1h7v16h-7a3 3 0 0 0-2 1 3 3 0 0 0-2-1H3z M12 5v16',reports:'M4 3v18h17 M8 17v-5 M13 17V7 M18 17V4',travel:'M3 9l18-6-6 18-3-9z M12 12l9-9',packing:'M3 7h18v14H3z M2 3h20v4H2z M9 12h6',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',guide:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4 M12 18v1 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20'};
 return `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[view]||paths.sales}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function navLabelButton(button,label,view){
 button.innerHTML=navIcon(view);const text=document.createElement('span');text.className='nav-label';text.textContent=label;button.append(text);button.setAttribute('aria-label',label);button.title=label;
}
function navFocusDestination(button){
 if(!button?.isConnected||button.hidden||button.disabled||button.closest('#nav')?.hidden)return null;
 const group=button.closest('.nav-group'),panel=button.closest('.nav-group-items');if(group?.hidden)return null;
 if(!panel?.hidden&&!panel?.inert)return button;
 const toggle=group?.querySelector('.nav-group-toggle');return toggle?.isConnected&&!toggle.hidden&&!toggle.disabled?toggle:null;
}
function navFocusTarget(nav){const buttons=[...nav.querySelectorAll('[data-view]')];return navFocusDestination(buttons.find(button=>button.getAttribute('aria-current')==='page'))||buttons.map(navFocusDestination).find(Boolean);}
async function navMobileSet(open,restoreFocus=false,immediate=false){
 const nav=document.getElementById('nav'),panel=document.getElementById('workspaceMenuPanel'),toggle=document.getElementById('workspaceMenuToggle');
 const phone=matchMedia('(max-width:600px)').matches,wasOpen=toggle.getAttribute('aria-expanded')==='true',request=++navMobileVersion,focused=document.activeElement;
 open=!!open&&phone&&!nav.hidden;nav.dataset.mobileOpen=String(open);toggle.setAttribute('aria-expanded',String(open));
 const finished=await setWorkspacePopover(panel,phone?open:!nav.hidden,{anchor:toggle,immediate:immediate||!phone||nav.hidden});
 if(!finished||request!==navMobileVersion||nav.hidden||!phone)return;
 if(open&&document.activeElement===toggle)navFocusTarget(nav)?.focus({preventScroll:true});
 else if(!open&&restoreFocus&&wasOpen&&(document.activeElement===focused||document.activeElement===document.body))toggle.focus({preventScroll:true});
}
function navMobileSync(){
 const nav=document.getElementById('nav'),bar=document.getElementById('workspaceShortcuts'),toggle=document.getElementById('workspaceMenuToggle');if(!bar)return;
 const help=document.getElementById('howToUse');if(help&&!help.querySelector('.nav-label'))navLabelButton(help,help.textContent,'guide');
 bar.hidden=nav.hidden;
 const originals=[...nav.querySelectorAll('[data-view]')].filter(button=>!button.hidden),preferred=[['personal','task'],['contacts',''],['inventory','catalog'],['sales','proformas'],['service','installations']];
 const chosen=[...new Set([...preferred.map(([view,section])=>originals.find(button=>button.dataset.view===view&&(button.dataset.workspaceSection||'')===section)).filter(Boolean),...originals])].slice(0,5);
 for(const [original,shortcut]of navShortcuts)if(!chosen.includes(original)){shortcut.remove();navShortcuts.delete(original);}
 chosen.forEach((original,index)=>{
  let shortcut=navShortcuts.get(original);
  if(!shortcut){shortcut=document.createElement('button');shortcut.type='button';navLabelButton(shortcut,({'personal:task':'Tasks','contacts:':'Clients','inventory:catalog':'Items','sales:proformas':'Orders','service:installations':'Service'})[original.dataset.view+':'+(original.dataset.workspaceSection||'')]||original.textContent.trim(),original.dataset.view);const label=shortcut.querySelector('.nav-label').textContent,fullLabel=original.textContent.trim();shortcut.setAttribute('aria-label',label===fullLabel?label:label+' — '+fullLabel);shortcut.title=fullLabel;shortcut.onclick=event=>{event.preventDefault();event.stopPropagation();if(!nav.hidden&&original.isConnected&&!original.hidden&&!original.disabled)return navigateWorkspace(original);};navShortcuts.set(original,shortcut);}
  shortcut.disabled=original.disabled;
  if(original.getAttribute('aria-current')==='page')shortcut.setAttribute('aria-current','page');else shortcut.removeAttribute('aria-current');
  if(bar.children[index]!==shortcut)bar.insertBefore(shortcut,bar.children[index]||toggle);
 });
 const active=originals.find(button=>button.getAttribute('aria-current')==='page');
 if(active&&!chosen.includes(active))toggle.setAttribute('aria-current','page');else toggle.removeAttribute('aria-current');
 if(nav.hidden||!matchMedia('(max-width:600px)').matches)navMobileSet(false,false,true);
}
function navShellResize(){
 const nav=document.getElementById('nav'),bar=document.getElementById('workspaceShortcuts');if(!bar)return;
 const phone=matchMedia('(max-width:600px)').matches,mode=phone?'phone':matchMedia('(max-width:1199.99px)').matches?'rail':'wide';
 if(nav.dataset.shellMode===mode)return;
 const active=document.activeElement;nav.dataset.shellMode=mode;navMobileSet(false,false,true);
 if(phone&&nav.contains(active))document.getElementById('workspaceMenuToggle').focus({preventScroll:true});
 else if(!phone&&bar.contains(active)){const original=navFocusDestination([...navShortcuts].find(([,shortcut])=>shortcut===active)?.[0])||navFocusTarget(nav);original?.focus({preventScroll:true});}
}
function navDropdownSetup(){
 const nav=document.getElementById('nav');if(!nav||nav.dataset.dropdown)return;nav.dataset.dropdown='1';
 const open=navOpenGroups();
 nav.querySelectorAll('[data-view]').forEach(button=>navLabelButton(button,button.textContent.trim(),button.dataset.view));
 nav.querySelectorAll('.nav-group').forEach((group,index)=>{
  const h=group.querySelector('h2');if(!h)return;const name=group.getAttribute('aria-label')||h.textContent;
  const toggle=document.createElement('button');toggle.type='button';toggle.className='nav-group-toggle';navLabelButton(toggle,h.textContent,{Workspace:'dashboard',Sales:'sales',Accounts:'books',Service:'service',Stores:'inventory',Admin:'settings'}[name]);toggle.setAttribute('aria-expanded','false');
  h.replaceChildren(toggle);
  const panel=document.createElement('div');panel.className='nav-group-items';panel.id=`workspaceNavGroup${index}`;panel.hidden=true;
  for(const child of [...group.children])if(child!==h)panel.append(child);group.append(panel);toggle.setAttribute('aria-controls',panel.id);
  navGroupSet(group,open.has(name)||name==='Workspace'||!!group.querySelector('button.active'),{immediate:true});
  toggle.onclick=()=>{const on=group.classList.contains('collapsed'),finished=navGroupSet(group,on),s=navOpenGroups();on?s.add(name):s.delete(name);navSaveGroups(s);return finished;};
 });
 const panel=document.createElement('div');panel.id='workspaceMenuPanel';nav.before(panel);panel.append(nav);
 const bar=document.createElement('nav');bar.id='workspaceShortcuts';bar.setAttribute('aria-label','Quick navigation');
 const toggle=document.createElement('button');toggle.id='workspaceMenuToggle';toggle.type='button';toggle.setAttribute('aria-controls','workspaceMenuPanel');toggle.setAttribute('aria-expanded','false');navLabelButton(toggle,'More','dashboard');bar.append(toggle);panel.after(bar);
 toggle.onclick=event=>{event.preventDefault();event.stopPropagation();return navMobileSet(toggle.getAttribute('aria-expanded')!=='true');};
 bar.addEventListener('keydown',event=>{if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){event.preventDefault();event.stopPropagation();return navMobileSet(false,true);}const buttons=[...bar.querySelectorAll('button')].filter(button=>!button.disabled),index=buttons.indexOf(event.target);if(index<0)return;const next=event.key==='ArrowRight'?(index+1)%buttons.length:event.key==='ArrowLeft'?(index+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:null;if(next!==null){event.preventDefault();buttons[next].focus();}});
 nav.addEventListener('keydown',event=>{if(event.key==='Escape'&&matchMedia('(max-width:600px)').matches){event.preventDefault();event.stopPropagation();navMobileSet(false,true);}});
 document.addEventListener('click',event=>{if(toggle.getAttribute('aria-expanded')==='true'&&!panel.contains(event.target)&&!bar.contains(event.target))navMobileSet(false);});
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{const height=bar.getBoundingClientRect().height;if(height)document.documentElement.style.setProperty('--workspace-shortcut-height',`${height}px`);}).observe(bar);
 window.addEventListener('resize',navShellResize);
 navDropdownSync();navShellResize();
}
function navDropdownSync(){
 document.querySelectorAll('#nav .nav-group').forEach(group=>{
  const wasHidden=group.hidden,allowed=[...group.querySelectorAll('[data-view]')].some(button=>!button.hidden);if(group.hidden===allowed)group.hidden=!allowed;
  const active=group.querySelector('[data-view].active:not([hidden])');
  if(!allowed)navGroupSet(group,false,{immediate:true});
  else if((active&&group.navActiveButton!==active)||(wasHidden&&navOpenGroups().has(group.getAttribute('aria-label'))))navGroupSet(group,true);
  group.navActiveButton=active;
 });navMobileSync();
}
const navDropdownWatch=new MutationObserver(()=>{const nav=document.getElementById('nav');if(!nav)return;navDropdownSetup();navDropdownWatch.disconnect();
 new MutationObserver(navDropdownSync).observe(nav,{subtree:true,attributes:true,attributeFilter:['class','hidden','disabled','aria-current']});navDropdownSync();});
navDropdownWatch.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',navDropdownSetup);
