'use strict';
// Type-to-search pickers. Every long dropdown (clients, contacts, suppliers…) and every suggestion box (products,
// Pro formas…) becomes one search box: type any part of any word, in any order, and pick from the list with the
// mouse, finger or arrow keys. The original <select>/<input> stays in the form and keeps its value, so every page
// reads and saves exactly as before.
const lookupMinOptions=12,lookupShown=60;
function lookupNormal(text){return String(text??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
// Every typed word must appear somewhere; names that start with the typed text come first, then word starts.
function lookupRank(items,query,limit=lookupShown){
 const q=lookupNormal(query),words=q.split(' ').filter(Boolean);
 if(!words.length)return {rows:items.slice(0,limit),total:items.length};
 const hits=[];
 for(const item of items){
  const text=item.search;let ok=true,score=0;
  for(const word of words){const at=text.indexOf(word);if(at<0){ok=false;break}score+=at===0?0:text[at-1]===' '?1:3;}
  if(!ok)continue;
  if(text.startsWith(q))score-=10;
  hits.push([score,item.label.length,item]);
 }
 hits.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 return {rows:hits.slice(0,limit).map(h=>h[2]),total:hits.length};
}
// Internal record IDs and review notes stay in the saved value but are not shown in the list.
function lookupTidy(label){return label.replace(/ · [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'').replace(/ · Specification needs review/g,'');}
function lookupOptionsOf(source){
 if(source.tagName==='SELECT')return [...source.options].filter(o=>o.value!==''&&!o.disabled).map(o=>({value:o.value,label:o.textContent.trim(),search:lookupNormal(o.textContent)}));
 const list=source._lookupList;return list?[...list.options].map(o=>{const label=lookupTidy(o.label&&o.label!==o.value?`${o.value} · ${o.label}`:o.value);return {value:o.value,label,search:lookupNormal(label)}}):[];
}
function lookupClose(box){box.querySelector('.lookup-list').hidden=true;box.querySelector('input.lookup-input').setAttribute('aria-expanded','false');}
function lookupRender(box,showAll=false){
 const input=box.querySelector('input.lookup-input'),list=box.querySelector('.lookup-list'),source=box._lookupSource;
 if(!box._lookupItems)box._lookupItems=lookupOptionsOf(source);
 const query=showAll?'':input.value,{rows,total}=lookupRank(box._lookupItems,query);
 box._lookupRows=rows;box._lookupActive=rows.length?0:-1;
 list.innerHTML=rows.length?rows.map((row,i)=>`<li role="option" id="${box.id}-o${i}" data-i="${i}" class="${i===0?'active':''}">${lookupMark(row.label,query)}</li>`).join('')+(total>rows.length?`<li class="lookup-more" aria-disabled="true">${total-rows.length} more · keep typing to narrow down</li>`:''):`<li class="lookup-more" aria-disabled="true">Nothing matches “${lookupEsc(input.value)}”</li>`;
 list.hidden=false;input.setAttribute('aria-expanded','true');
 input.setAttribute('aria-activedescendant',rows.length?`${box.id}-o0`:'');
}
function lookupEsc(text){return String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function lookupMark(label,query){
 const words=lookupNormal(query).split(' ').filter(Boolean);if(!words.length)return lookupEsc(label);
 const lower=label.toLowerCase(),marks=new Array(label.length).fill(false);
 for(const w of words){let at=lower.indexOf(w);while(at>=0){for(let i=at;i<at+w.length;i++)marks[i]=true;at=lower.indexOf(w,at+w.length);}}
 let out='',open=false;for(let i=0;i<label.length;i++){if(marks[i]&&!open){out+='<mark>';open=true}if(!marks[i]&&open){out+='</mark>';open=false}out+=lookupEsc(label[i]);}
 return out+(open?'</mark>':'');
}
function lookupMove(box,step){
 const rows=box._lookupRows||[];if(!rows.length)return;
 box._lookupActive=(box._lookupActive+step+rows.length)%rows.length;
 box.querySelectorAll('.lookup-list li[data-i]').forEach(li=>li.classList.toggle('active',Number(li.dataset.i)===box._lookupActive));
 const active=box.querySelector(`#${box.id}-o${box._lookupActive}`);active?.scrollIntoView({block:'nearest'});
 box.querySelector('input.lookup-input').setAttribute('aria-activedescendant',active?.id||'');
}
function lookupPick(box,row){
 const source=box._lookupSource,input=box.querySelector('input.lookup-input');
 if(source.tagName==='SELECT'){source.value=row.value;input.value=row.label;}
 else{source.value=row.value;}
 input.setCustomValidity('');lookupClose(box);
 source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));
}
// Show what the hidden <select> holds now (pages set .value or rebuild options without telling anyone).
function lookupSync(box){
 const source=box._lookupSource;if(source.tagName!=='SELECT')return;
 const input=box.querySelector('input.lookup-input'),chosen=source.selectedOptions[0];
 if(document.activeElement!==input)input.value=chosen&&chosen.value!==''?chosen.textContent.trim():'';
 input.disabled=source.disabled;
 const empty=source.options[0]&&source.options[0].value===''?source.options[0].textContent.trim():'';
 input.placeholder=empty?`${empty} · type to search`:'Type to search';
}
let lookupCount=0;
function lookupAttach(source){
 if(source._lookupBox||source.closest('.lookup'))return;
 const isSelect=source.tagName==='SELECT';
 if(isSelect&&(source.multiple||source.size>1))return;
 if(isSelect&&[...source.options].filter(o=>o.value!=='').length<lookupMinOptions&&!source.hasAttribute('data-lookup'))return;
 const box=document.createElement('div');box.className='lookup';box.id=`lookup${++lookupCount}`;box._lookupSource=source;source._lookupBox=box;
 let input;
 if(isSelect){
  input=document.createElement('input');input.type='search';input.autocomplete='off';input.className='lookup-input';
  if(source.required){input.required=true;source.required=false;source.dataset.lookupRequired='1';}
  input.setAttribute('aria-label',source.closest('label')?.querySelector('span')?.textContent||source.name||'Search');
  source.classList.add('lookup-source');source.tabIndex=-1;source.setAttribute('aria-hidden','true');
  source.parentNode.insertBefore(box,source);box.append(input,source);
 }else{
  input=source;source._lookupList=document.getElementById(source.getAttribute('list'));source.dataset.lookupList=source.getAttribute('list');source.removeAttribute('list');
  input.classList.add('lookup-input');source.parentNode.insertBefore(box,source);box.append(source);
 }
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',`${box.id}-list`);
 const list=document.createElement('ul');list.className='lookup-list';list.id=`${box.id}-list`;list.setAttribute('role','listbox');list.hidden=true;box.append(list);
 let timer=0;
 input.addEventListener('input',e=>{if(e.isTrusted===false&&!isSelect)return;clearTimeout(timer);timer=setTimeout(()=>lookupRender(box),60);
  if(isSelect){if(source.value!==''){source.value='';source.dispatchEvent(new Event('change',{bubbles:true}));}input.setCustomValidity('');}});
 input.addEventListener('focus',()=>{box._lookupItems=null;const chosen=isSelect&&source.value!=='';if(chosen)input.select();lookupRender(box,chosen);});
 input.addEventListener('click',()=>{if(list.hidden){box._lookupItems=null;lookupRender(box,isSelect&&source.value!=='');}});
 input.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'){e.preventDefault();list.hidden?lookupRender(box):lookupMove(box,1);}
  else if(e.key==='ArrowUp'){e.preventDefault();lookupMove(box,-1);}
  else if(e.key==='Enter'&&!list.hidden&&box._lookupRows?.length){e.preventDefault();lookupPick(box,box._lookupRows[box._lookupActive]);}
  else if(e.key==='Escape'&&!list.hidden){e.preventDefault();lookupClose(box);}
 });
 input.addEventListener('blur',()=>setTimeout(()=>{
  lookupClose(box);
  if(isSelect){
   if(source.value===''&&input.value.trim()){const only=lookupRank(lookupOptionsOf(source),input.value,2);if(only.total===1)lookupPick(box,only.rows[0]);else input.setCustomValidity('Choose one from the list');}
   lookupSync(box);
  }
 },150));
 list.addEventListener('mousedown',e=>e.preventDefault());
 list.addEventListener('click',e=>{const li=e.target.closest('li[data-i]');if(li)lookupPick(box,box._lookupRows[Number(li.dataset.i)]);});
 if(isSelect){
  new MutationObserver(()=>{box._lookupItems=null;lookupSync(box);}).observe(source,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  source.addEventListener('change',()=>lookupSync(box));
  lookupSync(box);
 }
}
// A <select> whose value a page sets in code (select.value=…) gives no event; keep the box text in step.
const lookupValueSetter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
Object.defineProperty(HTMLSelectElement.prototype,'value',{configurable:true,enumerable:lookupValueSetter.enumerable,get(){return lookupValueSetter.get.call(this)},set(v){lookupValueSetter.set.call(this,v);if(this._lookupBox)lookupSync(this._lookupBox);}});
function lookupScan(root=document){
 root.querySelectorAll?.('main select:not(.lookup-source), dialog select:not(.lookup-source), main input[list], dialog input[list]').forEach(lookupAttach);
}
// Datalists are often rebuilt after the input: refresh options when the list grows.
document.addEventListener('focusin',e=>{const box=e.target.closest?.('.lookup');if(box&&box._lookupSource.dataset.lookupList&&!box._lookupSource._lookupList?.isConnected)box._lookupSource._lookupList=document.getElementById(box._lookupSource.dataset.lookupList);});
// Before a form submits, a required lookup with nothing chosen points at the search box, not a hidden field.
document.addEventListener('submit',e=>{
 for(const source of e.target.querySelectorAll?.('select[data-lookup-required]')||[]){
  if(source.value===''){const input=source._lookupBox?.querySelector('input.lookup-input');if(input){input.setCustomValidity('Choose one from the list');input.reportValidity();}e.preventDefault();e.stopImmediatePropagation();return;}
 }
},true);
let lookupQueued=false;
new MutationObserver(()=>{if(lookupQueued)return;lookupQueued=true;requestAnimationFrame(()=>{lookupQueued=false;lookupScan();});}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>lookupScan());
