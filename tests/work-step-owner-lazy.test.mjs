import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Element{
 constructor(tag='div',root=false){this.tagName=tag.toUpperCase();this.root=root;this.parentElement=null;this.children=[];this._html='';this.open=false;}
 get isConnected(){return this.root||Boolean(this.parentElement?.isConnected);}
 get innerHTML(){return this._html;}
 set innerHTML(value){this._html=value;this.replaceChildren();if(value.includes('data-step-settings')){const panel=new Element();panel.settings=true;this.append(panel);}}
 append(child){child.parentElement=this;this.children.push(child);}
 replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];for(const child of children)this.append(child);}
 querySelector(selector){return selector==='[data-step-settings]'?this.children.find(child=>child.settings):null;}
 querySelectorAll(){return [];}
}
function fixture(role='owner'){
 const calls=[],pending=[],target=new Element('section',true),ctx=vm.createContext({me:{user_id:'owner',role},employeeDirectory:new Map(),employeeName:id=>id,esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),document:{createElement:tag=>new Element(tag)},
  client:{from:table=>({select:columns=>({order:(column,options)=>{calls.push({table,columns,column,options});const request=deferred();pending.push(request);return request.promise;}})})}});
 vm.runInContext(source,ctx);
 return {ctx,target,calls,pending,section:()=>target.children[0],panel:()=>target.children[0]?.querySelector('[data-step-settings]')};
}

test('default-owner settings create only a closed disclosure and issue no request until expanded',async()=>{
 const f=fixture();await f.ctx.renderWorkStepOwners(f.target);
 assert.equal(f.calls.length,0);assert.equal(f.section().tagName,'DETAILS');assert.equal(f.section().open,false);assert.equal(f.panel().innerHTML,'');
 f.section().open=true;const loading=f.section().ontoggle();assert.equal(f.calls.length,1);assert.match(f.panel().innerHTML,/Opening step assignments/);
 await f.section().ontoggle();assert.equal(f.calls.length,1,'repeated toggle while loading cannot duplicate the request');
 f.pending[0].resolve({data:[]});await loading;assert.equal(f.panel().children.length,1);assert.match(f.panel().children[0].innerHTML,/Who does each step/);
 f.section().open=false;await f.section().ontoggle();f.section().open=true;await f.section().ontoggle();assert.equal(f.calls.length,1,'successful settings are reused while this disclosure is mounted');
});

test('database and connection errors remain visible and closing/reopening retries',async()=>{
 for(const rejected of [false,true]){
  const f=fixture();await f.ctx.renderWorkStepOwners(f.target);f.section().open=true;const first=f.section().ontoggle();
  if(rejected)f.pending[0].reject(Error('Connection <failed>'));else f.pending[0].resolve({error:{message:'Owner <access> unavailable'}});
  await first;assert.match(f.panel().innerHTML,/role="alert"/);assert.match(f.panel().innerHTML,/&#60;/);assert.doesNotMatch(f.panel().innerHTML,/<failed>|<access>/);
  f.section().open=false;await f.section().ontoggle();f.section().open=true;const retry=f.section().ontoggle();assert.equal(f.calls.length,2);
  f.pending[1].resolve({data:[]});await retry;assert.equal(f.panel().children.length,1);
 }
});

test('late settings results cannot paint a detached panel or a replacement session',async()=>{
 for(const change of ['detached','session'])for(const rejected of [false,true]){
  const f=fixture();await f.ctx.renderWorkStepOwners(f.target);const panel=f.panel(),section=f.section();section.open=true;const loading=section.ontoggle();
  if(change==='detached')f.target.replaceChildren();else f.ctx.me={user_id:'owner',role:'owner'};
  if(rejected)f.pending[0].reject(Error('Late failure'));else f.pending[0].resolve({data:[]});await loading;
  assert.match(panel.innerHTML,/Opening step assignments/);assert.equal(panel.children.length,0);
 }
});

test('non-owners cannot create or open default-owner settings',async()=>{
 const f=fixture('head');await f.ctx.renderWorkStepOwners(f.target);assert.equal(f.target.children.length,0);assert.equal(f.calls.length,0);
 const owner=fixture();await owner.ctx.renderWorkStepOwners(owner.target);owner.ctx.me={user_id:'head',role:'head'};owner.section().open=true;await owner.section().ontoggle();assert.equal(owner.calls.length,0);
});
