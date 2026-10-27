'use strict';
// Type-to-search pickers. Every long dropdown (clients, contacts, suppliers…) and every suggestion box (products,
// Pro formas…) becomes one search box: type any part of any word, in any order, and pick from the list with the
// mouse, finger or arrow keys. The original <select>/<input> stays in the form and keeps its value, so every page
// reads and saves exactly as before.
const lookupMinOptions=12,lookupShown=60;
function lookupNormal(text){return String(text??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function lookupModelKeys(text){return (lookupNormal(text).match(/\b[a-z]+ ?[0-9]+[a-z0-9]*\b/g)||[]).map(key=>key.replace(/ /g,''));}
// Every typed word must appear somewhere; names that start with the typed text come first, then word starts.
function lookupRank(items,query,limit=lookupShown){
 const q=lookupNormal(query),words=q.split(' ').filter(Boolean),models=lookupModelKeys(q);
 if(!words.length)return {rows:items.slice(0,limit),total:items.length};
 const hits=[];
 for(const item of items){
  const text=item.search;let ok=true,score=0,compact;
  for(const word of words){
   // Model digits must start a token and end at a digit boundary: DP10 must not suggest DP100.
   if(item.product&&/[0-9]/.test(word)&&![...text.split(' '),...item.models].some(token=>{
    const candidate=/^[0-9]/.test(word)?token.replace(/^[a-z]+/,''):token;
    return candidate.startsWith(word)&&!/[0-9]/.test(candidate[word.length]||'');
   })){ok=false;break;}
   const at=text.indexOf(word);if(at<0){
   // Product model numbers and names may be entered without their printed spaces or hyphens.
   compact??=text.replace(/ /g,'');if(!compact.includes(word)){ok=false;break}score+=4;
  }else score+=at===0?0:text[at-1]===' '?1:3;}
  if(!ok)continue;
  if(text.startsWith(q))score-=10;
  if(item.product&&item.models.some(model=>models.includes(model)||words.includes(model.replace(/^[a-z]+/,''))))score-=item.category==='machines'?30:5;
  hits.push([score,item.label.length,item]);
 }
 hits.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 return {rows:hits.slice(0,limit).map(h=>h[2]),total:hits.length};
}
// Internal record IDs and review notes stay in the saved value but are not shown in the list.
function lookupTidy(label){return label.replace(/ · [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'').replace(/ · Specification needs review/g,'');}
// A client/branch list has ~10,000 entries, and a <select> holding them all took a quarter of a second to draw on a
// desktop (seconds on a phone). <select data-lookup-rows="organizations"> holds only its chosen option: the box offers
// every row from lookupRowSources, and picking one adds its <option> before choosing it, so the form reads and saves
// the <select> exactly as before.
const lookupRowSources={organizations:()=>organizations.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(row=>({value:row.id,label:`${row.name}${row.location?' · '+row.location:''}`}))};
// Likewise <datalist data-lookup-values="products"> takes its suggestions from lookupValueSources, not <option>s.
const lookupValueSources={products:()=>inventorySelectableProducts().map(product=>{
 const source=product.source||{},category=inventoryClassification(product.id)?.category||catalogCategoryOf(product),model=source.model&&source.specification&&source.model!==source.specification?` · ${source.model}`:'';
 const label=`${lookupTidy(inventoryProductIdentity(product))}${model} · ${catalogLabel(category)}`;
 return {value:inventoryProductChoice(product),label,search:lookupNormalCached(label),product:true,category,models:lookupModelKeys(`${product.name} ${source.model||''} ${source.specification||''}`)};
})};
const lookupNormals=new Map();
function lookupNormalCached(text){let value=lookupNormals.get(text);if(value===undefined){if(lookupNormals.size>100000)lookupNormals.clear();value=lookupNormal(text);lookupNormals.set(text,value);}return value;}
function lookupOptionsOf(source){
 const rows=lookupRowSources[source.dataset?.lookupRows];
 if(rows)return rows().filter(row=>row.value!=='').map(row=>{const label=String(row.label).trim();return {value:row.value,label,search:lookupNormalCached(label)}});
 if(source.tagName==='SELECT')return [...source.options].filter(o=>o.value!==''&&!o.disabled).map(o=>({value:o.value,label:o.textContent.trim(),search:lookupNormalCached(o.textContent)}));
 const list=source._lookupList,values=lookupValueSources[list?.dataset.lookupValues];
 if(values)return values();
 return list?[...list.options].map(o=>{const label=lookupTidy(o.label&&o.label!==o.value?`${o.value} · ${o.label}`:o.value);return {value:o.value,label,search:lookupNormalCached(label)}}):[];
}
function lookupClose(box){clearTimeout(box._lookupTimer);box._lookupTimer=0;box.querySelector('.lookup-list').hidden=true;const input=box.querySelector('input.lookup-input');input.setAttribute('aria-expanded','false');input.setAttribute('aria-activedescendant','');}
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
 if(source.tagName==='SELECT'&&![...source.options].some(o=>o.value===row.value))source.add(new Option(row.label,row.value));
 if(source!==input){source.setCustomValidity('');source.value=row.value;input.value=row.label;}
 else{source.value=row.value;}
 input.setCustomValidity('');lookupClose(box);box._lookupHold=false;
 source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));
}
// Keep the readable label in step with the canonical form field, including draft edits.
function lookupSync(box){
 const source=box._lookupSource,input=box.querySelector('input.lookup-input');if(source===input)return;
 if(source.tagName!=='SELECT'){
  if(source.value)input.value=(box._lookupItems||lookupOptionsOf(source)).find(row=>row.value===source.value)?.label||lookupTidy(source.value);
  else if(document.activeElement!==input)input.value='';
  input.disabled=source.disabled;input.placeholder=source.placeholder;return;
 }
 const chosen=source.selectedOptions[0];
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
 if(isSelect&&[...source.options].filter(o=>o.value!=='').length<lookupMinOptions&&!source.hasAttribute('data-lookup')&&!source.dataset.lookupRows)return;
 if(!isSelect){source._lookupList=document.getElementById(source.getAttribute('list'));source.dataset.lookupList=source.getAttribute('list');source.removeAttribute('list');}
 const isProduct=source._lookupList?.dataset.lookupValues==='products',isBound=isSelect||isProduct;
 const box=document.createElement('div');box.className='lookup';box.id=`lookup${++lookupCount}`;box._lookupSource=source;source._lookupBox=box;
 let input;
 if(isBound){
  input=document.createElement('input');input.type='search';input.autocomplete='off';input.className='lookup-input';
  // The original stays the required field (forms check it by name); when the browser flags it, the message is
  // shown on the search box instead of the hidden list.
  source.addEventListener('invalid',e=>{e.preventDefault();input.setCustomValidity(source.validity.customError?source.validationMessage:'Choose one from the list');input.reportValidity();});
  const labelledBy=source.getAttribute('aria-labelledby');
  if(labelledBy)input.setAttribute('aria-labelledby',labelledBy);
  else input.setAttribute('aria-label',source.getAttribute('aria-label')||[...(source.labels||[])].map(label=>label.textContent.trim()).join(' ')||source.closest('label')?.querySelector('span')?.textContent||source.name||'Search');
  source.classList.add('lookup-source');source.tabIndex=-1;source.setAttribute('aria-hidden','true');
  if(isProduct){
   source.hidden=true;
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'),setValidity=source.setCustomValidity.bind(source);
   Object.defineProperty(source,'value',{configurable:true,get(){return setter.get.call(this)},set(value){setter.set.call(this,value);lookupSync(box);}});
   source.setCustomValidity=message=>{setValidity(message);input.setCustomValidity(message);};
   if(source.validity.customError)input.setCustomValidity(source.validationMessage);
   source.form?.addEventListener('reset',()=>setTimeout(()=>{source.setCustomValidity('');input.value='';lookupSync(box);lookupClose(box);},0));
  }
  source.parentNode.insertBefore(box,source);box.append(input,source);
 }else{
  input=source;
  input.classList.add('lookup-input');source.parentNode.insertBefore(box,source);box.append(source);
 }
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',`${box.id}-list`);
 const list=document.createElement('ul');list.className='lookup-list';list.id=`${box.id}-list`;list.setAttribute('role','listbox');list.hidden=true;box.append(list);
 input.addEventListener('input',e=>{if(e.isTrusted===false&&!isBound)return;clearTimeout(box._lookupTimer);box._lookupTimer=setTimeout(()=>{box._lookupTimer=0;lookupRender(box);},60);
  if(isBound){source.setCustomValidity('');input.setCustomValidity('');if(source.value!==''){source.value='';if(isProduct)source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));}}});
 input.addEventListener('focus',()=>{box._lookupItems=null;const chosen=isBound&&source.value!=='';if(chosen)input.select();lookupRender(box,chosen);});
 input.addEventListener('click',()=>{if(list.hidden){box._lookupItems=null;lookupRender(box,isBound&&source.value!=='');}});
 input.addEventListener('keydown',e=>{
  if(box._lookupTimer&&['ArrowDown','ArrowUp','Enter'].includes(e.key)){clearTimeout(box._lookupTimer);box._lookupTimer=0;lookupRender(box);}
  if(e.key==='ArrowDown'){e.preventDefault();list.hidden?lookupRender(box):lookupMove(box,1);}
  else if(e.key==='ArrowUp'){e.preventDefault();lookupMove(box,-1);}
  else if(e.key==='Enter'&&!list.hidden&&box._lookupRows?.length){e.preventDefault();lookupPick(box,box._lookupRows[box._lookupActive]);}
  else if(e.key==='Escape'&&!list.hidden){e.preventDefault();lookupClose(box);}
 });
 // Leaving the box never picks for the person; typed text that is not a choice is flagged instead. While a finger
 // or mouse is on the list (scrolling on a phone blurs the box), the list stays open.
 const leave=()=>{
  lookupClose(box);box._lookupHold=false;
  if(isBound){if(source.value===''&&input.value.trim())input.setCustomValidity(source.validity.customError?source.validationMessage:'Choose one from the list');else lookupSync(box);}
 };
 box._lookupLeave=leave;
 input.addEventListener('blur',()=>setTimeout(()=>{if(box._lookupHold||document.activeElement===input)return;leave();},150));
 list.addEventListener('pointerdown',()=>{box._lookupHold=true;});
 list.addEventListener('mousedown',e=>e.preventDefault());
 list.addEventListener('click',e=>{const li=e.target.closest('li[data-i]');if(li)lookupPick(box,box._lookupRows[Number(li.dataset.i)]);});
 if(isBound){
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
// A tap anywhere outside an open list closes it.
document.addEventListener('pointerdown',e=>{document.querySelectorAll('.lookup').forEach(box=>{if(!box.contains(e.target)&&!box.querySelector('.lookup-list').hidden&&document.activeElement!==box.querySelector('input.lookup-input'))box._lookupLeave?.();else if(!box.contains(e.target))box._lookupHold=false;});},true);
let lookupQueued=false;
new MutationObserver(()=>{if(lookupQueued)return;lookupQueued=true;requestAnimationFrame(()=>{lookupQueued=false;lookupScan();});}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>lookupScan());
