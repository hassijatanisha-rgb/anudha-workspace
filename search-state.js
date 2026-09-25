'use strict';
// Search screens redraw their results synchronously. Preserve the editing range
// (including type=search), rather than letting focus restart typing at the front.
function renderSearchPreservingPosition(input,render){
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
