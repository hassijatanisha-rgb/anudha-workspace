'use strict';

// Markup slots belong to the caller; database text must pass through esc first.
function workspacePageHeader({title,subtitle='',titleAttrs='',back='',breadcrumbs='',actions=''}={}){
 return `<div class="workspace-page-header">${breadcrumbs?`<nav class="workspace-page-breadcrumbs" aria-label="Breadcrumb">${breadcrumbs}</nav>`:''}<div class="workspace-page-toolbar">${back?`<div class="workspace-page-back">${back}</div>`:''}<div class="workspace-page-heading"><h1${titleAttrs?' '+titleAttrs:''}>${esc(title||'')}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${actions?`<div class="actions workspace-page-actions">${actions}</div>`:''}</div></div>`;
}

let workspaceHeaderScrollInstalled=false;
function syncWorkspaceHeaderScroll(){document.body.classList.toggle('workspace-page-scrolled',window.scrollY>0);}
function installWorkspaceHeaderScroll(){
 if(!workspaceHeaderScrollInstalled){workspaceHeaderScrollInstalled=true;window.addEventListener('scroll',syncWorkspaceHeaderScroll,{passive:true});}
 syncWorkspaceHeaderScroll();
 installWorkspacePrimaryAction();
}

let workspacePrimaryButton=null,workspacePrimaryResize=null,workspacePrimaryWatch=null;
function workspacePrimaryCandidate(){
 const content=document.getElementById('content'),nav=document.getElementById('nav');
 if(!content||!nav||nav.hidden)return null;
 const header=content.querySelector('.workspace-page-header'),actions=header?.querySelector('.workspace-page-actions');
 const button=actions?.querySelector('button#newProforma,button#newProduct,button#newLead,button#newPending,button#newPurchase,button#newSupplier,button#travelNew,button[data-contract-new]');
 if(!button?.isConnected||button.parentElement!==actions||button.closest('form')||button.closest('dialog'))return null;
 for(let node=button;node;node=node.parentElement)if(node.hidden||node.inert)return null;
 if(button.id==='newLead'&&content.querySelector('#leadBack'))return null;
 if(button.id==='newPending'&&content.querySelector('#pendingForm,[data-pending-history-output]'))return null;
 if(button.id==='travelNew'&&content.querySelector('#travelClose'))return null;
 if(button.hasAttribute('data-contract-new')&&content.querySelector('[data-contract-back]'))return null;
 return button;
}
function syncWorkspacePrimaryAction(){
 const button=workspacePrimaryCandidate();if(button===workspacePrimaryButton)return;
 workspacePrimaryResize?.disconnect();workspacePrimaryResize=null;
 workspacePrimaryButton?.removeAttribute('data-workspace-primary');workspacePrimaryButton=button;
 const root=document.documentElement;root.removeAttribute('data-workspace-primary');root.style.removeProperty('--workspace-primary-height');
 if(!button)return;
 button.setAttribute('data-workspace-primary','');root.setAttribute('data-workspace-primary','');
 const measure=()=>{
  if(workspacePrimaryButton!==button||workspacePrimaryCandidate()!==button)return;
  const height=button.getBoundingClientRect().height;
  if(Number.isFinite(height)&&height>0)root.style.setProperty('--workspace-primary-height',`${Math.ceil(height)}px`);
 };
 // The original control can wrap at larger text sizes; reserve its rendered height.
 workspacePrimaryResize=new ResizeObserver(measure);workspacePrimaryResize.observe(button);measure();
}
function installWorkspacePrimaryAction(){
 if(!workspacePrimaryWatch){workspacePrimaryWatch=new MutationObserver(syncWorkspacePrimaryAction);workspacePrimaryWatch.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','inert']});}
 syncWorkspacePrimaryAction();
}
