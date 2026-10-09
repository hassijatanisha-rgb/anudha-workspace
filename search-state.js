'use strict';
// Search screens redraw their results synchronously. Preserve the editing range
// (including type=search), rather than letting focus restart typing at the front.
// With wait (ms) the page is redrawn once typing pauses instead of on every key, so a long list never makes the
// box stutter. The box keeps what is typed meanwhile; a page drawn in between (another view) cancels the redraw.
const searchRedraws=new Map();
function renderSearchPreservingPosition(input,render,wait=0){
 if(wait){
  clearTimeout(searchRedraws.get(input.id));
  searchRedraws.set(input.id,setTimeout(()=>{searchRedraws.delete(input.id);if(!input.isConnected)return;if(document.activeElement===input)renderSearchPreservingPosition(input,render);else render();},wait));
  return;
 }
 const id=input.id,start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
 const horizontal=input.scrollLeft,x=window.scrollX,y=window.scrollY,parents=[];
 for(let parent=input.parentElement;parent;parent=parent.parentElement)parents.push([parent,parent.scrollLeft,parent.scrollTop]);
 render();
 const next=document.getElementById(id);
 if(!next)return;
 next.focus({preventScroll:true});
 if(start!==null&&end!==null)next.setSelectionRange(start,end,direction||'none');
 next.scrollLeft=horizontal;
 for(const [parent,left,top] of parents){parent.scrollLeft=left;parent.scrollTop=top;}
 window.scrollTo(x,y);
}
