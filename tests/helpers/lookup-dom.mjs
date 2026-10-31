import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// DOM plumbing for the actual lookup decorator; no browser layout or native
// validity engine is simulated here. Constraint flags come from the form fixture.
export function installLookupDom(ctx){
 const document=ctx.document,prototype=Object.getPrototypeOf(document.body),matches=prototype.matches;
 prototype.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};
 const value={configurable:true,enumerable:true,get(){return this._lookupFixtureValue??'';},set(value){this._lookupFixtureValue=String(value);}};
 for(const node of [document.body,...document.querySelectorAll('*')]){node._lookupFixtureValue=node.value;delete node.value;}
 Object.defineProperties(prototype,{
  value,type:{configurable:true,get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}},
  tagName:{configurable:true,get(){return this.tag.toUpperCase();}},parentNode:{configurable:true,get(){return this.parentElement;}},form:{configurable:true,get(){return this.closest('form');}},
  nodeType:{configurable:true,get(){return this.tag?1:3;}},childNodes:{configurable:true,get(){return this.children;}},
  options:{configurable:true,get(){return this.querySelectorAll('option');}},selectedOptions:{configurable:true,get(){return this.options.filter(option=>option.value===this.value);}},
  labels:{configurable:true,get(){return document.querySelectorAll('label').filter(label=>label.hasAttribute('for')?!!this.id&&label.getAttribute('for')===this.id:label===this.closest('label'));}},
  classList:{configurable:true,get(){const node=this;return {add(name){node.className=[...new Set((node.className+' '+name).split(/\s+/).filter(Boolean))].join(' ');},toggle(name,enabled){const classes=new Set(node.className.split(/\s+/).filter(Boolean));if(enabled)classes.add(name);else classes.delete(name);node.className=[...classes].join(' ');}};}}
 });
 prototype.hasAttribute=function(name){return this.getAttribute(name)!==null;};
 prototype.add=function(option){this.append(option);};
 prototype.dispatchEvent=function(event){for(let node=this;node;node=event.bubbles?node.parentElement:null){const detail={...event,target:this,currentTarget:node};node['on'+event.type]?.(detail);for(const {fn}of node.events[event.type]||[])fn(detail);}return true;};
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);
 const inputPrototype={};Object.defineProperty(inputPrototype,'value',value);
 Object.assign(ctx,{HTMLInputElement:{prototype:inputPrototype},HTMLSelectElement:{prototype},MutationObserver:class{observe(){}},Event:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}preventDefault(){}},Option:function(label,value){const option=document.createElement('option');option.value=value;option.textContent=label;return option;},setTimeout,clearTimeout,requestAnimationFrame:()=>{}});
 vm.runInContext(readFileSync(new URL('../../smart-lookup.js',import.meta.url),'utf8'),ctx);
}
