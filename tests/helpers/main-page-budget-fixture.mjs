import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dom} from './dom-identity.mjs';

const root=new URL('../../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
// Match the fictional transport snapshots; midnight must not turn a request-budget case into a stale-stock case.
class BudgetDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-29T12:00:00Z']));}static now(){return Date.parse('2026-10-29T12:00:00Z');}}
const index=read('index.src.html');
export const excludedScripts=['vendor/supabase.js','vendor/phone.js','vendor/xlsx.full.min.js','config.js','smart-lookup.js'];
// Keep authored script order and all data-loading functions. Only replace the
// transport bootstrap; real load(), render(), navigation and decorators run.
const scripts=[...index.matchAll(/<script src="([^"?]+)[^"]*"><\/script>/g)].map(([,file])=>file).filter(file=>!excludedScripts.includes(file)).map(file=>{
 let source=read(file);
 if(file==='app.js'){
  const boot=source.split('\n').filter(line=>line.startsWith('(async()=>{const cfg=window.ERP_CONFIG;'));
  assert.equal(boot.length,1,'Locate only the transport/bootstrap IIFE');
  source=source.replace(boot[0],'');
 }
 return {file,script:new vm.Script(source,{filename:file})};
});
const encode=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function documentFixture(){
 const document=dom(),proto=Object.getPrototypeOf(document.body),html=Object.getOwnPropertyDescriptor(proto,'innerHTML');
 Object.defineProperty(proto,'innerHTML',{get(){return encode(this._text)+this.children.map(child=>child.outerHTML).join('');},set(value){html.set.call(this,value);for(const form of [this,...this.querySelectorAll('form')].filter(node=>node.tag==='form'))for(const control of form.querySelectorAll('[name]')){const name=control.getAttribute('name');if(!(name in form))Object.defineProperty(form,name,{configurable:true,get:()=>form.querySelector(`[name="${name}"]`)});}}});
 Object.defineProperty(proto,'outerHTML',{get(){return this.tag?`<${this.tag}${Object.entries(this.attrs).map(([key,value])=>` ${key}="${encode(value)}"`).join('')}>`+(['input','br','hr','img','meta','link'].includes(this.tag)?'':this.innerHTML+`</${this.tag}>`):encode(this._text);}});
 Object.defineProperties(proto,{
  id:{get(){return this.attrs.id||'';},set(value){this.attrs.id=value;}},
  className:{get(){return this.attrs.class||'';},set(value){this.attrs.class=value;}},
  tagName:{get(){return this.tag.toUpperCase();}},nodeType:{get(){return this.tag?1:3;}},
  firstChild:{get(){return this.children[0]||null;}},childNodes:{get(){return this.children;}},
  ownerDocument:{get(){return document;}},parentNode:{get(){return this.parentElement;}},
  style:{get(){return this._style??={setProperty(){},removeProperty(){}};}},
  classList:{get(){return {add:(...keys)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...keys])].join(' ');},remove:(...keys)=>{this.className=this.className.split(' ').filter(key=>!keys.includes(key)).join(' ');},contains:key=>this.className.split(' ').includes(key),toggle:(key,on)=>{const present=this.className.split(' ').includes(key);on=on??!present;if(on)this.classList.add(key);else this.classList.remove(key);return on;}};}}
 });
 proto.hasAttribute=function(key){return key in this.attrs;};proto.removeAttribute=function(key){delete this.attrs[key];};
 proto.prepend=function(...nodes){for(const node of nodes.reverse())this.insertBefore(node,this.children[0]||null);};
 proto.before=function(node){this.parentElement.insertBefore(node,this);};
 proto.removeEventListener=function(name,fn){this.events[name]=(this.events[name]||[]).filter(event=>event.fn!==fn);};
 proto.getClientRects=()=>[{}];proto.getBoundingClientRect=()=>({height:60,top:0,left:0,width:1280});
 proto.scrollIntoView=()=>{};
 document.body.innerHTML=index.match(/<body>([\s\S]*?)<script/)[1];
 document.getElementById=id=>document.querySelector('#'+id);
 document.addEventListener=(...args)=>document.body.addEventListener(...args);
 document.removeEventListener=(...args)=>document.body.removeEventListener(...args);
 document.documentElement=document.createElement('html');document.hidden=false;document.readyState='complete';
 return document;
}
function storage(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),get length(){return data.size;},key:index=>[...data.keys()][index]};}
class FixtureFormData{
 constructor(form){this.fields=form.querySelectorAll('input,select,textarea').filter(control=>control.getAttribute('name')&&!control.disabled&&!(['checkbox','radio'].includes(control.getAttribute('type'))&&!(control.checked??control.hasAttribute('checked')))).map(control=>[control.getAttribute('name'),control.getAttribute('type')==='checkbox'?(control.value||'on'):control.value]);}
 [Symbol.iterator](){return this.fields[Symbol.iterator]();}
 get(name){return this.fields.find(([key])=>key===name)?.[1]??null;}
 has(name){return this.fields.some(([key])=>key===name);}
}

export function mainPageFixture({role='owner',department='management',access=[],accounting=true,rpcs={},tables={},directorySize=70}={}){
 const document=documentFixture(),calls=[],authCalls=[],unexpected=[],timers=new Map(),intervals=[],errors=[];
 const actor={user_id:'actor',role,department,access,active:true,phone:''},directory=Array.from({length:directorySize},(_,n)=>({user_id:n?'employee-'+n:actor.user_id,display_name:n?'Fictional Employee '+n:'Fictional Current Employee',name_version:1}));
 const staff=directory.map((row,n)=>({...actor,user_id:row.user_id,role:n?'staff':role,department:n%2?'sales':department}));
 let timerSequence=0,inFlight=0;
 const fail=text=>{unexpected.push(text);throw Error(text);};
 async function request(call,handler){calls.push(call);inFlight++;try{await Promise.resolve();return {data:structuredClone(await handler()),error:null};}finally{inFlight--;}}
 const defaults={two_step_setup_required:()=>false,list_staff_display_names:args=>{assert.ok(Number.isInteger(args.p_limit)&&args.p_limit>=1&&args.p_limit<=100,'Directory RPC limit (migration 040)');const start=args.p_after_id?directory.findIndex(row=>row.user_id===args.p_after_id)+1:0,items=directory.slice(start,start+args.p_limit);return {items,next_after_id:start+items.length<directory.length?items.at(-1).user_id:null};},accounting_access:()=>accounting,notification_summary:()=>({tasks:2,work:1,results:0,notices:0}),staff_two_step_status:()=>staff.map(row=>({user_id:row.user_id,enabled:true})),staff_accounting_access:()=>[{user_id:actor.user_id,active:accounting}]};
 defaults.get_my_staff_profile=()=>({...actor,display_name:'Fictional Current Employee',name_version:1,contact_email:'',phone:''});
 defaults.two_step_required=()=>role==='owner'||accounting;
 const client={
  auth:{getUser:async()=>{authCalls.push('getUser');return {data:{user:{id:actor.user_id,user_metadata:{}}}};},mfa:{getAuthenticatorAssuranceLevel:async()=>{authCalls.push('mfa.getAuthenticatorAssuranceLevel');return {data:{currentLevel:'aal2',nextLevel:'aal2',currentAuthenticationMethods:[{method:'totp',timestamp:BudgetDate.now()/1000}]}};},listFactors:async()=>{authCalls.push('mfa.listFactors');return {data:{totp:[{id:'factor',status:'verified'}]}};}}},
  rpc(name,args={}){return request({kind:'rpc',name,args:structuredClone(args)},()=>{const handler=rpcs[name]||defaults[name];if(!handler)return fail('Unexpected RPC '+name);return typeof handler==='function'?handler(args):handler;});},
  from(table){
   const query={kind:'from',name:table,filters:[],orders:[]};let result;
   const chain={select(columns,options){query.columns=columns;query.options=options;return chain;},order(...args){query.orders.push(args);return chain;},range(from,to){query.range=[from,to];return chain;},limit(limit){query.limit=limit;return chain;},single(){query.single=true;return chain;},maybeSingle(){query.single=true;return chain;},then(resolve,reject){
    result??=request({...query},()=>{
     if(table==='staff'){
      assert.ok(['user_id,role,active,department,access','user_id,role,active,phone,department,access'].includes(query.columns),'Unexpected staff query '+query.columns);
      if(query.single){assert.deepEqual(query.filters,[['eq','user_id',actor.user_id]]);return actor;}
      assert.equal(query.filters.length,0);return role==='head'?staff.filter(row=>row.department===department):staff;
     }
     const handler=tables[table];if(!handler)return fail('Unexpected table query '+table+' '+query.columns);
     return handler(query);
    }).then(response=>({...response,count:Array.isArray(response.data)?response.data.length:null}));
    return result.then(resolve,reject);
   }};
   for(const method of ['eq','neq','is','in','gte','gt','lte','lt','or','not'])chain[method]=(...args)=>{query.filters.push([method,...args]);return chain;};
   return chain;
  }
 };
 const location={hash:'',href:'https://fictional.invalid/',origin:'https://fictional.invalid'},history={state:null,pushState(_,__,hash){location.hash=hash;},replaceState(_,__,hash){location.hash=hash;}};
 const ctx=vm.createContext({document,location,history,FormData:FixtureFormData,localStorage:storage(),sessionStorage:storage(),URL,URLSearchParams,Intl,Date:BudgetDate,Map,Set,Promise,structuredClone,AbortController,TextEncoder,performance,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},CSS:{escape:String},navigator:{onLine:true},console:{log(){},warn(){},error:(...args)=>errors.push(args.join(' '))},
  setTimeout(fn,delay=0){const id=++timerSequence;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval(fn,delay){intervals.push({fn,delay});return intervals.length;},clearInterval(){},
  MutationObserver:class{observe(){}disconnect(){}},addEventListener(){},removeEventListener(){},scrollTo(){},scrollX:0,scrollY:0,confirm(){throw Error('Unexpected confirmation on landing');},fetch(){return fail('Unexpected fetch outside fixture transport');},requestAnimationFrame:fn=>fn(),cancelAnimationFrame(){},__client:client
 });ctx.window=ctx;document.defaultView=ctx;
 for(const {script} of scripts)script.runInContext(ctx);
 vm.runInContext('client=__client;',ctx);
 const evaluate=source=>vm.runInContext(source,ctx);
 async function settle(){
  let quiet=0;
  for(let turn=0;turn<60&&quiet<4;turn++){
   const before=calls.length;
   // Advance every one-shot timer so a deferred decorator cannot escape the
   // budget. Recurring polling is recorded separately from a single cold open.
   for(const [id,timer] of [...timers]){timers.delete(id);await timer.fn();}
   await new Promise(setImmediate);
   quiet=!inFlight&&calls.length===before&&!timers.size?quiet+1:0;
  }
  assert.equal(inFlight,0,'Outstanding fixture database requests');assert.equal(quiet,4,'Landing did not settle');
  assert.deepEqual(unexpected,[],'Unknown transport requests may not be swallowed by production catch handlers');
  assert.deepEqual(errors,[],'Unexpected console errors');
 }
 return {ctx,document,calls,authCalls,actor,staff,directory,evaluate,settle,async open(state){for(const [key,value] of Object.entries(state))evaluate(`${key}=${JSON.stringify(value)}`);await ctx.load();await settle();},scripts:scripts.map(row=>row.file),intervals};
}
