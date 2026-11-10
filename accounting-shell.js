'use strict';
const accountingMenu=[
 ['Workspace',[['overview','Overview']]],
 ['Transactions',[['invoices','Sales invoices'],['receipts','Customer receipts'],['suppliers','Bills & supplier payments'],['credits','Customer credits'],['journal','Journal entries']]],
 ['Accounts & reports',[['accounts','Chart of accounts'],['reports','Financial reports'],['valuation','Stock accounting']]],
 ['Tools',[['import','Import Excel'],['opening','Opening receivables'],['forms','Company forms']]]
];
function accountingShell(content,section){
 return `<div class="acct-shell"><aside class="acct-sidebar"><p class="acct-sidebar-title">Accounting</p><nav class="acct-module-nav" aria-label="Accounting sections">${accountingMenu.map(([group,items])=>`<div class="acct-nav-group"><p>${esc(group)}</p>${items.map(([key,label])=>`<button type="button" data-accounting-section="${key}"${key===section?' aria-current="page"':''}>${esc(label)}</button>`).join('')}</div>`).join('')}</nav></aside><div class="acct-main"><label class="acct-section-picker"><span>Accounting section</span><select data-accounting-picker>${accountingMenu.map(([group,items])=>`<optgroup label="${esc(group)}">${items.map(([key,label])=>`<option value="${key}"${key===section?' selected':''}>${esc(label)}</option>`).join('')}</optgroup>`).join('')}</select></label>${content}</div></div>`;
}
function bindAccountingShell(current){
 document.querySelectorAll('[data-accounting-section]').forEach(button=>button.onclick=()=>{
  if(!current()||!button.isConnected||button.disabled)return;
  const context=workspaceNavigationContext();
  return openAccountingSection(button.dataset.accountingSection,{context:{current:()=>current()&&button.isConnected&&context.current()}});
 });
 document.querySelectorAll('[data-accounting-picker]').forEach(select=>{
  const selected=select.value;
  select.onchange=()=>{
   const section=select.value;select.value=selected;
   if(!current()||!select.isConnected||select.disabled||section===selected)return;
   const context=workspaceNavigationContext();
   return openAccountingSection(section,{context:{current:()=>current()&&select.isConnected&&context.current()}});
  };
 });
}
