'use strict';
// The phone or browser Back button goes to the previous ERP page instead of leaving the ERP (which meant signing in
// again). Each menu choice is recorded as #/go/<view>/<section>; going Back presses that menu choice again.
// Client and branch pages keep their own #/clients… addresses (client-profile-pages.js).
let navReplaying=false,navReplayPending=false;
function navHash(button){return `#/go/${button.dataset.view}${button.dataset.workspaceSection?'/'+button.dataset.workspaceSection:''}`;}
function navButtonFor(hash){
 const m=String(hash||'').match(/^#\/go\/([a-z]+)(?:\/([a-z-]+))?$/);
 const view=m?m[1]:'dashboard',section=m?.[2];
 return [...document.querySelectorAll(`#nav [data-view="${view}"]`)].find(b=>(b.dataset.workspaceSection||'')===(section||''))
  ||document.querySelector(`#nav [data-view="${view}"]`);
}
function navReplay(hash,tries=0){
 const button=navButtonFor(hash);
 if(!button||button.hidden||typeof me==='undefined'||!me||(typeof busy!=='undefined'&&busy)){navReplayPending=tries<40;if(tries<40)setTimeout(()=>navReplay(hash,tries+1),150);return;}
 navReplayPending=false;navReplaying=true;try{button.click();}finally{navReplaying=false;}
}
document.addEventListener('click',event=>{
 const button=event.target.closest?.('#nav [data-view]');
 if(!button||navReplaying||(typeof busy!=='undefined'&&busy))return;
 const hash=navHash(button);
 if(location.hash!==hash)history.pushState({erp:1},'',hash);
},true);
// A page opened by a button rather than the menu (Create Pro forma on a lead, Order from supplier, Open on My tasks)
// is recorded too, so Back returns to the page the button was on. Called when the menu highlights the open page.
function navRecordOpenPage(button){
 if(!button||navReplaying||navReplayPending||/^#\/(clients|client|branch)\b/.test(location.hash))return;
 const hash=navHash(button);if(location.hash===hash)return;
 if(/^#\/go\//.test(location.hash))history.pushState({erp:1},'',hash);else history.replaceState(history.state,'',hash);
}
window.addEventListener('popstate',()=>{
 if(/^#\/(clients|client|branch)\b/.test(location.hash))return;
 navReplay(location.hash);
});
// Reloading the page reopens the page that was showing.
if(/^#\/go\//.test(location.hash))navReplay(location.hash);
