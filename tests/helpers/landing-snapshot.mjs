import assert from 'node:assert/strict';

export const axeScript='/axe-core-4.14.0.min.js';
export const shellScripts=Object.freeze(['/source/ui-motion.js','/source/nav-dropdown.js','/source/ui-page-header.js']);
export const shellBootstrapScript='/axe-landings/shell-bootstrap.js';
export const shellBootstrapSource="document.addEventListener('DOMContentLoaded',()=>{installWorkspaceHeaderScroll();document.documentElement.dataset.landingShellReady='true';},{once:true});\n";
export const snapshotCsp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'";
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const decode=value=>String(value).replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
function attributes(text){return Object.fromEntries([...text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(([,key,value])=>[key,decode(value)]));}
function localSource(value){
 assert.ok(typeof value==='string'&&value&&!/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value),'Authored asset must be a local source path');
 const path=value.split(/[?#]/)[0];assert.ok(!path.startsWith('/')&&!path.split('/').includes('..'),'Authored asset must stay within the source directory');
 return (value.startsWith('assets/')?'/':'/source/')+value;
}
function attributeHtml(attrs){return Object.entries(attrs).map(([key,value])=>{
 assert.match(key,/^[a-zA-Z_:][\w:.-]*$/,'Valid attribute name');assert.ok(!/^on/i.test(key),'Inline event handlers are not exported');
 return ` ${key}="${escape(value)}"`;
}).join('');}

export function installLandingValueReflection(document){
 const prototype=Object.getPrototypeOf(document.body),values=new WeakMap();
 const initial=node=>{
  if(node.tag==='textarea')return node.textContent;
  if(node.tag==='select'){
   const options=node.querySelectorAll('option'),selected=options.find(option=>typeof option.selected==='boolean'?option.selected:'selected' in option.attrs)||options[0];
   return selected?selected.attrs.value??selected.textContent:'';
  }
  return node.attrs.value??'';
 };
 // Native controls derive their initial value from child markup. The fixture's
 // constructor assigns an empty own value before those children are parsed.
 const existing=[document.body,...document.body.querySelectorAll('input,select,textarea,option')];
 for(const node of existing){const value=node.value;delete node.value;values.set(node,{value,initial:value===''||value===initial(node)});}
 Object.defineProperty(prototype,'value',{configurable:true,get(){const state=values.get(this);return !state||state.initial?initial(this):state.value;},set(value){values.set(this,{value:String(value??''),initial:!values.has(this)});}});
}

export function landingHead(index){
 const html=attributes(index.match(/<html\b([^>]*)>/i)?.[1]||'');
 const head=index.match(/<head>([\s\S]*?)<\/head>/i)?.[1];assert.ok(head,'Authored document head is present');assert.ok(html.lang,'Authored language is present');
 const title=head.match(/<title>([\s\S]*?)<\/title>/i)?.[1];assert.ok(title,'Authored title is present');
 const metas=[...head.matchAll(/<meta\b([^>]*)>/gi)].map(match=>attributes(match[1]));
 const viewport=metas.find(meta=>meta.name==='viewport')?.content;assert.ok(viewport,'Authored viewport is present');
 const styles=[...head.matchAll(/<link\b([^>]*)>/gi)].map(match=>attributes(match[1])).filter(link=>link.rel==='stylesheet');assert.ok(styles.length,'Authored stylesheets are present');
 return {html,title:decode(title),viewport,styles:styles.map(link=>({...link,href:localSource(link.href)}))};
}

// The identity DOM does not reflect JavaScript properties into attributes.
// Serialize effective control state without enabling or disabling any control.
export function serializeLandingNode(node,{selectValue=null}={}){
 if(!node.tag)return escape(node._text||'');
 const tag=node.tag.toLowerCase();assert.ok(!['script','iframe','object','embed','base'].includes(tag),'Active embedded content is not exported');
 const attrs={...node.attrs};
 for(const [property,attribute] of [['hidden','hidden'],['disabled','disabled'],['inert','inert'],['open','open'],['checked','checked'],['selected','selected'],['multiple','multiple'],['required','required'],['readOnly','readonly']]){
  if(typeof node[property]!=='boolean')continue;if(node[property])attrs[attribute]='';else delete attrs[attribute];
 }
 if(tag==='input'){
  const type=String(attrs.type||'text').toLowerCase();
  if(type==='password'||type==='file'){assert.ok(!node.value,'Secret/file values must not appear in a landing export');delete attrs.value;}
  else attrs.value=node.value??attrs.value??'';
 }
 if(tag==='option'&&selectValue!==null){if((attrs.value??node.textContent)===selectValue)attrs.selected='';else delete attrs.selected;}
 for(const key of ['src','poster'])if(attrs[key])attrs[key]=/^data:image\//i.test(attrs[key])?attrs[key]:localSource(attrs[key]);
 for(const key of ['href','action','formaction'])if(attrs[key]){
  assert.ok(!/^\s*(?:javascript|data|vbscript):/i.test(attrs[key]),'Executable navigation is not exported');
  if(!/^(?:[a-z][\w+.-]*:|\/\/|#|\/)/i.test(attrs[key]))attrs[key]=localSource(attrs[key]);
 }
 assert.ok(!attrs.srcdoc&&!attrs.srcset,'Embedded HTML and alternate asset lists require explicit export handling');
 const start=`<${tag}${attributeHtml(attrs)}>`;if(voidTags.has(tag))return start;
 let content;
 if(tag==='textarea')content=escape(node.value??node.textContent);
 else{
  const selected=tag==='select'&&!('multiple' in attrs)?node.value??null:selectValue;
  content=escape(node._text||'')+node.children.map(child=>serializeLandingNode(child,{selectValue:selected})).join('');
 }
 return start+content+`</${tag}>`;
}

export function landingSnapshot(document,index){
 const head=landingHead(index),htmlAttrs={...head.html,...document.documentElement.attrs};
 const body=serializeLandingNode(document.body);
 return '<!doctype html>'+`<html${attributeHtml(htmlAttrs)}><head><meta charset="utf-8"><meta name="viewport" content="${escape(head.viewport)}"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escape(snapshotCsp)}"><title>${escape(head.title)}</title>${head.styles.map(link=>`<link${attributeHtml(link)}>`).join('')}</head>${body.slice(0,-7)}${[...shellScripts,shellBootstrapScript,axeScript].map(src=>`<script src="${src}"></script>`).join('')}</body></html>`;
}
