import assert from 'node:assert/strict';
// DOM identity fixture only; layout, accessibility and native input still require browser testing.
export function dom(){
 const decode=s=>String(s).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&');let document;
 const dataName=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 class Node{
  constructor(tag='',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.events={};this._text='';this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.value=attrs.value||'';this.selectionStart=this.selectionEnd=0;this.scrollLeft=0;this.open='open'in attrs;this.dataset=new Proxy({},{get:(_,key)=>this.attrs[dataName(key)],set:(_,key,value)=>(this.attrs[dataName(key)]=value,true),ownKeys:()=>Object.keys(this.attrs).filter(key=>key.startsWith('data-')).map(key=>key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});}
  get id(){return this.attrs.id;}get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value);}
  set innerHTML(value){this.replaceChildren(...parse(value));}get innerHTML(){return this._text+this.children.map(child=>child.outerHTML).join('');}
  get outerHTML(){return this.tag?`<${this.tag}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('')}>${this.innerHTML}</${this.tag}>`:this._text;}
  get nextElementSibling(){const rows=this.parentElement?.children.filter(node=>node.tag)||[];return rows[rows.indexOf(this)+1]||null;}
  showModal(){this.open=true;this.attrs.open='';}close(){this.open=false;delete this.attrs.open;this.emit('close');}
  get firstElementChild(){return this.children.find(node=>node.tag)||null;}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){
   if(selector.includes(',')&&!selector.includes(':not('))return selector.split(',').some(part=>this.matches(part.trim()));
   let no=true;selector=selector.replace(/:not\(([^)]+)\)/g,(_,negative)=>{if(this.matches(negative))no=false;return '';});if(!no)return false;
   if(selector===':disabled')return this.disabled;
   const attrs=[...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];if(attrs.some(([,key,value])=>!(key in this.attrs)||value!==undefined&&this.attrs[key]!==value))return false;
   selector=selector.replace(/\[[^\]]+\]/g,'');const id=selector.match(/#([\w-]+)/)?.[1],klass=selector.match(/\.([\w-]+)/)?.[1],tag=selector.match(/^[a-z][a-z0-9-]*/)?.[0];return (!id||this.id===id)&&(!klass||(this.attrs.class||'').split(' ').includes(klass))&&(!tag||this.tag===tag);
  }
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelectorAll(selector){const out=[],selectors=selector.split(',').map(value=>value.trim());const visit=node=>{for(const child of node.children){if(child.tag&&selectors.some(value=>{const parts=value.split(/\s+/);return child.matches(parts.at(-1))&&(parts.length===1||child.parentElement?.closest(parts.slice(0,-1).join(' ')));}))out.push(child);visit(child);}};visit(this);return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  after(node){this.parentElement.insertBefore(node,this.nextElementSibling);}
  insertBefore(node,before){node.remove();const at=before?this.children.indexOf(before):this.children.length;assert.notEqual(at,-1);this.children.splice(at,0,node);node.parentElement=this;}
  replaceChildren(...nodes){for(const node of [...this.children])node.remove();this._text='';this.append(...nodes);}
  replaceWith(node){const parent=this.parentElement;assert.ok(parent,'Replacement requires an attached old node');parent.insertBefore(node,this);this.remove();}
  remove(){if(!this.parentElement)return;if(this.isConnected&&this.contains(document.activeElement))document.activeElement=document.body;const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}
  insertAdjacentHTML(position,html){if(position==='beforeend')this.append(...parse(html));else if(position==='afterend'){const next=this.nextElementSibling;for(const node of parse(html))this.parentElement.insertBefore(node,next);}else assert.fail('Unsupported fixture insertion '+position);}
  addEventListener(name,fn,options){(this.events[name]??=[]).push({fn,once:!!options?.once});}
  emit(name){for(const event of [...(this.events[name]||[])]){event.fn();if(event.once)this.events[name].splice(this.events[name].indexOf(event),1);}}
  focus(){document.activeElement=this;}setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  get elements(){return new Proxy({},{get:(_,name)=>this.querySelector(`[name="${name}"]`)});}
 }
 function parse(html){const root=new Node(),stack=[root],svgNodes=new Set();for(const token of String(html).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[match[1]]=decode(match[2]??'');const node=new Node(tag,attrs),parent=stack.at(-1);
   // SVG honors self-closing syntax; its HTML integration points do not.
   const svg=tag.toLowerCase()==='svg'||svgNodes.has(parent)&&!['foreignobject','desc','title'].includes(parent.tag.toLowerCase());if(svg)svgNodes.add(node);
   parent.append(node);if(!['input','br','hr','img','meta','link'].includes(tag)&&!(svg&&/\/\s*>$/.test(token)))stack.push(node);
  }else{const node=new Node();node._text=decode(token);stack.at(-1).append(node);}}return [...root.children];}
 document={createElement(tag){const node=new Node(tag);if(tag==='template'){node.content=new Node();Object.defineProperty(node,'innerHTML',{set:value=>node.content.innerHTML=value});}return node;}};document.body=new Node('body');document.activeElement=document.body;document.querySelector=selector=>document.body.querySelector(selector);document.querySelectorAll=selector=>document.body.querySelectorAll(selector);return document;
}
