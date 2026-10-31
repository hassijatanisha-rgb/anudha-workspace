import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installStockTransition} from './stock-transition.mjs';
const read=file=>readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const refresh=read('workspace-refresh.js'),nav=read('workspace-navigation.js');
export const leaveScopeSource=refresh.slice(refresh.indexOf('function workspaceRefreshScope()'),refresh.indexOf('function workspaceRefreshReference('));
export const leaveContextSource=nav.slice(nav.indexOf('let navWhileBusy='),nav.indexOf('async function navigateWorkspace('));
// Use the production context and guard sequencing in isolated feature fixtures.
// Unmounted feature guards are inert; integration tests load all authored scripts.
export function leaveContextGlobals(ctx){
 installStockTransition(ctx);
 for(const [key,value]of Object.entries({me:{user_id:'fixture'},view:'sales',sessionLoadEpoch:0,location:{hash:''},salesSection:'proformas',salesFocusedProforma:'',salesFocusedDelivery:'',salesEditing:'',booksSection:'overview',askConfirm:async()=>false,returnCreditPostingConfirmLeave:()=>true,financialImportConfirmLeave:async()=>true,openingReceivablesConfirmLeave:async()=>true,salesConfirmLeave:async()=>true,inventoryConfirmLeave:async()=>true,confirmPurchasingLeave:async()=>true}))if(!(key in ctx))ctx[key]=value;
 vm.runInContext(leaveScopeSource,ctx);
}
export function installLeaveContext(ctx){
 leaveContextGlobals(ctx);vm.runInContext(leaveContextSource,ctx);
}
