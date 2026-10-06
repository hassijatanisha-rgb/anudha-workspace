'use strict';

// Navigation only: these links reuse the existing permission-checked workflows.
const workspaceGroups=[
 {name:'Main',tone:'main',items:[
  ['My tasks','personal','task'],['Client accounts','contacts'],['Product search','inventory','catalog'],['Reports','reports'],
  ['My notes & reminders','personal','note'],['My calendar','personal','event'],['Travel requests','travel']
 ]},
 {name:'Orders',tone:'orders',items:[
  ['Leads','leads','leads'],['Website inquiries','requests','inquiries'],['Complaints','requests','complaints'],['Create Pro forma','sales','new'],['Current orders','sales','proformas'],['Tally invoices','tallyinvoices'],
  ['Delivery progress','sales','delivery'],['Pending stock orders','pending'],['Purchasing','purchasing','orders'],['Suppliers','purchasing','suppliers'],['Accounting forms','accounting']
 ]},
 {name:'Service',tone:'service',items:[
  ['Machines to install','service','installations'],['Service & maintenance schedule','service','schedule'],
  ['Service forms','service','forms']
 ]},
 {name:'Inventory',tone:'inventory',items:[
  ['Stock & availability','inventory','stock'],['Move stock','inventory','transfers'],['Godowns & locations','inventory','locations'],['Stock count','stockcount','count'],['Review stock counts','stockcount','review'],['Tally stock review','inventory','review']
 ]},
 {name:'System',tone:'system',items:[
  ['How to use','guide'],['Staff','staff'],['My settings','settings'],['Deleted items','recycle'],['Questions for the owner','approvals']
 ]}
];
// Shown only once the signed-in person is known to be the owner (app.js load) or to have accounting access.
// Keys are a view, or view:section for one page of a view.
const ownerOnlyViews=new Set(['staff','approvals','recycle','stockcount:review','inventory:review']);
async function showAccountingNavigation(){
 const item=document.querySelector('#nav [data-accounting-only]');if(!item)return;
 item.hidden=true;
 try{const result=await client.rpc('accounting_access');item.hidden=result?.data!==true}catch{item.hidden=true}
}
function installWorkspaceNavigation(){
 const nav=document.querySelector('#nav');
 // The stock count screen is temporary; ERP_CONFIG.stockCountEnabled=false removes it from the menu.
 const shown=([,target])=>target!=='stockcount'||globalThis.ERP_CONFIG?.stockCountEnabled!==false;
 nav.innerHTML=workspaceGroups.map(group=>`<section class="nav-group nav-${group.tone}" aria-label="${group.name}"><h2>${group.name}</h2>${group.items.filter(shown).map(([label,target,section])=>target?`<button type="button" data-view="${target}"${section?` data-workspace-section="${section}"`:''}${target==='staff'?' id="staffNav" hidden':''}${ownerOnlyViews.has(target)||ownerOnlyViews.has(`${target}:${section}`)?' data-owner-only hidden':''}${target==='accounting'?' data-accounting-only hidden':''}>${label}</button>`:`<div class="nav-unavailable">${label}<small>Not connected yet</small></div>`).join('')}</section>`).join('');
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
 // A message from the previous screen ("LD-000001 saved.") must not follow the user to a different screen.
 if(typeof message==='function')message('');
  if(button.dataset.view==='personal'){personalSection=section||'event';personalPage=0;}
  if(button.dataset.view==='leads'&&typeof openLeadSection==='function')openLeadSection(section);
 if(button.dataset.view==='purchasing'&&typeof openPurchaseSection==='function')openPurchaseSection(section);
 if(button.dataset.view==='stockcount'&&typeof openStockCountSection==='function')openStockCountSection(section);
 if(button.dataset.view==='sales'){if(typeof clearSalesPrefill==='function')clearSalesPrefill();
   if(typeof salesFocusedProforma!=='undefined')salesFocusedProforma='';
   salesSection=section==='new'?'proformas':section||'proformas';
   salesEditing=section==='new'?'new':'';
  }
  if(button.dataset.view==='service')serviceSection=section||'installations';
  if(button.dataset.view==='requests'&&typeof openRequestSection==='function')openRequestSection(section);
  if(button.dataset.view==='inventory')inventorySection=section||'stock';
 },true);
}
function syncWorkspaceNavigation(){
 if(typeof applyStockProtection==='function')applyStockProtection();
 document.querySelectorAll('#nav [data-view]').forEach(button=>{
  const target=button.dataset.view,section=button.dataset.workspaceSection;
  const current=target==='sales'?(salesEditing==='new'?'new':salesSection):target==='service'?serviceSection:target==='inventory'?inventorySection:target==='personal'?personalSection:target==='leads'&&typeof leadSection!=='undefined'?leadSection:target==='purchasing'&&typeof purchaseSection!=='undefined'?purchaseSection:target==='stockcount'&&typeof countTab!=='undefined'?countTab:target==='requests'&&typeof requestSection!=='undefined'?requestSection:null;
  const active=target===view&&(!section||section===current);
  button.classList.toggle('active',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
}
installWorkspaceNavigation();
