'use strict';

// Navigation only: these links reuse the existing permission-checked workflows.
const workspaceGroups=[
 {name:'Main',tone:'main',items:[
  ['Client accounts','contacts'],['Product search','inventory','catalog'],
  ['My calendar','personal','event'],['To-do tasks · urgent first','personal','task'],['My notes & reminders','personal','note']
 ]},
 {name:'Orders',tone:'orders',items:[
  ['Current orders','sales','proformas'],['Create Pro forma','sales','new'],['Accounting forms','accounting'],
  ['Delivery progress','sales','delivery'],['Pending stock orders'],['Inquiries'],['Lead / Opportunity']
 ]},
 {name:'Service',tone:'service',items:[
  ['Machines to install','service','installations'],['Service & maintenance schedule','service','schedule'],
  ['Service forms','service','forms']
 ]},
 {name:'Inventory',tone:'inventory',items:[
  ['Stock & availability','inventory','stock'],['Move stock','inventory','transfers'],['Godowns & locations','inventory','locations']
 ]},
 {name:'System',tone:'system',items:[
  ['Staff','staff'],['Deleted items','recycle'],['Awaiting approval','approvals'],['Setup progress','checklist'],['Help','guide']
 ]}
];
function installWorkspaceNavigation(){
 const nav=document.querySelector('#nav');
 nav.innerHTML=workspaceGroups.map(group=>`<section class="nav-group nav-${group.tone}" aria-label="${group.name}"><h2>${group.name}</h2>${group.items.map(([label,target,section])=>target?`<button type="button" data-view="${target}"${section?` data-workspace-section="${section}"`:''}${target==='staff'?' id="staffNav" hidden':''}>${label}</button>`:`<div class="nav-unavailable">${label}<small>Not connected yet</small></div>`).join('')}</section>`).join('');
 nav.setAttribute('aria-label','Workspace sections');
 document.querySelector('main').before(nav);
 const header=document.querySelector('body>header');
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{
  document.documentElement.style.setProperty('--workspace-header-height',`${header.getBoundingClientRect().height}px`);
 }).observe(header);
 document.addEventListener('click',event=>{
  const button=event.target.closest('#nav [data-view]');
  if(!button||busy)return;
  const section=button.dataset.workspaceSection;
  if(button.dataset.view==='personal'){personalSection=section||'event';personalPage=0;}
  if(button.dataset.view==='sales'){
   salesSection=section==='new'?'proformas':section||'proformas';
   salesEditing=section==='new'?'new':'';
  }
  if(button.dataset.view==='service')serviceSection=section||'installations';
  if(button.dataset.view==='inventory')inventorySection=section||'stock';
 },true);
}
function syncWorkspaceNavigation(){
 document.querySelectorAll('#nav [data-view]').forEach(button=>{
  const target=button.dataset.view,section=button.dataset.workspaceSection;
  const current=target==='sales'?(salesEditing==='new'?'new':salesSection):target==='service'?serviceSection:target==='inventory'?inventorySection:target==='personal'?personalSection:null;
  const active=target===view&&(!section||section===current);
  button.classList.toggle('active',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
}
installWorkspaceNavigation();
