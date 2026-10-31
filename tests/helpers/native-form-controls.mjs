// Native-control contract for DOM identity tests. Browser validity flags are supplied
// explicitly; these fixtures do not claim to test the browser's constraint engine.
export function installNativeFormControls(document){
 const prototype=Object.getPrototypeOf(document.body),html=Object.getOwnPropertyDescriptor(prototype,'innerHTML');
 Object.defineProperties(prototype,{
  id:{configurable:true,get(){return this.attrs.id||''},set(value){this.attrs.id=value;}},
  className:{configurable:true,get(){return this.attrs.class||''},set(value){this.attrs.class=value;}},
  name:{configurable:true,get(){return this.getAttribute('name')||'';}},
  type:{configurable:true,get(){return this.getAttribute('type')||'';}},
  required:{configurable:true,get(){return this.getAttribute('required')!==null;}},
  willValidate:{configurable:true,get(){return !this.disabled&&!this.readOnly&&this.type!=='hidden';}},
  validity:{configurable:true,get(){return {valid:!this._customError&&!this._nativeError,customError:!!this._customError};}},
  validationMessage:{configurable:true,get(){return this._customError||this._nativeError||'';}},
  firstChild:{configurable:true,get(){return this.children[0]||null;}},
  elements:{configurable:true,get(){return new Proxy({},{get:(_,name)=>name==='namedItem'?key=>this.querySelector(`[name="${key}"]`):this.querySelector(`[name="${name}"]`)});}},
  innerHTML:{configurable:true,get(){return html.get.call(this)},set(value){html.set.call(this,value);for(const select of this.querySelectorAll('select')){const option=select.querySelector('option[selected]')||select.querySelector('option');select.value=option?.getAttribute('value')??option?.textContent??'';}for(const textarea of this.querySelectorAll('textarea'))textarea.value=textarea.textContent;}}
 });
 prototype.setCustomValidity=function(message){this._customError=message;};
 prototype.reset=function(){};
 prototype.removeAttribute=function(name){delete this.attrs[name];};
  prototype.scrollIntoView=function(options){this.scrolledIntoView=options;};
  prototype.removeEventListener=function(type,fn){this.events[type]=(this.events[type]||[]).filter(listener=>listener.fn!==fn);};
}

// Dispatch the bubbling event to registered listeners. onfocusout is not a
// browser event-handler property and must not make a broken binding pass here.
export function dispatchFocusout(control,relatedTarget=null){
 const event=new Event('focusout',{bubbles:true});Object.defineProperty(event,'target',{value:control});Object.defineProperty(event,'relatedTarget',{value:relatedTarget});
 for(let node=control;node;node=node.parentElement){
  Object.defineProperty(event,'currentTarget',{configurable:true,value:node});
  for(const {fn}of [...(node.events.focusout||[])])fn.call(node,event);
 }
 return event;
}
